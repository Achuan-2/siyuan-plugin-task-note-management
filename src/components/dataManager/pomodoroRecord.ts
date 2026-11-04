import { getLogicalDateString } from "../../utils/dateUtils";
import { ReminderPomodoroStatsSnapshot, type EventPomodoroTotals } from '../../utils/reminderPomodoroStats';
import { PomodoroStore, summarizePomodoroDay, type PomodoroDaySummary, type PomodoroEventTotals } from '../../utils/pomodoroStore';
import { calculatePomodoroSessionCount } from '../../utils/pomodoroWriteCoordinator';

// 单个番茄钟会话记录
export interface PomodoroSession {
    id: string; // 会话唯一ID
    type: 'work' | 'shortBreak' | 'longBreak'; // 会话类型
    eventId: string; // 关联的事件ID
    eventTitle: string; // 事件标题
    startTime: string; // 开始时间 ISO 字符串
    endTime: string; // 结束时间 ISO 字符串
    duration: number; // 实际持续时间（分钟）
    plannedDuration: number; // 计划持续时间（分钟）
    completed: boolean; // 是否完成（未中途停止）
    isCountUp?: boolean; // 是否为正计时模式
    count?: number; // 完成的番茄钟数量（正计时模式下根据时长计算）
    inProgress?: boolean; // 是否为开始计时时预创建、等待结束或补录的记录
    note?: string; // 备注
}

export interface PomodoroRecord {
    date: string; // YYYY-MM-DD
    workSessions: number; // 完成的工作番茄数
    totalWorkTime: number; // 总工作时间（分钟）
    totalBreakTime: number; // 总休息时间（分钟）
    sessions: PomodoroSession[]; // 详细的会话记录
}

export interface PomodoroStats {
    pomodoroCount: number;
    focusTime: number;
    todayPomodoroCount: number;
    todayFocusTime: number;
    totalRepeatingPomodoroCount: number;
    totalRepeatingFocusTime: number;
}

type SessionTimeInput = string | number | Date;

interface RecordSessionOptions {
    startTime?: SessionTimeInput;
    endTime?: SessionTimeInput;
    sessionId?: string;
    note?: string;
}

export class PomodoroRecordManager {
    private static instance: PomodoroRecordManager;
    private records: { [date: string]: PomodoroRecord } = {};
    private eventStats: { [eventId: string]: { count: number, duration: number } } = {};
    private isLoading: boolean = false;
    private isSaving: boolean = false;
    private isInitialized: boolean = false;
    private plugin: any;
    private store?: PomodoroStore;
    private initializing?: Promise<void>;
    private operationTail: Promise<unknown> = Promise.resolve();

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    static getInstance(plugin?: any): PomodoroRecordManager {
        if (!PomodoroRecordManager.instance) {
            PomodoroRecordManager.instance = new PomodoroRecordManager(plugin);
        } else if (plugin && !PomodoroRecordManager.instance.plugin) {
            PomodoroRecordManager.instance.plugin = plugin;
        }
        return PomodoroRecordManager.instance;
    }

    async initialize() {
        if (this.isInitialized) return;
        if (this.initializing) return this.initializing;
        this.initializing = (async () => {
            if (this.plugin?.createPomodoroStoreAdapter) {
                this.store ||= new PomodoroStore(this.plugin.createPomodoroStoreAdapter(), s => this.calculateSessionCount(s));
                await this.store.initialize();
                this.records = this.store.records;
                this.eventStats = this.store.eventTotals;
            } else {
                await this.loadRecords(true);
            }
            this.isInitialized = true;
        })().finally(() => { this.initializing = undefined; });
        return this.initializing;
    }

