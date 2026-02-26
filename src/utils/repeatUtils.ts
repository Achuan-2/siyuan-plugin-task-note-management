import { RepeatConfig } from '../components/RepeatSettingsDialog';
import { compareDateStrings, getLocalDateTimeString } from './dateUtils';
import { i18n } from '../pluginInstance';
import { solarToLunar } from './lunarUtils';

export interface RepeatInstance {
    title?: string; // 实例标题（可选，覆盖原始标题）
    date: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    customReminderTime?: string;
    reminderTimes?: Array<{ time: string, note?: string }>; // 提醒时间列表
    customReminderPreset?: string; // 提醒预设
    instanceId: string; // 实例标识符
    originalId: string; // 原始提醒ID
    isRepeatedInstance: boolean;
    completed?: boolean; // 添加实例级别的完成状态
    completedTime?: string; // 实例完成时间
    // 实例级别覆盖字段
    note?: string;
    priority?: string;
    categoryId?: string;
    projectId?: string;
    customGroupId?: string;
    kanbanStatus?: string;
    tagIds?: string[];
    milestoneId?: string;
    sort?: number;
}

/**
 * 将 Date 对象转换为 YYYY-MM-DD 格式的本地日期字符串
 */
function getLocalDateString(date: Date): string {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 生成重复事件实例
 */
export function generateRepeatInstances(
    reminder: any,
    startDate: string,
    endDate: string,
    maxInstances: number = 100
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

    // 获取排除日期列表
    const excludeDates = repeatConfig.excludeDates || [];
    // 获取实例修改列表
    const instanceModifications = repeatConfig.instanceModifications || {};
    // 获取已完成实例列表
    const completedInstances = repeatConfig.completedInstances || [];
    // 获取实例完成时间列表
    const instanceCompletedTimes = repeatConfig.instanceCompletedTimes || {};

    // 检查重复结束条件
    const hasEndDate = repeatConfig.endType === 'date' && repeatConfig.endDate;
    const hasEndCount = repeatConfig.endType === 'count' && repeatConfig.endCount;
    const repeatEndDate = hasEndDate ? new Date(repeatConfig.endDate + 'T23:59:59') : null;

    while (currentDate <= endDateObj && instanceCount < maxInstances) {
        const currentDateStr = getLocalDateString(currentDate); // 使用本地日期字符串

        // 检查是否在生成范围内
        if (compareDateStrings(currentDateStr, startDate) >= 0) {
            // 检查重复结束条件
            if (hasEndDate && repeatEndDate && currentDate > repeatEndDate) {
                break;
            }
            if (hasEndCount && instanceCount >= repeatConfig.endCount) {
                break;
            }

            // 检查是否符合重复规则且不在排除列表中
            // 对于农历重复，originalDate 可以为空
            if (shouldGenerateInstance(currentDate, reminder.date || startDate, repeatConfig) &&
                !excludeDates.includes(currentDateStr)) {

                // 检查是否有针对此实例的修改
                const modification = instanceModifications[currentDateStr];

                // 如果修改中明确将 date 设为 null，表示用户选择“清除日期/移除此实例”，因此跳过生成该实例
                if (modification && Object.prototype.hasOwnProperty.call(modification, 'date') && modification.date === null) {
                    // 跳过该实例
                } else {
                    // 检查此实例是否已完成
                    const isInstanceCompleted = completedInstances.includes(currentDateStr);

                    const instance: RepeatInstance = {
                        title: modification?.title !== undefined ? modification.title : reminder.title,
                        date: modification?.date || currentDateStr,
                        time: modification?.time || reminder.time,
                        endDate: modification?.endDate || (reminder.endDate && reminder.date ? addDaysToDate(modification?.date || currentDateStr, getDaysDifference(reminder.date, reminder.endDate)) : undefined),
                        endTime: modification?.endTime || reminder.endTime,
                        customReminderTime: modification?.customReminderTime || reminder.customReminderTime,
                        reminderTimes: modification?.reminderTimes !== undefined ? modification.reminderTimes : reminder.reminderTimes,
                        customReminderPreset: modification?.customReminderPreset !== undefined ? modification.customReminderPreset : reminder.customReminderPreset,
                        instanceId: `${reminder.id}_${currentDateStr}`,
                        originalId: reminder.id,
                        isRepeatedInstance: true,
                        completed: isInstanceCompleted, // 设置实例级别的完成状态
                        completedTime: isInstanceCompleted ? instanceCompletedTimes[currentDateStr] : undefined,
                        // 合并覆盖字段
                        note: modification?.note !== undefined ? modification.note : (reminder.note || ''),
                        priority: modification?.priority !== undefined ? modification.priority : (reminder.priority || 'none'),
                        categoryId: modification?.categoryId !== undefined ? modification.categoryId : reminder.categoryId,
                        projectId: modification?.projectId !== undefined ? modification.projectId : reminder.projectId,
                        customGroupId: modification?.customGroupId !== undefined ? modification.customGroupId : reminder.customGroupId,
                        kanbanStatus: modification?.kanbanStatus !== undefined ? modification.kanbanStatus : reminder.kanbanStatus,
                        tagIds: modification?.tagIds !== undefined ? modification.tagIds : reminder.tagIds,
                        milestoneId: modification?.milestoneId !== undefined ? modification.milestoneId : reminder.milestoneId,
                        sort: (modification && typeof modification.sort === 'number') ? modification.sort : (reminder.sort || 0)
                    };

                    instances.push(instance);
                    instanceCount++;
                }
            }
        }

        // 移动到下一个可能的日期
        currentDate = getNextDate(currentDate, repeatConfig);
    }

    return instances;
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
            // 如果设置了monthDays，检查当前日期是否在指定的日期列表中
            if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                return repeatConfig.monthDays.includes(currentDate.getDate()) && currentDate >= originalDateObj;
            }
            // 否则按原有逻辑：检查与原始日期的日是否相同
            const monthsDiff = (currentDate.getFullYear() - originalDateObj.getFullYear()) * 12 +
                (currentDate.getMonth() - originalDateObj.getMonth());
            const sameDay = currentDate.getDate() === originalDateObj.getDate();
            return monthsDiff >= 0 && monthsDiff % (repeatConfig.interval || 1) === 0 && sameDay;

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
    const pattern = repeatConfig.ebbinghausPattern || [1, 2, 4, 7, 15];

    return pattern.includes(daysDiff);
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
            description = interval === 1 ? i18n("everyDay") : i18n("everyNDays", { n: interval.toString() });
            break;
        case 'weekly':
            if (repeatConfig.weekDays && repeatConfig.weekDays.length > 0) {
                const dayNames = [i18n("sun"), i18n("mon"), i18n("tue"), i18n("wed"), i18n("thu"), i18n("fri"), i18n("sat")];
                const days = repeatConfig.weekDays.map(d => dayNames[d]).join(',');
                description = `每周${days}`;
            } else {
                description = interval === 1 ? i18n("everyWeek") : i18n("everyNWeeks", { n: interval.toString() });
            }
            break;
        case 'monthly':
            if (repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                description = `每月${repeatConfig.monthDays.join(',')}日`;
            } else {
                description = interval === 1 ? i18n("everyMonth") : i18n("everyNMonths", { n: interval.toString() });
            }
            break;
        case 'yearly':
            if (repeatConfig.months && repeatConfig.months.length > 0 &&
                repeatConfig.monthDays && repeatConfig.monthDays.length > 0) {
                description = `每年${repeatConfig.months[0]}月${repeatConfig.monthDays[0]}日`;
            } else {
                description = interval === 1 ? i18n("everyYear") : i18n("everyNYears", { n: interval.toString() });
            }
            break;
        case 'lunar-monthly':
            description = i18n("lunarMonthlyRepeat");
            break;
        case 'lunar-yearly':
            description = i18n("lunarYearlyRepeat");
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
        const completedInstances = child.repeat?.completedInstances || [];
        const isInstanceCompleted = completedInstances.includes(instanceDate);
        const instanceModifications = child.repeat?.instanceModifications || {};
        const instanceMod = instanceModifications[instanceDate];

        const instanceTask = {
            ...child,
            id: instanceId,
            parentId: instanceParentId,
            date: instanceDate,
            // If subtask has end date, calculate based on original span
            endDate: instanceMod?.endDate || (child.endDate && child.date ? addDaysToDate(instanceDate, getDaysDifference(child.date, child.endDate)) : undefined),
            time: instanceMod?.time || child.time,
            endTime: instanceMod?.endTime || child.endTime,
            // 确保实例级 title 会覆盖模板 title（修复 ghost 子任务实例标题未更新的问题）
            title: instanceMod?.title !== undefined ? instanceMod.title : child.title,
            isRepeatInstance: true,
            originalId: child.id,
            completed: isInstanceCompleted,
            // Inherit/override properties
            note: instanceMod?.note !== undefined ? instanceMod.note : child.note,
            priority: instanceMod?.priority !== undefined ? instanceMod.priority : child.priority,
            categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : child.categoryId,
            projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : child.projectId,
            customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : child.customGroupId,
            kanbanStatus: instanceMod?.kanbanStatus !== undefined ? instanceMod.kanbanStatus : child.kanbanStatus,
            milestoneId: instanceMod?.milestoneId !== undefined ? instanceMod.milestoneId : child.milestoneId,
            tagIds: instanceMod?.tagIds !== undefined ? instanceMod.tagIds : child.tagIds,
            reminderTimes: instanceMod?.reminderTimes !== undefined ? instanceMod.reminderTimes : child.reminderTimes,
            customReminderPreset: instanceMod?.customReminderPreset !== undefined ? instanceMod.customReminderPreset : child.customReminderPreset,
            completedTime: isInstanceCompleted ? (instanceMod?.completedTime || child.repeat?.completedTimes?.[instanceDate] || getLocalDateTimeString(new Date(instanceDate))) : undefined,
            sort: (instanceMod && typeof instanceMod.sort === 'number') ? instanceMod.sort : (child.sort || 0)
        };

        targetList.push(instanceTask);

        // Recurse to children's children
        // Use the same parentCompletionTime for the entire subtree to maintain the snapshot at completion
        generateSubtreeInstances(child.id, instanceId, instanceDate, targetList, reminderData, parentCompletionTime);
    });
}
