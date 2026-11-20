const { randomBytes } = require('node:crypto');
const { getDB, immediateTransaction } = require('../services/db');

const PAYABLE = ['pending', 'reconciling'];
const DATE_FIELDS = new Set([
    'paymentDeadline', 'reconcileUntil', 'nextCheckAt', 'workerUntil',
    'inviteExpiresAt', 'inviteLockUntil', 'paidAt', 'expiresAt', 'createdAt', 'updatedAt',
]);
const BOOLEAN_FIELDS = new Set(['reminded', 'isRenewal']);

function hydrate(row) {
    if (!row) return null;
    const order = {};
    for (const [key, value] of Object.entries(row)) {
        const field = key === 'id' ? '_id' : key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        if (DATE_FIELDS.has(field)) order[field] = value === null ? null : new Date(value);
        else if (BOOLEAN_FIELDS.has(field)) order[field] = Boolean(value);
        else order[field] = value;
    }
    return order;
}

function findById(id) {
    return hydrate(getDB().prepare('SELECT * FROM subscriptions WHERE id = ?').get(id));
}

function create(data) {
    const now = Date.now();
    const id = randomBytes(12).toString('hex');
    getDB().prepare(`
        INSERT INTO subscriptions (
            id, telegram_username, telegram_user_id, tx_hash, amount, expected_raw,
            payment_address, token_contract, subscription_days, access_token_hash,
            open_order_key, payment_deadline, reconcile_until, next_check_at,
            last_payment_error, worker_owner, worker_until, status, invite_link,
            invite_expires_at, invite_lock_until, invite_lock_owner, paid_at, expires_at,
            reminded, is_renewal, created_at, updated_at
        ) VALUES (
            @id, @telegramUsername, @telegramUserId, @txHash, @amount, @expectedRaw,
            @paymentAddress, @tokenContract, @subscriptionDays, @accessTokenHash,
            @openOrderKey, @paymentDeadline, @reconcileUntil, @nextCheckAt,
            @lastPaymentError, @workerOwner, @workerUntil, @status, @inviteLink,
            @inviteExpiresAt, @inviteLockUntil, @inviteLockOwner, @paidAt, @expiresAt,
            @reminded, @isRenewal, @createdAt, @updatedAt
        )
    `).run({
        id,
        telegramUsername: data.telegramUsername,
        telegramUserId: data.telegramUserId ?? null,
        txHash: data.txHash ?? null,
        amount: data.amount ?? 0,
        expectedRaw: data.expectedRaw ?? null,
        paymentAddress: data.paymentAddress ?? null,
        tokenContract: data.tokenContract ?? null,
        subscriptionDays: data.subscriptionDays ?? null,
        accessTokenHash: data.accessTokenHash ?? null,
        openOrderKey: data.openOrderKey ?? null,
        paymentDeadline: data.paymentDeadline?.getTime() ?? null,
        reconcileUntil: data.reconcileUntil?.getTime() ?? null,
        nextCheckAt: data.nextCheckAt?.getTime() ?? null,
        lastPaymentError: data.lastPaymentError ?? null,
        workerOwner: null,
        workerUntil: 0,
        status: data.status || 'pending',
        inviteLink: null,
        inviteExpiresAt: null,
        inviteLockUntil: 0,
        inviteLockOwner: null,
        paidAt: null,
        expiresAt: null,
        reminded: 0,
        isRenewal: 0,
        createdAt: now,
        updatedAt: now,
    });
    return findById(id);
}

function findByOpenOrderKey(openOrderKey) {
    return hydrate(getDB().prepare('SELECT * FROM subscriptions WHERE open_order_key = ?').get(openOrderKey));
}

function findByUsername(username) {
    return getDB().prepare(`
        SELECT * FROM subscriptions WHERE telegram_username = ? COLLATE NOCASE ORDER BY created_at DESC
    `).all(username).map(hydrate);
}

function findLatestActiveByUsername(username) {
    return hydrate(getDB().prepare(`
        SELECT * FROM subscriptions
        WHERE telegram_username = ? COLLATE NOCASE AND status = 'active'
        ORDER BY expires_at DESC LIMIT 1
    `).get(username));
}

function findLatestValidByUsername(username, now) {
    return hydrate(getDB().prepare(`
        SELECT * FROM subscriptions
        WHERE telegram_username = ? COLLATE NOCASE AND status = 'active' AND expires_at > ?
        ORDER BY expires_at DESC LIMIT 1
    `).get(username, now.getTime()));
}

function findValidForJoin(userId, username, now) {
    return hydrate(getDB().prepare(`
        SELECT * FROM subscriptions
        WHERE status = 'active' AND expires_at > ? AND (
            telegram_user_id = ? OR (
                ? IS NOT NULL AND telegram_username = ? COLLATE NOCASE AND telegram_user_id IS NULL
            )
        ) LIMIT 1
    `).get(now.getTime(), userId, username, username));
}

function findUnresolvedByUsername(username) {
    return hydrate(getDB().prepare(`
        SELECT * FROM subscriptions
        WHERE telegram_username = ? COLLATE NOCASE
            AND status IN ('pending', 'reconciling', 'manual_review')
        ORDER BY created_at DESC LIMIT 1
    `).get(username));
}

function findPayableById(id) {
    return hydrate(getDB().prepare(`
        SELECT * FROM subscriptions WHERE id = ? AND status IN ('pending', 'reconciling')
    `).get(id));
}

function markExpiredPendingOpenOrders(username, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET status = 'reconciling', open_order_key = NULL, updated_at = ?
        WHERE open_order_key = ? AND status = 'pending' AND payment_deadline <= ?
    `).run(now.getTime(), username, now.getTime()).changes;
}

function expireOtherActive(username, exceptId, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET status = 'expired', updated_at = ?
        WHERE telegram_username = ? COLLATE NOCASE AND status = 'active' AND id != ?
    `).run(now.getTime(), username, exceptId).changes;
}

