const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { registerHandlers } = require('./handlers');

const bot = new TelegramBot(config.telegram.botToken);

bot.setWebHook(`${config.webhookUrl}/webhook/${config.telegram.botToken}`);

registerHandlers(bot);

module.exports = bot;
