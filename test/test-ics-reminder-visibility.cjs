const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const ICAL = require('ical.js');

process.env.TZ = 'Asia/Shanghai';
const root = path.resolve(__dirname, '..');
const now = Date.parse('2026-11-17T12:00:00+08:00');
class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
}
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function fixture(data, options = {}) {
    let settings = { icsDateFilter: 'all', icsTaskFilter: 'all', icsFileName: 'calendar', icsSyncMethod: 'siyuan', ...options };
    const files = new Map(), errors = [], uploads = [];
    const mocks = {
        'src/api.ts': {
            putFile: async (name, _directory, blob) => { files.set(name, blob); },
            getFileBlob: async name => files.get(name),
            pushMsg: async () => {}, pushErrMsg: async value => errors.push(value),
            getBlockKramdown: async () => ({ kramdown: '' }),
            uploadCloud: async paths => { uploads.push(paths); },
            forwardProxy: async (_url, _method, content) => { uploads.push(content); return { status: 201, body: '', headers: {} }; },
        },
        'src/pluginInstance.ts': { i18n: key => key },
        'src/utils/icsSubscription.ts': { loadHolidays: async () => ({}) },
        'src/utils/dateUtils.ts': {
            compareDateStrings: (a, b) => a.localeCompare(b), getLocalDateString: localDate,
            getLocalDateTimeString: date => date.toISOString(), getLocaleTag: () => 'zh-CN',
        },
    };
    const cache = new Map();
    const load = relative => {
        if (mocks[relative]) return mocks[relative];
        if (cache.has(relative)) return cache.get(relative);
        const exported = {}; cache.set(relative, exported);
        const filename = path.join(root, relative);
        const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
        }).outputText;
        new Function('exports', 'require', 'Date', 'window', 'CustomEvent', code)(exported, name => {
            if (name === 'siyuan') return { Constants: {} };
            if (name === '@aws-sdk/client-s3') return { S3Client: class { async send(command) { uploads.push(command); } }, PutObjectCommand: class { constructor(input) { this.input = input; } } };
            if (name === '@aws-sdk/s3-request-presigner') return {};
            if (!name.startsWith('.')) return require(name);
            const target = path.relative(root, path.resolve(path.dirname(filename), name)).replaceAll('\\', '/');
            return load(target.endsWith('.ts') ? target : `${target}.ts`);
        }, Clock, { siyuan: { user: { userId: 'test' } }, dispatchEvent() {} }, class {});
        return exported;
    };
    const plugin = { loadReminderData: async () => structuredClone(data), loadSettings: async () => ({ ...settings }),
        saveSettings: async value => { settings = { ...value }; } };
    const exporter = load('src/utils/icsExport.ts');
    const result = async () => {
        assert.deepEqual(errors, []);
        const text = await files.get('data/storage/petal/siyuan-plugin-task-note-management/reminders.ics').text();
        return { text, events: new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent') };
    };
    return { uploads, files, load,
        export: async () => { await exporter.exportIcsFile(plugin, false, true, settings.icsTaskFilter); return result(); },
        upload: async () => { await exporter.uploadIcsToCloud(plugin, settings, true); return result(); },
    };
}

const task = patch => ({ id: 'task', title: '任务', date: '2026-11-17', time: '14:00', completed: false,
    reminderTimes: [{ time: '2026-11-17T13:50', note: '准备' }], ...patch });
const reminders = events => events.filter(event => event.getFirstPropertyValue('summary').startsWith('⏰'));
const tasks = events => events.filter(event => !event.getFirstPropertyValue('summary').startsWith('⏰'));
const alarms = event => event.getAllSubcomponents('valarm');
const dates = event => {
    const iterator = new ICAL.Event(event).iterator();
    return [iterator.next(), iterator.next()].filter(Boolean).map(time => localDate(time.toJSDate()));
};

test('仅未完成始终排除已完成任务的提醒，不受新开关取值影响', async () => {
    for (const hideCompleted of [true, false]) {
        const { events } = await fixture({ task: task({ completed: true }) }, {
            icsTaskFilter: 'uncompleted', icsHideCompletedReminderEvents: hideCompleted,
        }).export();
        assert.equal(events.length, 0);
    }
});

test('全部任务默认隐藏完成提醒，关闭选项后显示历史提醒且无内置闹钟', async () => {
    for (const hideCompleted of [undefined, true, false]) {
        const { events } = await fixture({ task: task({ completed: true }) }, { icsHideCompletedReminderEvents: hideCompleted }).export();
        assert.equal(tasks(events).length, 1);
        assert.equal(reminders(events).length, hideCompleted === false ? 1 : 0);
        assert.ok(events.every(event => alarms(event).length === 0));
    }
});

