import { showMessage, Dialog, Menu, confirm, getBackend, getFrontend } from "siyuan";
import { openBlock, pushMsg } from "../api";
import { getLocalDateTimeString, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { HabitGroupManager } from "../utils/habitGroupManager";
import { i18n } from "../pluginInstance";
import { HabitEditDialog } from "./HabitEditDialog";
import { HabitStatsDialog } from "./stats/HabitStatsDialog";
import { HabitGroupManageDialog } from "./HabitGroupManageDialog";
import { HabitCheckInEmojiDialog } from "./HabitCheckInEmojiDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { createPomodoroStartSubmenu as createSharedPomodoroStartSubmenu, resolveDefaultPomodoroDuration } from "../utils/pomodoroPresets";
import { showStatsDialog } from "./stats/ShowStatsDialog";
import { HabitDayDialog } from "./HabitDayDialog";
import {
    buildLinkedHabitPomodoroData,
    getLinkedTaskIdsForHabit as getLinkedTaskIdsForHabitUtil,
    getLinkedTaskPomodoroStatsByDate as getLinkedTaskPomodoroStatsByDateUtil,
    getLinkedTaskPomodoroTotalStats as getLinkedTaskPomodoroTotalStatsUtil,
    type LinkedTaskPomodoroDayStats
} from "../utils/linkedHabitPomodoro";
import {
    Habit,
    HabitEmojiConfig as HabitCheckInEmoji,
    getHabitGoalType as getHabitGoalTypeUtil,
    getHabitPomodoroTargetMinutes as getHabitPomodoroTargetMinutesUtil,
    getHabitProgressOnDate as getHabitProgressOnDateUtil,
    formatHabitReminderTimeDisplay,
    getHabitReminderTimesForDate,
    getTodayHabitBuckets,
    isHabitActiveOnDate,
    isHabitCompletedOnDate as isHabitCompletedOnDateUtil,
    shouldCheckInOnDate
} from "../utils/habitUtils";

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
    private showCompletedHabitsInTodayPending: boolean = true;
    private groupManager: HabitGroupManager;
    private habitUpdatedHandler: () => void;
    private reminderUpdatedHandler: () => void;
    private collapsedGroups: Set<string> = new Set();
    // 拖拽状态
    private draggingHabitId: string | null = null;
    private dragOverTargetEl: HTMLElement | null = null;
    private dragOverPosition: 'before' | 'after' | null = null;
    private pomodoroManager: PomodoroManager = PomodoroManager.getInstance();
    private pomodoroRecordManager: PomodoroRecordManager;
    private linkedTaskPomodoroStats: Map<string, Map<string, LinkedTaskPomodoroDayStats>> = new Map();
    private linkedTaskIdsByHabit: Map<string, Set<string>> = new Map();

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.groupManager = HabitGroupManager.getInstance();
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin);

        this.habitUpdatedHandler = () => {
            this.loadHabits();
        };
        this.reminderUpdatedHandler = () => {
            this.loadHabits();
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.groupManager.initialize();
        await this.pomodoroRecordManager.initialize();
        await this.loadCollapseStates();
        await this.restorePanelSettings();

        this.initUI();
        this.loadHabits();

        window.addEventListener('habitUpdated', this.habitUpdatedHandler);
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
    }

    public destroy() {
        this.saveCollapseStates();
        if (this.habitUpdatedHandler) {
            window.removeEventListener('habitUpdated', this.habitUpdatedHandler);
        }
        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
        this.pomodoroManager.cleanupInactiveTimer();
    }

    private async restorePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            if (Array.isArray(settings.habitPanelSelectedGroups)) {
                this.selectedGroups = settings.habitPanelSelectedGroups;
            }
            if (typeof settings.habitPanelShowCompletedInTodayPending === 'boolean') {
                this.showCompletedHabitsInTodayPending = settings.habitPanelShowCompletedInTodayPending;
            }
        } catch (error) {
            console.error('恢复习惯面板设置失败:', error);
        }
    }

    private async savePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            settings.habitPanelSelectedGroups = this.selectedGroups;
            settings.habitPanelShowCompletedInTodayPending = this.showCompletedHabitsInTodayPending;
            await this.plugin.saveSettings(settings);
        } catch (error) {
            console.error('保存习惯面板设置失败:', error);
        }
    }

    private async loadCollapseStates() {
        try {
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
        newHabitBtn.classList.add('ariaLabel'); newHabitBtn.setAttribute('aria-label', i18n("newHabit"));
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
        calendarBtn.classList.add('ariaLabel'); calendarBtn.setAttribute('aria-label', i18n("habitCalendar"));
        calendarBtn.addEventListener('click', () => {
            this.openHabitCalendarView();
        });
        actionContainer.appendChild(calendarBtn);

        // 统计按钮（统一统计视图）
        const habitStatsCalendarBtn = document.createElement('button');
        habitStatsCalendarBtn.className = 'b3-button b3-button--outline';
        habitStatsCalendarBtn.textContent = '📊';
        habitStatsCalendarBtn.classList.add('ariaLabel'); habitStatsCalendarBtn.setAttribute('aria-label', i18n("statsView"));
        habitStatsCalendarBtn.addEventListener('click', () => {
            this.showPomodoroStatsView();
        });
        actionContainer.appendChild(habitStatsCalendarBtn);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.classList.add('ariaLabel'); refreshBtn.setAttribute('aria-label', i18n("refresh"));
        refreshBtn.addEventListener('click', async () => {
            const svgIcon = refreshBtn.querySelector('svg');
            svgIcon?.classList.add('fn__rotate');
            try {
                await this.loadHabits();
                pushMsg(i18n("refreshSuccess"));
            } finally {
                svgIcon?.classList.remove('fn__rotate');
            }
        });
        actionContainer.appendChild(refreshBtn);

        // 更多按钮（显示插件设置）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.classList.add('ariaLabel'); moreBtn.setAttribute('aria-label', i18n("more"));
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
            <option value="todayCompleted">${i18n("filterTodayCompleted")}</option>
            <option value="yesterdayCompleted">${i18n("filterYesterdayCompleted")}</option>
            <option value="tomorrow">${i18n("filterTomorrow")}</option>
            <option value="all">${i18n("filterAll")}</option>
            <option value="ended">${i18n("filterEnded") || "已结束"}</option>
            <option value="abandoned">${i18n("filterAbandoned") || "已放弃"}</option>
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

            // 显示设置
            menu.addItem({
                icon: 'iconEye',
                label: i18n("displaySettings") || "显示设置",
                submenu: [
                    {
                        icon: this.showCompletedHabitsInTodayPending ? 'iconSelect' : '',
                        label: i18n("showTodayPendingCompletedHabits") || "今日待打卡显示已完成习惯",
                        click: () => {
                            this.showCompletedHabitsInTodayPending = !this.showCompletedHabitsInTodayPending;
                            void this.savePanelSettings();
                            void this.loadHabits();
                        }
                    }
                ]
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

    private async loadHabits() {
        try {
            // 保存滚动位置
            const scrollTop = this.habitsContainer?.scrollTop || 0;

            try {
                await this.pomodoroRecordManager.refreshData();
            } catch (error) {
                console.warn('刷新番茄钟数据失败:', error);
            }

            const [habitData, reminderData] = await Promise.all([
                this.plugin.loadHabitData(),
                this.plugin.loadReminderData()
            ]);

            await this.syncTaskCompletionAutoCheckIns(habitData || {}, reminderData || {});
            this.rebuildLinkedTaskPomodoroStats(reminderData || {});

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

    private getCompletedDateFromReminder(reminder: any): string {
        const completedTime = typeof reminder?.completedTime === 'string' ? reminder.completedTime.trim() : '';
        if (/^\d{4}-\d{2}-\d{2}/.test(completedTime)) {
            return completedTime.substring(0, 10);
        }

        if (completedTime) {
            const parsed = new Date(completedTime.replace(' ', 'T'));
            if (!Number.isNaN(parsed.getTime())) {
                return getLogicalDateString(parsed);
            }
        }

        return getLogicalDateString();
    }

    private buildHabitCheckInOptionKey(option: any): string {
        const emoji = option?.emoji || '';
        const meaning = option?.meaning || '';
        const group = (option?.group || '').trim();
        return `${emoji}\u001f${meaning}\u001f${group}`;
    }

    private resolveTaskAutoCheckInOption(habit: Habit, reminder: any): HabitCheckInEmoji | undefined {
        const emojiList = habit.checkInEmojis || [];
        if (emojiList.length === 0) return undefined;

        const preferredKey = reminder?.linkedHabitAutoCheckInOptionKey;
        if (preferredKey) {
            const matchedByKey = emojiList.find(item => this.buildHabitCheckInOptionKey(item) === preferredKey);
            if (matchedByKey) return matchedByKey as HabitCheckInEmoji;
        }

        const preferredEmoji = reminder?.linkedHabitAutoCheckInEmoji;
        if (preferredEmoji) {
            const matchedByEmoji = emojiList.find(item => item.emoji === preferredEmoji);
            if (matchedByEmoji) return matchedByEmoji as HabitCheckInEmoji;
        }

        return undefined;
    }

    private getCompletedDateFromRepeatInstance(reminder: any, instanceDate: string): string {
        const completedTimes = reminder?.repeat?.completedTimes;
        const completedTime = typeof completedTimes?.[instanceDate] === 'string'
            ? completedTimes[instanceDate]
            : '';

        if (completedTime) {
            return this.getCompletedDateFromReminder({ completedTime });
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(instanceDate || '')) {
            return instanceDate;
        }

        return getLogicalDateString();
    }

    private normalizeLinkedHabitInstanceSyncMap(reminder: any): Record<string, string> {
        const rawMap = reminder?.linkedHabitLastAutoCheckInInstanceKeys;
        if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
            return {};
        }

        const normalized: Record<string, string> = {};
        Object.entries(rawMap).forEach(([instanceDate, marker]) => {
            if (typeof instanceDate !== 'string' || typeof marker !== 'string') return;
            if (!instanceDate || !marker) return;
            normalized[instanceDate] = marker;
        });
        return normalized;
    }

    private applyTaskCompletionAutoCheckIn(
        habit: Habit,
        reminder: any,
        targetDate: string,
        now: string,
        noteSuffix?: string
    ) {
        let emojiConfig = this.resolveTaskAutoCheckInOption(habit, reminder);
        const configuredEmoji = reminder.linkedHabitAutoCheckInEmoji || habit.autoCheckInEmoji || habit.checkInEmojis?.[0]?.emoji || '✅';
        if (!emojiConfig) {
            emojiConfig = habit.checkInEmojis?.find(item => item.emoji === configuredEmoji);
        }
        if (!emojiConfig) {
            emojiConfig = {
                emoji: configuredEmoji,
                meaning: i18n("taskAutoCheckInFromTask") || '任务完成自动打卡',
                countsAsSuccess: true,
                promptNote: false
            } as HabitCheckInEmoji;
            habit.checkInEmojis = [...(habit.checkInEmojis || []), emojiConfig];
        }

        habit.checkIns = habit.checkIns || {};
        if (!habit.checkIns[targetDate]) {
            habit.checkIns[targetDate] = {
                count: 0,
                status: [],
                timestamp: now,
                entries: []
            };
        }

        const noteParts = [
            `${i18n("taskAutoCheckInNotePrefix") || '来自任务'}: ${reminder.title || i18n("unnamedTask") || '未命名任务'}`
        ];
        if (noteSuffix) {
            noteParts.push(noteSuffix);
        }

        const dayCheckIn = habit.checkIns[targetDate];
        dayCheckIn.entries = dayCheckIn.entries || [];
        dayCheckIn.entries.push({
            emoji: emojiConfig.emoji,
            timestamp: now,
            meaning: emojiConfig.meaning,
            note: noteParts.join(' '),
            group: (emojiConfig.group || '').trim() || undefined
        });
        dayCheckIn.status = (dayCheckIn.status || []).concat([emojiConfig.emoji]);
        dayCheckIn.count = (dayCheckIn.count || 0) + 1;
        dayCheckIn.timestamp = now;
        habit.totalCheckIns = (habit.totalCheckIns || 0) + 1;
        habit.updatedAt = now;
    }

    private async syncTaskCompletionAutoCheckIns(habitData: Record<string, Habit>, reminderData: Record<string, any>) {
        if (!habitData || !reminderData) return;

        let hasHabitChange = false;
        let hasReminderChange = false;
        const now = getLocalDateTimeString(new Date());

        for (const reminder of Object.values(reminderData || {}) as any[]) {
            if (!reminder || !reminder.id) continue;

            const linkedHabitId = reminder.linkedHabitId;
            if (!linkedHabitId || !reminder.linkedHabitAutoCheckInOnComplete) continue;
            const habit = habitData[linkedHabitId];
            if (!habit) continue;

            if (reminder.repeat?.enabled) {
                const completedInstances = (Array.isArray(reminder.repeat?.completedInstances)
                    ? reminder.repeat.completedInstances
                    : []).filter((instanceDate: any) => typeof instanceDate === 'string' && !!instanceDate);

                const completedInstanceSet = new Set<string>(completedInstances);
                const syncedInstanceMap = this.normalizeLinkedHabitInstanceSyncMap(reminder);
                let instanceMapChanged = false;

                Object.keys(syncedInstanceMap).forEach(instanceDate => {
                    if (completedInstanceSet.has(instanceDate)) return;
                    delete syncedInstanceMap[instanceDate];
                    instanceMapChanged = true;
                });

                for (const instanceDate of completedInstances) {
                    const instanceCompletedTime = typeof reminder.repeat?.completedTimes?.[instanceDate] === 'string'
                        ? reminder.repeat.completedTimes[instanceDate]
                        : '';
                    const syncMarker = instanceCompletedTime
                        ? `${instanceDate}:${instanceCompletedTime}`
                        : `${instanceDate}:completed`;

                    if (syncedInstanceMap[instanceDate] === syncMarker) continue;

                    const targetDate = this.getCompletedDateFromRepeatInstance(reminder, instanceDate);
                    this.applyTaskCompletionAutoCheckIn(
                        habit,
                        reminder,
                        targetDate,
                        now,
                        `(${i18n("instanceDate") || '实例日期'}: ${instanceDate})`
                    );

                    syncedInstanceMap[instanceDate] = syncMarker;
                    instanceMapChanged = true;
                    hasHabitChange = true;
                }

                if (instanceMapChanged) {
                    if (Object.keys(syncedInstanceMap).length > 0) {
                        reminder.linkedHabitLastAutoCheckInInstanceKeys = syncedInstanceMap;
                    } else if (reminder.linkedHabitLastAutoCheckInInstanceKeys !== undefined) {
                        delete reminder.linkedHabitLastAutoCheckInInstanceKeys;
                    }
                    hasReminderChange = true;
                }
            }

            if (!reminder.completed) {
                if (reminder.linkedHabitLastAutoCheckInKey !== undefined) {
                    delete reminder.linkedHabitLastAutoCheckInKey;
                    hasReminderChange = true;
                }
                continue;
            }

            const syncMarker = reminder.completedTime || 'completed';
            if (reminder.linkedHabitLastAutoCheckInKey === syncMarker) continue;

            const targetDate = this.getCompletedDateFromReminder(reminder);
            this.applyTaskCompletionAutoCheckIn(habit, reminder, targetDate, now);

            reminder.linkedHabitLastAutoCheckInKey = syncMarker;
            hasHabitChange = true;
            hasReminderChange = true;
        }

        if (hasHabitChange) {
            await this.plugin.saveHabitData(habitData);
        }
        if (hasReminderChange) {
            await this.plugin.saveReminderData(reminderData);
        }
    }

    private rebuildLinkedTaskPomodoroStats(reminderData: Record<string, any>) {
        const records = this.pomodoroRecordManager.getSaveData() || {};
        const linkedData = buildLinkedHabitPomodoroData(
            reminderData || {},
            records,
            (session) => this.pomodoroRecordManager.calculateSessionCount(session)
        );

        this.linkedTaskPomodoroStats = linkedData.statsByHabit;
        this.linkedTaskIdsByHabit = linkedData.taskIdsByHabit;
    }

    private getLinkedTaskPomodoroStatsByDate(habitId: string, date: string): LinkedTaskPomodoroDayStats {
        return getLinkedTaskPomodoroStatsByDateUtil(this.linkedTaskPomodoroStats, habitId, date);
    }

    private getLinkedTaskPomodoroTotalStats(habitId: string): LinkedTaskPomodoroDayStats {
        return getLinkedTaskPomodoroTotalStatsUtil(this.linkedTaskPomodoroStats, habitId);
    }

    private getLinkedTaskIdsForHabit(habitId: string): string[] {
        return getLinkedTaskIdsForHabitUtil(this.linkedTaskIdsByHabit, habitId);
    }

    private getHabitFocusMinutesByDate(habitId: string, date: string): number {
        const direct = this.pomodoroRecordManager.getEventFocusTime(habitId, date) || 0;
        const linked = this.getLinkedTaskPomodoroStatsByDate(habitId, date).focusMinutes;
        return direct + linked;
    }





    private isHabitEnded(habit: Habit): boolean {
        if (habit.abandoned) return false;
        if (!habit.endDate) return false;
        const today = getLogicalDateString();
        return habit.endDate < today;
    }

    private applyFilter(habits: Habit[]): Habit[] {
        const today = getLogicalDateString();
        const tomorrow = getRelativeDateString(1);
        const yesterday = getRelativeDateString(-1);

        // 已放弃习惯的筛选：单独处理
        if (this.currentTab === 'abandoned') {
            return habits.filter(h => h.abandoned);
        }

        // 已结束习惯的筛选：单独处理
        if (this.currentTab === 'ended') {
            return habits.filter(h => this.isHabitEnded(h));
        }

        // 排除已放弃和已结束的习惯
        const activeHabits = habits.filter(h => !h.abandoned && !this.isHabitEnded(h));
        const todayBuckets = getTodayHabitBuckets(activeHabits, today, {
            getPomodoroFocusMinutes: (habitId, date) => this.getHabitFocusMinutesByDate(habitId, date)
        });

        switch (this.currentTab) {
            case 'today':
                return todayBuckets.pendingHabits as Habit[];
            case 'tomorrow':
                return activeHabits.filter(h => this.shouldShowOnDate(h, tomorrow));
            case 'todayCompleted':
                return todayBuckets.completedHabits as Habit[];
            case 'yesterdayCompleted':
                return activeHabits.filter(h => this.isCompletedOnDate(h, yesterday));
            case 'all':
            default:
                return activeHabits;
        }
    }

    private shouldShowOnDate(habit: Habit, date: string): boolean {
        if (!isHabitActiveOnDate(habit, date)) return false;
        return shouldCheckInOnDate(habit, date);
    }

    private isCompletedOnDate(habit: Habit, date: string): boolean {
        return isHabitCompletedOnDateUtil(habit, date, {
            getPomodoroFocusMinutes: (habitId, logicalDate) => this.getHabitFocusMinutesByDate(habitId, logicalDate)
        });
    }

    private getHabitGoalType(habit: Habit): 'count' | 'pomodoro' {
        return getHabitGoalTypeUtil(habit);
    }

    private getHabitPomodoroTargetMinutes(habit: Habit): number {
        return getHabitPomodoroTargetMinutesUtil(habit);
    }

    private getHabitProgressColor(habit: Habit): string {
        const color = (habit as any).color;
        if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
            return color;
        }
        return 'var(--b3-theme-primary)';
    }

    private getHabitProgressOnDate(habit: Habit, date: string): { current: number; target: number } {
        return getHabitProgressOnDateUtil(habit, date, {
            getPomodoroFocusMinutes: (habitId, logicalDate) => this.getHabitFocusMinutesByDate(habitId, logicalDate)
        });
    }

    /**
     * 获取当前视图对应的日期
     * - yesterdayCompleted: 返回昨天
     * - 其他: 返回今天
     */
    private getCurrentViewDate(): string {
        if (this.currentTab === 'yesterdayCompleted') {
            return getRelativeDateString(-1);
        }
        return getLogicalDateString();
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
            if (this.currentTab !== 'today' || !this.showCompletedHabitsInTodayPending) {
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
        groupedHabits.forEach((groupHabits) => {
            groupHabits.forEach(h => renderedIds.add(h.id));
            this.renderGroup((groupHabits[0]?.groupId || 'none'), groupHabits);
        });

        // 如果是今日待打卡，在下方显示已打卡习惯（排除已在主区渲染的习惯）
        if (this.currentTab === 'today' && this.showCompletedHabitsInTodayPending) {
            this.renderCompletedHabitsSection(renderedIds);
        }
    }

    private toggleGroupCollapseUI(groupContainer: HTMLElement, isCollapsed: boolean) {
        const collapseIcon = groupContainer.querySelector('.habit-group__collapse-icon') as HTMLElement;
        const groupContent = groupContainer.querySelector('.habit-group__content') as HTMLElement;
        
        if (collapseIcon) {
            collapseIcon.innerHTML = isCollapsed ? '▶' : '▼';
        }
        
        if (groupContent) {
            groupContent.style.display = isCollapsed ? 'none' : '';
        }
    }

    private renderGroup(groupId: string, habits: Habit[]) {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'habit-group';

        // 分组头部
        const groupHeader = document.createElement('div');
        groupHeader.className = 'habit-group__header';

        const group = groupId === 'none' ? null : this.groupManager.getGroupById(groupId);
        const groupName = group ? group.name : i18n("noneGroupName");
        const isCollapsed = this.collapsedGroups.has(groupId);

        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'habit-group__collapse-icon';
        collapseIcon.innerHTML = isCollapsed ? '▶' : '▼';

        const groupTitle = document.createElement('span');
        groupTitle.className = 'habit-group__title';
        groupTitle.innerHTML = `${groupName}<span class="habit-group__count">${habits.length}</span>`;

        groupHeader.appendChild(collapseIcon);
        groupHeader.appendChild(groupTitle);

        groupHeader.addEventListener('click', () => {
            const isCollapsed = this.collapsedGroups.has(groupId);
            if (isCollapsed) {
                this.collapsedGroups.delete(groupId);
            } else {
                this.collapsedGroups.add(groupId);
            }
            this.saveCollapseStates();
            // 只更新当前分组的 UI，不刷新整个列表
            this.toggleGroupCollapseUI(groupContainer, !isCollapsed);
        });

        groupContainer.appendChild(groupHeader);

        // 分组内容 - 始终创建，通过 CSS 控制显示/隐藏
        const groupContent = document.createElement('div');
        groupContent.className = 'habit-group__content';
        if (isCollapsed) {
            groupContent.style.display = 'none';
        }

        // 对分组内的习惯进行排序
        const sortedHabits = this.sortHabitsInGroup(habits);
        const viewDate = this.getCurrentViewDate();
        sortedHabits.forEach(habit => {
            const habitCard = this.createHabitCard(habit, viewDate);
            if (!this.plugin.isInMobileApp) {                // 启用拖拽：仅在同一分组内按优先级排序时可拖拽调整
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
                        await this.reorderHabits(groupId, draggedId, targetId, this.dragOverPosition || 'after');
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
        this.habitsContainer.appendChild(groupContainer);
    }

    private sortHabitsInGroup(habits: Habit[]): Habit[] {
        return [...habits].sort((a, b) => {
            const sa = typeof (a as any).sort === 'number' ? (a as any).sort : 0;
            const sb = typeof (b as any).sort === 'number' ? (b as any).sort : 0;
            if (sa !== sb) return sa - sb;
            return (a.title || '').localeCompare(b.title || '', 'zh-CN', { sensitivity: 'base' });
        });
    }

    private createHabitCard(habit: Habit, date?: string): HTMLElement {
        const card = document.createElement('div');
        card.className = 'habit-card';
        
        // 判断习惯状态
        const isEnded = this.isHabitEnded(habit);
        const isAbandoned = habit.abandoned === true;
        const isInactive = isEnded || isAbandoned;
        
        // 今日已完成或昨日已完成的筛选项，添加透明度
        const isCompletedView = this.currentTab === 'todayCompleted' || this.currentTab === 'yesterdayCompleted';
        if (isCompletedView && !isInactive) {
            card.style.opacity = '0.7';
        }
        
        // 卡片头部：图标、标题
        const header = document.createElement('div');
        header.className = 'habit-card__header';
        
        // 图标 - 使用习惯自定义颜色（支持随机颜色）
        const iconEl = document.createElement('div');
        iconEl.className = 'habit-card__icon';
        iconEl.textContent = habit.icon || '🌱';
        const habitColor = this.getHabitProgressColor(habit);
        if (habitColor && habitColor !== 'var(--b3-theme-primary)') {
            iconEl.style.background = `linear-gradient(135deg, ${habitColor}33, ${habitColor}1a)`;
        }
        // 已结束或已放弃的习惯，图标降低透明度
        if (isInactive) {
            iconEl.style.opacity = '0.6';
        }
        header.appendChild(iconEl);
        
        // 标题
        const title = document.createElement('span');
        title.className = habit.blockId ? 'habit-card__title habit-card__title-link' : 'habit-card__title';
        title.setAttribute('data-type', 'a');
        if (habit.blockId) {
            title.setAttribute('data-href', `siyuan://blocks/${habit.blockId}`);
        }
        const titleText = document.createElement('span');
        titleText.className = habit.blockId ? 'habit-card__title-text habit-card__title-link-text' : 'habit-card__title-text';
        titleText.textContent = habit.title;
        title.appendChild(titleText);
        title.classList.add('ariaLabel'); title.setAttribute('aria-label', habit.title);
        if (isInactive) {
            title.style.opacity = '0.6';
        }
        if (habit.blockId) {
            title.style.cursor = 'pointer';
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
        header.appendChild(title);

        // 网页链接图标（参考 ReminderPanel）
        if (habit.url) {
            const rawUrl = habit.url.trim();
            const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
            const urlIcon = document.createElement('a');
            urlIcon.className = 'habit-card__url-icon';
            urlIcon.href = normalizedUrl;
            urlIcon.target = '_blank';
            urlIcon.rel = 'noopener noreferrer';
            urlIcon.classList.add('ariaLabel'); urlIcon.setAttribute('aria-label', `${i18n("openUrl")}: ${rawUrl}`);
            urlIcon.innerHTML = '<svg style="width: 14px; height: 14px; vertical-align: middle;"><use xlink:href="#iconOpenWindow"></use></svg>';
            urlIcon.style.cssText = 'color: var(--b3-theme-primary); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; flex-shrink: 0;';
            if (isInactive) {
                urlIcon.style.opacity = '0.6';
            }
            urlIcon.addEventListener('click', (ev) => {
                ev.stopPropagation();
            });
            header.appendChild(urlIcon);
        }
        
        // 状态标签（已结束/已放弃）
        if (isEnded) {
            const statusBadge = document.createElement('span');
            statusBadge.className = 'habit-card__status-badge habit-card__status-badge--ended';
            statusBadge.textContent = i18n('habitStatusEnded') || '已结束';
            header.appendChild(statusBadge);
        } else if (isAbandoned) {
            const statusBadge = document.createElement('span');
            statusBadge.className = 'habit-card__status-badge habit-card__status-badge--abandoned';
            statusBadge.textContent = i18n('habitStatusAbandoned') || '已放弃';
            header.appendChild(statusBadge);
        }
        
        card.appendChild(header);

        // 打卡信息 - 根据当前tab显示对应日期的数据
        const today = getLogicalDateString();
        const displayDate = date || today;
        const isHistoryView = displayDate !== today;
        const isCompletedOnDisplayDate = !isInactive && this.isCompletedOnDate(habit, displayDate);
        const checkIn = habit.checkIns?.[displayDate];
        
        // 已结束和已放弃的习惯不显示进度条
        if (!isInactive) {
            const goalType = this.getHabitGoalType(habit);
            const { current: currentProgress, target: targetProgress } = this.getHabitProgressOnDate(habit, displayDate);

            // 进度条区域
            const progressSection = document.createElement('div');
            progressSection.className = 'habit-card__progress';
            
            const progressHeader = document.createElement('div');
            progressHeader.className = 'habit-card__progress-header';
            
            const progressLabel = document.createElement('span');
            progressLabel.className = 'habit-card__progress-label';
            
            const progressValue = document.createElement('span');
            progressValue.className = 'habit-card__progress-value';
            
            const progressBar = document.createElement('div');
            progressBar.className = 'habit-card__progress-bar';
            
            const progressFill = document.createElement('div');
            progressFill.className = 'habit-card__progress-fill';
            
            const percentage = Math.min(100, (currentProgress / Math.max(1, targetProgress)) * 100);
            
            if (goalType === 'pomodoro') {
                progressLabel.textContent = isHistoryView 
                    ? (i18n("historyProgressLabel") || '当日进度') 
                    : (i18n("todayProgressLabel") || '今日进度');
                progressValue.textContent = `${this.formatMinutesToHourMinute(currentProgress)}/${this.formatMinutesToHourMinute(targetProgress)}`;
            } else {
                // 统一显示为 x/target 格式，即使是1次也显示 0/1 或 1/1
                progressLabel.textContent = isHistoryView 
                    ? (i18n("historyProgressLabel") || '当日进度') 
                    : (i18n("todayProgressLabel") || '今日进度');
                progressValue.textContent = `${currentProgress}/${targetProgress}`;
            }
            
            progressFill.style.width = `${percentage}%`;
            const progressColor = this.getHabitProgressColor(habit);
            if (progressColor && progressColor !== 'var(--b3-theme-primary)') {
                progressFill.style.background = `linear-gradient(90deg, ${progressColor}, ${progressColor}88)`;
            }
            
            progressHeader.appendChild(progressLabel);
            progressHeader.appendChild(progressValue);
            progressSection.appendChild(progressHeader);
            progressBar.appendChild(progressFill);
            progressSection.appendChild(progressBar);
            card.appendChild(progressSection);
        }

        // 信息网格区域
        const infoGrid = document.createElement('div');
        infoGrid.className = 'habit-card__info-grid';
        
        // 频率和时间信息合并到一个格子
        const freqTimeItem = document.createElement('div');
        freqTimeItem.className = 'habit-card__info-item habit-card__info-item--full';
        const timeText = habit.endDate 
            ? `${habit.startDate} ~ ${habit.endDate}`
            : `${habit.startDate} ${i18n("timeStart") || '起'}`;
        freqTimeItem.innerHTML = `<span class="habit-card__info-icon">🔄</span><span class="habit-card__info-text">${this.getFrequencyText(habit.frequency)} · ${timeText}</span>`;
        infoGrid.appendChild(freqTimeItem);
        
        // 提醒时间（支持多个）- 已结束和已放弃的习惯不显示
        if (!isInactive) {
            const timesList = isCompletedOnDisplayDate && !isHistoryView
                ? []
                : getHabitReminderTimesForDate(habit, displayDate);
            if (timesList && timesList.length > 0) {
                const reminderItem = document.createElement('div');
                reminderItem.className = 'habit-card__info-item habit-card__info-item--full';
                const displayTimes = timesList.map(t => formatHabitReminderTimeDisplay(t));
                reminderItem.innerHTML = `<span class="habit-card__info-icon">⏰</span><span class="habit-card__info-text">${displayTimes.join(', ')}</span>`;
                infoGrid.appendChild(reminderItem);
            }
        }
        
        card.appendChild(infoGrid);

        // 番茄钟统计
        const pomodoroStats = this.getHabitPomodoroStats(habit.id);
        if (pomodoroStats.totalCount > 0 || pomodoroStats.totalFocusMinutes > 0) {
            const pomodoroSection = document.createElement('div');
            pomodoroSection.style.cssText = 'margin-top:0; margin-bottom:12px; font-size:12px;';
            pomodoroSection.style.color = 'var(--b3-theme-on-surface-light)';
            pomodoroSection.innerHTML = `
                <div class="ariaLabel" aria-label="总计番茄钟: ${pomodoroStats.totalCount}">
                    <span>系列: 🍅 ${pomodoroStats.totalCount}</span>
                    <span style="margin-left:8px; opacity:0.9;">⏱ ${this.formatPomodoroFocusTime(pomodoroStats.totalFocusMinutes)}</span>
                </div>
                <div class="ariaLabel" aria-label="今日番茄钟: ${pomodoroStats.todayCount}" style="margin-top:4px; opacity:0.95;">
                    <span>今日: 🍅 ${pomodoroStats.todayCount}</span>
                    <span style="margin-left:8px; opacity:0.9;">⏱ ${this.formatPomodoroFocusTime(pomodoroStats.todayFocusMinutes)}</span>
                </div>
            `;
            card.appendChild(pomodoroSection);
        }

        // 打卡 emoji 显示（根据当前视图显示对应日期的打卡记录）
        if (checkIn && ((checkIn.entries && checkIn.entries.length > 0) || (checkIn.status && checkIn.status.length > 0))) {
            const emojiSection = document.createElement('div');
            emojiSection.className = 'habit-card__emoji-section';
            emojiSection.style.cursor = isHistoryView ? 'default' : 'pointer';
            emojiSection.classList.add('ariaLabel'); emojiSection.setAttribute('aria-label', isHistoryView 
                ? (i18n("historyCheckInEmoji") || '当日打卡')
                : (i18n("clickToEditCheckIn") || '点击编辑今日打卡'));
            
            const emojiLabel = document.createElement('div');
            emojiLabel.className = 'habit-card__emoji-label';
            emojiLabel.textContent = isHistoryView 
                ? (i18n("historyCheckInEmoji") || '当日打卡')
                : (i18n("todayCheckInEmoji") || '今日打卡');
            emojiSection.appendChild(emojiLabel);
            
            const emojiList = document.createElement('div');
            emojiList.className = 'habit-card__emoji-list';
            
            // 显示指定日期的entries，并显示emoji图标（保留顺序）
            const emojis: string[] = [];
            if (checkIn.entries && checkIn.entries.length > 0) {
                checkIn.entries.forEach(entry => emojis.push(entry.emoji));
            } else if (checkIn.status && checkIn.status.length > 0) {
                checkIn.status.forEach(s => emojis.push(s));
            }

            emojis.forEach((emojiStr) => {
                const emojiEl = document.createElement('span');
                emojiEl.className = 'habit-card__emoji-item';
                emojiEl.textContent = emojiStr;
                emojiEl.classList.add('ariaLabel'); emojiEl.setAttribute('aria-label', emojiStr);
                emojiList.appendChild(emojiEl);
            });
            
            emojiSection.appendChild(emojiList);
            
            // 只有非历史视图才允许点击编辑
            if (!isHistoryView) {
                emojiSection.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    const dialog = new HabitDayDialog(
                        habit,
                        today,
                        async (updatedHabit) => {
                            await this.saveHabit(updatedHabit);
                            this.loadHabits();
                        },
                        this.plugin
                    );
                    dialog.show();
                });
            }
            
            card.appendChild(emojiSection);
        }
        
        // 底部操作区：坚持天数 + 打卡按钮
        const footer = document.createElement('div');
        footer.className = 'habit-card__footer';
        
        // 坚持打卡天数
        const checkInDaysCount = Object.keys(habit.checkIns || {}).length;
        const streakEl = document.createElement('div');
        streakEl.className = 'habit-card__streak';
        streakEl.innerHTML = `<span class="habit-card__streak-icon">🔥</span><span>${i18n("persistDays", { count: checkInDaysCount.toString() })}</span>`;
        footer.appendChild(streakEl);
        
        // 打卡按钮 - 已结束和已放弃的习惯不显示
        if (!isInactive) {
            const actionsEl = document.createElement('div');
            actionsEl.className = 'habit-card__actions';
            
            const checkInBtn = document.createElement('button');
            checkInBtn.className = 'habit-card__checkin-btn';
            
            // 判断是否为番茄钟目标类型以及打卡按钮类型
            const goalType = this.getHabitGoalType(habit);
            const isPomodoroGoal = goalType === 'pomodoro';
            // checkInButtonType: 'pomodoro' | 'countup'，默认为 'pomodoro'
            const buttonType = isPomodoroGoal ? (habit.checkInButtonType || 'pomodoro') : 'normal';
            
            if (isPomodoroGoal && buttonType === 'countup') {
                // 正计时按钮
                checkInBtn.innerHTML = `<span>⏱️</span><span>正计时</span>`;
                checkInBtn.classList.add('ariaLabel');
                checkInBtn.setAttribute('aria-label', '开始正计时');
            } else if (isPomodoroGoal && buttonType === 'pomodoro') {
                // 番茄钟按钮
                checkInBtn.innerHTML = `<span>🍅</span><span>番茄钟</span>`;
                checkInBtn.classList.add('ariaLabel');
                checkInBtn.setAttribute('aria-label', '开始番茄钟');
            } else {
                // 默认打卡按钮
                checkInBtn.innerHTML = `<span>✓</span><span>${i18n("checkInBtn")}</span>`;
            }
            
            // 使用习惯自定义颜色（支持随机颜色）
            if (habitColor && habitColor !== 'var(--b3-theme-primary)') {
                checkInBtn.style.background = `linear-gradient(135deg, ${habitColor}, ${habitColor}dd)`;
                checkInBtn.style.boxShadow = `0 4px 12px ${habitColor}4d`;
            }
            
            checkInBtn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                
                if (isPomodoroGoal && buttonType === 'countup') {
                    // 正计时按钮直接启动正计时
                    this.startPomodoroCountUp(habit);
                } else if (isPomodoroGoal && buttonType === 'pomodoro') {
                    // 番茄钟按钮直接启动番茄钟
                    this.startPomodoro(habit);
                } else {
                    // 默认显示打卡菜单
                    try {
                        const menu = new Menu('habitCardCheckInMenu');
                        const submenu = this.createCheckInSubmenu(habit);
                        submenu.forEach((it: any) => {
                            if (it && it.type === 'separator') {
                                menu.addSeparator();
                            } else if (it) {
                                menu.addItem(it);
                            }
                        });

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
                }
            });
            
            actionsEl.appendChild(checkInBtn);
            footer.appendChild(actionsEl);
        }
        card.appendChild(footer);

        // 右键菜单
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showHabitContextMenu(e, habit);
        });

        return card;
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

        const completedTitle = document.createElement('div');
        completedTitle.className = 'habit-completed-section__title';
        completedTitle.innerHTML = `<span>✓</span><span>${i18n("todayCheckedSection")} (${completedHabits.length})</span>`;

        separator.appendChild(completedTitle);

        const sortedCompleted = this.sortHabitsInGroup(completedHabits);
        // 已打卡区域始终显示今日数据
        sortedCompleted.forEach(habit => {
            const habitCard = this.createHabitCard(habit, today);
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

    private async reorderHabits(groupId: string, draggedId: string, targetId: string, position: 'before' | 'after') {
        const habitData = await this.plugin.loadHabitData();
        const draggedHabit = habitData[draggedId];
        const targetHabit = habitData[targetId];

        if (!draggedHabit || !targetHabit) {
            throw new Error('Habit not found');
        }

        const groupKey = groupId || 'none';
        // 仅按分组内手动顺序重排，不再按优先级分桶
        const targetList = (Object.values(habitData) as Habit[]).filter(h =>
            ((h.groupId || 'none') === groupKey) &&
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

        // 打开网页链接（如果存在）
        if (habit.url) {
            menu.addItem({
                label: i18n("openUrl"),
                icon: "iconOpenWindow",
                click: () => {
                    const rawUrl = habit.url?.trim();
                    if (!rawUrl) {
                        showMessage(i18n("pleaseEnterUrl"));
                        return;
                    }
                    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
                    window.open(normalizedUrl, '_blank');
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

    private async startPomodoro(habit: Habit, workDurationOverride?: number) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 默认时长优化：若未指定，且习惯有番茄目标，在目标小于全局时长时优先使用目标时长
        let finalDuration = workDurationOverride;
        if (!finalDuration) {
            const goalType = this.getHabitGoalType(habit);
            if (goalType === "pomodoro") {
                const targetMinutes = this.getHabitPomodoroTargetMinutes(habit);
                const settings = await this.plugin.loadSettings();
                finalDuration = resolveDefaultPomodoroDuration({ 
                    estimatedPomodoroDuration: targetMinutes 
                }, settings);
            }
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
                    this.performStartPomodoro(habit, currentState, finalDuration);
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
            this.performStartPomodoro(habit, undefined, finalDuration);
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
        const linkedTaskIds = this.getLinkedTaskIdsForHabit(habit.id);
        const dialog = new PomodoroSessionsDialog(
            habit.id,
            this.plugin,
            undefined,
            true,
            {
                includeEventIds: linkedTaskIds
            }
        );
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

            const linkedTodayStats = this.getLinkedTaskPomodoroStatsByDate(habitId, today);
            const linkedTotalStats = this.getLinkedTaskPomodoroTotalStats(habitId);
            totalCount += linkedTotalStats.count;
            totalFocusMinutes += linkedTotalStats.focusMinutes;
            todayCount += linkedTodayStats.count;
            todayFocusMinutes += linkedTodayStats.focusMinutes;
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
        const checkedOptionsToday = new Set<string>(); // "emoji:meaning:group"
        const checkedGroupsToday = new Set<string>();
        const checkedEmojisToday = new Set<string>();

        // 收集所有可能的 emoji 到分组的映射，用于旧数据兼容
        const emojiToGroups = new Map<string, Set<string>>();
        habit.checkInEmojis.forEach(cfg => {
            const g = (cfg.group || '').trim();
            if (g) {
                if (!emojiToGroups.has(cfg.emoji)) emojiToGroups.set(cfg.emoji, new Set());
                emojiToGroups.get(cfg.emoji)!.add(g);
            }
        });

        if (todayCheckIn) {
            const entries = todayCheckIn.entries || [];
            if (entries.length > 0) {
                entries.forEach(entry => {
                    checkedEmojisToday.add(entry.emoji);
                    const m = entry.meaning || '';
                    const g = (entry.group || '').trim();
                    if (g) {
                        checkedGroupsToday.add(g);
                        checkedOptionsToday.add(`${entry.emoji}:${m}:${g}`);
                    } else {
                        // 旧数据兼容：将该 emoji 对应的所有分组都视为已打卡
                        const groups = emojiToGroups.get(entry.emoji);
                        if (groups) groups.forEach(pg => checkedGroupsToday.add(pg));
                    }
                });
            } else if (todayCheckIn.status) {
                // 更旧格式兼容
                todayCheckIn.status.forEach(emoji => {
                    checkedEmojisToday.add(emoji);
                    const groups = emojiToGroups.get(emoji);
                    if (groups) groups.forEach(pg => checkedGroupsToday.add(pg));
                });
            }
        }

        // 添加默认的打卡emoji选项
        habit.checkInEmojis.forEach(emojiConfig => {
            const groupName = (emojiConfig.group || '').trim();
            
            // 如果设置了隐藏今天已打卡选项：
            if (habit.hideCheckedToday) {
                if (groupName) {
                    // 如果有分组，检查该分组是否已打卡
                    if (checkedGroupsToday.has(groupName)) return;
                } else {
                    // 如果没分组，检查该 emoji 是否已打卡
                    if (checkedEmojisToday.has(emojiConfig.emoji)) return;
                }
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
            checkIn.entries.push({ 
                emoji: emojiConfig.emoji, 
                timestamp: customTimestamp, 
                note,
                meaning: emojiConfig.meaning,
                group: (emojiConfig.group || '').trim() || undefined
            });
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

        // 使用 saveHabitPartial 进行增量保存，避免每次重刷所有习惯的打卡子文件
        if (previousHabit?.id && previousHabit.id !== habit.id) {
            // 如果 ID 发生了变更，则仍使用全量保存以处理旧数据的清理
            delete habitData[previousHabit.id];
            try {
                if (this.plugin && typeof this.plugin.cancelMobileNotification === 'function') {
                    await this.plugin.cancelMobileNotification(previousHabit.id);
                }
            } catch (e) {
                console.warn('清理旧习惯ID的移动端通知失败:', e);
            }
            habitData[habit.id] = habit;
            await this.plugin.saveHabitData(habitData);
        } else {
            // 普通更新（包括打卡），使用部分保存以提高性能
            await this.plugin.saveHabitPartial(habit.id, habit);
        }
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



    private async showNewHabitDialog() {
        const dialog = new HabitEditDialog(null, async (habit) => {
            await this.saveHabit(habit);
            this.loadHabits();
        }, this.plugin);
        await dialog.show();
    }

    private async showEditHabitDialog(habit: Habit) {
        const oldHabitSnapshot = this.cloneHabit(habit);
        const dialog = new HabitEditDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit, oldHabitSnapshot);
            this.loadHabits();
        }, this.plugin);
        await dialog.show();
    }

    private openHabitCalendarView() {
        if (this.plugin && typeof this.plugin.openCalendarTab === 'function') {
            this.plugin.openCalendarTab({ showHabitsOnly: true });
            return;
        }
        showMessage(i18n("operationFailed") || "操作失败", 3000, 'error');
    }

    private showPomodoroStatsView() {
        try {
            // 习惯侧栏默认落在「习惯统计」页签
            showStatsDialog(this.plugin, 'habit');
        } catch (error) {
            console.error('打开习惯统计视图失败:', error);
            showMessage(i18n("operationFailed") || "操作失败", 3000, 'error');
        }
    }

    private showHabitStats(habit: Habit) {
        const dialog = new HabitStatsDialog(habit, async (updatedHabit) => {
            await this.saveHabit(updatedHabit);
            this.loadHabits();
        }, this.plugin);
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
