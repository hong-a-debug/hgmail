<div align="center">

# 📧 邮件系统

**基于 Cloudflare 全家桶搭建的全功能邮件系统**

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hong-a-debug/hgmail)

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-91.5%25-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![PWA](https://img.shields.io/badge/PWA-Supported-5A0FC8?logo=pwa&logoColor=white)

</div>

---

## ✨ 功能特性

<table>
<tr>
<td width="50%">

**📥 收件与存储**
- 收到的邮件自动存入 KV
- 支持附件存储到 R2
- 支持多人收件（To / 抄送）
- HTML 邮件的内嵌图片正常显示
- 收件箱支持搜索与分页

**👥 多用户**
- 注册/登录系统
- 每个用户独立收件箱
- 管理员可看全部邮件
- 任何用户都能自己改密码

**🚫 垃圾过滤**
- 加权评分 + 变体识别
- 词边界匹配
- 白名单保护
- 命中后隔离保留，不会直接丢弃

</td>
<td width="50%">

**📤 发送邮件**
- 通过 Resend API 发送
- 支持 HTML 格式
- 支持附件上传
- 支持回复与转发（自动带上原文）

**🔔 推送通知**
- Web Push 桌面通知
- 点击通知打开邮件
- 可在管理员面板开关

**📱 PWA 支持**
- 安装为桌面应用
- 支持 mailto: 链接
- 独立窗口运行

</td>
</tr>
<tr>
<td width="50%">

**🔐 账号安全**
- 口令 PBKDF2 加盐存储
- 会话走 HttpOnly Cookie
- 登录失败自动限速

</td>
<td width="50%">

**🛡️ 邮件安全**
- 正文一律转义后渲染
- 内嵌脚本会被清理
- 自动回复有回环防护

</td>
</tr>
</table>

---

## 🚀 快速开始

### 一键部署

点击下方按钮，Cloudflare 会自动帮你部署：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hong-a-debug/hgmail)

> 💡 部署完成后，继续看下面的「部署后配置」。

### 打开文件部署

1. 双击项目文件夹里的 `部署.bat`
2. 等待完成
3. 访问 `https://mail.你的域名`

### 手动部署

```bash
npm install
npx wrangler deploy
```

---

## 🎯 部署前准备

> 📖 **详细的准备说明，请看 [部署前准备文档](./README_.md)**

| 材料 | 说明 | 是否必需 |
|:-----|:-----|:--------:|
| Cloudflare 账号 | 免费注册 | ✅ |
| 一个域名 | 托管在 Cloudflare 上 | ✅ |
| Resend 账号 | 用于发送邮件 | ⚠️ |
| R2 存储桶 | 用于保存附件 | ⚠️ |
| Node.js 环境 | 本地部署需要 | ⚠️ |

