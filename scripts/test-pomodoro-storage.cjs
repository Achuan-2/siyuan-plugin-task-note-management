// node --test scripts/test-pomodoro-storage.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let dayStartHours = 0;
const logicalDate = value => {
    if (!value) return '2026-11-04';
    const date = new Date(value);
    date.setHours(date.getHours() - dayStartHours);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
function load(relative) {
    const file = path.resolve(root, relative);
    if (modules.has(file)) return modules.get(file);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports = {};
    modules.set(file, exports);
    new Function('require', 'exports', code)(name => {
        if (name.endsWith('/dateUtils')) return { getLogicalDateString: logicalDate };
        assert.ok(name.startsWith('.'), `Unexpected dependency: ${name}`);
        return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    }, exports);
    return exports;
}
const { PomodoroRecordManager } = load('src/components/dataManager/pomodoroRecord.ts');
const { summarizePomodoroDay } = load('src/utils/pomodoroStore.ts');
const { createPomodoroCache } = load('src/utils/pomodoroCache.ts');
const { buildLinkedHabitPomodoroData } = load('src/utils/linkedHabitPomodoro.ts');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const session = (date, id, eventId = 'task', extra = {}) => ({
    id, eventId, eventTitle: '专注任务', type: 'work', startTime: `${date}T10:00:00`, endTime: `${date}T10:25:00`,
    duration: 25, plannedDuration: 25, count: 1, completed: true, ...extra,
});
const record = (date, sessions) => ({
    date, sessions, workSessions: sessions.filter(s => s.type === 'work' && !s.inProgress).reduce((n, s) => n + (s.count ?? 1), 0),
    totalWorkTime: sessions.filter(s => s.type === 'work' && !s.inProgress).reduce((n, s) => n + s.duration, 0),
    totalBreakTime: sessions.filter(s => s.type !== 'work').reduce((n, s) => n + s.duration, 0),
});
function fixture(input = {}) {
    const files = new Map(Object.entries(clone(input)));
    const mtimes = new Map([...files.keys()].map(date => [date, 1700000000]));
    const stats = { reads: [], writes: [], removes: [], lists: 0, cacheReads: 0, cacheWrites: 0, active: 0, peak: 0 };
    let cache = null;
    let readError, writeError, listError, cacheReadError, cacheWriteError;
    let legacy = null;
    const adapter = {
        async list() { stats.lists++; if (listError) throw listError; return [...files.keys()].map(date => ({ name: `${date}.json`, isDir: false, updated: mtimes.get(date) })); },
        async read(date) {
            stats.reads.push(date); stats.active++; stats.peak = Math.max(stats.peak, stats.active);
            try {
                await new Promise(resolve => setImmediate(resolve));
                if (readError) throw readError;
                return clone(files.get(date)) || null;
            } finally { stats.active--; }
        },
        async write(date, data) {
            if (writeError && (typeof writeError !== 'function' || writeError(date))) throw new Error('disk full');
            stats.writes.push(date); files.set(date, clone(data)); mtimes.set(date, Math.floor(Date.now() / 1000));
        },
        async remove(date) { stats.removes.push(date); files.delete(date); mtimes.delete(date); },
        async readLegacy() { return clone(legacy); },
        async readCache() { stats.cacheReads++; if (cacheReadError) throw cacheReadError; return clone(cache); },
        async writeCache(data) { stats.cacheWrites++; if (cacheWriteError) throw cacheWriteError; cache = clone(data); },
    };
    const plugin = { createPomodoroStoreAdapter: () => adapter, loadReminderData: async () => ({ task: { id: 'task' } }) };
    return {
        files, mtimes, stats, manager: () => new PomodoroRecordManager(plugin),
        setCache: value => { cache = clone(value); }, getCache: () => clone(cache),
        setLegacy: value => { legacy = value; },
        failRead: value => { readError = value; }, failWrite: value => { writeError = value; },
        failList: value => { listError = value; }, failCacheRead: value => { cacheReadError = value; },
        failCacheWrite: value => { cacheWriteError = value; },
        reset() { stats.reads = []; stats.writes = []; stats.removes = []; stats.lists = 0; stats.cacheReads = 0; stats.cacheWrites = 0; stats.peak = 0; },
    };
}
const twoDays = () => ({
    '2026-11-03': record('2026-11-03', [session('2026-11-03', 'old')]),
    '2026-11-04': record('2026-11-04', [session('2026-11-04', 'today')]),
});

test('1000 日首次建摘要限制为 6 并发，释放明细；重启只读目录和缓存', async () => {
    const history = {};
    for (let i = 0; i < 1000; i++) {
        const date = new Date(2020, 0, i + 1).toISOString().slice(0, 10);
        history[date] = record(date, [session(date, `s${i}`)]);
    }
    const f = fixture(history);
    const first = f.manager();
    await Promise.all([first.initialize(), first.initialize(), first.initialize()]);
    assert.equal(f.stats.reads.length, 1000);
    assert.equal(f.stats.lists, 1);
    assert.equal(f.stats.peak, 6);
    assert.equal(Object.values(first.records).flatMap(r => r.sessions).length, 0);
    assert.equal(first.getEventTotalFocusTime('task'), 25000);
    assert.equal(first.getEventTotalPomodoroCount('task'), 1000);
    f.reset();
    const warm = f.manager();
    await warm.initialize();
    assert.equal(f.stats.reads.length, 0);
    assert.equal(f.stats.cacheReads, 1);
    assert.equal(f.stats.cacheWrites, 0);
    assert.equal(f.stats.lists, 1);
    assert.equal(warm.getEventTotalFocusTime('task'), 25000);
    const [date] = Object.keys(history);
    await warm.ensureDatesLoaded([date, date]);
    assert.deepEqual(f.stats.reads, [date]);
    assert.equal(warm.getDateSessions(date).length, 1);
});

test('指定日期重复刷新只读该文件，替换贡献而不重复累计', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    f.files.get('2026-11-04').sessions[0].duration = 40;
    f.files.get('2026-11-04').totalWorkTime = 40;
    await m.reloadRecords(['2026-11-04', '2026-11-04']);
    assert.deepEqual(f.stats.reads, ['2026-11-04']);
    assert.equal(m.getEventTotalFocusTime('task'), 65);
    await m.reloadRecords(['2026-11-04']);
    assert.equal(m.getEventTotalFocusTime('task'), 65);
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
});

