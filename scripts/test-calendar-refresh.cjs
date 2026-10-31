// Run with: node --test scripts/test-calendar-refresh.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { Calendar } = require('@fullcalendar/core');
const dayGrid = require('@fullcalendar/daygrid').default;
const root = path.resolve(__dirname, '..');
const compile = content => ts.transpileModule(content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const exportsObject = {};
new Function('exports', compile(fs.readFileSync(path.join(root, 'src/utils/calendarEventReconciler.ts'), 'utf8')))(exportsObject);
const { CalendarEventReconciler } = exportsObject;
const event = (id, extra = {}) => ({ id, title: id, start: '2026-10-31', allDay: true, ...extra });

function realCalendar(t, sourceId = 'test-events') {
    // 使用真实 FullCalendar 数据引擎；不调用 render，不需要模拟浏览器布局。
    const calendar = new Calendar({ isConnected: false }, {
        initialView: 'dayGridMonth', initialDate: '2026-10-31', plugins: [dayGrid],
    });
    t.after(() => calendar.destroy());
    const calls = {};
    for (const name of ['removeAllEvents', 'removeAllEventSources', 'addEventSource', 'addEvent']) {
        const original = calendar[name].bind(calendar);
        calendar[name] = (...args) => { calls[name] = (calls[name] || 0) + 1; return original(...args); };
    }
    calendar.on('eventRemove', () => { calls.removed = (calls.removed || 0) + 1; });
    return { calendar, sync: new CalendarEventReconciler(sourceId), calls,
        reset: () => { for (const key of Object.keys(calls)) delete calls[key]; } };
}

test('相同事件和不同对象字段顺序不触发 FullCalendar 修改', t => {
    const f = realCalendar(t);
    const inputs = [event('a', { extendedProps: { note: '备注', completed: false } }), event('b')];
    f.sync.sync(f.calendar, inputs, false);
    f.reset();
    assert.equal(f.sync.sync(f.calendar, [
        { allDay: true, start: '2026-10-31', title: 'a', id: 'a', extendedProps: { completed: false, note: '备注' } }, event('b'),
    ], true), false);
    assert.deepEqual(f.calls, {});
    assert.equal(f.calendar.getEventSources().length, 1);
});

test('单条编辑、新建和删除仅替换受影响事件，保留同一数据源', t => {
    const f = realCalendar(t);
    f.sync.sync(f.calendar, [event('a'), event('b'), event('deleted')], false);
    f.reset();
    assert.equal(f.sync.sync(f.calendar, [event('a', { title: '编辑后' }), event('b'), event('new')], true), true);
    assert.deepEqual(f.calls, { removed: 2, addEvent: 2 });
    assert.deepEqual(f.calendar.getEvents().map(e => e.id).sort(), ['a', 'b', 'new']);
    assert.equal(f.calendar.getEventById('a').title, '编辑后');
    assert.equal(f.calendar.getEventById('new').source.id, 'test-events');
    assert.equal(f.calendar.getEventSources().length, 1);
});

test('拖动日期、修改扩展属性和可编辑性后，以新快照校正运行时数据', t => {
    const f = realCalendar(t);
    const inputs = [event('a', { startEditable: false, extendedProps: { note: '原备注' } })];
    f.sync.sync(f.calendar, inputs, false);
    const live = f.calendar.getEventById('a');
    live.setStart('2026-11-02');
    live.setExtendedProp('note', '未保存的修改');
    live.setProp('startEditable', true);
    f.reset();
    f.sync.sync(f.calendar, inputs, true);
    assert.deepEqual(f.calls, { removed: 1, addEvent: 1 });
    const restored = f.calendar.getEventById('a');
    assert.equal(restored.startStr, '2026-10-31');
    assert.equal(restored.extendedProps.note, '原备注');
    assert.equal(restored.startEditable, false);
});

test('嵌套实例历史原地修改后仍可发现变化，不因引用相同漏掉更新', t => {
    const f = realCalendar(t);
    const input = event('a', { extendedProps: { repeat: { instances: { '2026-10-31': { completed: false } } } } });
    f.sync.sync(f.calendar, [input], false);
    input.extendedProps.repeat.instances['2026-10-31'].completed = true;
    f.reset();
    f.sync.sync(f.calendar, [input], true);
    assert.equal(f.calls.addEvent, 1);
    assert.equal(f.calendar.getEventById('a').extendedProps.repeat.instances['2026-10-31'].completed, true);
});

test('项目标签等外部渲染依赖变化时，仅替换受影响的事件', t => {
    const f = realCalendar(t);
    const inputs = [event('a'), event('b')];
    f.sync.sync(f.calendar, inputs, false, new Map([['a', { project: '旧名称' }]]));
    f.reset();
    f.sync.sync(f.calendar, inputs, true, new Map([['a', { project: '新名称' }]]));
    assert.deepEqual(f.calls, { removed: 1, addEvent: 1 });
});

test('完整刷新、重复或缺失 ID 仍按原语义重建，不丢失事件', t => {
    const f = realCalendar(t);
    f.sync.sync(f.calendar, [event('a')], false);
    f.reset();
    f.sync.sync(f.calendar, [event('a')], false);
    assert.equal(f.calls.removeAllEventSources, 1);
    f.sync.sync(f.calendar, [event('a'), event('a', { title: '同 ID 的第二项' })], true);
    assert.equal(f.calendar.getEvents().length, 2);
    f.sync.sync(f.calendar, [{ start: '2026-10-31' }], true);
    assert.equal(f.calendar.getEvents().length, 1);
    assert.equal(f.calendar.getEvents()[0].id, '');
});

test('空列表删除旧事件，后续新建不累积数据源，多个日历快照独立', t => {
    const a = realCalendar(t, 'a'), b = realCalendar(t, 'b');
    a.sync.sync(a.calendar, [event('task')], true);
    b.sync.sync(b.calendar, [event('task')], true);
    a.sync.sync(a.calendar, [], true);
    assert.equal(a.calendar.getEvents().length, 0);
    assert.equal(b.calendar.getEvents().length, 1);
    a.sync.sync(a.calendar, [event('task', { title: '新标题' })], true);
    assert.equal(a.calendar.getEventSources().length, 1);
    assert.equal(a.calendar.getEventById('task').title, '新标题');
    assert.equal(b.calendar.getEventById('task').title, 'task');
});

test('5000 条事件修改一条，只删除和新增一条且不重建数据源', t => {
    const f = realCalendar(t);
    const inputs = Array.from({ length: 5000 }, (_, i) => event(`task-${i}`));
    f.sync.sync(f.calendar, inputs, false);
    inputs[2345] = { ...inputs[2345], title: '编辑后的标题' };
    f.reset();
    f.sync.sync(f.calendar, inputs, true);
    assert.deepEqual(f.calls, { removed: 1, addEvent: 1 });
    assert.equal(f.calendar.getEvents().length, 5000);
});

const relative = 'src/components/panel/CalendarView.ts';
const source = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
function extract(names) {
    return source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'CalendarView').members
        .filter(node => names.includes(node.name?.getText(source))).map(node => node.getText(source)).join('\n');
}
function refreshFixture(read = async () => [event('a')]) {
    const timers = new Map(), frames = [], commits = [], reads = [], errors = [];
    const paints = { render: 0, size: 0 };
    let timerId = 0;
    const window = {
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        removeEventListener: () => {},
    };
    const clearTimeout = id => timers.delete(id);
    const CalendarView = new Function('window', 'clearTimeout', 'requestAnimationFrame', 'console',
        compile(`class CalendarView { ${extract(['refreshEvents', 'destroy'])} }`) + '; return CalendarView;')(
        window, clearTimeout, callback => frames.push(callback), { error: (...args) => errors.push(args) },
    );
    const view = Object.assign(new CalendarView(), {
        refreshVersion: 0, disposed: false, refreshPending: false, refreshPendingForce: false,
        refreshPendingIncremental: true, isDragging: false, isRefreshingEvents: false,
        showTasks: false, showPomodoroDuration: false,
        container: { querySelectorAll: () => [], contains: () => false }, colorCache: new Map(),
        eventReconciler: { sync: (_calendar, events, incremental) => { commits.push({ events, incremental }); return true; }, clear: () => {} },
        calendar: { updateSize: () => { paints.size++; }, render: () => { paints.render++; }, destroy: () => {} },
        getEventRenderKeys: () => new Map(),
        getEvents: async force => { reads.push(force); return read(force); },
        isCalendarVisible: () => true,
    });
    const tick = async () => {
        const next = timers.entries().next().value;
        assert.ok(next, 'Expected a scheduled refresh');
        timers.delete(next[0]);
        await next[1]();
    };
    return { view, timers, frames, commits, reads, errors, paints, tick };
}
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('渲染依赖按项目和分类去重读取，下一轮重新解析名称、图标和订阅顺序', () => {
    const CalendarView = new Function('getLogicalDateString', compile(`class CalendarView { ${extract(['getEventRenderKeys'])} }`) + '; return CalendarView;')(
        () => '2026-10-31',
    );
    let projectReads = 0, categoryReads = 0;
    const project = { name: '项目' }, category = { name: '分类', icon: 'a' };
    const view = Object.assign(new CalendarView(), {
        showCategoryAndProject: true, subscriptionOrderMap: new Map([['sub', 1]]),
        projectManager: { getProjectById: () => { projectReads++; return project; }, getProjectColor: () => 'red' },
        categoryManager: { getCategoryById: () => { categoryReads++; return category; } },
    });
    const inputs = ['a', 'b'].map(id => event(id, { extendedProps: { projectId: 'p', categoryId: 'c', subscriptionId: 'sub' } }));
    const first = view.getEventRenderKeys(inputs);
    assert.equal(projectReads, 1);
    assert.equal(categoryReads, 1);
    project.name = '重命名项目'; category.icon = 'b'; view.subscriptionOrderMap.set('sub', 0);
    const next = view.getEventRenderKeys(inputs);
    assert.equal(projectReads, 2);
    assert.equal(categoryReads, 2);
    assert.notDeepEqual(first.get('a'), next.get('a'));
    assert.equal(next.get('a').subscriptionOrder, 0);
});

