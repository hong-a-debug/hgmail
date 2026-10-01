# 📧 邮件系统

基于 Cloudflare Workers + KV + R2 + Resend 搭建的轻量级邮件收发系统，支持多用户、管理员控制面板、垃圾邮件过滤、附件存储与发送、PWA 安装、mailto 链接处理。

## ✨ 功能特性

- 📥 **收件存储** - 收到的邮件自动存入 KV，随时查看
- 📎 **附件存储** - 邮件附件自动保存到 R2，支持下载
- 📤 **发送附件** - 写邮件时支持上传附件，通过 Resend 发送
- 👥 **多用户支持** - 支持注册/登录，每个用户独立收件箱
- 🔐 **权限控制** - 管理员可看全部邮件，普通用户只能看自己的
- 🚫 **垃圾邮件过滤** - 加权评分 + 变体识别，自动拦截垃圾邮件
- 🛡️ **Script 标签清理** - 自动删除邮件中的 `<script>` 标签及其内容
- 🤖 **自动回复** - 收到邮件后自动回复（可在管理员面板开关）
- 🖥️ **网页管理** - 简洁的收件箱界面，写邮件、回复、删除一键操作
- 🔔 **实时刷新** - 收件箱每 30 秒自动刷新
- ⚙️ **管理员面板** - 修改标题、发件邮箱、注册码、密码、自动回复开关
- 🔐 **安全校验** - 密码和注册码均使用 SHA256 哈希存储
- 📱 **PWA 支持** - 可以安装为桌面应用，像原生软件一样使用
- 📧 **mailto 支持** - 点击网页上的 mailto: 链接自动打开写邮件界面

## 🚀 快速开始

### 一键部署

1. 双击项目文件夹里的 `部署.bat`
2. 等待完成
3. 访问 `https://mail.你的域名`

### 手动部署

```bash
npm install
npx wrangler deploy
```

## 📎 附件支持

| 功能 | 说明 |
|------|------|
| **发送附件** | 写邮件时点击"添加附件"选择文件，支持所有文件格式 |
| **接收附件** | 邮件中的附件自动保存到 R2，详情页显示下载链接 |
| **附件大小** | 单封邮件总大小不超过 10MB（Resend 限制） |
| **下载方式** | 邮件详情页点击下载，或直接访问 `/download/{邮件ID}` |

## 📱 PWA 安装

### 什么是 PWA

PWA（渐进式 Web 应用）让你可以把网页"安装"到电脑桌面，像原生软件一样使用：

- 双击图标打开，独立窗口，没有浏览器地址栏
- 可以接收 `mailto:` 链接
- 自动更新，无需手动升级

### 如何安装

1. 用 **Edge** 或 **Chrome** 打开 `https://mail.你的域名`
2. 地址栏右侧会出现「安装」图标，点击它
3. 确认安装
4. 桌面会出现邮件图标

### 设置 mailto 处理

安装后，浏览器会弹窗问：「是否允许此应用处理 mailto: 链接？」

点 **允许**，之后：

- 在任意网页点击 `mailto:test@example.com`
- 会自动打开你的邮件应用
- 收件人自动填入 `test@example.com`

### mailto 支持的格式

```
mailto:test@example.com
mailto:test@example.com?subject=你好
mailto:test@example.com?subject=你好&body=这是一封测试邮件
```

## 🚫 不想用 R2 怎么办？

R2 是 Cloudflare 的对象存储服务，用于保存邮件附件。如果你不想用 R2，或者账户没有开通 R2，可以按下面的方式处理。

### 影响对比

| 功能 | 有 R2 | 没有 R2 |
|------|-------|---------|
| 接收邮件 | ✅ 正常 | ✅ 正常 |
| 发送邮件 | ✅ 正常 | ✅ 正常 |
| 网页管理 | ✅ 正常 | ✅ 正常 |
| 接收附件 | ✅ 保存到 R2 | ❌ 附件无法保存 |
| 发送附件 | ✅ 通过 Resend 发送 | ✅ 通过 Resend 发送 |
| 下载附件 | ✅ 从 R2 读取 | ❌ 无法下载 |

### 方案一：临时禁用附件功能

**第一步：修改 `src/index.ts`**

找到 `email` 函数中的这一行：

```typescript
const attachments = await saveAttachments(env, parsed.attachments, messageId);
```

改成：

