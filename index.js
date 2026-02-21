
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
// import OpenAI from 'openai';
const { z } = require('zod');

const OpenAI = require('openai');

const deepseekapikey = process.env.DEEPSEEK_API_KEY;
const token = process.env.TELEGRAM_BOT_TOKEN;
const port = 8080;



const client = new OpenAI({
    apiKey: deepseekapikey,
    baseURL: 'https://api.deepseek.com/v1',
});




// 这是一个示例 URL。在实际部署时，您需要将其替换为您的公共 URL
// 例如，使用 ngrok 后生成的 URL，或者是您服务器的域名
// const url = 'https://your-public-url.com'; // <-- 稍后需要修改这里
const url = 'https://blink-icon-employer-controlled.trycloudflare.com'; // <-- 稍后需要修改这里

if (!token) {
    console.error('错误：请在 .env 文件中设置您的 TELEGRAM_BOT_TOKEN');
    process.exit(1);
}

// 创建 bot 实例，但暂时不启动 polling
const bot = new TelegramBot(token);

// 设置 Webhook。Telegram 会将更新发送到这个 URL
// 我们将路由设置为 /webhook/${token} 以增加一点安全性，防止他人随意调用
bot.setWebHook(`${url}/webhook/${token}`);

const app = express();

// 使用 express.json() 中间件来解析传入的 JSON 请求体
app.use(express.json());

// 添加一个根路由来响应浏览器请求，并显示 index.html
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

// 这是我们的 webhook 路由
// 当 Telegram 发送更新时，会向这个地址发送 POST 请求
app.post(`/webhook/${token}`, (req, res) => {
    // 将收到的请求体（即 Telegram 的更新）传递给 bot 处理
    bot.processUpdate(req.body);
    // 立即响应 Telegram，表示已收到，防止 Telegram 重复发送
    res.sendStatus(200);
});



// 监听频道消息
bot.on('channel_post', (msg) => {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;
    const text = msg.text;

    console.log(chatType, '<---chatType');




    // 确保是文本消息
    if (text) {
        console.log(`收到来自频道 ${chatId} 的消息: ${text}`);
        // 您可以在这里添加对频道消息的响应逻辑，例如调用 OpenAI
        bot.sendMessage(chatId, `已收到频道消息: ${text}`);
    }
});


// 监听文本消息 (回声)
bot.on('text', async (msg) => {
    const chatId = msg.chat.id;
    let text = msg.text.toLowerCase();
    text = msg.text.replace(/@tempTestBot2_10241222_bot/g, ''); 
    let paras = msg.text.trim().split(" "); 



    // 删除空格
    paras = paras.filter(function (para) {
        if (para) {
            return true;
        }
    });

        const options = {
            reply_markup: {
                inline_keyboard: [
                    // 第一行：包含两个按钮
                    [
                        { text: '/color', callback_data: '/color'},
                        { text: 'nihao', callback_data: 'nihao' },
                        { text: 'update', callback_data: '/update' }
                    ],
                    // 第二行：包含两个按钮
                    [
                        { text: '加密货币交易是如何工作的？', callback_data: '加密货币交易是如何工作的？' },
                        { text: '如何保护我的加密货币钱包？', url : 'https://www.google.com'  }
                    ]
                ]
            }
        };
    
    

    if (text.indexOf('/help') !== -1) {




        bot.sendMessage(chatId, `
    这是一个加密货币相关的问答机器人，您可以向它咨询加密货币的相关问题。
    
    以下是一些您可以向机器人咨询的问题：
    1. 加密货币的价格是多少？
    2. 什么是比特币？
    3. 加密货币交易是如何工作的？
    4. 我应该如何保护我的加密货币钱包？
    
    您可以直接向机器人发送问题，例如：“比特币的价格是多少？”
    
    注意：机器人只能回答与加密货币相关的问题，其他问题可能无法理解。
    `, options);
        return;
    }

        // 新增：处理 /menu 命令，弹出自定义键盘
    if (text.indexOf('/menu') !== -1) {
        const messageText = '请从下方的键盘中选择一个命令：';
        const options = {
            reply_markup: {
                keyboard: [
                    // 第一行：包含两个按钮
                    [{ text: '/colors' }, { text: '/list' }]
                ],
                // 让键盘大小适应内容
                resize_keyboard: true,
                // 点击按钮后自动隐藏键盘
                one_time_keyboard: true,
                selective : true
            }
        };

        bot.sendMessage(chatId, messageText, options);
        return;
    }

    if (text.indexOf('/removeKeyBoard') !== -1) {
        const messageText = '键盘已移除。';

         const options = {
            reply_markup: {
                remove_keyboard: true,
                selective: false
            }
        };

        bot.sendMessage(chatId, messageText, options);
    }



    if (text.indexOf('/color') !== -1) {
        bot.sendMessage(chatId, `红、绿、蓝`);
        return;
    }

    if (text.indexOf('/list') !== -1) {
        let payload = '';
        if (paras[1]){

            switch (paras[1]) {
                case 'js':
                    payload = `JS神技能 - https://www.youtube.com/@STARDOMofficial`
                    break;
                case 'wk':
                    payload = `悟空日常 - https://www.youtube.com/@beitong`
                    break;
                default:
                    payload = `我的 - https://www.youtube.com/watch?v=WQ7JMawmW9M`
                    break;
            }
        } else {
            payload = `
                JS神技能
                悟空日常
            `
        }

        bot.sendMessage(chatId, payload);
        return;
    }



    const fullSystemPrompt = `
      你是一个专业的加密货币相关领域的开发者，专业的行业解答
      
      返回要求：
      1. 只返回有效的JSON对象，不要有任何额外的文本
      2. 格式必须符合以下描述：{
            "query": "2",
            "interpretation": "用户输入了数字'2'，这可能是一个查询的开始、一个数字参数或一个简短的代码。由于没有上下文，无法确定其具体含义。",
            "response": "请提供更多上下文或详细信息，例如您想了解加密货币的哪个方面（如价格、技术、项目等），以便我能提供更准确的帮助。",
            "data": null,
            "suggestions": ["加密货币价格查询", "区块链技术解释", "DeFi项目介绍", "NFT市场分析", "交易策略建议"],
            "error": null,
            "status": "incomplete"
        }
      3. 确保所有字段都有正确的数据类型
      4. 如果某些信息缺失，使用null或合适的默认值
      5. 必须是中文
    `;

    const response = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
            { role: 'system', content: `${fullSystemPrompt}` },
            { role: 'user', content: `${text}` }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' }, // 关键参数
        max_tokens: 1000,
    });

    console.log(`收到来自 ${msg.from.first_name} 的文本消息: ${text}`);
    bot.sendMessage(chatId, JSON.parse(response.choices[0].message.content).response);
});

