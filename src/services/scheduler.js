const schedule = require('node-schedule');
const config = require('../config');
const Subscription = require('../models/subscription');
const { sendReminder, notifyAndRemove } = require('./membership');
const Member = require('../models/member');
const { normalizeUsername, acquireMemberLock, releaseMemberLock } = require('./payments');

function startScheduler() {
    console.log(`定时任务已启动, cron: ${config.schedule.cron}`);

    let checking = false;
    schedule.scheduleJob('* * * * *', async () => {
        if (checking) return;
        checking = true;
        try { await handleExpired(); } catch (error) {
            console.error('Expiry check failed:', error.message);
        } finally { checking = false; }
    });
    schedule.scheduleJob(config.schedule.cron, () => {
        handleReminders().catch(error => console.error('Reminder check failed:', error.message));
    });
}

/**
 * 自动清退: 到期的 active 订阅 -> 踢出群 + 标记 expired
 */
async function handleExpired() {
    const now = new Date();
    const expired = Subscription.findExpiredActive(now);

    let kicked = 0;
    let skipped = 0;

    for (const sub of expired) {
        const username = normalizeUsername(sub.telegramUsername);
        const owner = await acquireMemberLock(username);
        if (!owner) continue;
        try {
            const member = Member.findLockedByOwner(username, owner, new Date());
            if (!member) continue;
            if (member.expiresAt > now) {
                // 已被续期的旧订阅不能导致会员被移出群组。
                Subscription.markExpiredIfDue(sub._id, now);
                continue;
            }
            const userId = member.telegramUserId || sub.telegramUserId;
            if (userId) {
                const otherMembership = Member.hasValidMembershipForTelegramUser(userId, now);
                if (otherMembership) {
                    Subscription.markExpiredIfDue(sub._id, now);
                    continue;
                }
                const result = await notifyAndRemove(userId);
                if (result === false) continue;
                if (result === 'skipped') skipped++;
                else kicked++;
            } else {
                console.warn(`Expired member ${username} has no Telegram ID`);
            }
            Subscription.expireAllDueForUsername(username, now);
        } finally {
            await releaseMemberLock(username, owner);
        }
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

    const toRemind = Subscription.findReminders(now, remindDeadline);

    for (const sub of toRemind) {
        if (sub.telegramUserId) {
            console.log(`发送到期提醒: ${sub.telegramUsername}`);
            const sent = await sendReminder(sub.telegramUserId, sub.expiresAt);
            if (sent) {
                Subscription.markReminded(sub._id, new Date());
            }
        } else {
            console.warn(`⚠️ [警告] 用户 ${sub.telegramUsername} (订单 ${sub._id}) telegramUserId 为空，无法发送到期提醒，请人工排查`);
        }
    }

    if (toRemind.length > 0) {
        console.log(`已发送 ${toRemind.length} 条到期提醒`);
    }
}

module.exports = { startScheduler, handleExpired };
