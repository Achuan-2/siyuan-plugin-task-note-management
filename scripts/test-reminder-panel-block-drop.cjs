// Run with: pnpm exec node --test scripts/test-reminder-panel-block-drop.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const source = ts.createSourceFile('ReminderPanel.ts', fs.readFileSync(path.join(__dirname,
    '../src/components/panel/ReminderPanel.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['getReminderGroup', 'getReminderDisplayGroup', 'applyDropTargetGroupAttributes',
    'addContainerDragEvents', 'addItemByBlockId', 'extractSiYuanBlockIds', 'isSameNonPrioritySortGroup',
    'reorderReminders', 'reorderPriorityGroup', 'updateItemSort']);
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPanel')
    .members.filter(node => names.has(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Panel { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const today = '2026-11-13';
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(mode, target, { root, daily = false } = {}) {
    const tasks = [root, target].filter(Boolean);
    let data = Object.fromEntries(tasks.map(task => [task.id, clone(task)]));
    const events = {}, previews = [], errors = [];
    let nextId = 0, sorted = false, resolveLoaded;
    const loaded = new Promise(resolve => { resolveLoaded = resolve; });
    const container = { addEventListener(name, handler) { events[name] = handler; }, classList: { remove() {} } };
    const window = { Lute: { NewNodeID: () => `created-${++nextId}` }, dispatchEvent() {} };
    const dependencies = {
        i18n: key => key, getLogicalDateString: () => today, getRelativeDateString: () => '2026-11-14',
        getAllReminders: async () => clone(data),
        saveReminders: async (_plugin, reminders) => { data = clone(reminders); },
        updateBindBlockAtrrs: async () => {}, showMessage: message => errors.push(message),
        window, document: {}, console: { log() {}, error: (...args) => errors.push(args) },
        Constants: { SIYUAN_DROP_GUTTER: 'siyuan-gutter', SIYUAN_DROP_FILE: 'siyuan-file', SIYUAN_DROP_TAB: 'siyuan-tab' },
        parseReminderInstanceId: () => null,
    };
    const Panel = new Function(...Object.keys(dependencies), `${code};return Panel;`)(...Object.values(dependencies));
    const panel = Object.assign(new Panel(), {
        reminderGroupMode: mode, container, remindersContainer: container, currentRemindersCache: clone(tasks),
        optimisticUpdatesCache: new Map(), originalRemindersCache: {}, projectSortMetaCache: new Map(),
        plugin: {
            settings: { unassignedTasksProjectId: 'default-project' },
            getInheritedProjectAndGroup: async () => ({ projectId: 'block-project', categoryId: 'a',
                groupId: 'block-group', milestoneId: 'block-milestone' }),
        },
        categoryManager: { getCategories: () => [{ id: 'b' }, { id: 'a' }] },
        isTodayLikeView: () => daily,
        getReminderTodayGroup: task => task.isAvailableToday ? 'daily' : 'today',
        shouldTreatOnlyStartDateAsDeadline: task => !!task.date && task.treatStartDateAsDeadline !== false,
        getReminderLogicalDate: (date, time) => time === '01:00' ? '2026-11-12' : date,
        getFilterAttributes: async () => ({ defaultDate: today, defaultEndDate: '2026-11-20',
            defaultProjectId: 'filter-project', defaultCategoryId: 'a', defaultPriority: 'high' }),
        getBlockInfoSync: () => ({ title: '拖入的块', docId: '20261113000000-abcdefg' }),
        getBlockInfoForDrop: async () => ({ title: '拖入的块', docId: '20261113000000-abcdefg' }),
        isUuid: () => false, hideDropIndicator() {}, stopDragScroll() {},
        isDragDisabledBySortMode: () => false, getActiveSortCriteria: () => [{ method: 'priority' }],
        getNonPrioritySortGroupKey: () => '__ALLOW_ALL__',
        renderReminders(reminders) { previews.push(clone(reminders.filter(task => task.blockId))); },
        loadReminders: async () => { resolveLoaded(); },
    });
    const reorder = panel.reorderReminders.bind(panel);
    panel.reorderReminders = async (...args) => { sorted = true; return reorder(...args); };
    panel.addContainerDragEvents();
    return {
        panel, previews,
        async drop(dropType = 'after', blockIds = ['20261113000001-abcdefg']) {
            panel.getDropType = () => dropType;
            const element = { dataset: { reminderId: target.id, reminderGroup: daily ? 'daily' : undefined } };
            const gutterType = `siyuan-gutter\u200bmetadata\u200b${blockIds.join(',')}`;
            await events.drop({
                target: { closest: selector => selector === '.reminder-item' ? element : null },
                dataTransfer: { types: [gutterType], getData: () => '' }, preventDefault() {},
            });
            await loaded;
            assert.deepEqual(errors, []);
            const persisted = Object.values(data).filter(task => task.blockId);
            assert.equal(persisted.length, blockIds.length);
            assert.equal(sorted, dropType !== 'set-parent');
            return { preview: previews[0][0], persisted: persisted[0], all: persisted };
        },
    };
}

test('块拖到项目任务前后或设为子任务：预览和保存均优先使用目标项目', async () => {
    for (const dropType of ['before', 'after', 'set-parent']) {
        const { preview, persisted } = await fixture('project', { id: 'target', projectId: 'target-project' }).drop(dropType);
        for (const task of [preview, persisted]) assert.equal(task.projectId, 'target-project');
        assert.equal(persisted.customGroupId, undefined);
        assert.equal(persisted.milestoneId, undefined);
        assert.equal(persisted.parentId, dropType === 'set-parent' ? 'target' : undefined);
    }
});

test('无项目和无分类分组会覆盖块继承及筛选默认属性', async () => {
    for (const mode of ['project', 'category']) {
        const field = mode === 'project' ? 'projectId' : 'categoryId';
        const { preview, persisted } = await fixture(mode, { id: 'target' }).drop('set-parent');
        for (const task of [preview, persisted]) assert.equal(task[field] || '', '');
    }
});

test('分类分组使用管理顺序中的首个分类，优先级分组继承目标优先级', async () => {
    const category = await fixture('category', { id: 'target', categoryId: 'a,b' }).drop();
    for (const task of [category.preview, category.persisted]) assert.equal(task.categoryId, 'b');
    const priority = await fixture('priority', { id: 'target', priority: 'low' }).drop('set-parent');
    for (const task of [priority.preview, priority.persisted]) assert.equal(task.priority, 'low');
});

test('日期分组继承起止日期、时间与截止日期设置，不保留筛选默认结束日期', async () => {
    for (const dates of [
        { date: '2026-11-16' },
        { date: '2026-11-01', endDate: '2026-11-18', time: '09:00', endTime: '18:00' },
        { date: today, time: '01:00' },
        {},
        { date: today, treatStartDateAsDeadline: false },
    ]) {
        const f = fixture('date', { id: 'target', ...dates });
        const result = await f.drop();
        for (const task of [result.preview, result.persisted]) {
            for (const field of ['date', 'endDate', 'time', 'endTime', 'treatStartDateAsDeadline']) {
                assert.equal(task[field], dates[field], field);
            }
            assert.equal(f.panel.getReminderGroup(task, today).key, f.panel.getReminderGroup(dates, today).key);
        }
    }
});

test('目标是子任务时按可见根继承四种分组，排序不会覆盖继承的优先级', async () => {
    const root = { id: 'root', projectId: 'root-project', categoryId: 'b', priority: 'low', date: '2026-11-19' };
    const target = { id: 'target', parentId: 'root', projectId: 'child-project', categoryId: 'a', priority: 'high', date: today };
    for (const [mode, field] of [['project', 'projectId'], ['category', 'categoryId'], ['priority', 'priority'], ['date', 'date']]) {
        const { preview, persisted } = await fixture(mode, target, { root }).drop();
        for (const task of [preview, persisted]) {
            assert.equal(task[field], root[field]);
            assert.equal(task.parentId, 'root');
        }
    }
});

test('重复实例使用当前实例日期和父 ID，批量拖入逐项继承', async () => {
    const target = { id: 'instance', isRepeatInstance: true, originalId: 'original', date: '2026-11-17' };
    const { all } = await fixture('date', target).drop('set-parent', ['20261113000001-abcdefg', '20261113000002-abcdefg']);
    for (const task of all) {
        assert.equal(task.date, target.date);
        assert.equal(task.parentId, target.id);
        assert.equal(task.isRepeatInstance, undefined);
    }
});

test('每日可做保持无日期，同时继承二级项目分组', async () => {
    for (const mode of ['project', 'date']) {
        const { preview, persisted } = await fixture(mode, { id: 'target', projectId: 'daily-project',
            isAvailableToday: true, date: '2026-11-19' }, { daily: true }).drop();
        for (const task of [preview, persisted]) {
            assert.equal(task.isAvailableToday, true);
            assert.equal(task.date, undefined);
            assert.equal(task.endDate, undefined);
            if (mode === 'project') assert.equal(task.projectId, 'daily-project');
        }
    }
});

test('未启用分组仍沿用原有块项目继承和筛选日期', async () => {
    const { persisted } = await fixture('none', { id: 'target', projectId: 'target-project', date: '2026-11-19' }).drop();
    assert.equal(persisted.projectId, 'block-project');
    assert.equal(persisted.customGroupId, 'block-group');
    assert.equal(persisted.date, today);
    assert.equal(persisted.endDate, '2026-11-20');
});