// 监听图片消息 (作为文件发送)
bot.on('document', (msg) => {
    const chatId = msg.chat.id;
    const doc = msg.document;

    // 检查文件类型是否为图片
    if (doc.mime_type && doc.mime_type.startsWith('image/')) {
        const fileId = doc.file_id;
        console.log(`收到来自 ${msg.from.first_name} 的图片 (作为文件)`);

        // 将文件用 file_id 发送回去
        bot.sendDocument(chatId, fileId, { caption: '我收到了你发送的文件图片，现在把它发回给你！2' });
    }
});


// 监听内联键盘按钮的点击事件
// 监听内联键盘按钮的点击事件
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    // 响应回调查询，这会告诉Telegram客户端停止显示按钮上的“加载中”状态
    bot.answerCallbackQuery(callbackQuery.id);

    // 根据 callback_data 的值执行不同操作
    switch (data) {
        case '/color':
            // 如果用户点击了 /color 按钮
            bot.sendMessage(chatId, `红、绿、蓝`);
            break;
        case 'nihao':
            // 如果用户点击了 nihao 按钮
            bot.sendMessage(chatId, `你好！很高兴为您服务。`);
            break;
        case '/update':
             // 如果用户点击了 update 按钮，编辑原始消息
            const newText = `内容已于 ${new Date().toLocaleString()} 更新。\n\n`;
            bot.editMessageText(newText, {
                chat_id: chatId,
                message_id: message.message_id,
                reply_markup: message.reply_markup // 保持键盘不变
            }).catch(error => {
                // 如果错误是“消息未修改”，则静默忽略它。
                if (!(error.response && error.response.body.description.includes('message is not modified'))) {
                    console.error('编辑消息时出错:', error);
                }
            });
            break;
        default:
            // 对于其他按钮（例如提问按钮），调用 OpenAI API
            try {
                // 首先发送一条消息，告知用户正在处理
                bot.sendMessage(chatId, `正在处理您的问题：“${data}”...`);

                const fullSystemPrompt = `
                  你是一个专业的加密货币相关领域的开发者，专业的行业解答
                  
                  返回要求：
                  1. 只返回有效的JSON对象，不要有任何额外的文本
                  2. 格式必须符合以下描述：{
                        "query": "2",
                        "interpretation": "用户输入了数字'2'，这可能是一个查询的开始、一个数字参数或一个简短的代码。由于没有上下文，无法确定其具体含义。",
                        "response": "请提供更多上下文或详细信息，例如您想了解加密货币的哪个方面（如价格、技术、项目等），以便我能提供更准确的帮助。",
                        "data": null,
                        "suggestions": ["加密货币价格查询", "区块链技术解释", "DeFi项目介绍", "NFT市场分析", "交易策略建议"],
                        "error": null,
                        "status": "incomplete"
                    }
                  3. 确保所有字段都有正确的数据类型
                  4. 如果某些信息缺失，使用null或合适的默认值
                  5. 必须是中文
                `;

                const response = await client.chat.completions.create({
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: `${fullSystemPrompt}` },
                        { role: 'user', content: `${data}` }
                    ],
                    temperature: 0.7,
                    response_format: { type: 'json_object' },
                    max_tokens: 1000,
                });

                const aiResponse = JSON.parse(response.choices[0].message.content).response;
                // 发送从 OpenAI 获取的答案
                bot.sendMessage(chatId, aiResponse);

            } catch (error) {
                console.error('调用 OpenAI API 时出错:', error);
                bot.sendMessage(chatId, '抱歉，处理您的问题时发生了错误。');
            }
            break;
    }
});

// 启动服务器
app.listen(port, () => {
    console.log(`服务器已在 http://localhost:${port} 上运行`);
    console.log(`机器人 Webhook 已设置，正在等待来自 Telegram 的消息...`);
    console.log(`请确保您的公网 URL (${url}) 已正确配置并指向此服务。`);
});
