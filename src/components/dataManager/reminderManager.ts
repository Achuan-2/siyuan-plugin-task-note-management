import type { ReminderItem, ReminderData, ReminderTime } from "../../types/reminder";
import { getEnvironmentSafeAllReminders, cleanReminderItem } from "../../utils/reminderLoadUtils";
import { ReminderTaskLogic } from "../../utils/reminderTaskLogic";
import { getLogicalDateString } from "../../utils/dateUtils";

export interface SearchReminderOptions {
    keyword?: string;
    id?: string;
    projectId?: string;
    date?: string;
    priority?: "high" | "medium" | "low" | "none";
    status?: string;
    completed?: boolean;
    limit?: number;
}

export interface CreateReminderInput {
    title: string;
    note?: string;
    date?: string;
    time?: string;
    reminderTimes?: ReminderTime[];
    endDate?: string;
    endTime?: string;
    priority?: "high" | "medium" | "low" | "none";
    projectId?: string;
    categoryId?: string;
    completed?: boolean;
    kanbanStatus?: string;
    url?: string;
    parentId?: string;
    repeat?: any;
    blockId?: string;
    docId?: string;
    customProgress?: number;
    linkedHabitId?: string;
    linkedHabitSyncPomodoroToday?: boolean;
    linkedHabitAutoCheckInOnComplete?: boolean;
    linkedHabitAutoCheckInOptionKey?: string;
    linkedHabitAutoCheckInEmoji?: string;
}

export interface UpdateReminderInput {
    id: string;
    title?: string;
    note?: string;
    date?: string;
    time?: string;
    reminderTimes?: ReminderTime[];
    endDate?: string;
    endTime?: string;
    priority?: "high" | "medium" | "low" | "none";
    projectId?: string;
    categoryId?: string;
    completed?: boolean;
    kanbanStatus?: string;
    url?: string;
    repeat?: any;
    blockId?: string;
    docId?: string;
    customProgress?: number;
    linkedHabitId?: string;
    linkedHabitSyncPomodoroToday?: boolean;
    linkedHabitAutoCheckInOnComplete?: boolean;
    linkedHabitAutoCheckInOptionKey?: string;
    linkedHabitAutoCheckInEmoji?: string;
}

const REMINDER_DATA_FILE = "reminder.json";

export class ReminderManager {
    private static instance: ReminderManager;
    private plugin: any;
    private reminders: ReminderData = {};
    private initialized = false;

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    public static getInstance(plugin?: any): ReminderManager {
        if (!ReminderManager.instance) {
            if (!plugin) throw new Error("ReminderManager needs plugin instance");
            ReminderManager.instance = new ReminderManager(plugin);
        } else if (plugin && !ReminderManager.instance.plugin) {
            ReminderManager.instance.plugin = plugin;
        }
        return ReminderManager.instance;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        await this.loadReminders();
        this.initialized = true;
    }

    private async loadReminders(): Promise<ReminderData> {
        const data = await this.plugin.loadData(REMINDER_DATA_FILE);
        this.reminders = data && typeof data === "object" ? data : {};
        return this.reminders;
    }

    /** 强制从文件重新加载任务数据，清除内存缓存 */
    public async reload(): Promise<void> {
        await this.loadReminders();
        this.initialized = true;
    }

    private async saveReminders(): Promise<void> {
        if (this.reminders && typeof this.reminders === 'object') {
            for (const key of Object.keys(this.reminders)) {
                if (this.reminders[key]) {
                    cleanReminderItem(this.reminders[key]);
                }
            }
        }
        await this.plugin.saveData(REMINDER_DATA_FILE, this.reminders);
    }

    async getAllReminders(): Promise<ReminderData> {
        await this.initialize();
        return { ...this.reminders };
    }

    async getReminderById(id: string): Promise<ReminderItem | undefined> {
        await this.initialize();
        return this.reminders[id];
    }

    async reminderExists(id: string): Promise<boolean> {
        await this.initialize();
        return !!this.reminders[id];
    }

