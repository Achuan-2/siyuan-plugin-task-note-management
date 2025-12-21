import { Dialog, showMessage, confirm } from "siyuan";
import { readReminderData, writeReminderData, updateBlockReminderBookmark, sql, getBlockByID, openBlock } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTimeString, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";
import { t } from "../utils/i18n";

export class DocumentReminderDialog {
    private dialog: Dialog;
    private container: HTMLElement;
    private documentId: string;
    private categoryManager: CategoryManager;
    private plugin?: any;

    // 筛选和排序状态
    private currentFilter: 'all' | 'completed' | 'uncompleted' = 'all';
    private currentSort: 'time' | 'completedTime' | 'priority' = 'completedTime'; // 修改默认为按完成时间
    private currentSortOrder: 'asc' | 'desc' = 'desc'; // 修改默认为降序
    private searchQuery: string = '';

    // UI元素
    private filterSelect: HTMLSelectElement;
    private sortSelect: HTMLSelectElement;
    private sortOrderBtn: HTMLButtonElement;
    private searchInput: HTMLInputElement;
    private remindersContainer: HTMLElement;
    private countDisplay: HTMLElement;

    constructor(documentId: string, plugin?: any) {
        this.documentId = documentId;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.createDialog();
    }

    public show() {
        this.dialog.element.style.display = 'block';
        // 使用 setTimeout 确保对话框完全渲染后再初始化
        setTimeout(() => {
            this.ensureUIInitialized();
        }, 100);
    }

    private createDialog() {
        this.dialog = new Dialog({
            title: t("documentReminderManagement"),
            content: this.createContent(),
            width: "800px",
            height: "800px",
            destroyCallback: () => {
                // 清理资源
            }
        });

        // 延迟初始化，确保内容已渲染
        setTimeout(() => {
            this.initializeUI();
        }, 50);
    }

    private createContent(): string {
        return `
            <div class="document-reminder-dialog">
                <div class="doc-reminder-header">
                    <div class="doc-reminder-toolbar">
                        <div class="doc-reminder-filters">
                            <select class="b3-select doc-filter-select">
                                <option value="all">${t("allReminders")}</option>
                                <option value="uncompleted">${t("uncompleted")}</option>
                                <option value="completed">${t("completed")}</option>
                            </select>
                            
                            <select class="b3-select doc-sort-select">
                                <option value="time">${t("sortByTime")}</option>
                                <option value="priority">${t("sortByPriority")}</option>
                                <option value="completedTime" selected>${t("sortByCreated")}</option>
                            </select>
                            
                            <button class="b3-button b3-button--outline doc-sort-order-btn" title="${t("sortDirection")}">
                                <svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>
                                <span>${t("descending")}</span>
                            </button>
                            
                            <button class="b3-button b3-button--primary doc-add-reminder-btn" title="${t("setTimeReminder")}">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                <span>${t("reminder")}</span>
                            </button>
                        </div>
                        
                        <div class="doc-reminder-search">
                            <input type="text" class="b3-text-field doc-search-input" placeholder="${t("searchReminders")}">
                        </div>
                    </div>
                    
                    <div class="doc-reminder-stats">
                        <span class="doc-reminder-count">${t("loading")}</span>
                    </div>
                </div>
                
                <div class="doc-reminder-content">
                    <div class="doc-reminders-container">
                        <div class="doc-reminder-loading">${t("loadingReminders")}</div>
                    </div>
                </div>
            </div>
        `;
    }

