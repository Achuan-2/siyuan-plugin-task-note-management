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
const calendarDate = value => {
    const date = new Date(value);
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
        if (name.endsWith('/dateUtils')) return { getLogicalDateString: logicalDate, getLocalDateString: calendarDate, getDayStartMinutes: () => dayStartHours * 60 };
        assert.ok(name.startsWith('.'), `Unexpected dependency: ${name}`);
        return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    }, exports);
    return exports;
}
const { PomodoroRecordManager } = load('src/components/dataManager/pomodoroRecord.ts');
const { summarizePomodoroDay } = load('src/utils/pomodoroStore.ts');
const { createPomodoroCache } = load('src/utils/pomodoroCache.ts');
const { PomodoroWriteCoordinator } = load('src/utils/pomodoroWriteCoordinator.ts');
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
    const stats = { reads: [], commitReads: [], writes: [], removes: [], lists: 0, cacheReads: 0, cacheWrites: 0, cacheMonths: [], active: 0, peak: 0 };
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
        async writeCache(data, months = Object.keys(data.days).map(date => date.slice(0, 7))) {
            stats.cacheWrites++; stats.cacheMonths.push([...months]);
            if (cacheWriteError) throw cacheWriteError;
            if (!cache || cache.version !== data.version) cache = { version: data.version, days: {} };
            for (const date of Object.keys(cache.days)) if (months.includes(date.slice(0, 7))) delete cache.days[date];
            Object.assign(cache.days, clone(data.days));
            cache.months = data.months;
            cache.configuration = data.configuration;
        },
    };
    const makeWriter = () => new PomodoroWriteCoordinator({
        read: async date => { stats.commitReads.push(date); if (readError) throw readError; return clone(files.get(date)) || null; },
        write: (date, value) => adapter.write(date, value), remove: date => adapter.remove(date),
        listDates: async () => [...files.keys()],
        locateSession: async id => [...files].find(([, value]) => Object.prototype.hasOwnProperty.call(value.tombstones || {}, id))?.[0]
            || [...files].find(([, value]) => value.sessions?.some(session => session.id === id))?.[0],
    });
    let writer = makeWriter();
    adapter.commit = input => writer.commit(input);
    const plugin = { createPomodoroStoreAdapter: () => adapter, loadReminderData: async () => ({ task: { id: 'task' } }) };
    return {
        files, mtimes, stats, adapter, get writer() { return writer; }, restartWriter() { writer = makeWriter(); }, manager: () => new PomodoroRecordManager(plugin),
        setCache: value => { cache = clone(value); }, getCache: () => clone(cache),
        setLegacy: value => { legacy = value; },
        failRead: value => { readError = value; }, failWrite: value => { writeError = value; },
        failList: value => { listError = value; }, failCacheRead: value => { cacheReadError = value; },
        failCacheWrite: value => { cacheWriteError = value; },
        reset() { stats.reads = []; stats.commitReads = []; stats.writes = []; stats.removes = []; stats.lists = 0; stats.cacheReads = 0; stats.cacheWrites = 0; stats.cacheMonths = []; stats.peak = 0; },
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
    await m.flushCache();
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

test('跨天编辑保留物理分片，只更新逻辑日归属，仍可按 ID 修改和删除', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    await m.updateSession(session('2026-11-04', 'old', 'new-task', { duration: 35 }));
    assert.deepEqual(f.stats.reads, ['2026-11-03']);
    assert.equal(f.files.get('2026-11-03').sessions.length, 1);
    assert.equal(f.files.get('2026-11-04').sessions.length, 1);
    assert.equal((await m.getFocusById('old')).date, '2026-11-03');
    assert.equal(m.getDaySummary('2026-11-04').totalWorkTime, 60);
    assert.equal(m.getEventTotalFocusTime('new-task'), 35);
    const result = await m.getDateRangeSessions('2026-11-04', '2026-11-04');
    assert.deepEqual(result.map(s => s.id).sort(), ['old', 'today']);
    await m.updateSessionNote('old', '备注');
    assert.equal((await m.getFocusById('old')).session.note, '备注');
    assert.equal(await m.deleteSession('old'), true);
    assert.equal(m.getEventTotalFocusTime('new-task'), 0);
    assert.equal((await m.getFocusById('old')), undefined);
    assert.ok(f.files.get('2026-11-03').tombstones.old);
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

test('修改一天起始时间只重建索引，原始文件字节和物理定位不变', async () => {
    const date = '2026-11-04';
    const f = fixture({ [date]: record(date, [session(date, 'early', 'task', { startTime: date + 'T01:00:00' })]) });
    const original = JSON.stringify(Object.fromEntries(f.files));
    const m = f.manager(); await m.initialize(); f.reset(); dayStartHours = 3;
    try {
        await m.regenerateRecordsByDate();
        assert.deepEqual(f.stats.reads, [date]);
        assert.deepEqual(f.stats.writes, []); assert.deepEqual(f.stats.removes, []);
        assert.equal(JSON.stringify(Object.fromEntries(f.files)), original);
        assert.equal(m.getDaySummary('2026-11-03').totalWorkTime, 25);
        assert.equal(m.getDaySummary(date), undefined);
        assert.equal((await m.getFocusById('early')).date, date);
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

function cacheTransport() {
    const files = new Map(), writes = [], reads = [];
    const fetch = async (url, init) => {
        if (url.endsWith('getFile')) {
            const key = JSON.parse(init.body).path; reads.push(key);
            return { ok: files.has(key), status: files.has(key) ? 200 : 404, json: async () => clone(files.get(key)) };
        }
        const key = init.body.match(/name="path"\r\n\r\n([^\r]+)/)[1];
        const boundary = init.headers['Content-Type'].split('boundary=')[1];
        const data = init.body.split('Content-Type: application/json\r\n\r\n')[1].split('\r\n--' + boundary)[0];
        files.set(key, JSON.parse(data)); writes.push(key);
        return { ok: true, status: 200, json: async () => ({ code: 0 }) };
    };
    return { fetch, files, writes, reads };
}

test('本地缓存按月分片，更新一个月只写该月，前端和内核隔离', async () => {
    const transport = cacheTransport();
    const frontend = createPomodoroCache('plugin-name', 'frontend', transport.fetch);
    const kernel = createPomodoroCache('plugin-name', 'kernel', transport.fetch);
    const days = { '2026-10-03': { value: 1 }, '2026-11-04': { value: 2 } };
    await frontend.writeCache({ version: 4, days });
    assert.equal(transport.writes.length, 3); // 两个月和清单。
    assert.deepEqual(clone((await frontend.readCache()).days), days);
    transport.writes.length = 0;
    await frontend.writeCache({ version: 4, days: { '2026-11-04': { value: 3 } }, months: ['2026-10', '2026-11'] }, ['2026-11']);
    assert.deepEqual(transport.writes, ['/temp/petal/plugin-name/pomodoro-stats/frontend/2026-11.json']);
    assert.equal((await frontend.readCache()).days['2026-10-03'].value, 1);
    assert.equal((await frontend.readCache()).days['2026-11-04'].value, 3);
    assert.equal(await kernel.readCache(), null);
    assert.ok(transport.reads.some(key => key.endsWith('kernel/manifest.json')));
});

test('恶意对象键不会污染按事件和标题汇总', () => {
    const date = '2026-11-04';
    const summary = summarizePomodoroDay(date, record(date, [session(date, 'id', '__proto__', { eventTitle: 'constructor' })]), () => 1);
    assert.equal(summary.events.__proto__.count, 1);
    assert.equal(summary.workByTitle.constructor.duration, 25);
    assert.equal({}.count, undefined);
});

test('跨天编辑原物理文件写入失败时保留历史和原统计', async () => {
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

test('日界限索引重建读取失败后继续记录，原历史会话仍保留', async () => {
    const date = '2026-11-04';
    const f = fixture({ [date]: record(date, [session(date, 'historical', 'task', { startTime: date + 'T01:00:00' })]) });
    const m = f.manager(); await m.initialize();
    dayStartHours = 3; f.failRead(new Error('read failed'));
    try { await assert.rejects(m.regenerateRecordsByDate(), /read failed/); }
    finally { dayStartHours = 0; f.failRead(null); }
    assert.equal((await m.getFocusById('historical')).date, date);
    await m.recordWorkSession(25, 'task', 'new', 25, true, false, { startTime: date + 'T13:00:00' });
    assert.ok(f.files.get(date).sessions.some(s => s.id === 'historical'));
    assert.equal(f.files.get(date).sessions.length, 2);
});

test('单日写入已经落盘但响应失败时恢复原记录，随后可正常写入', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    const original = clone(f.files.get('2026-11-04'));
    const write = f.adapter.write; let first = true;
    f.adapter.write = async (date, value) => { await write(date, value); if (first) { first = false; throw new Error('response lost'); } };
    await assert.rejects(m.updateSession(session('2026-11-04', 'today', 'task', { duration: 40 })), /response lost/);
    assert.deepEqual(f.files.get('2026-11-04'), original);
    f.adapter.write = write;
    await m.updateSessionNote('today', 'saved after recovery');
    assert.equal(f.files.get('2026-11-04').sessions[0].note, 'saved after recovery');
});

test('两个管理器并发补录同一天，保留原记录和双方新增会话', async () => {
    const f = fixture(twoDays()), a = f.manager(), b = f.manager();
    await a.initialize(); await b.initialize();
    await a.ensureDatesLoaded(['2026-11-04']); await b.ensureDatesLoaded(['2026-11-04']);
    await Promise.all([a.updateSession(session('2026-11-04', 'a')), b.updateSession(session('2026-11-04', 'b'))]);
    assert.deepEqual(f.files.get('2026-11-04').sessions.map(s => s.id).sort(), ['a', 'b', 'today']);
    assert.equal(f.files.get('2026-11-04').workSessions, 3);
    await a.reloadRecords(['2026-11-04']);
    assert.equal(a.getEventTotalPomodoroCount('task'), 4);
});

test('并发编辑不同会话可以合并；同一会话冲突拒绝覆盖', async () => {
    const date = '2026-11-04';
    const f = fixture({ [date]: record(date, [session(date, 'x'), session(date, 'y')]) });
    const a = f.manager(), b = f.manager(); await a.initialize(); await b.initialize();
    await a.ensureDatesLoaded([date]); await b.ensureDatesLoaded([date]);
    await a.updateSession({ ...a.getDateSessions(date)[0], duration: 40 });
    await b.updateSession({ ...b.getDateSessions(date)[1], duration: 35 });
    assert.equal(f.files.get(date).totalWorkTime, 75);
    const stale = b.getDateSessions(date).find(s => s.id === 'x');
    await a.updateSessionNote('x', 'A changed note');
    await assert.rejects(b.updateSession({ ...stale, duration: 45 }), /其他窗口修改/);
    assert.equal(f.files.get(date).sessions.find(s => s.id === 'x').note, 'A changed note');
});

test('两个管理器同时把同一会话移到不同日期，第二次移动报冲突且不产生重复', async () => {
    const f = fixture(twoDays()), a = f.manager(), b = f.manager(); await a.initialize(); await b.initialize();
    await a.ensureDatesLoaded(['2026-11-04']); await b.ensureDatesLoaded(['2026-11-04']);
    await a.updateSession(session('2026-11-05', 'today'));
    await assert.rejects(b.updateSession(session('2026-11-06', 'today')), /其他窗口修改/);
    assert.equal([...f.files.values()].flatMap(r => r.sessions).filter(s => s.id === 'today').length, 1);
    assert.equal(f.files.has('2026-11-06'), false);
});

test('统计重建吸收外部新增会话，不改写原始记录', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); await m.ensureAllRecordsLoaded();
    f.files.get('2026-11-04').sessions.push(session('2026-11-04', 'external'));
    await m.regenerateRecordsByDate();
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
    assert.deepEqual(f.stats.writes, []);
});

test('缓存写入挂起不会阻塞原始记录保存，连续编辑按月合并写回', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize(); f.reset();
    let release;
    const original = f.adapter.writeCache;
    f.adapter.writeCache = async (...args) => { await new Promise(resolve => { release = resolve; }); await original(...args); };
    await m.updateSession(session('2026-11-04', 'one'));
    assert.equal(f.stats.cacheWrites, 0);
    const pending = m.flushCache();
    await new Promise(resolve => setImmediate(resolve));
    await m.updateSession(session('2026-11-04', 'two'));
    assert.equal(f.files.get('2026-11-04').sessions.length, 3);
    release(); await pending;
    f.adapter.writeCache = original;
    await m.flushCache();
    assert.deepEqual(f.stats.cacheMonths, [['2026-11'], ['2026-11']]);
});

test('长时间浏览历史后仅保留 62 天明细，淘汰后的记录仍可定位、编辑和删除', async () => {
    const data = {};
    for (let i = 0; i < 150; i++) {
        const date = new Date(2020, 0, i + 1).toISOString().slice(0, 10);
        data[date] = record(date, [session(date, `s${i}`)]);
    }
    const f = fixture(data), m = f.manager(); await m.initialize();
    for (const date of Object.keys(data)) await m.ensureDatesLoaded([date]);
    assert.equal(m.store.loaded.size, 62);
    assert.equal(m.store.committed.size, 62);
    assert.equal(m.getEventTotalPomodoroCount('task'), 150);
    const originalDate = Object.keys(data)[0];
    assert.equal(m.getDateSessions(originalDate).length, 0);
    await m.updateSessionNote('s0', 'edited after eviction');
    assert.equal(f.files.get(originalDate).sessions[0].note, 'edited after eviction');
    await m.deleteSession('s0');
    assert.equal(f.files.get(originalDate).sessions.length, 0);
    assert.ok(m.store.loaded.size <= 62);
});

test('大范围读取返回完整结果，释放缓存后统计不变', async () => {
    const data = {};
    for (let i = 0; i < 100; i++) {
        const date = new Date(2020, 0, i + 1).toISOString().slice(0, 10);
        data[date] = record(date, [session(date, `s${i}`)]);
    }
    const f = fixture(data), m = f.manager(); await m.initialize();
    const dates = Object.keys(data).sort();
    const sessions = await m.getDateRangeSessions(dates[0], dates[dates.length - 1]);
    assert.equal(sessions.length, 100);
    assert.ok(m.store.loaded.size <= 62);
    assert.equal(m.getEventTotalFocusTime('task'), 2500);
});

test('缓存某月损坏只重建该月；关闭管理器会提交待写缓存并清除定时器', async () => {
    const transport = cacheTransport(), f = fixture(twoDays());
    Object.assign(f.adapter, createPomodoroCache('test', 'frontend', transport.fetch));
    const m = f.manager(); await m.initialize();
    await m.updateSession(session('2026-11-04', 'extra'));
    assert.ok(m.store.cacheTimer);
    await m.closeStorage();
    assert.equal(m.store.cacheTimer, undefined);
    transport.files.set('/temp/petal/test/pomodoro-stats/frontend/2026-11.json', { broken: true });
    f.reset();
    const warm = f.manager(); await warm.initialize();
    assert.equal(f.stats.reads.length, 2);
    assert.equal(warm.getEventTotalPomodoroCount('task'), 3);
    await warm.closeStorage();
});

test('统计重建发现其他实例新增的日期，保留并统计新旧记录', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    f.files.set('2026-11-05', record('2026-11-05', [session('2026-11-05', 'new-day')]));
    await m.regenerateRecordsByDate();
    assert.equal(m.getDaySummary('2026-11-05').workSessions, 1);
    assert.equal(m.getEventTotalPomodoroCount('task'), 3);
    assert.deepEqual(f.stats.writes, []);
});

test('旧单文件已经被迁移成日期文件时，首次补录不会重复累计旧总量', async () => {
    const date = '2026-11-04';
    const legacy = { [date]: { date, workSessions: 10, totalWorkTime: 250, totalBreakTime: 0, sessions: [] } };
    const f = fixture(); f.setLegacy(legacy); const m = f.manager(); await m.initialize();
    f.files.set(date, clone(legacy[date]));
    await m.recordWorkSession(25, 'task', 'new', 25, true, false, { startTime: `${date}T12:00:00` });
    assert.equal(f.files.get(date).workSessions, 11);
    assert.equal(f.files.get(date).totalWorkTime, 275);
});

test('跨天写入部分失败的恢复期间发现外部修改，不用旧快照覆盖外部数据', async () => {
    const f = fixture(twoDays()), m = f.manager(); await m.initialize();
    const write = f.adapter.write;
    f.adapter.write = async (date, value) => {
        if (date === '2026-11-03') {
            await write(date, value);
            f.files.get(date).sessions.push(session(date, 'external-during-rollback'));
            throw new Error('source write failed');
        }
        return write(date, value);
    };
    await assert.rejects(m.updateSession(session('2026-11-04', 'old')), /保存及恢复失败/);
    assert.ok(f.files.get('2026-11-03').sessions.some(s => s.id === 'external-during-rollback'));
    assert.ok(f.files.get('2026-11-03').sessions.some(s => s.id === 'old'));
    const beforeRetry = clone(Object.fromEntries(f.files));
    await assert.rejects(m.recordWorkSession(25, 'task', 'retry'), /状态未恢复/);
    assert.deepEqual(Object.fromEntries(f.files), beforeRetry);
    f.adapter.write = write;
    await m.refreshData();
    assert.equal(m.store.needsReload, false);
});

function frontendAdapter({ kernel, locks, readonly = false, files = new Map(), directory = async () => [], legacy = null }) {
    const relative = 'src/index.ts';
    const source = fs.readFileSync(path.join(root, relative), 'utf8');
    const ast = ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true);
    const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'ReminderPlugin');
    const method = cls.members.find(node => node.name?.getText(ast) === 'createPomodoroStoreAdapter').getText(ast);
    const compiled = ts.transpileModule(`class Fixture { ${method} }`, { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
    const Fixture = new Function('PomodoroRecordManager', 'PomodoroWriteCoordinator', 'createPomodoroCache', 'readDir', 'window', 'navigator', 'POMODORO_RECORD_DATA_FILE',
        `${compiled}; return Fixture;`)({ getInstance: () => ({ locateSessionForWrite: async id => [...files].find(([, record]) => record.sessions?.some(s => s.id === id) || record.tombstones?.[id])?.[0].match(/([^/]+)\.json$/)?.[1] }) }, PomodoroWriteCoordinator, () => ({}), directory, { siyuan: { config: { readonly } } }, { locks }, 'legacy.json');
    const instance = Object.assign(new Fixture(), {
        name: 'test', kernel, storageDisposed: false,
        protectedStorage: { load: async file => clone(files.get(file)) || null },
        saveData: async (file, value) => { files.set(file, clone(value)); }, removeData: async file => { files.delete(file); },
        getWorkspaceScopedChannelName: name => `workspace:${name}`,
        loadData: async () => clone(legacy),
    });
    return instance.createPomodoroStoreAdapter();
}

function directoryApi(fetchSyncPost) {
    const source = fs.readFileSync(path.join(root, 'src/api.ts'), 'utf8');
    const ast = ts.createSourceFile('api.ts', source, ts.ScriptTarget.Latest, true);
    const methods = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['request', 'readDir'].includes(node.name?.text));
    const compiled = ts.transpileModule(methods.map(node => node.getText(ast).replace(/^export /, '')).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2021 },
    }).outputText;
    return new Function('fetchSyncPost', `${compiled}; return readDir;`)(fetchSyncPost);
}

