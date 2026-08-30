# 📧 邮件系统

基于 Cloudflare Workers + KV + Resend 搭建的轻量级邮件收发系统，支持多用户、管理员控制面板。

## ✨ 功能特性

- 📥 **收件存储** - 收到的邮件自动存入 KV，随时查看
- 👥 **多用户支持** - 支持注册/登录，每个用户独立收件箱
- 🔐 **权限控制** - 管理员可看全部邮件，普通用户只能看自己的
- 🤖 **自动回复** - 收到邮件后自动回复（需配置 Resend）
- 🖥️ **网页管理** - 简洁的收件箱界面，写邮件、回复、删除一键操作
- 📤 **发送邮件** - 通过 Resend API 发送，支持 HTML 格式
- 🔔 **实时刷新** - 收件箱每 30 秒自动刷新
- ⚙️ **管理员面板** - 修改标题、发件邮箱、注册码、密码
- 🔐 **安全校验** - 密码和注册码均使用 SHA256 哈希存储
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

需要创建两个 KV 命名空间：

```bash
# 邮件存储
npx wrangler kv:namespace create EMAIL

# 用户存储
npx wrangler kv:namespace create EMAIL_USER
```

将输出的两个 `id` 分别填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "EMAIL"
id = "你复制的EMAIL_ID"

[[kv_namespaces]]
binding = "EMAIL_USER"
id = "你复制的EMAIL_USER_ID"
```

### 第三步：设置 Resend API Key（可选，发信需要）

```bash
npx wrangler secret put RESEND_API_KEY
```

> 🔐 如果不配置，系统仍然可以**接收和存储邮件**，但**无法发送邮件**（包括自动回复和手动发信）。发送按钮会被**自动隐藏**并显示提示。

### 第四步：修改域名配置

打开 `wrangler.toml`，将 `DOMAIN` 和 `ADMIN_ACCOUNT` 改为你的配置：

```toml
[vars]
DOMAIN = "example.com"
ADMIN_ACCOUNT = "admin"   # 管理员账号名
```

### 第五步：部署

双击**部署.bat**

如果遇到报错，使用：

```bash
npx wrangler deploy --no-bundle
```

### ⚠️ 部署时出现警告？

如果你之前在 Cloudflare 网页控制台绑定了自定义域名（如 `mail.你的域名`），部署时可能会看到类似这样的警告：

```
▲ [WARNING] The local configuration being used differs from the remote configuration...
```

这是**正常现象**，输入 `Y` 按回车继续即可。

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

## 👥 用户指南

### 首次注册（自动成为管理员）

1. 访问你的邮件系统地址
2. 点击 **去注册**
3. 填写邮箱、密码、注册码（首次注册无需注册码，或使用默认注册码）
4. **第一个注册的用户自动成为管理员**

### 后续用户注册

1. 管理员登录后，在左侧 **系统设置** 中点击 **生成新码**
2. 将生成的注册码告诉新用户
3. 新用户访问网站，点击注册，填写信息并输入注册码

### 登录

- 输入邮箱和密码即可登录
- 管理员登录后会看到 **系统设置** 面板
- 普通用户只能看到自己的邮件

### 管理员功能

| 功能 | 说明 |
|------|------|
| 查看全部邮件 | 管理员收件箱显示所有用户的邮件 |
| 修改页面标题 | 自定义网站标题 |
| 修改发件邮箱 | 设置发送邮件时使用的发件人地址 |
| 生成注册码 | 为新用户生成注册码 |
| 修改管理员密码 | 更新管理员登录密码 |

---

## 📖 API 接口

| 接口 | 方法 | 用途 |
|------|------|------|
| `/` | GET | 管理界面 |
| `/register` | POST | 用户注册 |
| `/login` | POST | 用户登录 |
| `/logout` | POST | 退出登录 |
| `/user/info` | GET | 获取当前用户信息 |
| `/mails` | GET | 邮件列表（根据角色过滤） |
| `/mail/:id` | GET | 邮件详情（权限控制） |
| `/mail/:id` | DELETE | 删除邮件（权限控制） |
| `/send` | POST | 发送邮件 |
| `/admin/account` | GET | 获取管理员账号名 |
| `/admin/settings` | GET/POST | 管理员设置 |
| `/admin/regcode` | POST | 生成注册码 |
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

## 📁 项目结构

```
.
├── src/
│   ├── index.ts           # Worker 主入口
│   ├── auth.ts            # 用户/会话管理
│   ├── admin.ts           # 管理员设置
│   ├── utils.ts           # SHA256 工具
│   ├── email-parser.ts    # 邮件解析
│   ├── resend-client.ts   # Resend 发送封装
│   └── types.ts           # 类型定义
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 依赖管理
├── tsconfig.json          # TypeScript 配置
├── README.md              # 项目说明
└── 部署.bat               # Windows 一键部署脚本
```

---

## ❓ 常见问题

### Q: `workers.dev` 地址打不开？

`workers.dev` 在中国大陆可能无法直接访问，绑定自定义域名即可解决。

### Q: 部署报错 `Unexpected external import`？

使用 `wrangler deploy --no-bundle` 部署。

### Q: 部署时出现警告，选 Y 还是 N？

选 **Y**（继续）。

### Q: 第一个注册的用户是谁？

第一个注册的用户自动成为管理员。所以**务必第一时间注册**。

### Q: 注册码是什么？从哪里获取？

- 首次部署后，第一个用户注册**不需要注册码**（自动成为管理员）
- 管理员登录后，在左侧 **系统设置** 中点击 **生成新码** 获取
- 普通用户注册时需要输入管理员生成的注册码

### Q: 收不到邮件？

检查：
1. Email Routing 是否启用
2. Catch-all 是否指向 Worker
3. Resend 域名验证是否完成（仅发信需要）
4. DNS 记录是否已生效（等待几分钟）

### Q: 邮件发送失败或发送按钮被隐藏了？

1. 确认已配置 Resend API Key：`npx wrangler secret put RESEND_API_KEY`
2. 确认域名在 Resend 已验证
3. 管理员在 **系统设置** 中确认发件邮箱格式正确

### Q: 管理员密码忘了怎么办？

在 Cloudflare 控制台 → Workers → 你的 Worker → KV → `EMAIL_USER`，找到 `admin:password_hash`，删除它。然后重新注册第一个用户（会自动成为管理员）。

或者在代码中临时加一个重置路由（不推荐生产环境使用）。

### Q: 普通用户能看到别人的邮件吗？

**不能。** 普通用户只能看到自己邮箱收到的邮件（发件人或收件人是自己的邮箱）。管理员可以看到全部邮件。

---

## 📝 License

MIT