test('目录差异检查只读变更和新增文件，并清除删除日期的索引', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    await m.reloadRecords(); assert.equal(f.stats.reads.length, 0);
    f.files.delete('2026-11-03');
    f.files.set('2026-11-05', record('2026-11-05', [session('2026-11-05', 'new', 'other')]));
    f.mtimes.set('2026-11-05', 1700000100);
    f.mtimes.set('2026-11-04', 1700000200);
    await m.reloadRecords();
    assert.deepEqual(f.stats.reads.sort(), ['2026-11-04', '2026-11-05']);
    assert.equal(m.getEventTotalPomodoroCount('task'), 1);
    assert.equal(m.getEventTotalPomodoroCount('other'), 1);
    assert.equal(m.getDaySummary('2026-11-03'), undefined);
    f.reset();
    await f.manager().initialize();
    assert.equal(f.stats.reads.length, 0);
});

test('秒级时间戳碰撞的近期文件在重启时重新校验', async () => {
    const f = fixture(twoDays());
    f.mtimes.set('2026-11-04', Math.floor(Date.now() / 1000));
    await f.manager().initialize(); f.reset();
    f.files.get('2026-11-04').sessions.push(session('2026-11-04', 'same-second'));
    const warm = f.manager(); await warm.initialize();
    assert.deepEqual(f.stats.reads, ['2026-11-04']);
    assert.equal(warm.getEventTotalPomodoroCount('task'), 3);
});

test('强制重建读取所有明细；普通查询和统计快照不读取会话', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    await m.refreshData();
    assert.equal(m.getEventPomodoroCount('task', '2026-11-04'), 1);
    assert.equal(m.getEventFocusTime('task', '2026-11-03'), 25);
    assert.equal((await m.resolveReminderPomodoroStatsBatch([{ id: 'task' }], { task: { id: 'task' } })).get('task').todayPomodoroCount, 1);
    assert.equal(f.stats.reads.length, 0);
    await m.refreshData(true);
    assert.equal(f.stats.reads.length, 2);
});

test('按范围和任务取明细仅加载相关日期，含休息及进行中记录', async () => {
    const data = twoDays();
    data['2026-11-03'].sessions = [session('2026-11-03', 'break', 'other', { type: 'shortBreak' })];
    const f = fixture(data), m = f.manager(); await m.initialize(); f.reset();
    const list = await m.getSessionsMatchingEvent(id => id === 'other');
    assert.deepEqual(list.map(s => s.id), ['break']);
    assert.deepEqual(f.stats.reads, ['2026-11-03']);
    assert.equal((await m.getDateRangeSessions('2026-11-04', '2026-11-04')).length, 1);
    assert.deepEqual(f.stats.reads, ['2026-11-03', '2026-11-04']);
});