test('隐藏所有提醒保留任务及原始默认闹钟，父子任务和无日期任务均无提醒条目', async () => {
    const data = { task: task(), child: task({ id: 'child', parentId: 'task', title: '子任务' }),
        undated: task({ id: 'undated', date: undefined, time: undefined }) };
    const { events } = await fixture(data, { icsHideAllReminderEvents: true, icsHideCompletedReminderEvents: false }).export();
    assert.equal(tasks(events).length, 2);
    assert.equal(reminders(events).length, 0);
    assert.ok(tasks(events).every(event => alarms(event)[0].getFirstPropertyValue('trigger').toSeconds() === -900));
});

test('默认设置保留未完成任务原有的独立条目 UID、备注和开始时提醒', async () => {
    const { events } = await fixture({ task: task() }).export();
    assert.equal(events.length, 2);
    const reminder = reminders(events)[0];
    assert.equal(reminder.getFirstPropertyValue('uid'), 'task-reminder-0@siyuan');
    assert.equal(reminder.getFirstPropertyValue('description'), '准备');
    assert.equal(Math.abs(alarms(reminder)[0].getFirstPropertyValue('trigger').toSeconds()), 0);
});

test('仅已完成不泄漏未完成提醒；完成历史提醒按任务状态显示', async () => {
    let result = await fixture({ task: task() }, { icsTaskFilter: 'completed' }).export();
    assert.equal(result.events.length, 0);
    result = await fixture({ task: task({ completed: true }) }, { icsTaskFilter: 'completed', icsReminderVisibility: 'all' }).export();
    assert.equal(tasks(result.events).length, 1);
    assert.equal(reminders(result.events).length, 1);
    assert.equal(alarms(reminders(result.events)[0]).length, 0);
});

test('跨天每日提醒完成一天只排除该天，未来日期保留，取消完成后恢复', async () => {
    const data = { task: task({ endDate: '2026-11-20', reminderTimes: [{ time: '09:00', everyDay: true }],
        dailyCompletions: { '2026-11-17': true } }) };
    let { events } = await fixture(data, { icsTaskFilter: 'uncompleted', icsHideCompletedReminderEvents: false }).export();
    assert.deepEqual(dates(reminders(events)[0]), ['2026-11-18', '2026-11-19']);
    data.task.dailyCompletions['2026-11-17'] = false;
    ({ events } = await fixture(data, { icsTaskFilter: 'uncompleted' }).export());
    assert.deepEqual(dates(reminders(events)[0]), ['2026-11-17', '2026-11-18']);
});

test('重复任务实例完成后每日提醒排除当天，未来的重复提醒不消失', async () => {
    const data = { task: task({ reminderTimes: [{ time: '09:00', everyDay: true }],
        repeat: { enabled: true, type: 'daily', endType: 'never', instances: { '2026-11-17': { completed: true } } } }) };
    const { events } = await fixture(data, { icsTaskFilter: 'uncompleted' }).export();
    assert.deepEqual(dates(reminders(events)[0]), ['2026-11-18', '2026-11-19']);
    data.task.repeat.instances['2026-11-17'].completed = false;
    const restored = await fixture(data, { icsTaskFilter: 'uncompleted' }).export();
    assert.deepEqual(dates(reminders(restored.events)[0]), ['2026-11-17', '2026-11-18']);
});

test('全部任务关闭隐藏完成选项时，为完成的每日提醒生成无闹钟的单次覆盖', async () => {
    const { events } = await fixture({ task: task({ endDate: '2026-11-20', reminderTimes: [{ time: '09:00', everyDay: true }],
        dailyCompletions: { '2026-11-17': true } }) }, { icsHideCompletedReminderEvents: false }).export();
    const reminderEvents = reminders(events);
    assert.equal(reminderEvents.length, 2);
    const override = reminderEvents.find(event => event.hasProperty('recurrence-id'));
    assert.ok(override);
    assert.equal(override.getFirstPropertyValue('uid'), reminderEvents[0].getFirstPropertyValue('uid'));
    assert.equal(alarms(override).length, 0);
});

test('提前一天的重复任务提醒按所属实例完成状态隐藏', async () => {
    const data = { task: task({ reminderTimes: [{ time: '2026-11-16T09:00' }],
        repeat: { enabled: true, type: 'daily', endType: 'never', instances: { '2026-11-17': { completed: true } } } }) };
    const { events } = await fixture(data, { icsTaskFilter: 'uncompleted' }).export();
    assert.equal(reminders(events).length, 0);
});

