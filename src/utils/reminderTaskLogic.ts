import { getAllReminders } from "./icsSubscription";
import { getLogicalDateString, compareDateStrings, getLocalDateString, getLocalDateTimeString } from "./dateUtils";
import { generateRepeatInstances } from "./repeatUtils";

export class ReminderTaskLogic {
    /**
     * 获取指定 Tab 下的任务数量
     */
    public static async getTaskCountByTabs(plugin: any, tabNames: string[], excludeDesserts: boolean = false): Promise<number> {
        const today = getLogicalDateString();
        const reminderData = await getAllReminders(plugin, undefined, false, 'sidebar');
        const allReminders = this.generateAllRemindersWithInstances(reminderData, today);

        const reminderMap = new Map<string, any>();
        allReminders.forEach(r => reminderMap.set(r.id, r));

        const matchedIds = new Set<string>();
        tabNames.forEach(tab => {
            const filtered = this.filterRemindersByTab(allReminders, today, tab, excludeDesserts);
            filtered.forEach(r => matchedIds.add(r.id));
        });

        const finalReminders = allReminders.filter(r => matchedIds.has(r.id));
        const finalIds = new Set(finalReminders.map(r => r.id));

        let count = 0;
        finalReminders.forEach(r => {
            if (r.parentId) {
                const parent = reminderMap.get(r.parentId);
                // 如果父任务也在列表中且未完成，则子任务不计数（遵循面板/勋章的一致逻辑：只统计顶层未完成项）
                if (parent && !parent.completed && finalIds.has(r.parentId)) {
                    return;
                }
            }
            count++;
        });

        return count;
    }

    public static generateAllRemindersWithInstances(reminderData: any, today: string): any[] {
        const reminders = (Object.values(reminderData) as any[]).filter((reminder: any) => {
            const shouldInclude = reminder && typeof reminder === 'object' && reminder.id &&
                (reminder.date || reminder.parentId || this.hasChildren(reminder.id, reminderData) || reminder.completed || (!reminder.date && !reminder.parentId));
            return shouldInclude;
        });

        const allReminders: any[] = [];
        const originalRemindersMap: { [id: string]: any } = {};
        reminders.forEach(r => {
            if (r.repeat?.enabled) originalRemindersMap[r.id] = r;
        });

        reminders.forEach((reminder: any) => {
            if (!reminder.repeat?.enabled) {
                allReminders.push(reminder);
            } else {
                const isLunarRepeat = reminder.repeat?.enabled &&
                    (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

                const repeatInstances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);
                const completedInstances = reminder.repeat.completedInstances || [];
                const instanceModifications = reminder.repeat?.instanceModifications || {};

                let pastIncompleteList: any[] = [];
                let todayIncompleteList: any[] = [];
                let futureIncompleteList: any[] = [];
                let futureCompletedList: any[] = [];
                let pastCompletedList: any[] = [];

                repeatInstances.forEach(instance => {
                    const originalInstanceDate = instance.instanceId.split('_').pop() || instance.date;
                    let isInstanceCompleted = completedInstances.includes(originalInstanceDate);

                    const instanceMod = instanceModifications[originalInstanceDate];

                    const instanceTask = {
                        ...reminder,
                        ...instance,
                        id: instance.instanceId,
                        isRepeatInstance: true,
                        originalId: instance.originalId,
                        completed: isInstanceCompleted,
                        note: instanceMod?.note !== undefined ? instanceMod.note : reminder.note,
                        priority: instanceMod?.priority !== undefined ? instanceMod.priority : reminder.priority,
                        categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : reminder.categoryId,
                        projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : reminder.projectId,
                        customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : reminder.customGroupId,
                        kanbanStatus: instanceMod?.kanbanStatus !== undefined ? instanceMod.kanbanStatus : reminder.kanbanStatus,
                        milestoneId: instanceMod?.milestoneId !== undefined ? instanceMod.milestoneId : reminder.milestoneId,
                        tagIds: instanceMod?.tagIds !== undefined ? instanceMod.tagIds : reminder.tagIds,
                        completedTime: isInstanceCompleted ? getLocalDateTimeString(new Date(instance.date)) : undefined
                    };

                    const instanceLogicalDate = this.getReminderLogicalDate(instance.date, instance.time);
                    const dateComparison = compareDateStrings(instanceLogicalDate, today);

                    if (dateComparison < 0) {
                        if (isInstanceCompleted) pastCompletedList.push(instanceTask);
                        else pastIncompleteList.push(instanceTask);
                    } else if (dateComparison === 0) {
                        if (!isInstanceCompleted) todayIncompleteList.push(instanceTask);
                        else pastCompletedList.push(instanceTask);
                    } else {
                        if (isInstanceCompleted) futureCompletedList.push(instanceTask);
                        else futureIncompleteList.push(instanceTask);
                    }
                });

                allReminders.push(...pastIncompleteList);
                allReminders.push(...todayIncompleteList);
                if (futureIncompleteList.length > 0 && todayIncompleteList.length === 0) {
                    allReminders.push(futureIncompleteList[0]);
                }
                allReminders.push(...pastCompletedList);
                allReminders.push(...futureCompletedList);
            }
        });

        return allReminders;
    }