test('历史补录先加载当天原明细，保留已有会话并更新累计统计', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    await m.updateSession(session('2026-11-03', 'added'));
    assert.deepEqual(f.stats.reads, ['2026-11-03']);
    assert.equal(f.files.get('2026-11-03').sessions.length, 2);
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
    assert.equal(m.getDaySummary('2026-11-03').totalWorkTime, 50);
});

test('跨天编辑只加载原日期和目标日期，迁移后仍可按 ID 编辑或删除', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    await m.updateSession(session('2026-11-04', 'old', 'new-task', { duration: 35 }));
    assert.deepEqual(f.stats.reads.sort(), ['2026-11-03', '2026-11-04']);
    assert.equal(f.files.get('2026-11-03').sessions.length, 0);
    assert.equal(f.files.get('2026-11-04').sessions.length, 2);
    assert.equal(m.getEventTotalPomodoroCount('task'), 1);
    assert.equal(m.getEventTotalFocusTime('new-task'), 35);
    assert.equal((await m.getFocusById('old')).date, '2026-11-04');
    await m.updateSessionNote('old', '备注');
    assert.equal((await m.getFocusById('old')).session.note, '备注');
    assert.equal(await m.deleteSession('old'), true);
    assert.equal(m.getEventTotalFocusTime('new-task'), 0);
    assert.equal((await m.getFocusById('old')), undefined);
});

test('开始和结束计时更新同一记录，进行中不进入累计数量和时长', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    const id = await m.startWorkSession('task', '任务', 25, false, '2026-11-04T12:00:00');
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
    await m.finishWorkSession(id, 20, 'task', '任务', 25, false);
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
    assert.equal(m.getEventTotalFocusTime('task'), 70);
    assert.equal(f.files.get('2026-11-04').sessions.filter(s => s.id === id).length, 1);
});

test('并发补录与外部刷新经过同一队列，保存完成后再读取', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    await Promise.all([
        m.updateSession(session('2026-11-04', 'a')),
        m.reloadRecords(['2026-11-04']),
        m.updateSession(session('2026-11-04', 'b')),
    ]);
    assert.equal(f.files.get('2026-11-04').sessions.length, 3);
    assert.equal(m.getEventTotalPomodoroCount('task'), 4);
});

test('修改一天起始时间先加载全部明细，重新分组后摘要与 ID 索引一致', async () => {
    const f = fixture({
        '2026-11-04': record('2026-11-04', [session('2026-11-04', 'early', 'task', { startTime: '2026-11-04T01:00:00' })]),
    });
    const m = f.manager(); await m.initialize(); f.reset();
    dayStartHours = 3;
    try {
        await m.regenerateRecordsByDate();
        assert.deepEqual(f.stats.reads, ['2026-11-04']);
        assert.equal(f.files.has('2026-11-04'), false);
        assert.equal(f.files.get('2026-11-03').sessions[0].id, 'early');
        assert.equal(m.getDaySummary('2026-11-04'), undefined);
        assert.equal(m.getEventTotalPomodoroCount('task'), 1);
        assert.equal((await m.getFocusById('early')).date, '2026-11-03');
    } finally { dayStartHours = 0; }
});

test('缓存缺失、损坏、版本不兼容均可重建，某天摘要损坏只重建该日', async () => {
    const f = fixture(twoDays()); await f.manager().initialize();
    const cache = f.getCache();
    for (const bad of [null, { version: -1 }, { version: cache.version, days: [] }]) {
        f.setCache(bad); f.reset(); await f.manager().initialize();
        assert.equal(f.stats.reads.length, 2);
    }
    delete cache.days['2026-11-03'].summary.events;
    f.setCache(cache); f.reset(); await f.manager().initialize();
    assert.deepEqual(f.stats.reads, ['2026-11-03']);
});

test('缓存读写失败不会阻止读取和保存原始 JSON', async () => {
    const f = fixture(twoDays());
    f.failCacheRead(new Error('cache unavailable')); f.failCacheWrite(new Error('cache read only'));
    const m = f.manager(); await m.initialize();
    await m.updateSession(session('2026-11-04', 'added'));
    assert.equal(f.files.get('2026-11-04').sessions.length, 2);
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
});

