const { chat: aiChat } = require('../services/ai');

const INLINE_KEYBOARD = {
    reply_markup: {
        inline_keyboard: [
            [
                { text: '/color', callback_data: '/color' },
                { text: 'nihao', callback_data: 'nihao' },
                { text: 'update', callback_data: '/update' },
            ],
            [
                { text: '加密货币交易是如何工作的？', callback_data: '加密货币交易是如何工作的？' },
                { text: '如何保护我的加密货币钱包？', url: 'https://www.google.com' },
            ],
        ],
    },
};

const HELP_TEXT = `
这是一个加密货币相关的问答机器人，您可以向它咨询加密货币的相关问题。

以下是一些您可以向机器人咨询的问题：
1. 加密货币的价格是多少？
2. 什么是比特币？
3. 加密货币交易是如何工作的？
4. 我应该如何保护我的加密货币钱包？

您可以直接向机器人发送问题，例如："比特币的价格是多少？"

注意：机器人只能回答与加密货币相关的问题，其他问题可能无法理解。
`;

function registerHandlers(bot) {
    bot.on('channel_post', (msg) => handleChannelPost(bot, msg));
    bot.on('text', (msg) => handleText(bot, msg));
    bot.on('document', (msg) => handleDocument(bot, msg));
    bot.on('callback_query', (query) => handleCallbackQuery(bot, query));
}

function handleChannelPost(bot, msg) {
    const { id: chatId } = msg.chat;
    if (msg.text) {
        console.log(`收到来自频道 ${chatId} 的消息: ${msg.text}`);
        bot.sendMessage(chatId, `已收到频道消息: ${msg.text}`);
    }
}

async function handleText(bot, msg) {
    const chatId = msg.chat.id;
    const text = msg.text.replace(/@tempTestBot2_10241222_bot/g, '');
    const paras = msg.text.trim().split(' ').filter(Boolean);

    if (text.includes('/help')) {
        bot.sendMessage(chatId, HELP_TEXT, INLINE_KEYBOARD);
        return;
    }

    if (text.includes('/menu')) {
        bot.sendMessage(chatId, '请从下方的键盘中选择一个命令：', {
            reply_markup: {
                keyboard: [[{ text: '/colors' }, { text: '/list' }]],
                resize_keyboard: true,
                one_time_keyboard: true,
                selective: true,
            },
        });
        return;
    }

    if (text.includes('/removeKeyBoard')) {
        bot.sendMessage(chatId, '键盘已移除。', {
            reply_markup: { remove_keyboard: true, selective: false },
        });
        return;
    }

    if (text.includes('/color')) {
        bot.sendMessage(chatId, '红、绿、蓝');
        return;
    }

    if (text.includes('/list')) {
        let payload;
        if (paras[1]) {
            const listMap = {
                js: 'JS神技能 - https://www.youtube.com/@STARDOMofficial',
                wk: '悟空日常 - https://www.youtube.com/@beitong',
            };
            payload = listMap[paras[1]] || `我的 - https://www.youtube.com/watch?v=WQ7JMawmW9M`;
        } else {
            payload = 'JS神技能\n悟空日常';
        }
        bot.sendMessage(chatId, payload);
        return;
    }

    try {
        const reply = await aiChat(text);
        console.log(`收到来自 ${msg.from.first_name} 的文本消息: ${text}`);
        bot.sendMessage(chatId, reply);
    } catch (error) {
        console.error('AI 回复出错:', error);
        bot.sendMessage(chatId, '抱歉，处理您的问题时发生了错误。');
    }
}

function handleDocument(bot, msg) {
    const chatId = msg.chat.id;
    const doc = msg.document;
    if (doc.mime_type && doc.mime_type.startsWith('image/')) {
        console.log(`收到来自 ${msg.from.first_name} 的图片 (作为文件)`);
        bot.sendDocument(chatId, doc.file_id, {
            caption: '我收到了你发送的文件图片，现在把它发回给你！',
        });
    }
}

async function handleCallbackQuery(bot, callbackQuery) {
    const { message, data } = callbackQuery;
    const chatId = message.chat.id;

    bot.answerCallbackQuery(callbackQuery.id);

    switch (data) {
        case '/color':
            bot.sendMessage(chatId, '红、绿、蓝');
            break;

        case 'nihao':
            bot.sendMessage(chatId, '你好！很高兴为您服务。');
            break;

        case '/update': {
            const newText = `内容已于 ${new Date().toLocaleString()} 更新。\n\n`;
            bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: message.message_id,
                reply_markup: message.reply_markup,
            }).catch((error) => {
                if (!(error.response && error.response.body.description.includes('message is not modified'))) {
                    console.error('编辑消息时出错:', error);
                }
            });
            break;
        }

        default:
            try {
                bot.sendMessage(chatId, `正在处理您的问题："${data}"...`);
                const reply = await aiChat(data);
                bot.sendMessage(chatId, reply);
            } catch (error) {
                console.error('AI 回复出错:', error);
                bot.sendMessage(chatId, '抱歉，处理您的问题时发生了错误。');
            }
            break;
    }
}

module.exports = { registerHandlers };
