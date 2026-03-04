const { Router } = require('express');
const config = require('../config');
const Subscription = require('../models/subscription');
const { pollPayment } = require('../services/tron');
const { createInviteLink } = require('../services/membership');

const router = Router();

/**
 * POST /api/subscribe
 * body: { telegramUsername: "@xxx" }
 * 创建 pending 订单，后台启动轮询到账
 */
router.post('/api/subscribe', async (req, res) => {
    try {
        let { telegramUsername } = req.body;
        if (!telegramUsername) {
            return res.status(400).json({ error: '请提供 Telegram 账号' });
        }

        telegramUsername = telegramUsername.trim();
        if (!telegramUsername.startsWith('@')) {
            telegramUsername = '@' + telegramUsername;
        }

        const existing = await Subscription.findOne({
            telegramUsername,
            status: { $in: ['pending', 'active'] },
        });

        if (existing && existing.status === 'pending') {
            return res.json({
                status: 'pending',
                message: '订单已创建，等待支付确认中...',
                orderId: existing._id,
            });
        }

        const activeSub = await Subscription.findOne({
            telegramUsername,
            status: 'active',
        });
        const isRenewal = !!activeSub;

        const sub = await Subscription.create({
            telegramUsername,
            amount: config.schedule.subscriptionAmount,
            status: 'pending',
        });

        const message = isRenewal
            ? `续费订单已创建，当前会员到期时间 ${activeSub.expiresAt.toLocaleDateString('zh-CN')}，续费后将累加 ${config.schedule.subscriptionDays} 天`
            : '订单已创建，请转账后等待确认';

        res.json({
            status: 'pending',
            message,
            orderId: sub._id,
            isRenewal,
        });

        processPayment(sub);

    } catch (error) {
        console.error('创建订阅出错:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

/**
 * GET /api/status/:username
 * 查询会员状态
 */
router.get('/api/status/:username', async (req, res) => {
    try {
        let username = req.params.username.trim();
        if (!username.startsWith('@')) {
            username = '@' + username;
        }

        const subs = await Subscription.find({ telegramUsername: username })
            .sort({ createdAt: -1 });

        const STATUS_PRIORITY = { active: 0, pending: 1, expired: 2, failed: 3 };
        subs.sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9));
        const sub = subs[0] || null;

        if (!sub) {
            return res.json({ status: 'none', message: '未找到订阅记录' });
        }

        const result = {
            status: sub.status,
            telegramUsername: sub.telegramUsername,
            amount: sub.amount || 0,
            txHash: sub.txHash || null,
            paidAt: sub.paidAt || null,
            expiresAt: sub.expiresAt || null,
            createdAt: sub.createdAt,
        };

        if (sub.status === 'active') {
            const now = new Date();
            const remaining = Math.max(0, Math.ceil((sub.expiresAt - now) / (1000 * 60 * 60 * 24)));
            const totalDays = sub.paidAt
                ? Math.max(remaining, Math.ceil((sub.expiresAt - sub.paidAt) / (1000 * 60 * 60 * 24)))
                : config.schedule.subscriptionDays;
            result.remainingDays = remaining;
            result.totalDays = totalDays;
            result.message = `VIP 会员，剩余 ${remaining} 天`;
        } else if (sub.status === 'pending') {
            result.message = '等待支付确认中...';
        } else if (sub.status === 'expired') {
            result.message = '会员已到期，请续费';
        } else {
            result.message = '订单已失效';
        }

        res.json(result);
    } catch (error) {
        console.error('查询状态出错:', error);
        res.status(500).json({ error: '服务器内部错误' });
    }
});

/**
 * GET /api/order/:id
 * 前端轮询订单支付状态
 */
router.get('/api/order/:id', async (req, res) => {
    try {
        const sub = await Subscription.findById(req.params.id);
        if (!sub) {
            return res.status(404).json({ error: '订单不存在' });
        }
        res.json({
            status: sub.status,
            telegramUsername: sub.telegramUsername,
            expiresAt: sub.expiresAt,
            txHash: sub.txHash,
            inviteLink: sub.inviteLink || null,
            isRenewal: sub.isRenewal || false,
        });
    } catch (error) {
        res.status(500).json({ error: '服务器内部错误' });
    }
});

/**
 * 后台处理支付：轮询链上交易 -> 确认到账 -> 激活会员 -> 发送邀请
 */
async function processPayment(sub) {
    const sinceTimestamp = sub.createdAt.getTime();
    const minAmount = config.schedule.subscriptionAmount;

    console.log(`开始轮询到账: ${sub.telegramUsername}, 最低 ${minAmount} USDT`);

    const payment = await pollPayment(sinceTimestamp, minAmount);

    if (!payment) {
        console.log(`轮询超时，未检测到付款: ${sub.telegramUsername}`);
        sub.status = 'failed';
        await sub.save();
        return;
    }

    // 防止同一笔交易被多个订单重复使用
    const duplicateTx = await Subscription.findOne({
        txHash: payment.txHash,
        _id: { $ne: sub._id },
    });
    if (duplicateTx) {
        console.log(`txHash ${payment.txHash} 已被订单 ${duplicateTx._id} 使用，跳过`);
        sub.status = 'failed';
        await sub.save();
        return;
    }

    console.log(`到账确认: ${sub.telegramUsername}, txHash: ${payment.txHash}, ${payment.amount} USDT`);

    // 重新从 DB 读取最新状态（用户可能在轮询期间 /start 绑定了 userId）
    const freshSub = await Subscription.findById(sub._id);
    if (!freshSub || freshSub.status !== 'pending') {
        console.log(`订单 ${sub._id} 状态已变更 (${freshSub?.status})，跳过`);
        return;
    }

    const now = new Date();
    const addDays = config.schedule.subscriptionDays * 24 * 60 * 60 * 1000;

    // 检查是否有现存的 active 订阅（续费场景）
    const activeSub = await Subscription.findOne({
        telegramUsername: freshSub.telegramUsername,
        status: 'active',
        _id: { $ne: freshSub._id },
    });

    freshSub.status = 'active';
    freshSub.txHash = payment.txHash;
    freshSub.amount = payment.amount;
    freshSub.paidAt = now;

    if (activeSub) {
        // 续费：在原到期时间基础上累加
        const baseTime = activeSub.expiresAt > now ? activeSub.expiresAt : now;
        freshSub.expiresAt = new Date(baseTime.getTime() + addDays);
        freshSub.telegramUserId = freshSub.telegramUserId || activeSub.telegramUserId;
        freshSub.inviteLink = activeSub.inviteLink;
        freshSub.isRenewal = true;

        // 旧订阅标记为 expired（已被续费订单替代）
        activeSub.status = 'expired';
        await activeSub.save();

        console.log(`续费成功: ${freshSub.telegramUsername}, 原到期 ${activeSub.expiresAt.toISOString()}, 新到期 ${freshSub.expiresAt.toISOString()}`);
    } else {
        // 新订阅：从当前时间算起
        freshSub.expiresAt = new Date(now.getTime() + addDays);

        try {
            const link = await createInviteLink(freshSub.telegramUsername);
            freshSub.inviteLink = link;
            console.log(`邀请链接已生成: ${freshSub.telegramUsername} -> ${link}`);
        } catch (error) {
            console.error(`生成邀请链接失败: ${freshSub.telegramUsername}`, error.message);
        }
    }

    await freshSub.save();
}

module.exports = router;