    async searchReminders(options: SearchReminderOptions = {}): Promise<ReminderItem[]> {
        await this.initialize();
        
        let results: ReminderItem[];

        if (options.date) {
            const queryDate = options.date;
            const settings = (this.plugin && typeof this.plugin.loadSettings === 'function') ? await this.plugin.loadSettings() : {};
            const holidayData = (this.plugin && typeof this.plugin.loadHolidayData === 'function') ? await this.plugin.loadHolidayData() : {};
            const allRawReminders = await getEnvironmentSafeAllReminders(this.plugin, undefined, 'sidebar');
            const expandedReminders = ReminderTaskLogic.generateAllRemindersWithInstances(allRawReminders, queryDate, settings, holidayData);
            const activeTasks = ReminderTaskLogic.filterRemindersByTab(expandedReminders, queryDate, 'today', false, settings, holidayData);
            
            // 获取今日已完成的任务
            const completedTasks = expandedReminders.filter(r => {
                const isCompleted = r.completed || 
                    r.isSpanningTodayCompletedInstance || 
                    (r.dailyCompletions && r.dailyCompletions[queryDate] === true) ||
                    (r.dailyDessertCompleted && Array.isArray(r.dailyDessertCompleted) && r.dailyDessertCompleted.includes(queryDate));
                
                if (!isCompleted) return false;

                if (r.isSpanningTodayCompletedInstance || (r.dailyCompletions && r.dailyCompletions[queryDate] === true)) {
                    return true;
                }
                
                if (r.dailyDessertCompleted && Array.isArray(r.dailyDessertCompleted) && r.dailyDessertCompleted.includes(queryDate)) {
                    return true;
                }

                if (r.completedTime) {
                    try {
                        const completedDate = getLogicalDateString(new Date(r.completedTime.replace(' ', 'T')));
                        if (completedDate === queryDate) return true;
                    } catch (e) {
                        // ignore and fallback
                    }
                }

                const hasDate = r.date || r.endDate;
                if (hasDate) {
                    const taskDate = r.date || r.endDate;
                    return taskDate === queryDate;
                }

                return false;
            });

            const combined = [...activeTasks];
            const activeIds = new Set(activeTasks.map(t => t.id));
            completedTasks.forEach(t => {
                if (!activeIds.has(t.id)) {
                    combined.push(t);
                }
            });
            results = combined;
        } else {
            results = Object.values(this.reminders);
        }

        if (options.id) {
            results = results.filter((r) => r.id === options.id || (r as any).originalId === options.id);
        }

        if (options.projectId) {
            results = results.filter((r) => r.projectId === options.projectId);
        }

        if (options.priority) {
            results = results.filter((r) => (r.priority || "none") === options.priority);
        }

        if (options.status) {
            results = results.filter((r) => (r.kanbanStatus || "") === options.status);
        }

        if (options.completed !== undefined) {
            results = results.filter((r) => !!r.completed === options.completed);
        }

        if (options.keyword) {
            const kw = options.keyword.toLowerCase();
            results = results.filter((r) => {
                const title = (r.title || "").toLowerCase();
                const note = (r.note || "").toLowerCase();
                return title.includes(kw) || note.includes(kw);
            });
        }

        const limit = options.limit ?? 50;
        return results.slice(0, limit);
    }

    async createReminder(input: CreateReminderInput): Promise<ReminderItem> {
        await this.initialize();
        const title = input.title;
        const date = input.date ?? "";

        const now = new Date().toISOString();
        const id = `reminder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const reminder: ReminderItem = {
            id,
            title,
            date,
            completed: false,
            createdAt: now,
            ...input,
        };

        this.reminders[id] = reminder;
        await this.saveReminders();
        return reminder;
    }

    async updateReminders(updates: UpdateReminderInput[]): Promise<ReminderItem[]> {
        await this.initialize();
        const updated: ReminderItem[] = [];

        for (const update of updates) {
            const id = update.id;
            const existing = this.reminders[id];
            if (!existing) {
                continue;
            }

            const patched: ReminderItem = { ...existing };
            if (update.title !== undefined) patched.title = update.title;
            if (update.note !== undefined) patched.note = update.note;
            if (update.date !== undefined) patched.date = update.date;
            if (update.time !== undefined) patched.time = update.time;
            if (update.reminderTimes !== undefined) patched.reminderTimes = update.reminderTimes;
            if (update.endDate !== undefined) patched.endDate = update.endDate;
            if (update.endTime !== undefined) patched.endTime = update.endTime;
            if (update.priority !== undefined) patched.priority = update.priority;
            if (update.projectId !== undefined) patched.projectId = update.projectId;
            if (update.categoryId !== undefined) patched.categoryId = update.categoryId;
            if (update.completed !== undefined) patched.completed = update.completed;
            if (update.kanbanStatus !== undefined) patched.kanbanStatus = update.kanbanStatus;
            if (update.url !== undefined) patched.url = update.url;
            if (update.repeat !== undefined) patched.repeat = update.repeat;
            if (update.blockId !== undefined) patched.blockId = update.blockId;
            if (update.docId !== undefined) patched.docId = update.docId;
            if (update.customProgress !== undefined) patched.customProgress = update.customProgress;
            if (update.linkedHabitId !== undefined) patched.linkedHabitId = update.linkedHabitId;
            if (update.linkedHabitSyncPomodoroToday !== undefined) patched.linkedHabitSyncPomodoroToday = update.linkedHabitSyncPomodoroToday;
            if (update.linkedHabitAutoCheckInOnComplete !== undefined) patched.linkedHabitAutoCheckInOnComplete = update.linkedHabitAutoCheckInOnComplete;
            if (update.linkedHabitAutoCheckInOptionKey !== undefined) patched.linkedHabitAutoCheckInOptionKey = update.linkedHabitAutoCheckInOptionKey;
            if (update.linkedHabitAutoCheckInEmoji !== undefined) patched.linkedHabitAutoCheckInEmoji = update.linkedHabitAutoCheckInEmoji;

            this.reminders[id] = patched;
            updated.push(patched);
        }

        if (updated.length > 0) {
            await this.saveReminders();
        }
        return updated;
    }

    async deleteReminder(id: string): Promise<boolean> {
        await this.initialize();
        if (!this.reminders[id]) {
            return false;
        }
        delete this.reminders[id];
        await this.saveReminders();
        return true;
    }

    async getRemindersByProject(projectId: string): Promise<ReminderItem[]> {
        await this.initialize();
        return Object.values(this.reminders).filter((r) => r.projectId === projectId);
    }

    async getUndoneRemindersByProject(projectId: string): Promise<ReminderItem[]> {
        const tasks = await this.getRemindersByProject(projectId);
        return tasks.filter((r) => !r.completed);
    }

    async countByProject(projectId: string): Promise<{ total: number; undone: number }> {
        const tasks = await this.getRemindersByProject(projectId);
        const undone = tasks.filter((r) => !r.completed).length;
        return { total: tasks.length, undone };
    }
}
