const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const load = createKernelLoader();
const { KernelReminderService, WEBHOOK_STATE_FILE } = load('src/kernel/reminderService.ts');
const { FRONTEND_REMINDER_STATE_FILE } = load('src/kernel/frontendReminderDelivery.ts');

function fixture(extra = {}) {
    const files = {
        'reminder-settings.json': {
            reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid/webhook',
            reminderWebhookJsonType: 'wecom', todayStartTime: '03:00'
        },
        'reminder.json': { task: { id: 'task', title: '到点任务', date: '2026-10-08', time: '09:30', completed: false } },
        ...clone(extra)
    };
    const requests = [];
    const warnings = [];
    let failure = false;
    const storage = {
        async loadData(filename) { return clone(files[filename]); },
        async saveData(filename, data) { files[filename] = clone(data); },
        async readDir() { return []; }
    };
    const client = {
        async fetch(url, options) {
            if (url === '/api/system/getConf') return { json: async () => ({ data: { conf: { lang: 'zh_CN' } } }) };
            assert.equal(url, '/api/network/forwardProxy');
            const request = JSON.parse(options.body);
            requests.push({ ...request, payload: JSON.parse(request.payload) });
            return { ok: true, json: async () => ({ code: 0, data: {
                status: 200, body: failure ? '{"errcode":93000,"errmsg":"test failure"}' : '{"errcode":0}'
            } }) };
        }
    };
    const logger = { info: async () => {}, error: async () => {}, warn: async message => warnings.push(message) };
    const scheduler = new KernelReminderService(storage, client, logger);
    return { scheduler, files, requests, warnings, storage, client, logger, setFailure(value) { failure = value; } };
}

const now = () => new Date('2026-10-08T09:30:10');

test('没有 window/document 的内核独立发送，重复扫描和重启均不重复发送', async () => {
    assert.equal(typeof window, 'undefined');
    const f = fixture();
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].timeout, 8000);
    assert.match(f.requests[0].payload.text.content, /09:30 到点任务/);
    await f.scheduler.check(now());
    const restarted = new KernelReminderService(f.storage, f.client, f.logger);
    await restarted.check(now());
    assert.equal(f.requests.length, 1);
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].sent).length, 1);
});

test('失败通知跨分钟、重启后重试，成功后才标记已发送', async () => {
    const f = fixture();
    f.setFailure(true);
    await f.scheduler.check(now());
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].sent).length, 0);
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].pending).length, 1);
    f.setFailure(false);
    const restarted = new KernelReminderService(f.storage, f.client, f.logger);
    await restarted.check(new Date('2026-10-08T09:31:10'));
    assert.equal(f.requests.length, 2);
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].pending).length, 0);
});

test('修改设置立即生效，关闭 Webhook 后不再发送', async () => {
    const f = fixture();
    f.files['reminder-settings.json'].reminderWebhookEnabled = false;
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 0);
    f.files['reminder-settings.json'].reminderWebhookEnabled = true;
    f.files['reminder-settings.json'].reminderWebhookUrl = 'https://example.invalid/new';
    await f.scheduler.check(now());
    assert.equal(f.requests[0].url, 'https://example.invalid/new');
});

test('任务完成后取消失败重试，已完成和放弃的任务均不发送', async () => {
    const f = fixture();
    f.setFailure(true);
    await f.scheduler.check(now());
    f.files['reminder.json'].task.completed = true;
    f.setFailure(false);
    await f.scheduler.check(new Date('2026-10-08T09:31:10'));
    assert.equal(f.requests.length, 1);
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].pending).length, 0);
});

test('周末、节假日和明确日期的提前提醒使用共用扫描规则', async () => {
    const f = fixture({
        'reminder.json': {
            advance: { id: 'advance', title: '提前提醒', date: '2026-10-09', reminderTimes: [{ time: '2026-10-08T09:30', note: '提前一天' }] },
            skipped: { id: 'skipped', title: '跳过假日', date: '2026-10-07', endDate: '2026-10-09', time: '09:30', reminderSkipHolidays: true }
        },
        'holiday.json': { '2026-10-08': { type: 'holiday' } }
    });
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.text.content, /提前提醒（提前一天）/);
});

