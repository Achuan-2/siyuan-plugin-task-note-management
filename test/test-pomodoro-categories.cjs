const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
const clone = value => JSON.parse(JSON.stringify(value));
const dateString = value => {
    const date = value ? new Date(value) : new Date(2026, 10, 16, 12);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
function load(relative, overrides = {}) {
    const file = path.resolve(root, relative);
    if (!Object.keys(overrides).length && modules.has(file)) return modules.get(file);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', compiled)(name => {
        if (overrides[name]) return overrides[name];
        if (name.endsWith('/dateUtils')) return { getLocalDateString: dateString, getLogicalDateString: dateString, getDayStartMinutes: () => 0 };
        assert.ok(name.startsWith('.'), name);
        return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    }, exports);
    if (!Object.keys(overrides).length) modules.set(file, exports);
    return exports;
}
const categoriesModule = load('src/utils/pomodoroCategories.ts');
const { loadPomodoroCategories, changePomodoroCategories, getPomodoroCategoryStats, POMODORO_CATEGORIES_FILE } = categoriesModule;
const { PomodoroRecordManager } = load('src/components/dataManager/pomodoroRecord.ts');
const { summarizePomodoroDay } = load('src/utils/pomodoroStore.ts');
const categories = [{ id: 'pc_work', name: '写作', color: '#123456' }, { id: 'pc_break', name: '散步', color: '#654321' }];
const day = '2026-11-16';
const startTime = `${day}T10:00:00`, endTime = `${day}T10:25:00`;
function recordFixture() {
    const records = {};
    const manager = new PomodoroRecordManager({
        loadPomodoroRecords: async () => clone(records),
        saveData: async (file, value) => { records[path.basename(file, '.json')] = clone(value); },
    });
    return { manager, records };
}

test('工作和两种休息仅保存各自分类，任务 ID 和标题不提供分类', async () => {
    const { manager } = recordFixture();
    const work = await manager.recordWorkSession(25, 'task', '任务', 25, true, false, { startTime, endTime, categoryId: 'pc_work' });
    await manager.recordBreakSession(5, 'task', '任务', 5, false, true, { startTime, endTime, categoryId: 'pc_break' });
    await manager.recordBreakSession(15, 'task', '任务', 15, true, true, { startTime, endTime });
    assert.equal(work.categoryId, 'pc_work');
    assert.deepEqual(manager.getDateSessions(day).map(item => item.categoryId), ['pc_work', 'pc_break', undefined]);
    const summary = manager.getDaySummary(day);
    assert.deepEqual({ ...summary.workByCategory.pc_work }, { duration: 25, count: 1 });
    assert.equal(summary.breakByCategory.pc_break.duration, 5);
    assert.equal(summary.breakByCategory[''].duration, 15);
});

test('运行中仅更新分类，保留备注和计时；完成时保留最新分类，允许清空', async () => {
    const { manager } = recordFixture();
    const id = await manager.startWorkSession('task', '任务', 25, false, startTime, 'pc_work');
    await manager.updateSessionNote(id, '保留备注');
    assert.equal(await manager.updateSessionCategory(id, 'pc_break'), true);
    const active = (await manager.getFocusById(id)).session;
    assert.equal(active.inProgress, true);
    assert.equal(active.duration, 0);
    assert.equal(active.note, '保留备注');
    assert.deepEqual(Object.keys(manager.getDaySummary(day).workByCategory), []);
    const finished = await manager.finishWorkSession(id, 25, 'task', '任务', 25, true, false, { endTime });
    assert.equal(finished.categoryId, 'pc_break');
    assert.equal(finished.note, '保留备注');
    assert.equal(manager.getDateSessions(day).length, 1);
    await manager.updateSessionCategory(id, undefined);
    assert.equal((await manager.getFocusById(id)).session.categoryId, undefined);
    assert.equal(manager.getDaySummary(day).workByCategory[''].duration, 25);
});

test('MCP 创建、补录和编辑均保留独立分类，旧记录默认未分类', async () => {
    const { manager } = recordFixture();
    const created = await manager.createFocus({ type: 'work', eventId: 'task', startTime, endTime, categoryId: 'pc_work' });
    assert.equal(created.categoryId, 'pc_work');
    await manager.updateSession({ ...created, type: 'shortBreak', categoryId: 'pc_break' });
    assert.equal(manager.getDaySummary(day).breakByCategory.pc_break.duration, 25);
    const legacy = await manager.recordWorkSession(25, 'task', '任务', 25, true, false, { startTime, endTime });
    assert.equal(legacy.categoryId, undefined);
    assert.equal(manager.getDaySummary(day).workByCategory[''].duration, 25);
});

