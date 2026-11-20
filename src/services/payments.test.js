const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { connectDB, closeDB, getDB } = require('./db');
const Subscription = require('../models/subscription');
const Member = require('../models/member');

const config = {
    tron: { apiUrl: 'https://api.example.invalid', merchantAddress: 'merchant', usdtContract: 'usdt' },
    schedule: { subscriptionAmount: 50, subscriptionDays: 30 },
    payment: { windowMs: 900000, reconciliationMs: 86400000, checkIntervalMs: 30000, lockMs: 120000 },
};

function loadService(name, overrides = {}) {
    const context = {
        module: { exports: {} }, console, Date, Number, Math, BigInt, Set, Buffer, URL, URLSearchParams,
        setTimeout, clearTimeout, setInterval, require(id) {
            if (Object.hasOwn(overrides, id)) return overrides[id];
            if (id === '../config') return config;
            if (id === '../models/subscription') return Subscription;
            if (id === '../models/member') return Member;
            if (id === './tron') return { findPayment: async () => null };
            return require(id);
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, name + '.js'), 'utf8'), context);
    return context.module.exports;
}

const payments = loadService('payments');
const tron = loadService('tron');
const now = Date.now();
const orderFixture = () => ({
    expectedRaw: '50000123', paymentAddress: 'merchant', tokenContract: 'usdt',
    createdAt: new Date(now), paymentDeadline: new Date(now + 900000),
});
const txFixture = () => ({
    type: 'Transfer', to: 'merchant', value: '50000123', transaction_id: 'a'.repeat(64),
    token_info: { address: 'usdt', decimals: 6 }, block_timestamp: now + 1,
});

test('exact six-decimal amount and normalized Telegram identity', () => {
    assert.equal(payments.formatAmount('50000123'), '50.000123');
    assert.equal(payments.normalizeUsername(' @Test_User '), '@test_user');
    for (const invalid of [null, {}, 'abc', '@@@@@', 'bad.*name']) {
        assert.throws(() => payments.normalizeUsername(invalid));
    }
    assert.equal(payments.renewalExpiry(new Date(now + 86400000), new Date(now), 30).getTime(), now + 31 * 86400000);
});

test('strict amount, contract, recipient, hash, and time matching', () => {
    const order = orderFixture();
    assert(tron.matchesPayment(txFixture(), order));
    for (const change of [
        { value: '50000000' }, { value: '50000124' }, { to: 'wrong' }, { type: 'Approval' },
        { token_info: { address: 'fake-usdt', decimals: 6 } }, { transaction_id: '' },
        { block_timestamp: now - 1 }, { block_timestamp: now + 900001 },
    ]) assert.equal(tron.matchesPayment({ ...txFixture(), ...change }, order), false);
});

test('pagination finds transactions beyond first page', async () => {
    let calls = 0;
    const payment = await tron.findPayment(orderFixture(), {
        fetchPage: async url => {
            calls++;
            assert.equal(url.searchParams.get('only_confirmed'), 'true');
            if (calls === 1) return { success: true, data: [], meta: { fingerprint: 'next' } };
            assert.equal(url.searchParams.get('fingerprint'), 'next');
            return { success: true, data: [txFixture()] };
        },
    });
    assert.equal(calls, 2);
    assert.equal(payment.txHash, 'a'.repeat(64));
});

test('upstream errors and broken pagination never mean unpaid', async () => {
    await assert.rejects(tron.findPayment(orderFixture(), { fetchPage: async () => { throw Error('HTTP 429'); } }), /429/);
    await assert.rejects(tron.findPayment(orderFixture(), { fetchPage: async () => ({ success: false }) }), /Invalid/);
    await assert.rejects(tron.findPayment(orderFixture(), {
        fetchPage: async () => ({ success: true, data: [], meta: { fingerprint: 'loop' } }),
    }), /Repeated/);
    await assert.rejects(tron.findPayment({}), /Legacy/);
});

test('checkOrder retains payment state on outage and schedules a retry', async () => {
    const updates = [];
    const service = loadService('payments', {
        './tron': { findPayment: async () => { throw Error('unavailable'); } },
        '../models/subscription': { recordPaymentError: (...args) => { updates.push(args); } },
    });
    await service.checkOrder({ _id: 'order' });
    assert.equal(updates[0][1], 'unavailable');
    assert(updates[0][2] > new Date());
});

