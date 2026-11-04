import type { PomodoroRecord, PomodoroSession } from '../components/dataManager/pomodoroRecord';
import type { PomodoroCommit, PomodoroCommitResult } from './pomodoroWriteCoordinator';
import { getPomodoroDeleteMarker } from './pomodoroWriteCoordinator';
import { getDayStartMinutes } from './dateUtils';
import { getPomodoroLogicalDate } from './pomodoroDates';

export interface PomodoroEventTotals { count: number; duration: number; }
interface PomodoroWorkTotals extends PomodoroEventTotals { displayCount: number; displayDuration: number; }
export interface PomodoroDaySummary {
    date: string;
    workSessions: number;
    totalWorkTime: number;
    totalBreakTime: number;
    workTimeFromSessions: number;
    // workByEvent 保留按会话查询的旧口径；events 排除进行中记录，供累计索引使用。
    workByEvent: Record<string, PomodoroWorkTotals>;
    workByTitle: Record<string, PomodoroEventTotals>;
    events: Record<string, PomodoroEventTotals>;
    eventIds: string[];
    sessionIds: string[];
    deletedSessionIds: string[];
}

export interface PomodoroFileEntry { name: string; isDir: boolean; updated: number; }
export interface PomodoroStoreAdapter {
    list(): Promise<PomodoroFileEntry[]>;
    read(date: string): Promise<PomodoroRecord | null>;
    commit(input: PomodoroCommit): Promise<PomodoroCommitResult>;
    readLegacy?(): Promise<Record<string, PomodoroRecord> | null>;
    readCache(): Promise<any>;
    writeCache(cache: any, months?: string[]): Promise<void>;
}

interface CachedDay {
    updated: number;
    verifiedAt: number;
    summary: PomodoroDaySummary; // 物理分片总量及会话定位
    logicalDays: Record<string, PomodoroDaySummary>; // 此分片对各逻辑日的贡献
}
const CACHE_VERSION = 5;
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const CONCURRENCY = 6;

/** 同时限制在途读取和解析数量；失败后等待已开始的工作结束，再向上传播。 */
export async function mapPomodoroFiles<T>(items: T[], visit: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    let failure: unknown;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (!failure && next < items.length) {
            const item = items[next++];
            try { await visit(item); } catch (error) { failure = error; }
        }
    }));
    if (failure) throw failure;
}

export function summarizePomodoroDay(date: string, record: PomodoroRecord, count: (s: PomodoroSession) => number): PomodoroDaySummary {
    const workByEvent: Record<string, PomodoroWorkTotals> = Object.create(null);
    const workByTitle: Record<string, PomodoroEventTotals> = Object.create(null);
    const events: Record<string, PomodoroEventTotals> = Object.create(null);
    let workSessions = 0, totalWorkTime = 0, totalBreakTime = 0;
    for (const session of record.sessions) {
        if (session.type === 'work') {
            const sessionCount = count(session);
            const value = workByEvent[session.eventId] ||= { count: 0, duration: 0, displayCount: 0, displayDuration: 0 };
            value.count += sessionCount;
            value.duration += session.duration || 0;
            // 文档内标记的旧口径为逐条向下取整，不能先求和再取整。
            value.displayCount += Math.max(0, Math.floor(Number(sessionCount) || 0));
            value.displayDuration += Math.max(0, Math.floor(Number(session.duration) || 0));
            const title = workByTitle[session.eventTitle || ''] ||= { count: 0, duration: 0 };
            title.count += sessionCount;
            title.duration += session.duration || 0;
            if (!session.inProgress) {
                workSessions += sessionCount;
                totalWorkTime += Math.max(0, Math.round(Number(session.duration) || 0));
                if (session.eventId) {
                    const total = events[session.eventId] ||= { count: 0, duration: 0 };
                    total.count += sessionCount;
                    total.duration += session.duration || 0;
                }
            }
        } else if (!session.inProgress) {
            totalBreakTime += Math.max(0, Math.round(Number(session.duration) || 0));
        }
    }
    return {
        date,
        workSessions: record.workSessions ?? workSessions,
        totalWorkTime: record.totalWorkTime ?? totalWorkTime,
        totalBreakTime: record.totalBreakTime ?? totalBreakTime,
        workTimeFromSessions: totalWorkTime,
        workByEvent, workByTitle, events,
        eventIds: [...new Set(record.sessions.map(s => s.eventId).filter(id => typeof id === 'string'))],
        sessionIds: record.sessions.map(s => s.id).filter(id => typeof id === 'string'),
        deletedSessionIds: Object.keys(record.tombstones || {}),
    };
}