test('分类统计排除进行中记录，区分工作休息；删除分类及历史余额归未分类', () => {
    const sessions = [
        { type: 'work', id: 'a', eventId: 'same-task', categoryId: 'pc_work', duration: 25 },
        { type: 'work', id: 'b', eventId: 'same-task', categoryId: 'deleted', duration: 10 },
        { type: 'work', id: 'c', categoryId: 'pc_work', duration: 8, inProgress: true },
        { type: 'shortBreak', id: 'd', eventId: 'same-task', categoryId: 'pc_break', duration: 5 },
        { type: 'longBreak', id: 'e', eventId: 'same-task', duration: 15 },
    ];
    const summary = summarizePomodoroDay(day, { date: day, sessions, totalWorkTime: 45, totalBreakTime: 20, workSessions: 3 }, () => 1);
    const stats = getPomodoroCategoryStats([summary], categories, 'work');
    assert.deepEqual({ ...stats.pc_work }, { time: 25, count: 1 });
    assert.deepEqual({ ...stats[''] }, { time: 20, count: 2 });
    assert.equal(Object.values(stats).reduce((sum, item) => sum + item.time, 0), 45);
    const breaks = getPomodoroCategoryStats([summary], categories, 'break');
    assert.deepEqual({ ...breaks.pc_break }, { time: 5, count: 0 });
    assert.deepEqual({ ...breaks[''] }, { time: 15, count: 0 });
    assert.equal(getPomodoroCategoryStats([summary], [], 'work')[''].time, 45);
});

test('独立分类只访问自己的文件，串行编辑重新读取列表，损坏数据不会被覆盖', async () => {
    let data = clone(categories), writes = 0;
    const plugin = {
        loadData: async file => { assert.equal(file, POMODORO_CATEGORIES_FILE); return clone(data); },
        saveData: async (file, value) => { assert.equal(file, POMODORO_CATEGORIES_FILE); data = clone(value); writes++; },
    };
    await Promise.all([
        changePomodoroCategories(plugin, items => items.map(item => item.id === 'pc_work' ? { ...item, name: '新名称' } : item)),
        changePomodoroCategories(plugin, items => items.filter(item => item.id !== 'pc_break')),
    ]);
    assert.deepEqual(await loadPomodoroCategories(plugin), [{ ...categories[0], name: '新名称' }]);
    assert.equal(writes, 2);
    data = { broken: true };
    await assert.rejects(changePomodoroCategories(plugin, () => []), /Invalid pomodoro/);
    assert.equal(writes, 2);
});

test('真实思源 loadData 缺文件返回空字符串时视为空列表，首次新增正常保存', async () => {
    let stored = ''; // SiYuan Plugin.loadData initializes this.data[file] to '' on a missing file.
    let writes = 0;
    const plugin = {
        loadData: async file => { assert.equal(file, POMODORO_CATEGORIES_FILE); return stored; },
        saveData: async (file, data) => { assert.equal(file, POMODORO_CATEGORIES_FILE); stored = clone(data); writes++; },
    };
    assert.deepEqual(await loadPomodoroCategories(plugin), []);
    assert.equal(writes, 0, 'Reading an absent optional file must not write an empty replacement');
    await changePomodoroCategories(plugin, items => [...items, categories[0]]);
    assert.deepEqual(await loadPomodoroCategories(plugin), [categories[0]]);
    assert.equal(writes, 1);
    for (const invalid of [false, 0, '[]', {}, [{ id: 'broken' }]]) {
        stored = invalid;
        await assert.rejects(loadPomodoroCategories(plugin), /Invalid pomodoro categories/);
    }
    assert.equal(writes, 1);
});

class Element {
    children = []; listeners = {}; value = ''; style = {};
    append(...items) { this.children.push(...items); }
    appendChild(item) { this.append(item); }
    after(item) { this.sibling = item; }
    replaceChildren(...items) { this.children = items; }
    setAttribute() {}
    addEventListener(name, callback) { this.listeners[name] = callback; }
    focus() {}
}
test('实际共用选择控件为单选，初始化及保存不读取任务分类，删除后显示未分类', async () => {
    const documentBefore = global.document;
    global.document = { createElement: () => new Element() };
    try {
        let stored = clone(categories);
        const plugin = { loadData: async file => { assert.equal(file, POMODORO_CATEGORIES_FILE); return stored; } };
        const { mountPomodoroCategoryControl, renderPomodoroCategoryBadge } = load('src/components/dialog/pomodoroCategoryControl.ts', {
            siyuan: { showMessage() {} }, '../../pluginInstance': { i18n: key => key },
            '../../utils/pomodoroCategories': categoriesModule,
        });
        const anchor = new Element();
        const control = mountPomodoroCategoryControl(anchor, plugin, 'pc_work');
        await control.ready;
        const select = anchor.sibling.children[1].children[0];
        assert.equal(select.multiple, undefined);
        assert.deepEqual(select.children.map(option => option.value), ['', 'pc_work', 'pc_break']);
        assert.equal(await control.value(), 'pc_work');
        select.value = 'pc_break';
        assert.equal(await control.value(), 'pc_break');
        select.value = '';
        assert.equal(await control.value(), undefined);
        stored = '';
        const deleted = mountPomodoroCategoryControl(new Element(), plugin, 'pc_work');
        assert.equal(await deleted.value(), undefined);
        assert.match(renderPomodoroCategoryBadge('pc_work', []), /uncategorized/);
        assert.doesNotMatch(renderPomodoroCategoryBadge('pc_work', [{ ...categories[0], name: '<script>' }]), /<script>/);
    } finally { global.document = documentBefore; }
});