```typescript
const attachments = [];  // 不保存附件
```

**第二步：修改 `wrangler.toml`**

删掉 R2 配置：

```toml
# 删掉这段
# [[r2_buckets]]
# binding = "ATTACHMENTS"
# bucket_name = "attachments"
```

**第三步：重新部署**

```bash
npx wrangler deploy
```

### 方案二：开通 R2（推荐）

R2 是 Cloudflare 的免费服务，开通不需要花钱：

```bash
npx wrangler r2 bucket create attachments
```

免费额度：**10GB 存储/月，读取不收费**。

## 🛡️ 安全机制

### 垃圾邮件过滤

系统使用**加权评分 + 变体识别**过滤垃圾邮件：

| 特性 | 说明 |
|------|------|
| **词边界匹配** | `free` 不会匹配 `freeware` |
| **加权评分** | 不同关键词权重不同（如 `日入` 权重 5，`优惠` 权重 1） |
| **变体识别** | 能识别 `f.r.e.e`、`fr33`、`ｆｒｅｅ` 等变体 |
| **长度归一化** | 长邮件按比例折算，避免误杀 |
| **中英文区分** | 中文字符权重按 2.5 倍计算 |
| **零宽字符处理** | 移除 `\u200B` 等隐藏字符 |
| **白名单优先** | 验证码、注册等邮件不会被拦截 |

**中文垃圾词示例**：优惠、营销、折扣、促销、特价、秒杀、红包、返现、日入、月入

**英文垃圾词示例**：discount, promotion, sale, deal, coupon, marketing, spam, crypto

> ✅ **白名单保护**：包含 `验证码`、`激活`、`注册`、`verify`、`register` 等关键词的邮件**不会被拦截**。

### Script 标签清理

邮件中的 `<script>` 标签及其所有内容会被自动删除，防止恶意脚本执行。

## 👥 角色权限

| 角色 | 页面标题 | 邮件列表 | 邮件详情 | 写邮件 | 系统设置 |
|------|---------|---------|---------|--------|---------|
| **访客**（未登录） | ✅ 能看到 | ❌ 隐藏 | ❌ 打不开 | ❌ 隐藏 | ❌ 隐藏 |
| **普通用户** | ✅ 能看到 | ✅ 自己的 | ✅ 自己的 | ✅ 能写 | ❌ 隐藏 |
| **管理员** | ✅ 能看到 | ✅ 全部 | ✅ 全部 | ✅ 能写 | ✅ 显示 |

## 🎯 部署前准备

> 📖 **详细的准备说明，请看 [部署前准备文档](./README_.md)** —— 手把手教你注册账号、购买域名、配置 Resend 和 R2。

| 材料 | 说明 | 是否必需 |
|------|------|---------|
| Cloudflare 账号 | 免费注册 | ✅ |
| 一个域名 | 托管在 Cloudflare 上 | ✅ |
| Resend 账号 | 用于发送邮件 | ⚠️ 发信需要 |
| R2 存储桶 | 用于保存附件 | ⚠️ 收附件需要 |
| Node.js 环境 | 本地部署需要，版本 >= 18 | ⚠️ 本地部署需要 |