test('改期完成实例按实际发生日期隐藏每日提醒，其他日期保留', async () => {
    const { events } = await fixture({ task: task({ reminderTimes: [{ time: '09:00', everyDay: true }],
        repeat: { enabled: true, type: 'daily', endType: 'never', instances: { '2026-11-16': { date: '2026-11-17', completed: true } } } }) },
        { icsTaskFilter: 'uncompleted' }).export();
    assert.deepEqual(dates(reminders(events)[0]), ['2026-11-18', '2026-11-19']);
});

test('父子任务的完成筛选分别生效，隐藏日历任务的提醒不泄漏', async () => {
    const { events } = await fixture({ task: task(), child: task({ id: 'child', parentId: 'task', completed: true }),
        hidden: task({ id: 'hidden', hideInCalendar: true }),
    }, { icsTaskFilter: 'uncompleted', icsHideCompletedReminderEvents: false }).export();
    assert.equal(reminders(events).length, 1);
    assert.equal(reminders(events)[0].getFirstPropertyValue('uid'), 'task-reminder-0@siyuan');
});

test('设置同时影响手动导出和三个云端上传目标', async () => {
    for (const method of ['siyuan', 'webdav', 's3']) {
        const f = fixture({ task: task() }, { icsHideAllReminderEvents: true, icsSyncMethod: method,
            webdavUrl: 'https://example.test/', s3Endpoint: 'http://127.0.0.1:9000', s3Bucket: 'test', s3AccessKeyId: 'test', s3AccessKeySecret: 'test' });
        const { events } = await f.upload();
        assert.equal(f.uploads.length, 1);
        assert.equal(events.length, 1);
        assert.equal(reminders(events).length, 0);
    }
});

test('全部任务模式中开关只隐藏完成日期的提醒，任务日程始终保留', async () => {
    const data = { task: task({ endDate: '2026-11-19', reminderTimes: [{ time: '09:00', everyDay: true }],
        dailyCompletions: { '2026-11-17': true } }) };
    const { events } = await fixture(data, { icsHideCompletedReminderEvents: true }).export();
    assert.equal(tasks(events).length, 1);
    assert.deepEqual(dates(reminders(events)[0]), ['2026-11-18', '2026-11-19']);
});

test('仅已完成的每日提醒只输出完成日期，并遵守 ICS 日期范围', async () => {
    const data = { task: task({ date: '2026-11-01', endDate: '2026-11-30', reminderTimes: [{ time: '09:00', everyDay: true }],
        dailyCompletions: { '2026-11-01': true, '2026-11-17': true, '2026-11-25': true } }) };
    const { events } = await fixture(data, { icsTaskFilter: 'completed', icsDateFilter: 'lastWeek', icsReminderVisibility: 'all' }).export();
    assert.equal(reminders(events).length, 1);
    const reminder = reminders(events)[0];
    assert.equal(localDate(reminder.getFirstPropertyValue('dtstart').toJSDate()), '2026-11-17');
    assert.equal(reminder.hasProperty('rrule'), false);
    assert.equal(alarms(reminder).length, 0);
});

test('所有提醒隐藏开关优先，完成状态与已完成显示选项均不能恢复提醒', async () => {
    for (const filter of ['all', 'completed', 'uncompleted']) {
        const { events } = await fixture({ task: task({ completed: true }),
            undated: task({ id: 'undated', date: undefined, time: undefined, customReminderTime: '2026-11-17T09:00', reminderTimes: [] }) },
            { icsHideAllReminderEvents: true, icsHideCompletedReminderEvents: false, icsTaskFilter: filter }).export();
        assert.equal(reminders(events).length, 0);
        assert.equal(tasks(events).length, filter === 'uncompleted' ? 0 : 1);
    }
});

test('旧版自定义提醒和无日期完成任务也遵守两个开关', async () => {
    const data = { task: task({ date: undefined, time: undefined, reminderTimes: [],
        customReminderTime: '2026-11-17T09:00', completed: true }) };
    assert.equal((await fixture(data, { icsTaskFilter: 'uncompleted', icsHideCompletedReminderEvents: false }).export()).events.length, 0);
    assert.equal((await fixture(data, { icsHideCompletedReminderEvents: true }).export()).events.length, 0);
    const { events } = await fixture(data, { icsHideCompletedReminderEvents: false }).export();
    assert.equal(events.length, 1);
    assert.equal(alarms(events[0]).length, 0);
});

