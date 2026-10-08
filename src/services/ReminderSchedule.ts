import { ReminderTimeScanner } from './ReminderTimeScanner';
import { getLocalDateString, getLogicalDateString } from '../utils/dateUtils';
import { getHabitReminderTimesForDate, shouldCheckInOnDate } from '../utils/habitUtils';
import type { HolidayData } from '../utils/reminderSkipDate';

export interface ReminderSchedule {
    /** 当天可触发的时间；相同分钟只注册一个任务。 */
    times: Set<string>;
    dayStart: string;
    retryAt?: Date;
}

export function normalizeReminderClock(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const match = value.trim().match(/(?:^|[T ])(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
    return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** 启动、数据变更或到点唤醒时生成计划；发送时仍读取最新完成状态。 */
export async function buildReminderSchedule(tasks: Record<string, any>, habits: Record<string, any>,
    settings: any, holidays: HolidayData, now: Date = new Date()): Promise<ReminderSchedule> {
    const times = new Set<string>();
    const add = (raw: unknown) => { const time = normalizeReminderClock(raw); if (time) times.add(time); };
    const scanner = new ReminderTimeScanner({
        settings, notifiedReminders: new Map(), hasReminderNotified: async () => false,
        markReminderNotified: async () => {},
        showTimeReminder: async (reminder, field, triggeredTime) => {
            add(field === 'reminderTimes' ? triggeredTime : reminder.time);
        }
    }, key => key);
    await scanner.check(tasks, getLocalDateString(now), null, holidays);
    const logicalDate = getLogicalDateString(now);
    for (const habit of Object.values(habits) as any[]) {
        if (!habit?.id || habit.abandoned || !shouldCheckInOnDate(habit, logicalDate)) continue;
        for (const entry of getHabitReminderTimesForDate(habit, logicalDate)) {
            const date = entry.time.split(/[T ]/);
            if (date.length > 1 && date[0] !== logicalDate) continue;
            add(entry.time);
        }
    }
    if (settings.dailyNotificationEnabled) {
        add(typeof settings.dailyNotificationTime === 'number'
            ? `${Math.max(0, Math.min(23, Math.floor(settings.dailyNotificationTime)))}:00`
            : settings.dailyNotificationTime || '08:00');
    }
    return { times, dayStart: normalizeReminderClock(settings.todayStartTime) || '03:00' };
}
