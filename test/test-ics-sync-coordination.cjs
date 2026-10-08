const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const pluginSource = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const parsed = ts.createSourceFile('index.ts', pluginSource, ts.ScriptTarget.Latest, true);
const pluginClass = parsed.statements.find(node => ts.isClassDeclaration(node)
    && node.members.some(member => member.name?.getText(parsed) === 'startReminderReceiver'));
const coordinator = pluginClass?.members.find(member => member.name?.getText(parsed) === 'isPrimaryInstance');
assert.ok(coordinator, 'ICS 同步依赖的插件协调方法必须保留');

function compile(source) {
    return ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
}

function fixture() {
    let now = Date.parse('2026-10-08T09:00:00+08:00');
    class Clock extends Date {
        constructor(...args) { super(...(args.length ? args : [now])); }
        static now() { return now; }
    }
    const storage = new Map();
    const localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
    };
    // 使用插件实际方法，避免测试替身掩盖跨模块方法丢失。
    const Plugin = new Function('localStorage', 'Date',
        compile(`class Plugin { ${coordinator.getText(parsed)} }`) + '\nreturn Plugin;'
    )(localStorage, Clock);
    const timers = new Map();
    const window = { setInterval: (callback, ms) => { timers.set(ms, callback); return ms; } };
    const calls = { uploads: 0, subscriptions: 0 };
    const dependencies = {
        '../api': { getFileStat: async () => ({ mtime: now }) },
        './icsExport': { uploadIcsToCloud: async () => { calls.uploads++; } },
        './icsSubscription': {
            loadSubscriptions: async () => { calls.subscriptions++; return { subscriptions: {} }; }
        }
    };
    const exports = {};
    new Function('exports', 'require', 'window', 'clearInterval', 'Date',
        compile(fs.readFileSync(path.join(root, 'src/utils/icsSync.ts'), 'utf8'))
    )(exports, name => {
        assert.ok(name in dependencies, `未配置依赖: ${name}`);
        return dependencies[name];
    }, window, id => timers.delete(id), Clock);
    const plugin = new Plugin();
    plugin.instanceId = 'first';
    const settings = {
        icsSyncEnabled: true, icsSyncInterval: '15min', icsLastSyncAt: new Clock().toISOString()
    };
    plugin.loadSettings = async () => settings;
    plugin.saveSettings = async () => {};
    return { Plugin, plugin, sync: exports, timers, calls, storage, advance: ms => { now += ms; } };
}

test('ICS 自动同步和订阅定时回调可调用真实插件协调方法，卸载清理计时器', async () => {
    const { plugin, sync, timers, calls, advance } = fixture();
    await sync.initIcsSync(plugin);
    await sync.initIcsSubscriptionSync(plugin);
    assert.equal(timers.size, 2);
    advance(15 * 60 * 1000);
    await timers.get(30000)();
    await timers.get(60000)();
    assert.equal(calls.uploads, 1);
    assert.equal(calls.subscriptions, 1);
    sync.cleanupIcsSync(plugin);
    assert.equal(timers.size, 0);
});

test('ICS 协调保留跨窗口互斥，租约过期或损坏后可以接管', () => {
    const { Plugin, plugin, storage, advance } = fixture();
    const other = new Plugin();
    other.instanceId = 'second';
    assert.equal(plugin.isPrimaryInstance(), true);
    assert.equal(other.isPrimaryInstance(), false);
    advance(45000);
    assert.equal(other.isPrimaryInstance(), true);
    assert.equal(plugin.isPrimaryInstance(), false);
    storage.set('siyuan_task_note_coordinator_lock', '{invalid');
    assert.equal(plugin.isPrimaryInstance(), true);
});
