import type { ReminderItem, ReminderData, ReminderTime } from "../../types/reminder";
import { getEnvironmentSafeAllReminders, cleanReminderItem } from "../../utils/reminderLoadUtils";
import { ReminderTaskLogic } from "../../utils/reminderTaskLogic";
import { getLogicalDateString } from "../../utils/dateUtils";
import {
    cloneReminderData,
    createNextReminderUpdatedAt,
    formatReminderDataConflicts,
    mergeReminderDataChanges,
} from "../../utils/reminderDataConcurrency";

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
    expectedUpdatedAt?: string;
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
    private mutationQueue: Promise<void> = Promise.resolve();

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

    private async readReminders(): Promise<ReminderData> {
        const data = await this.plugin.loadData(REMINDER_DATA_FILE);
        return data && typeof data === "object" ? data : {};
    }

    private async loadReminders(): Promise<ReminderData> {
        this.reminders = await this.readReminders();
        return this.reminders;
    }

    /** 强制从文件重新加载任务数据，清除内存缓存 */
    public async reload(): Promise<void> {
        await this.mutationQueue;
        await this.loadReminders();
        this.initialized = true;
    }

    private cleanReminders(reminders: ReminderData): void {
        if (reminders && typeof reminders === "object") {
            for (const key of Object.keys(reminders)) {
                if (reminders[key]) {
                    cleanReminderItem(reminders[key]);
                }
            }
        }
    }

    private enqueueMutation<T>(
        mutate: (latest: ReminderData) => Promise<{ result: T; changed: boolean }> | { result: T; changed: boolean },
    ): Promise<T> {
        const operation = this.mutationQueue.then(async () => {
            const latest = cloneReminderData(await this.readReminders());
            const { result, changed } = await mutate(latest);
            if (changed) {
                this.cleanReminders(latest);
                await this.plugin.saveData(REMINDER_DATA_FILE, latest);
            }
            this.reminders = latest;
            this.initialized = true;
            return result;
        });

        this.mutationQueue = operation.then(() => undefined, () => undefined);
        return operation;
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
        const reminders = await this.createReminders([input]);
        return reminders[0];
    }

    async createReminders(inputs: CreateReminderInput[]): Promise<ReminderItem[]> {
        return this.enqueueMutation(async (latest) => {
            for (const input of inputs) {
                if (input.parentId && !latest[input.parentId]) {
                    const instanceMatch = input.parentId.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
                    const originalParent = instanceMatch ? latest[instanceMatch[1]] : undefined;
                    if (!originalParent?.repeat?.enabled) {
                        throw new Error(`父任务已不存在或已被修改: ${input.parentId}`);
                    }
                }
            }

            const reminders = inputs.map((input) => {
                const now = createNextReminderUpdatedAt();
                const id = `reminder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                const reminder: ReminderItem = {
                    id,
                    title: input.title,
                    date: input.date ?? "",
                    completed: false,
                    createdAt: now,
                    updatedAt: now,
                    ...input,
                };
                latest[id] = reminder;
                return reminder;
            });

            return { result: reminders, changed: reminders.length > 0 };
        });
    }

    async updateReminders(updates: UpdateReminderInput[]): Promise<ReminderItem[]> {
        return this.enqueueMutation(async (latest) => {
            const updated: ReminderItem[] = [];
            for (const update of updates) {
                const id = update.id;
                const existing = latest[id];
                if (!existing) continue;
                if (update.expectedUpdatedAt !== undefined) {
                    const currentRevision = existing.updatedAt || existing.createdAt;
                    if (currentRevision !== update.expectedUpdatedAt) {
                        throw new Error(`任务已被其他操作修改，请重新读取后再更新: ${id}`);
                    }
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

                patched.updatedAt = createNextReminderUpdatedAt(existing.updatedAt || existing.createdAt);
                latest[id] = patched;
                updated.push(patched);
            }
            return { result: updated, changed: updated.length > 0 };
        });
    }

    async deleteReminder(id: string, expectedUpdatedAt?: string): Promise<boolean> {
        return this.enqueueMutation(async (latest) => {
            if (!latest[id]) return { result: false, changed: false };
            const currentRevision = latest[id].updatedAt || latest[id].createdAt;
            if (expectedUpdatedAt !== undefined && currentRevision !== expectedUpdatedAt) {
                throw new Error(`任务已被其他操作修改，请重新读取后再删除: ${id}`);
            }
            delete latest[id];
            return { result: true, changed: true };
        });
    }

    /**
     * 前端界面统一通过该入口保存。与 MCP 修改共用 mutationQueue，避免整文件覆盖。
     */
    async mergeReminderData(base: ReminderData, desired: ReminderData): Promise<ReminderData> {
        return this.enqueueMutation(async (latest) => {
            const merged = mergeReminderDataChanges(base, desired, latest);
            if (merged.conflicts.length > 0) {
                throw new Error(formatReminderDataConflicts(merged.conflicts));
            }
            Object.keys(latest).forEach((id) => delete latest[id]);
            Object.assign(latest, merged.data);
            return { result: cloneReminderData(latest), changed: merged.changed };
        });
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
