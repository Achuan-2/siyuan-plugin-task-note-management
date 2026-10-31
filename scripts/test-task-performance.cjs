// Run with: node --test scripts/test-task-performance.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const today = '2026-10-31';

function load(relative) {
    const file = path.resolve(root, relative);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', code)(name => {
        if (name.endsWith('/dateUtils')) return { getLogicalDateString: () => today };
        assert.ok(name.startsWith('.'), `Unexpected dependency: ${name}`);
        return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    }, exports);
    return exports;
}
const { TaskHierarchyIndex } = load('src/utils/taskHierarchy.ts');
const { PomodoroRecordManager } = load('src/components/dataManager/pomodoroRecord.ts');
function fixture(tasks, sessions = []) {
    let reads = 0;
    const manager = new PomodoroRecordManager({ loadReminderData: async () => { reads++; return tasks; } });
    manager.isInitialized = true;
    manager.getToday = () => today;
    manager.records = {
        [today]: { sessions },
        '2026-10-30': { sessions: [{ eventId: 'root', type: 'work', duration: 25, count: 1 }] },
    };
    manager.refreshIndex();
    return { manager, reads: () => reads };
}
const session = (eventId, extra = {}) => ({ eventId, type: 'work', duration: 25, count: 1, ...extra });

async function compareWithExisting(tasks, visible = Object.values(tasks), sessions = []) {
    const { manager } = fixture(tasks, sessions);
    const expected = new Map();
    for (const reminder of visible) expected.set(reminder.id, await manager.resolveReminderPomodoroStats(reminder, tasks));
    const actual = await manager.resolveReminderPomodoroStatsBatch(visible, tasks);
    assert.deepEqual(actual, expected);
    return actual;
}

test('层级索引保持原顺序，兼容缺失父任务和循环关系', () => {
    const index = new TaskHierarchyIndex([
        { id: 'root', parentId: 'grandchild' }, { id: 'a', parentId: 'root' },
        { id: 'b', parentId: 'root' }, { id: 'grandchild', parentId: 'b' },
        { id: 'orphan', parentId: 'missing' },
    ]);
    assert.deepEqual(index.descendantIds('root'), ['a', 'b', 'grandchild']);
    assert.deepEqual(index.descendantIds('missing'), ['orphan']);
    assert.deepEqual(index.children('none'), []);
});

test('普通父子任务的累计、今日和专注时长与旧实现一致', async () => {
    const tasks = {
        root: { id: 'root' }, child: { id: 'child', parentId: 'root' },
        leaf: { id: 'leaf', parentId: 'child' }, orphan: { id: 'orphan', parentId: 'missing' },
    };
    const actual = await compareWithExisting(tasks, undefined, [session('root'), session('child'), session('leaf')]);
    assert.deepEqual(actual.get('root'), {
        pomodoroCount: 4, focusTime: 100, todayPomodoroCount: 3, todayFocusTime: 75,
        totalRepeatingPomodoroCount: 0, totalRepeatingFocusTime: 0,
    });
});

test('重复系列、显式实例与 ghost 子任务保持独立统计语义', async () => {
    const tasks = {
        root: { id: 'root', repeat: { enabled: true } },
        child: { id: 'child', parentId: 'root', repeat: { enabled: true } },
        [`root_${today}`]: { id: `root_${today}`, originalId: 'root', isRepeatInstance: true },
        [`ghost_${today}`]: { id: `ghost_${today}`, parentId: `root_${today}`, isRepeatInstance: true, originalId: 'child' },
        [`child_${today}`]: { id: `child_${today}`, parentId: 'root', originalId: 'child', isRepeatInstance: true },
    };
    const actual = await compareWithExisting(tasks, undefined, [
        session(`root_${today}`), session(`child_${today}`), session(`ghost_${today}`), session('root_other'),
    ]);
    assert.equal(actual.get(`root_${today}`).pomodoroCount, 2);
    assert.equal(actual.get(`root_${today}`).totalRepeatingPomodoroCount, 2);
});

test('旧版实例时长、正计时、休息和进行中会话保持原结果', async () => {
    const tasks = {
        root: { id: 'root', repeat: { enabled: true, instancePomodoroCount: { historical: 2 } } },
        child: { id: 'child', parentId: 'root' },
    };
    await compareWithExisting(tasks, undefined, [
        session('historical'), session('child', { isCountUp: true, duration: 60, plannedDuration: 25 }),
        session('root', { inProgress: true }), session('child', { type: 'shortBreak' }),
    ]);
});

