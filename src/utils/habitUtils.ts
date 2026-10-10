export type HabitGoalType = "count" | "pomodoro" | "either";

// 自动打卡的来源标识已写入历史记录，必须固定，不能随界面语言翻译。
export const POMODORO_TARGET_AUTO_CHECKIN_MEANING = "番茄达标自动补录";
export const POMODORO_PER_SESSION_AUTO_CHECKIN_MEANING = "自动番茄打卡";

export type HabitFrequencyType = "daily" | "weekly" | "monthly" | "yearly" | "ebbinghaus" | "custom" | "none";

export type HabitMemoSyncMode = "none" | "checkin" | "note";

export type HabitCheckInDaysMode = "streak" | "total";

export interface HabitFrequencyLike {
    type?: HabitFrequencyType;
    interval?: number;
    weekdays?: number[];
    monthDays?: number[];
    months?: number[];
}

export interface HabitReminderTimeEntry {
    time: string;
    endTime?: string;
    note?: string;
}

export interface HabitReminderTimeModification {
    reminderTimes?: (string | HabitReminderTimeEntry)[];
    modifiedAt?: string;
}

export interface HabitLike {
    id?: string;
    abandoned?: boolean;
    startDate?: string;
    endDate?: string;
    target?: number;
    goalType?: HabitGoalType;
    pomodoroTargetHours?: number;
    pomodoroTargetMinutes?: number;
    frequency?: HabitFrequencyLike;
    reminderTime?: string;
    reminderTimes?: (string | HabitReminderTimeEntry)[];
    reminderTimeModifications?: {
        [date: string]: HabitReminderTimeModification;
    };
    url?: string;
    habitMemoSyncMode?: HabitMemoSyncMode;
    habitMemoBlockId?: string;
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
    // Legacy flag kept for old data; new sync behavior is controlled by Habit.habitMemoSyncMode.
    syncMemoToBlock?: boolean;
    // Optional per-option override. Empty means use Habit.habitMemoBlockId.
    memoBlockId?: string;
}

export interface HabitCheckInEntry {
    emoji: string;
    timestamp: string;
    note?: string;
    meaning?: string;
    group?: string;
    memoBlockId?: string;
    memoSyncKey?: string;
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
    url?: string;
    habitMemoSyncMode?: HabitMemoSyncMode;
    habitMemoBlockId?: string;
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
    reminderTimeModifications?: {
        [date: string]: HabitReminderTimeModification;
    };
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
    return habit?.goalType === "either" ? "either" : habit?.goalType === "pomodoro" ? "pomodoro" : "count";
}

export function hasHabitPomodoroGoal(habit: HabitLike): boolean {
    return getHabitGoalType(habit) !== "count";
}

