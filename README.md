# Telegram VIP 订阅机器人 (Telegram VIP Bot)

这是一个基于 Node.js 开发的 Telegram VIP 群组订阅机器人。它集成了 TRC20 USDT 自动支付验证、DeepSeek AI 聊天助手以及自动化的群成员管理（到期提醒、自动踢出）功能。

## ✨ 核心功能

- **自动化订阅管理**：支持用户通过 TRC20 网络支付 USDT 购买/续费 VIP 群组会员。
- **波场链 (Tron) 支付验证**：集成 TronWeb 自动监听和验证用户的转账记录。
- **自动群组管理**：定时任务每天检查会员状态，提前提醒快到期用户，并自动踢出过期未续费的成员。
- **AI 智能对话**：集成 DeepSeek API，机器人在群内或私聊中可提供智能问答服务。
- **Webhook 模式**：使用 Telegram Webhook 实时、高效地接收和处理用户消息。

## 🛠️ 技术栈

- **后端框架**: Node.js + Express
- **数据库**: SQLite (`better-sqlite3`)
- **Telegram 交互**: `node-telegram-bot-api` (Webhook 模式)
- **区块链交互**: `tronweb`
- **AI 服务**: `openai` (接入 DeepSeek API)
- **定时任务**: `node-schedule`

## 🚀 快速启动

### 1. 环境准备
确保你的本地环境已安装以下依赖：
- **Node.js** v20.20.2
- SQLite 数据库文件随应用自动创建，无需单独安装数据库服务
- CentOS 8.5 源码构建时需要 Python 3、make 和 C++ 编译工具链
- **内网穿透工具** (如 Cloudflare Tunnel `cloudflared` 或 `ngrok`，用于提供 HTTPS Webhook 地址)

### 2. 安装依赖包
克隆代码后，在项目根目录运行：
```bash
npm ci
```

请在部署目标机上安装依赖，不要复制其他操作系统的 `node_modules`。如果 CentOS 8.5 没有匹配的 `better-sqlite3` 预编译包，安装构建工具后从源码编译：

```bash
npm ci --build-from-source
```

SQLite 文件应位于应用账号可写的本地磁盘目录，不要放在 NFS/CIFS 上。首次启动会创建空库和表结构，不会导入原 MongoDB 历史数据。

### 3. 环境变量配置
在项目根目录检查或修改 `.env` 文件。你需要配置以下关键信息：

```env
# 端口设置 (默认 8080)
PORT=8080

# Telegram Bot 配置
TELEGRAM_BOT_TOKEN=你的Bot_Token
TELEGRAM_VIP_GROUP_ID=你的VIP群ID(需带负号，如 -100xxx，且Bot需为管理员)

# DeepSeek API 配置
DEEPSEEK_API_KEY=你的DeepSeek_API_Key

# Webhook 地址 (必须是外网可访问的 HTTPS 地址)
WEBHOOK_URL=https://你的内网穿透域名.trycloudflare.com

# SQLite 数据库文件路径
SQLITE_PATH=./data/telegram-vip.sqlite

# Tron/TRC20 支付配置
TRON_API_URL=https://api.trongrid.io
TRON_USDT_CONTRACT=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
MERCHANT_TRON_ADDRESS=你的收款钱包地址
MERCHANT_TRON_PRIVATE_KEY=你的钱包私钥(可选，用于签名验证)

# 业务参数配置
SCHEDULE_CRON=0 0 * * *  # 每天凌晨执行检查
REMIND_BEFORE_DAYS=3     # 提前3天提醒到期
SUBSCRIPTION_DAYS=30     # 订阅有效期30天
SUBSCRIPTION_AMOUNT=50   # 订阅金额(USDT)
```

### 4. 启动内网穿透 (Webhook 必备)
项目默认运行在 8080 端口。你需要将该端口暴露为公共 HTTPS 地址。以 Cloudflare 为例：
```bash
cloudflared tunnel --url http://localhost:8080
```
**注意**：每次重启内网穿透工具后，域名可能会变化，请务必将新的 HTTPS 链接更新到 `.env` 文件的 `WEBHOOK_URL` 中。

### 5. 启动项目

**开发模式（推荐）**
支持热重载，修改代码后自动重启：
```bash
npm run dev
```

**生产模式**
```bash
npm start
```

启动成功后，终端将输出：
> SQLite 数据库连接成功
> 服务器已在 http://localhost:8080 上运行
> Webhook 地址: https://xxxx.trycloudflare.com/webhook/***

## 📝 常见问题 (FAQ)

**1. 机器人无法收到消息？**
请检查：
- 你的 `WEBHOOK_URL` 是否是有效的 HTTPS 链接。
- 你的内网穿透工具是否正在运行。
- 启动日志中是否提示 Webhook 注册成功。

**2. `better-sqlite3` 无法加载或提示 `NODE_MODULE_VERSION` 不匹配？**
确认使用 Node.js v20.20.2，并在目标机重新执行 `npm ci`。如果预编译包不匹配，安装 Python 3、make 和 C++ 编译工具链后执行 `npm ci --build-from-source`。备份数据库时应同时处理 SQLite 主文件及 WAL 文件。

**3. 如何让机器人管理群组？**
必须将机器人拉入你的 VIP 群组，并且**授予管理员权限**（特别是添加用户、踢出用户、发送消息的权限）。