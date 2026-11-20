const { getDB } = require('../services/db');

const DATE_FIELDS = new Set(['expiresAt', 'lockUntil', 'createdAt', 'updatedAt']);

function hydrate(row) {
    if (!row) return null;
    const member = {};
    for (const [key, value] of Object.entries(row)) {
        const field = key === 'id' ? '_id' : key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        member[field] = DATE_FIELDS.has(field) && value !== null ? new Date(value) : value;
    }
    return member;
}

function findById(id) {
    return hydrate(getDB().prepare('SELECT * FROM members WHERE id = ?').get(id));
}

function findLatestByTelegramUserId(telegramUserId) {
    return hydrate(getDB().prepare(`
        SELECT * FROM members WHERE telegram_user_id = ? ORDER BY expires_at DESC LIMIT 1
    `).get(telegramUserId));
}

function ensure(username, legacyOrder) {
    const now = Date.now();
    getDB().prepare(`
        INSERT INTO members (
            id, telegram_user_id, expires_at, latest_order_id, lock_owner, lock_until, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, 0, ?, ?)
        ON CONFLICT(id) DO NOTHING
    `).run(
        username, legacyOrder?.telegramUserId ?? null, legacyOrder?.expiresAt?.getTime() ?? null,
        legacyOrder?._id ?? null, now, now
    );
    return findById(username);
}

function acquireLock(username, owner, now, lockUntil) {
    return getDB().prepare(`
        UPDATE members SET lock_owner = ?, lock_until = ?, updated_at = ?
        WHERE id = ? AND lock_until <= ?
    `).run(owner, lockUntil.getTime(), now.getTime(), username, now.getTime()).changes === 1;
}

function findLockedByOwner(username, owner, now) {
    return hydrate(getDB().prepare(`
        SELECT * FROM members WHERE id = ? AND lock_owner = ? AND lock_until > ?
    `).get(username, owner, now.getTime()));
}

function releaseLock(username, owner, now) {
    return getDB().prepare(`
        UPDATE members SET lock_owner = NULL, lock_until = 0, updated_at = ?
        WHERE id = ? AND lock_owner = ?
    `).run(now.getTime(), username, owner).changes;
}

function updateAfterPayment(username, owner, expiresAt, latestOrderId, telegramUserId, now) {
    return getDB().prepare(`
        UPDATE members SET expires_at = ?, latest_order_id = ?, telegram_user_id = ?, updated_at = ?
        WHERE id = ? AND lock_owner = ?
    `).run(
        expiresAt.getTime(), latestOrderId, telegramUserId, now.getTime(), username, owner
    ).changes;
}

function bindTelegramUser(username, telegramUserId, now) {
    return getDB().prepare(`
        UPDATE members SET telegram_user_id = ?, updated_at = ?
        WHERE id = ? AND (telegram_user_id IS NULL OR telegram_user_id = ?)
    `).run(telegramUserId, now.getTime(), username, telegramUserId).changes;
}

function hasValidMembershipForTelegramUser(telegramUserId, now) {
    return Boolean(getDB().prepare(`
        SELECT 1 FROM members WHERE telegram_user_id = ? AND expires_at > ? LIMIT 1
    `).get(telegramUserId, now.getTime()));
}

module.exports = {
    findById,
    findLatestByTelegramUserId,
    ensure,
    acquireLock,
    findLockedByOwner,
    releaseLock,
    updateAfterPayment,
    bindTelegramUser,
    hasValidMembershipForTelegramUser,
};
