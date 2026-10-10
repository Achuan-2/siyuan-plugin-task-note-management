const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createKernelLoader } = require('./helpers/kernel-loader.cjs');
const { ProtectedJsonStorage } = createKernelLoader()('src/utils/protectedJsonStorage.ts');

function response(value, status = 200) {
    return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status });
}

function fixture(initial = { task: { title: '原任务' } }, timeoutMs = 1000) {
    const f = { value: initial, reads: 0, writes: [], read: null, write: null, writable: true };
    f.storage = new ProtectedJsonStorage({
        pluginName: () => 'test-plugin', appId: () => 'test-app', canWrite: () => f.writable, timeoutMs,
        fetch: async (url, options) => {
            if (url.endsWith('getFile')) {
                f.reads++;
                assert.match(JSON.parse(options.body).path, /^\/data\/storage\/petal\/test-plugin\//);
                if (f.read) return f.read(options);
                return f.value === undefined ? response({ code: 404, msg: 'not found', data: null }, 202) : response(f.value);
            }
            assert.equal(options.body.get('app'), 'test-app');
            f.writes.push(JSON.parse(await options.body.get('file').text()));
            if (f.write) return f.write(options);
            f.value = f.writes.at(-1);
            return response({ code: 0, data: null });
        },
    });
    return f;
}

for (const [name, read] of [
    ['网络中断', () => { throw new Error('network failed'); }],
    ['HTTP 错误', () => response('unavailable', 503)],
    ['空文件', () => response('')],
    ['截断 JSON', () => response('{"task":')],
    ['错误的数据类型', () => response([])],
    ['JSON null', () => response('null')],
    ['内核错误封装', () => response({ code: -1, msg: 'failed', data: null })],
    ['普通 404 页面', () => response('not found', 404)],
    ['202 权限错误', () => response({ code: 403 }, 202)],
]) {
    test(`${name}：拒绝读取，并拦截调用方捕获错误后保存空数据`, async () => {
        const f = fixture();
        f.read = read;
        await assert.rejects(f.storage.load('reminder.json', 'object'));
        await assert.rejects(f.storage.save('reminder.json', {}, 'object'), /重新加载/);
        assert.equal(f.writes.length, 0);
    });
}

test('失败后可靠重读可恢复保存，已存在的文件突然缺失则继续保护', async () => {
    const f = fixture();
    await f.storage.load('reminder.json', 'object');
    f.value = undefined;
    await assert.rejects(f.storage.load('reminder.json', 'object'), /意外缺失/);
    await assert.rejects(f.storage.save('reminder.json', {}, 'object'));
    f.value = { task: { title: '恢复的任务' } };
    const data = await f.storage.load('reminder.json', 'object');
    data.newTask = {};
    await f.storage.save('reminder.json', data, 'object');
    assert.equal(f.writes[0].task.title, '恢复的任务');
});

for (const status of [202, 404]) {
    test(`确认文件不存在 (HTTP ${status}) 时允许首次创建`, async () => {
        const f = fixture();
        f.read = () => response({ code: 404, data: null }, status);
        assert.equal(await f.storage.load('reminder.json', 'object'), null);
        await f.storage.save('reminder.json', {}, 'object');
        assert.equal(f.reads, 1);
        assert.deepEqual(f.writes, [{}]);
    });
}

test('保存前未读数据：只能创建不存在的新文件，不能盲目覆盖已有文件', async () => {
    const f = fixture();
    await assert.rejects(f.storage.save('reminder.json', {}, 'object'), /尚未加载/);
    assert.equal(f.writes.length, 0);
    f.value = undefined;
    await f.storage.save('new.json', {}, 'object');
    assert.equal(f.writes.length, 1);
});

test('可靠读取后允许用户主动清空任务和分类', async () => {
    const f = fixture();
    await f.storage.load('reminder.json', 'object');
    await f.storage.save('reminder.json', {}, 'object');
    f.value = [{ id: 'work' }];
    await f.storage.load('categories.json', 'array');
    await f.storage.save('categories.json', [], 'array');
    assert.deepEqual(f.writes, [{}, []]);
});

test('100 次并发读取合并为一次请求，正常保存不增加预读', async () => {
    const f = fixture();
    await Promise.all(Array.from({ length: 100 }, () => f.storage.load('reminder.json', 'object')));
    assert.equal(f.reads, 1);
    await f.storage.save('reminder.json', { task: {} }, 'object');
    await f.storage.save('reminder.json', { task: {}, second: {} }, 'object');
    assert.equal(f.reads, 1);
});

test('读写按调用顺序完成，保存固定快照，写后读取不复用写前请求', async () => {
    const f = fixture();
    let release;
    f.read = () => new Promise(resolve => { release = () => resolve(response(f.value)); });
    const before = f.storage.load('reminder.json', 'object');
    await Promise.resolve();
    const data = { newTask: { title: '保存时的标题' } };
    const saving = f.storage.save('reminder.json', data, 'object');
    const after = f.storage.load('reminder.json', 'object');
    data.newTask.title = '随后修改的标题';
    f.read = null;
    release();
    assert.ok((await before).task);
    await saving;
    assert.equal((await after).newTask.title, '保存时的标题');
    assert.equal(f.reads, 2);
});

test('内核保存失败后拦截已排队的后续覆盖，重读后可恢复', async () => {
    const f = fixture();
    await f.storage.load('reminder.json', 'object');
    f.write = () => response({ code: -1, msg: 'disk full' });
    const results = await Promise.allSettled([
        f.storage.save('reminder.json', { task: {} }, 'object'),
        f.storage.save('reminder.json', {}, 'object'),
    ]);
    assert.deepEqual(results.map(r => r.status), ['rejected', 'rejected']);
    assert.equal(f.writes.length, 1);
    await f.storage.load('reminder.json', 'object');
    f.write = null;
    await f.storage.save('reminder.json', { recovered: {} }, 'object');
    assert.equal(f.writes.length, 2);
});

test('读取超时中止请求并释放队列', async () => {
    const f = fixture({}, 15);
    let signal;
    f.read = options => { signal = options.signal; return new Promise(() => {}); };
    await assert.rejects(f.storage.load('reminder.json', 'object'), /超时/);
    assert.equal(signal.aborted, true);
    f.read = null;
    assert.deepEqual(await f.storage.load('reminder.json', 'object'), {});
});

test('响应体挂起或保存超时也会阻止后续覆盖', async () => {
    const f = fixture({}, 15);
    f.read = () => ({ status: 200, text: () => new Promise(() => {}) });
    await assert.rejects(f.storage.load('reminder-settings.json', 'object'), /超时/);
    await assert.rejects(f.storage.save('reminder-settings.json', {}, 'object'), /重新加载/);
    f.read = null;
    await f.storage.load('reminder-settings.json', 'object');
    f.write = () => new Promise(() => {});
    await assert.rejects(f.storage.save('reminder-settings.json', {}, 'object'), /超时/);
    await assert.rejects(f.storage.save('reminder-settings.json', {}, 'object'), /重新加载/);
    assert.equal(f.writes.length, 1);
});

test('只读或卸载状态不发送写请求', async () => {
    const f = fixture();
    await f.storage.load('reminder.json', 'object');
    f.writable = false;
    await assert.rejects(f.storage.save('reminder.json', {}, 'object'), /不可写/);
    assert.equal(f.writes.length, 0);
});

// 执行 index.ts 的真实方法，验证业务缓存与底层保护衔接；不启动思源 GUI。
const source = fs.readFileSync(path.resolve(__dirname, '../src/index.ts'), 'utf8');
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'ReminderPlugin');
const names = ['loadReminderData', 'saveReminderData', 'loadSettings', 'saveSettings', 'loadHabitData',
    'saveHabitData', 'persistHabitData', 'enqueueHabitSave', 'saveHabitPartial', 'persistHabitPartial',
    'getHabitCheckinFileName', 'stripHabitCheckinData', 'extractHabitCheckinData', 'mergeHabitWithCheckinData'];