test('输入快照与本地存储不同，仍保留旧实现的本地累计统计边界', async () => {
    const local = { root: { id: 'root' }, local: { id: 'local', parentId: 'root' } };
    const visible = { root: local.root, subscription: { id: 'subscription', parentId: 'root' } };
    const { manager } = fixture(local, [session('local'), session('subscription')]);
    const expected = await manager.resolveReminderPomodoroStats(visible.root, visible);
    const actual = await manager.resolveReminderPomodoroStatsBatch([visible.root], visible);
    assert.deepEqual(actual.get('root'), expected);
});

test('Map、数组输入一致，后续刷新不沿用旧父子关系或统计', async () => {
    const tasks = { root: { id: 'root' }, child: { id: 'child', parentId: 'root' } };
    const { manager } = fixture(tasks, [session('child')]);
    const values = Object.values(tasks);
    const first = await manager.resolveReminderPomodoroStatsBatch(values, values);
    assert.deepEqual(await manager.resolveReminderPomodoroStatsBatch(values, new Map(values.map(t => [t.id, t]))), first);
    tasks.child.parentId = 'other';
    const moved = await manager.resolveReminderPomodoroStatsBatch(values, tasks);
    assert.equal(first.get('root').todayPomodoroCount, 1);
    assert.equal(moved.get('root').todayPomodoroCount, 0);
    assert.equal(moved.get('root').pomodoroCount, 1);
    manager.records[today].sessions.push(session('root'));
    manager.refreshIndex();
    const next = await manager.resolveReminderPomodoroStatsBatch(values, tasks);
    assert.equal(next.get('root').todayPomodoroCount, 1);
    assert.equal(next.get('root').pomodoroCount, 2);
});

test('空列表不初始化或读取任务，跨天刷新重新扫描当天会话', async () => {
    const tasks = { root: { id: 'root' } };
    const { manager, reads } = fixture(tasks, [session('root'), session('root')]);
    assert.equal((await manager.resolveReminderPomodoroStatsBatch([], tasks)).size, 0);
    assert.equal(reads(), 0);
    manager.getToday = () => '2026-10-30';
    const stats = await manager.resolveReminderPomodoroStatsBatch(Object.values(tasks), tasks);
    assert.equal(stats.get('root').todayPomodoroCount, 1);
});

test('多组有下划线 ID、重复实例和父子关系的数据与旧实现逐项一致', async () => {
    for (let seed = 0; seed < 12; seed++) {
        const tasks = {};
        const sessions = [];
        for (let i = 0; i < 24; i++) {
            const id = `task_${i}`;
            tasks[id] = { id, ...(i > 0 && (i + seed) % 3 ? { parentId: `task_${Math.floor((i - 1) / 2)}` } : {}) };
            if ((i + seed) % 4 === 0) {
                tasks[id].repeat = { enabled: true };
                const instanceId = `${id}_${today}`;
                tasks[instanceId] = { id: instanceId, originalId: id, isRepeatInstance: true, parentId: tasks[id].parentId };
                sessions.push(session(instanceId));
            }
            sessions.push(session(id, { duration: i + 1 }));
        }
        await compareWithExisting(tasks, undefined, sessions);
    }
});

test('5000 条独立任务只读一次本地任务和当天会话，不逐任务全量扫描', async () => {
    let idReads = 0, sessionReads = 0;
    const tasks = {};
    for (let i = 0; i < 5000; i++) {
        tasks[`task_${i}`] = { get id() { idReads++; return `task_${i}`; } };
    }
    const { manager, reads } = fixture(tasks);
    const getSessions = manager.getDateSessions.bind(manager);
    manager.getDateSessions = date => { sessionReads++; return getSessions(date); };
    const actual = await manager.resolveReminderPomodoroStatsBatch(Object.values(tasks), tasks);
    assert.equal(actual.size, 5000);
    assert.equal(reads(), 1);
    assert.equal(sessionReads, 1);
    assert.ok(idReads < 5000 * 12, `Unexpected full scans: ${idReads} id reads`);
});