test('三选一显示设置直接控制提醒条目，与任务状态筛选取交集', async () => {
    for (const mode of ['all', 'hideCompleted', 'none']) {
        for (const filter of ['all', 'completed', 'uncompleted']) {
            for (const completed of [true, false]) {
                const { events } = await fixture({ task: task({ completed }) }, { icsTaskFilter: filter, icsReminderVisibility: mode }).export();
                const matchesTask = filter === 'all' || completed === (filter === 'completed');
                const matchesReminder = matchesTask && mode !== 'none' && (!completed || mode === 'all');
                assert.equal(reminders(events).length, matchesReminder ? 1 : 0, `${mode}/${filter}/${completed}`);
                assert.equal(tasks(events).length, matchesTask ? 1 : 0);
            }
        }
    }
});

test('三选一设置覆盖旧开关，新选择不被旧配置反弹', async () => {
    const { getIcsReminderVisibility } = fixture({}).load('src/utils/icsReminderVisibility.ts');
    assert.equal(getIcsReminderVisibility({}), 'hideCompleted');
    assert.equal(getIcsReminderVisibility({ icsHideAllReminderEvents: true }), 'none');
    assert.equal(getIcsReminderVisibility({ icsHideCompletedReminderEvents: false }), 'all');
    assert.equal(getIcsReminderVisibility({ icsHideCompletedReminderEvents: true }), 'hideCompleted');
    assert.equal(getIcsReminderVisibility({ icsReminderVisibility: 'all', icsHideAllReminderEvents: true }), 'all');
    assert.equal(getIcsReminderVisibility({ icsReminderVisibility: 'invalid' }), 'hideCompleted');
    const { events } = await fixture({ task: task({ completed: true }) }, {
        icsReminderVisibility: 'all', icsHideAllReminderEvents: true, icsHideCompletedReminderEvents: true,
    }).export();
    assert.equal(reminders(events).length, 1);
});

test('只看完成任务时，隐藏已完成模式也不输出完成日期的每日提醒', async () => {
    const { events } = await fixture({ task: task({ endDate: '2026-11-20', reminderTimes: [{ time: '09:00', everyDay: true }],
        dailyCompletions: { '2026-11-17': true } }) }, { icsTaskFilter: 'completed', icsReminderVisibility: 'hideCompleted' }).export();
    assert.equal(reminders(events).length, 0);
});

test('真实设置加载在默认值合并后仍保留两个旧开关对应的模式', async () => {
    const source = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
    const pluginClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.members.some(member => member.name?.getText(ast) === 'loadSettings'));
    const method = pluginClass.members.find(member => member.name?.getText(ast) === 'loadSettings');
    const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const { getIcsReminderVisibility } = fixture({}).load('src/utils/icsReminderVisibility.ts');
    const defaults = { icsReminderVisibility: 'hideCompleted', datatransfer: {}, weekStartDay: 1,
        pomodoroDurationPresets: [25], audioFileLists: { taskCompleteSound: [] }, audioSelected: { taskCompleteSound: '' } };
    const dependencies = { DEFAULT_SETTINGS: defaults, SETTINGS_FILE: 'reminder-settings.json', getIcsReminderVisibility,
        normalizeReminderSkipWeekendMode: () => undefined, normalizeEmailSettings: () => ({}),
        normalizeReminderWebhookJsonType: value => value, inferReminderWebhookJsonType: () => 'custom',
        WEBHOOK_JSON_TEMPLATES: { feishu: '{}' }, setDayStartTime() {}, setSingleDateDefaultRole() {} };
    const Plugin = new Function(...Object.keys(dependencies), compile(`class Fixture { ${method.getText(ast)} }; return Fixture;`))(...Object.values(dependencies));
    for (const [raw, expected] of [[{}, 'hideCompleted'], [{ icsHideAllReminderEvents: true }, 'none'],
        [{ icsHideCompletedReminderEvents: false }, 'all'], [{ icsHideCompletedReminderEvents: true, icsHideAllReminderEvents: false }, 'hideCompleted'],
        [{ icsReminderVisibility: 'all', icsHideAllReminderEvents: true }, 'all']]) {
        const plugin = new Plugin();
        plugin.loadData = async () => structuredClone(raw);
        plugin.loadVipData = async () => {};
        assert.equal((await plugin.loadSettings()).icsReminderVisibility, expected);
        assert.equal((await plugin.loadSettings()).icsReminderVisibility, expected);
    }
});
