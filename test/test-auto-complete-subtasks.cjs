const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// 执行真实面板方法和周期实例逻辑，替换思源界面与存储；跳过面板构造时的 DOM 初始化。
function load(relativePath, dependencies = {}) {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(name => dependencies[name] || {}, exports);
    return exports;
}

const dates = { getLocalDateTimeString: () => '2026-10-28 10:00:00' };
const i18n = { i18n: key => key };
const repeat = load('src/components/dataManager/repeatUtils.ts', {
    '../../utils/dateUtils': dates, '../../pluginInstance': i18n
});
const panels = ['ReminderPanel', 'ProjectKanbanView', 'EisenhowerMatrixView'].map(name => {
    const Panel = load(`src/components/panel/${name}.ts`, {
        siyuan: { showMessage() {} },
        '../../pluginInstance': i18n,
        '../../utils/dateUtils': dates,
        '../dataManager/repeatUtils': repeat,
        '../../utils/icsSubscription': { getAllReminders: async () => ({}) }
    })[name];
    return { name, Panel };
});

function fixture(Panel, enabled) {
    const panel = Object.create(Panel.prototype);
    panel.plugin = { settings: { autoCompleteSubtasksOnParentComplete: enabled } };
    panel.getTaskStatus = () => 'todo';
    panel.isAbandonedStatus = () => false;
    return panel;
}

for (const { name, Panel } of panels) {
    for (const enabled of [undefined, true, false]) {
        test(`${name}: 自动完成=${enabled}，普通及周期后代遵循开关`, async () => {
            const panel = fixture(Panel, enabled);
            for (const date of [undefined, '2026-10-28']) {
                const data = {
                    parent: { id: 'parent' },
                    child: { id: 'child', parentId: 'parent', completed: false },
                    grandchild: { id: 'grandchild', parentId: 'child', completed: false },
                    instanceChild: { id: 'instanceChild', parentId: 'parent_2026-10-28', completed: false },
                    other: { id: 'other', completed: false }
                };
                const before = structuredClone(data);
                const blocks = new Set();
                const ids = date && name !== 'ReminderPanel'
                    ? await panel.completeAllChildInstances('parent', date, data, blocks, `parent_${date}`)
                    : await panel.completeAllChildTasks('parent', data, blocks, date);
                if (enabled === false) {
                    assert.deepEqual(data, before);
                    assert.deepEqual(ids, []);
                    assert.equal(blocks.size, 0);
                } else {
                    for (const id of ['child', 'grandchild']) {
                        assert.equal(date ? repeat.isRepeatInstanceCompleted(data[id], date) : data[id].completed, true);
                        if (date) assert.equal(data[id].completed, false);
                    }
                    assert.equal(data.instanceChild.completed, !!date);
                }
                assert.deepEqual(data.other, before.other);
                assert.deepEqual(data.parent, before.parent);
            }
        });
    }
}

test('侧栏乐观勾选遵循开关，取消父任务完成不改变子任务', async () => {
    const { Panel } = panels.find(panel => panel.name === 'ReminderPanel');
    for (const enabled of [true, false]) {
        for (const completed of [true, false]) {
            const panel = fixture(Panel, enabled);
            panel.getDescendantIdsFromCache = () => ['child', 'grandchild'];
            let updatedIds;
            panel.applyOptimisticCompletionForIds = ids => { updatedIds = ids; };
            await panel.toggleReminder('parent', completed);
            assert.deepEqual(updatedIds, enabled && completed ? ['parent', 'child', 'grandchild'] : ['parent']);
        }
    }
});

test('看板关闭自动勾选后，乐观更新仅改变父任务', async () => {
    const { Panel } = panels.find(panel => panel.name === 'ProjectKanbanView');
    const panel = fixture(Panel, false);
    panel.tasks = [
        { id: 'parent', completed: false },
        { id: 'child', parentId: 'parent', completed: false, customProgress: 20 }
    ];
    panel.getReminders = async () => ({});
    const updatedIds = [];
    panel.updateTaskElementDOM = id => updatedIds.push(id);
    await panel.toggleTaskCompletion(panel.tasks[0], true);
    assert.equal(panel.tasks[0].completed, true);
    assert.equal(panel.tasks[1].completed, false);
    assert.equal(panel.tasks[1].customProgress, 20);
    assert.deepEqual(updatedIds, ['parent']);
});
