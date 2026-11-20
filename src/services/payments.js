const { randomInt, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { immediateTransaction } = require('./db');
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
    const existing = Member.findById(username);
    if (existing) return existing;
    const legacy = Subscription.findLatestActiveByUsername(username);
    return Member.ensure(username, legacy);
}

async function acquireMemberLock(username) {
    await ensureMember(username);
    const owner = randomBytes(16).toString('hex');
    const now = new Date();
    const lockUntil = new Date(now.getTime() + config.payment.lockMs);
    return Member.acquireLock(username, owner, now, lockUntil) ? owner : null;
}

async function releaseMemberLock(username, owner) {
    Member.releaseLock(username, owner, new Date());
}

async function createOrder(username, token) {
    await ensureMember(username);
    Subscription.markExpiredPendingOpenOrders(username, new Date());
    for (let attempt = 0; attempt < 64; attempt++) {
        const existing = Subscription.findByOpenOrderKey(username);
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
            const order = Subscription.create({
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
            if (!error.code?.startsWith('SQLITE_CONSTRAINT_')) throw error;
        }
    }
    const error = new Error('暂时无法分配唯一付款金额，请稍后重试');
    error.status = 503;
    throw error;
}

function assertPaymentMatches(order, payment) {
    if (!order.expectedRaw || Math.round(payment.amount * 1e6) !== Number(order.expectedRaw)
        || !/^[a-f0-9]{64}$/i.test(payment.txHash || '')
        || payment.timestamp < order.createdAt.getTime()
        || payment.timestamp > order.paymentDeadline.getTime()) {
        throw new Error('Payment does not match the immutable order');
    }
}

// 到账、会员续期和旧订阅过期在同一事务中提交。
async function activatePayment(orderId, payment) {
    const initial = Subscription.findById(orderId);
    if (!initial || !PAYABLE.includes(initial.status)) return false;
    assertPaymentMatches(initial, payment);
    const username = initial.telegramUsername;
    const owner = await acquireMemberLock(username);
    if (!owner) throw new Error('Membership is busy; payment will be retried');
    try {
        return immediateTransaction(() => {
            const order = Subscription.findPayableById(orderId);
            if (!order) return false;
            assertPaymentMatches(order, payment);
            const now = new Date();
            const member = Member.findLockedByOwner(username, owner, now);
            if (!member) throw new Error('Membership lock expired');
            const isRenewal = !!member.expiresAt && member.expiresAt > now;
            const expiresAt = renewalExpiry(member.expiresAt, now, order.subscriptionDays);
            const telegramUserId = member.telegramUserId || order.telegramUserId;
            if (Member.updateAfterPayment(
                username, owner, expiresAt, order._id, telegramUserId, now
            ) !== 1) throw new Error('Membership lock expired');
            Subscription.expireOtherActive(username, order._id, now);
            if (Subscription.activateOrder(
                order._id, payment, expiresAt, isRenewal, telegramUserId, now
            ) !== 1) throw new Error('Order was concurrently changed');
            return true;
        });
    } finally {
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
            Subscription.recordPaymentCheck(
                order._id, status, new Date(now.getTime() + config.payment.checkIntervalMs), now
            );
        }
    } catch (error) {
        console.error(`Payment reconciliation failed for ${order._id}:`, error.message);
        // Preserve the order on network/DB errors. Never turn these into "unpaid".
        const now = new Date();
        Subscription.recordPaymentError(
            order._id, error.message, new Date(now.getTime() + config.payment.checkIntervalMs), now
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
            const order = Subscription.claimNextWorker(
                now, owner, new Date(now.getTime() + config.payment.lockMs)
            );
            if (!order) break;
            try { await checkOrder(order); } finally {
                Subscription.releaseWorker(order._id, owner, new Date());
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