    private initializeUI() {
        // 获取容器元素，使用更可靠的选择器
        this.container = this.dialog.element.querySelector('.document-reminder-dialog');

        if (!this.container) {
            console.warn('Container not found, will retry initialization');
            // 如果还没找到容器，稍后重试
            setTimeout(() => {
                this.initializeUI();
            }, 100);
            return;
        }

        // 获取UI元素，添加空值检查
        this.filterSelect = this.container.querySelector('.doc-filter-select');
        this.sortSelect = this.container.querySelector('.doc-sort-select');
        this.sortOrderBtn = this.container.querySelector('.doc-sort-order-btn');
        this.searchInput = this.container.querySelector('.doc-search-input');
        this.remindersContainer = this.container.querySelector('.doc-reminders-container');
        this.countDisplay = this.container.querySelector('.doc-reminder-count');
        const addReminderBtn = this.container.querySelector('.doc-add-reminder-btn') as HTMLButtonElement;

        // 检查必要的UI元素是否存在
        if (!this.filterSelect || !this.sortSelect || !this.sortOrderBtn ||
            !this.searchInput || !this.remindersContainer || !this.countDisplay || !addReminderBtn) {
            console.warn('Some UI elements not found, will retry initialization');
            // 如果元素还没找到，稍后重试
            setTimeout(() => {
                this.initializeUI();
            }, 100);
            return;
        }

        // 设置排序选择器的默认值
        this.sortSelect.value = this.currentSort;

        // 绑定事件
        this.filterSelect.addEventListener('change', () => {
            this.currentFilter = this.filterSelect.value as any;
            this.loadReminders();
        });

        this.sortSelect.addEventListener('change', () => {
            this.currentSort = this.sortSelect.value as any;
            this.loadReminders();
        });

        this.sortOrderBtn.addEventListener('click', () => {
            this.currentSortOrder = this.currentSortOrder === 'asc' ? 'desc' : 'asc';
            this.updateSortOrderButton();
            this.loadReminders();
        });

        this.searchInput.addEventListener('input', () => {
            this.searchQuery = this.searchInput.value.trim();
            this.loadReminders();
        });

        // 绑定新建提醒按钮事件
        addReminderBtn.addEventListener('click', () => {
            this.showAddReminderDialog();
        });

        // 初始化排序按钮
        this.updateSortOrderButton();

        console.log('UI initialized successfully');
    }

    // 新增：确保UI已初始化的方法
    private ensureUIInitialized() {
        if (!this.container || !this.remindersContainer || !this.countDisplay) {
            // UI还未初始化，重新初始化
            this.initializeUI();
            // 再次检查并延迟加载数据
            setTimeout(() => {
                if (this.remindersContainer && this.countDisplay) {
                    this.loadReminders();
                }
            }, 50);
        } else {
            // UI已初始化，直接加载数据
            this.loadReminders();
        }
    }

    private updateSortOrderButton() {
        if (!this.sortOrderBtn) return;

        const span = this.sortOrderBtn.querySelector('span');
        if (span) {
            span.textContent = this.currentSortOrder === 'asc' ? t("ascending") : t("descending");
        }
        this.sortOrderBtn.title = `${t("sortDirection")}: ${this.currentSortOrder === 'asc' ? t("ascending") : t("descending")}`;
    }

    private async loadReminders() {
        try {
            // 确保必要的UI元素存在
            if (!this.remindersContainer || !this.countDisplay) {
                console.warn('UI elements not ready, skipping load');
                return;
            }

            this.remindersContainer.innerHTML = `<div class="doc-reminder-loading">${t("loadingReminders")}</div>`;

            // 获取所有提醒数据
            const reminderData = await readReminderData();
            if (!reminderData || typeof reminderData !== 'object') {
                this.remindersContainer.innerHTML = `<div class="doc-reminder-empty">${t("noReminders")}</div>`;
                this.countDisplay.textContent = `0 ${t("remindersCount")}`;
                return;
            }

            // 筛选出文档内的提醒
            const documentReminders = this.filterDocumentReminders(reminderData);

            // 应用筛选条件
            const filteredReminders = this.applyFilters(documentReminders);

            // 应用搜索
            const searchedReminders = this.applySearch(filteredReminders);

            // 排序
            this.sortReminders(searchedReminders);

            // 渲染提醒列表
            this.renderReminders(searchedReminders);

            // 更新统计
            this.updateStats(documentReminders, searchedReminders);

        } catch (error) {
            console.error('加载文档提醒失败:', error);
            if (this.remindersContainer) {
                this.remindersContainer.innerHTML = `<div class="doc-reminder-error">${t("loadReminderError")}</div>`;
            }
            if (this.countDisplay) {
                this.countDisplay.textContent = t("loadingFailed");
            }
        }
    }

    private filterDocumentReminders(reminderData: any): any[] {
        const reminders = [];

        // 遍历所有提醒，筛选属于当前文档的提醒
        Object.values(reminderData).forEach((reminder: any) => {
            if (!reminder || typeof reminder !== 'object' || !reminder.id) return;

            // 检查提醒是否属于当前文档
            const belongsToDocument =
                reminder.docId === this.documentId ||
                reminder.blockId === this.documentId ||
                (reminder.blockId && reminder.blockId.startsWith(this.documentId));

            if (belongsToDocument) {
                reminders.push(reminder);

                // 如果是重复事件，生成实例
                if (reminder.repeat?.enabled) {
                    const today = getLogicalDateString();
                    const isLunarRepeat = reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly';

                    const instances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);
                    instances.forEach(instance => {
                        if (instance.date !== reminder.date) {
                            const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                            const originalKey = instanceIdStr.split('_').pop() || instance.date;

                            const completedInstances = reminder.repeat?.completedInstances || [];
                            const isInstanceCompleted = completedInstances.includes(originalKey);

                            const instanceModifications = reminder.repeat?.instanceModifications || {};
                            const instanceMod = instanceModifications[originalKey];

                            const instanceReminder = {
                                ...reminder,
                                id: instance.instanceId,
                                date: instance.date,
                                endDate: instance.endDate,
                                time: instance.time,
                                endTime: instance.endTime,
                                isRepeatInstance: true,
                                originalId: instance.originalId,
                                completed: isInstanceCompleted,
                                note: instanceMod?.note || ''
                            };

                            reminders.push(instanceReminder);
                        }
                    });
                }
            }
        });