test('unconfirmed deadline transitions to reconciliation, not failed', async () => {
    const updates = [];
    const service = loadService('payments', {
        '../models/subscription': { recordPaymentCheck: (...args) => updates.push(args) },
    });
    await service.checkOrder({
        _id: 'order', paymentDeadline: new Date(now - 1), reconcileUntil: new Date(now + 86400000),
    });
    assert.equal(updates[0][1], 'reconciling');
});

test('normal application import no longer breaks invitation generation', () => {
    const output = execFileSync(process.execPath, ['-e', `
        const Module = require('node:module');
        const { EventEmitter } = require('node:events');
        const original = Module._load;
        class FakeBot extends EventEmitter {
            setWebHook() { return Promise.resolve(); }
            createChatInviteLink() { return Promise.resolve({ invite_link: 'test-link' }); }
        }
        Module._load = function(id, parent, main) {
            if (id === 'node-telegram-bot-api') return FakeBot;
            if (id === '../services/ai') return { chat: async () => '' };
            if (id === '../config') return { telegram: { botToken: 'test', vipGroupId: 'test' }, schedule: {}, tron: {}, payment: {} };
            return original.call(this, id, parent, main);
        };
        require('./src/app');
        require('./src/services/membership').createInviteLink('@tester').then(link => {
            if (link !== 'test-link') process.exitCode = 1;
            else console.log('INVITE_PASS');
        }).catch(() => { process.exitCode = 1; });
    `], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
    assert.match(output, /INVITE_PASS/);
});

test('QR CDN failure still creates an order and displays its exact amount', async () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../views/pages/vip.ejs'), 'utf8');
    const script = source.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
    const events = new Map();
    const element = id => ({
        style: {}, classList: { add() {}, remove() {} }, value: '', textContent: '',
        addEventListener(name, handler) { events.set(id + ':' + name, handler); },
        setAttribute() {},
    });
    const elements = new Map();
    vm.runInNewContext(script, {
        document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); } },
        localStorage: { getItem() { return null; }, setItem() {} }, console,
        setInterval() { return 1; }, clearInterval() {},
        fetch: async () => ({ json: async () => ({ status: 'pending', orderId: 'a'.repeat(24),
            orderToken: 'token', amount: '50.000123', paymentAddress: 'merchant',
            paymentDeadline: new Date(now + 900000).toISOString() }) }),
    });
    assert(events.has('subscribeBtn:click'));
    assert(events.has('queryBtn:click'));
    elements.get('tgInput').value = '@test_user';
    events.get('subscribeBtn:click')();
    await new Promise(setImmediate);
    assert.equal(elements.get('orderAmount').textContent, '50.000123');
    assert.equal(elements.get('qrcode').textContent, '二维码不可用，请复制地址');
    assert.equal(elements.get('paymentAddress').style.display, 'block');
    assert.equal(elements.get('subscribeBtn').textContent, '等待到账确认');
});

test('expired invitation is regenerated and expiry is persisted', async () => {
    const updates = [];
    const service = loadService('membership', {
        '../config': { telegram: { vipGroupId: 'group' } },
        '../bot': { createChatInviteLink: async () => ({ invite_link: 'fresh-link' }) },
        '../models/subscription': {
            findById: () => ({ status: 'active', expiresAt: new Date(now + 86400000),
                inviteLink: 'old-link', inviteExpiresAt: new Date(now - 1), telegramUsername: '@tester' }),
            acquireInviteLock: () => true,
            saveInviteLink: (...args) => { updates.push(args); return 1; },
            releaseInviteLock: (...args) => { updates.push(args); },
        },
    });
    assert.equal(await service.ensureInviteLink('order'), 'fresh-link');
    assert(updates[0][3] > new Date());
    assert.equal(updates[1][0], 'order');
});

