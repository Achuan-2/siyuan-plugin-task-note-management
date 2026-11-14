// node --test scripts/test-pomodoro-sessions-dialog.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/components/dialog/PomodoroSessionsDialog.ts'), 'utf8');
const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
const session = (id, date, extra = {}) => ({
    id, storageDate: date, eventId: 'task', type: 'work', startTime: `${date}T10:00:00Z`, duration: 25, ...extra,
});

function fixture() {
    const dialogs = [], confirmations = [], messages = [], errors = [];
    class Element {
        value = ''; checked = false; disabled = false; style = {}; listeners = {};
        addEventListener(name, listener) { this.listeners[name] = listener; }
        click() { return this.listeners.click?.(); }
    }
    class Dialog {
        constructor(options) {
            const fields = new Map();
            const values = {
                '#sessionType': 'work', '#timeMode': 'end', '#sessionDuration': '25',
                '#sessionNote': '', '#editSessionType': 'work',
            };
            this.element = { querySelector(selector) {
                if (!fields.has(selector)) fields.set(selector, Object.assign(new Element(), { value: values[selector] || '' }));
                return fields.get(selector);
            } };
            this.options = options;
            dialogs.push(this);
        }
        destroy() { this.destroyed = true; }
    }
    const recordManager = {
        updateSession: async () => true, deleteSession: async () => true,
        getSessionStorageDate: () => '2026-11-14', getStorageDateSessions: async () => [],
    };
    const exports = {};
    new Function('require', 'exports', 'window', 'CustomEvent', 'console', code)(name => {
        if (name === 'siyuan') return { Dialog, confirm: (...args) => confirmations.push(args), showMessage: text => messages.push(text) };
        if (name.endsWith('/pomodoroRecord')) return { PomodoroRecordManager: { getInstance: () => recordManager } };
        if (name.endsWith('/pluginInstance')) return { i18n: key => key };
        if (name.endsWith('/dateUtils')) return { getLocaleTag: () => 'zh-CN' };
        if (name.endsWith('/api')) return { getBlockByID: async () => null };
        return {};
    }, exports, { dispatchEvent() {} }, class {}, { error: (...args) => errors.push(args), warn() {} });
    const view = new exports.PomodoroSessionsDialog('task', { loadSettings: async () => ({}) });
    view.resolveEventTitle = async () => '任务';
    view.renderSessions = () => {};
    view.syncReminderPomodoroCount = async () => {};
    view.dispatchUpdateEvents = async () => {};
    return { view, recordManager, dialogs, confirmations, messages, errors };
}

test('仅刷新改动日期，保留其他历史并使用合并后的版本，慢速派生同步不阻塞列表', async () => {
    const f = fixture(), gate = deferred(), date = '2026-11-14';
    const historical = session('history', '2026-10-01');
    f.view.sessions = [historical, session('edited', date), session('deleted', date)];
    f.view.loadSessions = () => assert.fail('不应重新加载全部历史');
    const canonical = [session('edited', date, { revision: 2 }), session('other-window', date), session('unrelated', date, { eventId: 'elsewhere' })];
    f.recordManager.getStorageDateSessions = async dates => { assert.deepEqual(dates, [date]); return canonical; };
    let rendered = false, started = false;
    f.view.renderSessions = () => { rendered = true; };
    f.view.syncReminderPomodoroCount = async () => { started = true; await gate.promise; };
    await f.view.refreshAfterSessionChange([date, date]);
    assert.equal(rendered, true);
    assert.deepEqual(f.view.sessions.map(s => s.id), ['edited', 'other-window', 'history']);
    assert.equal(f.view.sessions[0].revision, 2);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(started, true);
    gate.resolve();
    await f.view.updateTail;
});

test('连续操作串行同步，第一次同步失败不阻止下一次', async () => {
    const f = fixture(), gate = deferred();
    let calls = 0, active = 0, peak = 0;
    f.view.syncReminderPomodoroCount = async () => {
        const call = ++calls;
        peak = Math.max(peak, ++active);
        try { if (call === 1) { await gate.promise; throw new Error('failed'); } }
        finally { active--; }
    };
    await f.view.refreshAfterSessionChange(['2026-11-14']);
    await f.view.refreshAfterSessionChange(['2026-11-14']);
    gate.resolve();
    await f.view.updateTail;
    assert.equal(calls, 2);
    assert.equal(peak, 1);
    assert.equal(f.errors.length, 1);
});

