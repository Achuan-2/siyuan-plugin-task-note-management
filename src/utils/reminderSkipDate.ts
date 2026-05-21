export type HolidayData = Record<string, { title?: string; type?: 'holiday' | 'workday' } | string>;

export type ReminderSkipWeekendMode = 'none' | 'saturdaySunday' | 'saturday' | 'sunday';

export const REMINDER_SKIP_WEEKEND_MODE_KEY = 'reminderSkipWeekendMode';
export const REMINDER_SKIP_WEEKENDS_KEY = 'reminderSkipWeekends';
export const REMINDER_SKIP_HOLIDAYS_KEY = 'reminderSkipHolidays';

export function normalizeReminderSkipWeekendMode(value: any): ReminderSkipWeekendMode | undefined {
    if (value === true) return 'saturdaySunday';
    if (value === false) return 'none';
    if (typeof value !== 'string') return undefined;

    switch (value) {
        case 'none':
        case 'saturdaySunday':
        case 'saturday':
        case 'sunday':
            return value;
        case 'both':
        case 'weekend':
        case 'weekends':
            return 'saturdaySunday';
        default:
            return undefined;
    }
}

function getStoredReminderSkipWeekendMode(source?: any): ReminderSkipWeekendMode | undefined {
    const explicitMode = normalizeReminderSkipWeekendMode(source?.[REMINDER_SKIP_WEEKEND_MODE_KEY]);
    if (explicitMode !== undefined) return explicitMode;
    return normalizeReminderSkipWeekendMode(source?.[REMINDER_SKIP_WEEKENDS_KEY]);
}

export function getGlobalReminderSkipWeekendMode(settings?: any): ReminderSkipWeekendMode {
    return getStoredReminderSkipWeekendMode(settings) || 'none';
}

export function getGlobalReminderSkipWeekends(settings?: any): boolean {
    return getGlobalReminderSkipWeekendMode(settings) !== 'none';
}

export function getGlobalReminderSkipHolidays(settings?: any): boolean {
    return settings?.[REMINDER_SKIP_HOLIDAYS_KEY] === true;
}

export function getReminderSkipWeekendModeEffective(reminder?: any, settings?: any): ReminderSkipWeekendMode {
    const reminderMode = getStoredReminderSkipWeekendMode(reminder);
    if (reminderMode !== undefined) {
        return reminderMode;
    }
    const repeatMode = getStoredReminderSkipWeekendMode(reminder?.repeat);
    if (repeatMode !== undefined) {
        return repeatMode;
    }
    return getGlobalReminderSkipWeekendMode(settings);
}

export function getReminderSkipWeekendsEffective(reminder?: any, settings?: any): boolean {
    return getReminderSkipWeekendModeEffective(reminder, settings) !== 'none';
}

export function getReminderSkipHolidaysEffective(reminder?: any, settings?: any): boolean {
    if (typeof reminder?.[REMINDER_SKIP_HOLIDAYS_KEY] === 'boolean') {
        return reminder[REMINDER_SKIP_HOLIDAYS_KEY];
    }
    if (typeof reminder?.repeat?.[REMINDER_SKIP_HOLIDAYS_KEY] === 'boolean') {
        return reminder.repeat[REMINDER_SKIP_HOLIDAYS_KEY];
    }
    return getGlobalReminderSkipHolidays(settings);
}

export function getReminderSkipWeekendModeOverrideValue(
    mode: ReminderSkipWeekendMode | string | boolean | undefined,
    settings?: any
): ReminderSkipWeekendMode | undefined {
    const normalizedMode = normalizeReminderSkipWeekendMode(mode) || 'none';
    const globalValue = getGlobalReminderSkipWeekendMode(settings);
    return normalizedMode === globalValue ? undefined : normalizedMode;
}

export function getReminderSkipWeekendsOverrideValue(checked: boolean, settings?: any): boolean | undefined {
    const globalValue = getGlobalReminderSkipWeekends(settings);
    return checked === globalValue ? undefined : checked;
}

export function getReminderSkipHolidaysOverrideValue(checked: boolean, settings?: any): boolean | undefined {
    const globalValue = getGlobalReminderSkipHolidays(settings);
    return checked === globalValue ? undefined : checked;
}

