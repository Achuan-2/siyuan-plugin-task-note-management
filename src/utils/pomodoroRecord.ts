import { getLogicalDateString } from "../utils/dateUtils";

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
    private pendingSaveDates: Set<string> = new Set();
    private isInitialized: boolean = false;
    private plugin: any;

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
        await this.loadRecords(true);
        this.isInitialized = true;
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
        for (const date in this.records) {
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
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const content = await this.plugin.loadPomodoroRecords(force);
            // 检查返回的内容是否是有效的记录数据
            if (content) {
                this.records = content;
            } else {
                // 如果返回的是错误对象或包含错误信息，则初始化为空记录
                console.log('番茄钟记录文件不存在或格式错误，初始化空记录');
                this.records = {};
                await this.saveRecords();
            }

            // 确保每个日期记录都有 sessions 数组，并构建索引
            this.buildStatsIndex();
        } catch (error) {
            console.log('番茄钟记录文件不存在，初始化空记录');
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
        if (!this.eventStats[eventId]) {
            this.eventStats[eventId] = { count: 0, duration: 0 };
        }
        this.eventStats[eventId].count += count;
        this.eventStats[eventId].duration += duration;
    }

    private async saveRecords(dates?: string[]) {
        const requestedDates = dates && dates.length > 0 ? dates : Object.keys(this.records);
        requestedDates.forEach(date => this.pendingSaveDates.add(date));

        if (this.isSaving) {
            return;
        }

        this.isSaving = true;

        try {
            while (this.pendingSaveDates.size > 0) {
                const keysToSync = Array.from(this.pendingSaveDates);
                this.pendingSaveDates.clear();

                for (const date of keysToSync) {
                    const record = this.records[date];
                    if (record) {
                        await this.plugin.saveData(`pomodoroRecords/${date}.json`, record);
                        if (this.plugin.pomodoroRecordsCache) {
                            this.plugin.pomodoroRecordsCache[date] = record;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('保存番茄钟记录失败:', error);
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

    async recordWorkSession(
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
        this.ensureTodayRecord(logicalDate);

        // console.log('记录工作会话前:', JSON.stringify(this.records[today]));

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

        // console.log('记录工作会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords([logicalDate]);
        return session;
    }

    async recordBreakSession(
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
        this.ensureTodayRecord(logicalDate);

        // console.log('记录休息会话前:', JSON.stringify(this.records[today]));

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

        // console.log('记录休息会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords([logicalDate]);
    }

    async startWorkSession(
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

    async finishWorkSession(
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

        const location = sessionId ? this.findSessionLocation(sessionId) : null;
        if (!location) {
            return await this.recordWorkSession(workMinutes, eventId, eventTitle, plannedDuration, completed, isCountUp, options);
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

        await this.updateSession(updatedSession);
        return updatedSession;
    }

    async updateSession(session: PomodoroSession): Promise<boolean> {
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
        await this.saveRecords(Array.from(datesToSave));
        return true;
    }

    async updateSessionNote(sessionId: string, note: string): Promise<boolean> {
        if (!this.isInitialized) {
            await this.initialize();
        }

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
            console.error('获取提醒及子任务累计番茄数量失败:', error);
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
            console.error('获取提醒及子任务累计专注时长失败:', error);
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
    async refreshData(force: boolean = false) {
        if (this.isSaving || this.isLoading) {
            console.log('正在进行文件操作，跳过刷新');
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
        // 进行中记录只是为了保存开始时间，等待结束或手动补录前不计入统计
        if (session.inProgress) {
            return 0;
        }

        // 对于正计时番茄，直接使用记录的count，不进行额外计算
        if (session.isCountUp && typeof session.count === 'number') {
            return session.count;
        }

        // 按照用户需求：有count值的按count值统计，没有count值的都算一个番茄
        // 即使记录的 count 为 0（旧数据或短时间中断），也按 1 个番茄计算（积极反馈原则）
        if (typeof session.count === 'number') {
            return Math.max(1, session.count);
        }
        return 1;
    }

    /**
     * 获取日期范围内的会话记录
     */
    getDateRangeSessions(startDate: string, endDate: string): PomodoroSession[] {
        const sessions: PomodoroSession[] = [];
        const start = new Date(startDate);
        const end = new Date(endDate);

        for (const date in this.records) {
            const recordDate = new Date(date);
            if (recordDate >= start && recordDate <= end) {
                sessions.push(...this.records[date].sessions);
            }
        }

        return sessions.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    }

    /**
     * 获取本周的会话记录
     */
    getWeekSessions(): PomodoroSession[] {
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
    async deleteSession(sessionId: string): Promise<boolean> {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        for (const date in this.records) {
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
    async regenerateRecordsByDate(): Promise<void> {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        // 收集所有会话
        const allSessions: PomodoroSession[] = [];
        for (const date in this.records) {
            const record = this.records[date];
            if (record && record.sessions) {
                allSessions.push(...record.sessions);
            }
        }

        if (allSessions.length === 0) {
            return;
        }


        // 保存旧有键，以防后续无法删除
        const oldDates = Object.keys(this.records);

        // 清空现有记录
        this.records = {};

        // 根据会话的开始时间重新分组
        for (const session of allSessions) {
            try {
                // 使用会话的开始时间计算逻辑日期
                const sessionStartTime = new Date(session.startTime);
                const logicalDate = getLogicalDateString(sessionStartTime);

                // 确保该日期的记录存在
                if (!this.records[logicalDate]) {
                    this.records[logicalDate] = {
                        date: logicalDate,
                        workSessions: 0,
                        totalWorkTime: 0,
                        totalBreakTime: 0,
                        sessions: []
                    };
                }

                // 添加会话到对应日期
                this.records[logicalDate].sessions.push(session);

                // 更新统计数据
                if (session.type === 'work') {
                    this.records[logicalDate].workSessions += this.calculateSessionCount(session);
                    this.records[logicalDate].totalWorkTime += session.duration;
                } else {
                    this.records[logicalDate].totalBreakTime += session.duration;
                }
            } catch (error) {
                console.error('处理会话时出错:', session, error);
            }
        }

        // 删除已经无用的日期记录
        for (const date of oldDates) {
            if (!this.records[date]) {
                await this.plugin.removeData(`pomodoroRecords/${date}.json`);
                if (this.plugin.pomodoroRecordsCache) {
                    delete this.plugin.pomodoroRecordsCache[date];
                }
            }
        }

        // 保存重新生成的记录
        await this.saveRecords();
    }
}
