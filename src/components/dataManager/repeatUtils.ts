import { RepeatConfig, RepeatInstanceState } from '../dialog/RepeatSettingsDialog';
import { compareDateStrings, getLocalDateTimeString } from '../../utils/dateUtils';
import { i18n } from '../../pluginInstance';
import { solarToLunar, formatLunarMonth, formatLunarDay } from '../../utils/lunarUtils';
import { normalizeReminderSkipWeekendMode, type HolidayData, type ReminderSkipWeekendMode, shouldSkipReminderOnDate } from '../../utils/reminderSkipDate';

export interface RepeatInstance {
    title?: string; // 实例标题（可选，覆盖原始标题）
    date: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    reminderTimes?: Array<{ time: string, endTime?: string, note?: string }>; // 提醒时间列表
    customReminderPreset?: string; // 提醒预设
    blockId?: string | null;
    docId?: string | null;
    url?: string;
    instanceId: string; // 实例标识符
    originalId: string; // 原始提醒ID
    isRepeatedInstance: boolean;
    completed?: boolean; // 添加实例级别的完成状态
    completedTime?: string; // 实例完成时间
    notified?: boolean;
    customGroupName?: string;
    // 实例级别覆盖字段
    note?: string;
    priority?: string;
    categoryId?: string;
    projectId?: string;
    customGroupId?: string;
    kanbanStatus?: string;
    tagIds?: string[];
    milestoneId?: string;
    linkedHabitId?: string;
    linkedHabitSyncPomodoroToday?: boolean;
    linkedHabitAutoCheckInOnComplete?: boolean;
    linkedHabitAutoCheckInOptionKey?: string;
    linkedHabitAutoCheckInEmoji?: string;
    estimatedPomodoroDuration?: number;
    customProgress?: number;
    pinned?: boolean;
    hideInCalendar?: boolean;
    isAvailableToday?: boolean;
    availableStartDate?: string;
    treatStartDateAsDeadline?: boolean;
    reminderSkipWeekendMode?: ReminderSkipWeekendMode;
    reminderSkipWeekends?: boolean;
    reminderSkipHolidays?: boolean;
    sort?: number;
    preservedFromSeriesEdit?: boolean;
}

export interface ReminderTimeConfig {
    time: string;
    endTime?: string;
    note?: string;
    dayOffset?: number;
    dayIndex?: number;
    everyDay?: boolean;
}

function resolveReminderSkipWeekendMode(...sources: any[]): ReminderSkipWeekendMode | undefined {
    for (const source of sources) {
        const mode = normalizeReminderSkipWeekendMode(source?.reminderSkipWeekendMode) ||
            normalizeReminderSkipWeekendMode(source?.reminderSkipWeekends);
        if (mode !== undefined) return mode;
    }
    return undefined;
}

// ===================== 统一 repeat.instances 操作 helper =====================

export function parseReminderInstanceId(id?: string): { originalId: string; instanceDate: string } | null {
    if (!id || typeof id !== 'string') return null;
    const splitIndex = id.lastIndexOf('_');
    if (splitIndex <= 0 || splitIndex >= id.length - 1) return null;
    const originalId = id.substring(0, splitIndex);
    const instanceDate = id.substring(splitIndex + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(instanceDate)) return null;
    return { originalId, instanceDate };
}

export function getRepeatInstanceOriginalKey(instance: any): string {
    if (!instance) return '';
    const instanceId = (instance as any).instanceId || instance.id;
    if (typeof instanceId === 'string') {
        const parsed = parseReminderInstanceId(instanceId);
        if (parsed) return parsed.instanceDate;
    }
    return instance.date || '';
}

export function ensureRepeatInstances(reminder: any): Record<string, RepeatInstanceState> {
    if (!reminder.repeat) reminder.repeat = {};
    if (!reminder.repeat.instances) reminder.repeat.instances = {};
    return reminder.repeat.instances;
}

export function getRepeatInstanceState(reminder: any, dateKey: string): RepeatInstanceState | undefined {
    return reminder?.repeat?.instances?.[dateKey];
}

export function getInstanceField<T>(
    state: RepeatInstanceState | undefined,
    field: keyof RepeatInstanceState,
    fallback: T
): T {
    if (!state || !Object.prototype.hasOwnProperty.call(state, field)) return fallback;
    const val = (state as any)[field];
    return val !== undefined ? val : fallback;
}

export function hasInstanceField(state: RepeatInstanceState | undefined, field: keyof RepeatInstanceState): boolean {
    return !!state && Object.prototype.hasOwnProperty.call(state, field) && (state as any)[field] !== undefined;
}

export function patchRepeatInstanceState(
    reminder: any,
    dateKey: string,
    patch: Partial<RepeatInstanceState>
): RepeatInstanceState {
    const instances = ensureRepeatInstances(reminder);
    const existing = instances[dateKey] || {};
    const updatedPatch = { ...patch };
    if (patch.hasOwnProperty('date') && patch.date === null) {
        updatedPatch.deleted = true;
    }
    instances[dateKey] = {
        ...existing,
        ...updatedPatch,
        modifiedAt: getLocalDateString(new Date())
    };
    return instances[dateKey];
}

export function setRepeatInstanceOverride<T extends keyof RepeatInstanceState>(
    reminder: any,
    dateKey: string,
    field: T,
    value: RepeatInstanceState[T] | undefined
): void {
    const instances = ensureRepeatInstances(reminder);
    const existing = instances[dateKey] || {};
    if (value === undefined) {
        delete (existing as any)[field];
    } else {
        (existing as any)[field] = value;
    }
    existing.modifiedAt = getLocalDateString(new Date());
    instances[dateKey] = existing;
}

