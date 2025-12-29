import { POMODORO_RECORD_DATA_FILE } from "../index";
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
}

export interface PomodoroRecord {
    date: string; // YYYY-MM-DD
    workSessions: number; // 完成的工作番茄数
    totalWorkTime: number; // 总工作时间（分钟）
    totalBreakTime: number; // 总休息时间（分钟）
    sessions: PomodoroSession[]; // 详细的会话记录
}

export class PomodoroRecordManager {
    private static instance: PomodoroRecordManager;
    private records: { [date: string]: PomodoroRecord } = {};
    private isLoading: boolean = false;
    private isSaving: boolean = false;
    private isInitialized: boolean = false;
    private plugin: any;

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    static getInstance(plugin?: any): PomodoroRecordManager {
        if (!PomodoroRecordManager.instance) {
            PomodoroRecordManager.instance = new PomodoroRecordManager(plugin);
        }
        return PomodoroRecordManager.instance;
    }

    async initialize() {
        if (this.isInitialized) return;
        await this.loadRecords();
        this.isInitialized = true;
    }

    private generateSessionId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    private async loadRecords() {
        if (this.isLoading) return;
        this.isLoading = true;

        try {
            const content = await this.plugin.loadData(POMODORO_RECORD_DATA_FILE);
            // 检查返回的内容是否是有效的记录数据
            if (content) {
                this.records = content;
            } else {
                // 如果返回的是错误对象或包含错误信息，则初始化为空记录
                console.log('番茄钟记录文件不存在或格式错误，初始化空记录');
                this.records = {};
            }

            // 确保每个日期记录都有 sessions 数组
            Object.keys(this.records).forEach(date => {
                if (!this.records[date].sessions) {
                    this.records[date].sessions = [];
                }
            });
        } catch (error) {
            console.log('番茄钟记录文件不存在，初始化空记录');
            this.records = {};
        } finally {
            this.isLoading = false;
        }
    }