function validSummary(value: any, date: string): value is PomodoroDaySummary {
    const totals = (map: any) => map && typeof map === 'object' && !Array.isArray(map)
        && Object.values(map).every((v: any) => v && Number.isFinite(v.count) && Number.isFinite(v.duration));
    return value?.date === date && ['workSessions', 'totalWorkTime', 'totalBreakTime', 'workTimeFromSessions'].every(k => Number.isFinite(value[k]))
        && totals(value.events) && totals(value.workByEvent) && totals(value.workByTitle)
        && Object.values(value.workByEvent).every((v: any) => Number.isFinite(v.displayCount) && Number.isFinite(v.displayDuration))
        && Array.isArray(value.sessionIds) && value.sessionIds.every((id: any) => typeof id === 'string')
        && Array.isArray(value.deletedSessionIds) && value.deletedSessionIds.every((id: any) => typeof id === 'string')
        && Array.isArray(value.eventIds) && value.eventIds.every((id: any) => typeof id === 'string');
}

function normalizeRecord(date: string, record: PomodoroRecord): PomodoroRecord {
    if (!record || typeof record !== 'object') throw new Error(`番茄钟记录读取失败: ${date}`);
    if (!Array.isArray(record.sessions)) {
        // 早期仅保存每日总量的记录可缺省 sessions，但错误响应不能当成空记录。
        if (record.sessions == null && Number.isFinite(record.workSessions) && Number.isFinite(record.totalWorkTime)) record.sessions = [];
        else throw new Error(`番茄钟记录格式无效: ${date}`);
    }
    record.date = date;
    record.sessions = record.sessions.filter(session => !getPomodoroDeleteMarker(record, session.id));
    return record;
}

function combineSummaries(date: string, values: PomodoroDaySummary[]): PomodoroDaySummary {
    const result = summarizePomodoroDay(date, { date, sessions: [] } as PomodoroRecord, () => 0);
    for (const value of values) {
        for (const key of ['workSessions', 'totalWorkTime', 'totalBreakTime', 'workTimeFromSessions'] as const) result[key] += value[key];
        for (const key of ['events', 'workByEvent', 'workByTitle'] as const) {
            for (const [id, stats] of Object.entries(value[key])) {
                const map = result[key] as unknown as Record<string, Record<string, number>>;
                const total = map[id] ||= {};
                for (const [metric, amount] of Object.entries(stats)) total[metric] = (total[metric] || 0) + amount;
            }
        }
        result.eventIds.push(...value.eventIds);
        result.sessionIds.push(...value.sessionIds);
    }
    result.eventIds = [...new Set(result.eventIds)];
    return result;
}

function summarizeFile(date: string, record: PomodoroRecord, count: (s: PomodoroSession) => number, dayStart: number): CachedDay {
    const summary = summarizePomodoroDay(date, record, count);
    const grouped: Record<string, PomodoroSession[]> = Object.create(null);
    for (const session of record.sessions) (grouped[getPomodoroLogicalDate(session, date, dayStart)] ||= []).push(session);
    const logicalDays: Record<string, PomodoroDaySummary> = Object.create(null);
    for (const [logicalDate, sessions] of Object.entries(grouped)) {
        logicalDays[logicalDate] = summarizePomodoroDay(logicalDate, { date: logicalDate, sessions } as PomodoroRecord, count);
    }
    // 没有详细会话的历史正余额保留在原日期，不能因补录一条凌晨会话而整体移到前一天。
    const sessionTotals = summarizePomodoroDay(date, { date, sessions: record.sessions } as PomodoroRecord, count);
    const targetDate = Object.keys(grouped).length === 1 ? Object.keys(grouped)[0] : date;
    for (const key of ['workSessions', 'totalWorkTime', 'totalBreakTime'] as const) {
        const residual = summary[key] - sessionTotals[key];
        if (residual || !Object.keys(grouped).length) {
            const residualDate = residual > 0 ? date : targetDate;
            const target = logicalDays[residualDate] ||= summarizePomodoroDay(residualDate, { date: residualDate, sessions: [] } as PomodoroRecord, count);
            target[key] += residual;
        }
    }
    return { summary, logicalDays, updated: 0, verifiedAt: Date.now() };
}

