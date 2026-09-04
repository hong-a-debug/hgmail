# 📧 邮件系统

基于 Cloudflare Workers + KV + R2 + Resend 搭建的轻量级邮件收发系统，支持多用户、管理员控制面板、垃圾邮件过滤、附件存储与发送。

## ✨ 功能特性

- 📥 **收件存储** - 收到的邮件自动存入 KV，随时查看
- 📎 **附件存储** - 邮件附件自动保存到 R2，支持下载
- 📤 **发送附件** - 写邮件时支持上传附件，通过 Resend 发送
- 👥 **多用户支持** - 支持注册/登录，每个用户独立收件箱
- 🔐 **权限控制** - 管理员可看全部邮件，普通用户只能看自己的
- 🚫 **垃圾邮件过滤** - 自动拦截含中英文垃圾关键词的邮件
- 🛡️ **Script 标签清理** - 自动删除邮件中的 `<script>` 标签及其内容
- 🤖 **自动回复** - 收到邮件后自动回复（可在管理员面板开关）
- 🖥️ **网页管理** - 简洁的收件箱界面，写邮件、回复、删除一键操作
- 🔔 **实时刷新** - 收件箱每 30 秒自动刷新
- ⚙️ **管理员面板** - 修改标题、发件邮箱、注册码、密码、自动回复开关
- 🔐 **安全校验** - 密码和注册码均使用 SHA256 哈希存储
- 🔌 **开放 API** - 提供 RESTful API，方便程序化调用
- 📋 **邮件 ID 显示** - 查看邮件详情时底部显示邮件 ID，方便复制下载

## 📎 附件支持

| 功能 | 说明 |
|------|------|
| **发送附件** | 写邮件时点击"添加附件"选择文件，支持所有文件格式 |
| **接收附件** | 邮件中的附件自动保存到 R2，详情页显示下载链接 |
| **附件大小** | 单封邮件总大小不超过 10MB（Resend 限制） |
| **下载方式** | 邮件详情页点击下载，或直接访问 `/download/{邮件ID}` |

## 🛡️ 安全机制

### 垃圾邮件过滤

系统会自动检测邮件内容，拦截包含以下关键词的邮件：

| 类型 | 关键词示例 |
|------|-----------|
| 中文垃圾词 | 优惠、营销、折扣、促销、特价、秒杀、红包、返现 |
| 英文垃圾词 | discount, promotion, sale, deal, coupon, marketing, spam |

> ✅ **白名单保护**：包含 `验证码`、`激活`、`注册`、`verify`、`register` 等关键词的邮件**不会被拦截**，确保注册验证码正常接收。

### Script 标签清理

邮件中的 `<script>` 标签及其所有内容会被自动删除，防止恶意脚本执行。

### 附件存储

- 邮件附件自动保存到 Cloudflare R2 存储
- 附件在邮件详情页显示下载链接
- 支持 `/download/{邮件ID}` 直接下载第一个附件
- 删除邮件时自动删除对应附件
- 普通用户只能下载自己邮件的附件

## 🎯 部署前准备

| 材料 | 说明 | 是否必需 |
|------|------|---------|
| Cloudflare 账号 | 免费注册 | ✅ |
| 一个域名 | 托管在 Cloudflare 上 | ✅ |
| Resend 账号 | 用于发送邮件 | ⚠️ 发信需要 |
| Node.js 环境 | 本地部署需要，版本 >= 18 | ⚠️ 本地部署需要 |

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

### 第三步：创建 R2 存储桶（用于附件）

```bash
npx wrangler r2 bucket create attachments
```

将 R2 配置填入 `wrangler.toml`：

```toml
[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "attachments"
```

### 第四步：设置 Resend API Key（可选，发信需要）

```bash
npx wrangler secret put RESEND_API_KEY
```

> 🔐 如果不配置，系统仍然可以**接收和存储邮件**，但**无法发送邮件**（包括自动回复和手动发信）。发送按钮会被**自动隐藏**并显示提示。

### 第五步：修改域名配置

打开 `wrangler.toml`，将 `DOMAIN` 和 `ADMIN_ACCOUNT` 改为你的配置：

```toml
[vars]
DOMAIN = "example.com"
ADMIN_ACCOUNT = "admin"
```

> ⚠️ **重要**：`ADMIN_ACCOUNT` 是**预先指定的管理员账号名**。第一个用户**必须用这个名字注册**才能成为管理员。

### 第六步：部署

**最简单的方式**：双击项目文件夹中的 **`部署.bat`** 文件，等待部署完成。

如果双击后报错，可以手动在终端运行：

```bash
npx wrangler deploy
```

如果遇到报错，使用：

```bash
npx wrangler deploy --no-bundle
```

### ⚠️ 部署时出现警告？

如果你之前在 Cloudflare 网页控制台绑定了自定义域名，部署时可能会看到配置不一致的警告，输入 `Y` 按回车继续即可。

### 第七步：配置邮件路由

1. Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
2. 启用 Email Routing
3. **Catch-all** 规则选择 **Send to a Worker**
4. 选择你部署的 Worker

### 第八步：配置 Resend 域名验证（如需发信）

