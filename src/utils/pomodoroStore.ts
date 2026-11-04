import type { PomodoroRecord, PomodoroSession } from '../components/dataManager/pomodoroRecord';
import type { PomodoroCommit, PomodoroCommitResult } from './pomodoroWriteCoordinator';

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

interface CachedDay { updated: number; verifiedAt: number; summary: PomodoroDaySummary; }
const CACHE_VERSION = 4;
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
    };
}

function validSummary(value: any, date: string): value is PomodoroDaySummary {
    const totals = (map: any) => map && typeof map === 'object' && !Array.isArray(map)
        && Object.values(map).every((v: any) => v && Number.isFinite(v.count) && Number.isFinite(v.duration));
    return value?.date === date && ['workSessions', 'totalWorkTime', 'totalBreakTime', 'workTimeFromSessions'].every(k => Number.isFinite(value[k]))
        && totals(value.events) && totals(value.workByEvent) && totals(value.workByTitle)
        && Object.values(value.workByEvent).every((v: any) => Number.isFinite(v.displayCount) && Number.isFinite(v.displayDuration))
        && Array.isArray(value.sessionIds) && value.sessionIds.every((id: any) => typeof id === 'string')
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
    return record;
}

/** 原始日期文件是唯一事实来源。持久缓存仅含摘要，不含会话明细，损坏时可完整重建。 */
export class PomodoroStore {
    readonly records: Record<string, PomodoroRecord> = Object.create(null);
    readonly summaries: Record<string, PomodoroDaySummary> = Object.create(null);
    readonly eventTotals: Record<string, PomodoroEventTotals> = Object.create(null);
    private readonly days: Record<string, CachedDay> = Object.create(null);
    private readonly loaded = new Set<string>();
    private readonly committed = new Map<string, PomodoroRecord>();
    private readonly sessionDates = new Map<string, string>();
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
        if (this.initialized) return Promise.resolve();
        if (this.initializing) return this.initializing;
        this.initializing = this.serial(async () => {
            let cache: any;
            try { cache = await this.adapter.readCache(); } catch { /* 临时目录被清除时重建。 */ }
            if (cache?.version === CACHE_VERSION && cache.days && typeof cache.days === 'object') {
                for (const [date, day] of Object.entries(cache.days) as [string, CachedDay][]) {
                    if (DATE_FILE.test(`${date}.json`) && Number.isFinite(day?.updated)
                        && Number.isFinite(day?.verifiedAt) && validSummary(day.summary, date)) {
                        this.replace(date, day.summary, day.updated, day.verifiedAt);
                    }
                }
            }
            await this.reconcileFiles(false);
            await this.flushCache();
            this.initialized = true;
        }).finally(() => { this.initializing = undefined; });
        return this.initializing;
    }

    private replace(date: string, summary?: PomodoroDaySummary, updated = 0, verifiedAt = Date.now()) {
        const old = this.summaries[date];
        for (const [id, value] of Object.entries(old?.events || {})) {
            const total = this.eventTotals[id];
            if (!total) continue;
            total.count -= value.count;
            total.duration -= value.duration;
            if (total.count === 0 && total.duration === 0) delete this.eventTotals[id];
        }
        for (const id of old?.sessionIds || []) if (this.sessionDates.get(id) === date) this.sessionDates.delete(id);
        if (!summary) {
            delete this.summaries[date]; delete this.days[date]; delete this.records[date];
            this.loaded.delete(date);
            this.committed.delete(date);
            return;
        }
        this.summaries[date] = summary;
        this.days[date] = { summary, updated, verifiedAt };
        for (const [id, value] of Object.entries(summary.events)) {
            const total = this.eventTotals[id] ||= { count: 0, duration: 0 };
            total.count += value.count; total.duration += value.duration;
        }
        for (const id of summary.sessionIds) this.sessionDates.set(id, date);
        // 占位只保留每日总量；读取明细必须经 ensureDates，不能据此写入。
        if (!this.loaded.has(date)) this.records[date] = {
            date, workSessions: summary.workSessions, totalWorkTime: summary.totalWorkTime,
            totalBreakTime: summary.totalBreakTime, sessions: [],
        };
    }

    private async readDate(date: string, updated: number): Promise<void> {
        const record = normalizeRecord(date, await this.adapter.read(date));
        const summary = summarizePomodoroDay(date, record, this.count);
        this.records[date] = record;
        this.committed.set(date, JSON.parse(JSON.stringify(record)));
        this.loaded.add(date);
        this.replace(date, summary, updated);
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
        const days = Object.fromEntries(Object.entries(this.days).filter(([date]) => selected.has(date.slice(0, 7))));
        const manifest = [...new Set(Object.keys(this.days).map(date => date.slice(0, 7)))].sort();
        this.cacheTail = this.cacheTail.then(() => this.adapter.writeCache({ version: CACHE_VERSION, days, months: manifest }, months))
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
            const day = this.summaries[date];
            if (day) this.records[date] = { date, workSessions: day.workSessions, totalWorkTime: day.totalWorkTime,
                totalBreakTime: day.totalBreakTime, sessions: [] };
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
                this.replace(date, summarizePomodoroDay(date, record, this.count));
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
                const summary = this.summaries[date];
                this.records[date] = { date, workSessions: summary.workSessions, totalWorkTime: summary.totalWorkTime,
                    totalBreakTime: summary.totalBreakTime, sessions: [] };
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

    private publish(result: PomodoroCommitResult): void {
        for (const [date, record] of Object.entries(result)) {
            if (!record) { this.replace(date); continue; }
            this.records[date] = record;
            this.loaded.add(date);
            this.committed.set(date, JSON.parse(JSON.stringify(record)));
            this.replace(date, summarizePomodoroDay(date, record, this.count), 0);
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