function activateOrder(orderId, payment, expiresAt, isRenewal, telegramUserId, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET
            status = 'active', tx_hash = ?, amount = ?, paid_at = ?, expires_at = ?,
            is_renewal = ?, telegram_user_id = ?, last_payment_error = NULL,
            open_order_key = NULL, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'reconciling') AND tx_hash IS NULL
    `).run(
        payment.txHash, payment.amount, payment.timestamp, expiresAt.getTime(),
        isRenewal ? 1 : 0, telegramUserId, now.getTime(), orderId
    ).changes;
}

function recordPaymentCheck(orderId, status, nextCheckAt, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET status = ?, last_payment_error = NULL, next_check_at = ?,
            open_order_key = CASE WHEN ? = 'pending' THEN open_order_key ELSE NULL END,
            updated_at = ?
        WHERE id = ? AND status IN ('pending', 'reconciling')
    `).run(status, nextCheckAt.getTime(), status, now.getTime(), orderId).changes;
}

function recordPaymentError(orderId, message, nextCheckAt, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET last_payment_error = ?, next_check_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending', 'reconciling')
    `).run(message, nextCheckAt.getTime(), now.getTime(), orderId).changes;
}

function claimNextWorker(now, owner, workerUntil) {
    return immediateTransaction(() => {
        const row = getDB().prepare(`
            SELECT id FROM subscriptions
            WHERE status IN ('pending', 'reconciling') AND expected_raw IS NOT NULL
                AND next_check_at IS NOT NULL AND next_check_at <= ? AND worker_until <= ?
            ORDER BY next_check_at ASC LIMIT 1
        `).get(now.getTime(), now.getTime());
        if (!row) return null;
        const changed = getDB().prepare(`
            UPDATE subscriptions SET worker_owner = ?, worker_until = ?, updated_at = ?
            WHERE id = ? AND status IN ('pending', 'reconciling') AND expected_raw IS NOT NULL
                AND next_check_at <= ? AND worker_until <= ?
        `).run(
            owner, workerUntil.getTime(), now.getTime(), row.id, now.getTime(), now.getTime()
        ).changes;
        return changed === 1 ? findById(row.id) : null;
    });
}

function releaseWorker(orderId, owner, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET worker_owner = NULL, worker_until = 0, updated_at = ?
        WHERE id = ? AND worker_owner = ?
    `).run(now.getTime(), orderId, owner).changes;
}

function acquireInviteLock(orderId, owner, now, lockUntil) {
    return getDB().prepare(`
        UPDATE subscriptions SET invite_lock_owner = ?, invite_lock_until = ?, updated_at = ?
        WHERE id = ? AND status = 'active' AND invite_lock_until <= ?
    `).run(owner, lockUntil.getTime(), now.getTime(), orderId, now.getTime()).changes === 1;
}

function saveInviteLink(orderId, owner, inviteLink, inviteExpiresAt, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET invite_link = ?, invite_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'active' AND invite_lock_owner = ?
    `).run(inviteLink, inviteExpiresAt.getTime(), now.getTime(), orderId, owner).changes;
}

function releaseInviteLock(orderId, owner, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET invite_lock_owner = NULL, invite_lock_until = 0, updated_at = ?
        WHERE id = ? AND invite_lock_owner = ?
    `).run(now.getTime(), orderId, owner).changes;
}

function bindTelegramUserByUsername(username, telegramUserId, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET telegram_user_id = ?, updated_at = ?
        WHERE telegram_username = ? COLLATE NOCASE AND telegram_user_id IS NULL
    `).run(telegramUserId, now.getTime(), username).changes;
}

function findExpiredActive(now) {
    return getDB().prepare(`
        SELECT * FROM subscriptions WHERE status = 'active' AND expires_at <= ? ORDER BY created_at ASC
    `).all(now.getTime()).map(hydrate);
}

function markExpiredIfDue(orderId, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET status = 'expired', updated_at = ?
        WHERE id = ? AND status = 'active' AND expires_at <= ?
    `).run(now.getTime(), orderId, now.getTime()).changes;
}

function expireAllDueForUsername(username, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET status = 'expired', updated_at = ?
        WHERE telegram_username = ? COLLATE NOCASE AND status = 'active' AND expires_at <= ?
    `).run(now.getTime(), username, now.getTime()).changes;
}

function findReminders(now, deadline) {
    return getDB().prepare(`
        SELECT * FROM subscriptions
        WHERE status = 'active' AND reminded = 0 AND expires_at > ? AND expires_at <= ?
        ORDER BY expires_at ASC
    `).all(now.getTime(), deadline.getTime()).map(hydrate);
}

function markReminded(orderId, now) {
    return getDB().prepare(`
        UPDATE subscriptions SET reminded = 1, updated_at = ? WHERE id = ? AND reminded = 0
    `).run(now.getTime(), orderId).changes;
}

module.exports = {
    PAYABLE,
    create,
    findById,
    findByOpenOrderKey,
    findByUsername,
    findLatestActiveByUsername,
    findLatestValidByUsername,
    findValidForJoin,
    findUnresolvedByUsername,
    findPayableById,
    markExpiredPendingOpenOrders,
    expireOtherActive,
    activateOrder,
    recordPaymentCheck,
    recordPaymentError,
    claimNextWorker,
    releaseWorker,
    acquireInviteLock,
    saveInviteLink,
    releaseInviteLock,
    bindTelegramUserByUsername,
    findExpiredActive,
    markExpiredIfDue,
    expireAllDueForUsername,
    findReminders,
    markReminded,
};