export function setRepeatInstanceCompletion(
    reminder: any,
    dateKey: string,
    completed: boolean,
    completedTime?: string
): boolean {
    const state = ensureRepeatInstances(reminder);
    const existing = state[dateKey] || {};
    let changed = false;
    if (existing.completed !== completed) {
        existing.completed = completed;
        changed = true;
    }
    if (completed) {
        const time = completedTime || getLocalDateTimeString(new Date());
        if (existing.completedTime !== time) {
            existing.completedTime = time;
            changed = true;
        }
    } else if (existing.completedTime !== undefined) {
        delete existing.completedTime;
        changed = true;
    }
    existing.modifiedAt = getLocalDateString(new Date());
    state[dateKey] = existing;
    return changed;
}

export function isRepeatInstanceCompleted(reminder: any, dateKey: string): boolean {
    return !!getRepeatInstanceState(reminder, dateKey)?.completed;
}

export function getRepeatInstanceCompletedTime(reminder: any, dateKey: string): string | undefined {
    return getRepeatInstanceState(reminder, dateKey)?.completedTime;
}

export function removeRepeatInstance(reminder: any, dateKey: string): void {
    patchRepeatInstanceState(reminder, dateKey, { deleted: true });
}

export function deleteRepeatInstanceState(reminder: any, dateKey: string): void {
    const instances = reminder?.repeat?.instances;
    if (instances) delete instances[dateKey];
}

// ===================== 统一 repeat.instances 操作 helper 结束 =====================

/**
 * 将 Date 对象转换为 YYYY-MM-DD 格式的本地日期字符串
 */
function getLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function extractDateAndTimeParts(value?: string): { date?: string | null; time?: string | null } {
    if (!value || typeof value !== 'string') return { date: null, time: null };
    if (value.includes('T')) {
        const [datePart, timePart] = value.split('T');
        if (!timePart) return { date: datePart, time: null };
        return { date: datePart, time: timePart.split(':').slice(0, 2).join(':') };
    }
    if (value.includes(' ')) {
        const [datePart, timePart] = value.split(' ');
        return { date: datePart, time: (timePart || '').split(':').slice(0, 2).join(':') || null };
    }
    if (value.split(':').length >= 2) {
        return { date: null, time: value.split(':').slice(0, 2).join(':') };
    }
    return { date: null, time: null };
}

function normalizeReminderTimeEntry(entry: any): ReminderTimeConfig | null {
    if (!entry) return null;
    if (typeof entry === 'string') {
        return { time: entry };
    }
    if (typeof entry === 'object' && typeof entry.time === 'string') {
        return {
            time: entry.time,
            endTime: typeof entry.endTime === 'string' ? entry.endTime : undefined,
            note: entry.note,
            dayOffset: typeof entry.dayOffset === 'number' ? entry.dayOffset : undefined,
            dayIndex: typeof entry.dayIndex === 'number' ? entry.dayIndex : undefined,
            everyDay: typeof entry.everyDay === 'boolean' ? entry.everyDay : undefined,
            overrides: entry.overrides
        };
    }
    return null;
}

export function getReminderTaskDurationDays(date?: string, endDate?: string): number {
    if (!date) return 1;
    if (!endDate) return 1;
    return Math.max(getDaysDifference(date, endDate) + 1, 1);
}

function getReminderEntryRelativeOffset(
    entry: ReminderTimeConfig,
    taskDate?: string,
    taskEndDate?: string
): number {
    const durationDays = getReminderTaskDurationDays(taskDate, taskEndDate);

    if (typeof entry.dayIndex === 'number') {
        const normalizedDayIndex = Math.min(Math.max(Math.trunc(entry.dayIndex), 1), durationDays);
        return normalizedDayIndex - 1;
    }

    if (typeof entry.dayOffset === 'number') {
        const normalizedDayOffset = Math.trunc(entry.dayOffset);
        return normalizedDayOffset <= 0 ? normalizedDayOffset : normalizedDayOffset - 1;
    }

    const parsed = extractDateAndTimeParts(entry.time);
    if (parsed.date && taskDate) {
        return getDaysDifference(taskDate, parsed.date);
    }

    return 0;
}

export function getRelativeReminderWindow(
    reminderTimes: any[] | undefined,
    taskDate?: string,
    taskEndDate?: string
): { lookBackDays: number; lookAheadDays: number } {
    if (!Array.isArray(reminderTimes) || reminderTimes.length === 0) {
        return { lookBackDays: 0, lookAheadDays: 0 };
    }

    let minOffset = 0;
    let maxOffset = 0;

    reminderTimes.forEach((item) => {
        const entry = normalizeReminderTimeEntry(item);
        if (!entry) return;
        const offset = getReminderEntryRelativeOffset(entry, taskDate, taskEndDate);
        minOffset = Math.min(minOffset, offset);
        maxOffset = Math.max(maxOffset, offset);
    });

    return {
        lookBackDays: Math.max(maxOffset, 0),
        lookAheadDays: Math.max(-minOffset, 0)
    };
}

