const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const { spawn } = require('child_process');
const VALID_TERMS = ['7d', '1m', '1y', 'Lifetime'];

/**
 * VIP 激活码生成工具 (Standalone)
 * 请妥善保管此文件和私钥，不要将其打包进插件。
 */

// 您的私钥 - 请务必保密！
const PRIVATE_KEY = "c96db0f1bc5a7f98cc7bd4d689427eac06b2a22fae21c64f27518ad208575573";

/**
 * 生成 VIP 激活码
 * @param {string} userId 思源用户 ID
 * @param {string} term 购买时长 ('7d', '1m', '1y', 'Lifetime')
 * @param {number} purchaseTime 购买时间戳 (ms)，默认为现在
 */
function generateVIPKey(userId, term, purchaseTime = Date.now()) {
    if (!VALID_TERMS.includes(term)) {
        throw new Error(`Invalid term "${term}". Allowed: ${VALID_TERMS.join(', ')}`);
    }
    // 使用秒级时间戳减少长度
    const purchaseSeconds = Math.floor(purchaseTime / 1000);
    const encodedPurchase = purchaseSeconds.toString(36).toUpperCase();

    // 签名包含用户ID、购买时间和时长
    const message = `${userId}|${purchaseSeconds}|${term}`;
    const key = ec.keyFromPrivate(PRIVATE_KEY);
    const signature = key.sign(message).toDER('hex');

    // 格式：购买时间_时长_签名
    return `${encodedPurchase}_${term}_${signature}`;
}

function copyToClipboardWindows(text) {
    return new Promise((resolve, reject) => {
        try {
            const clip = spawn('clip');
            clip.on('error', (err) => reject(err));
            clip.stdin.write(text);
            clip.stdin.end();
            clip.on('close', (code) => resolve(code));
        } catch (err) {
            reject(err);
        }
    });
}



// 示例用法
const args = process.argv.slice(2);
if (args.length >= 2) {
    const userId = args[0];
    const term = args[1];
    console.log(`\n--- VIP Key Generator ---`);
    console.log(`User ID: ${userId}`);
    console.log(`Term: ${term}`);


    let key;
    try {
        key = generateVIPKey(userId, term);
    } catch (err) {
        console.error('\nError:', err && err.message ? err.message : err);
        process.exit(1);
    }
    console.log(`\nGenerated Key:\n${key}\n`);
    if (process.platform === 'win32') {
        copyToClipboardWindows(key).then(() => {
            console.log('Key copied to clipboard.');
        }).catch((err) => {
            console.error('Failed to copy to clipboard:', err && err.message ? err.message : err);
        });
    } else {
    }
} else {
    console.log('\nUsage: node vip_scripts/vip-generator.cjs <userId> <term> [currentExpireDate]');
    console.log('Example: node vip_scripts/vip-generator.cjs 1610205759005 1y');
}

module.exports = { generateVIPKey };
