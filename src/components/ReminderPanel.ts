import { colorWithOpacity } from "../utils/uiUtils";
import { showMessage, confirm, Dialog, Menu, Constants, getFrontend, getBackend, platformUtils } from "siyuan";
import { refreshSql, sql, getBlockKramdown, getBlockByID, updateBindBlockAtrrs, openBlock } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTimeString, getLogicalDateString, getRelativeDateString, getLocaleTag } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortConfigSummary, SortCriterion } from "../utils/sortConfig";
import { SortMenuDialog } from "./SortMenuDialog";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { CategoryManager } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { i18n } from "../pluginInstance";
import { generateRepeatInstances, getRepeatDescription, getDaysDifference, addDaysToDate, generateSubtreeInstances } from "../utils/repeatUtils";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroStatsView, getLastStatsMode } from "./PomodoroStatsView";
import { TaskStatsView } from "./TaskStatsView";
import { PomodoroManager } from "../utils/pomodoroManager";
import { PomodoroRecordManager } from "../utils/pomodoroRecord"; // Add import
import { getSolarDateLunarString, getNextLunarMonthlyDate, getNextLunarYearlyDate } from "../utils/lunarUtils";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import { isEventPast } from "../utils/icsImport";
import { PasteTaskDialog } from "./PasteTaskDialog";
import { createPomodoroStartSubmenu as createSharedPomodoroStartSubmenu } from "@/utils/pomodoroPresets";

export class ReminderPanel {
    private container: HTMLElement;
    private remindersContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private categoryFilterButton: HTMLButtonElement;
    private sortButton: HTMLButtonElement;
    private searchInput: HTMLInputElement;
    private plugin: any;
    private currentTab: string = 'today';
    private currentCategoryFilter: string = 'all'; // 添加当前分类过滤
    private selectedCategories: string[] = [];
    private currentSearchQuery: string = '';
    // 排序条件数组（支持多选和拖拽排序）
    private currentSortCriteria: SortCriterion[] = [{ method: 'time', order: 'asc' }];
    private reminderUpdatedHandler: (event?: CustomEvent) => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private categoryManager: CategoryManager; // 添加分类管理器
    private isDragging: boolean = false;
    private draggedElement: HTMLElement | null = null;
    private draggedReminder: any = null;
    private collapsedTasks: Set<string> = new Set(); // 管理任务的折叠状态
    // 记录用户手动展开的任务（优先于默认折叠）
    private userExpandedTasks: Set<string> = new Set();
    private milestoneMap: Map<string, { name: string, icon?: string, projectId?: string, projectName?: string, blockId?: string }> = new Map();

    // 是否在“今日任务”视图下显示已完成的子任务（由 header 中的开关控制）
    private showCompletedSubtasks: boolean = false;
    private showCompletedCheckbox: HTMLInputElement | null = null;
    private showCompletedContainer: HTMLElement | null = null;

    // 使用全局番茄钟管理器
    private pomodoroManager: PomodoroManager = PomodoroManager.getInstance();
    private pomodoroRecordManager: PomodoroRecordManager; // Add property
    private panelId: string; // 唯一标识，用于区分事件来源，避免响应自己触发的更新
    private currentRemindersCache: any[] = [];
    private allRemindersMap: Map<string, any> = new Map(); // 存储所有任务的完整信息，用于计算进度
    private isLoading: boolean = false;
    private loadTimeoutId: number | null = null;

    // 侧栏多选模式
    private isMultiSelectMode: boolean = false;
    private selectedReminderIds: Set<string> = new Set();
    private lastClickedReminderId: string | null = null;
    private _panelKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

    // 当前应用的自定义过滤器ID（用于分类筛选同步）
    private currentCustomFilterId: string | null = null;
    // 用户手动修改的分类筛选（独立于筛选器设置）
    private userManualCategories: string[] = ['all'];

    // 分页相关状态
    private currentPage: number = 1;
    private itemsPerPage: number = 30;
    private isPaginationEnabled: boolean = true; // 是否启用分页
    private totalPages: number = 1;
    private totalItems: number = 0;
    private lastTruncatedTotal: number = 0;
    // 文档标题缓存：按 tab -> (docId -> title)
    private docTitleCache: Map<string, Map<string, string>> = new Map();
    private lute: any;

