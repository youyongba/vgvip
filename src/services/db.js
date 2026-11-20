const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

const SCHEMA = `
    CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        telegram_username TEXT NOT NULL COLLATE NOCASE,
        telegram_user_id INTEGER,
        tx_hash TEXT,
        amount REAL NOT NULL DEFAULT 0,
        expected_raw TEXT,
        payment_address TEXT,
        token_contract TEXT,
        subscription_days INTEGER,
        access_token_hash TEXT,
        open_order_key TEXT,
        payment_deadline INTEGER,
        reconcile_until INTEGER,
        next_check_at INTEGER,
        last_payment_error TEXT,
        worker_owner TEXT,
        worker_until INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
            'pending', 'reconciling', 'manual_review', 'active', 'expired', 'failed'
        )),
        invite_link TEXT,
        invite_expires_at INTEGER,
        invite_lock_until INTEGER NOT NULL DEFAULT 0,
        invite_lock_owner TEXT,
        paid_at INTEGER,
        expires_at INTEGER,
        reminded INTEGER NOT NULL DEFAULT 0 CHECK (reminded IN (0, 1)),
        is_renewal INTEGER NOT NULL DEFAULT 0 CHECK (is_renewal IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        telegram_user_id INTEGER,
        expires_at INTEGER,
        latest_order_id TEXT REFERENCES subscriptions(id),
        lock_owner TEXT,
        lock_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_tx_hash
        ON subscriptions(tx_hash) WHERE tx_hash IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_payment_amount
        ON subscriptions(payment_address, expected_raw) WHERE expected_raw IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_open_order
        ON subscriptions(open_order_key) WHERE open_order_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_subscriptions_username
        ON subscriptions(telegram_username);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_expires_at
        ON subscriptions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status
        ON subscriptions(status);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_worker
        ON subscriptions(status, next_check_at);
    CREATE INDEX IF NOT EXISTS idx_members_telegram_user
        ON members(telegram_user_id);

    PRAGMA user_version = 1;
`;

function connectDB(databasePath = config.sqlite.path) {
    try {
        closeDB();
        if (databasePath !== ':memory:') {
            fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
        }
        db = new Database(databasePath);
        db.pragma('foreign_keys = ON');
        db.pragma('busy_timeout = 5000');
        db.pragma('synchronous = FULL');
        if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');
        db.exec(SCHEMA);
        console.log('SQLite 数据库连接成功');
        return db;
    } catch (error) {
        closeDB();
        console.error('SQLite 数据库连接失败:', error.message);
        throw error;
    }
}

function getDB() {
    if (!db) throw new Error('SQLite 数据库尚未初始化');
    return db;
}

function closeDB() {
    if (!db) return;
    db.close();
    db = null;
}

function immediateTransaction(callback) {
    return getDB().transaction(callback).immediate();
}

function checkDB() {
    return getDB().prepare('SELECT 1 AS ok').get().ok === 1;
}

module.exports = { connectDB, getDB, closeDB, immediateTransaction, checkDB };