**[👉 点击查看完整的部署前准备文档](https://github.com/hong-a-debug/hgmail/blob/main/README_.md)**

---

## 🚀 部署后配置

> ⚠️ 仓库里的 `wrangler.toml` 是**占位符模板**（`example.com`、`你的 ... id`），里面没有任何真实信息。
> 请把下面各步得到的真实值填进去，再执行部署。

### 第一步：创建 KV 命名空间

```bash
npx wrangler kv:namespace create EMAIL
npx wrangler kv:namespace create EMAIL_USER
```

将输出的两个 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "EMAIL"
id = "你复制的EMAIL_ID"

[[kv_namespaces]]
binding = "EMAIL_USER"
id = "你复制的EMAIL_USER_ID"
```

### 第二步：创建 R2 存储桶（可选）

```bash
npx wrangler r2 bucket create attachments
```

```toml
[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "attachments"
```

### 第三步：设置 Resend API Key（可选）

```bash
npx wrangler secret put RESEND_API_KEY
```

### 第四步：配置域名

```toml
[vars]
DOMAIN = "example.com"
ADMIN_ACCOUNT = "admin"
```

### 第五步：部署

```bash
npx wrangler deploy
```

### 第六步：配置邮件路由

1. Cloudflare 控制台 → 你的域名 → **Email** → **Email Routing**
2. 启用 Email Routing
3. **Catch-all** 规则选择 **Send to a Worker**
4. 选择你部署的 Worker

---

## 🔔 推送通知设置（可选）

### 第一步：生成 VAPID 密钥

```bash
npx web-push generate-vapid-keys
```

### 第二步：配置密钥

```toml
[vars]
VAPID_PUBLIC_KEY = "你的公钥"
```

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

### 第三步：安装依赖并部署

`web-push` 已经写在 `package.json` 的 dependencies 里，直接 `npm install` 即可，不需要再单独添加。

```bash
npm install
npx wrangler deploy
```

### 第四步：在网页上开启推送

1. 用 Edge/Chrome 打开你的网站
2. 登录管理员
3. 在左侧「系统设置」里找到「推送通知」
4. 点「开启推送」

### 权限被阻止怎么办

1. 点击地址栏左侧的 🔒 锁图标
2. 找到「通知」
3. 改成「允许」
4. 刷新页面
5. 再点「开启推送」

---

## 📱 PWA 安装（可选）

PWA 让你可以把网页"安装"到桌面，像原生软件一样使用。

### 如何安装

1. 用 **Edge** 或 **Chrome** 打开你的网站
2. 地址栏右侧会出现「安装」图标，点击它
3. 确认安装
4. 桌面会出现邮件图标

### 设置 mailto 处理

安装后，浏览器会弹窗问：「是否允许此应用处理 mailto: 链接？」

点 **允许**，之后在任意网页点击 `mailto:test@example.com`，会自动打开你的邮件应用。

### ⚠️ 重要：图标必须能公开访问

Cloudflare Access 会拦截 PWA 资源（`/icon.png`、`/manifest.json`、`/sw.js`），导致图标加载失败，PWA 无法安装。

**解决方法**：
1. Cloudflare Zero Trust → 访问控制 → 应用程序
2. 删除或禁用保护 `mail.你的域名` 的应用
3. 或用 Bypass 策略放行这三个路径

---

## 📎 附件支持

| 功能 | 说明 |
|:-----|:-----|
| **发送附件** | 写邮件时点击"添加附件"选择文件 |
| **接收附件** | 邮件中的附件自动保存到 R2 |
| **附件大小** | 单封邮件总大小不超过 10MB |
| **下载方式** | 邮件详情页点击下载 |

---

## 🚫 不想用 R2 怎么办？

R2 用于保存邮件附件。如果不想用，可以禁用附件功能。

### 影响对比

| 功能 | 有 R2 | 没有 R2 |
|:-----|:-----:|:-------:|
| 接收邮件 | ✅ | ✅ |
| 发送邮件 | ✅ | ✅ |
| 接收附件 | ✅ | ❌ |
| 发送附件 | ✅ | ✅ |

### 禁用方法

**修改 `src/index.ts`：**

```typescript
// 改前
const attachments = await saveAttachments(env, parsed.attachments, messageId);

// 改后
const attachments = [];
```

**修改 `wrangler.toml`：** 删掉 R2 配置。

---

## 🛡️ 安全机制

### 账号与会话

| 机制 | 说明 |
|:-----|:-----|
| 口令存储 | PBKDF2-SHA256，10 万次迭代 + 每用户随机盐 |
| 旧数据兼容 | 历史的无盐 SHA-256 口令仍能登录，登录成功后自动升级为 PBKDF2 |
| 会话凭证 | 服务端下发 `HttpOnly; Secure; SameSite=Lax` Cookie，前端 JS 读不到 |
| 退出登录 | 同时销毁服务端会话并清除 Cookie，被复制过的凭证立即失效 |
| 修改密码 | 校验当前密码后写入，并注销该用户在其他设备上的全部会话 |
| 登录限速 | 同一 IP 15 分钟内失败 10 次后拒绝登录 |
| 账号枚举 | 账号不存在与密码错误返回同一句提示 |

### 邮件内容

| 机制 | 说明 |
|:-----|:-----|
| 正文渲染 | 邮件正文一律先转义再渲染，`<img onerror=...>` 之类的载荷不会执行 |
| 隔离展示 | 邮件 HTML 在带 `sandbox` 的 iframe 中渲染，且不含 `allow-scripts` |
| Script 清理 | 邮件中的 `<script>` 标签及其内容会被删除 |
| 附件下载 | 强制 `attachment` + `nosniff`，只有图片/音视频允许内联返回 |
| 响应头 | 统一附加 CSP、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer` |
| 发信限制 | 单次收件人上限 50、附件上限 10MB、按用户每日配额 |

### 垃圾邮件过滤

系统使用**加权评分 + 变体识别**过滤垃圾邮件：

| 特性 | 说明 |
|:-----|:-----|
| 词边界匹配 | `free` 不会匹配 `freeware` |
| 加权评分 | 不同关键词权重不同 |
| 变体识别 | 能识别 `f.r.e.e`、`fr33`、`ｆｒｅｅ` |
| 长度归一化 | 长邮件按比例折算 |
| 中英文区分 | 中文字符权重按 2.5 倍计算 |
| 白名单优先 | 验证码、注册等邮件不会被拦截 |
| 命中后处理 | 隔离保留而不是丢弃，见「常见问题」 |

---

## 👥 角色权限

| 角色 | 页面标题 | 邮件列表 | 邮件详情 | 写邮件 | 系统设置 | 推送 |
|:-----|:-------:|:-------:|:-------:|:-----:|:-------:|:---:|
| 访客 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 普通用户 | ✅ | ✅ 自己的 | ✅ 自己的 | ✅ | ❌ | ✅ |
| 管理员 | ✅ | ✅ 全部 | ✅ 全部 | ✅ | ✅ | ✅ |

---

## 👥 用户指南

### 首次注册（成为管理员）

1. 访问你的邮件系统地址
2. 点击 **去注册**
3. 填写：
   - **邮箱：填一个属于你域名的真实邮箱**（例如 `admin@你的域名`），注册时会校验格式
   - **密码：至少 6 位**
   - **注册码：留空**（第一个用户不需要）

> 第一个注册的用户自动成为管理员。之后注册的人需要管理员在系统设置里生成注册码。

### 修改自己的密码

登录后点页面右上角的 **🔑 修改密码**：

1. 填写**当前密码**和**新密码**（至少 6 位，两次输入要一致）
2. 保存后，**其他设备上的登录会全部失效**，当前这台保持登录

管理员和普通用户用的是同一个入口，不在左侧「系统设置」里。

### 忘记密码了怎么办

登录页有「忘记密码？」入口（需要管理员先配置 `RESEND_API_KEY`）：

1. 填入注册时用的邮箱
2. 系统发一封带重置链接的邮件，链接 **30 分钟内有效、只能用一次**
3. 打开链接设置新密码；设置成功后该账号在所有设备上的登录都会失效

出于安全考虑，无论邮箱是否注册过，接口返回的结果都一样，无法用来判断某个邮箱是否存在。

### 管理员功能

| 功能 | 说明 |
|:-----|:-----|
| 查看全部邮件 | 管理员收件箱显示所有用户的邮件 |
| 修改页面标题 | 自定义网站标题 |
| 修改发件邮箱前缀 | 自定义发件人地址 |
| 生成注册码 | 为新用户生成注册码 |
| 自动回复开关 | 开启/关闭自动回复 |
| 站外发信开关 | 限制普通用户只能发给本域地址 |
| 注册需邮箱确认 | 开启后新用户要先点邮件里的确认链接才能登录 |
| **开启推送** | 收到新邮件时桌面通知 |

---

## 📖 API 接口

| 接口 | 方法 | 用途 | 权限 |
|:-----|:----:|:-----|:----:|
| `/` | GET | 管理界面 | 任何人 |
| `/manifest.json` | GET | PWA 清单 | 任何人 |
| `/icon.png` | GET | PWA 图标 | 任何人 |
| `/sw.js` | GET | Service Worker | 任何人 |
| `/new-email` | GET | mailto 链接跳转 | 任何人 |
| `/register` | POST | 用户注册 | 任何人 |
| `/register/confirm` | POST | 用确认令牌验证注册邮箱 | 任何人 |
| `/password/request` | POST | 申请重置密码（发重置链接到邮箱） | 任何人 |
| `/password/reset` | POST | 用重置令牌设置新密码 | 任何人 |
| `/login` | POST | 用户登录 | 任何人 |
| `/logout` | POST | 退出登录（销毁服务端会话） | 已登录 |
| `/user/password` | POST | 修改自己的密码 | 已登录 |
| `/user/sessions` | GET | 查看自己的登录设备（返回短哈希而非会话 id） | 已登录 |
| `/user/sessions/revoke` | POST | 踢出某个登录设备 | 已登录 |
| `/admin/spam` | GET | 垃圾邮件隔离区列表 | 管理员 |
| `/admin/spam/:id` | DELETE | 删除一封隔离邮件 | 管理员 |
| `/no-login/info` | GET | 未登录用户获取标题 | 任何人 |
| `/user/info` | GET | 已登录用户获取信息 | 已登录 |
| `/admin/info` | GET | 管理员获取完整设置 | 管理员 |
| `/mails` | GET | 邮件列表，支持 `?q=` 搜索、`?page=` `?pageSize=` 分页 | 已登录 |
| `/mail/:id` | GET | 邮件详情 | 已登录 |
| `/mail/:id` | DELETE | 删除邮件 | 已登录 |
| `/mail/:id/status` | POST | 标记回复/转发状态 | 已登录 |
| `/send` | POST | 发送邮件（html 与 text 至少一样） | 已登录 |
| `/download/:id` | GET | 下载附件，`?index=N` 选第几个（默认第一个） | 已登录 |
| `/attachments/:key` | GET | 下载指定附件 | 已登录 |
| `/push/vapid-public-key` | GET | 获取 VAPID 公钥 | 任何人 |
| `/push/subscribe` | POST | 保存推送订阅 | 已登录 |
| `/push/unsubscribe` | POST | 取消推送订阅 | 已登录 |
| `/admin/settings` | GET/POST | 管理员设置 | 管理员 |
| `/admin/regcode` | POST | 生成注册码 | 管理员 |

---

## 📁 项目结构

```
.
├── src/
│   ├── index.ts           # Worker 主入口（HTTP 路由 + 内嵌前端脚本）
│   ├── template.html      # 前端 HTML 模板
│   ├── auth.ts            # 用户/会话管理 + 口令散列（PBKDF2）
│   ├── admin.ts           # 管理员设置 + 注册码
│   ├── attachment.ts      # 附件处理（R2 存储）
│   ├── email-parser.ts    # 邮件解析 + 垃圾过滤
│   ├── resend-client.ts   # Resend 发送封装
│   ├── utils.ts           # SHA256 工具
│   ├── types.ts           # 类型定义
│   └── modules.d.ts       # HTML 模块类型声明
├── wrangler.toml          # Cloudflare 配置（仓库里是占位符模板）
├── package.json           # 依赖管理
├── tsconfig.json          # TypeScript 配置
├── .gitignore             # 忽略 node_modules / .wrangler / .dev.vars
├── .gitattributes         # 统一换行符
├── README.md              # 项目说明
├── README_.md             # 部署前准备文档
├── LICENSE                # 许可证
└── 部署.bat               # Windows 一键部署脚本
```

---

## ❓ 常见问题

<details>
<summary><b>PWA 安装图标不显示？</b></summary>

1. 确认图标是 PNG 格式（不是 SVG）
2. 确认 `manifest.json` 里的 icons 有 192x192 和 512x512
3. 确认 `/icon.png` 能公开访问（无 Cloudflare Access 拦截）
4. 清除缓存后强制刷新

</details>

<details>
<summary><b>推送通知不弹窗？</b></summary>

如果你之前多次拒绝过，浏览器会记住。点击地址栏锁图标 → 通知 → 改成"允许"。

</details>

<details>
<summary><b>PWA 安装后 mailto 不生效？</b></summary>

1. 确认用 Edge 或 Chrome
2. 确认已安装为 PWA
3. 首次安装后，浏览器会弹窗问是否允许处理 mailto，点允许

</details>

<details>
<summary><b>不想用 R2，怎么部署？</b></summary>

删掉 R2 配置，把 `saveAttachments` 调用改成 `const attachments = []`。

</details>

<details>
<summary><b>附件发送失败？</b></summary>

1. 检查单封邮件总大小是否超过 10MB
2. 确认 Resend API Key 已配置

</details>

<details>
<summary><b>注册验证码邮件被拦截了怎么办？</b></summary>

系统已内置白名单，如果仍有误拦，可以在 `src/email-parser.ts` 的 `SAFE_KEYWORDS` 数组中添加关键词。

</details>

<details>
<summary><b>如何关闭自动回复？</b></summary>

管理员登录后，在左侧 **系统设置** → **自动回复** 中，选择 **关闭** 并保存。

</details>

<details>
<summary><b>怎么修改密码？其他设备会掉线吗？</b></summary>

登录后点右上角的 **🔑 修改密码**，输入当前密码和新密码即可，管理员也一样。
修改成功后，**其他设备上的登录会全部失效**，当前这台保持登录。

</details>

<details>
<summary><b>登录提示「邮箱或密码错误」？</b></summary>

出于安全考虑，「账号不存在」和「密码错误」返回的是同一句提示，无法据此判断某个邮箱有没有注册过。

如果确认密码没错，先 **Ctrl + Shift + R 强制刷新**一次：旧版本的前端脚本可能还留在浏览器缓存里。

</details>

<details>
<summary><b>垃圾邮件去哪了？</b></summary>

被判为垃圾的邮件**不会直接丢弃**，而是隔离保存在 KV 的 `spam:<id>` 下（7 天后自动过期），
既不会进任何人的收件箱，附件也不会写入 R2。需要排查时可以用 `npx wrangler kv key list` 查看。

</details>

<details>
<summary><b>自动回复为什么没发出去？</b></summary>

以下几种情况会**主动跳过**自动回复，避免给对方服务器造成回环或退信轰炸：

- 邮件带 `Auto-Submitted` 头（说明它本身就是自动回复）
- `Precedence` 是 `bulk` / `list` / `junk`
- 发件人是本域（防止两台服务器互相回信）
- 发件人是 `mailer-daemon` / `postmaster` / `noreply` 等无人值守地址

另外还需要配置 `RESEND_API_KEY`，并在系统设置里开启自动回复。

</details>

<details>
<summary><b>登录后控制台有 CSP 报错？</b></summary>

如果站点挂在 Cloudflare 后面，边缘会自动往 HTML 里注入 Bot Management 和 Web Analytics 的脚本。
默认的 CSP 已经放行这两者；若你手动收紧了 CSP，需要同时放行 `'unsafe-inline'` 与 `https://static.cloudflareinsights.com`。

</details>

<details>
<summary><b>workers.dev 地址打不开？</b></summary>

绑定自定义域名即可解决。

</details>

<details>
<summary><b>普通用户能看到别人的邮件吗？</b></summary>

**不能。** 普通用户只能看到自己邮箱收到的邮件。管理员可以看到全部邮件。

</details>

<details>
<summary><b>收不到邮件？</b></summary>

检查：
1. Email Routing 是否启用
2. Catch-all 是否指向 Worker
3. DNS 记录是否已生效

</details>

---

<div align="center">

## 📝 License

MIT

---

**⭐ 如果这个项目对你有帮助，请给个 Star 支持一下！**

</div>
