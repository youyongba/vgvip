const { randomInt, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const mongoose = require('mongoose');
const config = require('../config');
const Subscription = require('../models/subscription');
const Member = require('../models/member');
const { findPayment } = require('./tron');

const PAYABLE = ['pending', 'reconciling'];
const DAY_MS = 86400000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function normalizeUsername(value) {
    if (typeof value !== 'string' || !/^@?[a-z][a-z0-9_]{4,31}$/i.test(value.trim())) {
        const error = new Error('请输入有效的 Telegram 用户名');
        error.status = 400;
        throw error;
    }
    return '@' + value.trim().replace(/^@/, '').toLowerCase();
}

function ownsOrder(order, token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(order.accessTokenHash || '')) return false;
    return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(order.accessTokenHash, 'hex'));
}

function formatAmount(raw) {
    const value = BigInt(raw);
    return `${value / 1000000n}.${String(value % 1000000n).padStart(6, '0')}`;
}

function renewalExpiry(previous, now, days) {
    return new Date(Math.max(previous?.getTime() || 0, now.getTime()) + days * DAY_MS);
}

async function ensureMember(username) {
    const existing = await Member.findById(username);
    if (existing) return existing;
    const legacy = await Subscription.findOne({
        telegramUsername: { $regex: `^${username}$`, $options: 'i' },
        status: 'active',
    }).sort({ expiresAt: -1 });
    try {
        return await Member.findOneAndUpdate(
            { _id: username },
            { $setOnInsert: {
                expiresAt: legacy?.expiresAt || null,
                latestOrderId: legacy?._id || null,
                telegramUserId: legacy?.telegramUserId || null,
            } },
            { upsert: true, new: true }
        );
    } catch (error) {
        if (error.code !== 11000) throw error;
        return Member.findById(username);
    }
}

async function acquireMemberLock(username) {
    await ensureMember(username);
    const owner = randomBytes(16).toString('hex');
    const member = await Member.findOneAndUpdate(
        { _id: username, lockUntil: { $lte: new Date() } },
        { $set: { lockOwner: owner, lockUntil: new Date(Date.now() + config.payment.lockMs) } },
        { new: true }
    );
    return member ? owner : null;
}

async function releaseMemberLock(username, owner) {
    await Member.updateOne(
        { _id: username, lockOwner: owner },
        { $set: { lockOwner: null, lockUntil: new Date(0) } }
    );
}

async function createOrder(username, token) {
    await ensureMember(username);
    await Subscription.updateMany(
        { openOrderKey: username, status: 'pending', paymentDeadline: { $lte: new Date() } },
        { $set: { status: 'reconciling' }, $unset: { openOrderKey: 1 } }
    );
    for (let attempt = 0; attempt < 64; attempt++) {
        const existing = await Subscription.findOne({ openOrderKey: username });
        if (existing) {
            if (!ownsOrder(existing, token)) {
                const error = new Error('该账号已有待支付订单，请在创建订单的浏览器继续操作');
                error.status = 409;
                throw error;
            }
            return { order: existing, token };
        }
        const raw = String(config.schedule.subscriptionAmount * 1e6 + randomInt(1, 1000000));
        const accessToken = randomBytes(32).toString('hex');
        const now = new Date();
        try {
            const order = await Subscription.create({
                telegramUsername: username, openOrderKey: username,
                amount: Number(raw) / 1e6, expectedRaw: raw,
                paymentAddress: config.tron.merchantAddress, tokenContract: config.tron.usdtContract,
                subscriptionDays: config.schedule.subscriptionDays, accessTokenHash: hashToken(accessToken),
                paymentDeadline: new Date(now.getTime() + config.payment.windowMs),
                reconcileUntil: new Date(now.getTime() + config.payment.windowMs + config.payment.reconciliationMs),
                nextCheckAt: now, status: 'pending',
            });
            return { order, token: accessToken };
        } catch (error) {
            if (error.code !== 11000) throw error;
        }
    }
    const error = new Error('暂时无法分配唯一付款金额，请稍后重试');
    error.status = 503;
    throw error;
}

