import { ec as EC } from 'elliptic';

// 工具函数：生成MD5签名
async function md5(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 生成zpay签名
async function generateSign(params, key) {
    const filteredParams = Object.keys(params)
        .filter(k => params[k] !== '' && params[k] !== null && k !== 'sign' && k !== 'sign_type')
        .sort();

    const stringToSign = filteredParams.map(k => `${k}=${params[k]}`).join('&');
    const finalString = stringToSign + key;
    return await md5(finalString);
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
        case 'Lifetime': return 999 * 365 * 24 * 60 * 60 * 1000;
        default: return 0;
    }
}

async function recalculateSubscription(env, userId) {
    const codes = await env.DB.prepare(
        `SELECT term, created_at as purchaseTime FROM activation_codes WHERE user_id = ? ORDER BY created_at ASC`
    ).bind(userId).all();

    if (!codes.results || codes.results.length === 0) return;

    let currentExpire = 0;
    let isLifetime = false;

    for (const code of codes.results) {
        const termMs = getTermMs(code.term, code.purchaseTime);

        if (code.term === 'Lifetime') {
            currentExpire = new Date(code.purchaseTime).setFullYear(new Date(code.purchaseTime).getFullYear() + 99);
            isLifetime = true;
            break;
        }

        if (currentExpire < code.purchaseTime) {
            currentExpire = code.purchaseTime + termMs;
        } else {
            currentExpire += termMs;
        }
    }

    const now = Date.now();
    await env.DB.prepare(
        `INSERT INTO subscriptions (user_id, expire_date, is_lifetime, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET 
           expire_date = excluded.expire_date,
           is_lifetime = excluded.is_lifetime,
           updated_at = excluded.updated_at`
    ).bind(userId, currentExpire, isLifetime ? 1 : 0, now).run();

    return currentExpire;
}