    public static filterRemindersByTab(reminders: any[], today: string, targetTab: string, excludeDesserts: boolean = false): any[] {
        const reminderMap = new Map<string, any>();
        reminders.forEach(r => reminderMap.set(r.id, r));
        const sourceReminders = reminders.filter(r => !this.isReminderInAbandonedKanbanStatus(r));

        const isEffectivelyCompleted = (reminder: any) => {
            if (reminder.completed) return true;
            if (reminder.endDate) {
                const startLogical = this.getReminderLogicalDate(reminder.date, reminder.time);
                const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
                if (compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0) {
                    return this.isSpanningEventTodayCompleted(reminder, reminderMap, today);
                }
            }
            return false;
        };

        switch (targetTab) {
            case 'overdue':
                return sourceReminders.filter(r => {
                    if (!r.date || isEffectivelyCompleted(r)) return false;
                    const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                    return compareDateStrings(endLogical, today) < 0;
                });
            case 'today':
                return sourceReminders.filter(r => {
                    const isCompleted = isEffectivelyCompleted(r);
                    if (isCompleted) return false;
                    const hasIgnoreMark = this.hasTodayIgnoreMark(r, today);

                    const hasDate = r.date || r.endDate;
                    const startLogical = hasDate ? this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime) : null;
                    const endLogical = hasDate ? this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time) : null;

                    if (hasDate && startLogical && endLogical) {
                        const inRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;
                        const isOverdue = compareDateStrings(endLogical, today) < 0;
                        if (inRange || isOverdue) {
                            if (this.canApplyTodayIgnore(r, today) && hasIgnoreMark) return false;
                            return true;
                        }
                    }

                    if (this.isFutureTaskRemindedOnDate(r, today)) {
                        if (hasIgnoreMark) return false;
                        return !this.hasDailyCompletionMark(r, today);
                    }

                    if (excludeDesserts) return false;

                    if (r.isAvailableToday) {
                        const availDate = r.availableStartDate || today;
                        if (compareDateStrings(availDate, today) <= 0) {
                            if (r.date && r.time) {
                                const s = this.getReminderLogicalDate(r.date, r.time);
                                if (compareDateStrings(s, today) > 0) return false;
                            } else if (r.date && compareDateStrings(r.date, today) > 0) {
                                return false;
                            }
                            const dailyCompleted = Array.isArray(r.dailyDessertCompleted) ? r.dailyDessertCompleted : [];
                            if (dailyCompleted.includes(today)) return false;
                            if (hasIgnoreMark) return false;
                            return true;
                        }
                    }
                    return false;
                });
            // 暂时只实现 overdue 和 today 用于 badge 更新
            default:
                return [];
        }
    }

    private static hasChildren(reminderId: string, reminderData: any): boolean {
        return Object.values(reminderData).some((reminder: any) =>
            reminder && reminder.parentId === reminderId
        );
    }

    private static getReminderKanbanStatusId(reminder: any): string {
        if (!reminder || typeof reminder !== 'object') return 'doing';
        if (reminder.completed) return 'completed';
        return typeof reminder.kanbanStatus === 'string' && reminder.kanbanStatus.trim()
            ? reminder.kanbanStatus.trim()
            : 'doing';
    }

    private static isReminderInAbandonedKanbanStatus(reminder: any): boolean {
        return this.getReminderKanbanStatusId(reminder) === 'abandoned';
    }

    private static generateInstancesWithFutureGuarantee(reminder: any, today: string, isLunarRepeat: boolean): any[] {
        let monthsToAdd = 2;
        if (isLunarRepeat) monthsToAdd = 14;
        else if (reminder.repeat.type === 'yearly') monthsToAdd = 14;
        else if (reminder.repeat.type === 'monthly') monthsToAdd = 3;

        let repeatInstances: any[] = [];
        let hasUncompletedFutureInstance = false;
        const maxAttempts = 5;
        let attempts = 0;
        const completedInstances = reminder.repeat?.completedInstances || [];

        while (!hasUncompletedFutureInstance && attempts < maxAttempts) {
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setMonth(monthStart.getMonth() - 1);
            const monthEnd = new Date();
            monthEnd.setMonth(monthEnd.getMonth() + monthsToAdd);
            monthEnd.setDate(0);

            const startDate = getLocalDateString(monthStart);
            const endDate = getLocalDateString(monthEnd);
            const maxInstances = monthsToAdd * 50;
            repeatInstances = generateRepeatInstances(reminder, startDate, endDate, maxInstances);

            hasUncompletedFutureInstance = repeatInstances.some(instance => {
                const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                const originalKey = instanceIdStr.split('_').pop() || instance.date;
                return compareDateStrings(instance.date, today) > 0 && !completedInstances.includes(originalKey);
            });

            if (!hasUncompletedFutureInstance) {
                if (reminder.repeat.type === 'yearly') monthsToAdd += 12;
                else if (isLunarRepeat) monthsToAdd += 12;
                else monthsToAdd += 6;
                attempts++;
            }
        }
        return repeatInstances;
    }

    private static getReminderLogicalDate(dateStr?: string, timeStr?: string): string {
        if (!dateStr) return '';
        // 如果没有时间，直接返回日期字符串，避免逻辑日期转换导致日期偏移
        // For tasks without time, return date string directly to avoid logical date offset
        if (!timeStr) {
            return dateStr;
        }
        try {
            return getLogicalDateString(new Date(dateStr + 'T' + timeStr));
        } catch (e) {
            return dateStr;
        }
    }

    private static getReminderNotificationTimes(reminder: any): string[] {
        const times: string[] = [];
        if (Array.isArray(reminder?.reminderTimes)) {
            reminder.reminderTimes.forEach((item: any) => {
                if (typeof item === 'string' && item.trim()) {
                    times.push(item.trim());
                } else if (item && typeof item.time === 'string' && item.time.trim()) {
                    times.push(item.time.trim());
                }
            });
        }
        return times;
    }

    private static parseReminderTimeLogicalDate(timeStr: string, taskDate?: string): string | null {
        if (!timeStr) return null;

        const raw = String(timeStr).trim();
        let datePart: string | null = null;
        let timePart: string | null = null;

        if (raw.includes('T')) {
            const parts = raw.split('T');
            datePart = parts[0];
            timePart = parts[1] || null;
        } else if (raw.includes(' ')) {
            const parts = raw.split(' ');
            if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                datePart = parts[0];
                timePart = parts.slice(1).join(' ') || null;
            } else {
                timePart = parts[0];
            }
        } else if (/^\d{2}:\d{2}/.test(raw)) {
            timePart = raw;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            datePart = raw;
        } else {
            timePart = raw;
        }

        const effectiveDate = datePart || taskDate;
        if (!effectiveDate) return null;

        return this.getReminderLogicalDate(effectiveDate, timePart || undefined);
    }

    private static hasReminderNotificationOnDate(reminder: any, targetDate: string): boolean {
        const taskDate = reminder?.date || reminder?.endDate;
        if (!taskDate) return false;

        return this.getReminderNotificationTimes(reminder).some(timeStr => {
            const logicalDate = this.parseReminderTimeLogicalDate(timeStr, taskDate);
            return logicalDate === targetDate;
        });
    }

    private static isFutureTaskRemindedOnDate(reminder: any, targetDate: string): boolean {
        const taskDate = reminder?.date || reminder?.endDate;
        if (!taskDate) return false;

        const taskLogicalDate = this.getReminderLogicalDate(taskDate, reminder?.time || reminder?.endTime);
        if (!taskLogicalDate || compareDateStrings(taskLogicalDate, targetDate) <= 0) return false;

        return this.hasReminderNotificationOnDate(reminder, targetDate);
    }

    private static hasDailyCompletionMark(reminder: any, targetDate: string): boolean {
        return !!(reminder?.dailyCompletions && reminder.dailyCompletions[targetDate] === true);
    }

    private static isDailyDessertTaskForDate(reminder: any, targetDate: string): boolean {
        if (!reminder?.isAvailableToday) return false;
        const startLogical = this.getReminderLogicalDate(reminder.date, reminder.time);
        const isInOrAfterPeriod = reminder.date && compareDateStrings(startLogical, targetDate) <= 0;
        return !isInOrAfterPeriod;
    }

    private static getTodayIgnoreStorageKey(reminder: any, targetDate: string): 'todayIgnored' | 'dailyDessertIgnored' {
        return this.isDailyDessertTaskForDate(reminder, targetDate) ? 'dailyDessertIgnored' : 'todayIgnored';
    }

    private static hasTodayIgnoreMark(reminder: any, targetDate: string): boolean {
        const ignoreKey = this.getTodayIgnoreStorageKey(reminder, targetDate);
        const ignoredList = Array.isArray(reminder?.[ignoreKey]) ? reminder[ignoreKey] : [];
        return ignoredList.includes(targetDate);
    }

    private static canApplyTodayIgnore(reminder: any, targetDate: string): boolean {
        if (!reminder || reminder.completed) return false;

        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;
        if (isSpanningDays) {
            const startLogical = this.getReminderLogicalDate(reminder.date || reminder.endDate, reminder.time || reminder.endTime);
            const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
            if (startLogical && endLogical && compareDateStrings(startLogical, targetDate) <= 0 && compareDateStrings(targetDate, endLogical) <= 0) {
                return true;
            }
        }

        return this.isFutureTaskRemindedOnDate(reminder, targetDate);
    }

    private static isSpanningEventTodayCompleted(reminder: any, reminderMap: Map<string, any>, today: string): boolean {
        if (reminder.isRepeatInstance) {
            const originalReminder = reminderMap.get(reminder.originalId);
            if (originalReminder && originalReminder.dailyCompletions) {
                return originalReminder.dailyCompletions[today] === true;
            }
            return reminder.dailyCompletions && reminder.dailyCompletions[today] === true;
        } else {
            return reminder.dailyCompletions && reminder.dailyCompletions[today] === true;
        }
        return false;
    }
}
