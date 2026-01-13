import { showMessage, confirm, Dialog, Menu, openTab } from "siyuan";
import { refreshSql, sql, updateBlock, getBlockKramdown, getBlockByID, updateBlockReminderBookmark, openBlock, createDocWithMd, renderSprig, readProjectData } from "../api";
import { getLocalDateString, compareDateStrings, getLocalDateTime, getLocalDateTimeString, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { loadSortConfig, saveSortConfig, getSortMethodName } from "../utils/sortConfig";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { t } from "../utils/i18n";
import { SETTINGS_FILE } from "../index";
import { generateRepeatInstances, getRepeatDescription, getDaysDifference, addDaysToDate } from "../utils/repeatUtils";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroStatsView, getLastStatsMode } from "./PomodoroStatsView";
import { TaskStatsView } from "./TaskStatsView";
import { EisenhowerMatrixView } from "./EisenhowerMatrixView";
import { PomodoroManager } from "../utils/pomodoroManager";
import { getSolarDateLunarString, getNextLunarMonthlyDate, getNextLunarYearlyDate } from "../utils/lunarUtils";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import { isEventPast } from "../utils/icsImport";

// 添加四象限面板常量
const EISENHOWER_TAB_TYPE = "reminder_eisenhower_tab";

export class ReminderPanel {
    private container: HTMLElement;
    private remindersContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private categoryFilterSelect: HTMLSelectElement; // 添加分类过滤选择器
    private categoryFilterButton: HTMLButtonElement;
    private sortButton: HTMLButtonElement;
    private searchInput: HTMLInputElement;
    private plugin: any;
    private currentTab: string = 'today';
    private currentCategoryFilter: string = 'all'; // 添加当前分类过滤
    private selectedCategories: string[] = [];
    private currentSearchQuery: string = '';
    private currentSort: string = 'time';
    private currentSortOrder: 'asc' | 'desc' = 'asc';
    private reminderUpdatedHandler: () => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private closeCallback?: () => void;
    private categoryManager: CategoryManager; // 添加分类管理器
    private isDragging: boolean = false;
    private draggedElement: HTMLElement | null = null;
    private draggedReminder: any = null;
    private collapsedTasks: Set<string> = new Set(); // 管理任务的折叠状态
    // 记录用户手动展开的任务（优先于默认折叠）
    private userExpandedTasks: Set<string> = new Set();

    // 是否在“今日任务”视图下显示已完成的子任务（由 header 中的开关控制）
    private showCompletedSubtasks: boolean = false;
    private showCompletedCheckbox: HTMLInputElement | null = null;
    private showCompletedContainer: HTMLElement | null = null;

    // 使用全局番茄钟管理器
    private pomodoroManager: PomodoroManager = PomodoroManager.getInstance();
    private currentRemindersCache: any[] = [];
    private allRemindersMap: Map<string, any> = new Map(); // 存储所有任务的完整信息，用于计算进度
    private isLoading: boolean = false;
    private loadTimeoutId: number | null = null;

    // 分页相关状态
    private currentPage: number = 1;
    private itemsPerPage: number = 30;
    private isPaginationEnabled: boolean = true; // 是否启用分页
    private totalPages: number = 1;
    private totalItems: number = 0;
    private lastTruncatedTotal: number = 0;

    constructor(container: HTMLElement, plugin?: any, closeCallback?: () => void) {
        this.container = container;
        this.plugin = plugin;
        this.closeCallback = closeCallback;
        this.categoryManager = CategoryManager.getInstance(this.plugin); // 初始化分类管理器

        // 创建事件处理器
        this.reminderUpdatedHandler = (event?: CustomEvent) => {
            // 如果事件标记为跳过面板刷新（局部更新），则不刷新
            if (event && event.detail?.skipPanelRefresh) {
                return;
            }

            // 防抖处理，避免短时间内的多次更新
            if (this.loadTimeoutId) {
                clearTimeout(this.loadTimeoutId);
            }
            this.loadTimeoutId = window.setTimeout(() => {
                if (!this.isLoading) {
                    this.loadReminders();
                }
                this.loadTimeoutId = null;
            }, 100);
        };

        this.sortConfigUpdatedHandler = (event: CustomEvent) => {
            const { method, order } = event.detail;
            if (method !== this.currentSort || order !== this.currentSortOrder) {
                this.currentSort = method;
                this.currentSortOrder = order;
                this.updateSortButtonTitle();
                this.loadReminders();
            }
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        // 加载折叠状态
        await this.loadCollapseStates();

        // 加载持久化设置（例如 showCompletedSubtasks）
        try {
            const settings = (await this.plugin.loadData(SETTINGS_FILE)) || {};
            if (settings.showCompletedSubtasks !== undefined) {
                this.showCompletedSubtasks = !!settings.showCompletedSubtasks;
            }
        } catch (e) {
            // ignore
        }

        this.initUI();
        await this.loadSortConfig();
        this.loadReminders();

        // 确保对话框样式已加载
        this.addReminderDialogStyles();

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

        // 保存折叠状态
        this.saveCollapseStates();

        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
        if (this.sortConfigUpdatedHandler) {
            window.removeEventListener('sortConfigUpdated', this.sortConfigUpdatedHandler);
        }

        // 清理当前番茄钟实例
        this.pomodoroManager.cleanupInactiveTimer();
    }

    // 加载排序配置
    private async loadSortConfig() {
        try {
            const config = await loadSortConfig(this.plugin);
            this.currentSort = config.method;
            this.currentSortOrder = config.order;
            this.updateSortButtonTitle();
        } catch (error) {
            console.error('加载排序配置失败:', error);
            this.currentSort = 'time';
            this.currentSortOrder = 'asc';
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
        titleSpan.textContent = "任务管理";

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
        newTaskBtn.title = t("newTask") || "新建任务";
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
        this.sortButton.title = t("sortBy");
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
            calendarBtn.title = t("calendarView");
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);

            // 添加四象限面板按钮
            const eisenhowerBtn = document.createElement('button');
            eisenhowerBtn.className = 'b3-button b3-button--outline';
            eisenhowerBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconGrid"></use></svg>';
            eisenhowerBtn.title = t("eisenhowerMatrix") || "四象限面板";
            eisenhowerBtn.addEventListener('click', () => {
                this.openEisenhowerMatrix();
            });
            actionContainer.appendChild(eisenhowerBtn);

            // 添加番茄钟统计按钮
            const pomodoroStatsBtn = document.createElement('button');
            pomodoroStatsBtn.className = 'b3-button b3-button--outline';
            pomodoroStatsBtn.innerHTML = '📊';
            pomodoroStatsBtn.title = t("pomodoroStats");
            pomodoroStatsBtn.addEventListener('click', () => {
                this.showPomodoroStatsView();
            });
            actionContainer.appendChild(pomodoroStatsBtn);



            // 添加刷新按钮
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'b3-button b3-button--outline';
            refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
            refreshBtn.title = t("refresh") || "刷新";
            refreshBtn.addEventListener('click', () => {
                this.loadReminders();
            });
            actionContainer.appendChild(refreshBtn);
        }

        // 添加更多按钮（放在最右边）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.title = t("more") || "更多";
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
            <option value="today" selected>${t("todayReminders")}</option>
            <option value="tomorrow">${t("tomorrowReminders")}</option>
            <option value="future7">${t("future7Reminders")}</option>
            <option value="futureAll">${t("futureReminders")}</option>
            <option value="overdue">${t("overdueReminders")}</option>
            <option value="all">${t("past7Reminders")}</option>
            <option value="allUncompleted">${t("allUncompletedReminders")}</option>
            <option value="noDate">${t("noDateReminders")}</option>
            <option value="todayCompleted">${t("todayCompletedReminders")}</option>
            <option value="yesterdayCompleted">${t("yesterdayCompletedReminders")}</option>
            <option value="completed">${t("completedReminders")}</option>
        `;
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
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
            // 根据当前筛选显示或隐藏“显示已完成子任务”开关
            if (this.showCompletedContainer) {
                this.showCompletedContainer.style.display = this.currentTab === 'today' ? '' : 'none';
            }
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
                    const settings = (await this.plugin.loadData(SETTINGS_FILE)) || {};
                    settings.showCompletedSubtasks = this.showCompletedSubtasks;
                    await this.plugin.saveData(SETTINGS_FILE, settings);
                } catch (e) {
                    // ignore
                }
            })();
        });

        const showCompletedText = document.createElement('span');
        // 直接使用中文标签，不使用 i18n
        showCompletedText.textContent = '显示已完成子任务';
        showCompletedText.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        `;

        showCompletedContainer.appendChild(this.showCompletedCheckbox);
        showCompletedContainer.appendChild(showCompletedText);
        // 默认仅在当前筛选为 today 时显示，且单独一行
        showCompletedContainer.style.display = (this.filterSelect && this.filterSelect.value === 'today') ? '' : 'none';
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
        this.searchInput.placeholder = t("searchTasks") || "搜索任务...";
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
    }
    // 修改排序方法以支持手动排序
    private sortReminders(reminders: any[]) {
        const sortType = this.currentSort;
        const sortOrder = this.currentSortOrder;
        // console.log('应用排序方式:', sortType, sortOrder, '提醒数量:', reminders.length);

        // 特殊处理已完成相关的筛选器
        const isCompletedFilter = this.currentTab === 'completed' || this.currentTab === 'todayCompleted';
        const isPast7Filter = this.currentTab === 'all';

        // 如果当前视图是“今日已完成”或“全部已完成”，始终按完成时间降序显示
        // 不受用户选择的排序方式（如按优先级）影响，也不受升降序切换影响
        if (isCompletedFilter) {
            reminders.sort((a: any, b: any) => {
                // 直接使用 compareByCompletedTime 的结果作为最终排序依据
                // 这确保了无日期但有完成时间的任务不会回退到日期排序
                let result = this.compareByCompletedTime(a, b);



                // compareByCompletedTime 已返回降序的基础结果，直接返回（不再受 sortOrder 影响）
                return result;
            });

            return;
        }

        reminders.sort((a: any, b: any) => {
            let result = 0;

            // 对于"过去七天"筛选器，未完成事项优先显示
            if (isPast7Filter) {
                const aCompleted = a.completed || false;
                const bCompleted = b.completed || false;

                if (aCompleted !== bCompleted) {
                    return aCompleted ? 1 : -1; // 未完成的排在前面
                }
            }

            // 特殊处理：按时间排序时，无日期任务始终排在最后（不受升降序影响）
            if (sortType === 'time') {
                const hasDateA = !!a.date;
                const hasDateB = !!b.date;
                
                if (!hasDateA && !hasDateB) {
                    // 两个都没有日期，按优先级排序
                    return this.compareByPriorityValue(a, b);
                }
                if (!hasDateA) return 1;  // a 无日期，排在后面
                if (!hasDateB) return -1; // b 无日期，排在后面
            }

            // 应用用户选择的排序方式
            switch (sortType) {
                case 'time':
                    // 对于已完成相关的筛选器，如果都是已完成状态，优先按完成时间排序
                    if ((isCompletedFilter || (isPast7Filter && a.completed && b.completed)) &&
                        a.completed && b.completed) {
                        result = this.compareByCompletedTime(a, b);
                        // 如果完成时间相同，再按设置时间排序
                        if (result === 0) {
                            result = this.compareByTime(a, b);
                        }
                    } else {
                        result = this.compareByTime(a, b);
                    }
                    break;

                case 'priority':
                    result = this.compareByPriorityWithManualSort(a, b);
                    break;

                case 'title':
                    result = this.compareByTitle(a, b);
                    break;

                default:
                    console.warn('未知的排序类型:', sortType, '默认使用时间排序');
                    result = this.compareByTime(a, b);
            }

            // 在已完成视图中，优先展示子任务（子任务靠前），以满足父未完成时只展示子任务的需求
            if (isCompletedFilter) {
                const aIsChild = !!a.parentId;
                const bIsChild = !!b.parentId;
                if (aIsChild && !bIsChild) return -1; // 子任务在前
                if (!aIsChild && bIsChild) return 1;
            }

            // 优先级升降序的结果相反
            if (sortType === 'priority') {
                result = -result;
            }

            // 应用升降序
            return sortOrder === 'desc' ? -result : result;
        });

        // console.log('排序完成，排序方式:', sortType, sortOrder);
    }
    // 新增：优先级排序与手动排序结合
    private compareByPriorityWithManualSort(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 首先按优先级排序
        const priorityDiff = priorityB - priorityA;
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 同优先级内按手动排序
        const sortA = a.sort || 0;
        const sortB = b.sort || 0;

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 如果手动排序值也相同，按时间排序
        return this.compareByTime(a, b);
    }