export function getHabitPomodoroTargetMinutes(habit: HabitLike): number {
    const hours = Math.max(0, Number(habit?.pomodoroTargetHours) || 0);
    const minutes = Math.max(0, Number(habit?.pomodoroTargetMinutes) || 0);
    const total = (hours * 60) + minutes;
    if (total > 0) return total;
    // 组合目标的 target 保存次数，不能作为番茄分钟数的回退值。
    if (getHabitGoalType(habit) === "either") return 30;
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
        case "none":
            // 仅记录实际发生的打卡，不生成应打卡日期。
            return false;
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

export interface HabitProgress {
    current: number;
    target: number;
    count: { current: number; target: number };
    pomodoro: { current: number; target: number };
}

export function getHabitProgressOnDate(
    habit: HabitLike,
    date: string,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): HabitProgress {
    const goalType = getHabitGoalType(habit);
    const count = {
        current: goalType === "either" ? getHabitSuccessfulCheckInCount(habit as Habit, date) : (habit?.checkIns?.[date]?.count || 0),
        target: Math.max(1, Number(habit?.target) || 1)
    };
    const pomodoro = {
        current: hasHabitPomodoroGoal(habit) && habit?.id && options?.getPomodoroFocusMinutes
            ? (options.getPomodoroFocusMinutes(habit.id, date) || 0) : 0,
        target: getHabitPomodoroTargetMinutes(habit)
    };
    if (goalType === "either") {
        // 使用较高的达标比例；两项不足的进度不能相加成为完成。
        return { current: Math.max(count.current / count.target, pomodoro.current / pomodoro.target), target: 1, count, pomodoro };
    }
    const progress = goalType === "pomodoro" ? pomodoro : count;
    return { ...progress, count, pomodoro };
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

export function isHabitCheckInDayComplete(
    habit: Habit,
    date: string,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): boolean {
    if (hasHabitPomodoroGoal(habit)) {
        return isHabitCompletedOnDate(habit, date, options);
    }

    return getHabitSuccessfulCheckInCount(habit, date) >= Math.max(1, Number(habit.target) || 1);
}

function getHabitSuccessfulCheckInCount(habit: Habit, date: string): number {
    const checkIn = habit?.checkIns?.[date];
    if (!checkIn) return 0;

    const emojis = Array.isArray(checkIn.entries) && checkIn.entries.length > 0
        ? checkIn.entries.map(entry => entry.emoji).filter(Boolean)
        : (checkIn.status || []).filter(Boolean);
    const successCount = emojis.length > 0
        ? emojis.filter(emoji => {
            const config = habit.checkInEmojis?.find(item => item.emoji === emoji);
            return config ? config.countsAsSuccess !== false : true;
        }).length
        : Math.max(0, Number(checkIn.count) || 0);

    return successCount;
}

function getPreviousDateString(date: string): string {
    const [year, month, day] = date.split('-').map(Number);
    const value = new Date(Date.UTC(year, month - 1, day));
    value.setUTCDate(value.getUTCDate() - 1);
    return [
        value.getUTCFullYear(),
        String(value.getUTCMonth() + 1).padStart(2, '0'),
        String(value.getUTCDate()).padStart(2, '0')
    ].join('-');
}

export function getHabitCompletedDaysCount(
    habit: Habit,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): number {
    return Object.keys(habit?.checkIns || {}).filter(date =>
        isHabitCheckInDayComplete(habit, date, options)
    ).length;
}

export function getHabitStreakDays(
    habit: Habit,
    asOfDate: string,
    options?: {
        getPomodoroFocusMinutes?: (habitId: string, logicalDate: string) => number;
    }
): number {
    if (habit.frequency?.type === "none") return 0;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) return 0;

    const startDate = habit?.startDate || asOfDate;
    let cursor = habit?.endDate && habit.endDate < asOfDate ? habit.endDate : asOfDate;
    if (cursor < startDate) return 0;

    let streak = 0;
    while (cursor >= startDate) {
        if (isHabitActiveOnDate(habit, cursor) && shouldCheckInOnDate(habit, cursor)) {
            if (isHabitCheckInDayComplete(habit, cursor, options)) {
                streak++;
            } else if (cursor !== asOfDate) {
                break;
            }
            // 今天仍有时间完成，因此今天未打卡暂不打断此前的连续记录。
        }
        cursor = getPreviousDateString(cursor);
    }

    return streak;
}

function normalizeHabitReminderTimes(
    reminderTimes?: (string | HabitReminderTimeEntry)[],
    reminderTime?: string
): HabitReminderTimeEntry[] {
    const entries: HabitReminderTimeEntry[] = [];
    if (Array.isArray(reminderTimes) && reminderTimes.length > 0) {
        for (const rt of reminderTimes) {
            if (typeof rt === "string") {
                entries.push({ time: rt });
            } else if (rt && typeof rt === "object" && typeof rt.time === "string" && rt.time) {
                entries.push({
                    time: rt.time,
                    endTime: typeof rt.endTime === "string" ? rt.endTime : undefined,
                    note: rt.note
                });
            }
        }
        return entries;
    }

    if (reminderTime) {
        entries.push({ time: reminderTime });
    }
    return entries;
}

export function getHabitReminderTimes(habit: HabitLike): HabitReminderTimeEntry[] {
    if (habit.frequency?.type === "none") return [];
    return normalizeHabitReminderTimes(habit?.reminderTimes, habit?.reminderTime);
}

export function getHabitReminderTimesForDate(habit: HabitLike, date: string): HabitReminderTimeEntry[] {
    if (habit.frequency?.type === "none") return [];
    const modification = date ? habit?.reminderTimeModifications?.[date] : undefined;
    if (modification && Array.isArray(modification.reminderTimes)) {
        return normalizeHabitReminderTimes(modification.reminderTimes);
    }
    return getHabitReminderTimes(habit);
}

export function formatHabitReminderTimeDisplay(entry: HabitReminderTimeEntry): string {
    if (!entry?.time) return "";
    if (entry.endTime && entry.endTime !== entry.time) {
        return `${entry.time} - ${entry.endTime}`;
    }
    return entry.time;
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
        if (habit?.abandoned === true) return false;
        if (!isHabitActiveOnDate(habit, today)) return false;
        return shouldCheckInOnDate(habit, today);
    });

    const pendingHabits = dueHabits.filter((habit) => !isHabitCompletedOnDate(habit, today, options));
    // 无固定频率没有待办要求，但当天完成的打卡仍进入已打卡列表。
    const completedHabits = habits.filter((habit) =>
        habit?.abandoned !== true && isHabitActiveOnDate(habit, today) &&
        (habit.frequency?.type === "none" || shouldCheckInOnDate(habit, today)) &&
        isHabitCompletedOnDate(habit, today, options)
    );

    return { dueHabits, pendingHabits, completedHabits };
}