test('源文件/目录读取失败保留现有统计，不把失败视作空目录或写入空数据', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    f.failRead(new Error('read failed'));
    await assert.rejects(m.reloadRecords(['2026-11-04']), /read failed/);
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
    assert.deepEqual(f.stats.writes, []);
    f.failRead(null); f.failList(new Error('list failed'));
    await assert.rejects(m.reloadRecords(), /list failed/);
    assert.equal(Object.keys(m.getDailySummaries()).length, 2);
    f.failList(null);
    await m.reloadRecords();
});

test('原始 JSON 写入失败向调用方抛出，不发布成功摘要，可重试保存', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    f.failWrite(new Error('disk full'));
    await assert.rejects(m.updateSession(session('2026-11-04', 'added')), /disk full/);
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
    assert.equal(f.files.get('2026-11-04').sessions.length, 1);
    f.failWrite(null);
    await m.updateSession(session('2026-11-04', 'retry'));
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
});

test('摘要保持旧 count 规则、正计时、重复实例及关联习惯口径', async () => {
    const date = '2026-11-04';
    const items = [session(date, 'old', 'task', { count: 0 }),
        session(date, 'up', 'task_2026-11-04', { isCountUp: true, count: 3, duration: 70 }),
        session(date, 'progress', 'task', { inProgress: true, count: 0, duration: 0 }),
        session(date, 'rest', 'task', { type: 'shortBreak' })];
    const f = fixture({ [date]: record(date, items) }), m = f.manager(); await m.initialize();
    assert.equal(m.getEventTotalPomodoroCount('task'), 1);
    assert.equal(m.getRepeatingEventTotalPomodoroCount('task'), 4);
    const tasks = { task: { id: 'task', linkedHabitId: 'habit', linkedHabitSyncPomodoroToday: true } };
    const raw = buildLinkedHabitPomodoroData(tasks, Object.fromEntries(f.files), s => m.calculateSessionCount(s));
    const summaries = buildLinkedHabitPomodoroData(tasks, m.getDailySummaries(), s => m.calculateSessionCount(s));
    assert.deepEqual(summaries, raw);
    assert.equal(summaries.statsByHabit.get('habit').get(date).count, 4);
});

test('旧版单文件回退保留历史，第一次写入日期文件不丢失其他日期', async () => {
    const f = fixture(); f.setLegacy(twoDays()); const m = f.manager(); await m.initialize();
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
    await m.updateSession(session('2026-11-03', 'added'));
    assert.equal(f.files.get('2026-11-03').sessions.length, 2);
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
    const restarted = f.manager(); await restarted.initialize();
    assert.equal(restarted.getEventTotalPomodoroCount('task'), 3);
});

test('本地缓存适配器使用 /temp，前端内核隔离且不触发数据通知', async () => {
    const requests = [];
    const fakeFetch = async (url, init) => {
        requests.push([url, init]);
        return { ok: true, status: 200, json: async () => url.endsWith('putFile') ? { code: 0 } : { version: 2 } };
    };
    const frontend = createPomodoroCache('plugin-name', 'frontend', fakeFetch);
    await frontend.readCache(); await frontend.writeCache({ version: 2 });
    await createPomodoroCache('plugin-name', 'kernel', fakeFetch).readCache();
    assert.equal(JSON.parse(requests[0][1].body).path, '/temp/petal/plugin-name/pomodoro-stats/frontend.json');
    assert.equal(JSON.parse(requests[2][1].body).path, '/temp/petal/plugin-name/pomodoro-stats/kernel.json');
    assert.ok(requests[1][1].body.includes('name="file"; filename="summary.json"'));
    assert.ok(requests[1][1].body.endsWith('--\r\n'));
    assert.deepEqual(await frontend.readCache(), { version: 2 });
});

test('恶意对象键不会污染按事件和标题汇总', () => {
    const date = '2026-11-04';
    const summary = summarizePomodoroDay(date, record(date, [session(date, 'id', '__proto__', { eventTitle: 'constructor' })]), () => 1);
    assert.equal(summary.events.__proto__.count, 1);
    assert.equal(summary.workByTitle.constructor.duration, 25);
    assert.equal({}.count, undefined);
});