    private updateCategoryFilterButtonText() {
        if (!this.categoryFilterButton) return;

        if (this.selectedCategories.length === 0 || this.selectedCategories.includes('all')) {
            this.categoryFilterButton.textContent = t("categoryFilter") || "分类筛选";
        } else {
            // 显示选中的分类名称
            const names = this.selectedCategories.map(id => {
                if (id === 'none') return t("noCategory") || "无分类";
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



    // 更新排序按钮的提示文本
    private updateSortButtonTitle() {
        if (this.sortButton) {
            this.sortButton.title = `${t("sortBy")}: ${getSortMethodName(this.currentSort, this.currentSortOrder)}`;
        }
    }




    /**
     * 异步添加文档标题显示
     * @param container 标题容器元素
     * @param docId 文档ID
     */
    private async addDocumentTitle(container: HTMLElement, docId: string) {
        try {
            const docBlock = await getBlockByID(docId);
            if (docBlock && docBlock.content) {
                // 创建文档标题元素
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

                // 添加文档图标
                const docIcon = document.createElement('span');
                docIcon.innerHTML = '📄';
                docIcon.style.fontSize = '10px';

                // 创建支持悬浮预览的文档标题链接
                const docTitleLink = document.createElement('span');
                docTitleLink.setAttribute('data-type', 'a');
                docTitleLink.setAttribute('data-href', `siyuan://blocks/${docId}`);
                docTitleLink.textContent = docBlock.content;
                docTitleLink.title = `所属文档: ${docBlock.content}`;
                docTitleLink.style.cssText = `
                    cursor: pointer;
                    color: var(--b3-theme-on-background);
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;

                // 点击事件：打开文档
                docTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(docId);
                });

                // 鼠标悬停效果
                docTitleLink.addEventListener('mouseenter', () => {
                    docTitleLink.style.color = 'var(--b3-theme-primary)';
                });
                docTitleLink.addEventListener('mouseleave', () => {
                    docTitleLink.style.color = 'var(--b3-theme-on-background)';
                });

                docTitleEl.appendChild(docIcon);
                docTitleEl.appendChild(docTitleLink);

                // 将文档标题插入到容器的最前面
                container.insertBefore(docTitleEl, container.firstChild);

                // 异步加载完成后，恢复滚动位置以防止位置跳动
                // 保存当前滚动位置，避免异步加载导致的滚动跳动
                const currentScrollTop = this.remindersContainer.scrollTop;
                const currentScrollLeft = this.remindersContainer.scrollLeft;
                // 使用 setTimeout 确保 DOM 更新后再恢复滚动位置
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
            const projectData = await readProjectData();
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



    private applyCategoryFilter(reminders: any[]): any[] {
        if (this.selectedCategories.length === 0 || this.selectedCategories.includes('all')) {
            return reminders;
        }

        return reminders.filter(reminder => {
            const categoryId = reminder.categoryId || 'none';
            return this.selectedCategories.includes(categoryId);
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


    // 修复排序菜单方法
    private showSortMenu(event: MouseEvent) {
        try {
            const menu = new Menu("reminderSortMenu");

            const sortOptions = [
                { key: 'time', label: t("sortByTime"), icon: '🗓' },
                { key: 'priority', label: t("sortByPriority"), icon: '🎯' },
                { key: 'title', label: t("sortByTitle"), icon: '📝' }
            ];

            sortOptions.forEach(option => {
                // 为每个排序方式添加升序和降序选项
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t("ascending")}↓)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'asc',
                    click: async () => {
                        try {
                            this.currentSort = option.key;
                            this.currentSortOrder = 'asc';
                            this.updateSortButtonTitle();
                            await saveSortConfig(this.plugin, option.key, 'asc');
                            // 重置分页状态
                            this.currentPage = 1;
                            this.totalPages = 1;
                            this.totalItems = 0;
                            await this.loadReminders();
                            // console.log('排序已更新为:', option.key, 'asc');
                        } catch (error) {
                            console.error('保存排序配置失败:', error);
                            await this.loadReminders();
                        }
                    }
                });

                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${t("descending")}↑)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'desc',
                    click: async () => {
                        try {
                            this.currentSort = option.key;
                            this.currentSortOrder = 'desc';
                            this.updateSortButtonTitle();
                            await saveSortConfig(this.plugin, option.key, 'desc');
                            // 重置分页状态
                            this.currentPage = 1;
                            this.totalPages = 1;
                            this.totalItems = 0;
                            await this.loadReminders();
                            // console.log('排序已更新为:', option.key, 'desc');
                        } catch (error) {
                            console.error('保存排序配置失败:', error);
                            await this.loadReminders();
                        }
                    }
                });
            });

            // 使用按钮的位置信息来定位菜单
            if (this.sortButton) {
                const rect = this.sortButton.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

                // 确保菜单在可视区域内
                const maxX = window.innerWidth - 200;
                const maxY = window.innerHeight - 200;

                menu.open({
                    x: Math.min(menuX, maxX),
                    y: Math.min(menuY, maxY)
                });
            } else {
                menu.open({
                    x: event.clientX,
                    y: event.clientY
                });
            }
        } catch (error) {
            console.error('显示排序菜单失败:', error);
            const currentName = getSortMethodName(this.currentSort, this.currentSortOrder);
            // console.log(`当前排序方式: ${currentName}`);
        }
    }
    /**
     * 判断任务是否应该被折叠
     * 优先考虑用户手动展开，其次是collapsedTasks集合，
     * 如果都没有，则使用默认行为：父任务默认折叠（如果有子任务）
     */
    private isTaskCollapsed(taskId: string, hasChildren: boolean = false): boolean {
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
     * 当父任务完成时，自动完成所有子任务
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     */
    private async completeAllChildTasks(parentId: string, reminderData: any): Promise<void> {
        try {
            // 构建任务映射
            const reminderMap = new Map<string, any>();
            Object.values(reminderData).forEach((reminder: any) => {
                if (reminder && reminder.id) {
                    reminderMap.set(reminder.id, reminder);
                }
            });

            // 获取所有后代任务ID
            const descendantIds = this.getAllDescendantIds(parentId, reminderMap);

            if (descendantIds.length === 0) {
                return; // 没有子任务，直接返回
            }

            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            // 自动完成所有子任务
            for (const childId of descendantIds) {
                const childReminder = reminderData[childId];
                if (childReminder && !childReminder.completed) {
                    childReminder.completed = true;
                    childReminder.completedTime = currentTime;
                    completedCount++;

                    // 同步更新 allRemindersMap 中的数据
                    if (this.allRemindersMap.has(childId)) {
                        this.allRemindersMap.set(childId, { ...this.allRemindersMap.get(childId), completed: true, completedTime: currentTime });
                    }

                    // 如果子任务有绑定块，也需要处理任务列表完成
                    if (childReminder.blockId) {
                        try {
                            await updateBlockReminderBookmark(childReminder.blockId);
                            await this.handleTaskListCompletion(childReminder.blockId);
                        } catch (error) {
                            console.warn(`处理子任务 ${childId} 的块更新失败:`, error);
                        }
                    }
                }
            }

            if (completedCount > 0) {
                // console.log(`父任务 ${parentId} 完成时，自动完成了 ${completedCount} 个子任务`);
                showMessage(`已自动完成 ${completedCount} 个子任务`, 2000);
            }
        } catch (error) {
            console.error('自动完成子任务失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 局部更新单个提醒的 DOM 显示（如果该提醒当前正在显示）
     * @param reminderId 原始或实例的提醒 id
     * @param updatedReminder 可选，包含最新数据的提醒对象
     * @param instanceDate 可选，对于重复实例传入实例日期
     */


    private isReminderEffectivelyCompleted(reminder: any, instanceDate?: string, updatedReminder?: any): boolean {
        if (!reminder) return false;

        // 优先使用最新的 completed 标记
        if (updatedReminder && typeof updatedReminder.completed === 'boolean') {
            if (updatedReminder.completed) return true;
        }

        if (typeof reminder.completed === 'boolean' && reminder.completed) {
            return true;
        }

        // 处理重复实例的完成状态
        const repeatData = (updatedReminder && updatedReminder.repeat) || reminder.repeat;
        const dateKey = instanceDate || reminder.date;
        if (repeatData && dateKey) {
            if (Array.isArray(repeatData.completedInstances) && repeatData.completedInstances.includes(dateKey)) {
                return true;
            }
            if (repeatData.completedTimes && repeatData.completedTimes[dateKey]) {
                return true;
            }
        }

        // 处理跨天事件的“今日已完成”状态
        if (reminder.endDate && this.isSpanningEventTodayCompleted(reminder)) {
            return true;
        }
        if (updatedReminder && updatedReminder.endDate && this.isSpanningEventTodayCompleted(updatedReminder)) {
            return true;
        }

        return false;
    }

    private shouldRemoveReminderElement(reminder: any, isCompleted: boolean): boolean {
        if (!reminder) return false;

        if (this.currentTab === 'completed' || this.currentTab === 'todayCompleted') {
            // 在已完成视图中，只展示已完成的任务
            return !isCompleted;
        }

        // 在其他视图中，完成后直接隐藏
        return isCompleted;
    }

    private removeReminderElementFromDOM(reminder: any): number {
        if (!reminder) return 0;

        const idsToRemove = [reminder.id, ...this.getDescendantIdsFromCache(reminder.id)];
        let removed = 0;

        idsToRemove.forEach(id => {
            const node = this.remindersContainer.querySelector(`[data-reminder-id="${id}"]`) as HTMLElement | null;
            if (node) {
                node.remove();
                removed++;
            }
        });

        return removed;
    }

    private updateCountsAfterRemoval(removedCount: number) {
        if (!removedCount || removedCount <= 0) {
            return;
        }

        if (this.totalItems > 0) {
            this.totalItems = Math.max(0, this.totalItems - removedCount);

            if (this.totalItems === 0) {
                this.totalPages = 0;
                this.currentPage = 1;
            } else if (this.isPaginationEnabled) {
                this.totalPages = Math.max(1, Math.ceil(this.totalItems / this.itemsPerPage));
                if (this.currentPage > this.totalPages) {
                    this.currentPage = this.totalPages;
                }
            }
        }

        if (this.lastTruncatedTotal > 0) {
            this.lastTruncatedTotal = Math.max(0, this.lastTruncatedTotal - removedCount);
        }

        // 重新渲染分页控件以反映最新的统计信息
        this.renderPaginationControls(this.lastTruncatedTotal);
    }

    private ensureEmptyStateAfterRemoval() {
        const hasItems = this.remindersContainer.querySelector('.reminder-item');
        if (!hasItems) {
            if (this.totalItems === 0) {
                this.renderReminders([]);
                const pagination = this.container.querySelector('.reminder-pagination-controls');
                if (pagination) {
                    pagination.remove();
                }
            } else if (this.isPaginationEnabled && this.totalPages > 0) {
                const validPage = Math.min(this.currentPage, Math.max(1, this.totalPages));
                if (this.currentPage !== validPage) {
                    this.currentPage = validPage;
                }
                this.loadReminders(true);
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
            const reminderData = await getAllReminders(this.plugin);
            if (!reminderData || typeof reminderData !== 'object') {
                this.updateReminderCounts(0, 0, 0, 0, 0, 0);
                this.renderReminders([]);
                return;
            }

            const today = getLogicalDateString();
            const allRemindersWithInstances = this.generateAllRemindersWithInstances(reminderData, today);

            // 构造 map 便于查找父子关系
            const reminderMap = new Map<string, any>();
            allRemindersWithInstances.forEach(r => reminderMap.set(r.id, r));

            // 将所有任务保存到 allRemindersMap 中，用于后续计算进度
            this.allRemindersMap = new Map(reminderMap);

            // 1. 应用分类过滤
            const categoryFilteredReminders = this.applyCategoryFilter(allRemindersWithInstances);

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
                    // 在"今日任务"视图中，如果父任务未完成且开关关闭，不显示已完成的子任务
                    if (this.currentTab === 'today' && !parent.completed && !this.showCompletedSubtasks) {
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
                this.remindersContainer.innerHTML = `<div class="reminder-empty">${t("noReminders")}</div>`;
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
            showMessage(t("loadRemindersFailed"));
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
                const todayCount = await this.getReminderTodayPomodoroCount(reminder.id, reminder, fullData);
                const todayFocus = await this.getReminderTodayFocusTime(reminder.id, reminder, fullData);
                return { id: reminder.id, pomodoroCount: count, focusTime, todayPomodoroCount: todayCount, todayFocusTime: todayFocus };
            } catch (error) {
                console.warn(`获取任务 ${reminder.id} 的番茄钟计数失败:`, error);
                return { id: reminder.id, pomodoroCount: 0, focusTime: 0, todayPomodoroCount: 0, todayFocusTime: 0 };
            }
        });

        // 批量获取项目信息
        const projectPromises = reminders
            .filter(reminder => reminder.projectId)
            .map(async (reminder) => {
                try {
                    const projectData = await readProjectData();
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
            if (reminder.endDate) {
                isOverdue = compareDateStrings(reminder.endDate, today) < 0;
            } else {
                isOverdue = compareDateStrings(reminder.date, today) < 0;
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
                backgroundColor = 'var(--b3-card-error-background)';
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = 'var(--b3-card-warning-background)';
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = 'var(--b3-card-info-background)';
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = 'var(--b3-theme-surface-lighter)';
                borderColor = 'var(--b3-theme-surface-lighter)';
        }
        reminderEl.style.backgroundColor = backgroundColor;
        reminderEl.style.border = `2px solid ${borderColor}`;

        reminderEl.dataset.reminderId = reminder.id;
        reminderEl.dataset.priority = priority;

        // 所有任务均启用拖拽功能（支持排序）
        this.addDragFunctionality(reminderEl, reminder);

        reminderEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
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
                this.toggleReminder(reminder.originalId, checkbox.checked, true, reminder.date);
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
            collapseBtn.title = isCollapsed ? t("expand") : t("collapse");
            collapseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                // 使用统一方法判断当前状态
                const currentCollapsed = this.isTaskCollapsed(reminder.id, hasChildren);

                if (currentCollapsed) {
                    // 当前是折叠 -> 展开
                    // 移除折叠状态，添加到用户展开集合
                    this.collapsedTasks.delete(reminder.id);
                    this.userExpandedTasks.add(reminder.id);
                    // 递归显示子任务
                    await this.showChildrenRecursively(reminder.id);
                    // 更新按钮图标与标题
                    collapseBtn.innerHTML = '<svg><use xlink:href="#iconDown"></use></svg>';
                    collapseBtn.title = t("collapse");
                } else {
                    // 当前是展开 -> 折叠
                    // 移除用户展开状态，添加到折叠集合
                    this.userExpandedTasks.delete(reminder.id);
                    this.collapsedTasks.add(reminder.id);
                    // 隐藏后代
                    this.hideAllDescendants(reminder.id);
                    // 更新按钮图标与标题
                    collapseBtn.innerHTML = '<svg><use xlink:href="#iconRight"></use></svg>';
                    collapseBtn.title = t("expand");
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

        titleEl.textContent = reminder.title || t("unnamedNote");
        titleEl.title = reminder.blockId ? `点击打开绑定块: ${reminder.title || t("unnamedNote")}` : (reminder.title || t("unnamedNote"));
        titleContainer.appendChild(titleEl);

        // 添加URL链接图标
        if (reminder.url) {
            const urlIcon = document.createElement('a');
            urlIcon.className = 'reminder-item__url-icon';
            urlIcon.href = reminder.url;
            urlIcon.target = '_blank';
            urlIcon.title = t("openUrl") + ': ' + reminder.url;
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
            repeatIcon.title = reminder.repeat?.enabled ? getRepeatDescription(reminder.repeat) : t("repeatInstance");
            timeContainer.appendChild(repeatIcon);
        }

        // 只显示有日期的任务的时间信息
        if (reminder.date) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-item__time';
            const timeText = this.formatReminderTime(reminder.date, reminder.time, today, reminder.endDate, reminder.endTime, reminder);
            timeEl.textContent = '🗓' + timeText;
            timeEl.style.cursor = 'pointer';
            timeEl.title = t("clickToModifyTime");
            if (!reminder.isSubscribed) {
                timeEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (reminder.isRepeatInstance) {
                        this.editOriginalReminder(reminder.originalId);
                    } else {
                        this.showTimeEditDialog(reminder);
                    }
                });
            } else {
                timeEl.title = t("subscribedTaskReadOnly") || "订阅任务（只读）";
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
        if (cachedData && ((cachedData.pomodoroCount && cachedData.pomodoroCount > 0) || (cachedData.todayPomodoroCount && cachedData.todayPomodoroCount > 0) || (cachedData.focusTime && cachedData.focusTime > 0) || (cachedData.todayFocusTime && cachedData.todayFocusTime > 0))) {
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

            // 第一行：累计/总计
            const totalLine = (totalCount > 0 || totalFocus > 0) ? `<span title="累计完成的番茄钟: ${totalCount}">${formattedTotalTomato}${extraCount}</span><span title="总专注时长: ${totalFocus} 分钟" style="margin-left:8px; opacity:0.9;">${totalFocusText}</span>` : '';
            // 第二行：今日数据（单独一行）
            const todayLine = (todayCount > 0 || todayFocus > 0 || totalCount > 0) ? `<div style="margin-top:6px; font-size:12px; opacity:0.95;"><span title='今日完成的番茄钟: ${todayCount}'>今日: 🍅 ${todayCount}</span><span title='今日专注时长: ${todayFocus} 分钟' style='margin-left:8px'>${todayFocusText}</span></div>` : '';

            pomodoroDisplay.innerHTML = `${totalLine}${todayLine}`;

            // 将番茄计数添加到 timeContainer 后面
            infoEl.appendChild(pomodoroDisplay);
        }

        // 已完成任务显示透明度并显示完成时间
        if (reminder.completed) {
            // 添加已完成类
            reminderEl.classList.add('reminder-completed');
            // 设置整体透明度为 0.5（重要性以确保优先级）
            try {
                reminderEl.style.setProperty('opacity', '0.5', 'important');
            } catch (e) {
                // ignore style errors
            }

            // 获取完成时间（支持重复实例）并显示
            const completedTimeStr = this.getCompletedTime(reminder);
            if (completedTimeStr) {
                const completedEl = document.createElement('div');
                completedEl.className = 'reminder-item__completed-time';
                completedEl.textContent = `✅ ${this.formatCompletedTime(completedTimeStr)}`;
                completedEl.style.cssText = 'font-size:12px;  margin-top:6px; opacity:0.95;';
                infoEl.appendChild(completedEl);
            }
        }

        if (reminder.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-item__note';
            noteEl.textContent = reminder.note;
            infoEl.appendChild(noteEl);
        }

        // 添加项目信息显示（使用预处理的缓存数据）
        if (cachedData && cachedData.project) {
            // 兼容 title 和 name 字段（项目数据使用 title，但接口定义使用 name）
            const projectName = cachedData.project.title || cachedData.project.name;
            if (projectName) {
                const projectInfo = document.createElement('div');
                projectInfo.className = 'reminder-item__project';
                projectInfo.style.cssText = `
                    display: inline-flex;
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
                nameSpan.textContent = '📂' + projectName;
                nameSpan.style.cssText = `
                    text-decoration: underline;
                    text-decoration-style: dotted;
                `;
                projectInfo.appendChild(nameSpan);

                // 设置标题提示
                projectInfo.title = `点击打开项目: ${projectName}`;

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

        // 添加分类标签显示
        if (reminder.categoryId) {
            const category = this.categoryManager.getCategoryById(reminder.categoryId);
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
                const instanceModifications = reminder.repeat?.instanceModifications || {};

                // 将实例分类为：过去未完成、今天未完成、未来未完成、未来已完成、过去已完成
                let pastIncompleteList: any[] = [];
                let todayIncompleteList: any[] = [];
                let futureIncompleteList: any[] = [];
                let futureCompletedList: any[] = [];
                let pastCompletedList: any[] = [];

                repeatInstances.forEach(instance => {
                    // 对于所有重复事件，添加所有生成的实例（包括与原始日期相同的实例）
                    // 从 instanceId (格式: originalId_YYYY-MM-DD) 中提取原始生成日期
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
                            // 异步更新 completedInstances 数组并保存
                            if (!completedInstances.includes(originalInstanceDate)) {
                                completedInstances.push(originalInstanceDate);
                                // 标记需要保存（在循环结束后统一保存）
                                reminder._needsSave = true;
                            }
                        }
                    }

                    const instanceMod = instanceModifications[originalInstanceDate];

                    // 使用展开运算符复制原始提醒的所有属性（包括 projectId、categoryId、priority 等）
                    // 然后覆盖实例特定的属性（id、date、time 等）
                    const instanceTask = {
                        ...reminder,
                        id: instance.instanceId,
                        date: instance.date,
                        endDate: instance.endDate,
                        time: instance.time,
                        endTime: instance.endTime,
                        isRepeatInstance: true,
                        originalId: instance.originalId,
                        completed: isInstanceCompleted,
                        // 如果实例有修改，使用实例的值；否则使用原始值
                        note: instanceMod?.note !== undefined ? instanceMod.note : reminder.note,
                        priority: instanceMod?.priority !== undefined ? instanceMod.priority : reminder.priority,
                        categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : reminder.categoryId,
                        projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : reminder.projectId,
                        customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : reminder.customGroupId,
                        termType: instanceMod?.termType !== undefined ? instanceMod.termType : reminder.termType,
                        kanbanStatus: instanceMod?.kanbanStatus !== undefined ? instanceMod.kanbanStatus : reminder.kanbanStatus,
                        // 提醒时间相关字段
                        reminderTimes: instanceMod?.reminderTimes !== undefined ? instanceMod.reminderTimes : reminder.reminderTimes,
                        customReminderPreset: instanceMod?.customReminderPreset !== undefined ? instanceMod.customReminderPreset : reminder.customReminderPreset,
                        // 为已完成的实例添加完成时间（用于排序）
                        completedTime: isInstanceCompleted ? getLocalDateTimeString(new Date(instance.date)) : undefined
                    };

                    // 按日期和完成状态分类
                    const dateComparison = compareDateStrings(instance.date, today);

                    if (dateComparison < 0) {
                        // 过去的日期
                        if (isInstanceCompleted) {
                            pastCompletedList.push(instanceTask);
                        } else {
                            pastIncompleteList.push(instanceTask);
                        }
                    } else if (dateComparison === 0) {
                        // 今天的日期（只收集未完成的）
                        if (!isInstanceCompleted) {
                            todayIncompleteList.push(instanceTask);
                        } else {
                            pastCompletedList.push(instanceTask); // 今天已完成算作过去
                        }
                    } else {
                        // 未来的日期
                        if (isInstanceCompleted) {
                            futureCompletedList.push(instanceTask);
                        } else {
                            futureIncompleteList.push(instanceTask);
                        }
                    }
                });

                // 添加过去的未完成实例
                allReminders.push(...pastIncompleteList);

                // 添加今天的未完成实例
                allReminders.push(...todayIncompleteList);

                // 添加未来的第一个未完成实例（如果存在）
                // 这样即使有多个已完成的未来实例，也能显示下一个未完成的实例
                if (futureIncompleteList.length > 0) {
                    // 对于所有重复事件，如果今天没有未完成实例，就添加未来第一个未完成的
                    const hasTodayIncomplete = todayIncompleteList.length > 0;
                    if (!hasTodayIncomplete) {
                        allReminders.push(futureIncompleteList[0]);
                    }
                }

                // 添加所有已完成的实例（包括过去和未来的）
                allReminders.push(...pastCompletedList);
                allReminders.push(...futureCompletedList);

                // 如果订阅任务有过期实例被自动标记为已完成，保存更新
                if (reminder.isSubscribed && reminder._needsSave) {
                    delete reminder._needsSave; // 清理临时标记
                    // 异步保存，不阻塞UI渲染
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

    private filterRemindersByTab(reminders: any[], today: string): any[] {
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

            // 如果是跨天事件且今天在范围内，检查是否今天已完成
            if (reminder.endDate && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0) {
                return this.isSpanningEventTodayCompleted(reminder);
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

        switch (this.currentTab) {
            case 'overdue':
                return reminders.filter(r => !isEffectivelyCompleted(r) && r.date && compareDateStrings(r.endDate || r.date, today) < 0);
            case 'today':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    const endDate = r.endDate || r.date;
                    return (compareDateStrings(startDate, today) <= 0 && compareDateStrings(today, endDate) <= 0) || compareDateStrings(endDate, today) < 0;
                });
            case 'tomorrow':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    const endDate = r.endDate || r.date;
                    return compareDateStrings(startDate, tomorrow) <= 0 && compareDateStrings(tomorrow, endDate) <= 0;
                });
            case 'future7':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    const endDate = r.endDate || r.date;
                    return compareDateStrings(tomorrow, startDate) <= 0 && compareDateStrings(startDate, future7Days) <= 0;
                });
            case 'futureAll':
                return reminders.filter(r => {
                    if (isEffectivelyCompleted(r) || !r.date) return false;
                    const startDate = r.date;
                    // const endDate = r.endDate || r.date;
                    return compareDateStrings(tomorrow, startDate) <= 0;
                });
            case 'completed':
                return reminders.filter(r => isEffectivelyCompleted(r));
            case 'todayCompleted':
                return reminders.filter(r => {
                    // 已标记为完成的：如果其日期范围包含今日，或其原始日期是今日，或其完成时间（completedTime）在今日，则视为今日已完成
                    if (r.completed) {
                        try {
                            const completedTime = this.getCompletedTime(r);
                            if (completedTime) {
                                const completedDate = completedTime.split(' ')[0];
                                if (completedDate === today) return true;
                            }
                        } catch (e) {
                            // ignore and fallback to date checks
                        }

                        return (r.endDate && compareDateStrings(r.date, today) <= 0 && compareDateStrings(today, r.endDate) <= 0) || r.date === today;
                    }

                    // 未直接标记为完成的（可能为跨天事件的今日已完成标记）
                    return r.endDate && this.isSpanningEventTodayCompleted(r) && compareDateStrings(r.date, today) <= 0 && compareDateStrings(today, r.endDate) <= 0;
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
                    return r.endDate && this.isSpanningEventYesterdayCompleted(r) && compareDateStrings(r.date, yesterdayStr) <= 0 && compareDateStrings(yesterdayStr, r.endDate) <= 0;
                });
            case 'all': // Past 7 days
                return reminders.filter(r => r.date && compareDateStrings(sevenDaysAgo, r.date) <= 0 && compareDateStrings(r.endDate || r.date, today) < 0);
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
                    return !topLevelParent.date;
                });
            default:
                return [];
        }
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

            return (reminder.endDate && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0) || reminder.date === today;
        }