export function resolveRepeatReminderTimes(
    reminderTimes: any[] | undefined,
    instanceDate: string,
    instanceEndDate?: string,
    originalTaskDate?: string,
    originalTaskEndDate?: string
): ReminderTimeConfig[] | undefined {
    if (!Array.isArray(reminderTimes) || reminderTimes.length === 0) {
        return undefined;
    }

    const durationDays = getReminderTaskDurationDays(instanceDate, instanceEndDate);

    const resolveEntryDateTime = (value: string | undefined, item: ReminderTimeConfig, customDate?: string): string | undefined => {
        if (!value) return undefined;
        const parsed = extractDateAndTimeParts(value);
        if (!parsed.time) return undefined;

        let resolvedDate = customDate || parsed.date || instanceDate;
        if (!customDate) {
            if (typeof item.dayIndex === 'number') {
                const dayIndex = Math.min(Math.max(Math.trunc(item.dayIndex), 1), durationDays);
                resolvedDate = addDaysToDate(instanceDate, dayIndex - 1);
            } else if (typeof item.dayOffset === 'number') {
                const dayOffset = Math.trunc(item.dayOffset);
                resolvedDate = addDaysToDate(instanceDate, dayOffset <= 0 ? dayOffset : dayOffset - 1);
            } else if (!parsed.date && originalTaskDate) {
                const offset = getReminderEntryRelativeOffset(item, originalTaskDate, originalTaskEndDate);
                resolvedDate = addDaysToDate(instanceDate, offset);
            }
        }

        return `${resolvedDate}T${parsed.time}`;
    };

    const resolved: ReminderTimeConfig[] = [];

    reminderTimes
        .map((item) => normalizeReminderTimeEntry(item))
        .filter((item): item is ReminderTimeConfig => !!item)
        .forEach((item) => {
            if (item.everyDay && durationDays > 1) {
                for (let i = 0; i < durationDays; i++) {
                    const customDate = addDaysToDate(instanceDate, i);
                    const override = item.overrides?.[customDate];
                    const activeTime = override ? override.time : item.time;
                    const activeEndTime = override ? override.endTime : item.endTime;
                    const resolvedTime = resolveEntryDateTime(activeTime, item, customDate);
                    if (resolvedTime) {
                        resolved.push({
                            time: resolvedTime,
                            endTime: resolveEntryDateTime(activeEndTime, item, customDate),
                            note: item.note,
                            everyDay: true,
                            overrides: item.overrides
                        });
                    }
                }
            } else {
                const resolvedTime = resolveEntryDateTime(item.time, item);
                if (resolvedTime) {
                    resolved.push({
                        time: resolvedTime,
                        endTime: resolveEntryDateTime(item.endTime, item),
                        note: item.note,
                        overrides: item.overrides
                    });
                }
            }
        });

    return resolved.length > 0 ? resolved : undefined;
}

function getEffectiveMonthDays(year: number, month: number, monthDays: number[]): number[] {
    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();
    return Array.from(new Set(monthDays.map(day => Math.min(day, lastDayOfMonth)))).sort((a, b) => a - b);
}

function isValidMonthlyWeekOrder(order: number): boolean {
    return order === -1 || (order >= 1 && order <= 5);
}

function isValidMonthlyWeekday(weekday: number): boolean {
    return weekday >= 0 && weekday <= 6;
}

function getMonthlyWeekRuleSortRank(rule: { order: number; weekday: number }): number {
    const orderRank = rule.order === -1 ? 6 : rule.order;
    const weekdayRank = rule.weekday === 0 ? 7 : rule.weekday;
    return orderRank * 10 + weekdayRank;
}

export function getMonthlyWeekRules(repeatConfig: RepeatConfig | any): Array<{ order: number; weekday: number }> {
    if (repeatConfig?.monthlyRepeatMode !== 'weekday') {
        return [];
    }

    const rules: Array<{ order: number; weekday: number }> = [];
    const seen = new Set<string>();
    const appendRule = (orderValue: any, weekdayValue: any) => {
        const order = Number(orderValue);
        const weekday = Number(weekdayValue);
        if (!isValidMonthlyWeekOrder(order) || !isValidMonthlyWeekday(weekday)) return;
        const key = `${order}:${weekday}`;
        if (seen.has(key)) return;
        seen.add(key);
        rules.push({ order, weekday });
    };

    if (Array.isArray(repeatConfig.monthlyWeekRules)) {
        repeatConfig.monthlyWeekRules.forEach((rule: any) => appendRule(rule?.order, rule?.weekday));
    }

    if (rules.length === 0) {
        appendRule(repeatConfig.monthlyWeekOrder, repeatConfig.monthlyWeekday);
    }

    return rules.sort((a, b) => getMonthlyWeekRuleSortRank(a) - getMonthlyWeekRuleSortRank(b));
}

export function getMonthlyWeekdayDate(year: number, month: number, order: number, weekday: number): number | null {
    if (!(order === -1 || (order >= 1 && order <= 5)) || weekday < 0 || weekday > 6) {
        return null;
    }

    const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

    if (order === -1) {
        const lastDate = new Date(year, month, lastDayOfMonth);
        const daysBack = (lastDate.getDay() - weekday + 7) % 7;
        return lastDayOfMonth - daysBack;
    }

    const firstDate = new Date(year, month, 1);
    const daysToFirstWeekday = (weekday - firstDate.getDay() + 7) % 7;
    const targetDay = 1 + daysToFirstWeekday + (order - 1) * 7;
    return targetDay <= lastDayOfMonth ? targetDay : null;
}

function getMonthlyWeekOrderText(order: number): string {
    switch (order) {
        case 1:
            return '第一个';
        case 2:
            return '第二个';
        case 3:
            return '第三个';
        case 4:
            return '第四个';
        case 5:
            return '第五个';
        case -1:
            return '最后一个';
        default:
            return '';
    }
}

/**
 * 生成重复事件实例
 */
