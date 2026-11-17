const https = require('node:https');
const config = require('../config');
const agent = new https.Agent({ keepAlive: true, family: 4 });

function requestJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { agent, family: 4 }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`TronGrid HTTP ${res.statusCode}`));
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                body += chunk;
                if (body.length > 8 * 1024 * 1024) req.destroy(new Error('TronGrid response too large'));
            });
            res.on('error', reject);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
            });
        });
        const timeout = setTimeout(() => req.destroy(new Error('TronGrid request timed out')), config.payment.requestTimeoutMs);
        req.on('close', () => clearTimeout(timeout));
        req.on('error', reject);
    });
}

function matchesPayment(tx, order) {
    return tx.type === 'Transfer'
        && tx.to === order.paymentAddress
        && tx.token_info?.address === order.tokenContract
        && Number(tx.token_info.decimals) === 6
        && /^[a-f0-9]{64}$/i.test(tx.transaction_id || '')
        && /^\d+$/.test(tx.value || '')
        && BigInt(tx.value) === BigInt(order.expectedRaw)
        && Number.isSafeInteger(tx.block_timestamp)
        && tx.block_timestamp >= order.createdAt.getTime()
        && tx.block_timestamp <= order.paymentDeadline.getTime();
}

// An upstream error is never interpreted as proof that no payment exists.
async function findPayment(order, { fetchPage = requestJson } = {}) {
    if (!order.expectedRaw || !order.paymentDeadline || !order.paymentAddress || !order.tokenContract) {
        throw new Error('Legacy or incomplete order requires manual reconciliation');
    }
    const url = new URL(`/v1/accounts/${order.paymentAddress}/transactions/trc20`, config.tron.apiUrl);
    url.search = new URLSearchParams({
        only_to: 'true', only_confirmed: 'true', contract_address: order.tokenContract,
        min_timestamp: String(order.createdAt.getTime()),
        max_timestamp: String(order.paymentDeadline.getTime()),
        limit: '200', order_by: 'block_timestamp,asc',
    }).toString();
    const fingerprints = new Set();
    for (let page = 0; page < 100; page++) {
        const json = await fetchPage(url);
        if (json.success !== true || !Array.isArray(json.data)) {
            throw new Error('Invalid TronGrid response');
        }
        for (const tx of json.data) {
            if (matchesPayment(tx, order)) {
                return { txHash: tx.transaction_id, amount: Number(tx.value) / 1e6, timestamp: tx.block_timestamp };
            }
        }
        const fingerprint = json.meta?.fingerprint;
        if (!fingerprint) return null;
        if (fingerprints.has(fingerprint)) throw new Error('Repeated TronGrid pagination cursor');
        fingerprints.add(fingerprint);
        url.searchParams.set('fingerprint', fingerprint);
    }
    throw new Error('TronGrid pagination limit reached; reconciliation must retry');
}

module.exports = { findPayment, matchesPayment };