test('explicit invitation refresh replaces a possibly already-used link', async () => {
    const service = loadService('membership', {
        '../config': { telegram: { vipGroupId: 'group' } },
        '../bot': { createChatInviteLink: async () => ({ invite_link: 'replacement-link' }) },
        '../models/subscription': {
            findById: () => ({ status: 'active', expiresAt: new Date(now + 86400000),
                inviteLink: 'used-link', inviteExpiresAt: new Date(now + 1800000), telegramUsername: '@tester' }),
            acquireInviteLock: () => true,
            saveInviteLink: () => 1,
            releaseInviteLock: () => {},
        },
    });
    assert.equal(await service.ensureInviteLink('order', { refresh: true }), 'replacement-link');
});

test('order invitation endpoint rejects requests without the private order token', async () => {
    const routes = new Map();
    const api = loadService('../routes/api', {
        express: { Router: () => ({ get(route, handler) { routes.set(route, handler); }, post() {} }) },
        '../services/payments': payments,
        '../services/membership': { ensureInviteLink: async () => { throw Error('must not be reached'); } },
        '../models/subscription': { findById: () => ({ accessTokenHash: 'a'.repeat(64) }) },
    });
    assert(api);
    let status = 200;
    const response = { status(code) { status = code; return this; }, json() {} };
    await routes.get('/api/order/:id')({ params: { id: 'a'.repeat(24) }, get() { return undefined; } }, response);
    assert.equal(status, 403);
});

test('obsolete expired order does not kick a renewed member', async () => {
    let kicks = 0;
    let cleaned = 0;
    const scheduler = loadService('scheduler', {
        '../models/subscription': {
            findExpiredActive: () => [{ _id: 'old', telegramUsername: '@tester' }],
            markExpiredIfDue: () => { cleaned++; },
        },
        '../models/member': { findLockedByOwner: () => ({ expiresAt: new Date(now + 86400000) }) },
        './payments': {
            normalizeUsername: payments.normalizeUsername,
            acquireMemberLock: async () => 'lock',
            releaseMemberLock: async () => {},
        },
        './membership': { notifyAndRemove: async () => { kicks++; }, sendReminder: async () => true },
    });
    await scheduler.handleExpired();
    assert.equal(kicks, 0);
    assert.equal(cleaned, 1);
});

