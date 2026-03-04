const mongoose = require('mongoose');
const config = require('../config');

async function connectDB() {
    try {
        await mongoose.connect(config.mongo.uri);
        console.log('MongoDB 连接成功');
    } catch (error) {
        console.error('MongoDB 连接失败:', error.message);
        process.exit(1);
    }
}

module.exports = { connectDB };
