import assert from "node:assert/strict";
import test from "node:test";
import worker from "./worker.mjs";

class FakeKV {
  values = new Map();

  async getWithMetadata(key) {
    return this.values.get(key) || { value: null, metadata: null };
  }

  async get(key, type) {
    const value = this.values.get(key)?.value ?? null;
    return type === "json" && value !== null ? JSON.parse(value) : value;
  }

  async put(key, value, options = {}) {
    this.values.set(key, { value, metadata: options.metadata || null });
  }
}

const environment = () => ({
  APP_PASSWORD: "correct horse battery staple",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
  GUEST_TOKEN: "private-guest-link-token",
  WEREAD_API_KEY_1: "wrk-test-account-one",
  AI: {
    run: async () => ({ choices: [{ message: { content: "百姓都十分高兴。" } }] }),
  },
  DATA: new FakeKV(),
  ASSETS: { fetch: async () => new Response("asset") },
});

async function login(env) {
  const response = await worker.fetch(new Request("https://example.com/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: env.APP_PASSWORD }),
  }), env);
  assert.equal(response.status, 303);
  return response.headers.get("Set-Cookie").split(";")[0];
}

test("requires login and protects cloud writes with ETags", async () => {
  const env = environment();
  const unauthorized = await worker.fetch(new Request("https://example.com/api/state"), env);
  assert.equal(unauthorized.status, 401);

  const wrongLogin = await worker.fetch(new Request("https://example.com/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: "wrong" }),
  }), env);
  assert.equal(wrongLogin.status, 401);

  const cookie = await login(env);
  const empty = await worker.fetch(new Request("https://example.com/api/state", {
    headers: { Cookie: cookie },
  }), env);
  assert.deepEqual(await empty.json(), { books: [] });
  assert.equal(empty.headers.get("ETag"), null);

  const firstWrite = await worker.fetch(new Request("https://example.com/api/state", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "If-None-Match": "*",
    },
    body: JSON.stringify({ books: [{ id: "one", title: "三国志" }] }),
  }), env);
  assert.equal(firstWrite.status, 200);
  const etag = firstWrite.headers.get("ETag");
  assert.match(etag, /^"[A-Za-z0-9_-]{43}"$/);

  const staleWrite = await worker.fetch(new Request("https://example.com/api/state", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "If-Match": '"old"',
    },
    body: JSON.stringify({ books: [] }),
  }), env);
  assert.equal(staleWrite.status, 409);
  assert.equal(staleWrite.headers.get("ETag"), etag);
  assert.equal((await staleWrite.json()).currentState.books[0].title, "三国志");

  const freshWrite = await worker.fetch(new Request("https://example.com/api/state", {
    method: "PUT",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
      "If-Match": etag,
    },
    body: JSON.stringify({ books: [{ id: "two", title: "红楼梦" }] }),
  }), env);
  assert.equal(freshWrite.status, 200);
  assert.notEqual(freshWrite.headers.get("ETag"), etag);
});

test("returns configured WeRead accounts without exposing API keys", async () => {
  const env = environment();
  const cookie = await login(env);
  const response = await worker.fetch(new Request("https://example.com/api/config", {
    headers: { Cookie: cookie },
  }), env);
  const config = await response.json();
  assert.equal(config.storage, "cloud");
  assert.equal(config.wereadConfigured, true);
  assert.equal(config.wereadAccounts.length, 1);
  assert.equal(JSON.stringify(config).includes("wrk-"), false);
});

test("translates text only for authenticated users", async () => {
  const env = environment();
  const unauthorized = await worker.fetch(new Request("https://example.com/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "民皆悦之" }),
  }), env);
  assert.equal(unauthorized.status, 401);

  const cookie = await login(env);
  const response = await worker.fetch(new Request("https://example.com/api/translate", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "民皆悦之" }),
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).translation, "百姓都十分高兴。");
});

test("stores images separately and serves them only to owners or guests", async () => {
  const env = environment();
  const cookie = await login(env);
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const upload = await worker.fetch(new Request("https://example.com/api/images", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "image/png", "X-Image-Name": encodeURIComponent("截图.png") },
    body: bytes,
  }), env);
  assert.equal(upload.status, 201);
  const record = (await upload.json()).image;
  assert.match(record.imageId, /^[a-f0-9]{64}$/);
  assert.equal(record.name, "截图.png");

  const unauthorized = await worker.fetch(new Request(`https://example.com/api/images/${record.imageId}`), env);
  assert.equal(unauthorized.status, 401);
  const ownerImage = await worker.fetch(new Request(`https://example.com/api/images/${record.imageId}`, {
    headers: { Cookie: cookie },
  }), env);
  assert.equal(ownerImage.status, 200);
  assert.equal(ownerImage.headers.get("Content-Type"), "image/png");
  assert.match(ownerImage.headers.get("Cache-Control"), /immutable/);
  assert.deepEqual(new Uint8Array(await ownerImage.arrayBuffer()), bytes);

  const guestImage = await worker.fetch(new Request(`https://example.com/api/images/${record.imageId}?guest=private-guest-link-token`), env);
  assert.equal(guestImage.status, 200);
  const duplicate = await worker.fetch(new Request("https://example.com/api/images", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "image/png" },
    body: bytes,
  }), env);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).image.imageId, record.imageId);
});

test("guest link is read-only except for one-character visitor comments", async () => {
  const env = environment();
  const cookie = await login(env);
  const write = await worker.fetch(new Request("https://example.com/api/state", {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json", "If-None-Match": "*" },
    body: JSON.stringify({ books: [{ id: "book", title: "三国志", notes: [{ id: "note" }] }] }),
  }), env);
  assert.equal(write.status, 200);

  const invalid = await worker.fetch(new Request("https://example.com/api/guest-state?guest=wrong"), env);
  assert.equal(invalid.status, 401);
  const state = await worker.fetch(new Request("https://example.com/api/guest-state?guest=private-guest-link-token"), env);
  assert.equal(state.status, 200);
  assert.equal((await state.json()).books[0].title, "三国志");

  const deniedWrite = await worker.fetch(new Request("https://example.com/api/state?guest=private-guest-link-token", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ books: [] }),
  }), env);
  assert.equal(deniedWrite.status, 403);

  const comment = await worker.fetch(new Request("https://example.com/api/guest-comments?guest=private-guest-link-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteId: "note", nickname: "山", text: "这一段很有意思。" }),
  }), env);
  assert.equal(comment.status, 201);
  assert.equal((await comment.json()).comment.nickname, "山");

  const ownerView = await worker.fetch(new Request("https://example.com/api/guest-comments", { headers: { Cookie: cookie } }), env);
  assert.equal((await ownerView.json()).comments[0].text, "这一段很有意思。");
});