function statisticsConfiguration(): string { return `${getDayStartMinutes()}:${new Date().getTimezoneOffset()}`; }

/** 原始日期文件是唯一事实来源。持久缓存仅含摘要，不含会话明细，损坏时可完整重建。 */
export class PomodoroStore {
    readonly records: Record<string, PomodoroRecord> = Object.create(null);
    readonly summaries: Record<string, PomodoroDaySummary> = Object.create(null);
    readonly eventTotals: Record<string, PomodoroEventTotals> = Object.create(null);
    private readonly days: Record<string, CachedDay> = Object.create(null);
    private readonly loaded = new Set<string>();
    private readonly committed = new Map<string, PomodoroRecord>();
    private readonly sessionDates = new Map<string, string>();
    private readonly deletedDates = new Map<string, string>();
    private readonly logicalBuckets = new Map<string, Set<string>>();
    private configuration = statisticsConfiguration();
    private dayStart = getDayStartMinutes();
    private initializing?: Promise<void>;
    private initialized = false;
    private legacyMode = false;
    private tail: Promise<unknown> = Promise.resolve();
    private detailLeases = 0;
    private readonly maxLoadedDays = 62;
    private readonly dirtyMonths = new Set<string>();
    private cacheTimer?: ReturnType<typeof setTimeout>;
    private cacheTail: Promise<void> = Promise.resolve();
    private disposed = false;
    needsReload = false;

    constructor(private readonly adapter: PomodoroStoreAdapter, private readonly count: (s: PomodoroSession) => number) {}

    private serial<T>(operation: () => Promise<T>): Promise<T> {
        const pending = this.tail.then(operation);
        this.tail = pending.catch(() => {});
        return pending;
    }

    initialize(): Promise<void> {
        if (this.initialized) return this.configuration === statisticsConfiguration() ? Promise.resolve() : this.rebuildStatistics();
        if (this.initializing) return this.initializing;
        this.initializing = this.serial(async () => {
            let cache: any;
            try { cache = await this.adapter.readCache(); } catch { /* 临时目录被清除时重建。 */ }
            if (cache?.version === CACHE_VERSION && cache.configuration === this.configuration && cache.days && typeof cache.days === 'object') {
                for (const [date, cached] of Object.entries(cache.days) as [string, CachedDay & { logicalDate?: string }][]) {
                    const day = cached?.logicalDate && DATE_FILE.test(`${cached.logicalDate}.json`) && validSummary(cached.summary, date)
                        ? { ...cached, logicalDays: { [cached.logicalDate]: { ...cached.summary, date: cached.logicalDate, deletedSessionIds: [] } } }
                        : cached;
                    if (DATE_FILE.test(`${date}.json`) && Number.isFinite(day?.updated)
                        && Number.isFinite(day?.verifiedAt) && validSummary(day.summary, date)
                        && day.logicalDays && typeof day.logicalDays === 'object'
                        && Object.entries(day.logicalDays).every(([key, value]) => validSummary(value, key))) {
                        this.replace(date, day);
                    }
                }
            }
            await this.reconcileFiles(false);
            await this.flushCache();
            this.initialized = true;
        }).finally(() => { this.initializing = undefined; });
        return this.initializing;
    }

