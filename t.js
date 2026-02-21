// 定义一个函数，用于向指定的 Telegram 频道发送消息
function sendMessage() {
  // Telegram Bot 的访问令牌
  var token = '8593060991:AAE01lw87VLkPfoFbfiKx5lqifyFAf8r12s';
  // 目标频道的 ID
  var chatId = '-1002331072693';
  // 要发送的消息内容
  var message = '你好，世界';

  // 构建请求的 URL
  var url = 'https://api.telegram.org/bot' + token + '/sendMessage';

  // 构建请求的 payload
  var payload = {
    'chat_id': chatId,
    'text': message
  };

  // 构建请求的选项
  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload)
  };

  // 发送 HTTP 请求
  UrlFetchApp.fetch(url, options);
}


// Telegram Bot 的访问令牌
const TOKEN = '8593060991:AAE01lw87VLkPfoFbfiKx5lqifyFAf8r12s';
// Telegram API 的基础 URL
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TOKEN}`;

// 处理 POST 请求的函数，当 Telegram Bot 收到新消息时会调用此函数
function doPost(e) {
  try {
    // 解析收到的 JSON 数据
    const update = JSON.parse(e.postData.contents);
    // 获取消息对象
    const message = update.message;

    // 如果消息存在并且包含文本内容
    if (message && message.text) {
      // 获取聊天 ID
      const chatId = message.chat.id;
      // 获取消息文本
      const text = message.text;

      // 将收到的文本加上“个屁”后回复给用户
      sendText(chatId, text + "个屁");
    }
  } catch (error) {
    // 记录错误日志
    Logger.log('Error: ' + error.toString());
  }
}

// 发送文本消息的函数
function sendText(chatId, text) {
  // 构建请求的 payload
  const payload = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      chat_id: chatId,
      text: text
    })
  };

  // 构建请求的 URL
  const url = `${TELEGRAM_API_URL}/sendMessage`;
  // 发送 HTTP 请求
  UrlFetchApp.fetch(url, payload);
}