test('移动过日期的重复实例保留原始 ID，完成或删除实例不发送', async () => {
    const f = fixture({ 'reminder.json': {
        repeat: { id: 'repeat', title: '重复任务', date: '2026-10-01', time: '09:30',
            repeat: { enabled: true, type: 'weekly', interval: 1, weekdays: [4], instances: {
                '2026-10-01': { date: '2026-10-08', title: '移动后的实例' },
                '2026-10-08': { completed: true },
                '2026-09-24': { date: '2026-10-08', deleted: true }
            } }
        }
    } });
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.text.content, /移动后的实例/);
    assert.match(Object.keys(f.files[WEBHOOK_STATE_FILE].sent)[0], /repeat_2026-10-01/);
});

test('习惯读取独立打卡文件，已完成及番茄时长达标的习惯不提醒', async () => {
    const f = fixture({
        'reminder.json': {},
        'habit.json': {
            pending: { id: 'pending', title: '待打卡习惯', startDate: '2026-10-01', target: 1, reminderTimes: ['09:30'], frequency: { type: 'daily' } },
            done: { id: 'done', title: '已打卡', startDate: '2026-10-01', target: 1, reminderTimes: ['09:30'], frequency: { type: 'daily' } },
            focused: { id: 'focused', title: '专注达标', startDate: '2026-10-01', goalType: 'pomodoro', target: 25, reminderTimes: ['09:30'], frequency: { type: 'daily' } }
        },
        'habitCheckin/done.json': { checkIns: { '2026-10-08': { count: 1, status: ['✅'] } } },
        'pomodoroRecords/2026-10-08.json': { sessions: [{ type: 'work', eventId: 'focused', duration: 25 }] }
    });
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.text.content, /待打卡习惯/);
});

test('每日汇总单独去重，不会受前端通知记录影响', async () => {
    const f = fixture({ 'notify.json': { lastNotified: '2026-10-08' } });
    Object.assign(f.files['reminder-settings.json'], { dailyNotificationEnabled: true, dailyNotificationTime: '08:00' });
    f.files['reminder.json'].task.time = '';
    await f.scheduler.check(now());
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.text.content, /今日任务提醒/);
    assert.ok(f.files[WEBHOOK_STATE_FILE].sent['daily_2026-10-08']);
});

test('每日 Webhook 汇总完整列出所有任务，保留逾期、时间和分类信息', async () => {
    const tasks = Object.fromEntries(Array.from({ length: 12 }, (_, index) => {
        const id = `task-${index}`;
        return [id, {
            id, title: `任务 ${String(index + 1).padStart(2, '0')}`,
            date: index === 0 ? '2026-10-07' : '2026-10-08',
            endDate: index === 0 ? '2026-10-07' : undefined,
            time: index === 11 ? '10:00' : '', categoryName: '工作'
        }];
    }));
    for (const jsonType of ['wecom', 'feishu', 'custom']) {
        const f = fixture({ 'reminder.json': tasks });
        Object.assign(f.files['reminder-settings.json'], {
            dailyNotificationEnabled: true, dailyNotificationTime: '08:00',
            reminderWebhookJsonType: jsonType,
            reminderWebhookJsonTemplate: '{"text":"${title}\\n${message}","count":"${count}"}'
        });
        await f.scheduler.check(now());
        await f.scheduler.check(now());
        assert.equal(f.requests.length, 1);
        const payload = f.requests[0].payload;
        const content = jsonType === 'wecom' ? payload.text.content
            : jsonType === 'feishu' ? payload.content.text : payload.text;
        const [title, ...lines] = content.split('\n');
        assert.equal(title, '📅 今日任务提醒 (12)');
        assert.equal(lines.length, 12);
        for (const task of Object.values(tasks)) {
            assert.ok(lines.some(line => line.includes(`• ${task.title}`) && line.endsWith('[工作]')));
        }
        assert.ok(lines.includes('⚠️ • 任务 01 [工作]'));
        assert.ok(lines.includes('• 任务 12 ⏰10:00 [工作]'));
        assert.doesNotMatch(content, /还有|\.\.\./);
        if (jsonType === 'custom') assert.equal(payload.count, '12');
    }
});

