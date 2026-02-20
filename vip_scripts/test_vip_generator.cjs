const { generateVIPKey } = require('./vip-generator.cjs');
const key = generateVIPKey('1610205759005', "1y");
console.log('Generated VIP Key:', key);
