const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
    telegramUsername: { type: String, required: true, index: true },
    telegramUserId: { type: Number, default: null },
    txHash: { type: String, default: null },
    amount: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ['pending', 'active', 'expired', 'failed'],
        default: 'pending',
        index: true,
    },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    reminded: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
