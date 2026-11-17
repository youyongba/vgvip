const mongoose = require('mongoose');

// One document serializes renewals and expiry actions for each Telegram account.
const memberSchema = new mongoose.Schema({
    _id: { type: String },
    telegramUserId: { type: Number, default: null, index: true },
    expiresAt: { type: Date, default: null },
    latestOrderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    lockOwner: { type: String, default: null },
    lockUntil: { type: Date, default: () => new Date(0) },
}, { timestamps: true });

module.exports = mongoose.model('Member', memberSchema);
