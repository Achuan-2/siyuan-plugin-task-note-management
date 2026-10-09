const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const load = createKernelLoader();
const { sendKernelEmail, normalizeEmailSettings, DEFAULT_EMAIL_SETTINGS } = load('src/services/emailNotification.ts');
const { KernelReminderService, EMAIL_STATE_FILE, WEBHOOK_STATE_FILE } = load('src/kernel/reminderService.ts');
const { DesktopEmailService } = load('src/services/DesktopEmailService.ts');
const { buildSmtpOptions } = load('src/services/emailNotification.ts');
const { FRONTEND_REMINDER_STATE_FILE } = load('src/kernel/frontendReminderDelivery.ts');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const emailSettings = {
    ...DEFAULT_EMAIL_SETTINGS, reminderEmailEnabled: true,
    reminderEmailTransport: 'api', reminderEmailProvider: 'smtp2go',
    reminderEmailApiKey: 'test-api-key', reminderEmailFrom: 'sender@example.com', reminderEmailTo: 'recipient@example.com'
};
const now = () => new Date('2026-10-08T09:30:10');

function fixture(extra = {}) {
    const files = {
        'reminder-settings.json': { ...emailSettings, todayStartTime: '03:00' },
        'reminder.json': { task: { id: 'task', title: '到点任务', date: '2026-10-08', time: '09:30' } },
        ...clone(extra)
    };
    const requests = [], errors = [];
    let emailFailure = false, webhookFailure = false;
    const storage = {
        loadData: async filename => clone(files[filename]),
        saveData: async (filename, value) => { files[filename] = clone(value); },
        readDir: async () => []
    };
    const client = { fetch: async (url, options) => {
        assert.equal(url, '/api/network/forwardProxy');
        const request = JSON.parse(options.body);
        request.payload = JSON.parse(request.payload);
        requests.push(request);
        const isEmail = request.url.includes('smtp2go');
        const body = isEmail ? { data: { succeeded: emailFailure ? 0 : 1, failed: emailFailure ? 1 : 0 } }
            : { errcode: webhookFailure ? 93000 : 0 };
        return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: JSON.stringify(body) } }) };
    } };
    const logger = { info: async () => {}, warn: async message => errors.push(message), error: async message => errors.push(message) };
    return {
        scheduler: new KernelReminderService(storage, client, logger), files, storage, client, logger, requests, errors,
        setEmailFailure: value => { emailFailure = value; }, setWebhookFailure: value => { webhookFailure = value; }
    };
}

test('邮箱设置默认关闭并兼容没有邮箱配置的旧设置', () => {
    assert.deepEqual(normalizeEmailSettings({}), DEFAULT_EMAIL_SETTINGS);
    assert.equal(normalizeEmailSettings({ reminderEmailProvider: 'unknown' }).reminderEmailProvider, 'custom');
    assert.equal(normalizeEmailSettings({ reminderEmailTo: '  user@example.com ' }).reminderEmailTo, 'user@example.com');
    assert.equal(normalizeEmailSettings({}).reminderEmailTransport, 'smtp');
    assert.equal(normalizeEmailSettings({ reminderEmailProvider: 'resend', reminderEmailApiKey: 'legacy-key' }).reminderEmailTransport, 'api');
});

test('SMTP 支持 SSL/TLS 和强制 STARTTLS，用户名回退到发件邮箱并保留授权码', () => {
    const settings = normalizeEmailSettings({ ...emailSettings, reminderEmailTransport: 'smtp',
        reminderEmailSmtpHost: 'smtp.example.com', reminderEmailSmtpPassword: ' app password ' });
    const tls = buildSmtpOptions(settings);
    assert.equal(tls.port, 465);
    assert.equal(tls.secure, true);
    assert.equal(tls.auth.user, 'sender@example.com');
    assert.equal(tls.auth.pass, ' app password ');
    const starttls = buildSmtpOptions({ ...settings, reminderEmailSmtpPort: 587, reminderEmailSmtpSecurity: 'starttls' });
    assert.equal(starttls.secure, false);
    assert.equal(starttls.requireTLS, true);
    assert.throws(() => buildSmtpOptions({ ...settings, reminderEmailSmtpPort: 65536 }), /emailSmtpPortInvalid/);
    assert.throws(() => buildSmtpOptions({ ...settings, reminderEmailSmtpHost: 'https://smtp.example.com' }), /emailSmtpHostRequired/);
});