// 路由处理
async function handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS 处理
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    // 限流检查 (使用 Cloudflare Worker 官方提供的 Rate Limiter Binding)
    const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

    // 限流检查 (全局限流)
    if (env.RATE_LIMITER) {
        // 使用固定的 key 实现全局限流，不再根据 IP 区分
        const { success } = await env.RATE_LIMITER.limit({ key: 'global_rate_limit' });
        if (!success) {
            return new Response(JSON.stringify({
                success: false,
                message: '系统繁忙，请稍后再试 (Too Many Requests)'
            }), {
                status: 429,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    }

    try {
        // 1. 创建支付订单
        if (path === '/api/create-payment' && request.method === 'POST') {
            const { userId, term } = await request.json();

            if (!userId || !term) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '缺少必要参数: userId, term'
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
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
                return new Response(JSON.stringify({
                    success: false,
                    message: '无效的订阅期限'
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const name = NAMES[term];
            const money = PRICES[term];

            if (term === '7d') {
                // 检查是否已经申请过试用
                const existingTrial = await env.DB.prepare(
                    `SELECT code FROM activation_codes WHERE user_id = ? AND term = '7d' LIMIT 1`
                ).bind(userId).first();

                if (existingTrial) {
                    return new Response(JSON.stringify({
                        success: true,
                        status: 1,
                        message: '返回已有试用激活码',
                        activation_code: existingTrial.code
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                } else {
                    const now = Date.now();
                    const activationCode = generateVIPKey(userId, term, now, env.PRIVATE_KEY);
                    const expireDate = calculateExpireDate(now, term);

                    // 记录到试用记录表（用于统计和永久标记）
                    await env.DB.prepare(
                        `INSERT INTO free_trial_used (user_id, created_at)
                         VALUES (?, ?)
                         ON CONFLICT(user_id) DO NOTHING`
                    ).bind(userId, now).run();

                    // 记录到激活码表（供查询和验证使用）
                    await env.DB.prepare(
                        `INSERT INTO activation_codes (code, user_id, term, order_id, used, created_at, expires_at)
                         VALUES (?, ?, ?, ?, 0, ?, ?)`
                    ).bind(activationCode, userId, term, null, now, expireDate).run();

                    return new Response(JSON.stringify({
                        success: true,
                        status: 1,
                        message: '试用激活码生成成功',
                        activation_code: activationCode
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }
            }

            const out_trade_no = `SY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const params = {
                pid: env.PID,
                type: 'alipay',
                out_trade_no: out_trade_no,
                notify_url: `${url.origin}/api/notify`,
                return_url: `${url.origin}/api/return`,
                name: name,
                money: money,
                clientip: request.headers.get('CF-Connecting-IP') || '0.0.0.0',
                sign_type: 'MD5'
            };

            params.sign = await generateSign(params, env.PKEY);

            // 调用zpay API
            const zpayResponse = await fetch(`${env.ZPAY_API_BASE}/mapi.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(params)
            });

            const zpayResult = await zpayResponse.json();

            if (Number(zpayResult.code) === 1) {
                // 保存订单到数据库
                await env.DB.prepare(
                    `INSERT INTO orders (out_trade_no, user_id, product_name, amount, status, term, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`
                ).bind(out_trade_no, userId, name, money, term, Date.now()).run();

                return new Response(JSON.stringify({
                    success: true,
                    qrcode: zpayResult.qrcode,
                    img: zpayResult.img,
                    out_trade_no: out_trade_no
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response(JSON.stringify({
                    success: false,
                    message: zpayResult.msg || '创建订单失败'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 2. 查询订单状态
        if (path === '/api/check-status' && request.method === 'GET') {
            const out_trade_no = url.searchParams.get('out_trade_no');

            if (!out_trade_no) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '缺少订单号'
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 先查询本地数据库
            const localOrder = await env.DB.prepare(
                'SELECT * FROM orders WHERE out_trade_no = ?'
            ).bind(out_trade_no).first();

            if (!localOrder) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '订单不存在'
                }), {
                    status: 404,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 如果已支付，直接返回
            if (localOrder.status === 1) {
                return new Response(JSON.stringify({
                    success: true,
                    status: 1,
                    message: '已支付'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            // 查询zpay订单状态
            const checkUrl = `${env.ZPAY_API_BASE}/api.php?act=order&pid=${env.PID}&key=${env.PKEY}&out_trade_no=${out_trade_no}`;
            console.log('查询zpay订单状态:', checkUrl);
            const zpayResponse = await fetch(checkUrl);
            const zpayResult = await zpayResponse.json();

            if (Number(zpayResult.code) === 1) {
                const status = Number(zpayResult.status);

                // 如果支付成功，更新订单并生成激活码
                if (status === 1 && localOrder.status === 0) {
                    const now = Date.now();

                    // 更新订单状态
                    await env.DB.prepare(
                        `UPDATE orders SET status = 1, paid_at = ?, trade_no = ? WHERE out_trade_no = ?`
                    ).bind(now, zpayResult.trade_no, out_trade_no).run();

                    // 生成激活码
                    const activationCode = generateVIPKey(
                        localOrder.user_id,
                        localOrder.term,
                        now,
                        env.PRIVATE_KEY
                    );

                    // 保存激活码
                    const expireDate = calculateExpireDate(now, localOrder.term);
                    await env.DB.prepare(
                        `INSERT INTO activation_codes (code, user_id, term, order_id, used, created_at, expires_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`
                    ).bind(
                        activationCode,
                        localOrder.user_id,
                        localOrder.term,
                        localOrder.id,
                        now,
                        expireDate
                    ).run();

                    // 更新用户订阅信息
                    await recalculateSubscription(env, localOrder.user_id);

                    return new Response(JSON.stringify({
                        success: true,
                        status: 1,
                        message: '支付成功',
                        activation_code: activationCode
                    }), {
                        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                    });
                }

                return new Response(JSON.stringify({
                    success: true,
                    status: status,
                    message: zpayResult.msg
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            } else {
                return new Response(JSON.stringify({
                    success: false,
                    message: zpayResult.msg || '查询失败'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }
        }

        // 3. zpay异步通知回调
        if (path === '/api/notify' && request.method === 'POST') {
            const formData = await request.formData();
            const data = Object.fromEntries(formData);

            console.log('收到zpay通知:', data);

            // 验证签名（重要！）
            const receivedSign = data.sign;
            const calculatedSign = await generateSign(data, env.PKEY);

            if (receivedSign !== calculatedSign) {
                return new Response('sign error', { status: 400 });
            }

            const { out_trade_no, trade_no, trade_status } = data;

            if (trade_status === 'TRADE_SUCCESS') {
                // 处理支付成功逻辑（与check-status中的逻辑类似）
                const localOrder = await env.DB.prepare(
                    'SELECT * FROM orders WHERE out_trade_no = ?'
                ).bind(out_trade_no).first();

                if (localOrder && localOrder.status === 0) {
                    const now = Date.now();

                    await env.DB.prepare(
                        `UPDATE orders SET status = 1, paid_at = ?, trade_no = ? WHERE out_trade_no = ?`
                    ).bind(now, trade_no, out_trade_no).run();

                    const activationCode = generateVIPKey(
                        localOrder.user_id,
                        localOrder.term,
                        now,
                        env.PRIVATE_KEY
                    );

                    const expireDate = calculateExpireDate(now, localOrder.term);
                    await env.DB.prepare(
                        `INSERT INTO activation_codes (code, user_id, term, order_id, used, created_at, expires_at)
             VALUES (?, ?, ?, ?, 0, ?, ?)`
                    ).bind(activationCode, localOrder.user_id, localOrder.term, localOrder.id, now, expireDate).run();

                    await recalculateSubscription(env, localOrder.user_id);
                }
            }

            return new Response('success');
        }

        // 4. 查询用户订阅状态
        if (path === '/api/subscription' && request.method === 'GET') {
            const userId = url.searchParams.get('userId');

            if (!userId) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '缺少用户ID'
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const subscription = await env.DB.prepare(
                'SELECT * FROM subscriptions WHERE user_id = ?'
            ).bind(userId).first();

            if (!subscription) {
                return new Response(JSON.stringify({
                    success: true,
                    subscribed: false,
                    message: '未订阅'
                }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const now = Date.now();
            const isValid = subscription.is_lifetime === 1 || subscription.expire_date > now;

            return new Response(JSON.stringify({
                success: true,
                subscribed: isValid,
                expire_date: subscription.expire_date,
                is_lifetime: subscription.is_lifetime === 1
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 5. 手动生成激活码（管理接口，需要添加认证）
        if (path === '/api/admin/generate-code' && request.method === 'POST') {
            const { userId, term, adminToken } = await request.json();

            // 简单的管理员验证（建议使用更安全的方式）
            if (adminToken !== env.ADMIN_TOKEN) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '无权限'
                }), {
                    status: 403,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const now = Date.now();
            const activationCode = generateVIPKey(userId, term, now, env.PRIVATE_KEY);
            const expireDate = calculateExpireDate(now, term);

            await env.DB.prepare(
                `INSERT INTO activation_codes (code, user_id, term, used, created_at, expires_at)
         VALUES (?, ?, ?, 0, ?, ?)`
            ).bind(activationCode, userId, term, now, expireDate).run();

            await recalculateSubscription(env, userId);

            return new Response(JSON.stringify({
                success: true,
                code: activationCode
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        // 6. 查询用户是否已使用7天试用
        if (path === '/api/freeTrialUsed' && request.method === 'GET') {
            const userId = url.searchParams.get('userId');

            if (!userId) {
                return new Response(JSON.stringify({
                    success: false,
                    message: '缺少用户ID'
                }), {
                    status: 400,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
                });
            }

            const trialCount = await env.DB.prepare(
                `SELECT count(*) as count FROM free_trial_used WHERE user_id = ?`
            ).bind(userId).first('count');

            return new Response(JSON.stringify({
                success: true,
                used: trialCount > 0
            }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not Found', { status: 404 });

    } catch (error) {
        console.error('Error:', error);
        return new Response(JSON.stringify({
            success: false,
            message: error.message
        }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
}

export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env);
    }
};