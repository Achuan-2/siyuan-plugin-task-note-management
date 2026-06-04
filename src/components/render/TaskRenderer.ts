/**
 * 任务渲染核心类 (TaskRenderer)
 * 主要用途：集中处理任务（Task/Reminder）的 DOM 渲染逻辑，统一生成任务卡片组件。
 * 包含各个状态的展示（时间、优先级、子节点进度、番茄钟、项目及习惯关联等），以及操作事件（回调）绑定。
 * 供侧边栏面板、看板视图、四象限视图等各模块统一调用，以保证整体插件中任务 UI 和交互逻辑的一致性。
 */
import { colorWithOpacity } from "../../utils/uiUtils";
import { i18n } from "../../pluginInstance";
import { getLocalDateString, getLocalDateTimeString, compareDateStrings, getLogicalDateString, getRelativeDateString, getLocaleTag } from "../../utils/dateUtils";
import { getRepeatDescription } from "../../utils/repeatUtils";
import { getSolarDateLunarString } from "../../utils/lunarUtils";
import { shouldTreatStartDateOnlyAsOverdue, isOpenEndedStartDateTask } from "../../utils/startDateOverdue";
import { getReminderSkipWeekendsEffective, getReminderSkipHolidaysEffective, shouldSkipReminderOnDate } from "../../utils/reminderSkipDate";

export type TaskPriorityDisplayStyle = 'background' | 'checkboxBorder';

export interface TaskRenderContext {
    plugin: any;
    today: string;
    collapsedTasks?: Set<string>;
    selectedTaskIds?: Set<string>;
    isMultiSelectMode?: boolean;
    showCompletedSubtasks?: boolean;
    clipTitleToOneLine?: boolean;
    showProjectKanbanStatus?: boolean;
    showProjectBadge?: boolean;
    showDocumentTitle?: boolean;
    showCategoryBadge?: boolean; // 是否显示分类标签（默认 true）
    priorityDisplayStyle?: TaskPriorityDisplayStyle;
    allTasks?: any[]; // All tasks in context (e.g. for subtask progress ratio)
    customContainerClass?: string; // 自定义容器类名（如 'kanban-task'）

    // Managers / Helpers
    categoryManager?: any;
    milestoneMap?: Map<string, any>;
    lute?: any;

    // Cache lookup maps
    projectCache?: Map<string, any>; // Maps task.id (or task.projectId) to project info
    habitCache?: Map<string, any>;   // Maps task.id (or task.linkedHabitId) to habit info

    // Flag to determine custom status
    currentTab?: string;
    isMobileClient?: boolean;
    reminderSkipHolidayData?: any;

    // Fallback/Custom formatters if view needs to override them
    isReminderPinned?: (task: any) => boolean;
    getReminderKanbanStatusInfo?: (task: any) => any;
    formatReminderTime?: (dateStr: string, timeStr: string, today: string, endDateStr?: string, endTimeStr?: string, task?: any) => string;
    formatCompletedTime?: (timeStr: string) => string;
    isTodayCompleted?: (task: any, today: string) => boolean;
    getCompletedTime?: (task: any) => string;
    canApplyTodayIgnore?: (task: any, today: string) => boolean;
    hasTodayIgnoreMark?: (task: any, today: string) => boolean;
    parseReminderInstanceId?: (id: string) => { originalId: string; instanceDate: string } | null;
    isTaskCollapsed?: (task: any, hasChildren: boolean, childrenInVisibleBatch: boolean, allVisibleTasks: any[]) => boolean;
    getTaskStatus?: (task: any) => string;
}

export interface TaskRenderCallbacks {
    onCheckboxClick?: (task: any, checked: boolean, event: Event) => void;
    onCollapseClick?: (task: any, collapsed: boolean, event: MouseEvent) => void | Promise<void>;
    onMoreClick?: (task: any, element: HTMLElement, event: MouseEvent) => void;
    onCardClick?: (task: any, event: MouseEvent) => void;
    onCardDoubleClick?: (task: any, event: MouseEvent) => void;
    onTitleClick?: (task: any, event: MouseEvent) => void;
    onDocumentTitleClick?: (task: any, docId: string, event: MouseEvent) => void;
    onParentTitleClick?: (task: any, event: MouseEvent) => void;
    onNoteClick?: (task: any, event: MouseEvent) => void;
    onTimeClick?: (task: any, event: MouseEvent) => void;
    onProjectClick?: (task: any, event: MouseEvent) => void;
    onHabitClick?: (task: any, event: MouseEvent) => void;
    onMilestoneClick?: (task: any, event: MouseEvent) => void;
    setupDragAndDrop?: (taskEl: HTMLElement, task: any) => void;
}

export class TaskRenderer {
    public static getPriorityColors(priority: string): { backgroundColor: string; borderColor: string } {
        switch (priority) {
            case 'high':
                return {
                    backgroundColor: colorWithOpacity('var(--b3-card-error-background)', 0.5),
                    borderColor: 'var(--b3-card-error-color)'
                };
            case 'medium':
                return {
                    backgroundColor: colorWithOpacity('var(--b3-card-warning-background)', 0.5),
                    borderColor: 'var(--b3-card-warning-color)'
                };
            case 'low':
                return {
                    backgroundColor: colorWithOpacity('var(--b3-card-info-background)', 0.7),
                    borderColor: 'var(--b3-card-info-color)'
                };
            default:
                return {
                    backgroundColor: '',
                    borderColor: 'var(--b3-theme-surface-lighter)'
                };
        }
    }

    public static getPriorityCheckboxBorderColor(priority: string): string | null {
        switch (priority) {
            case 'high':
                return 'red';
            case 'medium':
                return 'orange';
            case 'low':
                return '#2998fa';
            default:
                return null;
        }
    }

    public static getPriorityDisplayStyle(context?: TaskRenderContext): TaskPriorityDisplayStyle {
        const style = context?.priorityDisplayStyle || context?.plugin?.settings?.taskPriorityDisplayStyle;
        return style === 'checkboxBorder' ? 'checkboxBorder' : 'background';
    }

    private static shouldRenderDocumentTitle(task: any, context: TaskRenderContext): boolean {
        if (context.showDocumentTitle !== true) return false;
        const blockId = task?.blockId;
        const docId = task?.docId;
        return !!(blockId && docId && blockId !== docId);
    }

    private static createDocumentTitleElement(
        task: any,
        docId: string,
        docTitle: string,
        callbacks: TaskRenderCallbacks
    ): HTMLElement {
        const belongsLabel = i18n("belongsToDocument") || "所属文档";
        const docTitleEl = document.createElement('div');
        docTitleEl.className = 'reminder-item__doc-title';
        docTitleEl.style.cssText = `
            font-size: 11px;
            color: var(--b3-theme-on-background);
            margin-bottom: 2px;
            opacity: 1;
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 0;
        `;

        const docIcon = document.createElement('span');
        docIcon.textContent = '📄';
        docIcon.style.fontSize = '10px';

        const docTitleLink = document.createElement('span');
        docTitleLink.setAttribute('data-type', 'a');
        docTitleLink.setAttribute('data-href', `siyuan://blocks/${docId}`);
        docTitleLink.textContent = docTitle;
        docTitleLink.classList.add('ariaLabel');
        docTitleLink.setAttribute('aria-label', `${belongsLabel}: ${docTitle}`);
        docTitleLink.style.cssText = `
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
            color: var(--b3-theme-on-background);
            text-decoration: underline;
            text-decoration-style: dotted;
        `;

        docTitleEl.addEventListener('click', (e) => {
            if (!callbacks.onDocumentTitleClick) return;
            e.preventDefault();
            e.stopPropagation();
            callbacks.onDocumentTitleClick(task, docId, e);
        });
        docTitleLink.addEventListener('mouseenter', () => {
            docTitleLink.style.color = 'var(--b3-theme-primary)';
        });
        docTitleLink.addEventListener('mouseleave', () => {
            docTitleLink.style.color = 'var(--b3-theme-on-background)';
        });

        docTitleEl.appendChild(docIcon);
        docTitleEl.appendChild(docTitleLink);
        return docTitleEl;
    }

