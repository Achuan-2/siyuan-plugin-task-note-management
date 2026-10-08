import type { Habit, HabitCheckIn, HabitCheckInEntry, HabitEmojiConfig, HabitGoalType } from "../../utils/habitUtils";

export interface CreateHabitInput {
    title: string;
    target?: number;
    goalType?: HabitGoalType;
    pomodoroTargetHours?: number;
    pomodoroTargetMinutes?: number;
    frequency?: {
        type: "daily" | "weekly" | "monthly" | "yearly" | "ebbinghaus" | "custom";
        interval?: number;
        weekdays?: number[];
        monthDays?: number[];
        months?: number[];
    };
    startDate: string;
    endDate?: string;
    icon?: string;
    color?: string;
    checkInEmojis?: HabitEmojiConfig[];
}

export interface UpdateHabitInput {
    title?: string;
    target?: number;
    goalType?: HabitGoalType;
    pomodoroTargetHours?: number;
    pomodoroTargetMinutes?: number;
    frequency?: {
        type: "daily" | "weekly" | "monthly" | "yearly" | "ebbinghaus" | "custom";
        interval?: number;
        weekdays?: number[];
        monthDays?: number[];
        months?: number[];
    };
    startDate?: string;
    endDate?: string;
    icon?: string;
    color?: string;
    checkInEmojis?: HabitEmojiConfig[];
    abandoned?: boolean;
}

export interface UpsertCheckinInput {
    date: string;
    entries?: HabitCheckInEntry[];
    count?: number;
    status?: string[];
}

const HABIT_DATA_FILE = "habit.json";
const HABIT_CHECKIN_DIR = "habitCheckin";
const HABIT_CHECKIN_DATA_KEYS = ["checkIns", "hasNotify", "totalCheckIns"] as const;

function getHabitCheckinFileName(habitId: string): string {
    return `${HABIT_CHECKIN_DIR}/${habitId}.json`;
}

function stripHabitCheckinData(habit: Record<string, any>): Record<string, any> {
    const baseHabit = { ...habit };
    for (const key of HABIT_CHECKIN_DATA_KEYS) {
        delete baseHabit[key];
    }
    return baseHabit;
}

function extractHabitCheckinData(habit: Record<string, any>): Record<string, any> {
    return {
        checkIns: habit.checkIns || {},
        hasNotify: habit.hasNotify || {},
        totalCheckIns: habit.totalCheckIns ?? 0,
    };
}

function mergeHabitWithCheckinData(habit: Record<string, any>, checkinData: any): Record<string, any> {
    const normalized = checkinData && typeof checkinData === "object" ? checkinData : {};
    return {
        ...habit,
        checkIns: normalized.checkIns || habit.checkIns || {},
        hasNotify: normalized.hasNotify || habit.hasNotify || {},
        totalCheckIns: normalized.totalCheckIns ?? habit.totalCheckIns ?? 0,
    };
}

export class HabitManager {
    private static instance: HabitManager;
    private plugin: any;
    private habits: Record<string, Habit> = {};
    private initialized = false;

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    public static getInstance(plugin?: any): HabitManager {
        if (!HabitManager.instance) {
            if (!plugin) throw new Error("HabitManager needs plugin instance");
            HabitManager.instance = new HabitManager(plugin);
        } else if (plugin && !HabitManager.instance.plugin) {
            HabitManager.instance.plugin = plugin;
        }
        return HabitManager.instance;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;
        await this.loadHabits();
        this.initialized = true;
    }

    private async loadHabits(): Promise<Record<string, Habit>> {
        const baseData = await this.plugin.loadData(HABIT_DATA_FILE);
        const mergedData: Record<string, Habit> = {};

        if (baseData && typeof baseData === "object") {
            await Promise.all(
                Object.entries(baseData).map(async ([habitId, habit]) => {
                    if (!habit || typeof habit !== "object") {
                        mergedData[habitId] = habit as Habit;
                        return;
                    }
                    const checkinData = await this.plugin.loadData(getHabitCheckinFileName(habitId));
                    mergedData[habitId] = mergeHabitWithCheckinData(habit as Record<string, any>, checkinData) as Habit;
                })
            );
        }

        this.habits = mergedData;
        return this.habits;
    }

    private async saveHabits(): Promise<void> {
        const baseData: Record<string, any> = {};
        const saveTasks: Promise<unknown>[] = [];

        Object.entries(this.habits).forEach(([habitId, habit]) => {
            if (!habit || typeof habit !== "object") {
                baseData[habitId] = habit;
                return;
            }
            baseData[habitId] = stripHabitCheckinData(habit as Record<string, any>);
            saveTasks.push(
                this.plugin.saveData(getHabitCheckinFileName(habitId), extractHabitCheckinData(habit as Record<string, any>))
            );
        });

        await this.plugin.saveData(HABIT_DATA_FILE, baseData);
        await Promise.all(saveTasks);
    }

