const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/utils/taskTreeDeletion.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(data, { failSave = false, retained = {} } = {}) {
    const calls = { saved: [], cancelled: [], blocks: [], remote: [], retained: [] };
    const plugin = { settings: {}, cancelMobileNotification: async id => calls.cancelled.push(id) };
    class Undo {
        constructor(plugin, before) { this.before = structuredClone(before); }
        async save(after) {
            if (failSave) throw new Error('save failed');
            calls.saved.push(structuredClone(after));
        }
    }
    const dependencies = {
        '../api': { updateBindBlockAtrrs: async id => calls.blocks.push(id) },
        '../components/dataManager/repeatUtils': {
            parseReminderInstanceId: id => {
                const match = id.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
                return match ? { originalId: match[1], instanceDate: match[2] } : null;
            },
        },
        '../pluginInstance': { i18n: key => key },
        './icsSubscription': {
            getAllReminders: async () => data,
            deleteSubscriptionReminderTask: async (plugin, task) => calls.remote.push(task.id),
        },
        './repeatTaskDeletion': {
            createCompletedRemindersForDeletion: (data, ids, options) => {
                calls.retained.push({ ids: [...ids], options });
                return retained;
            },
        },
        './taskActionUndo': { TaskActionUndo: Undo },
    };
    const exported = {};
    new Function('require', 'exports', code)(name => {
        assert.ok(dependencies[name], `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, exported);
    return { ...exported, plugin, calls };
}

test('删除全部层级子任务、落盘实例及实例子任务，保留父任务和兄弟任务', async () => {
    const data = {
        parent: { id: 'parent' },
        root: { id: 'root', parentId: 'parent', blockId: 'block-root' },
        child: { id: 'child', parentId: 'root' },
        grandchild: { id: 'grandchild', parentId: 'child', blockId: 'block-child' },
        sibling: { id: 'sibling', parentId: 'parent' },
        'child_2026-11-12': { id: 'child_2026-11-12', originalId: 'child' },
        instanceChild: { id: 'instanceChild', parentId: 'child_2026-11-12' },
    };
    const view = fixture(data);
    const undo = await view.deleteTaskTree(view.plugin, 'root');
    assert.deepEqual(Object.keys(view.calls.saved[0]).sort(), ['parent', 'sibling']);
    assert.ok(undo.before.root && undo.before.grandchild);
    assert.deepEqual(view.calls.cancelled.sort(), ['root', 'child', 'grandchild', 'child_2026-11-12', 'instanceChild'].sort());
    assert.deepEqual(view.calls.blocks.sort(), ['block-root', 'block-child'].sort());
});

test('损坏的循环父子关系不会无限遍历或重复删除', () => {
    const data = { a: { id: 'a', parentId: 'b' }, b: { id: 'b', parentId: 'a' } };
    const view = fixture(data);
    assert.deepEqual([...view.collectTaskDeletionIds(data, 'a')], ['a', 'b']);
});

test('保存失败时不取消通知、不修改块属性和远程任务', async () => {
    const view = fixture({ root: { id: 'root', blockId: 'block', isSubscribed: true, subscriptionType: 'caldav' } }, { failSave: true });
    await assert.rejects(view.deleteTaskTree(view.plugin, 'root'), /save failed/);
    assert.deepEqual(view.calls.cancelled, []);
    assert.deepEqual(view.calls.blocks, []);
    assert.deepEqual(view.calls.remote, []);
});

test('重复任务保留已完成实例，传入节假日设置并清理实例绑定块', async () => {
    const view = fixture({ root: { id: 'root', repeat: { enabled: true, instances: { '2026-11-12': { blockId: 'instance-block' } } } } }, {
        retained: { finished: { id: 'finished', completed: true } },
    });
    const holidays = { '2026-11-12': true };
    await view.deleteTaskTree(view.plugin, 'root', true, holidays);
    assert.deepEqual(Object.keys(view.calls.saved[0]), ['finished']);
    assert.equal(view.calls.retained[0].options.holidayData, holidays);
    assert.deepEqual(view.calls.blocks, ['instance-block']);
});

test('任务已被其他窗口删除时不写入数据', async () => {
    const view = fixture({ other: { id: 'other' } });
    await assert.rejects(view.deleteTaskTree(view.plugin, 'root'), /reminderNotExist/);
    assert.deepEqual(view.calls.saved, []);
});

test('确认后使用最新数据，包含确认期间新增的后代', async () => {
    const data = { root: { id: 'root' }, other: { id: 'other' } };
    const view = fixture(data);
    assert.equal(view.collectTaskDeletionIds(data, 'root').size, 1);
    data.newChild = { id: 'newChild', parentId: 'root' };
    await view.deleteTaskTree(view.plugin, 'root');
    assert.deepEqual(Object.keys(view.calls.saved[0]), ['other']);
});

function editorFixture({ readOnly = false, skipSave = false, repeat = false } = {}) {
    const relative = 'src/components/dialog/QuickReminderDialog.ts';
    const content = fs.readFileSync(path.join(root, relative), 'utf8');
    const source = ts.createSourceFile(relative, content, ts.ScriptTarget.Latest, true);
    const method = source.statements.find(ts.isClassDeclaration).members
        .find(member => member.name?.getText(source) === 'deleteCurrentTask').getText(source);
    const editorCode = ts.transpileModule(`class TaskEditor { ${method} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const calls = { deleted: [], events: [], errors: [] };
    const data = { root: { id: 'root', title: '<task>', projectId: 'project', repeat: { enabled: repeat } } };
    const button = { disabled: false };
    const Editor = new Function('getAllReminders', 'collectTaskDeletionIds', 'deleteTaskTree', 'parseReminderInstanceId',
        'i18n', 'confirm', 'showDeleteRepeatTaskDialog', 'window', 'CustomEvent', 'showMessage', `${editorCode}; return TaskEditor;`)(
        async () => data, () => new Set(['root', 'child']),
        async (plugin, id, keep) => {
            calls.deleted.push({ id, keep });
            return { show: message => { calls.toast = message; } };
        }, () => null,
        (key, params) => `${key}:${JSON.stringify(params || {})}`,
        (title, message, callback) => { calls.confirmation = { title, message, callback }; },
        options => { calls.repeat = options; },
        { dispatchEvent: event => calls.events.push(event) },
        class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        message => calls.errors.push(message),
    );
    const editor = Object.assign(new Editor(), {
        mode: 'edit', readOnly, skipSave, reminder: data.root, plugin: {},
        dialog: { element: { querySelector: () => button } },
        destroyDialog() { calls.closed = true; this.dialog = undefined; },
    });
    return { editor, calls, button };
}

test('编辑弹窗先确认，标题转义，成功后关闭并广播刷新、显示撤回', async () => {
    const { editor, calls } = editorFixture();
    await editor.deleteCurrentTask();
    assert.deepEqual(calls.deleted, []);
    assert.match(calls.confirmation.message, /&lt;task&gt;/);
    assert.match(calls.confirmation.message, /confirmDeleteTaskWithSubtasks/);
    calls.confirmation.callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls.deleted, [{ id: 'root', keep: false }]);
    assert.equal(calls.closed, true);
    assert.equal(calls.events[0].type, 'reminderUpdated');
    assert.equal(calls.events[0].detail.refreshDelayMs, 0);
    assert.match(calls.toast, /reminderDeleted/);
});

test('只读任务和临时任务不允许触发持久化删除', async () => {
    for (const options of [{ readOnly: true }, { skipSave: true }]) {
        const { editor, calls } = editorFixture(options);
        await editor.deleteCurrentTask();
        assert.equal(calls.confirmation, undefined);
        assert.deepEqual(calls.deleted, []);
    }
});

test('重复任务沿用系列删除选项，保留已完成实例的选择传入保存逻辑', async () => {
    const { editor, calls } = editorFixture({ repeat: true });
    await editor.deleteCurrentTask();
    assert.equal(calls.confirmation, undefined);
    assert.equal(calls.repeat.title, '<task>');
    await calls.repeat.onConfirm(true);
    assert.deepEqual(calls.deleted, [{ id: 'root', keep: true }]);
});