        return reminders;
    }

    private applyFilters(reminders: any[]): any[] {
        switch (this.currentFilter) {
            case 'completed':
                return reminders.filter(r => r.completed);
            case 'uncompleted':
                return reminders.filter(r => !r.completed);
            default:
                return reminders;
        }
    }

    private applySearch(reminders: any[]): any[] {
        if (!this.searchQuery) return reminders;

        const query = this.searchQuery.toLowerCase();
        return reminders.filter(reminder => {
            const title = (reminder.title || '').toLowerCase();
            const note = (reminder.note || '').toLowerCase();
            const date = reminder.date || '';
            const time = reminder.time || '';

            return title.includes(query) ||
                note.includes(query) ||
                date.includes(query) ||
                time.includes(query);
        });
    }

    private sortReminders(reminders: any[]) {
        reminders.sort((a: any, b: any) => {
            let result = 0;

            switch (this.currentSort) {
                case 'completedTime':
                    result = this.compareByCompletedTime(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                default:
                    result = this.compareByTime(a, b);
                    break;
            }

            return this.currentSortOrder === 'desc' ? -result : result;
        });
    }

    /**
     * [MODIFIED] Correctly compares two reminders by their completion status and time.
     * This function defines the "ascending" order. The calling sortReminders function
     * will negate the result for "descending" order.
     * Ascending order is:
     * 1. Completed items before uncompleted items.
     * 2. Completed items are sorted by their completion time (oldest first).
     * 3. Uncompleted items are sorted by their scheduled time (earliest first).
     * When reversed for descending sort, this meets the requirements:
     * 1. Uncompleted items first.
     * 2. Uncompleted items sorted by scheduled time (latest first).
     * 3. Completed items sorted by completion time (latest first).
     */
    private compareByCompletedTime(a: any, b: any): number {
        const isCompletedA = a.completed;
        const isCompletedB = b.completed;

        // Group by completion status. For ascending, completed items come first.
        if (isCompletedA && !isCompletedB) {
            return -1; // a (completed) comes before b (uncompleted)
        }
        if (!isCompletedA && isCompletedB) {
            return 1;  // b (completed) comes before a (uncompleted)
        }

        // If both are uncompleted, sort by their scheduled time, ascending.
        if (!isCompletedA && !isCompletedB) {
            const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
            const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));
            return dateA.getTime() - dateB.getTime();
        }

        // If both are completed, sort by their completion time, ascending.
        if (isCompletedA && isCompletedB) {
            const completedTimeA = this.getCompletedTime(a);
            const completedTimeB = this.getCompletedTime(b);
            const timeA = completedTimeA ? new Date(completedTimeA).getTime() : 0;
            const timeB = completedTimeB ? new Date(completedTimeB).getTime() : 0;
            return timeA - timeB;
        }

        return 0; // Should not be reached
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        const result = priorityB - priorityA; // 高优先级在前
        if (result !== 0) return -result;

        // 优先级相同时按时间排序
        return this.compareByTime(a, b);
    }

    private compareByTime(a: any, b: any): number {
        const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));

        // 首先按日期时间排序
        const timeDiff = dateA.getTime() - dateB.getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }

        // 时间相同时，比较完成状态 - 未完成的在前
        if (a.completed !== b.completed) {
            return a.completed ? -1 : 1; // 未完成的在前
        }

        // 时间相同且完成状态相同时，考虑跨天事件和全天事件的优先级
        const isSpanningA = a.endDate && a.endDate !== a.date;
        const isSpanningB = b.endDate && b.endDate !== b.date;
        const isAllDayA = !a.time;
        const isAllDayB = !b.time;

        // 跨天事件 > 有时间的单日事件 > 全天事件
        if (isSpanningA && !isSpanningB) return -1;
        if (!isSpanningA && isSpanningB) return 1;

        if (!isSpanningA && !isSpanningB) {
            // 都不是跨天事件，有时间的优先于全天事件
            if (!isAllDayA && isAllDayB) return -1;
            if (isAllDayA && !isAllDayB) return 1;
        }

        // 其他情况按优先级排序
        return this.compareByPriorityValue(a, b);
    }

    // 新增：优先级数值比较辅助方法
    private compareByPriorityValue(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        return priorityB - priorityA; // 高优先级在前
    }

    private getCompletedTime(reminder: any): string | null {
        if (reminder.isRepeatInstance) {
            // 重复事件实例的完成时间
            if (reminder.originalId && reminder.date) {
                // This logic is complex and relies on having access to the original reminder.
                // Assuming `toggleReminder` correctly stores the completion time for instances.
                // A better approach would be to ensure the instance object has this data directly.
                // For now, let's assume `reminder.completedTime` might exist or we need a lookup.
                // A placeholder for a more complex lookup if needed:
                // const originalReminder = reminderDataGlobal?.[reminder.originalId];
                // if (originalReminder?.repeat?.completedTimes) {
                //     return originalReminder.repeat.completedTimes[reminder.date] || null;
                // }
                // This is a simplification based on what toggleReminder does:
                return reminder.completedTime || null;
            }
            return null;
        } else {
            return reminder.completedTime || null;
        }
    }

    private updateStats(allReminders: any[], displayedReminders: any[]) {
        // 添加安全检查
        if (!this.countDisplay) {
            console.warn('Count display element not available');
            return;
        }

        const totalCount = allReminders.length;
        const completedCount = allReminders.filter(r => r.completed).length;
        const uncompletedCount = totalCount - completedCount;
        const displayedCount = displayedReminders.length;

        let statsText = `${t("totalRemindersCount")} ${totalCount} ${t("remindersCount")}`;
        if (totalCount > 0) {
            statsText += ` (${uncompletedCount} ${t("uncompletedRemindersCount")}, ${completedCount} ${t("completedRemindersCount")})`;
        }

        if (displayedCount !== totalCount) {
            statsText += ` ${t("displayCount")} ${displayedCount} ${t("displaying")}`;
        }

        this.countDisplay.textContent = statsText;
    }

    private renderReminders(reminders: any[]) {
        // 添加安全检查
        if (!this.remindersContainer) {
            console.warn('Reminders container not available');
            return;
        }

        if (reminders.length === 0) {
            const emptyMessage = this.searchQuery ?
                t("searchNotFound").replace("${query}", this.searchQuery) :
                t("noMatchingReminders");
            this.remindersContainer.innerHTML = `<div class="doc-reminder-empty">${emptyMessage}</div>`;
            return;
        }

        this.remindersContainer.innerHTML = '';
        const today = getLogicalDateString();

        reminders.forEach(reminder => {
            const reminderEl = this.createReminderElement(reminder, today);
            this.remindersContainer.appendChild(reminderEl);
        });
    }

    private createReminderElement(reminder: any, today: string): HTMLElement {
        // 判断是否过期
        let isOverdue = false;
        if (!reminder.completed) {
            if (reminder.endDate) {
                isOverdue = compareDateStrings(reminder.endDate, today) < 0;
            } else {
                isOverdue = compareDateStrings(reminder.date, today) < 0;
            }
        }

        const priority = reminder.priority || 'none';
        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;

        const reminderEl = document.createElement('div');
        reminderEl.className = `doc-reminder-item ${isOverdue ? 'doc-reminder-item--overdue' : ''} ${isSpanningDays ? 'doc-reminder-item--spanning' : ''} doc-reminder-priority-${priority}`;

        // 添加右键菜单事件
        reminderEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showContextMenu(e, reminder);
        });

        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = reminder.completed || false;
        checkbox.addEventListener('change', () => {
            this.toggleReminder(reminder, checkbox.checked);
        });

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'doc-reminder-item__info';

        // 1. 标题容器
        const titleContainer = document.createElement('div');
        titleContainer.className = 'doc-reminder-item__title-container';

        const titleEl = document.createElement('a');
        titleEl.className = 'doc-reminder-item__title';
        titleEl.textContent = reminder.title || t("unnamedNote");
        titleEl.href = '#';
        titleEl.addEventListener('click', (e) => {
            e.preventDefault();
            // 如果存在docId
            this.openBlockTab(reminder.blockId);
        });

        titleContainer.appendChild(titleEl);

        // 2. 时间信息容器（包含日期、重复图标、优先级、过期标签）
        const timeContainer = document.createElement('div');
        timeContainer.className = 'doc-reminder-item__time-container';
        timeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        // 添加重复图标
        if (reminder.repeat?.enabled || reminder.isRepeatInstance) {
            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'doc-reminder-repeat-icon';
            repeatIcon.textContent = '🔄';
            repeatIcon.title = reminder.repeat?.enabled ?
                getRepeatDescription(reminder.repeat) :
                t("repeatInstance");
            repeatIcon.style.cssText = `
                font-size: 12px;
                opacity: 0.7;
                flex-shrink: 0;
            `;
            timeContainer.appendChild(repeatIcon);
        }

        // 时间信息
        const timeEl = document.createElement('div');
        timeEl.className = 'doc-reminder-item__time';
        const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate);
        timeEl.textContent = '🕐' + timeText;

        // 添加优先级标签
        if (priority !== 'none') {
            const priorityLabel = document.createElement('span');
            priorityLabel.className = `doc-reminder-priority-label ${priority}`;
            const priorityNames = {
                'high': t("highPriority"),
                'medium': t("mediumPriority"),
                'low': t("lowPriority")
            };
            priorityLabel.innerHTML = `<div class="priority-dot ${priority}"></div>${priorityNames[priority]}`;
            timeEl.appendChild(priorityLabel);
        }

        // 过期标签
        if (isOverdue) {
            const overdueLabel = document.createElement('span');
            overdueLabel.className = 'doc-reminder-overdue-label';
            overdueLabel.textContent = t("overdue");
            timeEl.appendChild(overdueLabel);
        }

        timeContainer.appendChild(timeEl);

        // 3. 分类显示
        const categoryContainer = document.createElement('div');
        categoryContainer.className = 'doc-reminder-item__category-container';
        categoryContainer.style.cssText = `
            margin-top: 4px;
        `;

        if (reminder.categoryId) {
            const category = this.categoryManager.getCategoryById(reminder.categoryId);
            if (category) {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'doc-reminder-category-tag';
                categoryEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 6px;
                    background-color: ${category.color};
                    border: 1px solid ${category.color}40;
                    border-radius: 5px;
                    font-size: 11px;
                    color: #fff;
                `;

                if (category.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = category.icon;
                    iconSpan.style.cssText = `
                        font-size: 12px;
                        line-height: 1;
                    `;
                    categoryEl.appendChild(iconSpan);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = category.name;
                nameSpan.style.cssText = `
                    font-size: 11px;
                    font-weight: 500;
                `;
                categoryEl.appendChild(nameSpan);

                categoryContainer.appendChild(categoryEl);
            }
        }
        // 按照正确顺序添加到信息容器
        infoEl.appendChild(titleContainer);           // 1. 标题
        infoEl.appendChild(timeContainer);            // 2. 时间、优先级
        infoEl.appendChild(categoryContainer);        // 3. 分类

        // 4. 番茄数量显示
        const targetReminder = reminder.isRepeatInstance ?
            this.getOriginalReminder(reminder.originalId) || reminder :
            reminder;

        // 默认创建一个占位容器；异步获取累计番茄数（包括子任务）并在获取后显示
        const pomodoroDisplay = document.createElement('div');
        pomodoroDisplay.className = 'doc-reminder-pomodoro-count';
        pomodoroDisplay.style.cssText = `
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 2px;
            margin-top: 2px;
        `;
        // 先隐藏，避免闪烁
        pomodoroDisplay.style.display = 'none';
        infoEl.appendChild(pomodoroDisplay);

        (async () => {
            try {
                const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
                const pomodoroManager = PomodoroRecordManager.getInstance();
                let count = 0;
                let focusMinutes = 0;
                if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                    count = await pomodoroManager.getAggregatedReminderPomodoroCount(targetReminder.id);
                } else {
                    count = await pomodoroManager.getReminderPomodoroCount(targetReminder.id);
                }
                if (typeof pomodoroManager.getAggregatedReminderFocusTime === 'function') {
                    focusMinutes = await pomodoroManager.getAggregatedReminderFocusTime(targetReminder.id);
                } else if (typeof pomodoroManager.getEventFocusTime === 'function') {
                    focusMinutes = pomodoroManager.getEventFocusTime(targetReminder.id);
                }
                if ((count && count > 0) || (focusMinutes && focusMinutes > 0)) {
                    const tomatoEmojis = `🍅 ${count}`;
                    const extraCount = '';
                    const focusText = focusMinutes > 0 ? ` ⏱ ${pomodoroManager.formatTime(focusMinutes)}` : '';
                    pomodoroDisplay.innerHTML = `
                        <span title="${t("completedPomodoroCount")}: ${count}">${tomatoEmojis}${extraCount}</span>
                        <span title="总专注时长: ${focusMinutes} 分钟" style="margin-left:8px; opacity:0.9;">${focusText}</span>
                    `;
                    pomodoroDisplay.style.display = '';
                } else {
                    // 没有计数，则移除占位
                    if (pomodoroDisplay.parentNode) pomodoroDisplay.parentNode.removeChild(pomodoroDisplay);
                }
            } catch (e) {
                console.warn('获取提醒及子任务的番茄钟总数失败', e);
                if (pomodoroDisplay.parentNode) pomodoroDisplay.parentNode.removeChild(pomodoroDisplay);
            }
        })();

        // 备注
        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'doc-reminder-item__note';
            noteEl.textContent = reminder.note;
            infoEl.appendChild(noteEl);
        }

        // 5. 完成时间显示
        if (reminder.completed) {
            const completedTime = this.getCompletedTime(reminder);
            if (completedTime) {
                const completedTimeEl = document.createElement('div');
                completedTimeEl.className = 'doc-reminder-completed-time';
                completedTimeEl.style.cssText = `
                    font-size: 11px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.7;
                    margin-top: 2px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                `;

                const completedIcon = document.createElement('span');
                completedIcon.textContent = '✅';
                completedIcon.style.cssText = 'font-size: 10px;';

                const completedText = document.createElement('span');
                completedText.textContent = `${t("completedAtTime")}${this.formatCompletedTime(completedTime)}`;

                completedTimeEl.appendChild(completedIcon);
                completedTimeEl.appendChild(completedText);
                infoEl.appendChild(completedTimeEl);
            }
        }


        // 操作按钮
        const actionsEl = document.createElement('div');
        actionsEl.className = 'doc-reminder-item__actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'b3-button b3-button--small';
        editBtn.textContent = t("edit");
        editBtn.addEventListener('click', () => {
            this.editReminder(reminder);
        });

        actionsEl.appendChild(editBtn);

        reminderEl.appendChild(checkbox);
        reminderEl.appendChild(infoEl);
        reminderEl.appendChild(actionsEl);

        return reminderEl;
    }

    // 添加获取原始提醒数据的方法（用于重复事件实例）
    private getOriginalReminder(originalId: string): any {
        try {
            // 从缓存或全局数据中获取原始提醒数据
            // 这里需要实现获取原始提醒的逻辑
            return null; // 临时返回，需要根据实际情况实现
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            return null;
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string): string {
        if (!today) {
            today = getLogicalDateString();
        }

        const tomorrowStr = getRelativeDateString(1);

        let dateStr = '';
        if (date === today) {
            dateStr = t("today");
        } else if (date === tomorrowStr) {
            dateStr = t("tomorrow");
        } else {
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        }

        // 处理跨天事件
        if (endDate && endDate !== date) {
            let endDateStr = '';
            if (endDate === today) {
                endDateStr = t("today");
            } else if (endDate === tomorrowStr) {
                endDateStr = t("tomorrow");
            } else {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            }

            const timeStr = time ? ` ${time}` : '';
            return `${dateStr} → ${endDateStr}${timeStr}`;
        }

        return time ? `${dateStr} ${time}` : dateStr;
    }

    private formatCompletedTime(completedTime: string): string {
        try {
            const today = getLogicalDateString();
            const yesterdayStr = getRelativeDateString(-1);

            const completedDate = new Date(completedTime);
            const completedDateStr = getLocalDateString(completedDate);

            const timeStr = completedDate.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });

            if (completedDateStr === today) {
                return `${t("completedToday")} ${timeStr}`;
            } else if (completedDateStr === yesterdayStr) {
                return `${t("completedYesterday")} ${timeStr}`;
            } else {
                const dateStr = completedDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
                return `${dateStr} ${timeStr}`;
            }
        } catch (error) {
            console.error('格式化完成时间失败:', error);
            return completedTime;
        }
    }

    private async toggleReminder(reminder: any, completed: boolean) {
        try {
            const reminderData = await readReminderData();

            if (reminder.isRepeatInstance) {
                // 处理重复事件实例
                const originalId = reminder.originalId;
                if (reminderData[originalId]) {
                    if (!reminderData[originalId].repeat.completedInstances) {
                        reminderData[originalId].repeat.completedInstances = [];
                    }
                    if (!reminderData[originalId].repeat.completedTimes) {
                        reminderData[originalId].repeat.completedTimes = {};
                    }

                    const completedInstances = reminderData[originalId].repeat.completedInstances;
                    const completedTimes = reminderData[originalId].repeat.completedTimes;

                    if (completed) {
                        if (!completedInstances.includes(reminder.date)) {
                            completedInstances.push(reminder.date);
                        }
                        completedTimes[reminder.date] = getLocalDateTimeString(new Date());
                    } else {
                        const index = completedInstances.indexOf(reminder.date);
                        if (index > -1) {
                            completedInstances.splice(index, 1);
                        }
                        delete completedTimes[reminder.date];
                    }
                }
            } else {
                // 处理普通事件
                if (reminderData[reminder.id]) {
                    reminderData[reminder.id].completed = completed;
                    if (completed) {
                        reminderData[reminder.id].completedTime = getLocalDateTimeString(new Date());
                    } else {
                        delete reminderData[reminder.id].completedTime;
                    }
                }
            }

            await writeReminderData(reminderData);

            // 更新块的书签状态
            const blockId = reminder.blockId || reminder.id;
            if (blockId) {
                await updateBlockReminderBookmark(blockId);
            }

            // 触发全局更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 重新加载提醒列表
            this.loadReminders();

        } catch (error) {
            console.error('切换提醒状态失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    private async editReminder(reminder: any) {
        const editDialog = new QuickReminderDialog(
            undefined,
            undefined,
            () => {
                this.loadReminders();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            },
            undefined,
            {
                mode: 'edit',
                reminder: reminder,
                plugin: this.plugin
            }
        );
        editDialog.show();
    }

    private async openBlockTab(blockId: string) {
        try {
            const block = await getBlockByID(blockId);
            if (!block) {
                throw new Error('块不存在');
            }

            openBlock(blockId);
        } catch (error) {
            console.error('打开块失败:', error);
            showMessage(t("openNoteFailed"));
        }
    }

    // 添加新建提醒对话框方法
    private showAddReminderDialog() {
        const dialog = new QuickReminderDialog(undefined, undefined, () => {
            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        }, undefined, {
            blockId: this.documentId,
            mode: 'block',
            plugin: this.plugin
        });
        dialog.show();

        // 监听提醒更新事件以刷新当前对话框
        const handleReminderUpdate = () => {
            this.loadReminders();
            window.removeEventListener('reminderUpdated', handleReminderUpdate);
        };
        window.addEventListener('reminderUpdated', handleReminderUpdate);
    }

    // 新增：显示右键菜单
    private showContextMenu(event: MouseEvent, reminder: any) {
        // 移除已存在的菜单
        const existingMenu = document.querySelector('.doc-reminder-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        // 创建菜单
        const menu = document.createElement('div');
        menu.className = 'doc-reminder-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            z-index: 10000;
            min-width: 120px;
            padding: 4px 0;
        `;

        // 编辑选项
        const editOption = document.createElement('div');
        editOption.className = 'doc-reminder-context-menu-item';
        editOption.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            color: var(--b3-theme-on-surface);
        `;
        editOption.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
            </svg>
            ${t("editReminder")}
        `;
        editOption.addEventListener('click', () => {
            menu.remove();
            this.editReminder(reminder);
        });

        // 删除选项
        const deleteOption = document.createElement('div');
        deleteOption.className = 'doc-reminder-context-menu-item';
        deleteOption.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
            color: var(--b3-theme-error);
        `;
        deleteOption.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            ${t("deleteReminderContextMenu")}
        `;
        deleteOption.addEventListener('click', () => {
            menu.remove();
            this.deleteReminder(reminder);
        });

        // 鼠标悬停效果
        [editOption, deleteOption].forEach(option => {
            option.addEventListener('mouseenter', () => {
                option.style.backgroundColor = 'var(--b3-theme-surface-light)';
            });
            option.addEventListener('mouseleave', () => {
                option.style.backgroundColor = 'transparent';
            });
        });

        menu.appendChild(editOption);
        menu.appendChild(deleteOption);
        document.body.appendChild(menu);

        // 点击其他地方关闭菜单
        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);

        // 调整菜单位置，确保不超出视口
        const rect = menu.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (rect.right > viewportWidth) {
            menu.style.left = `${event.clientX - rect.width}px`;
        }
        if (rect.bottom > viewportHeight) {
            menu.style.top = `${event.clientY - rect.height}px`;
        }
    }

    // 新增：删除提醒
    private async deleteReminder(reminder: any) {

        // 确认删除
        const confirmMessage = reminder.isRepeatInstance
            ? t("deleteRepeatInstanceConfirm")
                .replace("${title}", reminder.title || t("unnamedNote"))
                .replace("${date}", reminder.date)
            : t("deleteReminderConfirm")
                .replace("${title}", reminder.title || t("unnamedNote"))
                .replace("${date}", reminder.date);

        const confirmed = await confirm(
            t("deleteReminderTitle"),
            confirmMessage,
            () => {
                this.performDeleteReminder(reminder);
            }
        );
    }


    private async performDeleteReminder(reminder: any) {
        // 用户确认删除
        try {
            const reminderData = await readReminderData();

            if (reminder.isRepeatInstance) {
                // 删除重复事件实例
                await this.deleteRepeatInstance(reminderData, reminder);
            } else {
                // 删除普通提醒
                await this.deleteNormalReminder(reminderData, reminder);
            }

            await writeReminderData(reminderData);

            // 更新块的书签状态
            const blockId = reminder.blockId || reminder.id;
            if (blockId) {
                await updateBlockReminderBookmark(blockId);
            }

            // 触发全局更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 重新加载提醒列表
            this.loadReminders();

            showMessage(t("reminderDeletedSuccess"));

        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    // 新增：删除重复事件实例
    private async deleteRepeatInstance(reminderData: any, reminder: any) {
        const originalId = reminder.originalId;
        const originalReminder = reminderData[originalId];

        if (!originalReminder) {
            throw new Error(t("originalReminderNotExist"));
        }

        // 如果是删除特定日期的实例，我们需要将其标记为已删除
        // 而不是真正删除，以避免重复生成
        if (!originalReminder.repeat.deletedInstances) {
            originalReminder.repeat.deletedInstances = [];
        }

        // 添加到已删除实例列表
        if (!originalReminder.repeat.deletedInstances.includes(reminder.date)) {
            originalReminder.repeat.deletedInstances.push(reminder.date);
        }

        // 如果该实例已完成，也需要从已完成列表中移除
        if (originalReminder.repeat.completedInstances) {
            const completedIndex = originalReminder.repeat.completedInstances.indexOf(reminder.date);
            if (completedIndex > -1) {
                originalReminder.repeat.completedInstances.splice(completedIndex, 1);
            }
        }

        // 删除完成时间记录
        if (originalReminder.repeat.completedTimes) {
            delete originalReminder.repeat.completedTimes[reminder.date];
        }

        // 删除实例修改记录
        if (originalReminder.repeat.instanceModifications) {
            delete originalReminder.repeat.instanceModifications[reminder.date];
        }
    }

    // 新增：删除普通提醒
    private async deleteNormalReminder(reminderData: any, reminder: any) {
        const reminderId = reminder.id;

        if (!reminderData[reminderId]) {
            throw new Error(t("reminderNotExistError"));
        }

        // 直接删除提醒
        delete reminderData[reminderId];
    }

    /**
     * 智能生成重复任务实例，确保至少能找到下一个未来实例
     * @param reminder 提醒任务对象
     * @param today 今天的日期字符串
     * @param isLunarRepeat 是否是农历重复
     * @returns 生成的实例数组
     */
    private generateInstancesWithFutureGuarantee(reminder: any, today: string, isLunarRepeat: boolean): any[] {
        // 根据重复类型确定初始范围
        let monthsToAdd = 2; // 默认范围

        if (isLunarRepeat) {
            monthsToAdd = 14; // 农历重复需要更长范围
        } else if (reminder.repeat.type === 'yearly') {
            monthsToAdd = 14; // 年度重复初始范围为14个月
        } else if (reminder.repeat.type === 'monthly') {
            monthsToAdd = 3; // 月度重复使用3个月
        }

        let repeatInstances: any[] = [];
        let hasUncompletedFutureInstance = false;
        const maxAttempts = 5; // 最多尝试5次扩展
        let attempts = 0;

        // 获取已完成实例列表
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

            // 生成实例，使用足够大的 maxInstances 以确保生成所有实例
            const maxInstances = monthsToAdd * 50; // 根据范围动态调整
            repeatInstances = generateRepeatInstances(reminder, startDate, endDate, maxInstances);

            // 检查是否有未完成的未来实例（关键修复：不仅要是未来的，还要是未完成的）
            hasUncompletedFutureInstance = repeatInstances.some(instance => {
                const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                const originalKey = instanceIdStr.split('_').pop() || instance.date;
                return compareDateStrings(instance.date, today) > 0 && !completedInstances.includes(originalKey);
            });

            if (!hasUncompletedFutureInstance) {
                // 如果没有找到未完成的未来实例，扩展范围
                if (reminder.repeat.type === 'yearly') {
                    monthsToAdd += 12; // 年度重复每次增加12个月
                } else if (isLunarRepeat) {
                    monthsToAdd += 12; // 农历重复每次增加12个月
                } else {
                    monthsToAdd += 6; // 其他类型每次增加6个月
                }
                attempts++;
            }
        }

        return repeatInstances;
    }
}
