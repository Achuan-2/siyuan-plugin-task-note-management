import express from 'express';
import cors from 'cors';
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
import elliptic from 'elliptic';
const EC = elliptic.ec;
import crypto from 'crypto';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 全局IP限流 (简单的内存级别，由于 Serverless 特性，只在单个实例内生效，适用于防简单的并发刷量)
const rateLimitMap = new Map();
app.use((req, res, next) => {
    const clientIp = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxRequests = 60;

    const record = rateLimitMap.get(clientIp) || { count: 0, startTime: now };

    // 清理过期记录
    if (now - record.startTime > windowMs) {
        record.count = 1;
        record.startTime = now;
    } else {
        record.count++;
    }

    rateLimitMap.set(clientIp, record);

    if (record.count > maxRequests) {
        return res.status(429).json({
            success: false,
            message: '系统繁忙，请稍后再试 (Too Many Requests)'
        });
    }

    next();
});

// 工具函数：生成MD5签名
function md5(text) {
    return crypto.createHash('md5').update(text).digest('hex');
}

// 生成zpay签名
function generateSign(params, key) {
    const filteredParams = Object.keys(params)
        .filter(k => params[k] !== '' && params[k] !== null && k !== 'sign' && k !== 'sign_type')
        .sort();

    const stringToSign = filteredParams.map(k => `${k}=${params[k]}`).join('&');
    const finalString = stringToSign + key;
    return md5(finalString);
}

// VIP激活码生成
function generateVIPKey(userId, term, purchaseTime, privateKey) {
    const ec = new EC('secp256k1');
    const purchaseSeconds = Math.floor(purchaseTime / 1000);
    const encodedPurchase = purchaseSeconds.toString(36).toUpperCase();

    const message = `${userId}|${purchaseSeconds}|${term}`;
    const key = ec.keyFromPrivate(privateKey);
    const signature = key.sign(message).toDER('hex');

    return `${encodedPurchase}_${term}_${signature}`;
}

// 计算过期时间
function calculateExpireDate(currentTime, term) {
    const MS_DAY = 86400000;
    const MS_MONTH = MS_DAY * 30;
    const MS_YEAR = MS_DAY * 365;

    switch (term) {
        case '7d': return currentTime + MS_DAY * 7;
        case '1m': return currentTime + MS_MONTH;
        case '1y': return currentTime + MS_YEAR;
        case 'Lifetime': return null; // 终身
        default: throw new Error('Invalid term');
    }
}

function getTermMs(term, purchaseTime) {
    const date = new Date(purchaseTime);
    const start = date.getTime();
    switch (term) {
        case '7d': return 7 * 24 * 60 * 60 * 1000;
        case '1m': return 30 * 24 * 60 * 60 * 1000;
        case '1y':
            date.setFullYear(date.getFullYear() + 1);
            return date.getTime() - start;
        case 'Lifetime': return new Date(start + 999 * 365 * 24 * 60 * 60 * 1000).toISOString();
        default: return new Date(start).toISOString();
    }
}

// 获取东八区格式化时间字符串
function getEast8Time(timestamp = Date.now()) {
    const d = new Date(timestamp);
    // 加上 8 小时的毫秒数得到东八区时间表示
    const east8 = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return east8.toISOString().replace('T', ' ').substring(0, 16);
}

// 将东八区格式化时间字符串（YYYY-MM-DD HH:mm）转回时间戳，用于计算
function parseEast8Time(timeStr) {
    if (!timeStr) return 0;
    // 如果是 ISO timestamp (带 Z)，原样解析；否则认为是东八区字面量，补上 +08:00
    if (timeStr.includes('Z') || timeStr.includes('+')) {
        return new Date(timeStr).getTime();
    }
    return new Date(timeStr + '+08:00').getTime();
}