    public static applyPriorityDisplayStyle(
        taskEl: HTMLElement,
        checkbox: HTMLInputElement | null,
        priority: string,
        displayStyle: TaskPriorityDisplayStyle = 'background'
    ): void {
        const normalizedPriority = priority || 'none';
        const { backgroundColor, borderColor } = this.getPriorityColors(normalizedPriority);

        if (displayStyle === 'checkboxBorder') {
            taskEl.style.backgroundColor = '';
            taskEl.style.border = '1.5px solid var(--b3-theme-surface-lighter)';
            taskEl.dataset.priorityDisplayStyle = 'checkboxBorder';
            if (checkbox) {
                const checkboxBorderColor = this.getPriorityCheckboxBorderColor(normalizedPriority);
                checkbox.style.borderColor = checkboxBorderColor || '';
                checkbox.style.borderWidth = checkboxBorderColor ? '0.12em' : '';
            }
            return;
        }

        taskEl.style.backgroundColor = backgroundColor;
        taskEl.style.border = `1.5px solid ${borderColor}`;
        taskEl.dataset.priorityDisplayStyle = 'background';
        if (checkbox) {
            checkbox.style.borderColor = '';
            checkbox.style.borderWidth = '';
        }
    }

    /**
     * 根据提醒的日期和时间计算其“逻辑日期”（考虑一天起始时间设置）
     */
    public static getReminderLogicalDate(dateStr?: string, timeStr?: string, plugin?: any): string {
        if (!dateStr) return '';
        if (timeStr) {
            try {
                return getLogicalDateString(new Date(dateStr + 'T' + timeStr));
            } catch (e) {
                return dateStr;
            }
        }
        return dateStr;
    }