test('前端首次启动缺少番茄目录时初始化为空，且不创建或覆盖记录', async () => {
    const calls = [];
    const directory = directoryApi(async (url, data) => {
        calls.push({ url, data }); return { code: 404, msg: 'path does not exist', data: null };
    });
    const adapter = frontendAdapter({ directory }), f = fixture();
    Object.assign(f.adapter, { list: adapter.list, readLegacy: adapter.readLegacy });
    const m = f.manager();
    await m.initialize();
    assert.deepEqual(Object.keys(m.getDailySummaries()), []);
    assert.deepEqual(f.stats.writes, []);
    assert.deepEqual(f.stats.removes, []);
    assert.deepEqual(calls, [{ url: '/api/file/readDir', data: { path: '/data/storage/petal/test/pomodoroRecords' } }]);
});

test('目录 API 保留默认非严格读取行为，严格读取返回完整目录条目', async () => {
    let response = { code: 500, msg: 'disk error', data: null };
    const directory = directoryApi(async () => response);
    assert.equal(await directory('/missing'), null);
    const entries = [{ name: '2026-11-04.json', isDir: false, isSymlink: false, updated: 1700000000 }];
    response = { code: 0, data: entries };
    assert.deepEqual(await directory('/records', true), entries);
});

test('缺少每日目录时仍加载旧版单文件历史，目录恢复后可重试', async () => {
    let response = { code: 404, data: null };
    const adapter = frontendAdapter({ directory: directoryApi(async () => response), legacy: twoDays() });
    const f = fixture(twoDays());
    Object.assign(f.adapter, { list: adapter.list, readLegacy: adapter.readLegacy });
    const m = f.manager();
    await m.initialize();
    assert.equal(m.getEventTotalFocusTime('task'), 50);
    response = { code: 0, data: await fixture(twoDays()).adapter.list() };
    await m.reloadRecords();
    assert.equal(m.getEventTotalFocusTime('task'), 50);
    assert.deepEqual(f.stats.writes, []);
});