export function generateRepeatInstances(
    reminder: any,
    startDate: string,
    endDate: string,
    maxInstances: number = 100,
    options: { settings?: any; holidayData?: HolidayData } = {}
): RepeatInstance[] {
    if (!reminder.repeat?.enabled || !reminder.repeat.type) {
        return [];
    }

    const instances: RepeatInstance[] = [];
    const repeatConfig = reminder.repeat;

    // 对于农历重复任务，如果没有设置 reminder.date，使用 startDate 作为起始日期
    // 对于其他类型的重复任务，必须有 reminder.date
    let currentDate: Date;
    if (reminder.date) {
        currentDate = new Date(reminder.date + 'T00:00:00');
    } else if (repeatConfig.type === 'lunar-monthly' || repeatConfig.type === 'lunar-yearly') {
        // 农历重复任务没有 startDate 时，从查询范围的开始日期开始生成
        currentDate = new Date(startDate + 'T00:00:00');
    } else {
        // 非农历重复任务必须有 startDate
        return [];
    }

    const endDateObj = new Date(endDate + 'T23:59:59');
    let instanceCount = 0;

    // 获取排除日期列表与统一实例状态表
    const excludeDates = repeatConfig.excludeDates || [];
    const instancesMap: Record<string, RepeatInstanceState> = repeatConfig.instances || {};

    // 检查重复结束条件
    const hasEndDate = repeatConfig.endType === 'date' && repeatConfig.endDate;
    const hasEndCount = repeatConfig.endType === 'count' && repeatConfig.endCount;
    const repeatEndDate = hasEndDate ? new Date(repeatConfig.endDate + 'T23:59:59') : null;

    const generatedInstanceKeys = new Set<string>();
    const resolveOccurrenceDate = (originalDate: string, state?: RepeatInstanceState): string | null => {
        if (state?.deleted || state?.date === null) return null;
        if (repeatConfig.skippedDateAction !== 'postpone' || hasInstanceField(state, 'date')) {
            return originalDate;
        }

        // 实例 ID 始终使用原周期日期；仅移动显示和提醒日期，不改变后续周期的基准。
        // 一年内仍没有可用日时停止查找，避免异常配置导致无限循环。
        const skipCandidate = { ...reminder, ...state, repeat: repeatConfig, isRepeatedInstance: true };
        let candidateDate = originalDate;
        for (let day = 0; day < 366; day++) {
            if (!shouldSkipReminderOnDate(skipCandidate, candidateDate, options.settings, options.holidayData)) {
                return candidateDate;
            }
            candidateDate = addDaysToDate(candidateDate, 1);
        }
        return null;
    };
    const buildInstance = (originalDateKey: string, occurrenceDateStr: string, state?: RepeatInstanceState): RepeatInstance | null => {
        if (state?.deleted || state?.date === null) {
            return null;
        }

        const instanceDate = getInstanceField(state, 'date', occurrenceDateStr) || occurrenceDateStr;
        const defaultEndDate = reminder.endDate && reminder.date
            ? addDaysToDate(instanceDate, getDaysDifference(reminder.date, reminder.endDate))
            : undefined;
        const instanceEndDate = getInstanceField(state, 'endDate', defaultEndDate);
        const reminderTimesSource = getInstanceField(state, 'reminderTimes', reminder.reminderTimes);
        const reminderTimes = state?.preservedFromSeriesEdit
            ? reminderTimesSource || undefined
            : resolveRepeatReminderTimes(
                reminderTimesSource,
                instanceDate,
                instanceEndDate,
                reminder.date,
                reminder.endDate
            );
        const isInstanceCompleted = !!state?.completed;
        const skipWeekendMode = hasInstanceField(state, 'reminderSkipWeekendMode') || hasInstanceField(state, 'reminderSkipWeekends')
            ? resolveReminderSkipWeekendMode(state)
            : resolveReminderSkipWeekendMode(reminder, repeatConfig);

        return {
            title: getInstanceField(state, 'title', reminder.title),
            date: instanceDate,
            time: getInstanceField(state, 'time', reminder.time),
            endDate: instanceEndDate,
            endTime: getInstanceField(state, 'endTime', reminder.endTime),
            reminderTimes,
            customReminderPreset: getInstanceField(state, 'customReminderPreset', reminder.customReminderPreset),
            blockId: getInstanceField(state, 'blockId', reminder.blockId),
            docId: getInstanceField(state, 'docId', reminder.docId),
            url: getInstanceField(state, 'url', reminder.url),
            instanceId: `${reminder.id}_${originalDateKey}`,
            originalId: reminder.id,
            isRepeatedInstance: true,
            completed: isInstanceCompleted,
            completedTime: isInstanceCompleted ? getInstanceField(state, 'completedTime', undefined) : undefined,
            note: getInstanceField(state, 'note', reminder.note || ''),
            priority: getInstanceField(state, 'priority', reminder.priority || 'none'),
            categoryId: getInstanceField(state, 'categoryId', reminder.categoryId),
            projectId: getInstanceField(state, 'projectId', reminder.projectId),
            customGroupId: getInstanceField(state, 'customGroupId', reminder.customGroupId),
            kanbanStatus: getInstanceField(state, 'kanbanStatus', reminder.kanbanStatus),
            tagIds: getInstanceField(state, 'tagIds', reminder.tagIds),
            milestoneId: getInstanceField(state, 'milestoneId', reminder.milestoneId),
            linkedHabitId: getInstanceField(state, 'linkedHabitId', reminder.linkedHabitId),
            linkedHabitSyncPomodoroToday: getInstanceField(state, 'linkedHabitSyncPomodoroToday', reminder.linkedHabitSyncPomodoroToday),
            linkedHabitAutoCheckInOnComplete: getInstanceField(state, 'linkedHabitAutoCheckInOnComplete', reminder.linkedHabitAutoCheckInOnComplete),
            linkedHabitAutoCheckInOptionKey: getInstanceField(state, 'linkedHabitAutoCheckInOptionKey', reminder.linkedHabitAutoCheckInOptionKey),
            linkedHabitAutoCheckInEmoji: getInstanceField(state, 'linkedHabitAutoCheckInEmoji', reminder.linkedHabitAutoCheckInEmoji),
            estimatedPomodoroDuration: getInstanceField(state, 'estimatedPomodoroDuration', reminder.estimatedPomodoroDuration),
            customProgress: getInstanceField(state, 'customProgress', reminder.customProgress),
            pinned: getInstanceField(state, 'pinned', reminder.pinned),
            hideInCalendar: getInstanceField(state, 'hideInCalendar', reminder.hideInCalendar),
            isAvailableToday: getInstanceField(state, 'isAvailableToday', reminder.isAvailableToday),
            availableStartDate: getInstanceField(state, 'availableStartDate', reminder.availableStartDate),
            treatStartDateAsDeadline: getInstanceField(state, 'treatStartDateAsDeadline', reminder.treatStartDateAsDeadline),
            reminderSkipWeekendMode: skipWeekendMode,
            reminderSkipHolidays: getInstanceField(
                state,
                'reminderSkipHolidays',
                reminder.reminderSkipHolidays !== undefined ? reminder.reminderSkipHolidays : repeatConfig.reminderSkipHolidays
            ),
            sort: getInstanceField(state, 'sort', reminder.sort || 0),
            preservedFromSeriesEdit: state?.preservedFromSeriesEdit === true
        };
    };

    while (currentDate <= endDateObj && instanceCount < maxInstances) {
        const currentDateStr = getLocalDateString(currentDate); // 使用本地日期字符串

        // 结束条件仍按原周期日期判断，顺延不会改变下一个周期。
        if (hasEndDate && repeatEndDate && currentDate > repeatEndDate) {
            break;
        }
        if (hasEndCount && instanceCount >= repeatConfig.endCount) {
            break;
        }

        // 先按重复规则确定原周期，再判断顺延后的发生日是否落在查询范围。
        if (shouldGenerateInstance(currentDate, reminder.date || startDate, repeatConfig) &&
            !excludeDates.includes(currentDateStr)) {
            const state = instancesMap[currentDateStr];
            const occurrenceDate = resolveOccurrenceDate(currentDateStr, state);
            if (occurrenceDate &&
                compareDateStrings(occurrenceDate, startDate) >= 0 &&
                compareDateStrings(occurrenceDate, endDate) <= 0) {
                generatedInstanceKeys.add(currentDateStr);
                const instance = buildInstance(currentDateStr, occurrenceDate, state);
                if (instance) {
                    instances.push(instance);
                    instanceCount++;
                }
            }
        }

        // 移动到下一个可能的日期
        currentDate = getNextDate(currentDate, repeatConfig);
    }

    Object.entries(instancesMap).forEach(([originalDateKey, state]) => {
        if (!state?.preservedFromSeriesEdit || generatedInstanceKeys.has(originalDateKey) || state?.deleted) {
            return;
        }
        if (excludeDates.includes(originalDateKey)) {
            return;
        }
        const instanceDate = state.date || originalDateKey;
        if (compareDateStrings(instanceDate, startDate) < 0 || compareDateStrings(instanceDate, endDate) > 0) {
            return;
        }
        const instance = buildInstance(originalDateKey, originalDateKey, state);
        if (instance) {
            instances.push(instance);
        }
    });

    instances.sort((a, b) => {
        const dateCompare = compareDateStrings(a.date, b.date);
        if (dateCompare !== 0) return dateCompare;
        const timeCompare = (a.time || '').localeCompare(b.time || '');
        if (timeCompare !== 0) return timeCompare;
        return a.instanceId.localeCompare(b.instanceId);
    });

    return instances;
}