test('并发扫描共用当前扫描，卸载会清理所有定时器', async () => {
    const f = fixture();
    await Promise.all([f.scheduler.check(now()), f.scheduler.check(now())]);
    assert.equal(f.requests.length, 1);
    await f.scheduler.start();
    await f.scheduler.stop();
    assert.equal(f.scheduler.cron.jobs.size, 0);
    assert.equal(f.scheduler.cron.changeTimer, null);
});

test('订阅日历任务也会提醒，禁用的订阅不读取任务', async () => {
    const f = fixture({
        'reminder.json': {},
        'ics-subscriptions.json': { subscriptions: { calendar: { id: 'calendar', enabled: true }, disabled: { id: 'disabled', enabled: false } } },
        'Subscribe/calendar.json': { event: { id: 'event', title: '订阅日历', date: '2026-10-08', time: '09:30' } },
        'Subscribe/disabled.json': { ignored: { id: 'ignored', title: '禁用订阅', date: '2026-10-08', time: '09:30' } }
    });
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.text.content, /订阅日历/);
});

test('失败习惯已打卡后不再重试，过期失败通知也不会补发', async () => {
    const f = fixture({
        'reminder.json': {},
        'habit.json': { habit: { id: 'habit', title: '习惯', startDate: '2026-10-01', target: 1, reminderTimes: ['09:30'], frequency: { type: 'daily' } } }
    });
    f.setFailure(true);
    await f.scheduler.check(now());
    f.files['habitCheckin/habit.json'] = { checkIns: { '2026-10-08': { count: 1 } } };
    f.setFailure(false);
    await f.scheduler.check(new Date('2026-10-08T09:31:10'));
    assert.equal(f.requests.length, 1);
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].pending).length, 0);

    const task = fixture();
    task.setFailure(true);
    await task.scheduler.check(now());
    task.setFailure(false);
    await task.scheduler.check(new Date('2026-10-08T09:36:10'));
    assert.equal(task.requests.length, 1);
});

test('关键文件读取失败会终止扫描，不能当成空记录重复发送', async () => {
    const f = fixture();
    const read = f.storage.loadData;
    f.storage.loadData = async (filename, strict) => {
        if (filename === FRONTEND_REMINDER_STATE_FILE) {
            assert.equal(strict, true);
            throw new Error('state unreadable');
        }
        return read(filename);
    };
    await assert.rejects(f.scheduler.check(now()), /state unreadable/);
    assert.equal(f.requests.length, 0);
});

test('内核生命周期注册测试 RPC 并启动调度；管理工具失败不影响后台通知', async () => {
    const f = fixture();
    const rpc = new Map();
    const lifecycle = {};
    const messages = [];
    const siyuan = {
        plugin: { lifecycle }, client: f.client,
        logger: { ...f.logger, info: async message => messages.push(message) },
        rpc: { bind: async (name, handler) => rpc.set(name, handler), unbind: async name => rpc.delete(name) }
    };
    class FailingManager {
        static getInstance() { return new FailingManager(); }
        async initialize() { throw new Error('manager initialization failure'); }
    }
    const source = fs.readFileSync(path.join(__dirname, '../src/kernel.ts'), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    new Function('require', 'exports', 'siyuan', compiled)(name => {
        if (name === './kernel/storageAdapter') return { createKernelStorage: () => f.storage };
        if (name === './kernel/reminderService') return { KernelReminderService };
        if (name === './kernel/constants') return load('src/kernel/constants.ts');
        if (name === './kernel/tools/index') return { createMcpRegistry: () => [] };
        return new Proxy({}, { get: () => FailingManager });
    }, {}, siyuan);
    try {
        await lifecycle.onload();
        assert.ok(messages.some(message => message.includes('Reminder scheduler started')));
        assert.ok(rpc.has('test-webhook'));
        assert.ok(rpc.has('test-email'));
        assert.ok(rpc.has('refresh-reminder-schedule'));
        assert.equal(await rpc.get('test-webhook')({ url: 'https://example.invalid/webhook', jsonType: 'wecom' }), true);
        assert.equal(f.requests.length, 1);
    } finally {
        await lifecycle.onunload();
    }
    assert.equal(rpc.size, 0);
});
