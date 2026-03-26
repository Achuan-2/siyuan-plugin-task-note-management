export type HabitGoalType = "count" | "pomodoro";

export type HabitFrequencyType = "daily" | "weekly" | "monthly" | "yearly" | "ebbinghaus" | "custom";

export interface HabitFrequencyLike {
    type?: HabitFrequencyType;
    interval?: number;
    weekdays?: number[];
    monthDays?: number[];
    months?: number[];
}

export interface HabitReminderTimeEntry {
    time: string;
    note?: string;
}

export interface HabitLike {
    id?: string;
    startDate?: string;
    endDate?: string;
    target?: number;
    goalType?: HabitGoalType;
    pomodoroTargetHours?: number;
    pomodoroTargetMinutes?: number;
    frequency?: HabitFrequencyLike;
    reminderTime?: string;
    reminderTimes?: (string | HabitReminderTimeEntry)[];
    checkIns?: {
        [date: string]: {
            count?: number;
        };
    };
}

export interface HabitEmojiConfig {
    emoji: string;
    meaning: string;
    value?: number;
    group?: string;
    promptNote?: boolean;
    countsAsSuccess?: boolean;
}

export interface HabitCheckInEntry {
    emoji: string;
    timestamp: string;
    note?: string;
    meaning?: string;
    group?: string;
}

export interface HabitCheckIn {
    count: number;
    status: string[];
    timestamp: string;
    entries?: HabitCheckInEntry[];
}

export interface Habit extends HabitLike {
    id: string;
    title: string;
    icon?: string;
    color?: string;
    note?: string;
    blockId?: string;
    target: number;
    goalType?: HabitGoalType;
    pomodoroTargetHours?: number;
    pomodoroTargetMinutes?: number;
    autoCheckInAfterPomodoro?: boolean;
    autoCheckInEmoji?: string;
    checkInButtonType?: 'pomodoro' | 'countup';
    frequency: {
        type: HabitFrequencyType;
        interval?: number;
        weekdays?: number[];
        monthDays?: number[];
        months?: number[];
    };
    startDate: string;
    endDate?: string;
    reminderTime?: string;
    reminderTimes?: (string | HabitReminderTimeEntry)[];
    groupId?: string;
    priority?: 'high' | 'medium' | 'low' | 'none';
    checkInEmojis: HabitEmojiConfig[];
    checkIns: {
        [date: string]: HabitCheckIn;
    };
    hasNotify?: { [date: string]: boolean | { [time: string]: boolean } };
    totalCheckIns: number;
    createdAt: string;
    updatedAt: string;
    hideCheckedToday?: boolean;
    sort?: number;
    abandoned?: boolean;
}

export function getHabitGoalType(habit: HabitLike): HabitGoalType {
    return habit?.goalType === "pomodoro" ? "pomodoro" : "count";
}

export function getHabitPomodoroTargetMinutes(habit: HabitLike): number {
    const hours = Math.max(0, Number(habit?.pomodoroTargetHours) || 0);
    const minutes = Math.max(0, Number(habit?.pomodoroTargetMinutes) || 0);
    const total = (hours * 60) + minutes;
    if (total > 0) return total;
    return Math.max(1, Number(habit?.target) || 1);
}

export function isHabitActiveOnDate(habit: HabitLike, date: string): boolean {
    if (!date) return false;
    if (habit?.startDate && habit.startDate > date) return false;
    if (habit?.endDate && habit.endDate < date) return false;
    return true;
}