test('目录权限、服务、格式及网络错误保留历史，失败初始化恢复后可重试', async () => {
    let response = { code: 0, data: [] }, networkError;
    const directory = directoryApi(async () => { if (networkError) throw networkError; return response; });
    const f = fixture(twoDays()), m = f.manager();
    await m.initialize();
    const cache = f.getCache();
    f.adapter.list = frontendAdapter({ directory }).list;
    for (const failure of [
        { code: 403, msg: 'permission denied', data: null },
        { code: 500, msg: 'disk error', data: null },
        { code: 0, data: null },
        { code: 0, data: {} },
        null,
    ]) {
        response = failure;
        await assert.rejects(m.reloadRecords(), /读取目录失败/);
        assert.equal(m.getEventTotalFocusTime('task'), 50);
        assert.deepEqual(f.getCache(), cache);
    }
    networkError = new Error('network unavailable');
    await assert.rejects(m.reloadRecords(), /network unavailable/);
    const retry = f.manager();
    await assert.rejects(retry.initialize(), /network unavailable/);
    networkError = null;
    response = { code: 0, data: await fixture(twoDays()).adapter.list() };
    await retry.initialize();
    assert.equal(retry.getEventTotalFocusTime('task'), 50);
    assert.deepEqual(f.stats.writes, []);
});