test('实际分类管理界面新增、改名改色和删除只修改独立列表', async () => {
    const documentBefore = global.document;
    global.document = { createElement: () => new Element() };
    const dialogs = [];
    class Dialog {
        constructor(options) {
            this.options = options; this.list = new Element(); this.add = new Element();
            this.element = { querySelector: selector => selector.endsWith('-list') ? this.list : this.add };
            dialogs.push(this);
        }
        destroy() { this.options.destroyCallback(); }
    }
    try {
        let stored = clone(categories);
        const plugin = {
            loadData: async file => { assert.equal(file, POMODORO_CATEGORIES_FILE); return clone(stored); },
            saveData: async (file, data) => { assert.equal(file, POMODORO_CATEGORIES_FILE); stored = clone(data); },
        };
        const { showPomodoroCategoryManager } = load('src/components/dialog/pomodoroCategoryControl.ts', {
            siyuan: { Dialog, confirm: (_title, _message, yes) => yes(), showMessage() { assert.fail('Unexpected error'); } },
            '../../pluginInstance': { i18n: key => key }, '../../utils/pomodoroCategories': categoriesModule,
        });
        const closed = showPomodoroCategoryManager(plugin), dialog = dialogs[0];
        const flush = () => new Promise(resolve => setImmediate(resolve));
        await flush();
        dialog.add.children[0].value = '阅读';
        dialog.add.children[1].value = '#112233';
        dialog.add.children[2].listeners.click();
        await flush();
        assert.equal(stored.length, 3);
        assert.equal(stored[2].name, '阅读');
        const row = dialog.list.children[0];
        row.children[0].value = '写作修改'; row.children[1].value = '#abcdef';
        row.children[2].listeners.click();
        await flush();
        assert.deepEqual(stored[0], { ...categories[0], name: '写作修改', color: '#abcdef' });
        dialog.list.children[1].children[3].listeners.click();
        await flush();
        assert.equal(stored.length, 2);
        assert.ok(!stored.some(item => item.id === 'pc_break'));
        dialog.destroy(); await closed;
    } finally { global.document = documentBefore; }
});

test('真实日历番茄分支按独立分类筛选和上色，不调用任务分类筛选', async () => {
    const source = fs.readFileSync(path.join(root, 'src/components/panel/CalendarView.ts'), 'utf8');
    const ast = ts.createSourceFile('CalendarView.ts', source, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'CalendarView');
    const method = declaration.members.find(node => node.name?.getText(ast) === 'passesPomodoroCategoryFilter').getText(ast);
    const Calendar = new Function(ts.transpileModule(`class Calendar { ${method} }; return Calendar;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2021 },
    }).outputText)();
    const block = source.slice(source.indexOf('            // Add Pomodoro records if enabled'),
        source.indexOf('            // Add completed task times if enabled'));
    const getEvents = new Function('loadPomodoroCategories', 'i18n',
        `return async function(reminderData, projectData, startDate, endDate) { const events=[]; ${block}; return events; }`)(loadPomodoroCategories, key => key);
    let stored = clone(categories);
    const sessions = ['pc_work', 'pc_break', undefined, 'deleted'].map((categoryId, i) => ({
        id: String(i), type: i === 1 ? 'shortBreak' : 'work', categoryId, eventId: 'task',
        startTime, endTime, duration: 25, plannedDuration: 25,
    }));
    const view = Object.assign(new Calendar(), {
        plugin: { loadData: async () => stored }, pomodoroCategoryFilter: 'all',
        calendar: { view: { type: 'timeGridWeek' } }, showTasks: true, showPomodoro: true, showPomodoroBreakTime: true,
        pomodoroRecordManager: { getDateRangeSessions: async () => sessions },
        passesProjectFilter: () => true, passesCategoryFilter: () => assert.fail('Task categories must not filter pomodoros'),
        isAbandonedReminder: () => false,
    });
    const task = { task: { id: 'task', categoryId: 'pc_work' } };
    const events = await getEvents.call(view, task, {}, day, day);
    assert.deepEqual(events.map(event => event.backgroundColor), ['#123456', '#654321', '#f23145', '#f23145']);
    view.pomodoroCategoryFilter = 'pc_break';
    assert.deepEqual((await getEvents.call(view, task, {}, day, day)).map(event => event.id), ['pomodoro-1']);
    view.pomodoroCategoryFilter = 'none'; task.task.categoryId = 'unrelated';
    assert.deepEqual((await getEvents.call(view, task, {}, day, day)).map(event => event.id), ['pomodoro-2', 'pomodoro-3']);
    stored = []; view.pomodoroCategoryFilter = 'pc_work';
    assert.equal((await getEvents.call(view, task, {}, day, day)).length, 4);
    assert.equal(view.pomodoroCategoryFilter, 'all');
    stored = ''; // Same value returned by the real host before the first category is saved.
    assert.equal((await getEvents.call(view, task, {}, day, day)).length, 4);
});