    private async saveHabitPartial(habitId: string, habit: Habit): Promise<void> {
        this.habits[habitId] = habit;
        await this.plugin.saveData(getHabitCheckinFileName(habitId), extractHabitCheckinData(habit as Record<string, any>));

        const baseData: Record<string, any> = {};
        Object.entries(this.habits).forEach(([hid, h]) => {
            if (h) {
                baseData[hid] = stripHabitCheckinData(h as Record<string, any>);
            }
        });
        await this.plugin.saveData(HABIT_DATA_FILE, baseData);
    }

    async listHabits(activeOnly: boolean = false): Promise<Habit[]> {
        await this.initialize();
        const habits = Object.values(this.habits);
        if (activeOnly) {
            return habits.filter((h) => !h.abandoned);
        }
        return habits;
    }

    async getHabit(id: string): Promise<Habit | undefined> {
        await this.initialize();
        return this.habits[id];
    }

    async habitExists(id: string): Promise<boolean> {
        await this.initialize();
        return !!this.habits[id];
    }

    async createHabit(input: CreateHabitInput): Promise<Habit> {
        await this.initialize();
        const title = input.title;
        const startDate = input.startDate;

        const id = `habit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const now = new Date().toISOString();

        const habit: Habit = {
            id,
            title,
            target: input.target ?? 1,
            goalType: input.goalType ?? "count",
            pomodoroTargetHours: input.pomodoroTargetHours,
            pomodoroTargetMinutes: input.pomodoroTargetMinutes,
            frequency: input.frequency ?? { type: "daily" },
            startDate,
            icon: input.icon ?? "✨",
            color: input.color ?? "#4f46e5",
            checkInEmojis: input.checkInEmojis ?? [
                { emoji: "✅", meaning: "完成", countsAsSuccess: true },
            ],
            checkIns: {},
            totalCheckIns: 0,
            createdAt: now,
            updatedAt: now,
        };

        if (input.endDate) habit.endDate = input.endDate;

        this.habits[id] = habit;
        await this.saveHabits();
        return habit;
    }

    async updateHabit(id: string, input: UpdateHabitInput): Promise<Habit | undefined> {
        await this.initialize();
        const existing = this.habits[id];
        if (!existing) return undefined;

        const updated: Habit = { ...existing };
        if (input.title !== undefined) updated.title = input.title;
        if (input.target !== undefined) updated.target = input.target;
        if (input.goalType !== undefined) updated.goalType = input.goalType;
        if (input.pomodoroTargetHours !== undefined) updated.pomodoroTargetHours = input.pomodoroTargetHours;
        if (input.pomodoroTargetMinutes !== undefined) updated.pomodoroTargetMinutes = input.pomodoroTargetMinutes;
        if (input.frequency !== undefined) updated.frequency = input.frequency;
        if (input.startDate !== undefined) updated.startDate = input.startDate;
        if (input.endDate !== undefined) updated.endDate = input.endDate;
        if (input.icon !== undefined) updated.icon = input.icon;
        if (input.color !== undefined) updated.color = input.color;
        if (input.checkInEmojis !== undefined) updated.checkInEmojis = input.checkInEmojis;
        if (input.abandoned !== undefined) updated.abandoned = input.abandoned;

        updated.updatedAt = new Date().toISOString();
        this.habits[id] = updated;
        await this.saveHabits();
        return updated;
    }

    async deleteHabit(id: string): Promise<boolean> {
        await this.initialize();
        if (!this.habits[id]) return false;
        delete this.habits[id];
        await Promise.all([this.saveHabits(), this.plugin.removeData(getHabitCheckinFileName(id))]);
        return true;
    }

    async getHabitCheckins(id: string, startDate?: string, endDate?: string): Promise<Record<string, HabitCheckIn> | undefined> {
        await this.initialize();
        const habit = this.habits[id];
        if (!habit) return undefined;

        const checkIns = habit.checkIns || {};
        if (!startDate && !endDate) {
            return { ...checkIns };
        }

        const filtered: Record<string, HabitCheckIn> = {};
        Object.entries(checkIns).forEach(([date, checkin]) => {
            if (startDate && date < startDate) return;
            if (endDate && date > endDate) return;
            filtered[date] = checkin;
        });
        return filtered;
    }

    async upsertHabitCheckins(id: string, input: UpsertCheckinInput): Promise<HabitCheckIn | undefined> {
        await this.initialize();
        const habit = this.habits[id];
        if (!habit) return undefined;

        const date = input.date;

        const checkIns = { ...(habit.checkIns || {}) };
        const existing = checkIns[date] || { count: 0, status: [], timestamp: new Date().toISOString() };

        const updated: HabitCheckIn = { ...existing };
        if (input.count !== undefined) updated.count = input.count;
        if (input.status !== undefined) updated.status = input.status;
        if (input.entries !== undefined) updated.entries = input.entries;
        updated.timestamp = new Date().toISOString();

        checkIns[date] = updated;
        habit.checkIns = checkIns;
        habit.totalCheckIns = Object.keys(checkIns).length;
        habit.updatedAt = new Date().toISOString();

        await this.saveHabitPartial(id, habit);
        return updated;
    }
}