test('前端提交始终路由到内核 RPC，RPC 失败不绕开队列写入，且遵守只读状态', async () => {
    const requests = []; let fallback = 0;
    const locks = { request: async () => { fallback++; } };
    const kernel = { rpc: { call: { 'commit-pomodoro-records': async input => { requests.push(input); return {}; } } } };
    await frontendAdapter({ kernel, locks }).commit({ changes: [] });
    assert.equal(requests.length, 1);
    kernel.rpc.call['commit-pomodoro-records'] = async () => { throw new Error('kernel unavailable'); };
    await assert.rejects(frontendAdapter({ kernel, locks }).commit({ changes: [] }), /kernel unavailable/);
    assert.equal(fallback, 0);
    await assert.rejects(frontendAdapter({ kernel, locks, readonly: true }).commit({ changes: [] }), /不可写/);
});

test('无内核的旧宿主使用共享 Web Lock，两个前端也不会覆盖彼此的补录', async () => {
    const date = '2026-11-04', base = record(date, [session(date, 'original')]);
    const files = new Map([[`pomodoroRecords/${date}.json`, base]]);
    let tail = Promise.resolve(); const names = [];
    const locks = { request(name, run) { names.push(name); const result = tail.then(run); tail = result.catch(() => {}); return result; } };
    const a = frontendAdapter({ locks, files }), b = frontendAdapter({ locks, files });
    await Promise.all(['a', 'b'].map((id, index) => [a,b][index].commit({ changes: [{ date, base,
        next: record(date, [...base.sessions, session(date, id)]),
    }] })));
    assert.equal(new Set(names).size, 1);
    assert.deepEqual(files.get(`pomodoroRecords/${date}.json`).sessions.map(s => s.id).sort(), ['a', 'b', 'original']);
});