**[👉 点击查看完整的部署前准备文档](https://github.com/hong-a-debug/hgmail/blob/main/README_.md)**

## 🚀 部署教程

### 第一步：安装依赖

```bash
npm install
```

### 第二步：创建 KV 命名空间

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

### 第三步：创建 R2 存储桶（可选）

```bash
npx wrangler r2 bucket create attachments
```

将 R2 配置填入 `wrangler.toml`：

```toml
[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "attachments"
```

### 第四步：设置 Resend API Key（可选）

```bash
npx wrangler secret put RESEND_API_KEY
```

> 🔐 如果不配置，系统仍然可以**接收和存储邮件**，但**无法发送邮件**。

### 第五步：修改域名配置

打开 `wrangler.toml`，将 `DOMAIN` 和 `ADMIN_ACCOUNT` 改为你的配置：

```toml
[vars]
DOMAIN = "example.com"
ADMIN_ACCOUNT = "admin"
```

### 第六步：部署

双击 `部署.bat`，或手动运行：

```bash
npx wrangler deploy
```

### 第七步：配置邮件路由

1. Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
2. 启用 Email Routing
3. **Catch-all** 规则选择 **Send to a Worker**
4. 选择你部署的 Worker

### 第八步：配置 Resend 域名验证（如需发信）

1. [Resend 控制台](https://resend.com) 添加你的域名
2. 按提示配置 DNS 记录（MX、SPF、DKIM、DMARC）

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
| 修改发件邮箱前缀 | 自定义发件人地址 |
| 生成注册码 | 为新用户生成注册码 |
| 修改管理员密码 | 更新管理员登录密码 |
| **自动回复开关** | 开启/关闭收到邮件后的自动回复 |

## 📖 API 接口

| 接口 | 方法 | 用途 | 权限 |
|------|------|------|------|
| `/` | GET | 管理界面 | 任何人 |
| `/manifest.json` | GET | PWA 清单 | 任何人 |
| `/new-email` | GET | mailto 链接跳转 | 任何人 |
| `/register` | POST | 用户注册 | 任何人 |
| `/login` | POST | 用户登录 | 任何人 |
| `/logout` | POST | 退出登录 | 已登录 |
| `/no-login/info` | GET | 未登录用户获取标题和域名 | 任何人 |
| `/user/info` | GET | 已登录用户获取信息 | 已登录 |
| `/admin/info` | GET | 管理员获取完整设置 | 管理员 |
| `/mails` | GET | 邮件列表 | 已登录 |
| `/mail/:id` | GET | 邮件详情 | 已登录 |
| `/mail/:id` | DELETE | 删除邮件 | 已登录 |
| `/send` | POST | 发送邮件 | 已登录 |
| `/download/:id` | GET | 下载第一个附件 | 已登录 |
| `/attachments/:key` | GET | 下载指定附件 | 已登录 |
| `/admin/settings` | GET/POST | 管理员设置 | 管理员 |
| `/admin/regcode` | POST | 生成注册码 | 管理员 |

## 📁 项目结构

```
.
├── src/
│   ├── index.ts           # Worker 主入口（路由 + 入口）
│   ├── template.html      # 前端 HTML 模板
│   ├── auth.ts            # 用户/会话管理
│   ├── admin.ts           # 管理员设置
│   ├── attachment.ts      # 附件处理（R2 存储）
│   ├── email-parser.ts    # 邮件解析 + 垃圾过滤 + Script 清理
│   ├── resend-client.ts   # Resend 发送封装
│   ├── utils.ts           # SHA256 工具
│   ├── types.ts           # 类型定义
│   └── types.d.ts         # 类型声明
├── wrangler.toml          # Cloudflare 配置
├── package.json           # 依赖管理
├── tsconfig.json          # TypeScript 配置
├── README.md              # 项目说明
├── README_.md             # 部署前准备文档
└── 部署.bat               # Windows 一键部署脚本
```

## ❓ 常见问题

### Q: PWA 安装后 mailto 不生效？

1. 确认用 Edge 或 Chrome 打开
2. 确认已安装为 PWA
3. 首次安装后，浏览器会弹窗问是否允许处理 mailto，点允许
4. 如果误点了"不允许"，可以在浏览器设置里重新开启

### Q: 不想用 R2，怎么部署？

删掉 `wrangler.toml` 中的 R2 配置，并把 `src/index.ts` 中 `saveAttachments` 调用改成 `const attachments = []`。

### Q: 附件发送失败？

1. 检查单封邮件总大小是否超过 10MB
2. 确认 Resend API Key 已配置
3. 确认文件读取成功

### Q: 注册验证码邮件被拦截了怎么办？

系统已内置白名单，如果仍有误拦，可以手动在 `src/email-parser.ts` 的 `SAFE_KEYWORDS` 数组中添加关键词。

### Q: 邮件中的 `<script>` 标签会被执行吗？

**不会。** 系统会自动检测并删除所有 `<script>` 标签及其内容。

### Q: 如何关闭自动回复？

管理员登录后，在左侧 **系统设置** → **自动回复** 中，选择 **关闭** 并保存。

### Q: `workers.dev` 地址打不开？

绑定自定义域名即可解决。

### Q: 普通用户能看到别人的邮件吗？

**不能。** 普通用户只能看到自己邮箱收到的邮件。管理员可以看到全部邮件。

### Q: 收不到邮件？

检查：
1. Email Routing 是否启用
2. Catch-all 是否指向 Worker
3. DNS 记录是否已生效

## 📝 License

MIT
