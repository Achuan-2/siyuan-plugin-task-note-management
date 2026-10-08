// Run with: pnpm exec node --test scripts/test-reminder-panel-refresh.cjs
// Exercise the real panel loading/filtering methods with controlled async dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const today = '2026-10-08';
const copy = value => JSON.parse(JSON.stringify(value));

function extract(relative, className, names) {
    const text = process.env.REMINDER_PANEL_SOURCE_REF && className
        ? execFileSync('git', ['show', `${process.env.REMINDER_PANEL_SOURCE_REF}:${relative}`], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(path.join(root, relative), 'utf8');
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true);
    const members = className
        ? source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className).members
        : source.statements;
    return members.filter(node => names.includes(node.name?.getText(source)))
        .map(node => node.getText(source).replace(/^export /, '')).join('\n');
}
const methods = extract('src/components/panel/ReminderPanel.ts', 'ReminderPanel', [
    'loadReminders', 'renderReminders', 'mergeOptimisticReminderUpdates', 'invalidatePendingReminderLoad',
    'shouldSingleReminderShowInCurrentView', 'filterRemindersByTab', 'filterTodayTabReminders',
    'getAllDescendantIds', 'getAllAncestorIds',
]);
const cleaning = extract('src/utils/reminderLoadUtils.ts', null, ['cleanReminderItem', 'cleanInstanceState']);
const code = ts.transpileModule(`${cleaning}\nclass Panel { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const Panel = new Function('getAllReminders', 'saveReminders', 'getLogicalDateString', 'getRelativeDateString',
    'getLocalDateString', 'compareDateStrings', 'i18n', 'showMessage', code + ';return Panel;')(
    (plugin, _project, force) => plugin.read(force), async () => {}, () => today,
    offset => { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() + offset); return date.toISOString().slice(0, 10); },
    date => date.toISOString().slice(0, 10), (a, b) => String(a).localeCompare(String(b)), key => key,
    message => { throw new Error(message); },
);
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}
function task(extra = {}) { return { id: 'a', title: '任务', date: today, completed: false, ...extra }; }
function fixture(read = async () => ({ a: task() })) {
    const commits = [];
    const panel = Object.assign(new Panel(), {
        plugin: { read }, isLoading: false, reminderLoadVersion: 0,
        pendingReminderLoad: false, pendingReminderForceLoad: false,
        currentTab: 'today', currentCategoryFilter: 'all', currentRemindersCache: [],
        allRemindersMap: new Map(), optimisticUpdatesCache: new Map(), isPaginationEnabled: false,
        container: { querySelector: () => null },
        buildMilestoneMap: async () => {}, refreshReminderSkipDateContext: async () => {},
        getActiveSortCriteria: () => [], generateAllRemindersWithInstances: data => Object.values(data),
        filterArchivedGroupTasks: async tasks => tasks, ensureProjectKanbanStatusNameCache: async () => {},
        applyCategoryFilter: tasks => tasks.filter(item => !panel.selectedCategories || panel.selectedCategories.includes(item.categoryId)),
        applySearchFilter: tasks => tasks, sortReminders: () => {},
        preprocessAsyncData: async () => new Map(),
        renderRemindersIteratively: tasks => { commits.push(copy(tasks)); },
        isReminderInAbandonedKanbanStatus: () => false, isOpenEndedStartDateTask: () => false,
        canReminderShowOnDate: () => true, hasTodayIgnoreMark: () => false,
        shouldTreatOnlyStartDateAsDeadline: () => false,
        getReminderLogicalDate: date => date,
        isReminderActiveOnAllowedDate: item => item.date === today,
        canApplyTodayIgnore: () => false, isFutureTaskRemindedOnDate: () => false,
        hasDailyCompletionMark: () => false, isDatelessReminderActiveOnDate: () => false,
        getCustomFilterConfig: () => ({ categoryFilters: ['all'] }), currentCustomFilterId: 'today',
        applyCustomFilter: (tasks, _tab, date, completed) => tasks.filter(item => item.date === date && !completed(item)),
    });
    panel.remindersContainer = {
        scrollTop: 20, scrollLeft: 0,
        set innerHTML(value) { commits.push(value); },
    };
    return { panel, commits };
}

test('编辑自定义今日筛选中的任务，局部筛选与完整筛选一致', () => {
    const { panel } = fixture();
    panel.currentTab = 'custom_today';
    const saved = task({ title: '编辑后的标题' });
    assert.equal(panel.filterRemindersByTab([saved], today).length, 1);
    assert.equal(panel.shouldSingleReminderShowInCurrentView(saved), true);
    assert.equal(panel.shouldSingleReminderShowInCurrentView(task({ date: '2026-10-09' })), false);
    assert.equal(panel.shouldSingleReminderShowInCurrentView(task({ completed: true })), false);
});

test('编辑后沿用多分类筛选，不读取旧的单分类状态', () => {
    const { panel } = fixture();
    panel.selectedCategories = ['work', 'life'];
    panel.currentCategoryFilter = 'work';
    assert.equal(panel.shouldSingleReminderShowInCurrentView(task({ categoryId: 'life' })), true);
    assert.equal(panel.shouldSingleReminderShowInCurrentView(task({ categoryId: 'other' })), false);
});

test('加载中收到强制刷新，过期空快照不能清空今日任务', async () => {
    const firstRead = deferred(), entered = deferred();
    const forces = [];
    const { panel, commits } = fixture(async force => {
        forces.push(force);
        if (forces.length === 1) { entered.resolve(); return firstRead.promise; }
        return { a: task({ title: '新快照' }) };
    });
    const loading = panel.loadReminders();
    await entered.promise;
    await panel.loadReminders(true);
    firstRead.resolve({});
    await loading;
    assert.deepEqual(forces, [false, true]);
    assert.deepEqual(commits, [[task({ title: '新快照' })]]);
    assert.equal(panel.isLoading, false);
});

test('异步预处理期间编辑任务，旧结果不提交，后续刷新保留乐观内容', async () => {
    const preparation = deferred(), entered = deferred();
    const { panel, commits } = fixture();
    let calls = 0;
    panel.preprocessAsyncData = async () => {
        if (++calls === 1) { entered.resolve(); await preparation.promise; }
        return new Map();
    };
    const loading = panel.loadReminders();
    await entered.promise;
    panel.optimisticUpdatesCache.set('a', task({ note: '新备注' }));
    panel.invalidatePendingReminderLoad();
    preparation.resolve();
    await loading;
    assert.deepEqual(commits, [[task({ note: '新备注' })]]);
    assert.equal(calls, 2);
});

test('加载中的普通更新通知也排队，不丢掉最新数据', async () => {
    const firstRead = deferred(), entered = deferred();
    let calls = 0;
    const { panel, commits } = fixture(async () => {
        if (++calls === 1) { entered.resolve(); return firstRead.promise; }
        return { a: task({ title: '后台保存完成' }) };
    });
    const loading = panel.loadReminders();
    await entered.promise;
    await panel.loadReminders();
    firstRead.resolve({ a: task() });
    await loading;
    assert.deepEqual(commits, [[task({ title: '后台保存完成' })]]);
});

test('仅确认已持久化的乐观编辑，不因其他任务通知覆盖尚未落盘的编辑', () => {
    const { panel } = fixture();
    panel.optimisticUpdatesCache.set('a', task({ note: '待保存', priority: 'none', blockId: null }));
    const oldData = { a: task() };
    panel.mergeOptimisticReminderUpdates(oldData);
    assert.equal(oldData.a.note, '待保存');
    assert.equal(panel.optimisticUpdatesCache.size, 1);
    panel.mergeOptimisticReminderUpdates({ a: task({ note: '待保存' }) });
    assert.equal(panel.optimisticUpdatesCache.size, 0);
});

test('真正无今日任务时仍正确显示空状态', async () => {
    const { panel, commits } = fixture(async () => ({}));
    await panel.loadReminders();
    assert.equal(commits.length, 1);
    assert.match(commits[0], /reminder-empty/);
});

test('重复实例备注落盘后释放模板缓存，忽略保存过程生成的时间戳', () => {
    const { panel } = fixture();
    const optimistic = task({ repeat: { enabled: true, type: 'daily', instances: {
        [today]: { note: '实例备注', modifiedAt: '2026-10-08T01:00:00Z' },
    } } });
    panel.optimisticUpdatesCache.set('a', copy(optimistic));
    const persisted = copy(optimistic);
    persisted.repeat.instances[today].modifiedAt = '2026-10-08T01:00:01Z';
    panel.mergeOptimisticReminderUpdates({ a: persisted });
    assert.equal(panel.optimisticUpdatesCache.size, 0);
    assert.equal(optimistic.repeat.instances[today].note, '实例备注');
});

test('确认保存后外部完成或删除不会被旧乐观缓存撤销', async () => {
    let data = { a: task({ note: '保存成功' }) };
    const { panel, commits } = fixture(async () => copy(data));
    panel.optimisticUpdatesCache.set('a', copy(data.a));
    await panel.loadReminders();
    data.a.completed = true;
    await panel.loadReminders();
    data = {};
    await panel.loadReminders();
    assert.equal(panel.optimisticUpdatesCache.size, 0);
    assert.deepEqual(commits[0], [task({ note: '保存成功' })]);
    assert.match(commits[1], /reminder-empty/);
    assert.match(commits[2], /reminder-empty/);
});

test('显式强制刷新可丢弃未保存成功的乐观编辑', async () => {
    const { panel, commits } = fixture();
    panel.optimisticUpdatesCache.set('a', task({ title: '未成功保存' }));
    await panel.loadReminders(true);
    assert.equal(panel.optimisticUpdatesCache.size, 0);
    assert.deepEqual(commits, [[task()]]);
});