/**
 * 生成重复实例，并保证视野内至少存在一个未来的未完成实例。
 * 如果当前窗口内没有未来未完成实例，会自动扩展窗口重试。
 */
export function generateRepeatInstancesWithFutureGuarantee(
    reminder: any,
    today: string,
    options: {
        isLunarRepeat?: boolean;
        settings?: any;
        holidayData?: any;
        maxAttempts?: number;
        startDate?: string;
    } = {}
): RepeatInstance[] {
    const {
        isLunarRepeat = false,
        settings,
        holidayData,
        maxAttempts = 5,
        startDate: requestedStartDate
    } = options;
    let monthsToAdd = isLunarRepeat
        ? 14
        : reminder.repeat?.type === 'yearly'
            ? 14
            : reminder.repeat?.type === 'monthly'
                ? 3
                : 2;

    let repeatInstances: RepeatInstance[] = [];
    let hasUncompletedFutureInstance = false;
    let attempts = 0;

    while (!hasUncompletedFutureInstance && attempts < maxAttempts) {
        const monthStart = requestedStartDate
            ? new Date(requestedStartDate + 'T00:00:00')
            : new Date();
        monthStart.setDate(1);
        monthStart.setMonth(monthStart.getMonth() - 1);

        const monthEnd = new Date();
        monthEnd.setMonth(monthEnd.getMonth() + monthsToAdd);
        monthEnd.setDate(0);

        const rangeStartDate = getLocalDateString(monthStart);
        const rangeEndDate = getLocalDateString(monthEnd);
        const maxInstances = monthsToAdd * 50;

        repeatInstances = generateRepeatInstances(reminder, rangeStartDate, rangeEndDate, maxInstances, { settings, holidayData })
            .filter(instance => !shouldSkipReminderOnDate(instance, instance.date, settings, holidayData));

        hasUncompletedFutureInstance = repeatInstances.some(instance => {
            const originalKey = getRepeatInstanceOriginalKey(instance);
            return compareDateStrings(instance.date, today) > 0 && !isRepeatInstanceCompleted(reminder, originalKey);
        });

        if (!hasUncompletedFutureInstance) {
            if (reminder.repeat?.type === 'yearly' || isLunarRepeat) monthsToAdd += 12;
            else monthsToAdd += 6;
            attempts++;
        }
    }

    return repeatInstances;
}