export function isWeekendDate(dateStr?: string): boolean {
    if (!dateStr) return false;
    const date = new Date(`${dateStr}T00:00:00`);
    if (isNaN(date.getTime())) return false;
    const day = date.getDay();
    return day === 0 || day === 6;
}

export function isWeekendSkippedDate(dateStr: string | undefined, mode: ReminderSkipWeekendMode): boolean {
    if (!dateStr || mode === 'none') return false;
    const date = new Date(`${dateStr}T00:00:00`);
    if (isNaN(date.getTime())) return false;
    const day = date.getDay();
    if (mode === 'saturdaySunday') return day === 0 || day === 6;
    if (mode === 'saturday') return day === 6;
    if (mode === 'sunday') return day === 0;
    return false;
}

export function isHolidayDate(dateStr: string | undefined, holidayData?: HolidayData): boolean {
    if (!dateStr || !holidayData) return false;
    const holiday = holidayData[dateStr];
    if (!holiday) return false;
    if (typeof holiday === 'string') return true;
    return holiday.type !== 'workday';
}

function addDaysToDate(dateStr: string, days: number): string {
    const date = new Date(`${dateStr}T00:00:00`);
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function hasValidDateRange(startDate?: string, endDate?: string): boolean {
    return !!startDate && !!endDate && startDate < endDate;
}

function isRepeatReminder(reminder?: any): boolean {
    return !!(
        reminder?.repeat?.enabled ||
        reminder?.isRepeatInstance ||
        reminder?.isRepeatedInstance
    );
}

function rangeHasSkippedAndAllowedDate(
    startDate: string | undefined,
    endDate: string | undefined,
    isSkipped: (date: string) => boolean
): boolean {
    if (!hasValidDateRange(startDate, endDate)) return false;

    let hasSkipped = false;
    let hasAllowed = false;
    let cursor = startDate!;

    while (cursor <= endDate!) {
        if (isSkipped(cursor)) {
            hasSkipped = true;
        } else {
            hasAllowed = true;
        }
        if (hasSkipped && hasAllowed) return true;
        cursor = addDaysToDate(cursor, 1);
    }

    return false;
}

function rangeHasMatchingDate(
    startDate: string | undefined,
    endDate: string | undefined,
    predicate: (date: string) => boolean
): boolean {
    if (!hasValidDateRange(startDate, endDate)) return false;

    let cursor = startDate!;
    while (cursor <= endDate!) {
        if (predicate(cursor)) return true;
        cursor = addDaysToDate(cursor, 1);
    }

    return false;
}

export function shouldShowReminderSkipWeekendsControl(
    reminder: any,
    startDate?: string,
    endDate?: string
): boolean {
    if (isRepeatReminder(reminder)) return true;
    return rangeHasMatchingDate(startDate, endDate, isWeekendDate);
}

export function shouldShowReminderSkipHolidaysControl(
    reminder: any,
    startDate?: string,
    endDate?: string,
    holidayData?: HolidayData
): boolean {
    if (isRepeatReminder(reminder)) return true;
    return rangeHasSkippedAndAllowedDate(startDate, endDate, date => isHolidayDate(date, holidayData));
}

export function shouldSkipReminderOnDate(
    reminder: any,
    dateStr: string | undefined,
    settings?: any,
    holidayData?: HolidayData
): boolean {
    if (!dateStr) return false;
    const isRepeat = isRepeatReminder(reminder);
    const weekendMode = getReminderSkipWeekendModeEffective(reminder, settings);
    const canApplyWeekendSkip = isRepeat ||
        rangeHasSkippedAndAllowedDate(
            reminder?.date,
            reminder?.endDate,
            date => isWeekendSkippedDate(date, weekendMode)
        );
    const canApplyHolidaySkip = isRepeat ||
        rangeHasSkippedAndAllowedDate(reminder?.date, reminder?.endDate, date => isHolidayDate(date, holidayData));

    if (
        canApplyWeekendSkip &&
        isWeekendSkippedDate(dateStr, weekendMode)
    ) {
        return true;
    }
    if (
        canApplyHolidaySkip &&
        getReminderSkipHolidaysEffective(reminder, settings) &&
        isHolidayDate(dateStr, holidayData)
    ) {
        return true;
    }
    return false;
}