// Receipt, membership extension and replacement of old active rows commit together.
async function activatePayment(orderId, payment) {
    const initial = await Subscription.findById(orderId);
    if (!initial || !PAYABLE.includes(initial.status)) return false;
    if (!initial.expectedRaw || Math.round(payment.amount * 1e6) !== Number(initial.expectedRaw)
        || !/^[a-f0-9]{64}$/i.test(payment.txHash || '')
        || payment.timestamp < initial.createdAt.getTime()
        || payment.timestamp > initial.paymentDeadline.getTime()) {
        throw new Error('Payment does not match the immutable order');
    }
    const username = initial.telegramUsername;
    const owner = await acquireMemberLock(username);
    if (!owner) throw new Error('Membership is busy; payment will be retried');
    let session;
    let activated = false;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            activated = false;
            const order = await Subscription.findOne({ _id: orderId, status: { $in: PAYABLE } }).session(session);
            if (!order) return;
            const member = await Member.findOne({
                _id: username, lockOwner: owner, lockUntil: { $gt: new Date() },
            }).session(session);
            if (!member) throw new Error('Membership lock expired');
            const now = new Date();
            const isRenewal = !!member.expiresAt && member.expiresAt > now;
            const expiresAt = renewalExpiry(member.expiresAt, now, order.subscriptionDays);
            member.expiresAt = expiresAt;
            member.latestOrderId = order._id;
            member.telegramUserId = member.telegramUserId || order.telegramUserId;
            await member.save({ session });
            await Subscription.updateMany(
                { telegramUsername: { $regex: `^${username}$`, $options: 'i' }, status: 'active', _id: { $ne: order._id } },
                { $set: { status: 'expired' } },
                { session }
            );
            const result = await Subscription.updateOne(
                { _id: order._id, status: { $in: PAYABLE }, txHash: null },
                { $set: {
                    status: 'active', txHash: payment.txHash, amount: payment.amount,
                    paidAt: new Date(payment.timestamp), expiresAt, isRenewal,
                    telegramUserId: member.telegramUserId, lastPaymentError: null,
                }, $unset: { openOrderKey: 1 } },
                { session }
            );
            if (result.modifiedCount !== 1) throw new Error('Order was concurrently changed');
            activated = true;
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
        return activated;
    } finally {
        if (session) await session.endSession();
        await releaseMemberLock(username, owner);
    }
}

async function checkOrder(order) {
    try {
        const payment = await findPayment(order);
        if (payment) {
            await activatePayment(order._id, payment);
        } else {
            const now = new Date();
            const status = now >= order.reconcileUntil ? 'manual_review'
                : now >= order.paymentDeadline ? 'reconciling' : 'pending';
            await Subscription.updateOne(
                { _id: order._id, status: { $in: PAYABLE } },
                { $set: { status, lastPaymentError: null, nextCheckAt: new Date(Date.now() + config.payment.checkIntervalMs) },
                    ...(status !== 'pending' ? { $unset: { openOrderKey: 1 } } : {}) }
            );
        }
    } catch (error) {
        console.error(`Payment reconciliation failed for ${order._id}:`, error.message);
        // Preserve the order on network/DB errors. Never turn these into "unpaid".
        await Subscription.updateOne(
            { _id: order._id, status: { $in: PAYABLE } },
            { $set: {
                lastPaymentError: error.message,
                nextCheckAt: new Date(Date.now() + config.payment.checkIntervalMs),
            } }
        );
    }
}

let workerRunning = false;
async function runPaymentWorker() {
    if (workerRunning) return;
    workerRunning = true;
    try {
        for (let count = 0; count < 20; count++) {
            const owner = randomBytes(16).toString('hex');
            const now = new Date();
            const order = await Subscription.findOneAndUpdate(
                { status: { $in: PAYABLE }, expectedRaw: { $exists: true }, nextCheckAt: { $lte: now },
                    workerUntil: { $lte: now } },
                { $set: { workerOwner: owner, workerUntil: new Date(Date.now() + config.payment.lockMs) } },
                { new: true, sort: { nextCheckAt: 1 } }
            );
            if (!order) break;
            try { await checkOrder(order); } finally {
                await Subscription.updateOne(
                    { _id: order._id, workerOwner: owner },
                    { $set: { workerOwner: null, workerUntil: new Date(0) } }
                );
            }
        }
    } finally {
        workerRunning = false;
    }
}

function startPaymentWorker() {
    const run = () => runPaymentWorker().catch(error => console.error('Payment worker failed:', error.message));
    run();
    return setInterval(run, 5000);
}

module.exports = {
    normalizeUsername, ownsOrder, formatAmount, renewalExpiry, ensureMember,
    acquireMemberLock, releaseMemberLock, createOrder, activatePayment,
    checkOrder, runPaymentWorker, startPaymentWorker,
};