function panelClass() {
    const relative = 'src/components/panel/ReminderPanel.ts';
    const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
    const names = ['renderRemindersIteratively', 'getReminderElementSignature', 'getReminderBadgeVisibility', 'preprocessAsyncData'];
    const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'ReminderPanel').members;
    const code = ts.transpileModule(`class Panel { ${members.filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
    }).outputText;
    return new Function('TaskHierarchyIndex', 'cleanReminderItem', 'parseReminderInstanceId', 'i18n', code + '; return Panel;')(
        TaskHierarchyIndex, load('src/utils/reminderLoadUtils.ts').cleanReminderItem, () => null, key => key,
    );
}

test('侧栏共用本轮索引，保持深度优先顺序、折叠和隐藏父任务展示', () => {
    const Panel = panelClass();
    const panel = new Panel();
    const tasks = [
        { id: 'root' }, { id: 'child', parentId: 'root' }, { id: 'leaf', parentId: 'child' },
        { id: 'other' }, { id: 'orphan', parentId: 'missing' },
    ];
    const contexts = new Set();
    let rendered;
    Object.assign(panel, {
        allRemindersMap: new Map(tasks.map(t => [t.id, t])),
        isTodayLikeView: () => false, currentTab: 'all', isTaskCollapsed: id => id === 'child',
        createReminderElementOptimized: (task, _cache, _today, level, _visible, indexes) => {
            contexts.add(indexes); return `${task.id}:${level}`;
        },
        reconcileReminderElements: elements => { rendered = elements; },
    });
    panel.renderRemindersIteratively(tasks, new Map(), today);
    assert.deepEqual(rendered, ['root:0', 'child:1', 'other:0', 'orphan:0']);
    assert.equal(contexts.size, 1);
    assert.equal([...contexts][0].all.byId.size, tasks.length);
});

test('侧栏预处理只读取一次项目并批量统计，保留项目、习惯和缺省值', async () => {
    const Panel = panelClass();
    const panel = new Panel();
    const tasks = [{ id: 'a', projectId: 'p', linkedHabitId: 'habit' }, { id: 'b', projectId: 'p' }, { id: 'c' }];
    const fullData = Object.fromEntries(tasks.map(t => [t.id, t]));
    let projectReads = 0, batches = 0;
    const project = { id: 'p', name: '项目' }, habit = { title: '习惯' };
    Object.assign(panel, {
        isTaskCardDocumentTitleEnabled: () => false,
        plugin: {
            loadProjectData: async () => { projectReads++; return { p: project }; },
            loadHabitData: async () => ({ habit }),
        },
        pomodoroRecordManager: {
            resolveReminderPomodoroStatsBatch: async (reminders, data) => {
                batches++;
                assert.equal(reminders, tasks);
                assert.equal(data, fullData);
                return new Map([['a', { pomodoroCount: 2, focusTime: 50 }]]);
            },
        },
    });
    const data = await panel.preprocessAsyncData(tasks, fullData);
    assert.equal(projectReads, 1);
    assert.equal(batches, 1);
    assert.equal(data.get('a').project, project);
    assert.equal(data.get('a').habit, habit);
    assert.equal(data.get('a').pomodoroCount, 2);
    assert.equal(data.get('b').pomodoroCount, 0);
    assert.equal(data.get('c').project, null);
});

test('共享索引不改变卡片复用签名或父子标签规则', () => {
    const Panel = panelClass();
    const panel = new Panel();
    const tasks = [{ id: 'root', title: '根', projectId: 'p', categoryId: 'a,b' },
        { id: 'child', parentId: 'root', title: '子', projectId: 'p', categoryId: 'b,a' }];
    Object.assign(panel, {
        allRemindersMap: new Map(tasks.map(t => [t.id, t])), currentRemindersCache: tasks,
        currentTab: 'all', selectedReminderIds: new Set(), plugin: { settings: {} },
        milestoneMap: new Map(), categoryManager: { getCategoryById: id => ({ id }) },
        isTaskCollapsed: () => false, isTaskCardDocumentTitleEnabled: () => true,
        getReminderKanbanStatusInfo: () => null,
    });
    const indexes = { all: new TaskHierarchyIndex(tasks), visible: new TaskHierarchyIndex(tasks) };
    const plain = panel.getReminderElementSignature(tasks[1], new Map(), today, 1, tasks);
    assert.equal(panel.getReminderElementSignature(tasks[1], new Map(), today, 1, tasks, indexes), plain);
    assert.deepEqual(panel.getReminderBadgeVisibility(tasks[1], 1, tasks, indexes), { showProjectBadge: false, showCategoryBadge: false });
    const changed = tasks.map(t => ({ ...t, ...(t.id === 'root' ? { completed: true } : {}) }));
    panel.allRemindersMap = new Map(changed.map(t => [t.id, t]));
    const next = { all: new TaskHierarchyIndex(changed), visible: new TaskHierarchyIndex(changed) };
    assert.notEqual(panel.getReminderElementSignature(changed[0], new Map(), today, 0, changed, next),
        panel.getReminderElementSignature(tasks[0], new Map(), today, 0, tasks, indexes));
});