test('防抖合并请求保留强制读取和完整渲染，普通通知使用增量模式', async () => {
    const f = refreshFixture();
    await f.view.refreshEvents(true, false);
    await f.view.refreshEvents(false, true);
    assert.equal(f.timers.size, 1);
    await f.tick();
    assert.deepEqual(f.reads, [true]);
    assert.equal(f.commits[0].incremental, false);
    await f.view.refreshEvents(false, true);
    await f.tick();
    assert.equal(f.commits[1].incremental, true);
    assert.equal(f.paints.render, 1); // 只有首轮完整刷新强制重绘自定义内容。
});

test('没有变化时不调整布局或重绘，新请求到来后旧滚动恢复回调失效', async () => {
    const f = refreshFixture();
    f.view.eventReconciler.sync = () => false;
    await f.view.refreshEvents(false, true);
    await f.tick();
    assert.deepEqual(f.paints, { render: 0, size: 0 });
    assert.equal(f.frames.length, 0);
    f.view.eventReconciler.sync = () => true;
    await f.view.refreshEvents();
    await f.tick();
    await f.view.refreshEvents(false, true);
    f.view.container.querySelectorAll = () => { throw new Error('旧绘制回调触及布局'); };
    assert.doesNotThrow(() => f.frames[0]());
});

