const schedule = require('node-schedule');
const config = require('../config');
const Subscription = require('../models/subscription');
const { sendReminder, notifyAndRemove } = require('./membership');

function startScheduler() {
    console.log(`定时任务已启动, cron: ${config.schedule.cron}`);

    schedule.scheduleJob(config.schedule.cron, async () => {
        console.log(`[${new Date().toISOString()}] 执行定时检查...`);
        await handleExpired();
        await handleReminders();
        await handleTimedOutOrders();
    });
}

/**
 * 自动清退: 到期的 active 订阅 -> 踢出群 + 标记 expired
 */
async function handleExpired() {
    const now = new Date();
    const expired = await Subscription.find({
        status: 'active',
        expiresAt: { $lte: now },
    });

    let kicked = 0;
    let skipped = 0;

    for (const sub of expired) {
        console.log(`会员到期: ${sub.telegramUsername} (${sub.telegramUserId})`);
        if (sub.telegramUserId) {
            const result = await notifyAndRemove(sub.telegramUserId);
            if (result === 'skipped') {
                // 管理员/群主：订阅标记过期但不踢出
                console.log(`管理员/群主 ${sub.telegramUsername} 跳过踢出，仅标记过期`);
                skipped++;
            } else {
                kicked++;
            }
        }
        sub.status = 'expired';
        await sub.save();
    }

    if (expired.length > 0) {
        console.log(`到期处理完成: 共 ${expired.length} 人, 踢出 ${kicked} 人, 跳过管理员 ${skipped} 人`);
    }
}

/**
 * 到期提醒: expiresAt 在 remindBeforeDays 天内且未提醒过
 */
async function handleReminders() {
    const now = new Date();
    const remindDeadline = new Date(now.getTime() + config.schedule.remindBeforeDays * 24 * 60 * 60 * 1000);

    const toRemind = await Subscription.find({
        status: 'active',
        reminded: false,
        expiresAt: { $gt: now, $lte: remindDeadline },
    });

    for (const sub of toRemind) {
        if (sub.telegramUserId) {
            console.log(`发送到期提醒: ${sub.telegramUsername}`);
            const sent = await sendReminder(sub.telegramUserId, sub.expiresAt);
            if (sent) {
                sub.reminded = true;
                await sub.save();
            }
        }
    }

    if (toRemind.length > 0) {
        console.log(`已发送 ${toRemind.length} 条到期提醒`);
    }
}

/**
 * 订单超时: pending 状态超过 30 分钟 -> 标记 failed
 */
async function handleTimedOutOrders() {
    const timeout = new Date(Date.now() - 30 * 60 * 1000);
    const result = await Subscription.updateMany(
        { status: 'pending', createdAt: { $lte: timeout } },
        { $set: { status: 'failed' } }
    );

    if (result.modifiedCount > 0) {
        console.log(`已标记 ${result.modifiedCount} 个超时订单为 failed`);
    }
}

module.exports = { startScheduler };