test('补录等待落盘期间阻止重复点击，成功关闭后也不重新启用保存', async () => {
    const f = fixture(), gate = deferred();
    let writes = 0, refreshed = 0;
    f.recordManager.updateSession = async () => { writes++; return gate.promise; };
    f.view.refreshAfterSessionChange = async () => { refreshed++; };
    await f.view.addNewSession();
    const dialog = f.dialogs[0], button = dialog.element.querySelector('#confirmAddPomodoro');
    const saving = button.click();
    await tick();
    await button.click();
    assert.equal(writes, 1);
    assert.equal(button.disabled, true);
    assert.equal(refreshed, 0);
    gate.resolve(true);
    await saving;
    assert.equal(dialog.destroyed, true);
    assert.equal(refreshed, 1);
    assert.equal(button.disabled, true);
});

test('补录落盘失败可重试，不关闭弹窗，不刷新列表', async () => {
    const f = fixture();
    f.recordManager.updateSession = async () => { throw new Error('disk full'); };
    f.view.refreshAfterSessionChange = () => assert.fail('失败不能刷新列表');
    await f.view.addNewSession();
    const dialog = f.dialogs[0], button = dialog.element.querySelector('#confirmAddPomodoro');
    await button.click();
    assert.equal(button.disabled, false);
    assert.equal(dialog.destroyed, undefined);
    assert.ok(f.messages.some(text => text.includes('addPomodoroFailed')));
});

test('删除等待落盘期间不移除记录，拒绝重复删除，成功后按原日期刷新', async () => {
    const f = fixture(), gate = deferred();
    f.view.sessions = [session('remove', '2026-10-01')];
    let writes = 0, refreshed;
    f.recordManager.deleteSession = async () => { writes++; return gate.promise; };
    f.view.refreshAfterSessionChange = async dates => { refreshed = dates; };
    await f.view.deleteSession('remove');
    const confirm = f.confirmations[0][2];
    const removing = confirm({ destroy() {} });
    await f.view.deleteSession('remove');
    await confirm({ destroy() {} });
    assert.equal(writes, 1);
    assert.equal(f.confirmations.length, 1);
    assert.equal(refreshed, undefined);
    gate.resolve(true);
    await removing;
    assert.deepEqual(refreshed, ['2026-10-01']);
    assert.equal(f.view.pendingDeletes.size, 0);
});

test('删除失败保留记录，解除重复操作锁', async () => {
    const f = fixture();
    f.view.sessions = [session('remove', '2026-11-14')];
    f.recordManager.deleteSession = async () => { throw new Error('disk full'); };
    f.view.refreshAfterSessionChange = () => assert.fail('失败不能刷新列表');
    await f.view.deleteSession('remove');
    await f.confirmations[0][2]({ destroy() {} });
    assert.equal(f.view.sessions.length, 1);
    assert.equal(f.view.pendingDeletes.size, 0);
    assert.ok(f.messages.some(text => text.includes('deletePomodoroFailed')));
});

test('落盘后的列表读取失败单独提示，后台同步仍执行', async () => {
    const f = fixture();
    f.recordManager.getStorageDateSessions = async () => { throw new Error('read failed'); };
    let synchronized = false;
    f.view.syncReminderPomodoroCount = async () => { synchronized = true; };
    await f.view.refreshAfterSessionChange(['2026-11-14']);
    await f.view.updateTail;
    assert.deepEqual(f.messages, ['loadingFailed']);
    assert.equal(synchronized, true);
});

test('同步任务数量使用最新摘要，包含全部重复实例且不依赖旧列表', () => {
    const f = fixture();
    f.view.includeInstances = true;
    f.view.sessions = [session('old-snapshot', '2026-11-14')];
    f.recordManager.getEventStats = () => ({
        task: { count: 2 }, 'task_2026-11-13': { count: 3 },
        'task_child': { count: 9 }, unrelated: { count: 10 },
    });
    assert.equal(f.view.getWorkCountForEventId('task'), 5);
    f.view.includeInstances = false;
    assert.equal(f.view.getWorkCountForEventId('task'), 2);
});
