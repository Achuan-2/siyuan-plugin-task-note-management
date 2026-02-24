import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import { showMessage, confirm, openTab, Menu, Dialog, Constants } from "siyuan";
import { refreshSql, getBlockByID, sql, updateBlock, getBlockKramdown, updateBindBlockAtrrs, openBlock } from "../api";
import { getLocalDateString, getLocalDateTime, getLocalDateTimeString, compareDateStrings, getLogicalDateString, getRelativeDateString, getDayStartAdjustedDate } from "../utils/dateUtils";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { confirmDialog } from "../libs/dialog";
import { ProjectManager } from "../utils/projectManager";
import { StatusManager } from "../utils/statusManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { ProjectColorDialog } from "./ProjectColorDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { i18n } from "../pluginInstance";
import { generateRepeatInstances, RepeatInstance, getDaysDifference, addDaysToDate } from "../utils/repeatUtils";
import { getAllReminders, saveReminders, loadHolidays } from "../utils/icsSubscription";
import { CalendarConfigManager } from "../utils/calendarConfigManager";
import { TaskSummaryDialog } from "@/components/TaskSummaryDialog";
import { PomodoroManager } from "../utils/pomodoroManager";
import { getNextLunarMonthlyDate, getNextLunarYearlyDate, getSolarDateLunarString } from "../utils/lunarUtils";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { Solar } from 'lunar-typescript';
import { VipManager } from "../utils/vip";
export class CalendarView {
    private container: HTMLElement;
    private calendar: Calendar;
    private plugin: any;
    private resizeObserver: ResizeObserver;
    private resizeTimeout: number;
    private categoryManager: CategoryManager; // 添加分类管理器
    private projectManager: ProjectManager;
    private statusManager: StatusManager; // 添加状态管理器
    private calendarConfigManager: CalendarConfigManager;
    private taskSummaryDialog: TaskSummaryDialog;
    private currentCategoryFilter: Set<string> = new Set(['all']); // 当前分类过滤（支持多选）
    private currentProjectFilter: Set<string> = new Set(['all']); // 当前项目过滤（支持多选）
    private initialProjectFilter: string | null = null;
    private showCategoryAndProject: boolean = true; // 是否显示分类和项目信息
    private showLunar: boolean = true; // 是否显示农历
    private showHoliday: boolean = true; // 是否显示节假日
    private showPomodoro: boolean = true; // 是否显示番茄专注时间
    private showCrossDayTasks: boolean = true; // 是否显示跨天任务
    private crossDayThreshold: number = -1; // 跨度多少天以下才显示
    private showSubtasks: boolean = true; // 是否显示子任务
    private showRepeatTasks: boolean = true; // 是否显示重复任务
    private repeatInstanceLimit: number = -1; // 重复任务显示实例数量限制
    private showHiddenTasks: boolean = false; // 是否显示不在日历视图显示的任务
    private pomodoroToggleBtn: HTMLElement | null = null; // Pomodoro toggle button
    private holidays: { [date: string]: { title: string, type: 'holiday' | 'workday' } } = {}; // 节假日数据
    private colorBy: 'category' | 'priority' | 'project' = 'priority'; // 按分类或优先级上色
    private tooltip: HTMLElement | null = null; // 添加提示框元素
    private dropIndicator: HTMLElement | null = null; // 拖放放置指示器
    private externalReminderUpdatedHandler: ((e: Event) => void) | null = null;
    private settingUpdateHandler: ((e: Event) => void) | null = null;
    private hideTooltipTimeout: number | null = null; // 添加提示框隐藏超时控制
    private tooltipShowTimeout: number | null = null; // 添加提示框显示延迟控制
    private lastClickTime: number = 0; // 添加双击检测
    private clickTimeout: number | null = null; // 添加单击延迟超时
    private refreshTimeout: number | null = null; // 添加刷新防抖超时
    private currentCompletionFilter: string = 'all'; // 当前完成状态过滤
    private isDragging: boolean = false; // 标记是否正在拖动事件
    private allDayDragState: {
        draggedEvent: any;
        targetEvent: { id: string; el: HTMLElement } | null;
        isAbove: boolean;
        date: string;
        isLocked?: boolean;
    } | null = null;
    private allDayDragListener: ((e: MouseEvent) => void) | null = null;
    private isAllDayReordering: boolean = false; // 标记是否正在处理全天重排序

    // 全天事件区域调整相关
    private allDayHeight: number = 200;
    private isResizingAllDay: boolean = false;
    private startResizeY: number = 0;
    private startResizeHeight: number = 0;

    // 性能优化：颜色缓存
    private colorCache: Map<string, { backgroundColor: string; borderColor: string }> = new Map();
    private lastNavigatedToTodayAt: number = 0; // 记录最后一次点击"今天"的时间

    // 视图按钮引用
    private monthBtn: HTMLButtonElement;
    private weekBtn: HTMLButtonElement;
    private dayBtn: HTMLButtonElement;
    private yearBtn: HTMLButtonElement;
    private multiDaysBtn: HTMLButtonElement;
    private viewTypeButton: HTMLButtonElement;


    // 使用全局番茄钟管理器
    private pomodoroManager: PomodoroManager = PomodoroManager.getInstance();
    private pomodoroRecordManager: PomodoroRecordManager;
    private lute: any; // Markdown 渲染器

    private async updateSettings() {
        const settings = await this.plugin.loadSettings();
        this.showCategoryAndProject = settings.calendarShowCategoryAndProject !== false;
        this.showLunar = settings.calendarShowLunar !== false;
        this.showHoliday = settings.calendarShowHoliday !== false;
        this.showPomodoro = settings.calendarShowPomodoro;

        if (this.calendarConfigManager) {
            await this.calendarConfigManager.initialize();
            this.colorBy = this.calendarConfigManager.getColorBy();
            this.showCrossDayTasks = this.calendarConfigManager.getShowCrossDayTasks();
            this.crossDayThreshold = this.calendarConfigManager.getCrossDayThreshold();
            this.showSubtasks = this.calendarConfigManager.getShowSubtasks();
            this.showRepeatTasks = this.calendarConfigManager.getShowRepeatTasks();
            this.repeatInstanceLimit = this.calendarConfigManager.getRepeatInstanceLimit();
            this.showHiddenTasks = this.calendarConfigManager.getShowHiddenTasks();
            this.showPomodoro = this.calendarConfigManager.getShowPomodoro();

            try {
                this.currentCompletionFilter = this.calendarConfigManager.getCompletionFilter();
            } catch (e) {
                this.currentCompletionFilter = 'all';
            }
        }

        const weekStartDay = await this.getWeekStartDay();
        const dayStartTime = await this.getDayStartTime();
        const todayStartTime = await this.getTodayStartTime();
        const slotMaxTime = this.calculateSlotMaxTime(todayStartTime);

        this.calendar.setOption('firstDay', weekStartDay);
        this.calendar.setOption('slotMinTime', todayStartTime);
        this.calendar.setOption('slotMaxTime', slotMaxTime);
        this.calendar.setOption('scrollTime', dayStartTime);
        this.calendar.setOption('nextDayThreshold', todayStartTime);

        // 尝试即时滚动到新的一天起始时间
        try {
            this.calendar.scrollToTime(dayStartTime);
        } catch (e) {
            // ignore
        }

        // 更新视图类型按钮文本
        if (this.viewTypeButton && this.calendarConfigManager) {
            const currentViewType = this.calendarConfigManager.getViewType();
            const viewTypeOptions = [
                { value: 'timeline', text: i18n("viewTypeTimeline") },
                { value: 'kanban', text: i18n("viewTypeKanban") },
                { value: 'list', text: i18n("viewTypeList") }
            ];
            const currentViewTypeText = viewTypeOptions.find(opt => opt.value === currentViewType)?.text;
            if (currentViewTypeText) {
                const textSpan = this.viewTypeButton.querySelector('.filter-button-text');
                if (textSpan) {
                    textSpan.textContent = currentViewTypeText;
                }
            }

            // 同步视图模式
            const savedViewMode = this.calendarConfigManager.getViewMode();
            if (this.calendar.view.type !== savedViewMode) {
                this.calendar.changeView(savedViewMode);
                this.updateViewButtonStates();
                this.updatePomodoroButtonVisibility();
            }
        }

        // 刷新事件
        await this.refreshEvents();

        // 解决 FC v6 的重绘问题：仅仅 render() 或 changeView() 同类型视图可能不会销毁并重建 DOM
        // 通过切换一个结构性选项（如 dayHeaders）并切回来，可以强制它完全重建内部网格，从而触发 Mount 钩子
        const hasHeaders = this.calendar.getOption('dayHeaders');
        this.calendar.setOption('dayHeaders', !hasHeaders);
        this.calendar.setOption('dayHeaders', hasHeaders);

        // 额外强制执行一次 render
        this.calendar.render();

        if (this.isCalendarVisible()) {
            this.calendar.updateSize();
        }
        this.checkVip();
    }

    constructor(container: HTMLElement, plugin: any, data?: { projectFilter?: string }) {
        this.container = container;
        this.plugin = plugin;
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(plugin);
        this.categoryManager = CategoryManager.getInstance(plugin); // 初始化分类管理器
        this.projectManager = ProjectManager.getInstance(this.plugin);
        this.statusManager = StatusManager.getInstance(plugin);
        this.calendarConfigManager = CalendarConfigManager.getInstance(this.plugin);
        this.taskSummaryDialog = new TaskSummaryDialog(undefined, plugin);
        if (data?.projectFilter) {
            this.initialProjectFilter = data.projectFilter;
        }

        // 初始化 Lute
        try {
            if ((window as any).Lute) {
                this.lute = (window as any).Lute.New();
            }
        } catch (e) {
            console.error('初始化 Lute 失败:', e);
        }

        this.initUI();
    }

    private handleViewDidMount(arg: any) {
        // 只在时间网格视图（周/日/多天）中处理全天事件区域
        if (arg.view.type.startsWith('timeGrid')) {
            this.setupAllDayResizer(arg.el);
        }
    }

    private checkVip() {
        const isVip = VipManager.isVip(this.plugin);
        const overlay = this.container.querySelector('.vip-mask-overlay');
        const prompt = this.container.querySelector('.vip-upgrade-prompt');

        if (isVip) {
            if (overlay) overlay.remove();
            if (prompt) prompt.remove();
            return;
        }

        // 显示遮罩层和升级提示
        this.showVipUpgradePrompt();
    }