1. [Resend 控制台](https://resend.com) 添加你的域名
2. 按提示配置 DNS 记录（MX、SPF、DKIM、DMARC）

## 🌐 访问地址

| 地址 | 说明 |
|------|------|
| `https://my-email-worker.你的域名.workers.dev` | 默认地址 |
| `https://mail.你的域名` | 绑定自定义域名后使用 |

### 绑定自定义域名

1. Cloudflare 控制台 → **Workers 和 Pages** → 你的 Worker
2. **设置** → **触发器** → **自定义域**
3. 添加 `mail.你的域名`

## 👥 用户指南

### 首次注册（成为管理员）

1. 访问你的邮件系统地址
2. 点击 **去注册**
3. 填写：
   - **邮箱：必须填 `ADMIN_ACCOUNT` 变量里设置的名字**（默认是 `admin`）
   - **密码：你自己设的**
   - **注册码：留空**（第一个用户不需要）
4. 点击注册，**第一个注册的用户自动成为管理员**

### 后续用户注册

1. 管理员登录后，在左侧 **系统设置** 中点击 **生成新码**
2. 将生成的注册码告诉新用户
3. 新用户注册时输入注册码即可

### 管理员功能

| 功能 | 说明 |
|------|------|
| 查看全部邮件 | 管理员收件箱显示所有用户的邮件 |
| 修改页面标题 | 自定义网站标题 |
| 修改发件邮箱前缀 | 自定义发件人地址（如 `noreply@xxx.com`） |
| 生成注册码 | 为新用户生成注册码 |
| 修改管理员密码 | 更新管理员登录密码 |
| **自动回复开关** | 开启/关闭收到邮件后的自动回复 |

### 发送附件

1. 点击 **写新邮件**
2. 填写收件人、主题、内容
3. 在附件区域点击 **添加附件**，选择文件
4. 点击 **发送**

> 💡 支持所有文件格式，单封邮件总大小不超过 10MB。

## 📖 API 接口

| 接口 | 方法 | 用途 |
|------|------|------|
| `/` | GET | 管理界面 |
| `/register` | POST | 用户注册 |
| `/login` | POST | 用户登录 |
| `/logout` | POST | 退出登录 |
| `/user/info` | GET | 获取当前用户信息 |
| `/admin/check` | GET | 检查是否有管理员 |
| `/mails` | GET | 邮件列表（根据角色过滤） |
| `/mail/:id` | GET | 邮件详情（含附件信息） |
| `/mail/:id` | DELETE | 删除邮件（同时删除附件） |
| `/send` | POST | 发送邮件（支持附件） |
| `/download/:id` | GET | 下载邮件的第一个附件 |
| `/attachments/:key` | GET | 下载指定附件（需登录） |
| `/admin/account` | GET | 获取管理员账号名 |
| `/admin/domain` | GET | 获取域名 |
| `/admin/settings` | GET/POST | 管理员设置（含自动回复） |
| `/admin/regcode` | POST | 生成注册码 |
| `/check-resend` | GET | 检查 Resend 是否配置 |

## 📁 项目结构

```
.
├── src/
│   ├── index.ts           # Worker 主入口
│   ├── template.html      # 前端 HTML 模板
│   ├── auth.ts            # 用户/会话管理
│   ├── admin.ts           # 管理员设置
│   ├── attachment.ts      # 附件处理（R2 存储）
│   ├── utils.ts           # SHA256 工具
│   ├── email-parser.ts    # 邮件解析 + 垃圾过滤 + Script 清理
│   ├── resend-client.ts   # Resend 发送封装
│   ├── types.ts           # 类型定义
│   └── types.d.ts         # 类型声明（HTML 模块）
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 依赖管理
├── tsconfig.json          # TypeScript 配置
├── README.md              # 项目说明
└── 部署.bat               # Windows 一键部署脚本（双击运行）
```

## ❓ 常见问题

### Q: 附件发送失败？

1. 检查单封邮件总大小是否超过 10MB
2. 确认 Resend API Key 已配置
3. 确认文件读取成功（浏览器控制台查看）

### Q: 附件下载失败？

1. 确认已登录
2. 确认邮件包含附件
3. 检查 R2 存储是否正常

### Q: 注册验证码邮件被拦截了怎么办？

系统已内置白名单，包含 `验证码`、`激活`、`注册`、`verify`、`register` 等关键词的邮件不会被拦截。如果仍有误拦，可以手动在 `src/email-parser.ts` 的 `SAFE_KEYWORDS` 数组中添加关键词，重新部署即可。

### Q: 如何添加更多垃圾关键词？

在 `src/email-parser.ts` 的 `SPAM_KEYWORDS` 数组中添加关键词（中英文均可），重新部署即可。

### Q: 邮件中的 `<script>` 标签会被执行吗？

**不会。** 系统会自动检测并删除所有 `<script>` 标签及其内容，确保邮件安全。

### Q: 附件存在哪里？

附件存储在 Cloudflare R2 存储中。R2 不收取出口流量费用，适合存储邮件附件。免费额度为 10GB 存储/月。

### Q: 如何下载附件？

两种方式：
1. 在邮件详情页点击附件旁的 **下载** 按钮
2. 直接访问 `/download/{邮件ID}` 下载第一个附件

### Q: 如何关闭自动回复？

管理员登录后，在左侧 **系统设置** → **自动回复** 中，选择 **关闭** 并保存即可。

### Q: `workers.dev` 地址打不开？

`workers.dev` 在中国大陆可能无法直接访问，绑定自定义域名即可解决。

### Q: 普通用户能看到别人的邮件吗？

**不能。** 普通用户只能看到自己邮箱收到的邮件。管理员可以看到全部邮件。

### Q: 收不到邮件？

检查：
1. Email Routing 是否启用
2. Catch-all 是否指向 Worker
3. Resend 域名验证是否完成（仅发信需要）
4. DNS 记录是否已生效（等待几分钟）

### Q: 部署时提示 KV namespace 无效？

检查 `wrangler.toml` 中 KV 的 `id` 是否正确，可以用 `npx wrangler kv:namespace list` 查看正确的 ID。

### Q: 部署时提示 `template.html` 找不到？

确保 `src/template.html` 文件存在，且 `tsconfig.json` 和 `wrangler.toml` 已按文档配置。

## 📝 License

MIT