test('20 个陈旧快照并发补录仍全部保留，重放相同提交不重复累计', async () => {
    const date = '2026-11-04', base = record(date, [session(date, 'original')]);
    const f = fixture({ [date]: base });
    const managers = Array.from({ length: 20 }, () => f.manager());
    await Promise.all(managers.map(m => m.initialize()));
    await Promise.all(managers.map(m => m.ensureDatesLoaded([date])));
    await Promise.all(managers.map((m, index) => m.updateSession(session(date, `added-${index}`))));
    assert.equal(f.files.get(date).sessions.length, 21);
    assert.equal(f.files.get(date).totalWorkTime, 525);
    const applied = f.files.get(date).sessions.find(s => s.id === 'added-0');
    const replay = { changes: [{ date, base, next: record(date, [...base.sessions, applied]) }] };
    await f.writer.commit(replay);
    assert.equal(f.files.get(date).workSessions, 21);
    await Promise.all(managers.map(m => m.closeStorage()));
});

test('无时区时间写为绝对时间，同一原始请求重放不重复累计', async () => {
    const date = '2026-11-04', f = fixture();
    const input = { changes: [{ date, base: null, next: record(date, [session(date, 'local-time')]) }] };
    await f.writer.commit(input);
    const saved = f.files.get(date).sessions[0];
    assert.equal(saved.startTime, new Date(`${date}T10:00:00`).toISOString());
    assert.equal(saved.endTime, new Date(`${date}T10:25:00`).toISOString());
    assert.equal(saved.timezoneOffsetMinutes, new Date(`${date}T10:00:00`).getTimezoneOffset());
    await f.writer.commit(input);
    assert.equal(f.files.get(date).workSessions, 1);
    assert.equal(f.files.get(date).sessions[0].revision, 1);
});

