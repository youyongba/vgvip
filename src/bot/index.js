const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { registerHandlers } = require('./handlers');

// 强制使用 IPv4，解决服务器 IPv6 路由不可达导致的 AggregateError
const bot = new TelegramBot(config.telegram.botToken, {
    request: {
        family: 4
    }
});

bot.setWebHook(`${config.webhookUrl}/webhook/${config.telegram.botToken}`)
    .then(() => console.log('✅ Telegram Webhook 设置成功'))
    .catch((err) => console.error('❌ Telegram Webhook 设置失败:', err.message));

registerHandlers(bot);

module.exports = bot;
