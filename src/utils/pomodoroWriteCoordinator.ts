import type { PomodoroRecord, PomodoroSession } from '../components/dataManager/pomodoroRecord';
import { attachPomodoroStorageMetadata } from './pomodoroDates';

export interface PomodoroChange {
    date: string;
    base: PomodoroRecord | null;
    next: PomodoroRecord | null;
}
export interface PomodoroCommit {
    changes: PomodoroChange[];
    mode?: 'merge' | 'replace';
    expectedDates?: string[];
}
export interface PomodoroCommitStorage {
    read(date: string): Promise<PomodoroRecord | null>;
    write(date: string, record: PomodoroRecord): Promise<void>;
    remove(date: string): Promise<void>;
    listDates?(): Promise<string[]>;
    locateSession?(id: string): Promise<string | undefined>;
}
export type PomodoroCommitResult = Record<string, PomodoroRecord | null>;

function canonical(value: any): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function sessionContent(session?: PomodoroSession): string {
    if (!session) return canonical(session);
    const { revision: _revision, updatedAt: _updatedAt, storageDate: _storageDate, timezoneOffsetMinutes: _offset, ...content } = session;
    for (const key of ['startTime', 'endTime'] as const) {
        const time = new Date(content[key]);
        if (Number.isFinite(time.getTime())) content[key] = time.toISOString();
    }
    return canonical(content);
}

export function getPomodoroDeleteMarker(record: PomodoroRecord, id: string) {
    if (!Object.prototype.hasOwnProperty.call(record.tombstones || {}, id)) return undefined;
    const marker = record.tombstones[id];
    if (!marker || !Number.isSafeInteger(marker.revision) || marker.revision <= 0 || !Number.isFinite(Date.parse(marker.updatedAt))) throw new Error('番茄钟删除标记格式无效');
    return marker;
}

export function calculatePomodoroSessionCount(session: PomodoroSession): number {
    if (session.inProgress) return 0;
    if (session.isCountUp && typeof session.count === 'number') return session.count;
    return typeof session.count === 'number' ? Math.max(1, session.count) : 1;
}

function sessionTotals(sessions: PomodoroSession[]) {
    const totals = { workSessions: 0, totalWorkTime: 0, totalBreakTime: 0 };
    for (const session of sessions) {
        if (session.inProgress) continue;
        const duration = Math.max(0, Math.round(Number(session.duration) || 0));
        if (session.type === 'work') { totals.workSessions += calculatePomodoroSessionCount(session); totals.totalWorkTime += duration; }
        else totals.totalBreakTime += duration;
    }
    return totals;
}

function validateRecord(record: PomodoroRecord | null) {
    if (record === null) return;
    if (!record || typeof record !== 'object' || (record.sessions != null && !Array.isArray(record.sessions))) throw new Error('番茄钟记录格式无效');
    if ((record.schemaVersion || 0) > 2) throw new Error('番茄钟数据版本较新，请升级插件后编辑');
    if (record.tombstones && (typeof record.tombstones !== 'object' || Array.isArray(record.tombstones))) throw new Error('番茄钟删除标记格式无效');
    for (const marker of Object.values(record.tombstones || {})) {
        if (!marker || !Number.isSafeInteger(marker.revision) || marker.revision <= 0 || !Number.isFinite(Date.parse(marker.updatedAt))) throw new Error('番茄钟删除标记格式无效');
    }
    const ids = new Set<string>();
    for (const session of record.sessions || []) {
        if (!session || typeof session.id !== 'string' || !session.id || ids.has(session.id)) throw new Error('番茄钟会话 ID 无效或重复');
        if (session.revision !== undefined && (!Number.isSafeInteger(session.revision) || session.revision < 0)) throw new Error('番茄钟会话版本无效');
        ids.add(session.id);
    }
}

