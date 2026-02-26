/**
 * sync-i18n.cjs
 * Run: node scripts/sync-i18n.cjs
 *
 * Checks for missing keys between zh_CN.json and en_US.json.
 * - Missing en_US keys get the zh_CN value as a placeholder (needs manual translation).
 * - Missing zh_CN keys get the en_US value as a placeholder.
 * - Both files are ALWAYS rewritten in zh_CN key order.
 */

const fs = require('fs');
const path = require('path');

const I18N_DIR = path.join(__dirname, '../i18n');
const ZH_PATH = path.join(I18N_DIR, 'zh_CN.json');
const EN_PATH = path.join(I18N_DIR, 'en_US.json');

const zh = JSON.parse(fs.readFileSync(ZH_PATH, 'utf8'));
const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));

const zhKeys = Object.keys(zh);
const enKeys = Object.keys(en);
const missingInEn = zhKeys.filter(k => !en.hasOwnProperty(k));
const missingInZh = enKeys.filter(k => !zh.hasOwnProperty(k));

console.log(`\nzh_CN: ${zhKeys.length} keys`);
console.log(`en_US: ${enKeys.length} keys`);

if (missingInEn.length > 0) {
    console.log(`\n⚠️  Missing in en_US (${missingInEn.length}) — using zh value as placeholder:`);
    missingInEn.forEach(k => {
        en[k] = zh[k];
        console.log(`  + ${k}: ${JSON.stringify(zh[k]).substring(0, 60)}`);
    });
} else {
    console.log('✅ en_US has no missing keys.');
}

if (missingInZh.length > 0) {
    console.log(`\n⚠️  Missing in zh_CN (${missingInZh.length}) — using en value as placeholder:`);
    missingInZh.forEach(k => {
        zh[k] = en[k];
        console.log(`  + ${k}: ${JSON.stringify(en[k]).substring(0, 60)}`);
    });
} else {
    console.log('✅ zh_CN has no missing keys.');
}

// Always reorder en_US to match zh_CN key order
const enOrdered = {};
Object.keys(zh).forEach(k => { enOrdered[k] = en[k]; });
// Append any extra en keys not in zh (shouldn't exist after sync above)
Object.keys(en).forEach(k => { if (!enOrdered.hasOwnProperty(k)) enOrdered[k] = en[k]; });

// Always write both files to guarantee consistent ordering
fs.writeFileSync(ZH_PATH, JSON.stringify(zh, null, 4) + '\n', 'utf8');
fs.writeFileSync(EN_PATH, JSON.stringify(enOrdered, null, 4) + '\n', 'utf8');

// Verify ordering
const zhFinalKeys = Object.keys(JSON.parse(fs.readFileSync(ZH_PATH, 'utf8')));
const enFinalKeys = Object.keys(JSON.parse(fs.readFileSync(EN_PATH, 'utf8')));
const orderOk = zhFinalKeys.length === enFinalKeys.length && zhFinalKeys.every((k, i) => k === enFinalKeys[i]);
console.log(orderOk
    ? '\n✅ Key order is identical in both files.'
    : '\n❌ Key order still differs!');

// Report en_US values that still contain Chinese characters (need translation)
const enData = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
const zhCharsRegex = /[\u4e00-\u9fff]/;
const needsTranslation = Object.keys(enData).filter(k =>
    k !== 'listCreationPlaceholder' && zhCharsRegex.test(enData[k])
);
if (needsTranslation.length > 0) {
    console.log(`\n⚠️  en_US entries still containing Chinese (need manual translation):`);
    needsTranslation.forEach(k => console.log(`  ${k}: ${String(enData[k]).substring(0, 80)}`));
} else {
    console.log('✅ No Chinese characters found in en_US values.');
}

console.log(`\nFinal: zh_CN ${zhFinalKeys.length} keys, en_US ${enFinalKeys.length} keys\n`);
