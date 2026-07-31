import { i18n } from '../../pluginInstance';
import { getLogicalDateString, getRelativeDateString } from '../../utils/dateUtils';
import { addDaysToDate } from '../dataManager/repeatUtils';
import { QuickReminderDialog } from '../dialog/QuickReminderDialog';

export interface QuickDateMenuOptions {
    plugin: any;
    targetTask: any;
    onlyThisInstance?: boolean;
    eventSource?: string;
    iconHTML?: string;
    onApplyStartDate: (newDate: string | null) => Promise<void> | void;
    onApplyEndDate: (newDate: string) => Promise<void> | void;
    onSaved?: (savedTask?: any) => Promise<void> | void;
}

/**
 * 弹出快速编辑日期的对话框 (QuickReminderDialog in dateOnly mode)
 */
export function openQuickDateEditDialog(options: {
    plugin: any;
    targetTask: any;
    onlyThisInstance?: boolean;
    eventSource?: string;
    onSaved?: (savedTask?: any) => Promise<void> | void;
}) {
    const { plugin, targetTask, onlyThisInstance = false, eventSource, onSaved } = options;
    const isInstanceEdit = targetTask.isRepeatInstance && onlyThisInstance;
    const getOriginalInstanceDate = () =>
        (targetTask.id && targetTask.id.includes('_')) ? targetTask.id.split('_').pop()! : targetTask.date;
    const originalInstanceDate = getOriginalInstanceDate();

    const dlg = new QuickReminderDialog(
        undefined, undefined, undefined, undefined,
        {
            mode: 'edit',
            eventSource: eventSource,
            reminder: isInstanceEdit ? {
                ...targetTask,
                isInstance: true,
                originalId: targetTask.originalId,
                instanceDate: originalInstanceDate
            } : targetTask,
            isInstanceEdit: isInstanceEdit,
            plugin: plugin,
            dateOnly: true,
            onSaved: async (savedTask?: any) => {
                if (onSaved) {
                    await onSaved(savedTask);
                }
            }
        }
    );
    dlg.show();
    return dlg;
}

/**
 * 构建统一的快速调整日期菜单项数组 (包含: 移至今天 (周X)、移至明天 (周X)、移至后天 (周X)、移至本周、移至下周、推迟7天、清除日期、编辑日期)
 */
