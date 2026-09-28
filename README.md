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
- **数据库**: MongoDB (Mongoose)
- **Telegram 交互**: `node-telegram-bot-api` (Webhook 模式)
- **区块链交互**: `tronweb`
- **AI 服务**: `openai` (接入 DeepSeek API)
- **定时任务**: `node-schedule`

## 🚀 快速启动

### 1. 环境准备
确保你的本地环境已安装以下依赖：
- **Node.js** (推荐 v18 或以上版本)
- **MongoDB** (本地运行或提供远程 URI)
- **内网穿透工具** (如 Cloudflare Tunnel `cloudflared` 或 `ngrok`，用于提供 HTTPS Webhook 地址)

### 2. 安装依赖包
克隆代码后，在项目根目录运行：
```bash
npm install
```

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

# MongoDB 数据库连接
MONGO_URI=mongodb://tg_vip_bot_user:qihong@127.0.0.1:27017/tg_vip_bot?authSource=tg_vip_bot

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
*(注：为避免 Node.js 的 IPv6 解析问题，建议 MongoDB URI 中使用 `127.0.0.1` 替代 `localhost`)*

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
> MongoDB 连接成功
> 服务器已在 http://localhost:8080 上运行
> Webhook 地址: https://xxxx.trycloudflare.com/webhook/***

## 📝 常见问题 (FAQ)

**1. 机器人无法收到消息？**
请检查：
- 你的 `WEBHOOK_URL` 是否是有效的 HTTPS 链接。
- 你的内网穿透工具是否正在运行。
- 启动日志中是否提示 Webhook 注册成功。

**2. 数据库报错 `ECONNREFUSED ::1:27017`？**
将 `.env` 文件中 `MONGO_URI` 的 `localhost` 改为 `127.0.0.1`。同时确保你的 MongoDB 服务已经正常启动并且配置了相应的账号密码。

**3. 如何让机器人管理群组？**
必须将机器人拉入你的 VIP 群组，并且**授予管理员权限**（特别是添加用户、踢出用户、发送消息的权限）。