test('SMTP2GO、Resend 和自定义服务使用各自认证及完整纯文本邮件', async () => {
    for (const provider of ['smtp2go', 'resend', 'custom']) {
        const requests = [];
        const settings = { ...emailSettings, reminderEmailProvider: provider, reminderEmailApiUrl: 'https://mail.example.com/send' };
        const client = { fetch: async (url, options) => {
            assert.equal(url, '/api/network/forwardProxy');
            requests.push(JSON.parse(options.body));
            const body = provider === 'smtp2go' ? { data: { succeeded: 1, failed: 0, failures: [] } } : { id: 'email-1' };
            return { ok: true, json: async () => ({ code: 0, data: { status: 200, body: JSON.stringify(body) } }) };
        } };
        const message = '任务 "引号"\n第二行 \\ 反斜杠';
        await sendKernelEmail(client, settings, '标题\r\n测试', message, 'daily_2026-10-08');
        const request = requests[0], payload = JSON.parse(request.payload), headers = request.headers[0];
        assert.equal(payload.subject, '标题 测试');
        assert.deepEqual(payload.to, ['recipient@example.com']);
        if (provider === 'smtp2go') {
            assert.equal(request.url, 'https://api.smtp2go.com/v3/email/send');
            assert.equal(headers['X-Smtp2go-Api-Key'], 'test-api-key');
            assert.equal(payload.sender, 'sender@example.com');
            assert.equal(payload.text_body, message);
        } else {
            assert.equal(headers.Authorization, 'Bearer test-api-key');
            assert.equal(headers['Idempotency-Key'], 'task-note-daily_2026-10-08');
            assert.equal(payload.from, 'sender@example.com');
            assert.equal(payload.text, message);
            assert.equal(request.url, provider === 'resend' ? 'https://api.resend.com/emails' : settings.reminderEmailApiUrl);
        }
    }
});

test('配置无效时不发送网络请求，拒绝邮件头注入与无效协议', async () => {
    const client = { fetch: async () => assert.fail('invalid settings must not send') };
    for (const [patch, error] of [
        [{ reminderEmailFrom: 'invalid' }, /emailFromRequired/],
        [{ reminderEmailFrom: 'user@example.com\r\nBcc: other@example.com' }, /emailFromRequired/],
        [{ reminderEmailTo: '' }, /emailToRequired/],
        [{ reminderEmailTo: 'one@example.com,two@example.com' }, /emailToRequired/],
        [{ reminderEmailApiKey: '' }, /emailApiKeyRequired/],
        [{ reminderEmailApiKey: 'key\r\nInjected: true' }, /emailApiKeyRequired/],
        [{ reminderEmailProvider: 'custom', reminderEmailApiUrl: 'file:///tmp/mail' }, /emailApiUrlInvalid/],
        [{ reminderEmailProvider: 'custom', reminderEmailApiUrl: 'https://user:pass@example.com' }, /emailApiUrlInvalid/]
    ]) {
        await assert.rejects(sendKernelEmail(client, { ...emailSettings, ...patch }, '标题', '正文'), error);
    }
});

test('邮箱传输检查代理、HTTP 和服务业务结果，不把空响应或部分失败当成功', async () => {
    const proxy = (status, body) => ({ ok: true, json: async () => ({ code: 0, data: { status, body } }) });
    const responses = [
        { ok: false, status: 403 }, proxy(500, '{}'), { ok: true, json: async () => ({ code: 1 }) },
        proxy(200, ''), proxy(200, '{}'), proxy(200, '{"data":{"succeeded":0,"failed":1}}'),
        proxy(200, '{"data":{"succeeded":1,"failed":0,"error":"failure"}}'),
        proxy(200, '{"data":{"succeeded":1,"failed":0,"failures":["failure"]}}')
    ];
    for (const response of responses) {
        await assert.rejects(sendKernelEmail({ fetch: async () => response }, emailSettings, '标题', '正文'));
    }
    await assert.rejects(sendKernelEmail({ fetch: async () => proxy(200, '{"message":"failure"}') },
        { ...emailSettings, reminderEmailProvider: 'resend' }, '标题', '正文'), /emailResponseInvalid/);
});

test('仅启用邮箱时后台发送，扫描、重启与前端确认均不重复发信', async () => {
    assert.equal(typeof window, 'undefined');
    const f = fixture();
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.text_body, /09:30 到点任务/);
    assert.equal(Object.keys(f.files[EMAIL_STATE_FILE].sent).length, 1);
    assert.equal(f.files[WEBHOOK_STATE_FILE], undefined);
    const key = Object.keys(f.files[FRONTEND_REMINDER_STATE_FILE].events)[0];
    await f.scheduler.claimFrontendEvent(key, 'window');
    await f.scheduler.acknowledgeFrontendEvent(key, 'window');
    await f.scheduler.check(now());
    await new KernelReminderService(f.storage, f.client, f.logger).check(now());
    assert.equal(f.requests.length, 1);
});

