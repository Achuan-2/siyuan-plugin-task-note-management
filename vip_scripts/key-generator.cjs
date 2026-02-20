const EC = require('elliptic').ec;
const ec = new EC('secp256k1');

/**
 * VIP 系统密钥对生成工具
 * 运行此脚本可以生成一对新的私钥和公钥。
 */

console.log("\n🚀 正在生成新的 VIP 系统密钥对...\n");

// 生成密钥对
const key = ec.genKeyPair();

const privateKey = key.getPrivate('hex');
const publicKey = key.getPublic('hex');

console.log("------------------------------------------------------------");
console.log("🔑 私钥 (PRIVATE_KEY):");
console.log(privateKey);
console.log("\n⚠️ 重要提示: 请妥善保管此私钥，仅用于 scripts/vip-generator.cjs，切勿泄露或打包进插件！");
console.log("------------------------------------------------------------");

console.log("\n------------------------------------------------------------");
console.log("🔓 公钥 (PUBLIC_KEY):");
console.log(publicKey);
console.log("\n✅ 使用提示: 请将此公钥替换到 src/utils/vip.ts 中的 PUBLIC_KEY 常量中。");
console.log("------------------------------------------------------------\n");