test('跨天移动的第二个文件写入失败时恢复目标日，原日期文件保持完整', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    const original = Object.fromEntries([...f.files].map(([date, value]) => [date, clone(value)]));
    f.failWrite(date => date === '2026-11-03');
    await assert.rejects(m.updateSession(session('2026-11-04', 'old')), /disk full/);
    assert.deepEqual(Object.fromEntries(f.files), original);
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
    assert.equal((await m.getFocusById('old')).date, '2026-11-03');
});

test('多个零时长正计时记录反复刷新不会破坏事件索引', async () => {
    const data = twoDays();
    for (const record of Object.values(data)) Object.assign(record.sessions[0], { isCountUp: true, count: 0, duration: 0 });
    const f = fixture(data), m = f.manager(); await m.initialize();
    await m.reloadRecords(['2026-11-03']);
    await m.reloadRecords(['2026-11-04']);
    assert.equal(m.getEventTotalPomodoroCount('task'), 0);
    assert.equal(m.getEventTotalFocusTime('task'), 0);
});

function statsView(manager) {
    const source = fs.readFileSync(path.join(root, 'src/components/stats/PomodoroStatsTab.svelte'), 'utf8');
    const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const ast = ts.createSourceFile('stats.ts', script, ts.ScriptTarget.Latest, true);
    const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'PomodoroStatsView');
    const compiled = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Stats = new Function('getLogicalDateString', 'getLocalDateString', 'i18n', 'showMessage', `${compiled}; return PomodoroStatsView;`)(
        logicalDate, date => logicalDate(date), key => key, () => {}
    );
    const content = { innerHTML: '' };
    const view = Object.assign(Object.create(Stats.prototype), {
        recordManager: manager, renderGeneration: 0, disposed: false,
        currentView: 'overview', currentTimeRange: 'week', currentWeekOffset: 0, currentMonthOffset: 0, currentYearOffset: 0,
        dialog: { element: { querySelectorAll: () => [], querySelector: selector => selector === '.stats-content' ? content : null }, destroy() {} },
        renderCurrentView() { return this.currentView; },
    });
    return { view, content };
}

test('统计页总览、趋势、热力图和分类饼图均只消费摘要；切换记录页才读取明细', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    const { view } = statsView(m);
    for (const mode of ['overview', 'details', 'trends', 'heatmap']) {
        view.currentView = mode;
        await view.updateContent();
    }
    assert.equal(view.getTaskCategoryStats()['专注任务'].count, 2);
    assert.equal(view.getHeatmapData(2026).find(day => day.date === '2026-11-04').time, 25);
    assert.equal(view.getTotalPomodoroCount(), 2);
    assert.equal(f.stats.reads.length, 0);
    view.currentView = 'records'; await view.updateContent();
    assert.deepEqual(f.stats.reads.sort(), ['2026-11-03', '2026-11-04']);
});

test('统计页时间线只读取当前日期范围，关闭后的异步加载不绘制界面', async () => {
    const data = twoDays();
    data['2025-11-04'] = record('2025-11-04', [session('2025-11-04', 'historical')]);
    const f = fixture(data), m = f.manager(); await m.initialize(); f.reset();
    const { view, content } = statsView(m);
    view.currentView = 'timeline'; await view.updateContent();
    assert.deepEqual(f.stats.reads.sort(), ['2026-11-03', '2026-11-04']);
    const original = content.innerHTML;
    view.currentView = 'overview';
    const pending = view.updateContent();
    view.destroy(); await pending;
    assert.equal(content.innerHTML, original);
});

test('缺少 sessions 的早期每日总量记录仍保留统计，新增会话不覆盖累计总量', async () => {
    const date = '2026-11-04';
    const f = fixture({ [date]: { date, workSessions: 10, totalWorkTime: 250, totalBreakTime: 15 } });
    const m = f.manager(); await m.initialize();
    assert.equal(m.getTodayFocusTime(), 250);
    await m.recordWorkSession(25, 'task', '任务', 25, true, false, { startTime: `${date}T13:00:00` });
    assert.equal(m.getTodayFocusTime(), 275);
    assert.equal(f.files.get(date).workSessions, 11);
});

test('坏会话导致统计失败时不替换已经加载的有效日期', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    await m.ensureDatesLoaded(['2026-11-04']);
    f.files.get('2026-11-04').sessions = [null];
    await assert.rejects(m.reloadRecords(['2026-11-04']));
    assert.equal(m.getDateSessions('2026-11-04')[0].id, 'today');
    assert.equal(m.getEventTotalPomodoroCount('task'), 2);
});