    private async saveRecords() {
        if (this.isSaving) {
            console.log('正在保存中，跳过本次保存请求');
            return;
        }

        this.isSaving = true;

        try {
            await this.plugin.saveData(POMODORO_RECORD_DATA_FILE, this.records);
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

    async recordWorkSession(workMinutes: number, eventId: string = '', eventTitle: string = '番茄专注', plannedDuration: number = 25, completed: boolean = true) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const today = this.getToday();
        this.ensureTodayRecord(today);

        // console.log('记录工作会话前:', JSON.stringify(this.records[today]));

        // 创建详细的会话记录
        const session: PomodoroSession = {
            id: this.generateSessionId(),
            type: 'work',
            eventId,
            eventTitle,
            startTime: new Date(Date.now() - workMinutes * 60000).toISOString(),
            endTime: new Date().toISOString(),
            duration: workMinutes,
            plannedDuration,
            completed
        };

        // 添加到会话记录
        this.records[today].sessions.push(session);

        // 更新统计数据
        if (completed) {
            this.records[today].workSessions += 1;
        }
        this.records[today].totalWorkTime += workMinutes;

        // console.log('记录工作会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords();
    }

    async recordBreakSession(breakMinutes: number, eventId: string = '', eventTitle: string = '休息时间', plannedDuration: number = 5, isLongBreak: boolean = false, completed: boolean = true) {
        // 确保已初始化
        if (!this.isInitialized) {
            await this.initialize();
        }

        const today = this.getToday();
        this.ensureTodayRecord(today);

        // console.log('记录休息会话前:', JSON.stringify(this.records[today]));

        // 创建详细的会话记录
        const session: PomodoroSession = {
            id: this.generateSessionId(),
            type: isLongBreak ? 'longBreak' : 'shortBreak',
            eventId,
            eventTitle: isLongBreak ? '长时休息' : '短时休息',
            startTime: new Date(Date.now() - breakMinutes * 60000).toISOString(),
            endTime: new Date().toISOString(),
            duration: breakMinutes,
            plannedDuration,
            completed
        };

        // 添加到会话记录
        this.records[today].sessions.push(session);

        // 更新统计数据
        this.records[today].totalBreakTime += breakMinutes;

        // console.log('记录休息会话后:', JSON.stringify(this.records[today]));

        await this.saveRecords();
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
     * 获取指定提醒的番茄数量
     */
    async getReminderPomodoroCount(reminderId: string): Promise<number> {
        try {
            const { readReminderData } = await import("../api");
            const reminderData = await readReminderData();

            if (!reminderData) return 0;

            // 检查是否是重复实例ID（格式：originalId_date）
            if (reminderId.includes('_')) {
                // 可能是重复实例，尝试提取原始ID
                const parts = reminderId.split('_');
                if (parts.length >= 2) {
                    // 最后一部分应该是日期，前面的部分组成原始ID
                    const lastPart = parts[parts.length - 1];
                    // 简单检查最后一部分是否像日期（YYYY-MM-DD格式）
                    if (/^\d{4}-\d{2}-\d{2}$/.test(lastPart)) {
                        // 这是一个重复实例ID
                        const originalId = parts.slice(0, -1).join('_');
                        const originalReminder = reminderData[originalId];

                        if (originalReminder?.repeat?.instancePomodoroCount) {
                            return originalReminder.repeat.instancePomodoroCount[reminderId] || 0;
                        }
                        return 0;
                    }
                }
            }

            // 普通任务或不是重复实例格式
            if (reminderData[reminderId]) {
                return reminderData[reminderId].pomodoroCount || 0;
            }

            return 0;
        } catch (error) {
            console.error('获取提醒番茄数量失败:', error);
            return 0;
        }
    }

    /**
     * 获取指定提醒及其所有子任务的累计番茄数量
     */
    async getAggregatedReminderPomodoroCount(reminderId: string): Promise<number> {
        try {
            const { readReminderData } = await import("../api");
            const reminderData = await readReminderData();

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

            while (queue.length > 0) {
                const current = queue.shift()!;
                if (visited.has(current)) continue;
                visited.add(current);

                // accumulate count for this id
                if (isInstanceId(current)) {
                    // Instance id: find original reminder and count via repeat.instancePomodoroCount
                    const parts = current.split('_');
                    const original = parts.slice(0, -1).join('_');
                    const originalReminder = reminderData[original];
                    if (originalReminder?.repeat?.instancePomodoroCount) {
                        total += originalReminder.repeat.instancePomodoroCount[current] || 0;
                    }
                } else {
                    if (reminderData[current]) {
                        total += reminderData[current].pomodoroCount || 0;
                        // If this reminder has per-instance counts, include those as well
                        if (reminderData[current].repeat && reminderData[current].repeat.instancePomodoroCount) {
                            const obj = reminderData[current].repeat.instancePomodoroCount;
                            Object.keys(obj).forEach(k => {
                                try {
                                    const v = obj[k];
                                    if (typeof v === 'number') total += v;
                                } catch (e) { }
                            });
                        }
                    }
                }

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
            const { readReminderData } = await import("../api");
            const reminderData = await readReminderData();
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
            for (const date in this.records) {
                const record = this.records[date];
                if (!record || !record.sessions) continue;
                for (const session of record.sessions) {
                    if (session && session.type === 'work') {
                        if (idsToInclude.has(session.eventId)) {
                            totalMinutes += session.duration || 0;
                        }
                    }
                }
            }
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
        try {
            const { readReminderData } = await import("../api");
            const reminderData = await readReminderData();

            if (!reminderData) return 0;

            const today = getLogicalDateString();
            let totalCount = 0;

            Object.values(reminderData).forEach((reminder: any) => {
                if (reminder && reminder.date === today && reminder.pomodoroCount) {
                    totalCount += reminder.pomodoroCount;
                }
            });

            return totalCount;
        } catch (error) {
            console.error('获取今日总番茄数失败:', error);
            return 0;
        }
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
     */
    async refreshData() {
        if (this.isSaving || this.isLoading) {
            console.log('正在进行文件操作，跳过刷新');
            return;
        }
        await this.loadRecords();
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
     * 获取指定事件的番茄钟数量
     */
    getEventPomodoroCount(eventId: string, date?: string): number {
        const targetDate = date || this.getToday();
        const sessions = this.getDateSessions(targetDate);

        return sessions.filter(session =>
            session.eventId === eventId &&
            session.type === 'work' &&
            session.completed
        ).length;
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
     * 获取指定事件在所有日期内的总专注时长（分钟）
     */
    getEventTotalFocusTime(eventId: string): number {
        let total = 0;
        for (const date in this.records) {
            const record = this.records[date];
            if (!record || !record.sessions) continue;
            for (const session of record.sessions) {
                if (session && session.type === 'work' && session.eventId === eventId) {
                    total += session.duration || 0;
                }
            }
        }
        return total;
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
                    if (session.completed) {
                        record.workSessions = Math.max(0, record.workSessions - 1);
                    }
                    record.totalWorkTime = Math.max(0, record.totalWorkTime - session.duration);
                } else {
                    record.totalBreakTime = Math.max(0, record.totalBreakTime - session.duration);
                }

                // 保存更改
                await this.saveRecords();
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
                    if (session.completed) {
                        this.records[logicalDate].workSessions += 1;
                    }
                    this.records[logicalDate].totalWorkTime += session.duration;
                } else {
                    this.records[logicalDate].totalBreakTime += session.duration;
                }
            } catch (error) {
                console.error('处理会话时出错:', session, error);
            }
        }

        // 保存重新生成的记录
        await this.saveRecords();
    }
}
