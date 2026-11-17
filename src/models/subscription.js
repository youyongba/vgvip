const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
    telegramUsername: { type: String, required: true, index: true },
    telegramUserId: { type: Number, default: null },
    txHash: { type: String, default: null },
    amount: { type: Number, default: 0 },
    expectedRaw: { type: String, immutable: true },
    paymentAddress: { type: String, immutable: true },
    tokenContract: { type: String, immutable: true },
    subscriptionDays: { type: Number, immutable: true },
    accessTokenHash: { type: String, immutable: true },
    openOrderKey: { type: String },
    paymentDeadline: { type: Date, immutable: true },
    reconcileUntil: { type: Date, immutable: true },
    nextCheckAt: { type: Date },
    lastPaymentError: { type: String, default: null },
    workerOwner: { type: String, default: null },
    workerUntil: { type: Date, default: () => new Date(0) },
    status: {
        type: String,
        enum: ['pending', 'reconciling', 'manual_review', 'active', 'expired', 'failed'],
        default: 'pending',
        index: true,
    },
    inviteLink: { type: String, default: null },
    inviteExpiresAt: { type: Date, default: null },
    inviteLockUntil: { type: Date, default: () => new Date(0) },
    inviteLockOwner: { type: String, default: null },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    reminded: { type: Boolean, default: false },
    isRenewal: { type: Boolean, default: false },
}, { timestamps: true });

subscriptionSchema.index(
    { txHash: 1 },
    { unique: true, partialFilterExpression: { txHash: { $type: 'string' } } }
);
// Amounts are never reused: a delayed payment must not activate a later order.
subscriptionSchema.index(
    { paymentAddress: 1, expectedRaw: 1 },
    { unique: true, partialFilterExpression: { expectedRaw: { $type: 'string' } } }
);
subscriptionSchema.index(
    { openOrderKey: 1 },
    { unique: true, partialFilterExpression: { openOrderKey: { $type: 'string' } } }
);
subscriptionSchema.index({ status: 1, nextCheckAt: 1 });

module.exports = mongoose.model('Subscription', subscriptionSchema);
