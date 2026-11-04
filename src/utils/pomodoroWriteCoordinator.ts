import type { PomodoroRecord, PomodoroSession } from '../components/dataManager/pomodoroRecord';

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
}
export type PomodoroCommitResult = Record<string, PomodoroRecord | null>;

function canonical(value: any): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
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
    const ids = new Set<string>();
    for (const session of record.sessions || []) {
        if (!session || typeof session.id !== 'string' || !session.id || ids.has(session.id)) throw new Error('番茄钟会话 ID 无效或重复');
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
    let changed = false;
    for (const id of new Set([...base.keys(), ...next.keys()])) {
        const before = base.get(id), after = next.get(id), latest = merged.get(id);
        if (canonical(before) === canonical(after)) continue;
        if (canonical(latest) === canonical(after)) continue; // 已经提交过的变更不重复累计。
        if (canonical(latest) !== canonical(before)) throw new Error(`番茄钟记录已被其他窗口修改，请刷新后重试 (${id})`);
        if (after) merged.set(id, after); else merged.delete(id);
        changed = true;
    }
    if (!changed && current) return current;
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
    return { ...current, ...change.next, date: change.date, sessions, ...totals };
}

/** 同一工作空间的前端和 MCP 均调用这个内核实例，锁覆盖读取、合并、落盘和失败恢复。 */
export class PomodoroWriteCoordinator {
    private tail: Promise<unknown> = Promise.resolve();
    private disposed = false;

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
            if (current) { current.date = change.date; current.sessions ||= []; }
            originals[change.date] = current;
            if (input.mode === 'replace' || change.next === null) {
                if (canonical(current) !== canonical(change.base)) throw new Error(`番茄钟日期记录已变化，请重新加载后重试 (${change.date})`);
                results[change.date] = change.next;
            } else results[change.date] = mergeDay(change, current);
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
                    if (current) { current.date = date; current.sessions ||= []; }
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
        return results;
    }
}
