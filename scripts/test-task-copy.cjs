// Run with: pnpm exec node --test scripts/test-task-copy.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const loadTaskActionUndo = require('./lib/task-action-undo.cjs');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const code = compile(fs.readFileSync(path.join(root, 'src/utils/taskDuplication.ts'), 'utf8'));
const repeatSource = ts.createSourceFile('repeatUtils.ts', fs.readFileSync(
    path.join(root, 'src/components/dataManager/repeatUtils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const repeatNames = ['getLocalDateString', 'addDaysToDate', 'getDaysDifference',
    'parseReminderInstanceId', 'getRepeatInstanceOriginalKey', 'getRepeatInstanceState'];
const repeat = {};
new Function('exports', compile(repeatSource.statements.filter(node => repeatNames.includes(node.name?.getText(repeatSource)))
    .map(node => node.getText(repeatSource)).join('\n')))(repeat);

function fixture(initial, { failSave = false } = {}) {
    let stored = structuredClone(initial);
    const calls = { saves: [], events: [], notifications: [], blocks: [] };
    const dependencies = {
        i18n: key => key,
        updateBindBlockAtrrs: async id => calls.blocks.push(id),
        window: { dispatchEvent: event => calls.events.push(event) },
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        showMessage: () => {},
    };
    const plugin = {
        loadReminderData: async () => stored,
        saveReminderData: async data => {
            if (failSave) throw new Error('save failed');
            stored = structuredClone(data);
            calls.saves.push(structuredClone(data));
        },
        updateMobileNotification: async task => calls.notifications.push(task.id),
    };
    const undo = loadTaskActionUndo(dependencies);
    const modules = {
        '../api': dependencies,
        '../pluginInstance': dependencies,
        '../components/dataManager/repeatUtils': repeat,
        './taskActionUndo': undo,
        './taskUndoPatch': undo,
    };
    const exported = {};
    new Function('require', 'exports', 'window', 'CustomEvent', code)(name => {
        assert.ok(modules[name], `Unexpected dependency: ${name}`);
        return modules[name];
    }, exported, dependencies.window, dependencies.CustomEvent);
    return { ...exported, plugin, calls, get data() { return stored; } };
}

test('普通任务复制日期、时间、属性和全部隐藏子任务，重建层级并可整体撤回', async () => {
    const data = {
        parent: { id: 'parent', title: '外部父任务' },
        task: {
            id: 'task', title: '测试', parentId: 'parent', date: '2026-11-13', time: '09:00',
            endDate: '2026-11-15', endTime: '18:00', note: '备注', projectId: 'p', customGroupId: 'g',
            milestoneId: 'm', tagIds: ['tag'], categoryId: 'work', priority: 'high', kanbanStatus: 'waiting',
            reminderTimes: [{ time: '08:00', note: '提前提醒' }], blockId: 'block', sort: 10,
            estimatedPomodoroDuration: 90, treatStartDateAsDeadline: true, reminderSkipWeekendMode: 'sunday',
            completed: true, completedTime: 'old', notified: true, notifiedTimes: { '08:00': true },
            dailyCompletions: { '2026-11-13': true }, createdAt: 'old',
        },
        child: { id: 'child', parentId: 'task', title: '子任务', date: '2026-11-14', completed: true, kanbanStatus: 'completed', sort: 5 },
        leaf: { id: 'leaf', parentId: 'child', title: '孙任务', tagIds: ['tag'], completed: false },
        sibling: { id: 'sibling', parentId: 'parent', projectId: 'p', sort: 30, title: '兄弟任务' },
        unrelated: { id: 'unrelated', title: '其他项目', projectId: 'elsewhere' },
    };
    const view = fixture(data);
    // 模拟看板缓存过期以及聚合视图中合成的项目/分组 ID。
    const action = await view.duplicateTaskTree(view.plugin, { id: 'task', title: '旧标题', customGroupId: 'agg_fake', __realProjectId: 'p' });
    const copies = Object.values(view.data).filter(task => !data[task.id]);
    assert.equal(copies.length, 3);
    const copy = copies.find(task => task.title === '测试');
    const child = copies.find(task => task.title === '子任务');
    const leaf = copies.find(task => task.title === '孙任务');
    for (const key of ['date', 'time', 'endDate', 'endTime', 'note', 'projectId', 'customGroupId', 'milestoneId',
        'tagIds', 'categoryId', 'priority', 'kanbanStatus', 'reminderTimes', 'blockId',
        'estimatedPomodoroDuration', 'treatStartDateAsDeadline', 'reminderSkipWeekendMode']) {
        assert.deepEqual(copy[key], data.task[key], key);
    }
    assert.equal(copy.parentId, 'parent');
    assert.equal(child.parentId, copy.id);
    assert.equal(leaf.parentId, child.id);
    assert.equal(child.date, '2026-11-14');
    assert.equal(copy.sort, 20);
    assert.ok(copies.every(task => !task.completed && task.id.trim() === task.id));
    assert.equal(child.kanbanStatus, 'doing');
    for (const key of ['completedTime', 'notified', 'notifiedTimes', 'dailyCompletions', '__realProjectId']) {
        assert.equal(Object.hasOwn(copy, key), false, key);
    }
    assert.notEqual(copy.createdAt, 'old');
    assert.deepEqual(view.data.task, data.task);
    assert.equal(view.calls.events[0].type, 'reminderUpdated');
    assert.deepEqual(view.calls.notifications.sort(), copies.map(task => task.id).sort());
    assert.deepEqual(view.calls.blocks, ['block']);

    view.data.unrelated.note = '复制之后的其他编辑';
    assert.equal(await action.undo(), true);
    assert.deepEqual(Object.keys(view.data).sort(), Object.keys(data).sort());
    assert.equal(view.data.unrelated.note, '复制之后的其他编辑');
});

test('重复实例复制为完整新系列，以实例日期开始，保留规则和全部子任务模板', () => {
    const rule = { enabled: true, type: 'weekly', interval: 2, weekDays: [1, 5], endType: 'count', endCount: 12 };
    const data = {
        series: {
            id: 'series', title: '周期任务', date: '2026-11-02', endDate: '2026-11-04', time: '09:00',
            repeat: { ...rule, excludeDates: ['2026-11-20'], instances: { '2026-11-13': { title: '本次标题', time: '11:00' } } },
        },
        child: { id: 'child', parentId: 'series', title: '模板子任务', date: '2026-11-03', repeat: { instances: { '2026-11-13': { completed: true } } } },
        leaf: { id: 'leaf', parentId: 'child', title: '模板孙任务' },
        instanceOnly: { id: 'instanceOnly', parentId: 'series_2026-11-13', title: '本次添加的子任务', date: '2026-11-13' },
        instanceLeaf: { id: 'instanceLeaf', parentId: 'instanceOnly', title: '本次子任务的后代', date: '2026-11-14' },
        otherInstance: { id: 'otherInstance', parentId: 'series_2026-11-20', title: '其他实例子任务' },
    };
    const original = structuredClone(data);
    const view = fixture(data);
    const result = view.buildTaskTreeCopy(data, {
        id: 'series_2026-11-13', originalId: 'series', isRepeatInstance: true, date: '2026-11-13',
        projectId: 'synthetic', customGroupId: 'agg_fake',
    });
    const copies = Object.values(result.tasks);
    const copy = result.tasks[result.rootId];
    assert.equal(copies.length, 5);
    assert.equal(copy.date, '2026-11-13');
    assert.equal(copy.endDate, '2026-11-15');
    assert.equal(copy.title, '本次标题');
    assert.equal(copy.time, '11:00');
    assert.deepEqual(copy.repeat, rule);
    assert.equal(copy.isRepeatInstance, undefined);
    assert.equal(copy.originalId, undefined);
    const child = copies.find(task => task.title === '模板子任务');
    assert.equal(child.parentId, copy.id);
    assert.equal(child.date, '2026-11-14');
    assert.equal(child.repeat.instances, undefined);
    assert.equal(copies.find(task => task.title === '模板孙任务').parentId, child.id);
    const added = copies.find(task => task.title === '本次添加的子任务');
    assert.equal(added.parentId, copy.id);
    assert.equal(added.date, '2026-11-13');
    assert.equal(copies.find(task => task.title === '本次子任务的后代').date, '2026-11-14');
    copy.repeat.weekDays.push(3);
    assert.deepEqual(data, original, 'Copy must not share repeat configuration with source');
});

test('已移动实例使用当前实际日期作为新系列起点，并保留实例结束日期覆盖', () => {
    const data = {
        series: { id: 'series', date: '2026-11-01', endDate: '2026-11-02', repeat: {
            enabled: true, type: 'daily', interval: 1,
            instances: { '2026-11-13': { date: '2026-11-16', endDate: '2026-11-19' } },
        } },
    };
    const view = fixture(data);
    const result = view.buildTaskTreeCopy(data, { id: 'series_2026-11-13', originalId: 'series', isRepeatInstance: true, date: '2026-11-13' });
    const copy = result.tasks[result.rootId];
    assert.equal(copy.date, '2026-11-16');
    assert.equal(copy.endDate, '2026-11-19');
    assert.equal(copy.repeat.enabled, true);
});

test('直接复制重复任务模板保留起止日期和规则，但不复制历史实例', () => {
    const data = { task: { id: 'task', date: '2026-11-01', endDate: '2026-11-03', repeat: { enabled: true, type: 'monthly', interval: 1, instances: { old: { completed: true } } } } };
    const view = fixture(data);
    const result = view.buildTaskTreeCopy(data, { id: 'task' });
    assert.equal(result.tasks[result.rootId].date, '2026-11-01');
    assert.equal(result.tasks[result.rootId].endDate, '2026-11-03');
    assert.deepEqual(result.tasks[result.rootId].repeat, { enabled: true, type: 'monthly', interval: 1 });
});

test('新重复系列平移绝对日期提醒和逐日覆盖，但保留相对提醒配置', () => {
    const times = [
        '2026-11-01T09:00',
        { time: '09:30', dayOffset: 1 },
        { time: '2026-11-01T10:00', endTime: '2026-11-01T11:00', everyDay: true,
            overrides: { '2026-11-02': { time: '2026-11-02T12:00' } } },
    ];
    const data = { task: { id: 'task', date: '2026-11-01', repeat: { enabled: true, type: 'daily' }, reminderTimes: times } };
    const view = fixture(data);
    const result = view.buildTaskTreeCopy(data, { id: 'task_2026-11-13', originalId: 'task', isRepeatInstance: true, date: '2026-11-13' });
    const copy = result.tasks[result.rootId];
    assert.equal(copy.reminderTimes[0], '2026-11-13T09:00');
    assert.deepEqual(copy.reminderTimes[1], { time: '09:30', dayOffset: 1, endTime: undefined });
    assert.equal(copy.reminderTimes[2].endTime, '2026-11-13T11:00');
    assert.equal(copy.reminderTimes[2].overrides['2026-11-14'].time, '2026-11-14T12:00');
    assert.equal(data.task.reminderTimes[0], '2026-11-01T09:00');
});

test('损坏的循环关系只复制一次，并断开副本根的父循环', () => {
    const data = { a: { id: 'a', parentId: 'b' }, b: { id: 'b', parentId: 'a' } };
    const view = fixture(data);
    const result = view.buildTaskTreeCopy(data, { id: 'a' });
    assert.equal(Object.keys(result.tasks).length, 2);
    assert.equal(result.tasks[result.rootId].parentId, undefined);
    assert.equal(Object.values(result.tasks).find(task => task.id !== result.rootId).parentId, result.rootId);
});

test('保存失败时不改写原数据、不刷新、不注册通知', async () => {
    const data = { task: { id: 'task', title: '任务', completed: true } };
    const view = fixture(data, { failSave: true });
    await assert.rejects(view.duplicateTaskTree(view.plugin, { id: 'task' }), /save failed/);
    assert.deepEqual(view.data, data);
    assert.deepEqual(view.calls.events, []);
    assert.deepEqual(view.calls.notifications, []);
    assert.deepEqual(view.calls.blocks, []);
});

test('原任务或实例已删除时不恢复旧缓存内容', async () => {
    const view = fixture({});
    await assert.rejects(view.duplicateTaskTree(view.plugin, { id: 'deleted', title: '旧缓存' }), /reminderNotExist/);
    const series = fixture({ task: { id: 'task', repeat: { enabled: true, instances: { '2026-11-13': { deleted: true } } } } });
    await assert.rejects(series.duplicateTaskTree(series.plugin, { id: 'task_2026-11-13', originalId: 'task', isRepeatInstance: true }), /reminderNotExist/);
    assert.equal(series.calls.saves.length, 0);
});

test('并发创建副本串行读取最新数据，不丢失另一个面板刚创建的副本', async () => {
    const view = fixture({ task: { id: 'task', title: '任务' }, unrelated: { id: 'unrelated' } });
    await Promise.all([1, 2, 3].map(() => view.duplicateTaskTree(view.plugin, { id: 'task' })));
    assert.equal(Object.keys(view.data).length, 5);
    assert.equal(view.calls.saves.length, 3);
});
