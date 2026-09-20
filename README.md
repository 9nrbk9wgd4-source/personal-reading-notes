# 个人阅读笔记

把自己的微信读书书架、划线和书评同步到一个私人网站，并继续添加文字、图片、白话翻译、关联作品和访客评论。

## 一键部署

> 仓库公开后，把下面链接里的 `YOUR_PUBLIC_REPOSITORY_URL` 替换为实际 GitHub 仓库地址。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=YOUR_PUBLIC_REPOSITORY_URL)

点击按钮后：

1. 登录自己的 GitHub 和 Cloudflare 账户。
2. 接受 Cloudflare 建议的项目名称，或改成自己喜欢的英文名称。
3. 填写部署页面要求的四项私密信息：网站密码、登录安全随机串、微信读书 API Key、访客口令。
4. 等待部署完成，打开 Cloudflare 给出的 `workers.dev` 网址。
5. 登录后点击“同步微信读书”。第一次打开时书架为空是正常的。

每次部署都会在使用者自己的 Cloudflare 账户中创建独立的 Worker、KV 数据库和 AI 绑定，不会共享模板作者或其他使用者的数据。

## 访客链接

假设部署后的网站地址是：

```text
https://你的项目名.你的子域名.workers.dev
```

访客口令是 `example-token`，分享链接就是：

```text
https://你的项目名.你的子域名.workers.dev/?guest=example-token
```

访客可以查看书架并发表文字评论，不能修改书架、同步微信读书或查看 API Key。

## 增加第二、第三个微信读书账号

部署完成后，进入 Cloudflare 控制台的 Worker 设置，在“变量和机密”中新增 Secret：

```text
WEREAD_API_KEY_2
WEREAD_API_KEY_3
```

只添加实际使用的账号。保存后重新打开网站，再点击同步。

## 本地检查（可选）

```bash
npm install
npm test
```

## 数据和密钥

- 书架、评论和图片保存在部署者自己的 Cloudflare KV 中。
- 微信读书 API Key、网站密码和访客口令通过 Cloudflare Worker Secrets 保存。
- 仓库不包含任何书籍数据、图片、API Key、密码或 Cloudflare 账户编号。