    private showVipUpgradePrompt() {
        this.container.style.position = 'relative';

        // 1. 透明遮罩层，阻断所有点击
        let overlay = this.container.querySelector('.vip-mask-overlay') as HTMLElement;
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'vip-mask-overlay';
            overlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(255, 255, 255, 0.01);
                z-index: 10;
                cursor: not-allowed;
            `;
            this.container.appendChild(overlay);
        }

        // 2. 居中的升级提示卡片
        let prompt = this.container.querySelector('.vip-upgrade-prompt') as HTMLElement;
        if (!prompt) {
            prompt = document.createElement('div');
            prompt.className = 'vip-upgrade-prompt';
            prompt.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: var(--b3-theme-surface);
                color: var(--b3-theme-on-surface);
                padding: 24px 40px;
                border-radius: 12px;
                box-shadow: var(--b3-dialog-shadow);
                border: 1px solid var(--b3-theme-primary-light);
                z-index: 10;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
                cursor: pointer;
                transition: transform 0.2s ease;
            `;
            prompt.innerHTML = `
                <div style="font-size: 40px;">👑</div>
                <div style="font-weight: bold; font-size: 18px; color: var(--b3-theme-primary);">
                    ${i18n('vipOnlyFeature') || '此功能仅限 VIP 用户使用'}
                </div>
                <div style="font-size: 14px; opacity: 0.8; text-align: center;">
                    ${i18n('upgradeToVipTip') || '升级到 VIP 以解锁更多高级功能，让任务管理更高效'}
                </div>
                <button class="b3-button b3-button--text" style="padding: 8px 24px; font-weight: bold;">
                    ${i18n('upgradeNow') || '立即升级'}
                </button>
            `;

            prompt.addEventListener('mouseenter', () => {
                prompt.style.transform = 'translate(-50%, -52%)';
            });
            prompt.addEventListener('mouseleave', () => {
                prompt.style.transform = 'translate(-50%, -50%)';
            });
            prompt.addEventListener('click', () => {
                if (this.plugin && typeof this.plugin.openVipDialog === 'function') {
                    this.plugin.openVipDialog();
                }
            });
            this.container.appendChild(prompt);
        }
    }

    private setupAllDayResizer(el: HTMLElement) {
        // 查找包含 all-day daygrid 的 row
        const allDayBody = el.querySelector('.fc-daygrid-body');
        if (!allDayBody) return;

        // 向上查找 wrapper
        // 结构: tr.fc-scrollgrid-section > td > div.fc-scroller-harness > div.fc-scroller > div.fc-daygrid-body
        const scroller = allDayBody.closest('.fc-scroller') as HTMLElement;
        const harness = allDayBody.closest('.fc-scroller-harness') as HTMLElement;

        if (scroller && harness) {
            harness.classList.add('fc-allday-resizable-container');

            // 应用当前高度设置
            scroller.style.maxHeight = `${this.allDayHeight}px`;

            // 检查是否已存在调整手柄
            if (harness.querySelector('.fc-allday-resizer')) return;

            const resizer = document.createElement('div');
            resizer.className = 'fc-allday-resizer';
            resizer.title = i18n("dragToResize") || "拖动调整高度";
            harness.appendChild(resizer);

            resizer.addEventListener('mousedown', (e: MouseEvent) => {
                e.stopPropagation(); // 防止触发 FC 的点击日期事件
                e.preventDefault();  // 防止选择文本

                this.isResizingAllDay = true;
                this.startResizeY = e.clientY;

                // 获取当前计算后的最大高度，如果没有设置过 max-height，则可能需要获取 offsetHeight 或默认值
                // 这里我们主要控制 maxHeight
                const currentStyle = window.getComputedStyle(scroller);
                const currentMaxHeight = parseInt(currentStyle.maxHeight);
                // 如果是 none 或无效值，使用当前实际高度作为起点，或者默认值
                if (isNaN(currentMaxHeight)) {
                    this.startResizeHeight = scroller.offsetHeight;
                } else {
                    this.startResizeHeight = currentMaxHeight;
                }

                resizer.classList.add('resizing');
                document.body.style.cursor = 'row-resize';

                const moveHandler = (moveEvent: MouseEvent) => {
                    if (!this.isResizingAllDay) return;

                    const delta = moveEvent.clientY - this.startResizeY;
                    const newHeight = Math.max(60, this.startResizeHeight + delta); // 最小高度 60px

                    this.allDayHeight = newHeight;
                    scroller.style.maxHeight = `${newHeight}px`;

                    // 强制 fullcalendar 更新一下布局尺寸（如果需要）
                    // view.calendar.updateSize(); // 可能导致重绘闪烁，暂时只要 CSS 生效即可
                };

                const upHandler = () => {
                    this.isResizingAllDay = false;
                    resizer.classList.remove('resizing');
                    document.body.style.cursor = '';

                    document.removeEventListener('mousemove', moveHandler);
                    document.removeEventListener('mouseup', upHandler);
                };

                document.addEventListener('mousemove', moveHandler);
                document.addEventListener('mouseup', upHandler);
            });
        }
    }

    private async initUI() {
        // 初始化分类管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize();
        await this.statusManager.initialize();
        await this.calendarConfigManager.initialize();

        if (this.initialProjectFilter) {
            this.currentProjectFilter = new Set([this.initialProjectFilter]);
            this.currentCategoryFilter = new Set(['all']);
        }

        // 从配置中读取colorBy和viewMode设置
        this.colorBy = this.calendarConfigManager.getColorBy();
        const settings = await this.plugin.loadSettings();
        this.showCategoryAndProject = settings.calendarShowCategoryAndProject !== false;
        this.showLunar = this.calendarConfigManager.getShowLunar();
        this.showHoliday = settings.calendarShowHoliday !== false;
        this.showPomodoro = this.calendarConfigManager.getShowPomodoro(); // Use config manager for pomodoro state
        this.showCrossDayTasks = this.calendarConfigManager.getShowCrossDayTasks();
        this.crossDayThreshold = this.calendarConfigManager.getCrossDayThreshold();
        this.showSubtasks = this.calendarConfigManager.getShowSubtasks();
        this.showRepeatTasks = this.calendarConfigManager.getShowRepeatTasks();
        this.repeatInstanceLimit = this.calendarConfigManager.getRepeatInstanceLimit();
        this.showHiddenTasks = this.calendarConfigManager.getShowHiddenTasks();
        this.holidays = await loadHolidays(this.plugin);

        // 获取周开始日设置
        const weekStartDay = await this.getWeekStartDay();

        // 获取日历视图滚动位置（dayStartTime）
        const dayStartTime = await this.getDayStartTime();

        // 获取逻辑一天起始时间（todayStartTime）
        const todayStartTime = await this.getTodayStartTime();
        const slotMaxTime = this.calculateSlotMaxTime(todayStartTime);

        this.container.classList.add('reminder-calendar-view');

        // 注入自定义样式，强制修正 FullCalendar 的顶部布局
        const style = document.createElement('style');
        style.textContent = `
            .reminder-calendar-view .fc-daygrid-day-top {
                flex-direction: row !important;
                justify-content: space-between !important;
                padding-right: 4px !important;
            }
            .reminder-calendar-view .fc-daygrid-day-number {
                width: auto !important;
                text-decoration: none !important;
                padding: 4px !important;
                z-index: 2;
            }
        `;
        this.container.appendChild(style);

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'reminder-calendar-toolbar';
        this.container.appendChild(toolbar);



        // 视图切换按钮
        const viewGroup = document.createElement('div');
        viewGroup.className = 'reminder-calendar-view-group';
        toolbar.appendChild(viewGroup);
        this.yearBtn = document.createElement('button');
        this.yearBtn.className = 'b3-button b3-button--outline';
        this.yearBtn.textContent = i18n("year");
        this.yearBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            let viewMode: string;
            if (viewType === 'list') {
                viewMode = 'listYear';
            } else {
                // timeline and kanban both use multiMonthYear
                viewMode = 'multiMonthYear';
            }
            await this.calendarConfigManager.setViewMode(viewMode as any);
            this.calendar.changeView(viewMode);
            this.updateViewButtonStates();
            this.updatePomodoroButtonVisibility();
        });
        viewGroup.appendChild(this.yearBtn);
        this.monthBtn = document.createElement('button');
        this.monthBtn.className = 'b3-button b3-button--outline';
        this.monthBtn.textContent = i18n("month");
        this.monthBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            let viewMode: string;
            if (viewType === 'list') {
                viewMode = 'listMonth';
            } else {
                // timeline and kanban both use dayGridMonth
                viewMode = 'dayGridMonth';
            }
            await this.calendarConfigManager.setViewMode(viewMode as any);
            this.calendar.changeView(viewMode);
            this.updateViewButtonStates();
            this.updatePomodoroButtonVisibility();
        });
        viewGroup.appendChild(this.monthBtn);

        this.weekBtn = document.createElement('button');
        this.weekBtn.className = 'b3-button b3-button--outline';
        this.weekBtn.textContent = i18n("week");
        this.weekBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            let viewMode: string;
            if (viewType === 'timeline') {
                viewMode = 'timeGridWeek';
            } else if (viewType === 'kanban') {
                viewMode = 'dayGridWeek';
            } else { // list
                viewMode = 'listWeek';
            }
            await this.calendarConfigManager.setViewMode(viewMode as any);
            this.calendar.changeView(viewMode);
            this.updateViewButtonStates();
            this.updatePomodoroButtonVisibility();
        });
        viewGroup.appendChild(this.weekBtn);

        // 多天视图按钮（默认最近7天，今日为第二天）
        this.multiDaysBtn = document.createElement('button');
        this.multiDaysBtn.className = 'b3-button b3-button--outline';
        this.multiDaysBtn.textContent = i18n("multiDays") || "多天";
        this.multiDaysBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            let viewMode: string;
            if (viewType === 'timeline') {
                viewMode = 'timeGridMultiDays7';
            } else if (viewType === 'kanban') {
                viewMode = 'dayGridMultiDays7';
            } else { // list
                viewMode = 'listMultiDays7';
            }

            // 计算多天视图的起始日期（今天的前一天），使今天显示为第二天
            const startDate = getRelativeDateString(-1);

            await this.calendarConfigManager.setViewMode(viewMode as any);
            this.calendar.changeView(viewMode, startDate);
            this.updateViewButtonStates();
            this.updatePomodoroButtonVisibility();
        });
        viewGroup.appendChild(this.multiDaysBtn);

        this.dayBtn = document.createElement('button');
        this.dayBtn.className = 'b3-button b3-button--outline';
        this.dayBtn.textContent = i18n("day");
        this.dayBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            let viewMode: string;
            if (viewType === 'timeline') {
                viewMode = 'timeGridDay';
            } else if (viewType === 'kanban') {
                viewMode = 'dayGridDay';
            } else { // list
                viewMode = 'listDay';
            }
            await this.calendarConfigManager.setViewMode(viewMode as any);
            this.calendar.changeView(viewMode);
            this.updateViewButtonStates();
            this.updatePomodoroButtonVisibility();
        });
        viewGroup.appendChild(this.dayBtn);



        // 添加视图类型下拉框（按钮样式）
        const viewTypeContainer = document.createElement('div');
        viewTypeContainer.className = 'filter-dropdown-container';
        viewTypeContainer.style.position = 'relative';
        viewTypeContainer.style.display = 'inline-block';
        viewTypeContainer.style.marginLeft = '8px';

        const currentViewType = this.calendarConfigManager.getViewType();
        const viewTypeOptions = [
            { value: 'timeline', text: i18n("viewTypeTimeline") },
            { value: 'kanban', text: i18n("viewTypeKanban") },
            { value: 'list', text: i18n("viewTypeList") }
        ];

        const currentViewTypeText = viewTypeOptions.find(opt => opt.value === currentViewType)?.text || i18n("viewTypeTimeline");

        this.viewTypeButton = document.createElement('button');
        this.viewTypeButton.className = 'b3-button b3-button--outline';
        this.viewTypeButton.style.width = '80px';
        this.viewTypeButton.style.display = 'flex';
        this.viewTypeButton.style.justifyContent = 'space-between';
        this.viewTypeButton.style.alignItems = 'center';
        this.viewTypeButton.style.textAlign = 'left';
        this.viewTypeButton.innerHTML = `<span class="filter-button-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${currentViewTypeText}</span> <span style="margin-left: 4px; flex-shrink: 0;">▼</span>`;
        viewTypeContainer.appendChild(this.viewTypeButton);

        const viewTypeDropdown = document.createElement('div');
        viewTypeDropdown.className = 'filter-dropdown-menu';
        viewTypeDropdown.style.display = 'none';
        viewTypeDropdown.style.position = 'absolute';
        viewTypeDropdown.style.top = '100%';
        viewTypeDropdown.style.left = '0';
        viewTypeDropdown.style.zIndex = '1000';
        viewTypeDropdown.style.backgroundColor = 'var(--b3-theme-background)';
        viewTypeDropdown.style.border = '1px solid var(--b3-border-color)';
        viewTypeDropdown.style.borderRadius = '4px';
        viewTypeDropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        viewTypeDropdown.style.minWidth = '150px';
        viewTypeDropdown.style.padding = '8px';

        viewTypeOptions.forEach(option => {
            const optionItem = document.createElement('div');
            optionItem.style.padding = '6px 12px';
            optionItem.style.cursor = 'pointer';
            optionItem.style.borderRadius = '4px';
            optionItem.textContent = option.text;

            optionItem.addEventListener('click', async (e) => {
                e.stopPropagation();
                const selectedViewType = option.value as 'timeline' | 'kanban' | 'list';
                const currentViewMode = this.calendarConfigManager.getViewMode();

                // Determine the new view mode based on current view mode and new view type
                let newViewMode: string;

                // Extract the time period from current view mode (year, month, week, day)
                if (currentViewMode === 'multiMonthYear') {
                    // 对于年视图，按选中的 viewType 决定是保留 timeline/kanban 还是切换为 listYear
                    if (selectedViewType === 'list') {
                        newViewMode = 'listYear';
                    } else {
                        newViewMode = 'multiMonthYear';
                    }
                } else if (currentViewMode === 'dayGridMonth') {
                    // 对于月视图，按选中的 viewType 决定是保留 dayGridMonth 还是切换为 listMonth
                    if (selectedViewType === 'list') {
                        newViewMode = 'listMonth';
                    } else {
                        newViewMode = 'dayGridMonth';
                    }
                } else if (currentViewMode.includes('Week')) {
                    // Week view
                    if (selectedViewType === 'timeline') {
                        newViewMode = 'timeGridWeek';
                    } else if (selectedViewType === 'kanban') {
                        newViewMode = 'dayGridWeek';
                    } else { // list
                        newViewMode = 'listWeek';
                    }
                } else if (currentViewMode.includes('MultiDays')) {
                    // Multi-days (7) view
                    if (selectedViewType === 'timeline') {
                        newViewMode = 'timeGridMultiDays7';
                    } else if (selectedViewType === 'kanban') {
                        newViewMode = 'dayGridMultiDays7';
                    } else { // list
                        newViewMode = 'listMultiDays7';
                    }
                } else if (currentViewMode.includes('Day')) {
                    // Day view
                    if (selectedViewType === 'timeline') {
                        newViewMode = 'timeGridDay';
                    } else if (selectedViewType === 'kanban') {
                        newViewMode = 'dayGridDay';
                    } else { // list
                        newViewMode = 'listDay';
                    }
                } else if (currentViewMode.includes('Month')) {
                    // List month view
                    if (selectedViewType === 'list') {
                        newViewMode = 'listMonth';
                    } else {
                        newViewMode = 'dayGridMonth';
                    }
                } else if (currentViewMode.includes('Year')) {
                    // List year view
                    if (selectedViewType === 'list') {
                        newViewMode = 'listYear';
                    } else {
                        newViewMode = 'multiMonthYear';
                    }
                } else {
                    // Default to week view
                    if (selectedViewType === 'timeline') {
                        newViewMode = 'timeGridWeek';
                    } else if (selectedViewType === 'kanban') {
                        newViewMode = 'dayGridWeek';
                    } else { // list
                        newViewMode = 'listWeek';
                    }
                }

                await this.calendarConfigManager.setViewType(selectedViewType);
                await this.calendarConfigManager.setViewMode(newViewMode as any);
                this.calendar.changeView(newViewMode);
                this.updateViewButtonStates();
                this.updatePomodoroButtonVisibility();

                const textSpan = this.viewTypeButton.querySelector('.filter-button-text');
                if (textSpan) {
                    textSpan.textContent = option.text;
                }
                viewTypeDropdown.style.display = 'none';
            });

            viewTypeDropdown.appendChild(optionItem);
        });

        viewTypeContainer.appendChild(viewTypeDropdown);
        // Create Pomodoro toggle button
        this.pomodoroToggleBtn = document.createElement('button');
        this.pomodoroToggleBtn.className = 'b3-button b3-button--outline';
        this.pomodoroToggleBtn.style.padding = '4px 8px';
        this.pomodoroToggleBtn.style.marginRight = '8px';
        this.pomodoroToggleBtn.style.display = 'none'; // Initially hidden, logic controls visibility based on view
        this.pomodoroToggleBtn.innerHTML = '🍅';
        this.pomodoroToggleBtn.title = i18n("togglePomodoroRecords") || "显示/隐藏番茄专注记录";
        this.pomodoroToggleBtn.onclick = async () => {
            this.showPomodoro = !this.showPomodoro;
            await this.calendarConfigManager.setShowPomodoro(this.showPomodoro);
            this.updatePomodoroButtonState();
            this.refreshEvents();
        };
        viewGroup.appendChild(viewTypeContainer);
        viewGroup.appendChild(this.pomodoroToggleBtn);


        // 初始化按钮状态
        this.updatePomodoroButtonState();

        // 添加统一过滤器
        const filterGroup = document.createElement('div');
        filterGroup.className = 'reminder-calendar-filter-group';
        filterGroup.style.display = 'flex';
        filterGroup.style.alignItems = 'center';
        filterGroup.style.flexWrap = 'wrap';
        filterGroup.style.gap = '8px';
        toolbar.appendChild(filterGroup);

        // 筛选图标
        const filterIcon = document.createElement('span');
        filterIcon.innerHTML = '<svg style="width: 14px; height: 14px; margin-right: 4px; vertical-align: middle;"><use xlink:href="#iconFilter"></use></svg>';
        filterIcon.style.color = 'var(--b3-theme-on-surface-light)';
        filterGroup.appendChild(filterIcon);

        // 创建项目筛选容器（带下拉菜单）
        const projectFilterContainer = document.createElement('div');
        projectFilterContainer.className = 'filter-dropdown-container';
        projectFilterContainer.style.position = 'relative';
        projectFilterContainer.style.display = 'inline-block';

        const projectFilterButton = document.createElement('button');
        projectFilterButton.className = 'b3-button b3-button--outline';
        projectFilterButton.style.width = '100px';
        projectFilterButton.style.display = 'flex';
        projectFilterButton.style.justifyContent = 'space-between';
        projectFilterButton.style.alignItems = 'center';
        projectFilterButton.style.textAlign = 'left';
        projectFilterButton.innerHTML = `<span class="filter-button-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${i18n("allProjects") || "全部项目"}</span> <span style="margin-left: 4px; flex-shrink: 0;">▼</span>`;
        projectFilterContainer.appendChild(projectFilterButton);

        const projectDropdown = document.createElement('div');
        projectDropdown.className = 'filter-dropdown-menu';
        projectDropdown.style.display = 'none';
        projectDropdown.style.position = 'absolute';
        projectDropdown.style.top = '100%';
        projectDropdown.style.left = '0';
        projectDropdown.style.zIndex = '1000';
        projectDropdown.style.backgroundColor = 'var(--b3-theme-background)';
        projectDropdown.style.border = '1px solid var(--b3-border-color)';
        projectDropdown.style.borderRadius = '4px';
        projectDropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        projectDropdown.style.minWidth = '200px';
        projectDropdown.style.maxHeight = '400px';
        projectDropdown.style.overflowY = 'auto';
        projectDropdown.style.padding = '8px';
        projectFilterContainer.appendChild(projectDropdown);

        filterGroup.appendChild(projectFilterContainer);

        // 创建分类筛选容器（带下拉菜单）
        const categoryFilterContainer = document.createElement('div');
        categoryFilterContainer.className = 'filter-dropdown-container';
        categoryFilterContainer.style.position = 'relative';
        categoryFilterContainer.style.display = 'inline-block';

        const categoryFilterButton = document.createElement('button');
        categoryFilterButton.className = 'b3-button b3-button--outline';
        categoryFilterButton.style.width = '100px';
        categoryFilterButton.style.display = 'flex';
        categoryFilterButton.style.justifyContent = 'space-between';
        categoryFilterButton.style.alignItems = 'center';
        categoryFilterButton.style.textAlign = 'left';
        categoryFilterButton.innerHTML = `<span class="filter-button-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${i18n("allCategories") || "全部分类"}</span> <span style="margin-left: 4px; flex-shrink: 0;">▼</span>`;
        categoryFilterContainer.appendChild(categoryFilterButton);

        const categoryDropdown = document.createElement('div');
        categoryDropdown.className = 'filter-dropdown-menu';
        categoryDropdown.style.display = 'none';
        categoryDropdown.style.position = 'absolute';
        categoryDropdown.style.top = '100%';
        categoryDropdown.style.left = '0';
        categoryDropdown.style.zIndex = '1000';
        categoryDropdown.style.backgroundColor = 'var(--b3-theme-background)';
        categoryDropdown.style.border = '1px solid var(--b3-border-color)';
        categoryDropdown.style.borderRadius = '4px';
        categoryDropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        categoryDropdown.style.minWidth = '200px';
        categoryDropdown.style.maxHeight = '400px';
        categoryDropdown.style.overflowY = 'auto';
        categoryDropdown.style.padding = '8px';
        categoryFilterContainer.appendChild(categoryDropdown);

        filterGroup.appendChild(categoryFilterContainer);



        // 渲染项目和分类筛选器
        await this.renderProjectFilterCheckboxes(projectDropdown, projectFilterButton);
        await this.renderCategoryFilterCheckboxes(categoryDropdown, categoryFilterButton);

        if (this.initialProjectFilter) {
            this.updateProjectFilterButtonText(projectFilterButton);
        }


        // 添加显示设置按钮
        const displaySettingsContainer = document.createElement('div');
        displaySettingsContainer.className = 'filter-dropdown-container';
        displaySettingsContainer.style.position = 'relative';
        displaySettingsContainer.style.display = 'inline-block';

        const displaySettingsButton = document.createElement('button');
        displaySettingsButton.className = 'b3-button b3-button--outline';
        displaySettingsButton.style.padding = '6px';
        displaySettingsButton.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconEye"></use></svg>';
        displaySettingsButton.title = i18n("displaySettings") || "显示设置";
        displaySettingsContainer.appendChild(displaySettingsButton);

        const displaySettingsDropdown = document.createElement('div');
        displaySettingsDropdown.className = 'filter-dropdown-menu';
        displaySettingsDropdown.style.display = 'none';
        displaySettingsDropdown.style.position = 'absolute';
        displaySettingsDropdown.style.top = '100%';
        displaySettingsDropdown.style.right = '0';
        displaySettingsDropdown.style.zIndex = '1000';
        displaySettingsDropdown.style.backgroundColor = 'var(--b3-theme-background)';
        displaySettingsDropdown.style.border = '1px solid var(--b3-border-color)';
        displaySettingsDropdown.style.borderRadius = '4px';
        displaySettingsDropdown.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
        displaySettingsDropdown.style.minWidth = '220px';
        displaySettingsDropdown.style.padding = '8px';

        const createSwitchItem = (label: string, value: boolean, onChange: (checked: boolean) => void) => {
            const item = document.createElement('div');
            item.className = 'fn__flex fn__flex-center';
            item.style.padding = '6px 12px';
            item.style.gap = '8px';
            item.innerHTML = `
                <div class="fn__flex-1">${label}</div>
                <input class="b3-switch" type="checkbox" ${value ? 'checked' : ''}>
            `;
            const checkbox = item.querySelector('input') as HTMLInputElement;
            checkbox.addEventListener('change', () => onChange(checkbox.checked));
            return item;
        };

        // 跨天任务设置
        displaySettingsDropdown.appendChild(createSwitchItem(i18n("showCrossDayTasks") || "显示跨天任务", this.showCrossDayTasks, async (checked) => {
            this.showCrossDayTasks = checked;
            await this.calendarConfigManager.setShowCrossDayTasks(checked);
            await this.refreshEvents();
        }));

        const thresholdItem = document.createElement('div');
        thresholdItem.className = 'fn__flex-column';
        thresholdItem.style.padding = '6px 12px';
        thresholdItem.style.marginLeft = '20px';
        thresholdItem.innerHTML = `
            <div class="fn__flex fn__flex-center" style="gap: 8px;">
                <input class="b3-text-field fn__flex-1" type="number" value="${this.crossDayThreshold}" min="-1" style="width: 50px;">
                <div>${i18n("crossDayThreshold") || "天及以下显示"}</div>
            </div>
            <div style="font-size: 0.8em; color: var(--b3-theme-on-surface-light); margin-top: 4px;">(-1${i18n("noLimit") || "表示不限制"})</div>
        `;
        const thresholdInput = thresholdItem.querySelector('input') as HTMLInputElement;
        thresholdInput.addEventListener('change', async () => {
            this.crossDayThreshold = parseInt(thresholdInput.value);
            if (isNaN(this.crossDayThreshold)) this.crossDayThreshold = -1;
            await this.calendarConfigManager.setCrossDayThreshold(this.crossDayThreshold);
            await this.refreshEvents();
        });
        displaySettingsDropdown.appendChild(thresholdItem);

        // 子任务设置
        displaySettingsDropdown.appendChild(createSwitchItem(i18n("showSubtasks") || "显示子任务", this.showSubtasks, async (checked) => {
            this.showSubtasks = checked;
            await this.calendarConfigManager.setShowSubtasks(checked);
            await this.refreshEvents();
        }));

        // 重复任务设置
        displaySettingsDropdown.appendChild(createSwitchItem(i18n("showRepeatTasks") || "显示重复任务", this.showRepeatTasks, async (checked) => {
            this.showRepeatTasks = checked;
            await this.calendarConfigManager.setShowRepeatTasks(checked);
            await this.refreshEvents();
        }));

        const repeatLimitItem = document.createElement('div');
        repeatLimitItem.className = 'fn__flex-column';
        repeatLimitItem.style.padding = '6px 12px';
        repeatLimitItem.style.marginLeft = '20px';
        repeatLimitItem.innerHTML = `
            <div class="fn__flex fn__flex-center" style="gap: 8px;">
                <div>${i18n("show") || "显示"}</div>
                <input class="b3-text-field fn__flex-1" type="number" value="${this.repeatInstanceLimit}" min="-1" style="width: 50px;">
                <div>${i18n("instances") || "个实例"}</div>
            </div>
            <div style="font-size: 0.8em; color: var(--b3-theme-on-surface-light); margin-top: 4px;">(-1${i18n("noLimit") || "表示不限制"})</div>
        `;
        const repeatLimitInput = repeatLimitItem.querySelector('input') as HTMLInputElement;
        repeatLimitInput.addEventListener('change', async () => {
            this.repeatInstanceLimit = parseInt(repeatLimitInput.value);
            if (isNaN(this.repeatInstanceLimit)) this.repeatInstanceLimit = -1;
            await this.calendarConfigManager.setRepeatInstanceLimit(this.repeatInstanceLimit);
            await this.refreshEvents();
        });
        displaySettingsDropdown.appendChild(repeatLimitItem);

        // 番茄专注设置
        displaySettingsDropdown.appendChild(createSwitchItem(i18n("showPomodoroRecords") || "显示番茄专注", this.showPomodoro, async (checked) => {
            this.showPomodoro = checked;
            await this.calendarConfigManager.setShowPomodoro(checked);
            this.updatePomodoroButtonState();
            await this.refreshEvents();
        }));

        // 隐藏任务设置（强制显示标记为不在日历显示的任务）
        displaySettingsDropdown.appendChild(createSwitchItem(i18n("showHiddenTasks") || "显示不在日历视图显示的任务", this.showHiddenTasks, async (checked) => {
            this.showHiddenTasks = checked;
            await this.calendarConfigManager.setShowHiddenTasks(checked);
            await this.refreshEvents();
        }));

        // 上色方案设置
        const colorDivider = document.createElement('div');
        colorDivider.style.height = '1px';
        colorDivider.style.backgroundColor = 'var(--b3-border-color)';
        colorDivider.style.margin = '8px 0';
        displaySettingsDropdown.appendChild(colorDivider);

        const colorLabel = document.createElement('div');
        colorLabel.style.padding = '4px 12px';
        colorLabel.style.fontSize = '0.9em';
        colorLabel.style.color = 'var(--b3-theme-on-surface-light)';
        colorLabel.innerText = i18n("colorScheme") || "任务上色方案";
        displaySettingsDropdown.appendChild(colorLabel);

        const colorGroup = document.createElement('div');
        colorGroup.className = 'fn__flex fn__flex-center';
        colorGroup.style.padding = '4px 8px';
        colorGroup.style.gap = '4px';

        const createColorBtn = (label: string, value: 'category' | 'priority' | 'project') => {
            const btn = document.createElement('button');
            btn.className = `b3-button b3-button--small ${this.colorBy === value ? '' : 'b3-button--outline'}`;
            btn.style.flex = '1';
            btn.innerText = label;
            btn.addEventListener('click', async () => {
                this.colorBy = value;
                await this.calendarConfigManager.setColorBy(this.colorBy);
                // 更新下拉菜单中的按钮状态
                Array.from(colorGroup.querySelectorAll('button')).forEach(b => b.classList.add('b3-button--outline'));
                btn.classList.remove('b3-button--outline');
                // 清除颜色缓存并刷新
                this.colorCache.clear();
                await this.refreshEvents();
            });
            return btn;
        };

        colorGroup.appendChild(createColorBtn(i18n("colorByPriority") || "优先级", 'priority'));
        colorGroup.appendChild(createColorBtn(i18n("colorByCategory") || "分类", 'category'));
        colorGroup.appendChild(createColorBtn(i18n("colorByProject") || "项目", 'project'));
        displaySettingsDropdown.appendChild(colorGroup);

        // 任务状态设置
        const statusDivider = document.createElement('div');
        statusDivider.style.height = '1px';
        statusDivider.style.backgroundColor = 'var(--b3-border-color)';
        statusDivider.style.margin = '8px 0';
        displaySettingsDropdown.appendChild(statusDivider);

        const statusLabel = document.createElement('div');
        statusLabel.style.padding = '4px 12px';
        statusLabel.style.fontSize = '0.9em';
        statusLabel.style.color = 'var(--b3-theme-on-surface-light)';
        statusLabel.innerText = "任务状态过滤";
        displaySettingsDropdown.appendChild(statusLabel);

        const statusGroup = document.createElement('div');
        statusGroup.className = 'fn__flex fn__flex-center';
        statusGroup.style.padding = '4px 8px';
        statusGroup.style.gap = '4px';

        const createStatusBtn = (label: string, value: 'all' | 'completed' | 'incomplete') => {
            const btn = document.createElement('button');
            btn.className = `b3-button b3-button--small ${this.currentCompletionFilter === value ? '' : 'b3-button--outline'}`;
            btn.style.flex = '1';
            btn.innerText = label;
            btn.addEventListener('click', async () => {
                this.currentCompletionFilter = value;
                await this.calendarConfigManager.setCompletionFilter(value);
                // 更新下拉菜单中的按钮状态
                Array.from(statusGroup.querySelectorAll('button')).forEach(b => b.classList.add('b3-button--outline'));
                btn.classList.remove('b3-button--outline');
                await this.refreshEvents();
            });
            return btn;
        };

        statusGroup.appendChild(createStatusBtn(i18n("all") || "全部", 'all'));
        statusGroup.appendChild(createStatusBtn(i18n("completed") || "已完成", 'completed'));
        statusGroup.appendChild(createStatusBtn(i18n("uncompleted") || "未完成", 'incomplete'));
        displaySettingsDropdown.appendChild(statusGroup);

        displaySettingsContainer.appendChild(displaySettingsDropdown);
        filterGroup.appendChild(displaySettingsContainer);

        displaySettingsButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = displaySettingsDropdown.style.display === 'block';
            displaySettingsDropdown.style.display = isVisible ? 'none' : 'block';
            projectDropdown.style.display = isVisible ? 'none' : 'none'; // Ensure others hide
            if (!isVisible) {
                projectDropdown.style.display = 'none';
                categoryDropdown.style.display = 'none';
                viewTypeDropdown.style.display = 'none';
            }
        });

        // 更新原有的下拉菜单关闭逻辑
        // 更新项目的点击事件
        projectFilterButton.onclick = null;
        projectFilterButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = projectDropdown.style.display === 'block';
            projectDropdown.style.display = isVisible ? 'none' : 'block';
            categoryDropdown.style.display = 'none';
            viewTypeDropdown.style.display = 'none';
            displaySettingsDropdown.style.display = 'none';
        });

        categoryFilterButton.onclick = null;
        categoryFilterButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = categoryDropdown.style.display === 'block';
            categoryDropdown.style.display = isVisible ? 'none' : 'block';
            projectDropdown.style.display = 'none';
            viewTypeDropdown.style.display = 'none';
            displaySettingsDropdown.style.display = 'none';
        });

        // 更新视图类型按钮的点击事件
        this.viewTypeButton.onclick = null;
        this.viewTypeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = viewTypeDropdown.style.display === 'block';
            viewTypeDropdown.style.display = isVisible ? 'none' : 'block';
            projectDropdown.style.display = 'none';
            categoryDropdown.style.display = 'none';
            displaySettingsDropdown.style.display = 'none';
        });

        // 点击外部关闭所有下拉菜单
        document.addEventListener('click', () => {
            projectDropdown.style.display = 'none';
            categoryDropdown.style.display = 'none';
            viewTypeDropdown.style.display = 'none';
            displaySettingsDropdown.style.display = 'none';
        });

        // 防止下拉菜单内部点击触发全局关闭
        projectDropdown.addEventListener('click', (e) => e.stopPropagation());
        categoryDropdown.addEventListener('click', (e) => e.stopPropagation());
        viewTypeDropdown.addEventListener('click', (e) => e.stopPropagation());
        displaySettingsDropdown.addEventListener('click', (e) => e.stopPropagation());


        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.style.padding = '6px';
        refreshBtn.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = i18n("refresh");
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            try {
                showMessage(i18n("refreshing") || "正在刷新...", 500);
                await this.refreshEvents(true);
            } catch (error) {
                console.error('手动刷新失败:', error);
                showMessage(i18n("refreshFailed") || "刷新失败");
            } finally {
                refreshBtn.disabled = false;
            }
        });
        filterGroup.appendChild(refreshBtn);



        // 摘要按钮
        const summaryBtn = document.createElement('button');
        summaryBtn.className = 'b3-button b3-button--outline';
        summaryBtn.style.padding = '6px';
        summaryBtn.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconList"></use></svg>';
        summaryBtn.title = i18n("taskSummary") || "任务摘要";
        summaryBtn.addEventListener('click', () => {
            this.taskSummaryDialog.showTaskSummaryDialog();
        });
        filterGroup.appendChild(summaryBtn);
        // 更多按钮（包含管理分类、项目颜色、插件设置）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.title = i18n('more') || '更多';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.addEventListener('click', (e) => {
            try {
                e.stopPropagation();
                e.preventDefault();
                const menu = new Menu('calendar-more-menu');

                menu.addItem({
                    icon: 'iconTags',
                    label: i18n('manageCategories') || '管理分类',
                    click: () => this.showCategoryManageDialog()
                });

                menu.addItem({
                    icon: 'iconProject',
                    label: i18n('projectColor') || '项目颜色',
                    click: () => this.showProjectColorDialog()
                });

                menu.addItem({
                    icon: 'iconSettings',
                    label: i18n('pluginSettings') || '插件设置',
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

                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                menu.open({ x: rect.right, y: rect.bottom + 4 });
            } catch (err) {
                console.error('打开更多菜单失败:', err);
            }
        });

        filterGroup.appendChild(moreBtn);
        // 创建日历容器
        const calendarEl = document.createElement('div');
        calendarEl.className = 'reminder-calendar-container';
        this.container.appendChild(calendarEl);

        // 初始化日历 - 使用用户设置的周开始日
        const initialViewMode = this.calendarConfigManager.getViewMode();
        const multiDaysStartDate = getRelativeDateString(-1);
        this.calendar = new Calendar(calendarEl, {
            plugins: [dayGridPlugin, timeGridPlugin, multiMonthPlugin, listPlugin, interactionPlugin],
            initialView: initialViewMode,
            initialDate: (initialViewMode && initialViewMode.includes('MultiDays')) ? multiDaysStartDate : getLogicalDateString(),
            views: {
                timeGridMultiDays7: { type: 'timeGrid', duration: { days: 7 } },
                dayGridMultiDays7: { type: 'dayGrid', duration: { days: 7 } },
                listMultiDays7: { type: 'list', duration: { days: 7 }, listDayFormat: { weekday: 'short', month: 'numeric', day: 'numeric', omitCommas: true }, listDaySideFormat: false },
                listDay: { listDayFormat: { weekday: 'short', month: 'numeric', day: 'numeric', omitCommas: true }, listDaySideFormat: false },
                listWeek: { listDayFormat: { weekday: 'short', month: 'numeric', day: 'numeric', omitCommas: true }, listDaySideFormat: false },
                listMonth: { listDayFormat: { weekday: 'short', month: 'numeric', day: 'numeric', omitCommas: true }, listDaySideFormat: false },
                listYear: { listDayFormat: { weekday: 'short', month: 'numeric', day: 'numeric', omitCommas: true }, listDaySideFormat: false }
            },
            multiMonthMaxColumns: 1, // force a single column
            headerToolbar: {
                left: 'prev,next myToday jumpTo',
                center: 'title',
                right: ''
            },
            customButtons: {
                myToday: {
                    text: i18n("today"),
                    click: () => {
                        this.lastNavigatedToTodayAt = Date.now();
                        const targetDate = getDayStartAdjustedDate(new Date());
                        this.calendar.gotoDate(targetDate);

                        // 尝试滚动到今天的位置（主要修复 dayGridMonth 不会自动滚动的问题）
                        setTimeout(() => {
                            // 优先查找高亮的今天元素
                            const todayEl = this.container.querySelector('.fc-day-today') ||
                                this.container.querySelector('.fc-today-custom') ||
                                this.container.querySelector(`[data-date="${getLocalDateString(targetDate)}"]`);

                            if (todayEl) {
                                todayEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
                            }
                        }, 100);
                    }
                },
                jumpTo: {
                    text: i18n("jumpToDate") || "跳转到",
                    click: () => {
                        const activeDate = getLocalDateString(this.calendar.getDate());
                        const inputContainer = document.createElement('div');
                        inputContainer.style.display = 'flex';
                        inputContainer.style.gap = '8px';
                        inputContainer.style.alignItems = 'center';
                        inputContainer.innerHTML = `<input type="date" id="reminder-jump-to-date" class="b3-text-field" value="${activeDate}" max="9999-12-31" style="min-width:160px;">`;

                        confirmDialog({
                            title: i18n("jumpToDate") || "跳转到日期",
                            content: inputContainer,
                            confirm: (ele) => {
                                const inputEl = (ele.querySelector('#reminder-jump-to-date') || document.getElementById('reminder-jump-to-date')) as HTMLInputElement;
                                if (!inputEl || !inputEl.value) {
                                    showMessage(i18n("pleaseEnterDate") || "请选择一个日期", 3000, "warning");
                                    return;
                                }
                                const target = new Date(inputEl.value + 'T00:00:00');
                                if (isNaN(target.getTime())) {
                                    showMessage(i18n("invalidDate") || "无效的日期", 3000, "error");
                                    return;
                                }
                                this.calendar.gotoDate(target);
                            }
                        });

                        // 将焦点设置到输入框并支持回车提交
                        setTimeout(() => {
                            const el = document.getElementById('reminder-jump-to-date') as HTMLInputElement;
                            if (el) {
                                el.focus();
                                el.addEventListener('keydown', (e) => {
                                    if (e.key === 'Enter') {
                                        const confirmBtn = document.querySelector('.b3-dialog__action .b3-button:last-child') as HTMLButtonElement;
                                        if (confirmBtn) confirmBtn.click();
                                    }
                                }, { once: true });
                            }
                        }, 50);
                    }
                }
            },
            viewDidMount: this.handleViewDidMount.bind(this),
            editable: true,
            selectable: true,
            selectMirror: true,
            selectOverlap: true,
            eventResizableFromStart: true, // 允许从事件顶部拖动调整开始时间
            locale: window.siyuan.config.lang.toLowerCase().replace('_', '-'),
            scrollTime: dayStartTime, // 日历视图初始滚动位置
            firstDay: weekStartDay, // 使用用户设置的周开始日
            slotMinTime: todayStartTime, // 逻辑一天的起始时间
            slotMaxTime: slotMaxTime, // 逻辑一天的结束时间（可能超过24小时）
            nextDayThreshold: todayStartTime, // 跨天事件的判断阈值
            now: () => new Date(), // 使用当前时间，确保 nowIndicator 正确
            nowIndicator: true, // 显示当前时间指示线
            snapDuration: '00:05:00', // 设置吸附间隔为5分钟
            slotDuration: '00:15:00', // 设置默认时间间隔为15分钟
            allDayText: '全天', // 设置全天事件的文本
            slotLabelFormat: {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            },
            eventTimeFormat: {
                hour: '2-digit',
                minute: '2-digit',
                meridiem: false,
                hour12: false
            },
            eventClassNames: 'reminder-calendar-event',
            eventOrder: (a: any, b: any) => {
                // 1. 优先根据优先级排序
                const priorityMap: { [key: string]: number } = {
                    'high': 0,
                    'medium': 1,
                    'low': 2,
                    'none': 3
                };

                const pA = a.extendedProps.priority || 'none';
                const pB = b.extendedProps.priority || 'none';

                const scoreA = priorityMap[pA] ?? 3;
                const scoreB = priorityMap[pB] ?? 3;

                if (scoreA !== scoreB) {
                    return scoreA - scoreB;
                }

                // 2. 同优先级内根据 sort 字段排序
                const orderA = typeof a.extendedProps.sort === 'number' ? a.extendedProps.sort : 0;
                const orderB = typeof b.extendedProps.sort === 'number' ? b.extendedProps.sort : 0;
                return orderA - orderB;
            },
            displayEventTime: true,
            // Custom Lunar Date and Holiday Rendering using DidMount hooks to preserve default behavior
            dayCellDidMount: (arg) => {
                const existingExtra = arg.el.querySelector('.day-extra-info-wrapper');
                if (existingExtra) existingExtra.remove();
                const existingLunar = arg.el.querySelector('.day-lunar');
                if (existingLunar) existingLunar.remove();
                const existingHoliday = arg.el.querySelector('.day-holiday');
                if (existingHoliday) existingHoliday.remove();

                // Only for month views and multiMonthYear
                if (arg.view.type === 'dayGridMonth' || arg.view.type === 'multiMonthYear') {
                    const topEl = arg.el.querySelector('.fc-daygrid-day-top');
                    if (topEl) {
                        const dateStr = getLocalDateString(arg.date);
                        const holidayName = this.holidays[dateStr];

                        const extraInfoWrapper = document.createElement('div');
                        extraInfoWrapper.className = 'day-extra-info-wrapper';
                        extraInfoWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px;  line-height: 1; margin-right: 4px;';

                        if (this.showLunar) {
                            const { displayLunar, isFestival, fullLunarDate } = this.getLunarInfo(arg.date);
                            const lunarSpan = document.createElement('span');
                            lunarSpan.className = `day-lunar ${isFestival ? 'festival' : ''}`;
                            lunarSpan.textContent = displayLunar;
                            lunarSpan.title = fullLunarDate;
                            lunarSpan.style.cssText = `${isFestival ? 'color: var(--b3-theme-primary); font-weight: bold;' : 'color: var(--b3-theme-on-surface-light); opacity: 0.8; font-size: 0.9em;'} z-index: 1; line-height: 1;`;
                            extraInfoWrapper.appendChild(lunarSpan);
                        }

                        if (this.showHoliday && holidayName) {
                            const isWorkday = typeof holidayName === 'object' && holidayName.type === 'workday';
                            const holidaySpan = document.createElement('span');
                            holidaySpan.className = 'day-holiday';
                            holidaySpan.textContent = isWorkday ? '(班)' : '(休)';
                            holidaySpan.title = typeof holidayName === 'object' ? holidayName.title : holidayName;
                            holidaySpan.style.cssText = `color: ${isWorkday ? 'var(--b3-theme-error)' : 'var(--b3-card-success-color)'}; font-size: 0.8em; cursor: help; font-weight: bold;`;
                            extraInfoWrapper.appendChild(holidaySpan);
                        }

                        if (extraInfoWrapper.children.length > 0) {
                            topEl.appendChild(extraInfoWrapper);
                        }
                    }
                }
            },
            dayHeaderDidMount: (arg) => {
                // 清理可能已存在的元素
                const existingExtra = arg.el.querySelector('.day-header-extra-wrapper');
                if (existingExtra) existingExtra.remove();
                const existingLunar = arg.el.querySelector('.day-header-lunar');
                if (existingLunar) existingLunar.remove();
                const existingHoliday = arg.el.querySelector('.day-header-holiday');
                if (existingHoliday) existingHoliday.remove();

                if (!this.showLunar && !this.showHoliday) return;

                const viewType = arg.view.type;
                if (!viewType.startsWith('list') &&
                    (viewType === 'timeGridWeek' || viewType === 'timeGridDay' ||
                        viewType === 'dayGridWeek' || viewType === 'dayGridDay' ||
                        viewType.includes('MultiDays'))) {

                    const cushion = arg.el.querySelector('.fc-col-header-cell-cushion');
                    if (cushion && cushion.parentElement) {
                        const parent = cushion.parentElement as HTMLElement;
                        parent.style.display = 'flex';
                        parent.style.flexDirection = 'column';
                        parent.style.alignItems = 'center';
                        parent.style.justifyContent = 'center';

                        const dateStr = getLocalDateString(arg.date);
                        const holidayName = this.holidays[dateStr];

                        const extraInfoWrapper = document.createElement('div');
                        extraInfoWrapper.className = 'day-header-extra-wrapper';
                        extraInfoWrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-top: 2px; line-height: 1.2;';

                        if (this.showLunar) {
                            const { displayLunar, isFestival, fullLunarDate } = this.getLunarInfo(arg.date);
                            const lunarSpan = document.createElement('span');
                            lunarSpan.className = `day-header-lunar ${isFestival ? 'festival' : ''}`;
                            lunarSpan.textContent = displayLunar;
                            lunarSpan.title = fullLunarDate;
                            lunarSpan.style.cssText = `font-size: 0.8em; ${isFestival ? 'color: var(--b3-theme-primary);' : 'color: var(--b3-theme-on-surface-light); opacity: 0.8;'}`;
                            extraInfoWrapper.appendChild(lunarSpan);
                        }

                        if (this.showHoliday && holidayName) {
                            const isWorkday = typeof holidayName === 'object' && holidayName.type === 'workday';
                            const holidaySpan = document.createElement('span');
                            holidaySpan.className = 'day-header-holiday';
                            holidaySpan.textContent = isWorkday ? '(班)' : '(休)';
                            holidaySpan.title = typeof holidayName === 'object' ? holidayName.title : holidayName;
                            holidaySpan.style.cssText = `font-size: 0.75em; color: ${isWorkday ? 'var(--b3-theme-error)' : 'var(--b3-card-success-color)'}; cursor: help; font-weight: bold;`;
                            extraInfoWrapper.appendChild(holidaySpan);
                        }

                        if (extraInfoWrapper.children.length > 0) {
                            parent.appendChild(extraInfoWrapper);
                        }
                    }
                }
            },
            eventContent: this.renderEventContent.bind(this),
            eventClick: this.handleEventClick.bind(this),
            eventDragStart: (info) => {
                this.isDragging = true;
                this.startAllDayDragTracking(info);
            },
            eventDragStop: (info) => {
                // 如果是全天事件，执行追踪停止逻辑
                if (info.event.allDay) {
                    this.stopAllDayDragTracking(info);
                } else {
                    this.isDragging = false;
                }

                // 延迟重置拖动标志，防止拖动结束后立即触发点击
                setTimeout(() => {
                    this.isDragging = false;
                }, 100);
            },
            eventDrop: this.handleEventDrop.bind(this),
            eventResize: this.handleEventResize.bind(this),
            eventAllow: (dropInfo, draggedEvent) => {
                // 禁用订阅任务的拖拽和调整大小
                if (draggedEvent.extendedProps.isSubscribed) {
                    return false;
                }
                return this.handleEventAllow(dropInfo, draggedEvent);
            },
            dateClick: this.handleDateClick.bind(this),
            select: this.handleDateSelect.bind(this),
            // 移除自动事件源，改为手动管理事件
            events: [],
            dayCellClassNames: (arg) => {
                const today = getLogicalDateString();
                const cellDate = getLocalDateString(arg.date);

                if (cellDate === today) {
                    return ['fc-today-custom'];
                }
                return [];
            },
            dayHeaderClassNames: (arg) => {
                const today = getLogicalDateString();
                const cellDate = getLocalDateString(arg.date);

                if (cellDate === today) {
                    return ['fc-today-custom'];
                }
                return [];
            },
            eventDidMount: (info) => {
                // List View Lunar Logic
                if (info.view.type.startsWith('list')) {
                    // Find the preceding list header
                    let prev = info.el.previousElementSibling;
                    let listHeader = null;
                    while (prev) {
                        if (prev.classList.contains('fc-list-day')) {
                            listHeader = prev;
                            break;
                        }
                        prev = prev.previousElementSibling;
                    }

                    if (listHeader) {
                        const dateStr = listHeader.getAttribute('data-date');
                        if (dateStr) {
                            const date = new Date(dateStr);
                            const localDateStr = getLocalDateString(date);
                            const holidayName = this.holidays[localDateStr];
                            const textContainer = listHeader.querySelector('.fc-list-day-text') || listHeader.querySelector('.fc-list-day-cushion');

                            // Handle Lunar in List View
                            if (!this.showLunar) {
                                const existingLunar = listHeader.querySelector('.day-lunar');
                                if (existingLunar) existingLunar.remove();
                                listHeader.removeAttribute('data-lunar-processed');
                            } else if (!listHeader.getAttribute('data-lunar-processed')) {
                                if (textContainer) {
                                    const { displayLunar, isFestival, fullLunarDate } = this.getLunarInfo(date);
                                    const lunarSpan = document.createElement('span');
                                    lunarSpan.className = `day-lunar ${isFestival ? 'festival' : ''}`;
                                    lunarSpan.textContent = displayLunar;
                                    lunarSpan.title = fullLunarDate;
                                    lunarSpan.style.cssText = `${isFestival ? 'color: var(--b3-theme-primary); font-weight: bold;' : 'color: var(--b3-theme-on-surface-light); opacity: 0.8; font-size: 0.9em;'} margin-left: 8px;`;
                                    textContainer.appendChild(lunarSpan);
                                }
                                listHeader.setAttribute('data-lunar-processed', 'true');
                            }

                            // Handle Holiday in List View
                            if (!this.showHoliday) {
                                const existingHoliday = listHeader.querySelector('.day-holiday');
                                if (existingHoliday) existingHoliday.remove();
                                listHeader.removeAttribute('data-holiday-processed');
                            } else if (!listHeader.getAttribute('data-holiday-processed')) {
                                if (textContainer && holidayName) {
                                    const isWorkday = typeof holidayName === 'object' && holidayName.type === 'workday';
                                    const holidaySpan = document.createElement('span');
                                    holidaySpan.className = 'day-holiday';
                                    holidaySpan.textContent = isWorkday ? '(班)' : '(休)';
                                    holidaySpan.title = typeof holidayName === 'object' ? holidayName.title : holidayName;
                                    holidaySpan.style.cssText = `color: ${isWorkday ? 'var(--b3-theme-error)' : 'var(--b3-card-success-color)'}; font-size: 0.8em; margin-left: 8px; cursor: help; font-weight: bold;`;
                                    textContainer.appendChild(holidaySpan);
                                }
                                listHeader.setAttribute('data-holiday-processed', 'true');
                            }

                            // Handle Today highlighting in List View
                            if (localDateStr === getLogicalDateString()) {
                                listHeader.classList.add('fc-list-day-today-custom');
                            } else {
                                listHeader.classList.remove('fc-list-day-today-custom');
                            }
                        }
                    }
                }

                info.el.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.showEventContextMenu(e, info.event);
                });

                // 改进的鼠标悬浮事件监听器 - 添加延迟显示
                info.el.addEventListener('mouseenter', (e) => {
                    this.handleEventMouseEnter(e, info.event);
                });

                info.el.addEventListener('mouseleave', () => {
                    this.handleEventMouseLeave();
                });

                // 鼠标移动时更新提示框位置
                info.el.addEventListener('mousemove', (e) => {
                    if (this.tooltip && this.tooltip.style.display !== 'none' && this.tooltip.style.opacity === '1') {
                        this.updateTooltipPosition(e);
                    }
                });

                // Modern UI Style: Pale background, thick left border, dark text
                const targetEl = info.el.querySelector('.fc-daygrid-event') as HTMLElement || info.el as HTMLElement;

                // Force block display for month view non-all-day events
                if (info.view.type === 'dayGridMonth' && !info.event.allDay) {
                    targetEl.classList.remove('fc-daygrid-dot-event');
                    targetEl.classList.add('fc-daygrid-block-event');
                }

                if (!info.view.type.startsWith('list')) {
                    const baseColor = info.event.backgroundColor || info.event.borderColor || 'var(--b3-theme-primary)';

                    // Reset standard styles
                    targetEl.style.border = 'none';
                    // Adjust opacity based on theme mode
                    const themeMode = document.querySelector('html')?.getAttribute('data-theme-mode');
                    const opacity = themeMode === 'dark' ? '0.3' : '0.15';
                    targetEl.style.backgroundColor = `rgba(from ${baseColor} r g b / ${opacity})`;

                    // Add thick left border
                    targetEl.style.borderLeft = `4px solid ${baseColor}`;
                    targetEl.style.borderRadius = '3px';

                    // Set text color to theme text color (black/dark in light mode, light in dark mode)
                    // The user requested "Black text", which usually corresponds to the main text color in modern UIs
                    targetEl.style.color = 'var(--b3-theme-on-background)';

                    // Clean up potential overrides
                    if (targetEl.style.borderColor === baseColor) {
                        targetEl.style.borderColor = 'transparent';
                    }
                }
            },
            // 添加视图切换和日期变化的监听
            datesSet: () => {
                // 当视图的日期范围改变时（包括切换前后时间），刷新事件
                this.refreshEvents();
            }
        });

        this.calendar.render();
        // Update Pomodoro button visibility after initial render
        this.updatePomodoroButtonVisibility();

        // 支持从提醒面板将任务拖拽到日历上以调整任务时间
        // 接受 mime-type: 'application/x-reminder' (JSON) 或纯文本 reminder id
        calendarEl.addEventListener('dragover', (e: DragEvent) => {
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = Array.from(types).some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain');

            if (isSiYuanDrag || isExternalDrag) {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                // 更新并显示放置指示器
                try {
                    this.updateDropIndicator(e.clientX, e.clientY, calendarEl);
                } catch (err) {
                    // ignore
                }
            }
        });

        calendarEl.addEventListener('dragleave', (e: DragEvent) => {
            // 隐藏指示器（当拖出日历区域）
            this.hideDropIndicator();
        });

        calendarEl.addEventListener('drop', async (e: DragEvent) => {
            e.preventDefault();
            // 隐藏指示器（优先）
            this.hideDropIndicator();
            try {
                const dt = e.dataTransfer;
                if (!dt) return;

                const types = Array.from(dt.types);
                let blockIds: string[] = [];

                // 1. 处理思源内部拖拽 (Gutter, File, Tab)
                const gutterType = types.find(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER));
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

                // 2. 处理已有提醒拖拽 (提醒面板拖入)
                let reminderId = '';
                if (blockIds.length === 0) {
                    let payloadStr = dt.getData('application/x-reminder') || dt.getData('text/plain') || '';
                    if (!payloadStr) return;
                    try {
                        const payload = JSON.parse(payloadStr);
                        reminderId = payload.id;
                    } catch (err) {
                        reminderId = payloadStr;
                    }
                }

                if (blockIds.length === 0 && !reminderId) return;

                // 找到放置位置对应的日期
                const pointX = e.clientX;
                const pointY = e.clientY;
                const dateEls = Array.from(calendarEl.querySelectorAll('[data-date]')) as HTMLElement[];
                let dateEl: HTMLElement | null = null;

                // 优先查找包含该点的元素
                for (const d of dateEls) {
                    const r = d.getBoundingClientRect();
                    if (pointX >= r.left && pointX <= r.right && pointY >= r.top && pointY <= r.bottom) {
                        dateEl = d;
                        break;
                    }
                }

                // 若没有直接包含的元素，则选择距离点中心最近的日期单元格
                if (!dateEl && dateEls.length > 0) {
                    let minDist = Infinity;
                    for (const d of dateEls) {
                        const r = d.getBoundingClientRect();
                        const cx = (r.left + r.right) / 2;
                        const cy = (r.top + r.bottom) / 2;
                        const dx = cx - pointX;
                        const dy = cy - pointY;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < minDist) {
                            minDist = dist;
                            dateEl = d;
                        }
                    }
                }

                // 若仍未找到，使用日历当前显示的日期作为回退
                if (!dateEl) {
                    const fallbackDate = this.calendar ? this.calendar.getDate() : getDayStartAdjustedDate(new Date());
                    const dateStrFallback = getLocalDateString(fallbackDate);
                    dateEl = null;
                    // 直接使用回退日期字符串
                    var dateStr = dateStrFallback;
                } else {
                    var dateStr = dateEl.getAttribute('data-date') || '';
                }
                if (!dateStr) {
                    showMessage('无法识别放置位置，请放到日历的日期或时间格上。');
                    return;
                }

                // 判断是否在时间网格（timeGrid）内部
                const elAtPoint = document.elementFromPoint(pointX, pointY) as HTMLElement | null;
                const inTimeGrid = !!(elAtPoint && elAtPoint.closest('.fc-timegrid'));

                // 检测是否落在“全天”区域（FullCalendar 在 timeGrid 上方会渲染 dayGrid/all-day 区域）
                const inAllDayArea = !!(elAtPoint && (elAtPoint.closest('.fc-daygrid') || elAtPoint.closest('.fc-daygrid-day') || elAtPoint.closest('.fc-daygrid-body') || elAtPoint.closest('.fc-all-day')));

                let startDate: Date;
                let isAllDay = false;

                if (inAllDayArea) {
                    // 明确放置到全天区域，按全天事件处理
                    startDate = new Date(`${dateStr}T00:00:00`);
                    isAllDay = true;
                } else if (inTimeGrid) {
                    // 计算时间：按放置点在当天列的相对纵向位置映射到 slotMinTime-slotMaxTime
                    const dayCol = dateEl;
                    const rect = dayCol.getBoundingClientRect();
                    const y = e.clientY - rect.top;

                    const todayStartTime = await this.getTodayStartTime();
                    const slotMaxTime = this.calculateSlotMaxTime(todayStartTime);
                    const slotMin = this.parseDuration(todayStartTime);
                    const slotMax = this.parseDuration(slotMaxTime);

                    const totalMinutes = Math.max(1, slotMax - slotMin);
                    const clampedY = Math.max(0, Math.min(rect.height, y));
                    const minutesFromMin = Math.round((clampedY / rect.height) * totalMinutes);

                    startDate = new Date(`${dateStr}T00:00:00`);
                    let m = slotMin + minutesFromMin;
                    // 吸附到5分钟步长，避免出现如 19:03 之类的时间
                    m = Math.round(m / 5) * 5;
                    const hh = Math.floor(m / 60);
                    const mm = m % 60;
                    startDate.setHours(hh, mm, 0, 0);
                    // 额外确保秒和毫秒为0，并做一次稳定的吸附
                    startDate = this.snapToMinutes(startDate, 5);
                    isAllDay = false;
                } else {
                    // 月视图或无时间信息：视为全天
                    startDate = new Date(`${dateStr}T00:00:00`);
                    isAllDay = true;
                }

                const durationMinutes = 60; // Default duration for new events
                let endDate: Date;
                if (isAllDay) {
                    // 对于全天事件，FullCalendar 要求 end 为排他日期（next day midnight）
                    // 因此将结束时间设为开始日期的下一天 00:00，避免在后续处理中被减一天后产生比开始早的问题
                    endDate = new Date(startDate.getTime() + 24 * 60 * 60000);
                    endDate.setHours(0, 0, 0, 0);
                } else {
                    endDate = new Date(startDate.getTime() + durationMinutes * 60000);
                    endDate = this.snapToMinutes(endDate, 5);
                }

                if (reminderId) {
                    // 更新已有提醒
                    await this.updateEventTime(reminderId, { event: { start: startDate, end: endDate, allDay: isAllDay } }, false);
                } else if (blockIds.length > 0) {
                    // 创建新任务
                    for (const bid of blockIds) {
                        await this.addItemByBlockId(bid, startDate, isAllDay);
                    }
                }

                // 通知全局提醒更新，触发 ReminderPanel 刷新
                try {
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                } catch (err) {
                    // ignore
                }

                // 刷新日历显示
                await this.refreshEvents();
                // 隐藏指示器
                this.hideDropIndicator();
            } catch (err) {
                console.error('处理外部拖放失败', err);
                showMessage(i18n('operationFailed'));
                this.hideDropIndicator();
            }
        });


        // 更新视图按钮状态
        this.updateViewButtonStates();

        // 设置任务摘要对话框的引用
        this.taskSummaryDialog.setCalendar(this.calendar);
        this.taskSummaryDialog.setCategoryManager(this);

        // datesSet 会在 render 后自动触发，无需额外调用 refreshEvents

        // 添加自定义样式
        this.addCustomStyles();

        // 监听提醒更新事件
        this.externalReminderUpdatedHandler = (e: Event) => {
            // 获取事件详细信息
            const detail = (e as CustomEvent).detail;

            // 如果事件来源是日历本身，不进行刷新，避免循环刷新
            if (detail && detail.source === 'calendar') {
                return;
            }

            this.refreshEvents();
        };
        window.addEventListener('reminderUpdated', this.externalReminderUpdatedHandler);

        // 监听设置更新事件
        this.settingUpdateHandler = async () => {
            await this.updateSettings();
        };
        window.addEventListener('reminderSettingsUpdated', this.settingUpdateHandler);

        // 监听项目颜色更新事件
        window.addEventListener('projectColorUpdated', () => {
            this.colorCache.clear();
            this.refreshEvents();
        });

        // 监听主题变化
        const themeObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme-mode') {
                    this.refreshEvents();
                }
            });
        });

        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-mode']
        });

        // 添加窗口大小变化监听器
        this.addResizeListeners();

        // 添加滚轮缩放监听器
        this.addWheelZoomListener(calendarEl);

        // 设置日历实例到任务摘要管理器
        this.taskSummaryDialog.setCalendar(this.calendar);
        this.taskSummaryDialog.setCategoryManager(this);

        this.checkVip();
    }


    private async renderProjectFilterCheckboxes(container: HTMLElement, button: HTMLButtonElement) {
        try {
            const projectData = await this.plugin.loadProjectData();
            const statuses = this.statusManager.getStatuses();
            const projectIds: string[] = [];

            container.innerHTML = '';

            // 收集所有有效项目ID（不包含归档）
            if (projectData) {
                Object.values(projectData).forEach((project: any) => {
                    const projectStatus = statuses.find(status => status.id === project.status);
                    if (projectStatus && !projectStatus.isArchived) {
                        projectIds.push(project.id);
                    }
                });
            }
            projectIds.push('none'); // 添加"无项目"标识

            // 添加"全选/取消全选"按钮
            const selectAllBtn = document.createElement('button');
            selectAllBtn.className = 'b3-button b3-button--text';
            selectAllBtn.style.width = '100%';
            selectAllBtn.style.marginBottom = '8px';

            const isAllSelected = this.currentProjectFilter.has('all');
            selectAllBtn.textContent = isAllSelected ? (i18n("deselectAll") || "取消全选") : (i18n("selectAll") || "全选");

            selectAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.currentProjectFilter.has('all')) {
                    this.currentProjectFilter = new Set();
                } else {
                    this.currentProjectFilter = new Set(['all']);
                }
                this.updateProjectFilterButtonText(button);
                this.renderProjectFilterCheckboxes(container, button);
                this.refreshEvents();
            });
            container.appendChild(selectAllBtn);

            const divider = document.createElement('div');
            divider.style.borderTop = '1px solid var(--b3-border-color)';
            divider.style.margin = '8px 0';
            container.appendChild(divider);

            // 渲染复选框的辅助函数
            const createCheckboxItem = (id: string, name: string, icon: string = '') => {
                const item = document.createElement('label');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.padding = '4px 16px';
                item.style.cursor = 'pointer';
                item.style.userSelect = 'none';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.style.marginRight = '8px';
                checkbox.checked = this.currentProjectFilter.has('all') || this.currentProjectFilter.has(id);

                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (checkbox.checked) {
                        this.currentProjectFilter.delete('all');
                        this.currentProjectFilter.add(id);

                        // 检查是否所有项都被勾选了
                        let allChecked = true;
                        for (const pid of projectIds) {
                            if (!this.currentProjectFilter.has(pid)) {
                                allChecked = false;
                                break;
                            }
                        }
                        if (allChecked) {
                            this.currentProjectFilter = new Set(['all']);
                            this.renderProjectFilterCheckboxes(container, button);
                        }
                    } else {
                        if (this.currentProjectFilter.has('all')) {
                            // 从全选状态切换到部分选，先把所有ID加进去然后再删掉当前的
                            this.currentProjectFilter = new Set(projectIds);
                        }
                        this.currentProjectFilter.delete(id);
                    }
                    this.updateProjectFilterButtonText(button);
                    this.refreshEvents();
                });

                const label = document.createElement('span');
                label.textContent = `${icon}${name}`;

                item.appendChild(checkbox);
                item.appendChild(label);
                return item;
            };

            // 首先添加"无项目"可选项
            container.appendChild(createCheckboxItem('none', i18n("noProject") || "无项目", '🚫 '));

            if (projectData && Object.keys(projectData).length > 0) {
                const projectsByStatus: { [key: string]: any[] } = {};
                Object.values(projectData).forEach((project: any) => {
                    const projectStatus = statuses.find(status => status.id === project.status);
                    if (projectStatus && !projectStatus.isArchived) {
                        if (!projectsByStatus[project.status]) {
                            projectsByStatus[project.status] = [];
                        }
                        projectsByStatus[project.status].push(project);
                    }
                });

                statuses.forEach(status => {
                    if (status.isArchived) return;
                    const statusProjects = projectsByStatus[status.id] || [];
                    if (statusProjects.length > 0) {
                        const statusHeader = document.createElement('div');
                        statusHeader.style.padding = '4px 8px';
                        statusHeader.style.fontWeight = 'bold';
                        statusHeader.style.marginTop = '4px';
                        statusHeader.style.color = 'var(--b3-theme-on-surface-light)';
                        statusHeader.textContent = `${status.icon || ''} ${status.name}`;
                        container.appendChild(statusHeader);

                        statusProjects.forEach(project => {
                            container.appendChild(createCheckboxItem(project.id, project.title || '未命名项目'));
                        });
                    }
                });
            }
        } catch (error) {
            console.error('渲染项目筛选器失败:', error);
        }
    }

    private async renderCategoryFilterCheckboxes(container: HTMLElement, button: HTMLButtonElement) {
        try {
            const categories = this.categoryManager.getCategories();
            const categoryIds = categories.map(c => c.id);
            categoryIds.push('none'); // 添加"无分类"标识

            container.innerHTML = '';

            // 添加"全选/取消全选"按钮
            const selectAllBtn = document.createElement('button');
            selectAllBtn.className = 'b3-button b3-button--text';
            selectAllBtn.style.width = '100%';
            selectAllBtn.style.marginBottom = '8px';

            const isAllSelected = this.currentCategoryFilter.has('all');
            selectAllBtn.textContent = isAllSelected ? (i18n("deselectAll") || "取消全选") : (i18n("selectAll") || "全选");

            selectAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.currentCategoryFilter.has('all')) {
                    this.currentCategoryFilter = new Set();
                } else {
                    this.currentCategoryFilter = new Set(['all']);
                }
                this.updateCategoryFilterButtonText(button);
                this.renderCategoryFilterCheckboxes(container, button);
                this.refreshEvents();
            });
            container.appendChild(selectAllBtn);

            const divider = document.createElement('div');
            divider.style.borderTop = '1px solid var(--b3-border-color)';
            divider.style.margin = '8px 0';
            container.appendChild(divider);

            const createCheckboxItem = (id: string, name: string, icon: string = '') => {
                const item = document.createElement('label');
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.padding = '4px 8px';
                item.style.cursor = 'pointer';
                item.style.userSelect = 'none';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.style.marginRight = '8px';
                checkbox.checked = this.currentCategoryFilter.has('all') || this.currentCategoryFilter.has(id);

                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (checkbox.checked) {
                        this.currentCategoryFilter.delete('all');
                        this.currentCategoryFilter.add(id);

                        // 检查是否所有项都被勾选了
                        let allChecked = true;
                        for (const cid of categoryIds) {
                            if (!this.currentCategoryFilter.has(cid)) {
                                allChecked = false;
                                break;
                            }
                        }
                        if (allChecked) {
                            this.currentCategoryFilter = new Set(['all']);
                            this.renderCategoryFilterCheckboxes(container, button);
                        }
                    } else {
                        if (this.currentCategoryFilter.has('all')) {
                            this.currentCategoryFilter = new Set(categoryIds);
                        }
                        this.currentCategoryFilter.delete(id);
                    }
                    this.updateCategoryFilterButtonText(button);
                    this.refreshEvents();
                });

                const label = document.createElement('span');
                label.textContent = `${icon}${name}`;

                item.appendChild(checkbox);
                item.appendChild(label);
                return item;
            };

            // 首先添加"无分类"
            container.appendChild(createCheckboxItem('none', i18n("noCategory") || "无分类", '🚫 '));

            if (categories && categories.length > 0) {
                categories.forEach(category => {
                    container.appendChild(createCheckboxItem(category.id, category.name, category.icon || ''));
                });
            }
        } catch (error) {
            console.error('渲染分类筛选器失败:', error);
        }
    }

    private updateProjectFilterButtonText(button: HTMLButtonElement) {
        const textSpan = button.querySelector('.filter-button-text');
        if (!textSpan) return;

        if (this.currentProjectFilter.has('all')) {
            textSpan.textContent = i18n("allProjects") || "全部项目";
        } else if (this.currentProjectFilter.size === 0) {
            textSpan.textContent = i18n("noProjectSelected") || "未选择项目";
        } else if (this.currentProjectFilter.size === 1) {
            const projectId = Array.from(this.currentProjectFilter)[0];
            if (projectId === 'none') {
                textSpan.textContent = i18n("noProject") || "无项目";
            } else {
                const projectName = this.projectManager.getProjectName(projectId);
                textSpan.textContent = projectName || i18n("unnamedProject") || "未命名项目";
            }
        } else {
            const count = this.currentProjectFilter.size;
            textSpan.textContent = `${count} ${i18n("projectsSelected") || "个项目"}`;
        }
    }

    private updateCategoryFilterButtonText(button: HTMLButtonElement) {
        const textSpan = button.querySelector('.filter-button-text');
        if (!textSpan) return;

        if (this.currentCategoryFilter.has('all')) {
            textSpan.textContent = i18n("allCategories") || "全部分类";
        } else if (this.currentCategoryFilter.size === 0) {
            textSpan.textContent = i18n("noCategorySelected") || "未选择分类";
        } else if (this.currentCategoryFilter.size === 1) {
            const categoryId = Array.from(this.currentCategoryFilter)[0];
            if (categoryId === 'none') {
                textSpan.textContent = i18n("noCategory") || "无分类";
            } else {
                const category = this.categoryManager.getCategoryById(categoryId);
                textSpan.textContent = category ? (category.icon ? `${category.icon} ${category.name}` : category.name) : (i18n("unnamedCategory") || "未命名分类");
            }
        } else {
            const count = this.currentCategoryFilter.size;
            textSpan.textContent = `${count} ${i18n("categoriesSelected") || "个分类"}`;
        }
    }


    private async showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(this.plugin, async () => {
            // 分类更新后重新渲染分类筛选器和事件
            const categoryFilterContainers = this.container.querySelectorAll('.filter-dropdown-container');
            if (categoryFilterContainers.length >= 2) {
                const categoryContainer = categoryFilterContainers[1]; // 第二个是分类筛选器
                const categoryDropdown = categoryContainer.querySelector('.filter-dropdown-menu') as HTMLElement;
                const categoryButton = categoryContainer.querySelector('button') as HTMLButtonElement;
                if (categoryDropdown && categoryButton) {
                    await this.renderCategoryFilterCheckboxes(categoryDropdown, categoryButton);
                }
            }
            this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
        });
        categoryDialog.show();
    }

    private showProjectColorDialog() {
        const projectColorDialog = new ProjectColorDialog(() => {
            this.refreshEvents();
        });
        projectColorDialog.show();
    }

    private addResizeListeners() {
        // 窗口大小变化监听器
        const handleResize = () => {
            this.debounceResize();
        };

        window.addEventListener('resize', handleResize);

        // 使用 ResizeObserver 监听容器大小变化
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => {
                this.debounceResize();
            });
            this.resizeObserver.observe(this.container);
        }

        // 监听标签页切换和显示事件
        const handleVisibilityChange = () => {
            if (!document.hidden && this.isCalendarVisible()) {
                this.debounceResize();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);



        // 使用 MutationObserver 监听容器的显示状态变化
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' &&
                    (mutation.attributeName === 'style' || mutation.attributeName === 'class')) {
                    if (this.isCalendarVisible()) {
                        this.debounceResize();
                    }
                }
            });
        });

        // 监听父级容器的变化
        let currentElement = this.container.parentElement;
        while (currentElement) {
            mutationObserver.observe(currentElement, {
                attributes: true,
                attributeFilter: ['style', 'class']
            });
            currentElement = currentElement.parentElement;
            // 只监听几层父级，避免监听过多元素
            if (currentElement === document.body) break;
        }

        // 清理函数
        const cleanup = () => {
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (this.resizeObserver) {
                this.resizeObserver.disconnect();
            }
            mutationObserver.disconnect();
            if (this.resizeTimeout) {
                clearTimeout(this.resizeTimeout);
            }
            // 清理提示框超时
            if (this.hideTooltipTimeout) {
                clearTimeout(this.hideTooltipTimeout);
            }
            // 清理提示框显示延迟超时
            if (this.tooltipShowTimeout) {
                clearTimeout(this.tooltipShowTimeout);
            }
            // 清理设置更新监听
            if (this.settingUpdateHandler) {
                window.removeEventListener('reminderSettingsUpdated', this.settingUpdateHandler);
            }
        };

        // 将清理函数绑定到容器，以便在组件销毁时调用
        (this.container as any)._calendarCleanup = cleanup;
    }

    private debounceResize() {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }

        this.resizeTimeout = window.setTimeout(() => {
            if (this.calendar && this.isCalendarVisible()) {
                try {
                    this.calendar.updateSize();
                    this.calendar.render();
                } catch (error) {
                    console.error('重新渲染日历失败:', error);
                }
            }
        }, 100);
    }

    private isCalendarVisible(): boolean {
        // 检查容器是否可见
        const containerRect = this.container.getBoundingClientRect();
        const isVisible = containerRect.width > 0 && containerRect.height > 0;

        // 检查容器是否在视口中或父级容器是否可见
        const style = window.getComputedStyle(this.container);
        const isDisplayed = style.display !== 'none' && style.visibility !== 'hidden';

        return isVisible && isDisplayed;
    }

    private getLunarInfo(date: Date) {
        const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
        const lunar = solar.getLunar();
        const lunarText = lunar.getDayInChinese();
        const festival = lunar.getFestivals()[0] || solar.getFestivals()[0] || lunar.getJieQi() || "";
        const displayLunar = festival ? festival : lunarText;
        const isFestival = !!festival;
        const fullLunarDate = lunar.getMonthInChinese() + '月' + lunar.getDayInChinese();
        return { displayLunar, isFestival, dateNum: date.getDate(), fullLunarDate };
    }



    private handleEventMouseEnter(event: MouseEvent, calendarEvent: any) {
        if (this.isDragging) return;
        // 当鼠标进入事件元素时，安排显示提示框
        // 如果已经有一个计划中的显示，则取消它
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
        }
        // 如果隐藏计时器正在运行，也取消它
        if (this.hideTooltipTimeout) {
            clearTimeout(this.hideTooltipTimeout);
            this.hideTooltipTimeout = null;
        }

        this.tooltipShowTimeout = window.setTimeout(() => {
            this.showEventTooltip(event, calendarEvent);
        }, 500); // 500ms延迟显示
    }

    private handleEventMouseLeave() {
        // 当鼠标离开事件元素时，安排隐藏提示框
        // 如果显示计时器正在运行，取消它
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
            this.tooltipShowTimeout = null;
        }

        // 安排隐藏
        this.hideTooltipTimeout = window.setTimeout(() => {
            this.hideEventTooltip();
        }, 300); // 300ms延迟隐藏
    }

    private showEventContextMenu(event: MouseEvent, calendarEvent: any) {
        // 在显示右键菜单前先隐藏提示框
        if (this.tooltip) {
            this.hideEventTooltip();
            // 清除任何待执行的提示框超时
            if (this.hideTooltipTimeout) {
                clearTimeout(this.hideTooltipTimeout);
                this.hideTooltipTimeout = null;
            }
        }

        const menu = new Menu("calendarEventContextMenu");

        // Handle Pomodoro events specifically
        if (calendarEvent.extendedProps.type === 'pomodoro') {
            menu.addItem({
                iconHTML: "📝",
                label: i18n("viewPomodoroTask") || "查看所属任务",
                click: async () => {
                    try {
                        let eventId = calendarEvent.extendedProps.eventId;
                        if (!eventId) return;

                        const reminderData = await getAllReminders(this.plugin);
                        let reminder = reminderData[eventId];
                        let instanceDate: string | undefined = undefined;
                        let isInstance = false;

                        // 如果是重复任务实例ID，提取原任务ID和实例日期 (格式为 {id}_{date})
                        if (!reminder) {
                            const idx = eventId.lastIndexOf('_');
                            if (idx !== -1) {
                                const possibleDate = eventId.slice(idx + 1);
                                if (/^\d{4}-\d{2}-\d{2}$/.test(possibleDate)) {
                                    instanceDate = possibleDate;
                                    const originalId = eventId.slice(0, idx);
                                    const originalReminder = reminderData[originalId];
                                    if (originalReminder) {
                                        // 构造实例对象，保持原始任务的属性，但使用实例ID和日期
                                        reminder = {
                                            ...originalReminder,
                                            id: eventId, // 使用实例ID
                                            originalId: originalId,
                                            date: instanceDate,
                                            isInstance: true
                                        };
                                        isInstance = true;
                                    }
                                }
                            }
                        }

                        if (reminder) {
                            const dialog = new QuickReminderDialog(
                                instanceDate || reminder.date,
                                reminder.time,
                                undefined,
                                undefined,
                                {
                                    reminder: reminder,
                                    mode: 'edit', // Allow edit as user might want to adjust the task
                                    plugin: this.plugin,
                                    isInstanceEdit: isInstance || !!instanceDate,
                                    instanceDate: instanceDate,
                                    onSaved: () => {
                                        this.refreshEvents();
                                        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                                    }
                                }
                            );
                            dialog.show();
                        } else {
                            showMessage(i18n("reminderNotExist"));
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deletePomodoroRecord") || "删除记录",
                click: async () => {
                    confirm(i18n("deletePomodoroRecord"), i18n("confirmDelete"), async () => {
                        const pomodoroManager = this.pomodoroRecordManager;
                        // session id format in prompt: pomodoro-ID
                        const sessionId = calendarEvent.id.replace('pomodoro-', '');
                        await pomodoroManager.deleteSession(sessionId);
                        await this.refreshEvents();
                        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                    });
                }
            });

            menu.open({
                x: event.clientX,
                y: event.clientY
            });
            return;
        }

        if (calendarEvent.extendedProps.isSubscribed) {
            menu.addItem({
                iconHTML: "ℹ️",
                label: i18n("subscribedTaskReadOnly") || "订阅任务（只读）",
                disabled: true
            });

            if (calendarEvent.extendedProps.projectId) {
                menu.addItem({
                    iconHTML: "📂",
                    label: i18n("openProjectKanban"),
                    click: () => {
                        this.openProjectKanban(calendarEvent.extendedProps.projectId);
                    }
                });
            }

            menu.addSeparator();

            menu.addItem({
                iconHTML: "🍅",
                label: i18n("startPomodoro"),
                click: () => {
                    this.startPomodoro(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "⏱️",
                label: i18n("startCountUp"),
                click: () => {
                    this.startPomodoroCountUp(calendarEvent);
                }
            });

            menu.open({
                x: event.clientX,
                y: event.clientY
            });
            return;
        }

        // 如果事项没有绑定块，显示绑定块选项
        if (!calendarEvent.extendedProps.blockId) {
            menu.addItem({
                iconHTML: "🔗",
                label: i18n("bindToBlock"),
                click: () => {
                    this.showBindToBlockDialog(calendarEvent);
                }
            });
            menu.addSeparator();
        } else {
            menu.addItem({
                iconHTML: "📖",
                label: i18n("openNote"),
                click: () => {
                    this.handleEventClick({ event: calendarEvent });
                }
            });
        }

        // 对于重复事件实例，提供特殊选项
        if (calendarEvent.extendedProps.isRepeated) {
            if (!calendarEvent.extendedProps.isSubscribed) {
                menu.addItem({
                    iconHTML: "📝",
                    label: i18n("modifyThisInstance"),
                    click: () => {
                        this.showInstanceEditDialog(calendarEvent);
                    }
                });

                menu.addItem({
                    iconHTML: "📝",
                    label: i18n("modifyAllInstances"),
                    click: () => {
                        this.showTimeEditDialogForSeries(calendarEvent);
                    }
                });
            }
        } else if (calendarEvent.extendedProps.repeat?.enabled) {
            // 对于周期原始事件，提供与实例一致的选项
            menu.addItem({
                iconHTML: "📝",
                label: i18n("modifyThisInstance"),
                click: () => {
                    this.splitRecurringEvent(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "📝",
                label: i18n("modifyAllInstances"),
                click: () => {
                    this.showTimeEditDialog(calendarEvent);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "📝",
                label: i18n("modify"),
                click: () => {
                    this.showTimeEditDialog(calendarEvent);
                }
            });
        }

        // 添加创建子任务选项
        menu.addItem({
            iconHTML: "➕",
            label: i18n("createSubtask") || "创建子任务",
            click: () => {
                this.showCreateSubtaskDialog(calendarEvent);
            }
        });

        // 如果是子任务，添加查看父任务选项
        if (calendarEvent.extendedProps.parentId) {
            menu.addItem({
                iconHTML: "👁️‍🗨️",
                label: i18n("viewParentTask") || "查看父任务",
                click: () => {
                    this.showParentTaskDialog(calendarEvent);
                }
            });
        }

        menu.addItem({
            iconHTML: "✅",
            label: calendarEvent.extendedProps.completed ? i18n("markAsUncompleted") : i18n("markAsCompleted"),
            click: () => {
                this.toggleEventCompleted(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加优先级设置子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: i18n("high"), color: '#e74c3c', icon: '🔴' },
            { key: 'medium', label: i18n("medium"), color: '#f39c12', icon: '🟡' },
            { key: 'low', label: i18n("low"), color: '#3498db', icon: '🔵' },
            { key: 'none', label: i18n("none"), color: '#8f8f8f', icon: '⚫' }
        ];

        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                click: () => {
                    this.setPriority(calendarEvent, priority.key);
                }
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: i18n("setPriority"),
            submenu: priorityMenuItems
        });

        menu.addItem({
            iconHTML: calendarEvent.allDay ? "⏰" : "📅",
            label: calendarEvent.allDay ? i18n("changeToTimed") : i18n("changeToAllDay"),
            click: () => {
                this.toggleAllDayEvent(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加复制块引选项 - 只对已绑定块的事件显示，排除未绑定块的事项和快速提醒
        if (calendarEvent.extendedProps.blockId) {
            menu.addItem({
                iconHTML: "📋",
                label: i18n("copyBlockRef"),
                click: () => {
                    this.copyBlockRef(calendarEvent);
                }
            });
        }

        // 添加复制事件标题菜单项
        menu.addItem({
            iconHTML: "📄",
            label: i18n("copyEventTitle"),
            click: () => {
                this.copyEventTitle(calendarEvent);
            }
        });

        // 添加创建副本菜单项
        menu.addItem({
            iconHTML: "📅",
            label: i18n("createCopy"),
            click: () => {
                this.createCopy(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加项目管理选项（仅当任务有projectId时显示）
        if (calendarEvent.extendedProps.projectId) {
            menu.addItem({
                iconHTML: "📂",
                label: i18n("openProjectKanban"),
                click: () => {
                    this.openProjectKanban(calendarEvent.extendedProps.projectId);
                }
            });
            menu.addSeparator();
        }

        // 添加番茄钟选项
        menu.addItem({
            iconHTML: "🍅",
            label: i18n("startPomodoro"),
            click: () => {
                this.startPomodoro(calendarEvent);
            }
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: i18n("startCountUp"),
            click: () => {
                this.startPomodoroCountUp(calendarEvent);
            }
        });

        menu.addSeparator();

        if (calendarEvent.extendedProps.isRepeated) {
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteThisInstance"),
                click: () => {
                    this.deleteInstanceOnly(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteAllInstances"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        } else if (calendarEvent.extendedProps.repeat?.enabled) {
            // 对于周期原始事件，提供与实例一致的删除选项
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteThisInstance"),
                click: () => {
                    this.skipFirstOccurrence(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteAllInstances"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteReminder"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async showInstanceEditDialog(calendarEvent: any) {
        // 为重复事件实例显示编辑对话框
        const originalId = calendarEvent.extendedProps.originalId;
        // 事件 id 使用格式: <reminder.id>_<originalKey>
        // 以 id 的最后一段作为实例的原始键，用于查找 instanceModifications
        const instanceIdStr = calendarEvent.id || '';
        const idx = instanceIdStr.lastIndexOf('_');
        const instanceDate = idx !== -1 ? instanceIdStr.slice(idx + 1) : calendarEvent.extendedProps.date;

        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(i18n("reminderDataNotExist"));
                return;
            }

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[instanceDate];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: calendarEvent.id,
                date: calendarEvent.extendedProps.date,
                endDate: calendarEvent.extendedProps.endDate,
                time: calendarEvent.extendedProps.time,
                endTime: calendarEvent.extendedProps.endTime,
                // 修改备注逻辑：复用原始事件的备注，如果实例有明确的备注则优先使用
                note: instanceMod?.note || originalReminder.note || '',  // 优先使用实例备注，其次使用原始事件备注
                isInstance: true,
                originalId: originalId,
                instanceDate: instanceDate
            };

            const editDialog = new QuickReminderDialog(
                instanceData.date,
                instanceData.time,
                undefined,
                undefined,
                {
                    reminder: instanceData,
                    mode: 'edit',
                    onSaved: async () => {
                        await this.refreshEvents();
                        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                    },
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

    private async deleteInstanceOnly(calendarEvent: any) {
        // 删除重复事件的单个实例
        await confirm(
            i18n("deleteThisInstance"),
            i18n("confirmDeleteInstance"),
            async () => {
                try {
                    const originalId = calendarEvent.extendedProps.originalId;
                    // 从 event.id 提取原始实例键，优先使用它作为排除键
                    const instanceIdStr = calendarEvent.id || '';
                    const instanceDate = instanceIdStr.split('_').pop() || calendarEvent.extendedProps.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(i18n("instanceDeleted"));
                    await this.refreshEvents();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                } catch (error) {
                    console.error('删除重复实例失败:', error);
                    showMessage(i18n("deleteInstanceFailed"));
                }
            }
        );
    }
    private async addExcludedDate(originalId: string, excludeDate: string) {
        // 为原始重复事件添加排除日期
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
    // 添加复制块引功能
    private async copyBlockRef(calendarEvent: any) {
        try {
            // 检查是否有绑定的块ID
            if (!calendarEvent.extendedProps.blockId) {
                showMessage(i18n("unboundReminder") + "，请先绑定到块");
                return;
            }

            // 获取块ID
            const blockId = calendarEvent.extendedProps.blockId;

            if (!blockId) {
                showMessage(i18n("cannotGetDocumentId"));
                return;
            }

            // 获取事件标题（移除可能存在的分类图标前缀）
            let title = calendarEvent.title || i18n("unnamedNote");

            // 移除分类图标（如果存在）
            // 移除分类图标（如果存在）
            if (calendarEvent.extendedProps.categoryId) {
                const categoryIds = calendarEvent.extendedProps.categoryId.split(',');
                for (const id of categoryIds) {
                    const category = this.categoryManager.getCategoryById(id);
                    if (category && category.icon) {
                        const iconPrefix = `${category.icon} `;
                        if (title.startsWith(iconPrefix)) {
                            title = title.substring(iconPrefix.length);
                            break;
                        }
                    }
                }
            }

            // 生成静态锚文本块引格式
            const blockRef = `((${blockId} "${title}"))`;

            // 复制到剪贴板
            await navigator.clipboard.writeText(blockRef);
            // showMessage("块引已复制到剪贴板");

        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    // 添加复制事件标题功能
    private async copyEventTitle(calendarEvent: any) {
        try {
            // 获取事件标题（移除可能存在的分类图标前缀）
            let title = calendarEvent.title || i18n("unnamedNote");

            // 移除分类图标（如果存在）
            // 移除分类图标（如果存在）
            if (calendarEvent.extendedProps.categoryId) {
                const categoryIds = calendarEvent.extendedProps.categoryId.split(',');
                for (const id of categoryIds) {
                    const category = this.categoryManager.getCategoryById(id);
                    if (category && category.icon) {
                        const iconPrefix = `${category.icon} `;
                        if (title.startsWith(iconPrefix)) {
                            title = title.substring(iconPrefix.length);
                            break;
                        }
                    }
                }
            }

            // 复制到剪贴板
            await navigator.clipboard.writeText(title);
            showMessage(i18n("eventTitleCopied") || "事件标题已复制到剪贴板");

        } catch (error) {
            console.error('复制事件标题失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    // 添加创建明日副本功能
    private async createCopy(calendarEvent: any, targetDate?: Date) {
        try {
            // 获取事件的原始信息
            const props = calendarEvent.extendedProps;
            const originalId = (props.isRepeated || props.repeat?.enabled) ? props.originalId : calendarEvent.id;

            const reminderData = await this.plugin.loadReminderData();
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(i18n("operationFailed"));
                return;
            }

            // 如果没有指定目标日期，则使用原事件日期
            let dateStr: string;
            if (targetDate) {
                dateStr = getLocalDateString(targetDate);
            } else {
                dateStr = props.date || originalReminder.date;
            }

            // 构造新提醒对象
            const newReminderId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)} `;

            // 复制字段，排除管理字段和实例特有字段
            const newReminder: any = {
                ...originalReminder,
                id: newReminderId,
                date: dateStr,
                completed: false, // 复制出来的始终是未完成
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                notifiedTime: false,
                notifiedCustomTime: false,
                repeat: undefined, // 复制为普通副本，不继承重复性
                parentId: originalReminder.parentId || null
            };

            // 删除实例特有属性和不必要的管理字段
            delete newReminder.isRepeated;
            delete newReminder.originalId;
            delete newReminder.instanceDate;
            delete newReminder.completedTime;
            delete newReminder.notified;

            // 处理跨天事件的时间位移
            if (originalReminder.endDate && targetDate) {
                const originalStart = new Date(originalReminder.date);
                const originalEnd = new Date(originalReminder.endDate);
                const dayDiff = Math.round((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24)); // Wait, 1000*1000 is wrong, it should be 1000*60*60*24

                const newEnd = new Date(targetDate);
                newEnd.setDate(newEnd.getDate() + dayDiff);
                newReminder.endDate = getLocalDateString(newEnd);
            }

            // 保存数据
            reminderData[newReminderId] = newReminder;
            await this.plugin.saveReminderData(reminderData);

            // 如果有绑定块，更新块的书签状态
            if (newReminder.blockId) {
                await updateBindBlockAtrrs(newReminder.blockId, this.plugin);
            }

            // 刷新日历事件
            await this.refreshEvents();
            showMessage(i18n("copyCreated") || "副本已创建");

        } catch (error) {
            console.error('创建副本失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }


    private async setPriority(calendarEvent: any, priority: string) {
        try {
            // 对于重复事件实例，优先修改单个实例的优先级
            if (calendarEvent.extendedProps.isRepeated) {
                // 从 ID 中提取原始实例日期键（格式为 <id>_<date>）
                const originalInstanceDate = (calendarEvent.id) ?
                    (calendarEvent.id.slice(calendarEvent.id.lastIndexOf('_') + 1) || calendarEvent.extendedProps.date) :
                    calendarEvent.extendedProps.date;
                await this.setInstancePriority(calendarEvent.extendedProps.originalId, originalInstanceDate, priority);
                return;
            }

            const reminderId = calendarEvent.id;
            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                reminderData[reminderId].priority = priority;
                await saveReminders(this.plugin, reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

                // 立即刷新事件显示
                await this.refreshEvents();

                const priorityNames = {
                    'high': i18n("high"),
                    'medium': i18n("medium"),
                    'low': i18n("low"),
                    'none': i18n("none")
                };
                showMessage(i18n("prioritySet", { priority: priorityNames[priority] }));
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(i18n("setPriorityFailed"));
        }
    }

    /**
     * 设置重复实例的优先级
     */
    private async setInstancePriority(originalId: string, instanceDate: string, priority: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
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
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

            showMessage(i18n("instanceModified") || "实例已修改");
        } catch (error) {
            console.error('设置实例优先级失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    private async deleteEvent(calendarEvent: any) {


        // 对于重复事件实例，删除的是整个系列
        if (calendarEvent.extendedProps.isRepeated) {
            await confirm(
                i18n("deleteAllInstances"),
                i18n("confirmDelete", { title: calendarEvent.title }),
                () => {
                    this.performDeleteEvent(calendarEvent.extendedProps.originalId);
                }
            );
        } else {
            await confirm(
                i18n("deleteReminder"),
                i18n("confirmDelete", { title: calendarEvent.title }),
                () => {
                    this.performDeleteEvent(calendarEvent.id);
                }
            );
        }
    }

    private async performDeleteEvent(reminderId: string) {
        // 1. 立即从日历 UI 中移除 (Optimistic UI)
        this.calendar.getEvents().forEach(event => {
            if (event.id === reminderId || event.extendedProps.originalId === reminderId) {
                event.remove();
            }
        });

        // 2. 后台处理数据保存和同步
        (async () => {
            try {
                const reminderData = await getAllReminders(this.plugin);

                if (reminderData[reminderId]) {
                    const blockId = reminderData[reminderId].blockId;
                    delete reminderData[reminderId];

                    // 保存数据到存储
                    await saveReminders(this.plugin, reminderData);

                    // 后台更新块属性
                    if (blockId) {
                        try {
                            await updateBindBlockAtrrs(blockId, this.plugin);
                        } catch (err) {
                            console.error('后台更新块属性失败:', err);
                        }
                    }

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                    showMessage(i18n("reminderDeleted"));
                }
            } catch (error) {
                console.error('后台删除提醒过程出错:', error);
                showMessage(i18n("deleteReminderFailed"));
                // 失败时同步数据回滚显示
                await this.refreshEvents();
            }
        })();
    }

    private renderEventContent(eventInfo) {
        const { event, timeText } = eventInfo;
        const props = event.extendedProps;

        // Special rendering for Pomodoro events
        if (props.type === 'pomodoro') {
            const mainFrame = document.createElement('div');
            mainFrame.className = 'fc-event-main-frame';
            mainFrame.style.padding = '2px 4px';

            if (timeText) {
                const timeEl = document.createElement('div');
                timeEl.className = 'fc-event-time';
                timeEl.textContent = timeText;
                mainFrame.appendChild(timeEl);
            }

            const titleEl = document.createElement('div');
            titleEl.className = 'fc-event-title';
            titleEl.textContent = event.title;
            mainFrame.appendChild(titleEl);

            return { domNodes: [mainFrame] };
        }

        // 创建主容器
        const mainFrame = document.createElement('div');
        mainFrame.className = 'fc-event-main-frame';
        mainFrame.setAttribute('data-event-id', event.id);

        // 顶部行：放置复选框和任务标题（同一行）
        const topRow = document.createElement('div');
        topRow.className = 'reminder-event-top-row';

        // 1. 复选框 or 订阅图标
        if (props.isSubscribed) {
            const subIcon = document.createElement('span');
            subIcon.innerHTML = '🗓';
            subIcon.title = i18n("subscribedTaskReadOnly") || "订阅任务（只读）";
            subIcon.style.width = '14px';
            subIcon.style.height = '14px';
            subIcon.style.display = 'flex';
            subIcon.style.alignItems = 'center';
            subIcon.style.justifyContent = 'center';
            subIcon.style.fontSize = '12px';
            subIcon.style.flexShrink = '0';
            topRow.appendChild(subIcon);
        } else {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'reminder-calendar-event-checkbox';
            checkbox.checked = props.completed || false;
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleEventCompleted(event);
            });
            topRow.appendChild(checkbox);
        }

        // 2. 任务标题（与复选框同行）
        const titleEl = document.createElement('div');
        titleEl.className = 'fc-event-title';

        // 如果有绑定块，将内容包裹在 span 中并添加虚线边框
        if (props.blockId && !props.isSubscribed) {
            const textSpan = document.createElement('span');
            const textColor = (event && event.textColor) ? event.textColor : '#fff';
            textSpan.innerHTML = event.title;
            textSpan.style.display = 'inline-block';
            textSpan.style.boxSizing = 'border-box';
            textSpan.style.paddingBottom = '2px';
            textSpan.style.borderBottom = `2px dashed currentColor `;
            textSpan.style.cursor = 'pointer';
            textSpan.title = '已绑定块';

            let hoverTimeout: number | null = null;

            // 添加悬浮事件显示块引弹窗（延迟500ms）
            textSpan.addEventListener('mouseenter', () => {
                if (this.isDragging) return;
                hoverTimeout = window.setTimeout(() => {
                    const rect = textSpan.getBoundingClientRect();
                    this.plugin.addFloatLayer({
                        refDefs: [{ refID: props.blockId, defIDs: [] }],
                        x: rect.left,
                        y: rect.top - 70,
                        isBacklink: false
                    });
                }, 500);
            });

            // 鼠标离开时清除延迟
            textSpan.addEventListener('mouseleave', () => {
                if (hoverTimeout !== null) {
                    window.clearTimeout(hoverTimeout);
                    hoverTimeout = null;
                }
            });

            titleEl.appendChild(textSpan);
        } else {
            // 没有绑定块时，直接设置 innerHTML
            titleEl.innerHTML = event.title;
        }

        topRow.appendChild(titleEl);

        mainFrame.appendChild(topRow);

        // 3. 指标行：放置状态图标
        const indicatorsRow = document.createElement('div');
        indicatorsRow.className = 'reminder-event-indicators-row';

        // 分类图标 (订阅图标已移至顶部复选框位置)
        // 分类图标 (订阅图标已移至顶部复选框位置)
        if (this.showCategoryAndProject && !props.isSubscribed && props.categoryId) {
            const categoryIds = props.categoryId.split(',');
            categoryIds.forEach(id => {
                const category = this.categoryManager.getCategoryById(id);
                if (category && category.icon) {
                    const catIcon = document.createElement('span');
                    catIcon.className = 'reminder-event-icon';
                    catIcon.innerHTML = category.icon;
                    catIcon.title = category.name;
                    indicatorsRow.appendChild(catIcon);
                }
            });
        }

        // 重复图标
        if (props.isRepeated || props.repeat?.enabled) {
            const repeatIcon = document.createElement('span');
            repeatIcon.className = 'reminder-event-icon';
            if (props.isRepeated) {
                repeatIcon.innerHTML = '🔄';
                repeatIcon.title = i18n("repeatInstance");
            } else {
                repeatIcon.innerHTML = '🔁';
                repeatIcon.title = i18n("repeatSeries");
            }
            indicatorsRow.appendChild(repeatIcon);
        }

        // 只有当有图标时才添加指标行
        if (indicatorsRow.children.length > 0) {
            mainFrame.appendChild(indicatorsRow);
        }

        // 4. 显示标签：项目名、自定义分组名、文档名或父任务名
        let labelText = '';
        let labelColor = '';

        // 如果是子任务，优先显示父任务信息
        if (props.parentId && props.parentTitle) {
            labelText = `↪️ 父任务: ${props.parentTitle}`;
        }

        if (this.showCategoryAndProject) {
            if (props.projectId) {
                // 如果有项目，显示项目名（带📂图标）
                const project = this.projectManager.getProjectById(props.projectId);
                if (project) {
                    const projectText = `📂 ${project.name} `;
                    labelColor = this.projectManager.getProjectColor(props.projectId);

                    // 如果有自定义分组，显示"项目/自定义分组"（使用预加载的名称）
                    if (props.customGroupId && props.customGroupName) {
                        labelText = `📂 ${project.name} / ${props.customGroupName}`;
                    } else {
                        labelText = projectText;
                    }
                }
            } else if (props.docTitle && props.docId && props.blockId && props.docId !== props.blockId) {
                // 如果没有项目，且绑定块是块而不是文档，显示文档名（带📄图标）
                labelText = `📄 ${props.docTitle}`;
            }
        }

        if (labelText) {
            const labelEl = document.createElement('div');
            labelEl.className = 'reminder-event-label';
            labelEl.textContent = labelText;

            // 如果有项目颜色，应用颜色样式
            if (labelColor) {
                labelEl.style.cssText = `
                    background-color: rgba(from ${labelColor} r g b / .3);
                    color: white;
                    padding: 2px 6px;
                    border-radius: 3px;
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    word-break: break-all;
                    font-size: 11px;
                    margin-top: 2px;
                    line-height: 1.2;
                `;
            }

            mainFrame.appendChild(labelEl);
        }

        // 5. 时间 (使用内置类名和 timeText) - 放在标题之后，空间不足时自动隐藏
        if (!event.allDay && timeText) {
            const timeEl = document.createElement('div');
            timeEl.className = 'fc-event-time';
            timeEl.textContent = timeText;
            mainFrame.appendChild(timeEl);
        }

        // 6. 备注
        if (props.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-event-note';
            noteEl.innerHTML = this.lute ? this.lute.Md2HTML(props.note) : props.note;
            mainFrame.appendChild(noteEl);
        }

        return { domNodes: [mainFrame] };
    }

    // ...existing code...

    private async toggleEventCompleted(event) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (event.extendedProps.isRepeated) {
                // 处理重复事件实例
                const originalId = event.extendedProps.originalId;
                const instanceIdStr = event.id || '';
                const instanceDate = instanceIdStr.split('_').pop() || event.extendedProps.date;

                if (reminderData[originalId]) {
                    // 初始化已完成实例列表
                    if (!reminderData[originalId].repeat) {
                        reminderData[originalId].repeat = {};
                    }
                    if (!reminderData[originalId].repeat.completedInstances) {
                        reminderData[originalId].repeat.completedInstances = [];
                    }
                    // 初始化完成时间记录
                    if (!reminderData[originalId].repeat.completedTimes) {
                        reminderData[originalId].repeat.completedTimes = {};
                    }

                    const completedInstances = reminderData[originalId].repeat.completedInstances;
                    const completedTimes = reminderData[originalId].repeat.completedTimes;
                    const isInstanceCompleted = completedInstances.includes(instanceDate);

                    if (isInstanceCompleted) {
                        // 从已完成列表中移除并删除完成时间
                        const index = completedInstances.indexOf(instanceDate);
                        if (index > -1) {
                            completedInstances.splice(index, 1);
                        }
                        delete completedTimes[instanceDate];
                    } else {
                        // 添加到已完成列表并记录完成时间
                        completedInstances.push(instanceDate);
                        completedTimes[instanceDate] = getLocalDateTimeString(new Date());
                    }

                    await saveReminders(this.plugin, reminderData);

                    // 更新块的书签状态
                    const blockId = reminderData[originalId].blockId;
                    if (blockId) {
                        await updateBindBlockAtrrs(blockId, this.plugin);
                        // 完成时自动处理任务列表
                        if (!isInstanceCompleted) {
                            await this.handleTaskListCompletion(blockId);
                        } else {
                            await this.handleTaskListCompletionCancel(blockId);
                        }
                    }

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

                    // 立即刷新事件显示
                    await this.refreshEvents();
                }
            } else {
                // 处理普通事件
                const reminderId = event.id;

                if (reminderData[reminderId]) {
                    const blockId = reminderData[reminderId].blockId;
                    const newCompletedState = !reminderData[reminderId].completed;

                    reminderData[reminderId].completed = newCompletedState;

                    // 记录或清除完成时间
                    if (newCompletedState) {
                        reminderData[reminderId].completedTime = getLocalDateTimeString(new Date());
                    } else {
                        delete reminderData[reminderId].completedTime;
                    }

                    await saveReminders(this.plugin, reminderData);

                    // 更新块的书签状态
                    if (blockId) {
                        await updateBindBlockAtrrs(blockId, this.plugin);
                        // 完成时自动处理任务列表
                        if (newCompletedState) {
                            await this.handleTaskListCompletion(blockId);
                        } else {
                            await this.handleTaskListCompletionCancel(blockId);
                        }
                    }

                    // 更新事件的显示状态
                    event.setExtendedProp('completed', newCompletedState);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

                    // 立即刷新事件显示
                    await this.refreshEvents();
                }
            }
        } catch (error) {
            console.error('切换事件完成状态失败:', error);
            showMessage('切换完成状态失败，请重试');
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

            // 4. 将 ^- {: xxx}[ ] 替换为 ^- {: xxx}[X]
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
     * 处理任务列表的取消完成功能
     * 当取消完成时间提醒事项时，检测是否为待办事项列表，如果是则自动取消勾选
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

            // 4. 将 ^- {: xxx}[X] 替换为 ^- {: xxx}[ ]
            // 重置正则表达式的 lastIndex
            taskPattern.lastIndex = 0;
            const updatedKramdown = kramdown.replace(
                /^(-\s*\{:[^}]*\})\[X\]/gm,
                '$1[ ]'
            );

            // 5. 更新块内容
            await this.updateBlockWithKramdown(blockId, updatedKramdown);

        } catch (error) {
            console.error('处理任务列表取消完成状态失败:', error);
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

    private startAllDayDragTracking(info: any) {
        const event = info.event;
        if (!event.allDay) return;

        this.forceHideTooltip();

        this.allDayDragState = {
            draggedEvent: event,
            targetEvent: null,
            isAbove: false,
            date: getLocalDateString(event.start)
        };

        this.allDayDragListener = (e: MouseEvent) => this.handleAllDayDragMove(e);
        window.addEventListener('mousemove', this.allDayDragListener);
    }

    private async stopAllDayDragTracking(info?: any) {
        if (!this.allDayDragState) return;

        // 1. 立即移除监听器，切断未来的所有输入流
        if (this.allDayDragListener) {
            window.removeEventListener('mousemove', this.allDayDragListener);
            this.allDayDragListener = null;
        }

        // 2. 最后一次同步释放点（即使失败也不影响后续清理）
        if (info && info.jsEvent) {
            try {
                // 注意：此时 isLocked 是 false，允许最后一次更新位置
                this.handleAllDayDragMove(info.jsEvent);
            } catch (err) {
                console.warn('Final drag sync failed:', err);
            }
        }

        // 3. 彻底锁定状态并显示层断开
        this.isAllDayReordering = true;
        this.allDayDragState.isLocked = true;
        this.hideDropIndicator();

        const stateToProcess = { ...this.allDayDragState };

        // 4. 执行异步重排序
        if (stateToProcess.targetEvent) {
            try {
                await this.handleAllDayReorder(stateToProcess);
            } finally {
                this.isAllDayReordering = false;
                this.allDayDragState = null;
            }
        } else {
            this.isAllDayReordering = false;
            this.allDayDragState = null;
        }
    }

    private handleAllDayDragMove(e: MouseEvent) {
        // 如果状态已锁定或监听器已移除，停止处理，确保位置不再变化
        if (!this.allDayDragState || this.allDayDragState.isLocked) return;
        // 如果不是在 stop 阶段主动调用的同步，且监听器已不存在，则返回
        if (!this.allDayDragListener && (!this.isDragging)) return;

        // 查找鼠标下的事件 harness
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const harness = el?.closest('.fc-daygrid-event-harness') as HTMLElement;

        if (harness) {
            const mainFrame = harness.querySelector('.fc-event-main-frame');
            const eventId = mainFrame?.getAttribute('data-event-id');

            // 排除正在拖动的事件自身
            if (eventId && eventId !== this.allDayDragState.draggedEvent.id) {
                const rect = harness.getBoundingClientRect();
                const isAbove = e.clientY < rect.top + rect.height / 2;

                const dayCell = harness.closest('.fc-daygrid-day') as HTMLElement;
                const cellDate = dayCell?.getAttribute('data-date');

                if (cellDate) {
                    this.allDayDragState.targetEvent = { id: eventId, el: harness };
                    this.allDayDragState.isAbove = isAbove;
                    this.allDayDragState.date = cellDate;

                    this.showAllDayDropIndicator(harness, isAbove);
                    return;
                }
            }
        }

        // 如果不在 harness 上，检查是否在日期单元格上
        const dayCell = el?.closest('.fc-daygrid-day') as HTMLElement;
        const cellDate = dayCell?.getAttribute('data-date');
        if (cellDate) {
            this.allDayDragState.date = cellDate;
        }

        this.allDayDragState.targetEvent = null;
        this.hideDropIndicator();
    }

    private showAllDayDropIndicator(harness: HTMLElement, isAbove: boolean) {
        // 如果已锁定或状态已清理，严禁显示指示器
        if (!this.allDayDragState || this.allDayDragState.isLocked) return;

        if (!this.dropIndicator) {
            this.dropIndicator = document.createElement('div');
            this.dropIndicator.className = 'calendar-drop-indicator all-day-reorder-indicator';
            document.body.appendChild(this.dropIndicator);
        }

        const rect = harness.getBoundingClientRect();
        this.dropIndicator.style.display = 'block';
        this.dropIndicator.style.width = `${rect.width}px`;
        this.dropIndicator.style.height = '2px';
        this.dropIndicator.style.backgroundColor = 'var(--b3-theme-primary)';
        this.dropIndicator.style.position = 'fixed';
        this.dropIndicator.style.left = `${rect.left}px`;
        this.dropIndicator.style.top = isAbove ? `${rect.top}px` : `${rect.bottom}px`;
        this.dropIndicator.style.zIndex = '10000';
    }

    private async handleAllDayReorder(state: any) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const draggedId = (() => {
                const d = state.draggedEvent.id || '';
                const idx = d.lastIndexOf('_');
                return idx !== -1 ? d.slice(0, idx) : d;
            })();
            // 判断是否为重复实例，并提取原始实例日期
            const isDraggedInstance = state.draggedEvent.extendedProps?.isRepeated;
            const draggedInstanceDate = isDraggedInstance ? state.draggedEvent.id.split('_').pop() : null;

            const targetDate = state.date;

            // 获取该日期的所有全天事件实例，从而找出该天显示的所有模板
            // 这样可以正确处理重复事件的排序
            const calendarEvents = this.calendar.getEvents().filter(e => {
                const eDate = getLocalDateString(e.start);
                return eDate === targetDate && e.allDay;
            });

            // 获取对应的提醒数据模板 ID (去重)
            const dayTemplateIds = Array.from(new Set(calendarEvents.map(e => {
                return e.extendedProps.originalId || e.id;
            })));

            const dayEvents = dayTemplateIds.map(id => reminderData[id]).filter(r => !!r);

            // 按当前可见顺序排序 (优先级优先，sort 其次)
            dayEvents.sort((a, b) => {
                const priorityMap: { [key: string]: number } = {
                    'high': 0,
                    'medium': 1,
                    'low': 2,
                    'none': 3
                };
                const scoreA = priorityMap[a.priority || 'none'] ?? 3;
                const scoreB = priorityMap[b.priority || 'none'] ?? 3;
                if (scoreA !== scoreB) return scoreA - scoreB;
                return (a.sort || 0) - (b.sort || 0);
            });

            // 获取当前拖拽的提醒模板
            const currentEvent = reminderData[draggedId];
            if (!currentEvent) return;

            // 如果日期改变了，更新模板日期（处理跨天拖拽重排序）
            // 对于重复实例，不修改原始任务的日期
            if (!isDraggedInstance) {
                const oldDate = currentEvent.date || '';
                if (oldDate !== targetDate) {
                    currentEvent.date = targetDate;
                    if (currentEvent.endDate) {
                        const diff = getDaysDifference(oldDate, targetDate);
                        currentEvent.endDate = addDaysToDate(currentEvent.endDate, diff);
                    }
                }
            }

            // 从待排序列表中移除当前事件
            const filteredEvents = dayEvents.filter(r => r.id !== draggedId);

            let newList: any[] = [];
            if (state.targetEvent) {
                const targetId = (() => {
                    const t = state.targetEvent.id || '';
                    const idx = t.lastIndexOf('_');
                    return idx !== -1 ? t.slice(0, idx) : t;
                })();

                const targetIndex = filteredEvents.findIndex(r => r.id === targetId);
                if (targetIndex !== -1) {
                    // 计算插入位置
                    const insertPos = state.isAbove ? targetIndex : targetIndex + 1;
                    newList = [...filteredEvents.slice(0, insertPos), currentEvent, ...filteredEvents.slice(insertPos)];

                    // --- 核心改进：根据插入位置自动调整优先级 ---
                    // 逻辑：使被拖拽的任务优先级与它落点周围的任务一致
                    // 如果列表只有一个，或者放在了首/尾，则参考邻居
                    // 如果放在两个任务中间，则根据当前可见的排序规则调整
                    if (state.isAbove) {
                        // 拖动到了 targetEvent 的上方
                        const targetEventInList = filteredEvents[targetIndex];
                        currentEvent.priority = targetEventInList.priority || 'none';
                    } else {
                        // 拖动到了 targetEvent 的下方
                        const targetEventInList = filteredEvents[targetIndex];
                        currentEvent.priority = targetEventInList.priority || 'none';
                    }
                } else {
                    newList = [...filteredEvents, currentEvent];
                }
            } else {
                newList = [...filteredEvents, currentEvent];
            }

            // 分配新的 sort 值
            // 注意：为了让 FullCalendar 的 eventOrder (priority-first) 表现正常，
            // 我们需要对全天列表在相同优先级块内部重新赋予递增的 sort
            let currentPriority = '';
            let prioritySort = 0;
            newList.forEach((r) => {
                if (r) {
                    const p = r.priority || 'none';
                    if (p !== currentPriority) {
                        currentPriority = p;
                        prioritySort = 0;
                    }
                    // 对于重复实例，将 sort 存储到 instanceModifications 中
                    if (isDraggedInstance && r.id === draggedId && draggedInstanceDate) {
                        if (!r.repeat) r.repeat = {};
                        if (!r.repeat.instanceModifications) r.repeat.instanceModifications = {};
                        if (!r.repeat.instanceModifications[draggedInstanceDate]) {
                            r.repeat.instanceModifications[draggedInstanceDate] = {};
                        }
                        r.repeat.instanceModifications[draggedInstanceDate].sort = prioritySort++;
                    } else {
                        r.sort = prioritySort++;
                    }
                }
            });

            await saveReminders(this.plugin, reminderData);

            // 刷新日历以应用新顺序
            await this.refreshEvents();

            // 通知外部更新
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

        } catch (error) {
            console.error('全天事件重排序失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    private async handleEventClick(info) {
        // 如果正在拖动，不触发点击事件
        if (this.isDragging) {
            return;
        }

        // Pomodoro events should act as read-only in click handler
        // Right-click context menu is available for them
        if (info.event.extendedProps.type === 'pomodoro') {
            return;
        }

        const reminder = info.event.extendedProps;
        const blockId = reminder.blockId || info.event.id; // 兼容旧数据格式

        // 如果没有绑定块，提示用户绑定块 (订阅任务除外)
        if (!reminder.blockId) {
            if (reminder.isSubscribed) {
                showMessage(i18n("subscribedTaskReadOnly") || "订阅任务（只读）");
            } else {
                showMessage(i18n("unboundReminder") + "，请右键选择\"绑定到块\"");
            }
            return;
        }

        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开笔记失败:', error);

            // 询问用户是否删除无效的提醒
            await confirm(
                i18n("openNoteFailedDelete"),
                i18n("noteBlockDeleted"),
                async () => {
                    // 删除当前提醒
                    await this.performDeleteEvent(info.event.id);
                },
                () => {
                    showMessage(i18n("openNoteFailed"));
                }
            );
        }
    }

    private async handleEventDrop(info) {
        // 如果正在进行全天重排序，直接跳过通用的 eventDrop 处理
        if (this.isAllDayReordering || (this.allDayDragState && this.allDayDragState.targetEvent)) {
            return;
        }

        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例
        if (originalReminder.isRepeated) {
            const originalId = originalReminder.originalId;
            // 修正：从 ID 中提取原始实例日期键（格式为 <id>_<date>）
            const instanceDate = (info.event.id) ?
                (info.event.id.slice(info.event.id.lastIndexOf('_') + 1) || originalReminder.date) :
                originalReminder.date;

            const reminderData = await getAllReminders(this.plugin);
            const originalEvent = reminderData[originalId];
            const isAlreadyModified = originalEvent?.repeat?.instanceModifications?.[instanceDate];

            // 如果实例已经被修改过,直接更新该实例,不再询问
            if (isAlreadyModified) {
                await this.updateSingleInstance(info);
                return;
            }

            // 否则询问用户如何应用更改
            const result = await this.askApplyToAllInstances();

            if (result === 'cancel') {
                info.revert();
                return;
            }

            if (result === 'single') {
                // 只更新当前实例
                await this.updateSingleInstance(info);
                return;
            }

            if (result === 'all') {
                // 更新此实例及所有未来实例
                await this.updateRecurringEventSeries(info);
                return;
            }
        } else {
            // 非重复事件，或重复事件的原始事件，直接更新
            await this.updateEventTime(reminderId, info, false);
            try { window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } })); } catch (err) { /* ignore */ }
        }
    }

    private async handleEventResize(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例
        if (originalReminder.isRepeated) {
            const originalId = originalReminder.originalId;
            // 修正：从 ID 中提取原始实例日期键（格式为 <id>_<date>）
            const instanceDate = (info.event.id) ?
                (info.event.id.slice(info.event.id.lastIndexOf('_') + 1) || originalReminder.date) :
                originalReminder.date;

            const reminderData = await getAllReminders(this.plugin);
            const originalEvent = reminderData[originalId];
            const isAlreadyModified = originalEvent?.repeat?.instanceModifications?.[instanceDate];

            // 如果实例已经被修改过,直接更新该实例,不再询问
            if (isAlreadyModified) {
                await this.updateSingleInstance(info);
                return;
            }

            // 否则询问用户如何应用更改
            const result = await this.askApplyToAllInstances();

            if (result === 'cancel') {
                info.revert();
                return;
            }

            if (result === 'single') {
                // 只更新当前实例
                await this.updateSingleInstance(info);
                return;
            }

            if (result === 'all') {
                // 更新此实例及所有未来实例
                await this.updateRecurringEventSeries(info);
                return;
            }
        } else {
            // 非重复事件，或重复事件的原始事件，直接更新
            await this.updateEventTime(reminderId, info, true);
            try { window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } })); } catch (err) { /* ignore */ }
        }
    }

    /**
     * 处理事件移动和调整大小时的吸附逻辑
     * 当任务拖动到当前时间附近时，自动吸附到当前时间
     */
    private handleEventAllow(dropInfo: any, draggedEvent: any): boolean {
        const view = this.calendar.view;

        // 只在周视图和日视图中启用当前时间吸附
        if (view.type !== 'timeGridWeek' && view.type !== 'timeGridDay' && view.type !== 'timeGridMultiDays7') {
            return true;
        }

        // 全天事件不需要吸附到当前时间
        if (draggedEvent.allDay) {
            return true;
        }

        const now = new Date();
        const dropStart = dropInfo.start;

        // 计算拖动目标时间与当前时间的差值（毫秒）
        const timeDiff = Math.abs(dropStart.getTime() - now.getTime());
        const minutesDiff = timeDiff / (1000 * 60);

        // 如果差值小于10分钟，吸附到当前时间
        if (minutesDiff < 10) {
            // 计算事件的持续时间
            const duration = draggedEvent.end ? draggedEvent.end.getTime() - draggedEvent.start.getTime() : 0;

            // 修改dropInfo的开始时间为当前时间
            dropInfo.start = new Date(now);

            // 如果有结束时间，保持持续时间不变
            if (duration > 0) {
                dropInfo.end = new Date(now.getTime() + duration);
            }
        }

        return true;
    }

    /**
     * 添加滚轮缩放监听器
     * 支持在周视图和日视图中按住Ctrl+滚轮放大缩小时间刻度
     * 缩放时以鼠标位置为中心,保持鼠标所在时间点的相对位置不变
     */
    private addWheelZoomListener(calendarEl: HTMLElement) {
        const slotDurations = ['00:05:00', '00:15:00', '00:30:00', '01:00:00']; // 5分钟、15分钟、30分钟、1小时
        let currentSlotIndex = 1; // 默认15分钟

        calendarEl.addEventListener('wheel', (e: WheelEvent) => {
            // 只在按住Ctrl键时处理
            if (!e.ctrlKey) {
                return;
            }

            const view = this.calendar.view;

            // 只在周视图和日视图中启用缩放
            if (view.type !== 'timeGridWeek' && view.type !== 'timeGridDay' && view.type !== 'timeGridMultiDays7') {
                return;
            }

            e.preventDefault();

            // 获取时间网格滚动容器
            const timeGridScroller = calendarEl.querySelector('.fc-scroller.fc-scroller-liquid-absolute') as HTMLElement;
            if (!timeGridScroller) {
                console.warn('未找到时间网格滚动容器');
                return;
            }

            // 获取缩放前的滚动位置和鼠标相对位置
            const scrollTop = timeGridScroller.scrollTop;
            const mouseY = e.clientY;
            const scrollerRect = timeGridScroller.getBoundingClientRect();
            const relativeMouseY = mouseY - scrollerRect.top + scrollTop;

            // 根据滚轮方向调整时间刻度
            const oldSlotIndex = currentSlotIndex;
            if (e.deltaY < 0) {
                // 向上滚动 - 放大（减小时间间隔）
                if (currentSlotIndex > 0) {
                    currentSlotIndex--;
                }
            } else {
                // 向下滚动 - 缩小（增大时间间隔）
                if (currentSlotIndex < slotDurations.length - 1) {
                    currentSlotIndex++;
                }
            }

            // 如果刻度没有变化,直接返回
            if (oldSlotIndex === currentSlotIndex) {
                return;
            }

            // 更新日历的时间刻度
            this.calendar.setOption('slotDuration', slotDurations[currentSlotIndex]);

            // 使用双重 requestAnimationFrame 确保 DOM 完全更新后再调整滚动位置
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const newTimeGridScroller = calendarEl.querySelector('.fc-scroller.fc-scroller-liquid-absolute') as HTMLElement;
                    if (!newTimeGridScroller) return;

                    // 计算缩放比例 (注意: 时间间隔越小,内容高度越大,所以是反比关系)
                    const oldDuration = this.parseDuration(slotDurations[oldSlotIndex]);
                    const newDuration = this.parseDuration(slotDurations[currentSlotIndex]);
                    const zoomRatio = oldDuration / newDuration; // 反比关系

                    // 计算新的滚动位置,使鼠标位置对应的时间点保持在相同的相对位置
                    const newScrollTop = relativeMouseY * zoomRatio - (mouseY - scrollerRect.top);

                    newTimeGridScroller.scrollTop = newScrollTop;
                });
            });
        }, { passive: false });
    }

    /**
     * 解析时间字符串为分钟数
     * @param duration 格式如 '00:15:00'
     */
    private parseDuration(duration: string): number {
        const parts = duration.split(':');
        const hours = parseInt(parts[0], 10);
        const minutes = parseInt(parts[1], 10);
        return hours * 60 + minutes;
    }

    /**
     * 将日期的分钟数吸附到指定步长（默认5分钟）
     * @param date 要吸附的日期
     * @param step 分钟步长，默认为5
     */
    private snapToMinutes(date: Date, step: number = 5): Date {
        try {
            const d = new Date(date);
            const minutes = d.getMinutes();
            const snapped = Math.round(minutes / step) * step;
            d.setMinutes(snapped, 0, 0);
            return d;
        } catch (err) {
            return date;
        }
    }

    private async updateRecurringEventSeries(info: any) {
        try {
            const originalId = info.event.extendedProps.originalId;
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                throw new Error('Original reminder not found.');
            }

            const oldInstanceDateStr = info.oldEvent.startStr.split('T')[0];
            const originalSeriesStartDate = new Date(originalReminder.date + 'T00:00:00Z');
            const movedInstanceOriginalDate = new Date(oldInstanceDateStr + 'T00:00:00Z');

            // 如果用户拖动了系列中的第一个事件，我们将更新整个系列的开始日期
            if (originalSeriesStartDate.getTime() === movedInstanceOriginalDate.getTime()) {
                await this.updateEventTime(originalId, info, info.event.end !== info.oldEvent.end);
                return;
            }

            // 用户拖动了后续实例。我们必须"分割"系列。
            // 1. 在拖动实例原始日期的前一天结束原始系列。
            const untilDate = new Date(oldInstanceDateStr + 'T12:00:00Z'); // 使用中午以避免夏令时问题
            untilDate.setUTCDate(untilDate.getUTCDate() - 1);
            const newEndDateStr = getLocalDateString(untilDate);

            // 根据用户反馈，使用 `repeat.endDate` 而不是 `repeat.until` 来终止系列。
            // 保存原始 series 的原始 endDate（如果有）以便在新系列中保留
            const originalSeriesEndDate = originalReminder.repeat?.endDate;
            if (!originalReminder.repeat) { originalReminder.repeat = {}; }
            originalReminder.repeat.endDate = newEndDateStr;

            // 2. 为新的、修改过的系列创建一个新的重复事件。
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒以开始新的生命周期。
            // 对于新系列，保留原始系列的 endDate（如果有），以避免丢失用户设置的结束日期。
            if (originalSeriesEndDate) {
                newReminder.repeat.endDate = originalSeriesEndDate;
            } else {
                delete newReminder.repeat.endDate;
            }
            // 同时清除旧系列的实例特定数据。
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 使用生成新的提醒ID
            const newId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newReminder.id = newId;

            // 3. 根据拖放信息更新这个新系列的日期/时间。
            const newStart = info.event.start;
            const newEnd = info.event.end;

            const { dateStr, timeStr } = getLocalDateTime(newStart);
            newReminder.date = dateStr; // 这是新系列的开始日期

            if (info.event.allDay) {
                delete newReminder.time;
                delete newReminder.endTime;
                delete newReminder.endDate; // 重置并在下面重新计算
            } else {
                newReminder.time = timeStr || null;
            }

            if (newEnd) {
                if (info.event.allDay) {
                    const inclusiveEnd = new Date(newEnd);
                    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
                    const { dateStr: endDateStr } = getLocalDateTime(inclusiveEnd);
                    if (endDateStr !== newReminder.date) {
                        newReminder.endDate = endDateStr;
                    }
                } else {
                    const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEnd);
                    if (endDateStr !== newReminder.date) {
                        newReminder.endDate = endDateStr;
                    } else {
                        delete newReminder.endDate;
                    }
                    newReminder.endTime = endTimeStr || null;
                }
            } else {
                delete newReminder.endDate;
                delete newReminder.endTime;
            }

            // 4. 保存修改后的原始提醒和新的提醒。
            reminderData[originalId] = originalReminder;
            reminderData[newId] = newReminder;
            await saveReminders(this.plugin, reminderData);

            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

        } catch (error) {
            console.error('更新重复事件系列失败:', error);
            showMessage(i18n("operationFailed"));
            info.revert();
        }
    }

    private async askApplyToAllInstances(): Promise<'single' | 'all' | 'cancel'> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: i18n("modifyRepeatEvent"),
                content: `
                    <div class="b3-dialog__content">
                        <div style="margin-bottom: 16px;">${i18n("howToApplyChanges")}</div>
                        <div class="fn__flex fn__flex-justify-center" style="gap: 8px;">
                            <button class="b3-button" id="btn-single">${i18n("onlyThisInstance")}</button>
                            <button class="b3-button b3-button--primary" id="btn-all">${i18n("allInstances")}</button>
                            <button class="b3-button b3-button--cancel" id="btn-cancel">${i18n("cancel")}</button>
                        </div>
                    </div>
                `,
                width: "400px",
                height: "auto"
            });

            // 等待对话框渲染完成后添加事件监听器
            setTimeout(() => {
                const singleBtn = dialog.element.querySelector('#btn-single');
                const allBtn = dialog.element.querySelector('#btn-all');
                const cancelBtn = dialog.element.querySelector('#btn-cancel');

                if (singleBtn) {
                    singleBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('single');
                    });
                }

                if (allBtn) {
                    allBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('all');
                    });
                }

                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('cancel');
                    });
                }

                // 处理对话框关闭事件
                const closeBtn = dialog.element.querySelector('.b3-dialog__close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => {
                        dialog.destroy();
                        resolve('cancel');
                    });
                }
            }, 100);
        });
    }

    private async updateSingleInstance(info) {
        try {
            const originalId = info.event.extendedProps.originalId;
            // 从 instanceId 提取原始日期（格式：originalId_YYYY-MM-DD）
            const originalInstanceDate = info.event.id ? info.event.id.split('_').pop() : info.event.extendedProps.date;
            let newStartDate = info.event.start;
            let newEndDate = info.event.end;

            // 吸附到5分钟步长，避免出现诸如 19:03 的时间
            if (newStartDate && !info.event.allDay) {
                newStartDate = this.snapToMinutes(newStartDate, 5);
            }
            if (newEndDate && !info.event.allDay) {
                newEndDate = this.snapToMinutes(newEndDate, 5);
            }

            // 检查是否需要重置通知状态
            const shouldResetNotified = this.shouldResetNotification(newStartDate, info.event.allDay);

            // 创建实例修改数据
            const instanceModification: any = {
                title: info.event.title.replace(/^🔄 /, ''), // 移除重复标识
                priority: info.event.extendedProps.priority,
                note: info.event.extendedProps.note,
                notified: shouldResetNotified ? false : info.event.extendedProps.notified
            };

            // 使用本地时间处理日期和时间
            const { dateStr: startDateStr, timeStr: startTimeStr } = getLocalDateTime(newStartDate);

            if (newEndDate) {
                if (info.event.allDay) {
                    // 全天事件：FullCalendar 的结束日期是排他的，需要减去一天
                    const endDate = new Date(newEndDate);
                    endDate.setDate(endDate.getDate() - 1);
                    const { dateStr: endDateStr } = getLocalDateTime(endDate);

                    instanceModification.date = startDateStr;
                    if (endDateStr !== startDateStr) {
                        instanceModification.endDate = endDateStr;
                    }
                } else {
                    // 定时事件
                    const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEndDate);

                    instanceModification.date = startDateStr;
                    if (startTimeStr) {
                        instanceModification.time = startTimeStr;
                    }

                    if (endDateStr !== startDateStr) {
                        instanceModification.endDate = endDateStr;
                        if (endTimeStr) {
                            instanceModification.endTime = endTimeStr;
                        }
                    } else {
                        if (endTimeStr) {
                            instanceModification.endTime = endTimeStr;
                        }
                    }
                }
            } else {
                // 单日事件
                instanceModification.date = startDateStr;
                if (!info.event.allDay && startTimeStr) {
                    instanceModification.time = startTimeStr;
                }
            }

            // 保存实例修改
            await this.saveInstanceModification({
                originalId,
                instanceDate: originalInstanceDate, // 使用从 instanceId 提取的原始日期
                ...instanceModification
            });

            showMessage(i18n("instanceTimeUpdated"));
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

        } catch (error) {
            console.error('更新单个实例失败:', error);
            showMessage(i18n("updateInstanceFailed"));
            info.revert();
        }
    }

    private async updateEventTime(reminderId: string, info, isResize: boolean) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                let newStartDate = info.event.start;
                let newEndDate = info.event.end;

                // 吸附到5分钟步长，避免出现诸如 19:03 的时间
                if (newStartDate && !info.event.allDay) {
                    newStartDate = this.snapToMinutes(newStartDate, 5);
                }
                if (newEndDate && !info.event.allDay) {
                    newEndDate = this.snapToMinutes(newEndDate, 5);
                }

                // 如果是将全天事件拖动为定时事件，FullCalendar 可能不会提供 end。
                // 在这种情况下默认使用 1 小时时长，避免刷新后事件变短。
                if (!newEndDate && !info.event.allDay && info.oldEvent && info.oldEvent.allDay) {
                    newEndDate = new Date(newStartDate.getTime() + 60 * 60 * 1000); // 默认 1 小时
                    newEndDate = this.snapToMinutes(newEndDate, 5);
                }

                // 使用本地时间处理日期和时间
                const { dateStr: startDateStr, timeStr: startTimeStr } = getLocalDateTime(newStartDate);

                // 检查是否需要重置通知状态
                const shouldResetNotified = this.shouldResetNotification(newStartDate, info.event.allDay);

                if (newEndDate) {
                    if (info.event.allDay) {
                        // 全天事件：FullCalendar 的结束日期是排他的，需要减去一天
                        const endDate = new Date(newEndDate);
                        endDate.setDate(endDate.getDate() - 1);
                        const { dateStr: endDateStr } = getLocalDateTime(endDate);

                        reminderData[reminderId].date = startDateStr;

                        if (endDateStr !== startDateStr) {
                            reminderData[reminderId].endDate = endDateStr;
                        } else {
                            delete reminderData[reminderId].endDate;
                        }

                        // 全天事件删除时间信息
                        delete reminderData[reminderId].time;
                        delete reminderData[reminderId].endTime;
                    } else {
                        // 定时事件：使用本地时间处理
                        const { dateStr: endDateStr, timeStr: endTimeStr } = getLocalDateTime(newEndDate);

                        reminderData[reminderId].date = startDateStr;

                        if (startTimeStr) {
                            reminderData[reminderId].time = startTimeStr;
                        }

                        if (endDateStr !== startDateStr) {
                            // 跨天的定时事件
                            reminderData[reminderId].endDate = endDateStr;
                            if (endTimeStr) {
                                reminderData[reminderId].endTime = endTimeStr;
                            }
                        } else {
                            // 同一天的定时事件
                            delete reminderData[reminderId].endDate;
                            if (endTimeStr) {
                                reminderData[reminderId].endTime = endTimeStr;
                            } else {
                                delete reminderData[reminderId].endTime;
                            }
                        }
                    }
                } else {
                    // 单日事件
                    reminderData[reminderId].date = startDateStr;
                    delete reminderData[reminderId].endDate;
                    delete reminderData[reminderId].endTime;

                    if (!info.event.allDay && startTimeStr) {
                        reminderData[reminderId].time = startTimeStr;
                    } else if (info.event.allDay) {
                        delete reminderData[reminderId].time;
                    }
                }

                // 细化重置通知状态：按字段重置（如果事件时间被修改并且新的时间在未来，则重置对应的字段级已提醒）
                if (shouldResetNotified) {
                    try {
                        const now = new Date();
                        const r = reminderData[reminderId];

                        if (info.event.allDay) {
                            // 全日事件，重置时间相关标志
                            r.notifiedTime = false;
                        } else {
                            if (startTimeStr) {
                                const newDT = new Date(`${startDateStr}T${startTimeStr}`);
                                if (newDT > now) {
                                    r.notifiedTime = false;
                                }
                            }
                        }

                        // 重新计算总体 notified
                        const hasTime = !!r.time;
                        const hasCustom = !!r.customReminderTime;
                        const nt = !!r.notifiedTime;
                        const nc = !!r.notifiedCustomTime;
                        if (hasTime && hasCustom) {
                            r.notified = nt && nc;
                        } else if (hasTime) {
                            r.notified = nt;
                        } else if (hasCustom) {
                            r.notified = nc;
                        } else {
                            r.notified = false;
                        }
                    } catch (err) {
                        reminderData[reminderId].notified = false;
                    }
                }

                await saveReminders(this.plugin, reminderData);

            } else {
                throw new Error('提醒数据不存在');
            }
        } catch (error) {
            console.error(isResize ? '调整事件大小失败:' : '更新事件时间失败:', error);
            showMessage(i18n("operationFailed"));
            info.revert();
        }
    }

    private shouldResetNotification(newStartDate: Date, isAllDay: boolean): boolean {
        try {
            const now = new Date();

            // 对于全天事件，只比较日期；对于定时事件，比较完整的日期时间
            if (isAllDay) {
                const newDateOnly = new Date(newStartDate.getFullYear(), newStartDate.getMonth(), newStartDate.getDate());
                const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                return newDateOnly >= todayOnly;
            } else {
                return newStartDate > now;
            }
        } catch (error) {
            console.error('检查通知重置条件失败:', error);
            return false;
        }
    }

    private async saveInstanceModification(instanceData: any) {
        // 保存重复事件实例的修改
        try {
            const originalId = instanceData.originalId;
            const instanceDate = instanceData.instanceDate;

            const reminderData = await getAllReminders(this.plugin);

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            const modifications = reminderData[originalId].repeat.instanceModifications;

            // 如果修改了日期，需要清理可能存在的中间修改记录
            // 例如：原始日期 12-01 改为 12-03，再改为 12-06
            // 应该只保留 12-01 的修改记录，删除 12-03 的记录
            if (instanceData.date !== instanceDate) {
                // 查找所有可能的中间修改记录
                const keysToDelete: string[] = [];
                for (const key in modifications) {
                    // 如果某个修改记录的日期指向当前实例的新日期，且该键不是原始实例日期
                    // 说明这是之前修改产生的中间记录，需要删除
                    if (key !== instanceDate && modifications[key]?.date === instanceData.date) {
                        keysToDelete.push(key);
                    }
                }
                // 删除中间修改记录
                keysToDelete.forEach(key => delete modifications[key]);
            }

            // 保存此实例的修改数据（始终使用原始实例日期作为键）
            modifications[instanceDate] = {
                title: instanceData.title,
                date: instanceData.date,
                endDate: instanceData.endDate,
                time: instanceData.time,
                endTime: instanceData.endTime,
                note: instanceData.note,
                priority: instanceData.priority,
                notified: instanceData.notified, // 添加通知状态
                modifiedAt: getLocalDateString(new Date())
            };

            await saveReminders(this.plugin, reminderData);

        } catch (error) {
            console.error('保存实例修改失败:', error);
            throw error;
        }
    }

    private addCustomStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#reminder-calendar-custom-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'reminder-calendar-custom-styles';
        style.textContent = `
            .fc-today-custom,
            .fc-list-day-today-custom,
            .fc-col-header-cell.fc-today-custom {
                background-color: transparent!important;
            }
            .fc-today-custom  .fc-daygrid-day-frame,
            .fc-today-custom .fc-scrollgrid-sync-inner,
            .fc-today-custom .fc-timegrid-col-frame{
                border: 2px solid var(--b3-theme-primary) !important;
            }
            .fc-today-custom:hover {
                background-color: var(--b3-theme-primary-lightest) !important;
            }
            
            /* 隐藏默认的今日高亮 */
            .fc-day-today:not(.fc-today-custom) {
                background-color: transparent !important;
            }
            .fc-list-day-today:not(.fc-list-day-today-custom) {
                background-color: transparent !important;
            }
            .fc-col-header-cell.fc-day-today:not(.fc-today-custom) {
                background-color: transparent !important;
            }
            
            /* 当前时间指示线样式 */
            .fc-timegrid-now-indicator-line {
                border-color: var(--b3-theme-primary) !important;
                border-width: 2px !important;
                opacity: 0.8;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
            }
            
            /* 当前时间指示箭头样式 */
            .fc-timegrid-now-indicator-arrow {
                border-left-color: var(--b3-theme-primary) !important;
                border-right-color: var(--b3-theme-primary) !important;
                opacity: 0.8;
            }
            
            /* 日历事件主容器优化 */
            .fc-event-main-frame {
                display: flex;
                flex-direction: column;
                padding: 2px 4px;
                box-sizing: border-box;
                gap: 1px;
                width: 100%;
                height: 100%;
                overflow: hidden;
            }

            .reminder-event-top-row {
                display: flex;
                align-items: center;
                gap: 4px;
                width: 100%;
                min-height: 18px;
                flex-shrink: 0;
            }

            .reminder-event-indicators-row {
                display: flex;
                gap: 2px;
                align-items: center;
                padding-left: 18px; /* 与复选框对齐 */
                flex-shrink: 999; /* 空间不足时优先隐藏 */
                max-height: 1.2em;
                overflow: hidden;
            }

            .reminder-event-icon {
                font-size: 12px;
                line-height: 1;
            }

            .reminder-calendar-event-checkbox {
                margin: 0;
                width: 14px;
                height: 14px;
                cursor: pointer;
                flex-shrink: 0;
            }

            .reminder-event-doc-title,
            .reminder-event-note {
                font-size: 10px;
                opacity: 0.7;
                line-height: 1.2;
                flex-shrink: 0;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
                overflow: hidden;
                text-overflow: ellipsis;
                word-break: break-word;
            }

            /* Markdown content styling in notes */
            .reminder-event-note p,
            .reminder-event-note ul,
            .reminder-event-note ol {
                margin: 0px 2px;
                padding: 0;
            }

            .reminder-event-note li {
                margin-left: 1em;
            }

            .reminder-event-note strong {
                font-weight: 600;
            }

            .reminder-event-note code {
                font-size: 0.9em;
                padding: 0 2px;
                background: var(--b3-theme-background);
                border-radius: 2px;
            }

            .fc-event-time {
                font-size: 10px;
                opacity: 0.8;
                white-space: nowrap;
                overflow: hidden;
                flex-shrink: 0;
            }

            .fc-event-title-container {
                flex-grow: 1;
                overflow: hidden;
                min-height: 0;
            }

            .fc-event-title {
                font-size: 12px;
                line-height: 1.3;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                flex: 1; /* 占据剩余空间 */
                min-width: 0; /* 允许收缩 */
            }

            .fc-event-time {
                font-size: 10px;
                opacity: 0.8;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                flex-shrink: 999; /* 时间优先收缩隐藏 */
                max-height: 1.2em;
            }

            .reminder-event-doc-title,
            .reminder-event-note {
                font-size: 10px;
                opacity: 0.7;
                line-height: 1.2;
                flex-shrink: 999; /* 文档名和备注优先收缩 */
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
                overflow: hidden;
                text-overflow: ellipsis;
                word-break: break-word;
                max-height: 2.4em; /* 2 lines * 1.2 line-height */
            }

            .reminder-event-label {
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-all;
                line-height: 1.2;
                max-height: 3.6em;
            }

            .fc-h-event .fc-event-main {
                color: var(--b3-theme-on-background);
            }

            /* 短事件布局优化 (TimeGrid 15-30min) */
            .fc-timegrid-event-short .fc-event-main-frame {
                flex-direction: row;
                align-items: center;
                gap: 4px;
                padding: 1px 4px;
            }

            .fc-timegrid-event-short .fc-event-title {
                -webkit-line-clamp: 1;
                flex-shrink: 1; /* 横向布局时可以收缩 */
            }

            .fc-timegrid-event-short .fc-event-time,
            .fc-timegrid-event-short .reminder-event-doc-title,
            .fc-timegrid-event-short .reminder-event-note {
                display: none;
            }

            /* 当高度非常小时隐藏非关键信息 */
            .fc-timegrid-event:not(.fc-timegrid-event-short) .fc-event-main-frame {
                justify-content: flex-start;
            }

            /* 在深色主题下的适配 */
            .b3-theme-dark .fc-timegrid-now-indicator-line {
                border-color: var(--b3-theme-primary-light) !important;
                box-shadow: 0 1px 3px rgba(255, 255, 255, 0.1);
            }
            
            .b3-theme-dark .fc-timegrid-now-indicator-arrow {
                border-left-color: var(--b3-theme-primary-light) !important;
                border-right-color: var(--b3-theme-primary-light) !important;
            }
            
            /* 已完成任务的样式优化 */
            .fc-event.completed {
                opacity: 0.8 !important;
            }
            
            .fc-event.completed .fc-event-title,
            .fc-event.completed .fc-event-title span{
                text-decoration: line-through;
            }

            /* Pomodoro Event Styles */
            .pomodoro-event {
                border: none !important;
                border-left: none !important;
                box-shadow: none !important;
                opacity: 0.7 !important;
            }

            .all-day-reorder-indicator {
                height: 2px !important;
                background-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 4px var(--b3-theme-primary);
                border-radius: 2px;
                /* 移除 transition 以免在隐藏或位置跳变时产生滑动感 */
                transition: none !important;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    private async updateDropIndicator(pointX: number, pointY: number, calendarEl: HTMLElement): Promise<void> {
        try {
            if (!this.dropIndicator) {
                const ind = document.createElement('div');
                ind.className = 'reminder-drop-indicator';
                ind.style.position = 'fixed';
                ind.style.pointerEvents = 'none';
                ind.style.zIndex = '9999';
                ind.style.transition = 'all 0.08s linear';
                document.body.appendChild(ind);
                this.dropIndicator = ind;
            }

            const dateEls = Array.from(calendarEl.querySelectorAll('[data-date]')) as HTMLElement[];
            if (dateEls.length === 0) {
                this.hideDropIndicator();
                return;
            }

            let dateEl: HTMLElement | null = null;
            for (const d of dateEls) {
                const r = d.getBoundingClientRect();
                if (pointX >= r.left && pointX <= r.right && pointY >= r.top && pointY <= r.bottom) {
                    dateEl = d;
                    break;
                }
            }

            if (!dateEl) {
                let minDist = Infinity;
                for (const d of dateEls) {
                    const r = d.getBoundingClientRect();
                    const cx = (r.left + r.right) / 2;
                    const cy = (r.top + r.bottom) / 2;
                    const dx = cx - pointX;
                    const dy = cy - pointY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < minDist) {
                        minDist = dist;
                        dateEl = d;
                    }
                }
            }

            if (!dateEl) {
                this.hideDropIndicator();
                return;
            }

            const elAtPoint = document.elementFromPoint(pointX, pointY) as HTMLElement | null;
            const inTimeGrid = !!(elAtPoint && elAtPoint.closest('.fc-timegrid'));
            const rect = dateEl.getBoundingClientRect();

            if (inTimeGrid) {
                const top = Math.max(rect.top, Math.min(rect.bottom, pointY));
                this.dropIndicator.style.left = rect.left + 'px';
                this.dropIndicator.style.top = (top - 1) + 'px';
                this.dropIndicator.style.width = rect.width + 'px';
                this.dropIndicator.style.height = '2px';
                this.dropIndicator.style.background = 'var(--b3-theme-primary)';
                this.dropIndicator.style.borderRadius = '2px';
                this.dropIndicator.style.boxShadow = '0 0 6px var(--b3-theme-primary)';
                this.dropIndicator.style.opacity = '1';
            } else {
                this.dropIndicator.style.left = rect.left + 'px';
                this.dropIndicator.style.top = rect.top + 'px';
                this.dropIndicator.style.width = rect.width + 'px';
                this.dropIndicator.style.height = rect.height + 'px';
                this.dropIndicator.style.background = 'rgba(0,128,255,0.06)';
                this.dropIndicator.style.border = '2px dashed rgba(0,128,255,0.18)';
                this.dropIndicator.style.borderRadius = '6px';
                this.dropIndicator.style.boxShadow = 'none';
                this.dropIndicator.style.opacity = '1';
            }
        } catch (err) {
            console.error('updateDropIndicator error', err);
        }
    }

    private hideDropIndicator(): void {
        try {
            if (this.dropIndicator) {
                this.dropIndicator.remove();
                this.dropIndicator = null;
            }
        } catch (err) {
            // ignore
        }
    }

    private async showTimeEditDialog(calendarEvent: any) {
        try {
            // 对于重复事件实例，需要使用原始ID来获取原始提醒数据
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                const reminder = reminderData[reminderId];

                const editDialog = new QuickReminderDialog(
                    reminder.date,
                    reminder.time,
                    undefined,
                    undefined,
                    {
                        reminder: reminder,
                        mode: 'edit',
                        onSaved: async () => {
                            // 刷新日历事件
                            await this.refreshEvents();

                            // 触发全局更新事件
                            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                        },
                        plugin: this.plugin
                    }
                );

                editDialog.show();
            } else {
                showMessage(i18n("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('打开修改对话框失败:', error);
            showMessage(i18n("openModifyDialogFailed"));
        }
    }

    private async showTimeEditDialogForSeries(calendarEvent: any) {
        try {
            // 获取原始重复事件的ID
            const originalId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[originalId]) {
                const reminder = reminderData[originalId];

                const editDialog = new QuickReminderDialog(
                    reminder.date,
                    reminder.time,
                    undefined,
                    undefined,
                    {
                        reminder: reminder,
                        mode: 'edit',
                        onSaved: async () => {
                            // 刷新日历事件
                            await this.refreshEvents();

                            // 触发全局更新事件
                            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                        },
                        plugin: this.plugin
                    }
                );

                editDialog.show();
            } else {
                showMessage(i18n("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('打开系列修改对话框失败:', error);
            showMessage(i18n("openModifyDialogFailed"));
        }
    }

    private async toggleAllDayEvent(calendarEvent: any) {
        try {
            // 获取正确的提醒ID - 对于重复事件实例，使用原始ID
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                if (calendarEvent.allDay) {
                    // 从全天改为定时：添加默认时间
                    reminderData[reminderId].time = "09:00";
                    delete reminderData[reminderId].endTime;
                } else {
                    // 从定时改为全天：删除时间信息
                    delete reminderData[reminderId].time;
                    delete reminderData[reminderId].endTime;
                }

                await saveReminders(this.plugin, reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

                // 立即刷新事件显示
                await this.refreshEvents();

                showMessage(calendarEvent.allDay ? i18n("changedToTimed") : i18n("changedToAllDay"));
            }
        } catch (error) {
            console.error('切换全天事件失败:', error);
            showMessage(i18n("toggleAllDayFailed"));
        }
    }

    private handleDateClick(info) {
        // 实现双击检测逻辑
        const currentTime = Date.now();
        const timeDiff = currentTime - this.lastClickTime;

        // 清除之前的单击超时
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
        }

        // 如果两次点击间隔小于500ms，认为是双击
        if (timeDiff < 500) {
            // 双击事件 - 创建快速提醒
            this.createQuickReminder(info);
            this.lastClickTime = 0; // 重置点击时间
        } else {
            // 单击事件 - 设置延迟，如果在延迟期间没有第二次点击，则不执行任何操作
            this.lastClickTime = currentTime;
            this.clickTimeout = window.setTimeout(() => {
                // 单击事件不执行任何操作（原来是创建快速提醒，现在改为双击才创建）
                this.lastClickTime = 0;
                this.clickTimeout = null;
            }, 500);
        }
    }

    private createQuickReminder(info) {
        // 双击日期，创建快速提醒
        const clickedDate = info.dateStr;

        // 获取点击的时间（如果是时间视图且不是all day区域）
        let clickedTime = null;
        if (info.date && this.calendar.view.type !== 'dayGridMonth') {
            // 在周视图或日视图中，检查是否点击在all day区域
            // 通过检查点击的时间是否为整点且分钟为0来判断是否在all day区域
            // 或者通过检查info.allDay属性（如果存在）
            const isAllDayClick = info.allDay ||
                (info.date.getHours() === 0 && info.date.getMinutes() === 0) ||
                // 检查点击位置是否在all day区域（通过DOM元素类名判断）
                this.isClickInAllDayArea(info.jsEvent);

            if (!isAllDayClick) {
                // 只有在非all day区域点击时才设置具体时间
                const hours = info.date.getHours();
                const minutes = info.date.getMinutes();
                clickedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
        }

        // 创建快速提醒对话框，传递默认项目ID和默认分类ID
        const quickDialog = new QuickReminderDialog(clickedDate, clickedTime, async () => {
            // 刷新日历事件
            await this.refreshEvents();
        }, undefined, {
            defaultProjectId: (!this.currentProjectFilter.has('all') && !this.currentProjectFilter.has('none') && this.currentProjectFilter.size === 1) ? Array.from(this.currentProjectFilter)[0] : undefined,
            defaultCategoryId: (!this.currentCategoryFilter.has('all') && !this.currentCategoryFilter.has('none') && this.currentCategoryFilter.size === 1) ? Array.from(this.currentCategoryFilter)[0] : undefined,
            plugin: this.plugin // 传入plugin实例
        });

        quickDialog.show();
    }

    /**
     * 检测点击是否在all day区域
     * @param jsEvent 原生JavaScript事件对象
     * @returns 是否在all day区域点击
     */
    private isClickInAllDayArea(jsEvent: MouseEvent): boolean {
        if (!jsEvent || !jsEvent.target) {
            return false;
        }
        const target = jsEvent.target as HTMLElement;

        // 检查点击的元素或其父元素是否包含all day相关的类名
        let element = target;
        let depth = 0;
        const maxDepth = 10; // 限制向上查找的深度，避免无限循环

        while (element && depth < maxDepth) {
            const className = element.className || '';

            // FullCalendar的all day区域通常包含这些类名
            if (typeof className === 'string' && (
                className.includes('fc-timegrid-slot-lane') ||
                className.includes('fc-timegrid-col-frame') ||
                className.includes('fc-daygrid') ||
                className.includes('fc-scrollgrid-section-header') ||
                className.includes('fc-col-header') ||
                className.includes('fc-timegrid-divider') ||
                className.includes('fc-timegrid-col-bg')
            )) {
                // 如果包含时间网格相关类名，进一步检查是否在all day区域
                if (className.includes('fc-timegrid-slot-lane') ||
                    className.includes('fc-timegrid-col-frame')) {
                    // 检查Y坐标是否在all day区域（通常在顶部）
                    const rect = element.getBoundingClientRect();
                    const clickY = jsEvent.clientY;

                    // 如果点击位置在元素的上半部分，可能是all day区域
                    return clickY < rect.top + (rect.height * 0.2);
                }

                // 其他all day相关的类名直接返回true
                if (className.includes('fc-daygrid') ||
                    className.includes('fc-scrollgrid-section-header') ||
                    className.includes('fc-col-header')) {
                    return true;
                }
            }

            element = element.parentElement;
            depth++;
        }

        return false;
    }

    private handleDateSelect(selectInfo) {
        // 强制隐藏提示框，防止在创建新提醒时它仍然可见
        this.forceHideTooltip();
        // 处理拖拽选择时间段创建事项
        const startDate = selectInfo.start;
        const endDate = selectInfo.end;

        // 格式化开始日期
        const { dateStr: startDateStr, timeStr: startTimeStr } = getLocalDateTime(startDate);

        let endDateStr = null;
        let endTimeStr = null;

        // 处理结束日期和时间
        if (endDate) {
            if (selectInfo.allDay) {
                // 全天事件：FullCalendar 的结束日期是排他的，需要减去一天
                const adjustedEndDate = new Date(endDate);
                adjustedEndDate.setDate(adjustedEndDate.getDate() - 1);
                const { dateStr } = getLocalDateTime(adjustedEndDate);

                // 只有当结束日期不同于开始日期时才设置结束日期
                if (dateStr !== startDateStr) {
                    endDateStr = dateStr;
                }
            } else {
                // 定时事件
                const { dateStr: endDtStr, timeStr: endTmStr } = getLocalDateTime(endDate);
                endDateStr = endDtStr;
                endTimeStr = endTmStr;
            }
        }

        // 对于all day选择，不传递时间信息
        const finalStartTime = selectInfo.allDay ? null : startTimeStr;
        const finalEndTime = selectInfo.allDay ? null : endTimeStr;

        // 创建快速提醒对话框，传递时间段信息和默认项目ID
        const quickDialog = new QuickReminderDialog(
            startDateStr,
            finalStartTime,
            async () => {
                // 刷新日历事件
                await this.refreshEvents();
            },
            {
                endDate: endDateStr,
                endTime: finalEndTime,
                isTimeRange: true
            },
            {
                defaultProjectId: !this.currentProjectFilter.has('all') && !this.currentProjectFilter.has('none') && this.currentProjectFilter.size === 1 ? Array.from(this.currentProjectFilter)[0] : undefined,
                defaultCategoryId: !this.currentCategoryFilter.has('all') && !this.currentCategoryFilter.has('none') && this.currentCategoryFilter.size === 1 ? Array.from(this.currentCategoryFilter)[0] : undefined,
                plugin: this.plugin // 传入plugin实例
            }
        );

        quickDialog.show();

        // 清除选择
        this.calendar.unselect();
    }

    private async refreshEvents(force: boolean = false) {
        // 清除之前的刷新超时
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        // 使用防抖机制，避免频繁刷新
        this.refreshTimeout = window.setTimeout(async () => {
            // 1. 记录当前所有滚动容器的位置 (特别是月视图或时间轴视图中的滚动条)
            const scrollerStates = Array.from(this.container.querySelectorAll('.fc-scroller')).map((el: HTMLElement) => ({
                el,
                scrollTop: el.scrollTop,
                scrollLeft: el.scrollLeft
            }));

            try {
                // 刷新番茄数据以确保统计准确
                if (this.showPomodoro) {
                    await this.pomodoroRecordManager.refreshData();
                }

                // 先获取新的事件数据
                const events = await this.getEvents(force);

                // 清除所有现有事件和事件源
                this.calendar.removeAllEvents();
                this.calendar.removeAllEventSources();

                // 批量添加事件（比逐个添加更高效）
                if (events.length > 0) {
                    this.calendar.addEventSource(events);
                }

                // 强制重新渲染日历并更新大小
                if (this.isCalendarVisible()) {
                    this.calendar.updateSize();
                    this.calendar.render();

                    // 2. 恢复滚动位置
                    // 注意：FullCalendar 重新渲染可能会保留部分 DOM 结构，如果 el 还在文档中则直接恢复
                    // 如果 DOM 被完全销毁并重建，则需要通过索引或类名重新匹配。
                    // 实践中 FC v6 调用 render() 往往会重用 scroller 容器。
                    requestAnimationFrame(() => {
                        // 如果最近刚刚点击了"今天"按钮（2秒内），则不要恢复之前的滚动位置
                        // 防止滚动到"今天"后被重置回之前的位置
                        if (Date.now() - this.lastNavigatedToTodayAt < 2000) {
                            const targetDate = getDayStartAdjustedDate(new Date());
                            const todayEl = this.container.querySelector('.fc-day-today') ||
                                this.container.querySelector('.fc-today-custom') ||
                                this.container.querySelector(`[data-date="${getLocalDateString(targetDate)}"]`);
                            if (todayEl) {
                                todayEl.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
                            }
                        } else {
                            scrollerStates.forEach(state => {
                                if (state.el && this.container.contains(state.el)) {
                                    state.el.scrollTop = state.scrollTop;
                                    state.el.scrollLeft = state.scrollLeft;
                                } else {
                                    // 如果旧的 el 已经失效，则根据索引恢复新 scroller 的位置
                                    // 这是一个备选方案
                                    const newScrollers = this.container.querySelectorAll('.fc-scroller');
                                    newScrollers.forEach((newEl: HTMLElement, index) => {
                                        if (scrollerStates[index] && !this.container.contains(scrollerStates[index].el)) {
                                            newEl.scrollTop = scrollerStates[index].scrollTop;
                                            newEl.scrollLeft = scrollerStates[index].scrollLeft;
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            } catch (error) {
                console.error('刷新事件失败:', error);
            }
        }, 100); // 100ms 防抖延迟
    }

    private async getEvents(force: boolean = false) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, force);
            const events = [];

            // 获取当前视图的日期范围
            let startDate, endDate;
            if (this.calendar && this.calendar.view) {
                const currentView = this.calendar.view;
                startDate = getLocalDateString(currentView.activeStart);
                endDate = getLocalDateString(currentView.activeEnd);
            } else {
                const now = new Date();
                const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
                const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                startDate = getLocalDateString(monthStart);
                endDate = getLocalDateString(monthEnd);
            }

            // 获取项目数据用于分类过滤继承
            const projectData = await this.plugin.loadProjectData() || {};

            // 转换为数组并过滤
            const allReminders = Object.values(reminderData) as any[];
            let filteredReminders = allReminders.filter(reminder => {
                if (!reminder || typeof reminder !== 'object') return false;

                // 不在日历视图显示的任务过滤
                // 如果任务或父任务被标记为隐藏，且未开启强制显示，则过滤掉
                if (!this.showHiddenTasks) {
                    // 检查任务本身是否被标记为隐藏
                    if (reminder.hideInCalendar) return false;
                    // 检查父任务是否被标记为隐藏（子任务继承父任务的隐藏设置）
                    if (reminder.parentId && reminderData[reminder.parentId]?.hideInCalendar) return false;
                }

                // 子任务过滤
                if (!this.showSubtasks && reminder.parentId) return false;

                // 重复任务过滤
                if (!this.showRepeatTasks && reminder.repeat?.enabled) return false;

                // 跨天任务过滤
                const durationDays = getDaysDifference(reminder.date, reminder.endDate || reminder.date);
                if (durationDays > 0) {
                    if (!this.showCrossDayTasks) return false;
                    if (this.crossDayThreshold === 0) return false;
                    if (this.crossDayThreshold > 0 && (durationDays + 1) > this.crossDayThreshold) return false;
                    // crossDayThreshold === -1 means no limit
                }

                if (!this.passesCategoryFilter(reminder, projectData)) return false;
                if (!this.passesProjectFilter(reminder)) return false;

                // For repeat tasks, we allow them to pass the initial filter because their instances have different completion statuses.
                // Actual filtering will be performed when generating instances.
                if (!reminder.repeat?.enabled && !this.passesCompletionFilter(reminder)) return false;
                return true;
            });

            // 过滤已归档分组的未完成任务
            filteredReminders = await this.filterArchivedGroupTasks(filteredReminders);

            // 批量预加载所有需要的文档标题
            await this.batchLoadDocTitles(filteredReminders);

            // 批量预加载自定义分组信息
            await this.batchLoadCustomGroupNames(filteredReminders);

            // 预处理父任务信息映射（一次性构建，避免重复查找）
            const parentInfoMap = new Map<string, { title: string; blockId: string }>();
            for (const reminder of filteredReminders) {
                if (reminder.parentId && reminderData[reminder.parentId]) {
                    const parentReminder = reminderData[reminder.parentId];
                    parentInfoMap.set(reminder.parentId, {
                        title: parentReminder?.title || '',
                        blockId: parentReminder?.blockId || parentReminder?.id
                    });
                }
            }

            // 处理提醒数据
            for (const reminder of filteredReminders) {
                // 注入父任务信息
                if (reminder.parentId && parentInfoMap.has(reminder.parentId)) {
                    const parentInfo = parentInfoMap.get(reminder.parentId);
                    reminder.parentTitle = parentInfo.title;
                }

                // If repeat settings exist, do not display the original event (only display instances); otherwise, display the original event
                if (!reminder.repeat?.enabled) {
                    this.addEventToList(events, reminder, reminder.id, false);
                } else if (this.showRepeatTasks) {
                    // Generate repeat event instances
                    let repeatInstances = generateRepeatInstances(reminder, startDate, endDate);

                    const completedInstances = reminder.repeat?.completedInstances || [];
                    const instanceModifications = reminder.repeat?.instanceModifications || {};

                    // Used to track processed instances (using original date key)
                    const processedInstances = new Set<string>();
                    let incompleteCount = 0;

                    // 批量处理实例，减少重复计算
                    for (const instance of repeatInstances) {
                        // 使用 instance.instanceId（由 generateRepeatInstances 生成，格式为 <reminder.id>_YYYY-MM-DD）
                        // 从中提取原始实例日期键 originalKey，用于查找完成状态和 instanceModifications。
                        const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                        const originalKey = instanceIdStr.split('_').pop() || instance.date;

                        // 标记此实例已处理
                        processedInstances.add(originalKey);

                        // completedInstances 和 instanceModifications 都以原始实例日期键为索引
                        const isInstanceCompleted = completedInstances.includes(originalKey);

                        // Apply instance quantity limit to incomplete instances
                        if (!isInstanceCompleted) {
                            if (this.repeatInstanceLimit !== -1 && incompleteCount >= this.repeatInstanceLimit) {
                                continue;
                            }
                            incompleteCount++;
                        }

                        const instanceReminder = {
                            ...reminder,
                            ...instance,
                            completed: isInstanceCompleted
                        };

                        // Apply completion filter to instances
                        if (!this.passesCompletionFilter(instanceReminder)) {
                            continue;
                        }

                        // 事件 id 应使用原始实例键，以便后续的拖拽/保存逻辑能够基于原始实例键进行修改，避免产生重复的 instanceModifications 条目
                        const uniqueInstanceId = `${reminder.id}_${originalKey}`;
                        this.addEventToList(events, instanceReminder, uniqueInstanceId, true, instance.originalId);
                    }

                    // 处理被移动到当前视图范围内但原始日期不在范围内的实例
                    // 这些实例不会被 generateRepeatInstances 返回，因为它只检查符合重复规则的日期
                    for (const [originalDateKey, modification] of Object.entries(instanceModifications)) {
                        // 如果此实例已经被处理过，跳过
                        if (processedInstances.has(originalDateKey)) {
                            continue;
                        }

                        // 类型断言：modification 是实例修改对象
                        const mod = modification as any;

                        // 检查修改后的日期是否在当前视图范围内
                        const modifiedDate = mod.date || originalDateKey;
                        if (compareDateStrings(modifiedDate, startDate) >= 0 &&
                            compareDateStrings(modifiedDate, endDate) <= 0) {

                            // 检查是否在排除列表中
                            const excludeDates = reminder.repeat?.excludeDates || [];
                            if (excludeDates.includes(originalDateKey)) {
                                continue;
                            }

                            // 检查此实例是否已完成
                            const isInstanceCompleted = completedInstances.includes(originalDateKey);

                            // Apply instance quantity limit to incomplete instances
                            if (!isInstanceCompleted) {
                                if (this.repeatInstanceLimit !== -1 && incompleteCount >= this.repeatInstanceLimit) {
                                    continue;
                                }
                                incompleteCount++;
                            }

                            // 计算结束日期（如果有）
                            let modifiedEndDate = mod.endDate;
                            if (!modifiedEndDate && reminder.endDate && reminder.date) {
                                const daysDiff = getDaysDifference(reminder.date, reminder.endDate);
                                modifiedEndDate = addDaysToDate(modifiedDate, daysDiff);
                            }

                            const instanceReminder = {
                                ...reminder,
                                date: modifiedDate,
                                endDate: modifiedEndDate || reminder.endDate,
                                time: mod.time || reminder.time,
                                endTime: mod.endTime || reminder.endTime,
                                completed: isInstanceCompleted,
                                title: mod.title !== undefined ? mod.title : reminder.title,
                                note: mod.note !== undefined ? mod.note : (reminder.note || ''),
                                priority: mod.priority !== undefined ? mod.priority : (reminder.priority || 'none'),
                                categoryId: mod.categoryId !== undefined ? mod.categoryId : reminder.categoryId,
                                projectId: mod.projectId !== undefined ? mod.projectId : reminder.projectId,
                                customGroupId: mod.customGroupId !== undefined ? mod.customGroupId : reminder.customGroupId,
                                kanbanStatus: mod.kanbanStatus !== undefined ? mod.kanbanStatus : reminder.kanbanStatus,
                                tagIds: mod.tagIds !== undefined ? mod.tagIds : reminder.tagIds,
                                milestoneId: mod.milestoneId !== undefined ? mod.milestoneId : reminder.milestoneId,
                                sort: (mod && typeof mod.sort === 'number') ? mod.sort : (reminder.sort || 0)
                            };

                            // Apply completion filter to modified instances
                            if (!this.passesCompletionFilter(instanceReminder)) {
                                continue;
                            }

                            const uniqueInstanceId = `${reminder.id}_${originalDateKey}`;
                            this.addEventToList(events, instanceReminder, uniqueInstanceId, true, reminder.id);
                        }
                    }
                }
            }

            // Add Pomodoro records if enabled and in Day/Week view
            if (this.showPomodoro && this.calendar && this.calendar.view) {
                const viewType = this.calendar.view.type;
                if (viewType === 'timeGridDay' || viewType === 'timeGridWeek' || viewType === 'timeGridMultiDays7') {
                    const pomodoroManager = this.pomodoroRecordManager;
                    const sessions = await pomodoroManager.getDateRangeSessions(startDate, endDate);

                    for (const session of sessions) {
                        // Ensure session has necessary data
                        if (!session.startTime || !session.endTime) continue;

                        // 筛选项目和分类
                        let reminder = session.eventId ? reminderData[session.eventId] : null;

                        // 如果关联了任务但没在 reminderData 中找到，尝试作为重复任务实例处理
                        if (!reminder && session.eventId) {
                            const sid = session.eventId;
                            const idx = sid.lastIndexOf('_');
                            if (idx !== -1) {
                                const possibleDate = sid.slice(idx + 1);
                                if (/^\d{4}-\d{2}-\d{2}$/.test(possibleDate)) {
                                    reminder = reminderData[sid.slice(0, idx)];
                                }
                            }
                        }

                        // 执行过滤逻辑
                        if (reminder) {
                            if (!this.passesProjectFilter(reminder)) continue;
                            if (!this.passesCategoryFilter(reminder, projectData)) continue;
                        } else {
                            // 如果是休息记录或关联的任务已彻底删除且无法找回，则视为“无项目”和“无分类”进行过滤
                            const virtualReminder = { projectId: null, categoryId: null };
                            if (!this.passesProjectFilter(virtualReminder)) continue;
                            if (!this.passesCategoryFilter(virtualReminder, projectData)) continue;
                        }

                        // Construct title: "<TomatoIcon> TaskName"
                        const title = `🍅 ${session.eventTitle || i18n('unnamedTask')}`;

                        // Determine colors based on session type
                        let backgroundColor = '#f23145'; // Default to work type
                        if (session.type === 'shortBreak' || session.type === 'longBreak') {
                            backgroundColor = '#00b36b';
                        }

                        const eventObj = {
                            id: `pomodoro-${session.id}`,
                            title: title,
                            start: session.startTime,
                            end: session.endTime,
                            backgroundColor: backgroundColor,
                            borderColor: 'transparent', // Match border to background
                            textColor: 'var(--b3-theme-on-background)',
                            className: 'pomodoro-event',
                            editable: false,
                            startEditable: false,
                            durationEditable: false,
                            allDay: false,
                            extendedProps: {
                                type: 'pomodoro',
                                eventId: session.eventId, // Associated Task ID
                                eventTitle: session.eventTitle,
                                duration: session.duration,
                                parentId: session.eventId, // Map associated task ID to parentId for easy access
                                originalSession: session
                            }
                        };
                        events.push(eventObj);
                    }
                }
            }

            return events;
        } catch (error) {
            console.error('获取事件数据失败:', error);
            showMessage(i18n("loadReminderDataFailed"));
            return [];
        }
    }

    /**
     * 批量加载文档标题（性能优化版本）
     */
    private async batchLoadDocTitles(reminders: any[]) {
        try {
            // 收集所有需要查询的blockId和docId
            const blockIdsToQuery = new Set<string>();
            const docIdsToQuery = new Set<string>();

            for (const reminder of reminders) {
                if (reminder.docTitle) continue; // 已有标题，跳过

                const blockId = reminder.blockId || reminder.id;
                const docId = reminder.docId;

                // 收集需要查询docId的blockId
                if (!docId && blockId) {
                    blockIdsToQuery.add(blockId);
                } else if (docId && docId !== blockId) {
                    docIdsToQuery.add(docId);
                }
            }


            // 批量查询文档标题
            const docIdToTitle = new Map<string, string>();
            if (docIdsToQuery.size > 0) {
                const promises = Array.from(docIdsToQuery).map(async (docId) => {
                    try {
                        const docBlock = await getBlockByID(docId);
                        if (docBlock && docBlock.content) {
                            docIdToTitle.set(docId, docBlock.content.trim());
                        }
                    } catch (err) {
                        console.warn(`获取文档 ${docId} 的标题失败:`, err);
                    }
                });
                await Promise.all(promises);
            }

            // 应用结果到reminders
            for (const reminder of reminders) {
                if (reminder.docTitle) continue;

                const blockId = reminder.blockId || reminder.id;
                let docId = reminder.docId;


                // 设置文档标题
                if (docId && docId !== blockId && docIdToTitle.has(docId)) {
                    reminder.docTitle = docIdToTitle.get(docId);
                } else {
                    reminder.docTitle = '';
                }
            }
        } catch (error) {
            console.warn('批量加载文档标题失败:', error);
            // 失败时设置空标题，避免后续重复尝试
            for (const reminder of reminders) {
                if (!reminder.docTitle) {
                    reminder.docTitle = '';
                }
            }
        }
    }

    /**
     * 批量加载自定义分组名称
     */
    private async batchLoadCustomGroupNames(reminders: any[]) {
        try {
            // 收集所有需要查询的项目ID
            const projectIds = new Set<string>();
            for (const reminder of reminders) {
                if (reminder.projectId && reminder.customGroupId) {
                    projectIds.add(reminder.projectId);
                }
            }

            // 批量加载所有项目的自定义分组
            const projectCustomGroups = new Map<string, any[]>();
            const promises = Array.from(projectIds).map(async (projectId) => {
                try {
                    const customGroups = await this.projectManager.getProjectCustomGroups(projectId);
                    projectCustomGroups.set(projectId, customGroups);
                } catch (err) {
                    console.warn(`获取项目 ${projectId} 的自定义分组失败:`, err);
                    projectCustomGroups.set(projectId, []);
                }
            });
            await Promise.all(promises);

            // 应用结果到reminders
            for (const reminder of reminders) {
                if (reminder.projectId && reminder.customGroupId) {
                    const customGroups = projectCustomGroups.get(reminder.projectId);
                    if (customGroups) {
                        const customGroup = customGroups.find(g => g.id === reminder.customGroupId);
                        if (customGroup) {
                            reminder.customGroupName = customGroup.name;
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('批量加载自定义分组名称失败:', error);
        }
    }




    passesCategoryFilter(reminder: any, projectData: any = {}): boolean {
        // 如果没有选择任何分类（取消全选），不显示任何任务
        if (this.currentCategoryFilter.size === 0) {
            return false;
        }

        if (this.currentCategoryFilter.has('all')) {
            return true;
        }

        // 确定生效的分类 ID
        let effectiveCategoryId = reminder.categoryId;

        // 如果任务本身没分类，但属于某个项目，则尝试继承项目的分类
        if (!effectiveCategoryId && reminder.projectId && projectData[reminder.projectId]) {
            effectiveCategoryId = projectData[reminder.projectId].categoryId;
        }

        if (!effectiveCategoryId) {
            return this.currentCategoryFilter.has('none');
        }

        // Handle multiple categories
        const categoryIds = effectiveCategoryId.split(',');
        return categoryIds.some(id => this.currentCategoryFilter.has(id));
    }

    passesProjectFilter(reminder: any): boolean {
        // 如果没有选择任何项目（取消全选），不显示任何任务
        if (this.currentProjectFilter.size === 0) {
            return false;
        }

        if (this.currentProjectFilter.has('all')) {
            return true;
        }

        if (!reminder.projectId) {
            return this.currentProjectFilter.has('none');
        }

        return this.currentProjectFilter.has(reminder.projectId);
    }

    passesCompletionFilter(reminder: any): boolean {
        if (this.currentCompletionFilter === 'all') {
            return true;
        }

        if (this.currentCompletionFilter === 'completed') {
            return reminder.completed === true;
        }

        if (this.currentCompletionFilter === 'incomplete') {
            return reminder.completed !== true;
        }

        return true;
    }

    /**
     * 过滤已归档分组的未完成任务
     */
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

            for (const projectId of projectIds) {
                try {
                    const groups = await this.projectManager.getProjectCustomGroups(projectId);
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

    private addEventToList(events: any[], reminder: any, eventId: string, isRepeated: boolean, originalId?: string) {
        const priority = reminder.priority || 'none';

        // 使用缓存获取颜色，避免重复计算
        const cacheKey = `${this.colorBy}-${reminder.projectId || ''}-${reminder.categoryId || ''}-${priority}`;
        let colors = this.colorCache.get(cacheKey);

        if (!colors) {
            let backgroundColor: string;
            let borderColor: string;

            if (this.colorBy === 'project') {
                if (reminder.projectId) {
                    const color = this.projectManager.getProjectColor(reminder.projectId);
                    backgroundColor = color;
                    borderColor = color;
                } else {
                    backgroundColor = '#8f8f8f';
                    borderColor = '#7f8c8d';
                }
            } else if (this.colorBy === 'category') {
                if (reminder.categoryId) {
                    // Use the first category for color if multiple are present
                    const firstCategoryId = reminder.categoryId.split(',')[0];
                    const categoryStyle = this.categoryManager.getCategoryStyle(firstCategoryId);
                    backgroundColor = categoryStyle.backgroundColor;
                    borderColor = categoryStyle.borderColor;
                } else {
                    backgroundColor = '#8f8f8f';
                    borderColor = '#7f8c8d';
                }
            } else { // colorBy === 'priority'
                switch (priority) {
                    case 'high':
                        backgroundColor = '#ff0000';
                        borderColor = '#ff0000';
                        break;
                    case 'medium':
                        backgroundColor = '#f39c12';
                        borderColor = '#e67e22';
                        break;
                    case 'low':
                        backgroundColor = '#3498db';
                        borderColor = '#2980b9';
                        break;
                    default:
                        backgroundColor = '#8f8f8f';
                        borderColor = '#7f8c8d';
                        break;
                }
            }

            colors = { backgroundColor, borderColor };
            this.colorCache.set(cacheKey, colors);
        }

        // 检查完成状态（简化逻辑）
        const isCompleted = reminder.completed || false;

        // 构建 className（优化：减少数组分配，直接字符串拼接）
        let classNames = `reminder-priority-${priority}`;
        if (isRepeated) classNames += ' reminder-repeated';
        if (isCompleted) classNames += ' completed';
        // 仅根据是否存在 blockId 决定绑定样式，允许已绑定块的快速提醒显示绑定样式
        classNames += (!reminder.blockId) ? ' no-block-binding' : ' has-block-binding';

        // 构建事件对象（优化：直接使用colors.backgroundColor和colors.borderColor）
        const eventObj: any = {
            id: eventId,
            title: reminder.title || i18n("unnamedNote"),
            backgroundColor: colors.backgroundColor,
            borderColor: colors.borderColor,
            textColor: 'var(--b3-theme-on-background)',
            className: classNames,
            editable: !reminder.isSubscribed, // 如果是订阅任务，禁止编辑
            startEditable: !reminder.isSubscribed, // 如果是订阅任务，禁止拖动开始时间
            durationEditable: !reminder.isSubscribed, // 如果是订阅任务，禁止调整时长
            extendedProps: {
                completed: isCompleted,
                note: reminder.note || '',
                date: reminder.date,
                endDate: reminder.endDate || null,
                time: reminder.time || null,
                endTime: reminder.endTime || null,
                priority: priority,
                categoryId: reminder.categoryId,
                projectId: reminder.projectId,
                customGroupId: reminder.customGroupId,
                customGroupName: reminder.customGroupName,
                sort: typeof reminder.sort === 'number' ? reminder.sort : 0,
                blockId: reminder.blockId || null,
                docId: reminder.docId,
                docTitle: reminder.docTitle,
                parentId: reminder.parentId || null,
                parentTitle: reminder.parentTitle || null,
                isRepeated: isRepeated,
                originalId: originalId || reminder.id,
                repeat: reminder.repeat,
                isSubscribed: reminder.isSubscribed || false,
                subscriptionId: reminder.subscriptionId
            }
        };

        // 处理跨天事件
        if (reminder.endDate) {
            if (reminder.time && reminder.endTime) {
                eventObj.start = `${reminder.date}T${reminder.time}:00`;
                eventObj.end = `${reminder.endDate}T${reminder.endTime}:00`;
                eventObj.allDay = false;
            } else {
                eventObj.start = reminder.date;
                const endDate = new Date(reminder.endDate);
                endDate.setDate(endDate.getDate() + 1);
                eventObj.end = getLocalDateString(endDate);
                eventObj.allDay = true;

                if (reminder.time) {
                    eventObj.title = `${reminder.title || i18n("unnamedNote")} (${reminder.time})`;
                }
            }
        } else {
            if (reminder.time) {
                eventObj.start = `${reminder.date}T${reminder.time}:00`;
                if (reminder.endTime) {
                    eventObj.end = `${reminder.date}T${reminder.endTime}:00`;
                } else {
                    // 对于只有开始时间的提醒，设置30分钟的默认持续时间，但确保不跨天
                    const startTime = new Date(`${reminder.date}T${reminder.time}:00`);
                    const endTime = new Date(startTime);
                    endTime.setMinutes(endTime.getMinutes() + 30);

                    // 检查是否跨天，如果跨天则设置为当天23:59
                    if (endTime.getDate() !== startTime.getDate()) {
                        endTime.setDate(startTime.getDate());
                        endTime.setHours(23, 59, 0, 0);
                    }

                    const endTimeStr = endTime.toTimeString().substring(0, 5);
                    eventObj.end = `${reminder.date}T${endTimeStr}:00`;
                }
                eventObj.allDay = false;
            } else {
                eventObj.start = reminder.date;
                eventObj.allDay = true;
                eventObj.display = 'block';
            }
        }

        if (!eventObj.allDay) {
            eventObj.display = 'block';
        }

        events.push(eventObj);
    }

    private async showEventTooltip(event: MouseEvent, calendarEvent: any) {
        try {
            // 清除可能存在的隐藏超时
            if (this.hideTooltipTimeout) {
                clearTimeout(this.hideTooltipTimeout);
                this.hideTooltipTimeout = null;
            }

            // 创建提示框
            if (!this.tooltip) {
                this.tooltip = document.createElement('div');
                this.tooltip.className = 'reminder-event-tooltip';
                this.tooltip.style.cssText = `
                    position: fixed;
                    background: var(--b3-theme-surface);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 6px;
                    padding: 12px;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                    z-index: 9999;
                    min-width: 100px;
                    max-width: 300px;
                    font-size: 13px;
                    line-height: 1.4;
                    opacity: 0;
                    transition: opacity 0.2s ease-in-out;
                    word-wrap: break-word;
                    pointer-events: none; /* 关键修改：让鼠标事件穿透提示框 */
                `;

                document.body.appendChild(this.tooltip);
            }

            // 显示加载状态
            this.tooltip.innerHTML = `<div style="color: var(--b3-theme-on-surface-light); font-size: 12px;">${i18n("loading")}</div>`;
            this.tooltip.style.display = 'block';
            this.updateTooltipPosition(event);

            // 异步获取详细信息
            const tooltipContent = await this.buildTooltipContent(calendarEvent);

            // 检查tooltip是否仍然存在（防止快速移动鼠标时的竞态条件）
            if (this.tooltip && this.tooltip.style.display !== 'none') {
                this.tooltip.innerHTML = tooltipContent;
                this.tooltip.style.opacity = '1';
            }

        } catch (error) {
            console.error('显示事件提示框失败:', error);
            this.hideEventTooltip();
        }
    }

    private hideEventTooltip() {
        if (this.tooltip) {
            this.tooltip.style.opacity = '0';
            setTimeout(() => {
                if (this.tooltip) {
                    this.tooltip.style.display = 'none';
                }
            }, 200);
        }
    }

    private forceHideTooltip() {
        // 强制隐藏提示框，清除所有相关定时器
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
            this.tooltipShowTimeout = null;
        }
        if (this.hideTooltipTimeout) {
            clearTimeout(this.hideTooltipTimeout);
            this.hideTooltipTimeout = null;
        }
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
            this.tooltip.style.opacity = '0';
        }
    }

    private updateTooltipPosition(event: MouseEvent) {
        if (!this.tooltip) return;

        const tooltipRect = this.tooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // 计算基础位置（鼠标右下方）
        let left = event.clientX + 10;
        let top = event.clientY + 10;

        // 检查右边界
        if (left + tooltipRect.width > viewportWidth) {
            left = event.clientX - tooltipRect.width - 10;
        }

        // 检查下边界
        if (top + tooltipRect.height > viewportHeight) {
            top = event.clientY - tooltipRect.height - 10;
        }

        // 确保不超出左边界和上边界
        left = Math.max(10, left);
        top = Math.max(10, top);

        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
    }

    private async buildTooltipContent(calendarEvent: any): Promise<string> {
        const reminder = calendarEvent.extendedProps;

        // Special tooltip for Pomodoro events
        if (reminder.type === 'pomodoro') {
            const htmlParts: string[] = [];
            const title = reminder.eventTitle || i18n("unnamedTask");

            // Title
            htmlParts.push(
                `<div style="font-weight: 600; color: var(--b3-theme-on-surface); margin-bottom: 8px; font-size: 14px; text-align: left; width: 100%;">`,
                `🍅 ${this.escapeHtml(title)}`,
                `</div>`
            );

            // Time & Duration
            if (calendarEvent.start && calendarEvent.end) {
                const startTime = calendarEvent.start.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                const endTime = calendarEvent.end.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">`,
                    `<span style="opacity: 0.7;">🕐</span>`,
                    `<span>${startTime} - ${endTime} (${reminder.duration}m)</span>`,
                    `</div>`
                );
            }

            // Associated Task Hint
            if (reminder.eventId) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface-light); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--b3-theme-border); font-size: 12px; font-style: italic;">`,
                    `${i18n("rightClickToManage") || "右键管理记录"}`,
                    `</div>`
                );
            }

            return htmlParts.join('');
        }

        // 优化：使用数组收集HTML片段，最后一次性join，减少字符串拼接开销
        const htmlParts: string[] = [];

        try {
            // 1. 显示标签：项目名、自定义分组名或文档名
            let labelText = '';
            let labelIcon = '';

            if (reminder.projectId) {
                // 如果有项目，显示项目名
                const project = this.projectManager.getProjectById(reminder.projectId);
                if (project) {
                    labelIcon = '📂';
                    labelText = project.name;

                    // 如果有自定义分组，显示"项目-自定义分组"
                    if (reminder.customGroupId) {
                        try {
                            const customGroups = await this.projectManager.getProjectCustomGroups(reminder.projectId);
                            const customGroup = customGroups.find(g => g.id === reminder.customGroupId);
                            if (customGroup) {
                                labelText = `${project.name} - ${customGroup.name}`;
                            }
                        } catch (error) {
                            console.warn('获取自定义分组失败:', error);
                        }
                    }
                }
            } else if (reminder.docTitle && reminder.docId && reminder.blockId && reminder.docId !== reminder.blockId) {
                // 如果没有项目，且绑定块是块而不是文档，显示文档名
                labelIcon = '📄';
                labelText = reminder.docTitle;
            }

            if (labelText) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-background); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-align: left;">`,
                    `<span>${labelIcon}</span>`,
                    `<span title="${i18n("belongsToDocument")}">${this.escapeHtml(labelText)}</span>`,
                    `</div>`
                );
            }

            // 2. 事项名称
            let eventTitle = calendarEvent.title || i18n("unnamedNote");
            if (reminder.categoryId) {
                const categoryIds = reminder.categoryId.split(',');
                for (const id of categoryIds) {
                    const category = this.categoryManager.getCategoryById(id);
                    if (category?.icon) {
                        const iconPrefix = `${category.icon} `;
                        if (eventTitle.startsWith(iconPrefix)) {
                            eventTitle = eventTitle.substring(iconPrefix.length);
                            break;
                        }
                    }
                }
            }
            htmlParts.push(
                `<div style="font-weight: 600; color: var(--b3-theme-on-surface); margin-bottom: 8px; font-size: 14px; text-align: left; width: 100%;">`,
                this.escapeHtml(eventTitle),
                `</div>`
            );

            // 3. 日期时间信息
            const dateTimeInfo = this.formatEventDateTime(reminder);
            if (dateTimeInfo) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">`,
                    `<span style="opacity: 0.7;">🕐</span>`,
                    `<span>${dateTimeInfo}</span>`,
                    `</div>`
                );
            }

            // 3.1 父任务信息
            if (reminder.parentId && reminder.parentTitle) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">`,
                    `<span style="opacity: 0.7;">↪️</span>`,
                    `<span style="font-size: 13px;">${i18n("parentTask") || '父任务'}: ${this.escapeHtml(reminder.parentTitle)}</span>`,
                    `</div>`
                );
            }

            // 4. 优先级信息
            if (reminder.priority && reminder.priority !== 'none') {
                const priorityInfo = this.formatPriorityInfo(reminder.priority);
                if (priorityInfo) {
                    htmlParts.push(
                        `<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">`,
                        priorityInfo,
                        `</div>`
                    );
                }
            }

            // 5. 分类信息
            // 5. 分类信息
            if (reminder.categoryId) {
                const categoryIds = reminder.categoryId.split(',');
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">`,
                    `<span style="opacity: 0.7;">🏷️</span>`
                );

                categoryIds.forEach(id => {
                    const category = this.categoryManager.getCategoryById(id);
                    if (category) {
                        htmlParts.push(
                            `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background-color: ${category.color}; border-radius: 4px; color: white; font-size: 11px;">`
                        );
                        if (category.icon) {
                            htmlParts.push(`<span style="font-size: 12px;">${category.icon}</span>`);
                        }
                        htmlParts.push(
                            `<span>${this.escapeHtml(category.name)}</span>`,
                            `</span>`
                        );
                    }
                });

                htmlParts.push(`</div>`);
            }

            // 6. 重复信息
            if (reminder.isRepeated) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">`,
                    `<span>🔄</span>`,
                    `<span>${i18n("repeatInstance")}</span>`,
                    `</div>`
                );
            } else if (reminder.repeat?.enabled) {
                const repeatDescription = this.getRepeatDescription(reminder.repeat);
                if (repeatDescription) {
                    htmlParts.push(
                        `<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">`,
                        `<span>🔁</span>`,
                        `<span>${repeatDescription}</span>`,
                        `</div>`
                    );
                }
            }

            // 7. 备注信息
            if (reminder.note?.trim()) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface-light); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--b3-theme-border); font-size: 12px;">`,
                    `<div style="margin-bottom: 4px; opacity: 0.7;">${i18n("note")}:</div>`,
                    `<div>${this.lute ? this.lute.Md2HTML(reminder.note) : this.escapeHtml(reminder.note)}</div>`,
                    `</div>`
                );
            }

            // 8. 完成状态和完成时间
            if (reminder.completed) {
                // 获取完成时间 - 修复逻辑
                let completedTime = null;

                try {
                    const reminderData = await getAllReminders(this.plugin);

                    if (reminder.isRepeated) {
                        // 重复事件实例的完成时间
                        const originalReminder = reminderData[reminder.originalId];
                        if (originalReminder?.repeat?.completedTimes) {
                            completedTime = originalReminder.repeat.completedTimes[reminder.date];
                        }
                    } else {
                        // 普通事件的完成时间
                        const currentReminder = reminderData[calendarEvent.id];
                        if (currentReminder) {
                            completedTime = currentReminder.completedTime;
                        }
                    }
                } catch (error) {
                    console.error('获取完成时间失败:', error);
                }

                htmlParts.push(
                    `<div style="color: var(--b3-theme-success); margin-top: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">`,
                    `<span>✅</span>`,
                    `<span>${i18n("completed")}</span>`
                );

                if (completedTime) {
                    const formattedCompletedTime = this.formatCompletedTimeForTooltip(completedTime);
                    htmlParts.push(`<span style="margin-left: 8px; opacity: 0.7;">${formattedCompletedTime}</span>`);
                }

                htmlParts.push(`</div>`);
            }

            // 使用join一次性拼接所有HTML片段，比多次字符串拼接更高效
            return htmlParts.join('');

        } catch (error) {
            console.error('构建提示框内容失败:', error);
            return `<div style="color: var(--b3-theme-error);">${i18n("loadFailed")}</div>`;
        }
    }

    /**
     * 格式化完成时间用于提示框显示
     */
    private formatCompletedTimeForTooltip(completedTime: string): string {
        try {
            const today = getLogicalDateString();
            const yesterdayStr = getRelativeDateString(-1);

            // 解析完成时间
            const completedDate = new Date(completedTime);
            const completedDateStr = getLocalDateString(completedDate);

            const timeStr = completedDate.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });

            if (completedDateStr === today) {
                return `${i18n("completedToday")} ${timeStr}`;
            } else if (completedDateStr === yesterdayStr) {
                return `${i18n("completedYesterday")} ${timeStr}`;
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
    /**
     * 格式化事件日期时间信息
     */
    private formatEventDateTime(reminder: any): string {
        try {
            const today = getLogicalDateString();
            const tomorrowStr = getRelativeDateString(1);

            let dateStr = '';
            if (reminder.date === today) {
                dateStr = i18n("today");
            } else if (reminder.date === tomorrowStr) {
                dateStr = i18n("tomorrow");
            } else {
                const reminderDate = new Date(reminder.date + 'T00:00:00');

                dateStr = reminderDate.toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    weekday: 'short'
                });
            }

            // 处理跨天事件
            if (reminder.endDate && reminder.endDate !== reminder.date) {
                let endDateStr = '';
                if (reminder.endDate === today) {
                    endDateStr = i18n("today");
                } else if (reminder.endDate === tomorrowStr) {
                    endDateStr = i18n("tomorrow");
                } else {
                    const endReminderDate = new Date(reminder.endDate + 'T00:00:00');
                    endDateStr = endReminderDate.toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        weekday: 'short'
                    });
                }

                if (reminder.time || reminder.endTime) {
                    const timeStr = reminder.time ? ` ${reminder.time}` : '';
                    const endTimeStr = reminder.endTime ? ` ${reminder.endTime}` : '';
                    return `${dateStr}${timeStr} → ${endDateStr}${endTimeStr}`;
                } else {
                    return `${dateStr} → ${endDateStr}`;
                }
            }

            // 单日事件
            if (reminder.time) {
                if (reminder.endTime && reminder.endTime !== reminder.time) {
                    return `${dateStr} ${reminder.time} - ${reminder.endTime}`;
                } else {
                    return `${dateStr} ${reminder.time}`;
                }
            }

            return dateStr;

        } catch (error) {
            console.error('格式化日期时间失败:', error);
            return reminder.date || '';
        }
    }

    /**
     * 格式化优先级信息
     */
    private formatPriorityInfo(priority: string): string {
        const priorityMap = {
            'high': { label: i18n("high"), icon: '🔴', color: '#e74c3c' },
            'medium': { label: i18n("medium"), icon: '🟡', color: '#f39c12' },
            'low': { label: i18n("low"), icon: '🔵', color: '#3498db' }
        };

        const priorityInfo = priorityMap[priority];
        if (!priorityInfo) return '';

        return `<span style="opacity: 0.7;">${priorityInfo.icon}</span>
                <span style="color: ${priorityInfo.color};">${priorityInfo.label}</span>`;
    }

    /**
     * 获取重复描述
     */
    private getRepeatDescription(repeat: any): string {
        if (!repeat || !repeat.enabled) return '';

        try {
            switch (repeat.type) {
                case 'daily':
                    return repeat.interval === 1 ? i18n("dailyRepeat") : i18n("everyNDaysRepeat", { n: repeat.interval });
                case 'weekly':
                    return repeat.interval === 1 ? i18n("weeklyRepeat") : i18n("everyNWeeksRepeat", { n: repeat.interval });
                case 'monthly':
                    return repeat.interval === 1 ? i18n("monthlyRepeat") : i18n("everyNMonthsRepeat", { n: repeat.interval });
                case 'yearly':
                    return repeat.interval === 1 ? i18n("yearlyRepeat") : i18n("everyNYearsRepeat", { n: repeat.interval });
                case 'lunar-monthly':
                    return i18n("lunarMonthlyRepeat");
                case 'lunar-yearly':
                    return i18n("lunarYearlyRepeat");
                case 'custom':
                    return i18n("customRepeat");
                case 'ebbinghaus':
                    return i18n("ebbinghausRepeat");
                default:
                    return i18n("repeatEvent");
            }
        } catch (error) {
            console.error('获取重复描述失败:', error);
            return i18n("repeatEvent");
        }
    }

    /**
     * HTML转义函数
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }


    // 添加销毁方法
    destroy() {
        // 清理提示框显示延迟超时
        if (this.tooltipShowTimeout) {
            clearTimeout(this.tooltipShowTimeout);
            this.tooltipShowTimeout = null;
        }

        // 清理提示框超时
        if (this.hideTooltipTimeout) {
            clearTimeout(this.hideTooltipTimeout);
            this.hideTooltipTimeout = null;
        }

        // 清理双击检测超时
        if (this.clickTimeout) {
            clearTimeout(this.clickTimeout);
            this.clickTimeout = null;
        }

        // 清理刷新防抖超时
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = null;
        }

        // 清理提示框
        if (this.tooltip) {
            this.tooltip.remove();
            this.tooltip = null;
        }

        // 清理缓存
        this.colorCache.clear();

        // 调用清理函数
        const cleanup = (this.container as any)._calendarCleanup;
        if (cleanup) {
            cleanup();
        }

        // 移除事件监听器
        if (this.externalReminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.externalReminderUpdatedHandler);
            this.externalReminderUpdatedHandler = null;
        }
        window.removeEventListener('projectColorUpdated', () => {
            this.colorCache.clear();
            this.refreshEvents();
        });

        // 销毁日历实例
        if (this.calendar) {
            this.calendar.destroy();
        }

        // 清理容器
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    /**
     * 分割重复事件系列 - 修改原始事件并创建新系列
     */
    private async splitRecurringEvent(calendarEvent: any) {
        try {
            const reminder = calendarEvent.extendedProps;
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[calendarEvent.id];

            if (!originalReminder || !originalReminder.repeat?.enabled) {
                showMessage(i18n("operationFailed"));
                return;
            }

            // 计算下一个周期日期
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(i18n("operationFailed") + ": " + i18n("invalidRepeatConfig"));
                return;
            }
            const nextDateStr = getLocalDateTime(nextDate).dateStr;

            // 创建用于编辑的临时数据
            const editData = {
                ...originalReminder,
                isSplitOperation: true,
                originalId: calendarEvent.id,
                nextCycleDate: nextDateStr,
                nextCycleEndDate: originalReminder.endDate ? this.calculateEndDateForSplit(originalReminder, nextDate) : undefined
            };

            // 打开编辑对话框
            const editDialog = new QuickReminderDialog(
                editData.date,
                editData.time,
                undefined,
                undefined,
                {
                    reminder: editData,
                    mode: 'edit',
                    onSaved: async (modifiedReminder) => {
                        await this.performSplitOperation(originalReminder, modifiedReminder);
                    },
                    plugin: this.plugin
                }
            );
            editDialog.show();

        } catch (error) {
            console.error('分割重复事件系列失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * 执行分割操作
     */
    private async performSplitOperation(originalReminder: any, modifiedReminder: any) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            // 1. 修改原始事件为单次事件
            const singleReminder = {
                ...originalReminder,
                title: modifiedReminder.title,
                date: modifiedReminder.date,
                time: modifiedReminder.time,
                endDate: modifiedReminder.endDate,
                endTime: modifiedReminder.endTime,
                note: modifiedReminder.note,
                priority: modifiedReminder.priority,
                repeat: undefined
            };

            // 2. 创建新的重复事件系列
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒的重复历史数据，同时保留原始系列的 endDate
            const originalEndDate = originalReminder.repeat?.endDate;
            if (originalEndDate) {
                newReminder.repeat.endDate = originalEndDate;
            } else {
                delete newReminder.repeat.endDate;
            }
            delete newReminder.repeat.excludeDates;
            delete newReminder.repeat.instanceModifications;
            delete newReminder.repeat.completedInstances;

            // 生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            newReminder.id = newId;

            // 3. 设置新系列从下一个周期开始
            newReminder.date = modifiedReminder.nextCycleDate;
            newReminder.endDate = modifiedReminder.nextCycleEndDate;
            newReminder.time = originalReminder.time;
            newReminder.endTime = originalReminder.endTime;
            newReminder.title = originalReminder.title;
            newReminder.note = originalReminder.note;
            newReminder.priority = originalReminder.priority;

            // 应用重复设置
            if (modifiedReminder.repeat && modifiedReminder.repeat.enabled) {
                newReminder.repeat = { ...modifiedReminder.repeat };
                // 如果用户没有在新的重复设置中指定 endDate，则保留原始系列的 endDate（如果有）
                if (!newReminder.repeat.endDate && originalEndDate) {
                    newReminder.repeat.endDate = originalEndDate;
                }
            } else {
                newReminder.repeat = { ...originalReminder.repeat };
                // 保留原始系列的 endDate（如果有）
                if (!newReminder.repeat.endDate && originalEndDate) {
                    newReminder.repeat.endDate = originalEndDate;
                }
            }

            // 4. 保存修改
            reminderData[originalReminder.id] = singleReminder;
            reminderData[newId] = newReminder;
            await saveReminders(this.plugin, reminderData);

            // 5. 更新界面
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
            showMessage(i18n("seriesSplitSuccess"));

        } catch (error) {
            console.error('执行分割重复事件系列失败:', error);
            showMessage(i18n("operationFailed"));
        }
    }

    /**
     * 跳过首次发生 - 为原始事件添加排除日期
     */

    private async skipFirstOccurrence(reminder: any) {
        await confirm(
            i18n("deleteThisInstance"),
            i18n("confirmSkipFirstOccurrence"),
            async () => {
                try {
                    const reminderData = await getAllReminders(this.plugin);
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
                        const originalStart = new Date(reminder.date + 'T12:00:00');
                        const originalEnd = new Date(originalReminder.endDate + 'T12:00:00');
                        const daysDiff = Math.floor((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24));

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
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                } catch (error) {
                    console.error('跳过首次发生失败:', error);
                    showMessage(i18n("operationFailed"));
                }
            }
        );
    }

    /**
     * 计算下一个周期日期
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
                return this.calculateLunarMonthlyNext(startDateStr, repeat.lunarDay);
            case 'lunar-yearly':
                return this.calculateLunarYearlyNext(startDateStr, repeat.lunarMonth, repeat.lunarDay);
            default:
                console.error("Unknown repeat type:", repeat.type);
                return null;
        }
    }

    /**
     * 计算每日重复的下一个日期
     */
    private calculateDailyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + interval);
        return nextDate;
    }

    /**
     * 计算每周重复的下一个日期
     */
    private calculateWeeklyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setDate(nextDate.getDate() + (7 * interval));
        return nextDate;
    }

    /**
     * 计算每月重复的下一个日期
     */
    private calculateMonthlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setMonth(nextDate.getMonth() + interval);

        // 处理月份溢出
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // 设置为前一个月的最后一天
        }

        return nextDate;
    }

    /**
     * 计算每年重复的下一个日期
     */
    private calculateYearlyNext(startDate: Date, interval: number): Date {
        const nextDate = new Date(startDate);
        nextDate.setFullYear(nextDate.getFullYear() + interval);

        // 处理闰年边界情况
        if (nextDate.getDate() !== startDate.getDate()) {
            nextDate.setDate(0); // 设置为前一个月的最后一天
        }

        return nextDate;
    }

    /**
     * 计算农历每月重复的下一个日期
     */
    private calculateLunarMonthlyNext(currentDateStr: string, lunarDay: number): Date {
        const nextDateStr = getNextLunarMonthlyDate(currentDateStr, lunarDay);
        if (nextDateStr) {
            return new Date(nextDateStr + 'T12:00:00');
        }
        // 如果计算失败，返回明天
        const nextDate = new Date(currentDateStr + 'T12:00:00');
        nextDate.setDate(nextDate.getDate() + 1);
        return nextDate;
    }

    /**
     * 计算农历每年重复的下一个日期
     */
    private calculateLunarYearlyNext(currentDateStr: string, lunarMonth: number, lunarDay: number): Date {
        const nextDateStr = getNextLunarYearlyDate(currentDateStr, lunarMonth, lunarDay);
        if (nextDateStr) {
            return new Date(nextDateStr + 'T12:00:00');
        }
        // 如果计算失败，返回明天
        const nextDate = new Date(currentDateStr + 'T12:00:00');
        nextDate.setDate(nextDate.getDate() + 1);
        return nextDate;
    }

    /**
     * 计算分割时的结束日期
     */
    private calculateEndDateForSplit(originalReminder: any, nextDate: Date): string {
        if (!originalReminder.endDate) {
            return undefined;
        }

        // 计算原始事件的持续天数
        const originalStart = new Date(originalReminder.date + 'T00:00:00');
        const originalEnd = new Date(originalReminder.endDate + 'T00:00:00');
        const durationDays = Math.round((originalEnd.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24));

        // 为新系列计算结束日期
        const newEndDate = new Date(nextDate);
        newEndDate.setDate(newEndDate.getDate() + durationDays);

        return getLocalDateTime(newEndDate).dateStr;
    }

    /**
     * 显示绑定到块的对话框
     */
    private showBindToBlockDialog(calendarEvent: any) {
        const dialog = new BlockBindingDialog(
            this.plugin,
            async (blockId: string) => {
                try {
                    await this.bindReminderToBlock(calendarEvent, blockId);
                    showMessage(i18n("reminderBoundToBlock"));
                    // 刷新日历显示
                    await this.refreshEvents();
                } catch (error) {
                    console.error('绑定提醒到块失败:', error);
                    showMessage(i18n("bindToBlockFailed"));
                }
            },
            {
                title: i18n("bindReminderToBlock"),
                defaultTab: 'bind',
                reminder: calendarEvent,
                defaultTitle: calendarEvent.title || ''
            }
        );
        dialog.show();
    }


    /**
     * 将提醒绑定到指定的块
     */
    private async bindReminderToBlock(calendarEvent: any, blockId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const reminderId = calendarEvent.id;

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
                    console.debug('CalendarView: bindReminderToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBindBlockAtrrs(blockId, this.plugin);

                // 触发更新事件（标记来源为日历，避免自我触发）
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
            } else {
                throw new Error('提醒不存在');
            }
        } catch (error) {
            console.error('绑定提醒到块失败:', error);
            throw error;
        }
    }

    // 添加番茄钟相关方法
    private startPomodoro(calendarEvent: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (this.pomodoroManager.hasActivePomodoroTimer()) {
            // 获取当前番茄钟的状态
            const currentState = this.pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = calendarEvent.title || '新任务';

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

                confirmMessage += `\n\n当前状态: ${timeDisplay}\n\n选择"确定"将继承当前进度继续计时。`;
            }

            // 显示确认对话框
            confirm(
                "切换番茄钟任务",
                confirmMessage,
                () => {
                    // 用户确认替换，传递当前状态
                    this.performStartPomodoro(calendarEvent, currentState);
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
            this.performStartPomodoro(calendarEvent);
        }
    }

    private startPomodoroCountUp(calendarEvent: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (this.pomodoroManager.hasActivePomodoroTimer()) {
            // 获取当前番茄钟的状态
            const currentState = this.pomodoroManager.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = calendarEvent.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                if (!this.pomodoroManager.pauseCurrentTimer()) {
                    console.error('暂停当前番茄钟失败');
                }

                confirmMessage += `\n\n选择"确定"将继承当前进度继续计时。`;
            }

            // 显示确认对话框
            confirm(
                "切换到正计时番茄钟",
                confirmMessage,
                () => {
                    // 用户确认替换，传递当前状态
                    this.performStartPomodoroCountUp(calendarEvent, currentState);
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
            this.performStartPomodoroCountUp(calendarEvent);
        }
    }

    private async performStartPomodoro(calendarEvent: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟');

            // 构建提醒对象
            const reminder = {
                id: calendarEvent.id,
                title: calendarEvent.title,
                blockId: calendarEvent.extendedProps.blockId,
                isRepeatInstance: calendarEvent.extendedProps.isRepeated,
                originalId: calendarEvent.extendedProps.originalId
            };

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

            // 构建提醒对象
            const reminder = {
                id: calendarEvent.id,
                title: calendarEvent.title,
                blockId: calendarEvent.extendedProps.blockId,
                isRepeatInstance: calendarEvent.extendedProps.isRepeated,
                originalId: calendarEvent.extendedProps.originalId
            };

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

    private async performStartPomodoroCountUp(calendarEvent: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟（正计时模式）');

            // 构建提醒对象
            const reminder = {
                id: calendarEvent.id,
                title: calendarEvent.title,
                blockId: calendarEvent.extendedProps.blockId,
                isRepeatInstance: calendarEvent.extendedProps.isRepeated,
                originalId: calendarEvent.extendedProps.originalId
            };

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
            console.log('没有独立窗口，在当前窗口显示番茄钟 Dialog（正计时模式）');

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            // 构建提醒对象
            const reminder = {
                id: calendarEvent.id,
                title: calendarEvent.title,
                blockId: calendarEvent.extendedProps.blockId,
                isRepeatInstance: calendarEvent.extendedProps.isRepeated,
                originalId: calendarEvent.extendedProps.originalId
            };

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
            this.plugin.openProjectKanbanTab(projectId, project.title);
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage("打开项目看板失败");
        }
    }






    /**
     * 更新番茄钟按钮的可见性
     * 仅在时间轴视图（timeGrid...）中显示
     */
    private updatePomodoroButtonVisibility() {
        if (!this.pomodoroToggleBtn) return;

        const currentViewType = this.calendar?.view?.type;
        const isTimeGridView = currentViewType && (
            currentViewType === 'timeGridDay' ||
            currentViewType === 'timeGridWeek' ||
            currentViewType === 'timeGridMultiDays7'
        );

        if (isTimeGridView) {
            this.pomodoroToggleBtn.style.display = 'inline-flex';
        } else {
            this.pomodoroToggleBtn.style.display = 'none';
        }
    }

    /**
     * 更新番茄钟按钮的激活状态样式
     */
    private updatePomodoroButtonState() {
        if (!this.pomodoroToggleBtn) return;

        if (this.showPomodoro) {
            this.pomodoroToggleBtn.classList.remove('b3-button--outline');
            this.pomodoroToggleBtn.classList.add('b3-button--primary');
            this.pomodoroToggleBtn.style.setProperty('background-color', 'rgba(255, 0, 0, 0.1)', 'important');
            this.pomodoroToggleBtn.style.setProperty('color', '#d23f31', 'important');
            this.pomodoroToggleBtn.style.setProperty('border-color', '#d23f31', 'important');
        } else {
            this.pomodoroToggleBtn.classList.remove('b3-button--primary');
            this.pomodoroToggleBtn.classList.add('b3-button--outline');
            this.pomodoroToggleBtn.style.backgroundColor = '';
            this.pomodoroToggleBtn.style.color = '';
            this.pomodoroToggleBtn.style.borderColor = '';
        }
    }

    /**
     * 更新视图按钮的激活状态
     */
    private updateViewButtonStates() {
        const currentViewMode = this.calendarConfigManager.getViewMode();

        // 重置所有按钮样式
        this.monthBtn.classList.remove('b3-button--primary');
        this.weekBtn.classList.remove('b3-button--primary');
        this.dayBtn.classList.remove('b3-button--primary');
        this.yearBtn.classList.remove('b3-button--primary');
        if (this.multiDaysBtn) this.multiDaysBtn.classList.remove('b3-button--primary');

        // 根据当前视图模式设置激活按钮
        switch (currentViewMode) {
            case 'dayGridMonth':
                this.monthBtn.classList.add('b3-button--primary');
                break;
            case 'timeGridWeek':
            case 'dayGridWeek':
            case 'listWeek':
                this.weekBtn.classList.add('b3-button--primary');
                break;
            case 'timeGridDay':
            case 'dayGridDay':
            case 'listDay':
                this.dayBtn.classList.add('b3-button--primary');
                break;
            case 'multiMonthYear':
                this.yearBtn.classList.add('b3-button--primary');
                break;
            case 'timeGridMultiDays7':
            case 'dayGridMultiDays7':
            case 'listMultiDays7':
                if (this.multiDaysBtn) this.multiDaysBtn.classList.add('b3-button--primary');
                break;
            case 'listMonth':
                this.monthBtn.classList.add('b3-button--primary');
                break;
            case 'listYear':
                this.yearBtn.classList.add('b3-button--primary');
                break;
        }
    }

    /**
     * 获取周开始日设置
     */
    private async getWeekStartDay(): Promise<number> {
        try {
            const settings = await this.plugin.loadSettings();
            let weekStartDay = settings.weekStartDay;

            // 如果以字符串形式存储（如"1"），尝试转换为数字
            if (typeof weekStartDay === 'string') {
                const parsed = parseInt(weekStartDay, 10);
                if (!isNaN(parsed)) {
                    weekStartDay = parsed;
                }
            }

            // 确保值在0-6范围内 (0=周日, 1=周一, ..., 6=周六)
            if (typeof weekStartDay === 'number' && weekStartDay >= 0 && weekStartDay <= 6) {
                return weekStartDay;
            }

            // 如果配置无效，返回默认值（周一）
            return 1;
        } catch (error) {
            console.error('获取周开始日设置失败:', error);
            // 出错时返回默认值（周一）
            return 1;
        }
    }

    /**
     * 获取一天起始时间设置（用于日历视图滚动位置）
     */
    private async getDayStartTime(): Promise<string> {
        try {
            const settings = await this.plugin.loadSettings();
            const dayStartTime = settings.dayStartTime;

            // 验证时间格式 (HH:MM)
            if (typeof dayStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(dayStartTime)) {
                return dayStartTime;
            }

            // 如果配置无效，返回默认值
            return '06:00';
        } catch (error) {
            console.error('获取一天起始时间设置失败:', error);
            // 出错时返回默认值
            return '06:00';
        }
    }

    /**
     * 获取逻辑一天起始时间设置（todayStartTime）
     * 用于日历视图的时间范围显示
     */
    private async getTodayStartTime(): Promise<string> {
        try {
            const settings = await this.plugin.loadSettings();
            const todayStartTime = settings.todayStartTime;

            // 验证时间格式 (HH:MM)
            if (typeof todayStartTime === 'string' && /^\d{1,2}:\d{2}$/.test(todayStartTime)) {
                return todayStartTime;
            }

            // 如果配置无效，返回默认值
            return '00:00';
        } catch (error) {
            console.error('获取逻辑一天起始时间设置失败:', error);
            // 出错时返回默认值
            return '00:00';
        }
    }

    /**
     * 计算 slotMaxTime（一天的结束时间）
     * 如果 todayStartTime 是 03:00，则 slotMaxTime 应该是 27:00（次日 03:00）
     * 如果 todayStartTime 是 00:00，则 slotMaxTime 应该是 24:00（次日 00:00）
     */
    private calculateSlotMaxTime(todayStartTime: string): string {
        try {
            // 解析时间字符串
            const match = todayStartTime.match(/^(\d{1,2}):(\d{2})$/);
            if (!match) {
                return '24:00'; // 默认值
            }

            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);

            // 计算下一天的同一时间（24小时后）
            const maxHours = 24 + hours;
            const maxMinutes = minutes;

            // 格式化为 HH:MM
            const formattedHours = maxHours.toString().padStart(2, '0');
            const formattedMinutes = maxMinutes.toString().padStart(2, '0');

            return `${formattedHours}:${formattedMinutes}`;
        } catch (error) {
            console.error('计算 slotMaxTime 失败:', error);
            return '24:00';
        }
    }

    private async addItemByBlockId(blockId: string, startDate: Date, isAllDay: boolean) {
        try {
            const block = await getBlockByID(blockId);
            if (!block) return;

            const reminderData = await getAllReminders(this.plugin);
            const dateStr = getLocalDateString(startDate);
            const timeStr = isAllDay ? "" : startDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

            const reminderId = window.Lute?.NewNodeID?.() || `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            let title = block.content || i18n('unnamedNote') || '未命名任务';
            if (title.length > 100) title = title.substring(0, 100) + '...';

            const newReminder: any = {
                id: reminderId,
                title: title.trim(),
                blockId: blockId,
                docId: block.root_id || (block.type === 'd' ? block.id : null),
                date: dateStr,
                time: timeStr,
                createdAt: new Date().toISOString(),
                createdTime: new Date().toISOString(),
                completed: false
            };

            reminderData[reminderId] = newReminder;
            await saveReminders(this.plugin, reminderData);
            await updateBindBlockAtrrs(blockId, this.plugin);
        } catch (error) {
            console.error('addItemByBlockId failed:', error);
            showMessage(i18n('createFailed') || '创建失败');
        }
    }

    private escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private async showCreateSubtaskDialog(calendarEvent: any) {
        // 获取父任务ID
        let parentId = calendarEvent.extendedProps?.originalId || calendarEvent.id;
        
        // 获取父任务数据
        const reminderData = await getAllReminders(this.plugin);
        const parentReminder = reminderData[parentId];
        
        if (!parentReminder) {
            showMessage(i18n("reminderNotExist") || "任务不存在");
            return;
        }

        // 计算默认日期
        const today = getLogicalDateString();
        const startDate = parentReminder.date;
        const endDate = parentReminder.endDate || parentReminder.date;
        
        let defaultDate: string;
        
        // 判断是否是跨日任务
        const isCrossDay = startDate !== endDate;
        
        if (isCrossDay) {
            // 跨日任务：检查今天是否在时间段内
            if (today >= startDate && today <= endDate) {
                // 今天日期在任务时间段内，自动填充今日日期
                defaultDate = today;
            } else if (startDate > today) {
                // 任务开始时间晚于今天（未来任务），填充起始日期
                defaultDate = startDate;
            } else {
                // 任务结束时间早于今天（过去任务），填充结束日期
                defaultDate = endDate;
            }
        } else {
            // 非跨日任务（单日任务）
            if (startDate >= today) {
                // 任务日期在今天或未来，使用任务日期
                defaultDate = startDate;
            } else {
                // 任务日期在过去，使用今天日期
                defaultDate = today;
            }
        }

        // 计算最大排序值，以便将新任务放在末尾
        const allReminders = Object.values(reminderData);
        const maxSort = allReminders.reduce((max, r) => Math.max(max, r.sort || 0), 0);
        const defaultSort = maxSort + 10000;

        // 处理时间段继承
        let defaultTime: string | undefined = undefined;
        let timeRangeOptions: { isTimeRange: boolean; endDate?: string; endTime?: string } | undefined = undefined;
        
        // 如果父任务有时间设置
        if (parentReminder.time) {
            defaultTime = parentReminder.time;
            
            // 如果是单日任务且有结束时间，则继承时间段设置
            if (!isCrossDay && parentReminder.endTime) {
                timeRangeOptions = {
                    isTimeRange: true,
                    endDate: defaultDate,
                    endTime: parentReminder.endTime
                };
            }
        }

        const dialog = new QuickReminderDialog(
            defaultDate, // 计算后的默认日期
            defaultTime, // 继承父任务时间
            async () => { // onSaved - optimistic update
                this.refreshEvents();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
            },
            timeRangeOptions, // 时间段选项（单日任务继承父任务时间段）
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

    private async showParentTaskDialog(calendarEvent: any) {
        const parentId = calendarEvent.extendedProps?.parentId;
        if (!parentId) {
            showMessage(i18n("noParentTask") || "没有父任务");
            return;
        }

        // 获取父任务数据
        const reminderData = await getAllReminders(this.plugin);
        const parentTask = reminderData[parentId];

        if (!parentTask) {
            showMessage(i18n("parentTaskNotExist") || "父任务不存在");
            return;
        }

        // 判断是否是重复任务实例
        const isInstanceEdit = calendarEvent.extendedProps?.isRepeated || false;
        const instanceDate = calendarEvent.extendedProps?.date;

        const parentDialog = new QuickReminderDialog(
            isInstanceEdit ? instanceDate : parentTask.date,
            parentTask.time,
            undefined,
            parentTask.endDate ? {
                isTimeRange: true,
                endDate: parentTask.endDate,
                endTime: parentTask.endTime
            } : undefined,
            {
                reminder: parentTask,
                mode: 'edit',
                plugin: this.plugin,
                isInstanceEdit: isInstanceEdit,
                instanceDate: isInstanceEdit ? instanceDate : undefined,
                onSaved: async () => {
                    // 父任务保存后刷新日历
                    await this.refreshEvents();
                    // 触发全局刷新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                }
            }
        );
        parentDialog.show();
    }
}