test('关闭邮箱不发送，修改收件邮箱立即生效，测试邮件不需要启用自动通知', async () => {
    const f = fixture();
    f.files['reminder-settings.json'].reminderEmailEnabled = false;
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 0);
    await f.scheduler.testEmail({ ...emailSettings, reminderEmailEnabled: false });
    assert.equal(f.requests.length, 1);
    assert.match(f.requests[0].payload.subject, /邮箱通知测试/);
    Object.assign(f.files['reminder-settings.json'], { reminderEmailEnabled: true, reminderEmailTo: 'new@example.com' });
    await f.scheduler.check(now());
    assert.deepEqual(f.requests[1].payload.to, ['new@example.com']);
});

test('邮箱失败跨分钟和重启重试，不重复发送成功的 Webhook', async () => {
    const f = fixture();
    Object.assign(f.files['reminder-settings.json'], {
        reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid/webhook', reminderWebhookJsonType: 'wecom'
    });
    f.setEmailFailure(true);
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 2);
    assert.equal(Object.keys(f.files[EMAIL_STATE_FILE].pending).length, 1);
    assert.equal(Object.keys(f.files[WEBHOOK_STATE_FILE].sent).length, 1);
    const restart = new KernelReminderService(f.storage, f.client, f.logger);
    const retryPlan = await restart.readSchedule(now());
    assert.equal(retryPlan.retryAt.getTime(), now().getTime() + 30_000);
    f.setEmailFailure(false);
    await restart.check(new Date('2026-10-08T09:31:10'));
    assert.equal(f.requests.length, 3);
    assert.equal(f.requests.filter(item => item.url.includes('example.invalid')).length, 1);
    assert.equal(Object.keys(f.files[EMAIL_STATE_FILE].pending).length, 0);
});

test('Webhook 状态损坏或发送失败也不阻止邮箱发送', async () => {
    for (const corrupt of [false, true]) {
        const f = fixture(corrupt ? { [WEBHOOK_STATE_FILE]: { invalid: true } } : {});
        Object.assign(f.files['reminder-settings.json'], {
            reminderWebhookEnabled: true, reminderWebhookUrl: 'https://example.invalid/webhook', reminderWebhookJsonType: 'wecom'
        });
        f.setWebhookFailure(true);
        await f.scheduler.check(now());
        assert.equal(Object.keys(f.files[EMAIL_STATE_FILE].sent).length, 1);
        assert.equal(f.requests.filter(item => item.url.includes('smtp2go')).length, 1);
    }
});

test('任务完成、习惯打卡或超过重试窗口后取消失败邮件', async () => {
    for (const kind of ['task', 'habit', 'expired']) {
        const f = fixture(kind === 'habit' ? {
            'reminder.json': {}, 'habit.json': { habit: {
                id: 'habit', title: '习惯', startDate: '2026-10-01', target: 1,
                reminderTimes: ['09:30'], frequency: { type: 'daily' }
            } }
        } : {});
        f.setEmailFailure(true);
        await f.scheduler.check(now());
        assert.equal(f.requests.length, 1);
        if (kind === 'habit') f.files['habitCheckin/habit.json'] = { checkIns: { '2026-10-08': { count: 1 } } };
        if (kind === 'task') f.files['reminder.json'].task.completed = true;
        f.setEmailFailure(false);
        await f.scheduler.check(new Date(kind === 'expired' ? '2026-10-08T09:36:10' : '2026-10-08T09:31:10'));
        assert.equal(f.requests.length, 1);
        assert.equal(Object.keys(f.files[EMAIL_STATE_FILE].pending).length, 0);
    }
});

test('每日邮件完整发送 12 条任务并独立去重', async () => {
    const tasks = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index), {
        id: String(index), title: `每日任务 ${String(index + 1).padStart(2, '0')}`, date: '2026-10-08'
    }]));
    const f = fixture({ 'reminder.json': tasks });
    Object.assign(f.files['reminder-settings.json'], { dailyNotificationEnabled: true, dailyNotificationTime: '08:00' });
    await f.scheduler.check(now());
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].payload.subject, '📅 今日任务提醒 (12)');
    assert.equal(f.requests[0].payload.text_body.split('\n').length, 12);
    assert.match(f.requests[0].payload.text_body, /每日任务 12/);
    assert.ok(f.files[EMAIL_STATE_FILE].sent['daily_2026-10-08']);
});

function smtpFixture() {
    const f = fixture();
    Object.assign(f.files['reminder-settings.json'], {
        reminderEmailTransport: 'smtp', reminderEmailSmtpHost: 'smtp.example.com', reminderEmailSmtpPassword: 'test-password'
    });
    return f;
}

