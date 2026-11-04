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
            reminderWebhookUrl: 'https://example.invalid', reminderWebhookJsonType: 'wecom',
            reminderEmailEnabled: true, reminderEmailTransport: 'api', reminderEmailProvider: 'custom',
            reminderEmailApiUrl: 'https://mail.example.invalid/emails', reminderEmailApiKey: 'test-key',
            reminderEmailFrom: 'sender@example.com', reminderEmailTo: 'recipient@example.com' }),
        'reminder.json': JSON.stringify({ task: { id: 'task', date: '2026-10-08', time: '09:30', title: '无页面任务' } })
    };
    const rpc = new Map(), capabilities = new Map(), watched = new Set(), errors = [], broadcasts = [];
    let sends = 0;
    const emails = [];
    const original = global.siyuan;
    const runtime = {
        plugin: { name: 'test-plugin', lifecycle: {} }, event: { handler: null },
        storage: {
            get: async filename => {
                if (!(filename in files)) throw new Error('no such file');
                return { text: async () => files[filename] };
            },
            put: async (filename, data) => { files[filename] = data; },
            list: async dir => Object.keys(files).filter(key => key.startsWith(dir + '/')).map(key => ({
                name: key.slice(dir.length + 1), isDir: false, updated: Math.floor(Date.now() / 1000),
            })), remove: async filename => { delete files[filename]; },
            watcher: { add: async path => watched.add(path), remove: async path => watched.delete(path) }
        },
        client: { fetch: async (url, options) => {
            if (url === '/api/system/getConf') return { json: async () => ({}) };
            if (url === '/api/file/getFile') return { ok: false, status: 404, json: async () => ({ code: 404 }) };
            if (url === '/api/file/putFile') return { ok: true, status: 200, json: async () => ({ code: 0 }) };
            assert.equal(url, '/api/network/forwardProxy');
            const request = JSON.parse(options.body);
            if (request.url === 'https://mail.example.invalid/emails') {
                emails.push(JSON.parse(request.payload));
                return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: '{"id":"email-1"}' } }) };
            }
            sends++;
            return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: '{}' } }) };
        } },
        rpc: { bind: async (name, handler) => rpc.set(name, handler), unbind: async name => rpc.delete(name),
            broadcast: async (method, params) => broadcasts.push({ method, params }) },
        agent: { registerCapability: async (name, _config, handler) => { capabilities.set(name, handler); return { name }; },
            unregisterCapability: async name => { capabilities.delete(name); } },
        logger: { info: async () => {}, debug: async () => {}, warn: async () => {}, error: async (...args) => errors.push(args) }
    };
    global.siyuan = runtime;
    try {
        await import(pathToFileURL(path.resolve(__dirname, '../dist/kernel.js')).href);
        await runtime.plugin.lifecycle.onload();
        assert.ok(watched.has('.'));
        assert.ok(rpc.has('refresh-reminder-schedule'));
        assert.ok(rpc.has('test-email'));
        assert.ok(rpc.has('commit-pomodoro-records'));
        assert.equal(sends, 0);
        t.mock.timers.tick(30_000); await flush();
        assert.equal(sends, 1);
        assert.equal(emails.length, 1);
        assert.match(emails[0].text, /无页面任务/);
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
        assert.equal(emails.length, 2);
        assert.match(emails[1].text, /修改时间/);
        assert.equal(errors.length, 0);

        // 前端 RPC 与 MCP 走同一个真实内核写入队列，陈旧快照不能覆盖另一端的新会话。
        const date = '2026-10-08';
        const original = { id: 'original', eventId: 'task', eventTitle: 'task', type: 'work',
            startTime: `${date}T10:00:00`, endTime: `${date}T10:25:00`, duration: 25, plannedDuration: 25, count: 1, completed: true };
        const base = { date, sessions: [original], workSessions: 1, totalWorkTime: 25, totalBreakTime: 0 };
        files[`pomodoroRecords/${date}.json`] = JSON.stringify(base);
        const stats = capabilities.get('stats');
        assert.equal((await stats({ action: 'get_focuses_by_time', startDate: date, endDate: date })).data.length, 1);
        const frontendSession = { ...original, id: 'frontend' };
        const [, mcp] = await Promise.all([
            rpc.get('commit-pomodoro-records')({ changes: [{ date, base, next: {
                ...base, sessions: [original, frontendSession], workSessions: 2, totalWorkTime: 50,
            } }] }),
            stats({ action: 'create_focus', type: 'work', eventId: 'task', startTime: `${date}T11:00:00`, endTime: `${date}T11:25:00` }),
        ]);
        assert.equal(mcp.success, true);
        const saved = JSON.parse(files[`pomodoroRecords/${date}.json`]);
        assert.equal(saved.sessions.length, 3);
        assert.ok(saved.sessions.some(session => session.id === 'frontend'));
        assert.ok(saved.sessions.some(session => session.id === mcp.data.id));
        assert.equal(saved.totalWorkTime, 75);

        // 自然日文件中的凌晨专注属于前一逻辑日；后台习惯提醒必须使用索引。
        files['habit.json'] = JSON.stringify({ focused: { id: 'focused', title: '凌晨已达标', startDate: date,
            goalType: 'pomodoro', target: 25, reminderTimes: ['09:32'], frequency: { type: 'daily' } } });
        const early = { ...original, id: 'early', eventId: 'focused', startTime: '2026-10-09T01:00:00', endTime: '2026-10-09T01:25:00' };
        files['pomodoroRecords/2026-10-09.json'] = JSON.stringify({ date: '2026-10-09', sessions: [early],
            workSessions: 1, totalWorkTime: 25, totalBreakTime: 0 });
        await runtime.event.handler({ type: 'fs-notify', detail: { path: 'habit.json' } });
        t.mock.timers.tick(250); await flush();
        t.mock.timers.tick(59_750); await flush();
        assert.equal(sends, 2, '达标习惯不能因数据存放在次日文件而误报');
        assert.equal(emails.length, 2);
        const earlyFocus = (await stats({ action: 'get_focuses_by_time', startDate: date, endDate: date })).data;
        assert.ok(earlyFocus.some(session => session.id === 'early'));
        assert.equal(errors.length, 0);
    } finally {
        await runtime.plugin.lifecycle.onunload();
        global.siyuan = original;
    }
    assert.equal(rpc.size, 0);
    assert.equal(watched.size, 0);
    assert.equal(runtime.event.handler, null);
    assert.equal(capabilities.size, 0);
    t.mock.timers.tick(60_000); await flush();
    assert.equal(sends, 2);
    assert.equal(emails.length, 2);
});