test('凌晨新记录存自然日文件，查询和今日统计按逻辑日归属，时长不按起止时间差重算', async () => {
    const f = fixture(), m = f.manager(); dayStartHours = 3;
    try {
        await m.recordWorkSession(25, 'task', 'paused focus', 25, true, false, {
            startTime: '2026-11-04T01:00:00', endTime: '2026-11-04T02:30:00',
        });
        assert.equal(f.files.has('2026-11-04'), true);
        assert.equal(f.files.has('2026-11-03'), false);
        assert.equal(m.getDaySummary('2026-11-03').totalWorkTime, 25);
        assert.equal(m.getDaySummary('2026-11-04'), undefined);
        const sessions = await m.getDateRangeSessions('2026-11-03', '2026-11-03');
        assert.equal(sessions.length, 1); assert.equal(sessions[0].duration, 25);
        assert.equal(sessions[0].storageDate, '2026-11-04');
        assert.equal(sessions[0].revision, 1);
    } finally { dayStartHours = 0; await m.closeStorage(); }
});

test('日界限精确到分钟，同一物理分片可以贡献两个逻辑日', async () => {
    const date = '2026-11-04'; dayStartHours = 3.5;
    const f = fixture({ [date]: record(date, [
        session(date, 'before', 'task', { startTime: date + 'T03:29:00' }),
        session(date, 'boundary', 'task', { startTime: date + 'T03:30:00' }),
    ]) }); const m = f.manager();
    try {
        await m.initialize();
        assert.equal(m.getDaySummary('2026-11-03').workSessions, 1);
        assert.equal(m.getDaySummary(date).workSessions, 1);
        await m.ensureDatesLoaded(['2026-11-03']);
        assert.deepEqual(m.getDateSessions('2026-11-03').map(s => s.id), ['before']);
        assert.deepEqual(m.getDateSessions(date).map(s => s.id), ['boundary']);
        assert.equal(m.getEventTotalPomodoroCount('task'), 2);
    } finally { dayStartHours = 0; await m.closeStorage(); }
});

