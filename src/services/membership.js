const bot = require('../bot');
const config = require('../config');

const vipGroupId = config.telegram.vipGroupId;
const PROTECTED_STATUSES = new Set(['creator', 'administrator']);

/**
 * 检查用户是否是群主或管理员，是则不可踢出
 */
async function isGroupAdmin(telegramUserId) {
    try {
        const member = await bot.getChatMember(vipGroupId, telegramUserId);
        return PROTECTED_STATUSES.has(member.status);
    } catch (error) {
        console.error(`获取用户 ${telegramUserId} 群身份失败:`, error.message);
        return false;
    }
}

const INVITE_EXPIRE_MINUTES = 30;

/**
 * 生成一次性邀请链接，限 1 人使用，30 分钟后过期
 */
async function createInviteLink(telegramUsername) {
    const expireDate = Math.floor(Date.now() / 1000) + INVITE_EXPIRE_MINUTES * 60;
    const link = await bot.createChatInviteLink(vipGroupId, {
        member_limit: 1,
        expire_date: expireDate,
        name: `VIP-${telegramUsername}`,
    });
    return link.invite_link;
}

/**
 * 通过 Bot 私信发送邀请链接给用户（备用通道，需用户先 /start Bot）
 */
async function sendInviteMessage(telegramUserId, inviteLink) {
    await bot.sendMessage(telegramUserId,
        `🎉 支付确认成功！\n\n` +
        `点击下方链接加入 VIP 专属群：\n${inviteLink}\n\n` +
        `该链接仅限一次使用，请尽快加入。`
    );
}

/**
 * 将用户踢出 VIP 群（管理员和群主跳过）
 * 返回 'skipped' 表示受保护身份，true 表示成功踢出，false 表示失败
 */
async function removeFromGroup(telegramUserId) {
    if (await isGroupAdmin(telegramUserId)) {
        console.log(`用户 ${telegramUserId} 是管理员/群主，跳过踢出`);
        return 'skipped';
    }

    try {
        await bot.banChatMember(vipGroupId, telegramUserId);
        await bot.unbanChatMember(vipGroupId, telegramUserId, { only_if_banned: true });
        return true;
    } catch (error) {
        console.error(`踢出用户 ${telegramUserId} 失败:`, error.message);
        return false;
    }
}

/**
 * 发送到期提醒私信（管理员/群主也会收到提醒，但不会被踢出）
 */
async function sendReminder(telegramUserId, expiresAt) {
    const dateStr = expiresAt.toLocaleDateString('zh-CN');
    const admin = await isGroupAdmin(telegramUserId);
    const text = admin
        ? `⏰ 会员到期提醒\n\n` +
          `您的 VIP 会员将于 ${dateStr} 到期。\n` +
          `您是群管理员，到期后不会被移出群组，但建议续费以保持订阅记录。`
        : `⏰ 会员到期提醒\n\n` +
          `您的 VIP 会员将于 ${dateStr} 到期。\n` +
          `到期后将被自动移出 VIP 群组。\n\n` +
          `如需续费，请访问订阅页面重新支付。`;
    try {
        await bot.sendMessage(telegramUserId, text);
        return true;
    } catch (error) {
        console.error(`发送提醒给 ${telegramUserId} 失败:`, error.message);
        return false;
    }
}

/**
 * 发送到期通知并踢出（管理员/群主只通知不踢出）
 */
async function notifyAndRemove(telegramUserId) {
    const admin = await isGroupAdmin(telegramUserId);

    const text = admin
        ? `📢 会员已到期\n\n` +
          `您的 VIP 订阅已到期。\n` +
          `您是群管理员，不会被移出群组，但建议续费。`
        : `📢 会员已到期\n\n` +
          `您的 VIP 会员已到期，已被移出 VIP 群组。\n` +
          `如需继续享受权益，请重新订阅。`;

    try {
        await bot.sendMessage(telegramUserId, text);
    } catch (error) {
        console.error(`发送到期通知给 ${telegramUserId} 失败:`, error.message);
    }

    if (admin) {
        console.log(`用户 ${telegramUserId} 是管理员/群主，跳过踢出`);
        return 'skipped';
    }

    return removeFromGroup(telegramUserId);
}

module.exports = { isGroupAdmin, createInviteLink, sendInviteMessage, removeFromGroup, sendReminder, notifyAndRemove };
