# VIP 会员订阅系统 — RESTful API 接口文档

> Base URL: `http://localhost:8080`

---

## 目录

- [1. 创建订阅 / 续费](#1-创建订阅--续费)
- [2. 查询会员状态](#2-查询会员状态)
- [3. 查询订单详情](#3-查询订单详情)
- [4. 页面路由](#4-页面路由)
- [5. Webhook](#5-webhook)
- [数据模型](#数据模型)
- [状态流转](#状态流转)

---

## 1. 创建订阅 / 续费

创建新的订阅订单。如果用户已是 active 会员，则创建续费订单，到账后时间累加。

```
POST /api/subscribe
```

### 请求

**Content-Type:** `application/json`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| telegramUsername | string | 是 | Telegram 用户名，如 `@web3vip` 或 `web3vip` |

**请求示例：**

```json
{
  "telegramUsername": "@web3vip"
}
```

### 响应

#### 新订阅创建成功 `200`

```json
{
  "status": "pending",
  "message": "订单已创建，请转账后等待确认",
  "orderId": "6651a2b3c4d5e6f7g8h9i0j1",
  "isRenewal": false
}
```

#### 续费订单创建成功 `200`

```json
{
  "status": "pending",
  "message": "续费订单已创建，当前会员到期时间 2026/3/15，续费后将累加 30 天",
  "orderId": "6651a2b3c4d5e6f7g8h9i0j2",
  "isRenewal": true
}
```

#### 已有 pending 订单 `200`

```json
{
  "status": "pending",
  "message": "订单已创建，等待支付确认中...",
  "orderId": "6651a2b3c4d5e6f7g8h9i0j1"
}
```

#### 参数缺失 `400`

```json
{
  "error": "请提供 Telegram 账号"
}
```

#### 服务器错误 `500`

```json
{
  "error": "服务器内部错误"
}
```

### 后台行为

订单创建后，服务端自动启动后台轮询（每 30 秒查询一次 TronGrid API，最多 15 分钟），检测 TRC20 USDT 到账：

- **到账确认** → 订单状态变为 `active`，生成一次性邀请链接（新订阅）或累加有效期（续费）
- **轮询超时** → 订单状态变为 `failed`

---

## 2. 查询会员状态

根据 Telegram 用户名查询会员状态。当用户有多条记录时，按优先级返回：`active > pending > expired > failed`。

```
GET /api/status/:username
```

### 请求

| 参数 | 位置 | 类型 | 说明 |
|------|------|------|------|
| username | path | string | Telegram 用户名，如 `@web3vip` 或 `web3vip` |

### 响应

#### active — 有效会员 `200`

```json
{
  "status": "active",
  "telegramUsername": "@web3vip",
  "amount": 1,
  "txHash": "abc123def456...",
  "paidAt": "2026-02-22T10:30:00.000Z",
  "expiresAt": "2026-03-24T10:30:00.000Z",
  "createdAt": "2026-02-22T10:25:00.000Z",
  "remainingDays": 28,
  "totalDays": 30,
  "message": "VIP 会员，剩余 28 天"
}
```

#### pending — 待支付 `200`

```json
{
  "status": "pending",
  "telegramUsername": "@web3vip",
  "amount": 1,
  "txHash": null,
  "paidAt": null,
  "expiresAt": null,
  "createdAt": "2026-02-22T10:25:00.000Z",
  "message": "等待支付确认中..."
}
```

#### expired — 已到期 `200`

```json
{
  "status": "expired",
  "telegramUsername": "@web3vip",
  "amount": 1,
  "txHash": "abc123def456...",
  "paidAt": "2026-01-22T10:30:00.000Z",
  "expiresAt": "2026-02-21T10:30:00.000Z",
  "createdAt": "2026-01-22T10:25:00.000Z",
  "message": "会员已到期，请续费"
}
```

#### failed — 已失效 `200`

```json
{
  "status": "failed",
  "telegramUsername": "@web3vip",
  "amount": 1,
  "txHash": null,
  "paidAt": null,
  "expiresAt": null,
  "createdAt": "2026-02-22T10:25:00.000Z",
  "message": "订单已失效"
}
```

#### none — 无记录 `200`

```json
{
  "status": "none",
  "message": "未找到订阅记录"
}
```

---

## 3. 查询订单详情

根据订单 ID 查询订单状态。前端用于轮询支付结果。

```
GET /api/order/:id
```

### 请求

| 参数 | 位置 | 类型 | 说明 |
|------|------|------|------|
| id | path | string | MongoDB ObjectId，订单唯一标识 |

### 响应

#### 成功 `200`

```json
{
  "status": "active",
  "telegramUsername": "@web3vip",
  "expiresAt": "2026-03-24T10:30:00.000Z",
  "txHash": "abc123def456...",
  "inviteLink": "https://t.me/+aBcDeFgHiJk",
  "isRenewal": false
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| status | string | `pending` / `active` / `expired` / `failed` |
| telegramUsername | string | Telegram 用户名 |
| expiresAt | string \| null | 会员到期时间（ISO 8601） |
| txHash | string \| null | 链上交易哈希 |
| inviteLink | string \| null | VIP 群一次性邀请链接（仅 active 且非续费时有值） |
| isRenewal | boolean | 是否为续费订单 |

#### 订单不存在 `404`

```json
{
  "error": "订单不存在"
}
```

---

## 4. 页面路由

渲染 EJS 模板页面，返回 HTML。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | VIP 会员订阅页（同 `/vip`） |
| GET | `/vip` | VIP 会员订阅页 |
| GET | `/benefits` | 会员权益页 |
| GET | `/faq` | 常见问题页 |
| GET | `/contact` | 联系我们页 |

---

## 5. Webhook

Telegram Bot Webhook 端点，接收 Telegram 推送的消息更新。

```
POST /webhook/{BOT_TOKEN}
```

> 该端点由 Telegram 服务器调用，无需手动请求。Bot 启动时自动通过 `setWebHook` 注册。

---

## 数据模型

### Subscription

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| telegramUsername | String | — | Telegram 用户名（@开头），必填 |
| telegramUserId | Number | null | Telegram 数字 ID，入群时自动回填 |
| txHash | String | null | TRC20 链上交易哈希 |
| amount | Number | 0 | 实际支付金额（USDT） |
| status | String | pending | `pending` / `active` / `expired` / `failed` |
| inviteLink | String | null | VIP 群一次性邀请链接 |
| paidAt | Date | null | 链上到账确认时间 |
| expiresAt | Date | null | 会员到期时间 |
| reminded | Boolean | false | 是否已发送到期提醒 |
| isRenewal | Boolean | false | 是否为续费订单 |
| createdAt | Date | 自动 | 订单创建时间（mongoose timestamps） |
| updatedAt | Date | 自动 | 最后更新时间（mongoose timestamps） |

---

## 状态流转

```
┌─────────┐    支付超时/轮询超时     ┌────────┐
│ pending │ ───────────────────────> │ failed │
└────┬────┘                         └────────┘
     │
     │ 链上到账确认
     ▼
┌─────────┐    到期（定时任务检查）   ┌─────────┐
│  active │ ───────────────────────> │ expired │
└────┬────┘                         └─────────┘
     │
     │ 用户续费到账
     │ （旧订阅 → expired，新订阅 → active，时间累加）
     ▼
┌─────────────────┐
│ active (续费后)  │
│ expiresAt 累加   │
└─────────────────┘
```

### 到期时间计算规则

- **新订阅**：`expiresAt = 当前时间 + SUBSCRIPTION_DAYS 天`
- **续费（未过期）**：`expiresAt = 原到期时间 + SUBSCRIPTION_DAYS 天`（累加）
- **续费（已过期）**：`expiresAt = 当前时间 + SUBSCRIPTION_DAYS 天`（从现在算起）
