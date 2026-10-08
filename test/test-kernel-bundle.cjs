const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// 构建后运行，验证完整打包产物，而不是替换调度器或管理器。
test('内核构建产物没有页面也能启动 Croner、响应文件变更并完整卸载', async t => {
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-10-08T09:29:30').getTime() });
    const flush = async () => { for (let i = 0; i < 300; i++) await Promise.resolve(); };
    const files = {
        'reminder-settings.json': JSON.stringify({ reminderWebhookEnabled: true,
            reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom' }),
        'reminder.json': JSON.stringify({ task: { id: 'task', date: '2026-10-08', time: '09:30', title: '无页面任务' } })
    };
    const rpc = new Map(), watched = new Set(), errors = [], broadcasts = [];
    let sends = 0;
    const original = global.siyuan;
    const runtime = {
        plugin: { lifecycle: {} }, event: { handler: null },
        storage: {
            get: async filename => {
                if (!(filename in files)) throw new Error('no such file');
                return { text: async () => files[filename] };
            },
            put: async (filename, data) => { files[filename] = data; },
            list: async () => [], remove: async filename => { delete files[filename]; },
            watcher: { add: async path => watched.add(path), remove: async path => watched.delete(path) }
        },
        client: { fetch: async url => {
            if (url === '/api/system/getConf') return { json: async () => ({}) };
            assert.equal(url, '/api/network/forwardProxy');
            sends++;
            return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: '{}' } }) };
        } },
        rpc: { bind: async (name, handler) => rpc.set(name, handler), unbind: async name => rpc.delete(name),
            broadcast: async (method, params) => broadcasts.push({ method, params }) },
        agent: { registerCapability: async name => ({ name }), unregisterCapability: async () => {} },
        logger: { info: async () => {}, debug: async () => {}, warn: async () => {}, error: async (...args) => errors.push(args) }
    };
    global.siyuan = runtime;
    try {
        await import(pathToFileURL(path.resolve(__dirname, '../dist/kernel.js')).href);
        await runtime.plugin.lifecycle.onload();
        assert.ok(watched.has('.'));
        assert.ok(rpc.has('refresh-reminder-schedule'));
        assert.equal(sends, 0);
        t.mock.timers.tick(30_000); await flush();
        assert.equal(sends, 1);
        const event = broadcasts.find(item => item.method === 'reminder-due').params.events[0];
        const snapshot = await rpc.get('get-reminder-events')();
        assert.equal(snapshot.events[0].key, event.key);
        assert.equal(await rpc.get('claim-reminder-event')({ key: event.key, owner: 'window-a' }), true);
        assert.equal(await rpc.get('claim-reminder-event')({ key: event.key, owner: 'window-b' }), false);
        await rpc.get('ack-reminder-event')({ key: event.key, owner: 'window-a' });
        assert.equal((await rpc.get('get-reminder-events')()).events.length, 0);
        files['reminder.json'] = JSON.stringify({ task: { id: 'task', date: '2026-10-08', time: '09:31', title: '修改时间' } });
        await runtime.event.handler({ type: 'fs-notify', detail: { path: 'reminder.json' } });
        t.mock.timers.tick(250); await flush();
        t.mock.timers.tick(30_000); await flush();
        t.mock.timers.tick(29_750); await flush();
        assert.equal(sends, 2);
        assert.equal(errors.length, 0);
    } finally {
        await runtime.plugin.lifecycle.onunload();
        global.siyuan = original;
    }
    assert.equal(rpc.size, 0);
    assert.equal(watched.size, 0);
    assert.equal(runtime.event.handler, null);
    t.mock.timers.tick(60_000); await flush();
    assert.equal(sends, 2);
});
