require('dotenv').config();

const config = {
    port: process.env.PORT || 3107,
    webhookUrl: process.env.WEBHOOK_URL || 'https://blink-icon-employer-controlled.trycloudflare.com',

    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN,
        vipGroupId: process.env.TELEGRAM_VIP_GROUP_ID,
    },

    deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com/v1',
    },

    mongo: {
        uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/telegram-vip-db',
    },

    tron: {
        apiUrl: process.env.TRON_API_URL || 'https://api.trongrid.io',
        usdtContract: process.env.TRON_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        merchantAddress: process.env.MERCHANT_TRON_ADDRESS,
        merchantPrivateKey: process.env.MERCHANT_TRON_PRIVATE_KEY,
    },

    schedule: {
        cron: process.env.SCHEDULE_CRON || '0 0 * * *',
        remindBeforeDays: parseInt(process.env.REMIND_BEFORE_DAYS, 10) || 3,
        subscriptionDays: Number(process.env.SUBSCRIPTION_DAYS ?? 30),
        subscriptionAmount: Number(process.env.SUBSCRIPTION_AMOUNT ?? 50),
    },
    payment: {
        windowMs: 15 * 60 * 1000,
        reconciliationMs: 24 * 60 * 60 * 1000,
        checkIntervalMs: 30000,
        requestTimeoutMs: 15000,
        lockMs: 2 * 60 * 1000,
    },
};

if (!config.telegram.botToken) {
    console.error('错误：请在 .env 文件中设置 TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(config.tron.merchantAddress || '')) {
    console.error('错误：请在 .env 文件中设置有效的 MERCHANT_TRON_ADDRESS');
    process.exit(1);
}

if (!Number.isSafeInteger(config.schedule.subscriptionAmount) || config.schedule.subscriptionAmount <= 0
    || config.schedule.subscriptionAmount > 1000000
    || !Number.isSafeInteger(config.schedule.subscriptionDays) || config.schedule.subscriptionDays <= 0) {
    throw new Error('Subscription amount and days must be positive integers within supported limits');
}

module.exports = config;