    private replace(date: string, day?: CachedDay) {
        const old = this.days[date];
        const affected = new Set([...Object.keys(old?.logicalDays || {}), ...Object.keys(day?.logicalDays || {})]);
        for (const [id, value] of Object.entries(old?.summary.events || {})) {
            const total = this.eventTotals[id];
            if (!total) continue;
            total.count -= value.count; total.duration -= value.duration;
            if (!total.count && !total.duration) delete this.eventTotals[id];
        }
        for (const id of old?.summary.sessionIds || []) if (this.sessionDates.get(id) === date) this.sessionDates.delete(id);
        for (const id of old?.summary.deletedSessionIds || []) if (this.deletedDates.get(id) === date) this.deletedDates.delete(id);
        for (const logicalDate of Object.keys(old?.logicalDays || {})) this.logicalBuckets.get(logicalDate)?.delete(date);
        if (!day) {
            delete this.days[date]; delete this.records[date];
            this.loaded.delete(date); this.committed.delete(date);
        } else {
            this.days[date] = day;
            for (const [id, value] of Object.entries(day.summary.events)) {
                const total = this.eventTotals[id] ||= { count: 0, duration: 0 };
                total.count += value.count; total.duration += value.duration;
            }
            for (const id of day.summary.sessionIds) this.sessionDates.set(id, date);
            for (const id of day.summary.deletedSessionIds) this.deletedDates.set(id, date);
            for (const logicalDate of Object.keys(day.logicalDays)) {
                if (!this.logicalBuckets.has(logicalDate)) this.logicalBuckets.set(logicalDate, new Set());
                this.logicalBuckets.get(logicalDate)!.add(date);
            }
            if (!this.loaded.has(date)) this.records[date] = this.placeholder(date);
        }
        for (const logicalDate of affected) {
            const buckets = this.logicalBuckets.get(logicalDate);
            if (!buckets?.size) { this.logicalBuckets.delete(logicalDate); delete this.summaries[logicalDate]; }
            else this.summaries[logicalDate] = combineSummaries(logicalDate, [...buckets].map(key => this.days[key].logicalDays[logicalDate]));
        }
    }

    private placeholder(date: string): PomodoroRecord {
        const day = this.days[date].summary;
        return { date, workSessions: day.workSessions, totalWorkTime: day.totalWorkTime, totalBreakTime: day.totalBreakTime, sessions: [] };
    }

    private async readDate(date: string, updated: number): Promise<void> {
        const record = normalizeRecord(date, await this.adapter.read(date));
        const day = summarizeFile(date, record, this.count, this.dayStart);
        day.updated = updated;
        this.records[date] = record;
        this.committed.set(date, JSON.parse(JSON.stringify(record)));
        this.loaded.add(date);
        this.replace(date, day);
    }

    logicalDates(): string[] { return Object.keys(this.summaries); }

    async ensureLogicalDates(dates: string[]): Promise<void> {
        await this.initialize();
        const buckets = new Set<string>();
        for (const date of dates) for (const bucket of this.logicalBuckets.get(date) || []) buckets.add(bucket);
        await this.ensureDates([...buckets]);
    }

    getLogicalDateSessions(date: string): PomodoroSession[] {
        return [...this.logicalBuckets.get(date) || []].flatMap(bucket => (this.records[bucket]?.sessions || [])
            .filter(session => getPomodoroLogicalDate(session, bucket, this.dayStart) === date));
    }

    /** 日界限只改变索引；读取全部源文件成功前保留旧索引，绝不重写历史文件。 */
    async rebuildStatistics(): Promise<void> {
        await this.serial(async () => {
            const configuration = statisticsConfiguration(), dayStart = getDayStartMinutes();
            const entries = (await this.adapter.list()).filter(entry => !entry.isDir && DATE_FILE.test(entry.name));
            const staged = new Map<string, { day: CachedDay; record?: PomodoroRecord }>();
            let legacy = false;
            if (!entries.length && this.adapter.readLegacy) {
                const values = await this.adapter.readLegacy();
                legacy = !!values && Object.keys(values).length > 0;
                for (const [date, value] of Object.entries(values || {})) {
                    if (!DATE_FILE.test(date + '.json')) continue;
                    const record = normalizeRecord(date, value);
                    staged.set(date, { day: summarizeFile(date, record, this.count, dayStart), record });
                }
            } else await mapPomodoroFiles(entries, async entry => {
                const date = entry.name.slice(0, -5);
                const record = normalizeRecord(date, await this.adapter.read(date));
                const day = summarizeFile(date, record, this.count, dayStart);
                day.updated = entry.updated;
                staged.set(date, { day, record: this.loaded.has(date) ? record : undefined });
            });
            if (configuration !== statisticsConfiguration()) throw new Error('日界限设置在统计重建期间发生变化，请重试');
            const oldDates = Object.keys(this.days);
            for (const date of oldDates) this.replace(date);
            this.configuration = configuration; this.dayStart = dayStart; this.legacyMode = legacy;
            for (const [date, { day, record }] of staged) {
                if (record) {
                    this.records[date] = record; this.loaded.add(date);
                    this.committed.set(date, JSON.parse(JSON.stringify(record)));
                }
                this.replace(date, day);
            }
            if (!legacy) this.persist([...oldDates, ...staged.keys()]);
            this.trimDetails();
        });
    }

