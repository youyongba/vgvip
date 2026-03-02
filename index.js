const app = require('./src/app');
const config = require('./src/config');

app.listen(config.port, () => {
    console.log(`服务器已在 http://localhost:${config.port} 上运行`);
    console.log(`Webhook 地址: ${config.webhookUrl}/webhook/***`);
});