    /**
     * 判断是否是跨天且昨天已完成的任务
     */
    private static isSpanningEventYesterdayCompleted(reminder: any, todayStr: string, plugin: any): boolean {
        if (!reminder.endDate || reminder.endDate === reminder.date) return false;
        if (!reminder.completed) return false;

        const completedTime = reminder.completedTime ? new Date(reminder.completedTime) : null;
        if (!completedTime) return false;

        const completedLogicalDate = getLogicalDateString(completedTime);
        const yesterdayStr = getRelativeDateString(-1);
        if (completedLogicalDate !== yesterdayStr) return false;

        const startLogical = this.getReminderLogicalDate(reminder.date || reminder.endDate, reminder.time || reminder.endTime, plugin);
        const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time, plugin);
        return compareDateStrings(startLogical, yesterdayStr) <= 0 && compareDateStrings(yesterdayStr, endLogical) <= 0;
    }

    /**
     * 格式化截止时间 / 时间范围
     */
    public static formatReminderTime(date: string, time?: string, today?: string, endDate?: string, endTime?: string, reminder?: any, context?: TaskRenderContext): string {
        if (context?.formatReminderTime) {
            return context.formatReminderTime(date, time || '', today || '', endDate, endTime, reminder);
        }

        if (!today) {
            today = getLogicalDateString();
        }

        const tomorrowStr = getRelativeDateString(1);
        const logicalStart = this.getReminderLogicalDate(date, time, context?.plugin);
        const logicalEnd = this.getReminderLogicalDate(endDate || date, endTime || time, context?.plugin);

        let dateStr = '';
        const formatDateLabel = (dateStr: string, logicalDate: string): string => {
            if (logicalDate === today) return i18n("today");
            if (logicalDate === tomorrowStr) return i18n("tomorrow");
            const d = new Date(dateStr + 'T00:00:00');
            const currentYear = new Date().getFullYear();
            return d.getFullYear() !== currentYear
                ? d.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'short', day: 'numeric' })
                : d.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
        };

        dateStr = formatDateLabel(date, logicalStart);

        // 如果是农历循环事件，添加农历日期显示
        if (reminder?.repeat?.enabled && (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly')) {
            try {
                const lunarStr = getSolarDateLunarString(date);
                if (lunarStr) {
                    dateStr = `${dateStr} (${lunarStr})`;
                }
            } catch (error) {
                console.error('Failed to format lunar date:', error);
            }
        }

        let result = '';

        // 处理跨天事件
        if (endDate && endDate !== date) {
            const endDateStr = formatDateLabel(endDate, logicalEnd);
            const startTimeStr = time ? ` ${time}` : '';
            const endTimeStr = endTime ? ` ${endTime}` : '';
            result = `${dateStr}${startTimeStr} → ${endDateStr}${endTimeStr}`;
        } else if (endTime && endTime !== time) {
            // 当天时间段
            result = `${dateStr} ${time || ''} - ${endTime}`;
        } else {
            result = time ? `${dateStr} ${time}` : dateStr;
        }

        // 如果是无日期的任务，我们不要前面的 dateStr / time
        const hasNoDate = reminder && !reminder.date && !reminder.endDate;
        if (hasNoDate) {
            result = '';
        }

        // 处理 reminderTimes
        try {
            const entries: Array<{ time: string; note?: string; everyDay?: boolean }> = [];
            if (reminder?.reminderTimes && Array.isArray(reminder.reminderTimes)) {
                reminder.reminderTimes.forEach((rtItem: any) => {
                    if (!rtItem) return;
                    const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                    const note = typeof rtItem === 'string' ? '' : String(rtItem.note || '').trim();
                    if (rt) {
                        entries.push({ time: rt, note, everyDay: !!rtItem.everyDay });
                    }
                });
            }
            if (entries.length === 0 && typeof reminder?.customReminderTime === 'string' && reminder.customReminderTime.trim()) {
                entries.push({ time: reminder.customReminderTime.trim() });
            }

            if (entries.length > 0) {
                const times = entries.map((rtItem: any) => {
                    if (!rtItem) return '';
                    const rt = rtItem.time;
                    const note = String(rtItem.note || '').trim();
                    if (!rt) return '';
                    const s = String(rt).trim();
                    let datePart: string | null = null;
                    let timePart: string | null = null;

                    if (s.includes('T')) {
                        const parts = s.split('T');
                        datePart = parts[0];
                        timePart = parts[1] || null;
                    } else {
                        timePart = s;
                    }

                    let targetDate = datePart || date || today;
                    if (rtItem.everyDay) {
                        const logicalStart = this.getReminderLogicalDate(date, time, context?.plugin);
                        const logicalEnd = this.getReminderLogicalDate(endDate || date, endTime || time, context?.plugin);
                        if (logicalStart && logicalEnd) {
                            if (compareDateStrings(today, logicalStart) < 0) {
                                if (reminder?.isAvailableToday) {
                                    targetDate = today;
                                } else {
                                    targetDate = date;
                                }
                            } else if (compareDateStrings(today, logicalEnd) > 0) {
                                targetDate = endDate || date;
                            } else {
                                targetDate = today;
                            }
                        }
                    }
                    const logicalTarget = this.getReminderLogicalDate(targetDate, timePart || undefined, context?.plugin);

                    if (compareDateStrings(logicalTarget, today) < 0) return ''; // 过去的不显示

                    if (compareDateStrings(logicalTarget, today) === 0) {
                        const displayTime = timePart ? timePart.substring(0, 5) : '';
                        return note && displayTime ? `${displayTime}（${note}）` : displayTime;
                    } else {
                        const d = new Date(targetDate + 'T00:00:00');
                        const ds = d.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
                        const displayTime = `${ds}${timePart ? ' ' + timePart.substring(0, 5) : ''}`;
                        return note ? `${displayTime}（${note}）` : displayTime;
                    }
                }).filter(Boolean).join(', ');

                if (times) {
                    result += ` ⏰${times}`;
                }
            }
        } catch (e) {
            console.warn('格式化 reminderTimes 失败', e);
        }

        return result.trim();
    }

    /**
     * 创建倒计时标签
     */
    private static createCountdownBadge(task: any, today: string, context: TaskRenderContext): HTMLElement | null {
        if (!task.date && !task.endDate) {
            return null;
        }
        let targetDate: string;
        let isOverdueEvent = false;
        let isStartedOnlyEvent = false;

        const startLogical = this.getReminderLogicalDate(task.date || task.endDate, task.time || task.endTime, context.plugin);
        const endLogical = this.getReminderLogicalDate(task.endDate || task.date, task.endTime || task.time, context.plugin);
        const hasStartDate = !!task.date;
        const hasEndDate = !!task.endDate;
        const isOnlyEndDate = !hasStartDate && hasEndDate;
        const isOnlyStartDate = hasStartDate && !hasEndDate;

        const treatsOnlyStartAsDeadline = isOnlyStartDate && shouldTreatStartDateOnlyAsOverdue(task, context.plugin?.settings);
        const isSpanningRealEvent = !!(hasStartDate && hasEndDate && task.endDate !== task.date);

        if (isSpanningRealEvent) {
            const isInRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;
            if (isInRange) {
                targetDate = endLogical;
            } else if (compareDateStrings(startLogical, today) > 0) {
                targetDate = startLogical;
            } else {
                if (!task.completed) {
                    targetDate = endLogical;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            }
        } else {
            if (compareDateStrings(startLogical, today) > 0) {
                targetDate = startLogical;
            } else if (compareDateStrings(startLogical, today) < 0) {
                if (!task.completed) {
                    targetDate = startLogical;
                    if (isOnlyStartDate && !treatsOnlyStartAsDeadline) {
                        isStartedOnlyEvent = true;
                    } else {
                        isOverdueEvent = true;
                    }
                } else {
                    return null;
                }
            } else {
                return null;
            }
        }

        const target = new Date(targetDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffTime = target.getTime() - todayDate.getTime();
        const daysDiff = Math.round(diffTime / (1000 * 60 * 60 * 24));

        const isTargetEndForSpanning = isSpanningRealEvent && targetDate === endLogical;
        const isInRangeForSpanning = isSpanningRealEvent && compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

        if (daysDiff === 0 && !(isTargetEndForSpanning && isInRangeForSpanning)) {
            return null;
        }

        const countdownEl = document.createElement('div');
        countdownEl.className = 'reminder-countdown';

        const applyCountdownStyle = (colorVar: string, backgroundVar: string) => {
            countdownEl.style.cssText = `
                color: var(${colorVar});
                font-size: 12px;
                font-weight: 500;
                background: var(${backgroundVar});
                border: 1px solid var(${colorVar});
                border-radius: 4px;
                padding: 2px 6px;
                flex-shrink: 0;
            `;
        };

        if (isStartedOnlyEvent && daysDiff < 0) {
            applyCountdownStyle('--b3-card-success-color', '--b3-card-success-background');
            countdownEl.textContent = i18n("startedDays", { days: Math.abs(daysDiff).toString() });
        } else if (isOverdueEvent || daysDiff < 0) {
            applyCountdownStyle('--b3-font-color1', '--b3-font-background1');
            const overdueDays = Math.abs(daysDiff);
            countdownEl.textContent = overdueDays === 1
                ? i18n("overdueBySingleDay")
                : i18n("overdueByDays", { days: overdueDays.toString() });
        } else {
            applyCountdownStyle('--b3-font-color4', '--b3-font-background4');
            if (isSpanningRealEvent) {
                const isInRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;
                if (isInRange) {
                    applyCountdownStyle('--b3-font-color2', '--b3-font-background2');
                    countdownEl.textContent = daysDiff === 1
                        ? i18n("spanningDaysLeftSingle")
                        : i18n("spanningDaysLeftPlural", { days: daysDiff.toString() });
                } else {
                    applyCountdownStyle('--b3-font-color4', '--b3-font-background4');
                    countdownEl.textContent = i18n("startInDays", { days: daysDiff.toString() });
                }
            } else if (isOnlyEndDate) {
                applyCountdownStyle('--b3-font-color2', '--b3-font-background2');
                countdownEl.textContent = i18n("endsInNDays", { days: daysDiff.toString() });
            } else {
                applyCountdownStyle('--b3-font-color4', '--b3-font-background4');
                countdownEl.textContent = i18n("startInDays", { days: daysDiff.toString() });
            }
        }

        return countdownEl;
    }

    /**
     * 格式化专注时间字符串
     */
    private static formatMinutesToString(minutes: number): string {
        const hours = Math.floor(minutes / 60);
        const mins = Math.floor(minutes % 60);
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    }

    /**
     * 计算并渲染进度条
     */
    private static renderProgressBar(task: any, context: TaskRenderContext, infoEl: HTMLElement): void {
        let percent = 0;
        let shouldShow = false;

        const customPercent = this.normalizeCustomProgress(task.customProgress);
        if (customPercent !== undefined) {
            shouldShow = true;
            percent = task.completed ? 100 : customPercent;
        } else if (context.allTasks) {
            const directChildren = context.allTasks.filter((t: any) => t.parentId === task.id);
            if (directChildren.length > 0) {
                shouldShow = true;
                const completedCount = directChildren.filter((c: any) => c.completed).length;
                percent = Math.round((completedCount / directChildren.length) * 100);
            }
        }

        if (shouldShow) {
            percent = Math.max(0, Math.min(100, percent));
            const progressContainer = document.createElement('div');
            progressContainer.className = 'reminder-progress-container reminder-item__progress-container';
            progressContainer.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                margin-top: 4px;
                width: 100%;
            `;

            const progressBarWrap = document.createElement('div');
            progressBarWrap.className = 'reminder-progress-wrap reminder-item__progress-wrap';
            progressBarWrap.style.cssText = `
                flex: 1;
                height: 4px;
                background-color: var(--b3-theme-surface-lighter);
                border-radius: 2px;
                overflow: hidden;
            `;

            const progressBar = document.createElement('div');
            progressBar.className = 'reminder-progress-bar reminder-item__progress-bar';
            progressBar.style.cssText = `
                width: ${percent}%;
                height: 100%;
                background-color: var(--b3-theme-primary);
                border-radius: 2px;
                transition: width 0.3s ease;
            `;
            progressBarWrap.appendChild(progressBar);

            const percentLabel = document.createElement('span');
            percentLabel.className = 'reminder-progress-text reminder-item__progress-text';
            percentLabel.style.cssText = `
                font-size: 10px;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                white-space: nowrap;
                min-width: 28px;
                text-align: right;
            `;
            percentLabel.textContent = `${percent}%`;

            progressContainer.appendChild(progressBarWrap);
            progressContainer.appendChild(percentLabel);
            infoEl.appendChild(progressContainer);
        }
    }

    private static normalizeCustomProgress(val: any): number | undefined {
        if (val === undefined || val === null || val === '') return undefined;
        const num = Number(val);
        return isNaN(num) ? undefined : num;
    }

    /**
     * 核心渲染函数
     */
    public static render(
        task: any,
        context: TaskRenderContext,
        callbacks: TaskRenderCallbacks,
        level: number = 0,
        allVisibleTasks: any[] = []
    ): HTMLElement {
        const today = context.today;
        const treatsOnlyStartAsDeadline = shouldTreatStartDateOnlyAsOverdue(task, context.plugin?.settings);

        // 改进过期判断逻辑
        let isOverdue = false;
        if (!task.completed && (task.endDate || treatsOnlyStartAsDeadline)) {
            const endLogical = this.getReminderLogicalDate(
                task.endDate || task.date,
                task.endDate ? (task.endTime || task.time) : task.time,
                context.plugin
            );
            isOverdue = compareDateStrings(endLogical, today) < 0;
        }

        const isSpanningDays = !!(task.endDate && task.endDate !== task.date);
        const priority = task.priority || 'none';

        // 判断是否有子任务
        const childrenInVisibleBatch = allVisibleTasks.some(r => r.parentId === task.id);
        let hasChildren = childrenInVisibleBatch;
        if (!hasChildren && context.allTasks) {
            hasChildren = context.allTasks.some(r => r.parentId === task.id);
        }

        // 如果子任务不在当前渲染批次（如侧栏今日视图子任务无今日日期），则视为折叠状态，
        // 这样点击折叠按钮会触发展开（showChildrenRecursively），而非错误地触发折叠
        const collapsedBySet = context.collapsedTasks ? context.collapsedTasks.has(task.id) : false;
        const childrenNotRendered = hasChildren && !childrenInVisibleBatch;
        let isCollapsed = context.isTaskCollapsed
            ? context.isTaskCollapsed(task, hasChildren, childrenInVisibleBatch, allVisibleTasks)
            : (collapsedBySet || childrenNotRendered);

        // 计算最大深度
        let maxChildDepth = 0;
        if (hasChildren && allVisibleTasks.length > 0) {
            const calculateDepth = (id: string, currentDepth: number): number => {
                const children = allVisibleTasks.filter(r => r.parentId === id);
                if (children.length === 0) return currentDepth;

                let maxDepth = currentDepth;
                for (const child of children) {
                    const childDepth = calculateDepth(child.id, currentDepth + 1);
                    maxDepth = Math.max(maxDepth, childDepth);
                }
                return maxDepth;
            };
            maxChildDepth = calculateDepth(task.id, 0);
        }

        // 创建根元素
        const taskEl = document.createElement('div');

        // 拼接基础与视图自定义类名
        const baseClasses = ['reminder-item'];
        if (context.customContainerClass) {
            baseClasses.push(context.customContainerClass);
        }
        if (isOverdue) baseClasses.push('reminder-item--overdue');
        if (isSpanningDays) baseClasses.push('reminder-item--spanning');
        baseClasses.push(`reminder-priority-${priority}`);

        const isSelected = context.selectedTaskIds?.has(task.id) || false;
        if (isSelected) {
            baseClasses.push('reminder-item--selected');
        }

        taskEl.setAttribute('data-level', level.toString());
        if (level > 0) {
            baseClasses.push('is-subtask');
            taskEl.style.marginLeft = `${level * 20}px`;
        }

        if (hasChildren && maxChildDepth > 1) {
            taskEl.setAttribute('data-has-deep-children', maxChildDepth.toString());
            baseClasses.push('reminder-item--has-deep-children');
        }

        taskEl.className = baseClasses.join(' ');
        taskEl.setAttribute('data-task-id', task.id);
        taskEl.setAttribute('data-reminder-id', task.id);
        taskEl.setAttribute('data-priority', priority);

        // 设置移动端防误拖拽
        const isMobile = context.isMobileClient || false;
        taskEl.setAttribute('draggable', isMobile ? 'false' : 'true');
        if (context.plugin?.isInMobileApp) {
            taskEl.style.setProperty('-webkit-user-select', 'none');
            taskEl.style.setProperty('user-select', 'none');
            taskEl.style.setProperty('-webkit-touch-callout', 'none');
        }

        const priorityDisplayStyle = this.getPriorityDisplayStyle(context);
        this.applyPriorityDisplayStyle(taskEl, null, priority, priorityDisplayStyle);
        taskEl.style.position = 'relative';

        // 注册拖拽与手势 hook
        if (callbacks.setupDragAndDrop) {
            callbacks.setupDragAndDrop(taskEl, task);
        }

        // 注册点击与右键 hook
        taskEl.addEventListener('click', (e: MouseEvent) => {
            if (callbacks.onCardClick) {
                callbacks.onCardClick(task, e);
            }
        });
        taskEl.addEventListener('dblclick', (e: MouseEvent) => {
            if (callbacks.onCardDoubleClick) {
                callbacks.onCardDoubleClick(task, e);
            }
        });
        taskEl.addEventListener('contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (callbacks.onMoreClick) {
                callbacks.onMoreClick(task, taskEl, e);
            }
        });

        // 更多按钮
        const itemMoreBtn = document.createElement('button');
        itemMoreBtn.type = 'button';
        itemMoreBtn.className = 'b3-button b3-button--text reminder-item__more-button';
        itemMoreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        itemMoreBtn.classList.add('ariaLabel');
        itemMoreBtn.setAttribute('aria-label', i18n("more") || "更多");
        itemMoreBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        itemMoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (callbacks.onMoreClick) {
                callbacks.onMoreClick(task, itemMoreBtn, e);
            }
        });
        taskEl.appendChild(itemMoreBtn);

        // 主体内容容器
        const contentEl = document.createElement('div');
        contentEl.className = 'reminder-item__content';

        // 复选框和折叠按钮容器
        const leftControls = document.createElement('div');
        leftControls.className = 'reminder-item__left-controls';

        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'reminder-task-checkbox';
        checkbox.checked = !!task.completed;
        const isEditable = !task.isSubscribed || (task.subscriptionType === 'caldav' && task.caldavEditable);
        if (!isEditable) {
            checkbox.disabled = true;
        }
        this.applyPriorityDisplayStyle(taskEl, checkbox, priority, priorityDisplayStyle);
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            if (callbacks.onCheckboxClick) {
                callbacks.onCheckboxClick(task, checkbox.checked, e);
            }
        });
        leftControls.appendChild(checkbox);

        // 折叠按钮
        if (hasChildren) {
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text collapse-btn';
            collapseBtn.classList.add('ariaLabel');
            const updateCollapseButton = () => {
                collapseBtn.innerHTML = isCollapsed
                    ? '<svg><use xlink:href="#iconRight"></use></svg>'
                    : '<svg><use xlink:href="#iconDown"></use></svg>';
                collapseBtn.setAttribute('aria-label', isCollapsed ? i18n("expand") : i18n("collapse"));
            };
            updateCollapseButton();
            collapseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (callbacks.onCollapseClick) {
                    const nextCollapsed = !isCollapsed;
                    await callbacks.onCollapseClick(task, nextCollapsed, e);
                    isCollapsed = nextCollapsed;
                    updateCollapseButton();
                }
            });
            leftControls.appendChild(collapseBtn);
        }
        contentEl.appendChild(leftControls);

        // 信息内容
        const infoEl = document.createElement('div');
        infoEl.className = 'reminder-item__info';
        const cachedProjHabit = context.projectCache?.get(task.id)
            || (task.projectId ? context.projectCache?.get(task.projectId) : undefined);

        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-item__title-container';

        if (this.shouldRenderDocumentTitle(task, context)) {
            const docTitle = String(cachedProjHabit?.docTitle || task.docTitle || '').trim();
            if (docTitle) {
                titleContainer.appendChild(
                    this.createDocumentTitleElement(task, task.docId, docTitle, callbacks)
                );
            }
        }

        // 新增：父任务层级路径显示
        const isParentHidden = task.parentId && !allVisibleTasks.some(r => r.id === task.parentId);
        let isIndependentKanbanSubtask = false;
        if (context.customContainerClass === 'kanban-task' && task.parentId && context.getTaskStatus && context.allTasks) {
            const parent = context.allTasks.find((t: any) => t.id === task.parentId);
            if (parent) {
                const currentStatus = context.getTaskStatus(task);
                const parentStatus = context.getTaskStatus(parent);
                if (currentStatus !== parentStatus) {
                    isIndependentKanbanSubtask = true;
                }
            }
        }

        if (level === 0 && (isParentHidden || isIndependentKanbanSubtask) && context.allTasks) {
            const ancestors: string[] = [];
            let currentParentId = task.parentId;
            while (currentParentId) {
                const parent = context.allTasks.find((t: any) => t.id === currentParentId);
                if (parent) {
                    ancestors.unshift(parent.title || i18n("unnamedNote"));
                    currentParentId = parent.parentId;
                } else {
                    break;
                }
            }
            if (ancestors.length > 0) {
                const parentHierarchyEl = document.createElement('div');
                parentHierarchyEl.className = 'reminder-item__parent-hierarchy';
                parentHierarchyEl.style.cssText = `
                    font-size: 10px;
                    color: var(--b3-theme-on-surface-light);
                    margin-bottom: 2px;
                    opacity: 0.8;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    cursor: default;
                `;
                parentHierarchyEl.textContent = ancestors.join(' > ');
                parentHierarchyEl.title = ancestors.join(' > ');
                titleContainer.appendChild(parentHierarchyEl);
            }
        }

        const titleRow = document.createElement('div');
        titleRow.className = 'reminder-item__title-row';

        // 📌 置顶徽章
        const isPinned = context.isReminderPinned ? context.isReminderPinned(task) : false;
        if (isPinned) {
            const pinBadge = document.createElement('span');
            pinBadge.className = 'reminder-item__pin-badge';
            pinBadge.textContent = '📌';
            titleRow.appendChild(pinBadge);
        }

        // 标题元素
        const titleEl = document.createElement('span');
        titleEl.className = 'reminder-item__title';

        const boundBlockId = task.blockId || task.docId;
        if (boundBlockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${boundBlockId}`);
            titleEl.style.cssText = `cursor: pointer; color: var(--b3-protyle-inline-blockref-color); text-decoration: underline; text-decoration-style: dotted; font-weight: 500;`;
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (callbacks.onTitleClick) {
                    callbacks.onTitleClick(task, e);
                }
            });
        } else {
            titleEl.style.cssText = `font-weight: 500; color: var(--b3-theme-on-surface); cursor: default; text-decoration: none;`;
        }

        if (context.clipTitleToOneLine) {
            titleEl.style.cssText += `; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; word-break: break-all; margin-bottom: 0;`;
        }

        titleEl.textContent = task.title || i18n("unnamedNote");
        titleEl.classList.add('ariaLabel');
        titleEl.setAttribute('aria-label', boundBlockId ? `点击打开绑定块: ${task.title || i18n("unnamedNote")}` : (task.title || i18n("unnamedNote")));
        titleRow.appendChild(titleEl);

        // 链接 URL 链图标
        if (task.url) {
            const urlIcon = document.createElement('a');
            urlIcon.className = 'reminder-item__url-icon';
            urlIcon.href = task.url;
            urlIcon.target = '_blank';
            urlIcon.classList.add('ariaLabel');
            urlIcon.setAttribute('aria-label', (i18n("openUrl") || "打开链接") + ': ' + task.url);
            urlIcon.innerHTML = '<svg style="width: 14px; height: 14px; vertical-align: middle; margin-left: 4px;"><use xlink:href="#iconOpenWindow"></use></svg>';
            urlIcon.style.cssText = 'color: var(--b3-theme-primary); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;';
            urlIcon.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            titleRow.appendChild(urlIcon);
        }
        titleContainer.appendChild(titleRow);
        infoEl.appendChild(titleContainer);

        // 时间与倒计时容器
        const timeContainer = document.createElement('div');
        timeContainer.className = 'reminder-item__time-container';
        timeContainer.style.cssText = `display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;`;

        if (task.repeat?.enabled || task.isRepeatInstance) {
            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'reminder-repeat-icon';
            repeatIcon.textContent = '🔄';
            repeatIcon.classList.add('ariaLabel');
            repeatIcon.setAttribute('aria-label', task.repeat?.enabled ? getRepeatDescription(task.repeat) : (i18n("repeatInstance") || "周期事件实例"));
            timeContainer.appendChild(repeatIcon);
        }

        const hasCustomTimes = (task.reminderTimes && task.reminderTimes.length > 0) || (typeof task.customReminderTime === 'string' && task.customReminderTime.trim());
        const displayDate = task.date || task.endDate || (hasCustomTimes ? today : null);
        if (displayDate) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-item__time';
            const displayTime = task.date ? task.time : (task.endTime || task.time);
            const timeText = this.formatReminderTime(displayDate, displayTime, today, task.endDate, task.endTime, task, context);
            const hasNoDate = !task.date && !task.endDate;
            timeEl.textContent = (hasNoDate ? '' : '🗓') + timeText;

            const isEditable = !task.isSubscribed || (task.subscriptionType === 'caldav' && task.caldavEditable);
            if (isEditable) {
                timeEl.style.cursor = 'pointer';
                timeEl.classList.add('ariaLabel');
                timeEl.setAttribute('aria-label', i18n("clickToModifyTime") || "点击修改时间");
                timeEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (callbacks.onTimeClick) {
                        callbacks.onTimeClick(task, e);
                    }
                });
            } else {
                timeEl.classList.add('ariaLabel');
                timeEl.setAttribute('aria-label', i18n("subscribedTaskReadOnly") || "订阅任务（只读）");
                timeEl.style.cursor = 'default';
            }
            timeContainer.appendChild(timeEl);

            const countdownEl = this.createCountdownBadge(task, today, context);
            if (countdownEl) {
                timeContainer.appendChild(countdownEl);
            }
        }
        infoEl.appendChild(timeContainer);

        // 番茄钟信息展示
        const pomodoroCount = cachedProjHabit?.pomodoroCount ?? task.pomodoroCount;
        const focusTime = cachedProjHabit?.focusTime ?? task.focusTime;
        const todayPomodoroCount = cachedProjHabit?.todayPomodoroCount ?? task.todayPomodoroCount;
        const todayFocusTime = cachedProjHabit?.todayFocusTime ?? task.todayFocusTime;
        const totalRepeatingPomodoroCount = cachedProjHabit?.totalRepeatingPomodoroCount ?? task.totalRepeatingPomodoroCount;
        const totalRepeatingFocusTime = cachedProjHabit?.totalRepeatingFocusTime ?? task.totalRepeatingFocusTime;

        if ((pomodoroCount && pomodoroCount > 0) ||
            (todayPomodoroCount && todayPomodoroCount > 0) ||
            (focusTime && focusTime > 0) ||
            (todayFocusTime && todayFocusTime > 0) ||
            (totalRepeatingPomodoroCount && totalRepeatingPomodoroCount > 0) ||
            (totalRepeatingFocusTime && totalRepeatingFocusTime > 0) ||
            task.estimatedPomodoroDuration) {

            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'reminder-item__pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: block;
                background: rgba(255, 99, 71, 0.1);
                color: rgb(255, 99, 71);
                padding: 4px 8px;
                border-radius: 4px;
                margin-top: 4px;
                width: fit-content;
            `;

            const estimatedLine = task.estimatedPomodoroDuration ? `<span class="ariaLabel" aria-label='${i18n('estimatedPomodoro') || "预计番茄"}'>${i18n('estimated') || "预计"}: ${task.estimatedPomodoroDuration}</span>` : '';
            let totalLine = '';
            let todayLine = '';

            if (task.isRepeatInstance) {
                const repeatingTotal = totalRepeatingPomodoroCount || 0;
                const repeatingFocus = totalRepeatingFocusTime || 0;
                const instanceCount = pomodoroCount || 0;

                const repeatingFocusText = repeatingFocus > 0 ? ` ⏱ ${this.formatMinutesToString(repeatingFocus)}` : '';
                const instanceFocusText = focusTime > 0 ? ` ⏱ ${this.formatMinutesToString(focusTime)}` : '';

                totalLine = `<div style="margin-top:${estimatedLine ? '6px' : '0'}; font-size:12px;">
                    <div class="ariaLabel" aria-label="${i18n('seriesTotalTomatoTitle') || "系列累计番茄钟: "}${repeatingTotal}">
                        <span>${i18n('series') || "系列"}: 🍅 ${repeatingTotal}</span>
                        <span style="margin-left:8px; opacity:0.9;">${repeatingFocusText}</span>
                    </div>
                    <div class="ariaLabel" aria-label="${i18n('instanceTomatoTitle') || "本实例番茄钟: "}${instanceCount}" style="margin-top:4px; opacity:0.95;">
                        <span>${i18n('currentInstance') || "本次"}: 🍅 ${instanceCount}</span>
                        <span style="margin-left:8px; opacity:0.9;">${instanceFocusText}</span>
                    </div>
                 </div>`;
            } else {
                const formattedTotalTomato = `🍅 ${pomodoroCount || 0}`;
                const totalFocusText = focusTime > 0 ? ` ⏱ ${this.formatMinutesToString(focusTime)}` : '';
                totalLine = (pomodoroCount > 0 || focusTime > 0)
                    ? `<div style="margin-top:${estimatedLine ? '6px' : '0'}; font-size:12px;"><span class="ariaLabel" aria-label="${i18n('totalCompletedPomodoroTitle') || "完成的番茄钟数量: "}${pomodoroCount || 0}">${i18n('total') || "总共"}: ${formattedTotalTomato}</span><span class="ariaLabel" aria-label="${i18n('totalFocusDurationTitle') || "总专注时长: "}${focusTime || 0} ${i18n('minutes') || "分钟"}" style="margin-left:8px; opacity:0.9;">${totalFocusText}</span></div>`
                    : '';

                const hasHistoricalData = (pomodoroCount > todayPomodoroCount) || (focusTime > todayFocusTime);
                const todayFocusText = todayFocusTime > 0 ? ` ⏱ ${this.formatMinutesToString(todayFocusTime)}` : '';
                todayLine = hasHistoricalData && (todayPomodoroCount > 0 || todayFocusTime > 0)
                    ? `<div style="margin-top:6px; font-size:12px; opacity:0.95;"><span class="ariaLabel" aria-label='${i18n('todayCompletedPomodoroTitle') || "今日完成番茄钟: "}${todayPomodoroCount}'>${i18n('today') || "今日"}: 🍅 ${todayPomodoroCount}</span><span class="ariaLabel" aria-label='${i18n('todayFocusTimeTitle') || "今日专注时长: "}${todayFocusTime} ${i18n('minutes') || "分钟"}' style='margin-left:8px'>${todayFocusText}</span></div>`
                    : '';
            }

            pomodoroDisplay.innerHTML = `${estimatedLine}${totalLine}${todayLine}`;
            infoEl.appendChild(pomodoroDisplay);
        }

        // 已完成/已忽略状态渲染
        const isTodayCompleted = context.isTodayCompleted ? context.isTodayCompleted(task, today) : false;
        const virtualTodayCompletedTime = !task.completed && isTodayCompleted
            ? (context.getCompletedTime ? context.getCompletedTime(task) : null)
            : null;

        const startLogical_rendering = this.getReminderLogicalDate(task.date, task.time, context.plugin);
        const isBeforePeriod_rendering = !task.date || compareDateStrings(today, startLogical_rendering) < 0;

        if (task.completed || virtualTodayCompletedTime) {
            taskEl.classList.add('reminder-completed');
            checkbox.checked = true;
            try {
                taskEl.style.setProperty('opacity', '0.5', 'important');
            } catch (e) { }

            const completedTimeStr = virtualTodayCompletedTime || (context.getCompletedTime ? context.getCompletedTime(task) : task.completedTime);
            if (completedTimeStr) {
                const completedEl = document.createElement('div');
                completedEl.className = 'reminder-item__completed-time';

                const currentLogicalToday = getLogicalDateString();
                const completionDate = new Date(String(completedTimeStr).replace(' ', 'T'));
                const completionLogicalDay = getLogicalDateString(completionDate);
                const formattedTime = context.formatCompletedTime ? context.formatCompletedTime(completedTimeStr) : getLocalDateTimeString(completionDate);

                if (completionLogicalDay === currentLogicalToday) {
                    const timeOnly = formattedTime.includes(' ') ? formattedTime.substring(formattedTime.indexOf(' ') + 1) : formattedTime;
                    completedEl.textContent = i18n('todayCompletedWithTime', { time: timeOnly }) || `今日完成于 ${timeOnly}`;
                } else {
                    completedEl.textContent = `✅ ${formattedTime}`;
                }
                completedEl.style.cssText = 'font-size:12px; margin-top:6px; opacity:0.95;';
                infoEl.appendChild(completedEl);
            }
        } else {
            const currentToday = getLogicalDateString();
            const canRenderDessertStatus = (context as any).isDailyDessertTaskForDate 
                ? (context as any).isDailyDessertTaskForDate(task, currentToday) 
                : this.isDailyDessertTaskForDate(task, currentToday);
            const canRenderTodayIgnoreStatus = context.canApplyTodayIgnore ? context.canApplyTodayIgnore(task, currentToday) : false;

            const checkIgnoreMark = () => context.hasTodayIgnoreMark ? context.hasTodayIgnoreMark(task, currentToday) : false;

            if (canRenderDessertStatus) {
                const dailyCompletedList = Array.isArray(task.dailyDessertCompleted) ? task.dailyDessertCompleted : [];
                if (dailyCompletedList.includes(currentToday)) {
                    taskEl.classList.add('reminder-completed');
                    checkbox.checked = true;
                    try {
                        taskEl.style.setProperty('opacity', '0.5', 'important');
                    } catch (e) { }
                    const completedEl = document.createElement('div');
                    completedEl.className = 'reminder-item__completed-time';

                    const dailyTimes = task.dailyDessertCompletedTimes || {};
                    const timeStr = dailyTimes[currentToday];
                    if (timeStr) {
                        const formatted = context.formatCompletedTime ? context.formatCompletedTime(timeStr) : timeStr;
                        const timeOnly = formatted.includes(' ') ? formatted.substring(formatted.indexOf(' ') + 1) : formatted;
                        completedEl.textContent = i18n('todayCompletedWithTime', { time: timeOnly }) || `今日完成于 ${timeOnly}`;
                    } else {
                        completedEl.textContent = i18n('todayCompleted') || "今日已完成";
                    }
                    completedEl.style.cssText = 'font-size:12px; margin-top:6px; opacity:0.95;';
                    infoEl.appendChild(completedEl);
                } else if (checkIgnoreMark()) {
                    taskEl.classList.add('reminder-ignored');
                    try {
                        taskEl.style.setProperty('opacity', '0.5', 'important');
                    } catch (e) { }
                    const ignoredEl = document.createElement('div');
                    ignoredEl.className = 'reminder-item__ignored-time';
                    ignoredEl.textContent = `⭕ 今日已忽略`;
                    ignoredEl.style.cssText = 'font-size:12px; margin-top:6px; opacity:0.95;';
                    infoEl.appendChild(ignoredEl);
                }
            } else if (canRenderTodayIgnoreStatus && checkIgnoreMark()) {
                taskEl.classList.add('reminder-ignored');
                try {
                    taskEl.style.setProperty('opacity', '0.5', 'important');
                } catch (e) { }
                const ignoredEl = document.createElement('div');
                ignoredEl.className = 'reminder-item__ignored-time';
                ignoredEl.textContent = `⭕ 今日已忽略`;
                ignoredEl.style.cssText = 'font-size:12px; margin-top:6px; opacity:0.95;';
                infoEl.appendChild(ignoredEl);
            }
        }

        // 备注信息 (HTML / Markdown)
        if (task.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';

            if (context.lute) {
                noteEl.innerHTML = context.lute.Md2HTML(task.note);
                const pTags = noteEl.querySelectorAll('p');
                pTags.forEach(p => {
                    p.style.margin = '0';
                    p.style.lineHeight = 'inherit';
                });
                const listTags = noteEl.querySelectorAll('ul, ol');
                listTags.forEach(list => {
                    (list as HTMLElement).style.margin = '0';
                    (list as HTMLElement).style.paddingLeft = '20px';
                });
                const liTags = noteEl.querySelectorAll('li');
                liTags.forEach(li => {
                    (li as HTMLElement).style.margin = '0';
                });
                const quoteTags = noteEl.querySelectorAll('blockquote');
                quoteTags.forEach(quote => {
                    (quote as HTMLElement).style.margin = '0';
                    (quote as HTMLElement).style.paddingLeft = '10px';
                    (quote as HTMLElement).style.borderLeft = '2px solid var(--b3-theme-on-surface-light)';
                    (quote as HTMLElement).style.opacity = '0.8';
                });
                const imgTags = noteEl.querySelectorAll('img');
                imgTags.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && src.startsWith('/data/storage/petal/siyuan-plugin-task-note-management/assets/')) {
                        import('../../api').then(({ getFileBlob }) => {
                            getFileBlob(src).then(blob => {
                                if (blob) {
                                    img.src = URL.createObjectURL(blob);
                                }
                            });
                        });
                    }
                });
            } else {
                noteEl.textContent = task.note;
            }

            noteEl.style.cssText = `
                font-size: 12px;
                margin-top: 4px;
                line-height: 1.5;
                max-height: 3em;
                overflow: hidden;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                word-break: break-all;
                cursor: pointer;
                border-radius: 4px;
                padding: 0 4px; 
                margin-left: -4px;
                transition: background-color 0.2s, color 0.2s;
                position: relative;
            `;

            noteEl.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (callbacks.onNoteClick) {
                    callbacks.onNoteClick(task, e);
                }
            });

            infoEl.appendChild(noteEl);
        }

        // 项目名称 (使用预处理的 projectCache)
        const showProjectBadge = context.showProjectBadge !== false;
        const project = cachedProjHabit?.project || task.project;
        if (showProjectBadge && project) {
            const projectName = project.title || project.name;
            if (projectName) {
                let displayProjectName = projectName;
                const customGroupId = typeof task.customGroupId === 'string' ? task.customGroupId.trim() : '';
                const projectGroups = Array.isArray(project.customGroups) ? project.customGroups : [];
                const groupFromProject = customGroupId
                    ? projectGroups.find((g: any) => g?.id === customGroupId && !g?.archived)
                    : null;
                const cachedGroup = customGroupId && cachedProjHabit?.customGroup?.id === customGroupId && !cachedProjHabit.customGroup?.archived
                    ? cachedProjHabit.customGroup
                    : null;
                const customGroupName = groupFromProject?.name || cachedGroup?.name;
                if (customGroupName) {
                    displayProjectName = `${projectName}/${customGroupName}`;
                }

                const projectInfo = document.createElement('div');
                projectInfo.className = 'reminder-item__project';
                projectInfo.style.cssText = `
                    display: flex;
                    width: fit-content;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    background-color: ${project.color}20;
                    color: ${project.color};
                    border: 1px solid ${project.color}40;
                    border-radius: 12px;
                    padding: 2px 8px;
                    margin-top: 4px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: opacity 0.2s;
                `;


                const nameSpan = document.createElement('span');
                nameSpan.textContent = `📂${i18n("project") || "项目"}：${displayProjectName}`;
                nameSpan.style.cssText = `
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;
                projectInfo.appendChild(nameSpan);

                projectInfo.classList.add('ariaLabel');
                projectInfo.setAttribute('aria-label', `点击打开项目: ${displayProjectName}`);

                projectInfo.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (callbacks.onProjectClick) {
                        callbacks.onProjectClick(task, e);
                    }
                });

                projectInfo.addEventListener('mouseenter', () => {
                    projectInfo.style.opacity = '0.8';
                    nameSpan.style.color = project.color;
                });
                projectInfo.addEventListener('mouseleave', () => {
                    projectInfo.style.opacity = '1';
                    nameSpan.style.color = '';
                });

                infoEl.appendChild(projectInfo);
            }
        }

        // 项目看板状态
        const kanbanStatusInfo = (context.showProjectKanbanStatus && context.getReminderKanbanStatusInfo)
            ? context.getReminderKanbanStatusInfo(task)
            : null;

        if (kanbanStatusInfo?.name) {
            const statusColor = kanbanStatusInfo.color || (project ? project.color : '') || 'var(--b3-theme-primary)';
            const projectStatusInfo = document.createElement('div');
            projectStatusInfo.className = 'reminder-item__project-status';
            
            const hasProject = !!project;
            projectStatusInfo.style.cssText = `
                display: inline-flex;
                width: fit-content;
                align-items: center;
                gap: 4px;
                font-size: 11px;
                background-color: ${colorWithOpacity(statusColor, 0.12)};
                color: ${statusColor};
                border: 1px solid ${colorWithOpacity(statusColor, 0.28)};
                border-radius: 12px;
                padding: 2px 8px;
                margin-top: 4px;
                font-weight: 500;
                cursor: ${hasProject ? 'pointer' : 'default'};
                transition: opacity 0.2s;
            `;

            const statusNameSpan = document.createElement('span');
            statusNameSpan.textContent = `${kanbanStatusInfo.icon ? `${kanbanStatusInfo.icon} ` : ''}${kanbanStatusInfo.name}`;
            projectStatusInfo.appendChild(statusNameSpan);

            projectStatusInfo.classList.add('ariaLabel');
            projectStatusInfo.setAttribute('aria-label', `${i18n("showProjectKanbanStatus") || "显示项目看板状态"}: ${kanbanStatusInfo.name}`);

            if (hasProject) {
                projectStatusInfo.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (callbacks.onProjectClick) {
                        callbacks.onProjectClick(task, e);
                    }
                });

                projectStatusInfo.addEventListener('mouseenter', () => {
                    projectStatusInfo.style.opacity = '0.8';
                });
                projectStatusInfo.addEventListener('mouseleave', () => {
                    projectStatusInfo.style.opacity = '1';
                });
            }

            infoEl.appendChild(projectStatusInfo);
        }

        // 习惯绑定信息
        const linkedHabitId = task.linkedHabitId;
        const habit = cachedProjHabit?.habit || task.linkedHabit;
        if (linkedHabitId) {
            const habitInfo = document.createElement('div');
            habitInfo.className = 'reminder-item__habit';

            const baseStyle = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
                font-size: 11px;
                border-radius: 12px;
                padding: 2px 8px;
                margin-top: 4px;
                font-weight: 500;
            `;

            const habitName = habit?.title || linkedHabitId;
            const habitIcon = habit?.icon || '✅';
            const linkModes: string[] = [];
            if (task.linkedHabitSyncPomodoroToday) {
                linkModes.push(i18n('pomodoroSync') || '番茄联动');
            }
            if (task.linkedHabitAutoCheckInOnComplete) {
                const autoEmoji = task.linkedHabitAutoCheckInEmoji;
                linkModes.push(autoEmoji ? `${i18n('autoCheckIn') || '自动打卡'}(${autoEmoji})` : (i18n('autoCheckIn') || '自动打卡'));
            }
            const modeText = linkModes.length > 0 ? ` · ${linkModes.join(' / ')}` : '';

            habitInfo.style.cssText = `
                ${baseStyle}
                background-color: rgba(76, 175, 80, 0.14);
                color: var(--b3-theme-on-surface);
                border: 1px solid rgba(76, 175, 80, 0.35);
                cursor: pointer;
                text-decoration: underline dotted;
            `;
            habitInfo.textContent = `${habitIcon} 习惯: ${habitName}${modeText}`;
            habitInfo.classList.add('ariaLabel');
            habitInfo.setAttribute('aria-label', `已绑定习惯: ${habitName}${modeText}，点击查看习惯统计`);

            habitInfo.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (callbacks.onHabitClick) {
                    callbacks.onHabitClick(task, e);
                }
            });

            infoEl.appendChild(habitInfo);
        }

        // 里程碑
        if (task.milestoneId && context.milestoneMap) {
            const milestone = context.milestoneMap.get(task.milestoneId);
            if (milestone) {
                const milestoneEl = document.createElement('div');
                milestoneEl.className = 'reminder-item__milestone';
                milestoneEl.style.cssText = `
                    font-size: 11px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.8;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    margin-top: 4px;
                    background: var(--b3-theme-surface-lighter);
                    padding: 2px 6px;
                    border-radius: 4px;
                    width: fit-content;
                    border: 1px solid var(--b3-theme-border);
                `;

                if (milestone.blockId) {
                    milestoneEl.setAttribute('data-type', 'a');
                    milestoneEl.setAttribute('data-href', `siyuan://blocks/${milestone.blockId}`);
                    milestoneEl.style.color = 'var(--b3-protyle-inline-blockref-color)';
                    milestoneEl.style.cursor = 'pointer';
                    milestoneEl.style.textDecoration = 'underline dotted';
                }

                milestoneEl.innerHTML = `<span>${milestone.icon || '🚩'}</span><span style="font-weight: 500;">${milestone.name}</span>`;

                milestoneEl.addEventListener('click', (e) => {
                    if (milestone.blockId) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (callbacks.onMilestoneClick) {
                            callbacks.onMilestoneClick(task, e);
                        }
                    }
                });

                infoEl.appendChild(milestoneEl);
            }
        }

        // 分类
        if (context.showCategoryBadge !== false && context.categoryManager && task.categoryId) {
            const categoryContainer = document.createElement('div');
            categoryContainer.className = 'reminder-item__categories';
            categoryContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
                align-self: flex-start;
            `;

            const categoryIds = typeof task.categoryId === 'string' ? task.categoryId.split(',') : [task.categoryId];
            let hasValidCategory = false;

            categoryIds.forEach((catId: string) => {
                const id = catId.trim();
                if (!id) return;

                const category = context.categoryManager.getCategoryById(id);
                if (category) {
                    hasValidCategory = true;
                    const categoryEl = document.createElement('div');
                    categoryEl.className = 'reminder-item__category';
                    categoryEl.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        padding: 2px 6px;
                        background-color: ${category.color};
                        border-radius: 4px;
                        font-size: 11px;
                        color: white;
                        font-weight: 500;
                    `;

                    if (category.icon) {
                        categoryEl.innerHTML = `<span>${category.icon}</span><span>${category.name}</span>`;
                    } else {
                        categoryEl.textContent = category.name;
                    }
                    categoryContainer.appendChild(categoryEl);
                }
            });

            if (hasValidCategory) {
                infoEl.appendChild(categoryContainer);
            }
        }

        // 自定义标签
        if (task.tags && Array.isArray(task.tags) && task.tags.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'reminder-item__tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            task.tags.forEach((tag: string) => {
                if (!tag) return;
                const tagEl = document.createElement('span');
                tagEl.className = 'reminder-item__tag';
                tagEl.style.cssText = `
                    font-size: 10px;
                    background-color: var(--b3-theme-surface-lighter);
                    color: var(--b3-theme-on-surface);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 4px;
                    padding: 1px 4px;
                    font-weight: 500;
                `;
                tagEl.textContent = `#${tag}`;
                tagsContainer.appendChild(tagEl);
            });
            infoEl.appendChild(tagsContainer);
        }

        // 项目标签显示
        if (task.projectId && task.tagIds && Array.isArray(task.tagIds) && task.tagIds.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'reminder-item__tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            (async () => {
                try {
                    const { ProjectManager } = await import('../../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(context.plugin);
                    const projectTags = await projectManager.getProjectTags(task.projectId);
                    const tagMap = new Map(projectTags.map(t => [t.id, t]));
                    const validTagIds = task.tagIds.filter((tagId: string) => tagMap.has(tagId));

                    validTagIds.forEach((tagId: string) => {
                        const tag = tagMap.get(tagId);
                        if (tag) {
                            const tagEl = document.createElement('span');
                            tagEl.className = 'reminder-item__tag';
                            tagEl.style.cssText = `
                                display: inline-flex;
                                align-items: center;
                                padding: 2px 8px;
                                font-size: 11px;
                                border-radius: 12px;
                                background: ${tag.color}20;
                                border: 1px solid ${tag.color};
                                color: ${tag.color};
                                font-weight: 500;
                            `;
                            tagEl.textContent = `#${tag.name}`;
                            tagEl.classList.add('ariaLabel');
                            tagEl.setAttribute('aria-label', tag.name);
                            tagsContainer.appendChild(tagEl);
                        }
                    });
                } catch (error) {
                    console.error('加载项目标签失败:', error);
                }
            })();

            infoEl.appendChild(tagsContainer);
        }

        // 进度条渲染
        this.renderProgressBar(task, context, infoEl);

        contentEl.appendChild(infoEl);
        taskEl.appendChild(contentEl);

        return taskEl;
    }


    private static getReminderTimeEntries(reminder: any): Array<{ time: string; endTime?: string; note?: string; everyDay?: boolean }> {
        const entries: Array<{ time: string; endTime?: string; note?: string; everyDay?: boolean }> = [];
        if (Array.isArray(reminder?.reminderTimes)) {
            reminder.reminderTimes.forEach((rtItem: any) => {
                if (!rtItem) return;
                const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                const note = typeof rtItem === 'string' ? '' : String(rtItem.note || '').trim();
                if (rt) {
                    entries.push({
                        time: rt,
                        endTime: typeof rtItem === 'string' ? undefined : (typeof rtItem.endTime === 'string' ? rtItem.endTime.trim() : undefined),
                        note,
                        everyDay: typeof rtItem === 'string' ? false : !!rtItem.everyDay
                    });
                }
            });
        }
        if (entries.length === 0 && typeof reminder?.customReminderTime === 'string' && reminder.customReminderTime.trim()) {
            entries.push({ time: reminder.customReminderTime.trim() });
        }
        return entries;
    }

    private static isDatelessReminderActiveOnDate(reminder: any, targetDate: string): boolean {
        const hasDate = reminder?.date || reminder?.endDate;
        if (hasDate) return false;
        const entries = this.getReminderTimeEntries(reminder);
        if (entries.length === 0) return false;
        return entries.some(entry => {
            if (entry.everyDay) {
                return true;
            }
            if (entry.time.includes('T')) {
                const datePart = entry.time.split('T')[0];
                return datePart === targetDate;
            }
            return true;
        });
    }

    private static isDailyDessertTaskForDate(reminder: any, targetDate: string): boolean {
        if (!reminder?.isAvailableToday) {
            if (!reminder.date && !reminder.endDate && this.isDatelessReminderActiveOnDate(reminder, targetDate)) {
                return true;
            }
            return false;
        }
        const startLogical = this.getReminderLogicalDate(reminder.date, reminder.time);
        const isInOrAfterPeriod = reminder.date && compareDateStrings(startLogical, targetDate) <= 0;
        return !isInOrAfterPeriod;
    }
}