    /** 所有业务写入和外部刷新共用队列，刷新不会穿过尚未落盘的编辑。 */
    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const pending = this.operationTail.then(async () => {
            await this.initialize();
            const release = this.retainDetails();
            try { return await operation(); } finally { release(); }
        });
        this.operationTail = pending.catch(() => {});
        return pending;
    }

    async ensureDatesLoaded(dates: string[]): Promise<void> {
        await this.initialize();
        await this.store?.ensureDates(dates);
    }

    async ensureRangeLoaded(startDate: string, endDate: string): Promise<void> {
        await this.initialize();
        await this.ensureDatesLoaded(Object.keys(this.records).filter(date => date >= startDate && date <= endDate));
    }

    async ensureAllRecordsLoaded(): Promise<void> {
        await this.initialize();
        await this.ensureDatesLoaded(Object.keys(this.records));
    }

    retainDetails(): () => void { return this.store?.retainDetails() || (() => {}); }
    releaseDetails(): void { this.store?.trimDetails(); }
    async flushCache(): Promise<void> { await this.store?.flushCache(); }
    async closeStorage(): Promise<void> { await this.store?.close(); }

    getDailySummaries(): Record<string, PomodoroDaySummary> {
        if (this.store) return this.store.summaries;
        return Object.fromEntries(Object.entries(this.records).map(([date, record]) =>
            [date, summarizePomodoroDay(date, record, s => this.calculateSessionCount(s))]));
    }

    getDaySummary(date: string): PomodoroDaySummary | undefined {
        if (this.store) return this.store.summaries[date];
        const record = this.records[date];
        return record ? summarizePomodoroDay(date, record, s => this.calculateSessionCount(s)) : undefined;
    }

    getEventStats(): Readonly<Record<string, PomodoroEventTotals>> { return this.eventStats; }

    async getSessionsMatchingEvent(matches: (eventId: string) => boolean): Promise<PomodoroSession[]> {
        await this.initialize();
        const dates = Object.entries(this.getDailySummaries()).filter(([, day]) => day.eventIds.some(matches)).map(([date]) => date);
        await this.ensureDatesLoaded(dates);
        const sessions = dates.flatMap(date => this.getDateSessions(date).filter(session => matches(session.eventId)));
        this.releaseDetails();
        return sessions;
    }

    private async loadSessionDate(id: string): Promise<void> {
        const date = this.store?.dateForSession(id);
        if (date) await this.ensureDatesLoaded([date]);
    }

    async recordWorkSession(...args: Parameters<PomodoroRecordManager['recordWorkSessionImpl']>) {
        return this.serialize(() => this.recordWorkSessionImpl(...args));
    }

    async recordBreakSession(...args: Parameters<PomodoroRecordManager['recordBreakSessionImpl']>) {
        return this.serialize(() => this.recordBreakSessionImpl(...args));
    }

    async startWorkSession(...args: Parameters<PomodoroRecordManager['startWorkSessionImpl']>) {
        return this.serialize(() => this.startWorkSessionImpl(...args));
    }

    async finishWorkSession(...args: Parameters<PomodoroRecordManager['finishWorkSessionImpl']>) {
        return this.serialize(() => this.finishWorkSessionImpl(...args));
    }

    async updateSession(...args: Parameters<PomodoroRecordManager['updateSessionImpl']>) {
        return this.serialize(() => this.updateSessionImpl(...args));
    }

    async updateSessionNote(...args: Parameters<PomodoroRecordManager['updateSessionNoteImpl']>) {
        return this.serialize(() => this.updateSessionNoteImpl(...args));
    }

    async deleteSession(...args: Parameters<PomodoroRecordManager['deleteSessionImpl']>) {
        return this.serialize(() => this.deleteSessionImpl(...args));
    }

    async regenerateRecordsByDate(...args: Parameters<PomodoroRecordManager['regenerateRecordsByDateImpl']>) {
        return this.serialize(() => this.regenerateRecordsByDateImpl(...args));
    }

    async createFocus(...args: Parameters<PomodoroRecordManager['createFocusImpl']>) {
        return this.serialize(() => this.createFocusImpl(...args));
    }

    async refreshData(...args: Parameters<PomodoroRecordManager['refreshDataImpl']>) {
        return this.serialize(() => this.refreshDataImpl(...args));
    }

    private generateSessionId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private normalizeSessionDate(input?: SessionTimeInput): Date | null {
        if (input === undefined || input === null) return null;

        const date = input instanceof Date ? new Date(input.getTime()) : new Date(input);
        if (Number.isNaN(date.getTime())) {
            return null;
        }
        return date;
    }

    private roundSessionMinutes(minutes: number): number {
        let roundedMinutes = Math.round(Number(minutes) || 0);
        if (roundedMinutes === 0 && minutes > 0) {
            roundedMinutes = 1;
        }
        return Math.max(0, roundedMinutes);
    }

    private normalizeSessionNote(note: any): string {
        return typeof note === 'string' ? note.trim() : '';
    }

    private calculateWorkSessionCount(workMinutes: number, plannedDuration: number, completed: boolean, isCountUp: boolean): number {
        const calculated = Math.round(workMinutes / Math.max(1, plannedDuration));

        if (workMinutes <= 0) {
            return 0;
        }

        if (isCountUp) {
            // 正计时模式：按时长计算数量，至少为1
            return Math.max(1, calculated);
        }

        if (completed) {
            // 倒计时完成：按时长计算（通常为1，但如果是自定义长番茄可能更多）
            return Math.max(1, calculated);
        }

        // 倒计时中断：认为是一个番茄
        return 1;
    }

    private recalculateRecordTotals(date: string) {
        const record = this.records[date];
        if (!record) return;

        if (!record.sessions) {
            record.sessions = [];
        }

        record.date = date;
        record.workSessions = 0;
        record.totalWorkTime = 0;
        record.totalBreakTime = 0;

        record.sessions.forEach(session => {
            if (session.inProgress) return;

            if (session.type === 'work') {
                record.workSessions += this.calculateSessionCount(session);
                record.totalWorkTime += Math.max(0, Math.round(Number(session.duration) || 0));
            } else {
                record.totalBreakTime += Math.max(0, Math.round(Number(session.duration) || 0));
            }
        });
    }

    private findSessionLocation(sessionId: string): { date: string; index: number; session: PomodoroSession } | null {
        const dateForSession = this.store?.dateForSession(sessionId);
        const dates = this.store ? (dateForSession ? [dateForSession] : []) : Object.keys(this.records);
        for (const date of dates) {
            const record = this.records[date];
            if (!record || !record.sessions) continue;

            const index = record.sessions.findIndex(session => session.id === sessionId);
            if (index !== -1) {
                return {
                    date,
                    index,
                    session: record.sessions[index]
                };
            }
        }
        return null;
    }

    private async loadRecords(force: boolean = false) {
        if (this.store) {
            await this.store.refresh(undefined, force);
            return;
        }
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const content = await this.plugin.loadPomodoroRecords(force);
            // 检查返回的内容是否是有效的记录数据
            if (content) {
                this.records = content;
            } else {
                // 如果返回的是错误对象或包含错误信息，则初始化为空记录
                console.log("Pomodoro record file is missing or malformed; initializing empty records");
                this.records = {};
                await this.saveRecords();
            }

            // 确保每个日期记录都有 sessions 数组，并构建索引
            this.buildStatsIndex();
        } catch (error) {
            console.log("Pomodoro record file is missing; initializing empty records");
            this.records = {};
            this.eventStats = {};
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 构建事件统计索引，用于快速查询
     */
    private buildStatsIndex() {
        if (this.store) return; // 保存时由 store 按日期替换统计贡献。
        this.eventStats = {};
        Object.keys(this.records).forEach(date => {
            const record = this.records[date];
            if (!record.sessions) {
                record.sessions = [];
            }
            record.sessions.forEach(session => {
                if (!session.inProgress && session.type === 'work' && session.eventId) {
                    this.updateStatsIndex(session.eventId, this.calculateSessionCount(session), session.duration);
                }
            });
        });
    }

    /**
     * 刷新事件统计索引（公共方法）
     */
    public refreshIndex() {
        this.buildStatsIndex();
    }

    /**
     * 更新索引中的单个统计信息
     */
    private updateStatsIndex(eventId: string, count: number, duration: number) {
        if (this.store) return;
        if (!this.eventStats[eventId]) {
            this.eventStats[eventId] = { count: 0, duration: 0 };
        }
        this.eventStats[eventId].count += count;
        this.eventStats[eventId].duration += duration;
    }

    private async saveRecords(dates?: string[]) {
        const requestedDates = dates?.length ? [...new Set(dates)] : Object.keys(this.records);
        this.isSaving = true;
        try {
            if (this.store) {
                await this.store.saveMany(requestedDates.filter(date => this.records[date]).map(date => [date, this.records[date]]));
            } else {
                for (const date of requestedDates) {
                    const record = this.records[date];
                    if (!record) continue;
                    await this.plugin.saveData(`pomodoroRecords/${date}.json`, record);
                    if (this.plugin.pomodoroRecordsCache) this.plugin.pomodoroRecordsCache[date] = record;
                }
            }
        } finally {
            this.isSaving = false;
        }
    }

    private getToday(): string {
        return getLogicalDateString();
    }

    private ensureTodayRecord(today: string) {
        if (!this.records[today]) {
            this.records[today] = {
                date: today,
                workSessions: 0,
                totalWorkTime: 0,
                totalBreakTime: 0,
                sessions: []
            };
        }
        // 确保 sessions 数组存在
        if (!this.records[today].sessions) {
            this.records[today].sessions = [];
        }
    }

    private async recordWorkSessionImpl(
        workMinutes: number,
        eventId: string = '',
        eventTitle: string = '番茄专注',
        plannedDuration: number = 25,
        completed: boolean = true,
        isCountUp: boolean = false,
        options: RecordSessionOptions = {}
    ) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const roundedWorkMinutes = this.roundSessionMinutes(workMinutes);
        const endTime = this.normalizeSessionDate(options.endTime) || new Date();
        const startTime = this.normalizeSessionDate(options.startTime) || new Date(endTime.getTime() - roundedWorkMinutes * 60000);
        const logicalDate = getLogicalDateString(startTime);
        await this.ensureDatesLoaded([logicalDate]);
        this.ensureTodayRecord(logicalDate);

        // console.log('Before recording work session:', JSON.stringify(this.records[today]));

        const count = this.calculateWorkSessionCount(roundedWorkMinutes, plannedDuration, completed, isCountUp);

        // 创建详细的会话记录
        const session: PomodoroSession = {
            id: options.sessionId || this.generateSessionId(),
            type: 'work',
            eventId,
            eventTitle,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: roundedWorkMinutes,
            plannedDuration,
            completed,
            isCountUp: isCountUp || false,
            count,
            note: this.normalizeSessionNote(options.note)
        };

        // 添加到会话记录
        this.records[logicalDate].sessions.push(session);

        // 更新统计数据
        this.records[logicalDate].workSessions += count;

        this.records[logicalDate].totalWorkTime += roundedWorkMinutes;

        // 更新索引，使用取整后的分钟数
        this.updateStatsIndex(eventId, count, roundedWorkMinutes);

        // console.log('After recording work session:', JSON.stringify(this.records[today]));

        await this.saveRecords([logicalDate]);
        return session;
    }

    private async recordBreakSessionImpl(
        breakMinutes: number,
        eventId: string = '',
        _eventTitle: string = '休息时间',
        plannedDuration: number = 5,
        isLongBreak: boolean = false,
        completed: boolean = true,
        options: RecordSessionOptions = {}
    ) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        // 将休息时长取整为分钟，避免保存小数分钟
        const roundedBreakMinutes = this.roundSessionMinutes(breakMinutes);
        const endTime = this.normalizeSessionDate(options.endTime) || new Date();
        const startTime = this.normalizeSessionDate(options.startTime) || new Date(endTime.getTime() - roundedBreakMinutes * 60000);
        const logicalDate = getLogicalDateString(startTime);
        await this.ensureDatesLoaded([logicalDate]);
        this.ensureTodayRecord(logicalDate);

        // console.log('Before recording break session:', JSON.stringify(this.records[today]));

        // 创建详细的会话记录
        const session: PomodoroSession = {
            id: options.sessionId || this.generateSessionId(),
            type: isLongBreak ? 'longBreak' : 'shortBreak',
            eventId,
            eventTitle: isLongBreak ? '长时休息' : '短时休息',
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: roundedBreakMinutes,
            plannedDuration,
            completed,
            note: this.normalizeSessionNote(options.note)
        };

        // 添加到会话记录
        this.records[logicalDate].sessions.push(session);

        // 更新统计数据
        this.records[logicalDate].totalBreakTime += roundedBreakMinutes;

        // console.log('After recording break session:', JSON.stringify(this.records[today]));

        await this.saveRecords([logicalDate]);
    }

    private async startWorkSessionImpl(
        eventId: string = '',
        eventTitle: string = '番茄专注',
        plannedDuration: number = 25,
        isCountUp: boolean = false,
        startTimeInput?: SessionTimeInput
    ): Promise<string> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const startTime = this.normalizeSessionDate(startTimeInput) || new Date();
        const logicalDate = getLogicalDateString(startTime);
        await this.ensureDatesLoaded([logicalDate]);
        this.ensureTodayRecord(logicalDate);

        const session: PomodoroSession = {
            id: this.generateSessionId(),
            type: 'work',
            eventId,
            eventTitle,
            startTime: startTime.toISOString(),
            endTime: startTime.toISOString(),
            duration: 0,
            plannedDuration,
            completed: false,
            isCountUp: isCountUp || false,
            count: 0,
            inProgress: true,
            note: ''
        };

        this.records[logicalDate].sessions.push(session);
        await this.saveRecords([logicalDate]);
        return session.id;
    }

    private async finishWorkSessionImpl(
        sessionId: string,
        workMinutes: number,
        eventId: string = '',
        eventTitle: string = '番茄专注',
        plannedDuration: number = 25,
        completed: boolean = true,
        isCountUp: boolean = false,
        options: RecordSessionOptions = {}
    ): Promise<PomodoroSession | null> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        await this.loadSessionDate(sessionId);
        const location = sessionId ? this.findSessionLocation(sessionId) : null;
        if (!location) {
            return await this.recordWorkSessionImpl(workMinutes, eventId, eventTitle, plannedDuration, completed, isCountUp, options);
        }

        const roundedWorkMinutes = this.roundSessionMinutes(workMinutes);
        const startTime = this.normalizeSessionDate(options.startTime)
            || this.normalizeSessionDate(location.session.startTime)
            || new Date();
        const endTime = this.normalizeSessionDate(options.endTime)
            || new Date(startTime.getTime() + roundedWorkMinutes * 60000);
        const count = this.calculateWorkSessionCount(roundedWorkMinutes, plannedDuration, completed, isCountUp);

        const updatedSession: PomodoroSession = {
            ...location.session,
            type: 'work',
            eventId,
            eventTitle,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: roundedWorkMinutes,
            plannedDuration,
            completed,
            isCountUp: isCountUp || false,
            count,
            inProgress: false,
            note: this.normalizeSessionNote(options.note ?? location.session.note)
        };

        await this.updateSessionImpl(updatedSession);
        return updatedSession;
    }

    private async updateSessionImpl(session: PomodoroSession): Promise<boolean> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!session || !session.id) {
            return false;
        }

        const startTime = this.normalizeSessionDate(session.startTime);
        const endTime = this.normalizeSessionDate(session.endTime);
        if (!startTime || !endTime) {
            return false;
        }

        const normalizedSession: PomodoroSession = {
            ...session,
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
            duration: this.roundSessionMinutes(session.duration),
            plannedDuration: Math.max(1, Math.round(Number(session.plannedDuration) || 1)),
            completed: session.inProgress ? false : session.completed !== false,
            isCountUp: session.type === 'work' ? !!session.isCountUp : false,
            inProgress: !!session.inProgress,
            note: this.normalizeSessionNote(session.note)
        };

        if (normalizedSession.type === 'work') {
            if (normalizedSession.inProgress) {
                normalizedSession.count = 0;
            } else if (normalizedSession.isCountUp) {
                normalizedSession.count = this.calculateWorkSessionCount(
                    normalizedSession.duration,
                    normalizedSession.plannedDuration,
                    normalizedSession.completed,
                    true
                );
            } else if (typeof normalizedSession.count !== 'number' || normalizedSession.count <= 0) {
                normalizedSession.count = this.calculateWorkSessionCount(
                    normalizedSession.duration,
                    normalizedSession.plannedDuration,
                    normalizedSession.completed,
                    false
                );
            }
        } else {
            delete normalizedSession.count;
            delete normalizedSession.isCountUp;
        }

        await this.loadSessionDate(normalizedSession.id);
        await this.ensureDatesLoaded([getLogicalDateString(startTime)]);
        const location = this.findSessionLocation(normalizedSession.id);
        const datesToSave = new Set<string>();
        if (location) {
            this.records[location.date].sessions.splice(location.index, 1);
            this.recalculateRecordTotals(location.date);
            datesToSave.add(location.date);
        }

        const logicalDate = getLogicalDateString(startTime);
        this.ensureTodayRecord(logicalDate);
        this.records[logicalDate].sessions.push(normalizedSession);
        this.records[logicalDate].sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        this.recalculateRecordTotals(logicalDate);
        datesToSave.add(logicalDate);

        this.buildStatsIndex();
        await this.saveRecords([logicalDate, ...Array.from(datesToSave).filter(date => date !== logicalDate)]);
        return true;
    }

    private async updateSessionNoteImpl(sessionId: string, note: string): Promise<boolean> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        await this.loadSessionDate(sessionId);
        const location = this.findSessionLocation(sessionId);
        if (!location) {
            return false;
        }

        location.session.note = this.normalizeSessionNote(note);
        await this.saveRecords([location.date]);
        return true;
    }

    getTodayFocusTime(): number {
        const today = this.getToday();
        return this.records[today]?.totalWorkTime || 0;
    }

    getWeekFocusTime(): number {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        // 获取本周一的日期（周一为一周的开始）
        const currentDay = today.getDay(); // 0 = 周日, 1 = 周一, ..., 6 = 周六
        const mondayOffset = currentDay === 0 ? -6 : 1 - currentDay; // 如果是周日，回退6天；否则回退到周一

        const monday = new Date(today);
        monday.setDate(today.getDate() + mondayOffset);

        let totalMinutes = 0;
        for (let i = 0; i < 7; i++) {
            const date = new Date(monday);
            date.setDate(monday.getDate() + i);
            const dateStr = getLogicalDateString(date);

            totalMinutes += this.records[dateStr]?.totalWorkTime || 0;
        }

        return totalMinutes;
    }

    /**
     * 获取指定提醒的番茄数量 (Deprecated: prefer using getEventTotalPomodoroCount)
     */
    async getReminderPomodoroCount(reminderId: string): Promise<number> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        return this.getEventTotalPomodoroCount(reminderId);
    }

    /**
     * 获取指定提醒及其所有子任务的累计番茄数量
     */
    async getAggregatedReminderPomodoroCount(reminderId: string): Promise<number> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        try {
            const reminderData = await this.plugin.loadReminderData() || {};

            if (!reminderData) return 0;

            // Helper to detect instance id format
            const isInstanceId = (id: string) => {
                if (!id.includes('_')) return false;
                const parts = id.split('_');
                const lastPart = parts[parts.length - 1];
                return /^\d{4}-\d{2}-\d{2}$/.test(lastPart);
            };

            // Determine starting id (convert instance id to original id if needed)
            let rootId = reminderId;
            if (isInstanceId(reminderId)) {
                const parts = reminderId.split('_');
                rootId = parts.slice(0, -1).join('_');
            }

            // BFS traversal to collect all descendant IDs
            const visited = new Set<string>();
            const queue: string[] = [rootId];
            let total = 0;

            // Using this.records to count
            const countForId = (id: string) => {
                return this.getEventTotalPomodoroCount(id);
            };

            while (queue.length > 0) {
                const current = queue.shift()!;
                if (visited.has(current)) continue;
                visited.add(current);

                // accumulate count for this id from records
                total += countForId(current);

                // enqueue direct children
                Object.keys(reminderData).forEach(k => {
                    try {
                        const r = reminderData[k];
                        if (r && r.parentId === current) {
                            queue.push(k);
                        }
                    } catch (e) {
                        // ignore malformed entries
                    }
                });
            }

            return total;
        } catch (error) {
            console.error("Failed to get total pomodoro count for reminder and subtasks:", error);
            return 0;
        }
    }

    /**
     * 获取指定提醒及其所有子任务的累计专注时长（分钟）
     */
    async getAggregatedReminderFocusTime(reminderId: string): Promise<number> {
        try {
            // Ensure records loaded
            if (!this.isInitialized) {
                await this.initialize();
            }

            const reminderData = await this.plugin.loadReminderData() || {};
            if (!reminderData) return 0;

            const isInstanceId = (id: string) => {
                if (!id.includes('_')) return false;
                const parts = id.split('_');
                const lastPart = parts[parts.length - 1];
                return /^\d{4}-\d{2}-\d{2}$/.test(lastPart);
            };

            let rootId = reminderId;
            if (isInstanceId(reminderId)) {
                const parts = reminderId.split('_');
                rootId = parts.slice(0, -1).join('_');
            }

            // Collect all related ids (root + descendants + per-instance ids)
            const idsToInclude = new Set<string>();
            const queue = [rootId];
            while (queue.length > 0) {
                const current = queue.shift()!;
                if (idsToInclude.has(current)) continue;
                idsToInclude.add(current);
                // include instance keys
                try {
                    const r = reminderData[current];
                    if (r && r.repeat && r.repeat.instancePomodoroCount) {
                        Object.keys(r.repeat.instancePomodoroCount).forEach(k => idsToInclude.add(k));
                    }
                } catch (e) { }
                // add children
                Object.keys(reminderData).forEach(k => {
                    try {
                        const r = reminderData[k];
                        if (r && r.parentId === current) {
                            queue.push(k);
                        }
                    } catch (e) { }
                });
            }

            // Sum durations across all stored sessions whose eventId is in idsToInclude
            let totalMinutes = 0;
            idsToInclude.forEach(id => {
                totalMinutes += this.eventStats[id]?.duration || 0;
            });
            return totalMinutes;
        } catch (error) {
            console.error("Failed to get total focus duration for reminder and subtasks:", error);
            return 0;
        }
    }

    /**
     * 获取今日所有提醒的总番茄数
     */
    async getTodayTotalPomodoroCount(): Promise<number> {
        // Using records instead of reminderData
        const today = getLogicalDateString();
        const record = this.records[today];
        return record ? record.workSessions : 0;
    }

    formatTime(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        } else {
            return `${mins}m`;
        }
    }

    /**
     * 手动刷新数据（仅在需要时调用）
     * 如果缓存已存在且没有指定强制更新，则跳过文件读取
     */
    private async refreshDataImpl(force: boolean = false) {
        await this.initialize();
        if (this.store) {
            if (force || this.store.needsReload) await this.store.refresh(undefined, true);
            return;
        }
        if (this.isSaving || this.isLoading) {
            console.log("File operation in progress; skipping refresh");
            return;
        }

        // 如果不是强制更新且已有记录，则只同步插件层级的缓存（如果可用）
        if (!force && this.isInitialized) {
            const cachedRecords = await this.plugin.loadPomodoroRecords(false);
            if (cachedRecords === this.records) {
                return; // 缓存未变，直接返回
            }
        }

        await this.loadRecords(force);
    }

    /**
     * 获取指定日期的会话记录
     */
    getDateSessions(date: string): PomodoroSession[] {
        return this.records[date]?.sessions || [];
    }

    /**
     * 获取今日的会话记录
     */
    getTodaySessions(): PomodoroSession[] {
        const today = this.getToday();
        return this.getDateSessions(today);
    }

    /**
     * 计算并获取指定日期的某个事件的番茄钟数量（兼容旧数据）
     */
    getEventPomodoroCount(eventId: string, date: string): number {
        if (this.store) return this.store.summaries[date]?.workByEvent[eventId]?.count || 0;
        if (!this.records[date]) {
            return 0;
        }

        return this.records[date].sessions.reduce((sum, session) => {
            if (session.eventId === eventId && session.type === 'work') {
                return sum + this.calculateSessionCount(session);
            }
            return sum;
        }, 0);
    }

    /**
     * 获取某个事件的总番茄钟数量（跨所有日期，使用索引优化）
     */
    getEventTotalPomodoroCount(eventId: string): number {
        return this.eventStats[eventId]?.count || 0;
    }

    /**
     * 获取重复事件的所有实例的总番茄数
     */
    getRepeatingEventTotalPomodoroCount(originalId: string): number {
        let total = 0;

        // 优化：仅遍历 eventStats 的键
        for (const eventId in this.eventStats) {
            let match = false;
            if (eventId === originalId) {
                match = true;
            } else if (eventId.startsWith(originalId + '_')) {
                // Verify suffix is a date
                const suffix = eventId.substring(originalId.length + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) {
                    match = true;
                }
            }

            if (match) {
                total += this.eventStats[eventId].count;
            }
        }
        return total;
    }

    /**
     * 获取指定事件的总专注时间
     */
    getEventFocusTime(eventId: string, date?: string): number {
        const targetDate = date || this.getToday();
        if (this.store) return this.store.summaries[targetDate]?.workByEvent[eventId]?.duration || 0;
        const sessions = this.getDateSessions(targetDate);

        return sessions
            .filter(session => session.eventId === eventId && session.type === 'work')
            .reduce((total, session) => total + session.duration, 0);
    }

    /**
     * 获取指定事件在所有日期内的总专注时长（分钟，使用索引优化）
     */
    getEventTotalFocusTime(eventId: string): number {
        return this.eventStats[eventId]?.duration || 0;
    }

    /**
     * 获取重复事件的所有实例的总专注时长（分钟）
     */
    getRepeatingEventTotalFocusTime(originalId: string): number {
        let total = 0;

        // 优化：仅遍历 eventStats 的键
        for (const eventId in this.eventStats) {
            let match = false;
            if (eventId === originalId) {
                match = true;
            } else if (eventId.startsWith(originalId + '_')) {
                // Verify suffix is a date
                const suffix = eventId.substring(originalId.length + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(suffix)) {
                    match = true;
                }
            }

            if (match) {
                total += this.eventStats[eventId].duration;
            }
        }
        return total;
    }

    getSaveData(): any {
        return this.records;
    }

    /**
     * 计算会话的番茄钟数量
     * @param session 番茄钟会话
     */
    public calculateSessionCount(session: PomodoroSession): number {
        return calculatePomodoroSessionCount(session);
    }

    /**
     * 获取日期范围内的会话记录
     */
    async getDateRangeSessions(startDate: string, endDate: string): Promise<PomodoroSession[]> {
        await this.ensureRangeLoaded(startDate, endDate);
        const sessions: PomodoroSession[] = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        for (const date in this.records) {
            const recordDate = new Date(date);
            if (recordDate >= start && recordDate <= end) {
                sessions.push(...this.records[date].sessions);
            }
        }

        this.releaseDetails();
        return sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }

    /**
     * 获取本周的会话记录
     */
    async getWeekSessions(): Promise<PomodoroSession[]> {
        const today = new Date(`${getLogicalDateString()}T00:00:00`);
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        return this.getDateRangeSessions(
            getLogicalDateString(weekStart),
            getLogicalDateString(weekEnd)
        );
    }

    /**
     * 删除指定的会话记录
     */
    private async deleteSessionImpl(sessionId: string): Promise<boolean> {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        await this.loadSessionDate(sessionId);
        const dateForSession = this.store?.dateForSession(sessionId);
        const dates = this.store ? (dateForSession ? [dateForSession] : []) : Object.keys(this.records);
        for (const date of dates) {
            const record = this.records[date];
            if (!record || !record.sessions) continue;

            const sessionIndex = record.sessions.findIndex(session => session.id === sessionId);
            if (sessionIndex !== -1) {
                const session = record.sessions[sessionIndex];

                // 从数组中删除会话
                record.sessions.splice(sessionIndex, 1);

                // 更新统计数据
                if (session.type === 'work') {
                    // Update stats (completed or not, it might have contributed to count)
                    const count = this.calculateSessionCount(session);
                    record.workSessions = Math.max(0, record.workSessions - count);

                    record.totalWorkTime = Math.max(0, record.totalWorkTime - session.duration);
                } else {
                    record.totalBreakTime = Math.max(0, record.totalBreakTime - session.duration);
                }

                // 保存更改
                this.buildStatsIndex(); // 重新构建索引比较简单稳妥
                await this.saveRecords([date]);
                return true;
            }
        }

        return false; // 未找到会话
    }

    /**
     * 根据当前的一天起始时间设置，重新生成按天分组的番茄钟记录
     * 当用户修改一天起始时间后，需要调用此方法重新计算所有会话的逻辑日期
     */
    private async regenerateRecordsByDateImpl(): Promise<void> {
        await this.ensureAllRecordsLoaded();
        const staged: Record<string, PomodoroRecord> = Object.create(null);
        for (const [date, record] of Object.entries(this.records)) {
            // 没有明细的旧总量无法重新归属，保留在原日期。
            if (!record.sessions.length) {
                const day = staged[date] ||= { date, workSessions: 0, totalWorkTime: 0, totalBreakTime: 0, sessions: [] };
                day.workSessions += record.workSessions;
                day.totalWorkTime += record.totalWorkTime;
                day.totalBreakTime += record.totalBreakTime;
                continue;
            }
            for (const session of record.sessions) {
                const start = this.normalizeSessionDate(session.startTime);
                if (!start) throw new Error(`番茄钟开始时间无效: ${session.id}`);
                const target = getLogicalDateString(start);
                const day = staged[target] ||= { date: target, workSessions: 0, totalWorkTime: 0, totalBreakTime: 0, sessions: [] };
                day.sessions.push(session);
                if (session.type === 'work') {
                    day.workSessions += this.calculateSessionCount(session);
                    day.totalWorkTime += session.duration;
                } else day.totalBreakTime += session.duration;
            }
        }
        if (this.store) {
            await this.store.replaceAll(staged);
        } else {
            const original = this.records;
            try {
                this.records = staged;
                await this.saveRecords();
                for (const date of Object.keys(original)) if (!staged[date]) await this.plugin.removeData(`pomodoroRecords/${date}.json`);
            } catch (error) { this.records = original; throw error; }
            this.buildStatsIndex();
        }
    }

    /** 批量解析时共用本轮快照，避免逐个任务重建索引和扫描当天会话。 */
    async resolveReminderPomodoroStatsBatch(reminders: any[], reminderData: any): Promise<Map<string, PomodoroStats>> {
        if (reminders.length === 0) return new Map();
        if (!this.isInitialized) await this.initialize();
        const dataMap = await this.getReminderStatsDataMap(undefined, reminderData);
        let localData: any = {};
        if (reminders.some(reminder => reminder && !reminder.isRepeatInstance)) {
            try {
                localData = await this.plugin.loadReminderData() || {};
            } catch (error) {
                console.warn('Failed to load local tasks for pomodoro statistics:', error);
            }
        }
        const today = this.getToday();
        const todayTotals = new Map<string, EventPomodoroTotals>();
        if (this.store) {
            for (const [id, stats] of Object.entries(this.getDaySummary(today)?.workByEvent || {})) {
                todayTotals.set(id, { ...stats });
            }
        } else {
            for (const session of this.getDateSessions(today)) {
                if (session.type !== 'work') continue;
                const stats = todayTotals.get(session.eventId) || { count: 0, duration: 0 };
                stats.count += this.calculateSessionCount(session);
                stats.duration += session.duration;
                todayTotals.set(session.eventId, stats);
            }
        }
        const snapshot = new ReminderPomodoroStatsSnapshot(
            dataMap.values(), Object.values(localData), this.eventStats, todayTotals, today,
        );
        return new Map(reminders.map(reminder => [reminder?.id, snapshot.resolve(reminder)]));
    }

    /** 单个任务的兼容入口；列表刷新使用上面的批量方法。 */
    async resolveReminderPomodoroStats(reminder: any, reminderData: any): Promise<PomodoroStats> {
        if (!this.isInitialized) {
            await this.initialize();
        }
        try {
            const reminderId = reminder?.id;
            if (!reminderId) {
                return {
                    pomodoroCount: 0,
                    focusTime: 0,
                    todayPomodoroCount: 0,
                    todayFocusTime: 0,
                    totalRepeatingPomodoroCount: 0,
                    totalRepeatingFocusTime: 0
                };
            }

            const dataMap = await this.getReminderStatsDataMap(reminder, reminderData);

            // 1. Get Pomodoro count & Focus Time
            const pomodoroCount = await this.getReminderPomodoroCountInternal(reminderId, reminder, dataMap);
            const focusTime = await this.getReminderFocusTimeInternal(reminderId, reminder, dataMap);

            // 2. Get Today's Pomodoro count & Today's Focus Time
            const todayPomodoroCount = await this.getReminderTodayPomodoroCountInternal(reminderId, reminder, dataMap);
            const todayFocusTime = await this.getReminderTodayFocusTimeInternal(reminderId, reminder, dataMap);

            // 3. Get Repeating Total Pomodoro count & Repeating Total Focus Time
            let totalRepeatingPomodoroCount = 0;
            let totalRepeatingFocusTime = 0;
            if (reminder.isRepeatInstance) {
                const originalId = reminder.originalId || reminderId.split('_')[0];
                totalRepeatingPomodoroCount = this.getRepeatingEventTotalPomodoroCount(originalId);
                totalRepeatingFocusTime = this.getRepeatingEventTotalFocusTime(originalId);
            }

            return {
                pomodoroCount,
                focusTime,
                todayPomodoroCount,
                todayFocusTime,
                totalRepeatingPomodoroCount,
                totalRepeatingFocusTime
            };
        } catch (error) {
            console.error("Failed to parse pomodoro statistics:", error, reminder);
            return {
                pomodoroCount: 0,
                focusTime: 0,
                todayPomodoroCount: 0,
                todayFocusTime: 0,
                totalRepeatingPomodoroCount: 0,
                totalRepeatingFocusTime: 0
            };
        }
    }

    private async getReminderStatsDataMap(reminder?: any, reminderData?: any): Promise<Map<string, any>> {
        const raw = reminderData;
        if (raw instanceof Map) {
            return raw;
        }
        if (Array.isArray(raw)) {
            return new Map(raw.map((r: any) => [r.id, r]));
        }
        if (raw && typeof raw === 'object') {
            return new Map(Object.values(raw).map((r: any) => [r.id, r]));
        }
        try {
            const rd = await this.plugin.loadReminderData();
            return new Map(Object.values(rd || {}).map((r: any) => [r.id, r]));
        } catch (e) {
            return new Map();
        }
    }

    private getAllDescendantIdsForStats(id: string, reminderMap: Map<string, any>): string[] {
        const result: string[] = [];
        const stack = [id];
        const visited = new Set<string>();
        visited.add(id);

        while (stack.length > 0) {
            const curId = stack.pop()!;
            for (const r of reminderMap.values()) {
                if (r && r.parentId === curId && !visited.has(r.id)) {
                    result.push(r.id);
                    stack.push(r.id);
                    visited.add(r.id);
                }
            }
        }
        return result;
    }

    private getAllAncestorIdsForStats(id: string, reminderMap: Map<string, any>): string[] {
        const result: string[] = [];
        let current = reminderMap.get(id);

        while (current && current.parentId) {
            if (result.includes(current.parentId)) {
                break;
            }
            result.push(current.parentId);
            current = reminderMap.get(current.parentId);
        }
        return result;
    }

    private async getReminderSubtreeIdsForStats(reminderId: string, reminder: any, dataMap: Map<string, any>): Promise<Set<string>> {
        const idsToQuery = new Set<string>();
        idsToQuery.add(reminderId);

        try {
            const descendantIds = this.getAllDescendantIdsForStats(reminderId, dataMap);
            descendantIds.forEach(id => idsToQuery.add(id));
        } catch (e) {
            // ignore subtree resolution failures and fall back to the current node
        }

        return idsToQuery;
    }

    private async getReminderPomodoroCountInternal(reminderId: string, reminder: any, dataMap: Map<string, any>): Promise<number> {
        // Repeat instances can also own ghost descendants. In that case we need to
        // aggregate the whole visible instance subtree instead of only the current node.
        if (reminder && reminder.isRepeatInstance) {
            const idsToQuery = await this.getReminderSubtreeIdsForStats(reminderId, reminder, dataMap);
            let total = 0;
            for (const id of idsToQuery) {
                total += this.getEventTotalPomodoroCount(id);
            }
            return total;
        }

        // Determine if this reminder has any descendants (regardless of depth)
        let hasDescendants = false;
        try {
            hasDescendants = this.getAllDescendantIdsForStats(reminderId, dataMap).length > 0;
        } catch (e) {
            hasDescendants = false;
        }

        if (hasDescendants) {
            return await this.getAggregatedReminderPomodoroCount(reminderId);
        }
        const isSubtask = reminder && reminder.parentId;
        if (isSubtask) {
            return this.getEventTotalPomodoroCount(reminderId);
        }
        return await this.getAggregatedReminderPomodoroCount(reminderId);
    }

    private async getReminderFocusTimeInternal(reminderId: string, reminder: any, dataMap: Map<string, any>): Promise<number> {
        // Repeat instances can also own ghost descendants. Aggregate the whole
        // visible instance subtree instead of only the current node.
        if (reminder && reminder.isRepeatInstance) {
            const idsToQuery = await this.getReminderSubtreeIdsForStats(reminderId, reminder, dataMap);
            let total = 0;
            for (const id of idsToQuery) {
                total += this.getEventTotalFocusTime(id);
            }
            return total;
        }

        // Determine if this reminder has any descendants (regardless of depth)
        let hasDescendants = false;
        try {
            hasDescendants = this.getAllDescendantIdsForStats(reminderId, dataMap).length > 0;
        } catch (e) {
            hasDescendants = false;
        }

        if (hasDescendants) {
            return await this.getAggregatedReminderFocusTime(reminderId);
        }

        return this.getEventTotalFocusTime(reminderId);
    }

    private async getReminderTodayPomodoroCountInternal(reminderId: string, reminder: any, dataMap: Map<string, any>, date?: string): Promise<number> {
        const targetDate = date || this.getToday();

        // Repeat instances can own ghost descendants. Sum the current instance subtree.
        if (reminder && reminder.isRepeatInstance) {
            const idsToQuery = await this.getReminderSubtreeIdsForStats(reminderId, reminder, dataMap);
            let total = 0;
            for (const id of idsToQuery) {
                total += this.getEventPomodoroCount(id, targetDate);
            }
            return total;
        }

        // Build a set of event ids: root id + descendants + per-instance ids that match target date
        const idsToQuery = new Set<string>();
        idsToQuery.add(reminderId);

        if (dataMap) {
            // Add descendants
            try {
                const descendantIds = this.getAllDescendantIdsForStats(reminderId, dataMap);
                descendantIds.forEach(id => idsToQuery.add(id));
            } catch (e) { }

            // Also include per-instance IDs that match the target date (e.g. originalId_YYYY-MM-DD)
            try {
                const suffix = `_${targetDate}`;
                dataMap.forEach((r, k) => {
                    // if reminder is repeat enabled and belongs to our root, add constructed instance id
                    if (r && r.repeat && r.repeat.enabled) {
                        const constructed = `${k}_${targetDate}`;
                        try {
                            const originalId = k;
                            if (originalId === reminderId || this.getAllAncestorIdsForStats(k, dataMap).includes(reminderId)) {
                                idsToQuery.add(constructed);
                            }
                        } catch (e) { }
                    }
                    if (k.endsWith(suffix)) {
                        // check whether this instance belongs to our reminder (originalId prefix)
                        const parts = k.split('_');
                        const originalId = parts.slice(0, -1).join('_');
                        if (originalId === reminderId || this.getAllAncestorIdsForStats(k, dataMap).includes(reminderId)) {
                            idsToQuery.add(k);
                        }
                    }
                });
            } catch (e) { }
        }

        // Sum event counts for the target date
        let total = 0;
        for (const id of idsToQuery) {
            total += this.getEventPomodoroCount(id, targetDate);
        }

        return total;
    }

    private async getReminderTodayFocusTimeInternal(reminderId: string, reminder: any, dataMap: Map<string, any>, date?: string): Promise<number> {
        const targetDate = date || this.getToday();

        // Repeat instances can own ghost descendants. Sum the current instance subtree.
        if (reminder && reminder.isRepeatInstance) {
            const idsToQuery = await this.getReminderSubtreeIdsForStats(reminderId, reminder, dataMap);
            let total = 0;
            for (const id of idsToQuery) {
                total += this.getEventFocusTime(id, targetDate);
            }
            return total;
        }

        // Build a set of ids to query: root + descendants + instance ids of the date
        const idsToQuery = new Set<string>();
        idsToQuery.add(reminderId);

        if (dataMap) {
            try {
                const descendantIds = this.getAllDescendantIdsForStats(reminderId, dataMap);
                descendantIds.forEach(id => idsToQuery.add(id));
            } catch (e) { }

            try {
                const suffix = `_${targetDate}`;
                dataMap.forEach((r, k) => {
                    if (r && r.repeat && r.repeat.enabled) {
                        const constructed = `${k}_${targetDate}`;
                        try {
                            const originalId = k;
                            if (originalId === reminderId || this.getAllAncestorIdsForStats(k, dataMap).includes(reminderId)) {
                                idsToQuery.add(constructed);
                            }
                        } catch (e) { }
                    }
                    if (k.endsWith(suffix)) {
                        const parts = k.split('_');
                        const originalId = parts.slice(0, -1).join('_');
                        if (originalId === reminderId || this.getAllAncestorIdsForStats(k, dataMap).includes(reminderId)) {
                            idsToQuery.add(k);
                        }
                    }
                });
            } catch (e) { }
        }

        let total = 0;
        for (const id of idsToQuery) {
            total += this.getEventFocusTime(id, targetDate);
        }

        return total;
    }

    /**
     * MCP kernel compat: reload records
     */
    public async reloadRecords(dates?: string[], verifyAll = false) {
        return this.serialize(async () => {
            await this.initialize();
            if (this.store) await this.store.refresh(dates, verifyAll);
            else await this.loadRecords(true);
        });
    }

    /**
     * MCP kernel compat: get focuses by time range
     */
    public async getFocusesByTime(startDate: string, endDate: string, eventId?: string): Promise<PomodoroSession[]> {
        await this.ensureRangeLoaded(startDate, endDate);
        const results: PomodoroSession[] = [];
        Object.values(this.records).forEach((record) => {
            if (record.date < startDate || record.date > endDate) return;
            if (record.sessions) {
                record.sessions.forEach((session) => {
                    if (eventId && session.eventId !== eventId) return;
                    results.push(session);
                });
            }
        });
        this.releaseDetails();
        return results.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }

    /**
     * MCP kernel compat: get focus by ID
     */
    public async getFocusById(sessionId: string): Promise<{ session: PomodoroSession; date: string } | undefined> {
        await this.initialize();
        await this.loadSessionDate(sessionId);
        const loc = this.findSessionLocation(sessionId);
        if (loc) {
            return { session: loc.session, date: loc.date };
        }
        return undefined;
    }

    /**
     * MCP kernel compat: create focus
     */
    private async createFocusImpl(input: {
        type: 'work' | 'shortBreak' | 'longBreak';
        eventId?: string;
        eventTitle?: string;
        startTime: string;
        endTime: string;
        duration?: number;
        plannedDuration?: number;
        completed?: boolean;
        note?: string;
    }): Promise<PomodoroSession> {
        const startTimeObj = new Date(input.startTime);
        const endTimeObj = new Date(input.endTime);
        const duration = input.duration ?? Math.max(0, Math.round((endTimeObj.getTime() - startTimeObj.getTime()) / 60000));
        const session: PomodoroSession = {
            id: `focus_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            type: input.type,
            eventId: input.eventId || '',
            eventTitle: input.eventTitle || '',
            startTime: input.startTime,
            endTime: input.endTime,
            duration,
            plannedDuration: input.plannedDuration ?? 25,
            completed: input.completed ?? true,
            note: input.note || '',
        };
        await this.initialize();
        const date = getLogicalDateString(startTimeObj);
        await this.ensureDatesLoaded([date]);
        if (!this.records[date]) {
            this.records[date] = {
                date,
                workSessions: 0,
                totalWorkTime: 0,
                totalBreakTime: 0,
                sessions: []
            };
        }
        this.records[date].sessions.push(session);
        this.recalculateRecordTotals(date);
        await this.saveRecords([date]);
        return session;
    }

    /**
     * MCP kernel compat: delete focus
     */
    public async deleteFocus(sessionId: string): Promise<boolean> {
        return this.deleteSession(sessionId);
    }

    /**
     * MCP kernel compat: update focus
     */
    public async updateFocus(session: PomodoroSession): Promise<boolean> {
        return this.updateSession(session);
    }
}

export { PomodoroRecordManager as PomodoroManager };