test('加载中连续更新时丢弃旧结果，只提交最新快照且不丢强制读取', async () => {
    const first = deferred();
    let calls = 0;
    const f = refreshFixture(async () => ++calls === 1 ? first.promise : [event('latest')]);
    await f.view.refreshEvents(true, false);
    const loading = f.tick();
    await f.view.refreshEvents(false, true);
    await f.view.refreshEvents(false, true);
    first.resolve([event('old')]);
    await loading;
    assert.equal(f.commits.length, 0);
    assert.equal(f.timers.size, 1);
    await f.tick();
    assert.deepEqual(f.reads, [true, true]);
    assert.equal(f.commits[0].events[0].id, 'latest');
    assert.equal(f.commits[0].incremental, false);
});

test('拖动期间延后刷新并保留强制读取，停止拖动后合并执行', async () => {
    const f = refreshFixture();
    f.view.isDragging = true;
    await f.view.refreshEvents(true, true);
    assert.equal(f.timers.size, 0);
    assert.equal(f.view.refreshPendingDuringDrag, true);
    f.view.isDragging = false;
    await f.view.refreshEvents();
    await f.tick();
    assert.deepEqual(f.reads, [true]);
});

test('读取失败保留已有日历，销毁中的读取和旧绘制回调不能再写入', async () => {
    const failed = refreshFixture(async () => { throw new Error('读取失败'); });
    await failed.view.refreshEvents();
    await failed.tick();
    assert.equal(failed.commits.length, 0);
    assert.equal(failed.errors.length, 1);
    const first = deferred(), f = refreshFixture(() => first.promise);
    await f.view.refreshEvents();
    const loading = f.tick();
    f.view.destroy();
    first.resolve([event('old')]);
    await loading;
    await f.view.refreshEvents();
    assert.equal(f.commits.length, 0);
    assert.equal(f.timers.size, 0);
    const rendered = refreshFixture();
    await rendered.view.refreshEvents();
    await rendered.tick();
    rendered.view.destroy();
    assert.doesNotThrow(() => rendered.frames[0]());
});

test('真实数据加载错误向刷新层传播，不能伪装成合法空列表', async () => {
    const messages = [];
    const CalendarView = new Function('console', 'showMessage', 'i18n', 'loadHolidays', 'loadSubscriptions',
        compile(`class CalendarView { ${extract(['getEvents'])} }`) + '; return CalendarView;')(
        { error: () => {} }, message => messages.push(message), key => key,
        async () => ({}), async () => { throw new Error('订阅读取失败'); },
    );
    const view = Object.assign(new CalendarView(), { plugin: { loadSettings: async () => ({}) } });
    await assert.rejects(view.getEvents(), /订阅读取失败/);
    assert.deepEqual(messages, ['loadReminderDataFailed']);
});