/**
 * 判断是否应该在指定日期生成实例
 */
function shouldGenerateInstance(currentDate: Date, originalDate: string, repeatConfig: RepeatConfig): boolean {
    const originalDateObj = new Date(originalDate + 'T00:00:00');

    switch (repeatConfig.type) {
        case 'daily':
            const daysDiff = Math.floor((currentDate.getTime() - originalDateObj.getTime()) / (24 * 60 * 60 * 1000));
            return daysDiff >= 0 && daysDiff % (repeatConfig.interval || 1) === 0;

        case 'weekly':
            // 支持“每隔 X 周”的逻辑：无论是否指定多个星期几，都以原始日期为基准按周数间隔判断
            if (currentDate < originalDateObj) {
                return false;
            }
            const weeksDiff = Math.floor((currentDate.getTime() - originalDateObj.getTime()) / (7 * 24 * 60 * 60 * 1000));
            const interval = repeatConfig.interval || 1;

            // 当指定了 weekDays 时，检查当前日期是否为指定的星期且与原始周数间隔匹配
            if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
                const isWeekdayMatched = repeatConfig.weekDays.includes(currentDate.getDay());
                return isWeekdayMatched && (weeksDiff % interval === 0);
            }

            // 否则按原有逻辑：检查与原始日期的星期是否相同并满足间隔
            const sameWeekday = currentDate.getDay() === originalDateObj.getDay();
            return weeksDiff >= 0 && weeksDiff % interval === 0 && sameWeekday;

        case 'monthly':
            const monthsDiff = (currentDate.getFullYear() - originalDateObj.getFullYear()) * 12 +
                (currentDate.getMonth() - originalDateObj.getMonth());
            const monthlyInterval = repeatConfig.interval || 1;
            const matchesMonthlyInterval = currentDate >= originalDateObj &&
                monthsDiff >= 0 &&
                monthsDiff % monthlyInterval === 0;

            const monthlyWeekRules = getMonthlyWeekRules(repeatConfig);
            if (monthlyWeekRules.length > 0) {
                return matchesMonthlyInterval && monthlyWeekRules.some(rule => {
                    const targetMonthDay = getMonthlyWeekdayDate(
                        currentDate.getFullYear(),
                        currentDate.getMonth(),
                        rule.order,
                        rule.weekday
                    );
                    return targetMonthDay !== null && currentDate.getDate() === targetMonthDay;
                });
            }

            // 如果设置了 monthDays，同时要求命中“每 N 个月”的间隔。
            if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                const effectiveMonthDays = getEffectiveMonthDays(
                    currentDate.getFullYear(),
                    currentDate.getMonth(),
                    repeatConfig.monthDays
                );
                return matchesMonthlyInterval && effectiveMonthDays.includes(currentDate.getDate());
            }

            // 否则按原有逻辑：检查与原始日期的日是否相同
            const sameDay = currentDate.getDate() === originalDateObj.getDate();
            return matchesMonthlyInterval && sameDay;

        case 'yearly':
            // 如果设置了months和monthDays，检查当前日期是否匹配
            if (repeatConfig.months && repeatConfig.months.length > 0 &&
                repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                const matchMonth = repeatConfig.months.includes(currentDate.getMonth() + 1);
                const matchDay = repeatConfig.monthDays.includes(currentDate.getDate());
                return matchMonth && matchDay && currentDate >= originalDateObj;
            }
            // 否则按原有逻辑：检查与原始日期的月和日是否相同
            const yearsDiff = currentDate.getFullYear() - originalDateObj.getFullYear();
            const sameMonthDay = currentDate.getMonth() === originalDateObj.getMonth() &&
                currentDate.getDate() === originalDateObj.getDate();
            return yearsDiff >= 0 && yearsDiff % (repeatConfig.interval || 1) === 0 && sameMonthDay;

        case 'custom':
            return checkCustomRepeat(currentDate, originalDateObj, repeatConfig);

        case 'ebbinghaus':
            return checkEbbinghausRepeat(currentDate, originalDateObj, repeatConfig);

        case 'lunar-monthly':
            return checkLunarMonthlyRepeat(currentDate, originalDateObj, repeatConfig);

        case 'lunar-yearly':
            return checkLunarYearlyRepeat(currentDate, originalDateObj, repeatConfig);

        default:
            return false;
    }
}

/**
 * 检查自定义重复规则
 */
function checkCustomRepeat(currentDate: Date, originalDate: Date, repeatConfig: RepeatConfig): boolean {
    // 检查星期几
    if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
        if (!repeatConfig.weekDays.includes(currentDate.getDay())) {
            return false;
        }
    }

    // 检查每月的日期
    if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
        if (!repeatConfig.monthDays.includes(currentDate.getDate())) {
            return false;
        }
    }

    // 检查月份
    if (repeatConfig.months && repeatConfig.months.length > 0) {
        if (!repeatConfig.months.includes(currentDate.getMonth() + 1)) {
            return false;
        }
    }

    return currentDate >= originalDate;
}

/**
 * 检查艾宾浩斯重复规则
 */
