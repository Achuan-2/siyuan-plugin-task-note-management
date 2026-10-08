import { generateRepeatInstances, resolveRepeatReminderTimes, addDaysToDate, getDaysDifference } from "../components/dataManager/repeatUtils";
import { isOpenEndedStartDateTask } from "../utils/startDateOverdue";
import { shouldSkipReminderOnDate, type HolidayData } from "../utils/reminderSkipDate";

export interface ReminderTimeScannerHost {
    settings: any;
    notifiedReminders: Map<string, boolean>;
    hasReminderNotified(key: string): Promise<boolean>;
    markReminderNotified(key: string): Promise<void>;
    showTimeReminder(reminder: any, triggerField?: 'time' | 'reminderTimes', triggeredTime?: string): Promise<void>;
}

/** 前端系统通知与内核 Webhook 共用同一套到期规则，各自管理发送记录。 */
export class ReminderTimeScanner {
    constructor(private readonly host: ReminderTimeScannerHost, private readonly translate: (key: string) => string) { }

    private canReminderNotifyOnDate(reminder: any, date: string, holidayData: HolidayData): boolean {
        return !shouldSkipReminderOnDate(reminder, date, this.host.settings, holidayData);
    }

    public async check(reminderData: any, today: string, currentTime: string, holidayData: HolidayData = {}) {
        try {
            for (const reminder of Object.values(reminderData)) {
                if (!reminder || typeof reminder !== 'object') continue;

                const reminderObj = reminder as any;

                // 跳过已完成、已放弃或没有时间的提醒
                if (reminderObj.completed || reminderObj.kanbanStatus === 'abandoned') continue;
                if (!this.canReminderNotifyOnDate(reminderObj, today, holidayData)) continue;

                // 如果是跨天事件且今日已完成，跳过其所有通知提醒
                const checkStartDate = reminderObj.date || reminderObj.endDate;
                const checkEndDate = reminderObj.endDate || checkStartDate;
                const checkIsCrossDay = checkStartDate && checkEndDate && checkStartDate !== checkEndDate;
                if (checkIsCrossDay && reminderObj.dailyCompletions && reminderObj.dailyCompletions[today] === true) {
                    continue;
                }

                // 处理普通提醒
                if (!reminderObj.repeat?.enabled) {
                    // 普通（非重复）提醒：按字段分别处理 time 和 reminderTimes

                    // 计算任务的起止范围与开放式任务判定（对齐日历视图与 ReminderPanel）
                    const hasExplicitTaskDate = !!(reminderObj.date || reminderObj.endDate);
                    const isOpenEnded = isOpenEndedStartDateTask(reminderObj, this.host.settings);
                    const checkIsCrossDay = !!(reminderObj.date && reminderObj.endDate && reminderObj.endDate > reminderObj.date);

                    let inDateRange = false;
                    if (!hasExplicitTaskDate) {
                        inDateRange = true;
                    } else if (isOpenEnded) {
                        inDateRange = today >= reminderObj.date;
                    } else if (checkIsCrossDay) {
                        inDateRange = reminderObj.date <= today && today <= reminderObj.endDate;
                    } else {
                        const singleDate = reminderObj.date || reminderObj.endDate;
                        inDateRange = today === singleDate;
                    }

                    // 检查 time 提醒
                    if (reminderObj.time && inDateRange) {
                        const notifyKey = `${reminderObj.id}_${today}_${reminderObj.time}_time`;
                        if (!this.host.notifiedReminders.has(notifyKey) && this.shouldNotifyNow(reminderObj, today, currentTime, 'time')) {
                            // 二次检查持久化记录，防止多窗口并发
                            if (await this.host.hasReminderNotified(notifyKey)) {
                                this.host.notifiedReminders.set(notifyKey, true);
                            } else {
                                console.debug('checkTimeReminders - triggering time reminder', { id: reminderObj.id, date: reminderObj.date, time: reminderObj.time });
                                await this.host.showTimeReminder(reminderObj, 'time');
                                this.host.notifiedReminders.set(notifyKey, true);
                                await this.host.markReminderNotified(notifyKey);
                            }
                        }
                    }

                    // 检查 reminderTimes 提醒
                    if (reminderObj.reminderTimes && Array.isArray(reminderObj.reminderTimes)) {
                        for (const rtItem of reminderObj.reminderTimes) {
                            const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                            const note = typeof rtItem === 'string' ? '' : rtItem.note;

                            const parsed = this.extractDateAndTime(rt);
                            const hasDate = !!parsed.date;

                            let shouldCheck = false;
                            if (hasDate) {
                                shouldCheck = (parsed.date === today);
                            } else {
                                shouldCheck = inDateRange;
                            }

                            if (shouldCheck) {
                                const notifyKey = `${reminderObj.id}_${today}_${rt}_reminderTimes`;
                                const currentNum = this.timeStringToNumber(currentTime);
                                const reminderNum = this.timeStringToNumber(rt);
                                // 只检测当前分钟，不检测过期提醒
                                if (!this.host.notifiedReminders.has(notifyKey) && currentNum === reminderNum) {
                                    // 二次检查持久化记录
                                    if (await this.host.hasReminderNotified(notifyKey)) {
                                        this.host.notifiedReminders.set(notifyKey, true);
                                    } else {
                                        console.debug('checkTimeReminders - triggering reminderTimes reminder', { id: reminderObj.id, rt });
                                        const tempReminder = { ...reminderObj, note: note ? (reminderObj.note ? reminderObj.note + '\n' + note : note) : reminderObj.note };
                                        await this.host.showTimeReminder(tempReminder, 'reminderTimes', rt);
                                        this.host.notifiedReminders.set(notifyKey, true);
                                        await this.host.markReminderNotified(notifyKey);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    // 处理重复提醒
                    let instances = generateRepeatInstances(reminderObj, today, today, 100, {
                        settings: this.host.settings,
                        holidayData
                    });

                    // 额外处理：如果存在 repeat.instances，将那些被修改后日期为今天的实例也加入检查。
                    // 情形：原始实例键（例如 2025-12-01）被修改为另一个日期（例如 2025-12-05），当今天为 2025-12-05 时
                    // generateRepeatInstances 可能不会基于原始键生成该实例，因此需要显式加入被移动到今天的实例。
                    try {
                        const instStates = reminderObj.repeat?.instances || {};
                        for (const [origKey, state] of Object.entries(instStates)) {
                            try {
                                if (!state || typeof state !== 'object') continue;
                                const stateObj = state as any;
                                if (stateObj.date !== today) continue; // 只关心被改到今天的实例
                                if (stateObj.deleted) continue;
                                const instanceId = `${reminderObj.id}_${origKey}`;
                                const exists = instances.some((it: any) => it.instanceId === instanceId);
                                if (exists) continue;

                                const constructed = {
                                    title: stateObj.title || reminderObj.title || this.translate('unnamedNote'),
                                    date: stateObj.date || today,
                                    time: stateObj.time !== undefined ? stateObj.time : reminderObj.time,
                                    endDate: stateObj.endDate !== undefined ? stateObj.endDate : reminderObj.endDate,
                                    endTime: stateObj.endTime !== undefined ? stateObj.endTime : reminderObj.endTime,
                                    reminderTimes: stateObj.reminderTimes !== undefined ? stateObj.reminderTimes : reminderObj.reminderTimes,
                                    customReminderPreset: stateObj.customReminderPreset !== undefined ? stateObj.customReminderPreset : reminderObj.customReminderPreset,
                                    instanceId: instanceId,
                                    originalId: reminderObj.id,
                                    isRepeatedInstance: true,
                                    completed: !!stateObj.completed,
                                    completedTime: stateObj.completed ? stateObj.completedTime : undefined,
                                    note: stateObj.note !== undefined ? stateObj.note : reminderObj.note,
                                    priority: stateObj.priority !== undefined ? stateObj.priority : reminderObj.priority,
                                    categoryId: stateObj.categoryId !== undefined ? stateObj.categoryId : reminderObj.categoryId,
                                    projectId: stateObj.projectId !== undefined ? stateObj.projectId : reminderObj.projectId
                                };

                                instances.push(constructed as any);
                            } catch (e) {
                                console.warn('处理 repeat.instances 时出错', e);
                            }
                        }
                    } catch (e) {
                        console.warn('处理重复实例的 repeat.instances 时发生错误:', e);
                    }

                    // 将生成的实例与原始 reminderObj 合并，确保实例包含 title、note、priority 等字段
                    instances = instances.map((inst: any) => ({
                        ...reminderObj,
                        ...inst,
                        id: inst.instanceId,
                        isRepeatInstance: true,
                        originalId: inst.originalId || reminderObj.id
                    }));

                    const processedInstanceIds = new Set<string>();

                    for (const instance of instances) {
                        const instanceId = instance.instanceId || (instance as any).id;
                        processedInstanceIds.add(instanceId);
                        const originalInstanceDate = (instanceId && instanceId.includes('_'))
                            ? instanceId.split('_').pop()
                            : instance.date;
                        // 重复实例已完成（含每日完成标记）时，不应再触发时间提醒
                        if (instance.completed || (originalInstanceDate && reminderObj.dailyCompletions?.[originalInstanceDate])) {
                            continue;
                        }
                        if (!this.canReminderNotifyOnDate(instance, today, holidayData)) {
                            continue;
                        }

                        // 检查实例是否需要提醒
                        // 时间提醒
                        if (instance.time) {
                            const notifyKey = `${instanceId}_${today}_${instance.time}_time`;
                            if (!this.host.notifiedReminders.has(notifyKey) && this.shouldNotifyNow(instance, today, currentTime, 'time')) {
                                // 二次检查持久化记录
                                if (await this.host.hasReminderNotified(notifyKey)) {
                                    this.host.notifiedReminders.set(notifyKey, true);
                                } else {
                                    console.debug('checkTimeReminders - triggering repeat instance time reminder', { id: instanceId, date: instance.date, time: instance.time });
                                    await this.host.showTimeReminder(instance, 'time');
                                    this.host.notifiedReminders.set(notifyKey, true);
                                    await this.host.markReminderNotified(notifyKey);
                                }
                            }
                        }

                        // reminderTimes 实例提醒
                        if (instance.reminderTimes && Array.isArray(instance.reminderTimes)) {
                            for (const rtItem of instance.reminderTimes) {
                                const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;

                                const parsed = this.extractDateAndTime(rt);
                                if (parsed.date && parsed.date !== today) continue;

                                const currentNum = this.timeStringToNumber(currentTime);
                                const reminderNum = this.timeStringToNumber(rt);

                                // 只检测当前分钟，不检测过期提醒
                                const notifyKey = `${instanceId}_${today}_${rt}_reminderTimes`;
                                if (!this.host.notifiedReminders.has(notifyKey) && currentNum === reminderNum) {
                                    // 二次检查持久化记录
                                    if (await this.host.hasReminderNotified(notifyKey)) {
                                        this.host.notifiedReminders.set(notifyKey, true);
                                    } else {
                                        console.debug('checkTimeReminders - triggering repeat instance reminderTimes reminder', { id: instanceId, rt });
                                        await this.host.showTimeReminder(instance, 'reminderTimes', rt);
                                        this.host.notifiedReminders.set(notifyKey, true);
                                        await this.host.markReminderNotified(notifyKey);
                                    }
                                }
                            }
                        }
                    }

                    // 额外扫描 repeat.instances：处理实例级自定义提醒中的“指定日期”（可前可后），
                    // 以及“提前 x 天”等相对提醒。只要实例未完成，即使实例发生日不是今天，也应在提醒日当天触发。
                    try {
                        const instStates = reminderObj.repeat?.instances || {};
                        for (const [origKey, state] of Object.entries(instStates)) {
                            try {
                                if (!state || typeof state !== 'object') continue;
                                const stateObj = state as any;
                                if (stateObj.deleted || stateObj.date === null) continue;
                                if (stateObj.completed) continue;
                                if (reminderObj.dailyCompletions?.[origKey]) continue;
                                if (!stateObj.reminderTimes || !Array.isArray(stateObj.reminderTimes) || stateObj.reminderTimes.length === 0) continue;

                                const instanceId = `${reminderObj.id}_${origKey}`;
                                if (processedInstanceIds.has(instanceId)) continue;

                                const instanceDate = stateObj.date || origKey;
                                const instanceEndDate = stateObj.endDate !== undefined
                                    ? stateObj.endDate
                                    : (reminderObj.endDate && reminderObj.date
                                        ? addDaysToDate(instanceDate, getDaysDifference(reminderObj.date, reminderObj.endDate))
                                        : undefined);

                                const resolvedTimes = resolveRepeatReminderTimes(
                                    stateObj.reminderTimes,
                                    instanceDate,
                                    instanceEndDate,
                                    reminderObj.date,
                                    reminderObj.endDate
                                );
                                if (!resolvedTimes || resolvedTimes.length === 0) continue;

                                const matchingItems = resolvedTimes.filter((rt: any) => {
                                    const parsed = this.extractDateAndTime(rt.time);
                                    return parsed.date === today;
                                });
                                if (matchingItems.length === 0) continue;

                                const constructed: any = {
                                    ...reminderObj,
                                    ...stateObj,
                                    id: instanceId,
                                    instanceId,
                                    originalId: reminderObj.id,
                                    isRepeatInstance: true,
                                    date: instanceDate,
                                    endDate: instanceEndDate,
                                    reminderTimes: matchingItems
                                };
                                if (!this.canReminderNotifyOnDate(constructed, today, holidayData)) continue;

                                for (const rtItem of matchingItems) {
                                    const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                                    const note = typeof rtItem === 'string' ? '' : rtItem.note;

                                    const parsed = this.extractDateAndTime(rt);
                                    if (parsed.date && parsed.date !== today) continue;

                                    const currentNum = this.timeStringToNumber(currentTime);
                                    const reminderNum = this.timeStringToNumber(rt);

                                    const notifyKey = `${instanceId}_${today}_${rt}_reminderTimes`;
                                    if (!this.host.notifiedReminders.has(notifyKey) && currentNum === reminderNum) {
                                        if (await this.host.hasReminderNotified(notifyKey)) {
                                            this.host.notifiedReminders.set(notifyKey, true);
                                        } else {
                                            console.debug('checkTimeReminders - triggering repeat instance reminderTimes reminder (state scan)', { id: instanceId, rt });
                                            const tempReminder = { ...constructed, note: note ? (constructed.note ? constructed.note + '\n' + note : note) : constructed.note };
                                            await this.host.showTimeReminder(tempReminder, 'reminderTimes', rt);
                                            this.host.notifiedReminders.set(notifyKey, true);
                                            await this.host.markReminderNotified(notifyKey);
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn('扫描 repeat.instances 自定义提醒时出错', e);
                            }
                        }
                    } catch (e) {
                        console.warn('扫描重复实例自定义提醒时发生错误:', e);
                    }
                }
            }

        } catch (error) {
            console.error('检查时间提醒失败:', error);
        }
    }

    private shouldNotifyNow(reminder: any, today: string, currentTime: string, timeField: 'time' = 'time'): boolean {
        // 不在此处强制检查日期，调用方负责判断提醒是否在当天或范围内。

        // 必须有时间字段
        if (!reminder[timeField]) return false;

        // 比较当前时间和提醒时间（支持带日期的自定义提醒）
        const rawReminderTime = reminder[timeField];
        const parsed = this.extractDateAndTime(rawReminderTime);

        // 如果提醒时间包含日期并且不是今天，则不触发
        if (parsed.date && parsed.date !== today) {
            console.debug('shouldNotifyNow - date does not match today, skip', parsed.date, 'today:', today, 'id:', reminder.id, 'field:', timeField);
            return false;
        }

        // 如果没有有效的 time 部分（比如只有日期，或解析失败），则视为非时间提醒，不触发此函数
        if (!parsed.time) {
            console.debug('shouldNotifyNow - no valid time component, skip', rawReminderTime, 'id:', reminder.id);
            return false;
        }

        const currentTimeNumber = this.timeStringToNumber(currentTime);
        const reminderTimeNumber = this.timeStringToNumber(rawReminderTime);
        // 只检测当前分钟的提醒，不检测过期提醒（精确匹配）
        const shouldNotify = currentTimeNumber === reminderTimeNumber;
        if (shouldNotify) {
            console.debug('shouldNotifyNow - trigger:', timeField, 'reminderId:', reminder.id, 'currentTime:', currentTime, 'reminderTime:', reminder[timeField]);
        }
        return shouldNotify;
    }

    private extractDateAndTime(value?: string): { date?: string | null, time?: string | null } {
        if (!value || typeof value !== 'string') return { date: null, time: null };
        if (value.includes('T')) {
            const [datePart, timePart] = value.split('T');
            if (!timePart) return { date: datePart, time: null };
            const time = timePart.split(':').slice(0, 2).join(':');
            return { date: datePart, time };
        }
        if (value.includes(' ')) {
            const [datePart, timePart] = value.split(' ');
            const time = (timePart || '').split(':').slice(0, 2).join(':') || null;
            return { date: datePart, time };
        }
        if (value.split(':').length >= 2) {
            return { date: null, time: value.split(':').slice(0, 2).join(':') };
        }
        return { date: null, time: null };
    }

    private timeStringToNumber(timeString: string): number {
        if (!timeString) return 0;
        const { time } = this.extractDateAndTime(timeString) || { time: null };
        if (!time) return 0;
        const parts = time.split(':');
        if (parts.length < 2) return 0;
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        if (isNaN(hours) || isNaN(minutes)) return 0;
        return hours * 100 + minutes;
    }
}
