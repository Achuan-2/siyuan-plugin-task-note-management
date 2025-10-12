import { RepeatConfig } from '../components/RepeatSettingsDialog';
import { compareDateStrings } from './dateUtils';
import { t } from './i18n';
import { solarToLunar } from './lunarUtils';

export interface RepeatInstance {
    date: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    instanceId: string; // 实例标识符
    originalId: string; // 原始提醒ID
    isRepeatedInstance: boolean;
    completed?: boolean; // 添加实例级别的完成状态
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
    let currentDate = new Date(reminder.date + 'T00:00:00');
    const endDateObj = new Date(endDate + 'T23:59:59');
    let instanceCount = 0;

    // 获取排除日期列表
    const excludeDates = repeatConfig.excludeDates || [];
    // 获取实例修改列表
    const instanceModifications = repeatConfig.instanceModifications || {};
    // 获取已完成实例列表
    const completedInstances = repeatConfig.completedInstances || [];

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
            if (shouldGenerateInstance(currentDate, reminder.date, repeatConfig) &&
                !excludeDates.includes(currentDateStr)) {

                // 检查是否有针对此实例的修改
                const modification = instanceModifications[currentDateStr];

                // 检查此实例是否已完成
                const isInstanceCompleted = completedInstances.includes(currentDateStr);

                const instance: RepeatInstance = {
                    date: modification?.date || currentDateStr,
                    time: modification?.time || reminder.time,
                    endDate: modification?.endDate || (reminder.endDate ? addDaysToDate(modification?.date || currentDateStr, getDaysDifference(reminder.date, reminder.endDate)) : undefined),
                    endTime: modification?.endTime || reminder.endTime,
                    instanceId: `${reminder.id}_${currentDateStr}`,
                    originalId: reminder.id,
                    isRepeatedInstance: true,
                    completed: isInstanceCompleted // 设置实例级别的完成状态
                };

                instances.push(instance);
                instanceCount++;
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
            const weeksDiff = Math.floor((currentDate.getTime() - originalDateObj.getTime()) / (7 * 24 * 60 * 60 * 1000));
            const sameWeekday = currentDate.getDay() === originalDateObj.getDay();
            return weeksDiff >= 0 && weeksDiff % (repeatConfig.interval || 1) === 0 && sameWeekday;

        case 'monthly':
            const monthsDiff = (currentDate.getFullYear() - originalDateObj.getFullYear()) * 12 +
                (currentDate.getMonth() - originalDateObj.getMonth());
            const sameDay = currentDate.getDate() === originalDateObj.getDate();
            return monthsDiff >= 0 && monthsDiff % (repeatConfig.interval || 1) === 0 && sameDay;

        case 'yearly':
            const yearsDiff = currentDate.getFullYear() - originalDateObj.getFullYear();
            const sameMonthDay = currentDate.getMonth() === originalDateObj.getMonth() &&
                currentDate.getDate() === originalDateObj.getDate();
            return yearsDiff >= 0 && yearsDiff % (repeatConfig.interval || 1) === 0 && sameMonthDay;

        case 'custom':
            return checkCustomRepeat(currentDate, originalDateObj, repeatConfig);

        case 'ebbinghaus':
            return checkEbbinghausRepeat(currentDate, originalDateObj, repeatConfig);

        case 'lunar-monthly':
            return checkLunarMonthlyRepeat(currentDate, repeatConfig);

        case 'lunar-yearly':
            return checkLunarYearlyRepeat(currentDate, repeatConfig);

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
function checkLunarMonthlyRepeat(currentDate: Date, repeatConfig: RepeatConfig): boolean {
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
function checkLunarYearlyRepeat(currentDate: Date, repeatConfig: RepeatConfig): boolean {
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
function getDaysDifference(startDate: string, endDate: string): number {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * 给日期添加指定天数
 */
function addDaysToDate(dateStr: string, days: number): string {
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
            description = interval === 1 ? t("everyDay") : t("everyNDays", { n: interval.toString() });
            break;
        case 'weekly':
            description = interval === 1 ? t("everyWeek") : t("everyNWeeks", { n: interval.toString() });
            break;
        case 'monthly':
            description = interval === 1 ? t("everyMonth") : t("everyNMonths", { n: interval.toString() });
            break;
        case 'yearly':
            description = interval === 1 ? t("everyYear") : t("everyNYears", { n: interval.toString() });
            break;
        case 'lunar-monthly':
            description = t("lunarMonthlyRepeat");
            break;
        case 'lunar-yearly':
            description = t("lunarYearlyRepeat");
            break;
        case 'custom':
            description = t("customRepeat");
            break;
        case 'ebbinghaus':
            description = t("ebbinghausRepeat");
            break;
    }

    // 添加结束条件
    if (repeatConfig.endType === 'date' && repeatConfig.endDate) {
        description += t("untilDate", { date: repeatConfig.endDate });
    } else if (repeatConfig.endType === 'count' && repeatConfig.endCount) {
        description += t("forNTimes", { n: repeatConfig.endCount.toString() });
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