/** 不同会话可合并；同一会话被另一端修改/删除时拒绝覆盖。 */
function mergeDay(change: PomodoroChange, current: PomodoroRecord | null): PomodoroRecord {
    const baseSessions = change.base?.sessions || [];
    const nextSessions = change.next?.sessions || [];
    const currentSessions = current?.sessions || [];
    const base = new Map(baseSessions.map(session => [session.id, session]));
    const next = new Map(nextSessions.map(session => [session.id, session]));
    const merged = new Map(currentSessions.map(session => [session.id, session]));
    const tombstones = Object.assign(Object.create(null), current?.tombstones || {});
    let changed = false;
    for (const id of new Set([...base.keys(), ...next.keys()])) {
        const before = base.get(id), after = next.get(id), latest = merged.get(id);
        if (sessionContent(before) === sessionContent(after)) continue;
        if (after && tombstones[id]) throw new Error(`番茄钟记录已删除，拒绝恢复旧快照 (${id})`);
        if (sessionContent(latest) === sessionContent(after)) continue; // 请求重放不重复累计。
        if (sessionContent(latest) !== sessionContent(before) || (latest?.revision || 0) !== (before?.revision || 0)) {
            throw new Error(`番茄钟记录已被其他窗口修改，请刷新后重试 (${id})`);
        }
        const revision = (latest?.revision || before?.revision || 0) + 1;
        const updatedAt = new Date().toISOString();
        if (after) merged.set(id, { ...attachPomodoroStorageMetadata(after, change.date), revision, updatedAt });
        else { merged.delete(id); tombstones[id] = { revision, updatedAt }; }
        changed = true;
    }
    const dailyTotals = (value: PomodoroRecord | null) => value && [value.workSessions, value.totalWorkTime, value.totalBreakTime];
    if (!changed && current && canonical(dailyTotals(change.base)) === canonical(dailyTotals(change.next))) return current;
    const sessions = [...merged.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const totals = sessionTotals(sessions);
    const currentTotals = sessionTotals(currentSessions), beforeTotals = sessionTotals(baseSessions), afterTotals = sessionTotals(nextSessions);
    // 保留早期仅有每日总量、没有会话明细的余额，以及旧接口的特殊计数口径。
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
        const residual = (value: PomodoroRecord | null, calculated: typeof totals) => (value?.[key] ?? calculated[key]) - calculated[key];
        const currentResidual = residual(current, currentTotals), nextResidual = residual(change.next, afterTotals);
        if (!change.base && current && currentResidual === nextResidual) totals[key] += currentResidual;
        else {
            if (!change.base && currentResidual && nextResidual) throw new Error('番茄钟旧版总量发生冲突，请刷新后重试');
            totals[key] += currentResidual + nextResidual - residual(change.base, beforeTotals);
        }
    }
    return { ...current, ...change.next, schemaVersion: 2, date: change.date, sessions, tombstones, ...totals };
}

/** 同一工作空间的前端和 MCP 均调用这个内核实例，锁覆盖读取、合并、落盘和失败恢复。 */
export class PomodoroWriteCoordinator {
    private tail: Promise<unknown> = Promise.resolve();
    private disposed = false;
    private readonly locations = new Map<string, { date: string; deleted: boolean }>();

    constructor(private readonly storage: PomodoroCommitStorage) {}

    commit(input: PomodoroCommit): Promise<PomodoroCommitResult> {
        // 入队时固定参数，防止调用方继续修改传入对象。
        const request = JSON.parse(JSON.stringify(input)) as PomodoroCommit;
        const pending = this.tail.then(() => this.commitNow(request));
        this.tail = pending.catch(() => {});
        return pending;
    }

    async close(): Promise<void> { this.disposed = true; await this.tail; }