function checkEbbinghausRepeat(currentDate: Date, originalDate: Date, repeatConfig: RepeatConfig): boolean {
    const daysDiff = Math.floor((currentDate.getTime() - originalDate.getTime()) / (24 * 60 * 60 * 1000));
    // 艾宾浩斯规则：
    // 1) 首次实例应为当天（daysDiff = 0）
    // 2) 默认检查点为 1,2,4,7,15 天
    // 3) 达到 15 天后，固定每 15 天重复一次（30,45,60...）
    const pattern = repeatConfig.ebbinghausPattern || [1, 2, 4, 7, 15];
    if (daysDiff < 0) {
        return false;
    }
    if (daysDiff === 0) {
        return true;
    }
    if (pattern.includes(daysDiff)) {
        return true;
    }

    const maxPatternDay = pattern.length > 0 ? Math.max(...pattern) : 15;
    const fixedInterval = 15;
    return daysDiff > maxPatternDay && (daysDiff - maxPatternDay) % fixedInterval === 0;
}

/**
 * 检查农历每月重复规则
 */
function checkLunarMonthlyRepeat(currentDate: Date, _originalDate: Date, repeatConfig: RepeatConfig): boolean {
    if (!repeatConfig.lunarDay) {
        return false;
    }

    try {
        const currentDateStr = getLocalDateString(currentDate);
        const lunar = solarToLunar(currentDateStr);
        return lunar.day === repeatConfig.lunarDay;
    } catch (error) {
        console.error('Error checking lunar monthly repeat:', error);
        return false;
    }
}

/**
 * 检查农历每年重复规则
 */
function checkLunarYearlyRepeat(currentDate: Date, _originalDate: Date, repeatConfig: RepeatConfig): boolean {
    if (!repeatConfig.lunarMonth || !repeatConfig.lunarDay) {
        return false;
    }

    try {
        const currentDateStr = getLocalDateString(currentDate);
        const lunar = solarToLunar(currentDateStr);
        return lunar.month === repeatConfig.lunarMonth && lunar.day === repeatConfig.lunarDay;
    } catch (error) {
        console.error('Error checking lunar yearly repeat:', error);
        return false;
    }
}

/**
 * 获取下一个检查日期
 */
function getNextDate(currentDate: Date, repeatConfig: RepeatConfig): Date {
    const nextDate = new Date(currentDate);

    switch (repeatConfig.type) {
        case 'daily':
        case 'custom':
        case 'ebbinghaus':
        case 'weekly':
        case 'monthly':
        case 'yearly':
        case 'lunar-monthly':
        case 'lunar-yearly':
            // For all types, we check daily to find the next valid date
            nextDate.setDate(nextDate.getDate() + 1);
            break;
        default:
            nextDate.setDate(nextDate.getDate() + 1);
            break;
    }

    return nextDate;
}

/**
 * 计算两个日期之间的天数差
 */
export function getDaysDifference(startDate: string, endDate: string): number {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 给日期添加指定天数
 */
export function addDaysToDate(dateStr: string, days: number): string {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + days);
    return getLocalDateString(date); // 使用本地日期字符串
}

/**
 * 获取重复描述文本
 */
export function getRepeatDescription(repeatConfig: RepeatConfig): string {
    if (!repeatConfig.enabled) {
        return '';
    }

    let description = '';
    const interval = repeatConfig.interval || 1;

    switch (repeatConfig.type) {
        case 'daily':
            description = interval === 1 ? i18n("freqDaily") : i18n("everyNDays", { n: interval.toString() });
            break;
        case 'weekly':
            if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
                const keys = interval === 1
                    ? ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
                    : ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                const dayNames = keys.map(k => i18n(k));
                const days = repeatConfig.weekDays.map(d => dayNames[d]).join('、');
                description = interval === 1 ? `每周${days}` : `每${interval}周的${days}`;
            } else {
                description = interval === 1 ? i18n("everyWeek") : i18n("everyNWeeks", { n: interval.toString() });
            }
            break;
        case 'monthly':
            const monthlyWeekRules = getMonthlyWeekRules(repeatConfig);
            if (monthlyWeekRules.length > 0) {
                const keys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                const fallbackDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
                const dayNames = keys.map((k, index) => i18n(k) || fallbackDayNames[index]);
                const ruleText = monthlyWeekRules
                    .map(rule => `${getMonthlyWeekOrderText(rule.order)}${dayNames[rule.weekday] || ''}`)
                    .join('、');
                description = interval === 1
                    ? `每月${ruleText}`
                    : `每${interval}个月的${ruleText}`;
            } else if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                const monthDaysText = repeatConfig.monthDays.join('、');
                description = interval === 1
                    ? `每月${monthDaysText}号`
                    : `每${interval}个月的${monthDaysText}号`;
            } else {
                description = interval === 1 ? i18n("everyMonth") : i18n("everyNMonths", { n: interval.toString() });
            }
            break;
        case 'yearly':
            if (repeatConfig.months && repeatConfig.months.length > 0 &&
                repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                description = `每年${repeatConfig.months[0]}月${repeatConfig.monthDays[0]}号`;
            } else {
                description = interval === 1 ? i18n("everyYear") : i18n("everyNYears", { n: interval.toString() });
            }
            break;
        case 'lunar-monthly':
            if (repeatConfig.lunarDay) {
                const dayText = formatLunarDay(repeatConfig.lunarDay);
                description = `农历每月${dayText}`;
            } else {
                description = i18n("lunarMonthlyRepeat");
            }
            break;
        case 'lunar-yearly':
            if (repeatConfig.lunarMonth && repeatConfig.lunarDay) {
                const monthText = formatLunarMonth(repeatConfig.lunarMonth);
                const dayText = formatLunarDay(repeatConfig.lunarDay);
                description = `农历每年${monthText}${dayText}`;
            } else {
                description = i18n("lunarYearlyRepeat");
            }
            break;
        case 'custom':
            description = i18n("customRepeat");
            break;
        case 'ebbinghaus':
            description = i18n("ebbinghausRepeat");
            break;
    }

    // 添加结束条件
    if (repeatConfig.endType === 'date' && repeatConfig.endDate) {
        description += i18n("untilDate", { date: repeatConfig.endDate });
    } else if (repeatConfig.endType === 'count' && repeatConfig.endCount) {
        description += i18n("forNTimes", { n: repeatConfig.endCount.toString() });
    }

    return description;
}