    private persist(dates: string[]) {
        dates.forEach(date => this.dirtyMonths.add(date.slice(0, 7)));
        if (!this.dirtyMonths.size || this.disposed || this.cacheTimer) return;
        this.cacheTimer = setTimeout(() => { this.cacheTimer = undefined; void this.flushCache(); }, 500);
    }

    /** 源记录成功后立即返回；可重建缓存另排队，仅序列化发生变化的月份。 */
    async flushCache(): Promise<void> {
        clearTimeout(this.cacheTimer);
        this.cacheTimer = undefined;
        const months = [...this.dirtyMonths];
        if (!months.length) return this.cacheTail;
        this.dirtyMonths.clear();
        const selected = new Set(months);
        const days = Object.fromEntries(Object.entries(this.days).filter(([date]) => selected.has(date.slice(0, 7))).map(([date, day]) => {
            const logicalDates = Object.keys(day.logicalDays);
            // 整个物理分片只贡献一个逻辑日时，复用汇总，避免缓存重复保存整套事件索引。
            if (logicalDates.length === 1) {
                const { logicalDays: _logicalDays, ...physical } = day;
                return [date, { ...physical, logicalDate: logicalDates[0] }];
            }
            return [date, day];
        }));
        const manifest = [...new Set(Object.keys(this.days).map(date => date.slice(0, 7)))].sort();
        const configuration = this.configuration;
        this.cacheTail = this.cacheTail.then(() => this.adapter.writeCache({ version: CACHE_VERSION, configuration, days, months: manifest }, months))
            .catch(error => {
                months.forEach(month => this.dirtyMonths.add(month));
                console.warn('Failed to persist rebuildable pomodoro statistics cache:', error);
            });
        return this.cacheTail;
    }

    async close(): Promise<void> { this.disposed = true; await this.flushCache(); }

    retainDetails(): () => void {
        this.detailLeases++;
        let released = false;
        return () => { if (!released) { released = true; this.detailLeases--; this.trimDetails(); } };
    }

    trimDetails(protectedDates: Set<string> = new Set()): void {
        if (this.detailLeases || this.legacyMode) return;
        for (const date of this.loaded) {
            if (this.loaded.size <= this.maxLoadedDays) break;
            if (protectedDates.has(date)) continue;
            this.loaded.delete(date);
            this.committed.delete(date);
            if (this.days[date]) this.records[date] = this.placeholder(date);
        }
    }

    private async reconcileFiles(verifyAll: boolean) {
        const entries = (await this.adapter.list()).filter(e => !e.isDir && DATE_FILE.test(e.name));
        const dates = new Set(entries.map(e => e.name.slice(0, -5)));
        if (!entries.length && (!Object.keys(this.days).length || this.legacyMode) && this.adapter.readLegacy) {
            const legacy = await this.adapter.readLegacy();
            this.legacyMode = !!legacy && Object.keys(legacy).length > 0;
            for (const [date, value] of Object.entries(legacy || {})) {
                if (!DATE_FILE.test(`${date}.json`)) continue;
                const record = normalizeRecord(date, value);
                this.records[date] = record; this.loaded.add(date);
                this.committed.set(date, JSON.parse(JSON.stringify(record)));
                this.replace(date, summarizeFile(date, record, this.count, this.dayStart));
            }
            // 旧版单文件在迁移到逐日文件之前不持久化摘要，避免误判为空目录。
            return;
        }
        const changed = entries.filter(entry => {
            const day = this.days[entry.name.slice(0, -5)];
            // readDir 的时间只有秒精度：最近两秒写入的文件不能仅凭相同时间戳复用。
            return verifyAll || !day || day.updated !== entry.updated || !entry.updated
                || day.verifiedAt - entry.updated * 1000 < 2000;
        });
        // 先读完所有发生变化的文件；读取失败不清空已有数据或覆盖原始文件。
        await mapPomodoroFiles(changed, async entry => {
            const date = entry.name.slice(0, -5);
            const retain = this.loaded.has(date);
            await this.readDate(date, entry.updated);
            if (!retain) {
                this.loaded.delete(date);
                this.committed.delete(date);
                this.records[date] = this.placeholder(date);
            }
        });
        const deleted = Object.keys(this.days).filter(date => !dates.has(date));
        for (const date of deleted) this.replace(date);
        this.persist([...changed.map(entry => entry.name.slice(0, -5)), ...deleted]);
        this.trimDetails();
    }