test('旧逻辑日文件不迁移，两个物理文件的同一逻辑日贡献正确合并和替换', async () => {
    dayStartHours = 3;
    const f = fixture({
        '2026-11-03': record('2026-11-03', [session('2026-11-04', 'legacy', 'task', { startTime: '2026-11-04T01:00:00' })]),
        '2026-11-04': record('2026-11-04', [session('2026-11-04', 'new', 'task', { startTime: '2026-11-04T02:00:00' })]),
    }); const m = f.manager();
    try {
        await m.initialize();
        assert.equal(m.getDaySummary('2026-11-03').totalWorkTime, 50);
        assert.equal((await m.getDateRangeSessions('2026-11-03', '2026-11-03')).length, 2);
        f.files.get('2026-11-04').sessions[0].duration = 40;
        f.files.get('2026-11-04').totalWorkTime = 40;
        await m.reloadRecords(['2026-11-04']);
        assert.equal(m.getDaySummary('2026-11-03').totalWorkTime, 65);
        assert.equal(m.getEventTotalFocusTime('task'), 65);
        assert.deepEqual(f.stats.writes, []);
    } finally { dayStartHours = 0; await m.closeStorage(); }
});

test('缓存记录日界限配置，配置变化重读明细，配置相同的再次启动无需读明细', async () => {
    const date = '2026-11-04';
    const f = fixture({ [date]: record(date, [session(date, 'early', 'task', { startTime: date + 'T01:00:00' })]) });
    const a = f.manager(); await a.initialize(); f.reset(); dayStartHours = 3;
    try {
        const b = f.manager(); await b.initialize();
        assert.deepEqual(f.stats.reads, [date]);
        assert.equal(b.getDaySummary('2026-11-03').workSessions, 1);
        f.reset(); const c = f.manager(); await c.initialize();
        assert.deepEqual(f.stats.reads, []);
        assert.equal(c.getDaySummary('2026-11-03').workSessions, 1);
        assert.equal((await c.getDateRangeSessions('2026-11-03', '2026-11-03')).length, 1);
        assert.deepEqual(f.stats.writes, []);
    } finally { dayStartHours = 0; }
});

test('记录保存的时区偏移使自然日和逻辑日不受设备时区变化影响', async t => {
    const f = fixture(), m = f.manager(); dayStartHours = 3;
    try {
        await m.updateSession(session('2026-11-05', 'tz', 'task', {
            startTime: '2026-11-04T18:00:00.000Z', endTime: '2026-11-04T18:25:00.000Z', timezoneOffsetMinutes: -480,
        }));
        assert.equal(f.files.has('2026-11-05'), true);
        assert.equal(m.getDaySummary('2026-11-04').workSessions, 1);
        t.mock.method(Date.prototype, 'getTimezoneOffset', () => 360);
        await m.regenerateRecordsByDate();
        assert.equal(m.getDaySummary('2026-11-04').workSessions, 1);
        assert.equal((await m.getFocusById('tz')).date, '2026-11-05');
    } finally { dayStartHours = 0; await m.closeStorage(); }
});

