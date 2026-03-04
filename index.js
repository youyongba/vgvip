const app = require('./src/app');
const config = require('./src/config');
const { connectDB } = require('./src/services/db');
const { startScheduler } = require('./src/services/scheduler');

async function start() {
    await connectDB();
    startScheduler();

    app.listen(config.port, () => {
        console.log(`服务器已在 http://localhost:${config.port} 上运行`);
        console.log(`Webhook 地址: ${config.webhookUrl}/webhook/***`);
    });
}

start().catch((err) => {
    console.error('启动失败:', err);
    process.exit(1);
});