        // 未直接标记为完成的（可能为跨天事件的今日已完成标记）
        return reminder.endDate && this.isSpanningEventTodayCompleted(reminder) && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0;
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
                'today': t("noTodayReminders"),
                'tomorrow': t("noTomorrowReminders"),
                'future7': t("noFuture7Reminders"),
                'overdue': t("noOverdueReminders"),
                'completed': t("noCompletedReminders"),
                'todayCompleted': "今日暂无已完成任务",
                'yesterdayCompleted': "昨日暂无已完成任务",
                'all': t("noPast7Reminders"),
                'allUncompleted': t("noAllUncompletedReminders"),
                'noDate': t("noNoDateReminders")
            };
            this.remindersContainer.innerHTML = `<div class="reminder-empty">${filterNames[this.currentTab] || t("noReminders")}</div>`;
            return;
        }
    }
    private originalRemindersCache: { [id: string]: any } = {};
    // 缓存异步加载数据（番茄数、专注时长、项目等）以减少重复请求
    private asyncDataCache: Map<string, any> = new Map();
    private async editOriginalReminder(originalId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (originalReminder) {
                this.showTimeEditDialog(originalReminder);
            } else {
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            showMessage(t("openModifyDialogFailed"));
        }
    }
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
            const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00')).getTime();
            const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00')).getTime();
            return dateA - dateB; // 较早的日期排在前面
        }

        // 都没有日期，按创建时间或其他标识符排序
        // 使用任务ID作为最后排序依据（ID通常包含时间戳）
        return (a.id || '').localeCompare(b.id || '');
    }

    // 新增：获取完成时间的辅助方法
    private getCompletedTime(reminder: any): string | null {
        if (reminder.isRepeatInstance) {
            // 重复事件实例的完成时间
            const originalReminder = this.getOriginalReminder(reminder.originalId);
            if (originalReminder && originalReminder.repeat?.completedTimes) {
                return originalReminder.repeat.completedTimes[reminder.date] || null;
            }
        } else {
            // 普通事件的完成时间
            return reminder.completedTime || null;
        }
        return null;
    }
    // 按时间比较（考虑跨天事件和优先级）
    private compareByTime(a: any, b: any): number {
        // 注意：无日期任务的处理已在 sortReminders 中提前处理
        // 这里假设传入的 a 和 b 都有日期
        
        // 都有日期时，按日期时间排序
        // 对于重复任务实例，a.date 已经是实例的日期，而不是原始任务的日期
        const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));

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
        return priorityB - priorityA; // 高优先级在前
    }

    // 按标题比较
    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, 'zh-CN');
    }

    private async toggleReminder(reminderId: string, completed: boolean, isRepeatInstance?: boolean, instanceDate?: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);

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

                if (completed) {
                    if (!completedInstances.includes(instanceDate)) completedInstances.push(instanceDate);
                    completedTimes[instanceDate] = getLocalDateTimeString(new Date());

                    // 如果需要，自动完成子任务（局部更新内部会处理DOM）
                    await this.completeAllChildTasks(originalId, reminderData);
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

                // 更新块书签与任务列表状态
                const blockId = original.blockId;
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                    if (completed) await this.handleTaskListCompletion(blockId);
                    else await this.handleTaskListCompletionCancel(blockId);
                }

                // 局部更新：更新实例与父任务进度
                // 传入更新后的数据以便正确判断完成状态

                // 更新徽章
                if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                    this.plugin.updateBadges();
                }

                // 触发UI刷新
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                return;
            }

            // 非重复事件
            const reminder = reminderData[reminderId];
            if (!reminder) return;

            reminder.completed = completed;
            if (completed) {
                reminder.completedTime = getLocalDateTimeString(new Date());
                // 自动完成子任务（局部更新内部会处理DOM）
                await this.completeAllChildTasks(reminderId, reminderData);
            } else {
                delete reminder.completedTime;
            }

            await saveReminders(this.plugin, reminderData);

            // (no block attribute updates here)


            // 更新 allRemindersMap 中的数据，以便 updateParentProgress 能获取最新的完成状态
            if (this.allRemindersMap.has(reminderId)) {
                this.allRemindersMap.set(reminderId, { ...this.allRemindersMap.get(reminderId), completed, completedTime: reminder.completedTime });
            }

            // 更新块书签与任务列表状态
            if (reminder.blockId) {
                await updateBlockReminderBookmark(reminder.blockId);
                if (completed) await this.handleTaskListCompletion(reminder.blockId);
                else await this.handleTaskListCompletionCancel(reminder.blockId);
            }

            // 局部更新：更新当前提醒元素和其父任务进度
            // 传入更新后的数据以便正确判断完成状态

            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }

            // 触发UI刷新
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('切换提醒状态失败:', error);
            showMessage(t("operationFailed"));
            // 即使出错也要触发UI刷新，确保界面状态同步
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
                t("openNoteFailedDelete"),
                t("noteBlockDeleted"),
                async () => {
                    // 查找并删除相关提醒
                    await this.deleteRemindersByBlockId(blockId);
                },
                () => {
                    showMessage(t("openNoteFailed"));
                }
            );
        }
    }

    private formatReminderTime(date: string, time?: string, today?: string, endDate?: string, endTime?: string, reminder?: any): string {
        if (!today) {
            today = getLogicalDateString();
        }

        const tomorrowStr = getRelativeDateString(1);

        let dateStr = '';
        if (date === today) {
            dateStr = t("today");
        } else if (date === tomorrowStr) {
            dateStr = t("tomorrow");
        } else if (compareDateStrings(date, today) < 0) {
            // 过期日期也显示为相对时间
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
            });
        } else {
            const reminderDate = new Date(date + 'T00:00:00');
            dateStr = reminderDate.toLocaleDateString('zh-CN', {
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
            if (endDate === today) {
                endDateStr = t("today");
            } else if (endDate === tomorrowStr) {
                endDateStr = t("tomorrow");
            } else if (compareDateStrings(endDate, today) < 0) {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            } else {
                const endReminderDate = new Date(endDate + 'T00:00:00');
                endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
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

                    if (compareDateStrings(targetDate, today) < 0) return ''; // 过去的不显示

                    if (compareDateStrings(targetDate, today) === 0) {
                        return timePart ? timePart.substring(0, 5) : '';
                    } else {
                        // 未来：显示日期 + 时间
                        const d = new Date(targetDate + 'T00:00:00');
                        const ds = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
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

                    if (compareDateStrings(targetDate, today) < 0) {
                        // 过去：不显示 customReminderTime
                    } else if (compareDateStrings(targetDate, today) === 0) {
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
            const reminderData = await getAllReminders(this.plugin);
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
                await updateBlockReminderBookmark(blockId);

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
                    this.remindersContainer.innerHTML = `<div class="reminder-empty">${t("noReminders")}</div>`;
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

                showMessage(t("deletedRelatedReminders", { count: deletedCount.toString() }));
                // 全量刷新以确保分页、父子关系与异步数据都正确更新
                await this.loadReminders(true);
            } else {
                showMessage(t("noRelatedReminders"));
            }
        } catch (error) {
            console.error('删除相关提醒失败:', error);
            showMessage(t("deleteRelatedRemindersFailed"));
        }
    }

    // 新增：添加拖拽功能
    private addDragFunctionality(element: HTMLElement, reminder: any) {
        element.draggable = true;
        element.style.cursor = 'grab';

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
            element.style.cursor = 'grabbing';

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
            element.style.cursor = 'grab';
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

    // 容器拖拽事件（已不需要，通过拖到其他任务上下方自动移除父子关系）
    private addContainerDragEvents() {
        // 不再需要容器级别的拖拽提示
        // 移除父子关系现在通过拖动到其他任务的上方或下方自动完成
    }

    // 新增:移除父子关系
    private async removeParentRelation(childReminder: any, silent: boolean = false) {
        try {
            const reminderData = await getAllReminders(this.plugin);

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
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('移除父子关系失败:', error);
            showMessage(t("operationFailed") || "操作失败", 3000, 'error');
            throw error;
        }
    }

    // 新增：创建提醒倒计时元素 - 改进以支持过期显示
    private createReminderCountdownElement(reminder: any, today: string): HTMLElement | null {
        // 判断提醒的目标日期
        let targetDate: string;
        let isOverdueEvent = false;

        if (reminder.endDate && reminder.endDate !== reminder.date) {
            // 跨天事件：检查今天是否在事件范围内
            const isInRange = compareDateStrings(reminder.date, today) <= 0 &&
                compareDateStrings(today, reminder.endDate) <= 0;

            if (isInRange) {
                // 今天在事件范围内，显示到结束日期的倒计时
                targetDate = reminder.endDate;
            } else if (compareDateStrings(reminder.date, today) > 0) {
                // 事件还未开始，显示到开始日期的倒计时
                targetDate = reminder.date;
            } else {
                // 事件已结束，显示过期天数（仅对未完成事件）
                if (!reminder.completed) {
                    targetDate = reminder.endDate;
                    isOverdueEvent = true;
                } else {
                    return null;
                }
            }
        } else {
            // 单日事件
            if (compareDateStrings(reminder.date, today) > 0) {
                // 未来日期，显示倒计时
                targetDate = reminder.date;
            } else if (compareDateStrings(reminder.date, today) < 0) {
                // 过去日期，显示过期天数（仅对未完成事件）
                if (!reminder.completed) {
                    targetDate = reminder.date;
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
        const isSpanningEvent = !!(reminder.endDate && reminder.endDate !== reminder.date);
        const isTargetEndForSpanning = isSpanningEvent && targetDate === reminder.endDate;
        const isInRange = isSpanningEvent && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0;

        if (daysDiff === 0 && !(isTargetEndForSpanning && isInRange)) {
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
                t("overdueBySingleDay") :
                t("overdueByDays", { days: overdueDays.toString() });
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
            if (reminder.endDate && reminder.endDate !== reminder.date) {
                const isInRange = compareDateStrings(reminder.date, today) <= 0 &&
                    compareDateStrings(today, reminder.endDate) <= 0;

                if (isInRange) {
                    countdownEl.textContent = daysDiff === 1 ?
                        t("spanningDaysLeftSingle") :
                        t("spanningDaysLeftPlural", { days: daysDiff.toString() });
                } else {
                    countdownEl.textContent = daysDiff === 1 ?
                        t("startInDays", { days: daysDiff.toString() }) :
                        t("startInDays", { days: daysDiff.toString() });
                }
            } else {
                countdownEl.textContent = daysDiff === 1 ?
                    t("daysLeftSingle") :
                    t("daysLeftPlural", { days: daysDiff.toString() });
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

            // 循环任务限制
            if (draggedIsRecurring) {
                return false; // 循环任务不能成为子任务
            }
            if (targetIsRecurring) {
                return false; // 循环任务不能成为父任务
            }

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
            showMessage(t("operationFailed") || "操作失败");
        }
    }

    // 新增：设置父子关系
    private async setParentRelation(childReminder: any, parentReminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin);

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
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

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

    // 新增：重新排序提醒
    private async reorderReminders(draggedReminder: any, targetReminder: any, insertBefore: boolean) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            const oldPriority = draggedReminder.priority || 'none';
            const newPriority = targetReminder.priority || 'none';

            // 检查是否跨优先级拖拽
            if (oldPriority !== newPriority) {
                // 1. 更新优先级
                if (reminderData[draggedReminder.id]) {
                    reminderData[draggedReminder.id].priority = newPriority;
                    // 更新传入对象以反映最新状态
                    draggedReminder.priority = newPriority;
                }

                // 2. 处理旧优先级分组：移除被拖拽项并重新排序
                const oldGroup = Object.values(reminderData)
                    .filter((r: any) => (r.priority || 'none') === oldPriority && r.id !== draggedReminder.id)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                oldGroup.forEach((r: any, index: number) => {
                    if (reminderData[r.id]) reminderData[r.id].sort = index * 10;
                });

                // 3. 处理新优先级分组：插入并重新排序
                // 排除 draggedReminder (虽然它现在的 priority 可能是 newPriority，但我们需要将其插入到特定位置)
                const newGroup = Object.values(reminderData)
                    .filter((r: any) => (r.priority || 'none') === newPriority && r.id !== draggedReminder.id)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                // 找到目标位置
                let targetIndex = newGroup.findIndex((r: any) => r.id === targetReminder.id);
                // 如果找不到目标（极端情况），追加到末尾
                if (targetIndex === -1) targetIndex = newGroup.length;

                const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

                // 插入被拖拽的提醒
                const updatedDraggedReminder = reminderData[draggedReminder.id] || draggedReminder;
                newGroup.splice(insertIndex, 0, updatedDraggedReminder);

                // 更新新分组的排序值
                newGroup.forEach((r: any, index: number) => {
                    if (reminderData[r.id]) reminderData[r.id].sort = index * 10;
                });

                await saveReminders(this.plugin, reminderData);

                // 触发全局刷新以更新UI（包括优先级颜色和位置）
                // 不使用 skipPanelRefresh，因为优先级改变需要重新渲染样式
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                // showMessage(t("priorityUpdated") || "优先级已更新");

            } else {
                // 同优先级排序（原有逻辑）
                const samePriorityReminders = Object.values(reminderData)
                    .filter((r: any) => (r.priority || 'none') === oldPriority)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                // 移除被拖拽的提醒
                const filteredReminders = samePriorityReminders.filter((r: any) => r.id !== draggedReminder.id);

                // 找到目标位置
                const targetIndex = filteredReminders.findIndex((r: any) => r.id === targetReminder.id);
                const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

                // 插入被拖拽的提醒
                filteredReminders.splice(insertIndex, 0, draggedReminder);

                // 重新分配排序值
                filteredReminders.forEach((reminder: any, index: number) => {
                    if (reminderData[reminder.id]) {
                        reminderData[reminder.id].sort = index * 10; // 使用10的倍数便于后续插入
                    }
                });

                await saveReminders(this.plugin, reminderData);
                // 注意：同优先级排序不触发强制刷新，因为 manually updateDOMOrder 会处理
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: { skipPanelRefresh: true }
                }));
            }

        } catch (error) {
            console.error('重新排序提醒失败:', error);
            throw error;
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
            const completedDate = new Date(completedTime);
            const completedDateStr = getLocalDateString(completedDate);

            const timeStr = completedDate.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });

            if (completedDateStr === today) {
                return `今天 ${timeStr}`;
            } else if (completedDateStr === yesterdayStr) {
                return `昨天 ${timeStr}`;
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

    private showReminderContextMenu(event: MouseEvent, reminder: any) {
        const menu = new Menu("reminderContextMenu");
        const today = getLogicalDateString();

        // --- 订阅任务处理 ---
        if (reminder.isSubscribed) {
            // 导航选项
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📖",
                    label: t("openNote") || "打开笔记",
                    click: () => this.openBlockTab(reminder.blockId)
                });
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef") || "复制块引用",
                    click: () => this.copyBlockRef(reminder)
                });
            }

            if (reminder.projectId) {
                menu.addItem({
                    icon: "iconGrid",
                    label: t("openProjectKanban") || "打开项目看板",
                    click: () => this.openProjectKanban(reminder.projectId)
                });
            }

            menu.addSeparator();

            // 生产力工具
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro") || "开始番茄钟",
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp") || "开始正向计时",
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: t("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });

            menu.addSeparator();

            // 说明订阅来源
            menu.addItem({
                iconHTML: "ℹ️",
                label: t("subscribedTask") || "订阅日历任务",
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

        // --- 创建子任务 ---
        if (!isRecurring) {
            menu.addItem({
                iconHTML: "➕",
                label: t("createSubtask"),
                click: () => this.showCreateSubtaskDialog(reminder)
            });
            // 粘贴新建子任务（参考 ProjectKanbanView 的实现）
            menu.addItem({
                iconHTML: "📋",
                label: t("pasteCreateSubtask"),
                click: () => this.showPasteSubtaskDialog(reminder)
            });
            // 解除父子任务关系（仅当任务有父任务时显示）
            if (reminder.parentId) {
                menu.addItem({
                    iconHTML: "🔓",
                    label: t("unsetParentRelation"),
                    click: async () => {
                        try {
                            await this.removeParentRelation(reminder);
                            showMessage(t("taskUnlinkedFromParent").replace("${childTitle}", reminder.title || "任务").replace("${parentTitle}", "父任务"));
                        } catch (error) {
                            console.error('解除父子关系失败:', error);
                            showMessage(t("unlinkParentChildFailed") || "解除父子关系失败");
                        }
                    }
                });
            }
        } else {
            menu.addItem({
                iconHTML: "➕",
                label: "创建子任务 (循环任务禁用)",
                disabled: true,
            });
        }
        menu.addSeparator();

        // Helper to create priority submenu items, to avoid code repetition.
        // onlyThisInstance: true=只修改此实例, false=修改所有实例（原始事件）
        const createPriorityMenuItems = (onlyThisInstance: boolean = false) => {
            const menuItems = [];
            const priorities = [
                { key: 'high', label: t("high"), icon: '🔴' },
                { key: 'medium', label: t("medium"), icon: '🟡' },
                { key: 'low', label: t("low"), icon: '🔵' },
                { key: 'none', label: t("none"), icon: '⚫' }
            ];

            const currentPriority = reminder.priority || 'none';

            priorities.forEach(priority => {
                menuItems.push({
                    iconHTML: priority.icon,
                    label: priority.label,
                    current: currentPriority === priority.key,
                    click: () => {
                        if (reminder.isRepeatInstance && onlyThisInstance) {
                            // 只修改此实例
                            this.setInstancePriority(reminder.originalId, reminder.date, priority.key);
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
                label: "无分类",
                current: !currentCategoryId,
                click: () => {
                    if (reminder.isRepeatInstance && onlyThisInstance) {
                        // 只修改此实例
                        this.setInstanceCategory(reminder.originalId, reminder.date, null);
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
                            // 只修改此实例
                            this.setInstanceCategory(reminder.originalId, reminder.date, category.id);
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

        // 检查是否为跨天事件且在今日任务中
        const isSpanningInToday = isSpanningDays &&
            compareDateStrings(reminder.date, today) <= 0 &&
            compareDateStrings(today, reminder.endDate) <= 0;

        // 检查是否为未绑定的快速事件
        // const isUnboundQuickReminder = (reminder.isQuickReminder || reminder.id.startsWith('quick')) && !reminder.blockId;

        // 添加项目管理选项（仅当任务有projectId时显示）
        if (reminder.projectId) {
            menu.addItem({
                icon: "iconGrid",
                label: t("openProjectKanban"),
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

            const apply = async (newDate: string) => {
                try {
                    if (targetReminder.isRepeatInstance && onlyThisInstance) {
                        await this.setInstanceDate(targetReminder.originalId, targetReminder.date, newDate);
                    } else {
                        const targetId = targetReminder.isRepeatInstance ? targetReminder.originalId : targetReminder.id;
                        await this.setReminderBaseDate(targetId, newDate);
                    }
                } catch (err) {
                    console.error('快速调整日期失败:', err);
                    showMessage(t("operationFailed"));
                }
            };

            items.push({ iconHTML: "📅", label: t("moveToToday") || "移至今天", click: () => apply(todayStr) });
            items.push({ iconHTML: "📅", label: t("moveToTomorrow") || "移至明天", click: () => apply(tomorrowStr) });
            items.push({ iconHTML: "📅", label: t("moveToDayAfterTomorrow") || "移至后天", click: () => apply(dayAfterStr) });
            items.push({ iconHTML: "📅", label: t("moveToNextWeek") || "移至下周", click: () => apply(nextWeekStr) });
            return items;
        };

        if (reminder.isRepeatInstance) {
            // --- Menu for a REPEAT INSTANCE ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: t("bindToBlock"),
                    click: () => this.showBindToBlockDialog(reminder)
                });
            }

            // 为跨天的重复事件实例添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? t("unmarkTodayCompleted") : t("markTodayCompleted"),
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

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => this.editInstanceReminder(reminder)
            });
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: async () => {
                    // 从数据库重新加载原始提醒对象，避免使用实例化的对象
                    const reminderData = await getAllReminders(this.plugin);
                    const originalReminder = reminderData[reminder.originalId];
                    if (!originalReminder) {
                        showMessage(t("reminderDataNotExist"));
                        return;
                    }
                    this.showTimeEditDialog(originalReminder);
                }
            });

            // 优先级默认只修改此实例（因为不同实例的优先级可能不同）
            // 分类默认修改所有实例（因为分类一般不变）
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems(true) // true 表示只修改此实例
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: t("setCategory"),
                submenu: createCategoryMenuItems(false) // false 表示修改所有实例
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => this.deleteInstanceOnly(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => this.deleteOriginalReminder(reminder.originalId)
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: t("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });

        } else if (reminder.repeat?.enabled) {
            // --- Menu for the ORIGINAL RECURRING EVENT ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: t("bindToBlock"),
                    click: () => this.showBindToBlockDialog(reminder)
                });
            }

            // 为跨天的重复事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? t("unmarkTodayCompleted") : t("markTodayCompleted"),
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

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => this.splitRecurringReminder(reminder)
            });
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => this.showTimeEditDialog(reminder)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: t("setCategory"),
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => this.skipFirstOccurrence(reminder)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => this.deleteReminder(reminder)
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: t("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });

        } else {
            // --- Menu for a SIMPLE, NON-RECURRING EVENT ---
            // 只对已绑定块的事件显示复制块引用
            if (reminder.blockId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t("copyBlockRef"),
                    click: () => this.copyBlockRef(reminder)
                });
            } else {
                // 未绑定块的事件显示绑定块选项
                menu.addItem({
                    iconHTML: "🔗",
                    label: t("bindToBlock"),
                    click: () => this.showBindToBlockDialog(reminder)
                });
            }

            // 为跨天的普通事件添加"今日已完成"选项
            if (isSpanningInToday && !reminder.completed) {
                const isTodayCompleted = this.isSpanningEventTodayCompleted(reminder);
                menu.addItem({
                    iconHTML: isTodayCompleted ? "🔄" : "✅",
                    label: isTodayCompleted ? t("unmarkTodayCompleted") : t("markTodayCompleted"),
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

            menu.addItem({
                iconHTML: "📝",
                label: t("modify"),
                click: () => this.showTimeEditDialog(reminder)
            });
            // 快速调整日期（普通任务）
            menu.addItem({
                iconHTML: "📆",
                label: t("quickReschedule") || "快速调整日期",
                submenu: createQuickDateMenuItems(reminder, false)
            });
            menu.addItem({
                iconHTML: "🎯",
                label: t("setPriority"),
                submenu: createPriorityMenuItems()
            });
            menu.addItem({
                iconHTML: "🏷️",
                label: t("setCategory"),
                submenu: createCategoryMenuItems()
            });
            menu.addSeparator();
            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => this.startPomodoro(reminder)
            });
            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
                click: () => this.startPomodoroCountUp(reminder)
            });
            menu.addItem({
                iconHTML: "📊",
                label: t("viewPomodoros") || "查看番茄钟",
                click: () => this.showPomodoroSessions(reminder)
            });
            menu.addItem({
                iconHTML: "🗑",
                label: t("deleteReminder"),
                click: () => this.deleteReminder(reminder)
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    /**
     * 将非实例任务或系列原始任务的基准日期设置为 newDate。
     * 保持跨天跨度（若存在 endDate）。
     */
    private async setReminderBaseDate(reminderId: string, newDate: string) {
        const reminderData = await getAllReminders(this.plugin);
        const reminder = reminderData[reminderId];
        if (!reminder) {
            showMessage(t("reminderNotExist"));
            return;
        }

        try {
            const oldDate: string | undefined = reminder.date;
            const oldEndDate: string | undefined = reminder.endDate;

            reminder.date = newDate;
            if (oldEndDate && oldDate) {
                const span = getDaysDifference(oldDate, oldEndDate);
                reminder.endDate = addDaysToDate(newDate, span);
            }

            await saveReminders(this.plugin, reminderData);

            if (reminder.blockId) {
                try { await updateBlockReminderBookmark(reminder.blockId); } catch (e) { /* ignore */ }
            }

            // 局部刷新
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            showMessage(t("eventTimeUpdated") || "事件时间已更新");
        } catch (err) {
            console.error('设置基准日期失败:', err);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * 设置重复事件的某个实例日期（通过 instanceModifications）。
     * 同时根据原始事件的跨度设置实例的 endDate 修改。
     */
    private async setInstanceDate(originalId: string, instanceDate: string, newDate: string) {
        const reminderData = await getAllReminders(this.plugin);
        const originalReminder = reminderData[originalId];
        if (!originalReminder || !originalReminder.repeat?.enabled) {
            showMessage(t("reminderNotExist"));
            return;
        }

        try {
            if (!originalReminder.repeat.instanceModifications) {
                originalReminder.repeat.instanceModifications = {};
            }
            if (!originalReminder.repeat.instanceModifications[instanceDate]) {
                originalReminder.repeat.instanceModifications[instanceDate] = {};
            }

            // 设置新的日期
            originalReminder.repeat.instanceModifications[instanceDate].date = newDate;

            // 若原始为跨天，保持跨度
            if (originalReminder.endDate && originalReminder.date) {
                const span = getDaysDifference(originalReminder.date, originalReminder.endDate);
                originalReminder.repeat.instanceModifications[instanceDate].endDate = addDaysToDate(newDate, span);
            }

            await saveReminders(this.plugin, reminderData);

            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            showMessage(t("instanceTimeUpdated") || "实例时间已更新");
        } catch (err) {
            console.error('设置实例日期失败:', err);
            showMessage(t("operationFailed"));
        }
    }

    private startPomodoro(reminder: any) {
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
                    this.performStartPomodoro(reminder, currentState);
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
            this.performStartPomodoro(reminder);
        }
    }



    /**
     * 标记跨天事件"今日已完成"
     * @param reminder 提醒对象
     */
    private async markSpanningEventTodayCompleted(reminder: any) {
        try {
            const today = getLogicalDateString();
            const reminderData = await getAllReminders(this.plugin);

            let updatedReminder: any = null;

            if (reminder.isRepeatInstance) {
                // 重复事件实例：更新原始事件的每日完成记录
                const originalId = reminder.originalId;
                if (reminderData[originalId]) {
                    if (!reminderData[originalId].dailyCompletions) {
                        reminderData[originalId].dailyCompletions = {};
                    }
                    reminderData[originalId].dailyCompletions[today] = true;
                    updatedReminder = reminderData[originalId];
                }
            } else {
                // 普通事件：更新事件的每日完成记录
                if (reminderData[reminder.id]) {
                    if (!reminderData[reminder.id].dailyCompletions) {
                        reminderData[reminder.id].dailyCompletions = {};
                    }
                    reminderData[reminder.id].dailyCompletions[today] = true;
                    updatedReminder = reminderData[reminder.id];
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
            showMessage(t("markedTodayCompleted") || "已标记今日已完成", 2000);
        } catch (error) {
            console.error('标记今日已完成失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * 取消标记跨天事件"今日已完成"
     * @param reminder 提醒对象
     */
    private async unmarkSpanningEventTodayCompleted(reminder: any) {
        try {
            const today = getLogicalDateString();
            const reminderData = await getAllReminders(this.plugin);

            let updatedReminder: any = null;

            if (reminder.isRepeatInstance) {
                // 重复事件实例：更新原始事件的每日完成记录
                const originalId = reminder.originalId;
                if (reminderData[originalId] && reminderData[originalId].dailyCompletions) {
                    delete reminderData[originalId].dailyCompletions[today];
                    updatedReminder = reminderData[originalId];
                }
            } else {
                // 普通事件：更新事件的每日完成记录
                if (reminderData[reminder.id] && reminderData[reminder.id].dailyCompletions) {
                    delete reminderData[reminder.id].dailyCompletions[today];
                    updatedReminder = reminderData[reminder.id];
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 通知插件更新徽章
            if (this.plugin && typeof this.plugin.updateBadges === 'function') {
                this.plugin.updateBadges();
            }

            // 刷新界面显示
            this.loadReminders();
            showMessage(t("unmarkedTodayCompleted") || "已取消今日已完成", 2000);
        } catch (error) {
            console.error('取消今日已完成失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    private async performStartPomodoro(reminder: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟');
            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, false, inheritState);

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

            const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState, this.plugin);

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
            const reminderData = await getAllReminders(this.plugin);
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
                t("deleteReminder"),
                `${t("confirmDelete", { title: reminder.title })}${extra}`,
                () => {
                    this.performDeleteReminder(reminder.id);
                }
            );
        } catch (error) {
            // 回退到默认提示
            await confirm(
                t("deleteReminder"),
                t("confirmDelete", { title: reminder.title }),
                () => {
                    this.performDeleteReminder(reminder.id);
                }
            );
        }
    }

    private async performDeleteReminder(reminderId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (!reminderData[reminderId]) {
                showMessage(t("reminderNotExist"));
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
                        await updateBlockReminderBookmark(bId);
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
                await this.loadReminders(true);
                showMessage(t("reminderDeleted"));

                // 触发其他组件更新
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: {}
                }));
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
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
                    this.remindersContainer.innerHTML = `<div class="reminder-empty">${t("noReminders")}</div>`;
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
            const reminderData = await getAllReminders(this.plugin);
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
                showMessage(t("priorityUpdated") || "优先级已更新");

                // 如果是重复事件（修改全部实例），需要重新加载面板以更新所有实例
                // 参考项目看板的实现，确保所有实例都能得到更新
                if (isRecurringEvent) {
                    await this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
                                backgroundColor = 'var(--b3-card-error-background)';
                                borderColor = 'var(--b3-card-error-color)';
                                break;
                            case 'medium':
                                backgroundColor = 'var(--b3-card-warning-background)';
                                borderColor = 'var(--b3-card-warning-color)';
                                break;
                            case 'low':
                                backgroundColor = 'var(--b3-card-info-background)';
                                borderColor = 'var(--b3-card-info-color)';
                                break;
                            default:
                                backgroundColor = 'var(--b3-theme-surface-lighter)';
                                borderColor = 'var(--b3-theme-surface-lighter)';
                        }
                        el.style.backgroundColor = backgroundColor;
                        el.style.border = `2px solid ${borderColor}`;
                        el.dataset.priority = priority;
                    }

                    // 如果当前按优先级排序，需要触发刷新以重新排序
                    if (this.currentSort === 'priority') {
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    } else {
                        window.dispatchEvent(new CustomEvent('reminderUpdated', {
                            detail: { skipPanelRefresh: true }
                        }));
                    }
                }
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    private async setCategory(reminderId: string, categoryId: string | null) {
        try {
            const reminderData = await getAllReminders(this.plugin);
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
                showMessage(categoryId ? (t("categoryUpdated") || "分类已更新") : (t("categoryRemoved") || "分类已移除"));

                // 如果是重复事件（修改全部实例），需要重新加载面板以更新所有实例
                // 参考项目看板的实现，确保所有实例都能得到更新
                if (isRecurringEvent) {
                    await this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
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

                    // 如果当前有分类过滤（不是"全部分类"），需要触发刷新以更新列表
                    // 因为修改分类后，任务可能不再匹配当前的过滤条件
                    if (this.currentCategoryFilter !== 'all') {
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    } else {
                        window.dispatchEvent(new CustomEvent('reminderUpdated', {
                            detail: { skipPanelRefresh: true }
                        }));
                    }
                }
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('设置分类失败:', error);
            showMessage(t("operationFailed"));
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
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(t("reminderNotExist"));
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

            // 触发刷新（如果当前按优先级排序）
            if (this.currentSort === 'priority') {
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            }

            showMessage(t("instanceModified") || "实例已修改");
        } catch (error) {
            console.error('设置实例优先级失败:', error);
            showMessage(t("operationFailed"));
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
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(t("reminderNotExist"));
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

            // 触发刷新（如果有分类过滤）
            if (this.currentCategoryFilter !== 'all') {
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            }

            showMessage(t("instanceModified") || "实例已修改");
        } catch (error) {
            console.error('设置实例分类失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * [NEW] Ends the current recurring series and starts a new one from the next cycle.
     * @param reminder The original recurring reminder to split.
     */
    private async splitRecurringReminder(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[reminder.id];
            if (!originalReminder || !originalReminder.repeat?.enabled) {
                showMessage(t("operationFailed"));
                return;
            }

            // 计算原始事件的下一个周期日期
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
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
            showMessage(t("operationFailed"));
        }
    }

    /**
     * [MODIFIED] Performs the actual split operation after user edits the reminder
     * @param originalReminder The original recurring reminder
     * @param modifiedReminder The modified reminder data from edit dialog
     */
    private async performSplitOperation(originalReminder: any, modifiedReminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin);

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
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
                detail: { skipPanelRefresh: true }
            }));
            showMessage(t("seriesSplitSuccess"));

        } catch (error) {
            console.error('执行分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    // 新增：将实例作为新系列编辑（分割系列）
    private async editInstanceAsNewSeries(reminder: any) {
        try {
            const originalId = reminder.originalId;
            const instanceDate = reminder.date;

            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(t("reminderDataNotExist"));
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
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
                async () => {
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { skipPanelRefresh: true }
                    }));
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
            showMessage(t("operationFailed"));
        }
    }

    // 新增：编辑重复事件实例
    private async editInstanceReminder(reminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[reminder.originalId];

            if (!originalReminder) {
                showMessage(t("reminderDataNotExist"));
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
                termType: instanceMod?.termType !== undefined ? instanceMod.termType : originalReminder.termType,
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
                        detail: { skipPanelRefresh: true }
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
            showMessage(t("openModifyDialogFailed"));
        }
    }

    // 新增：删除单个重复事件实例
    private async deleteInstanceOnly(reminder: any) {
        await confirm(
            t("deleteThisInstance"),
            t("confirmDeleteInstance"),
            async () => {
                try {
                    const originalId = reminder.originalId;
                    const instanceDate = reminder.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(t("instanceDeleted"));
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { skipPanelRefresh: true }
                    }));
                } catch (error) {
                    console.error('删除重复实例失败:', error);
                    showMessage(t("deleteInstanceFailed"));
                }
            }
        );
    }

    // 新增：为原始重复事件添加排除日期
    private async addExcludedDate(originalId: string, excludeDate: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);

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

    private async showTimeEditDialog(reminder: any) {
        const editDialog = new QuickReminderDialog(
            undefined,
            undefined,
            () => {
                this.loadReminders();
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

    private async deleteOriginalReminder(originalId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (originalReminder) {
                this.deleteReminder(originalReminder);
            } else {
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('获取原始提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
        }
    }

    /**
     * [MODIFIED] Skip the first occurrence of a recurring reminder
     * This method advances the start date of the recurring reminder to the next cycle
     * @param reminder The original recurring reminder
     */
    private async skipFirstOccurrence(reminder: any) {
        await confirm(
            t("deleteThisInstance"),
            t("confirmSkipFirstOccurrence"),
            async () => {
                try {
                    const reminderData = await getAllReminders(this.plugin);
                    const originalReminder = reminderData[reminder.id];

                    if (!originalReminder || !originalReminder.repeat?.enabled) {
                        showMessage(t("operationFailed"));
                        return;
                    }

                    // 计算下一个周期的日期
                    const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
                    if (!nextDate) {
                        showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
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
                    showMessage(t("firstOccurrenceSkipped"));
                    this.loadReminders();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { skipPanelRefresh: true }
                    }));
                } catch (error) {
                    console.error('跳过首次发生失败:', error);
                    showMessage(t("operationFailed"));
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
            const title = reminder.title || t("unnamedNote");

            // 生成静态锚文本块引格式
            const blockRef = `((${blockId} "${title}"))`;

            // 复制到剪贴板
            await navigator.clipboard.writeText(blockRef);

        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage("复制块引失败");
        }
    }
    // 获取原始事件的blockId
    private async getOriginalBlockId(originalId: string): Promise<string | null> {
        try {
            const reminderData = await getAllReminders(this.plugin);
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
    private showBindToBlockDialog(reminder: any) {
        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            try {
                console.log('选择绑定到块ID:', blockId);
                await this.bindReminderToBlock(reminder, blockId);
                showMessage(t("reminderBoundToBlock"));
                // 绑定成功后刷新整个列表以确保显示正确
                this.loadReminders();
            } catch (error) {
                console.error('绑定提醒到块失败:', error);
                showMessage(t("bindToBlockFailed"));
            }
        }, {
            defaultTab: 'bind',
            defaultParentId: reminder.parentId,
            defaultProjectId: reminder.projectId,
            defaultCustomGroupId: reminder.customGroupId,
            reminder: reminder
        });
        blockBindingDialog.show();
    }

    private showCreateSubtaskDialog(parentReminder: any) {
        const dialog = new QuickReminderDialog(
            undefined, // initialDate
            undefined, // initialTime
            async () => { // onSaved
                await this.loadReminders(true);
            },
            undefined, // 无时间段选项
            { // options
                defaultParentId: parentReminder.id,
                defaultProjectId: parentReminder.projectId,
                defaultCategoryId: parentReminder.categoryId,
                defaultPriority: parentReminder.priority || 'none',
                plugin: this.plugin,
                defaultTitle: '', // 子任务标题默认为空
            }
        );
        dialog.show();
    }

    private showPasteSubtaskDialog(parentReminder: any) {
        const dialog = new Dialog({
            title: "粘贴列表新建子任务",
            content: `
                <div class="b3-dialog__content">
                    <p>粘贴Markdown列表或多行文本，每行将创建一个子任务。支持多层级列表自动创建父子任务。</p>
                    <textarea id="taskList" class="b3-text-field" placeholder="示例：\n- 需求文档\n  - 功能列表\n  - 接口设计\n- 测试用例" style="width:100%; height:220px; resize:vertical;"></textarea>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                    <button class="b3-button b3-button--primary" id="createBtn">创建子任务</button>
                </div>
            `,
            width: "500px",
        });

        const textArea = dialog.element.querySelector('#taskList') as HTMLTextAreaElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        createBtn.addEventListener('click', async () => {
            const text = textArea.value.trim();
            if (!text) {
                showMessage("列表内容不能为空");
                return;
            }

            const hierarchicalTasks = this.parseHierarchicalTaskList(text);

            if (hierarchicalTasks.length > 0) {
                await this.batchCreateSubtasksWithHierarchy(hierarchicalTasks, parentReminder.id);
                dialog.destroy();
                const totalTasks = this.countTotalTasks(hierarchicalTasks);
                showMessage(`${totalTasks} 个子任务已创建`);
            }
        });
    }

    // 复用 ProjectKanbanView 的解析方法，适配为在 ReminderPanel 创建子任务
    private parseHierarchicalTaskList(text: string): any[] {
        const lines = text.split('\n');
        const tasks: any[] = [];
        const stack: Array<{ task: any; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            if (!cleanLine || (!cleanLine.startsWith('-') && level === 0 && !cleanLine.match(/^\s*-/))) {
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine);
                    const task = { ...taskData, level: 0, children: [] };
                    tasks.push(task);
                    stack.length = 0;
                    stack.push({ task, level: 0 });
                }
                continue;
            }

            let levelFromDashes = 0;
            const dashPrefixMatch = cleanLine.match(/^(-{2,})\s*/);
            if (dashPrefixMatch) {
                levelFromDashes = dashPrefixMatch[1].length - 1;
            }

            const combinedLevel = level + levelFromDashes;
            const taskContent = cleanLine.replace(/^[-*+]+\s*/, '');
            if (!taskContent) continue;

            const taskData = this.parseTaskLine(taskContent);
            const task = { ...taskData, level: combinedLevel, children: [] };

            while (stack.length > 0 && stack[stack.length - 1].level >= combinedLevel) {
                stack.pop();
            }

            if (stack.length === 0) {
                tasks.push(task);
            } else {
                const parent = stack[stack.length - 1].task;
                parent.children.push(task);
            }

            stack.push({ task, level: combinedLevel });
        }

        return tasks;
    }

    private calculateIndentLevel(line: string): number {
        const match = line.match(/^(\s*)/);
        if (!match) return 0;
        const indent = match[1];
        const spaces = indent.replace(/\t/g, '  ').length;
        return Math.floor(spaces / 2);
    }

    private parseTaskLine(line: string): { title: string; priority?: string; startDate?: string; endDate?: string; blockId?: string; completed?: boolean } {
        const paramMatch = line.match(/@(.*)$/);
        let title = line;
        let priority: string | undefined;
        let startDate: string | undefined;
        let endDate: string | undefined;
        let blockId: string | undefined;
        let completed: boolean | undefined;

        blockId = this.extractBlockIdFromText(line);

        if (blockId) {
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+'([^']+)'\)\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+"([^\"]+)"\)\)/g, '$1');
            title = title.replace(/\(\([^\)]+\)\)/g, '');
        }

        const checkboxMatch = title.match(/^\s*\[\s*([ xX])\s*\]\s*/);
        if (checkboxMatch) {
            const mark = checkboxMatch[1];
            completed = (mark.toLowerCase() === 'x');
            title = title.replace(/^\s*\[\s*([ xX])\s*\]\s*/, '').trim();
        }

        const leadingCheckboxMatch = line.match(/^\s*[-*+]\s*\[\s*([ xX])\s*\]\s*(.+)$/);
        if (leadingCheckboxMatch) {
            completed = (leadingCheckboxMatch[1].toLowerCase() === 'x');
            title = leadingCheckboxMatch[2];
        }

        if (paramMatch) {
            title = title.replace(/@(.*)$/, '').trim();
            const paramString = paramMatch[1];
            const params = new URLSearchParams(paramString);
            priority = params.get('priority') || undefined;
            startDate = params.get('startDate') || undefined;
            endDate = params.get('endDate') || undefined;
            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) priority = 'none';
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) startDate = undefined;
            if (endDate && !dateRegex.test(endDate)) endDate = undefined;
        }

        return { title: title.trim() || '未命名任务', priority, startDate, endDate, blockId, completed };
    }

    private async batchCreateSubtasksWithHierarchy(tasks: any[], parentIdForAllTopLevel: string) {
        const reminderData = await getAllReminders(this.plugin);

        // 获取项目ID从父任务
        const parent = reminderData[parentIdForAllTopLevel];
        const projectId = parent ? parent.projectId : undefined;

        // 获取当前最大 sort
        const maxSort = Object.values(reminderData)
            .filter((r: any) => r && r.projectId === projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;
        const createdTasks: any[] = []; // 记录所有创建的任务

        const createRecursively = async (task: any, parentId?: string) => {
            const taskId = `rem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            sortCounter += 10;

            const newSubtask: any = {
                id: taskId,
                title: task.title,
                note: '',
                date: task.startDate || undefined,
                endDate: task.endDate || undefined,
                // 如果子任务没指定优先级，继承父任务的优先级
                priority: task.priority && task.priority !== 'none' ? task.priority : (parent ? parent.priority : undefined),
                categoryId: parent ? parent.categoryId : undefined,
                projectId: projectId,
                parentId: parentId || parentIdForAllTopLevel,
                completed: !!task.completed,
                created: getLocalDateTimeString(new Date()),
                sort: sortCounter
            };

            if (task.blockId) {
                try {
                    const block = await getBlockByID(task.blockId);
                    if (block) {
                        newSubtask.blockId = task.blockId;
                        newSubtask.docId = block.root_id || task.blockId;
                        if (!task.title || task.title === '未命名任务') {
                            newSubtask.title = block.content || block.fcontent || '未命名任务';
                        }
                        await updateBlockReminderBookmark(task.blockId);
                    }
                } catch (err) {
                    console.warn('绑定块失败:', err);
                }
            }

            reminderData[taskId] = newSubtask;
            createdTasks.push(newSubtask); // 记录创建的任务

            if (task.children && task.children.length > 0) {
                for (const child of task.children) {
                    await createRecursively(child, taskId);
                }
            }
        };

        for (const t of tasks) {
            await createRecursively(t, undefined);
        }

        await saveReminders(this.plugin, reminderData);
        // 全量刷新面板以确保分页/父子关系/异步数据一致
        try {
            await this.loadReminders(true);
        } catch (err) {
            console.warn('批量创建子任务后刷新面板失败，可能在并发加载中:', err);
        }

    }

    private countTotalTasks(tasks: any[]): number {
        let count = 0;
        const countRecursively = (list: any[]) => {
            for (const t of list) {
                count++;
                if (t.children && t.children.length > 0) countRecursively(t.children);
            }
        };
        countRecursively(tasks);
        return count;
    }

    private extractBlockIdFromText(text: string): string | undefined {
        const markdownLinkMatch = text.match(/\[([^\]]+)\]\(siyuan:\/\/blocks\/([^)]+)\)/);
        if (markdownLinkMatch) {
            const blockId = markdownLinkMatch[2];
            if (blockId && blockId.length >= 20) return blockId;
        }

        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'\"]+)['"]\)\)/);
        if (blockRefWithTitleMatch) {
            const blockId = blockRefWithTitleMatch[1];
            if (blockId && blockId.length >= 20) return blockId;
        }

        const simpleBlockRefMatch = text.match(/\(\(([^)]+)\)\)/);
        if (simpleBlockRefMatch) {
            const blockId = simpleBlockRefMatch[1].trim();
            if (blockId && blockId.length >= 20) return blockId;
        }

        return undefined;
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
                return !reminder.completed && reminder.date && compareDateStrings(reminder.endDate || reminder.date, today) < 0;
            case 'today':
                if (reminder.completed || !reminder.date) return false;
                return (compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate || reminder.date) <= 0) ||
                    compareDateStrings(reminder.endDate || reminder.date, today) < 0;
            case 'tomorrow':
                if (reminder.completed || !reminder.date) return false;
                return compareDateStrings(reminder.date, tomorrow) <= 0 && compareDateStrings(tomorrow, reminder.endDate || reminder.date) <= 0;
            case 'future7':
                if (reminder.completed || !reminder.date) return false;
                return compareDateStrings(tomorrow, reminder.date) <= 0 && compareDateStrings(reminder.date, future7Days) <= 0;
            case 'completed':
                return reminder.completed;
            case 'todayCompleted':
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
                return (reminder.endDate && compareDateStrings(reminder.date, today) <= 0 && compareDateStrings(today, reminder.endDate) <= 0) ||
                    reminder.date === today;
            case 'all':
                const sevenDaysAgo = getRelativeDateString(-7);
                return reminder.date && compareDateStrings(sevenDaysAgo, reminder.date) <= 0 &&
                    compareDateStrings(reminder.endDate || reminder.date, today) < 0;
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
        noCategoryEl.innerHTML = `<span>无分类</span>`;
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
                border-radius: 14px;
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
                background-color: var(--b3-theme-surface-lighter);
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
                throw new Error(t("pleaseConfigureNotebook"));
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
                throw new Error(t("renderPathFailed"));
            }

            // 准备文档内容
            const docContent = content;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);
            await refreshSql();
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
            const reminderData = await getAllReminders(this.plugin);
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
                reminderData[reminderId].isQuickReminder = false; // 移除快速提醒标记

                await saveReminders(this.plugin, reminderData);

                // 将绑定的块添加项目ID属性 custom-task-projectId
                const projectId = reminderData[reminderId].projectId;
                if (projectId) {
                    const { addBlockProjectId } = await import('../api');
                    await addBlockProjectId(blockId, projectId);
                    console.debug('ReminderPanel: bindReminderToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBlockReminderBookmark(blockId);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: { skipPanelRefresh: true }
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
            const projectData = await readProjectData();

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
                const statsView = new TaskStatsView();
                statsView.show();
            } else {
                const statsView = new PomodoroStatsView();
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

    /**
     * 显示新建任务对话框
     */
    private showNewTaskDialog() {
        try {
            const today = getLogicalDateString();
            const quickDialog = new QuickReminderDialog(
                today, // 初始日期为今天
                undefined, // 不指定初始时间
                async () => {
                    // 保存回调：局部更新而非刷新整个列表
                    try {
                        // 读取最新的提醒数据，找到刚创建的任务
                        const reminderData = await getAllReminders(this.plugin);
                        const allReminders = Object.values(reminderData);
                        // 找到最新创建的任务（按created时间排序）
                        const sortedReminders = allReminders
                            .filter((r: any) => r && r.created)
                            .sort((a: any, b: any) => {
                                const timeA = new Date(a.created).getTime();
                                const timeB = new Date(b.created).getTime();
                                return timeB - timeA;
                            });

                        if (sortedReminders.length > 0) {
                            const newReminder = sortedReminders[0];
                            // 检查新任务是否应该在当前视图显示
                            if (this.shouldShowInCurrentView(newReminder)) {
                                // 局部更新DOM：添加新任务
                                // await this.insertNewReminderDOM(newReminder);
                                // 改为全局刷新以确保显示正确
                                this.loadReminders();
                            }
                        }
                    } catch (error) {
                        console.error('添加新任务DOM失败，使用全局刷新:', error);
                        this.loadReminders();
                    }
                },
                undefined, // timeRangeOptions
                {
                    plugin: this.plugin // 传入plugin实例
                }
            );
            quickDialog.show();
        } catch (error) {
            console.error('显示新建任务对话框失败:', error);
            showMessage("打开新建任务对话框失败");
        }
    }

    /**
     * 显示更多菜单
     */
    private showMoreMenu(event: MouseEvent) {
        try {
            const menu = new Menu("reminderMoreMenu");

            // 添加分类管理
            menu.addItem({
                icon: 'iconTags',
                label: t("manageCategories") || "管理分类",
                click: () => this.showCategoryManageDialog()
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
            pageInfo.textContent = `第 ${this.currentPage} 页，共 ${this.totalPages} 页 (${this.totalItems} 条)`;

            paginationContainer.appendChild(prevBtn);
            paginationContainer.appendChild(pageInfo);
            paginationContainer.appendChild(nextBtn);
        } else if (truncatedTotal > 0) {
            // 非分页模式下的截断提示
            pageInfo.textContent = `已展示 ${this.currentRemindersCache.length} 条，还隐藏 ${truncatedTotal} 条`;
            paginationContainer.appendChild(pageInfo);
        } else {
            // 没有截断时的信息
            pageInfo.textContent = `共 ${this.totalItems} 条`;
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
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();
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
                        const { readReminderData } = await import("../api");
                        rawData = await getAllReminders(this.plugin);
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
            console.error('获取番茄钟计数失败:', error);
            return 0;
        }
    }

    private async getReminderFocusTime(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();
            // If this is a repeat instance, always use per-event total
            if (reminder && reminder.isRepeatInstance) {
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
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();

            const targetDate = date || getLogicalDateString();

            // If it's a repeat instance or an instance id (contains date), try direct event count
            if (reminder && reminder.isRepeatInstance) {
                if (typeof pomodoroManager.getEventPomodoroCount === 'function') {
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
                    const { readReminderData } = await import("../api");
                    const rd = await getAllReminders(this.plugin);
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
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();
            const targetDate = date || getLogicalDateString();

            // If it's a repeat instance, use event-specific focus time
            if (reminder && reminder.isRepeatInstance) {
                if (typeof pomodoroManager.getEventFocusTime === 'function') {
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
                    const { readReminderData } = await import("../api");
                    const rd = await getAllReminders(this.plugin);
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
                        total += pomodoroManager.getEventFocusTime(id, targetDate) || 0;
                    }
                } catch (e) { }
            }

            return total;
        } catch (error) {
            console.error('获取今日专注时长失败:', error);
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


    /**
     * 加载折叠状态
     */
    private async loadCollapseStates() {
        try {
            if (!this.plugin) return;

            const collapseData = await this.plugin.loadData('reminder-collapse-states') || {};
            this.collapsedTasks = new Set(collapseData.collapsedTasks || []);
            this.userExpandedTasks = new Set(collapseData.userExpandedTasks || []);
        } catch (error) {
            console.warn('加载折叠状态失败:', error);
            // 初始化为空的Set
            this.collapsedTasks = new Set();
            this.userExpandedTasks = new Set();
        }
    }

    /**
     * 保存折叠状态
     */
    private async saveCollapseStates() {
        try {
            if (!this.plugin) return;

            const collapseData = {
                collapsedTasks: Array.from(this.collapsedTasks),
                userExpandedTasks: Array.from(this.userExpandedTasks)
            };

            await this.plugin.saveData('reminder-collapse-states', collapseData);
        } catch (error) {
            console.warn('保存折叠状态失败:', error);
        }
    }

    private async showCategorySelectDialog() {
        const categories = await this.categoryManager.loadCategories();

        const dialog = new Dialog({
            title: t("selectCategories") || "选择分类",
            content: this.createCategorySelectContent(categories),
            width: "400px",
            height: "250px"
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
            this.updateCategoryFilterButtonText();
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
                            <input type="checkbox" id="categoryAll" value="all" ${this.selectedCategories.includes('all') || this.selectedCategories.length === 0 ? 'checked' : ''}>
                            ${t("allCategories") || "全部"}
                        </label>
                    </div>
                    <div class="category-option">
                        <label>
                            <input type="checkbox" class="category-checkbox" value="none" ${this.selectedCategories.includes('none') ? 'checked' : ''}>
                            ${t("noCategory") || "无分类"}
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
                    <button class="b3-button b3-button--cancel" id="categorySelectCancel">${t("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="categorySelectConfirm">${t("confirm")}</button>
                </div>
            </div>
        `;

        return html;
    }

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
