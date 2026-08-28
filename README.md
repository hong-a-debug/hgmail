# 📧 邮件系统

基于 Cloudflare Workers + KV + Resend 搭建的轻量级邮件收发系统。

## ✨ 功能特性

- 📥 **收件存储** - 收到的邮件自动存入 KV，随时查看
- 🤖 **自动回复** - 收到邮件后自动回复（需配置 Resend）
- 🖥️ **网页管理** - 简洁的收件箱界面，写邮件、回复、删除一键操作
- 📤 **发送邮件** - 通过 Resend API 发送，支持 HTML 格式
- 🔔 **实时刷新** - 收件箱每 30 秒自动刷新
- 🔐 **安全校验** - 未配置 Resend API Key 时自动隐藏发送按钮并提示
- 🔌 **开放 API** - 提供 RESTful API，方便程序化调用

---

## 🎯 部署前准备

| 材料 | 说明 | 是否必需 |
|------|------|---------|
| Cloudflare 账号 | 免费注册 | ✅ |
| 一个域名 | 托管在 Cloudflare 上 | ✅ |
| Resend 账号 | 用于发送邮件 | ⚠️ 发信需要 |
| Node.js 环境 | 本地部署需要，版本 >= 18 | ⚠️ 本地部署需要 |

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

### 第三步：设置 Resend API Key（可选，发信需要）

```bash
npx wrangler secret put RESEND_API_KEY
```

> 🔐 如果不配置，系统仍然可以**接收和存储邮件**，但**无法发送邮件**（包括自动回复和手动发信）。发送按钮会被**自动隐藏**并显示提示。

### 第四步：修改域名配置

打开 `wrangler.toml`，将 `DOMAIN` 改为你的域名：

```toml
[vars]
DOMAIN = "example.com"
```

### 第五步：部署

双击文件夹中的"部署.bat"

如果遇到报错，使用：

```bash
npx wrangler deploy --no-bundle
```

### ⚠️ 部署时出现警告？

如果你之前在 Cloudflare 网页控制台绑定了自定义域名（如 `mail.你的域名`），部署时可能会看到类似这样的警告：

```
▲ [WARNING] The local configuration being used differs from the remote configuration...
```

这是**正常现象**，输入 `Y` 按回车继续即可。这个警告只是告诉你本地配置和远程配置略有不同，不会影响已绑定的自定义域名。

### 第六步：配置邮件路由

1. Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
2. 启用 Email Routing
3. **Catch-all** 规则选择 **Send to a Worker**
4. 选择你部署的 Worker

### 第七步：配置 Resend 域名验证（如需发信）

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
| `/check-resend` | GET | 检查 Resend 是否配置 |

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

### Q: 部署时出现警告，选 Y 还是 N？

选 **Y**（继续）。这个警告只是说本地配置和远程配置略有不同，选 Y 不会影响已绑定的自定义域名。

### Q: 收不到邮件？

检查：
1. Email Routing 是否启用
2. Catch-all 是否指向 Worker
3. Resend 域名验证是否完成（仅发信需要）
4. DNS 记录是否已生效（等待几分钟）

### Q: 邮件发送失败或发送按钮被隐藏了？

1. 确认已配置 Resend API Key：`npx wrangler secret put RESEND_API_KEY`
2. 确认域名在 Resend 已验证
3. 确认发件人地址格式为 `noreply@你的域名`

### Q: 我只想收邮件，不想发邮件，可以吗？

可以。不配置 Resend API Key 即可。系统会正常收件和存储，但发送按钮会被**自动隐藏**，自动回复也会跳过。

### Q: 收到邮件后没有自动回复？

检查是否配置了 Resend API Key。如果未配置，自动回复会跳过，只存储邮件。

---

## 📁 项目结构

```
.
├── src/
│   ├── index.ts           # Worker 主入口
│   ├── email-parser.ts    # 邮件解析
│   ├── resend-client.ts   # Resend 发送封装
│   └── types.ts           # 类型定义
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 依赖管理
├── tsconfig.json          # TypeScript 配置
└── README.md              # 项目说明
```

---

## 📝 License

MIT
