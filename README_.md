# 🎯 部署前准备

部署这个邮件系统之前，你需要准备以下材料。本文档会手把手教你每一步怎么操作。

---

## 📋 材料清单

| 材料 | 说明 | 是否必需 | 大概花费 |
|------|------|---------|---------|
| Cloudflare 账号 | 运行 Worker、存储邮件 | ✅ 必需 | 免费 |
| 一个域名 | 接收和发送邮件 | ✅ 必需 | 一年几十元 |
| Resend 账号 | 用于发送邮件 | ⚠️ 发信需要 | 免费 |
| R2 存储桶 | 用于保存附件 | ⚠️ 收附件需要 | 免费（10GB/月） |
| Node.js 环境 | 本地部署需要 | ⚠️ 本地部署需要 | 免费 |

**总共花费：** 只需要买域名（一年几十元），其他全部免费。

---

## 1️⃣ Cloudflare 账号（必需）

### 用途
- 运行你的 Worker 代码
- 存储邮件和用户数据（KV）
- 托管你的域名
- 接收邮件（Email Routing）

### 如何注册

1. 打开浏览器，访问 https://dash.cloudflare.com/sign-up
2. 输入邮箱和密码
3. 点击「Sign Up」
4. 去邮箱点击验证链接
5. 登录后就能看到控制台

### 需要做什么

| 步骤 | 说明 |
|------|------|
| 1. 注册账号 | 上面已完成 |
| 2. 把域名托管到 Cloudflare | 见下方「2️⃣ 域名」 |
| 3. 创建 KV 命名空间 | 部署时自动创建，或手动运行命令 |
| 4. 创建 R2 存储桶 | 部署时手动创建 |

### 免费额度

- Workers：每天 10 万次请求
- KV：1GB 存储，每天 10 万次读
- R2：10GB 存储/月，读取不收费
- Email Routing：免费

**对个人邮件系统完全够用。**

---

## 2️⃣ 一个域名（必需）

### 用途
- 接收邮件（如 `xxx@你的域名`）
- 发送邮件（如 `noreply@你的域名`）

### 如何购买

**方式一：阿里云（国内）**
1. 访问 https://wanwang.aliyun.com
2. 搜索你想要的域名
3. 加入清单，付款
4. 价格：`.com` 约 60 元/年，`.win` 约 10 元/年

**方式二：腾讯云（国内）**
1. 访问 https://dnspod.cloud.tencent.com
2. 同上

**方式三：Namecheap（国外）**
1. 访问 https://www.namecheap.com
2. 同上，价格更便宜

### 把域名托管到 Cloudflare

1. 登录 Cloudflare 控制台
2. 点击「添加站点」
3. 输入你的域名（如 `example.com`）
4. 选择「免费计划」
5. Cloudflare 会给你两个 DNS 服务器地址
   - 比如 `amy.ns.cloudflare.com`
   - 比如 `bob.ns.cloudflare.com`
6. 去你买域名的网站，找到 DNS 管理
7. 把原来的 DNS 服务器换成 Cloudflare 给的那两个
8. 等待几分钟到几小时
9. 直到 Cloudflare 显示「活跃」

### 验证成功

在 Cloudflare 控制台看到你的域名状态是「活跃」，就说明托管成功了。

---

## 3️⃣ Resend 账号（发信需要）

### 用途
- 通过 API 发送邮件
- 发送自动回复

### 如何注册

1. 访问 https://resend.com
2. 点击「Sign Up」
3. 用邮箱注册
4. 登录后进入控制台

### 免费额度

- 每天 100 封
- 每月 3000 封
- 对个人使用完全够用

### 需要做什么

**第一步：添加域名**
1. Resend 控制台 → Domains → Add Domain
2. 输入你的域名（如 `example.com`）
3. 点击「Add」

**第二步：配置 DNS 记录**
1. Resend 会给你几条 DNS 记录（MX、SPF、DKIM、DMARC）
2. 回到 Cloudflare 控制台 → 你的域名 → DNS → 记录
3. 点击「添加记录」，把 Resend 给的记录一条条加进去
4. 所有记录都添加完

**第三步：等待验证**
1. 等几分钟到几小时
2. Resend 显示域名状态变成「Verified」
3. 说明验证成功

