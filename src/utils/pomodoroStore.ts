import type { PomodoroRecord, PomodoroSession } from '../components/dataManager/pomodoroRecord';

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
    write(date: string, record: PomodoroRecord): Promise<void>;
    remove(date: string): Promise<void>;
    readLegacy?(): Promise<Record<string, PomodoroRecord> | null>;
    readCache(): Promise<any>;
    writeCache(cache: any): Promise<void>;
}

interface CachedDay { updated: number; verifiedAt: number; summary: PomodoroDaySummary; }
const CACHE_VERSION = 3;
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

    private async persist() {
        try { await this.adapter.writeCache({ version: CACHE_VERSION, days: this.days }); }
        catch (error) { console.warn('Failed to persist rebuildable pomodoro statistics cache:', error); }
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
        if (changed.length || deleted.length) await this.persist();
    }

    async refresh(dates?: string[], verifyAll = false): Promise<void> {
        await this.initialize();
        await this.serial(async () => {
            if (!dates) return this.reconcileFiles(verifyAll);
            const entries = await this.adapter.list();
            const byDate = new Map(entries.filter(e => !e.isDir && DATE_FILE.test(e.name)).map(e => [e.name.slice(0, -5), e]));
            await mapPomodoroFiles([...new Set(dates)], async date => {
                if (!DATE_FILE.test(`${date}.json`)) return;
                const entry = byDate.get(date);
                if (entry) await this.readDate(date, entry.updated);
                else this.replace(date);
            });
            await this.persist();
        });
    }

    async ensureDates(dates: string[]): Promise<void> {
        await this.initialize();
        await this.serial(() => mapPomodoroFiles([...new Set(dates)].filter(date => this.days[date] && !this.loaded.has(date)),
            date => this.readDate(date, this.days[date].updated)));
    }

    dateForSession(id: string): string | undefined { return this.sessionDates.get(id); }

    async saveMany(records: [string, PomodoroRecord][]): Promise<void> {
        await this.serial(async () => {
            // 旧版单文件首次落盘时迁移完整历史，不能只生成一个日期文件后遮蔽其他旧日期。
            if (this.legacyMode) {
                const requested = new Set(records.map(([date]) => date));
                records = [...records, ...Object.entries(this.records).filter(([date]) => !requested.has(date))];
            }
            const snapshots = records.map(([date, record]): [string, PomodoroRecord] => {
                if (this.days[date] && !this.loaded.has(date)) throw new Error(`番茄钟明细尚未加载，禁止覆盖: ${date}`);
                return [date, JSON.parse(JSON.stringify(record))];
            });
            const written: string[] = [];
            try {
                for (const [date, snapshot] of snapshots) {
                    await this.adapter.write(date, snapshot);
                    written.push(date);
                }
            } catch (error) {
                // 跨天移动先保存目标日。后续写入失败时尽力恢复已经写入的日期，避免丢失原记录。
                const rollbackErrors: unknown[] = [];
                for (const date of written.reverse()) {
                    try {
                        const original = this.committed.get(date);
                        if (original) await this.adapter.write(date, original);
                        else await this.adapter.remove(date);
                    } catch (rollbackError) { rollbackErrors.push(rollbackError); }
                }
                for (const [date] of records) {
                    const original = this.committed.get(date);
                    if (original) this.records[date] = JSON.parse(JSON.stringify(original));
                    else delete this.records[date];
                }
                if (rollbackErrors.length) throw Object.assign(new Error('番茄钟保存及恢复失败，请重新加载记录后重试'), { errors: [error, ...rollbackErrors] });
                throw error;
            }
            for (const [date, snapshot] of snapshots) {
                this.records[date] = snapshot; this.loaded.add(date);
                this.committed.set(date, JSON.parse(JSON.stringify(snapshot)));
                // 未知时间戳会在下次校验时重新读取，避免同秒修改漏检。
                this.replace(date, summarizePomodoroDay(date, snapshot, this.count), 0);
            }
            this.legacyMode = false;
            await this.persist();
        });
    }

    async remove(date: string): Promise<void> {
        await this.serial(async () => { await this.adapter.remove(date); this.replace(date); await this.persist(); });
    }
}