test('SMTP 模式只入队，邮件领取独立于系统弹窗，两个窗口不会同时领取', async () => {
    const f = smtpFixture();
    const keys = await f.scheduler.getDesktopEmailEvents(now());
    assert.equal(keys.length, 1);
    assert.equal(f.requests.length, 0);
    await f.scheduler.claimFrontendEvent(keys[0], 'window-a');
    await f.scheduler.acknowledgeFrontendEvent(keys[0], 'window-a');
    const claims = await Promise.all(['window-a', 'window-b'].map(owner => f.scheduler.claimDesktopEmail(keys[0], owner, now())));
    assert.equal(claims.filter(Boolean).length, 1);
    const owner = f.files[EMAIL_STATE_FILE].pending[keys[0]].desktopClaim.owner;
    await f.scheduler.finishDesktopEmail(keys[0], 'wrong-owner', true, now());
    assert.equal(Object.keys(f.files[EMAIL_STATE_FILE].sent).length, 0);
    await f.scheduler.finishDesktopEmail(keys[0], owner, true, now());
    assert.ok(f.files[EMAIL_STATE_FILE].sent[keys[0]]);
    assert.deepEqual(await f.scheduler.getDesktopEmailEvents(now()), []);
});

test('SMTP 领取租约跨内核重启保留，过期后可重新领取', async () => {
    const f = smtpFixture();
    const [key] = await f.scheduler.getDesktopEmailEvents(now());
    await f.scheduler.claimDesktopEmail(key, 'window-a', now());
    const restart = new KernelReminderService(f.storage, f.client, f.logger);
    assert.equal(await restart.claimDesktopEmail(key, 'window-b', now()), null);
    assert.ok(await restart.claimDesktopEmail(key, 'window-b', new Date(now().getTime() + 91_000)));
});

test('SMTP 失败安排重试，任务完成和关闭邮件通知后不再领取', async () => {
    const f = smtpFixture();
    const [key] = await f.scheduler.getDesktopEmailEvents(now());
    await f.scheduler.claimDesktopEmail(key, 'window-a', now());
    await f.scheduler.finishDesktopEmail(key, 'window-a', false, now());
    assert.deepEqual(await f.scheduler.getDesktopEmailEvents(new Date(now().getTime() + 10_000)), []);
    const retryAt = new Date(now().getTime() + 31_000);
    assert.deepEqual(await f.scheduler.getDesktopEmailEvents(retryAt), [key]);
    f.files['reminder-settings.json'].reminderEmailEnabled = false;
    assert.deepEqual(await f.scheduler.getDesktopEmailEvents(retryAt), []);
    f.files['reminder-settings.json'].reminderEmailEnabled = true;
    f.files['reminder.json'].task.completed = true;
    assert.deepEqual(await f.scheduler.getDesktopEmailEvents(retryAt), []);
});

test('切换 SMTP/API 时共享邮件去重，并等待正在发送的 SMTP 领取结束', async () => {
    const f = smtpFixture();
    const [key] = await f.scheduler.getDesktopEmailEvents(now());
    await f.scheduler.claimDesktopEmail(key, 'window-a', now());
    f.files['reminder-settings.json'].reminderEmailTransport = 'api';
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 0);
    await f.scheduler.finishDesktopEmail(key, 'window-a', true, now());
    await f.scheduler.check(now());
    assert.equal(f.requests.length, 0);
    const pending = smtpFixture();
    await pending.scheduler.check(now());
    pending.files['reminder-settings.json'].reminderEmailTransport = 'api';
    await pending.scheduler.check(now());
    assert.equal(pending.requests.length, 1);
});

test('桌面 SMTP 接收器独立发送、确认并在卸载时解绑，浏览器不启动', async () => {
    const f = smtpFixture(), handlers = new Map(), sends = [];
    let closed = 0;
    const call = (method, params) => method === 'get-smtp-email-events' ? f.scheduler.getDesktopEmailEvents(now())
        : method === 'claim-smtp-email' ? f.scheduler.claimDesktopEmail(params.key, params.owner, now())
        : f.scheduler.finishDesktopEmail(params.key, params.owner, params.sent, now());
    const host = {
        owner: 'desktop', canSend: () => true, call,
        bind: (method, handler) => handlers.set(method, handler), unbind: method => handlers.delete(method),
        send: async (settings, title, message) => sends.push({ settings, title, message }),
        close: () => closed++, onError: () => assert.fail('unexpected delivery failure')
    };
    const service = new DesktopEmailService(host);
    service.start();
    await service.recover();
    await service.recover();
    assert.equal(sends.length, 1);
    assert.match(sends[0].message, /到点任务/);
    service.stop();
    assert.equal(handlers.size, 0);
    assert.equal(closed, 1);
    new DesktopEmailService({ ...host, canSend: () => false }).start();
    assert.equal(handlers.size, 0);
});