**第四步：创建 API Key**
1. Resend 控制台 → API Keys → Create API Key
2. 权限选「Send」
3. 复制生成的 API Key（只显示一次！）
4. 保存好，后面部署时要用

### 不配置会怎样？

- 系统仍然可以**接收和存储邮件**
- 但**无法发送邮件**（包括自动回复和手动发信）
- 发送按钮会被自动隐藏并显示提示

---

## 4️⃣ R2 存储桶（收附件需要）

### 用途
- 存储邮件附件（图片、PDF、Word 等）

### 如何创建

**方式一：命令行（推荐）**
```bash
npx wrangler r2 bucket create attachments
```

**方式二：Cloudflare 控制台**
1. 登录 Cloudflare 控制台
2. 左侧菜单 → R2
3. 点击「Create bucket」
4. 名字填 `attachments`
5. 点击「Create bucket」

### 免费额度

- 10GB 存储/月
- 读取不收费（这是 R2 相比 AWS S3 的最大优势）
- 写入收费但很便宜

### 需要做什么

在 `wrangler.toml` 中绑定 R2：

```toml
[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "attachments"
```

### 不想用 R2 怎么办？

可以禁用附件功能，系统仍然能收发纯文本邮件。

**禁用方法：**

1. 修改 `src/index.ts` 中的 `email` 函数：
   ```typescript
   // 改前
   const attachments = await saveAttachments(env, parsed.attachments, messageId);
   
   // 改后
   const attachments = [];
   ```

2. 删掉 `wrangler.toml` 中的 R2 配置：
   ```toml
   # 删掉这段
   # [[r2_buckets]]
   # binding = "ATTACHMENTS"
   # bucket_name = "attachments"
   ```

3. 重新部署

**影响对比：**

| 功能 | 有 R2 | 没有 R2 |
|------|-------|---------|
| 接收邮件 | ✅ 正常 | ✅ 正常 |
| 发送邮件 | ✅ 正常 | ✅ 正常 |
| 网页管理 | ✅ 正常 | ✅ 正常 |
| 接收附件 | ✅ 保存到 R2 | ❌ 附件无法保存 |
| 发送附件 | ✅ 通过 Resend 发送 | ✅ 通过 Resend 发送 |
| 下载附件 | ✅ 从 R2 读取 | ❌ 无法下载 |

---

## 5️⃣ Node.js 环境（本地部署需要）

### 用途
- 运行 `wrangler` 命令行工具
- 部署 Worker 到 Cloudflare

### 如何安装

**Windows：**
1. 访问 https://nodejs.org
2. 点击绿色的「LTS」版本下载
3. 双击下载的 `.msi` 文件
4. 一路点「下一步」，不要改任何选项
5. 安装完成后，按 `Win + R`，输入 `cmd`，按回车
6. 在黑色窗口里输入 `node -v`，按回车
7. 如果显示 `v20.x.x` 之类的，说明安装成功

**Mac：**
```bash
brew install node
```

**Linux：**
```bash
sudo apt install nodejs npm
```

### 验证安装

```bash
node -v    # 显示 v20.x.x
npm -v     # 显示 10.x.x
```

### 不安装会怎样？

- 无法在本地运行 `wrangler` 命令
- 但可以用 GitHub Actions 或双击 `部署.bat` 部署
- 如果没有 Node.js，`部署.bat` 也运行不了

**建议还是装一下，几分钟的事。**

---

## ✅ 检查清单

部署前，确认以下项目：

- [ ] 有 Cloudflare 账号（已注册并登录）
- [ ] 有托管在 Cloudflare 的域名（状态显示「活跃」）
- [ ] （可选）有 Resend 账号和 API Key（域名已验证）
- [ ] （可选）创建了 R2 存储桶
- [ ] （可选）本地安装了 Node.js（版本 >= 18）

---

## 🚀 下一步

所有材料准备好后，回到 [主 README](./README.md) 继续部署。

---

## 📚 相关链接

- [主 README](./README.md) - 完整部署教程
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare Email Routing 文档](https://developers.cloudflare.com/email-routing/)
- [Resend 文档](https://resend.com/docs)
- [Cloudflare R2 文档](https://developers.cloudflare.com/r2/)
- [Node.js 官网](https://nodejs.org)