async function recalculateSubscription(userId) {
    const rows = await sql`
        SELECT term, created_at as "purchaseTime" 
        FROM activation_codes 
        WHERE user_id = ${userId} 
        ORDER BY created_at ASC
    `;

    if (!rows || rows.length === 0) return;

    let currentExpireMs = 0;
    let isLifetime = false;

    for (const code of rows) {
        // code.purchaseTime 现在是类似 "2026-02-23 23:20" 的字符串或 ISO 时间串
        const purchaseTime = parseEast8Time(code.purchaseTime);
        const termMs = getTermMs(code.term, purchaseTime);

        if (code.term === 'Lifetime') {
            currentExpireMs = new Date(purchaseTime).setFullYear(new Date(purchaseTime).getFullYear() + 99);
            isLifetime = true;
            break;
        }

        if (currentExpireMs < purchaseTime) {
            currentExpireMs = purchaseTime + termMs;
        } else {
            currentExpireMs += termMs;
        }
    }

    const currentExpireFormatted = getEast8Time(currentExpireMs);
    const nowFormatted = getEast8Time();
    await sql`
        INSERT INTO subscriptions (user_id, expire_date, is_lifetime, updated_at)
        VALUES (${userId}, ${currentExpireFormatted}, ${isLifetime ? 1 : 0}, ${nowFormatted})
        ON CONFLICT (user_id) DO UPDATE SET 
            expire_date = EXCLUDED.expire_date,
            is_lifetime = EXCLUDED.is_lifetime,
            updated_at = EXCLUDED.updated_at
    `;

    return currentExpireFormatted;
}

