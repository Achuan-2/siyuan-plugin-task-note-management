import { showMessage, Dialog, Menu, confirm, getBackend, getFrontend } from "siyuan";
import { openBlock } from "../api";
import { getLocalDateTimeString, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { HabitGroupManager } from "../utils/habitGroupManager";
import { i18n } from "../pluginInstance";
import { HabitEditDialog } from "./HabitEditDialog";
import { HabitStatsDialog } from "./HabitStatsDialog";
import { HabitGroupManageDialog } from "./HabitGroupManageDialog";
import { HabitCheckInEmojiDialog } from "./HabitCheckInEmojiDialog";
import { HabitCalendarDialog } from "./HabitCalendarDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { createPomodoroStartSubmenu as createSharedPomodoroStartSubmenu } from "@/utils/pomodoroPresets";

export interface HabitCheckInEmoji {
    emoji: string;
    meaning: string;
    value?: number;
    group?: string; // 打卡选项分组
    // 当打卡该emoji时，是否在每次打卡时弹窗输入备注
    promptNote?: boolean;
    // 是否认为是成功打卡（默认为true）
    countsAsSuccess?: boolean;
    // value removed: now emoji only has emoji and meaning
}

export interface Habit {
    id: string;
    title: string;
    note?: string; // 提醒备注
    blockId?: string; // 绑定的块ID
    target: number; // 每次打卡需要打卡x次
    goalType?: 'count' | 'pomodoro'; // 打卡目标类型：按次数或按番茄时长
    pomodoroTargetHours?: number; // 番茄目标小时
    pomodoroTargetMinutes?: number; // 番茄目标分钟
    autoCheckInAfterPomodoro?: boolean; // 完成番茄后是否自动打卡
    autoCheckInEmoji?: string; // 自动打卡使用的 emoji
    frequency: {
        type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'ebbinghaus';
        interval?: number; // 重复间隔，比如每x天
        weekdays?: number[]; // 重复星期 (0-6, 0=周日)
        monthDays?: number[]; // 重复日期 (1-31)
        months?: number[]; // 重复月份 (1-12)
    };
    startDate: string;
    endDate?: string;
    reminderTime?: string; // (向后兼容) 单个提醒时间
    reminderTimes?: (string | { time: string; note?: string })[]; // 支持多个提醒时间
    groupId?: string; // 分组ID
    priority?: 'high' | 'medium' | 'low' | 'none';
    checkInEmojis: HabitCheckInEmoji[]; // 打卡emoji配置
    checkIns: { // 打卡记录
        [date: string]: {
            count: number; // 当天打卡次数
            status: string[]; // 打卡状态emoji数组（兼容旧格式）
            timestamp: string; // 最后打卡时间
            entries?: { emoji: string; timestamp: string; note?: string }[]; // 每次单独打卡记录
        };
    };
    // 每日提醒通知状态 (键为 YYYY-MM-DD -> true/false 或键->(time->true))
    // 例如： { '2025-12-01': true } 或 { '2025-12-01': { '08:00': true, '20:00': true } }
    hasNotify?: { [date: string]: boolean | { [time: string]: boolean } };
    totalCheckIns: number; // 总打卡次数（保留历史数据，已不在主面板显示）
    createdAt: string;
    updatedAt: string;
    hideCheckedToday?: boolean; // 如果设置为true，今天已打卡的选项不显示在菜单中
    // 手动排序字段（用于同优先级内的自定义顺序，数值越小越靠前）
    sort?: number;
}

interface HabitPomodoroStats {
    totalCount: number;
    totalFocusMinutes: number;
    todayCount: number;
    todayFocusMinutes: number;
}

export class HabitPanel {
    private container: HTMLElement;
    private plugin: any;
    private habitsContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private groupFilterButton: HTMLButtonElement;
    private currentTab: string = 'today';
    private selectedGroups: string[] = [];
    // 排序选项
    private sortKey: 'priority' | 'title' = 'priority';
    private sortOrder: 'desc' | 'asc' = 'desc';
    private sortButton: HTMLButtonElement;
    private groupManager: HabitGroupManager;
    private habitUpdatedHandler: () => void;
    private habitPomodoroCompletedHandler: (event: Event) => void;
    private collapsedGroups: Set<string> = new Set();
    // 拖拽状态
    private draggingHabitId: string | null = null;
    private dragOverTargetEl: HTMLElement | null = null;
    private dragOverPosition: 'before' | 'after' | null = null;
    private pomodoroManager: PomodoroManager = PomodoroManager.getInstance();
    private pomodoroRecordManager: PomodoroRecordManager;

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.groupManager = HabitGroupManager.getInstance();
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin);

        this.habitUpdatedHandler = () => {
            this.loadHabits();
        };
        this.habitPomodoroCompletedHandler = (event: Event) => {
            this.handleHabitPomodoroCompleted(event);
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.groupManager.initialize();
        await this.pomodoroRecordManager.initialize();
        await this.loadCollapseStates();
        await this.restorePanelSettings();

        this.initUI();
        this.updateSortButtonTitle();
        this.loadHabits();

        window.addEventListener('habitUpdated', this.habitUpdatedHandler);
        window.addEventListener('habitPomodoroCompleted', this.habitPomodoroCompletedHandler);
    }

    public destroy() {
        this.saveCollapseStates();
        if (this.habitUpdatedHandler) {
            window.removeEventListener('habitUpdated', this.habitUpdatedHandler);
        }
        if (this.habitPomodoroCompletedHandler) {
            window.removeEventListener('habitPomodoroCompleted', this.habitPomodoroCompletedHandler);
        }
        this.pomodoroManager.cleanupInactiveTimer();
    }

    private async restorePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            this.sortKey = settings.habitPanelSortKey || 'priority';
            this.sortOrder = settings.habitPanelSortOrder || 'desc';
            if (Array.isArray(settings.habitPanelSelectedGroups)) {
                this.selectedGroups = settings.habitPanelSelectedGroups;
            }
        } catch (error) {
            console.error('恢复习惯面板设置失败:', error);
        }
    }

    private async savePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            settings.habitPanelSortKey = this.sortKey;
            settings.habitPanelSortOrder = this.sortOrder;
            settings.habitPanelSelectedGroups = this.selectedGroups;
            await this.plugin.saveSettings(settings);
        } catch (error) {
            console.error('保存习惯面板设置失败:', error);
        }
    }

    private async loadCollapseStates() {
        try {
            console.debug('HabitPanel: showSortMenu invoked', { sortKey: this.sortKey, sortOrder: this.sortOrder });
            const states = localStorage.getItem('habit-panel-collapse-states');
            if (states) {
                this.collapsedGroups = new Set(JSON.parse(states));
            }
        } catch (error) {
            console.warn('加载折叠状态失败:', error);
        }
    }

    private saveCollapseStates() {
        try {
            localStorage.setItem('habit-panel-collapse-states',
                JSON.stringify(Array.from(this.collapsedGroups)));
        } catch (error) {
            console.warn('保存折叠状态失败:', error);
        }
    }

    private initUI() {
        this.container.classList.add('habit-panel');
        this.container.innerHTML = '';

        // 标题部分
        const header = document.createElement('div');
        header.className = 'habit-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'habit-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'habit-icon';
        iconSpan.textContent = '✅';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = i18n("habitPanelTitle");

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'habit-panel__actions';
        actionContainer.style.cssText = 'display:flex; justify-content:flex-start; gap:8px; margin-bottom:8px; flex-warp: wrap;';

        // 新建习惯按钮
        const newHabitBtn = document.createElement('button');
        newHabitBtn.className = 'b3-button b3-button--outline';
        newHabitBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        newHabitBtn.title = i18n("newHabit");
        newHabitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNewHabitDialog();
        });
        actionContainer.appendChild(newHabitBtn);

        // 日历视图按钮（习惯分布）
        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'b3-button b3-button--outline';
        calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
        calendarBtn.title = i18n("habitCalendar");
        calendarBtn.addEventListener('click', () => {
            this.openHabitCalendarView();
        });
        actionContainer.appendChild(calendarBtn);

        // 统计日历按钮（HabitCalendarDialog）
        const habitStatsCalendarBtn = document.createElement('button');
        habitStatsCalendarBtn.className = 'b3-button b3-button--outline';
        habitStatsCalendarBtn.textContent = '📊';
        habitStatsCalendarBtn.title = i18n("habitStats") || "习惯统计";
        habitStatsCalendarBtn.addEventListener('click', () => {
            this.openHabitStatsCalendarDialog();
        });
        actionContainer.appendChild(habitStatsCalendarBtn);

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.title = i18n("sortBy");
        this.sortButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSortMenu(e);
        });
        actionContainer.appendChild(this.sortButton);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = i18n("refresh");
        refreshBtn.addEventListener('click', () => {
            this.loadHabits();
        });
        actionContainer.appendChild(refreshBtn);

        // 更多按钮（显示插件设置）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.title = i18n("more");
        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMoreMenu(e);
        });
        actionContainer.appendChild(moreBtn);

        header.appendChild(titleContainer);
        header.appendChild(actionContainer);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'habit-controls';
        controls.style.cssText = 'display: flex; gap: 8px; width: 100%;';

        // 时间筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = 'flex: 1; min-width: 0;';
        this.filterSelect.innerHTML = `
            <option value="today" selected>${i18n("filterTodayPending")}</option>
            <option value="tomorrow">${i18n("filterTomorrow")}</option>
            <option value="all">${i18n("filterAll")}</option>
            <option value="todayCompleted">${i18n("filterTodayCompleted")}</option>
            <option value="yesterdayCompleted">${i18n("filterYesterdayCompleted")}</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadHabits();
        });
        controls.appendChild(this.filterSelect);

        // 分组筛选按钮
        this.groupFilterButton = document.createElement('button');
        this.groupFilterButton.className = 'b3-button b3-button--outline';
        this.groupFilterButton.style.cssText = `
            display: inline-block;
            max-width: 200px;
            box-sizing: border-box;
            padding: 0 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            vertical-align: middle;
            text-align: left;
        `;
        this.groupFilterButton.textContent = i18n("groupFilter");
        this.groupFilterButton.addEventListener('click', () => this.showGroupSelectDialog());
        controls.appendChild(this.groupFilterButton);

        header.appendChild(controls);
        this.container.appendChild(header);

        // 习惯列表容器
        this.habitsContainer = document.createElement('div');
        this.habitsContainer.className = 'habit-list';
        this.habitsContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        `;
        this.container.appendChild(this.habitsContainer);

        this.updateGroupFilterButtonText();
    }

    private updateGroupFilterButtonText() {
        if (!this.groupFilterButton) return;

        if (this.selectedGroups.length === 0 || this.selectedGroups.includes('all')) {
            this.groupFilterButton.textContent = i18n("groupFilter");
        } else {
            const names = this.selectedGroups.map(id => {
                if (id === 'none') return i18n("noneGroupName");
                const group = this.groupManager.getGroupById(id);
                return group ? group.name : id;
            });
            this.groupFilterButton.textContent = names.join(', ');
        }
    }

    private showSortMenu(event: MouseEvent) {
        try {
            const menu = new Menu("habitSortMenu");

            const sortOptions = [
                { key: 'priority', label: i18n('sortByPriority'), icon: '🎯' },
                { key: 'title', label: i18n('sortByTitle'), icon: '📝' }
            ];

            sortOptions.forEach(option => {
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${i18n('ascending')})`,
                    current: this.sortKey === option.key && this.sortOrder === 'asc',
                    click: () => {
                        this.setSort(option.key as any, 'asc');
                    }
                });

                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${i18n('descending')})`,
                    current: this.sortKey === option.key && this.sortOrder === 'desc',
                    click: () => {
                        this.setSort(option.key as any, 'desc');
                    }
                });
            });

            // 使用按钮的位置定位菜单（与 ReminderPanel 保持一致）
            if (this.sortButton) {
                console.debug('HabitPanel: sortButton rect', this.sortButton.getBoundingClientRect());
                const rect = this.sortButton.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

                const maxX = window.innerWidth - 200;
                const maxY = window.innerHeight - 200;

                menu.open({
                    x: Math.min(menuX, maxX),
                    y: Math.min(menuY, maxY)
                });
            } else {
                // 回退：根据事件坐标打开
                menu.open({ x: event.clientX, y: event.clientY });
            }
        } catch (error) {
            console.error('显示排序菜单失败:', error);
        }
    }

    // 显示更多菜单（包含插件设置）
    private showMoreMenu(event: MouseEvent) {
        try {
            const menu = new Menu("habitMoreMenu");

            // 插件设置
            menu.addItem({
                icon: 'iconSettings',
                label: i18n("pluginSettings"),
                click: () => {
                    try {
                        if (this.plugin && typeof this.plugin.openSetting === 'function') {
                            this.plugin.openSetting();
                        } else {
                            console.warn('plugin.openSetting is not available');
                        }
                    } catch (err) {
                        console.error('打开插件设置失败:', err);
                    }
                }
            });

            // 分组管理
            menu.addItem({
                icon: 'iconTags',
                label: i18n("groupManageBtn"),
                click: () => {
                    this.showGroupManageDialog();
                }
            });

            // 使用按钮的位置定位菜单（回退到事件坐标）
            if (event.target instanceof HTMLElement) {
                const rect = event.target.getBoundingClientRect();
                menu.open({ x: rect.left, y: rect.bottom + 4 });
            } else {
                menu.open({ x: event.clientX, y: event.clientY });
            }
        } catch (error) {
            console.error('显示更多菜单失败:', error);
        }
    }

    private setSort(key: 'priority' | 'title', order: 'asc' | 'desc') {
        this.sortKey = key;
        this.sortOrder = order;
        this.updateSortButtonTitle();
        this.savePanelSettings();
        this.loadHabits();
    }

    private updateSortButtonTitle() {
        const sortLabels = {
            'priority_desc': i18n("sortHighPriority"),
            'priority_asc': i18n("sortLowPriority"),
            'title_asc': i18n("sortTitleAZ"),
            'title_desc': i18n("sortTitleZA")
        };
        const key = `${this.sortKey}_${this.sortOrder}`;
        this.sortButton.title = `${i18n("sortPrefix")}${sortLabels[key] || i18n("sortDefault")}`;
    }

    private async loadHabits() {
        try {
            // 保存滚动位置
            const scrollTop = this.habitsContainer?.scrollTop || 0;

            try {
                await this.pomodoroRecordManager.refreshData();
            } catch (error) {
                console.warn('刷新番茄钟数据失败:', error);
            }

            const habitData = await this.plugin.loadHabitData();
            const habits: Habit[] = Object.values(habitData || {});

            // 应用筛选
            let filteredHabits = this.applyFilter(habits);
            filteredHabits = this.applyGroupFilter(filteredHabits);

            this.renderHabits(filteredHabits);

            // 恢复滚动位置
            if (this.habitsContainer && scrollTop > 0) {
                // 使用 requestAnimationFrame 确保 DOM 已更新
                requestAnimationFrame(() => {
                    this.habitsContainer.scrollTop = scrollTop;
                });
            }
        } catch (error) {
            console.error('loadHabits failed:', error);
            this.habitsContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">${i18n("loadHabitFailed")}</div>`;
        }
    }

    private applyFilter(habits: Habit[]): Habit[] {
        const today = getLogicalDateString();
        const tomorrow = getRelativeDateString(1);
        const yesterday = getRelativeDateString(-1);

        switch (this.currentTab) {
            case 'today':
                return habits.filter(h => this.shouldShowToday(h, today));
            case 'tomorrow':
                return habits.filter(h => this.shouldShowOnDate(h, tomorrow));
            case 'todayCompleted':
                return habits.filter(h => this.isCompletedOnDate(h, today));
            case 'yesterdayCompleted':
                return habits.filter(h => this.isCompletedOnDate(h, yesterday));
            case 'all':
            default:
                return habits;
        }
    }

    private shouldShowToday(habit: Habit, today: string): boolean {
        // 检查是否在有效期内
        if (habit.startDate > today) return false;
        if (habit.endDate && habit.endDate < today) return false;

        // 检查今天是否应该打卡
        if (!this.shouldCheckInOnDate(habit, today)) return false;

        // 检查今天是否已完成
        return !this.isCompletedOnDate(habit, today);
    }

    private shouldShowOnDate(habit: Habit, date: string): boolean {
        if (habit.startDate > date) return false;
        if (habit.endDate && habit.endDate < date) return false;
        return this.shouldCheckInOnDate(habit, date);
    }

    private shouldCheckInOnDate(habit: Habit, date: string): boolean {
        const { frequency } = habit;
        const checkDate = new Date(date);
        const startDate = new Date(habit.startDate);

        switch (frequency.type) {
            case 'daily':
                if (frequency.interval) {
                    const daysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                    return daysDiff % frequency.interval === 0;
                }
                return true;

            case 'weekly':
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.interval) {
                    const weeksDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / (86400000 * 7));
                    return weeksDiff % frequency.interval === 0 && checkDate.getDay() === startDate.getDay();
                }
                return checkDate.getDay() === startDate.getDay();

            case 'monthly':
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                if (frequency.interval) {
                    const monthsDiff = (checkDate.getFullYear() - startDate.getFullYear()) * 12 +
                        (checkDate.getMonth() - startDate.getMonth());
                    return monthsDiff % frequency.interval === 0 && checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getDate() === startDate.getDate();

            case 'yearly':
                if (frequency.months && frequency.months.length > 0) {
                    if (!frequency.months.includes(checkDate.getMonth() + 1)) return false;
                    if (frequency.monthDays && frequency.monthDays.length > 0) {
                        return frequency.monthDays.includes(checkDate.getDate());
                    }
                    return checkDate.getDate() === startDate.getDate();
                }
                if (frequency.interval) {
                    const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                    return yearsDiff % frequency.interval === 0 &&
                        checkDate.getMonth() === startDate.getMonth() &&
                        checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getMonth() === startDate.getMonth() &&
                    checkDate.getDate() === startDate.getDate();

            case 'ebbinghaus':
                const ebbinghausDaysDiff = Math.floor((checkDate.getTime() - startDate.getTime()) / 86400000);
                const ebbinghausPattern = [1, 2, 4, 7, 15];
                const maxPatternDay = 15;
                if (ebbinghausDaysDiff < 0) return false;
                if (ebbinghausDaysDiff === 0) return true;
                if (ebbinghausPattern.includes(ebbinghausDaysDiff)) return true;
                return ebbinghausDaysDiff > maxPatternDay && (ebbinghausDaysDiff - maxPatternDay) % 15 === 0;

            default:
                return true;
        }
    }

    private isCompletedOnDate(habit: Habit, date: string): boolean {
        const { current, target } = this.getHabitProgressOnDate(habit, date);
        return current >= target;
    }

    private getHabitGoalType(habit: Habit): 'count' | 'pomodoro' {
        return habit.goalType === 'pomodoro' ? 'pomodoro' : 'count';
    }

    private getHabitPomodoroTargetMinutes(habit: Habit): number {
        const hours = Math.max(0, Number(habit.pomodoroTargetHours) || 0);
        const minutes = Math.max(0, Number(habit.pomodoroTargetMinutes) || 0);
        const total = (hours * 60) + minutes;
        if (total > 0) return total;
        return Math.max(1, Number(habit.target) || 1);
    }

    private getHabitProgressOnDate(habit: Habit, date: string): { current: number; target: number } {
        if (this.getHabitGoalType(habit) === 'pomodoro') {
            const target = this.getHabitPomodoroTargetMinutes(habit);
            const current = this.pomodoroRecordManager.getEventFocusTime(habit.id, date) || 0;
            return { current, target };
        }

        const checkIn = habit.checkIns?.[date];
        if (!checkIn) {
            return { current: 0, target: Math.max(1, Number(habit.target) || 1) };
        }
        const current = checkIn.count || 0;
        const target = Math.max(1, Number(habit.target) || 1);
        return { current, target };
    }

    private formatMinutesToHourMinute(totalMinutes: number): string {
        const minutes = Math.max(0, Math.round(totalMinutes || 0));
        if (minutes < 60) {
            return `${minutes}m`;
        }
        const hours = Math.floor(minutes / 60);
        const remain = minutes % 60;
        return remain > 0 ? `${hours}h${remain}m` : `${hours}h`;
    }

    private applyGroupFilter(habits: Habit[]): Habit[] {
        if (this.selectedGroups.length === 0 || this.selectedGroups.includes('all')) {
            return habits;
        }

        return habits.filter(habit => {
            const groupId = habit.groupId || 'none';
            return this.selectedGroups.includes(groupId);
        });
    }

    private renderHabits(habits: Habit[]) {
        this.habitsContainer.innerHTML = '';

        // 如果没有习惯，根据当前 tab 决定是否继续渲染已打卡区
        if (habits.length === 0) {
            if (this.currentTab !== 'today') {
                this.habitsContainer.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--b3-theme-on-surface-light);">${i18n("noHabits")}</div>`;
                return;
            }
            // 否则（today 且主区无待打卡习惯）继续渲染已打卡区
        }

        // 按分组分类
        const groupedHabits = new Map<string, Habit[]>();
        habits.forEach(habit => {
            const groupId = habit.groupId || 'none';
            if (!groupedHabits.has(groupId)) {
                groupedHabits.set(groupId, []);
            }
            groupedHabits.get(groupId)!.push(habit);
        });

        // 记录主区已渲染的习惯ID，防止已打卡区重复渲染
        const renderedIds = new Set<string>();

        // 渲染每个分组
        const sortedGroups = this.groupManager.getAllGroups();

        // 先渲染有分组的习惯，按顺序
        sortedGroups.forEach(group => {
            if (groupedHabits.has(group.id)) {
                const groupHabits = groupedHabits.get(group.id)!;
                groupHabits.forEach(h => renderedIds.add(h.id));
                this.renderGroup(group.id, groupHabits);
                groupedHabits.delete(group.id);
            }
        });

        // 最后渲染无分组的习惯 (groupId === 'none')
        if (groupedHabits.has('none')) {
            const groupHabits = groupedHabits.get('none')!;
            groupHabits.forEach(h => renderedIds.add(h.id));
            this.renderGroup('none', groupHabits);
            groupedHabits.delete('none');
        }

        // 如果还有其他未渲染的分组（理论上不应该有，除非有脏数据），也渲染出来
        groupedHabits.forEach((groupHabits, groupId) => {
            groupHabits.forEach(h => renderedIds.add(h.id));
            this.renderGroup(groupId, groupHabits);
        });

        // 如果是今日待打卡，在下方显示已打卡习惯（排除已在主区渲染的习惯）
        if (this.currentTab === 'today') {
            this.renderCompletedHabitsSection(renderedIds);
        }
    }

    private renderGroup(groupId: string, habits: Habit[]) {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'habit-group';
        groupContainer.style.cssText = 'margin-bottom: 16px;';

        // 分组头部
        const groupHeader = document.createElement('div');
        groupHeader.className = 'habit-group__header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            padding: 8px;
            background: var(--b3-theme-surface);
            border-radius: 4px;
            cursor: pointer;
            margin-bottom: 8px;
        `;

        const group = groupId === 'none' ? null : this.groupManager.getGroupById(groupId);
        const groupName = group ? group.name : i18n("noneGroupName");
        const isCollapsed = this.collapsedGroups.has(groupId);

        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = isCollapsed ? '▶' : '🔽';
        collapseIcon.style.cssText = 'margin-right: 8px; font-size: 12px;';

        const groupTitle = document.createElement('span');
        groupTitle.textContent = `${groupName} (${habits.length})`;
        groupTitle.style.cssText = 'flex: 1; font-weight: bold;';

        groupHeader.appendChild(collapseIcon);
        groupHeader.appendChild(groupTitle);

        groupHeader.addEventListener('click', () => {
            if (this.collapsedGroups.has(groupId)) {
                this.collapsedGroups.delete(groupId);
            } else {
                this.collapsedGroups.add(groupId);
            }
            this.loadHabits();
        });

        groupContainer.appendChild(groupHeader);

        // 分组内容
        if (!isCollapsed) {
            const groupContent = document.createElement('div');
            groupContent.className = 'habit-group__content';

            // 对分组内的习惯进行排序
            const sortedHabits = this.sortHabitsInGroup(habits);
            sortedHabits.forEach(habit => {
                const habitCard = this.createHabitCard(habit);
                const isAndroid = getFrontend().endsWith('mobile') || getBackend().endsWith('android');
                if (!isAndroid) {                // 启用拖拽：仅在同一分组内按优先级排序时可拖拽调整
                    habitCard.draggable = true;
                    habitCard.dataset.habitId = habit.id;
                    habitCard.style.cursor = 'grab';

                    habitCard.addEventListener('dragstart', (e) => {
                        this.draggingHabitId = habit.id;
                        habitCard.style.opacity = '0.5';
                        habitCard.style.cursor = 'grabbing';
                        if (e.dataTransfer) {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', habit.id);
                        }
                    });

                    habitCard.addEventListener('dragend', () => {
                        this.draggingHabitId = null;
                        habitCard.style.opacity = '';
                        habitCard.style.cursor = 'grab';
                        this.clearDragOver();
                    });

                    habitCard.addEventListener('dragover', (e) => {
                        if (this.draggingHabitId && this.draggingHabitId !== habit.id) {
                            e.preventDefault();
                            const rect = habitCard.getBoundingClientRect();
                            const pos = (e.clientY - rect.top) < (rect.height / 2) ? 'before' : 'after';
                            this.setDragOverIndicator(habitCard, pos as 'before' | 'after');
                        }
                    });

                    habitCard.addEventListener('dragleave', () => {
                        this.clearDragOverOn(habitCard);
                    });

                    habitCard.addEventListener('drop', async (e) => {
                        e.preventDefault();
                        if (!this.draggingHabitId || this.draggingHabitId === habit.id) return;
                        const draggedId = this.draggingHabitId;
                        const targetId = habit.id;

                        try {
                            // 支持跨优先级排序，自动更新优先级
                            await this.reorderHabits(groupId, habit.priority, draggedId, targetId, this.dragOverPosition || 'after');
                            await this.loadHabits();
                            showMessage(i18n("sortUpdated"));
                        } catch (err) {
                            console.error('reorder failed:', err);
                            showMessage(i18n("reorderFailed"), 3000, 'error');
                        }
                        this.draggingHabitId = null;
                        this.clearDragOver();
                    });
                };


                groupContent.appendChild(habitCard);
            });

            groupContainer.appendChild(groupContent);
        }

        this.habitsContainer.appendChild(groupContainer);
    }

    private sortHabitsInGroup(habits: Habit[]): Habit[] {
        const priorityVal = (p?: string) => {
            switch (p) {
                case 'high': return 3;
                case 'medium': return 2;
                case 'low': return 1;
                default: return 0;
            }
        };

        const compare = (a: Habit, b: Habit) => {
            if (this.sortKey === 'priority') {
                const pa = priorityVal(a.priority);
                const pb = priorityVal(b.priority);
                if (pa !== pb) return pb - pa;
                // 同优先级时，优先使用手动排序值（sort），没有则按标题
                const sa = (a as any).sort || 0;
                const sb = (b as any).sort || 0;
                if (sa !== sb) return sa - sb;
                return (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
            }
            // title
            const res = (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
            if (res !== 0) return res;
            // fallback by priority, then manual sort
            const pv = priorityVal(b.priority) - priorityVal(a.priority);
            if (pv !== 0) return pv;
            return ((a as any).sort || 0) - ((b as any).sort || 0);
        };

        const copy = [...habits];
        copy.sort((a, b) => {
            const r = compare(a, b);
            // 当按优先级排序时，手动排序（`sort` 字段）应被视为绝对顺序，不受全局升降序切换影响
            if (this.sortKey === 'priority') {
                return r;
            }
            return this.sortOrder === 'asc' ? r : -r;
        });
        return copy;
    }

    private createHabitCard(habit: Habit): HTMLElement {
        const card = document.createElement('div');
        card.className = 'habit-card';
        // 标题和优先级
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';

        const priorityIcon = this.getPriorityIcon(habit.priority);
        if (priorityIcon) {
            const priority = document.createElement('span');
            priority.textContent = priorityIcon;
            priority.style.fontSize = '16px';
            titleRow.appendChild(priority);
        }

        const title = document.createElement('span');
        title.setAttribute('data-type', 'a');
        if (habit.blockId) {
            title.setAttribute('data-href', `siyuan://blocks/${habit.blockId}`);
        }
        title.textContent = habit.title;
        title.style.cssText = 'flex: 1; font-weight: bold; font-size: 14px;';
        if (habit.blockId) {
            title.style.cursor = 'pointer';
            title.style.color = 'var(--b3-theme-primary)';
            title.style.textDecoration = 'underline dotted';
            title.addEventListener('click', (ev) => {
                ev.stopPropagation();
                try {
                    openBlock(habit.blockId!);
                } catch (err) {
                    console.error('openBlock failed:', err);
                    showMessage(i18n("openBlockFailed"), 3000, 'error');
                }
            });
        }
        titleRow.appendChild(title);

        // 绑定块的图标已移除，点击和 data-href 在标题 `span` 上处理。

        card.appendChild(titleRow);

        // 打卡信息
        const today = getLogicalDateString();
        const checkIn = habit.checkIns?.[today];
        const goalType = this.getHabitGoalType(habit);
        const { current: currentProgress, target: targetProgress } = this.getHabitProgressOnDate(habit, today);

        const progressRow = document.createElement('div');
        progressRow.style.cssText = 'margin-bottom: 8px;';

        if (goalType === 'pomodoro') {
            const progressText = document.createElement('div');
            progressText.textContent = `今日番茄进度：${this.formatMinutesToHourMinute(currentProgress)}/${this.formatMinutesToHourMinute(targetProgress)}`;
            progressText.style.cssText = 'font-size: 12px; margin-bottom: 4px; color: var(--b3-theme-on-surface-light);';
            progressRow.appendChild(progressText);

            const progressBar = document.createElement('div');
            progressBar.style.cssText = `
                width: 100%;
                height: 6px;
                background: var(--b3-theme-surface);
                border-radius: 3px;
                overflow: hidden;
            `;
            const progressFill = document.createElement('div');
            const percentage = Math.min(100, (currentProgress / Math.max(1, targetProgress)) * 100);
            progressFill.style.cssText = `
                width: ${percentage}%;
                height: 100%;
                background: var(--b3-theme-primary);
                transition: width 0.3s;
            `;
            progressBar.appendChild(progressFill);
            progressRow.appendChild(progressBar);
        } else if (targetProgress > 1) {
            const progressText = document.createElement('div');
            progressText.textContent = `${i18n("todayProgressLabel")}${currentProgress}/${targetProgress}`;
            progressText.style.cssText = 'font-size: 12px; margin-bottom: 4px; color: var(--b3-theme-on-surface-light);';
            progressRow.appendChild(progressText);

            const progressBar = document.createElement('div');
            progressBar.style.cssText = `
                width: 100%;
                height: 6px;
                background: var(--b3-theme-surface);
                border-radius: 3px;
                overflow: hidden;
            `;

            const progressFill = document.createElement('div');
            const percentage = Math.min(100, (currentProgress / targetProgress) * 100);
            progressFill.style.cssText = `
                width: ${percentage}%;
                height: 100%;
                background: var(--b3-theme-primary);
                transition: width 0.3s;
            `;
            progressBar.appendChild(progressFill);
            progressRow.appendChild(progressBar);
        } else {
            const progressText = document.createElement('div');
            progressText.textContent = `${i18n("todayStatusLabel")}${currentProgress >= targetProgress ? i18n("completed") : i18n("unfinished")}`;
            progressText.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light);';
            progressRow.appendChild(progressText);
        }

        card.appendChild(progressRow);

        // 频率信息
        const frequencyText = this.getFrequencyText(habit.frequency);
        const frequency = document.createElement('div');
        frequency.textContent = `${i18n("frequencyLabel")}${frequencyText}`;
        frequency.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
        card.appendChild(frequency);

        // 时间范围
        const timeRange = document.createElement('div');
        timeRange.textContent = `${i18n("timeLabel")}${habit.startDate}${habit.endDate ? ' ~ ' + habit.endDate : i18n("timeStart")}`;
        timeRange.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
        card.appendChild(timeRange);

        // 提醒时间（支持多个）
        const timesList = Array.isArray(habit.reminderTimes) && habit.reminderTimes.length > 0 ? habit.reminderTimes : (habit.reminderTime ? [habit.reminderTime] : []);
        if (timesList && timesList.length > 0) {
            const reminder = document.createElement('div');
            // 提取时间字符串，如果是对象则取 time 属性
            const displayTimes = timesList.map(t => typeof t === 'string' ? t : t.time);
            reminder.textContent = `${i18n("reminderLabel")}${displayTimes.join(', ')}`;
            reminder.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
            card.appendChild(reminder);
        }

        const pomodoroStats = this.getHabitPomodoroStats(habit.id);
        if (pomodoroStats.totalCount > 0 || pomodoroStats.totalFocusMinutes > 0) {
            const pomodoroInfo = document.createElement('div');
            pomodoroInfo.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';

            const totalLine = document.createElement('div');
            totalLine.textContent = `${i18n("total") || "总计"}: 🍅 ${pomodoroStats.totalCount}  ⏱ ${this.formatPomodoroFocusTime(pomodoroStats.totalFocusMinutes)}`;
            pomodoroInfo.appendChild(totalLine);

            const todayLine = document.createElement('div');
            todayLine.textContent = `${i18n("today") || "今日"}: 🍅 ${pomodoroStats.todayCount}  ⏱ ${this.formatPomodoroFocusTime(pomodoroStats.todayFocusMinutes)}`;
            pomodoroInfo.appendChild(todayLine);

            card.appendChild(pomodoroInfo);
        }

        // 坚持打卡天数（显示打卡天数，替换累计打卡次数）
        const checkInDaysCount = Object.keys(habit.checkIns || {}).length;
        const checkInDaysEl = document.createElement('div');
        checkInDaysEl.textContent = i18n("persistDays", { count: checkInDaysCount.toString() });
        checkInDaysEl.style.cssText = 'font-size: 12px; color: var(--b3-theme-primary); font-weight: bold;';

        // 今日打卡 emoji（只显示当天的）
        if (checkIn && ((checkIn.entries && checkIn.entries.length > 0) || (checkIn.status && checkIn.status.length > 0))) {
            const emojiRow = document.createElement('div');
            emojiRow.style.cssText = 'margin-top:8px; display:flex; gap:6px; align-items:center;';


            const emojiLabel = document.createElement('span');
            emojiLabel.textContent = i18n("todayCheckInEmoji");
            emojiLabel.style.cssText = 'font-size:12px; color: var(--b3-theme-on-surface-light); margin-right:6px;';
            emojiRow.appendChild(emojiLabel);

            // Only show today's entries, and display emoji icons (preserve order). Support both "entries" (new) and "status" (legacy).
            const emojis: string[] = [];
            if (checkIn.entries && checkIn.entries.length > 0) {
                checkIn.entries.forEach(entry => emojis.push(entry.emoji));
            } else if (checkIn.status && checkIn.status.length > 0) {
                // status may contain repeated emojis; keep the order
                checkIn.status.forEach(s => emojis.push(s));
            }

            emojis.forEach((emojiStr) => {
                const emojiEl = document.createElement('span');
                emojiEl.textContent = emojiStr;
                emojiEl.title = emojiStr;
                emojiEl.style.cssText = 'font-size: 18px; line-height: 1;';
                emojiRow.appendChild(emojiEl);
            });


            card.appendChild(emojiRow);
        }
        // 底部操作行：左侧显示坚持天数，右侧放打卡按钮（两者在一行）
        try {
            const footerRow = document.createElement('div');
            footerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; gap:8px; margin-top:8px;';

            // 左侧：坚持打卡天数
            const leftWrap = document.createElement('div');
            leftWrap.style.cssText = 'flex:1;';
            leftWrap.appendChild(checkInDaysEl);

            // 右侧：按钮集合（当前仅一个打卡按钮）
            const actionRow = document.createElement('div');
            actionRow.style.cssText = 'display:flex; justify-content:flex-end; gap:8px;';

            const checkInBtn = document.createElement('button');
            checkInBtn.className = 'b3-button b3-button--outline b3-button--small';
            checkInBtn.innerHTML = i18n("checkInBtn");

            checkInBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                try {
                    const menu = new Menu('habitCardCheckInMenu');
                    const submenu = this.createCheckInSubmenu(habit);
                    // submenu may contain separators (type:'separator') or items
                    submenu.forEach((it: any) => {
                        if (it && it.type === 'separator') {
                            menu.addSeparator();
                        } else if (it) {
                            menu.addItem(it);
                        }
                    });

                    // 根据按钮位置打开菜单（向上偏移一些以避免覆盖）
                    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                    const menuX = rect.left;
                    const menuY = rect.top - 4;

                    const maxX = window.innerWidth - 200;
                    const maxY = window.innerHeight - 200;

                    menu.open({ x: Math.min(menuX, maxX), y: Math.max(0, Math.min(menuY, maxY)) });
                } catch (err) {
                    console.error('openCheckInMenu failed', err);
                    showMessage(i18n("openCheckInMenuFailed"), 2000, 'error');
                }
            });

            actionRow.appendChild(checkInBtn);
            footerRow.appendChild(leftWrap);
            footerRow.appendChild(actionRow);
            card.appendChild(footerRow);
        } catch (err) {
            console.warn('添加底部操作行失败', err);
        }

        // 右键菜单
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showHabitContextMenu(e, habit);
        });

        return card;
    }

    private getPriorityIcon(priority?: string): string {
        switch (priority) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            case 'low': return '🔵';
            default: return '';
        }
    }

    private getFrequencyText(frequency: Habit['frequency']): string {
        const { type, interval, weekdays, monthDays, months } = frequency;

        switch (type) {
            case 'daily':
                return interval ? i18n("freqEveryNDays", { n: String(interval) }) : i18n("freqEveryDay");
            case 'weekly':
                if (weekdays && weekdays.length > 0) {
                    const weekdayNamesArr = i18n("weekdayNames").split(',');
                    const days = weekdays.map(d => weekdayNamesArr[d] || String(d)).join(',');
                    return i18n("freqWeekdays", { days });
                }
                return interval ? i18n("freqEveryNWeeks", { n: String(interval) }) : i18n("freqEveryWeek");
            case 'monthly':
                if (monthDays && monthDays.length > 0) {
                    return i18n("freqMonthDays", { days: monthDays.join(',') });
                }
                return interval ? i18n("freqEveryNMonths", { n: String(interval) }) : i18n("freqEveryMonth");
            case 'yearly':
                if (months && months.length > 0) {
                    const monthStr = months.join(',');
                    if (monthDays && monthDays.length > 0) {
                        return i18n("freqYearMonthDays", { months: monthStr, days: monthDays.join(',') });
                    }
                    return i18n("freqYearMonths", { months: monthStr });
                }
                return interval ? i18n("freqEveryNYears", { n: String(interval) }) : i18n("freqEveryYear");
            case 'ebbinghaus':
                return i18n("ebbinghausRepeat");
            default:
                return i18n("freqEveryDay");
        }
    }



    private async renderCompletedHabitsSection(excludeIds?: Set<string>) {
        const today = getLogicalDateString();
        const habitData = await this.plugin.loadHabitData();
        const habits: Habit[] = Object.values(habitData || {});

        let completedHabits = habits.filter(h => this.isCompletedOnDate(h, today));

        // 排除已经在主区渲染的习惯，防止重复
        if (excludeIds && excludeIds.size > 0) {
            completedHabits = completedHabits.filter(h => !excludeIds.has(h.id));
        }

        // 如果没有已打卡习惯，移除已有的已打卡区并返回
        if (completedHabits.length === 0) {
            const existing = this.habitsContainer.querySelector('.habit-completed-section');
            if (existing) existing.remove();
            return;
        }

        // 移除已有的已打卡区（防止重复追加）
        const existingSection = this.habitsContainer.querySelector('.habit-completed-section');
        if (existingSection) {
            existingSection.remove();
        }

        const separator = document.createElement('div');
        separator.className = 'habit-completed-section';
        separator.style.cssText = `
            margin: 16px 0;
            border-top: 2px dashed var(--b3-theme-surface-lighter);
            padding-top: 16px;
        `;

        const completedTitle = document.createElement('div');
        completedTitle.textContent = `${i18n("todayCheckedSection")} (${completedHabits.length})`;
        completedTitle.style.cssText = `
            font-weight: bold;
            margin-bottom: 12px;
            color: var(--b3-theme-on-surface);
        `;

        separator.appendChild(completedTitle);

        const sortedCompleted = this.sortHabitsInGroup(completedHabits);
        sortedCompleted.forEach(habit => {
            const habitCard = this.createHabitCard(habit);
            habitCard.style.opacity = '0.7';
            separator.appendChild(habitCard);
        });

        this.habitsContainer.appendChild(separator);
    }

    // 显示拖拽位置指示（简单使用元素的 borderTop/bottom）
    private setDragOverIndicator(el: HTMLElement, pos: 'before' | 'after') {
        this.clearDragOver();
        this.dragOverTargetEl = el;
        this.dragOverPosition = pos;
        if (pos === 'before') {
            el.style.borderTop = '2px solid var(--b3-theme-primary)';
        } else {
            el.style.borderBottom = '2px solid var(--b3-theme-primary)';
        }
    }

    private clearDragOverOn(el: HTMLElement) {
        if (!el) return;
        el.style.borderTop = '';
        el.style.borderBottom = '';
        if (this.dragOverTargetEl === el) {
            this.dragOverTargetEl = null;
            this.dragOverPosition = null;
        }
    }

    private clearDragOver() {
        if (this.dragOverTargetEl) {
            this.dragOverTargetEl.style.borderTop = '';
            this.dragOverTargetEl.style.borderBottom = '';
            this.dragOverTargetEl = null;
        }
        this.dragOverPosition = null;
    }

    private async reorderHabits(groupId: string, targetPriority: Habit['priority'] | undefined, draggedId: string, targetId: string, position: 'before' | 'after') {
        const habitData = await this.plugin.loadHabitData();
        const draggedHabit = habitData[draggedId];
        const targetHabit = habitData[targetId];

        if (!draggedHabit || !targetHabit) {
            throw new Error('Habit not found');
        }

        const groupKey = groupId || 'none';
        const oldPriority = draggedHabit.priority || 'none';
        const newPriority = targetPriority || 'none';

        // 1. 如果优先级发生变化，更新被拖拽习惯的优先级
        if (oldPriority !== newPriority) {
            // 注意：界面显示的 'none' 对应数据可能是 'none' 或 undefined，这里统一处理
            draggedHabit.priority = newPriority as any;

            // 2. 整理旧优先级列表（移除被拖拽项并重新排序）
            const oldList = (Object.values(habitData) as Habit[]).filter(h =>
                ((h.groupId || 'none') === groupKey) &&
                ((h.priority || 'none') === oldPriority) &&
                h.id !== draggedId
            );

            // 排序旧列表
            oldList.sort((a, b) => {
                const sa = (a as any).sort || 0;
                const sb = (b as any).sort || 0;
                if (sa !== sb) return sa - sb;
                return (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
            });

            // 更新旧列表的 sort 值
            oldList.forEach((h, i) => {
                if (habitData[h.id]) habitData[h.id].sort = i + 1;
            });
        }

        // 3. 处理目标列表（插入到新位置）
        // 获取目标优先级的所有习惯（不包含拖拽项，以防同优先级情况）
        const targetList = (Object.values(habitData) as Habit[]).filter(h =>
            ((h.groupId || 'none') === groupKey) &&
            ((h.priority || 'none') === newPriority) &&
            h.id !== draggedId
        );

        // 排序目标列表
        targetList.sort((a, b) => {
            const sa = (a as any).sort || 0;
            const sb = (b as any).sort || 0;
            if (sa !== sb) return sa - sb;
            return (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
        });

        // 找到插入位置
        let targetIndex = targetList.findIndex(h => h.id === targetId);
        if (targetIndex === -1) {
            // 目标可能在过滤时被排除了？理论上不应该，除非数据不一致
            targetIndex = targetList.length;
        }

        const insertAt = position === 'before' ? targetIndex : targetIndex + 1;
        targetList.splice(Math.min(targetList.length, Math.max(0, insertAt)), 0, draggedHabit);

        // 更新目标列表的 sort 值
        targetList.forEach((h, i) => {
            if (habitData[h.id]) habitData[h.id].sort = i + 1;
        });

        await this.plugin.saveHabitData(habitData);
    }

    private showHabitContextMenu(event: MouseEvent, habit: Habit) {
        const menu = new Menu("habitContextMenu");

        // 打卡选项
        menu.addItem({
            label: i18n("checkInMenuItem"),
            icon: "iconCheck",
            submenu: this.createCheckInSubmenu(habit)
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: "🍅",
            label: i18n("startPomodoro") || "开始番茄钟",
            submenu: this.createPomodoroStartSubmenu(habit)
        });
        menu.addItem({
            iconHTML: "⏱️",
            label: i18n("startCountUp") || "开始正向计时",
            click: () => this.startPomodoroCountUp(habit)
        });
        menu.addItem({
            iconHTML: "📊",
            label: i18n("viewPomodoros") || "查看番茄钟",
            click: () => this.showPomodoroSessions(habit)
        });

        menu.addSeparator();

        // 查看统计
        menu.addItem({
            label: i18n("viewStatsMenuItem"),
            icon: "iconSparkles",
            click: () => {
                this.showHabitStats(habit);
            }
        });


        // 编辑习惯
        menu.addItem({
            label: i18n("editHabitMenuItem"),
            icon: "iconEdit",
            click: () => {
                this.showEditHabitDialog(habit);
            }
        });

        // 打开绑定块（如果存在）
        if (habit.blockId) {
            menu.addItem({
                label: i18n("openBoundBlock"),
                icon: "iconOpen",
                click: () => {
                    try {
                        openBlock(habit.blockId!);
                    } catch (err) {
                        console.error('openBlock failed', err);
                        showMessage(i18n("openBlockFailed"), 3000, 'error');
                    }
                }
            });
        }

        // 删除习惯
        menu.addItem({
            label: i18n("deleteHabitMenuItem"),
            icon: "iconTrashcan",
            click: () => {
                confirm(
                    i18n("confirmDeleteHabitTitle"),
                    i18n("confirmDeleteHabit", { title: habit.title }),
                    () => {
                        this.deleteHabit(habit.id);
                    }
                );
            }
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private createPomodoroStartSubmenu(habit: Habit): any[] {
        const goalType = this.getHabitGoalType(habit);
        const pomodoroGoalMinutes = goalType === 'pomodoro' ? this.getHabitPomodoroTargetMinutes(habit) : undefined;
        const sourceForMenu = pomodoroGoalMinutes
            ? { ...habit, estimatedPomodoroDuration: pomodoroGoalMinutes }
            : habit;
        return createSharedPomodoroStartSubmenu({
            source: sourceForMenu,
            plugin: this.plugin,
            startPomodoro: (workDurationOverride?: number) => this.startPomodoro(habit, workDurationOverride)
        });
    }

    private startPomodoro(habit: Habit, workDurationOverride?: number) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        if (this.pomodoroManager.hasActivePomodoroTimer()) {
            const currentState = this.pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = habit.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新任务："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                if (!this.pomodoroManager.pauseCurrentTimer()) {
                    console.error('暂停当前番茄钟失败');
                }
                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
            }

            confirm(
                "切换番茄钟任务",
                confirmMessage,
                () => {
                    this.performStartPomodoro(habit, currentState, workDurationOverride);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        if (!this.pomodoroManager.resumeCurrentTimer()) {
                            console.error('恢复番茄钟运行失败');
                        }
                    }
                }
            );
        } else {
            this.pomodoroManager.cleanupInactiveTimer();
            this.performStartPomodoro(habit, undefined, workDurationOverride);
        }
    }

    private async performStartPomodoro(habit: Habit, inheritState?: any, workDurationOverride?: number) {
        const settings = await this.plugin.getPomodoroSettings();
        const runtimeSettings = workDurationOverride && workDurationOverride > 0
            ? { ...settings, workDuration: workDurationOverride }
            : settings;

        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(habit, runtimeSettings, false, inheritState);

                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换任务并继承${phaseText}进度`, 2000);
                }
            }
        } else {
            this.pomodoroManager.closeCurrentTimer();

            const pomodoroTimer = new PomodoroTimer(habit, runtimeSettings, false, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);

            pomodoroTimer.show();

            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换任务并继承${phaseText}进度`, 2000);
            }
        }
    }

    private startPomodoroCountUp(habit: Habit) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        if (this.pomodoroManager.hasActivePomodoroTimer()) {
            const currentState = this.pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = habit.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                if (!this.pomodoroManager.pauseCurrentTimer()) {
                    console.error('暂停当前番茄钟失败');
                }
                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
            }

            confirm(
                "切换到正计时番茄钟",
                confirmMessage,
                () => {
                    this.performStartPomodoroCountUp(habit, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        if (!this.pomodoroManager.resumeCurrentTimer()) {
                            console.error('恢复番茄钟运行失败');
                        }
                    }
                }
            );
        } else {
            this.pomodoroManager.cleanupInactiveTimer();
            this.performStartPomodoroCountUp(habit);
        }
    }

    private async performStartPomodoroCountUp(habit: Habit, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(habit, settings, true, inheritState);

                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
                } else {
                    showMessage("已启动正计时番茄钟", 2000);
                }
            }
        } else {
            this.pomodoroManager.closeCurrentTimer();

            const pomodoroTimer = new PomodoroTimer(habit, settings, true, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);

            pomodoroTimer.show();

            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
            } else {
                showMessage("已启动正计时番茄钟", 2000);
            }
        }
    }

    private async showPomodoroSessions(habit: Habit) {
        const { PomodoroSessionsDialog } = await import("./PomodoroSessionsDialog");
        const dialog = new PomodoroSessionsDialog(habit.id, this.plugin);
        dialog.show();
    }

    private getHabitPomodoroStats(habitId: string): HabitPomodoroStats {
        const today = getLogicalDateString();

        let totalCount = 0;
        let totalFocusMinutes = 0;
        let todayCount = 0;
        let todayFocusMinutes = 0;

        try {
            totalCount = this.pomodoroRecordManager.getEventTotalPomodoroCount(habitId) || 0;
            totalFocusMinutes = this.pomodoroRecordManager.getEventTotalFocusTime(habitId) || 0;
            todayCount = this.pomodoroRecordManager.getEventPomodoroCount(habitId, today) || 0;
            todayFocusMinutes = this.pomodoroRecordManager.getEventFocusTime(habitId, today) || 0;
        } catch (error) {
            console.warn(`获取习惯 ${habitId} 的番茄统计失败:`, error);
        }

        return {
            totalCount,
            totalFocusMinutes,
            todayCount,
            todayFocusMinutes
        };
    }

    private formatPomodoroFocusTime(minutes: number): string {
        if (!minutes || minutes <= 0) return '0m';
        if (minutes < 60) return `${minutes}m`;

        const hours = Math.floor(minutes / 60);
        const remain = minutes % 60;
        return remain > 0 ? `${hours}h ${remain}m` : `${hours}h`;
    }

    private createCheckInSubmenu(habit: Habit): any[] {
        const submenu: any[] = [];

        const today = getLogicalDateString();
        const todayCheckIn = habit.checkIns?.[today];
        const checkedEmojisToday = new Set<string>();
        const emojiGroupMap = new Map<string, string>();
        const checkedGroupsToday = new Set<string>();

        if (todayCheckIn?.entries) {
            todayCheckIn.entries.forEach(entry => checkedEmojisToday.add(entry.emoji));
        } else if (todayCheckIn?.status) {
            todayCheckIn.status.forEach(emoji => checkedEmojisToday.add(emoji));
        }

        habit.checkInEmojis.forEach(emojiConfig => {
            const groupName = (emojiConfig.group || '').trim();
            if (groupName) {
                emojiGroupMap.set(emojiConfig.emoji, groupName);
            }
        });
        checkedEmojisToday.forEach(checkedEmoji => {
            const groupName = emojiGroupMap.get(checkedEmoji);
            if (groupName) checkedGroupsToday.add(groupName);
        });

        // 添加默认的打卡emoji选项
        habit.checkInEmojis.forEach(emojiConfig => {
            const groupName = (emojiConfig.group || '').trim();
            // 如果设置了隐藏今天已打卡选项：
            // 1. 当前 emoji 已打卡，隐藏
            // 2. 当前 emoji 所属分组中任意项已打卡，整组隐藏
            if (habit.hideCheckedToday && (checkedEmojisToday.has(emojiConfig.emoji) || (!!groupName && checkedGroupsToday.has(groupName)))) {
                return;
            }

            submenu.push({
                label: `${emojiConfig.emoji} ${emojiConfig.meaning}`,
                click: () => {
                    this.checkInHabit(habit, emojiConfig);
                }
            });
        });

        // 添加编辑emoji选项
        submenu.push({
            type: 'separator'
        });

        submenu.push({
            label: i18n("editCheckInOptions"),
            icon: "iconEdit",
            click: () => {
                this.showEditCheckInEmojis(habit);
            }
        });

        return submenu;
    }

    private async checkInHabit(
        habit: Habit,
        emojiConfig: HabitCheckInEmoji,
        options?: { skipPromptNote?: boolean; silent?: boolean }
    ) {
        try {
            const today = getLogicalDateString();
            const now = getLocalDateTimeString(new Date());

            if (!habit.checkIns) {
                habit.checkIns = {};
            }

            if (!habit.checkIns[today]) {
                habit.checkIns[today] = {
                    count: 0,
                    status: [],
                    timestamp: now,
                    entries: []
                };
            }

            const checkIn = habit.checkIns[today];
            // 询问备注（如果配置了 promptNote）
            let note: string | undefined = undefined;
            let customTimestamp: string = now; // 默认使用当前时间
            let cancelled = false; // 标记用户是否取消了打卡
            if (emojiConfig.promptNote && !options?.skipPromptNote) {
                // 弹窗输入备注和打卡时间 —— 使用标准 dialog footer（.b3-dialog__action）放置按钮以保证样式与位置正确
                let resolveFn: (() => void) | null = null;
                const promise = new Promise<void>((resolve) => { resolveFn = resolve; });

                // 格式化当前时间为 datetime-local 输入框所需的格式 (YYYY-MM-DDTHH:mm)
                const nowDate = new Date();
                const datetimeLocalValue = nowDate.getFullYear() + '-' +
                    String(nowDate.getMonth() + 1).padStart(2, '0') + '-' +
                    String(nowDate.getDate()).padStart(2, '0') + 'T' +
                    String(nowDate.getHours()).padStart(2, '0') + ':' +
                    String(nowDate.getMinutes()).padStart(2, '0');

                const inputDialog = new Dialog({
                    title: i18n("checkInInfo"),
                    content: `<div class="b3-dialog__content"><div class="ft__breakword" style="padding:12px">
                        <div style="margin-bottom:12px;">
                            <label style="display:block;margin-bottom:4px;font-weight:bold;">${i18n("checkInTimeLabel")}</label>
                            <input type="datetime-local" id="__habits_time_input" value="${datetimeLocalValue}" style="width:100%;padding:8px;box-sizing:border-box;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);" />
                        </div>
                        <div>
                            <label style="display:block;margin-bottom:4px;font-weight:bold;">${i18n("checkInNoteLabel")}</label>
                            <textarea id="__habits_note_input" placeholder="${i18n("checkInNotePlaceholder")}" style="width:100%;height:100px;box-sizing:border-box;resize:vertical;padding:8px;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);"></textarea>
                        </div>
                    </div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">${i18n("cancel")}</button><div class="fn__space"></div><button class="b3-button b3-button--text" id="__habits_note_confirm">${i18n("save")}</button></div>`,
                    width: '520px',
                    height: '360px',
                    destroyCallback: () => {
                        if (resolveFn) resolveFn();
                    }
                });

                const timeInputEl = inputDialog.element.querySelector('#__habits_time_input') as HTMLInputElement;
                const noteInputEl = inputDialog.element.querySelector('#__habits_note_input') as HTMLTextAreaElement;
                const cancelBtn = inputDialog.element.querySelector('.b3-button.b3-button--cancel') as HTMLButtonElement;
                const okBtn = inputDialog.element.querySelector('#__habits_note_confirm') as HTMLButtonElement;

                // 点击保存时取值
                okBtn.addEventListener('click', () => {
                    note = noteInputEl.value.trim();
                    // 将 datetime-local 的值转换为本地时间字符串 (YYYY-MM-DD HH:mm:ss)
                    const timeValue = timeInputEl.value;
                    if (timeValue) {
                        const selectedDate = new Date(timeValue);
                        customTimestamp = getLocalDateTimeString(selectedDate);
                    }
                    cancelled = false;
                    inputDialog.destroy();
                });
                // 点击取消时标记为取消
                cancelBtn.addEventListener('click', () => {
                    cancelled = true;
                    inputDialog.destroy();
                });

                // 按 ESC 键取消
                const escHandler = (e: KeyboardEvent) => {
                    if (e.key === 'Escape') {
                        cancelled = true;
                        inputDialog.destroy();
                    }
                };
                inputDialog.element.addEventListener('keydown', escHandler);

                // 等待用户点击保存或取消或直接关闭对话框
                await promise;

                // 如果用户取消了，直接返回，不保存打卡
                if (cancelled) {
                    return;
                }
            }

            // Append an entry for this check-in, using custom timestamp if provided
            checkIn.entries = checkIn.entries || [];
            checkIn.entries.push({ emoji: emojiConfig.emoji, timestamp: customTimestamp, note });
            // Keep status/count/timestamp fields in sync for backward compatibility
            checkIn.count = (checkIn.count || 0) + 1;
            checkIn.status = (checkIn.status || []).concat([emojiConfig.emoji]);
            checkIn.timestamp = customTimestamp;

            habit.totalCheckIns = (habit.totalCheckIns || 0) + 1;
            habit.updatedAt = now;

            await this.saveHabit(habit);
            if (!options?.silent) {
                showMessage(`${i18n("checkInSuccess")}${emojiConfig.emoji}` + (note ? ` - ${note}` : ''));
            }
            this.loadHabits();
        } catch (error) {
            console.error('checkIn failed:', error);
            showMessage(i18n("checkInFailed"), 3000, 'error');
        }
    }

    private cloneHabit(habit: Habit | null | undefined): Habit | undefined {
        if (!habit) return undefined;
        try {
            return JSON.parse(JSON.stringify(habit));
        } catch {
            return { ...habit };
        }
    }

    private async saveHabit(habit: Habit, oldHabit?: Habit) {
        const habitData = await this.plugin.loadHabitData();
        const previousHabit = this.cloneHabit(oldHabit) || this.cloneHabit(habitData[habit.id]);

        // 如果编辑场景中发生了 ID 变更，清理旧 ID 的数据和通知，避免残留
        if (previousHabit?.id && previousHabit.id !== habit.id) {
            delete habitData[previousHabit.id];
            try {
                if (this.plugin && typeof this.plugin.cancelMobileNotification === 'function') {
                    await this.plugin.cancelMobileNotification(previousHabit.id);
                }
            } catch (e) {
                console.warn('清理旧习惯ID的移动端通知失败:', e);
            }
        }

        habitData[habit.id] = habit;
        await this.plugin.saveHabitData(habitData);
        // 同步更新移动端系统通知（限制7天）
        try {
            if (this.plugin && typeof this.plugin.updateMobileNotification === 'function') {
                await this.plugin.updateMobileNotification(habit, previousHabit, 7);
            }
        } catch (e) {
            console.warn('更新习惯移动端通知失败:', e);
        }

        window.dispatchEvent(new CustomEvent('habitUpdated'));
        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'habitPanel' } }));
    }

    private async deleteHabit(habitId: string) {
        try {
            const habitData = await this.plugin.loadHabitData();
            // 先取消移动端通知，避免删除后极端情况下的通知残留
            try {
                if (this.plugin && typeof this.plugin.cancelMobileNotification === 'function') {
                    await this.plugin.cancelMobileNotification(habitId);
                }
            } catch (e) {
                console.warn('取消习惯移动端通知失败:', e);
            }

            delete habitData[habitId];
            await this.plugin.saveHabitData(habitData);
            try {
                if (this.plugin && typeof this.plugin.removeData === 'function') {
                    await this.plugin.removeData(`habitCheckin/${habitId}.json`);
                }
            } catch (e) {
                console.warn('删除习惯打卡文件失败:', e);
            }
            showMessage(i18n("deleteSuccess"));
            this.loadHabits();

            window.dispatchEvent(new CustomEvent('habitUpdated'));
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'habitPanel' } }));
        } catch (error) {
            console.error('deleteHabit failed:', error);
            showMessage(i18n("deleteFailed"), 3000, 'error');
        }
    }

    private async handleHabitPomodoroCompleted(event: Event) {
        try {
            const customEvent = event as CustomEvent<{ habitId?: string; autoCheckInEmoji?: string }>;
            const habitId = customEvent?.detail?.habitId;
            if (!habitId) return;

            const habitData = await this.plugin.loadHabitData();
            const habit = habitData?.[habitId] as Habit | undefined;
            if (!habit || !habit.autoCheckInAfterPomodoro) return;

            const configuredEmoji = customEvent?.detail?.autoCheckInEmoji || habit.autoCheckInEmoji;
            let targetEmoji = habit.checkInEmojis?.find(item => item.emoji === configuredEmoji);
            if (!targetEmoji) {
                targetEmoji = habit.checkInEmojis?.[0];
            }
            if (!targetEmoji) {
                console.warn('自动打卡失败：未找到可用打卡项', habitId);
                return;
            }

            await this.checkInHabit(habit, targetEmoji, { skipPromptNote: true, silent: true });
            showMessage(`番茄完成，已自动打卡 ${targetEmoji.emoji}`, 2500);
        } catch (error) {
            console.error('处理番茄完成自动打卡失败:', error);
        }
    }

    private showNewHabitDialog() {
        const dialog = new HabitEditDialog(null, async (habit) => {
            await this.saveHabit(habit);
            this.loadHabits();
        }, this.plugin);
        dialog.show();
    }

    private showEditHabitDialog(habit: Habit) {
        const oldHabitSnapshot = this.cloneHabit(habit);
        const dialog = new HabitEditDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit, oldHabitSnapshot);
            this.loadHabits();
        }, this.plugin);
        dialog.show();
    }

    private openHabitCalendarView() {
        if (this.plugin && typeof this.plugin.openCalendarTab === 'function') {
            this.plugin.openCalendarTab({ showHabitsOnly: true });
            return;
        }
        showMessage(i18n("operationFailed") || "操作失败", 3000, 'error');
    }

    private openHabitStatsCalendarDialog() {
        try {
            const dialog = new HabitCalendarDialog(this.plugin);
            dialog.show();
        } catch (error) {
            console.error('打开习惯统计日历失败:', error);
            showMessage(i18n("operationFailed") || "操作失败", 3000, 'error');
        }
    }

    private showHabitStats(habit: Habit) {
        const dialog = new HabitStatsDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit);
            this.loadHabits();
        });
        dialog.show();
    }



    private showGroupManageDialog() {
        const dialog = new HabitGroupManageDialog(() => {
            this.updateGroupFilterButtonText();
            this.loadHabits();
        });
        dialog.show();
    }

    private showGroupSelectDialog() {
        const dialog = new Dialog({
            title: i18n("selectGroup"),
            content: '<div id="groupSelectContainer"></div>',
            width: "400px",
            height: "500px"
        });

        const container = dialog.element.querySelector('#groupSelectContainer') as HTMLElement;
        if (!container) return;

        container.style.cssText = 'padding: 16px;';

        // 全部分组选项
        const allOption = this.createGroupCheckbox('all', i18n("allGroups"), this.selectedGroups.includes('all'));
        container.appendChild(allOption);

        // 无分组选项
        const noneOption = this.createGroupCheckbox('none', i18n("noneGroupName"), this.selectedGroups.includes('none'));
        container.appendChild(noneOption);

        // 其他分组
        const groups = this.groupManager.getAllGroups();
        groups.forEach(group => {
            const option = this.createGroupCheckbox(group.id, group.name, this.selectedGroups.includes(group.id));
            container.appendChild(option);
        });

        // 确认按钮
        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'b3-button b3-button--primary';
        confirmBtn.textContent = i18n("save");
        confirmBtn.style.cssText = 'margin-top: 16px; width: 100%;';
        confirmBtn.addEventListener('click', () => {
            this.updateGroupFilterButtonText();
            this.savePanelSettings();
            this.loadHabits();
            dialog.destroy();
        });
        container.appendChild(confirmBtn);
    }

    private createGroupCheckbox(id: string, name: string, checked: boolean): HTMLElement {
        const label = document.createElement('label');
        label.style.cssText = 'display: flex; align-items: center; padding: 8px; cursor: pointer;';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.style.cssText = 'margin-right: 8px;';

        checkbox.addEventListener('change', () => {
            if (id === 'all') {
                if (checkbox.checked) {
                    this.selectedGroups = ['all'];
                } else {
                    this.selectedGroups = [];
                }
            } else {
                if (checkbox.checked) {
                    this.selectedGroups = this.selectedGroups.filter(g => g !== 'all');
                    if (!this.selectedGroups.includes(id)) {
                        this.selectedGroups.push(id);
                    }
                } else {
                    this.selectedGroups = this.selectedGroups.filter(g => g !== id);
                }
            }
        });

        const text = document.createElement('span');
        text.textContent = name;

        label.appendChild(checkbox);
        label.appendChild(text);

        return label;
    }

    private showEditCheckInEmojis(habit: Habit) {
        const dialog = new HabitCheckInEmojiDialog(habit, async (emojis) => {
            // 更新习惯的打卡emoji配置
            habit.checkInEmojis = emojis;
            habit.updatedAt = getLocalDateTimeString(new Date());

            // 保存到数据库
            await this.saveHabit(habit);

            // 刷新显示
            this.loadHabits();
        });
        dialog.show();
    }
}
