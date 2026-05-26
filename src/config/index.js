require('dotenv').config();

const config = {
    port: process.env.PORT || 3007,
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
        uri: process.env.MONGO_URI || 'mongodb://localhost:27017/telegram-vip-db',
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
        subscriptionDays: parseInt(process.env.SUBSCRIPTION_DAYS, 10) || 30,
        subscriptionAmount: parseInt(process.env.SUBSCRIPTION_AMOUNT, 10) || 50,
    },
};

if (!config.telegram.botToken) {
    console.error('错误：请在 .env 文件中设置 TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

module.exports = config;
