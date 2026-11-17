const { Router } = require('express');
const config = require('../config');
const Subscription = require('../models/subscription');
const { createOrder, normalizeUsername, ownsOrder, formatAmount } = require('../services/payments');
const { ensureInviteLink } = require('../services/membership');

const router = Router();

/**
 * GET /api/test-db
 * 测试数据库连接状态
 */
router.get('/api/test-db', async (req, res) => {
    try {
        // readyState: 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
        const state = Subscription.db.readyState;
        if (state === 1) {
            res.json({ success: true, message: '✅ 数据库连接正常！' });
        } else {
            res.json({ success: false, message: `❌ 数据库未连接 (状态码: ${state})` });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: `❌ 数据库错误: ${error.message}` });
    }
});

/**
 * POST /api/subscribe
 * body: { telegramUsername: "@xxx" }
 * 创建 pending 订单，后台启动轮询到账
 */
router.post('/api/subscribe', async (req, res) => {
    try {
        const username = normalizeUsername(req.body.telegramUsername);
        const { order, token } = await createOrder(username, req.body.orderToken);
        res.json({
            status: 'pending',
            message: '请在付款截止前按订单精确金额转账，不要取整',
            orderId: order._id,
            orderToken: token,
            amount: formatAmount(order.expectedRaw),
            paymentAddress: order.paymentAddress,
            paymentDeadline: order.paymentDeadline,
        });
    } catch (error) {
        console.error('创建订阅出错:', error);
        res.status(error.status || 500).json({ error: error.status ? error.message : '服务器内部错误' });
    }
});

/**
 * GET /api/status/:username
 * 查询会员状态
 */
router.get('/api/status/:username', async (req, res) => {
    try {
        const username = normalizeUsername(req.params.username);

        const subs = await Subscription.find({ telegramUsername: { $regex: `^${username}$`, $options: 'i' } })
            .sort({ createdAt: -1 });

        const STATUS_PRIORITY = { active: 0, pending: 1, reconciling: 2, manual_review: 3, expired: 4, failed: 5 };
        subs.sort((a, b) => (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9));
        const sub = subs[0] || null;

        if (!sub) {
            return res.json({ status: 'none', message: '未找到订阅记录' });
        }

        const result = {
            status: sub.status === 'active' && sub.expiresAt <= new Date() ? 'expired' : sub.status,
            telegramUsername: sub.telegramUsername,
            amount: sub.amount || 0,
            txHash: sub.txHash || null,
            paidAt: sub.paidAt || null,
            expiresAt: sub.expiresAt || null,
            createdAt: sub.createdAt,
        };

        if (result.status === 'active') {
            const now = new Date();
            const remaining = Math.max(0, Math.ceil((sub.expiresAt - now) / (1000 * 60 * 60 * 24)));
            const totalDays = sub.paidAt
                ? Math.max(remaining, Math.ceil((sub.expiresAt - sub.paidAt) / (1000 * 60 * 60 * 24)))
                : config.schedule.subscriptionDays;
            result.remainingDays = remaining;
            result.totalDays = totalDays;
            result.message = `VIP 会员，剩余 ${remaining} 天`;
        } else if (result.status === 'pending') {
            result.message = '等待支付确认中...';
        } else if (result.status === 'reconciling') {
            result.message = '付款窗口已结束，正在持续核对到账，请勿重复转账';
        } else if (result.status === 'manual_review') {
            result.message = '订单需要人工核对，请联系客服并提供交易哈希';
        } else if (result.status === 'expired') {
            result.message = '会员已到期，请续费';
        } else {
            result.message = '订单已失效';
        }

        res.json(result);
    } catch (error) {
        console.error('查询状态出错:', error);
        res.status(error.status || 500).json({ error: error.status ? error.message : '服务器内部错误' });
    }
});

/**
 * GET /api/order/:id
 * 前端轮询订单支付状态
 */
router.get('/api/order/:id', async (req, res) => {
    try {
        if (!/^[a-f0-9]{24}$/i.test(req.params.id)) {
            return res.status(400).json({ error: '无效订单编号' });
        }
        const sub = await Subscription.findById(req.params.id);
        if (!sub) {
            return res.status(404).json({ error: '订单不存在' });
        }
        const token = req.get('Authorization')?.replace(/^Bearer /, '');
        if (!ownsOrder(sub, token)) return res.status(403).json({ error: '无权访问此订单，请使用创建订单的浏览器' });
        let inviteLink = null;
        if (sub.status === 'active' && sub.expiresAt > new Date()) {
            try { inviteLink = await ensureInviteLink(sub._id); } catch (error) {
                console.error(`Invite delivery retry failed for ${sub._id}:`, error.message);
            }
        }
        res.json({
            status: sub.status === 'active' && sub.expiresAt <= new Date() ? 'expired' : sub.status,
            telegramUsername: sub.telegramUsername,
            expiresAt: sub.expiresAt,
            txHash: sub.txHash,
            inviteLink,
            isRenewal: sub.isRenewal || false,
            amount: sub.expectedRaw ? formatAmount(sub.expectedRaw) : sub.amount,
            paymentDeadline: sub.paymentDeadline,
            checkingDelayed: !!sub.lastPaymentError,
        });
    } catch (error) {
        res.status(500).json({ error: '服务器内部错误' });
    }
});

module.exports = router;