test('SQLite payment transactions', async t => {
    connectDB(':memory:');
    const count = (sql, ...params) => getDB().prepare(sql).get(...params).count;
    try {
        const paymentFor = (order, hash) => ({
            txHash: hash.repeat(64), amount: order.amount, timestamp: order.createdAt.getTime() + 1,
        });
        await t.test('parallel order creation returns exactly one payable order', async () => {
            const results = await Promise.allSettled(Array.from({ length: 12 }, () => payments.createOrder('@tester')));
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(count("SELECT COUNT(*) AS count FROM subscriptions WHERE open_order_key = '@tester'"), 1);
            const result = results.find(r => r.status === 'fulfilled').value;
            const resumed = await payments.createOrder('@tester', result.token);
            assert.equal(resumed.order._id, result.order._id);
            assert(payments.ownsOrder(result.order, result.token));
            assert.equal(payments.ownsOrder(result.order, 'wrong'), false);
            await payments.activatePayment(result.order._id, paymentFor(result.order, '1'));
            assert.equal(await payments.activatePayment(result.order._id, paymentFor(result.order, '2')), false);
            assert.equal(Subscription.findById(result.order._id).txHash, '1'.repeat(64));
        });
        await t.test('worker lease allows only one processor to claim an order', async () => {
            const result = await payments.createOrder('@worker_user');
            const now = new Date();
            const claimed = Subscription.claimNextWorker(now, 'worker-1', new Date(now.getTime() + 60000));
            assert.equal(claimed._id, result.order._id);
            assert.equal(Subscription.claimNextWorker(now, 'worker-2', new Date(now.getTime() + 60000)), null);
            Subscription.releaseWorker(result.order._id, 'worker-1', new Date());
            const reclaimed = Subscription.claimNextWorker(new Date(), 'worker-2', new Date(Date.now() + 60000));
            assert.equal(reclaimed._id, result.order._id);
            Subscription.releaseWorker(result.order._id, 'worker-2', new Date());
        });
        await t.test('two renewals add full 60 days, with a single active row', async () => {
            const before = Member.findById('@tester').expiresAt.getTime();
            const first = await payments.createOrder('@tester');
            getDB().prepare("UPDATE subscriptions SET status = 'reconciling', open_order_key = NULL WHERE id = ?")
                .run(first.order._id);
            const second = await payments.createOrder('@tester');
            assert.notEqual(first.order.expectedRaw, second.order.expectedRaw);
            const results = await Promise.allSettled([
                payments.activatePayment(first.order._id, paymentFor(first.order, '3')),
                payments.activatePayment(second.order._id, paymentFor(second.order, '4')),
            ]);
            for (let i = 0; i < results.length; i++) {
                if (results[i].status === 'rejected') {
                    const row = [first, second][i].order;
                    await payments.activatePayment(row._id, paymentFor(row, i === 0 ? '3' : '4'));
                }
            }
            assert.equal(Member.findById('@tester').expiresAt.getTime(), before + 60 * 86400000);
            assert.equal(count("SELECT COUNT(*) AS count FROM subscriptions WHERE telegram_username = '@tester' AND status = 'active'"), 1);
        });
        await t.test('amount reservations survive payment and immutable fields have no update API', async () => {
            const paid = Subscription.findLatestActiveByUsername('@tester');
            assert.throws(() => Subscription.create({
                telegramUsername: '@amount_collision', paymentAddress: paid.paymentAddress, expectedRaw: paid.expectedRaw,
            }), error => error.code?.startsWith('SQLITE_CONSTRAINT_'));
            assert.equal(Subscription.updateOne, undefined);
            const unchanged = Subscription.findById(paid._id);
            assert.equal(unchanged.expectedRaw, paid.expectedRaw);
            assert.equal(unchanged.subscriptionDays, 30);
        });
        await t.test('duplicate receipt rolls back membership and order together', async () => {
            const result = await payments.createOrder('@other_user');
            await assert.rejects(payments.activatePayment(result.order._id, paymentFor(result.order, '1')));
            assert.equal(Member.findById('@other_user').expiresAt, null);
            assert.equal(Subscription.findById(result.order._id).status, 'pending');
            assert.equal(count("SELECT COUNT(*) AS count FROM subscriptions WHERE telegram_username = '@tester' AND status = 'active'"), 1);
        });
        await t.test('two processors cannot overwrite the receipt of the same order', async () => {
            const result = await payments.createOrder('@same_order');
            await Promise.allSettled([
                payments.activatePayment(result.order._id, paymentFor(result.order, '6')),
                payments.activatePayment(result.order._id, paymentFor(result.order, '7')),
            ]);
            const paid = Subscription.findById(result.order._id);
            assert.equal(paid.status, 'active');
            const txHash = paid.txHash;
            assert.equal(await payments.activatePayment(result.order._id, paymentFor(result.order, '8')), false);
            assert.equal(Subscription.findById(result.order._id).txHash, txHash);
        });
        await t.test('expiry lock defers renewal without losing the receipt', async () => {
            const result = await payments.createOrder('@lock_user');
            const owner = await payments.acquireMemberLock('@lock_user');
            await assert.rejects(payments.activatePayment(result.order._id, paymentFor(result.order, '5')), /busy/);
            assert.equal(Subscription.findById(result.order._id).txHash, null);
            await payments.releaseMemberLock('@lock_user', owner);
            assert.equal(await payments.activatePayment(result.order._id, paymentFor(result.order, '5')), true);
        });
        await t.test('unpaid orders progress from reconciliation to manual review', async () => {
            const result = await payments.createOrder('@transition_user');
            getDB().prepare('UPDATE subscriptions SET payment_deadline = ? WHERE id = ?')
                .run(Date.now() - 1, result.order._id);
            await payments.checkOrder(Subscription.findById(result.order._id));
            assert.equal(Subscription.findById(result.order._id).status, 'reconciling');
            assert.equal(Subscription.findById(result.order._id).openOrderKey, null);
            getDB().prepare('UPDATE subscriptions SET reconcile_until = ? WHERE id = ?')
                .run(Date.now() - 1, result.order._id);
            await payments.checkOrder(Subscription.findById(result.order._id));
            assert.equal(Subscription.findById(result.order._id).status, 'manual_review');
        });
    } finally {
        closeDB();
    }
});
