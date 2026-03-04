const config = require('../config');
const Subscription = require('../models/subscription');

const USDT_DECIMALS = 6;

/**
 * 查询收款地址的 TRC20 USDT 入账记录
 * 返回 sinceTimestamp 之后、金额 >= minAmount 且未被其他订单占用的第一笔匹配交易
 */
async function findPayment(sinceTimestamp, minAmount) {
    const url = `${config.tron.apiUrl}/v1/accounts/${config.tron.merchantAddress}/transactions/trc20`
        + `?only_to=true`
        + `&only_confirmed=true`
        + `&contract_address=${config.tron.usdtContract}`
        + `&min_timestamp=${sinceTimestamp}`
        + `&limit=50`
        + `&order_by=block_timestamp,desc`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`TronGrid API 错误: ${res.status}`);
    }

    const json = await res.json();
    const txList = json.data || [];

    const minRaw = BigInt(Math.round(minAmount * (10 ** USDT_DECIMALS)));

    // 查询已被其他订单使用的 txHash，避免一笔交易匹配多个订单
    const usedHashes = new Set(
        (await Subscription.find(
            { txHash: { $ne: null } },
            { txHash: 1 }
        )).map(s => s.txHash)
    );

    for (const tx of txList) {
        const toAddr = tx.to;
        const value = BigInt(tx.value || '0');
        if (
            toAddr === config.tron.merchantAddress &&
            value >= minRaw &&
            !usedHashes.has(tx.transaction_id)
        ) {
            return {
                txHash: tx.transaction_id,
                amount: Number(value) / (10 ** USDT_DECIMALS),
                timestamp: tx.block_timestamp,
            };
        }
    }

    return null;
}

/**
 * 轮询到账，每 interval 毫秒查一次，最多 maxDuration 毫秒
 */
function pollPayment(sinceTimestamp, minAmount, { interval = 30000, maxDuration = 15 * 60 * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();

        async function check() {
            try {
                const result = await findPayment(sinceTimestamp, minAmount);
                if (result) {
                    return resolve(result);
                }
                if (Date.now() - startTime >= maxDuration) {
                    return resolve(null);
                }
                setTimeout(check, interval);
            } catch (err) {
                console.error('轮询到账出错:', err.message);
                if (Date.now() - startTime >= maxDuration) {
                    return resolve(null);
                }
                setTimeout(check, interval);
            }
        }

        check();
    });
}

module.exports = { findPayment, pollPayment };
