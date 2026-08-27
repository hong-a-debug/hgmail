<div align="center">

# 📧 邮件系统


<p>基于 Cloudflare Workers + KV + Resend 搭建的轻量级邮件收发系统</p>

</div>

---

> 👋 大家好，这个项目是一个基于 Cloudflare 全家桶的轻量级邮件系统，主打简单实用。跟着教程走，小白也能搭出自己的邮件服务。
>
> 支持收件存储、自动回复、网页管理、API 发送，适合个人或小团队使用。

---

## ✨ 功能特性

- 📥 **收件存储** - 收到的邮件自动存入 KV，随时查看
- 🤖 **自动回复** - 收到邮件后自动回复，省心省力
- 🖥️ **网页管理** - 简洁的收件箱界面，写邮件、回复、删除一键操作
- 📤 **发送邮件** - 通过 Resend API 发送，支持 HTML 格式
- 🔔 **实时刷新** - 收件箱每 30 秒自动刷新
- 🔌 **开放 API** - 提供 RESTful API，方便程序化调用

---

## 🎯 部署前准备

| 材料 | 说明 | 是否必需 |
|------|------|---------|
| Cloudflare 账号 | 免费注册 | ✅ |
| 一个域名 | 托管在 Cloudflare 上 | ✅ |
| Resend 账号 | 用于发送邮件 | ✅ |
| Node.js 环境 | 本地部署需要，版本 >= 18 | ⚠️ |

---

## 🚀 部署教程

### 第一步：安装依赖

```bash
npm install
```

### 第二步：创建 KV 命名空间

```bash
npx wrangler kv:namespace create EMAIL
```

将输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "EMAIL"
id = "你复制的ID"
```

### 第三步：设置 Resend API Key

```bash
npx wrangler secret put RESEND_API_KEY
```

> 🔐 API Key 是敏感信息，务必用 Secret 方式配置，不要写在代码里。

### 第四步：修改域名配置

打开 `wrangler.toml`，将 `DOMAIN` 改为你的域名：

```toml
[vars]
DOMAIN = "你的域名"
```

### 第五步：部署

```bash
npx wrangler deploy
```

如果遇到报错，使用：

```bash
npx wrangler deploy --no-bundle
```

### 第六步：配置邮件路由

1. Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
2. 启用 Email Routing
3. **Catch-all** 规则选择 **Send to a Worker**
4. 选择你部署的 Worker

### 第七步：配置 Resend 域名验证

1. [Resend 控制台](https://resend.com) 添加你的域名
2. 按提示配置 DNS 记录（MX、SPF、DKIM、DMARC）

---

## 🌐 访问地址

| 地址 | 说明 |
|------|------|
| `https://my-email-worker.你的域名.workers.dev` | 默认地址 |
| `https://mail.你的域名` | 绑定自定义域名后使用 |

### 绑定自定义域名

1. Cloudflare 控制台 → **Workers 和 Pages** → 你的 Worker
2. **设置** → **触发器** → **自定义域**
3. 添加 `mail.你的域名`

---

## 📖 API 接口

| 接口 | 方法 | 用途 |
|------|------|------|
| `/` | GET | 管理界面 |
| `/mails` | GET | 邮件列表 |
| `/mail/:id` | GET | 邮件详情 |
| `/mail/:id` | DELETE | 删除邮件 |
| `/send` | POST | 发送邮件 |
| `/domain` | GET | 获取域名 |

### 发送邮件示例

```bash
curl -X POST https://你的地址.workers.dev/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "friend@example.com",
    "subject": "Hello",
    "html": "<h1>Hi</h1>"
  }'
```

---

## ❓ 常见问题

### Q: `workers.dev` 地址打不开？

`workers.dev` 在中国大陆可能无法直接访问，绑定自定义域名即可解决。

### Q: 部署报错 `Unexpected external import`？

使用 `wrangler deploy --no-bundle` 部署。

### Q: 收不到邮件？

检查：
1. Email Routing 是否启用
2. Catch-all 是否指向 Worker
3. Resend 域名验证是否完成

### Q: 邮件发送失败？

1. 确认 Resend API Key 是否正确配置
2. 确认域名在 Resend 已验证
3. 确认发件人地址格式为 `noreply@你的域名`

---

## 📚 更多

觉得有用的话，点个 Star 支持一下吧！🌟

---

## 📝 License

MIT