    async refresh(dates?: string[], verifyAll = false): Promise<void> {
        await this.initialize();
        await this.serial(async () => {
            if (this.needsReload) {
                await this.reconcileFiles(true);
                this.needsReload = false;
                return;
            }
            if (!dates) return this.reconcileFiles(verifyAll);
            const entries = await this.adapter.list();
            const byDate = new Map(entries.filter(e => !e.isDir && DATE_FILE.test(e.name)).map(e => [e.name.slice(0, -5), e]));
            await mapPomodoroFiles([...new Set(dates)], async date => {
                if (!DATE_FILE.test(`${date}.json`)) return;
                const entry = byDate.get(date);
                if (entry) await this.readDate(date, entry.updated);
                else this.replace(date);
            });
            this.persist(dates);
            this.trimDetails();
        });
    }

    async ensureDates(dates: string[]): Promise<void> {
        await this.initialize();
        await this.serial(async () => {
            await mapPomodoroFiles([...new Set(dates)].filter(date => this.days[date] && !this.loaded.has(date)),
                date => this.readDate(date, this.days[date].updated));
            for (const date of dates) if (this.loaded.has(date)) { this.loaded.delete(date); this.loaded.add(date); }
            this.trimDetails(new Set(dates));
        });
    }

    dateForSession(id: string): string | undefined { return this.sessionDates.get(id); }
    locateSession(id: string): string | undefined { return this.deletedDates.get(id) || this.sessionDates.get(id); }

    private publish(result: PomodoroCommitResult): void {
        for (const [date, record] of Object.entries(result)) {
            if (!record) { this.replace(date); continue; }
            this.records[date] = record;
            this.loaded.add(date);
            this.committed.set(date, JSON.parse(JSON.stringify(record)));
            this.replace(date, summarizeFile(date, record, this.count, this.dayStart));
        }
        this.legacyMode = false;
        this.persist(Object.keys(result));
        this.trimDetails();
    }

    async saveMany(records: [string, PomodoroRecord][]): Promise<void> {
        await this.serial(async () => {
            if (this.legacyMode) {
                const requested = new Set(records.map(([date]) => date));
                records = [...records, ...Object.entries(this.records).filter(([date]) => !requested.has(date))];
            }
            const changes = records.map(([date, record]) => {
                if (this.days[date] && !this.loaded.has(date)) throw new Error(`番茄钟明细尚未加载，禁止覆盖: ${date}`);
                // 旧单文件迁移到新日期文件时，该文件尚不存在。
                const base = this.legacyMode ? null : this.committed.get(date) || null;
                return { date, base, next: JSON.parse(JSON.stringify(record)) };
            });
            try {
                if (this.needsReload) throw new Error('上次番茄钟保存状态未恢复，请刷新记录后重试');
                this.publish(await this.adapter.commit({ changes }));
            } catch (error) {
                if (String((error as Error)?.message || error).includes('保存及恢复失败')) this.needsReload = true;
                // 恢复完整的本地编辑快照；失败的重新分组不曾修改 records。
                for (const [date] of records) {
                    const original = this.committed.get(date);
                    if (original) this.records[date] = JSON.parse(JSON.stringify(original));
                    else delete this.records[date];
                }
                throw error;
            }
        });
    }

    /** 新分组独立暂存，协调器同时校验所有源日期，成功后才发布新状态。 */
    async replaceAll(records: Record<string, PomodoroRecord>): Promise<void> {
        await this.serial(async () => {
            if (this.needsReload) throw new Error('上次番茄钟保存状态未恢复，请刷新记录后重试');
            const dates = new Set([...Object.keys(this.days), ...Object.keys(records)]);
            const changes = [...dates].map(date => ({ date,
                base: this.legacyMode ? null : this.committed.get(date) || null,
                next: records[date] || null,
            }));
            const expectedDates = this.legacyMode ? [] : Object.keys(this.days);
            try {
                this.publish(await this.adapter.commit({ changes, mode: 'replace', expectedDates }));
            } catch (error) {
                if (String((error as Error)?.message || error).includes('保存及恢复失败')) this.needsReload = true;
                throw error;
            }
        });
    }
}
