# 📧 邮件系统

一个基于 Cloudflare 的免费邮件收发系统，你可以用自己买的域名来收信和发信。

## 这是干什么的？

简单说就是：
- 别人发邮件到 `任何名字@你的域名`，你能在网页上看到
- 你也能在网页上给别人发邮件
- 收到邮件后会自动回复一句"感谢来信"

## 需要准备什么？

| 东西 | 怎么弄 | 花钱吗 |
|------|--------|--------|
| 一个域名 | 去阿里云/腾讯云/Namecheap 买一个 | 花钱（一年几十块） |
| Cloudflare 账号 | 去 cloudflare.com 注册 | 免费 |
| Resend 账号 | 去 resend.com 注册 | 免费（有额度） |
| 一台电脑 | 你自己的就行 | 已经有了 |

> ⚠️ 域名必须托管在 Cloudflare 上。如果你域名是在阿里云买的，要把 DNS 解析转到 Cloudflare。

---

## 第一步：把域名放到 Cloudflare

1. 打开浏览器，访问 https://dash.cloudflare.com
2. 登录你的 Cloudflare 账号
3. 点击 **添加站点**，输入你的域名（比如 `example.com`）
4. 选择 **免费计划**
5. Cloudflare 会给你两个 **DNS 服务器地址**，比如 `amy.ns.cloudflare.com` 和 `bob.ns.cloudflare.com`
6. 去你买域名的网站（阿里云/腾讯云/Namecheap），找到 DNS 管理
7. 把原来的 DNS 服务器换成 Cloudflare 给你的那两个
8. 等几分钟到几小时，直到 Cloudflare 显示"活跃"

---

## 第二步：在 Resend 验证你的域名

1. 打开浏览器，访问 https://resend.com
2. 注册并登录
3. 点击 **Add Domain**
4. 输入你的域名，点击 **Add**
5. Resend 会给你几条 DNS 记录（MX、SPF、DKIM、DMARC）
6. 回到 Cloudflare 控制台，点击你的域名 → **DNS** → **记录**
7. 点击 **添加记录**，把 Resend 给你的那几条记录一条条加进去
8. 等几分钟到几小时，Resend 显示域名状态变成 **Verified**

---

## 第三步：在电脑上安装工具

### 3.1 安装 Node.js

1. 打开浏览器，访问 https://nodejs.org
2. 点击绿色的 **LTS** 版本下载
3. 下载完成后双击安装，一路点 **下一步**，不要改任何选项
4. 安装完成后，按 `Win + R`，输入 `cmd`，按回车
5. 在黑色窗口里输入 `node -v`，按回车
6. 如果显示 `v20.x.x` 之类的，说明安装成功

### 3.2 安装 Git

1. 打开浏览器，访问 https://git-scm.com/download/win
2. 点击下载，然后双击安装
3. 一路点 **下一步**，不要改任何选项
4. 安装完成后，关掉 CMD 窗口重新打开
5. 输入 `git --version`，按回车
6. 如果显示 `git version 2.x.x`，说明安装成功

---

## 第四步：下载项目代码

1. 打开浏览器，访问你的 GitHub 仓库
2. 点击绿色的 **Code** 按钮
3. 点击 **Download ZIP**
4. 下载后解压到一个文件夹，比如 `D:\my-email-worker`

---

## 第五步：创建 KV 存储

1. 按 `Win + R`，输入 `cmd`，按回车打开命令提示符
2. 输入以下命令，按回车（把路径换成你解压的文件夹位置）：

```bash
cd D:\my-email-worker
```

3. 登录 Cloudflare：

```bash
npx wrangler login
```

4. 浏览器会自动打开，点击 **允许** 授权
5. 创建 KV 命名空间：

```bash
npx wrangler kv:namespace create EMAIL
```

6. 输出会有一行类似这样的内容：

```
🌀 Creating namespace with title "my-email-worker-EMAIL"
✨ Success!
🚩 KV namespace with id: 81b0f153831548108fc5bfe552159d38
```

**把那个 `id` 复制下来，保存好。**