export function shouldCheckInOnDate(habit: HabitLike, date: string): boolean {
    const frequency = habit?.frequency || { type: "daily" as HabitFrequencyType };
    const checkDate = new Date(date);
    const startDate = new Date(habit?.startDate || date);

    switch (frequency.type) {
        case "daily":
            if (frequency.interval) {
                const daysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                return daysDiff % frequency.interval === 0;
            }
            return true;

        case "weekly":
            if (frequency.weekdays && frequency.weekdays.length > 0) {
                return frequency.weekdays.includes(checkDate.getDay());
            }
            if (frequency.interval) {
                const weeksDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / (86400000 * 7));
                return weeksDiff % frequency.interval === 0 && checkDate.getDay() === startDate.getDay();
            }
            return checkDate.getDay() === startDate.getDay();

        case "monthly":
            if (frequency.monthDays && frequency.monthDays.length > 0) {
                return frequency.monthDays.includes(checkDate.getDate());
            }
            if (frequency.interval) {
                const monthsDiff = (checkDate.getFullYear() - startDate.getFullYear()) * 12 +
                    (checkDate.getMonth() - startDate.getMonth());
                return monthsDiff % frequency.interval === 0 && checkDate.getDate() === startDate.getDate();
            }
            return checkDate.getDate() === startDate.getDate();

        case "yearly":
            if (frequency.months && frequency.months.length > 0) {
                if (!frequency.months.includes(checkDate.getMonth() + 1)) return false;
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                return checkDate.getDate() === startDate.getDate();
            }
            if (frequency.interval) {
                const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                return yearsDiff % frequency.interval === 0 &&
                    checkDate.getMonth() === startDate.getMonth() &&
                    checkDate.getDate() === startDate.getDate();
            }
            return checkDate.getMonth() === startDate.getMonth() &&
                checkDate.getDate() === startDate.getDate();

        case "ebbinghaus":
            const ebbinghausDaysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
            const ebbinghausPattern = [1, 2, 4, 7, 15];
            const maxPatternDay = 15;
            if (ebbinghausDaysDiff < 0) return false;
            if (ebbinghausDaysDiff === 0) return true;
            if (ebbinghausPattern.includes(ebbinghausDaysDiff)) return true;
            return ebbinghausDaysDiff > maxPatternDay && (ebbinghausDaysDiff - maxPatternDay) % 15 === 0;

        case "custom":
            if (frequency.weekdays && frequency.weekdays.length > 0) {
                return frequency.weekdays.includes(checkDate.getDay());
            }
            if (frequency.monthDays && frequency.monthDays.length > 0) {
                return frequency.monthDays.includes(checkDate.getDate());
            }
            return true;

        default:
            return true;
    }
}

export function getHabitProgressOnDate(
    habit: HabitLike,
    date: string,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): { current: number; target: number } {
    if (getHabitGoalType(habit) === "pomodoro") {
        const target = getHabitPomodoroTargetMinutes(habit);
        const habitId = habit?.id || "";
        const current = habitId && options?.getPomodoroFocusMinutes
            ? (options.getPomodoroFocusMinutes(habitId, date) || 0)
            : 0;
        return { current, target };
    }

    const checkIn = habit?.checkIns?.[date];
    const current = checkIn?.count || 0;
    const target = Math.max(1, Number(habit?.target) || 1);
    return { current, target };
}

export function isHabitCompletedOnDate(
    habit: HabitLike,
    date: string,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): boolean {
    const { current, target } = getHabitProgressOnDate(habit, date, options);
    return current >= target;
}

export function getHabitReminderTimes(habit: HabitLike): HabitReminderTimeEntry[] {
    const entries: HabitReminderTimeEntry[] = [];
    if (Array.isArray(habit?.reminderTimes) && habit.reminderTimes.length > 0) {
        for (const rt of habit.reminderTimes) {
            if (typeof rt === "string") {
                entries.push({ time: rt });
            } else if (rt && typeof rt === "object" && typeof rt.time === "string" && rt.time) {
                entries.push({ time: rt.time, note: rt.note });
            }
        }
        return entries;
    }

    if (habit?.reminderTime) {
        entries.push({ time: habit.reminderTime });
    }
    return entries;
}

export function getTodayHabitBuckets(
    habits: HabitLike[],
    today: string,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): {
    dueHabits: HabitLike[];
    pendingHabits: HabitLike[];
    completedHabits: HabitLike[];
} {
    const dueHabits = habits.filter((habit) => {
        if (!isHabitActiveOnDate(habit, today)) return false;
        return shouldCheckInOnDate(habit, today);
    });

    const pendingHabits = dueHabits.filter((habit) => !isHabitCompletedOnDate(habit, today, options));
    const completedHabits = dueHabits.filter((habit) => isHabitCompletedOnDate(habit, today, options));

    return { dueHabits, pendingHabits, completedHabits };
}