test('会话版本递增，旧编辑窗口不能覆盖本实例已经修改过的记录', async () => {
    const f = fixture(), m = f.manager();
    await m.updateSession(session('2026-11-04', 'versioned'));
    const first = clone((await m.getFocusById('versioned')).session);
    assert.equal(first.revision, 1); assert.ok(Number.isFinite(Date.parse(first.updatedAt)));
    await m.updateSessionNote('versioned', 'second');
    assert.equal((await m.getFocusById('versioned')).session.revision, 2);
    await assert.rejects(m.updateSession({ ...first, note: 'stale' }), /已变化/);
    assert.equal(f.files.get('2026-11-04').sessions[0].note, 'second');
});

test('没有版本字段的旧记录编辑快照按版本零校验', async () => {
    const date = '2026-11-04', original = session(date, 'legacy-editor');
    const f = fixture({ [date]: record(date, [original]) }), m = f.manager();
    await m.initialize();
    const stale = clone((await m.getFocusById(original.id)).session);
    await m.updateSession({ ...stale, note: 'first edit' });
    await assert.rejects(m.updateSession({ ...stale, note: 'old editor' }), /已变化/);
    assert.equal(f.files.get(date).sessions[0].note, 'first edit');
});

test('删除保留持久标记，旧实例、重新启动和其他分片都不能恢复旧 ID', async () => {
    const date = '2026-11-03', id = 'deleted-legacy';
    const f = fixture({ [date]: record(date, [session('2026-11-04', id)]) });
    const a = f.manager(), b = f.manager(); await a.initialize(); await b.initialize();
    const stale = clone((await b.getFocusById(id)).session);
    await a.deleteSession(id);
    assert.equal(f.files.get(date).sessions.length, 0);
    assert.equal(f.files.get(date).schemaVersion, 2);
    assert.ok(f.files.get(date).tombstones[id].revision > (stale.revision || 0));
    await assert.rejects(b.updateSession({ ...stale, note: 'offline' }), /已删除/);
    await a.flushCache(); f.restartWriter();
    const c = f.manager(); await c.initialize();
    assert.equal(c.getSessionStorageDate(id), date);
    await assert.rejects(c.updateSession({ ...stale, startTime: '2026-11-06T10:00:00' }), /已删除/);
    assert.equal(f.files.has('2026-11-06'), false);
    assert.equal(f.files.get(date).sessions.length, 0);
});

test('同一会话内容改回原值后，版本仍能识别陈旧快照', async () => {
    const f = fixture(), a = f.manager(); await a.updateSession(session('2026-11-04', 'aba', 'task', { note: '' }));
    const b = f.manager(); await b.initialize(); const stale = clone((await b.getFocusById('aba')).session);
    await a.updateSessionNote('aba', 'temporary'); await a.updateSessionNote('aba', '');
    await assert.rejects(b.updateSession({ ...stale, note: 'stale edit' }), /其他窗口修改/);
    assert.equal(f.files.get('2026-11-04').sessions[0].revision, 3);
});

test('旧累计余额不会随新增凌晨会话整体转移到前一逻辑日', async () => {
    const date = '2026-11-04'; dayStartHours = 3;
    const f = fixture({ [date]: { date, sessions: [], workSessions: 10, totalWorkTime: 250, totalBreakTime: 0 } }); const m = f.manager();
    try {
        await m.recordWorkSession(25, 'task', 'early', 25, true, false, { startTime: date + 'T01:00:00' });
        assert.equal(m.getDaySummary(date).totalWorkTime, 250);
        assert.equal(m.getDaySummary('2026-11-03').totalWorkTime, 25);
        assert.equal(f.files.get(date).totalWorkTime, 275);
    } finally { dayStartHours = 0; await m.closeStorage(); }
});

test('周统计使用逻辑日字符串，不重复扣除一天起始时间', async () => {
    dayStartHours = 3;
    const f = fixture({
        '2026-11-01': record('2026-11-01', [session('2026-11-01', 'sunday')]),
        '2026-11-02': record('2026-11-02', [session('2026-11-02', 'monday')]),
    }); const m = f.manager();
    try { await m.initialize(); assert.equal(m.getWeekFocusTime(), 25); }
    finally { dayStartHours = 0; await m.closeStorage(); }
});