// 1. 创建支付订单
app.post('/api/create-payment', async (req, res) => {
    try {
        const { userId, term } = req.body;

        if (!userId || !term) {
            return res.status(400).json({ success: false, message: '缺少必要参数: userId, term' });
        }

        const PRICES = {
            '1m': '5',
            '1y': '30',
            'Lifetime': '99'
        };

        const NAMES = {
            '7d': '【任务笔记管理插件】7天试用',
            '1m': '【任务笔记管理插件】月付',
            '1y': '【任务笔记管理插件】年付',
            'Lifetime': '【任务笔记管理插件】终身'
        };

        if (!['7d', '1m', '1y', 'Lifetime'].includes(term)) {
            return res.status(400).json({ success: false, message: '无效的订阅期限' });
        }

        const name = NAMES[term];
        const money = PRICES[term];

        if (term === '7d') {
            const result = await sql`SELECT code FROM activation_codes WHERE user_id = ${userId} AND term = '7d' LIMIT 1`;
            const existingTrial = result[0];

            if (existingTrial) {
                return res.json({
                    success: true,
                    status: 1,
                    message: '返回已有试用激活码',
                    activation_code: existingTrial.code
                });
            } else {
                const nowMs = Date.now();
                const nowFormatted = getEast8Time(nowMs);
                const activationCode = generateVIPKey(userId, term, nowMs, process.env.PRIVATE_KEY);
                const expireDateMs = calculateExpireDate(nowMs, term);
                const expireDateFormatted = getEast8Time(expireDateMs);

                await sql`
                    INSERT INTO free_trial_used (user_id, created_at)
                    VALUES (${userId}, ${nowFormatted})
                    ON CONFLICT (user_id) DO NOTHING
                `;

                await sql`
                    INSERT INTO activation_codes (code, user_id, term, order_id, used, created_at, expires_at)
                    VALUES (${activationCode}, ${userId}, ${term}, null, 0, ${nowFormatted}, ${expireDateFormatted})
                `;

                return res.json({
                    success: true,
                    status: 1,
                    message: '试用激活码生成成功',
                    activation_code: activationCode
                });
            }
        }

        const nowMs = Date.now();
        const nowFormatted = getEast8Time(nowMs);
        const out_trade_no = `SY_${nowMs}_${Math.random().toString(36).substr(2, 9)}`;

        const params = {
            pid: process.env.PID,
            type: 'alipay',
            out_trade_no: out_trade_no,
            notify_url: `${req.protocol}://${req.get('host')}/api/notify`,
            return_url: `${req.protocol}://${req.get('host')}/api/return`,
            name: name,
            money: money,
            clientip: req.ip || req.headers['x-forwarded-for'] || '0.0.0.0',
            sign_type: 'MD5'
        };

        params.sign = generateSign(params, process.env.PKEY);

        const zpayResponse = await fetch(`${process.env.ZPAY_API_BASE}/mapi.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params)
        });

        const zpayResult = await zpayResponse.json();

        if (Number(zpayResult.code) === 1) {
            await sql`
                INSERT INTO orders (out_trade_no, user_id, product_name, amount, status, term, created_at)
                VALUES (${out_trade_no}, ${userId}, ${name}, ${money}, 0, ${term}, ${nowFormatted})
            `;

            return res.json({
                success: true,
                qrcode: zpayResult.qrcode,
                img: zpayResult.img,
                out_trade_no: out_trade_no
            });
        } else {
            return res.json({
                success: false,
                message: zpayResult.msg || '创建订单失败'
            });
        }
    } catch (error) {
        console.error('Error in /api/create-payment:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// 2. 查询订单状态
app.get('/api/check-status', async (req, res) => {
    try {
        const { out_trade_no } = req.query;

        if (!out_trade_no) {
            return res.status(400).json({ success: false, message: '缺少订单号' });
        }

        const localOrderResult = await sql`SELECT * FROM orders WHERE out_trade_no = ${out_trade_no}`;
        const localOrder = localOrderResult[0];

        if (!localOrder) {
            return res.status(404).json({ success: false, message: '订单不存在' });
        }

        if (localOrder.status === 1) {
            return res.json({ success: true, status: 1, message: '已支付' });
        }

        const checkUrl = `${process.env.ZPAY_API_BASE}/api.php?act=order&pid=${process.env.PID}&key=${process.env.PKEY}&out_trade_no=${out_trade_no}`;
        console.log('查询zpay订单状态:', checkUrl);

        const zpayResponse = await fetch(checkUrl);
        const zpayResult = await zpayResponse.json();

        if (Number(zpayResult.code) === 1) {
            const status = Number(zpayResult.status);

            if (status === 1 && localOrder.status === 0) {
                const nowMs = Date.now();
                const nowFormatted = getEast8Time(nowMs);

                await sql`
                    UPDATE orders SET status = 1, paid_at = ${nowFormatted}, trade_no = ${zpayResult.trade_no} 
                    WHERE out_trade_no = ${out_trade_no}
                `;

                const activationCode = generateVIPKey(
                    localOrder.user_id,
                    localOrder.term,
                    nowMs,
                    process.env.PRIVATE_KEY
                );

                const expireDateMs = calculateExpireDate(nowMs, localOrder.term);
                const expireDateFormatted = getEast8Time(expireDateMs);

                await sql`
                    INSERT INTO activation_codes (code, user_id, term, order_id, used, created_at, expires_at)
                    VALUES (${activationCode}, ${localOrder.user_id}, ${localOrder.term}, ${localOrder.id}, 0, ${nowFormatted}, ${expireDateFormatted})
                `;

                await recalculateSubscription(localOrder.user_id);

                return res.json({
                    success: true,
                    status: 1,
                    message: '支付成功',
                    activation_code: activationCode
                });
            }

            return res.json({
                success: true,
                status: status,
                message: zpayResult.msg
            });
        } else {
            return res.json({
                success: false,
                message: zpayResult.msg || '查询失败'
            });
        }
    } catch (error) {
        console.error('Error in /api/check-status:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// 3. zpay异步通知回调
app.post('/api/notify', async (req, res) => {
    try {
        const data = req.body;
        console.log('收到zpay通知:', data);

        const receivedSign = data.sign;
        const calculatedSign = generateSign(data, process.env.PKEY);

        if (receivedSign !== calculatedSign) {
            return res.status(400).send('sign error');
        }

        const { out_trade_no, trade_no, trade_status } = data;

        if (trade_status === 'TRADE_SUCCESS') {
            const orderResult = await sql`SELECT * FROM orders WHERE out_trade_no = ${out_trade_no}`;
            const localOrder = orderResult[0];

            if (localOrder && localOrder.status === 0) {
                const nowMs = Date.now();
                const nowFormatted = getEast8Time(nowMs);

                await sql`
                    UPDATE orders SET status = 1, paid_at = ${nowFormatted}, trade_no = ${trade_no} 
                    WHERE out_trade_no = ${out_trade_no}
                `;

                const activationCode = generateVIPKey(
                    localOrder.user_id,
                    localOrder.term,
                    nowMs,
                    process.env.PRIVATE_KEY
                );

                const expireDateMs = calculateExpireDate(nowMs, localOrder.term);
                const expireDateFormatted = getEast8Time(expireDateMs);

                await sql`
                    INSERT INTO activation_codes (code, user_id, term, order_id, used, created_at, expires_at)
                    VALUES (${activationCode}, ${localOrder.user_id}, ${localOrder.term}, ${localOrder.id}, 0, ${nowFormatted}, ${expireDateFormatted})
                `;

                await recalculateSubscription(localOrder.user_id);
            }
        }

        return res.send('success');
    } catch (error) {
        console.error('Error in /api/notify:', error);
        return res.status(500).send('error');
    }
});

// 4. 查询用户订阅状态
app.get('/api/subscription', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ success: false, message: '缺少用户ID' });
        }

        const subResult = await sql`SELECT * FROM subscriptions WHERE user_id = ${userId}`;
        const subscription = subResult[0];

        if (!subscription) {
            return res.json({ success: true, subscribed: false, message: '未订阅' });
        }

        const nowMs = Date.now();
        const expireDateStr = subscription.expire_date;
        const isLifetime = subscription.is_lifetime === 1;
        // 把数据库取出来的字符或者Date类型变成时间戳，进行计算比较
        const expireDate = new Date(expireDateStr).getTime();

        const isValid = isLifetime || expireDate > nowMs;

        return res.json({
            success: true,
            subscribed: isValid,
            expire_date: expireDate,
            is_lifetime: isLifetime
        });
    } catch (error) {
        console.error('Error in /api/subscription:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// 5. 手动生成激活码
app.post('/api/admin/generate-code', async (req, res) => {
    try {
        const { userId, term, adminToken } = req.body;

        if (adminToken !== process.env.ADMIN_TOKEN) {
            return res.status(403).json({ success: false, message: '无权限' });
        }

        const nowMs = Date.now();
        const nowFormatted = getEast8Time(nowMs);
        const activationCode = generateVIPKey(userId, term, nowMs, process.env.PRIVATE_KEY);
        const expireDateMs = calculateExpireDate(nowMs, term);
        const expireDateFormatted = getEast8Time(expireDateMs);

        await sql`
            INSERT INTO activation_codes (code, user_id, term, used, created_at, expires_at)
            VALUES (${activationCode}, ${userId}, ${term}, 0, ${nowFormatted}, ${expireDateFormatted})
        `;

        await recalculateSubscription(userId);

        return res.json({ success: true, code: activationCode });
    } catch (error) {
        console.error('Error in /api/admin/generate-code:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

// 6. 查询用户是否已使用7天试用
app.get('/api/freeTrialUsed', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ success: false, message: '缺少用户ID' });
        }

        const trialResult = await sql`SELECT count(*) as count FROM free_trial_used WHERE user_id = ${userId}`;
        const trialCount = parseInt(trialResult[0].count, 10);

        return res.json({ success: true, used: trialCount > 0 });
    } catch (error) {
        console.error('Error in /api/freeTrialUsed:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
});

export default app;