/**
 * 检查重复事件是否已结束
 */
export function isRepeatEnded(reminder: any, currentDate: string): boolean {
    const repeatConfig = reminder.repeat;
    if (!repeatConfig?.enabled) {
        return false;
    }

    if (repeatConfig.endType === 'date' && repeatConfig.endDate) {
        return compareDateStrings(currentDate, repeatConfig.endDate) > 0;
    }

    // 对于次数限制，需要在使用时检查
    return false;
}

/**
 * Recursive generation of template subtask ghost instances
 */
export function generateSubtreeInstances(
    originalParentId: string,
    instanceParentId: string,
    instanceDate: string,
    targetList: any[],
    reminderData: any,
    parentCompletionTime?: number
) {
    // Find all tasks with this original parent ID
    const directChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === originalParentId);

    directChildren.forEach((child: any) => {
        // If parent instance is completed, skip children created after completion
        if (parentCompletionTime) {
            const childCreated = child.created || child.createdTime || child.createdAt;
            if (childCreated) {
                const childCreatedTime = new Date(childCreated).getTime();
                // Add 1 minute buffer to avoid race conditions during batch operations
                if (childCreatedTime > parentCompletionTime + 60000) {
                    return;
                }
            }
        }

        // Check if this child is excluded for the current instance date
        const excludeDates = child.repeat?.excludeDates || [];
        if (excludeDates.includes(instanceDate)) {
            // Skip this child and its descendants for this instance date
            return;
        }

        const instanceId = `${child.id}_${instanceDate}`;
        const instanceState = getRepeatInstanceState(child, instanceDate);
        if (instanceState?.deleted || instanceState?.date === null) {
            return;
        }
        const isInstanceCompleted = !!instanceState?.completed;
        const defaultEndDate = child.endDate && child.date
            ? addDaysToDate(instanceDate, getDaysDifference(child.date, child.endDate))
            : undefined;

        const instanceTask = {
            ...child,
            ...instanceState,
            id: instanceId,
            parentId: instanceParentId,
            date: getInstanceField(instanceState, 'date', instanceDate),
            // If subtask has end date, calculate based on original span
            endDate: getInstanceField(instanceState, 'endDate', defaultEndDate),
            time: getInstanceField(instanceState, 'time', child.time),
            endTime: getInstanceField(instanceState, 'endTime', child.endTime),
            blockId: getInstanceField(instanceState, 'blockId', child.blockId),
            docId: getInstanceField(instanceState, 'docId', child.docId),
            url: getInstanceField(instanceState, 'url', child.url),
            // 确保实例级 title 会覆盖模板 title（修复 ghost 子任务实例标题未更新的问题）
            title: getInstanceField(instanceState, 'title', child.title || ''),
            isRepeatInstance: true,
            originalId: child.id,
            completed: isInstanceCompleted,
            // Inherit/override properties
            note: getInstanceField(instanceState, 'note', child.note),
            priority: getInstanceField(instanceState, 'priority', child.priority),
            categoryId: getInstanceField(instanceState, 'categoryId', child.categoryId),
            projectId: getInstanceField(instanceState, 'projectId', child.projectId),
            customGroupId: getInstanceField(instanceState, 'customGroupId', child.customGroupId),
            kanbanStatus: getInstanceField(instanceState, 'kanbanStatus', child.kanbanStatus),
            milestoneId: getInstanceField(instanceState, 'milestoneId', child.milestoneId),
            tagIds: getInstanceField(instanceState, 'tagIds', child.tagIds),
            treatStartDateAsDeadline: getInstanceField(instanceState, 'treatStartDateAsDeadline', child.treatStartDateAsDeadline),
            reminderSkipWeekendMode: resolveReminderSkipWeekendMode(instanceState, child, child.repeat),
            reminderSkipHolidays: getInstanceField(
                instanceState,
                'reminderSkipHolidays',
                child.reminderSkipHolidays !== undefined ? child.reminderSkipHolidays : child.repeat?.reminderSkipHolidays
            ),
            reminderTimes: resolveRepeatReminderTimes(
                getInstanceField(instanceState, 'reminderTimes', child.reminderTimes),
                instanceDate,
                getInstanceField(instanceState, 'endDate', defaultEndDate),
                child.date,
                child.endDate
            ),
            customReminderPreset: getInstanceField(instanceState, 'customReminderPreset', child.customReminderPreset),
            completedTime: isInstanceCompleted ? (instanceState?.completedTime || getLocalDateTimeString(new Date(instanceDate))) : undefined,
            sort: getInstanceField(instanceState, 'sort', child.sort || 0)
        };

        targetList.push(instanceTask);

        // Recurse to children's children
        // Use the same parentCompletionTime for the entire subtree to maintain the snapshot at completion
        generateSubtreeInstances(child.id, instanceId, instanceDate, targetList, reminderData, parentCompletionTime);
    });
}
