const mongoose = require('mongoose');
const config = require('../config');
const Subscription = require('../models/subscription');
const Member = require('../models/member');

async function connectDB() {
    try {
        await mongoose.connect(config.mongo.uri, { family: 4, serverSelectionTimeoutMS: 10000 });
        const topology = await mongoose.connection.db.admin().command({ hello: 1 });
        if (!topology.setName && topology.msg !== 'isdbgrid') {
            throw new Error('Payment safety requires MongoDB replica set or mongos; standalone MongoDB is not supported');
        }
        await Subscription.createIndexes();
        await Member.createIndexes();
        const legacy = await Subscription.updateMany(
            { status: { $in: ['pending', 'reconciling'] }, expectedRaw: { $exists: false } },
            { $set: { status: 'manual_review', lastPaymentError: 'Legacy shared-amount order requires manual reconciliation' },
                $unset: { openOrderKey: 1 } }
        );
        if (legacy.modifiedCount) console.warn(`${legacy.modifiedCount} legacy orders require manual reconciliation`);
        console.log('MongoDB 连接成功');
    } catch (error) {
        console.error('MongoDB 连接失败:', error.message);
        throw error;
    }
}

module.exports = { connectDB };