    private async commitNow(input: PomodoroCommit): Promise<PomodoroCommitResult> {
        if (this.disposed) throw new Error('番茄钟写入服务已关闭');
        if (!Array.isArray(input.changes) || !['merge', 'replace', undefined].includes(input.mode)) throw new Error('番茄钟提交格式无效');
        const dates = new Set<string>();
        const originals: PomodoroCommitResult = Object.create(null);
        const results: PomodoroCommitResult = Object.create(null);
        if (input.mode === 'replace' && input.expectedDates) {
            if (!this.storage.listDates) throw new Error('番茄钟写入服务不支持目录校验');
            const actual = (await this.storage.listDates()).sort();
            if (canonical(actual) !== canonical([...input.expectedDates].sort())) throw new Error('番茄钟历史日期已变化，请重新加载后重试');
        }
        for (const change of input.changes) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date) || dates.has(change.date)) throw new Error('番茄钟提交日期无效或重复');
            dates.add(change.date);
            validateRecord(change.base); validateRecord(change.next);
            const current = await this.storage.read(change.date);
            validateRecord(current);
            if (current) {
                current.date = change.date;
                current.sessions = (current.sessions || []).filter(session => !getPomodoroDeleteMarker(current, session.id));
            }
            originals[change.date] = current;
            if (input.mode === 'replace' || change.next === null) {
                if (canonical(current) !== canonical(change.base)) throw new Error(`番茄钟日期记录已变化，请重新加载后重试 (${change.date})`);
                const next = change.next || { date: change.date, sessions: [], workSessions: 0, totalWorkTime: 0, totalBreakTime: 0 };
                results[change.date] = mergeDay({ ...change, next }, current);
            } else results[change.date] = mergeDay(change, current);
        }
        // 旧文件可能使用旧逻辑日命名；依靠会话定位索引检查另一分片中的删除标记。
        for (const change of input.changes) {
            const existing = new Set((change.base?.sessions || []).map(session => session.id));
            for (const session of change.next?.sessions || []) {
                if (existing.has(session.id)) continue;
                const known = this.locations.get(session.id);
                if (known?.deleted) throw new Error(`番茄钟记录已删除，拒绝恢复旧快照 (${session.id})`);
                const originDate = known?.date || await this.storage.locateSession?.(session.id);
                if (!originDate || originDate === change.date) continue;
                const origin = originals[originDate] || await this.storage.read(originDate);
                if (!origin) continue;
                validateRecord(origin);
                if (getPomodoroDeleteMarker(origin, session.id)) throw new Error(`番茄钟记录已删除，拒绝恢复旧快照 (${session.id})`);
                const removedHere = input.changes.some(item => item.date === originDate
                    && item.base?.sessions.some(value => value.id === session.id)
                    && !item.next?.sessions.some(value => value.id === session.id));
                if (!removedHere && origin.sessions?.some(value => value.id === session.id)) throw new Error(`番茄钟会话已存在于其他日期 (${session.id})`);
            }
        }
        // 源日已被另一事务移走时，不能把同一会话再添加到另一个目标日。
        const beforeDates = new Map<string, string>();
        const afterDates = new Map<string, { date: string; session: PomodoroSession }>();
        for (const change of input.changes) {
            for (const session of change.base?.sessions || []) beforeDates.set(session.id, change.date);
            for (const session of change.next?.sessions || []) afterDates.set(session.id, { date: change.date, session });
        }
        for (const [id, source] of beforeDates) {
            const target = afterDates.get(id);
            if (!target || source === target.date) continue;
            const sourceSession = originals[source]?.sessions.find(session => session.id === id);
            const targetSession = originals[target.date]?.sessions.find(session => session.id === id);
            if (!sourceSession && canonical(targetSession) !== canonical(target.session)) throw new Error(`番茄钟记录已被移动，请刷新后重试 (${id})`);
        }
        const attempted: string[] = [];
        try {
            // 先写所有目标日期，再删除废弃日期。任何源记录都不会在目标落盘前被删除。
            for (const deleting of [false, true]) for (const [date, record] of Object.entries(results)) {
                if ((record === null) !== deleting || canonical(record) === canonical(originals[date])) continue;
                attempted.push(date); // 请求失败也可能已落盘，恢复时必须包含失败的请求。
                if (record) await this.storage.write(date, record); else await this.storage.remove(date);
            }
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            for (const date of attempted.reverse()) {
                try {
                    const current = await this.storage.read(date);
                    if (current) { current.date = date; current.sessions = (current.sessions || []).filter(session => !getPomodoroDeleteMarker(current, session.id)); }
                    if (canonical(current) === canonical(originals[date])) continue;
                    // 文件系统同步或外部写入未经过本队列，不能用旧快照覆盖它。
                    if (canonical(current) !== canonical(results[date])) throw new Error(`恢复时检测到外部修改 (${date})`);
                    if (originals[date]) await this.storage.write(date, originals[date]);
                    else await this.storage.remove(date);
                } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            }
            if (rollbackErrors.length) throw Object.assign(new Error('番茄钟保存及恢复失败，请重新加载记录后重试'), { errors: [error, ...rollbackErrors] });
            throw error;
        }
        for (const [date, record] of Object.entries(results)) {
            for (const session of record?.sessions || []) this.locations.set(session.id, { date, deleted: false });
            for (const id of Object.keys(record?.tombstones || {})) this.locations.set(id, { date, deleted: true });
        }
        return results;
    }
}