export function buildQuickDateMenuItems(options: QuickDateMenuOptions): any[] {
    const {
        plugin,
        targetTask,
        onlyThisInstance = false,
        eventSource,
        iconHTML = "📅",
        onApplyStartDate,
        onApplyEndDate,
        onSaved
    } = options;

    const items: any[] = [];
    const todayStr = getLogicalDateString();
    const tomorrowStr = getRelativeDateString(1);
    const dayAfterStr = getRelativeDateString(2);

    const isSpanningTask = !!(targetTask.date && targetTask.endDate && targetTask.endDate !== targetTask.date);
    const editIcon = "✏️";
    const removeIcon = "❌";

    // 计算本周与下周的三级菜单及星期几后缀
    const [todayYear, todayMonth, todayDay] = todayStr.split('-').map(Number);
    const todayDateObj = new Date(todayYear, todayMonth - 1, todayDay);
    const currentIsoDay = todayDateObj.getDay() === 0 ? 7 : todayDateObj.getDay();

    const weekdayNames = [
        i18n("weekdayMon") || "周一",
        i18n("weekdayTue") || "周二",
        i18n("weekdayWed") || "周三",
        i18n("weekdayThu") || "周四",
        i18n("weekdayFri") || "周五",
        i18n("weekdaySat") || "周六",
        i18n("weekdaySun") || "周日"
    ];

    const todayWeekdayName = weekdayNames[currentIsoDay - 1];
    const tomorrowIsoDay = ((currentIsoDay % 7) + 1);
    const dayAfterIsoDay = (((currentIsoDay + 1) % 7) + 1);

    const tomorrowWeekdayName = weekdayNames[tomorrowIsoDay - 1];
    const dayAfterWeekdayName = weekdayNames[dayAfterIsoDay - 1];

    const todayLabel = `${i18n("moveToToday") || "移至今天"} (${todayWeekdayName})`;
    const tomorrowLabel = `${i18n("moveToTomorrow") || "移至明天"} (${tomorrowWeekdayName})`;
    const dayAfterLabel = `${i18n("moveToDayAfterTomorrow") || "移至后天"} (${dayAfterWeekdayName})`;

    const createThisWeekSubmenu = (applyDate: (newDate: string) => Promise<void> | void) => {
        const subItems: any[] = [];
        // 本周：仅显示今天及以后的星期 (从 currentIsoDay 到 7)
        for (let d = currentIsoDay; d <= 7; d++) {
            const daysOffset = d - currentIsoDay;
            const dateStr = addDaysToDate(todayStr, daysOffset);
            const dayName = weekdayNames[d - 1];
            subItems.push({
                iconHTML: iconHTML,
                label: dayName,
                click: () => applyDate(dateStr)
            });
        }
        return subItems;
    };

    const createNextWeekSubmenu = (applyDate: (newDate: string) => Promise<void> | void) => {
        const subItems: any[] = [];
        // 下周：显示周一到周日 (1 到 7)
        for (let d = 1; d <= 7; d++) {
            const daysOffset = 7 - currentIsoDay + d;
            const dateStr = addDaysToDate(todayStr, daysOffset);
            const dayName = weekdayNames[d - 1];
            subItems.push({
                iconHTML: iconHTML,
                label: dayName,
                click: () => applyDate(dateStr)
            });
        }
        return subItems;
    };

    const createDateTargetSubmenu = (
        applyDate: (newDate: string) => Promise<void> | void,
        getBaseDate?: () => string | undefined
    ) => {
        const submenuItems: any[] = [
            { iconHTML: iconHTML, label: todayLabel, click: () => applyDate(todayStr) },
            { iconHTML: iconHTML, label: tomorrowLabel, click: () => applyDate(tomorrowStr) },
            { iconHTML: iconHTML, label: dayAfterLabel, click: () => applyDate(dayAfterStr) },
        ];

        // 仅在周一至周四时显示“移至本周”（周五~周日时，今天/明天/后天已完全涵盖本周剩余日期）
        if (currentIsoDay < 5) {
            submenuItems.push({
                iconHTML: iconHTML,
                label: i18n("moveToThisWeek") || "移至本周",
                submenu: createThisWeekSubmenu(applyDate)
            });
        }

        submenuItems.push(
            { iconHTML: iconHTML, label: i18n("moveToNextWeek") || "移至下周", submenu: createNextWeekSubmenu(applyDate) },
            { iconHTML: iconHTML, label: i18n("postponeSevenDays") || "推迟7天", click: () => applyDate(addDaysToDate((getBaseDate ? getBaseDate() : null) || targetTask.date || targetTask.endDate || todayStr, 7)) }
        );

        return submenuItems;
    };

    const editDate = () => {
        openQuickDateEditDialog({
            plugin,
            targetTask,
            onlyThisInstance,
            eventSource,
            onSaved
        });
    };

    if (isSpanningTask) {
        items.push({
            iconHTML: iconHTML,
            label: i18n("adjustStartDate") || "调整开始日期",
            submenu: createDateTargetSubmenu(onApplyStartDate, () => targetTask.date)
        });
        items.push({
            iconHTML: iconHTML,
            label: i18n("adjustEndDate") || "调整结束日期",
            submenu: createDateTargetSubmenu(onApplyEndDate, () => targetTask.endDate || targetTask.date)
        });
        items.push({ iconHTML: removeIcon, label: i18n("clearDate") || "清除日期", click: () => onApplyStartDate(null) });
        items.push({ iconHTML: editIcon, label: i18n("editDate") || "编辑日期", click: editDate });
    } else {
        items.push({ iconHTML: iconHTML, label: todayLabel, click: () => onApplyStartDate(todayStr) });
        items.push({ iconHTML: iconHTML, label: tomorrowLabel, click: () => onApplyStartDate(tomorrowStr) });
        items.push({ iconHTML: iconHTML, label: dayAfterLabel, click: () => onApplyStartDate(dayAfterStr) });
        if (currentIsoDay < 5) {
            items.push({ iconHTML: iconHTML, label: i18n("moveToThisWeek") || "移至本周", submenu: createThisWeekSubmenu(onApplyStartDate) });
        }
        items.push({ iconHTML: iconHTML, label: i18n("moveToNextWeek") || "移至下周", submenu: createNextWeekSubmenu(onApplyStartDate) });
        items.push({ iconHTML: iconHTML, label: i18n("postponeSevenDays") || "推迟7天", click: () => onApplyStartDate(addDaysToDate(targetTask.date || targetTask.endDate || todayStr, 7)) });
        items.push({ iconHTML: removeIcon, label: i18n("clearDate") || "清除日期", click: () => onApplyStartDate(null) });
        items.push({ iconHTML: editIcon, label: i18n("editDate") || "编辑日期", click: editDate });
    }

    return items;
}
