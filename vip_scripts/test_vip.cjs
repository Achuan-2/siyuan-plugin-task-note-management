const { generateVIPKey } = require('./vip-generator.cjs');
// 注意：由于 src/utils/vip.ts 是 ESM，在 Node.js 中直接 require TS 比较麻烦
// 为了测试验证逻辑，我们可以模拟一个兼容的验证器，或者直接使用 gen-generator 中的公钥
const EC = require('elliptic').ec;
const ec = new EC('secp256k1');
const PUBLIC_KEY = "04d460cc7f5e41bf5aab87b18b38cb6b317e6beffd46942d6b4a6357530ea94e84c552ace2ade7f30df60060d99a8873f373a52d6d8ea129760aee0991bf3bfd30";

/**
 * 模拟验证逻辑 (与 src/utils/vip.ts 中的逻辑保持一致)
 */
function verifyVIPKey(userId, vipKey) {
    if (!vipKey || !vipKey.includes('_')) return { valid: false, error: '格式错误' };
    try {
        const parts = vipKey.split('_');
        if (parts.length !== 3) return { valid: false, error: '格式不全' };

        const [encodedPurchase, term, signature] = parts;

        // 1. 解码购买时间
        const purchaseSeconds = parseInt(encodedPurchase, 36);
        if (isNaN(purchaseSeconds)) return { valid: false, error: '解码失败' };

        const purchaseTime = purchaseSeconds * 1000;

        // 2. 签名验证使用的是 userId|purchaseSeconds|term
        const message = `${userId}|${purchaseSeconds}|${term}`;
        const key = ec.keyFromPublic(PUBLIC_KEY, 'hex');
        const valid = key.verify(message, signature);

        // 计算此单一 Key 的到期日 (仅用于展示测试结果)
        let expireDate = new Date(purchaseTime);
        if (term === '7d') expireDate.setDate(expireDate.getDate() + 7);
        else if (term === '1m') expireDate.setMonth(expireDate.getMonth() + 1);
        else if (term === '1y') expireDate.setFullYear(expireDate.getFullYear() + 1);
        else if (term === 'Lifetime') expireDate.setFullYear(expireDate.getFullYear() + 99);

        return {
            valid,
            purchaseTime: formatDate(new Date(purchaseTime)),
            expireDate: formatDate(expireDate),
            term
        };
    } catch (e) {
        return { valid: false, error: e.message };
    }
}

function formatDate(date) {
    const Y = date.getFullYear();
    const M = String(date.getMonth() + 1).padStart(2, '0');
    const D = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${Y}-${M}-${D} ${h}:${m}`;
}

// --- 测试流程 ---

const userIdA = "1610205759005";
const userIdB = "9999999999999"; // 模拟另一个用户

console.log("\n🧪 开始 VIP 安全验证测试 (V2 - 阶梯式累计版)...");

// 1. 生成并测试各种版本的合法 Key
console.log("\n[1] 开始验证所有阶梯版本的 Key ('7d', '1m', '1y', 'Lifetime'):");

const terms = ['7d', '1m', '1y', 'Lifetime'];
const termNames = {
    '7d': '7天版',
    '1m': '1月版',
    '1y': '1年版',
    'Lifetime': '永久版'
};

terms.forEach(term => {
    const key = generateVIPKey(userIdA, term);
    const result = verifyVIPKey(userIdA, key);

    console.log(`\n> 测试 ${termNames[term]} (${term}):`);
    console.log(`   生成的 Key: ${key.substring(0, 20)}...`);
    console.log(`   验证状态:   ${result.valid ? "✅ 成功" : "❌ 失败"}`);
    console.log(`   购买时间:   ${result.purchaseTime}`);
    console.log(`   此单有效期: ${result.expireDate}`);
});

const key1y = generateVIPKey(userIdA, "1y");

// 2. 验证合法 Key (具体分析)
console.log("\n[2] 合法 Key 安全性深入分析 (以 1年版为例):");
const result1 = verifyVIPKey(userIdA, key1y);
console.log("   验证结果:", result1.valid ? "✅ 成功" : "❌ 失败", "| 购买时间:", result1.purchaseTime);

// 3. 测试用户 ID 篡改 (用 A 的 Key 尝试激活 B 的账号)
console.log("\n[3] 安全测试: 尝试用用户 A 的激活码，激活用户 B 的账号...");
const result2 = verifyVIPKey(userIdB, key1y);
console.log("   验证结果:", result2.valid ? "❌ 注入漏洞 (风险!)" : "✅ 拦截成功 (签名不匹配)");

// 4. 测试激活码内容篡改 (尝试修改购买时间以试图重置到期日)
console.log("\n[4] 安全测试: 尝试篡改激活码中的购买时间...");
const parts = key1y.split('_');
const encodedPart = parts[0];
// 修改编码部分的一个字符
const tamperedEncoded = encodedPart.substring(0, encodedPart.length - 1) + (encodedPart.endsWith('A') ? 'B' : 'A');
const tamperedKey = [tamperedEncoded, parts[1], parts[2]].join('_');

const result3 = verifyVIPKey(userIdA, tamperedKey);
console.log("   原始 Key:", key1y.substring(0, 15) + "...");
console.log("   篡改 Key:", tamperedKey.substring(0, 15) + "...");
console.log("   验证结果:", result3.valid ? "❌ 篡改成功 (风险!)" : "✅ 拦截成功 (签名校验失败)");

// 5. 测试随机激活码
console.log("\n[5] 安全测试: 尝试使用伪造的随机激活码...");
const fakeKey = "KZA2B3C4_1y_abcdef1234567890";
const result4 = verifyVIPKey(userIdA, fakeKey);
console.log("   验证结果:", result4.valid ? "❌ 伪造成功 (风险!)" : "✅ 拦截成功 (格式或签名错误)");

console.log("\n🏁 测试结束\n");