const members = declaration.members.filter(m => names.includes(m.name?.getText(ast)));
assert.equal(members.length, names.length);
const js = ts.transpileModule(`class Fixture { ${members.map(m => m.getText(ast)).join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
}).outputText;
const PluginFixture = new Function('REMINDER_DATA_FILE', 'SETTINGS_FILE', 'HABIT_DATA_FILE', 'HABIT_CHECKIN_DIR',
    'HABIT_CHECKIN_DATA_KEYS', 'cleanReminderItem', 'console', `${js}; return Fixture;`)(
    'reminder.json', 'reminder-settings.json', 'habit.json', 'habitCheckin', ['checkIns', 'hasNotify', 'totalCheckIns'],
    () => {}, { error() {}, warn() {} });

test('index：任务刷新失败保留原缓存，首次失败不生成空缓存', async () => {
    const p = new PluginFixture();
    const original = { task: { title: '原任务' } };
    p.reminderDataCache = original;
    p.loadData = async () => { throw new Error('read failed'); };
    await assert.rejects(p.loadReminderData(true));
    assert.equal(p.reminderDataCache, original);
    p.reminderDataCache = null;
    await assert.rejects(p.loadReminderData());
    assert.equal(p.reminderDataCache, null);
});

test('index：任务和设置保存失败不发布新缓存，设置读取失败不套用默认值', async () => {
    const p = new PluginFixture();
    p.settings = { language: 'custom' };
    p.reminderDataCache = { task: {} };
    p.saveData = p.loadData = async () => { throw new Error('failed'); };
    await assert.rejects(p.saveReminderData({}));
    await assert.rejects(p.saveSettings({}));
    await assert.rejects(p.loadSettings(true));
    assert.deepEqual(p.reminderDataCache, { task: {} });
    assert.deepEqual(p.settings, { language: 'custom' });
});

test('index：一个习惯明细读取失败，保留完整旧缓存并禁止空索引保存', async () => {
    const p = new PluginFixture();
    const f = fixture();
    p.protectedStorage = f.storage;
    p.habitSaveQueue = Promise.resolve();
    const original = { habit: { checkIns: { yesterday: true } } };
    p.habitDataCache = original;
    p.loadData = async file => {
        if (file === 'habit.json') return { habit: {} };
        throw new Error('checkin read failed');
    };
    p.saveData = () => assert.fail('不应写入');
    await assert.rejects(p.loadHabitData(true));
    assert.equal(p.habitDataCache, original);
    await assert.rejects(p.saveHabitData({}), /重新加载/);
});

test('index：并发保存不同习惯的打卡，不丢失另一习惯的索引更新', async () => {
    const p = new PluginFixture();
    p.habitDataCache = { a: { title: 'A' }, b: { title: 'B' } };
    p.habitSaveQueue = Promise.resolve();
    p.protectedStorage = { assertWritable() {} };
    const writes = [];
    p.saveData = async (file, data) => { await Promise.resolve(); writes.push([file, structuredClone(data)]); };
    await Promise.all([
        p.saveHabitPartial('a', { title: 'A2', checkIns: { today: true } }),
        p.saveHabitPartial('b', { title: 'B2', checkIns: { today: true } }),
    ]);
    assert.deepEqual(writes.at(-1), ['habit.json', { a: { title: 'A2' }, b: { title: 'B2' } }]);
});