---

## 第六步：修改配置文件

1. 打开文件夹 `D:\my-email-worker`
2. 找到 `wrangler.toml` 文件，用记事本或 VS Code 打开
3. 找到这行：

```toml
id = "这里填你的KV ID"
```

把上一步复制的 `id` 填进去。

4. 找到这行：

```toml
DOMAIN = "example.com"
```

把 `example.com` 换成你的域名。

5. 保存文件并关闭。

---

## 第七步：安装依赖

在命令提示符里，确保你在 `D:\my-email-worker` 目录下，输入：

```bash
npm install
```

按回车，等待它运行完（会显示很多文字，不用管）。

---

## 第八步：设置 Resend API Key

1. 回到 Resend 控制台（https://resend.com）
2. 点击左侧 **API Keys**
3. 点击 **Create API Key**
4. 随便起个名字，权限选 **Send**，点击创建
5. **复制生成的 API Key**（只显示一次！）

回到命令提示符，输入：

```bash
npx wrangler secret put RESEND_API_KEY
```

按回车，然后把 API Key **粘贴** 进去（粘贴后不显示字符），按回车。

---

## 第九步：部署

在命令提示符输入：

```bash
npx wrangler deploy
```

如果看到红色的报错，改成：

```bash
npx wrangler deploy --no-bundle
```

等待出现绿色的 **Deployed** 字样，说明部署成功。

---

## 第十步：配置邮件路由

1. 打开 Cloudflare 控制台（https://dash.cloudflare.com）
2. 点击你的域名
3. 左侧菜单点击 **Email** → **Email Routing**
4. 点击 **Get started** 启用
5. 点击 **Catch-all** 规则
6. 选择 **Send to a Worker**
7. 在下拉菜单里选择你部署的 Worker（名字叫 `my-email-worker`）
8. 点击保存

---

## 第十一步：访问你的邮件系统

在浏览器打开：

```
https://my-email-worker.你的域名.workers.dev
```

如果打不开（在中国大陆可能被墙），继续往下看。

---

## 第十二步：绑定自己的域名（解决打不开的问题）

1. Cloudflare 控制台 → **Workers 和 Pages**
2. 点击你的 Worker（`my-email-worker`）
3. 点击 **设置** → **触发器** → **自定义域**
4. 点击 **添加自定义域**
5. 输入 `mail.你的域名`（比如 `mail.example.com`）
6. 点击保存，等几分钟生效
7. 然后你就可以用 `https://mail.你的域名` 访问了

---

## 验证是否成功

### 测试收信

用你的私人邮箱（QQ/163/Gmail）发一封邮件到 `test@你的域名`，等十几秒，刷新网页收件箱，应该能看到。

### 测试发信

在网页界面点 **写新邮件**，填上你的私人邮箱，发送，应该能收到。

---

## 常见问题

### 收不到邮件？

1. Cloudflare Email Routing 开了吗？（第十步）
2. Catch-all 指向 Worker 了吗？
3. Resend 域名验证完成了吗？（第二步）
4. 等了几分钟吗？（DNS 需要时间生效）

### `workers.dev` 打不开？

这是正常的，中国大陆访问受限。绑定自定义域名就好（第十二步）。

### 部署报错？

用 `npx wrangler deploy --no-bundle` 试试。

### 发邮件失败？

1. Resend API Key 设置了吗？（第八步）
2. Resend 域名验证完成了吗？
3. 发件人地址格式是 `noreply@你的域名`

---

## 目录结构

```
D:\my-email-worker\
├── src/
│   ├── index.ts           # 主程序
│   ├── email-parser.ts    # 解析邮件
│   ├── resend-client.ts   # 发送邮件
│   └── types.ts           # 类型定义
├── wrangler.toml          # 配置文件
├── package.json           # 依赖列表
├── tsconfig.json          # TypeScript 配置
└── README.md              # 这个文件
```

---

## 需要帮助？

把命令提示符里的**红色报错文字**复制下来，去 GitHub 提 Issue，或者问帮你部署的人。

---

## License

MIT