    constructor(container: HTMLElement, plugin?: any, closeCallback?: () => void) {
        this.container = container;
        this.plugin = plugin;
        // 唯一 ID，用于标记由本面板发出的全局事件，避免自身响应
        this.panelId = `ReminderPanel_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        this.categoryManager = CategoryManager.getInstance(this.plugin); // 初始化分类管理器
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin); // Initialization

        try {
            if ((window as any).Lute) {
                this.lute = (window as any).Lute.New();
            }
        } catch (e) {
            console.error('初始化 Lute 失败:', e);
        }

        // 创建事件处理器（忽略由本 panel 发出的事件）
        this.reminderUpdatedHandler = (event?: CustomEvent) => {
            // 如果事件来自自己或显式要求跳过面板刷新，则忽略
            if (event && event.detail) {
                if (event.detail.source === this.panelId) return;
            }

            // 防抖处理，避免短时间内的多次更新
            if (this.loadTimeoutId) {
                clearTimeout(this.loadTimeoutId);
            }
            this.loadTimeoutId = window.setTimeout(async () => {
                if (!this.isLoading) {
                    // 确保番茄钟数据是最新的
                    try {
                        // 使用共享实例刷新数据
                        await this.pomodoroRecordManager.refreshData();
                    } catch (e) {
                        console.warn('刷新番茄钟数据失败:', e);
                    }
                    this.loadReminders();
                }
                this.loadTimeoutId = null;
            }, 100);
        };

        this.sortConfigUpdatedHandler = (event: CustomEvent) => {
            const { criteria } = event.detail;
            if (JSON.stringify(criteria) !== JSON.stringify(this.currentSortCriteria)) {
                this.currentSortCriteria = criteria || [{ method: 'time', order: 'asc' }];
                this.updateSortButtonTitle();
                this.loadReminders();
            }
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        // 初始化番茄钟记录管理器，确保番茄数据已加载
        await this.pomodoroRecordManager.initialize();

        // 加载持久化设置（例如 showCompletedSubtasks）
        try {
            const settings = await this.plugin.loadSettings();
            if (settings.showCompletedSubtasks !== undefined) {
                this.showCompletedSubtasks = !!settings.showCompletedSubtasks;
            }
            if (Array.isArray(settings.reminderPanelSelectedCategories)) {
                this.selectedCategories = settings.reminderPanelSelectedCategories;
            }
        } catch (e) {
            // ignore
        }

        this.initUI();
        await this.loadSortConfig();
        await this.loadCustomFilters(); // 加载自定义过滤器配置
        this.loadReminders();

        // Escape：如果右键菜单已打开则关闭菜单（不退出多选）；否则退出多选模式
        this._panelKeydownHandler = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            // 检测 SiYuan 菜单是否可见（b3-menu 且非隐藏）
            const openMenu = document.querySelector<HTMLElement>('.b3-menu');
            if (openMenu && openMenu.style.display !== 'none' && openMenu.offsetParent !== null) {
                // 菜单已打开，让菜单自行处理 Escape，不干预多选状态
                return;
            }
            if (this.isMultiSelectMode) {
                this.exitPanelMultiSelectMode();
            }
        };
        document.addEventListener('keydown', this._panelKeydownHandler);

        // 确保对话框样式已加载
        this.addReminderDialogStyles();
        this.reminderUpdatedHandler()
        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
        // 监听排序配置更新事件
        window.addEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
    }

    // 添加销毁方法以清理事件监听器
    public destroy() {
        // 清理定时器
        if (this.loadTimeoutId) {
            clearTimeout(this.loadTimeoutId);
            this.loadTimeoutId = null;
        }


        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
        if (this.sortConfigUpdatedHandler) {
            window.removeEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
        }
        if (this._panelKeydownHandler) {
            document.removeEventListener('keydown', this._panelKeydownHandler);
            this._panelKeydownHandler = null;
        }

        // 清理当前番茄钟实例
        this.pomodoroManager.cleanupInactiveTimer();
    }


    // 加载排序配置
    private async loadSortConfig() {
        try {
            const config = await loadSortConfig(this.plugin);
            this.currentSortCriteria = config.criteria || [{ method: 'time', order: 'asc' }];
            this.updateSortButtonTitle();
        } catch (error) {
            console.error('加载排序配置失败:', error);
            this.currentSortCriteria = [{ method: 'time', order: 'asc' }];
        }
    }

    private initUI() {
        this.container.classList.add('reminder-panel');
        this.container.innerHTML = '';

        // 注入拖拽时的全局样式（确保 drag 状态下透明度生效）
        try {
            if (!document.getElementById('reminder-panel-drag-style')) {
                const style = document.createElement('style');
                style.id = 'reminder-panel-drag-style';
                style.textContent = `
                    .reminder-item.dragging { opacity: 0.5 !important; }
                    .reminder-item.reminder-completed { opacity: 0.5 !important; }
                    .reminder-list.drag-over-active {
                        box-shadow: inset 0 0 0 2px var(--b3-theme-primary);
                    }
                `;
                document.head.appendChild(style);
            }
        } catch (e) {
            // ignore
        }

        // 标题部分
        const header = document.createElement('div');
        header.className = 'reminder-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'reminder-icon';
        iconSpan.textContent = '⏰';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = i18n('taskManagement');

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 添加右侧按钮容器（单独一行，将在标题下方显示）
        const actionContainer = document.createElement('div');
        actionContainer.className = 'reminder-panel__actions';
        // 在单独一行时使用 flex 右对齐
        actionContainer.style.cssText = 'display:flex; justify-content:flex-start; gap:8px; margin-bottom:8px;';

        // 添加新建任务按钮
        const newTaskBtn = document.createElement('button');
        newTaskBtn.className = 'b3-button b3-button--outline';
        newTaskBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        newTaskBtn.title = i18n("newTask") || "新建任务";
        newTaskBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showNewTaskDialog();
        });
        actionContainer.appendChild(newTaskBtn);

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

        // 添加日历视图按钮和番茄钟统计按钮放在一起
        if (this.plugin) {
            const calendarBtn = document.createElement('button');
            calendarBtn.className = 'b3-button b3-button--outline';
            calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
            calendarBtn.title = i18n("calendarView");
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);

            // 添加四象限面板按钮
            const eisenhowerBtn = document.createElement('button');
            eisenhowerBtn.className = 'b3-button b3-button--outline';
            eisenhowerBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconGrid"></use></svg>';
            eisenhowerBtn.title = i18n("eisenhowerMatrix") || "四象限面板";
            eisenhowerBtn.addEventListener('click', () => {
                this.openEisenhowerMatrix();
            });
            actionContainer.appendChild(eisenhowerBtn);

            // 添加番茄钟统计按钮
            const pomodoroStatsBtn = document.createElement('button');
            pomodoroStatsBtn.className = 'b3-button b3-button--outline';
            pomodoroStatsBtn.innerHTML = '📊';
            pomodoroStatsBtn.title = i18n("pomodoroStats");
            pomodoroStatsBtn.addEventListener('click', () => {
                this.showPomodoroStatsView();
            });
            actionContainer.appendChild(pomodoroStatsBtn);



            // 添加刷新按钮
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'b3-button b3-button--outline';
            refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
            refreshBtn.title = i18n("refresh") || "刷新";
            refreshBtn.addEventListener('click', () => {
                // 刷新时清空当前 Tab 的文档标题缓存，再强制重载提醒
                try {
                    if (this.currentTab) {
                        this.docTitleCache.delete(this.currentTab);
                    }
                } catch (e) {
                    // ignore
                }
                this.loadReminders(true);
            });
            actionContainer.appendChild(refreshBtn);
        }

        // 添加更多按钮（放在最右边）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.title = i18n("more") || "更多";
        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMoreMenu(e);
        });
        actionContainer.appendChild(moreBtn);

        // 标题单独一行
        header.appendChild(titleContainer);
        // 按钮单独一行，置于标题下方并右对齐
        header.appendChild(actionContainer);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'reminder-controls';
        controls.style.cssText = `
            display: flex;
            gap: 8px;
            width: 100%;
        `;

        // 时间筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.filterSelect.innerHTML = `
            <option value="today" selected>${i18n("todayReminders")}</option>
            <option value="tomorrow">${i18n("tomorrowReminders")}</option>
            <option value="future7">${i18n("future7Reminders")}</option>
            <option value="thisWeek">${i18n("thisWeekReminders") || "本周任务"}</option>
            <option value="futureAll">${i18n("futureReminders")}</option>
            <option value="overdue">${i18n("overdueReminders")}</option>
            <option value="all">${i18n("past7Reminders")}</option>
            <option value="allUncompleted">${i18n("allUncompletedReminders")}</option>
            <option value="noDate">${i18n("noDateReminders")}</option>
            <option value="todayCompleted">${i18n("todayCompletedReminders")}</option>
            <option value="yesterdayCompleted">${i18n("yesterdayCompletedReminders")}</option>
            <option value="completed">${i18n("completedReminders")}</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            const newTab = this.filterSelect.value;
            const isOldTabCustom = this.currentTab.startsWith('custom_');
            const isNewTabCustom = newTab.startsWith('custom_');
            this.currentTab = newTab;

            // 如果从自定义过滤器切换到非自定义过滤器，重置当前自定义过滤器ID
            // 这样下次切换到自定义过滤器时会重新同步分类设置
            if (isOldTabCustom && !isNewTabCustom) {
                this.currentCustomFilterId = null;
                // 切换到内置筛选器时，使用用户手动记忆的分啰
                this.selectedCategories = [...this.userManualCategories];
                this.updateCategoryFilterButtonText();
                this.saveSelectedCategories();
            }

            // 切换筛选时清理防抖，清空当前缓存并强制刷新，避免从 "completed" 切换到 "todayCompleted" 时不更新的问题
            if (this.loadTimeoutId) {
                clearTimeout(this.loadTimeoutId);
                this.loadTimeoutId = null;
            }
            this.currentRemindersCache = [];
            // 重置分页状态
            this.currentPage = 1;
            this.totalPages = 1;
            this.totalItems = 0;
            // 强制刷新，允许在 isLoading 为 true 时也能覆盖加载（例如快速切换时）
            this.loadReminders(true);
        });
        controls.appendChild(this.filterSelect);

        // 分类筛选
        this.categoryFilterButton = document.createElement('button');
        this.categoryFilterButton.className = 'b3-button b3-button--outline';
        this.categoryFilterButton.style.cssText = `
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
        this.categoryFilterButton.addEventListener('click', () => this.showCategorySelectDialog());
        controls.appendChild(this.categoryFilterButton);

        // 添加“显示已完成子任务”开关，仅在“今日任务”筛选时显示
        const showCompletedContainer = document.createElement('label');
        showCompletedContainer.className = 'b3-label';
        showCompletedContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            margin: 0;
            white-space: nowrap;
            cursor: pointer;
            padding: 0;
        `;

        this.showCompletedCheckbox = document.createElement('input');
        this.showCompletedCheckbox.type = 'checkbox';
        this.showCompletedCheckbox.className = 'b3-switch';
        this.showCompletedCheckbox.checked = this.showCompletedSubtasks;
        this.showCompletedCheckbox.addEventListener('change', () => {
            this.showCompletedSubtasks = !!this.showCompletedCheckbox!.checked;
            // 切换后刷新任务显示
            this.loadReminders(true);
            // 持久化设置
            (async () => {
                try {
                    const settings = await this.plugin.loadSettings() || {};
                    settings.showCompletedSubtasks = this.showCompletedSubtasks;
                    await this.plugin.saveSettings(settings);
                } catch (e) {
                    // ignore
                }
            })();
        });

        const showCompletedText = document.createElement('span');
        showCompletedText.textContent = i18n('showCompletedSubtasks');
        showCompletedText.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        `;

        showCompletedContainer.appendChild(this.showCompletedCheckbox);
        showCompletedContainer.appendChild(showCompletedText);
        // 显示已完成子任务开关在所有筛选项下都可见
        showCompletedContainer.style.cssText += '\n            display: flex; width: 100%; margin-top: 8px;';

        header.appendChild(controls);
        // 将开关单独一行放在 controls 下面
        header.appendChild(showCompletedContainer);
        this.showCompletedContainer = showCompletedContainer;

        // 搜索框（参考ProjectPanel的实现）
        const searchContainer = document.createElement('div');
        searchContainer.className = 'reminder-search';
        searchContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 8px;
        `;

        this.searchInput = document.createElement('input');
        this.searchInput.className = 'b3-text-field';
        this.searchInput.type = 'text';
        this.searchInput.placeholder = i18n("searchTasks") || "搜索任务...";
        this.searchInput.style.cssText = `
            flex: 1;
        `;
        this.searchInput.addEventListener('input', () => {
            this.currentSearchQuery = this.searchInput.value.trim();
            this.loadReminders();
        });

        searchContainer.appendChild(this.searchInput);
        header.appendChild(searchContainer);

        this.container.appendChild(header);

        // 提醒列表容器
        this.remindersContainer = document.createElement('div');
        this.remindersContainer.className = 'reminder-list';
        // 添加拖拽相关样式
        this.remindersContainer.style.position = 'relative';
        this.container.appendChild(this.remindersContainer);

        // 为容器添加拖拽事件，支持拖动到空白区域移除父子关系
        this.addContainerDragEvents();

        // 渲染分类过滤器
        this.updateCategoryFilterButtonText();

        // 初始化排序按钮标题
        this.updateSortButtonTitle();

        // 初始化自定义过滤器
        this.updateFilterSelect();
    }
    // 修改排序方法以支持多条件排序
    private sortReminders(reminders: any[]) {
        const criteria = this.currentSortCriteria;
        // console.log('应用排序方式:', criteria, '提醒数量:', reminders.length);

        // 特殊处理已完成相关的筛选器（包括昨日已完成）
        const isCompletedFilter = this.currentTab === 'completed' || this.currentTab === 'todayCompleted' || this.currentTab === 'yesterdayCompleted';
        const isPast7Filter = this.currentTab === 'all';

        // 如果当前视图是"今日已完成"或"全部已完成"，始终按完成时间降序显示
        if (isCompletedFilter) {
            reminders.sort((a: any, b: any) => {
                const today = getLogicalDateString();

                // 只有被忽略的任务才强制排在最后，已完成的每日可做参与正常排序
                const aIsIgnored = a.isAvailableToday && Array.isArray(a.dailyDessertIgnored) && a.dailyDessertIgnored.includes(today);
                const bIsIgnored = b.isAvailableToday && Array.isArray(b.dailyDessertIgnored) && b.dailyDessertIgnored.includes(today);

                if (aIsIgnored && !bIsIgnored) return 1;
                if (!aIsIgnored && bIsIgnored) return -1;

                // 直接使用 compareByCompletedTime 的结果作为最终排序依据
                let result = this.compareByCompletedTime(a, b);
                return result;
            });

            return;
        }

        // 特殊处理：今日任务视图下，每日可做任务始终放在最后，不参与其他排序
        if (this.currentTab === 'today') {
            const todayStr = getLogicalDateString();
            
            // 定义分组：0-普通任务, 1-订阅任务, 2-每日可做(Dessert)
            const getGroupOrder = (item: any) => {
                const isDessert = item.isAvailableToday && (!item.date && !item.endDate || (item.date || item.endDate) !== todayStr);
                if (isDessert) return 2;
                if (item.isSubscribed) return 1;
                return 0;
            };
            
            // 先按分组排序（普通任务在前，每日可做最后）
            reminders.sort((a: any, b: any) => {
                const orderA = getGroupOrder(a);
                const orderB = getGroupOrder(b);
                
                // 如果分组不同，直接按分组排序
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                
                // 同组内再按排序条件排序
                return this.sortByCriteria(a, b, criteria, isPast7Filter);
            });
        } else {
            reminders.sort((a: any, b: any) => {
                return this.sortByCriteria(a, b, criteria, isPast7Filter);
            });
        }

        // console.log('排序完成，排序方式:', criteria);
    }

    // 根据单个排序条件比较两个任务
    private compareByCriterion(a: any, b: any, criterion: SortCriterion): number {
        let result = 0;

        switch (criterion.method) {
            case 'time':
                // 特殊处理：按时间排序时，无日期任务始终排在最后
                const hasDateA = !!(a.date || a.endDate);
                const hasDateB = !!(b.date || b.endDate);

                if (!hasDateA && !hasDateB) {
                    result = this.compareByPriorityValue(a, b);
                } else if (!hasDateA) {
                    result = 1;  // a 无日期，排在后面
                } else if (!hasDateB) {
                    result = -1; // b 无日期，排在后面
                } else {
                    result = this.compareByTime(a, b);
                }
                break;

            case 'priority':
                result = this.compareByPriorityValue(a, b);
                // 优先级相同时按手动排序
                if (result === 0) {
                    const sortA = this.getReminderSortValue(a);
                    const sortB = this.getReminderSortValue(b);
                    result = sortA - sortB;
                }
                break;

            case 'title':
                result = this.compareByTitle(a, b);
                break;

            case 'created':
                result = this.compareByCreatedTime(a, b);
                break;

            case 'category':
                result = this.compareByCategory(a, b);
                break;

            default:
                result = 0;
        }

        // 应用升降序
        return criterion.order === 'desc' ? -result : result;
    }

    // 按排序条件数组比较两个任务
    private sortByCriteria(a: any, b: any, criteria: SortCriterion[], isPast7Filter: boolean): number {
        // 对于"过去七天"筛选器，未完成事项优先显示
        if (isPast7Filter) {
            const aCompleted = a.completed || false;
            const bCompleted = b.completed || false;

            if (aCompleted !== bCompleted) {
                return aCompleted ? 1 : -1; // 未完成的排在前面
            }
        }

        // 依次应用每个排序条件
        for (const criterion of criteria) {
            const result = this.compareByCriterion(a, b, criterion);
            if (result !== 0) {
                // 调试日志：记录哪个排序条件决定了顺序
                // console.log(`[排序] ${a.title?.substring(0, 20)} vs ${b.title?.substring(0, 20)}: 按 ${criterion.method}(${criterion.order}) = ${result}`);
                return result;
            }
        }

        // 所有排序条件都相同时，按创建时间作为兜底排序（确保排序的稳定性）
        return this.compareByCreatedTime(a, b);
    }

    // 按创建时间比较
    private compareByCreatedTime(a: any, b: any): number {
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeA - timeB; // 旧到新（升序），降序会在 compareByCriterion 中取反
    }

    // 按分类比较（按照分类管理器中的排序顺序）
    private compareByCategory(a: any, b: any): number {
        const categories = this.categoryManager.getCategories();
        const categoryOrder = new Map<string, number>();
        
        // 构建分类ID到排序索引的映射
        categories.forEach((cat, index) => {
            categoryOrder.set(cat.id, index);
        });
        
        // 获取任务的排序最靠前的分类ID（支持重复任务实例）
        const getHighestPriorityCategoryId = (reminder: any): string => {
            // 对于重复任务实例，优先使用自身的 categoryId，如果没有则从原始任务获取
            let categoryId = reminder.categoryId;
            
            // 如果没有 categoryId 且有 originalId，尝试从原始任务获取
            if (!categoryId && reminder.isRepeatInstance && reminder.originalId && this.originalRemindersCache) {
                const original = this.originalRemindersCache[reminder.originalId];
                if (original) {
                    categoryId = original.categoryId;
                }
            }
            
            if (!categoryId) return 'none';
            const ids = String(categoryId).split(',').map((id: string) => id.trim()).filter((id: string) => id);
            
            if (ids.length === 0) return 'none';
            if (ids.length === 1) return ids[0];
            
            // 有多个分类时，返回排序最靠前的那个（在 categoryOrder 中索引最小的）
            let bestId = ids[0];
            let bestOrder = categoryOrder.get(bestId) ?? Number.MAX_SAFE_INTEGER;
            
            for (let i = 1; i < ids.length; i++) {
                const id = ids[i];
                const order = categoryOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
                if (order < bestOrder) {
                    bestOrder = order;
                    bestId = id;
                }
            }
            
            return bestId;
        };
        
        const catA = getHighestPriorityCategoryId(a);
        const catB = getHighestPriorityCategoryId(b);
        
        // 调试日志
        // if (a.categoryId?.includes(',') || b.categoryId?.includes(',')) {
        //     console.log('[分类排序]', a.title?.substring(0, 20), `(${a.categoryId || 'none'})`, '=>', catA, 'vs', b.title?.substring(0, 20), `(${b.categoryId || 'none'})`, '=>', catB);
        // }
        
        // 无分类的任务排在最后
        if (catA === 'none' && catB === 'none') return 0;
        if (catA === 'none') return 1;
        if (catB === 'none') return -1;
        
        // 按照分类的排序索引比较
        const orderA = categoryOrder.get(catA) ?? Number.MAX_SAFE_INTEGER;
        const orderB = categoryOrder.get(catB) ?? Number.MAX_SAFE_INTEGER;
        
        return orderA - orderB;
    }
    // 新增：优先级排序与手动排序结合（支持重复实例）
    private compareByPriorityWithManualSort(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 首先按优先级排序
        const priorityDiff = priorityB - priorityA;
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 同优先级内按手动排序（支持重复实例从 instanceModifications 读取）
        const sortA = this.getReminderSortValue(a);
        const sortB = this.getReminderSortValue(b);

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 修改：如果手动排序值也相同，按时间排序
        const timeResult = this.compareByTime(a, b);
        if (timeResult !== 0) {
            return timeResult;
        }

        // 最后兜底：按创建时间排序 (借鉴 ProjectKanbanView)
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeB - timeA; // 最新创建的在前
    }

    /**
     * 获取任务的排序值（支持重复实例）
     */
    private getReminderSortValue(reminder: any): number {
        if (!reminder) return 0;

        // 如果是重复实例，从 instanceModifications 中读取
        // 使用原始日期（从 ID 中提取）作为键，因为 date 可能已被修改
        if (reminder.isRepeatInstance && reminder.originalId && reminder.id && reminder.id.includes('_')) {
            const originalInstanceDate = reminder.id.split('_').pop();
            const originalReminder = this.originalRemindersCache?.[reminder.originalId];
            if (originalReminder?.repeat?.instanceModifications?.[originalInstanceDate]) {
                return originalReminder.repeat.instanceModifications[originalInstanceDate].sort ?? reminder.sort ?? 0;
            }
        }

        // 普通任务或没有 instanceModifications 的实例
        return reminder.sort || 0;
    }

    private async saveSelectedCategories() {
        try {
            const settings = await this.plugin.loadSettings();
            settings.reminderPanelSelectedCategories = this.selectedCategories;
            await this.plugin.saveSettings(settings);
        } catch (error) {
            console.error('保存任务分类筛选设置失败:', error);
        }
    }

    private updateCategoryFilterButtonText() {
        if (!this.categoryFilterButton) return;

        if (this.selectedCategories.length === 0 || this.selectedCategories.includes('all')) {
            this.categoryFilterButton.textContent = i18n("categoryFilter");
        } else {
            // 显示选中的分类名称
            const names = this.selectedCategories.map(id => {
                if (id === 'none') return i18n("noCategory");
                const cat = this.categoryManager.getCategoryById(id);
                return cat ? cat.name : id;
            });
            this.categoryFilterButton.textContent = names.join(', ');
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(this.plugin, () => {
            // 分类更新后重新渲染过滤器
            this.updateCategoryFilterButtonText();
        });
        categoryDialog.show();
    }

    private showFilterManagement() {
        const dialog = new Dialog({
            title: i18n("filterManagement") || "过滤器管理",
            // use full-height content wrapper and prevent the wrapper itself from scrolling
            content: `<div id="filterManagementContent" style="height: 100%; display:flex; overflow:hidden;"></div>`,
            width: "900px",
            height: "700px"
        });

        // mark the dialog so we can override dialog-level scrolling for this instance
        dialog.element.classList.add('filter-management-dialog');

        // 动态导入 Svelte 组件
        import('./FilterManagement.svelte').then((module) => {
            const FilterManagement = module.default;
            new FilterManagement({
                target: dialog.element.querySelector('#filterManagementContent'),
                props: {
                    plugin: this.plugin,
                    onFilterApplied: async (filter: any) => {
                        // 应用过滤器逻辑
                        console.log('应用过滤器:', filter);
                        showMessage(i18n("filterApplied") || "过滤器已应用");
                        // 更新filterSelect（包含重新加载配置缓存）
                        await this.updateFilterSelect();
                        // 重新加载任务以显示修改后的过滤结果
                        this.loadReminders();
                    }
                }
            });
        }).catch((error) => {
            console.error('加载过滤器管理组件失败:', error);
            showMessage('加载过滤器管理组件失败');
            dialog.destroy();
        });
    }

    // 动态更新filterSelect选项
    private async updateFilterSelect() {
        if (!this.filterSelect) return;

        const settings = await this.plugin.loadData('settings.json');
        const customFilters = settings?.customFilters || [];
        const filterOrder = settings?.filterOrder || [];
        const hiddenBuiltInFilters: string[] = settings?.hiddenBuiltInFilters || [];

        // 重新加载自定义过滤器缓存
        await this.loadCustomFilters();

        // 保存当前选中的值
        const currentValue = this.filterSelect.value;

        // 内置过滤器定义
        const builtInFilters = [
            { id: 'builtin_today', value: 'today', label: i18n("todayReminders") },
            { id: 'builtin_tomorrow', value: 'tomorrow', label: i18n("tomorrowReminders") },
            { id: 'builtin_future7', value: 'future7', label: i18n("future7Reminders") },
            { id: 'builtin_thisWeek', value: 'thisWeek', label: i18n("thisWeekReminders") || "本周任务" },
            { id: 'builtin_futureAll', value: 'futureAll', label: i18n("futureReminders") },
            { id: 'builtin_overdue', value: 'overdue', label: i18n("overdueReminders") },
            { id: 'builtin_all', value: 'all', label: i18n("past7Reminders") },
            { id: 'builtin_allUncompleted', value: 'allUncompleted', label: i18n("allUncompletedReminders") },
            { id: 'builtin_noDate', value: 'noDate', label: i18n("noDateReminders") },
            { id: 'builtin_todayCompleted', value: 'todayCompleted', label: i18n("todayCompletedReminders") },
            { id: 'builtin_yesterdayCompleted', value: 'yesterdayCompleted', label: i18n("yesterdayCompletedReminders") },
            { id: 'builtin_completed', value: 'completed', label: i18n("completedReminders") },
        ];

        // 统一所有过滤器对象
        // 自定义过滤器的 id 格式已经是 custom_...，value 也是 custom_custom_... (保持现有逻辑一致)
        // 或者是 custom_123 ? 现有代码是 optionsHTML += `<option value="custom_${filter.id}">`
        // 如果 filter.id 已经是 custom_123，那 value 就是 custom_custom_123
        // 我们这里暂且构造一个统一的列表
        let allFilters = [
            ...builtInFilters.filter(f => !hiddenBuiltInFilters.includes(f.id)).map(f => ({ ...f, isAppended: false })),
            ...customFilters.map((f: any) => ({
                id: f.id,
                value: `custom_${f.id}`,
                label: f.name,
                isAppended: false
            }))
        ];

        let sortedFilters: any[] = [];

        // 如果有排序设置，按照排序设置重组列表
        if (filterOrder && filterOrder.length > 0) {
            const filterMap = new Map(allFilters.map(f => [f.id, f]));

            // 按顺序添加
            for (const id of filterOrder) {
                if (filterMap.has(id)) {
                    sortedFilters.push(filterMap.get(id));
                    filterMap.get(id).isAppended = true;
                }
            }

            // 添加未在排序列表中的过滤器（可能是新增的内置或自定义过滤器）
            for (const filter of allFilters) {
                if (!filter.isAppended) {
                    sortedFilters.push(filter);
                }
            }
        } else {
            // 没有排序设置，使用默认顺序：内置 -> 自定义
            sortedFilters = allFilters;
        }

        // 生成 HTML
        let optionsHTML = '';
        sortedFilters.forEach(filter => {
            optionsHTML += `<option value="${filter.value}">${filter.label}</option>`;
        });

        this.filterSelect.innerHTML = optionsHTML;

        // 恢复之前选中的值（如果还存在）
        if (currentValue && Array.from(this.filterSelect.options).some(opt => opt.value === currentValue)) {
            this.filterSelect.value = currentValue;
        } else {
            // 当前选中的过滤器已被删除（或不可用），切换到第一个
            if (this.filterSelect.options.length > 0) {
                this.filterSelect.selectedIndex = 0;
                // 如果被删除的过滤器正是当前激活的 Tab，则更新 currentTab
                if (this.currentTab === currentValue) {
                    this.currentTab = this.filterSelect.value;
                }
            }
        }
    }



    // 更新排序按钮的提示文本
    private updateSortButtonTitle() {
        if (this.sortButton) {
            const summary = getSortConfigSummary({ criteria: this.currentSortCriteria });
            this.sortButton.title = `${i18n("sortBy")}: ${summary}`;
        }
    }




    /**
     * 异步添加文档标题显示
     * @param container 标题容器元素
     * @param docId 文档ID
     */
    private async addDocumentTitle(container: HTMLElement, docId: string) {
        try {
            // 如果容器已经有文档标题，避免重复插入
            if (container.querySelector('.reminder-item__doc-title')) return;

            const tab = this.currentTab || 'default';
            let tabCache = this.docTitleCache.get(tab);
            if (!tabCache) {
                tabCache = new Map<string, string>();
                this.docTitleCache.set(tab, tabCache);
            }

            // 优先使用缓存（仅使用当前 tab 的缓存）
            if (tabCache.has(docId)) {
                const cachedTitle = tabCache.get(docId)!;
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
                `;

                const docIcon = document.createElement('span');
                docIcon.innerHTML = '📄';
                docIcon.style.fontSize = '10px';

                const docTitleLink = document.createElement('span');
                docTitleLink.setAttribute('data-type', 'a');
                docTitleLink.setAttribute('data-href', `siyuan://blocks/${docId}`);
                docTitleLink.textContent = cachedTitle;
                docTitleLink.title = `所属文档: ${cachedTitle}`;
                docTitleLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-on-background);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;

                docTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(docId);
                });
                docTitleLink.addEventListener('mouseenter', () => {
                    docTitleLink.style.color = 'var(--b3-theme-primary)';
                });
                docTitleLink.addEventListener('mouseleave', () => {
                    docTitleLink.style.color = 'var(--b3-theme-on-background)';
                });

                docTitleEl.appendChild(docIcon);
                docTitleEl.appendChild(docTitleLink);
                container.insertBefore(docTitleEl, container.firstChild);

                return;
            }

            // 缓存中没有时再异步获取并缓存
            const docBlock = await getBlockByID(docId);
            if (docBlock && docBlock.content) {
                const title = docBlock.content;
                tabCache.set(docId, title);

                // 创建文档标题元素并插入
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
                `;

                const docIcon = document.createElement('span');
                docIcon.innerHTML = '📄';
                docIcon.style.fontSize = '10px';

                const docTitleLink = document.createElement('span');
                docTitleLink.setAttribute('data-type', 'a');
                docTitleLink.setAttribute('data-href', `siyuan://blocks/${docId}`);
                docTitleLink.textContent = title;
                docTitleLink.title = `所属文档: ${title}`;
                docTitleLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-on-background);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;

                docTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(docId);
                });
                docTitleLink.addEventListener('mouseenter', () => {
                    docTitleLink.style.color = 'var(--b3-theme-primary)';
                });
                docTitleLink.addEventListener('mouseleave', () => {
                    docTitleLink.style.color = 'var(--b3-theme-on-background)';
                });

                docTitleEl.appendChild(docIcon);
                docTitleEl.appendChild(docTitleLink);
                container.insertBefore(docTitleEl, container.firstChild);

                // 恢复滚动位置以防止异步插入引起跳动
                const currentScrollTop = this.remindersContainer.scrollTop;
                const currentScrollLeft = this.remindersContainer.scrollLeft;
                setTimeout(() => {
                    this.remindersContainer.scrollTop = currentScrollTop;
                    this.remindersContainer.scrollLeft = currentScrollLeft;
                }, 0);
            }
        } catch (error) {
            console.warn('获取文档标题失败:', error);
            // 静默失败，不影响主要功能
        }
    }

    /**
     * 异步添加项目信息显示
     * @param container 信息容器元素
     * @param projectId 项目ID
     */
    private async addProjectInfo(container: HTMLElement, projectId: string) {
        try {
            const projectData = await this.plugin.loadProjectData();
            const project = projectData[projectId];

            if (project && project.title) {
                // 创建项目信息元素
                const projectEl = document.createElement('div');
                projectEl.className = 'reminder-item__project';
                projectEl.style.cssText = `
                    font-size: 11px;
                    color: var(--b3-theme-on-background);
                    margin-top: 4px;
                    opacity: 0.8;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                `;

                // 添加项目图标
                const projectIcon = document.createElement('span');
                projectIcon.textContent = '📂';
                projectIcon.style.fontSize = '12px';

                // 创建项目标题链接
                const projectLink = document.createElement('span');
                projectLink.textContent = project.title;
                projectLink.title = `所属项目: ${project.title}`;
                projectLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-on-background);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;

                // 点击事件：打开项目看板
                projectEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openProjectKanban(projectId);
                });

                // 鼠标悬停效果
                projectLink.addEventListener('mouseenter', () => {
                    projectLink.style.color = 'var(--b3-theme-primary)';
                });
                projectLink.addEventListener('mouseleave', () => {
                    projectLink.style.color = 'var(--b3-theme-on-background)';
                });

                projectEl.appendChild(projectIcon);
                projectEl.appendChild(projectLink);

                // 将项目信息添加到容器底部
                container.appendChild(projectEl);
            }
        } catch (error) {
            console.warn('获取项目信息失败:', error);
            // 静默失败，不影响主要功能
        }
    }



    private async buildMilestoneMap() {
        this.milestoneMap.clear();
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectData = await this.plugin.loadProjectData() || {};

            for (const projectId in projectData) {
                const project = projectData[projectId];
                const projectName = project.name || projectId;

                // 1. 默认里程碑
                (project.milestones || []).forEach((ms: any) => {
                    this.milestoneMap.set(ms.id, { name: ms.name, icon: ms.icon, projectId, projectName, blockId: ms.blockId });
                });

                // 2. 分组里程碑
                const projectGroups = await projectManager.getProjectCustomGroups(projectId);
                projectGroups.forEach((group: any) => {
                    (group.milestones || []).forEach((ms: any) => {
                        this.milestoneMap.set(ms.id, { name: ms.name, icon: ms.icon, projectId, projectName: `${projectName} - ${group.name}`, blockId: ms.blockId });
                    });
                });
            }
        } catch (error) {
            console.error('ReminderPanel 构造里程碑映射失败:', error);
        }
    }




    private applyCategoryFilter(reminders: any[]): any[] {
        if (this.selectedCategories.length === 0 || this.selectedCategories.includes('all')) {
            return reminders;
        }

        return reminders.filter(reminder => {
            const categoryIdStr = reminder.categoryId || 'none';
            // 支持多分类：只要任务包含选中的任意一个分类即可显示
            const taskCategoryIds = categoryIdStr.split(',').filter((id: string) => id);

            if (taskCategoryIds.length === 0) {
                return this.selectedCategories.includes('none');
            }

            return taskCategoryIds.some((id: string) => this.selectedCategories.includes(id));
        });
    }

    private applySearchFilter(reminders: any[]): any[] {
        if (!this.currentSearchQuery) {
            return reminders;
        }

        // 将搜索查询按空格分割成多个词，实现AND搜索
        const searchTerms = this.currentSearchQuery.trim().split(/\s+/).filter(term => term.length > 0);

        return reminders.filter(reminder => {
            const searchableText = [
                reminder.title || '',
                reminder.note || '',
                reminder.categoryId || ''
            ].join(' ').toLowerCase();

            // 所有搜索词都必须匹配（AND逻辑）
            return searchTerms.every(term => searchableText.includes(term.toLowerCase()));
        });
    }


    // 显示排序菜单对话框（支持多选和拖拽排序）
    private showSortMenu(event: MouseEvent) {
        try {
            const dialog = new SortMenuDialog({
                plugin: this.plugin,
                currentCriteria: this.currentSortCriteria,
                onSave: async (criteria) => {
                    // 点击关闭时也会触发，确保配置已保存
                    try {
                        this.currentSortCriteria = criteria;
                        this.updateSortButtonTitle();
                        await saveSortConfig(this.plugin, criteria);
                    } catch (error) {
                        console.error('保存排序配置失败:', error);
                    }
                },
                onChange: async (criteria) => {
                    // 实时更新排序
                    try {
                        this.currentSortCriteria = criteria;
                        this.updateSortButtonTitle();
                        await saveSortConfig(this.plugin, criteria);
                        // 重置分页状态
                        this.currentPage = 1;
                        this.totalPages = 1;
                        this.totalItems = 0;
                        await this.loadReminders();
                    } catch (error) {
                        console.error('实时更新排序失败:', error);
                    }
                }
            });
            dialog.show();
        } catch (error) {
            console.error('显示排序菜单失败:', error);
        }
    }
    /**
     * 判断任务是否应该被折叠
     * 优先考虑用户手动展开，其次是collapsedTasks集合，
     * 如果都没有，则使用默认行为：父任务默认折叠（如果有子任务）
     */
    private isTaskCollapsed(taskId: string, hasChildren: boolean = false): boolean {
        // 优先检查持久化的 fold 属性
        const reminder = this.allRemindersMap ? this.allRemindersMap.get(taskId) : null;
        if (reminder && reminder.fold !== undefined) {
            return reminder.fold;
        }

        if (this.userExpandedTasks.has(taskId)) {
            return false; // 用户手动展开的任务不折叠
        } else if (this.collapsedTasks.has(taskId)) {
            return true; // 明确标记为折叠的任务
        } else {
            // 默认行为：父任务（有子任务）默认折叠
            return hasChildren;
        }
    }

    /**
     * 获取给定提醒的所有后代 id（深度优先）
     */
    private getAllDescendantIds(id: string, reminderMap: Map<string, any>): string[] {
        const result: string[] = [];
        const stack = [id];
        const visited = new Set<string>(); // 防止循环引用
        visited.add(id);

        while (stack.length > 0) {
            const curId = stack.pop()!;
            for (const r of reminderMap.values()) {
                if (r.parentId === curId && !visited.has(r.id)) {
                    result.push(r.id);
                    stack.push(r.id);
                    visited.add(r.id);
                }
            }
        }
        return result;
    }

    /**
     * Recursive completion of all child tasks (including recurring instance ghosts).
     */
    private async completeAllChildTasks(parentId: string, reminderData: any, affectedBlockIds: Set<string>, instanceDate?: string): Promise<void> {
        // 1. Ghost Subtasks: Children of the original parent (recurse with instanceDate)
        const ghostChildren = (Object.values(reminderData) as any[]).filter(r => r.parentId === parentId);

        for (const child of ghostChildren) {
            if (instanceDate) {
                // If it's a recurring instance completion, we mark the corresponding ghost subtask as complete
                if (!child.repeat) child.repeat = {};
                if (!child.repeat.completedInstances) child.repeat.completedInstances = [];
                if (!child.repeat.completedTimes) child.repeat.completedTimes = {};

                if (!child.repeat.completedInstances.includes(instanceDate)) {
                    child.repeat.completedInstances.push(instanceDate);
                    child.repeat.completedTimes[instanceDate] = getLocalDateTimeString(new Date());
                    if (child.blockId) affectedBlockIds.add(child.blockId);
                }
                // Recurse to children's children (passing instanceDate to continue ghost chain)
                await this.completeAllChildTasks(child.id, reminderData, affectedBlockIds, instanceDate);
            } else {
                // Regular completion
                if (!child.completed) {
                    child.completed = true;
                    child.completedTime = getLocalDateTimeString(new Date());
                    if (child.blockId) affectedBlockIds.add(child.blockId);
                }
                // Recurse to children's children
                await this.completeAllChildTasks(child.id, reminderData, affectedBlockIds);
            }
        }

        // 2. Regular Subtasks of the Instance: Children of parentId_instanceDate (recurse WITHOUT instanceDate)
        if (instanceDate) {
            const instanceId = `${parentId}_${instanceDate}`;
            const instanceChildren = (Object.values(reminderData) as any[]).filter(r => r.parentId === instanceId);

            for (const child of instanceChildren) {
                if (!child.completed) {
                    child.completed = true;
                    child.completedTime = getLocalDateTimeString(new Date());
                    if (child.blockId) affectedBlockIds.add(child.blockId);
                }
                // These are regular tasks now, so recurse without instanceDate
                await this.completeAllChildTasks(child.id, reminderData, affectedBlockIds);
            }
        }
    }

    /**
     * 更新父任务底部的进度条显示（如果父任务当前显示）
     * @param parentId 父任务ID
     */


    /**
     * 获取给定提醒的所有祖先 id（从直接父到最顶层）
     */
    private getAllAncestorIds(id: string, reminderMap: Map<string, any>): string[] {
        const result: string[] = [];
        let current = reminderMap.get(id);
        // console.log(`获取任务 ${id} 的祖先, 当前任务:`, current);

        while (current && current.parentId) {
            // console.log(`找到父任务: ${current.parentId}`);
            if (result.includes(current.parentId)) {
                // console.log(`检测到循环引用，停止查找`);
                break; // 防止循环引用
            }
            result.push(current.parentId);
            current = reminderMap.get(current.parentId);
            // console.log(`父任务详情:`, current);
        }

        // console.log(`任务 ${id} 的所有祖先:`, result);
        return result;
    }

    /**
     * 从当前缓存获取所有后代 id
     */
    private getDescendantIdsFromCache(parentId: string): string[] {
        const reminderMap = new Map<string, any>();
        this.currentRemindersCache.forEach((r: any) => reminderMap.set(r.id, r));
        return this.getAllDescendantIds(parentId, reminderMap);
    }

    /**
     * 隐藏指定父任务的所有后代 DOM 元素（不刷新数据）
     */
    private hideAllDescendants(parentId: string) {
        try {
            const descendantIds = this.getDescendantIdsFromCache(parentId);
            for (const id of descendantIds) {
                const el = this.remindersContainer.querySelector(`[data-reminder-id="${id}"]`) as HTMLElement | null;
                if (el) el.style.display = 'none';
            }
        } catch (e) {
            console.error('hideAllDescendants failed', e);
        }
    }

    /**
     * 展示指定父任务的直接子项，并递归展示那些用户已手动展开的子树
     */
    private async showChildrenRecursively(parentId: string) {
        // 防护：如果未传入 parentId（意外调用），直接返回，避免 ReferenceError
        if (!parentId) return;
        try {
            // 优先从当前缓存查找子项
            let children = this.currentRemindersCache.filter(r => r.parentId === parentId).sort((a, b) => (a.sort || 0) - (b.sort || 0));

            // 如果当前缓存没有子项（例如因分页/刷新被截断），尝试从完整的 allRemindersMap 中加载子项
            if (children.length === 0 && this.allRemindersMap) {
                children = [];
                this.allRemindersMap.forEach(r => {
                    if (r.parentId === parentId) children.push(r);
                });
                children.sort((a, b) => (a.sort || 0) - (b.sort || 0));
            }

            // 找到父元素用于插入位置和层级计算
            const parentEl = this.remindersContainer.querySelector(`[data-reminder-id="${parentId}"]`) as HTMLElement | null;
            const parentLevel = parentEl ? parseInt(parentEl.getAttribute('data-level') || '0') : 0;

            // 插入顺序：紧跟在父元素后或者已插入的最后一个子元素之后
            let insertAfterEl: HTMLElement | null = parentEl;
            for (const child of children) {
                let el = this.remindersContainer.querySelector(`[data-reminder-id="${child.id}"]`) as HTMLElement | null;

                if (el) {
                    // 如果元素存在，显示出来
                    el.style.display = '';
                    // 如果异步数据已缓存，更新元素中的番茄钟显示，避免需刷新才能看到数据
                    try {
                        const cachedInfo = this.asyncDataCache && this.asyncDataCache.get(child.id);
                        if (cachedInfo) {
                            const pomEl = el.querySelector('.reminder-item__pomodoro-count') as HTMLElement | null;
                            if (pomEl) {
                                const totalCount = cachedInfo.pomodoroCount || 0;
                                const todayCount = cachedInfo.todayPomodoroCount || 0;
                                const focusTimeMinutes = cachedInfo.focusTime || 0;
                                const todayFocusMinutes = cachedInfo.todayFocusTime || 0;
                                const formatMinutesToString = (minutes: number) => {
                                    const hours = Math.floor(minutes / 60);
                                    const mins = Math.floor(minutes % 60);
                                    if (hours > 0) return `${hours}h ${mins}m`;
                                    return `${mins}m`;
                                };
                                const totalFocusText = focusTimeMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusTimeMinutes)}` : '';
                                const todayFocusText = (todayFocusMinutes > 0 || totalCount > 0) ? ` ⏱ ${formatMinutesToString(todayFocusMinutes)}` : '';
                                const totalLine = (totalCount > 0 || focusTimeMinutes > 0) ? `<span title="累计完成的番茄钟: ${totalCount}">🍅 ${totalCount}</span><span title="总专注时长: ${focusTimeMinutes} 分钟" style="margin-left:8px; opacity:0.9;">${totalFocusText}</span>` : '';
                                const todayLine = (todayCount > 0 || todayFocusMinutes > 0 || totalCount > 0) ? `<div style="margin-top:6px; font-size:12px; opacity:0.95;"><span title='今日完成的番茄钟: ${todayCount}'>今日: 🍅 ${todayCount}</span><span title='今日专注时长: ${todayFocusMinutes} 分钟' style='margin-left:8px'>${todayFocusText}</span></div>` : '';

                                const focusTimeText = focusTimeMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusTimeMinutes)}` : '';
                                pomEl.innerHTML = `${totalLine}${todayLine}`;
                            }
                        }
                    } catch (updateErr) {
                        // ignore DOM update errors
                    }
                } else {
                    // 元素不存在：尝试基于所有可见提醒和默认数据创建元素（缺省 asyncDataCache）
                    try {
                        const today = getLogicalDateString();
                        const asyncCache = this.asyncDataCache && this.asyncDataCache.size > 0 ? this.asyncDataCache : new Map<string, any>();
                        const allVisible = this.currentRemindersCache.concat(children);
                        // 如果 asyncCache 中没有 child 的数据，提前加载以避免闪烁
                        if (!asyncCache.has(child.id)) {
                            try {
                                const count = await this.getReminderPomodoroCount(child.id, child, this.allRemindersMap || undefined);
                                const focusTime = await this.getReminderFocusTime(child.id, child, this.allRemindersMap || undefined);
                                const todayCount = await this.getReminderTodayPomodoroCount(child.id, child, this.allRemindersMap || undefined);
                                const todayFocus = await this.getReminderTodayFocusTime(child.id, child, this.allRemindersMap || undefined);
                                asyncCache.set(child.id, { pomodoroCount: count, focusTime: focusTime || 0, todayPomodoroCount: todayCount || 0, todayFocusTime: todayFocus || 0, project: null });
                                // keep in instance cache as well
                                this.asyncDataCache.set(child.id, asyncCache.get(child.id));
                            } catch (e) {
                                // ignore
                            }
                        }
                        el = this.createReminderElementOptimized(child, asyncCache, today, parentLevel + 1, allVisible);

                        // 插入到 DOM：在 insertAfterEl 之后
                        if (insertAfterEl && insertAfterEl.parentNode) {
                            if (insertAfterEl.nextSibling) {
                                insertAfterEl.parentNode.insertBefore(el, insertAfterEl.nextSibling);
                            } else {
                                insertAfterEl.parentNode.appendChild(el);
                            }
                        } else {
                            // 作为兜底，追加到容器末尾
                            this.remindersContainer.appendChild(el);
                        }

                        // 将该子项同步加入 currentRemindersCache 的合适位置（紧跟父后）
                        const parentIndex = this.currentRemindersCache.findIndex(r => r.id === parentId);
                        const insertIndex = parentIndex >= 0 ? parentIndex + 1 : this.currentRemindersCache.length;
                        this.currentRemindersCache.splice(insertIndex, 0, child);
                        this.totalItems = Math.max(this.totalItems, this.currentRemindersCache.length);
                    } catch (err) {
                        console.error('failed to create child element on expand', err);
                        continue;
                    }
                }

                // 更新 insertAfterEl 为当前子元素，确保多个子项按顺序插入
                insertAfterEl = el;

                // 如果用户手动展开了该 child，则继续展示其子项（递归）
                if (this.userExpandedTasks.has(child.id)) {
                    await this.showChildrenRecursively(child.id);
                }
            }
        } catch (e) {
            console.error('showChildrenRecursively failed', e);
        }
    }


    private async loadReminders(force: boolean = false) {
        // 防止重复加载，但当传入 force 时强制重新加载
        if (this.isLoading && !force) {
            // console.log('任务正在加载中，跳过本次加载请求');
            return;
        }

        // 如果强制刷新，重置正在加载标志以允许覆盖进行中的加载
        if (force) {
            this.isLoading = false;
        }

        this.isLoading = true;

        // 保存当前滚动位置
        const scrollTop = this.remindersContainer.scrollTop;
        const scrollLeft = this.remindersContainer.scrollLeft;

        try {
            // 构造里程碑映射
            await this.buildMilestoneMap();

            const reminderData = await getAllReminders(this.plugin, undefined, force, 'sidebar');
            if (!reminderData || typeof reminderData !== 'object') {
                this.updateReminderCounts(0, 0, 0, 0, 0, 0);
                this.renderReminders([]);
                return;
            }

            const today = getLogicalDateString();
            const allRemindersWithInstances = this.generateAllRemindersWithInstances(reminderData, today);

            // 过滤已归档分组的未完成任务
            const filteredReminders = await this.filterArchivedGroupTasks(allRemindersWithInstances);

            // 构造 map 便于查找父子关系
            const reminderMap = new Map<string, any>();
            filteredReminders.forEach(r => reminderMap.set(r.id, r));

            // 将所有任务保存到 allRemindersMap 中，用于后续计算进度
            this.allRemindersMap = new Map(reminderMap);

            // 1. 应用分类过滤
            const categoryFilteredReminders = this.applyCategoryFilter(filteredReminders);

            // 2. 根据当前Tab（日期/状态）进行筛选，得到直接匹配的提醒
            const directlyMatchingReminders = this.filterRemindersByTab(categoryFilteredReminders, today);

            // 3. 实现父/子驱动逻辑
            const idsToRender = new Set<string>();

            // 添加所有直接匹配的提醒
            directlyMatchingReminders.forEach(r => idsToRender.add(r.id));

            // 父任务驱动: 如果父任务匹配，其所有后代都应显示
            for (const parent of directlyMatchingReminders) {
                const descendants = this.getAllDescendantIds(parent.id, reminderMap);
                descendants.forEach(id => {
                    // 如果父任务未完成且开关关闭，不显示已完成的子任务
                    if (!parent.completed && !this.showCompletedSubtasks) {
                        const descendant = reminderMap.get(id);
                        if (descendant && descendant.completed) {
                            return; // 跳过已完成的子任务
                        }
                    }
                    idsToRender.add(id);
                });
            }

            // 子任务驱动: 如果子任务匹配，其所有祖先都应显示
            // 但是对于已完成的视图（completed / todayCompleted），仅当祖先也已完成时才显示祖先（父任务未完成时只展示子任务）
            const isCompletedView = this.currentTab === 'completed' || this.currentTab === 'todayCompleted';
            for (const child of directlyMatchingReminders) {
                const ancestors = this.getAllAncestorIds(child.id, reminderMap);
                ancestors.forEach(ancestorId => {
                    if (!isCompletedView) {
                        idsToRender.add(ancestorId);
                    } else {
                        const anc = reminderMap.get(ancestorId);
                        // 仅当祖先被标记为完成或其跨天事件在今日被标记为已完成时添加
                        if (anc) {
                            const ancCompleted = !!anc.completed || this.isSpanningEventTodayCompleted(anc);
                            if (ancCompleted) {
                                idsToRender.add(ancestorId);
                            }
                        }
                    }
                });
            }


            // 4. 组装最终要显示的提醒列表（所有被标记为需要渲染的提醒）
            // 修改：从所有提醒中筛选，而不是从分类过滤后的提醒中筛选
            // 这样可以确保祖先任务即使不满足分类筛选也能显示
            let displayReminders = allRemindersWithInstances.filter(r => idsToRender.has(r.id));

            // 5. 应用搜索过滤
            displayReminders = this.applySearchFilter(displayReminders);

            this.sortReminders(displayReminders);
            this.currentRemindersCache = [...displayReminders];

            // 分页逻辑：按顶级父任务数进行分页（每页 N 个父任务及其子任务），避免父子被拆分
            let truncatedTotal = 0;
            if (this.isPaginationEnabled) {
                const remMap = new Map<string, any>();
                displayReminders.forEach(r => remMap.set(r.id, r));

                // 找到根节点（在当前 displayReminders 集合中没有父节点的项）
                const roots = displayReminders.filter(r => !r.parentId || !remMap.has(r.parentId));

                // 计算以父任务为单位的分页信息
                const totalParents = roots.length;
                this.totalItems = totalParents; // 总项数表示为父任务数量
                this.totalPages = Math.max(1, Math.ceil(totalParents / this.itemsPerPage));

                // 仅当有多页时才进行按父任务分页截断
                if (this.totalPages > 1) {
                    // 构建每个根节点对应的组（包含所有后代，按 displayReminders 中的顺序）
                    const idToChildren = new Map<string, any[]>();
                    displayReminders.forEach(r => {
                        if (r.parentId && remMap.has(r.parentId)) {
                            const arr = idToChildren.get(r.parentId) || [];
                            arr.push(r);
                            idToChildren.set(r.parentId, arr);
                        }
                    });

                    const buildGroup = (root: any) => {
                        const group: any[] = [];
                        const queue: any[] = [root];
                        while (queue.length > 0) {
                            const cur = queue.shift();
                            group.push(cur);
                            const children = idToChildren.get(cur.id) || [];
                            for (const c of children) queue.push(c);
                        }
                        return group;
                    };

                    const groups = roots.map(r => buildGroup(r));

                    const startParent = (this.currentPage - 1) * this.itemsPerPage;
                    const endParent = startParent + this.itemsPerPage;
                    const selectedRoots = roots.slice(startParent, endParent);

                    // 将选中的父组展开为页面项
                    const pageItems: any[] = [];
                    for (const root of selectedRoots) {
                        const g = buildGroup(root);
                        pageItems.push(...g);
                    }

                    const originalLength = displayReminders.length;
                    truncatedTotal = Math.max(0, originalLength - pageItems.length);
                    displayReminders = pageItems;
                    this.currentRemindersCache = [...displayReminders];
                } else {
                    // 仅一页，全部展示
                    this.currentRemindersCache = [...displayReminders];
                    this.totalItems = totalParents;
                    this.totalPages = 1;
                }
            } else {
                // 未启用分页：总项为实际提醒数
                this.totalItems = displayReminders.length;
                this.totalPages = 1;
                this.currentRemindersCache = [...displayReminders];
            }

            // 5. 预处理异步数据以提高渲染性能（传入完整 reminderData 以便准确检测子代）
            const asyncDataCache = await this.preprocessAsyncData(displayReminders, reminderData);
            // 保存到实例级缓存，供动态展开子任务时复用
            this.asyncDataCache = asyncDataCache;

            // 6. 清理之前的内容并渲染新内容
            this.remindersContainer.innerHTML = '';
            const topLevelReminders = displayReminders.filter(r => !r.parentId || !displayReminders.some(p => p.id === r.parentId));

            if (topLevelReminders.length === 0) {
                this.remindersContainer.innerHTML = `<div class="reminder-empty">${i18n("noReminders")}</div>`;
                return;
            }

            // 使用优化的迭代渲染方法
            // 使用迭代式渲染替换递归渲染
            await this.renderRemindersIteratively(displayReminders, asyncDataCache, today);

            // 立即恢复滚动位置，避免滚动跳动
            this.remindersContainer.scrollTop = scrollTop;
            this.remindersContainer.scrollLeft = scrollLeft;

            // 总是先移除旧的分页控件，确保切换筛选条件时能正确隐藏
            const existingControls = this.container.querySelector('.reminder-pagination-controls');
            if (existingControls) {
                existingControls.remove();
            }

            // 如果有被截断的项，添加分页提示
            if (truncatedTotal > 0 || (this.isPaginationEnabled && this.totalPages > 1)) {
                this.renderPaginationControls(truncatedTotal);
            }

        } catch (error) {
            console.error('加载提醒失败:', error);
            showMessage(i18n("loadRemindersFailed"));
        } finally {
            this.isLoading = false;
        }
    }
    /**
     * 预处理异步数据以提高渲染性能
     * @param reminders 要渲染的任务列表
     * @returns 异步数据缓存
     */
    private async preprocessAsyncData(reminders: any[], reminderDataFull?: any): Promise<Map<string, any>> {
        const asyncDataCache = new Map<string, any>();

        // 批量获取番茄钟计数和总专注时长（分钟）
        const pomodoroPromises = reminders.map(async (reminder) => {
            try {
                // 每个实例使用自己的ID来获取独立的番茄钟计数
                const fullData = reminderDataFull || reminders;
                const count = await this.getReminderPomodoroCount(reminder.id, reminder, fullData);
                // focusTime in minutes
                const focusTime = await this.getReminderFocusTime(reminder.id, reminder, fullData);
                // 今日番茄钟计数（使用今天的日期，而不是任务的截止日期）
                // 今日番茄钟计数（使用今天的日期，而不是任务的截止日期）
                const todayCount = await this.getReminderTodayPomodoroCount(reminder.id, reminder, fullData);
                const todayFocus = await this.getReminderTodayFocusTime(reminder.id, reminder, fullData);

                let totalRepeatingCount = 0;
                let totalRepeatingFocus = 0;
                if (reminder.isRepeatInstance) {
                    totalRepeatingCount = await this.getReminderRepeatingTotalPomodoroCount(reminder.originalId);
                    totalRepeatingFocus = await this.getReminderRepeatingTotalFocusTime(reminder.originalId);
                }

                return { id: reminder.id, pomodoroCount: count, focusTime, todayPomodoroCount: todayCount, todayFocusTime: todayFocus, totalRepeatingPomodoroCount: totalRepeatingCount, totalRepeatingFocusTime: totalRepeatingFocus };
            } catch (error) {
                console.warn(`获取任务 ${reminder.id} 的番茄钟计数失败:`, error);
                return { id: reminder.id, pomodoroCount: 0, focusTime: 0, todayPomodoroCount: 0, todayFocusTime: 0, totalRepeatingPomodoroCount: 0, totalRepeatingFocusTime: 0 };
            }
        });

        // 批量获取项目信息
        const projectPromises = reminders
            .filter(reminder => reminder.projectId)
            .map(async (reminder) => {
                try {
                    const projectData = await this.plugin.loadProjectData();
                    const project = projectData[reminder.projectId];
                    return { id: reminder.id, project };
                } catch (error) {
                    console.warn(`获取任务 ${reminder.id} 的项目信息失败:`, error);
                    return { id: reminder.id, project: null };
                }
            });

        // 并行执行所有异步操作
        const [pomodoroResults, projectResults] = await Promise.all([
            Promise.all(pomodoroPromises),
            Promise.all(projectPromises)
        ]);

        // 构建缓存
        pomodoroResults.forEach(result => {
            asyncDataCache.set(result.id, {
                pomodoroCount: result.pomodoroCount,
                focusTime: result.focusTime || 0,
                todayPomodoroCount: result.todayPomodoroCount || 0,
                todayFocusTime: result.todayFocusTime || 0,
                totalRepeatingPomodoroCount: result.totalRepeatingPomodoroCount || 0,
                totalRepeatingFocusTime: result.totalRepeatingFocusTime || 0,
                project: null
            });
        });

        projectResults.forEach(result => {
            if (asyncDataCache.has(result.id)) {
                asyncDataCache.get(result.id).project = result.project;
            } else {
                asyncDataCache.set(result.id, {
                    pomodoroCount: 0,
                    todayPomodoroCount: 0,
                    todayFocusTime: 0,
                    project: result.project
                });
            }
        });

        return asyncDataCache;
    }

    /**
     * 迭代式渲染提醒任务，使用队列避免递归深度限制
     * @param reminders 要渲染的任务列表
     * @param asyncDataCache 预处理的异步数据缓存
     * @param today 今天的日期字符串
     */
    private renderRemindersIteratively(reminders: any[], asyncDataCache: Map<string, any>, today: string) {
        // 清空容器
        this.remindersContainer.innerHTML = '';

        // 使用 DocumentFragment 进行批量 DOM 操作
        const fragment = document.createDocumentFragment();

        // 创建队列来处理任务渲染（广度优先）
        const renderQueue: Array<{ reminder: any; level: number }> = [];

        // 初始化队列：只添加顶级任务（没有父任务的任务）
        // 注意：如果某个任务的父任务不在当前可见列表中，也应当将其视为顶级（例如祖先被过滤掉的情况）
        const topLevelReminders = reminders.filter(r => !r.parentId || !reminders.some(p => p.id === r.parentId));
        topLevelReminders.forEach(reminder => renderQueue.push({ reminder, level: 0 }));

        // 处理渲染队列
        while (renderQueue.length > 0) {
            const { reminder, level } = renderQueue.shift()!;

            try {
                // 创建任务元素（使用预处理的异步数据）
                const element = this.createReminderElementOptimized(reminder, asyncDataCache, today, level, reminders);

                // 添加到文档片段

                // 检查是否需要插入分隔符 (Daily Dessert Separator)
                // 我们假设 renderQueue 按照顺序处理 (topLevelReminders 是有序的)
                // 如果当前任务是第一个 Daily Dessert，且前面有非 Dessert 任务，插入分隔符
                // 但是 topLevelReminders 可能是乱序进入 queue? No, sorted before loop.
                // Wait, reminders passed to this function ARE sorted by sortReminders().
                // And sortReminders puts desserts at bottom.
                // So checking transition is enough.

                // 只有 top-level 任务需要分隔符。
                if (level === 0 && (this.currentTab === 'today' || this.currentTab === 'todayCompleted')) {
                    // 定义分组类型：0-普通任务, 1-订阅任务, 2-底部任务(每日可做/今日忽略)
                    const getGroupType = (item: any) => {
                        let isBottomGroup = false;
                        if (this.currentTab === 'today') {
                            isBottomGroup = item.isAvailableToday && (!item.date && !item.endDate || (item.date || item.endDate) !== today);
                        } else if (this.currentTab === 'todayCompleted') {
                            const dailyIgnored = Array.isArray(item.dailyDessertIgnored) ? item.dailyDessertIgnored : [];
                            const dailyCompleted = Array.isArray(item.dailyDessertCompleted) ? item.dailyDessertCompleted : [];
                            isBottomGroup = item.isAvailableToday && dailyIgnored.includes(today) && !dailyCompleted.includes(today);
                        }

                        if (isBottomGroup) return 2;
                        if (item.isSubscribed) return 1;
                        return 0;
                    };

                    const currentType = getGroupType(reminder);
                    const prevIndex = topLevelReminders.indexOf(reminder) - 1;
                    const prevType = prevIndex >= 0 ? getGroupType(topLevelReminders[prevIndex]) : -1;

                    // 当类型发生变化且当前不是普通任务时，插入对应的分隔符
                    if (currentType > 0 && currentType !== prevType) {
                        let separatorText = '';
                        let separatorId = '';

                        if (currentType === 1) { // 订阅日历
                            separatorText = i18n('subscribedTask');
                            separatorId = 'subscribed-tasks-separator';
                        } else if (currentType === 2) { // 每日可做/今日忽略
                            separatorText = this.currentTab === 'todayCompleted' ? i18n('todayIgnored') : i18n('dailyAvailable');
                            separatorId = 'daily-dessert-separator';
                        }

                        if (separatorText && !fragment.querySelector('#' + separatorId)) {
                            const separator = document.createElement('div');
                            separator.id = separatorId;
                            separator.className = `reminder-separator ${separatorId}`;
                            separator.innerHTML = `<span style="padding:0 8px;">${separatorText}</span>`;
                            separator.style.cssText = `
                                display: flex; 
                                align-items: center; 
                                justify-content: center; 
                                margin: 16px 0 8px 0; 
                                font-size: 12px; 
                                color: var(--b3-theme-on-surface-light);
                                opacity: 0.8;
                            `;

                            // 添加左右横线装饰
                            const lineStyle = 'flex: 1; height: 1px; background: var(--b3-theme-surface-lighter);';
                            separator.insertAdjacentHTML('afterbegin', `<div style="${lineStyle}"></div>`);
                            separator.insertAdjacentHTML('beforeend', `<div style="${lineStyle}"></div>`);

                            fragment.appendChild(separator);
                        }
                    }
                }

                fragment.appendChild(element);

                // 如果任务有子任务且未折叠，添加到队列中
                const hasChildren = reminders.some(r => r.parentId === reminder.id);
                // 传入 hasChildren 给 isTaskCollapsed，保证折叠判定在渲染时与元素创建时一致
                if (hasChildren && !this.isTaskCollapsed(reminder.id, hasChildren)) {
                    const children = reminders.filter(r => r.parentId === reminder.id);
                    // 按排序添加子任务到队列前面（深度优先）
                    for (let i = children.length - 1; i >= 0; i--) {
                        renderQueue.unshift({ reminder: children[i], level: level + 1 });
                    }
                }
            } catch (error) {
                console.error(`渲染任务 ${reminder.id} 失败:`, error);
                // 继续处理其他任务
            }
        }

        // 一次性添加到 DOM
        this.remindersContainer.appendChild(fragment);

        // 更新任务总数
        this.totalItems = reminders.length;
    }

    /**
     * 获取按深度优先（DFS）遍历的可见任务 ID 序列
     * 逻辑与 renderRemindersIteratively 保持一致，用于确定乐观插入时的 DOM 位置
     */
    private getVisualOrderIds(reminders: any[]): string[] {
        if (!reminders || reminders.length === 0) return [];

        // 顶级任务：没有父任务，或者父任务不在当前显示列表中
        const topLevelReminders = reminders.filter(r => !r.parentId || !reminders.some(p => p.id === r.parentId));

        const order: string[] = [];
        // 模拟 renderRemindersIteratively 的 DFS 渲染逻辑
        const renderQueue: any[] = [...topLevelReminders];

        while (renderQueue.length > 0) {
            const reminder = renderQueue.shift();
            order.push(reminder.id);

            const children = reminders.filter(r => r.parentId === reminder.id);
            const hasChildren = children.length > 0;

            // 如果未折叠，则处理其子任务的遍历
            if (hasChildren && !this.isTaskCollapsed(reminder.id, hasChildren)) {
                // 按 sorted 顺序逆序插入队列前端，保证 shift 出的是 DFS 正序
                for (let i = children.length - 1; i >= 0; i--) {
                    renderQueue.unshift(children[i]);
                }
            }
        }
        return order;
    }

    /**
     * 创建优化的提醒元素，使用预处理的异步数据缓存
     * @param reminder 提醒对象
     * @param asyncDataCache 预处理的异步数据缓存
     * @param today 今天的日期字符串
     * @param level 层级深度
     * @param allVisibleReminders 所有可见的提醒列表
     * @returns HTMLElement
     */
    private createReminderElementOptimized(reminder: any, asyncDataCache: Map<string, any>, today: string, level: number = 0, allVisibleReminders: any[] = []): HTMLElement {
        // 改进过期判断逻辑
        let isOverdue = false;
        if (!reminder.completed && reminder.date) {
            const startLogical = this.getReminderLogicalDate(reminder.date, reminder.time);
            const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
            if (reminder.endDate) {
                isOverdue = compareDateStrings(endLogical, today) < 0;
            } else {
                isOverdue = compareDateStrings(startLogical, today) < 0;
            }
        }

        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;
        const priority = reminder.priority || 'none';
        const hasChildren = allVisibleReminders.some(r => r.parentId === reminder.id);
        // 使用统一的方法判断任务是否应该被折叠
        const isCollapsed: boolean = this.isTaskCollapsed(reminder.id, hasChildren);

        // 计算子任务的层级深度，用于显示层级指示
        let maxChildDepth = 0;
        if (hasChildren) {
            const calculateDepth = (id: string, currentDepth: number): number => {
                const children = allVisibleReminders.filter(r => r.parentId === id);
                if (children.length === 0) return currentDepth;

                let maxDepth = currentDepth;
                for (const child of children) {
                    const childDepth = calculateDepth(child.id, currentDepth + 1);
                    maxDepth = Math.max(maxDepth, childDepth);
                }
                return maxDepth;
            };
            maxChildDepth = calculateDepth(reminder.id, 0);
        }

        const reminderEl = document.createElement('div');
        reminderEl.className = `reminder-item ${isOverdue ? 'reminder-item--overdue' : ''} ${isSpanningDays ? 'reminder-item--spanning' : ''} reminder-priority-${priority}`;

        // 子任务缩进：使用margin-left让整个任务块缩进，包括背景色
        if (level > 0) {
            reminderEl.style.marginLeft = `${level * 20}px`;
            // 为子任务添加层级数据属性，用于CSS样式
            reminderEl.setAttribute('data-level', level.toString());
        }

        // 为有深层子任务的父任务添加额外的视觉提示
        if (hasChildren && maxChildDepth > 1) {
            reminderEl.setAttribute('data-has-deep-children', maxChildDepth.toString());
            reminderEl.classList.add('reminder-item--has-deep-children');
        }

        // 优先级背景色和边框设置
        let backgroundColor = '';
        let borderColor = '';
        switch (priority) {
            case 'high':
                backgroundColor = colorWithOpacity('var(--b3-card-error-background)', 0.5);
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = colorWithOpacity('var(--b3-card-warning-background)', 0.5);
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = colorWithOpacity('var(--b3-card-info-background)', 0.7);
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = colorWithOpacity('var(--b3-theme-background-light)', 0.1);
                borderColor = 'var(--b3-theme-surface-lighter)';
        }
        reminderEl.style.backgroundColor = backgroundColor;
        reminderEl.style.border = `2px solid ${borderColor}`;

        reminderEl.dataset.reminderId = reminder.id;
        reminderEl.dataset.priority = priority;

        // 所有任务均启用拖拽功能（支持排序）
        this.addDragFunctionality(reminderEl, reminder);

        // Ctrl+Click 进入/切换多选模式；Shift+Click 范围选择
        reminderEl.addEventListener('click', (e: MouseEvent) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                if (!this.isMultiSelectMode) {
                    this.isMultiSelectMode = true;
                }
                this.togglePanelReminderSelection(reminder.id, reminderEl);
                this.lastClickedReminderId = reminder.id;
            } else if (e.shiftKey && this.isMultiSelectMode && this.lastClickedReminderId) {
                e.preventDefault();
                e.stopPropagation();
                this.selectRangeInPanel(this.lastClickedReminderId, reminder.id);
            }
        }, true);

        // 如果当前已处于选中状态，应用选中样式
        if (this.selectedReminderIds.has(reminder.id)) {
            reminderEl.classList.add('reminder-item--selected');
        }

        reminderEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // 多选模式下显示批量操作菜单
            if (this.isMultiSelectMode) {
                if (!this.selectedReminderIds.has(reminder.id)) {
                    this.togglePanelReminderSelection(reminder.id, reminderEl);
                }
                this.showPanelBatchContextMenu(e);
                return;
            }
            this.showReminderContextMenu(e, reminder);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'reminder-item__content';

        // 折叠按钮和复选框容器
        const leftControls = document.createElement('div');
        leftControls.className = 'reminder-item__left-controls';

        // 复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = reminder.completed || false;
        checkbox.addEventListener('change', () => {
            if (reminder.isRepeatInstance) {
                // 使用原始实例日期（从 ID 中提取），而非可能被 instanceModifications 修改后的 date
                const originalInstanceDate = (reminder.id && reminder.id.includes('_')) ? reminder.id.split('_').pop() : reminder.date;
                this.toggleReminder(reminder.originalId, checkbox.checked, true, originalInstanceDate);
            } else {
                this.toggleReminder(reminder.id, checkbox.checked);
            }
        });

        leftControls.appendChild(checkbox);

        // 折叠按钮
        if (hasChildren) {
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text collapse-btn';
            collapseBtn.innerHTML = isCollapsed ? '<svg><use xlink:href="#iconRight"></use></svg>' : '<svg><use xlink:href="#iconDown"></use></svg>';
            collapseBtn.title = isCollapsed ? i18n("expand") : i18n("collapse");
            collapseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                // 使用统一方法判断当前状态
                const currentCollapsed = this.isTaskCollapsed(reminder.id, hasChildren);

                // 加载最新数据以便持久化 fold 属性
                const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                const targetId = reminder.isRepeatInstance ? (reminder.originalId || reminder.id) : reminder.id;
                const targetReminder = reminderData[targetId];

                if (currentCollapsed) {
                    // 当前是折叠 -> 展开
                    if (targetReminder) targetReminder.fold = false;
                    // 移除折叠状态，添加到用户展开集合
                    this.collapsedTasks.delete(reminder.id);
                    this.userExpandedTasks.add(reminder.id);
                    // 同步内存对象
                    reminder.fold = false;
                    // 递归显示子任务
                    await this.showChildrenRecursively(reminder.id);
                    // 更新按钮图标与标题
                    collapseBtn.innerHTML = '<svg><use xlink:href="#iconDown"></use></svg>';
                    collapseBtn.title = i18n("collapse");
                } else {
                    // 当前是展开 -> 折叠
                    if (targetReminder) targetReminder.fold = true;
                    // 移除用户展开状态，添加到折叠集合
                    this.userExpandedTasks.delete(reminder.id);
                    this.collapsedTasks.add(reminder.id);
                    // 同步内存对象
                    reminder.fold = true;
                    // 隐藏后代
                    this.hideAllDescendants(reminder.id);
                    // 更新按钮图标与标题
                    collapseBtn.innerHTML = '<svg><use xlink:href="#iconRight"></use></svg>';
                    collapseBtn.title = i18n("expand");
                }

                // 持久化保存
                if (targetReminder) {
                    await saveReminders(this.plugin, reminderData);
                    // 更新 allRemindersMap 以保持一致
                    if (this.allRemindersMap && this.allRemindersMap.has(reminder.id)) {
                        this.allRemindersMap.get(reminder.id).fold = reminder.fold;
                    }
                }
            });
            leftControls.appendChild(collapseBtn);
        } else {
            // 占位符以对齐
            const spacer = document.createElement('div');
            spacer.className = 'collapse-spacer';
            leftControls.appendChild(spacer);
        }

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'reminder-item__info';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'reminder-item__title-container';

        if (reminder.docId && reminder.blockId !== reminder.docId) {
            this.addDocumentTitle(titleContainer, reminder.docId);
        }

        const titleEl = document.createElement('span');
        titleEl.className = 'reminder-item__title';

        if (reminder.blockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${reminder.blockId}`);
            titleEl.style.cssText = `cursor: pointer; color: var(--b3-theme-primary); text-decoration: underline; text-decoration-style: dotted; font-weight: 500;`;
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openBlockTab(reminder.blockId);
            });
        } else {
            titleEl.style.cssText = `font-weight: 500; color: var(--b3-theme-on-surface); cursor: default; text-decoration: none;`;
        }

        titleEl.textContent = reminder.title || i18n("unnamedNote");
        titleEl.title = reminder.blockId ? `点击打开绑定块: ${reminder.title || i18n("unnamedNote")}` : (reminder.title || i18n("unnamedNote"));
        titleContainer.appendChild(titleEl);

        // 添加URL链接图标
        if (reminder.url) {
            const urlIcon = document.createElement('a');
            urlIcon.className = 'reminder-item__url-icon';
            urlIcon.href = reminder.url;
            urlIcon.target = '_blank';
            urlIcon.title = i18n("openUrl") + ': ' + reminder.url;
            urlIcon.innerHTML = '<svg style="width: 14px; height: 14px; vertical-align: middle; margin-left: 4px;"><use xlink:href="#iconLink"></use></svg>';
            urlIcon.style.cssText = 'color: var(--b3-theme-primary); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;';
            urlIcon.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            titleContainer.appendChild(urlIcon);
        }

        const timeContainer = document.createElement('div');
        timeContainer.className = 'reminder-item__time-container';
        timeContainer.style.cssText = `display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;`;

        if (reminder.repeat?.enabled || reminder.isRepeatInstance) {
            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'reminder-repeat-icon';
            repeatIcon.textContent = '🔄';
            repeatIcon.title = reminder.repeat?.enabled ? getRepeatDescription(reminder.repeat) : i18n("repeatInstance");
            timeContainer.appendChild(repeatIcon);
        }

        // 只显示有日期的任务的时间信息
        const displayDate = reminder.date || reminder.endDate;
        if (displayDate) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-item__time';
            const displayTime = reminder.date ? reminder.time : (reminder.endTime || reminder.time);
            const timeText = this.formatReminderTime(displayDate, displayTime, today, reminder.endDate, reminder.endTime, reminder);
            timeEl.textContent = '🗓' + timeText;
            timeEl.style.cursor = 'pointer';
            timeEl.title = i18n("clickToModifyTime");
            if (!reminder.isSubscribed) {
                timeEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // 默认编辑此实例
                    this.showTimeEditDialog(reminder);
                });
            } else {
                timeEl.title = i18n("subscribedTaskReadOnly") || "订阅任务（只读）";
                timeEl.style.cursor = 'default';
            }
            timeContainer.appendChild(timeEl);

            const countdownEl = this.createReminderCountdownElement(reminder, today);
            if (countdownEl) {
                timeContainer.appendChild(countdownEl);
            }
        }

        infoEl.appendChild(titleContainer);
        infoEl.appendChild(timeContainer);

        // 添加番茄钟计数显示（使用预处理的缓存数据），同时显示总专注时长
        const cachedData = asyncDataCache.get(reminder.id);
        if (cachedData && ((cachedData.pomodoroCount && cachedData.pomodoroCount > 0) || (cachedData.todayPomodoroCount && cachedData.todayPomodoroCount > 0) || (cachedData.focusTime && cachedData.focusTime > 0) || (cachedData.todayFocusTime && cachedData.todayFocusTime > 0) || (cachedData.totalRepeatingPomodoroCount && cachedData.totalRepeatingPomodoroCount > 0) || (cachedData.totalRepeatingFocusTime && cachedData.totalRepeatingFocusTime > 0) || reminder.estimatedPomodoroDuration)) {
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

            const totalCount = cachedData.pomodoroCount || 0;
            const todayCount = cachedData.todayPomodoroCount || 0;
            const totalFocus = cachedData.focusTime || 0;
            const todayFocus = cachedData.todayFocusTime || 0;
            // totals should be displayed with aggregated numbers
            const formattedTotalTomato = `🍅 ${totalCount}`;
            const focusTimeMinutes = cachedData.focusTime || 0;
            const formatMinutesToString = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                if (hours > 0) return `${hours}h ${mins}m`;
                return `${mins}m`;
            };
            const focusTimeText = focusTimeMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusTimeMinutes)}` : '';
            const extraCount = '';

            const totalFocusText = totalFocus > 0 ? ` ⏱ ${formatMinutesToString(totalFocus)}` : '';
            const todayFocusText = (todayFocus > 0 || totalCount > 0) ? ` ⏱ ${formatMinutesToString(todayFocus)}` : '';

            // 第一行：预计番茄时长
            const estimatedLine = reminder.estimatedPomodoroDuration ? `<span title='${i18n('estimatedPomodoro')}'>${i18n('estimated')}: ${reminder.estimatedPomodoroDuration}</span>` : '';
            // 第二行：累计/总计
            // 第二行：累计/总计
            let totalLine = '';
            let todayLine = '';

            if (reminder.isRepeatInstance) {
                const repeatingTotal = cachedData.totalRepeatingPomodoroCount || 0;
                const repeatingFocus = cachedData.totalRepeatingFocusTime || 0;
                const instanceCount = totalCount;

                const formatMinutesToString = (minutes: number) => {
                    const hours = Math.floor(minutes / 60);
                    const mins = Math.floor(minutes % 60);
                    if (hours > 0) return `${hours}h ${mins}m`;
                    return `${mins}m`;
                };
                const repeatingFocusText = repeatingFocus > 0 ? ` ⏱ ${formatMinutesToString(repeatingFocus)}` : '';
                const instanceFocusText = totalFocus > 0 ? ` ⏱ ${formatMinutesToString(totalFocus)}` : '';

                totalLine = `<div style="margin-top:${estimatedLine ? '6px' : '0'}; font-size:12px;">
                    <div title="${i18n('seriesTotalTomatoTitle')}${repeatingTotal}">
                        <span>${i18n('series')}: 🍅 ${repeatingTotal}</span>
                        <span style="margin-left:8px; opacity:0.9;">${repeatingFocusText}</span>
                    </div>
                    <div title="${i18n('instanceTomatoTitle')}${instanceCount}" style="margin-top:4px; opacity:0.95;">
                        <span>${i18n('currentInstance')}: 🍅 ${instanceCount}</span>
                        <span style="margin-left:8px; opacity:0.9;">${instanceFocusText}</span>
                    </div>
                 </div>`;

                // Do not show todayLine for repeat instances as requested
                todayLine = '';
            } else {
                totalLine = (totalCount > 0 || totalFocus > 0) ? `<div style="margin-top:${estimatedLine ? '6px' : '0'}; font-size:12px;"><span title="${i18n('totalCompletedPomodoroTitle')}${totalCount}">${i18n('total')}: ${formattedTotalTomato}${extraCount}</span><span title="${i18n('totalFocusDurationTitle')}${totalFocus} ${i18n('minutes')}" style="margin-left:8px; opacity:0.9;">${totalFocusText}</span></div>` : '';

                // 第三行：今日数据（只在总番茄不等于今日番茄时显示，即有历史数据时）
                // 判断条件：总数量大于今日数量，或者总时长大于今日时长
                const hasHistoricalData = (totalCount > todayCount) || (totalFocus > todayFocus);
                todayLine = hasHistoricalData && (todayCount > 0 || todayFocus > 0) ? `<div style="margin-top:6px; font-size:12px; opacity:0.95;"><span title='${i18n('todayCompletedPomodoroTitle')}${todayCount}'>${i18n('today')}: 🍅 ${todayCount}</span><span title='${i18n('todayFocusTimeTitle')}${todayFocus} ${i18n('minutes')}' style='margin-left:8px'>${todayFocusText}</span></div>` : '';
            }

            pomodoroDisplay.innerHTML = `${estimatedLine}${totalLine}${todayLine}`;

            // 将番茄计数添加到 timeContainer 后面
            infoEl.appendChild(pomodoroDisplay);
        }

        // 已完成任务显示透明度并显示完成时间
        // (如果是跨天任务的今日完成，或是普通已完成)
        const spanningCompletedTime = !reminder.completed && reminder.endDate ? this.getCompletedTime(reminder) : null;
        if (reminder.completed || spanningCompletedTime) {
            // 添加已完成类
            reminderEl.classList.add('reminder-completed');
            // 设置整体透明度为 0.5（重要性以确保优先级）
            try {
                reminderEl.style.setProperty('opacity', '0.5', 'important');
            } catch (e) {
                // ignore style errors
            }

            // 获取完成时间（支持重复实例和跨天今日完成）并显示
            const completedTimeStr = spanningCompletedTime || this.getCompletedTime(reminder);
            if (completedTimeStr) {
                const completedEl = document.createElement('div');
                completedEl.className = 'reminder-item__completed-time';

                // 判断完成时间是否在逻辑上的“今天”
                const currentLogicalToday = getLogicalDateString();
                const completionDate = new Date(completedTimeStr.replace(' ', 'T'));
                const completionLogicalDay = getLogicalDateString(completionDate);
                const formattedTime = this.formatCompletedTime(completedTimeStr);

                if (completionLogicalDay === currentLogicalToday) {
                    // 今日完成的特殊显示格式
                    const timeOnly = formattedTime.includes(' ') ? formattedTime.substring(formattedTime.indexOf(' ') + 1) : formattedTime;
                    completedEl.textContent = i18n('todayCompletedWithTime', { time: timeOnly });
                } else {
                    completedEl.textContent = `✅ ${formattedTime}`;
                }

                completedEl.style.cssText = 'font-size:12px;  margin-top:6px; opacity:0.95;';
                infoEl.appendChild(completedEl);
            }
        } else if (reminder.isAvailableToday) {
            const currentToday = getLogicalDateString();
            const dailyCompletedList = Array.isArray(reminder.dailyDessertCompleted) ? reminder.dailyDessertCompleted : [];
            const dailyIgnoredList = Array.isArray(reminder.dailyDessertIgnored) ? reminder.dailyDessertIgnored : [];

            if (dailyCompletedList.includes(currentToday)) {
                reminderEl.classList.add('reminder-completed');
                try {
                    reminderEl.style.setProperty('opacity', '0.5', 'important');
                } catch (e) { }
                const completedEl = document.createElement('div');
                completedEl.className = 'reminder-item__completed-time';

                // 尝试获取今日完成时间
                const dailyTimes = reminder.dailyDessertCompletedTimes || {};
                const timeStr = dailyTimes[currentToday];
                if (timeStr) {
                    const formatted = this.formatCompletedTime(timeStr);
                    const timeOnly = formatted.includes(' ') ? formatted.substring(formatted.indexOf(' ') + 1) : formatted;
                    completedEl.textContent = i18n('todayCompletedWithTime', { time: timeOnly });
                } else {
                    completedEl.textContent = i18n('todayCompleted');
                }

                completedEl.style.cssText = 'font-size:12px;  margin-top:6px; opacity:0.95;';
                infoEl.appendChild(completedEl);
            } else if (dailyIgnoredList.includes(currentToday)) {
                reminderEl.classList.add('reminder-ignored');
                try {
                    reminderEl.style.setProperty('opacity', '0.5', 'important');
                } catch (e) { }
                const ignoredEl = document.createElement('div');
                ignoredEl.className = 'reminder-item__ignored-time';
                ignoredEl.textContent = `⭕ 今日已忽略`;
                ignoredEl.style.cssText = 'font-size:12px;  margin-top:6px; opacity:0.95;';
                infoEl.appendChild(ignoredEl);
            }
        }

        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';

            // 渲染 HTML
            if (this.lute) {
                noteEl.innerHTML = this.lute.Md2HTML(reminder.note);
                // 移除 p 标签的外边距以保持紧凑
                const pTags = noteEl.querySelectorAll('p');
                pTags.forEach(p => {
                    p.style.margin = '0';
                    p.style.lineHeight = 'inherit';
                });
                // 处理列表样式，防止内联显示
                const listTags = noteEl.querySelectorAll('ul, ol');
                listTags.forEach(list => {
                    (list as HTMLElement).style.margin = '0';
                    (list as HTMLElement).style.paddingLeft = '20px';
                });
                const liTags = noteEl.querySelectorAll('li');
                liTags.forEach(li => {
                    (li as HTMLElement).style.margin = '0';
                });
                // 处理引用样式
                const quoteTags = noteEl.querySelectorAll('blockquote');
                quoteTags.forEach(quote => {
                    (quote as HTMLElement).style.margin = '0';
                    (quote as HTMLElement).style.paddingLeft = '10px';
                    (quote as HTMLElement).style.borderLeft = '2px solid var(--b3-theme-on-surface-light)';
                    (quote as HTMLElement).style.opacity = '0.8';
                });
                // 处理私有图片路径渲染
                const imgTags = noteEl.querySelectorAll('img');
                imgTags.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && src.startsWith('/data/storage/petal/siyuan-plugin-task-note-management/assets/')) {
                        import('../api').then(({ getFileBlob }) => {
                            getFileBlob(src).then(blob => {
                                if (blob) {
                                    img.src = URL.createObjectURL(blob);
                                }
                            });
                        });
                    }
                });
            } else {
                noteEl.textContent = reminder.note;
            }

            // 样式：1.5行截断
            noteEl.style.cssText = `
                font-size: 12px;
                margin-top: 4px;
                line-height: 1.5;
                max-height: 3em; /* 限制高度为约 2 行，实现 1.5 行+截断效果 */
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



            // 点击编辑
            noteEl.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发整行点击
                e.preventDefault();

                const isRepeatInstance = reminder.isRepeatInstance;
                const originalId = reminder.originalId;
                const isInstanceEdit = isRepeatInstance && !!originalId;

                // 获取实例日期
                const originalInstanceDate = (isRepeatInstance && reminder.id && reminder.id.includes('_')) ? reminder.id.split('_').pop() : reminder.date;

                new QuickReminderDialog(
                    undefined, undefined, undefined, undefined,
                    {
                        plugin: this.plugin,
                        mode: 'note', // 使用仅备注模式
                        reminder: isInstanceEdit ? {
                            ...reminder,
                            isInstance: true,
                            originalId: originalId,
                            instanceDate: originalInstanceDate
                        } : reminder,
                        isInstanceEdit: isInstanceEdit,
                        onSaved: async (savedReminder) => {
                            // 乐观更新：如果返回了修改后的数据，尝试在缓存中更新并重绘
                            if (savedReminder && savedReminder.id) {
                                await this.handleOptimisticSavedReminder(savedReminder);
                            } else {
                                await this.loadReminders();
                            }
                            // 同时也触发事件通知其他组件
                            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                        }
                    }
                ).show();
            });

            infoEl.appendChild(noteEl);
        }



        // 添加项目信息显示（使用预处理的缓存数据）
        if (cachedData && cachedData.project) {
            // 兼容 title 和 name 字段（项目数据使用 title，但接口定义使用 name）
            const projectName = cachedData.project.title || cachedData.project.name;
            if (projectName) {
                // Determine display text
                let displayProjectName = projectName;
                // 如果任务设置了分组，需要显示分组，格式为“项目/分组”
                if (reminder.customGroupId && cachedData.project.customGroups && Array.isArray(cachedData.project.customGroups)) {
                    const group = cachedData.project.customGroups.find((g: any) => g.id === reminder.customGroupId);
                    if (group) {
                        displayProjectName = `${projectName}/${group.name}`;
                    }
                }

                const projectInfo = document.createElement('div');
                projectInfo.className = 'reminder-item__project';
                projectInfo.style.cssText = `
                    display: flex;
                    width: fit-content;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    background-color: ${cachedData.project.color}20;
                    color: ${cachedData.project.color};
                    border: 1px solid ${cachedData.project.color}40;
                    border-radius: 12px;
                    padding: 2px 8px;
                    margin-top: 4px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: opacity 0.2s;
                `;

                // 添加项目图标（如果有）
                if (cachedData.project.icon) {
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = cachedData.project.icon;
                    iconSpan.style.cssText = 'font-size: 10px;';
                    projectInfo.appendChild(iconSpan);
                }

                // 添加项目名称
                const nameSpan = document.createElement('span');
                nameSpan.textContent = '📂' + displayProjectName;
                nameSpan.style.cssText = `
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;
                projectInfo.appendChild(nameSpan);

                // 设置标题提示
                projectInfo.title = `点击打开项目: ${displayProjectName}`;

                // 点击事件：打开项目看板
                projectInfo.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openProjectKanban(reminder.projectId);
                });

                // 鼠标悬停效果（改变整个标签的透明度和文字颜色）
                projectInfo.addEventListener('mouseenter', () => {
                    projectInfo.style.opacity = '0.8';
                    nameSpan.style.color = cachedData.project.color;
                });
                projectInfo.addEventListener('mouseleave', () => {
                    projectInfo.style.opacity = '1';
                    nameSpan.style.color = '';
                });

                // 将项目信息添加到信息容器底部
                infoEl.appendChild(projectInfo);
            }
        }
        // 里程碑显示
        if (reminder.milestoneId) {
            const milestone = this.milestoneMap.get(reminder.milestoneId);
            if (milestone) {
                const milestoneTag = document.createElement('div');
                milestoneTag.className = 'reminder-item__milestone';
                milestoneTag.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    font-size: 11px;
                    background: var(--b3-theme-surface-lighter);
                    color: var(--b3-theme-on-surface);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 4px;
                    padding: 2px 8px;
                    margin-top: 4px;
                    font-weight: 500;
                    opacity: 0.8;
                `;
                // 如果里程碑绑定了块，添加悬浮预览支持
                if (milestone.blockId) {
                    milestoneTag.setAttribute('data-type', 'a');
                    milestoneTag.setAttribute('data-href', `siyuan://blocks/${milestone.blockId}`);
                    milestoneTag.style.color = 'var(--b3-theme-primary)';
                    milestoneTag.style.cursor = 'pointer';
                    milestoneTag.style.textDecoration = 'underline dotted';
                }
                milestoneTag.innerHTML = `<span>${milestone.icon || '🚩'}</span><span>${milestone.name}</span>`;
                milestoneTag.title = `${i18n('milestone') || '里程碑'}: ${milestone.name}`;
                infoEl.appendChild(milestoneTag);
            }
        }
        // 添加分类标签显示
        // 添加分类标签显示（支持多分类）
        if (reminder.categoryId) {
            // 将 categoryId 字符串分割为数组
            const categoryIds = typeof reminder.categoryId === 'string' ? reminder.categoryId.split(',') : [reminder.categoryId];

            categoryIds.forEach((catId: string) => {
                const id = catId.trim();
                if (!id) return;
                const category = this.categoryManager.getCategoryById(id);
                if (category) {
                    const categoryTag = document.createElement('div');
                    categoryTag.className = 'reminder-item__category';
                    categoryTag.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 2px;
                        font-size: 11px;
                        background-color: ${category.color}20;
                        color: ${category.color};
                        border: 1px solid ${category.color}40;
                        border-radius: 12px;
                        padding: 2px 8px;
                        margin-top: 4px;
                        margin-right: 4px;
                        font-weight: 500;
                    `;

                    // 添加分类图标（如果有）
                    if (category.icon) {
                        const iconSpan = document.createElement('span');
                        iconSpan.textContent = category.icon;
                        iconSpan.style.cssText = 'font-size: 10px;';
                        categoryTag.appendChild(iconSpan);
                    }

                    // 添加分类名称
                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = category.name;
                    categoryTag.appendChild(nameSpan);

                    // 设置标题提示
                    categoryTag.title = `分类: ${category.name}`;

                    // 将分类标签添加到信息容器底部
                    infoEl.appendChild(categoryTag);
                }
            });
        }

        // 添加项目标签显示（如果任务属于项目且有标签）
        if (reminder.projectId && reminder.tagIds && reminder.tagIds.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'reminder-item__tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            // 异步加载项目标签配置
            (async () => {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(reminder.projectId);

                    // 创建标签ID到标签对象的映射
                    const tagMap = new Map(projectTags.map(t => [t.id, t]));

                    // 过滤出有效的标签ID
                    const validTagIds = reminder.tagIds.filter((tagId: string) => tagMap.has(tagId));

                    // 如果有无效标签，记录日志（不自动清理，避免在ReminderPanel中修改数据）
                    if (validTagIds.length !== reminder.tagIds.length) {
                        const invalidCount = reminder.tagIds.length - validTagIds.length;
                        console.log(`任务 ${reminder.id} 有 ${invalidCount} 个无效标签`);
                    }

                    // 显示有效标签
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
                                color: var(--b3-theme-on-surface);
                                font-weight: 500;
                            `;
                            tagEl.textContent = `#${tag.name}`;
                            tagEl.title = tag.name;
                            tagsContainer.appendChild(tagEl);
                        }
                    });
                } catch (error) {
                    console.error('加载项目标签失败:', error);
                }
            })();

            infoEl.appendChild(tagsContainer);
        }

        contentEl.appendChild(leftControls);
        contentEl.appendChild(infoEl);
        reminderEl.appendChild(contentEl);

        // 如果为父任务，计算直接子任务完成进度并在底部显示进度条
        if (hasChildren) {
            // 注意：需要从 allRemindersMap 中获取所有子任务（包括被隐藏的已完成子任务）
            // 而不是只从 allVisibleReminders 或 currentRemindersCache 中获取
            // 这样进度条才能正确反映所有子任务的完成情况
            const allChildren: any[] = [];
            this.allRemindersMap.forEach(r => {
                if (r.parentId === reminder.id) {
                    allChildren.push(r);
                }
            });
            const completedCount = allChildren.filter(c => c.completed).length;
            const percent = allChildren.length > 0 ? Math.round((completedCount / allChildren.length) * 100) : 0;

            const progressContainer = document.createElement('div');
            progressContainer.className = 'reminder-progress-container';

            const progressWrap = document.createElement('div');
            progressWrap.className = 'reminder-progress-wrap';

            const progressBar = document.createElement('div');
            progressBar.className = 'reminder-progress-bar';
            progressBar.style.width = `${percent}%`;

            progressWrap.appendChild(progressBar);

            const percentLabel = document.createElement('div');
            percentLabel.className = 'reminder-progress-text';
            percentLabel.textContent = `${percent}%`;

            progressContainer.appendChild(progressWrap);
            progressContainer.appendChild(percentLabel);

            reminderEl.appendChild(progressContainer);
        }

        return reminderEl;
    }

    private async completeDailyDessert(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[targetId]) {
                const now = new Date();
                const todayStr = getLogicalDateString();

                // 初始化 dailyDessertCompleted 数组
                if (!Array.isArray(reminderData[targetId].dailyDessertCompleted)) {
                    reminderData[targetId].dailyDessertCompleted = [];
                }

                // 添加今天到已完成列表 (如果还未添加)
                if (!reminderData[targetId].dailyDessertCompleted.includes(todayStr)) {
                    reminderData[targetId].dailyDessertCompleted.push(todayStr);

                    // 记录完成时间
                    if (!reminderData[targetId].dailyDessertCompletedTimes) {
                        reminderData[targetId].dailyDessertCompletedTimes = {};
                    }
                    reminderData[targetId].dailyDessertCompletedTimes[todayStr] = getLocalDateTimeString(now);
                }

                // 不将任务本身标记为完成，也不修改日期，使其明天继续作为"每日可做"出现
                // 但为了在"今日已完成"视图中能看到今天的记录，我们需要某种方式体现
                // 不过用户明确说 "明天还要继续"，说明它不应该真正变成 completed

                await saveReminders(this.plugin, reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                // 刷新界面显示
                this.loadReminders();
            }
        } catch (e) {
            console.error("完成每日可做任务失败", e);
            showMessage("操作失败", 3000, "error");
        }
    }

    private async undoDailyDessertCompletion(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[targetId]) {
                const todayStr = getLogicalDateString();

                if (Array.isArray(reminderData[targetId].dailyDessertCompleted)) {
                    // 从数组中移除今天
                    reminderData[targetId].dailyDessertCompleted = reminderData[targetId].dailyDessertCompleted.filter((d: string) => d !== todayStr);

                    // 同步移除记录的时间
                    if (reminderData[targetId].dailyDessertCompletedTimes) {
                        delete reminderData[targetId].dailyDessertCompletedTimes[todayStr];
                    }

                    await saveReminders(this.plugin, reminderData);
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                    // 刷新界面显示
                    this.loadReminders();
                    showMessage("已取消今日完成标记");
                }
            }
        } catch (e) {
            console.error("取消完成每日可做任务失败", e);
            showMessage("操作失败", 3000, "error");
        }
    }

    private async ignoreDailyDessertToday(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[targetId]) {
                const todayStr = getLogicalDateString();

                // 初始化 dailyDessertIgnored 数组
                if (!Array.isArray(reminderData[targetId].dailyDessertIgnored)) {
                    reminderData[targetId].dailyDessertIgnored = [];
                }

                // 添加今天到忽略列表 (如果还未添加)
                if (!reminderData[targetId].dailyDessertIgnored.includes(todayStr)) {
                    reminderData[targetId].dailyDessertIgnored.push(todayStr);
                }

                await saveReminders(this.plugin, reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                // 刷新界面显示
                this.loadReminders();
                showMessage("今日已忽略该任务");
            }
        } catch (e) {
            console.error("忽略每日可做任务失败", e);
            showMessage("操作失败", 3000, "error");
        }
    }

    private async undoDailyDessertIgnore(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[targetId]) {
                const todayStr = getLogicalDateString();

                if (Array.isArray(reminderData[targetId].dailyDessertIgnored)) {
                    // 从数组中移除今天
                    reminderData[targetId].dailyDessertIgnored = reminderData[targetId].dailyDessertIgnored.filter((d: string) => d !== todayStr);

                    await saveReminders(this.plugin, reminderData);
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                    // 刷新界面显示
                    this.loadReminders();
                    showMessage("已取消今日忽略");
                }
            }
        } catch (e) {
            console.error("取消忽略每日可做任务失败", e);
            showMessage("操作失败", 3000, "error");
        }
    }

    private async filterArchivedGroupTasks(reminders: any[]): Promise<any[]> {
        try {
            // 收集所有涉及的项目ID
            const projectIds = new Set<string>();
            reminders.forEach(r => {
                if (r.projectId) {
                    projectIds.add(r.projectId);
                }
            });

            // 获取所有项目的分组信息，构建已归档分组的ID集合
            const archivedGroupIds = new Set<string>();
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);

            for (const projectId of projectIds) {
                try {
                    const groups = await projectManager.getProjectCustomGroups(projectId);
                    groups.forEach((g: any) => {
                        if (g.archived) {
                            archivedGroupIds.add(g.id);
                        }
                    });
                } catch (e) {
                    console.warn(`获取项目 ${projectId} 的分组信息失败`, e);
                }
            }

            // 过滤：如果任务属于已归档分组且未完成，则过滤掉
            return reminders.filter(r => {
                if (r.customGroupId && archivedGroupIds.has(r.customGroupId) && !r.completed) {
                    return false;
                }
                return true;
            });
        } catch (error) {
            console.error('过滤已归档分组任务失败', error);
            return reminders;
        }
    }

    private generateAllRemindersWithInstances(reminderData: any, today: string): any[] {
        const reminders = Object.values(reminderData).filter((reminder: any) => {
            // 包含以下任务：
            // 1. 有日期的任务
            // 2. 有父任务的任务（子任务）
            // 3. 有子任务的任务（父任务）
            // 4. 已完成的任务
            // 5. 没有日期的独立任务（既不是父任务也不是子任务，用于"无日期任务"筛选）
            const shouldInclude = reminder && typeof reminder === 'object' && reminder.id &&
                (reminder.date || reminder.parentId || this.hasChildren(reminder.id, reminderData) || reminder.completed || (!reminder.date && !reminder.parentId));

            if (reminder && reminder.id) {
                // console.log(`任务 ${reminder.id} (${reminder.title}):`, {
                //     hasDate: !!reminder.date,
                //     hasParentId: !!reminder.parentId,
                //     hasChildren: this.hasChildren(reminder.id, reminderData),
                //     completed: reminder.completed,
                //     shouldInclude
                // });
            }

            return shouldInclude;
        });

        // console.log(`生成的所有任务数量: ${reminders.length}`);
        const allReminders = [];
        // 重置原始提醒缓存（用于重复实例的原始数据查询）
        this.originalRemindersCache = {};

        reminders.forEach((reminder: any) => {
            // 对于农历重复任务，只添加符合农历日期的实例，不添加原始日期
            const isLunarRepeat = reminder.repeat?.enabled &&
                (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

            // 修改：对于所有重复事件，只显示实例（不再显示原始任务）
            // 非周期任务仍然保留原始任务
            if (!reminder.repeat?.enabled) {
                // 如果是重复任务模板的子任务，则跳过（由父任务在处理流程中递归生成）
                let hasRepeatingAncestor = false;
                let current = reminder;
                while (current.parentId && reminderData[current.parentId]) {
                    const parent = reminderData[current.parentId];
                    if (parent.repeat?.enabled) {
                        hasRepeatingAncestor = true;
                        break;
                    }
                    current = parent;
                }

                if (hasRepeatingAncestor) {
                    return;
                }
                allReminders.push(reminder);
            } else {
                // 缓存原始提醒，供实例查询原始数据（如 completedTimes、dailyCompletions 等）使用
                this.originalRemindersCache[reminder.id] = reminder;

                // 生成实例（无论是否为农历重复，都只显示生成的实例）
                const repeatInstances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);

                // 过滤实例：保留过去未完成、今天的、未来第一个未完成，以及所有已完成的实例
                // 确保 repeat 对象存在
                if (!reminder.repeat) {
                    reminder.repeat = {};
                }
                if (!reminder.repeat.completedInstances) {
                    reminder.repeat.completedInstances = [];
                }
                const completedInstances = reminder.repeat.completedInstances;

                // 预先判断该系列在今天是否有未完成实例，用于决定是否显示未来的首个 uncompleted 实例
                const hasTodayIncomplete = repeatInstances.some(instance => {
                    const originalDate = instance.instanceId.split('_').pop() || instance.date;
                    const isCompleted = completedInstances.includes(originalDate);
                    const logicalDate = this.getReminderLogicalDate(instance.date, instance.time);
                    return compareDateStrings(logicalDate, today) === 0 && !isCompleted;
                });

                let firstFutureIncompleteId: string | null = null;
                if (!hasTodayIncomplete) {
                    const nextFuture = repeatInstances.find(instance => {
                        const originalDate = instance.instanceId.split('_').pop() || instance.date;
                        const isCompleted = completedInstances.includes(originalDate);
                        const logicalDate = this.getReminderLogicalDate(instance.date, instance.time);
                        return compareDateStrings(logicalDate, today) > 0 && !isCompleted;
                    });
                    if (nextFuture) firstFutureIncompleteId = nextFuture.instanceId;
                }

                repeatInstances.forEach(instance => {
                    const originalInstanceDate = instance.instanceId.split('_').pop() || instance.date;
                    let isInstanceCompleted = completedInstances.includes(originalInstanceDate);

                    // 对于订阅任务的重复实例，检查是否过期并自动标记为已完成
                    if (reminder.isSubscribed && !isInstanceCompleted) {
                        const instanceIsPast = isEventPast({
                            ...reminder,
                            date: instance.date,
                            time: instance.time,
                            endDate: instance.endDate,
                            endTime: instance.endTime,
                        });
                        if (instanceIsPast) {
                            isInstanceCompleted = true;
                            if (!completedInstances.includes(originalInstanceDate)) {
                                completedInstances.push(originalInstanceDate);
                                reminder._needsSave = true;
                            }
                        }
                    }

                    // 判断该实例是否应该被显示
                    const instanceLogicalDate = this.getReminderLogicalDate(instance.date, instance.time);
                    const dateComparison = compareDateStrings(instanceLogicalDate, today);

                    let shouldShow = false;
                    if (dateComparison <= 0) {
                        // 过去的和今天的：始终显示（已完成或未完成）
                        shouldShow = true;
                    } else if (isInstanceCompleted) {
                        // 未来的：仅显示已完成的
                        shouldShow = true;
                    } else if (instance.instanceId === firstFutureIncompleteId) {
                        // 未来的：且是第一个未完成的（当今天没有未完成时）
                        shouldShow = true;
                    }

                    if (shouldShow) {
                        const instanceTask = {
                            ...reminder,
                            ...instance,
                            id: instance.instanceId,
                            isRepeatInstance: true,
                            completed: isInstanceCompleted,
                            completedTime: isInstanceCompleted ? (instance.completedTime || reminder.repeat?.completedTimes?.[originalInstanceDate] || getLocalDateTimeString(new Date(instance.date))) : undefined
                        };

                        allReminders.push(instanceTask);
                        // 为该可见实例生成所有子任务树（确保子任务紧跟父任务）
                        // Calculate cutoff time for subtask generation (prevent new subtasks in completed instances)
                        let cutoffTime: number | undefined;
                        // Use the exact completion time if available
                        const realCompletedTimeStr = instance.completedTime || reminder.repeat?.completedTimes?.[originalInstanceDate];

                        // If explicit time exists, use it
                        if (realCompletedTimeStr) {
                            cutoffTime = new Date(realCompletedTimeStr).getTime();
                        } else if (isInstanceCompleted) {
                            // If implicitly completed (e.g. past) or no time recorded, default to end of the instance date
                            // ensuring tasks created ON that day are included, but future tasks are excluded.
                            cutoffTime = new Date(`${instance.date}T23:59:59`).getTime();
                        }

                        generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, allReminders, reminderData, cutoffTime);
                    }
                });

                // 如果订阅任务有过期实例被自动标记为已完成，保存更新
                if (reminder.isSubscribed && reminder._needsSave) {
                    delete reminder._needsSave;
                    (async () => {
                        try {
                            reminderData[reminder.id] = reminder;
                            await saveReminders(this.plugin, reminderData);
                        } catch (error) {
                            console.error('Failed to save auto-completed subscription instances:', error);
                        }
                    })();
                }
            }
        });

        return allReminders;
    }

    /**
     * 检查提醒是否有子任务
     * @param reminderId 提醒ID
     * @param reminderData 提醒数据对象
     * @returns 是否有子任务
     */
    private hasChildren(reminderId: string, reminderData: any): boolean {
        return Object.values(reminderData).some((reminder: any) =>
            reminder && reminder.parentId === reminderId
        );
    }

    public async getTaskCountByTabs(tabNames: string[], excludeDesserts: boolean = false): Promise<number> {
        const { ReminderTaskLogic } = await import("../utils/reminderTaskLogic");
        return ReminderTaskLogic.getTaskCountByTabs(this.plugin, tabNames, excludeDesserts);
    }

    private filterRemindersByTab(reminders: any[], today: string, tabName?: string, excludeDesserts: boolean = false): any[] {
        const targetTab = tabName || this.currentTab;
        const tomorrow = getRelativeDateString(1);
        const future7Days = getRelativeDateString(7);
        const sevenDaysAgo = getRelativeDateString(-7);
        // 修复昨天计算：基于本地日期而不是UTC时间
        const todayDate = new Date(today + 'T00:00:00');
        const yesterdayDate = new Date(todayDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = getLocalDateString(yesterdayDate);

        // 构建提醒映射，用于查找父任务
        const reminderMap = new Map<string, any>();
        reminders.forEach(r => reminderMap.set(r.id, r));

        const isEffectivelyCompleted = (reminder: any) => {
            // 如果任务已标记为完成，直接返回 true
            if (reminder.completed) return true;

            // 如果是跨天事件且今天在范围内，检查是否今天已完成（使用逻辑日期判断范围）
            if (reminder.endDate) {
                const startLogical = this.getReminderLogicalDate(reminder.date || reminder.endDate, reminder.time || reminder.endTime);
                const endLogical = this.getReminderLogicalDate(reminder.endDate, reminder.endTime || reminder.time);
                if (compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0) {
                    return this.isSpanningEventTodayCompleted(reminder);
                }
            }

            // 其他情况返回 false
            return false;
        };

        // 检查任务是否因为父任务完成而应该被视为完成
        const isCompletedDueToParent = (reminder: any): boolean => {
            if (!reminder.parentId) return false;

            let currentId = reminder.parentId;
            while (currentId) {
                const parent = reminderMap.get(currentId);
                if (!parent) break;

                // 如果找到已完成的父任务，则当前任务视为完成
                if (isEffectivelyCompleted(parent)) {
                    return true;
                }

                // 继续向上查找
                currentId = parent.parentId;
            }

            return false;
        };

        // 获取任务的顶级父任务（如果没有父任务，返回自己）
        const getTopLevelParent = (reminder: any): any => {
            if (!reminder.parentId) return reminder;

            let current = reminder;
            while (current.parentId) {
                const parent = reminderMap.get(current.parentId);
                if (!parent) break;
                current = parent;
            }

            return current;
        };

        switch (targetTab) {
            case 'overdue':
                return reminders.filter(r => {
                    const hasDate = r.date || r.endDate;
                    if (!hasDate || isEffectivelyCompleted(r)) return false;
                    const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                    return compareDateStrings(endLogical, today) < 0;
                });
            case 'today':
                return reminders.filter(r => {
                    const isCompleted = isEffectivelyCompleted(r);
                    if (isCompleted) return false;

                    // 1. 常规今日任务：有日期且 (在日期范围内 或 已逾期)
                    const hasDate = r.date || r.endDate;
                    const startLogical = hasDate ? this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime) : null;
                    const endLogical = hasDate ? this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time) : null;

                    if (hasDate && startLogical && endLogical) {
                        const inRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;
                        const isOverdue = compareDateStrings(endLogical, today) < 0;
                        if (inRange || isOverdue) return true;
                    }

                    // 2. 今日可做任务 (Daily Dessert): 
                    if (excludeDesserts) return false;

                    if (r.isAvailableToday) {
                        const availDate = r.availableStartDate || today;
                        if (compareDateStrings(availDate, today) <= 0) {
                            // 排除已有未来日期的任务
                            const checkDate = r.date || r.endDate;
                            const checkTime = r.time || r.endTime;
                            if (checkDate && checkTime) {
                                const s = this.getReminderLogicalDate(checkDate, checkTime);
                                if (compareDateStrings(s, today) > 0) return false;
                            } else if (checkDate && compareDateStrings(checkDate, today) > 0) {
                                return false;
                            }

                            // 检查今天是否已完成
                            const dailyCompleted = Array.isArray(r.dailyDessertCompleted) ? r.dailyDessertCompleted : [];
                            if (dailyCompleted.includes(today)) return false;

                            // 检查今天是否已忽略
                            const dailyIgnored = Array.isArray(r.dailyDessertIgnored) ? r.dailyDessertIgnored : [];
                            if (dailyIgnored.includes(today)) return false;

                            return true;
                        }
                    }

                    return false;
                });
            case 'tomorrow':

                return reminders.filter(r => {
                    const hasDate = r.date || r.endDate;
                    if (isEffectivelyCompleted(r) || !hasDate) return false;
                    const startLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                    const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                    return compareDateStrings(startLogical, tomorrow) <= 0 && compareDateStrings(tomorrow, endLogical) <= 0;
                });
            case 'future7':
                return reminders.filter(r => {
                    const hasDate = r.date || r.endDate;
                    if (isEffectivelyCompleted(r) || !hasDate) return false;
                    const startLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                    const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                    return compareDateStrings(tomorrow, endLogical) <= 0 && compareDateStrings(startLogical, future7Days) <= 0;
                });
            case 'futureAll':
                return reminders.filter(r => {
                    const hasDate = r.date || r.endDate;
                    if (isEffectivelyCompleted(r) || !hasDate) return false;
                    const startLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                    return compareDateStrings(tomorrow, startLogical) <= 0;
                });
            case 'completed':
                return reminders.filter(r => isEffectivelyCompleted(r));
            case 'todayCompleted':
                return reminders.filter(r => {
                    // 1. 常规任务的今日完成
                    if (this.isTodayCompleted(r, today)) return true;

                    // 2. 特殊处理 Daily Dessert: 
                    if (r.isAvailableToday) {
                        // 如果它今天被标记完成了 (dailyDessertCompleted includes today)，也应该显示
                        const dailyCompleted = Array.isArray(r.dailyDessertCompleted) ? r.dailyDessertCompleted : [];
                        if (dailyCompleted.includes(today)) return true;

                        // 如果它今天被忽略了，也应该显示
                        const dailyIgnored = Array.isArray(r.dailyDessertIgnored) ? r.dailyDessertIgnored : [];
                        if (dailyIgnored.includes(today)) return true;
                    }

                    return false;
                });
            case 'yesterdayCompleted':
                return reminders.filter(r => {
                    // 已标记为完成的：如果其完成时间（completedTime）在昨日，则视为昨日已完成
                    if (r.completed) {
                        try {
                            const completedTime = this.getCompletedTime(r);
                            if (completedTime) {
                                const completedDate = completedTime.split(' ')[0];
                                if (completedDate === yesterdayStr) return true;
                            }
                        } catch (e) {
                            // ignore and fallback to date checks
                        }

                        // 移除fallback逻辑，只根据完成时间判断
                        return false;
                    }

                    // 未直接标记为完成的（可能为跨天事件的昨日已完成标记）
                    return r.endDate && this.isSpanningEventYesterdayCompleted(r) && compareDateStrings(this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime), yesterdayStr) <= 0 && compareDateStrings(yesterdayStr, this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time)) <= 0;
                });
            case 'all': // Past 7 days
                return reminders.filter(r => {
                    const hasDate = r.date || r.endDate;
                    if (!hasDate) return false;
                    const startLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                    const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                    return compareDateStrings(sevenDaysAgo, startLogical) <= 0 && compareDateStrings(endLogical, today) < 0;
                });
            case 'allUncompleted': // 所有未完成任务
                return reminders.filter(r => !isEffectivelyCompleted(r) && !isCompletedDueToParent(r));
            case 'noDate': // 无日期任务（根据顶级父任务是否有日期来判断）
                return reminders.filter(r => {
                    // 排除已完成的任务和因父任务完成而视为完成的任务
                    if (isEffectivelyCompleted(r) || isCompletedDueToParent(r)) return false;

                    // 获取顶级父任务（如果任务没有父任务，则返回自己）
                    const topLevelParent = getTopLevelParent(r);

                    // 如果顶级父任务没有日期，则显示该任务及其所有子孙任务
                    // 这包括：
                    // 1. 没有父任务且没有子任务的独立任务（如果没有日期）
                    // 2. 没有父任务但有子任务的顶级父任务（如果没有日期）及其所有子孙
                    // 3. 属于无日期顶级父任务的所有子任务（无论子任务本身是否有日期）
                    return !(topLevelParent.date || topLevelParent.endDate);
                });
            case 'thisWeek':
                return reminders.filter(r => {
                    const hasDate = r.date || r.endDate;
                    if (isEffectivelyCompleted(r) || !hasDate) return false;

                    const startLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                    const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);

                    // 计算本周的起止（周一为一周起点）
                    const todayDate = new Date(today + 'T00:00:00');
                    const day = todayDate.getDay(); // 0 (Sun) - 6 (Sat)
                    const offsetToMonday = (day + 6) % 7; // 将 Sunday(0) 转为 offset 6
                    const weekStartDate = new Date(todayDate);
                    weekStartDate.setDate(weekStartDate.getDate() - offsetToMonday);
                    const weekEndDate = new Date(weekStartDate);
                    weekEndDate.setDate(weekEndDate.getDate() + 6);

                    const weekStartStr = getLocalDateString(weekStartDate);
                    const weekEndStr = getLocalDateString(weekEndDate);

                    // 只要任务的时间范围与本周有交集就列出
                    return compareDateStrings(startLogical, weekEndStr) <= 0 && compareDateStrings(endLogical, weekStartStr) >= 0;
                });
            default:
                // 处理自定义过滤器
                if (targetTab.startsWith('custom_')) {
                    return this.applyCustomFilter(reminders, targetTab, today, isEffectivelyCompleted);
                }
                return [];
        }
    }

    /**
     * 应用自定义过滤器
     * @param reminders 所有提醒
     * @param filterTab 过滤器tab值（custom_xxx）
     * @param today 今天的日期
     * @param isEffectivelyCompleted 判断任务是否完成的函数
     * @returns 过滤后的提醒列表
     */
    private applyCustomFilter(reminders: any[], filterTab: string, today: string, isEffectivelyCompleted: (reminder: any) => boolean): any[] {
        // 从filterTab中提取过滤器ID
        const filterId = filterTab.replace('custom_', '');

        // 同步加载过滤器配置（注意：这里需要改为同步方式或缓存）
        // 为了避免异步问题，我们需要在类中缓存过滤器配置
        const filterConfig = this.getCustomFilterConfig(filterId);
        if (!filterConfig) {
            console.warn(`Custom filter not found: ${filterId}`);
            return reminders;
        }

        // 同步过滤器中的分类设置到侧边栏分类筛选按钮
        // 只有切换到不同的过滤器时才更新
        if (this.currentCustomFilterId !== filterId) {
            this.currentCustomFilterId = filterId;
            // 只有当筛选器设置了具体的分类（不是'all'）时，才同步筛选器的分类
            // 筛选器设置为'all'或未设置时，使用用户手动记忆的分啰
            const hasSpecificCategories = filterConfig.categoryFilters &&
                filterConfig.categoryFilters.length > 0 &&
                !filterConfig.categoryFilters.includes('all');

            if (hasSpecificCategories) {
                // 筛选器有具体分类设置，同步到侧边栏
                this.selectedCategories = [...filterConfig.categoryFilters];
                this.updateCategoryFilterButtonText();
                // 保存到设置
                this.saveSelectedCategories();
            } else {
                // 筛选器没有设置分类或设置为'all'，使用用户手动记忆的分类筛选
                this.selectedCategories = [...this.userManualCategories];
                this.updateCategoryFilterButtonText();
                this.saveSelectedCategories();
            }
        }

        let filtered = [...reminders];

        // 1. 应用日期过滤
        if (filterConfig.dateFilters && filterConfig.dateFilters.length > 0) {
            filtered = this.applyDateFilters(filtered, filterConfig.dateFilters, today, isEffectivelyCompleted);
        }

        // 2. 应用状态过滤
        if (filterConfig.statusFilter && filterConfig.statusFilter !== 'all') {
            filtered = this.applyStatusFilter(filtered, filterConfig.statusFilter, isEffectivelyCompleted);
        }

        // 3. 应用项目过滤
        if (filterConfig.projectFilters && filterConfig.projectFilters.length > 0 && !filterConfig.projectFilters.includes('all')) {
            filtered = this.applyProjectFilter(filtered, filterConfig.projectFilters);
        }

        // 4. 应用分类过滤（已在loadReminders中通过applyCategoryFilter处理）
        // 但自定义过滤器可能有自己的分类设置，这里需要额外处理
        if (filterConfig.categoryFilters && filterConfig.categoryFilters.length > 0 && !filterConfig.categoryFilters.includes('all')) {
            filtered = this.applyCustomCategoryFilter(filtered, filterConfig.categoryFilters);
        }

        // 5. 应用优先级过滤
        if (filterConfig.priorityFilters && filterConfig.priorityFilters.length > 0 && !filterConfig.priorityFilters.includes('all')) {
            filtered = this.applyPriorityFilter(filtered, filterConfig.priorityFilters);
        }

        return filtered;
    }

    /**
     * 获取自定义过滤器配置（同步方式，需要提前缓存）
     */
    private customFilterCache: Map<string, any> = new Map();

    private getCustomFilterConfig(filterId: string): any {
        return this.customFilterCache.get(filterId);
    }

    /**
     * 加载并缓存自定义过滤器配置
     */
    private async loadCustomFilters() {
        try {
            const settings = await this.plugin.loadData('settings.json');
            const customFilters = settings?.customFilters || [];
            this.customFilterCache.clear();
            customFilters.forEach((filter: any) => {
                this.customFilterCache.set(filter.id, filter);
            });
        } catch (error) {
            console.error('Failed to load custom filters:', error);
        }
    }

    /**
     * 应用日期过滤器
     */
    private applyDateFilters(reminders: any[], dateFilters: any[], today: string, isEffectivelyCompleted: (reminder: any) => boolean): any[] {
        if (dateFilters.some(df => df.type === 'all')) {
            return reminders; // 全部日期，不过滤
        }

        const tomorrow = getRelativeDateString(1);
        const future7Days = getRelativeDateString(7);
        const sevenDaysAgo = getRelativeDateString(-7);
        const todayDate = new Date(today + 'T00:00:00');
        const yesterdayDate = new Date(todayDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = getLocalDateString(yesterdayDate);

        return reminders.filter(r => {
            return dateFilters.some(df => {
                switch (df.type) {
                    case 'none':
                        return !r.date && !r.endDate;
                    case 'yesterday': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const startLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        const endLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                        return compareDateStrings(startLogical, yesterdayStr) <= 0 && compareDateStrings(yesterdayStr, endLogical) <= 0;
                    }
                    case 'today': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const todayStart = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        const todayEnd = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                        return compareDateStrings(todayStart, today) <= 0 && compareDateStrings(today, todayEnd) <= 0;
                    }
                    case 'tomorrow': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const tomorrowStart = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        const tomorrowEnd = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                        return compareDateStrings(tomorrowStart, tomorrow) <= 0 && compareDateStrings(tomorrow, tomorrowEnd) <= 0;
                    }
                    case 'this_week': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const weekStartLogical = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        const weekEndLogical = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                        const todayDateObj = new Date(today + 'T00:00:00');
                        const day = todayDateObj.getDay();
                        const offsetToMonday = (day + 6) % 7;
                        const weekStartDate = new Date(todayDateObj);
                        weekStartDate.setDate(weekStartDate.getDate() - offsetToMonday);
                        const weekEndDate = new Date(weekStartDate);
                        weekEndDate.setDate(weekEndDate.getDate() + 6);
                        const weekStartStr = getLocalDateString(weekStartDate);
                        const weekEndStr = getLocalDateString(weekEndDate);
                        return compareDateStrings(weekStartLogical, weekEndStr) <= 0 && compareDateStrings(weekEndLogical, weekStartStr) >= 0;
                    }
                    case 'next_7_days': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const next7Start = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        return compareDateStrings(next7Start, today) >= 0 && compareDateStrings(next7Start, future7Days) <= 0;
                    }
                    case 'future': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const futureStart = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        return compareDateStrings(futureStart, today) > 0;
                    }
                    case 'past_7_days': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const past7End = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                        return compareDateStrings(past7End, sevenDaysAgo) >= 0 && compareDateStrings(past7End, today) <= 0;
                    }
                    case 'custom_range': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate || !df.startDate || !df.endDate) return false;
                        const rangeStart = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        const rangeEnd = this.getReminderLogicalDate(r.endDate || r.date, r.endTime || r.time);
                        return compareDateStrings(rangeStart, df.endDate) <= 0 && compareDateStrings(rangeEnd, df.startDate) >= 0;
                    }
                    case 'future_x_days': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const days = df.futureDays || 14;
                        const futureXEnd = getRelativeDateString(days);
                        const fxStart = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        return compareDateStrings(fxStart, today) >= 0 && compareDateStrings(fxStart, futureXEnd) <= 0;
                    }
                    case 'yearly_date_range': {
                        const hasDate = r.date || r.endDate;
                        if (!hasDate) return false;
                        const sm = df.yearlyStartMonth || 1;
                        const sd = df.yearlyStartDay || 1;
                        const em = df.yearlyEndMonth || 12;
                        const ed = df.yearlyEndDay || 31;
                        const rDate = this.getReminderLogicalDate(r.date || r.endDate, r.time || r.endTime);
                        const rDateObj = new Date(rDate + 'T00:00:00');
                        const rMonth = rDateObj.getMonth() + 1;
                        const rDay = rDateObj.getDate();
                        const rMD = rMonth * 100 + rDay;
                        const startMD = sm * 100 + sd;
                        const endMD = em * 100 + ed;
                        if (startMD <= endMD) {
                            return rMD >= startMD && rMD <= endMD;
                        } else {
                            // 跨年范围，如 11/01 - 02/28
                            return rMD >= startMD || rMD <= endMD;
                        }
                    }
                    default:
                        return false;
                }
            });
        });
    }

    /**
     * 应用状态过滤器
     */
    private applyStatusFilter(reminders: any[], statusFilter: string, isEffectivelyCompleted: (reminder: any) => boolean): any[] {
        switch (statusFilter) {
            case 'completed':
                return reminders.filter(r => isEffectivelyCompleted(r));
            case 'uncompleted':
                return reminders.filter(r => !isEffectivelyCompleted(r));
            default:
                return reminders;
        }
    }

    /**
     * 应用项目过滤器
     */
    private applyProjectFilter(reminders: any[], projectFilters: string[]): any[] {
        return reminders.filter(r => {
            if (projectFilters.includes('none')) {
                if (!r.projectId) return true;
            }
            if (r.projectId && projectFilters.includes(r.projectId)) {
                return true;
            }
            return false;
        });
    }

    /**
     * 应用自定义分类过滤器
     * 支持多分类：只要任务包含选中的任意一个分类即可显示
     */
    private applyCustomCategoryFilter(reminders: any[], categoryFilters: string[]): any[] {
        return reminders.filter(r => {
            if (categoryFilters.includes('all')) {
                return true;
            }

            const categoryIdStr = r.categoryId || 'none';
            // 支持多分类：分割逗号分隔的分类ID
            const taskCategoryIds = categoryIdStr.split(',').filter((id: string) => id);

            if (taskCategoryIds.length === 0) {
                // 任务没有分类，检查是否选中了"无分类"
                return categoryFilters.includes('none');
            }

            // 只要任务的任意一个分类在过滤器列表中，就显示该任务
            return taskCategoryIds.some((id: string) => categoryFilters.includes(id));
        });
    }

    /**
     * 应用优先级过滤器
     */
    private applyPriorityFilter(reminders: any[], priorityFilters: string[]): any[] {
        return reminders.filter(r => {
            const priority = r.priority || 'none';
            if (priorityFilters.includes('none') && !r.priority) {
                return true;
            }
            return priorityFilters.includes(priority);
        });
    }

    /**
     * 检查提醒是否是今天完成的
     * @param reminder 提醒对象
     * @param today 今天的日期字符串
     * @returns 是否是今天完成的
     */
    private isTodayCompleted(reminder: any, today: string): boolean {
        // 已标记为完成的：如果其日期范围包含今日，或其原始日期是今日，或其完成时间（completedTime）在今日，则视为今日已完成
        if (reminder.completed) {
            try {
                const completedTime = this.getCompletedTime(reminder);
                if (completedTime) {
                    const completedDate = completedTime.split(' ')[0];
                    if (completedDate === today) return true;
                }
            } catch (e) {
                // ignore and fallback to date checks
            }

            const startLogical = this.getReminderLogicalDate(reminder.date, reminder.time);
            const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
            return (reminder.endDate && compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0) || startLogical === today;
        }

        // 未直接标记为完成的（可能为跨天事件的今日已完成标记）
        return reminder.endDate && this.isSpanningEventTodayCompleted(reminder) && compareDateStrings(this.getReminderLogicalDate(reminder.date, reminder.time), today) <= 0 && compareDateStrings(today, this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time)) <= 0;
    }

    /**
     * 检查跨天事件是否已标记"今日已完成"
     * @param reminder 提醒对象
     * @returns 是否已标记今日已完成
     */
    private isSpanningEventTodayCompleted(reminder: any): boolean {
        const today = getLogicalDateString();

        if (reminder.isRepeatInstance) {
            // 重复事件实例：检查原始事件的每日完成记录
            const originalReminder = this.getOriginalReminder(reminder.originalId);
            if (originalReminder && originalReminder.dailyCompletions) {
                return originalReminder.dailyCompletions[today] === true;
            }
        } else {
            // 普通事件：检查事件的每日完成记录
            return reminder.dailyCompletions && reminder.dailyCompletions[today] === true;
        }

        return false;
    }

    /**
     * 检查跨天事件是否已标记"昨日已完成"
     * @param reminder 提醒对象
     * @returns 是否已标记昨日已完成
     */
    private isSpanningEventYesterdayCompleted(reminder: any): boolean {
        const today = getLogicalDateString();
        const todayDate = new Date(today + 'T00:00:00');
        const yesterdayDate = new Date(todayDate);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = getLocalDateString(yesterdayDate);

        if (reminder.isRepeatInstance) {
            // 重复事件实例：检查原始事件的每日完成记录
            const originalReminder = this.getOriginalReminder(reminder.originalId);
            if (originalReminder && originalReminder.dailyCompletions) {
                return originalReminder.dailyCompletions[yesterdayStr] === true;
            }
        } else {
            // 普通事件：检查事件的每日完成记录
            return reminder.dailyCompletions && reminder.dailyCompletions[yesterdayStr] === true;
        }

        return false;
    }

    private renderReminders(reminderData: any) {
        // This function is now largely superseded by the new loadReminders logic.
        // It can be kept as a fallback or for simpler views if needed, but for now, we clear the container if no data.
        if (!reminderData || (Array.isArray(reminderData) && reminderData.length === 0)) {
            const filterNames = {
                'today': i18n("noTodayReminders"),
                'tomorrow': i18n("noTomorrowReminders"),
                'future7': i18n("noFuture7Reminders"),
                'overdue': i18n("noOverdueReminders"),
                'thisWeek': i18n("noThisWeekReminders") || "本周暂无任务",
                'completed': i18n("noCompletedReminders"),
                'todayCompleted': "今日暂无已完成任务",
                'yesterdayCompleted': "昨日暂无已完成任务",
                'all': i18n("noPast7Reminders"),
                'allUncompleted': i18n("noAllUncompletedReminders"),
                'noDate': i18n("noNoDateReminders")
            };
            this.remindersContainer.innerHTML = `<div class="reminder-empty">${filterNames[this.currentTab] || i18n("noReminders")}</div>`;
            return;
        }
    }
    private originalRemindersCache: { [id: string]: any } = {};
    // 缓存异步加载数据（番茄数、专注时长、项目等）以减少重复请求
    private asyncDataCache: Map<string, any> = new Map();

    /**
     * 获取原始提醒数据（用于重复事件实例）
     */
    private getOriginalReminder(originalId: string): any {
        try {
            // 这里需要从缓存中获取原始提醒数据
            // 为了性能考虑，我们可以在loadReminders时缓存这些数据
            return this.originalRemindersCache?.[originalId] || null;
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            return null;
        }
    }

    /**
     * 根据提醒的日期和时间计算其“逻辑日期”（考虑一天起始时间设置）
     * 如果提醒含有 time 字段，则使用 date+time 构建 Date 后调用 getLogicalDateString。
     * 否则返回原始的 date 字符串（不对全天/无时刻事件进行偏移）。
     */
    private getReminderLogicalDate(dateStr?: string, timeStr?: string): string {
        if (!dateStr) return '';
        if (timeStr) {
            try {
                // 构造带时分的 Date 对象，交给 getLogicalDateString 处理一天起始偏移
                return getLogicalDateString(new Date(dateStr + 'T' + timeStr));
            } catch (e) {
                // 若解析失败，回退到原始日期字符串
                return dateStr;
            }
        }
        return dateStr;
    }


    // 新增：按完成时间比较
    private compareByCompletedTime(a: any, b: any): number {
        // 获取完成时间
        const completedTimeA = this.getCompletedTime(a);
        const completedTimeB = this.getCompletedTime(b);

        // 如果都有完成时间，按完成时间比较（默认降序：最近完成的在前）
        if (completedTimeA && completedTimeB) {
            const timeA = new Date(completedTimeA).getTime();
            const timeB = new Date(completedTimeB).getTime();
            return timeB - timeA; // 返回基础比较结果，升降序由调用方处理
        }

        // 如果只有一个有完成时间，有完成时间的在前
        if (completedTimeA && !completedTimeB) return -1;
        if (!completedTimeA && completedTimeB) return 1;

        // 如果都没有完成时间，则按以下优先级排序：
        // 1. 有日期的任务优先于无日期的任务
        // 2. 同等情况下，按日期时间排序
        const hasDateA = !!(a.date);
        const hasDateB = !!(b.date);

        if (hasDateA && !hasDateB) return -1; // 有日期的排在前面
        if (!hasDateA && hasDateB) return 1;  // 无日期的排在后面

        // 都有日期或都没有日期的情况下，按日期时间排序
        if (hasDateA && hasDateB) {
            const dateValueA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00')).getTime();
            const dateValueB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00')).getTime();
            if (!isNaN(dateValueA) && !isNaN(dateValueB) && dateValueA !== dateValueB) {
                return dateValueA - dateValueB;
            }
        }

        // 最後兜底：按创建时间排序 (借鉴 ProjectKanbanView)
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        if (timeA !== timeB) {
            return timeB - timeA; // 最新创建的在前
        }

        return (a.id || '').localeCompare(b.id || '');
    }

    // 新增：获取完成时间的辅助方法
    private getCompletedTime(reminder: any): string | null {
        // 如果是每日可做任务，优先获取今日完成时间
        if (reminder.isAvailableToday) {
            const today = getLogicalDateString();
            const dailyTimes = reminder.dailyDessertCompletedTimes || {};
            if (dailyTimes[today]) {
                return dailyTimes[today];
            }
        }

        if (reminder.isRepeatInstance) {
            // 优先使用实例自带的完成时间（如果已由 generateRepeatInstances 生成）
            if (reminder.completedTime) {
                return reminder.completedTime;
            }
            // 重复事件实例的完成时间
            const originalReminder = this.getOriginalReminder(reminder.originalId);
            const today = getLogicalDateString();

            // 优先检查跨天任务的今日完成记录
            if (originalReminder && originalReminder.dailyCompletionsTimes && originalReminder.dailyCompletionsTimes[today]) {
                return originalReminder.dailyCompletionsTimes[today];
            }

            if (originalReminder && originalReminder.repeat?.completedTimes) {
                return originalReminder.repeat.completedTimes[reminder.date] || null;
            }
        } else {
            // 普通事件的完成时间
            const today = getLogicalDateString();
            // 优先检查跨天任务的今日完成记录
            if (reminder.dailyCompletionsTimes && reminder.dailyCompletionsTimes[today]) {
                return reminder.dailyCompletionsTimes[today];
            }
            return reminder.completedTime || null;
        }
        return null;
    }
    // 按时间比较（考虑跨天事件和优先级）
    private compareByTime(a: any, b: any): number {
        const hasDateA = !!a.date;
        const hasDateB = !!b.date;

        if (!hasDateA && !hasDateB) {
            return 0;
        }
        if (!hasDateA) return 1;  // a 无日期，排在后面
        if (!hasDateB) return -1; // b 无日期，排在后面

        // 都有日期时，按日期时间排序
        // 对于重复任务实例，a.date 已经是实例的日期，而不是原始任务的日期
        const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));

        // 如果解析失败，返回0
        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
            return isNaN(dateA.getTime()) ? 1 : -1;
        }

        // 首先按日期时间排序
        const timeDiff = dateA.getTime() - dateB.getTime();
        if (timeDiff !== 0) {
            return timeDiff;
        }

        // 时间相同时，考虑跨天事件和全天事件的优先级
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

        // 时间相同且类型相同时，按优先级排序
        return this.compareByPriorityValue(a, b);
    }

    // 按优先级比较（优先级相同时按时间）
    private compareByPriority(a: any, b: any): number {
        const priorityDiff = this.compareByPriorityValue(a, b);
        if (priorityDiff !== 0) {
            return priorityDiff;
        }
        // 优先级相同时按时间排序
        return this.compareByTime(a, b);
    }

    // 优先级数值比较
    private compareByPriorityValue(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        return priorityA - priorityB; // 低到高（升序），降序会在 compareByCriterion 中取反
    }

    // 按标题比较
    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'zh-CN');
    }

    private async toggleReminder(reminderId: string, completed: boolean, isRepeatInstance?: boolean, instanceDate?: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');

            if (isRepeatInstance && instanceDate) {
                // reminderId 是原始提醒的 id
                const originalId = reminderId;
                const original = reminderData[originalId];
                if (!original) return;

                // 初始化结构
                if (!original.repeat) original.repeat = {};
                if (!original.repeat.completedInstances) original.repeat.completedInstances = [];
                if (!original.repeat.completedTimes) original.repeat.completedTimes = {};

                const completedInstances = original.repeat.completedInstances;
                const completedTimes = original.repeat.completedTimes;

                const affectedBlockIds = new Set<string>();
                if (original.blockId) affectedBlockIds.add(original.blockId);

                if (completed) {
                    if (!completedInstances.includes(instanceDate)) completedInstances.push(instanceDate);
                    completedTimes[instanceDate] = getLocalDateTimeString(new Date());

                    // 如果需要，自动完成子任务（收集受影响的块ID）
                    await this.completeAllChildTasks(originalId, reminderData, affectedBlockIds, instanceDate);
                } else {
                    const idx = completedInstances.indexOf(instanceDate);
                    if (idx > -1) completedInstances.splice(idx, 1);
                    delete completedTimes[instanceDate];
                }

                await saveReminders(this.plugin, reminderData);

                // 更新 allRemindersMap 中的原始数据
                if (this.allRemindersMap.has(originalId)) {
                    this.allRemindersMap.set(originalId, { ...this.allRemindersMap.get(originalId), repeat: original.repeat });
                }

                // 批量更新块书签与任务列表状态
                for (const bId of affectedBlockIds) {
                    try {
                        await updateBindBlockAtrrs(bId, this.plugin);
                        if (completed) await this.handleTaskListCompletion(bId);
                        else await this.handleTaskListCompletionCancel(bId);
                    } catch (err) {
                        console.warn('更新子任务块属性失败:', bId, err);
                    }
                }

                // 局部更新：更新实例与父任务进度
                // 传入更新后的数据以便正确判断完成状态

                // 更新徽章
                if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                    this.plugin.updateBadges();
                }

                // 触发UI刷新
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                this.loadReminders();
                return;
            }

            // 非重复事件
            const reminder = reminderData[reminderId];
            if (!reminder) return;

            const affectedBlockIds = new Set<string>();
            if (reminder.blockId) affectedBlockIds.add(reminder.blockId);

            reminder.completed = completed;
            if (completed) {
                reminder.completedTime = getLocalDateTimeString(new Date());
                // 自动完成子任务
                await this.completeAllChildTasks(reminderId, reminderData, affectedBlockIds);
            } else {
                delete reminder.completedTime;
            }

            await saveReminders(this.plugin, reminderData);

            // 更新 allRemindersMap 中的数据，以便 updateParentProgress 能获取最新的完成状态
            if (this.allRemindersMap.has(reminderId)) {
                this.allRemindersMap.set(reminderId, { ...this.allRemindersMap.get(reminderId), completed, completedTime: reminder.completedTime });
            }

            // 批量更新块书签与任务列表状态
            for (const bId of affectedBlockIds) {
                try {
                    await updateBindBlockAtrrs(bId, this.plugin);
                    if (completed) await this.handleTaskListCompletion(bId);
                    else await this.handleTaskListCompletionCancel(bId);
                } catch (err) {
                    console.warn('更新任务块属性失败:', bId, err);
                }
            }

            // 局部更新：更新当前提醒元素和其父任务进度
            // 传入更新后的数据以便正确判断完成状态

            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }

            // 触发UI刷新
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
            this.loadReminders();
        } catch (error) {
            console.error('切换提醒状态失败:', error);
            showMessage(i18n("operationFailed"));
            // 即使出错也要触发UI刷新，确保界面状态同步
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
            this.loadReminders();
        }
    }
    /**
     * 处理任务列表的自动完成取消功能
     * 当完成时间提醒事项时，检测是否为待办事项列表，如果是则自动打勾
     * @param blockId 块ID
     */
    private async handleTaskListCompletionCancel(blockId: string) {
        try {
            // 1. 检测块是否为待办事项列表
            const isTaskList = await this.isTaskListBlock(blockId);
            if (!isTaskList) {
                return; // 不是待办事项列表，不需要处理
            }

            // 2. 获取块的 kramdown 内容
            const kramdown = (await getBlockKramdown(blockId)).kramdown;
            if (!kramdown) {
                console.warn('无法获取块的 kramdown 内容:', blockId);
                return;
            }
            // 3. 使用正则表达式匹配待办事项格式: ^- {: xxx}[X]
            const taskPattern = /^-\s*\{:[^}]*\}\[X\]/gm;

            // 检查是否包含完成的待办项
            const hasCompletedTasks = taskPattern.test(kramdown);
            if (!hasCompletedTasks) {
                return; // 没有完成的待办项，不需要处理
            }

            // 4. 将 ^- {: xxx}[x] 替换为 ^- {: xxx}[ ]
            // 重置正则表达式的 lastIndex
            taskPattern.lastIndex = 0;
            const updatedKramdown = kramdown.replace(
                /^(-\s*\{:[^}]*\})\[X\]/gm,
                '$1[ ]'
            );


            // 5. 更新块内容
            await this.updateBlockWithKramdown(blockId, updatedKramdown);


        } catch (error) {
            console.error('处理任务列表完成状态失败:', error);
            // 静默处理错误，不影响主要功能
        }
    }
    /**
     * 处理任务列表的自动完成功能
     * 当完成时间提醒事项时，检测是否为待办事项列表，如果是则自动打勾
     * @param blockId 块ID
     */
    private async handleTaskListCompletion(blockId: string) {
        try {
            // 1. 检测块是否为待办事项列表
            const isTaskList = await this.isTaskListBlock(blockId);
            if (!isTaskList) {
                return; // 不是待办事项列表，不需要处理
            }

            // 2. 获取块的 kramdown 内容
            const kramdown = (await getBlockKramdown(blockId)).kramdown;
            if (!kramdown) {
                console.warn('无法获取块的 kramdown 内容:', blockId);
                return;
            }

            // 3. 使用正则表达式匹配待办事项格式: ^- {: xxx}[ ]
            const taskPattern = /^-\s*\{:[^}]*\}\[\s*\]/gm;

            // 检查是否包含未完成的待办项
            const hasUncompletedTasks = taskPattern.test(kramdown);

            if (!hasUncompletedTasks) {
                return; // 没有未完成的待办项，不需要处理
            }

            // 4. 将 ^- {: xxx}[ ] 替换为 ^- {: xxx}[x]
            // 重置正则表达式的 lastIndex
            taskPattern.lastIndex = 0;
            const updatedKramdown = kramdown.replace(
                /^(-\s*\{:[^}]*\})\[\s*\]/gm,
                '$1[X]'
            );


            // 5. 更新块内容
            await this.updateBlockWithKramdown(blockId, updatedKramdown);


        } catch (error) {
            console.error('处理任务列表完成状态失败:', error);
            // 静默处理错误，不影响主要功能
        }
    }
    /**
     * 检测块是否为待办事项列表
     * @param blockId 块ID
     * @returns 是否为待办事项列表
     */
    private async isTaskListBlock(blockId: string): Promise<boolean> {
        try {
            // 使用 SQL 查询检测块类型
            const sqlQuery = `SELECT type, subtype FROM blocks WHERE id = '${blockId}'`;
            const result = await sql(sqlQuery);

            if (result && result.length > 0) {
                const block = result[0];
                // 检查是否为待办事项列表：type='i' and subtype='t'
                return block.type === 'i' && block.subtype === 't';
            }

            return false;
        } catch (error) {
            console.error('检测任务列表块失败:', error);
            return false;
        }
    }

    /**
     * 使用 kramdown 更新块内容
     * @param blockId 块ID
     * @param kramdown kramdown 内容
     */
    private async updateBlockWithKramdown(blockId: string, kramdown: string) {
        try {
            const updateData = {
                dataType: "markdown",
                data: kramdown,
                id: blockId
            };

            // 使用 updateBlock API 更新块
            const response = await fetch('/api/block/updateBlock', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updateData)
            });

            if (!response.ok) {
                throw new Error(`更新块失败: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            if (result.code !== 0) {
                throw new Error(`更新块失败: ${result.msg || '未知错误'}`);
            }

        } catch (error) {
            console.error('更新块内容失败:', error);
            throw error;
        }
    }

    private async openBlockTab(blockId: string) {
        try {
            openBlock(blockId);

        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的提醒
            await confirm(
                i18n("openNoteFailedDelete"),
                i18n("noteBlockDeleted"),
                async () => {
                    // 查找并删除相关提醒
                    await this.deleteRemindersByBlockId(blockId);
                },
                () => {
                    showMessage(i18n("openNoteFailed"));
                }
            );
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string, endTime?: string, reminder?: any): string {
        if (!today) {
            today = getLogicalDateString();
        }

        const tomorrowStr = getRelativeDateString(1);

        // 使用逻辑日期（考虑一天起始时间）来判断“今天/明天/过去/未来”标签
        const logicalStart = this.getReminderLogicalDate(date, time);
        const logicalEnd = this.getReminderLogicalDate(endDate || date, endTime || time);

        let dateStr = '';
        if (logicalStart === today) {
            dateStr = i18n("today");
        } else if (logicalStart === tomorrowStr) {
            dateStr = i18n("tomorrow");
        } else if (compareDateStrings(logicalStart, today) < 0) {
            // 过去的逻辑日期也显示为相对时间，但显示原始日历日期
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString(getLocaleTag(), {
                month: 'short',
                day: 'numeric'
            });
        } else {
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString(getLocaleTag(), {
                month: 'short',
                day: 'numeric'
            });
        }

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

        // 准备最终结果字符串，统一在末尾追加 customReminderTime（如果存在）
        let result = '';

        // 处理跨天事件
        if (endDate && endDate !== date) {
            let endDateStr = '';
            if (logicalEnd === today) {
                endDateStr = i18n("today");
            } else if (logicalEnd === tomorrowStr) {
                endDateStr = i18n("tomorrow");
            } else if (compareDateStrings(logicalEnd, today) < 0) {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString(getLocaleTag(), {
                    month: 'short',
                    day: 'numeric'
                });
            } else {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString(getLocaleTag(), {
                    month: 'short',
                    day: 'numeric'
                });
            }

            // 跨天事件：显示开始日期 开始时间 - 结束日期 结束时间
            const startTimeStr = time ? ` ${time}` : '';
            const endTimeStr = endTime ? ` ${endTime}` : '';
            result = `${dateStr}${startTimeStr} → ${endDateStr}${endTimeStr}`;
        } else if (endTime && endTime !== time) {
            // 当天时间段：显示开始时间 - 结束时间
            const startTimeStr = time || '';
            result = `${dateStr} ${startTimeStr} - ${endTime}`;
        } else {
            result = time ? `${dateStr} ${time}` : dateStr;
        }

        // 如果存在 customReminderTime，按规则显示：
        // 如果存在 reminderTimes，显示多个时间
        try {
            if (reminder?.reminderTimes && Array.isArray(reminder.reminderTimes) && reminder.reminderTimes.length > 0) {
                const times = reminder.reminderTimes.map((rtItem: any) => {
                    if (!rtItem) return '';
                    const rt = typeof rtItem === 'string' ? rtItem : rtItem.time;
                    if (!rt) return '';
                    let s = String(rt).trim();
                    let datePart: string | null = null;
                    let timePart: string | null = null;

                    if (s.includes('T')) {
                        const parts = s.split('T');
                        datePart = parts[0];
                        timePart = parts[1] || null;
                    } else {
                        timePart = s;
                    }

                    const targetDate = datePart || date || today;
                    const logicalTarget = this.getReminderLogicalDate(targetDate, timePart || undefined);

                    if (compareDateStrings(logicalTarget, today) < 0) return ''; // 过去的不显示

                    if (compareDateStrings(logicalTarget, today) === 0) {
                        return timePart ? timePart.substring(0, 5) : '';
                    } else {
                        // 未来：显示日期 + 时间（显示原始 targetDate）
                        const d = new Date(targetDate + 'T00:00:00');
                        const ds = d.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
                        return `${ds}${timePart ? ' ' + timePart.substring(0, 5) : ''}`;
                    }
                }).filter(Boolean).join(', ');

                if (times) {
                    result += ` ⏰${times}`;
                }
            } else {
                const custom = reminder?.customReminderTime;
                if (custom) {
                    let s = String(custom).trim();
                    let datePart: string | null = null;
                    let timePart: string | null = null;

                    if (s.includes('T')) {
                        const parts = s.split('T');
                        datePart = parts[0];
                        timePart = parts[1] || null;
                    } else if (s.includes(' ')) {
                        const parts = s.split(' ');
                        if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                            datePart = parts[0];
                            timePart = parts.slice(1).join(' ') || null;
                        } else {
                            timePart = parts.slice(-1)[0] || null;
                        }
                    } else if (/^\d{2}:\d{2}$/.test(s)) {
                        timePart = s;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                        datePart = s;
                    } else {
                        timePart = s;
                    }

                    const targetDate = datePart || date || today;
                    const logicalTarget = this.getReminderLogicalDate(targetDate, timePart || undefined);

                    if (compareDateStrings(logicalTarget, today) < 0) {
                        // 过去：不显示 customReminderTime
                    } else if (compareDateStrings(logicalTarget, today) === 0) {
                        if (timePart) {
                            const showTime = timePart.substring(0, 5);
                            result = `${result} ⏰${showTime}`;
                        }
                    } else {
                        // 未来：显示日期 + 时间（如果有）
                        const showDate = targetDate;
                        const showTime = timePart ? ` ${timePart.substring(0, 5)}` : '';
                        result = `${result} ⏰${showDate}${showTime}`;
                    }
                }
            }
        } catch (e) {
            console.warn('格式化 customReminderTime 失败', e);
        }

        return result;
    }

    private async deleteRemindersByBlockId(blockId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            let deletedCount = 0;
            const deletedIds: string[] = [];

            // 找到所有相关的提醒并删除
            Object.keys(reminderData).forEach(reminderId => {
                const reminder = reminderData[reminderId];
                if (reminder && (reminder.blockId === blockId || reminder.id === blockId)) {
                    delete reminderData[reminderId];
                    deletedIds.push(reminderId);
                    deletedCount++;
                }
            });

            if (deletedCount > 0) {
                await saveReminders(this.plugin, reminderData);

                // 更新块的书签状态（应该会移除书签，因为没有提醒了）
                await updateBindBlockAtrrs(blockId, this.plugin);

                // 手动移除DOM中的相关元素，避免刷新整个面板
                deletedIds.forEach(reminderId => {
                    const el = this.remindersContainer.querySelector(`[data-reminder-id="${reminderId}"]`) as HTMLElement | null;
                    if (el) {
                        el.remove();
                    }

                    // 从缓存中移除
                    const cacheIndex = this.currentRemindersCache.findIndex(r => r.id === reminderId);
                    if (cacheIndex > -1) {
                        this.currentRemindersCache.splice(cacheIndex, 1);
                    }
                });

                // 更新任务总数
                this.totalItems = Math.max(0, this.totalItems - deletedCount);

                // 检查是否需要显示空状态
                if (this.totalItems === 0) {
                    this.remindersContainer.innerHTML = `<div class="reminder-empty">${i18n("noReminders")}</div>`;
                    const paginationEl = this.container.querySelector('.reminder-pagination-controls');
                    if (paginationEl) {
                        paginationEl.remove();
                    }
                } else if (this.isPaginationEnabled) {
                    // 重新计算分页
                    this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
                    if (this.currentPage > this.totalPages) {
                        this.currentPage = this.totalPages;
                    }
                    this.renderPaginationControls(0);
                }

                showMessage(i18n("deletedRelatedReminders", { count: deletedCount.toString() }));
                // 全量刷新以确保分页、父子关系与异步数据都正确更新
                await this.loadReminders(true);
            } else {
                showMessage(i18n("noRelatedReminders"));
            }
        } catch (error) {
            console.error('删除相关提醒失败:', error);
            showMessage(i18n("deleteRelatedRemindersFailed"));
        }
    }

    // 新增：添加拖拽功能
    private addDragFunctionality(element: HTMLElement, reminder: any) {
        const isAndroid = getBackend().endsWith('android');

        if (isAndroid) return; // 华为平板不能添加lement.draggable = true;

        element.draggable = true;

        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedElement = element;
            this.draggedReminder = reminder;
            try {
                element.style.setProperty('opacity', '0.5', 'important');
            } catch (e) {
                element.style.opacity = '0.5';
            }
            // 添加 dragging 类，作为保险（并覆盖任何样式冲突）
            try { element.classList.add('dragging'); } catch (e) { }

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
                // 支持拖动到日历：携带提醒的最小必要信息
                try {
                    const payload = {
                        id: reminder.id,
                        title: reminder.title || '',
                        date: reminder.date || null,
                        time: reminder.time || null,
                        endDate: reminder.endDate || null,
                        endTime: reminder.endTime || null,
                        priority: reminder.priority || 'none',
                        projectId: reminder.projectId || null,
                        categoryId: reminder.categoryId || null,
                        durationMinutes: (() => {
                            try {
                                if (reminder.time && reminder.endTime) {
                                    const [sh, sm] = (reminder.time || '00:00').split(':').map(Number);
                                    const [eh, em] = (reminder.endTime || reminder.time || '00:00').split(':').map(Number);
                                    const s = sh * 60 + (sm || 0);
                                    const e = eh * 60 + (em || 0);
                                    return Math.max(1, e - s);
                                }
                            } catch (e) { }
                            return 60;
                        })()
                    };

                    e.dataTransfer.setData('application/x-reminder', JSON.stringify(payload));
                    // 兼容性：也设置纯文本为 id
                    e.dataTransfer.setData('text/plain', reminder.id);
                } catch (err) {
                    // ignore
                }
            }
        });

        element.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedElement = null;
            this.draggedReminder = null;
            try {
                element.style.removeProperty('opacity');
            } catch (e) {
                element.style.opacity = '';
            }
            try { element.classList.remove('dragging'); } catch (e) { }
        });

        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement !== element) {
                e.preventDefault();

                const targetReminder = this.getReminderFromElement(element);
                if (!targetReminder) return;

                // 判断拖放类型
                const dropType = this.getDropType(element, e);
                const isSetParent = dropType === 'set-parent';

                // 检查是否可以放置
                if (this.canDropHere(this.draggedReminder, targetReminder, isSetParent)) {
                    e.dataTransfer.dropEffect = 'move';
                    this.showDropIndicator(element, e);
                }
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement !== element) {
                e.preventDefault();

                const targetReminder = this.getReminderFromElement(element);
                if (!targetReminder) {
                    this.hideDropIndicator();
                    return;
                }

                // 判断拖放类型
                const dropType = this.getDropType(element, e);
                const isSetParent = dropType === 'set-parent';

                if (this.canDropHere(this.draggedReminder, targetReminder, isSetParent)) {
                    this.handleDrop(this.draggedReminder, targetReminder, e, dropType);
                }
            }
            this.hideDropIndicator();
        });

        element.addEventListener('dragleave', () => {
            this.hideDropIndicator();
        });
    }

    // 容器拖拽事件：处理外部拖入（如从看板拖入）
    private addContainerDragEvents() {
        this.remindersContainer.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = Array.from(types).some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);
            const isInternalDrag = types.includes('application/x-reminder');

            if (!this.isDragging && !this.draggedElement && (isSiYuanDrag || isInternalDrag)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';

                const targetElement = (e.target as HTMLElement).closest('.reminder-item') as HTMLElement;
                if (targetElement) {
                    this.showDropIndicator(targetElement, e);
                    this.remindersContainer.classList.remove('drag-over-active');
                } else {
                    this.hideDropIndicator();
                    this.remindersContainer.classList.add('drag-over-active');
                }
            }
        });

        this.remindersContainer.addEventListener('dragleave', () => {
            this.remindersContainer.classList.remove('drag-over-active');
        });

        this.remindersContainer.addEventListener('drop', async (e) => {
            this.hideDropIndicator();
            this.remindersContainer.classList.remove('drag-over-active');

            // 获取拖拽目标信息（用于排序）
            const targetElement = (e.target as HTMLElement).closest('.reminder-item') as HTMLElement;
            let targetInfo: { id: string, isBefore: boolean } | undefined = undefined;
            if (targetElement) {
                const rect = targetElement.getBoundingClientRect();
                const isBefore = e.clientY < rect.top + rect.height / 2;
                const targetId = targetElement.dataset.reminderId;
                if (targetId) {
                    targetInfo = { id: targetId, isBefore };
                }
            }

            // 处理内部拖拽 (application/x-reminder)
            if (!this.isDragging && !this.draggedElement && e.dataTransfer?.types.includes('application/x-reminder')) {
                e.preventDefault();
                try {
                    const dataStr = e.dataTransfer.getData('application/x-reminder');
                    if (!dataStr) return;

                    const data = JSON.parse(dataStr);
                    const taskId = data.id;
                    if (!taskId) return;

                    // 计算目标属性
                    const { defaultDate, defaultEndDate, defaultCategoryId, defaultProjectId, defaultPriority } = await this.getFilterAttributes();

                    // 如果有默认属性，则更新任务
                    if (defaultDate || defaultProjectId || defaultPriority || defaultCategoryId) {
                        const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                        const reminder = reminderData[taskId];
                        if (reminder) {
                            let changed = false;

                            // Date
                            if (defaultDate && reminder.date !== defaultDate) {
                                reminder.date = defaultDate;
                                changed = true;
                            }
                            if (defaultEndDate && reminder.endDate !== defaultEndDate) {
                                reminder.endDate = defaultEndDate;
                                changed = true;
                            } else if (defaultDate && !defaultEndDate && reminder.endDate) {
                                // If setting to a single day (defaultEndDate empty), clear endDate if it exists
                                delete reminder.endDate;
                                changed = true;
                            }

                            // Priority
                            if (defaultPriority && (reminder.priority || 'none') !== defaultPriority) {
                                reminder.priority = defaultPriority;
                                changed = true;
                            }

                            // Project
                            if (defaultProjectId && reminder.projectId !== defaultProjectId) {
                                reminder.projectId = defaultProjectId;
                                changed = true;
                            }

                            // Category
                            if (defaultCategoryId && reminder.categoryId !== defaultCategoryId) {
                                reminder.categoryId = defaultCategoryId;
                                changed = true;
                            }

                            // Support sorting for internal drag if dropped on an item
                            if (targetInfo) {
                                // Resolve target reminder (including instances)
                                const targetRem = this.currentRemindersCache.find(r => r.id === targetInfo.id);
                                if (targetRem) {
                                    // If target has specific priority and we didn't force one from filter, adopt target's priority?
                                    // User request: "based on current filters".
                                    // But typically dropping ON an item implies sorting.
                                    // If we conform to filter, we might conflict with target item's group if filter is 'all'?
                                    // Let's stick to filter first. If filter didn't specify priority, maybe use target's?
                                    if (!defaultPriority) {
                                        const targetPriority = targetRem.priority || 'none';
                                        if ((reminder.priority || 'none') !== targetPriority) {
                                            reminder.priority = targetPriority;
                                            changed = true;
                                        }
                                    }

                                    if (changed) {
                                        await saveReminders(this.plugin, reminderData);
                                        // Reset changed flag because we just saved
                                        changed = false;
                                    }

                                    await this.reorderReminders(reminder, targetRem, targetInfo.isBefore, reminderData);
                                }
                            }

                            if (changed) {
                                await saveReminders(this.plugin, reminderData);
                                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                                await this.loadReminders();
                                showMessage(i18n("reminderUpdated") || "任务已更新");
                            }
                        }
                    }
                    // 如果不在特定日期视图（如全部、逾期等），仅允许拖拽（可能用于排序，但此处未实现跨列表排序逻辑，暂不操作）
                    // 用户需求是"不限制视图"，所以解除之前的 return 限制即可。
                } catch (error) {
                    console.error('处理拖放失败:', error);
                    showMessage(i18n("operationFailed"));
                }
                return;
            }

            // 处理思源内部拖拽 (Gutter, File, Tab)
            const types = e.dataTransfer?.types || [];
            if (Array.from(types).some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB)) {

                e.preventDefault();
                const dt = e.dataTransfer;
                let blockIds: string[] = [];

                // 解析拖拽数据
                const gutterType = Array.from(types).find(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER));
                if (gutterType) {
                    const data = dt.getData(gutterType) || dt.getData(Constants.SIYUAN_DROP_GUTTER);
                    if (data) {
                        try {
                            const parsed = JSON.parse(data);
                            if (Array.isArray(parsed)) blockIds = parsed.map(item => item.id);
                            else if (parsed && parsed.id) blockIds = [parsed.id];
                        } catch (e) {
                            const meta = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, '');
                            const info = meta.split('\u200b');
                            if (info && info.length >= 3) {
                                const idStr = info[2];
                                if (idStr) blockIds = idStr.split(',').map(id => id.trim()).filter(id => id && id !== '/');
                            }
                        }
                    } else {
                        // 尝试从类型字符串解析
                        const meta = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, '');
                        const info = meta.split('\u200b');
                        if (info && info.length >= 3) {
                            const idStr = info[2];
                            if (idStr) blockIds = idStr.split(',').map(id => id.trim()).filter(id => id && id !== '/');
                        }
                    }
                } else if (types.includes(Constants.SIYUAN_DROP_FILE)) {
                    const ele: HTMLElement = (window as any).siyuan?.dragElement;
                    if (ele && ele.innerText) {
                        blockIds = ele.innerText.split(',').map(id => id.trim()).filter(id => id && id !== '/');
                    }
                    if (blockIds.length === 0) {
                        const data = dt.getData(Constants.SIYUAN_DROP_FILE);
                        if (data) {
                            try {
                                const parsed = JSON.parse(data);
                                if (Array.isArray(parsed)) blockIds = parsed.map(item => item.id || item);
                                else if (parsed && parsed.id) blockIds = [parsed.id];
                                else if (typeof parsed === 'string') blockIds = [parsed];
                            } catch (e) { blockIds = [data]; }
                        }
                    }
                } else if (types.includes(Constants.SIYUAN_DROP_TAB)) {
                    const data = dt.getData(Constants.SIYUAN_DROP_TAB);
                    if (data) {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed && parsed.id) blockIds = [parsed.id];
                            else if (typeof parsed === 'string') blockIds = [parsed];
                        } catch (e) { blockIds = [data]; }
                    }
                }

                if (blockIds.length > 0) {
                    for (const bid of blockIds) {
                        await this.addItemByBlockId(bid, targetInfo);
                    }
                    // 刷新列表
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                    await this.loadReminders();
                }
            }
        });
    }



    private async addItemByBlockId(blockId: string, targetInfo?: { id: string, isBefore: boolean }) {
        try {
            const block = await getBlockByID(blockId);
            if (!block) return;

            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const { defaultDate, defaultEndDate, defaultCategoryId, defaultProjectId, defaultPriority } = await this.getFilterAttributes();

            // 不需要去重，直接创建新任务

            const reminderId = window.Lute?.NewNodeID?.() || `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            let title = block.content || i18n('unnamedNote') || '未命名任务';
            if (title.length > 100) title = title.substring(0, 100) + '...';

            const newReminder: any = {
                id: reminderId,
                title: title.trim(),
                blockId: blockId,
                docId: block.root_id || (block.type === 'd' ? block.id : null),
                date: defaultDate || getLogicalDateString(), // 默认为今天
                endDate: defaultEndDate || undefined,
                time: '', // 默认不设置时间
                categoryId: defaultCategoryId,
                projectId: defaultProjectId,
                priority: defaultPriority,
                createdAt: new Date().toISOString(),
                createdTime: new Date().toISOString(),
                completed: false
            };

            // 如果是“明天”视图，设置为明天
            // (已在 getFilterAttributes 中处理)
            // if (this.currentTab === 'tomorrow') {
            //     newReminder.date = getRelativeDateString(1);
            // }

            // Apply priority from target if available (handling repeating instances via cache)
            let targetRemObject = null;
            if (targetInfo) {
                targetRemObject = this.currentRemindersCache.find(r => r.id === targetInfo.id);
                if (targetRemObject) {
                    newReminder.priority = targetRemObject.priority || 'none';
                }
            }

            reminderData[reminderId] = newReminder;

            // Apply sorting if target exists, otherwise just save
            // We pass reminderData to reorderReminders to avoid stale data issues (since we just added the new item but haven't saved yet)
            if (targetInfo && targetRemObject) {
                await this.reorderReminders(newReminder, targetRemObject, targetInfo.isBefore, reminderData);
            } else {
                await saveReminders(this.plugin, reminderData);
            }

            // Update block attributes after saving so the reminder exists
            await updateBindBlockAtrrs(blockId, this.plugin);
        } catch (error) {
            console.error('addItemByBlockId failed:', error);
            showMessage(i18n('createFailed') || '创建失败');
        }
    }

    private async getFilterAttributes() {
        let defaultDate = '';
        let defaultEndDate = '';
        let defaultCategoryId: string | undefined = undefined;
        let defaultProjectId: string | undefined = undefined;
        let defaultPriority: string | undefined = undefined;

        // 1. 处理日期 Tab
        if (this.currentTab === 'today') {
            defaultDate = getLogicalDateString();
        } else if (this.currentTab === 'tomorrow') {
            defaultDate = getRelativeDateString(1);
        } else if (this.currentTab === 'thisWeek') {
            const today = getLogicalDateString();
            const todayDate = new Date(today + 'T00:00:00');
            const day = todayDate.getDay();
            const offsetToMonday = (day + 6) % 7;
            const weekStartDate = new Date(todayDate);
            weekStartDate.setDate(weekStartDate.getDate() - offsetToMonday);
            const weekEndDate = new Date(weekStartDate);
            weekEndDate.setDate(weekEndDate.getDate() + 6);

            defaultDate = getLocalDateString(weekStartDate);
            defaultEndDate = getLocalDateString(weekEndDate);
        } else if (this.currentTab === 'future7') {
            defaultDate = getRelativeDateString(1);
            defaultEndDate = getRelativeDateString(7);
        } else if (['futureAll', 'all', 'completed', 'overdue'].includes(this.currentTab)) {
            // 对于这些宽泛视图，默认使用今天
            defaultDate = getLogicalDateString();
        }

        // 2. 处理分类筛选
        if (this.currentCategoryFilter && this.currentCategoryFilter !== 'all' && this.currentCategoryFilter !== 'none') {
            defaultCategoryId = this.currentCategoryFilter;
        }

        // 3. 处理自定义过滤器
        if (this.currentTab.startsWith('custom_')) {
            const filterId = this.currentTab.replace('custom_', '');
            const filter = this.getCustomFilterConfig(filterId);
            if (filter) {
                // Priority
                if (filter.priorityFilters && filter.priorityFilters.length === 1 && filter.priorityFilters[0] !== 'all') {
                    defaultPriority = filter.priorityFilters[0];
                }

                // Project
                if (filter.projectFilters && filter.projectFilters.length === 1 && filter.projectFilters[0] !== 'all' && filter.projectFilters[0] !== 'none') {
                    defaultProjectId = filter.projectFilters[0];
                }

                // Category
                if (filter.categoryFilters && filter.categoryFilters.length === 1 && filter.categoryFilters[0] !== 'all' && filter.categoryFilters[0] !== 'none') {
                    defaultCategoryId = filter.categoryFilters[0];
                }

                // Date
                if (filter.dateFilters && filter.dateFilters.length > 0) {
                    const df = filter.dateFilters[0];
                    if (df.type === 'today') defaultDate = getLogicalDateString();
                    else if (df.type === 'tomorrow') defaultDate = getRelativeDateString(1);
                    else if (df.type === 'custom_range' && df.startDate && df.endDate) {
                        defaultDate = df.startDate;
                        defaultEndDate = df.endDate;
                    } else if (df.type === 'this_week') {
                        const today = getLogicalDateString();
                        const todayDate = new Date(today + 'T00:00:00');
                        const day = todayDate.getDay();
                        const offsetToMonday = (day + 6) % 7;
                        const weekStartDate = new Date(todayDate);
                        weekStartDate.setDate(weekStartDate.getDate() - offsetToMonday);
                        const weekEndDate = new Date(weekStartDate);
                        weekEndDate.setDate(weekEndDate.getDate() + 6);
                        defaultDate = getLocalDateString(weekStartDate);
                        defaultEndDate = getLocalDateString(weekEndDate);
                    } else if (df.type === 'next_7_days') {
                        defaultDate = getLogicalDateString(); // Start today or tomorrow? definition varies. usually "Next 7 days" includes today in some contexts, or starts tomorrow. 
                        // applyDateFilters uses: compareDateStrings(next7Start, today) >= 0 && compareDateStrings(next7Start, future7Days) <= 0;
                        // So it is Today to Today+7
                        defaultDate = getLogicalDateString();
                        defaultEndDate = getRelativeDateString(7);
                    }
                }
            }
        }

        return { defaultDate, defaultEndDate, defaultCategoryId, defaultProjectId, defaultPriority };
    }

    // 新增:移除父子关系
    private async removeParentRelation(childReminder: any, silent: boolean = false) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');

            // 获取原始ID（处理重复实例的情况）
            const childId = childReminder.isRepeatInstance ? childReminder.originalId : childReminder.id;

            if (!reminderData[childId]) {
                throw new Error('任务不存在');
            }

            // 获取父任务信息，用于继承属性
            const parentId = reminderData[childId].parentId;
            if (parentId && reminderData[parentId]) {
                const parentTask = reminderData[parentId];

                // 继承父任务的属性（如果子任务没有设置这些属性）
                // 1. 继承分类（categoryId）
                if (!reminderData[childId].categoryId && parentTask.categoryId) {
                    reminderData[childId].categoryId = parentTask.categoryId;
                }

                // 2. 继承项目（projectId）
                if (!reminderData[childId].projectId && parentTask.projectId) {
                    reminderData[childId].projectId = parentTask.projectId;
                }

                // 3. 继承优先级（priority）
                if (!reminderData[childId].priority && parentTask.priority) {
                    reminderData[childId].priority = parentTask.priority;
                }

                // 4. 继承自定义分组（customGroup）
                if (!reminderData[childId].customGroup && parentTask.customGroup) {
                    reminderData[childId].customGroup = parentTask.customGroup;
                }
            }

            // 移除 parentId
            delete reminderData[childId].parentId;

            // 如果任务没有日期，且当前在"今日任务"视图中，自动添加今日日期
            // 这样可以确保拖拽出来的子任务不会从今日任务视图中消失
            if (!reminderData[childId].date && this.currentTab === 'today') {
                reminderData[childId].date = getLogicalDateString();
            }

            await saveReminders(this.plugin, reminderData);

            // 触发刷新以重新渲染整个列表（因为层级结构变化需要重新渲染）
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
            await this.loadReminders();

        } catch (error) {
            console.error('移除父子关系失败:', error);
            showMessage(i18n("operationFailed") || "操作失败", 3000, 'error');
            throw error;
        }
    }

    // 新增：创建提醒倒计时元素 - 改进以支持过期显示
    private createReminderCountdownElement(reminder: any, today: string): HTMLElement | null {
        // 判断提醒的目标日期
        let targetDate: string;
        let isOverdueEvent = false;

        const startLogical = this.getReminderLogicalDate(reminder.date || reminder.endDate, reminder.time || reminder.endTime);
        const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
        const isSpanningRealEvent = !!(reminder.date && reminder.endDate && reminder.endDate !== reminder.date);

        if (isSpanningRealEvent) {
            // 跨天事件：检查今天是否在事件范围内（使用逻辑日期）
            const isInRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

            if (isInRange) {
                // 今天在事件范围内，显示到结束日期的倒计时
                targetDate = endLogical;
            } else if (compareDateStrings(startLogical, today) > 0) {
                // 事件还未开始，显示到开始日期的倒计时
                targetDate = startLogical;
            } else {
                // 事件已结束，显示过期天数（仅对未完成事件）
                if (!reminder.completed) {
                    targetDate = endLogical;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            }
        } else {
            // 单日事件（使用逻辑起始日期判断）
            if (compareDateStrings(startLogical, today) > 0) {
                // 未来日期，显示倒计时
                targetDate = startLogical;
            } else if (compareDateStrings(startLogical, today) < 0) {
                // 过去日期，显示过期天数（仅对未完成事件）
                if (!reminder.completed) {
                    targetDate = startLogical;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            } else {
                // 今天的事件，不显示倒计时
                return null;
            }
        }

        const daysDiff = this.calculateReminderDaysDifference(targetDate, today);

        // 对于未来事件，daysDiff > 0；对于过期事件，daysDiff < 0
        // 特殊情况：跨天事件且目标日期为结束日期，且结束日期为今天时，应显示"还剩0天"
        const isTargetEndForSpanning = isSpanningRealEvent && targetDate === endLogical;
        const isInRangeForSpanning = isSpanningRealEvent && compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

        if (daysDiff === 0 && !(isTargetEndForSpanning && isInRangeForSpanning)) {
            // 对于非跨天结束日的 0 天，仍然不显示倒计时（今天事件）
            return null;
        }

        const countdownEl = document.createElement('div');
        countdownEl.className = 'reminder-countdown';

        // 根据是否过期设置不同的样式和文本
        if (isOverdueEvent || daysDiff < 0) {
            // 过期事件：红色样式
            countdownEl.style.cssText = `
                color: var(--b3-font-color1);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background1);
                border: 1px solid var(--b3-font-color1);
                border-radius: 4px;
                padding: 2px 6px;
                flex-shrink: 0;
            `;

            const overdueDays = Math.abs(daysDiff);
            countdownEl.textContent = overdueDays === 1 ?
                i18n("overdueBySingleDay") :
                i18n("overdueByDays", { days: overdueDays.toString() });
        } else {
            // 未来事件：绿色样式
            countdownEl.style.cssText = `
                color: var(--b3-font-color4);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background4);
                border: 1px solid var(--b3-font-color4);
                border-radius: 4px;
                padding: 2px 6px;
                flex-shrink: 0;
            `;

            // 根据是否为跨天事件显示不同的文案
            if (isSpanningRealEvent) {
                const isInRange = compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;

                if (isInRange) {
                    countdownEl.textContent = daysDiff === 1 ?
                        i18n("spanningDaysLeftSingle") :
                        i18n("spanningDaysLeftPlural", { days: daysDiff.toString() });
                } else {
                    countdownEl.textContent = daysDiff === 1 ?
                        i18n("startInDays", { days: daysDiff.toString() }) :
                        i18n("startInDays", { days: daysDiff.toString() });
                }
            } else {
                countdownEl.textContent = daysDiff === 1 ?
                    i18n("daysLeftSingle") :
                    i18n("daysLeftPlural", { days: daysDiff.toString() });
            }
        }

        return countdownEl;
    }

    // 新增：计算提醒日期差值 - 改进以支持负值（过期天数）
    private calculateReminderDaysDifference(targetDate: string, today: string): number {
        const target = new Date(targetDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffTime = target.getTime() - todayDate.getTime();
        // 返回实际天数差值，负数表示过期，正数表示未来
        return Math.round(diffTime / (1000 * 60 * 60 * 24));
    }


    // 新增：从元素获取提醒数据
    private getReminderFromElement(element: HTMLElement): any {
        const reminderId = element.dataset.reminderId;
        if (!reminderId) return null;

        // 从当前显示的提醒列表中查找
        const displayedReminders = this.getDisplayedReminders();
        return displayedReminders.find(r => r.id === reminderId);
    }

    // 新增：获取当前显示的提醒列表
    private getDisplayedReminders(): any[] {
        const reminderElements = Array.from(this.remindersContainer.querySelectorAll('.reminder-item'));
        return reminderElements.map(el => {
            const reminderId = (el as HTMLElement).dataset.reminderId;
            return this.currentRemindersCache.find(r => r.id === reminderId);
        }).filter(Boolean);
    }

    // 新增：检查是否可以放置
    private canDropHere(draggedReminder: any, targetReminder: any, isSetParent: boolean = false): boolean {
        // 检查基本条件：不能拖到自己上
        if (draggedReminder.id === targetReminder.id) {
            return false;
        }

        // 检查循环任务限制：循环任务不能有父任务或子任务
        const draggedIsRecurring = draggedReminder.isRepeatInstance || (draggedReminder.repeat && draggedReminder.repeat.enabled);
        const targetIsRecurring = targetReminder.isRepeatInstance || (targetReminder.repeat && targetReminder.repeat.enabled);

        if (isSetParent) {
            // 设置父子关系时的额外检查
            // 订阅任务不支持设置父子关系
            if (draggedReminder.isSubscribed || targetReminder.isSubscribed) {
                return false;
            }

            // 循环任务限制 - 现已支持循环任务设置父子关系
            /*
            if (draggedIsRecurring) {
                return false; // 循环任务不能成为子任务
            }
            if (targetIsRecurring) {
                return false; // 循环任务不能成为父任务
            }
            */

            // 检查是否会造成循环引用
            if (this.wouldCreateCycle(draggedReminder.id, targetReminder.id)) {
                return false;
            }
        } else {
            // 排序时的检查
            // 如果被拖动的任务有父任务，说明是要移除父子关系，此时不检查优先级限制
            const isRemovingParent = draggedReminder.parentId != null;

            if (!isRemovingParent) {
                // 只有在不是移除父子关系的情况下，才检查优先级限制
                // 允许跨优先级拖拽，后续在 dropping 时处理优先级变更
                /* const draggedPriority = draggedReminder.priority || 'none';
                const targetPriority = targetReminder.priority || 'none';
                if (draggedPriority !== targetPriority) {
                    return false;
                } */
            }
        }

        return true;
    }

    // 新增：检查是否会造成循环引用
    private wouldCreateCycle(childId: string, newParentId: string): boolean {
        // 检查 newParentId 是否是 childId 的后代
        const reminderMap = new Map<string, any>();
        this.currentRemindersCache.forEach(r => reminderMap.set(r.id, r));

        let currentId: string | undefined = newParentId;
        const visited = new Set<string>();

        while (currentId) {
            if (currentId === childId) {
                return true; // 发现循环
            }
            if (visited.has(currentId)) {
                break; // 防止无限循环
            }
            visited.add(currentId);

            const current = reminderMap.get(currentId);
            currentId = current?.parentId;
        }

        return false;
    }

    // 新增：检查是否为同级排序（不需要移除父子关系）
    private isSameLevelSort(draggedReminder: any, targetReminder: any): boolean {
        // 如果被拖拽的任务没有父任务，则一定是同级排序
        if (!draggedReminder.parentId) {
            return true;
        }

        // 如果目标任务的父任务ID与被拖拽任务的父任务ID相同，则为同级排序
        if (targetReminder.parentId === draggedReminder.parentId) {
            return true;
        }

        // 检查目标任务是否是被拖拽任务的祖先（在同一棵树内）
        const reminderMap = new Map<string, any>();
        this.currentRemindersCache.forEach(r => reminderMap.set(r.id, r));

        let currentId: string | undefined = draggedReminder.parentId;
        while (currentId) {
            if (currentId === targetReminder.id) {
                return true; // 目标任务是被拖拽任务的祖先，属于同级排序
            }
            const current = reminderMap.get(currentId);
            currentId = current?.parentId;
        }

        // 检查被拖拽任务是否是目标任务的祖先（这种情况很少见，但也要处理）
        currentId = targetReminder.parentId;
        while (currentId) {
            if (currentId === draggedReminder.id) {
                return true; // 被拖拽任务是目标任务的祖先，属于同级排序
            }
            const current = reminderMap.get(currentId);
            currentId = current?.parentId;
        }

        // 其他情况：父任务ID不同，且不在同一棵树内，则为不同级排序
        return false;
    }

    // 新增：显示拖放指示器
    private showDropIndicator(element: HTMLElement, event: DragEvent) {
        this.hideDropIndicator(); // 先清除之前的指示器

        const rect = element.getBoundingClientRect();
        const height = rect.height;
        const mouseY = event.clientY - rect.top;

        // 定义边缘区域：上下各 25% 区域用于排序，中间 50% 区域用于设置父子关系
        const edgeThreshold = height * 0.25;

        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';

        if (mouseY < edgeThreshold) {
            // 上边缘：插入到目标元素之前（排序）
            indicator.style.cssText = `
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                height: 2px;
                background-color: var(--b3-theme-primary);
                z-index: 1000;
                pointer-events: none;
            `;
            element.style.position = 'relative';
            element.insertBefore(indicator, element.firstChild);
        } else if (mouseY > height - edgeThreshold) {
            // 下边缘：插入到目标元素之后（排序）
            indicator.style.cssText = `
                position: absolute;
                left: 0;
                right: 0;
                bottom: 0;
                height: 2px;
                background-color: var(--b3-theme-primary);
                z-index: 1000;
                pointer-events: none;
            `;
            element.style.position = 'relative';
            element.appendChild(indicator);
        } else {
            // 中间区域：设置为子任务（显示不同的指示器）
            indicator.style.cssText = `
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                bottom: 0;
                background-color: var(--b3-theme-primary);
                opacity: 0.1;
                border: 2px dashed var(--b3-theme-primary);
                border-radius: 4px;
                z-index: 1000;
                pointer-events: none;
            `;
            indicator.setAttribute('data-drop-type', 'set-parent');

            // 添加提示文字
            const hintText = document.createElement('div');
            hintText.style.cssText = `
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                color: var(--b3-theme-primary);
                font-size: 14px;
                font-weight: bold;
                white-space: nowrap;
                pointer-events: none;
            `;
            hintText.textContent = '设为子任务 ↓';
            indicator.appendChild(hintText);

            element.style.position = 'relative';
            element.appendChild(indicator);
        }
    }

    // 新增：判断拖放类型（根据鼠标位置）
    private getDropType(element: HTMLElement, event: DragEvent): 'before' | 'after' | 'set-parent' {
        const rect = element.getBoundingClientRect();
        const height = rect.height;
        const mouseY = event.clientY - rect.top;
        const edgeThreshold = height * 0.25;

        if (mouseY < edgeThreshold) {
            return 'before';
        } else if (mouseY > height - edgeThreshold) {
            return 'after';
        } else {
            return 'set-parent';
        }
    }

    // 新增：隐藏拖放指示器
    private hideDropIndicator() {
        const indicators = document.querySelectorAll('.drop-indicator');
        indicators.forEach(indicator => indicator.remove());
    }

    // 新增：处理拖放
    private async handleDrop(draggedReminder: any, targetReminder: any, event: DragEvent, dropType: 'before' | 'after' | 'set-parent') {
        try {
            if (dropType === 'set-parent') {
                // 设置父子关系
                await this.setParentRelation(draggedReminder, targetReminder);
            } else {
                // 排序操作：智能判断是否需要移除父子关系
                const insertBefore = dropType === 'before';

                // 检查是否为同级排序（不需要移除父子关系的情况）
                const isSameLevelSort = this.isSameLevelSort(draggedReminder, targetReminder);

                if (draggedReminder.parentId && !isSameLevelSort) {
                    // 不同级排序：自动移除父子关系
                    await this.removeParentRelation(draggedReminder, true);
                }

                // 执行排序操作
                await this.reorderReminders(draggedReminder, targetReminder, insertBefore);
                this.updateDOMOrder(draggedReminder, targetReminder, insertBefore);
            }
        } catch (error) {
            console.error('处理拖放失败:', error);
            showMessage(i18n("operationFailed") || "操作失败");
        }
    }

    // 新增：设置父子关系
    private async setParentRelation(childReminder: any, parentReminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');

            // 获取原始ID（处理重复实例的情况）
            const childId = childReminder.isRepeatInstance ? childReminder.originalId : childReminder.id;
            const parentId = parentReminder.isRepeatInstance ? parentReminder.originalId : parentReminder.id;

            if (!reminderData[childId]) {
                throw new Error('子任务不存在');
            }
            if (!reminderData[parentId]) {
                throw new Error('父任务不存在');
            }

            // 更新子任务的 parentId
            reminderData[childId].parentId = parentId;

            // 如果父任务有 projectId，则自动赋值给子任务
            if (reminderData[parentId].projectId) {
                reminderData[childId].projectId = reminderData[parentId].projectId;
            }

            await saveReminders(this.plugin, reminderData);

            // 触发刷新以重新渲染整个列表（因为层级结构变化需要重新渲染）
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
            await this.loadReminders();

        } catch (error) {
            console.error('设置父子关系失败:', error);
            throw error;
        }
    }

    // 新增：只更新DOM顺序，不刷新整个列表
    private updateDOMOrder(draggedReminder: any, targetReminder: any, insertBefore: boolean) {
        try {
            // 获取被拖拽元素和目标元素
            const draggedElement = this.remindersContainer.querySelector(`[data-reminder-id="${draggedReminder.id}"]`) as HTMLElement;
            const targetElement = this.remindersContainer.querySelector(`[data-reminder-id="${targetReminder.id}"]`) as HTMLElement;

            if (!draggedElement || !targetElement) {
                console.error('找不到拖拽或目标元素');
                return;
            }

            // 移动DOM元素
            if (insertBefore) {
                this.remindersContainer.insertBefore(draggedElement, targetElement);
            } else {
                // 插入到目标元素之后
                if (targetElement.nextSibling) {
                    this.remindersContainer.insertBefore(draggedElement, targetElement.nextSibling);
                } else {
                    this.remindersContainer.appendChild(draggedElement);
                }
            }

            // 更新缓存中的顺序
            const draggedIndex = this.currentRemindersCache.findIndex(r => r.id === draggedReminder.id);
            const targetIndex = this.currentRemindersCache.findIndex(r => r.id === targetReminder.id);

            if (draggedIndex !== -1 && targetIndex !== -1) {
                // 从缓存中移除被拖拽的项
                const [removed] = this.currentRemindersCache.splice(draggedIndex, 1);

                // 重新计算插入位置（因为移除操作可能改变了索引）
                const newTargetIndex = this.currentRemindersCache.findIndex(r => r.id === targetReminder.id);
                const insertIndex = insertBefore ? newTargetIndex : newTargetIndex + 1;

                // 插入到新位置
                this.currentRemindersCache.splice(insertIndex, 0, removed);
            }

        } catch (error) {
            console.error('更新DOM顺序失败:', error);
        }
    }

    // 新增：重新排序提醒（支持重复实例）
    private async reorderReminders(draggedReminder: any, targetReminder: any, insertBefore: boolean, providedReminderData?: any) {
        try {
            const reminderData = providedReminderData || await getAllReminders(this.plugin, undefined, false, 'sidebar');

            // 判断是否为重复实例
            // 优先使用 isRepeatInstance 属性，如果未设置则通过 originalId 判断（只有明确有 originalId 才是实例）
            const isDraggedInstance = draggedReminder.isRepeatInstance !== undefined
                ? draggedReminder.isRepeatInstance
                : !!draggedReminder.originalId;
            const isTargetInstance = targetReminder.isRepeatInstance !== undefined
                ? targetReminder.isRepeatInstance
                : !!targetReminder.originalId;

            // 获取原始ID
            const draggedOriginalId = isDraggedInstance ? (draggedReminder.originalId || draggedReminder.id.split('_')[0]) : draggedReminder.id;
            const targetOriginalId = isTargetInstance ? (targetReminder.originalId || targetReminder.id.split('_')[0]) : targetReminder.id;

            // 获取原始实例日期（从 ID 中提取，因为 date 可能已被修改）
            const draggedOriginalInstanceDate = isDraggedInstance ? draggedReminder.id.split('_').pop() : undefined;
            const targetOriginalInstanceDate = isTargetInstance ? targetReminder.id.split('_').pop() : undefined;

            const oldPriority = draggedReminder.priority || 'none';
            const newPriority = targetReminder.priority || 'none';

            // 检查是否跨优先级拖拽
            if (oldPriority !== newPriority) {
                // 跨优先级：更新被拖拽任务的优先级
                if (isDraggedInstance) {
                    // 重复实例：在 instanceModifications 中存储优先级
                    const originalTask = reminderData[draggedOriginalId];
                    if (originalTask) {
                        const instanceDate = draggedOriginalInstanceDate;
                        if (!originalTask.repeat) originalTask.repeat = {};
                        if (!originalTask.repeat.instanceModifications) originalTask.repeat.instanceModifications = {};
                        if (!originalTask.repeat.instanceModifications[instanceDate]) {
                            originalTask.repeat.instanceModifications[instanceDate] = {};
                        }
                        originalTask.repeat.instanceModifications[instanceDate].priority = newPriority;
                        draggedReminder.priority = newPriority;
                    }
                } else {
                    // 普通任务
                    if (reminderData[draggedReminder.id]) {
                        reminderData[draggedReminder.id].priority = newPriority;
                        draggedReminder.priority = newPriority;
                    }
                }

                // 重新排序两个优先级分组
                await this.reorderPriorityGroup(reminderData, oldPriority, draggedOriginalId, isDraggedInstance, draggedOriginalInstanceDate);
                await this.reorderPriorityGroup(reminderData, newPriority, draggedOriginalId, isDraggedInstance, draggedOriginalInstanceDate, targetOriginalId, targetOriginalInstanceDate, insertBefore);

                await saveReminders(this.plugin, reminderData);

                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                await this.loadReminders();

            } else {
                // 同优先级排序
                await this.reorderPriorityGroup(reminderData, oldPriority, draggedOriginalId, isDraggedInstance, draggedOriginalInstanceDate, targetOriginalId, targetOriginalInstanceDate, insertBefore, draggedReminder, targetReminder);

                await saveReminders(this.plugin, reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: { source: this.panelId }
                }));
                await this.loadReminders();
            }

        } catch (error) {
            console.error('重新排序提醒失败:', error);
            throw error;
        }
    }

    /**
     * 对指定优先级分组进行排序（支持重复实例）
     */
    private async reorderPriorityGroup(
        reminderData: any,
        priority: string,
        draggedOriginalId: string,
        isDraggedInstance: boolean,
        draggedInstanceDate?: string,
        targetOriginalId?: string,
        targetInstanceDate?: string,
        insertBefore?: boolean,
        draggedReminder?: any,
        targetReminder?: any
    ) {
        // 收集该优先级下的所有任务和实例
        const items: Array<{
            id: string;
            originalId: string;
            date?: string;
            sort: number;
            isInstance: boolean;
        }> = [];

        // 收集普通任务
        Object.values(reminderData).forEach((task: any) => {
            if ((task.priority || 'none') === priority && !task.repeat?.enabled) {
                items.push({
                    id: task.id,
                    originalId: task.id,
                    sort: task.sort || 0,
                    isInstance: false
                });
            }
        });

        // 收集重复实例（从 instanceModifications 中）
        Object.values(reminderData).forEach((task: any) => {
            if (task.repeat?.enabled && task.repeat?.instanceModifications) {
                Object.entries(task.repeat.instanceModifications).forEach(([date, mod]: [string, any]) => {
                    if (!mod) return;
                    const instancePriority = mod.priority || task.priority || 'none';
                    if (instancePriority === priority) {
                        items.push({
                            id: `${task.id}_${date}`,
                            originalId: task.id,
                            date: date,
                            sort: mod.sort !== undefined ? mod.sort : (task.sort || 0),
                            isInstance: true
                        });
                    }
                });
            }
        });

        // 如果没有拖拽操作（仅重新排序），直接按当前 sort 排序
        if (!targetOriginalId) {
            items.sort((a, b) => a.sort - b.sort);
            items.forEach((item, index) => {
                this.updateItemSort(reminderData, item, index * 10);
            });
            return;
        }

        // 确保拖拽项在列表中
        const draggedFullId = isDraggedInstance ? `${draggedOriginalId}_${draggedInstanceDate}` : draggedOriginalId;
        const draggedExists = items.some(item => item.id === draggedFullId);
        if (!draggedExists && draggedReminder) {
            let sort = 0;
            if (isDraggedInstance) {
                const originalTask = reminderData[draggedOriginalId];
                sort = originalTask?.repeat?.instanceModifications?.[draggedInstanceDate!]?.sort ?? originalTask?.sort ?? 0;
            } else {
                sort = reminderData[draggedOriginalId]?.sort || 0;
            }
            items.push({
                id: draggedFullId,
                originalId: draggedOriginalId,
                date: draggedInstanceDate,
                sort: sort,
                isInstance: isDraggedInstance
            });
        }

        // 确保目标项在列表中
        // 优先使用 isRepeatInstance 属性，如果未设置则通过 originalId 判断（只有明确有 originalId 才是实例）
        const isTargetInstance = targetReminder?.isRepeatInstance !== undefined
            ? targetReminder.isRepeatInstance
            : !!targetReminder?.originalId;
        const targetFullId = isTargetInstance ? `${targetOriginalId}_${targetInstanceDate}` : targetOriginalId;
        const targetExists = items.some(item => item.id === targetFullId);
        if (!targetExists && targetReminder) {
            let sort = 0;
            if (isTargetInstance) {
                const originalTask = reminderData[targetOriginalId];
                sort = originalTask?.repeat?.instanceModifications?.[targetInstanceDate!]?.sort ?? originalTask?.sort ?? 0;
            } else {
                sort = reminderData[targetOriginalId]?.sort || 0;
            }
            items.push({
                id: targetFullId,
                originalId: targetOriginalId,
                date: targetInstanceDate,
                sort: sort,
                isInstance: isTargetInstance
            });
        }

        // 按 sort 排序
        items.sort((a, b) => a.sort - b.sort);

        // 找到目标索引和拖拽索引
        const targetIndex = items.findIndex(item => item.id === targetFullId);
        const draggedIndex = items.findIndex(item => item.id === draggedFullId);

        if (targetIndex === -1 || draggedIndex === -1) {
            console.error('找不到拖拽或目标任务', { draggedFullId, targetFullId, items: items.map(i => i.id) });
            return;
        }

        // 计算插入位置
        let insertIndex = targetIndex;
        if (insertBefore !== undefined) {
            insertIndex = insertBefore ? targetIndex : targetIndex + 1;
        }

        // 重新排序
        const draggedItem = items[draggedIndex];
        items.splice(draggedIndex, 1);

        // 调整插入索引
        if (draggedIndex < insertIndex) {
            insertIndex--;
        }

        const validInsertIndex = Math.max(0, Math.min(insertIndex, items.length));
        items.splice(validInsertIndex, 0, draggedItem);

        // 更新排序值
        items.forEach((item, index) => {
            this.updateItemSort(reminderData, item, index * 10);
        });
    }

    /**
     * 更新任务或实例的 sort 值
     */
    private updateItemSort(reminderData: any, item: { id: string; originalId: string; date?: string; isInstance: boolean }, sort: number) {
        if (item.isInstance) {
            // 更新 instanceModifications 中的 sort
            const originalTask = reminderData[item.originalId];
            if (originalTask && originalTask.repeat) {
                if (!originalTask.repeat.instanceModifications) {
                    originalTask.repeat.instanceModifications = {};
                }
                if (!originalTask.repeat.instanceModifications[item.date!]) {
                    originalTask.repeat.instanceModifications[item.date!] = {};
                }
                originalTask.repeat.instanceModifications[item.date!].sort = sort;
            }
        } else {
            // 更新普通任务的 sort
            if (reminderData[item.id]) {
                reminderData[item.id].sort = sort;
            }
        }
    }

    /**
     * 格式化完成时间显示
     * @param completedTime 完成时间字符串
     * @returns 格式化的时间显示
     */
    private formatCompletedTime(completedTime: string): string {
        try {
            const today = getLogicalDateString();
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = getLocalDateString(yesterday);

            // 解析完成时间
            const completedDate = new Date(completedTime.replace(' ', 'T'));
            const completedDateLogicalStr = getLogicalDateString(completedDate);

            const timeStr = completedDate.toLocaleTimeString(getLocaleTag(), {
                hour: '2-digit',
                minute: '2-digit'
            });

            if (completedDateLogicalStr === today) {
                return `${i18n('today')} ${timeStr}`;
            } else if (completedDateLogicalStr === yesterdayStr) {
                return `${i18n('yesterday')} ${timeStr}`;
            } else {
                const dateStr = completedDate.toLocaleDateString(getLocaleTag(), {
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

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");
        const today = getLogicalDateString();

        // --- 订阅任务处理 ---
        if (reminder.isSubscribed) {
            // 导航选项
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📖",
                    label: i18n("openNote") || "打开笔记",
                    click: () => this.openBlockTab(reminder.blockId)
                });
                menu.addItem({
                    iconHTML: "📋",
                    label: i18n("copyBlockRef") || "复制块引用",
                    click: () => this.copyBlockRef(reminder)
                });
            }

            if (reminder.projectId) {
                menu.addItem({
                    icon: "iconProject",
                    label: i18n("openProjectKanban") || "打开项目看板",
                    click: () => this.openProjectKanban(reminder.projectId)
                });
            }

            menu.addSeparator();

            // 生产力工具
            menu.addItem({
                iconHTML: "🍅",
                label: i18n("startPomodoro") || "开始番茄钟",
                submenu: this.createPomodoroStartSubmenu(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: i18n("startCountUp") || "开始正向计时",
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: i18n("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });

            menu.addSeparator();

            // 说明订阅来源
            menu.addItem({
                iconHTML: "ℹ️",
                label: i18n("subscribedTask") || "订阅日历任务",
                disabled: true
            });

            menu.open({
                x: event.clientX,
                y: event.clientY,
            });
            return;
        }

        const isSpanningDays = reminder.endDate && reminder.endDate !== reminder.date;

        // 判断是否为重复/循环任务或重复实例
        const isRecurring = reminder.isRepeatInstance || (reminder.repeat && reminder.repeat.enabled);
        const isDessert = reminder.isAvailableToday && (!reminder.date || reminder.date !== today);

        // --- 每日可做任务专用菜单 ---
        // 只有当今天还没完成时才显示 "今日已完成"
        const dailyCompletedList = Array.isArray(reminder.dailyDessertCompleted) ? reminder.dailyDessertCompleted : [];
        const isAlreadyCompletedToday = dailyCompletedList.includes(today);

        if (isDessert && !reminder.completed && !isAlreadyCompletedToday) {
            menu.addItem({
                iconHTML: "✅",
                label: i18n("markTodayCompleted"),
                click: () => {
                    // Logic: Mark complete, set completion time, AND set date to today (so it shows in calendar history)
                    this.completeDailyDessert(reminder);
                }
            });

            // --- ❌ 今日忽略 ---
            const dailyIgnoredList = Array.isArray(reminder.dailyDessertIgnored) ? reminder.dailyDessertIgnored : [];
            const isIgnoredToday = dailyIgnoredList.includes(today);
            if (!isIgnoredToday) {
                menu.addItem({
                    iconHTML: "⭕",
                    label: i18n("todayIgnored").replace('⭕ ', ''),
                    click: () => {
                        this.ignoreDailyDessertToday(reminder);
                    }
                });
            } else {
                menu.addItem({
                    iconHTML: "↩️",
                    label: i18n("undoDailyDessertIgnore") || "取消今日忽略",
                    click: () => {
                        this.undoDailyDessertIgnore(reminder);
                    }
                });
            }

            menu.addSeparator();
        }

        // --- 取消今日已完成 (对于已经标记为今日完成的 Daily Dessert) ---
        // 这种情况通常在 "todayCompleted" 视图中出现
        // 我们检查 dailyDessertCompleted 数组
        if (reminder.isAvailableToday) {
            const dailyCompleted = Array.isArray(reminder.dailyDessertCompleted) ? reminder.dailyDessertCompleted : [];
            const today = getLogicalDateString();
            if (dailyCompleted.includes(today)) {
                menu.addItem({
                    iconHTML: "↩️",
                    label: i18n("unmarkTodayCompleted"),
                    click: () => {
                        this.undoDailyDessertCompletion(reminder);
                    }
                });
                menu.addSeparator();
            }
        }
        if (reminder.isRepeatInstance) {
            menu.addItem({
                iconHTML: "📝",
                label: i18n("modifyThisInstance"),
                click: () => this.showTimeEditDialog(reminder, false)
            });
            menu.addItem({
                iconHTML: "🔄",
                label: i18n("modifyAllInstances"),
                click: () => this.showTimeEditDialog(reminder, true)
            });
        } else {
            menu.addItem({
                iconHTML: "📝",
                label: i18n("modify"),
                click: () => this.showTimeEditDialog(reminder)
            });
        }
        // --- 创建子任务 ---
        menu.addItem({
            iconHTML: "➕",
            label: i18n("createSubtask"),
            click: () => this.showCreateSubtaskDialog(reminder)
        });
        // 粘贴新建子任务（参考 ProjectKanbanView 的实现）
        menu.addItem({
            iconHTML: "📋",
            label: i18n("pasteCreateSubtask"),
            click: () => this.showPasteTaskDialog(reminder)
        });
        // 解除父子任务关系（仅当任务有父任务时显示）
        if (reminder.parentId) {
            menu.addItem({
                iconHTML: "🔓",
                label: i18n("unsetParentRelation"),
                click: async () => {
                    try {
                        await this.removeParentRelation(reminder);
                        showMessage(i18n("taskUnlinkedFromParent").replace("${childTitle}", reminder.title || "任务").replace("${parentTitle}", "父任务"));
                    } catch (error) {
                        console.error('解除父子关系失败:', error);
                        showMessage(i18n("unlinkParentChildFailed") || "解除父子关系失败");
                    }
                }
            });
        }
        menu.addSeparator();

        // Helper to create priority submenu items, to avoid code repetition.
        // onlyThisInstance: true=只修改此实例, false=修改所有实例（原始事件）
        const createPriorityMenuItems = (onlyThisInstance: boolean = false) => {
            const menuItems = [];
            const priorities = [
                { key: 'high', label: i18n("high"), icon: '🔴' },
                { key: 'medium', label: i18n("medium"), icon: '🟡' },
                { key: 'low', label: i18n("low"), icon: '🔵' },
                { key: 'none', label: i18n("none"), icon: '⚫' }
            ];

            const currentPriority = reminder.priority || 'none';

            priorities.forEach(priority => {
                menuItems.push({
                    iconHTML: priority.icon,
                    label: priority.label,
                    current: currentPriority === priority.key,
                    click: () => {
                        if (reminder.isRepeatInstance && onlyThisInstance) {
                            // 只修改此实例，使用原始实例日期作为键
                            const originalInstanceDate = (reminder.id && reminder.id.includes('_')) ? reminder.id.split('_').pop()! : reminder.date;
                            this.setInstancePriority(reminder.originalId, originalInstanceDate, priority.key);
                        } else {
                            // 修改原始事件（影响所有实例）
                            const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                            this.setPriority(targetId, priority.key);
                        }
                    }
                });
            });
            return menuItems;
        };

        // 优化分类子菜单项创建 - 确保emoji正确显示
        // onlyThisInstance: true=只修改此实例, false=修改所有实例（原始事件）
        const createCategoryMenuItems = (onlyThisInstance: boolean = false) => {
            const menuItems = [];
            const categories = this.categoryManager.getCategories();
            const currentCategoryId = reminder.categoryId;

            // Add "无分类" option
            menuItems.push({
                iconHTML: "❌",
                label: i18n("noCategory"),
                current: !currentCategoryId,
                click: () => {
                    if (reminder.isRepeatInstance && onlyThisInstance) {
                        // 只修改此实例；使用原始实例日期作为键
                        const originalInstanceDate = (reminder.id && reminder.id.includes('_')) ? reminder.id.split('_').pop()! : reminder.date;
                        this.setInstanceCategory(reminder.originalId, originalInstanceDate, null);
                    } else {
                        // 修改原始事件（影响所有实例）
                        const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                        this.setCategory(targetId, null);
                    }
                }
            });

            // Add existing categories with proper emoji display
            categories.forEach(category => {
                menuItems.push({
                    iconHTML: category.icon || "📁",
                    label: category.name,
                    current: currentCategoryId === category.id,
                    click: () => {
                        if (reminder.isRepeatInstance && onlyThisInstance) {
                            // 只修改此实例；使用原始实例日期作为键
                            const originalInstanceDate = (reminder.id && reminder.id.includes('_')) ? reminder.id.split('_').pop()! : reminder.date;
                            this.setInstanceCategory(reminder.originalId, originalInstanceDate, category.id);
                        } else {
                            // 修改原始事件（影响所有实例）
                            const targetId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;
                            this.setCategory(targetId, category.id);
                        }
                    }
                });
            });

            return menuItems;
        };

        // 计算逻辑起止日期并检查是否为跨天事件且在今日任务中
        const startLogical = this.getReminderLogicalDate(reminder.date, reminder.time);
        const endLogical = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
        const isSpanningInToday = isSpanningDays && compareDateStrings(startLogical, today) <= 0 && compareDateStrings(today, endLogical) <= 0;


        // 添加项目管理选项（仅当任务有projectId时显示）
        if (reminder.projectId) {
            menu.addItem({
                icon: "iconGrid",
                label: i18n("openProjectKanban"),
                click: () => this.openProjectKanban(reminder.projectId)
            });
            menu.addSeparator();
        }

        // Helper: quick date submenu items
        const createQuickDateMenuItems = (targetReminder: any, onlyThisInstance: boolean = false) => {
            const items: any[] = [];
            const todayStr = getLogicalDateString();
            const tomorrowStr = getRelativeDateString(1);
            const dayAfterStr = getRelativeDateString(2);
            const nextWeekStr = getRelativeDateString(7);

            const apply = async (newDate: string | null) => {
                try {
                    if (targetReminder.isRepeatInstance && onlyThisInstance) {
                        // 使用原始实例日期作为键（如果实例曾被移动，reminder.date 可能已改变，应该使用 id 中的原始生成日期）
                        const originalInstanceDate = (targetReminder.id && targetReminder.id.includes('_')) ? targetReminder.id.split('_').pop()! : targetReminder.date;
                        await this.setInstanceDate(targetReminder.originalId, originalInstanceDate, newDate);
                    } else {
                        const targetId = targetReminder.isRepeatInstance ? targetReminder.originalId : targetReminder.id;
                        await this.setReminderBaseDate(targetId, newDate);
                    }
                } catch (err) {
                    console.error('快速调整日期失败:', err);
                    showMessage(i18n("operationFailed"));
                }
            };

            items.push({ iconHTML: "📅", label: i18n("moveToToday") || "移至今天", click: () => apply(todayStr) });
            items.push({ iconHTML: "📅", label: i18n("moveToTomorrow") || "移至明天", click: () => apply(tomorrowStr) });
            items.push({ iconHTML: "📅", label: i18n("moveToDayAfterTomorrow") || "移至后天", click: () => apply(dayAfterStr) });
            items.push({ iconHTML: "📅", label: i18n("moveToNextWeek") || "移至下周", click: () => apply(nextWeekStr) });
            items.push({ iconHTML: "❌", label: i18n("clearDate") || "清除日期", click: () => apply(null) });
            items.push({
                iconHTML: "✏️", label: i18n("editDate") || "编辑日期", click: () => {
                    const isInstanceEdit = targetReminder.isRepeatInstance && onlyThisInstance;
                    const originalInstanceDate = (targetReminder.isRepeatInstance && targetReminder.id && targetReminder.id.includes('_'))
                        ? targetReminder.id.split('_').pop()
                        : targetReminder.date;
                    const dlg = new QuickReminderDialog(
                        undefined, undefined, undefined, undefined,
                        {
                            mode: 'edit',
                            reminder: isInstanceEdit ? {
                                ...targetReminder,
                                isInstance: true,
                                originalId: targetReminder.originalId,
                                instanceDate: originalInstanceDate
                            } : targetReminder,
                            isInstanceEdit: isInstanceEdit,
                            plugin: this.plugin,
                            dateOnly: true,
                            onSaved: async (savedReminder) => {
                                if (savedReminder && savedReminder.id) {
                                    await this.handleOptimisticSavedReminder(savedReminder);
                                } else {
                                    await this.loadReminders();
                                }
                                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                            }
                        }
                    );
                    dlg.show();
                }
            });
            return items;
        };

        if (reminder.isRepeatInstance) {
            // --- Menu for a REPEAT INSTANCE ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: i18n("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: i18n("bindToBlock"),
                    submenu: [
                        {
                            iconHTML: "🔗",
                            label: i18n("bindToBlock"),
                            click: () => this.showBindToBlockDialog(reminder, 'bind')
                        },
                        {
                            iconHTML: "📑",
                            label: i18n("newHeading"),
                            click: () => this.showBindToBlockDialog(reminder, 'heading')
                        },
                        {
                            iconHTML: "📄",
                            label: i18n("newDocument"),
                            click: () => this.showBindToBlockDialog(reminder, 'document')
                        }
                    ]
                });
            }

            // 为跨天的重复事件实例添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? i18n("unmarkTodayCompleted") : i18n("markTodayCompleted"),
                    click: () => {
                        if (isTodayCompleted) {
                            this.unmarkSpanningEventTodayCompleted(reminder);
                        } else {
                            this.markSpanningEventTodayCompleted(reminder);
                        }
                    }
                });
                menu.addSeparator();
            }



            // 快速调整日期 (重复实例：只修改此实例)
            menu.addItem({
                iconHTML: "📆",
                label: i18n("quickReschedule") || "快速调整日期",
                submenu: createQuickDateMenuItems(reminder, true)
            });

            // 优先级默认只修改此实例（因为不同实例的优先级可能不同）
            // 分类默认修改所有实例（因为分类一般不变）
            menu.addItem({
                iconHTML: "🎯",
                label: i18n("setPriority"),
                submenu: createPriorityMenuItems(true) // true 表示只修改此实例
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: i18n("setCategory"),
                submenu: createCategoryMenuItems(false) // false 表示修改所有实例
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: i18n("startPomodoro"),
                submenu: this.createPomodoroStartSubmenu(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: i18n("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: i18n("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteThisInstance"),
                click: () => this.deleteInstanceOnly(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteAllInstances"),
                click: () => this.deleteOriginalReminder(reminder.originalId)
            });

        } else {
            // --- Menu for a SIMPLE, NON-RECURRING EVENT ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: i18n("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: i18n("bindToBlock"),
                    submenu: [
                        {
                            iconHTML: "🔗",
                            label: i18n("bindToBlock"),
                            click: () => this.showBindToBlockDialog(reminder, 'bind')
                        },
                        {
                            iconHTML: "📑",
                            label: i18n("newHeading"),
                            click: () => this.showBindToBlockDialog(reminder, 'heading')
                        },
                        {
                            iconHTML: "📄",
                            label: i18n("newDocument"),
                            click: () => this.showBindToBlockDialog(reminder, 'document')
                        }
                    ]
                });
            }

            // 为跨天的普通事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? i18n("unmarkTodayCompleted") : i18n("markTodayCompleted"),
                    click: () => {
                        if (isTodayCompleted) {
                            this.unmarkSpanningEventTodayCompleted(reminder);
                        } else {
                            this.markSpanningEventTodayCompleted(reminder);
                        }
                    }
                });
                menu.addSeparator();
            }


            // 快速调整日期（普通任务）
            menu.addItem({
                iconHTML: "📆",
                label: i18n("quickReschedule") || "快速调整日期",
                submenu: createQuickDateMenuItems(reminder, false)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: i18n("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: i18n("setCategory"),
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: i18n("startPomodoro"),
                submenu: this.createPomodoroStartSubmenu(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: i18n("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: i18n("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });
            menu.addItem({
                iconHTML: "🗑",
                label: i18n("deleteReminder"),
                click: () => this.deleteReminder(reminder)
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private createPomodoroStartSubmenu(reminder: any): any[] {
        return createSharedPomodoroStartSubmenu({
            source: reminder,
            plugin: this.plugin,
            startPomodoro: (workDurationOverride?: number) => this.startPomodoro(reminder, workDurationOverride)
        });
    }

    /**
     * 将非实例任务或系列原始任务的基准日期设置为 newDate。
     * 保持跨天跨度（若存在 endDate）。
     */
    private async setReminderBaseDate(reminderId: string, newDate: string | null) {
        const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
        const reminder = reminderData[reminderId];
        if (!reminder) {
            showMessage(i18n("reminderNotExist"));
            return;
        }

        try {
            const oldDate: string | undefined = reminder.date;
            const oldEndDate: string | undefined = reminder.endDate;

            if (newDate === null) {
                // 清除日期及相关结束日期/时间
                delete reminder.date;
                delete reminder.time;
                delete reminder.endDate;
                delete reminder.endTime;
            } else {
                reminder.date = newDate;
                if (oldEndDate && oldDate) {
                    const span = getDaysDifference(oldDate, oldEndDate);
                    reminder.endDate = addDaysToDate(newDate, span);
                }
            }

            await saveReminders(this.plugin, reminderData);

            if (reminder.blockId) {
                try { await updateBindBlockAtrrs(reminder.blockId, this.plugin); } catch (e) { /* ignore */ }
            }

            // 刷新界面显示并通知其他面板
            await this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
        } catch (err) {
            console.error('设置基准日期失败:', err);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * 设置重复事件的某个实例日期（通过 instanceModifications）。
     * 同时根据原始事件的跨度设置实例的 endDate 修改。
     */
    private async setInstanceDate(originalId: string, instanceDate: string, newDate: string | null) {
        const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
        const originalReminder = reminderData[originalId];
        if (!originalReminder || !originalReminder.repeat?.enabled) {
            showMessage(i18n("reminderNotExist"));
            return;
        }

        try {
            if (!originalReminder.repeat.instanceModifications) {
                originalReminder.repeat.instanceModifications = {};
            }
            if (!originalReminder.repeat.instanceModifications[instanceDate]) {
                originalReminder.repeat.instanceModifications[instanceDate] = {};
            }

            // 设置新的日期（如果为 null，表示用户选择清除该实例）
            if (newDate === null) {
                // 将 date 显式设为 null 表示该实例被移除/清空（generateRepeatInstances 会对此做特殊处理）
                originalReminder.repeat.instanceModifications[instanceDate].date = null;
                // 同时移除 endDate 修改
                delete originalReminder.repeat.instanceModifications[instanceDate].endDate;
            } else {
                originalReminder.repeat.instanceModifications[instanceDate].date = newDate;

                // 若原始为跨天，保持跨度
                if (originalReminder.endDate && originalReminder.date) {
                    const span = getDaysDifference(originalReminder.date, originalReminder.endDate);
                    originalReminder.repeat.instanceModifications[instanceDate].endDate = addDaysToDate(newDate, span);
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 刷新界面显示并通知其他面板
            await this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
            showMessage(i18n("instanceTimeUpdated") || "实例时间已更新");
        } catch (err) {
            console.error('设置实例日期失败:', err);
            showMessage(i18n("operationFailed"));
        }
    }

    private startPomodoro(reminder: any, workDurationOverride?: number) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (this.pomodoroManager.hasActivePomodoroTimer()) {
            // 获取当前番茄钟的状态
            const currentState = this.pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = reminder.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                if (!this.pomodoroManager.pauseCurrentTimer()) {
                    console.error('暂停当前番茄钟失败');
                }

                const timeDisplay = currentState.isWorkPhase ?
                    `工作时间 ${Math.floor(currentState.timeElapsed / 60)}:${(currentState.timeElapsed % 60).toString().padStart(2, '0')}` :
                    `休息时间 ${Math.floor(currentState.timeLeft / 60)}:${(currentState.timeLeft % 60).toString().padStart(2, '0')}`;

                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
            }

            // 显示确认对话框
            confirm(
                "切换番茄钟任务",
                confirmMessage,
                () => {
                    // 用户确认替换，传递当前状态
                    this.performStartPomodoro(reminder, currentState, workDurationOverride);
                },
                () => {
                    // 用户取消，尝试恢复原番茄钟的运行状态
                    if (currentState.isRunning && !currentState.isPaused) {
                        if (!this.pomodoroManager.resumeCurrentTimer()) {
                            console.error('恢复番茄钟运行失败');
                        }
                    }
                }
            );
        } else {
            // 没有活动番茄钟或窗口已关闭，清理引用并直接启动
            this.pomodoroManager.cleanupInactiveTimer();
            this.performStartPomodoro(reminder, undefined, workDurationOverride);
        }
    }



    /**
     * 标记跨天事件"今日已完成"
     * @param reminder 提醒对象
     */
    private async markSpanningEventTodayCompleted(reminder: any) {
        try {
            const today = getLogicalDateString();
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');



            if (reminder.isRepeatInstance) {
                // 重复事件实例：更新原始事件的每日完成记录
                const originalId = reminder.originalId;
                if (reminderData[originalId]) {
                    if (!reminderData[originalId].dailyCompletions) {
                        reminderData[originalId].dailyCompletions = {};
                    }
                    if (!reminderData[originalId].dailyCompletionsTimes) {
                        reminderData[originalId].dailyCompletionsTimes = {};
                    }
                    reminderData[originalId].dailyCompletions[today] = true;
                    reminderData[originalId].dailyCompletionsTimes[today] = getLocalDateTimeString(new Date());
                }
            } else {
                if (reminderData[reminder.id]) {
                    if (!reminderData[reminder.id].dailyCompletions) {
                        reminderData[reminder.id].dailyCompletions = {};
                    }
                    if (!reminderData[reminder.id].dailyCompletionsTimes) {
                        reminderData[reminder.id].dailyCompletionsTimes = {};
                    }
                    reminderData[reminder.id].dailyCompletions[today] = true;
                    reminderData[reminder.id].dailyCompletionsTimes[today] = getLocalDateTimeString(new Date());
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 局部更新：更新该提醒显示及其父项进度（如果显示）
            // 传入更新后的数据以便正确判断完成状态

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }

            // 刷新界面显示
            this.loadReminders();
            showMessage(i18n("markedTodayCompleted"), 2000);
        } catch (error) {
            console.error('标记今日已完成失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * 取消标记跨天事件"今日已完成"
     * @param reminder 提醒对象
     */
    private async unmarkSpanningEventTodayCompleted(reminder: any) {
        try {
            const today = getLogicalDateString();
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');



            if (reminder.isRepeatInstance) {
                // 重复事件实例：更新原始事件的每日完成记录
                const originalId = reminder.originalId;
                if (reminderData[originalId]) {
                    if (reminderData[originalId].dailyCompletions) {
                        delete reminderData[originalId].dailyCompletions[today];
                    }
                    if (reminderData[originalId].dailyCompletionsTimes) {
                        delete reminderData[originalId].dailyCompletionsTimes[today];
                    }
                }
            } else {
                // 普通事件：更新事件的每日完成记录
                if (reminderData[reminder.id]) {
                    if (reminderData[reminder.id].dailyCompletions) {
                        delete reminderData[reminder.id].dailyCompletions[today];
                    }
                    if (reminderData[reminder.id].dailyCompletionsTimes) {
                        delete reminderData[reminder.id].dailyCompletionsTimes[today];
                    }
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }

            // 刷新界面显示
            this.loadReminders();
            showMessage(i18n("unmarkedTodayCompleted"), 2000);
        } catch (error) {
            console.error('取消今日已完成失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    private async performStartPomodoro(reminder: any, inheritState?: any, workDurationOverride?: number) {
        const settings = await this.plugin.getPomodoroSettings();
        const runtimeSettings = workDurationOverride && workDurationOverride > 0
            ? { ...settings, workDuration: workDurationOverride }
            : settings;

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟');
            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, runtimeSettings, false, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换任务并继承${phaseText}进度`, 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const pomodoroTimer = new PomodoroTimer(reminder, runtimeSettings, false, inheritState, this.plugin);

            // 设置当前活动的番茄钟实例
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);

            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换任务并继承${phaseText}进度`, 2000);
            }
        }
    }

    private startPomodoroCountUp(reminder: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (this.pomodoroManager.hasActivePomodoroTimer()) {
            // 获取当前番茄钟的状态
            const currentState = this.pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = reminder.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                if (!this.pomodoroManager.pauseCurrentTimer()) {
                    console.error('暂停当前番茄钟失败');
                }

                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
            }

            // 显示确认对话框
            confirm(
                "切换到正计时番茄钟",
                confirmMessage,
                () => {
                    // 用户确认替换，传递当前状态
                    this.performStartPomodoroCountUp(reminder, currentState);
                },
                () => {
                    // 用户取消，尝试恢复番茄钟的运行状态
                    if (currentState.isRunning && !currentState.isPaused) {
                        if (!this.pomodoroManager.resumeCurrentTimer()) {
                            console.error('恢复番茄钟运行失败');
                        }
                    }
                }
            );
        } else {
            // 没有活动番茄钟或窗口已关闭，清理引用并直接启动
            this.pomodoroManager.cleanupInactiveTimer();
            this.performStartPomodoroCountUp(reminder);
        }
    }

    private async performStartPomodoroCountUp(reminder: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟（正计时模式）');
            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, true, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
                } else {
                    showMessage("已启动正计时番茄钟", 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）
            console.log('（正计时模式）');

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState, this.plugin);

            // 设置当前活动的番茄钟实例并直接切换到正计时模式
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);

            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
            } else {
                showMessage("已启动正计时番茄钟", 2000);
            }
        }
    }




    /**
     * [NEW] Calculates the next occurrence date based on the repeat settings.
     * @param startDateStr The starting date string (YYYY-MM-DD).
     * @param repeat The repeat configuration object from RepeatConfig.
     * @returns A Date object for the next occurrence.
     */
    private calculateNextDate(startDateStr: string, repeat: any): Date {
        const startDate = new Date(startDateStr + 'T12:00:00');
        if (isNaN(startDate.getTime())) {
            console.error("Invalid start date for cycle calculation:", startDateStr);
            return null;
        }

        if (!repeat || !repeat.enabled) {
            return null;
        }

        switch (repeat.type) {
            case 'daily':
                return this.calculateDailyNext(startDate, repeat.interval || 1);

            case 'weekly':
                return this.calculateWeeklyNext(startDate, repeat.interval || 1);

            case 'monthly':
                return this.calculateMonthlyNext(startDate, repeat.interval || 1);

            case 'yearly':
                return this.calculateYearlyNext(startDate, repeat.interval || 1);

            case 'lunar-monthly':
                return this.calculateLunarMonthlyNext(startDateStr, repeat);

            case 'lunar-yearly':
                return this.calculateLunarYearlyNext(startDateStr, repeat);

            case 'custom':
                return this.calculateCustomNext(startDate, repeat);

            case 'ebbinghaus':
                return this.calculateEbbinghausNext(startDate, repeat.ebbinghausPattern || [1, 2, 4, 7, 15]);

            default:
                console.error("Unknown repeat type:", repeat.type);
                return null;
        }
    }

    /**
     * Calculate next daily occurrence
     */
    private calculateDailyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + interval);
        return nextDate;
    }

    /**
     * Calculate next weekly occurrence
     */
    private calculateWeeklyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + (7 * interval));
        return nextDate;
    }

    /**
     * Calculate next monthly occurrence
     */
    private calculateMonthlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setMonth(nextDate.getMonth() + interval);

        // Handle month overflow (e.g., Jan 31 + 1 month should be Feb 28/29, not Mar 3)
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // Set to last day of previous month
        }

        return nextDate;
    }

    /**
     * Calculate next yearly occurrence
     */
    private calculateYearlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setFullYear(nextDate.getFullYear() + interval);

        // Handle leap year edge case (Feb 29 -> Feb 28)
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // Set to last day of previous month
        }

        return nextDate;
    }

    /**
     * Calculate next custom occurrence
     */
    private calculateCustomNext(startDate: Date, repeat: any): Date {
        // For custom repeats, use the first available option
        // Priority: weekDays > monthDays > months

        if (repeat.weekDays && repeat.weekDays.length > 0) {
            return this.calculateNextWeekday(startDate, repeat.weekDays);
        }

        if (repeat.monthDays && repeat.monthDays.length > 0) {
            return this.calculateNextMonthday(startDate, repeat.monthDays);
        }

        if (repeat.months && repeat.months.length > 0) {
            return this.calculateNextMonth(startDate, repeat.months);
        }

        // Fallback to daily if no custom options
        return this.calculateDailyNext(startDate, 1);
    }

    /**
     * Calculate next occurrence based on weekdays
     */
    private calculateNextWeekday(startDate: Date, weekDays: number[]): Date {
        const nextDate = new Date(startDate);
        const currentWeekday = nextDate.getDay();

        // Sort weekdays and find next one
        const sortedWeekdays = [...weekDays].sort((a, b) => a - b);

        // Find next weekday in the same week
        let nextWeekday = sortedWeekdays.find(day => day > currentWeekday);

        if (nextWeekday !== undefined) {
            // Next occurrence is this week
            const daysToAdd = nextWeekday - currentWeekday;
            nextDate.setDate(nextDate.getDate() + daysToAdd);
        } else {
            // Next occurrence is next week, use first weekday
            const daysToAdd = 7 - currentWeekday + sortedWeekdays[0];
            nextDate.setDate(nextDate.getDate() + daysToAdd);
        }

        return nextDate;
    }

    /**
     * Calculate next occurrence based on month days
     */
    private calculateNextMonthday(startDate: Date, monthDays: number[]): Date {
        const nextDate = new Date(startDate);
        const currentDay = nextDate.getDate();

        // Sort month days and find next one
        const sortedDays = [...monthDays].sort((a, b) => a - b);

        // Find next day in the same month
        let nextDay = sortedDays.find(day => day > currentDay);

        if (nextDay !== undefined) {
            // Check if the day exists in current month
            const tempDate = new Date(nextDate.getFullYear(), nextDate.getMonth(), nextDay);
            if (tempDate.getMonth() === nextDate.getMonth()) {
                nextDate.setDate(nextDay);
                return nextDate;
            }
        }

        // Next occurrence is next month, use first day
        nextDate.setMonth(nextDate.getMonth() + 1);
        const firstDay = sortedDays[0];

        // Ensure the day exists in the target month
        const lastDayOfMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
        nextDate.setDate(Math.min(firstDay, lastDayOfMonth));

        return nextDate;
    }

    /**
     * Calculate next occurrence based on months
     */
    private calculateNextMonth(startDate: Date, months: number[]): Date {
        const nextDate = new Date(startDate);
        const currentMonth = nextDate.getMonth() + 1; // Convert to 1-based

        // Sort months and find next one
        const sortedMonths = [...months].sort((a, b) => a - b);

        // Find next month in the same year
        let nextMonth = sortedMonths.find(month => month > currentMonth);

        if (nextMonth !== undefined) {
            // Next occurrence is this year
            nextDate.setMonth(nextMonth - 1); // Convert back to 0-based
        } else {
            // Next occurrence is next year, use first month
            nextDate.setFullYear(nextDate.getFullYear() + 1);
            nextDate.setMonth(sortedMonths[0] - 1); // Convert back to 0-based
        }

        // Handle day overflow for months with fewer days
        const lastDayOfMonth = new Date(nextDate.getFullYear(), nextDate.getMonth() + 1, 0).getDate();
        if (nextDate.getDate() > lastDayOfMonth) {
            nextDate.setDate(lastDayOfMonth);
        }

        return nextDate;
    }

    /**
     * Calculate next ebbinghaus occurrence
     */
    private calculateEbbinghausNext(startDate: Date, pattern: number[]): Date {
        // For ebbinghaus, we need to track which step we're on
        // This is a simplified version - in practice, you'd need to track state
        const nextDate = new Date(startDate);

        // Use the first interval in the pattern as default
        const firstInterval = pattern[0] || 1;
        nextDate.setDate(nextDate.getDate() + firstInterval);

        return nextDate;
    }

    /**
     * Calculate next lunar monthly occurrence
     */
    private calculateLunarMonthlyNext(startDateStr: string, repeat: any): Date {
        try {
            const nextDateStr = getNextLunarMonthlyDate(startDateStr, repeat.lunarDay);
            if (nextDateStr) {
                return new Date(nextDateStr + 'T12:00:00');
            }
        } catch (error) {
            console.error('Failed to calculate lunar monthly next:', error);
        }
        // Fallback: add 30 days
        const fallbackDate = new Date(startDateStr + 'T12:00:00');
        fallbackDate.setDate(fallbackDate.getDate() + 30);
        return fallbackDate;
    }

    /**
     * Calculate next lunar yearly occurrence
     */
    private calculateLunarYearlyNext(startDateStr: string, repeat: any): Date {
        try {
            const nextDateStr = getNextLunarYearlyDate(startDateStr, repeat.lunarMonth, repeat.lunarDay);
            if (nextDateStr) {
                return new Date(nextDateStr + 'T12:00:00');
            }
        } catch (error) {
            console.error('Failed to calculate lunar yearly next:', error);
        }
        // Fallback: add 365 days
        const fallbackDate = new Date(startDateStr + 'T12:00:00');
        fallbackDate.setDate(fallbackDate.getDate() + 365);
        return fallbackDate;
    }

    private async deleteReminder(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            let hasDescendants = false;
            if (reminderData) {
                // 快速判断是否存在子任务（深度优先）
                const reminderMap = new Map<string, any>();
                Object.values(reminderData).forEach((r: any) => { if (r && r.id) reminderMap.set(r.id, r); });
                const stack = [reminder.id];
                const visited = new Set<string>();
                visited.add(reminder.id);
                while (stack.length > 0) {
                    const cur = stack.pop()!;
                    for (const r of reminderMap.values()) {
                        if (r.parentId === cur && !visited.has(r.id)) {
                            hasDescendants = true;
                            stack.length = 0; // break outer loop
                            break;
                        }
                    }
                }
            }

            const extra = hasDescendants ? '（包括子任务）' : '';

            await confirm(
                i18n("deleteReminder"),
                `${i18n("confirmDelete", { title: reminder.title })}${extra}`,
                () => {
                    this.performDeleteReminder(reminder.id);
                }
            );
        } catch (error) {
            // 回退到默认提示
            await confirm(
                i18n("deleteReminder"),
                i18n("confirmDelete", { title: reminder.title }),
                () => {
                    this.performDeleteReminder(reminder.id);
                }
            );
        }
    }

    private async performDeleteReminder(reminderId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');

            if (!reminderData[reminderId]) {
                showMessage(i18n("reminderNotExist"));
                return;
            }

            // 保存父任务ID（用于更新父任务进度）
            const reminder = reminderData[reminderId];
            const parentId = reminder?.parentId;

            // 构建提醒映射以便查找子任务
            const reminderMap = new Map<string, any>();
            Object.values(reminderData).forEach((r: any) => {
                if (r && r.id) reminderMap.set(r.id, r);
            });

            // 获取所有后代 id（递归）
            const descendantIds: string[] = [];
            const stack = [reminderId];
            const visited = new Set<string>();
            visited.add(reminderId);
            while (stack.length > 0) {
                const cur = stack.pop()!;
                for (const r of reminderMap.values()) {
                    if (r.parentId === cur && !visited.has(r.id)) {
                        descendantIds.push(r.id);
                        stack.push(r.id);
                        visited.add(r.id);
                    }
                }
            }

            // 收集要删除的 id（包括自身）
            const toDelete = new Set<string>([reminderId, ...descendantIds]);

            // 收集受影响的 blockId 以便之后更新书签
            const affectedBlockIds = new Set<string>();

            // 如果存在重复实例/原始提醒的特殊处理：删除时也应删除实例或原始记录（这里统一按 id 匹配）
            let deletedCount = 0;
            for (const id of Array.from(toDelete)) {
                const rem = reminderData[id];
                if (rem) {
                    if (rem.blockId) affectedBlockIds.add(rem.blockId);
                    delete reminderData[id];
                    deletedCount++;
                }
                // 还要删除可能是重复实例（形式为 `${originalId}_${date}`）的条目
                // 例如：如果删除原始提醒，则删除其实例; 如果删除实例则删除对应实例条目
                // 遍历所有 keys 查找以 id 开头的实例形式
                for (const key of Object.keys(reminderData)) {
                    if (toDelete.has(key)) continue; // 已处理
                    // 匹配 instance id pattern: startsWith(`${id}_`)
                    if (key.startsWith(id + '_')) {
                        const inst = reminderData[key];
                        if (inst && inst.blockId) affectedBlockIds.add(inst.blockId);
                        delete reminderData[key];
                        deletedCount++;
                    }
                }
            }

            if (deletedCount > 0) {
                await saveReminders(this.plugin, reminderData);

                // 更新受影响的块的书签状态
                for (const bId of affectedBlockIds) {
                    try {
                        await updateBindBlockAtrrs(bId, this.plugin);
                    } catch (e) {
                        console.warn('更新块书签失败:', bId, e);
                    }
                }

                // 局部更新DOM：移除被删除的任务及其子任务
                this.removeReminderFromDOM(reminderId, Array.from(toDelete));

                // 如果有父任务，更新父任务的进度条
                if (parentId) {
                    // 父任务进度将在下次刷新时自动更新
                }

                // 全量刷新面板，保证父任务进度、分页和异步数据都能够正确更新
                await this.loadReminders();
                showMessage(i18n("reminderDeleted"));

                // 触发其他组件更新
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: { source: this.panelId }
                }));
            } else {
                showMessage(i18n("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(i18n("deleteReminderFailed"));
        }
    }

    /**
     * 从DOM中移除提醒及其所有子任务
     * @param reminderId 主任务ID
     * @param allIdsToRemove 所有要移除的ID集合（包括主任务和所有后代）
     */
    private removeReminderFromDOM(reminderId: string, allIdsToRemove: string[]) {
        try {
            let removedCount = 0;

            // 移除所有相关的DOM元素
            allIdsToRemove.forEach(id => {
                const el = this.remindersContainer.querySelector(`[data-reminder-id="${id}"]`) as HTMLElement | null;
                if (el) {
                    el.remove();
                    removedCount++;

                    // 从缓存中移除
                    const cacheIndex = this.currentRemindersCache.findIndex(r => r.id === id);
                    if (cacheIndex > -1) {
                        this.currentRemindersCache.splice(cacheIndex, 1);
                    }
                }
            });

            // 更新任务总数
            if (removedCount > 0) {
                this.totalItems = Math.max(0, this.totalItems - removedCount);

                // 重新计算分页信息
                if (this.isPaginationEnabled && this.totalItems > 0) {
                    this.totalPages = Math.ceil(this.totalItems / this.itemsPerPage);
                    // 如果当前页超出范围，调整到最后一页
                    if (this.currentPage > this.totalPages) {
                        this.currentPage = this.totalPages;
                    }
                    this.renderPaginationControls(0);
                } else if (this.totalItems === 0) {
                    // 如果没有任务了，显示空状态
                    this.remindersContainer.innerHTML = `<div class="reminder-empty">${i18n("noReminders")}</div>`;
                    // 移除分页控件
                    const paginationEl = this.container.querySelector('.reminder-pagination-controls');
                    if (paginationEl) {
                        paginationEl.remove();
                    }
                }
            }

            // 从折叠状态集合中移除
            allIdsToRemove.forEach(id => {
                this.collapsedTasks.delete(id);
                this.userExpandedTasks.delete(id);
            });

        } catch (error) {
            console.error('从DOM移除任务失败:', error);
            // 出错时使用全局刷新
            this.loadReminders();
        }
    }

    private updateReminderCounts(overdueCount: number, todayCount: number, tomorrowCount: number, future7Count: number, completedCount: number, todayCompletedCount: number) {
        // 更新各个标签的提醒数量 - 添加未来7天和今日已完成的数量更新
        // 这里可以根据需要添加UI更新逻辑
        // console.log('提醒数量统计:', {
        //     overdue: overdueCount,
        //     today: todayCount,
        //     tomorrow: tomorrowCount,
        //     future7: future7Count,
        //     completed: completedCount,
        //     todayCompleted: todayCompletedCount
        // });
    }

    private async setPriority(reminderId: string, priority: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            if (reminderData[reminderId]) {
                // 检查是否为重复事件（修改全部实例的情况）
                const isRecurringEvent = reminderData[reminderId].repeat?.enabled;

                reminderData[reminderId].priority = priority;

                // 如果是重复事件，清除所有实例的优先级覆盖
                if (isRecurringEvent && reminderData[reminderId].repeat?.instanceModifications) {
                    const modifications = reminderData[reminderId].repeat.instanceModifications;
                    Object.keys(modifications).forEach(date => {
                        if (modifications[date].priority !== undefined) {
                            delete modifications[date].priority;
                        }
                    });
                }

                await saveReminders(this.plugin, reminderData);
                showMessage(i18n("priorityUpdated") || "优先级已更新");

                // 如果是重复事件（修改全部实例），需要重新加载面板以更新所有实例
                // 参考项目看板的实现，确保所有实例都能得到更新
                if (isRecurringEvent) {
                    await this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                } else {
                    // 非重复事件，只需手动更新当前任务DOM的优先级样式
                    // 更新缓存中的数据，确保右键菜单显示正确
                    const cacheIndex = this.currentRemindersCache.findIndex(r => r.id === reminderId);
                    if (cacheIndex > -1) {
                        this.currentRemindersCache[cacheIndex].priority = priority;
                    }

                    const el = this.remindersContainer.querySelector(`[data-reminder-id="${reminderId}"]`) as HTMLElement | null;
                    if (el) {
                        // 移除旧的优先级类名
                        el.classList.remove('reminder-priority-high', 'reminder-priority-medium', 'reminder-priority-low', 'reminder-priority-none');
                        // 添加新的优先级类名
                        el.classList.add(`reminder-priority-${priority}`);

                        // 更新优先级背景色和边框
                        let backgroundColor = '';
                        let borderColor = '';
                        switch (priority) {
                            case 'high':
                                backgroundColor = colorWithOpacity('var(--b3-card-error-background)', 0.5);
                                borderColor = 'var(--b3-card-error-color)';
                                break;
                            case 'medium':
                                backgroundColor = colorWithOpacity('var(--b3-card-warning-background)', 0.5);
                                borderColor = 'var(--b3-card-warning-color)';
                                break;
                            case 'low':
                                backgroundColor = colorWithOpacity('var(--b3-card-info-background)', 0.7);
                                borderColor = 'var(--b3-card-info-color)';
                                break;
                            default:
                                backgroundColor = colorWithOpacity('var(--b3-theme-background-light)', 0.1);
                                borderColor = 'var(--b3-theme-surface-lighter)';
                        }
                        el.style.backgroundColor = backgroundColor;
                        el.style.border = `2px solid ${borderColor}`;
                        el.dataset.priority = priority;
                    }

                    // 如果当前按优先级排序，需要触发刷新以重新排序
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { source: this.panelId }
                    }));
                    await this.loadReminders();

                }
            } else {
                showMessage(i18n("reminderNotExist"));
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    private async setCategory(reminderId: string, categoryId: string | null) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            if (reminderData[reminderId]) {
                // 检查是否为重复事件（修改全部实例的情况）
                const isRecurringEvent = reminderData[reminderId].repeat?.enabled;

                reminderData[reminderId].categoryId = categoryId;

                // 如果是重复事件，清除所有实例的分类覆盖
                if (isRecurringEvent && reminderData[reminderId].repeat?.instanceModifications) {
                    const modifications = reminderData[reminderId].repeat.instanceModifications;
                    Object.keys(modifications).forEach(date => {
                        if (modifications[date].categoryId !== undefined) {
                            delete modifications[date].categoryId;
                        }
                    });
                }

                await saveReminders(this.plugin, reminderData);
                showMessage(categoryId ? (i18n("categoryUpdated") || "分类已更新") : (i18n("categoryRemoved") || "分类已移除"));

                // 如果是重复事件（修改全部实例），需要重新加载面板以更新所有实例
                // 参考项目看板的实现，确保所有实例都能得到更新
                if (isRecurringEvent) {
                    await this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                } else {
                    // 非重复事件，只需手动更新当前任务DOM的分类标签
                    // 更新缓存中的数据，确保右键菜单显示正确
                    const cacheIndex = this.currentRemindersCache.findIndex(r => r.id === reminderId);
                    if (cacheIndex > -1) {
                        this.currentRemindersCache[cacheIndex].categoryId = categoryId;
                    }

                    const el = this.remindersContainer.querySelector(`[data-reminder-id="${reminderId}"]`) as HTMLElement | null;
                    if (el) {
                        const infoEl = el.querySelector('.reminder-item__info') as HTMLElement | null;
                        if (infoEl) {
                            // 移除现有的分类标签
                            const existingCategoryTag = infoEl.querySelector('.reminder-item__category');
                            if (existingCategoryTag) {
                                existingCategoryTag.remove();
                            }

                            // 如果有新的分类ID，添加新的分类标签
                            if (categoryId) {
                                const category = this.categoryManager.getCategoryById(categoryId);
                                if (category) {
                                    const categoryTag = document.createElement('div');
                                    categoryTag.className = 'reminder-item__category';
                                    categoryTag.style.cssText = `
                                        display: inline-flex;
                                        align-items: center;
                                        gap: 2px;
                                        font-size: 11px;
                                        background-color: ${category.color}20;
                                        color: ${category.color};
                                        border: 1px solid ${category.color}40;
                                        border-radius: 12px;
                                        padding: 2px 8px;
                                        margin-top: 4px;
                                        font-weight: 500;
                                    `;

                                    // 添加分类图标（如果有）
                                    if (category.icon) {
                                        const iconSpan = document.createElement('span');
                                        iconSpan.textContent = category.icon;
                                        iconSpan.style.cssText = 'font-size: 10px;';
                                        categoryTag.appendChild(iconSpan);
                                    }

                                    // 添加分类名称
                                    const nameSpan = document.createElement('span');
                                    nameSpan.textContent = category.name;
                                    categoryTag.appendChild(nameSpan);

                                    // 设置标题提示
                                    categoryTag.title = `分类: ${category.name}`;

                                    // 将分类标签添加到信息容器底部
                                    infoEl.appendChild(categoryTag);
                                }
                            }
                        }
                    }

                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { source: this.panelId }
                    }));
                    await this.loadReminders();
                }
            } else {
                showMessage(i18n("reminderNotExist"));
            }
        } catch (error) {
            console.error('设置分类失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * 设置重复事件某个实例的优先级（不影响其他实例）
     * @param originalId 原始事件ID
     * @param instanceDate 实例日期
     * @param priority 优先级
     */
    private async setInstancePriority(originalId: string, instanceDate: string, priority: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(i18n("reminderNotExist"));
                return;
            }

            // 初始化实例修改结构
            if (!originalReminder.repeat) {
                originalReminder.repeat = {};
            }
            if (!originalReminder.repeat.instanceModifications) {
                originalReminder.repeat.instanceModifications = {};
            }
            if (!originalReminder.repeat.instanceModifications[instanceDate]) {
                originalReminder.repeat.instanceModifications[instanceDate] = {};
            }

            // 设置实例的优先级
            originalReminder.repeat.instanceModifications[instanceDate].priority = priority;

            await saveReminders(this.plugin, reminderData);

            // 刷新界面显示并通知其他面板
            await this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));

            showMessage(i18n("instanceModified") || "实例已修改");
        } catch (error) {
            console.error('设置实例优先级失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * 设置重复事件某个实例的分类（不影响其他实例）
     * @param originalId 原始事件ID
     * @param instanceDate 实例日期
     * @param categoryId 分类ID（null表示无分类）
     */
    private async setInstanceCategory(originalId: string, instanceDate: string, categoryId: string | null) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(i18n("reminderNotExist"));
                return;
            }

            // 初始化实例修改结构
            if (!originalReminder.repeat) {
                originalReminder.repeat = {};
            }
            if (!originalReminder.repeat.instanceModifications) {
                originalReminder.repeat.instanceModifications = {};
            }
            if (!originalReminder.repeat.instanceModifications[instanceDate]) {
                originalReminder.repeat.instanceModifications[instanceDate] = {};
            }

            // 设置实例的分类
            originalReminder.repeat.instanceModifications[instanceDate].categoryId = categoryId;

            await saveReminders(this.plugin, reminderData);

            // 刷新界面显示并通知其他面板
            await this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));

            showMessage(i18n("instanceModified") || "实例已修改");
        } catch (error) {
            console.error('设置实例分类失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * [NEW] Ends the current recurring series and starts a new one from the next cycle.
     * @param reminder The original recurring reminder to split.
     */
    private async splitRecurringReminder(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            // Handle instance ID: if it's an instance, use originalId
            const targetId = (reminder.isRepeatInstance && reminder.originalId) ? reminder.originalId : reminder.id;
            const originalReminder = reminderData[targetId];
            if (!originalReminder || !originalReminder.repeat?.enabled) {
                showMessage(i18n("operationFailed"));
                return;
            }

            // 计算原始事件的下一个周期日期
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(i18n("operationFailed") + ": " + i18n("invalidRepeatConfig"));
                return;
            }
            const nextDateStr = getLocalDateString(nextDate);

            // 创建用于编辑的临时数据，用于修改原始事件（第一次发生）
            const editData = {
                ...originalReminder,
                // 保持原始事件的日期和时间，用户可以修改这个单次事件
                // 保持原始ID用于识别这是分割操作
                isSplitOperation: true,
                originalId: reminder.id,
                nextCycleDate: nextDateStr, // 保存下一个周期日期，用于创建新系列
            };

            // 打开编辑对话框
            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                async (modifiedReminder) => {
                    // 编辑完成后执行分割逻辑
                    await this.performSplitOperation(originalReminder, modifiedReminder);
                },
                undefined,
                {
                    mode: 'edit',
                    reminder: editData,
                    plugin: this.plugin
                }
            );
            editDialog.show();

        } catch (error) {
            console.error('开始分割重复事件系列失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * [MODIFIED] Performs the actual split operation after user edits the reminder
     * @param originalReminder The original recurring reminder
     * @param modifiedReminder The modified reminder data from edit dialog
     */
    private async performSplitOperation(originalReminder: any, modifiedReminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');

            // 1. 修改原始事件为单次事件（应用用户的修改）
            const singleReminder = {
                ...originalReminder,
                // 应用用户修改的数据到单次事件
                title: modifiedReminder.title,
                date: modifiedReminder.date,
                time: modifiedReminder.time,
                endDate: modifiedReminder.endDate,
                endTime: modifiedReminder.endTime,
                note: modifiedReminder.note,
                priority: modifiedReminder.priority,
                // 移除重复设置，变成单次事件
                repeat: undefined
            };

            // 2. 创建新的重复事件系列，保持原始时间设置
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒的重复历史数据
            delete newReminder.repeat.endDate;
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newReminder.id = newId;

            // 3. 设置新系列从下一个周期开始，保持原始时间设置
            newReminder.date = modifiedReminder.nextCycleDate;
            newReminder.endDate = modifiedReminder.nextCycleEndDate;
            // 保持原始的时间设置，不应用用户修改
            newReminder.time = originalReminder.time;
            newReminder.endTime = originalReminder.endTime;
            newReminder.title = originalReminder.title;
            newReminder.note = originalReminder.note;
            newReminder.priority = originalReminder.priority;

            // 如果用户修改了重复设置，应用到新系列
            if (modifiedReminder.repeat && modifiedReminder.repeat.enabled) {
                newReminder.repeat = { ...modifiedReminder.repeat };
                // 确保新系列没有结束日期限制
                delete newReminder.repeat.endDate;
            } else {
                // 如果用户禁用了重复，保持原始重复设置
                newReminder.repeat = { ...originalReminder.repeat };
                delete newReminder.repeat.endDate;
            }

            // 4. 保存修改
            reminderData[originalReminder.id] = singleReminder;
            reminderData[newId] = newReminder;
            await saveReminders(this.plugin, reminderData);

            // 5. 更新界面
            this.loadReminders();
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: { source: this.panelId }
            }));
            showMessage(i18n("seriesSplitSuccess"));

        } catch (error) {
            console.error('执行分割重复事件系列失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    // 新增：将实例作为新系列编辑（分割系列）
    private async editInstanceAsNewSeries(reminder: any) {
        try {
            const originalId = reminder.originalId;
            const instanceDate = reminder.date;

            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(i18n("reminderDataNotExist"));
                return;
            }

            // 1. 在当前实例日期的前一天结束原始系列
            // 计算原始系列应该结束的日期（当前实例的前一天）
            const untilDate = new Date(instanceDate);
            untilDate.setDate(untilDate.getDate() - 1);
            const newEndDateStr = getLocalDateString(untilDate);

            // 更新原始系列的结束日期
            if (!originalReminder.repeat) {
                originalReminder.repeat = {};
            }
            originalReminder.repeat.endDate = newEndDateStr;

            // 2. 创建新的重复事件系列
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒
            delete newReminder.repeat.endDate;
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 生成新的提醒ID
            const newId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newReminder.id = newId;

            // 3. 设置新系列的开始日期为当前实例日期
            newReminder.date = instanceDate;
            newReminder.endDate = reminder.endDate;
            newReminder.time = reminder.time;
            newReminder.endTime = reminder.endTime;

            // 4. 保存修改
            reminderData[originalId] = originalReminder;
            reminderData[newId] = newReminder;
            await saveReminders(this.plugin, reminderData);

            // 5. 打开编辑对话框编辑新系列
            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                async (savedReminder?: any) => {
                    try {
                        if (savedReminder && typeof savedReminder === 'object') {
                            await this.handleOptimisticSavedReminder(savedReminder);
                        } else {
                            await this.loadReminders();
                        }
                        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                    } catch (e) {
                        console.error('实例编辑乐观更新失败，回退刷新', e);
                        this.loadReminders();
                    }
                },
                undefined,
                {
                    mode: 'edit',
                    reminder: newReminder,
                    plugin: this.plugin
                }
            );
            editDialog.show();

        } catch (error) {
            console.error('分割重复事件系列失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    // 新增：编辑重复事件实例
    private async editInstanceReminder(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const originalReminder = reminderData[reminder.originalId];

            if (!originalReminder) {
                showMessage(i18n("reminderDataNotExist"));
                return;
            }

            // 从 instanceId 提取原始日期（格式：originalId_YYYY-MM-DD）
            const originalInstanceDate = reminder.id ? reminder.id.split('_').pop() : reminder.date;

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[originalInstanceDate];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: reminder.id,
                date: reminder.date,
                endDate: reminder.endDate,
                time: reminder.time,
                endTime: reminder.endTime,
                // 如果实例有修改，使用实例的值；否则使用原始值
                note: instanceMod?.note !== undefined ? instanceMod.note : (originalReminder.note || ''),
                priority: instanceMod?.priority !== undefined ? instanceMod.priority : originalReminder.priority,
                categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : originalReminder.categoryId,
                projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : originalReminder.projectId,
                customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : originalReminder.customGroupId,
                kanbanStatus: instanceMod?.kanbanStatus !== undefined ? instanceMod.kanbanStatus : originalReminder.kanbanStatus,
                // 提醒时间相关字段
                reminderTimes: instanceMod?.reminderTimes !== undefined ? instanceMod.reminderTimes : originalReminder.reminderTimes,
                customReminderPreset: instanceMod?.customReminderPreset !== undefined ? instanceMod.customReminderPreset : originalReminder.customReminderPreset,
                isInstance: true,
                originalId: reminder.originalId,
                instanceDate: originalInstanceDate // 使用从 instanceId 提取的原始日期

            };

            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                async () => {
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { source: this.panelId }
                    }));
                },
                undefined,
                {
                    mode: 'edit',
                    reminder: instanceData,
                    plugin: this.plugin,
                    isInstanceEdit: true
                }
            );
            editDialog.show();
        } catch (error) {
            console.error('打开实例编辑对话框失败:', error);
            showMessage(i18n("openModifyDialogFailed"));
        }
    }

    // 新增：删除单个重复事件实例
    private async deleteInstanceOnly(reminder: any) {
        await confirm(
            i18n("deleteThisInstance"),
            i18n("confirmDeleteInstance"),
            async () => {
                try {
                    const originalId = reminder.originalId;
                    const instanceDate = reminder.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(i18n("instanceDeleted"));
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { source: this.panelId }
                    }));
                } catch (error) {
                    console.error('删除重复实例失败:', error);
                    showMessage(i18n("deleteInstanceFailed"));
                }
            }
        );
    }

    // 新增：为原始重复事件添加排除日期
    private async addExcludedDate(originalId: string, excludeDate: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');

            if (reminderData[originalId]) {
                if (!reminderData[originalId].repeat) {
                    throw new Error('不是重复事件');
                }

                // 初始化排除日期列表
                if (!reminderData[originalId].repeat.excludeDates) {
                    reminderData[originalId].repeat.excludeDates = [];
                }

                // 添加排除日期（如果还没有的话）
                if (!reminderData[originalId].repeat.excludeDates.includes(excludeDate)) {
                    reminderData[originalId].repeat.excludeDates.push(excludeDate);
                }

                await saveReminders(this.plugin, reminderData);
            } else {
                throw new Error('原始事件不存在');
            }
        } catch (error) {
            console.error('添加排除日期失败:', error);
            throw error;
        }
    }

    private async showTimeEditDialog(reminder: any, isSeriesEdit: boolean = false) {
        let reminderToEdit = reminder;
        let isInstanceEdit = false;

        // 如果是重复实例
        if (reminder.isRepeatInstance && reminder.originalId) {
            try {
                // 如果是编辑整个系列，或者没有提供实例日期
                if (isSeriesEdit) {
                    // 优先使用缓存的原始提醒
                    if (this.originalRemindersCache[reminder.originalId]) {
                        reminderToEdit = this.originalRemindersCache[reminder.originalId];
                    } else {
                        const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                        if (reminderData && reminderData[reminder.originalId]) {
                            reminderToEdit = reminderData[reminder.originalId];
                        }
                    }
                } else {
                    // 编辑单个实例（Instance modification）
                    const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                    const originalReminder = reminderData[reminder.originalId];
                    if (!originalReminder) {
                        showMessage("原始周期事件不存在");
                        return;
                    }

                    // 从 ID 中提取原始生成日期
                    const originalInstanceDate = reminder.id && reminder.id.includes('_') ? reminder.id.split('_').pop()! : reminder.date;

                    // 检查实例级别的修改
                    const instanceModifications = originalReminder.repeat?.instanceModifications || {};
                    const instanceMod = instanceModifications[originalInstanceDate];

                    // 创建实例数据
                    reminderToEdit = {
                        ...originalReminder,
                        id: reminder.id,
                        title: instanceMod?.title !== undefined ? instanceMod.title : (originalReminder.title || ''),
                        date: reminder.date,
                        endDate: reminder.endDate,
                        time: reminder.time,
                        endTime: reminder.endTime,
                        note: instanceMod?.note !== undefined ? instanceMod.note : (originalReminder.note || ''),
                        priority: instanceMod?.priority !== undefined ? instanceMod.priority : (originalReminder.priority || 'none'),
                        isInstance: true,
                        originalId: reminder.originalId,
                        instanceDate: originalInstanceDate
                    };
                    isInstanceEdit = true;
                }
            } catch (e) {
                console.warn('获取原始提醒或处理实例失败:', e);
            }
        }

        const editDialog = new QuickReminderDialog(
            undefined,
            undefined,
            async (savedReminder?: any) => {
                try {
                    if (savedReminder && typeof savedReminder === 'object') {
                        await this.handleOptimisticSavedReminder(savedReminder);
                    } else {
                        await this.loadReminders();
                    }
                } catch (e) {
                    console.error('时间编辑乐观更新失败，回退刷新', e);
                    await this.loadReminders();
                }
            },
            undefined,
            {
                mode: 'edit',
                reminder: reminderToEdit,
                plugin: this.plugin,
                isInstanceEdit: isInstanceEdit
            }
        );
        editDialog.show();
    }

    private async deleteOriginalReminder(originalId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const originalReminder = reminderData[originalId];

            if (originalReminder) {
                this.deleteReminder(originalReminder);
            } else {
                showMessage(i18n("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            showMessage(i18n("deleteReminderFailed"));
        }
    }

    /**
     * [MODIFIED] Skip the first occurrence of a recurring reminder
     * This method advances the start date of the recurring reminder to the next cycle
     * @param reminder The original recurring reminder
     */
    private async skipFirstOccurrence(reminder: any) {
        await confirm(
            i18n("deleteThisInstance"),
            i18n("confirmSkipFirstOccurrence"),
            async () => {
                try {
                    const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                    const originalReminder = reminderData[reminder.id];

                    if (!originalReminder || !originalReminder.repeat?.enabled) {
                        showMessage(i18n("operationFailed"));
                        return;
                    }

                    // 计算下一个周期的日期
                    const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
                    if (!nextDate) {
                        showMessage(i18n("operationFailed") + ": " + i18n("invalidRepeatConfig"));
                        return;
                    }

                    // 将周期事件的开始日期更新为下一个周期
                    originalReminder.date = getLocalDateString(nextDate);

                    // 如果是跨天事件，也需要更新结束日期
                    if (originalReminder.endDate) {
                        const originalStartDate = new Date(reminder.date + 'T12:00:00');
                        const originalEndDate = new Date(originalReminder.endDate + 'T12:00:00');
                        const daysDiff = Math.floor((originalEndDate.getTime() - originalStartDate.getTime()) / (1000 * 60 * 60 * 24));

                        const newEndDate = new Date(nextDate);
                        newEndDate.setDate(newEndDate.getDate() + daysDiff);
                        originalReminder.endDate = getLocalDateString(newEndDate);
                    }

                    // 清理可能存在的首次发生相关的历史数据
                    if (originalReminder.repeat.completedInstances) {
                        const firstOccurrenceIndex = originalReminder.repeat.completedInstances.indexOf(reminder.date);
                        if (firstOccurrenceIndex > -1) {
                            originalReminder.repeat.completedInstances.splice(firstOccurrenceIndex, 1);
                        }
                    }

                    if (originalReminder.repeat.instanceModifications && originalReminder.repeat.instanceModifications[reminder.date]) {
                        delete originalReminder.repeat.instanceModifications[reminder.date];
                    }

                    if (originalReminder.repeat.excludeDates) {
                        const firstOccurrenceIndex = originalReminder.repeat.excludeDates.indexOf(reminder.date);
                        if (firstOccurrenceIndex > -1) {
                            originalReminder.repeat.excludeDates.splice(firstOccurrenceIndex, 1);
                        }
                    }

                    await saveReminders(this.plugin, reminderData);
                    showMessage(i18n("firstOccurrenceSkipped"));
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { source: this.panelId }
                    }));
                } catch (error) {
                    console.error('跳过首次发生失败:', error);
                    showMessage(i18n("operationFailed"));
                }
            }
        );
    }
    private async copyBlockRef(reminder: any) {
        try {
            // 获取块ID（对于重复事件实例，使用原始事件的blockId）
            const blockId = reminder.blockId || (reminder.isRepeatInstance ?
                await this.getOriginalBlockId(reminder.originalId) :
                reminder.id);

            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            // 获取事件标题
            const title = reminder.title || i18n("unnamedNote");

            // 生成静态锚文本块引格式
            const blockRef = `((${blockId} "${title}"))`;

            // 复制到剪贴板
            await platformUtils.writeText(blockRef);

        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage("复制块引失败");
        }
    }
    // 获取原始事件的blockId
    private async getOriginalBlockId(originalId: string): Promise<string | null> {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const originalReminder = reminderData[originalId];
            return originalReminder?.blockId || originalId;
        } catch (error) {
            console.error('获取原始块ID失败:', error);
            return null;
        }
    }

    /**
     * 显示绑定到块的对话框
     */
    private showBindToBlockDialog(reminder: any, defaultTab: 'bind' | 'document' | 'heading' = 'heading') {
        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            try {
                console.log('选择绑定到块ID:', blockId);
                await this.bindReminderToBlock(reminder, blockId);
                showMessage(i18n("reminderBoundToBlock"));
                // 绑定成功后刷新整个列表以确保显示正确
                this.loadReminders();
            } catch (error) {
                console.error('绑定提醒到块失败:', error);
                showMessage(i18n("bindToBlockFailed"));
            }
        }, {
            defaultTab: defaultTab,
            defaultParentId: reminder.parentId,
            defaultProjectId: reminder.projectId,
            defaultCustomGroupId: reminder.customGroupId,
            reminder: reminder
        });
        blockBindingDialog.show();
    }

    private showCreateSubtaskDialog(parentReminder: any) {
        // 计算最大排序值，以便将新任务放在末尾
        const allReminders = Array.from(this.allRemindersMap.values());
        const maxSort = allReminders.reduce((max, r) => Math.max(max, r.sort || 0), 0);
        const defaultSort = maxSort + 10000;

        const dialog = new QuickReminderDialog(
            undefined, // initialDate
            undefined, // initialTime
            async (savedReminder?: any) => { // onSaved - optimistic update
                try {
                    if (savedReminder && typeof savedReminder === 'object') {
                        await this.handleOptimisticSavedReminder(savedReminder);
                    }
                } catch (e) {
                    console.error('乐观渲染子任务失败，回退到完整刷新', e);
                    await this.loadReminders(true);
                }
            },
            undefined, // 无时间段选项
            { // options
                defaultParentId: parentReminder.id,
                defaultProjectId: parentReminder.projectId,
                defaultCategoryId: parentReminder.categoryId,
                defaultPriority: parentReminder.priority || 'none',
                // 自动填充父任务的自定义分组与状态
                defaultCustomGroupId: parentReminder.customGroupId || undefined,
                defaultStatus: parentReminder.kanbanStatus || undefined,
                defaultMilestoneId: parentReminder.milestoneId || undefined,
                plugin: this.plugin,
                defaultTitle: '', // 子任务标题默认为空
                defaultSort: defaultSort
            }
        );
        // 保留默认回调行为（QuickReminderDialog 内部仍会在后台保存并触发 reminderUpdated）
        dialog.show();
    }

    private showPasteTaskDialog(parentReminder: any) {
        const dialog = new PasteTaskDialog({
            plugin: this.plugin,
            parentTask: parentReminder,
            onSuccess: (totalCount) => {
                showMessage(`${totalCount} 个子任务已创建`);
                this.loadReminders();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
            }
        });
        dialog.show();
    }

    /**
     * 检查提醒是否应该在当前视图中显示
     */
    private shouldShowInCurrentView(reminder: any): boolean {
        const today = getLogicalDateString();
        const tomorrow = getRelativeDateString(1);
        const future7Days = getRelativeDateString(7);

        // 检查分类筛选
        if (this.currentCategoryFilter !== 'all') {
            if (this.currentCategoryFilter === 'none') {
                if (reminder.categoryId) return false;
            } else {
                if (reminder.categoryId !== this.currentCategoryFilter) return false;
            }
        }

        // 检查日期筛选
        switch (this.currentTab) {
            case 'overdue':
                if (!reminder.date || reminder.completed) return false;
                return compareDateStrings(this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time), today) < 0;
            case 'today':
                const startLogical_cur = this.getReminderLogicalDate(reminder.date, reminder.time);
                const endLogical_cur = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);

                // 常规今日任务
                const isNormalToday = reminder.date && (
                    (compareDateStrings(startLogical_cur, today) <= 0 && compareDateStrings(today, endLogical_cur) <= 0) ||
                    compareDateStrings(endLogical_cur, today) < 0
                );

                if (isNormalToday && !reminder.completed) return true;

                // 今日可做 (Daily Dessert)
                if (reminder.isAvailableToday && !reminder.completed) {
                    const availDate = reminder.availableStartDate || today;
                    if (compareDateStrings(availDate, today) <= 0) {
                        // 排除已有未来日期的任务
                        if (reminder.date && compareDateStrings(startLogical_cur!, today) > 0) return false;

                        // 检查今天是否已完成
                        const dailyCompleted = Array.isArray(reminder.dailyDessertCompleted) ? reminder.dailyDessertCompleted : [];
                        if (dailyCompleted.includes(today)) return false;

                        return true;
                    }
                }

                return false;
            case 'tomorrow':
                if (reminder.completed || !reminder.date) return false;
                return compareDateStrings(this.getReminderLogicalDate(reminder.date, reminder.time), tomorrow) <= 0 && compareDateStrings(tomorrow, this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time)) <= 0;
            case 'future7':
                if (reminder.completed || !reminder.date) return false;
                return compareDateStrings(tomorrow, this.getReminderLogicalDate(reminder.date, reminder.time)) <= 0 && compareDateStrings(this.getReminderLogicalDate(reminder.date, reminder.time), future7Days) <= 0;
            case 'completed':
                return reminder.completed;
            case 'todayCompleted':
                // 特殊处理 Daily Dessert: 如果它今天被标记完成了 (dailyDessertCompleted includes today)，也应该显示
                if (reminder.isAvailableToday) {
                    const dailyCompleted = Array.isArray(reminder.dailyDessertCompleted) ? reminder.dailyDessertCompleted : [];
                    if (dailyCompleted.includes(today)) return true;
                }

                if (!reminder.completed) return false;
                try {
                    const completedTime = this.getCompletedTime(reminder);
                    if (completedTime) {
                        const completedDate = completedTime.split(' ')[0];
                        return completedDate === today;
                    }
                } catch (e) {
                    // ignore
                }
                const startLogical_tc = this.getReminderLogicalDate(reminder.date, reminder.time);
                const endLogical_tc = this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time);
                return (reminder.endDate && compareDateStrings(startLogical_tc, today) <= 0 && compareDateStrings(today, endLogical_tc) <= 0) || startLogical_tc === today;
            case 'all':
                const sevenDaysAgo = getRelativeDateString(-7);
                return reminder.date && compareDateStrings(sevenDaysAgo, this.getReminderLogicalDate(reminder.date, reminder.time)) <= 0 && compareDateStrings(this.getReminderLogicalDate(reminder.endDate || reminder.date, reminder.endTime || reminder.time), today) < 0;
            default:
                return false;
        }
    }



    private renderCategorySelector(container: HTMLElement, defaultCategoryId?: string) {
        container.innerHTML = '';
        const categories = this.categoryManager.getCategories();

        const noCategoryEl = document.createElement('div');
        noCategoryEl.className = 'category-option';
        noCategoryEl.setAttribute('data-category', '');
        noCategoryEl.innerHTML = `<span>${i18n("noCategory")}</span>`;
        if (!defaultCategoryId) {
            noCategoryEl.classList.add('selected');
        }
        container.appendChild(noCategoryEl);

        categories.forEach(category => {
            const categoryEl = document.createElement('div');
            categoryEl.className = 'category-option';
            categoryEl.setAttribute('data-category', category.id);
            categoryEl.style.backgroundColor = category.color;
            categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
            if (category.id === defaultCategoryId) {
                categoryEl.classList.add('selected');
            }
            container.appendChild(categoryEl);
        });

        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                container.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });
    }

    private addReminderDialogStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#reminder-dialog-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'reminder-dialog-styles';
        style.textContent = `
            .reminder-dialog .b3-form__group {
                margin-bottom: 16px;
            }
            .reminder-dialog .b3-form__label {
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
            }
            .priority-selector {
                display: flex;
                gap: 8px;
            }
            .priority-option {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 16px;
                cursor: pointer;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }
            .priority-option:hover {
                background-color: var(--b3-theme-surface-lighter);
            }
            .priority-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }
            .priority-option .priority-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
            }
            .priority-option .priority-dot.high { background-color: #e74c3c; }
            .priority-option .priority-dot.medium { background-color: #f39c12; }
            .priority-option .priority-dot.low { background-color: #3498db; }
            .priority-option .priority-dot.none { background-color: #95a5a6; }

            .category-selector .category-option {
                padding: 4px 10px;
                border-radius: 8px;
                cursor: pointer;
                transition: transform 0.15s ease;
                border: 1px solid transparent;
                color: white;
            }
            .category-selector .category-option.selected {
                transform: scale(1.05);
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
                font-weight: bold;
            }
            .category-selector .category-option[data-category=""] {
                background-color: var(--b3-theme-background-light);
                color: var(--b3-theme-on-surface);
            }

            .reminder-date-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .reminder-date-container .b3-text-field {
                flex: 1;
            }
            .reminder-arrow {
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            }
            /* 父任务子任务进度条样式 */
            .reminder-progress-container {
                margin-top: 8px;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .reminder-progress-wrap {
                flex: 1;
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            }
            .reminder-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
                border-radius: 6px 0 0 6px;
            }
            .reminder-progress-text {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.9;
                min-width: 34px;
                text-align: right;
            }

            /* 分页控件样式 */
            .reminder-pagination-controls {
                margin-top: 8px;
            }
            .reminder-pagination-controls .b3-button {
                min-width: 32px;
                height: 32px;
                padding: 0 8px;
                font-size: 14px;
            }
            .reminder-pagination-controls .b3-button:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * 创建文档并绑定提醒
     */
    private async createDocumentAndBind(reminder: any, title: string, content: string): Promise<string> {
        try {
            // 获取插件设置
            const settings = await this.plugin.loadSettings();
            const notebook = settings.newDocNotebook;
            const pathTemplate = settings.newDocPath || '/{{now | date "2006/200601"}}/';

            if (!notebook) {
                throw new Error(i18n("pleaseConfigureNotebook"));
            }

            // 导入API函数
            const { renderSprig, createDocWithMd } = await import("../api");

            // 渲染路径模板
            let renderedPath: string;
            try {
                // 需要检测pathTemplate是否以/结尾，如果不是，则添加/
                if (!pathTemplate.endsWith('/')) {
                    renderedPath += pathTemplate + '/';
                } else {
                    renderedPath = pathTemplate;
                }
                renderedPath = await renderSprig(renderedPath + title);
            } catch (error) {
                console.error('渲染路径模板失败:', error);
                throw new Error(i18n("renderPathFailed"));
            }

            // 准备文档内容
            const docContent = content;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);
            // 绑定提醒到新创建的文档
            await this.bindReminderToBlock(reminder, docId);

            return docId;
        } catch (error) {
            console.error('创建文档并绑定失败:', error);
            throw error;
        }
    }

    /**
     * 将提醒绑定到指定的块
     */
    private async bindReminderToBlock(reminder: any, blockId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
            const reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[reminderId]) {
                // 获取块信息
                await refreshSql();
                const block = await getBlockByID(blockId);
                if (!block) {
                    throw new Error('目标块不存在');
                }

                // 更新提醒数据
                reminderData[reminderId].blockId = blockId;
                reminderData[reminderId].docId = block.root_id || blockId;

                await saveReminders(this.plugin, reminderData);

                // 将绑定的块添加项目ID属性 custom-task-projectId
                const projectId = reminderData[reminderId].projectId;
                if (projectId) {
                    const { addBlockProjectId } = await import('../api');
                    await addBlockProjectId(blockId, projectId);
                    console.debug('ReminderPanel: bindReminderToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBindBlockAtrrs(blockId, this.plugin);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: { source: this.panelId }
                }));
            } else {
                throw new Error('提醒不存在');
            }
        } catch (error) {
            console.error('绑定提醒到块失败:', error);
            throw error;
        }
    }

    /**
     * 打开项目看板
     * @param projectId 项目ID
     */
    private async openProjectKanban(projectId: string) {
        try {
            // 获取项目数据以获取项目标题
            const projectData = await this.plugin.loadProjectData();

            if (!projectData || !projectData[projectId]) {
                showMessage("项目不存在");
                return;
            }

            const project = projectData[projectId];

            // 使用openProjectKanbanTab打开项目看板
            this.plugin.openProjectKanbanTab(project.id, project.title);
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage("打开项目看板失败");
        }
    }

    /**
     * 显示番茄钟统计视图
     */
    private showPomodoroStatsView() {
        try {
            const lastMode = getLastStatsMode();
            if (lastMode === 'task') {
                const statsView = new TaskStatsView(this.plugin);
                statsView.show();
            } else {
                const statsView = new PomodoroStatsView(this.plugin);
                statsView.show();
            }
        } catch (error) {
            console.error('打开番茄钟统计视图失败:', error);
            showMessage("打开番茄钟统计视图失败");
        }
    }


    /**
     * 打开四象限面板
     */
    private openEisenhowerMatrix() {
        try {
            // 使用插件的openEisenhowerMatrixTab方法打开四象限面板
            this.plugin.openEisenhowerMatrixTab();
        } catch (error) {
            console.error('打开四象限面板失败:', error);
            showMessage("打开四象限面板失败");
        }
    }

    private showNewTaskDialog() {
        try {
            // 计算最大排序值，以便将新任务放在末尾
            const allReminders = Array.from(this.allRemindersMap.values());
            const maxSort = allReminders.reduce((max, r) => Math.max(max, r.sort || 0), 0);
            const defaultSort = maxSort + 10000;

            const today = getLogicalDateString();
            const quickDialog = new QuickReminderDialog(
                today, // 初始日期为今天
                undefined, // 不指定初始时间
                async (savedReminder?: any) => {
                    // 乐观渲染：快速在面板中插入或更新元素，后台仍由 dialog 持久化并触发 reminderUpdated
                    try {
                        if (savedReminder && typeof savedReminder === 'object') {
                            await this.handleOptimisticSavedReminder(savedReminder);
                        } else {
                            // 兜底：完整加载
                            await this.loadReminders();
                        }
                    } catch (error) {
                        console.error('添加新任务乐观渲染失败，使用全局刷新:', error);
                        this.loadReminders();
                    }
                },
                undefined, // timeRangeOptions
                {
                    plugin: this.plugin, // 传入plugin实例
                    defaultSort: defaultSort
                }
            );
            quickDialog.show();
        } catch (error) {
            console.error('显示新建任务对话框失败:', error);
            showMessage(i18n("openNewTaskDialogFailed"));
        }
    }

    /**
     * 乐观渲染 QuickReminderDialog 保存后的提醒（在后台写入的同时立即更新 DOM）
     */
    private async handleOptimisticSavedReminder(savedReminder: any) {
        try {
            if (!savedReminder || typeof savedReminder !== 'object') return;

            // 1. 补齐 createdTime 字段以便排序显示
            if (savedReminder.createdAt && !savedReminder.createdTime) {
                savedReminder.createdTime = savedReminder.createdAt;
            }

            // 2. 更新内部缓存
            this.allRemindersMap.set(savedReminder.id, savedReminder);
            const existingCacheIdx = this.currentRemindersCache.findIndex(r => r.id === savedReminder.id);
            if (existingCacheIdx >= 0) {
                this.currentRemindersCache[existingCacheIdx] = savedReminder;
            } else {
                this.currentRemindersCache.push(savedReminder);
            }

            // 3. 应用当前排序规则到缓存，确定 sibling 间的相对顺序
            this.sortReminders(this.currentRemindersCache);

            // 4. 如果任务不满足当前视图筛选条件，且 DOM 中已存在则移除，然后退出
            if (!this.shouldShowInCurrentView(savedReminder)) {
                const existing = this.remindersContainer.querySelector(`[data-reminder-id="${savedReminder.id}"]`);
                if (existing) existing.remove();
                return;
            }

            // 5. 如果是新建子任务，确保其父任务在视觉上展开，以便子任务可见
            if (savedReminder.parentId) {
                if (!this.userExpandedTasks.has(savedReminder.parentId)) {
                    this.userExpandedTasks.add(savedReminder.parentId);
                    this.collapsedTasks.delete(savedReminder.parentId);
                }
            }

            // 6. 计算任务层级深度 (level)
            let level = 0;
            let temp = savedReminder;
            while (temp && temp.parentId && this.allRemindersMap.has(temp.parentId)) {
                level++;
                temp = this.allRemindersMap.get(temp.parentId);
            }

            // 7. 预处理异步数据以生成元素（尽可能提供周边语境以准确计算子任务数等）
            const reminderDataFull: any = {};
            this.currentRemindersCache.forEach(r => reminderDataFull[r.id] = r);
            const asyncDataCache = await this.preprocessAsyncData([savedReminder], reminderDataFull);

            const today = getLogicalDateString();
            const el = this.createReminderElementOptimized(savedReminder, asyncDataCache, today, level, this.currentRemindersCache);

            // 8. 查找视觉上的插入位置 (DFS 顺序)
            const visualOrderIds = this.getVisualOrderIds(this.currentRemindersCache);
            const myIndex = visualOrderIds.indexOf(savedReminder.id);

            // 如果该任务由于某些原因（如祖先被折叠）不应出现在当前视觉列表中，则移除/不渲染
            if (myIndex === -1) {
                const existing = this.remindersContainer.querySelector(`[data-reminder-id="${savedReminder.id}"]`);
                if (existing) existing.remove();
                return;
            }

            // 查找在我之后的第一个已渲染在 DOM 中的元素作为 nextEl
            let nextEl: HTMLElement | null = null;
            for (let i = myIndex + 1; i < visualOrderIds.length; i++) {
                const targetId = visualOrderIds[i];
                if (targetId === savedReminder.id) continue;
                const targetEl = this.remindersContainer.querySelector(`[data-reminder-id="${targetId}"]`);
                if (targetEl && targetEl !== el) {
                    nextEl = targetEl as HTMLElement;
                    break;
                }
            }

            // 8.5 特殊处理今日视图下的每日可做分隔符 (Daily Dessert Separator)
            // 确保普通任务不会被错误地插入到分隔符下方
            if (this.currentTab === 'today') {
                const isSavedDessert = savedReminder.isAvailableToday && (!savedReminder.date || savedReminder.date !== today);
                const separator = this.remindersContainer.querySelector('#daily-dessert-separator') as HTMLElement;
                if (separator) {
                    if (!isSavedDessert) {
                        // 普通任务：必须在分隔符上方
                        let shouldInsertBeforeSeparator = false;
                        if (!nextEl) {
                            shouldInsertBeforeSeparator = true;
                        } else {
                            const nextId = nextEl.getAttribute('data-reminder-id');
                            const nextReminder = nextId ? this.allRemindersMap.get(nextId) : null;
                            if (nextReminder && nextReminder.isAvailableToday && (!nextReminder.date || nextReminder.date !== today)) {
                                shouldInsertBeforeSeparator = true;
                            }
                        }
                        if (shouldInsertBeforeSeparator) {
                            nextEl = separator;
                        }
                    }
                }
            }

            // 9. 执行 DOM 插入或位置校正
            const existing = this.remindersContainer.querySelector(`[data-reminder-id="${savedReminder.id}"]`);
            if (existing) {
                // 如果当前位置不正确 (nextElementSibling 与预期的 nextEl 不符)，则重新插入
                if (existing.nextElementSibling !== nextEl) {
                    existing.remove();
                    if (nextEl) {
                        this.remindersContainer.insertBefore(el, nextEl);
                    } else {
                        this.remindersContainer.appendChild(el);
                    }
                } else {
                    // 位置正确则仅替换内容
                    existing.replaceWith(el);
                }
            } else {
                if (nextEl) {
                    this.remindersContainer.insertBefore(el, nextEl);
                } else {
                    // 找不到后项时，尝试找前项插入其后
                    let prevEl: HTMLElement | null = null;
                    for (let i = myIndex - 1; i >= 0; i--) {
                        const targetId = visualOrderIds[i];
                        const targetEl = this.remindersContainer.querySelector(`[data-reminder-id="${targetId}"]`);
                        if (targetEl) {
                            prevEl = targetEl as HTMLElement;
                            break;
                        }
                    }
                    if (prevEl) {
                        // 8.6 针对每日可做任务修正 prevEl
                        if (this.currentTab === 'today') {
                            const isSavedDessert = savedReminder.isAvailableToday && (!savedReminder.date || savedReminder.date !== today);
                            if (isSavedDessert) {
                                const separator = this.remindersContainer.querySelector('#daily-dessert-separator') as HTMLElement;
                                if (separator) {
                                    const prevId = prevEl.getAttribute('data-reminder-id');
                                    const prevReminder = prevId ? this.allRemindersMap.get(prevId) : null;
                                    const isPrevDessert = prevReminder && prevReminder.isAvailableToday && (!prevReminder.date || prevReminder.date !== today);
                                    if (!isPrevDessert) {
                                        // 如果前一个是普通任务，而我是每日可做，则我应该在分隔符之后
                                        prevEl = separator;
                                    }
                                }
                            }
                        }
                        prevEl.after(el);
                    } else {
                        // 连前项都没有，说明是列表首个元素
                        this.remindersContainer.prepend(el);
                    }
                }
            }

            // 10. 清理空状态
            const emptyState = this.remindersContainer.querySelector('.reminder-empty, .empty-state');
            if (emptyState) emptyState.remove();

        } catch (error) {
            console.error('handleOptimisticSavedReminder error:', error);
            // 乐观渲染失败，尝试通过全量刷新兜底
            try { await this.loadReminders(true); } catch (e) { /* ignore */ }
        }
    }

    /**
     * 显示更多菜单
     */
    private showMoreMenu(event: MouseEvent) {
        try {
            const menu = new Menu("reminderMoreMenu");

            // 添加粘贴新建任务
            menu.addItem({
                icon: 'iconPaste',
                label: i18n("pasteCreateTask") || "粘贴新建任务",
                click: () => {
                    const dialog = new PasteTaskDialog({
                        plugin: this.plugin,
                        defaultSetDate: true,
                        defaultDateStr: getLogicalDateString(),
                        onSuccess: () => {
                            this.loadReminders(true);
                        }
                    });
                    dialog.show();
                }
            });

            // 添加分类管理
            menu.addItem({
                icon: 'iconTags',
                label: i18n("manageCategories"),
                click: () => this.showCategoryManageDialog()
            });

            // 添加过滤器管理
            menu.addItem({
                icon: 'iconFilter',
                label: i18n("manageFilters"),
                click: () => this.showFilterManagement()
            });

            // 添加插件设置
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
                        console.error('Failed to open plugin settings:', err);
                    }
                }
            });

            // 显示菜单
            if (event.target instanceof HTMLElement) {
                const rect = event.target.getBoundingClientRect();
                menu.open({
                    x: rect.left,
                    y: rect.bottom + 4
                });
            } else {
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示更多菜单失败:', error);
        }
    }

    /**
     * 渲染分页控件
     */
    private renderPaginationControls(truncatedTotal: number) {
        // 移除现有的分页控件
        const existingControls = this.container.querySelector('.reminder-pagination-controls');
        if (existingControls) {
            existingControls.remove();
        }

        this.lastTruncatedTotal = truncatedTotal;

        // 如果没有分页需求，直接返回
        if (this.totalPages <= 1 && truncatedTotal === 0) {
            return;
        }

        // 创建分页控件容器
        const paginationContainer = document.createElement('div');
        paginationContainer.className = 'reminder-pagination-controls';
        paginationContainer.style.cssText = `
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 12px;
            padding: 12px;
            border-top: 1px solid var(--b3-theme-border);
            background: var(--b3-theme-surface);
        `;

        // 分页信息
        const pageInfo = document.createElement('span');
        pageInfo.style.cssText = `
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            opacity: 0.8;
        `;

        if (this.isPaginationEnabled && this.totalPages > 1) {
            // 上一页按钮
            const prevBtn = document.createElement('button');
            prevBtn.className = 'b3-button b3-button--outline';
            prevBtn.innerHTML = '‹';
            prevBtn.disabled = this.currentPage <= 1;
            prevBtn.onclick = () => {
                if (this.currentPage > 1) {
                    this.currentPage--;
                    this.loadReminders();
                }
            };

            // 下一页按钮
            const nextBtn = document.createElement('button');
            nextBtn.className = 'b3-button b3-button--outline';
            nextBtn.innerHTML = '›';
            nextBtn.disabled = this.currentPage >= this.totalPages;
            nextBtn.onclick = () => {
                if (this.currentPage < this.totalPages) {
                    this.currentPage++;
                    this.loadReminders();
                }
            };

            // 页码信息
            pageInfo.textContent = i18n("pageInfoTemplate")
                .replace("${current}", this.currentPage.toString())
                .replace("${total}", this.totalPages.toString())
                .replace("${count}", this.totalItems.toString());

            paginationContainer.appendChild(prevBtn);
            paginationContainer.appendChild(pageInfo);
            paginationContainer.appendChild(nextBtn);
        } else if (truncatedTotal > 0) {
            // 非分页模式下的截断提示
            pageInfo.textContent = i18n("truncatedInfo")
                .replace("${count}", this.currentRemindersCache.length.toString())
                .replace("${hidden}", truncatedTotal.toString());
            paginationContainer.appendChild(pageInfo);
        } else {
            // 没有截断时的信息
            pageInfo.textContent = i18n("totalItemsInfo").replace("${count}", this.totalItems.toString());
            paginationContainer.appendChild(pageInfo);
        }

        // 将分页控件添加到容器底部
        this.container.appendChild(paginationContainer);
    }

    /**
     * 获取提醒的番茄钟计数
     */
    private async getReminderPomodoroCount(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            // If this is a repeat instance, always use per-event count
            if (reminder && reminder.isRepeatInstance) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            // Determine if this reminder has any descendants (regardless of depth)
            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    // If reminderData not provided, try to load global data
                    let rawData = reminderData;
                    if (!rawData) {
                        rawData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

            // If it has descendants, return aggregated count; otherwise, if it's a subtask without descendants, return per-event
            if (hasDescendants) {
                if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                    return await pomodoroManager.getAggregatedReminderPomodoroCount(reminderId);
                }
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }
            const isSubtask = reminder && reminder.parentId;
            if (isSubtask) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }
            if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                return await pomodoroManager.getAggregatedReminderPomodoroCount(reminderId);
            }
            return await pomodoroManager.getReminderPomodoroCount(reminderId);
        } catch (error) {
            console.error('Failed to get pomodoro count:', error);
            return 0;
        }
    }

    private async getReminderRepeatingTotalPomodoroCount(originalId: string): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            if (typeof pomodoroManager.getRepeatingEventTotalPomodoroCount === 'function') {
                return pomodoroManager.getRepeatingEventTotalPomodoroCount(originalId);
            }
            return 0;
        } catch (error) {
            console.error('获取重复事件总番茄钟计数失败:', error);
            return 0;
        }
    }

    private async getReminderRepeatingTotalFocusTime(originalId: string): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            if (typeof pomodoroManager.getRepeatingEventTotalFocusTime === 'function') {
                return pomodoroManager.getRepeatingEventTotalFocusTime(originalId);
            }
            return 0;
        } catch (error) {
            console.error('获取重复事件总专注时长失败:', error);
            return 0;
        }
    }

    private async getReminderFocusTime(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            // If this is a repeat instance, always use per-event total
            if (reminder && reminder.isRepeatInstance) {
                if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
                if (typeof pomodoroManager.getEventFocusTime === 'function') {
                    return pomodoroManager.getEventFocusTime(reminderId);
                }
                return 0;
            }

            // Determine if this reminder has any descendants (regardless of depth)
            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    const reminderMap = reminderData instanceof Map ? reminderData : new Map(Object.values(reminderData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

            if (hasDescendants) {
                if (typeof pomodoroManager.getAggregatedReminderFocusTime === 'function') {
                    return await pomodoroManager.getAggregatedReminderFocusTime(reminderId);
                }
                if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
            }

            // If it's a subtask/leaf or no descendants found, return per-event total
            if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                return pomodoroManager.getEventTotalFocusTime(reminderId);
            }
            return 0;
        } catch (error) {
            console.error('获取番茄钟总专注时长失败:', error);
            return 0;
        }
    }

    /**
     * 获取指定提醒及其所有子任务在指定日期（默认为今日）的番茄数量
     * @param reminderId 提醒 ID（可能是实例 ID）
     * @param reminder 提醒对象（可选）
     * @param reminderData 全量提醒数据（可选）
     * @param date 指定日期（YYYY-MM-DD），如果传空则使用今日
     */
    private async getReminderTodayPomodoroCount(reminderId: string, reminder?: any, reminderData?: any, date?: string): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            const targetDate = date || getLogicalDateString();

            // If it's a repeat instance or an instance id (contains date), try direct event count
            if (reminder && reminder.isRepeatInstance) {
                if (typeof pomodoroManager.getEventPomodoroCount === 'function') {
                    if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                    return pomodoroManager.getEventPomodoroCount(reminderId, targetDate);
                }
                return 0;
            }

            // Build a set of event ids: root id + descendants + per-instance ids that match target date
            const idsToQuery = new Set<string>();

            // Add root
            idsToQuery.add(reminderId);

            // Build reminderData map if needed
            const raw = reminderData;
            let dataMap: Map<string, any> | null = null;
            if (raw instanceof Map) {
                dataMap = raw;
            } else if (raw && typeof raw === 'object') {
                dataMap = new Map(Object.values(raw).map((r: any) => [r.id, r]));
            } else {
                try {
                    const rd = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                    dataMap = new Map(Object.values(rd || {}).map((r: any) => [r.id, r]));
                } catch (e) {
                    dataMap = null;
                }
            }

            if (dataMap) {
                // Add descendants
                try {
                    const descendantIds = this.getAllDescendantIds(reminderId, dataMap);
                    descendantIds.forEach(id => idsToQuery.add(id));
                } catch (e) {
                    // ignore
                }

                // Also include per-instance IDs that match the target date (e.g. originalId_YYYY-MM-DD)
                try {
                    const suffix = `_${targetDate}`;
                    dataMap.forEach((r, k) => {
                        // if reminder is repeat enabled and belongs to our root, add constructed instance id
                        if (r && r.repeat && r.repeat.enabled) {
                            const constructed = `${k}_${targetDate}`;
                            try {
                                const originalId = k;
                                if (originalId === reminderId || this.getAllAncestorIds && this.getAllAncestorIds(k, dataMap).includes(reminderId)) {
                                    idsToQuery.add(constructed);
                                }
                            } catch (e) { }
                        }
                        if (k.endsWith(suffix)) {
                            // check whether this instance belongs to our reminder (originalId prefix)
                            const parts = k.split('_');
                            // remove trailing date to get original id
                            const originalId = parts.slice(0, -1).join('_');
                            if (originalId === reminderId || this.getAllAncestorIds && this.getAllAncestorIds(k, dataMap).includes(reminderId)) {
                                idsToQuery.add(k);
                            }
                        }
                    });
                } catch (e) {
                    // ignore
                }
            }

            // Sum event counts for the target date
            let total = 0;
            for (const id of idsToQuery) {
                try {
                    if (typeof pomodoroManager.getEventPomodoroCount === 'function') {
                        if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                        total += pomodoroManager.getEventPomodoroCount(id, targetDate) || 0;
                    }
                } catch (e) {
                    // ignore per-id errors
                }
            }

            return total;
        } catch (error) {
            console.error('获取今日番茄计数失败:', error);
            return 0;
        }
    }

    /**
     * 获取指定提醒及其所有子任务在指定日期（默认为今日）的专注时长（分钟）
     */
    private async getReminderTodayFocusTime(reminderId: string, reminder?: any, reminderData?: any, date?: string): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            const targetDate = date || getLogicalDateString();

            // If it's a repeat instance, use event-specific focus time
            if (reminder && reminder.isRepeatInstance) {
                if (typeof pomodoroManager.getEventFocusTime === 'function') {
                    if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                    return pomodoroManager.getEventFocusTime(reminderId, targetDate);
                }
                return 0;
            }

            // Build a set of ids to query: root + descendants + instance ids of the date
            const idsToQuery = new Set<string>();
            idsToQuery.add(reminderId);

            let dataMap: Map<string, any> | null = null;
            const raw = reminderData;
            if (raw instanceof Map) {
                dataMap = raw;
            } else if (raw && typeof raw === 'object') {
                dataMap = new Map(Object.values(raw).map((r: any) => [r.id, r]));
            } else {
                try {
                    const rd = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                    dataMap = new Map(Object.values(rd || {}).map((r: any) => [r.id, r]));
                } catch (e) {
                    dataMap = null;
                }
            }

            if (dataMap) {
                try {
                    const descendantIds = this.getAllDescendantIds(reminderId, dataMap);
                    descendantIds.forEach(id => idsToQuery.add(id));
                } catch (e) { }

                try {
                    const suffix = `_${targetDate}`;
                    dataMap.forEach((r, k) => {
                        if (r && r.repeat && r.repeat.enabled) {
                            const constructed = `${k}_${targetDate}`;
                            try {
                                const originalId = k;
                                if (originalId === reminderId || this.getAllAncestorIds && this.getAllAncestorIds(k, dataMap).includes(reminderId)) {
                                    idsToQuery.add(constructed);
                                }
                            } catch (e) { }
                        }
                        if (k.endsWith(suffix)) {
                            const parts = k.split('_');
                            const originalId = parts.slice(0, -1).join('_');
                            if (originalId === reminderId || this.getAllAncestorIds && this.getAllAncestorIds(k, dataMap).includes(reminderId)) {
                                idsToQuery.add(k);
                            }
                        }
                    });
                } catch (e) { }
            }

            let total = 0;
            for (const id of idsToQuery) {
                try {
                    if (typeof pomodoroManager.getEventFocusTime === 'function') {
                        if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                        total += pomodoroManager.getEventFocusTime(id, targetDate) || 0;
                    }
                } catch (e) { }
            }

            return total;
        } catch (error) {
            console.error('Failed to get today focus time:', error);
            return 0;
        }
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






    private async showCategorySelectDialog() {
        const categories = await this.categoryManager.loadCategories();

        const dialog = new Dialog({
            title: i18n("selectCategories"),
            content: this.createCategorySelectContent(categories),
            width: "500px",
            height: "300px"
        });

        // 绑定事件
        const confirmBtn = dialog.element.querySelector('#categorySelectConfirm') as HTMLButtonElement;
        const cancelBtn = dialog.element.querySelector('#categorySelectCancel') as HTMLButtonElement;
        const allCheckbox = dialog.element.querySelector('#categoryAll') as HTMLInputElement;
        const checkboxes = dialog.element.querySelectorAll('.category-checkbox') as NodeListOf<HTMLInputElement>;

        // 当"全部"改变时
        allCheckbox.addEventListener('change', () => {
            if (allCheckbox.checked) {
                checkboxes.forEach(cb => cb.checked = false);
            }
        });

        // 当其他改变时
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked) {
                    allCheckbox.checked = false;
                }
            });
        });

        confirmBtn.addEventListener('click', () => {
            const selected = [];
            if (allCheckbox.checked) {
                selected.push('all');
            } else {
                checkboxes.forEach(cb => {
                    if (cb.checked) {
                        selected.push(cb.value);
                    }
                });
            }
            this.selectedCategories = selected;
            // 保存用户手动修改的分类筛选
            this.userManualCategories = [...selected];
            this.updateCategoryFilterButtonText();
            this.saveSelectedCategories();
            this.loadReminders();
            dialog.destroy();
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());
    }

    private createCategorySelectContent(categories: any[]): string {
        let html = `
            <div class="category-select-dialog">
                <div class="b3-dialog__content">
                    <div class="category-option">
                        <label>
                            <input type="checkbox" id="categoryAll" ${this.selectedCategories.includes('all') || this.selectedCategories.length === 0 ? 'checked' : ''}>
                            ${i18n("allCategories")}
                        </label>
                    </div>
                    <div class="category-option">
                        <label>
                            <input type="checkbox" class="category-checkbox" value="none" ${this.selectedCategories.includes('none') ? 'checked' : ''}>
                            ${i18n("noCategory")}
                        </label>
                    </div>
        `;

        categories.forEach(cat => {
            html += `
                <div class="category-option">
                    <label>
                        <input type="checkbox" class="category-checkbox" value="${cat.id}" ${this.selectedCategories.includes(cat.id) ? 'checked' : ''}>
                        ${cat.icon || ''} ${cat.name}
                    </label>
                </div>
            `;
        });

        html += `
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="categorySelectCancel">${i18n("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="categorySelectConfirm">${i18n("confirm")}</button>
                </div>
            </div>
        `;

        return html;
    }

    // ===================== 侧栏多选模式 =====================

    private togglePanelReminderSelection(reminderId: string, el: HTMLElement): void {
        if (this.selectedReminderIds.has(reminderId)) {
            this.selectedReminderIds.delete(reminderId);
            el.classList.remove('reminder-item--selected');
        } else {
            this.selectedReminderIds.add(reminderId);
            el.classList.add('reminder-item--selected');
        }
    }

    private exitPanelMultiSelectMode(): void {
        this.isMultiSelectMode = false;
        this.selectedReminderIds.clear();
        this.lastClickedReminderId = null;
        // 清除所有选中样式
        this.container.querySelectorAll('.reminder-item--selected').forEach(el => {
            el.classList.remove('reminder-item--selected');
        });
        showMessage(i18n('batchSelectModeOff') || '已退出多选模式');
    }

    /**
     * Shift+Click 范围选择：从 lastId 到 currentId 之间的所有可见任务全部选中
     */
    private selectRangeInPanel(lastId: string, currentId: string): void {
        // 从 DOM 按渲染顺序获取所有任务元素
        const allEls = Array.from(
            this.container.querySelectorAll<HTMLElement>('.reminder-item[data-reminder-id]')
        );
        const ids = allEls.map(el => el.dataset.reminderId!);
        const lastIdx = ids.indexOf(lastId);
        const curIdx = ids.indexOf(currentId);
        if (lastIdx === -1 || curIdx === -1) return;
        const start = Math.min(lastIdx, curIdx);
        const end = Math.max(lastIdx, curIdx);
        for (let i = start; i <= end; i++) {
            const id = ids[i];
            const el = allEls[i];
            if (id && el) {
                this.selectedReminderIds.add(id);
                el.classList.add('reminder-item--selected');
            }
        }
        this.lastClickedReminderId = currentId;
    }

    private showPanelBatchContextMenu(event: MouseEvent): void {
        const menu = new Menu('panelBatchContextMenu');
        const selectedCount = this.selectedReminderIds.size;

        // 提示行
        menu.addItem({
            iconHTML: '☑️',
            label: `${selectedCount} ${i18n('tasksSelected') || '个任务已选择'}`,
            click: () => { }
        });
        menu.addSeparator();

        // 设置已完成
        menu.addItem({
            iconHTML: '✅',
            label: i18n('setCompleted') || '设置已完成',
            click: () => this.panelBatchSetCompleted()
        });

        // 设置日期子菜单
        const todayStr = getLogicalDateString();
        const tomorrowStr = getRelativeDateString(1);
        const dayAfterStr = getRelativeDateString(2);
        const nextWeekStr = getRelativeDateString(7);
        menu.addItem({
            iconHTML: '🗓',
            label: i18n('setDate') || '设置日期',
            submenu: [
                { iconHTML: '📅', label: i18n('moveToToday') || '移至今天', click: () => this.panelBatchSetDate(todayStr) },
                { iconHTML: '📅', label: i18n('moveToTomorrow') || '移至明天', click: () => this.panelBatchSetDate(tomorrowStr) },
                { iconHTML: '📅', label: i18n('moveToDayAfterTomorrow') || '移至后天', click: () => this.panelBatchSetDate(dayAfterStr) },
                { iconHTML: '📅', label: i18n('moveToNextWeek') || '移至下周', click: () => this.panelBatchSetDate(nextWeekStr) },
                { iconHTML: '❌', label: i18n('clearDate') || '清除日期', click: () => this.panelBatchSetDate(null) },
                { iconHTML: '🗓', label: i18n('batchSetDate') || '批量设置日期…', click: () => this.panelBatchSetDateDialog() }
            ]
        });

        // 设置优先级子菜单
        const priorities = [
            { key: 'high', label: i18n('priorityHigh') || '高', icon: '🔴' },
            { key: 'medium', label: i18n('priorityMedium') || '中', icon: '🟡' },
            { key: 'low', label: i18n('priorityLow') || '低', icon: '🔵' },
            { key: 'none', label: i18n('none') || '无', icon: '⚫' }
        ];
        menu.addItem({
            iconHTML: '🎯',
            label: i18n('setPriority') || '设置优先级',
            submenu: priorities.map(p => ({
                iconHTML: p.icon,
                label: p.label,
                click: () => this.panelBatchSetPriority(p.key)
            }))
        });

        // 设置分类子菜单
        const categories = this.categoryManager.getCategories();
        if (categories.length > 0) {
            const catItems: any[] = [{
                iconHTML: '❌',
                label: i18n('noCategory') || '无分类',
                click: () => this.panelBatchSetCategory(null)
            }];
            categories.forEach((cat: any) => {
                catItems.push({
                    iconHTML: cat.icon || '📁',
                    label: cat.name,
                    click: () => this.panelBatchSetCategory(cat.id)
                });
            });
            menu.addItem({
                iconHTML: '📁',
                label: i18n('setCategory') || '设置分类',
                submenu: catItems
            });
        }

        menu.addSeparator();


        // 退出多选
        menu.addItem({
            iconHTML: '❌',
            label: i18n('exitBatchSelect') || '退出多选',
            click: () => this.exitPanelMultiSelectMode()
        });

        menu.addSeparator();

        // 删除
        menu.addItem({
            iconHTML: '🗑️',
            label: i18n('delete') || '删除',
            click: () => this.panelBatchDelete()
        });

        menu.open({ x: event.clientX, y: event.clientY });
    }

    private async panelBatchSetCompleted(): Promise<void> {
        const ids = Array.from(this.selectedReminderIds);
        if (ids.length === 0) return;
        try {
            for (const id of ids) {
                await this.toggleReminder(id, true);
            }
            showMessage(i18n('operationSuccessful') || '操作成功');
            this.exitPanelMultiSelectMode();
            this.loadReminders();
        } catch (e) {
            showMessage(i18n('operationFailed') || '操作失败');
        }
    }

    private async panelBatchSetDate(newDate: string | null): Promise<void> {
        const ids = Array.from(this.selectedReminderIds);
        if (ids.length === 0) return;
        try {
            for (const id of ids) {
                await this.setReminderBaseDate(id, newDate);
            }
            showMessage(i18n('operationSuccessful') || '操作成功');
            this.exitPanelMultiSelectMode();
            this.loadReminders();
        } catch (e) {
            showMessage(i18n('operationFailed') || '操作失败');
        }
    }

    private async panelBatchSetDateDialog(): Promise<void> {
        const ids = Array.from(this.selectedReminderIds);
        if (ids.length === 0) return;

        const langTag = (window as any).siyuan?.config?.lang?.replace('_', '-') || 'en-US';
        const _now = new Date();
        const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;

        const dialog = new Dialog({
            title: i18n('batchSetDate') || '批量设置日期',
            content: `
                <div class="b3-dialog__content" style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
                    <!-- 开始日期/时间行 -->
                    <div class="b3-form__group" style="margin-bottom: 0;">
                        <label class="b3-form__label">${i18n('startLabel') || '开始：'}</label>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 140px; min-width: 120px;">
                                    <input type="date" id="panelBatchStartDate" class="b3-text-field" max="9999-12-31" style="flex: 1; min-width: 0;" lang="${langTag}">
                                    <button type="button" id="panelClearStartDateBtn" class="b3-button b3-button--outline" title="${i18n('clearDate') || '清除日期'}" style="padding: 4px 8px; font-size: 12px; flex: 0 0 auto;">
                                        <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                    </button>
                                </div>
                                <div style="display: flex; align-items: center; gap: 8px; flex: 0 0 auto; white-space: nowrap; min-width: 110px; margin-left: auto;">
                                    <input type="time" id="panelBatchStartTime" class="b3-text-field" style="flex: 0 0 auto; min-width: 100px;" lang="${langTag}">
                                    <button type="button" id="panelClearStartTimeBtn" class="b3-button b3-button--outline" title="${i18n('clearTime') || '清除时间'}" style="padding: 4px 8px; font-size: 12px;">
                                        <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <!-- 结束日期/时间行 -->
                    <div class="b3-form__group" style="margin-bottom: 0;">
                        <label class="b3-form__label">${i18n('endLabel') || '结束：'}</label>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 140px; min-width: 120px;">
                                <input type="date" id="panelBatchEndDate" class="b3-text-field" placeholder="${i18n('endDateOptional') || '结束日期（可选）'}" max="9999-12-31" style="flex: 1; min-width: 0;" lang="${langTag}">
                                <button type="button" id="panelClearEndDateBtn" class="b3-button b3-button--outline" title="${i18n('clearDate') || '清除日期'}" style="padding: 4px 8px; font-size: 12px; flex: 0 0 auto;">
                                    <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                </button>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px; flex: 0 0 auto; white-space: nowrap; min-width: 110px; margin-left: auto;">
                                <input type="time" id="panelBatchEndTime" class="b3-text-field" placeholder="${i18n('endTimeOptional') || '结束时间 (可选)'}" style="flex: 0 0 auto; min-width: 100px;" lang="${langTag}">
                                <button type="button" id="panelClearEndTimeBtn" class="b3-button b3-button--outline" title="${i18n('clearTime') || '清除时间'}" style="padding: 4px 8px; font-size: 12px;">
                                    <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <!-- 清空所有日期选项 -->
                    <div class="b3-form__group" style="margin-bottom: 0;">
                        <label class="b3-checkbox" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                            <input type="checkbox" class="b3-switch" id="panelClearAllDatesCheck">
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label" style="font-size: 13px;">${i18n('clearDate') || '清空日期'}</span>
                            <span style="font-size: 12px; color: var(--b3-theme-on-surface-light);">${i18n('clearDateHint') || '勾选后将清空所选任务的日期'}</span>
                        </label>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="panelBatchDateCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="panelBatchDateConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '460px'
        });

        const startDateInput = dialog.element.querySelector('#panelBatchStartDate') as HTMLInputElement;
        const startTimeInput = dialog.element.querySelector('#panelBatchStartTime') as HTMLInputElement;
        const endDateInput = dialog.element.querySelector('#panelBatchEndDate') as HTMLInputElement;
        const endTimeInput = dialog.element.querySelector('#panelBatchEndTime') as HTMLInputElement;
        const clearAllCheck = dialog.element.querySelector('#panelClearAllDatesCheck') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#panelBatchDateCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#panelBatchDateConfirm') as HTMLButtonElement;

        startDateInput.value = today;

        dialog.element.querySelector('#panelClearStartDateBtn')?.addEventListener('click', () => { startDateInput.value = ''; });
        dialog.element.querySelector('#panelClearStartTimeBtn')?.addEventListener('click', () => { startTimeInput.value = ''; });
        dialog.element.querySelector('#panelClearEndDateBtn')?.addEventListener('click', () => { endDateInput.value = ''; });
        dialog.element.querySelector('#panelClearEndTimeBtn')?.addEventListener('click', () => { endTimeInput.value = ''; });

        endDateInput.addEventListener('change', () => {
            if (startDateInput.value && endDateInput.value && endDateInput.value < startDateInput.value) {
                showMessage(i18n('endDateAdjusted') || '结束日期已自动调整为开始日期');
                endDateInput.value = startDateInput.value;
            }
        });

        clearAllCheck.addEventListener('change', () => {
            const disabled = clearAllCheck.checked;
            [startDateInput, startTimeInput, endDateInput, endTimeInput].forEach(el => {
                el.disabled = disabled;
                el.style.opacity = disabled ? '0.4' : '1';
            });
            ['#panelClearStartDateBtn', '#panelClearStartTimeBtn', '#panelClearEndDateBtn', '#panelClearEndTimeBtn'].forEach(sel => {
                const btn = dialog.element.querySelector(sel) as HTMLButtonElement;
                if (btn) { btn.disabled = disabled; btn.style.opacity = disabled ? '0.4' : '1'; }
            });
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const clearAll = clearAllCheck.checked;
            const startDate = startDateInput.value;
            const startTime = startTimeInput.value;
            const endDate = endDateInput.value;
            const endTime = endTimeInput.value;

            if (!clearAll && startDate && endDate && endDate < startDate) {
                showMessage(i18n('endDateCannotBeEarlier') || '结束日期不能早于开始日期');
                return;
            }

            dialog.destroy();

            try {
                const reminderData = await getAllReminders(this.plugin, undefined, false, 'sidebar');
                for (const id of ids) {
                    const reminder = reminderData[id];
                    if (!reminder) continue;
                    if (clearAll) {
                        delete reminder.date;
                        delete reminder.time;
                        delete reminder.endDate;
                        delete reminder.endTime;
                    } else {
                        if (startDate) reminder.date = startDate;
                        if (startTime) reminder.time = startTime; else delete reminder.time;
                        if (endDate) reminder.endDate = endDate; else delete reminder.endDate;
                        if (endTime) reminder.endTime = endTime; else delete reminder.endTime;
                    }
                    if (reminder.blockId) {
                        try { await updateBindBlockAtrrs(reminder.blockId, this.plugin); } catch (e) { /* ignore */ }
                    }
                }
                await saveReminders(this.plugin, reminderData);
                showMessage(i18n('batchUpdateSuccess', { count: String(ids.length) }) || `成功更新 ${ids.length} 个任务`);
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.panelId } }));
                this.exitPanelMultiSelectMode();
                this.loadReminders();
            } catch (e) {
                console.error('批量设置日期失败:', e);
                showMessage(i18n('operationFailed') || '操作失败');
            }
        });
    }

    private async panelBatchSetPriority(priority: string): Promise<void> {
        const ids = Array.from(this.selectedReminderIds);
        if (ids.length === 0) return;
        try {
            for (const id of ids) {
                await this.setPriority(id, priority);
            }
            showMessage(i18n('operationSuccessful') || '操作成功');
            this.exitPanelMultiSelectMode();
            this.loadReminders();
        } catch (e) {
            showMessage(i18n('operationFailed') || '操作失败');
        }
    }

    private async panelBatchSetCategory(categoryId: string | null): Promise<void> {
        const ids = Array.from(this.selectedReminderIds);
        if (ids.length === 0) return;
        try {
            for (const id of ids) {
                await this.setCategory(id, categoryId);
            }
            showMessage(i18n('operationSuccessful') || '操作成功');
            this.exitPanelMultiSelectMode();
            this.loadReminders();
        } catch (e) {
            showMessage(i18n('operationFailed') || '操作失败');
        }
    }

    private panelSelectAll(): void {
        this.currentRemindersCache.forEach(r => {
            if (!r.isSubscribed) {
                this.selectedReminderIds.add(r.id);
                const el = this.container.querySelector(`[data-reminder-id="${r.id}"]`) as HTMLElement;
                if (el) el.classList.add('reminder-item--selected');
            }
        });
    }

    private panelBatchDelete(): void {
        const ids = Array.from(this.selectedReminderIds);
        if (ids.length === 0) return;
        confirm(
            i18n('confirmBatchDelete') || '确认批量删除',
            i18n('confirmBatchDeleteMessage', { count: String(ids.length) }) || `确定要删除选中的 ${ids.length} 个任务吗？此操作不可恢复。`,
            async () => {
                try {
                    for (const id of ids) {
                        await this.performDeleteReminder(id);
                    }
                    showMessage(i18n('batchDeleteSuccess', { count: String(ids.length) }) || `成功删除 ${ids.length} 个任务`);
                    this.exitPanelMultiSelectMode();
                    this.loadReminders();
                } catch (e) {
                    showMessage(i18n('batchDeleteFailed') || '批量删除失败');
                }
            }
        );
    }

    // ===================== 侧栏多选模式结束 =====================

    /**
     * 显示任务的番茄钟会话记录
     */
    private async showPomodoroSessions(reminder: any) {
        // 动态导入 PomodoroSessionsDialog
        const { PomodoroSessionsDialog } = await import("./PomodoroSessionsDialog");

        // 获取提醒ID（处理重复实例的情况）
        const reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

        const dialog = new PomodoroSessionsDialog(reminderId, this.plugin, () => {
            // 番茄钟更新后的回调，可选择性刷新界面
            // this.loadReminders();
        });

        dialog.show();
    }
}
