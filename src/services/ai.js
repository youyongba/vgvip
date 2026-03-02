const OpenAI = require('openai');
const config = require('../config');

const client = new OpenAI({
    apiKey: config.deepseek.apiKey,
    baseURL: config.deepseek.baseURL,
});

const SYSTEM_PROMPT = `
你是一个专业的加密货币相关领域的开发者，专业的行业解答

返回要求：
1. 只返回有效的JSON对象，不要有任何额外的文本
2. 格式必须符合以下描述：{
      "query": "",
      "interpretation": "",
      "response": "",
      "data": null,
      "suggestions": [],
      "error": null,
      "status": ""
  }
3. 确保所有字段都有正确的数据类型
4. 如果某些信息缺失，使用null或合适的默认值
5. 必须是中文
`;

async function chat(userMessage) {
    const response = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        max_tokens: 1000,
    });

    return JSON.parse(response.choices[0].message.content).response;
}

module.exports = { chat };
