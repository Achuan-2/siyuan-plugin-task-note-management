import { showMessage, Dialog, Menu, confirm } from "siyuan";
import { readHabitData, writeHabitData, getBlockByID, getBlockDOM, openBlock } from "../api";
import { getLocalDateTimeString, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { HabitGroupManager } from "../utils/habitGroupManager";
import { HabitCalendarDialog } from "./HabitCalendarDialog";
import { t } from "../utils/i18n";
import { HabitEditDialog } from "./HabitEditDialog";
import { HabitStatsDialog } from "./HabitStatsDialog";
import { HabitGroupManageDialog } from "./HabitGroupManageDialog";
import { HabitCheckInEmojiDialog } from "./HabitCheckInEmojiDialog";

export interface HabitCheckInEmoji {
    emoji: string;
    meaning: string;
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
    frequency: {
        type: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
        interval?: number; // 重复间隔，比如每x天
        weekdays?: number[]; // 重复星期 (0-6, 0=周日)
        monthDays?: number[]; // 重复日期 (1-31)
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
    private collapsedGroups: Set<string> = new Set();
    // 拖拽状态
    private draggingHabitId: string | null = null;
    private dragOverTargetEl: HTMLElement | null = null;
    private dragOverPosition: 'before' | 'after' | null = null;

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.groupManager = HabitGroupManager.getInstance();

        this.habitUpdatedHandler = () => {
            this.loadHabits();
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.groupManager.initialize();
        await this.loadCollapseStates();

        this.initUI();
        this.updateSortButtonTitle();
        this.loadHabits();

        window.addEventListener('habitUpdated', this.habitUpdatedHandler);
    }

    public destroy() {
        this.saveCollapseStates();
        if (this.habitUpdatedHandler) {
            window.removeEventListener('habitUpdated', this.habitUpdatedHandler);
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
        titleSpan.textContent = "习惯打卡";

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'habit-panel__actions';
        actionContainer.style.cssText = 'display:flex; justify-content:flex-start; gap:8px; margin-bottom:8px;';

        // 新建习惯按钮
        const newHabitBtn = document.createElement('button');
        newHabitBtn.className = 'b3-button b3-button--outline';
        newHabitBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        newHabitBtn.title = "新建习惯";
        newHabitBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNewHabitDialog();
        });
        actionContainer.appendChild(newHabitBtn);

        // 打卡日历按钮
        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'b3-button b3-button--outline';
        calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
        calendarBtn.title = "打卡日历";
        calendarBtn.addEventListener('click', () => {
            this.showCalendarView();
        });
        actionContainer.appendChild(calendarBtn);

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.title = "排序";
        this.sortButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSortMenu(e);
        });
        actionContainer.appendChild(this.sortButton);

        // 分组管理按钮
        const groupManageBtn = document.createElement('button');
        groupManageBtn.className = 'b3-button b3-button--outline';
        groupManageBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg>';
        groupManageBtn.title = "分组管理";
        groupManageBtn.addEventListener('click', () => {
            this.showGroupManageDialog();
        });
        actionContainer.appendChild(groupManageBtn);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = "刷新";
        refreshBtn.addEventListener('click', () => {
            this.loadHabits();
        });
        actionContainer.appendChild(refreshBtn);

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
            <option value="today" selected>今日待打卡</option>
            <option value="tomorrow">明日习惯</option>
            <option value="all">所有习惯</option>
            <option value="todayCompleted">今日已打卡</option>
            <option value="yesterdayCompleted">昨日已打卡</option>
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
        this.groupFilterButton.textContent = "分组筛选";
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
            this.groupFilterButton.textContent = "分组筛选";
        } else {
            const names = this.selectedGroups.map(id => {
                if (id === 'none') return "无分组";
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
                { key: 'priority', label: t('sortByPriority') || '按优先级排序', icon: '🎯' },
                { key: 'title', label: t('sortByTitle') || '按标题排序', icon: '📝' }
            ];

            sortOptions.forEach(option => {
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t('ascending') || '升序'})`,
                    current: this.sortKey === option.key && this.sortOrder === 'asc',
                    click: () => {
                        this.setSort(option.key as any, 'asc');
                    }
                });

                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t('descending') || '降序'})`,
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

    private setSort(key: 'priority' | 'title', order: 'asc' | 'desc') {
        this.sortKey = key;
        this.sortOrder = order;
        this.updateSortButtonTitle();
        this.loadHabits();
    }

    private updateSortButtonTitle() {
        const sortLabels = {
            'priority_desc': '最高优先',
            'priority_asc': '最低优先',
            'title_asc': '标题 A-Z',
            'title_desc': '标题 Z-A'
        };
        const key = `${this.sortKey}_${this.sortOrder}`;
        this.sortButton.title = `排序: ${sortLabels[key] || '默认'}`;
    }

    private async loadHabits() {
        try {
            // 保存滚动位置
            const scrollTop = this.habitsContainer?.scrollTop || 0;

            const habitData = await readHabitData();
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
            console.error('加载习惯失败:', error);
            this.habitsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-error);">加载习惯失败</div>';
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
                if (frequency.interval) {
                    const yearsDiff = checkDate.getFullYear() - startDate.getFullYear();
                    return yearsDiff % frequency.interval === 0 &&
                        checkDate.getMonth() === startDate.getMonth() &&
                        checkDate.getDate() === startDate.getDate();
                }
                return checkDate.getMonth() === startDate.getMonth() &&
                    checkDate.getDate() === startDate.getDate();

            case 'custom':
                // 自定义频率：如果设置了周重复则按周判断，如果设置了月重复则按月判断；默认返回true
                if (frequency.weekdays && frequency.weekdays.length > 0) {
                    return frequency.weekdays.includes(checkDate.getDay());
                }
                if (frequency.monthDays && frequency.monthDays.length > 0) {
                    return frequency.monthDays.includes(checkDate.getDate());
                }
                return true;

            default:
                return true;
        }
    }

    private isCompletedOnDate(habit: Habit, date: string): boolean {
        const checkIn = habit.checkIns?.[date];
        if (!checkIn) return false;

        // 获取当天所有打卡的emoji
        const emojis: string[] = [];
        if (checkIn.entries && checkIn.entries.length > 0) {
            // 使用新格式的entries
            checkIn.entries.forEach(entry => {
                if (entry.emoji) emojis.push(entry.emoji);
            });
        } else if (checkIn.status && checkIn.status.length > 0) {
            // 使用旧格式的status
            emojis.push(...checkIn.status);
        }

        const target = habit.target || 1;
        const totalCount = emojis.length;

        // 只要打卡次数达标，就算已完成（不管是成功还是失败）
        return totalCount >= target;
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
                this.habitsContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--b3-theme-on-surface-light);">暂无习惯</div>';
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
        const groupName = group ? group.name : '无分组';
        const isCollapsed = this.collapsedGroups.has(groupId);

        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = isCollapsed ? '▶' : '▼';
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

                // 启用拖拽：仅在同一分组内按优先级排序时可拖拽调整
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
                        showMessage("排序已更新");
                    } catch (err) {
                        console.error('调整顺序失败:', err);
                        showMessage('调整顺序失败', 3000, 'error');
                    }
                    this.draggingHabitId = null;
                    this.clearDragOver();
                });

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
                    console.error('打开块失败:', err);
                    showMessage('打开块失败', 3000, 'error');
                }
            });
        }
        titleRow.appendChild(title);

        // 绑定块的图标已移除，点击和 data-href 在标题 `span` 上处理。

        card.appendChild(titleRow);

        // 打卡信息
        const today = getLogicalDateString();
        const checkIn = habit.checkIns?.[today];
        const currentCount = checkIn?.count || 0;
        const targetCount = habit.target;

        const progressRow = document.createElement('div');
        progressRow.style.cssText = 'margin-bottom: 8px;';

        if (targetCount > 1) {
            // 显示进度条
            const progressText = document.createElement('div');
            progressText.textContent = `今日进度: ${currentCount}/${targetCount}`;
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
            const percentage = Math.min(100, (currentCount / targetCount) * 100);
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
            progressText.textContent = `今日: ${currentCount >= targetCount ? '已完成' : '未完成'}`;
            progressText.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light);';
            progressRow.appendChild(progressText);
        }

        card.appendChild(progressRow);

        // 频率信息
        const frequencyText = this.getFrequencyText(habit.frequency);
        const frequency = document.createElement('div');
        frequency.textContent = `频率: ${frequencyText}`;
        frequency.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
        card.appendChild(frequency);

        // 时间范围
        const timeRange = document.createElement('div');
        timeRange.textContent = `时间: ${habit.startDate}${habit.endDate ? ' ~ ' + habit.endDate : ' 起'}`;
        timeRange.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
        card.appendChild(timeRange);

        // 提醒时间（支持多个）
        const timesList = Array.isArray(habit.reminderTimes) && habit.reminderTimes.length > 0 ? habit.reminderTimes : (habit.reminderTime ? [habit.reminderTime] : []);
        if (timesList && timesList.length > 0) {
            const reminder = document.createElement('div');
            // 提取时间字符串，如果是对象则取 time 属性
            const displayTimes = timesList.map(t => typeof t === 'string' ? t : t.time);
            reminder.textContent = `提醒: ${displayTimes.join(', ')}`;
            reminder.style.cssText = 'font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;';
            card.appendChild(reminder);
        }

        // 坚持打卡天数（显示打卡天数，替换累计打卡次数）
        const checkInDaysCount = Object.keys(habit.checkIns || {}).length;
        const checkInDaysEl = document.createElement('div');
        checkInDaysEl.textContent = `坚持打卡: ${checkInDaysCount} 天`;
        checkInDaysEl.style.cssText = 'font-size: 12px; color: var(--b3-theme-primary); font-weight: bold;';

        // 今日打卡 emoji（只显示当天的）
        if (checkIn && ((checkIn.entries && checkIn.entries.length > 0) || (checkIn.status && checkIn.status.length > 0))) {
            const emojiRow = document.createElement('div');
            emojiRow.style.cssText = 'margin-top:8px; display:flex; gap:6px; align-items:center;';


            const emojiLabel = document.createElement('span');
            emojiLabel.textContent = '今日打卡:';
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
            checkInBtn.innerHTML = '打卡';

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
                    console.error('打开卡片打卡菜单失败', err);
                    showMessage('打开打卡菜单失败', 2000, 'error');
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
            case 'low': return '🟢';
            default: return '';
        }
    }

    private getFrequencyText(frequency: Habit['frequency']): string {
        const { type, interval, weekdays, monthDays } = frequency;

        switch (type) {
            case 'daily':
                return interval ? `每${interval}天` : '每天';
            case 'weekly':
                if (weekdays && weekdays.length > 0) {
                    const days = weekdays.map(d => ['日', '一', '二', '三', '四', '五', '六'][d]).join(',');
                    return `每周${days}`;
                }
                return interval ? `每${interval}周` : '每周';
            case 'monthly':
                if (monthDays && monthDays.length > 0) {
                    return `每月${monthDays.join(',')}日`;
                }
                return interval ? `每${interval}月` : '每月';
            case 'yearly':
                return interval ? `每${interval}年` : '每年';
            case 'custom':
                return '自定义';
            default:
                return '每天';
        }
    }

    private async getBlockPreview(blockId: string): Promise<string> {
        try {
            const block = await getBlockByID(blockId);
            if (!block) return '块不存在';
            if (block.type === 'd') {
                return block.content || '';
            }
            try {
                const domString = await getBlockDOM(blockId);
                const parser = new DOMParser();
                const dom = parser.parseFromString(domString.dom, 'text/html');
                const element = dom.querySelector('div[data-type="NodeParagraph"]');
                if (element) {
                    const attrElement = element.querySelector('div.protyle-attr');
                    if (attrElement) attrElement.remove();
                }
                const snippet = element ? (element.textContent || '') : (block.fcontent || block.content || '');
                return (snippet || '').trim().slice(0, 300);
            } catch (err) {
                return (block.fcontent || block.content || '').slice(0, 300);
            }
        } catch (error) {
            console.error('获取块预览失败', error);
            return '获取块信息失败';
        }
    }

    private async renderCompletedHabitsSection(excludeIds?: Set<string>) {
        const today = getLogicalDateString();
        const habitData = await readHabitData();
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
        completedTitle.textContent = `今日已打卡 (${completedHabits.length})`;
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
        const habitData = await readHabitData();
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

        await writeHabitData(habitData);
    }

    private showHabitContextMenu(event: MouseEvent, habit: Habit) {
        const menu = new Menu("habitContextMenu");

        // 打卡选项
        menu.addItem({
            label: "打卡",
            icon: "iconCheck",
            submenu: this.createCheckInSubmenu(habit)
        });

        menu.addSeparator();

        // 查看统计
        menu.addItem({
            label: "查看统计",
            icon: "iconSparkles",
            click: () => {
                this.showHabitStats(habit);
            }
        });


        // 编辑习惯
        menu.addItem({
            label: "编辑习惯",
            icon: "iconEdit",
            click: () => {
                this.showEditHabitDialog(habit);
            }
        });

        // 打开绑定块（如果存在）
        if (habit.blockId) {
            menu.addItem({
                label: "打开绑定块",
                icon: "iconOpen",
                click: () => {
                    try {
                        openBlock(habit.blockId!);
                    } catch (err) {
                        console.error('打开块失败', err);
                        showMessage('打开块失败', 3000, 'error');
                    }
                }
            });
        }

        // 删除习惯
        menu.addItem({
            label: "删除习惯",
            icon: "iconTrashcan",
            click: () => {
                confirm(
                    "确认删除",
                    `确定要删除习惯"${habit.title}"吗？`,
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

    private createCheckInSubmenu(habit: Habit): any[] {
        const submenu: any[] = [];

        const today = getLogicalDateString();
        const todayCheckIn = habit.checkIns?.[today];
        const checkedEmojisToday = new Set<string>();

        if (todayCheckIn?.entries) {
            todayCheckIn.entries.forEach(entry => checkedEmojisToday.add(entry.emoji));
        } else if (todayCheckIn?.status) {
            todayCheckIn.status.forEach(emoji => checkedEmojisToday.add(emoji));
        }

        // 添加默认的打卡emoji选项
        habit.checkInEmojis.forEach(emojiConfig => {
            // 如果设置了隐藏今天已打卡的选项，且该选项今天已打卡，则跳过
            if (habit.hideCheckedToday && checkedEmojisToday.has(emojiConfig.emoji)) {
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
            label: "编辑打卡选项",
            icon: "iconEdit",
            click: () => {
                this.showEditCheckInEmojis(habit);
            }
        });

        return submenu;
    }

    private async checkInHabit(habit: Habit, emojiConfig: HabitCheckInEmoji) {
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
            if (emojiConfig.promptNote) {
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
                    title: '打卡信息',
                    content: `<div class="b3-dialog__content"><div class="ft__breakword" style="padding:12px">
                        <div style="margin-bottom:12px;">
                            <label style="display:block;margin-bottom:4px;font-weight:bold;">打卡时间:</label>
                            <input type="datetime-local" id="__habits_time_input" value="${datetimeLocalValue}" style="width:100%;padding:8px;box-sizing:border-box;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);" />
                        </div>
                        <div>
                            <label style="display:block;margin-bottom:4px;font-weight:bold;">备注:</label>
                            <textarea id="__habits_note_input" placeholder="可选,输入备注信息..." style="width:100%;height:100px;box-sizing:border-box;resize:vertical;padding:8px;border:1px solid var(--b3-theme-surface-lighter);border-radius:4px;background:var(--b3-theme-background);"></textarea>
                        </div>
                    </div></div><div class="b3-dialog__action"><button class="b3-button b3-button--cancel">取消</button><div class="fn__space"></div><button class="b3-button b3-button--text" id="__habits_note_confirm">保存</button></div>`,
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
            showMessage(`打卡成功！${emojiConfig.emoji}` + (note ? ` - ${note}` : ''));
            this.loadHabits();
        } catch (error) {
            console.error('打卡失败:', error);
            showMessage('打卡失败', 3000, 'error');
        }
    }

    private async saveHabit(habit: Habit) {
        const habitData = await readHabitData();
        habitData[habit.id] = habit;
        await writeHabitData(habitData);
        window.dispatchEvent(new CustomEvent('habitUpdated'));
    }

    private async deleteHabit(habitId: string) {
        try {
            const habitData = await readHabitData();
            delete habitData[habitId];
            await writeHabitData(habitData);
            showMessage('删除成功');
            this.loadHabits();
            window.dispatchEvent(new CustomEvent('habitUpdated'));
        } catch (error) {
            console.error('删除习惯失败:', error);
            showMessage('删除失败', 3000, 'error');
        }
    }

    private showNewHabitDialog() {
        const dialog = new HabitEditDialog(null, async (habit) => {
            await this.saveHabit(habit);
            this.loadHabits();
        });
        dialog.show();
    }

    private showEditHabitDialog(habit: Habit) {
        const dialog = new HabitEditDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit);
            this.loadHabits();
        });
        dialog.show();
    }

    private showCalendarView() {
        const dialog = new HabitCalendarDialog(this.plugin);
        dialog.show();
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
            title: "选择分组",
            content: '<div id="groupSelectContainer"></div>',
            width: "400px",
            height: "500px"
        });

        const container = dialog.element.querySelector('#groupSelectContainer') as HTMLElement;
        if (!container) return;

        container.style.cssText = 'padding: 16px;';

        // 全部分组选项
        const allOption = this.createGroupCheckbox('all', '全部分组', this.selectedGroups.includes('all'));
        container.appendChild(allOption);

        // 无分组选项
        const noneOption = this.createGroupCheckbox('none', '无分组', this.selectedGroups.includes('none'));
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
        confirmBtn.textContent = '确定';
        confirmBtn.style.cssText = 'margin-top: 16px; width: 100%;';
        confirmBtn.addEventListener('click', () => {
            this.updateGroupFilterButtonText();
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
