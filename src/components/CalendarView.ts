import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth';
import interactionPlugin from '@fullcalendar/interaction';
import { showMessage, confirm, openTab, Menu, Dialog } from "siyuan";
import { refreshSql, getBlockByID, sql, updateBlock, getBlockKramdown, updateBlockReminderBookmark, openBlock, readProjectData } from "../api";
import { getLocalDateString, getLocalDateTime, getLocalDateTimeString, compareDateStrings, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { StatusManager } from "../utils/statusManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { ProjectColorDialog } from "./ProjectColorDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { t } from "../utils/i18n";
import { generateRepeatInstances, RepeatInstance, getDaysDifference, addDaysToDate } from "../utils/repeatUtils";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import { CalendarConfigManager } from "../utils/calendarConfigManager";
import { TaskSummaryDialog } from "@/components/TaskSummaryDialog";
import { PomodoroManager } from "../utils/pomodoroManager";
import { getNextLunarMonthlyDate, getNextLunarYearlyDate, getSolarDateLunarString } from "../utils/lunarUtils";
import { BlockBindingDialog } from "./BlockBindingDialog";
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
    private currentCategoryFilter: string = 'all'; // 当前分类过滤
    private currentProjectFilter: string = 'all'; // 当前项目过滤
    private initialProjectFilter: string | null = null;
    private colorBy: 'category' | 'priority' | 'project' = 'project'; // 按分类或优先级上色
    private tooltip: HTMLElement | null = null; // 添加提示框元素
    private dropIndicator: HTMLElement | null = null; // 拖放放置指示器
    private externalReminderUpdatedHandler: ((e: Event) => void) | null = null;
    private hideTooltipTimeout: number | null = null; // 添加提示框隐藏超时控制
    private tooltipShowTimeout: number | null = null; // 添加提示框显示延迟控制
    private lastClickTime: number = 0; // 添加双击检测
    private clickTimeout: number | null = null; // 添加单击延迟超时
    private refreshTimeout: number | null = null; // 添加刷新防抖超时
    private currentCompletionFilter: string = 'all'; // 当前完成状态过滤

    // 性能优化：颜色缓存
    private colorCache: Map<string, { backgroundColor: string; borderColor: string }> = new Map();

    // 视图按钮引用
    private monthBtn: HTMLButtonElement;
    private weekBtn: HTMLButtonElement;
    private dayBtn: HTMLButtonElement;
    private yearBtn: HTMLButtonElement;
    private viewTypeSwitch: HTMLInputElement;

    // 使用全局番茄钟管理器
    private pomodoroManager: PomodoroManager = PomodoroManager.getInstance();

    constructor(container: HTMLElement, plugin: any, data?: { projectFilter?: string }) {
        this.container = container;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(plugin); // 初始化分类管理器
        this.projectManager = ProjectManager.getInstance(this.plugin);
        this.statusManager = StatusManager.getInstance(plugin);
        this.calendarConfigManager = CalendarConfigManager.getInstance(this.plugin);
        this.taskSummaryDialog = new TaskSummaryDialog(undefined, plugin);
        if (data?.projectFilter) {
            this.initialProjectFilter = data.projectFilter;
        }
        this.initUI();
    }

    private async initUI() {
        // 初始化分类管理器
        await this.categoryManager.initialize();
        await this.projectManager.initialize();
        await this.statusManager.initialize();
        await this.calendarConfigManager.initialize();

        if (this.initialProjectFilter) {
            this.currentProjectFilter = this.initialProjectFilter;
            this.currentCategoryFilter = 'all';
        }

        // 从配置中读取colorBy和viewMode设置
        this.colorBy = this.calendarConfigManager.getColorBy();

        // 获取周开始日设置
        const weekStartDay = await this.getWeekStartDay();

        // 获取日历视图滚动位置（dayStartTime）
        const dayStartTime = await this.getDayStartTime();

        // 获取逻辑一天起始时间（todayStartTime）
        const todayStartTime = await this.getTodayStartTime();
        const slotMaxTime = this.calculateSlotMaxTime(todayStartTime);

        this.container.classList.add('reminder-calendar-view');

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
        this.yearBtn.textContent = t("year");
        this.yearBtn.addEventListener('click', async () => {
            await this.calendarConfigManager.setViewMode('multiMonthYear');
            this.calendar.changeView('multiMonthYear');
            this.updateViewButtonStates();
        });
        viewGroup.appendChild(this.yearBtn);
        this.monthBtn = document.createElement('button');
        this.monthBtn.className = 'b3-button b3-button--outline';
        this.monthBtn.textContent = t("month");
        this.monthBtn.addEventListener('click', async () => {
            await this.calendarConfigManager.setViewMode('dayGridMonth');
            this.calendar.changeView('dayGridMonth');
            this.updateViewButtonStates();
        });
        viewGroup.appendChild(this.monthBtn);

        this.weekBtn = document.createElement('button');
        this.weekBtn.className = 'b3-button b3-button--outline';
        this.weekBtn.textContent = t("week");
        this.weekBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            const viewMode = viewType === 'dayGrid' ? 'dayGridWeek' : 'timeGridWeek';
            await this.calendarConfigManager.setViewMode(viewMode);
            this.calendar.changeView(viewMode);
            this.updateViewButtonStates();
        });
        viewGroup.appendChild(this.weekBtn);

        this.dayBtn = document.createElement('button');
        this.dayBtn.className = 'b3-button b3-button--outline';
        this.dayBtn.textContent = t("day");
        this.dayBtn.addEventListener('click', async () => {
            const viewType = this.calendarConfigManager.getViewType();
            const viewMode = viewType === 'dayGrid' ? 'dayGridDay' : 'timeGridDay';
            await this.calendarConfigManager.setViewMode(viewMode);
            this.calendar.changeView(viewMode);
            this.updateViewButtonStates();
        });
        viewGroup.appendChild(this.dayBtn);




        // 添加视图类型切换开关
        const switchContainer = document.createElement('div');
        switchContainer.style.display = 'flex';
        switchContainer.style.alignItems = 'center';
        switchContainer.style.marginLeft = '8px';
        switchContainer.style.whiteSpace = 'nowrap';
        switchContainer.style.flexShrink = '0';
        switchContainer.title = t("switchViewType");

        const switchLabel = document.createElement('label');
        switchLabel.className = 'b3-form__label';
        switchLabel.textContent = t("switchViewType");
        switchLabel.style.marginRight = '4px';
        switchLabel.style.fontSize = '12px';

        this.viewTypeSwitch = document.createElement('input');
        this.viewTypeSwitch.type = 'checkbox';
        this.viewTypeSwitch.className = 'b3-switch';
        this.viewTypeSwitch.addEventListener('change', () => {
            this.toggleViewType();
        });

        switchContainer.appendChild(switchLabel);
        switchContainer.appendChild(this.viewTypeSwitch);
        viewGroup.appendChild(switchContainer);


        // 添加统一过滤器
        const filterGroup = document.createElement('div');
        filterGroup.className = 'reminder-calendar-filter-group';
        filterGroup.style.display = 'flex';
        filterGroup.style.justifyContent = 'flex-end';
        filterGroup.style.alignItems = 'center';
        filterGroup.style.flexWrap = 'wrap';
        filterGroup.style.gap = '8px';
        toolbar.appendChild(filterGroup);

        // 筛选图标
        const filterIcon = document.createElement('span');
        filterIcon.innerHTML = '<svg style="width: 14px; height: 14px; margin-right: 4px; vertical-align: middle;"><use xlink:href="#iconFilter"></use></svg>';
        filterIcon.style.color = 'var(--b3-theme-on-surface-light)';
        filterGroup.appendChild(filterIcon);

        // 创建统一的筛选下拉框
        const unifiedFilterSelect = document.createElement('select');
        unifiedFilterSelect.className = 'b3-select';
        unifiedFilterSelect.style.width = '15%';
        unifiedFilterSelect.title = t("filterReminders") || "筛选提醒";
        unifiedFilterSelect.addEventListener('change', () => {
            const selectedValue = unifiedFilterSelect.value;
            // 解析选择值格式：type:id (category:123 或 project:456)
            const [type, id] = selectedValue.split(':');
            if (type === 'category') {
                this.currentCategoryFilter = id;
                this.currentProjectFilter = 'all'; // 重置项目筛选
            } else if (type === 'project') {
                this.currentProjectFilter = id;
                this.currentCategoryFilter = 'all'; // 重置分类筛选
            } else {
                // 全部或无分类/无项目
                this.currentCategoryFilter = selectedValue;
                this.currentProjectFilter = selectedValue === 'all' ? 'all' : (selectedValue === 'none' ? 'none' : 'all');
            }
            this.refreshEvents();
        });
        filterGroup.appendChild(unifiedFilterSelect);

        // 渲染统一筛选器
        await this.renderUnifiedFilter(unifiedFilterSelect);
        // 添加完成状态筛选
        const completionFilterSelect = document.createElement('select');
        completionFilterSelect.className = 'b3-select';
        completionFilterSelect.style.width = '15%';
        completionFilterSelect.innerHTML = `
            <option value="all">${t("allStatuses") || "全部状态"}</option>
            <option value="incomplete">${t("incomplete") || "未完成"}</option>
            <option value="completed">${t("completed") || "已完成"}</option>
        `;
        completionFilterSelect.value = this.currentCompletionFilter;
        completionFilterSelect.addEventListener('change', () => {
            this.currentCompletionFilter = completionFilterSelect.value;
            this.refreshEvents();
        });
        filterGroup.appendChild(completionFilterSelect);
        // 添加按分类/优先级上色切换
        const colorBySelect = document.createElement('select');
        colorBySelect.className = 'b3-select';
        colorBySelect.style.width = '15%';
        colorBySelect.innerHTML = `
            <option value="project">${t("colorByProject")}</option>
            <option value="category">${t("colorByCategory")}</option>
            <option value="priority">${t("colorByPriority")}</option>
        `;
        colorBySelect.value = this.colorBy;
        colorBySelect.addEventListener('change', async () => {
            this.colorBy = colorBySelect.value as 'category' | 'priority' | 'project';
            await this.calendarConfigManager.setColorBy(this.colorBy);
            // 清除颜色缓存
            this.colorCache.clear();
            this.refreshEvents();
        });
        filterGroup.appendChild(colorBySelect);



        if (this.initialProjectFilter) {
            unifiedFilterSelect.value = `project:${this.initialProjectFilter}`;
        }

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.style.padding = '6px';
        refreshBtn.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = t("refresh");
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            try {
                showMessage(t("refreshing") || "正在刷新...", 500);
                await this.refreshEvents();
            } catch (error) {
                console.error('手动刷新失败:', error);
                showMessage(t("refreshFailed") || "刷新失败");
            } finally {
                refreshBtn.disabled = false;
            }
        });
        filterGroup.appendChild(refreshBtn);

        // 分类管理按钮
        const categoryManageBtn = document.createElement('button');
        categoryManageBtn.className = 'b3-button b3-button--outline';
        categoryManageBtn.style.padding = '6px';
        categoryManageBtn.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconTags"></use></svg>';
        categoryManageBtn.title = t("manageCategories");
        categoryManageBtn.addEventListener('click', () => {
            this.showCategoryManageDialog();
        });
        filterGroup.appendChild(categoryManageBtn);

        // 项目颜色管理按钮
        const projectColorManageBtn = document.createElement('button');
        projectColorManageBtn.className = 'b3-button b3-button--outline';
        projectColorManageBtn.style.padding = '6px';
        projectColorManageBtn.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconProject"></use></svg>';
        projectColorManageBtn.title = t("manageProjectColors");
        projectColorManageBtn.addEventListener('click', () => {
            this.showProjectColorDialog();
        });
        filterGroup.appendChild(projectColorManageBtn);

        // 摘要按钮
        const summaryBtn = document.createElement('button');
        summaryBtn.className = 'b3-button b3-button--outline';
        summaryBtn.style.padding = '6px';
        summaryBtn.innerHTML = '<svg class="b3-button__icon" style="margin-right: 0;"><use xlink:href="#iconList"></use></svg>';
        summaryBtn.title = t("taskSummary") || "任务摘要";
        summaryBtn.addEventListener('click', () => {
            this.taskSummaryDialog.showTaskSummaryDialog();
        });
        filterGroup.appendChild(summaryBtn);

        // 创建日历容器
        const calendarEl = document.createElement('div');
        calendarEl.className = 'reminder-calendar-container';
        this.container.appendChild(calendarEl);

        // 初始化日历 - 使用用户设置的周开始日
        this.calendar = new Calendar(calendarEl, {
            plugins: [dayGridPlugin, timeGridPlugin, multiMonthPlugin, interactionPlugin],
            initialView: this.calendarConfigManager.getViewMode(),
            multiMonthMaxColumns: 1, // force a single column
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: ''
            },
            editable: true,
            selectable: true,
            selectMirror: true,
            selectOverlap: true,
            locale: window.siyuan.config.lang.toLowerCase().replace('_', '-'),
            scrollTime: dayStartTime, // 日历视图初始滚动位置
            firstDay: weekStartDay, // 使用用户设置的周开始日
            slotMinTime: todayStartTime, // 逻辑一天的起始时间
            slotMaxTime: slotMaxTime, // 逻辑一天的结束时间（可能超过24小时）
            nextDayThreshold: todayStartTime, // 跨天事件的判断阈值
            nowIndicator: true, // 显示当前时间指示线
            snapDuration: '00:05:00', // 设置吸附间隔为5分钟
            slotDuration: '00:15:00', // 设置默认时间间隔为15分钟
            slotLabelFormat: {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            },
            eventClassNames: 'reminder-calendar-event',
            displayEventTime: true,
            eventContent: this.renderEventContent.bind(this),
            eventClick: this.handleEventClick.bind(this),
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
                const today = new Date();
                const cellDate = arg.date;

                if (cellDate.toDateString() === today.toDateString()) {
                    return ['fc-today-custom'];
                }
                return [];
            },
            eventDidMount: (info) => {
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

                if (info.view.type === 'dayGridMonth' && !info.event.allDay) {
                    const targetEl = info.el.querySelector('.fc-daygrid-event') as HTMLElement || info.el as HTMLElement;
                    targetEl.classList.remove('fc-daygrid-dot-event');
                    targetEl.classList.add('fc-daygrid-block-event');
                    if (info.event.backgroundColor) {
                        targetEl.style.backgroundColor = info.event.backgroundColor;
                    }
                    if (info.event.borderColor) {
                        targetEl.style.borderColor = 'transparent';
                    }
                    if (info.event.textColor) {
                        targetEl.style.color = info.event.textColor;
                    }
                }
                if (info.view.type == 'dayGridMonth' && info.event.allDay) {
                    const targetEl = info.el.querySelector('.fc-daygrid-event') as HTMLElement || info.el as HTMLElement;
                    targetEl.style.borderWidth = '2px';
                }
            },
            // 添加视图切换和日期变化的监听
            datesSet: () => {
                // 当视图的日期范围改变时（包括切换前后时间），刷新事件
                this.refreshEvents();
            }
        });

        this.calendar.render();

        // 支持从提醒面板将任务拖拽到日历上以调整任务时间
        // 接受 mime-type: 'application/x-reminder' (JSON) 或纯文本 reminder id
        calendarEl.addEventListener('dragover', (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            // 更新并显示放置指示器
            try {
                this.updateDropIndicator(e.clientX, e.clientY, calendarEl);
            } catch (err) {
                // ignore
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

                let payloadStr = dt.getData('application/x-reminder') || dt.getData('text/plain') || '';
                if (!payloadStr) return;

                let payload: any;
                try {
                    payload = JSON.parse(payloadStr);
                } catch (err) {
                    // 如果只是 id 字符串
                    payload = { id: payloadStr };
                }

                const reminderId = payload.id;
                if (!reminderId) return;

                // 找到放置位置对应的日期（通过坐标查找所有带 data-date 的元素）
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
                    const fallbackDate = this.calendar ? this.calendar.getDate() : new Date();
                    const dateStrFallback = fallbackDate.toISOString().slice(0, 10);
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
                    const m = slotMin + minutesFromMin;
                    const hh = Math.floor(m / 60);
                    const mm = m % 60;
                    startDate.setHours(hh, mm, 0, 0);
                    isAllDay = false;
                } else {
                    // 月视图或无时间信息：视为全天
                    startDate = new Date(`${dateStr}T00:00:00`);
                    isAllDay = true;
                }

                const durationMinutes = payload.durationMinutes || 60;
                const endDate = new Date(startDate.getTime() + durationMinutes * 60000);

                // 使用已有的方法更新提醒时间（复用现有逻辑）
                await this.updateEventTime(reminderId, { event: { start: startDate, end: endDate, allDay: isAllDay } }, false);

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
                showMessage(t('operationFailed'));
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
            try {
                const ev = e as CustomEvent;
                if (ev && ev.detail && ev.detail.source === 'calendar') {
                    // 忽略由日历自身发出的更新，防止循环刷新
                    return;
                }
            } catch (err) {
                // ignore and proceed
            }
            this.refreshEvents();
        };
        window.addEventListener('reminderUpdated', this.externalReminderUpdatedHandler);
        // 监听项目颜色更新事件
        window.addEventListener('projectColorUpdated', () => {
            this.colorCache.clear();
            this.refreshEvents();
        });
        // 监听设置更新事件（如：周开始日）
        window.addEventListener('reminderSettingsUpdated', () => this.applyWeekStartDay());
        window.addEventListener('reminderSettingsUpdated', () => this.applyDayStartTime());

        // 添加窗口大小变化监听器
        this.addResizeListeners();

        // 添加滚轮缩放监听器
        this.addWheelZoomListener(calendarEl);

        // 设置日历实例到任务摘要管理器
        this.taskSummaryDialog.setCalendar(this.calendar);
        this.taskSummaryDialog.setCategoryManager(this);
    }

    private async renderCategoryFilter(selectElement: HTMLSelectElement) {
        try {
            const categories = this.categoryManager.getCategories();

            selectElement.innerHTML = `
                <option value="all" ${this.currentCategoryFilter === 'all' ? 'selected' : ''}>${t("allCategories")}</option>
                <option value="none" ${this.currentCategoryFilter === 'none' ? 'selected' : ''}>${t("noCategory")}</option>
            `;

            categories.forEach(category => {
                const optionEl = document.createElement('option');
                optionEl.value = category.id;
                optionEl.textContent = `${category.icon || ''} ${category.name}`;
                optionEl.selected = this.currentCategoryFilter === category.id;
                selectElement.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染分类过滤器失败:', error);
            selectElement.innerHTML = `<option value="all">${t("allCategories")}</option>`;
        }
    }

    private async renderProjectFilter(selectElement: HTMLSelectElement) {
        try {
            const projectData = await readProjectData();

            selectElement.innerHTML = `
                <option value="all" ${this.currentProjectFilter === 'all' ? 'selected' : ''}>${t("allProjects")}</option>
                <option value="none" ${this.currentProjectFilter === 'none' ? 'selected' : ''}>${t("noProject")}</option>
            `;

            if (projectData) {
                Object.values(projectData).forEach((project: any) => {
                    const optionEl = document.createElement('option');
                    optionEl.value = project.id;
                    optionEl.textContent = project.title || '未命名项目';
                    optionEl.selected = this.currentProjectFilter === project.id;
                    selectElement.appendChild(optionEl);
                });
            }

        } catch (error) {
            console.error('渲染项目过滤器失败:', error);
            selectElement.innerHTML = `<option value="all">${t("allProjects")}</option>`;
        }
    }

    private async renderUnifiedFilter(selectElement: HTMLSelectElement) {
        try {
            const categories = this.categoryManager.getCategories();
            const projectData = await readProjectData();
            const statuses = this.statusManager.getStatuses();

            // 构建选项列表
            const options = [];

            // 添加顶级选项
            options.push({
                value: 'all',
                text: t("allCategoriesAndProjects") || "全部",
                group: 'main'
            });
            options.push({
                value: 'none',
                text: t("noCategoryNoProject") || "无分类无项目",
                group: 'main'
            });

            // 添加分类分组
            if (categories && categories.length > 0) {
                options.push({
                    value: 'category_group',
                    text: '📂 ' + (t("categories") || "分类"),
                    group: 'categories',
                    disabled: true
                });

                categories.forEach(category => {
                    options.push({
                        value: `category:${category.id}`,
                        text: `${category.icon || ''} ${category.name}`,
                        group: 'categories',
                        indent: 1
                    });
                });
            }

            // 添加项目分组 - 按状态分组（排除归档状态）
            if (projectData && Object.keys(projectData).length > 0) {
                // 按状态分组项目，排除归档状态
                const projectsByStatus: { [key: string]: any[] } = {};

                Object.values(projectData).forEach((project: any) => {
                    // 跳过归档状态的项目，直接根据project的status判断是否为归档状态
                    const projectStatus = statuses.find(status => status.id === project.status);
                    if (projectStatus && !projectStatus.isArchived) {
                        // 非归档状态的项目，按状态分组
                        if (!projectsByStatus[project.status]) {
                            projectsByStatus[project.status] = [];
                        }
                        projectsByStatus[project.status].push(project);
                    }
                    // 归档状态的项目被跳过，不会在筛选器中显示
                });

                // 为每个非归档状态创建分组
                statuses.forEach(status => {
                    // 跳过归档状态
                    if (status.isArchived) {
                        return;
                    }

                    const statusProjects = projectsByStatus[status.id] || [];
                    if (statusProjects.length > 0) {
                        // 添加状态分组标题
                        options.push({
                            value: `status_group_${status.id}`,
                            text: `${status.icon || ''} ${status.name}`,
                            group: 'projects',
                            disabled: true,
                            indent: 0
                        });

                        // 添加该状态下的项目
                        statusProjects.forEach(project => {
                            options.push({
                                value: `project:${project.id}`,
                                text: project.title || '未命名项目',
                                group: 'projects',
                                indent: 1
                            });
                        });
                    }
                });
            }

            // 生成HTML
            selectElement.innerHTML = '';
            options.forEach(option => {
                const optionEl = document.createElement('option');
                optionEl.value = option.value;
                optionEl.textContent = option.text;
                optionEl.disabled = option.disabled || false;

                // 设置缩进（通过添加空格实现）
                if (option.indent && option.indent > 0) {
                    const spaces = '　'.repeat(option.indent); // 使用中文全角空格
                    optionEl.textContent = spaces + option.text;
                }

                // 设置当前选择状态
                if (option.value === 'all' && this.currentCategoryFilter === 'all' && this.currentProjectFilter === 'all') {
                    optionEl.selected = true;
                } else if (option.value === 'none' && this.currentCategoryFilter === 'none' && this.currentProjectFilter === 'none') {
                    optionEl.selected = true;
                } else if (option.value.startsWith('category:') && option.value === `category:${this.currentCategoryFilter}`) {
                    optionEl.selected = true;
                } else if (option.value.startsWith('project:') && option.value === `project:${this.currentProjectFilter}`) {
                    optionEl.selected = true;
                }

                selectElement.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染统一筛选器失败:', error);
            selectElement.innerHTML = `<option value="all">${t("allCategoriesAndProjects") || "全部"}</option>`;
        }
    }

    private async showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(this.plugin, async () => {
            // 分类更新后重新渲染统一筛选器和事件
            const unifiedFilterSelect = this.container.querySelector('.reminder-calendar-filter-group select') as HTMLSelectElement;
            if (unifiedFilterSelect) {
                await this.renderUnifiedFilter(unifiedFilterSelect);
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

        // 监听标签页激活事件
        const handleTabShow = () => {
            if (this.isCalendarVisible()) {
                this.debounceResize();
            }
        };

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

    private handleEventMouseEnter(event: MouseEvent, calendarEvent: any) {
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

        if (calendarEvent.extendedProps.isSubscribed) {
            menu.addItem({
                iconHTML: "ℹ️",
                label: t("subscribedTaskReadOnly") || "订阅任务（只读）",
                disabled: true
            });

            if (calendarEvent.extendedProps.projectId) {
                menu.addItem({
                    iconHTML: "📂",
                    label: t("openProjectKanban"),
                    click: () => {
                        this.openProjectKanban(calendarEvent.extendedProps.projectId);
                    }
                });
            }

            menu.addSeparator();

            menu.addItem({
                iconHTML: "🍅",
                label: t("startPomodoro"),
                click: () => {
                    this.startPomodoro(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "⏱️",
                label: t("startCountUp"),
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
        if (!calendarEvent.extendedProps.blockId || calendarEvent.extendedProps.isQuickReminder) {
            menu.addItem({
                iconHTML: "🔗",
                label: t("bindToBlock"),
                click: () => {
                    this.showBindToBlockDialog(calendarEvent);
                }
            });
            menu.addSeparator();
        } else {
            menu.addItem({
                iconHTML: "📖",
                label: t("openNote"),
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
                    label: t("modifyThisInstance"),
                    click: () => {
                        this.showInstanceEditDialog(calendarEvent);
                    }
                });

                menu.addItem({
                    iconHTML: "📝",
                    label: t("modifyAllInstances"),
                    click: () => {
                        this.showTimeEditDialogForSeries(calendarEvent);
                    }
                });
            }
        } else if (calendarEvent.extendedProps.repeat?.enabled) {
            // 对于周期原始事件，提供与实例一致的选项
            menu.addItem({
                iconHTML: "📝",
                label: t("modifyThisInstance"),
                click: () => {
                    this.splitRecurringEvent(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "📝",
                label: t("modifyAllInstances"),
                click: () => {
                    this.showTimeEditDialog(calendarEvent);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "📝",
                label: t("modify"),
                click: () => {
                    this.showTimeEditDialog(calendarEvent);
                }
            });
        }

        menu.addItem({
            iconHTML: "✅",
            label: calendarEvent.extendedProps.completed ? t("markAsUncompleted") : t("markAsCompleted"),
            click: () => {
                this.toggleEventCompleted(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加优先级设置子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: t("high"), color: '#e74c3c', icon: '🔴' },
            { key: 'medium', label: t("medium"), color: '#f39c12', icon: '🟡' },
            { key: 'low', label: t("low"), color: '#3498db', icon: '🔵' },
            { key: 'none', label: t("none"), color: '#95a5a6', icon: '⚫' }
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
            label: t("setPriority"),
            submenu: priorityMenuItems
        });

        menu.addItem({
            iconHTML: calendarEvent.allDay ? "⏰" : "📅",
            label: calendarEvent.allDay ? t("changeToTimed") : t("changeToAllDay"),
            click: () => {
                this.toggleAllDayEvent(calendarEvent);
            }
        });

        menu.addSeparator();

        // 添加复制块引选项 - 只对已绑定块的事件显示，排除未绑定块的事项和快速提醒
        if (calendarEvent.extendedProps.blockId && !calendarEvent.extendedProps.isQuickReminder) {
            menu.addItem({
                iconHTML: "📋",
                label: t("copyBlockRef"),
                click: () => {
                    this.copyBlockRef(calendarEvent);
                }
            });
        }

        // 添加复制事件标题菜单项
        menu.addItem({
            iconHTML: "📄",
            label: t("copyEventTitle"),
            click: () => {
                this.copyEventTitle(calendarEvent);
            }
        });

        // 添加创建副本菜单项
        menu.addItem({
            iconHTML: "📅",
            label: t("createCopy"),
            click: () => {
                this.createTomorrowCopy(calendarEvent);
            }
        });

        menu.addSeparator();

        if (calendarEvent.extendedProps.isRepeated) {
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => {
                    this.deleteInstanceOnly(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        } else if (calendarEvent.extendedProps.repeat?.enabled) {
            // 对于周期原始事件，提供与实例一致的删除选项
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteThisInstance"),
                click: () => {
                    this.skipFirstOccurrence(calendarEvent);
                }
            });

            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteAllInstances"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        } else {
            menu.addItem({
                iconHTML: "🗑️",
                label: t("deleteReminder"),
                click: () => {
                    this.deleteEvent(calendarEvent);
                }
            });
        }

        menu.addSeparator();

        // 添加项目管理选项（仅当任务有projectId时显示）
        if (calendarEvent.extendedProps.projectId) {
            menu.addItem({
                iconHTML: "📂",
                label: t("openProjectKanban"),
                click: () => {
                    this.openProjectKanban(calendarEvent.extendedProps.projectId);
                }
            });
            menu.addSeparator();
        }

        // 添加番茄钟选项
        menu.addItem({
            iconHTML: "🍅",
            label: t("startPomodoro"),
            click: () => {
                this.startPomodoro(calendarEvent);
            }
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: t("startCountUp"),
            click: () => {
                this.startPomodoroCountUp(calendarEvent);
            }
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async showInstanceEditDialog(calendarEvent: any) {
        // 为重复事件实例显示编辑对话框
        const originalId = calendarEvent.extendedProps.originalId;
        // 事件 id 使用格式: <reminder.id>_instance_<originalKey>
        // 以 id 的最后一段作为实例的原始键，用于查找 instanceModifications
        const instanceIdStr = calendarEvent.id || '';
        const instanceDate = instanceIdStr.split('_').pop() || calendarEvent.extendedProps.date;

        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[originalId];

            if (!originalReminder) {
                showMessage(t("reminderDataNotExist"));
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
            showMessage(t("openModifyDialogFailed"));
        }
    }

    private async deleteInstanceOnly(calendarEvent: any) {
        // 删除重复事件的单个实例
        const result = await confirm(
            t("deleteThisInstance"),
            t("confirmDeleteInstance"),
            async () => {
                try {
                    const originalId = calendarEvent.extendedProps.originalId;
                    // 从 event.id 提取原始实例键，优先使用它作为排除键
                    const instanceIdStr = calendarEvent.id || '';
                    const instanceDate = instanceIdStr.split('_').pop() || calendarEvent.extendedProps.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(t("instanceDeleted"));
                    await this.refreshEvents();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                } catch (error) {
                    console.error('删除重复实例失败:', error);
                    showMessage(t("deleteInstanceFailed"));
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
                showMessage(t("unboundReminder") + "，请先绑定到块");
                return;
            }

            // 获取块ID
            const blockId = calendarEvent.extendedProps.blockId;

            if (!blockId) {
                showMessage(t("cannotGetDocumentId"));
                return;
            }

            // 获取事件标题（移除可能存在的分类图标前缀）
            let title = calendarEvent.title || t("unnamedNote");

            // 移除分类图标（如果存在）
            if (calendarEvent.extendedProps.categoryId) {
                const category = this.categoryManager.getCategoryById(calendarEvent.extendedProps.categoryId);
                if (category && category.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (title.startsWith(iconPrefix)) {
                        title = title.substring(iconPrefix.length);
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
            showMessage(t("operationFailed"));
        }
    }

    // 添加复制事件标题功能
    private async copyEventTitle(calendarEvent: any) {
        try {
            // 获取事件标题（移除可能存在的分类图标前缀）
            let title = calendarEvent.title || t("unnamedNote");

            // 移除分类图标（如果存在）
            if (calendarEvent.extendedProps.categoryId) {
                const category = this.categoryManager.getCategoryById(calendarEvent.extendedProps.categoryId);
                if (category && category.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (title.startsWith(iconPrefix)) {
                        title = title.substring(iconPrefix.length);
                    }
                }
            }

            // 复制到剪贴板
            await navigator.clipboard.writeText(title);
            showMessage(t("eventTitleCopied") || "事件标题已复制到剪贴板");

        } catch (error) {
            console.error('复制事件标题失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    // 添加创建明日副本功能
    private async createCopy(calendarEvent: any, targetDate?: Date) {
        try {
            // 如果没有指定目标日期，则使用当前日期
            const copyDate = targetDate || new Date();
            const dateStr = getLocalDateString(copyDate);

            // 获取事件的原始信息
            const originalProps = calendarEvent.extendedProps;

            // 获取事件标题（移除可能存在的分类图标前缀）
            let title = calendarEvent.title || t("unnamedNote");
            if (originalProps.categoryId) {
                const category = this.categoryManager.getCategoryById(originalProps.categoryId);
                if (category && category.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (title.startsWith(iconPrefix)) {
                        title = title.substring(iconPrefix.length);
                    }
                }
            }

            // 创建 QuickReminderDialog，传入目标日期和预填充数据
            const quickDialog = new QuickReminderDialog(
                dateStr, // 目标日期
                undefined, // 不设置具体时间，默认为全天
                async () => {
                    // 刷新日历事件
                    await this.refreshEvents();
                    showMessage(t("copyCreated") || "副本已创建");
                },
                undefined, // 时间段选项
                {
                    defaultProjectId: originalProps.projectId,
                    defaultTitle: title,
                    defaultNote: originalProps.note || '',
                    defaultCategoryId: originalProps.categoryId,
                    defaultPriority: originalProps.priority || 'none',
                    defaultBlockId: originalProps.blockId,
                    plugin: this.plugin // 传入plugin实例
                }
            );

            // 显示对话框
            quickDialog.show();

        } catch (error) {
            console.error('创建副本失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    private async createTomorrowCopy(calendarEvent: any) {
        // 计算明日日期并调用通用创建副本方法
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        await this.createCopy(calendarEvent, tomorrow);
    }

    private async setPriority(calendarEvent: any, priority: string) {
        try {
            // 获取正确的提醒ID - 对于重复事件实例，使用原始ID
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                reminderData[reminderId].priority = priority;
                await saveReminders(this.plugin, reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

                // 立即刷新事件显示
                await this.refreshEvents();

                const priorityNames = {
                    'high': t("high"),
                    'medium': t("medium"),
                    'low': t("low"),
                    'none': t("none")
                };
                showMessage(t("prioritySet", { priority: priorityNames[priority] }));
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(t("setPriorityFailed"));
        }
    }

    private async deleteEvent(calendarEvent: any) {
        const reminder = calendarEvent.extendedProps;

        // 对于重复事件实例，删除的是整个系列
        if (calendarEvent.extendedProps.isRepeated) {
            const result = await confirm(
                t("deleteAllInstances"),
                t("confirmDelete", { title: calendarEvent.title }),
                () => {
                    this.performDeleteEvent(calendarEvent.extendedProps.originalId);
                }
            );
        } else {
            const result = await confirm(
                t("deleteReminder"),
                t("confirmDelete", { title: calendarEvent.title }),
                () => {
                    this.performDeleteEvent(calendarEvent.id);
                }
            );
        }
    }

    private async performDeleteEvent(reminderId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                const blockId = reminderData[reminderId].blockId;
                delete reminderData[reminderId];
                await saveReminders(this.plugin, reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

                // 立即刷新事件显示
                await this.refreshEvents();

                showMessage(t("reminderDeleted"));
            } else {
                showMessage(t("reminderNotExist"));
            }
        } catch (error) {
            console.error('删除提醒失败:', error);
            showMessage(t("deleteReminderFailed"));
        }
    }

    private renderEventContent(eventInfo) {
        const wrapper = document.createElement('div');
        wrapper.className = 'reminder-calendar-event-wrapper';

        // 添加复选框
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'reminder-calendar-event-checkbox';
        checkbox.checked = eventInfo.event.extendedProps.completed || false;
        if (eventInfo.event.extendedProps.isSubscribed) {
            checkbox.disabled = true;
            checkbox.title = t("subscribedTaskReadOnly") || "订阅任务（只读）";
        } else {
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                this.toggleEventCompleted(eventInfo.event);
            });
        }

        // 添加事件内容容器
        const eventEl = document.createElement('div');
        eventEl.className = 'reminder-calendar-event-content';

        // 只有当docId不等于blockId时才添加文档标题（表示这是块级事件）
        if (eventInfo.event.extendedProps.docTitle &&
            eventInfo.event.extendedProps.docId &&
            eventInfo.event.extendedProps.blockId &&
            eventInfo.event.extendedProps.docId !== eventInfo.event.extendedProps.blockId) {
            const docTitleEl = document.createElement('div');
            docTitleEl.className = 'reminder-calendar-event-doc-title';
            docTitleEl.textContent = eventInfo.event.extendedProps.docTitle;
            docTitleEl.style.cssText = `
                font-size: 10px;
                opacity: 0.7;
                margin-bottom: 2px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                line-height: 1.2;
            `;
            eventEl.appendChild(docTitleEl);
        }

        // 添加事件标题
        const titleEl = document.createElement('div');
        titleEl.className = 'fc-event-title';
        titleEl.innerHTML = eventInfo.event.title;
        eventEl.appendChild(titleEl);

        // 在非全天事件中显示时间范围
        if (!eventInfo.event.allDay) {
            const timeEl = document.createElement('div');
            timeEl.className = 'reminder-calendar-event-time';
            timeEl.style.cssText = `
                font-size: 10px;
                opacity: 0.8;
                margin-top: 2px;
                line-height: 1.2;
            `;

            const startTime = eventInfo.event.start;
            const endTime = eventInfo.event.end;

            if (startTime && endTime) {
                const startStr = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const endStr = endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                timeEl.textContent = `${startStr} - ${endStr}`;
            } else if (startTime) {
                timeEl.textContent = startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            eventEl.appendChild(timeEl);
        }

        // 添加备注（如果存在）
        if (eventInfo.event.extendedProps.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-calendar-event-note';
            noteEl.textContent = eventInfo.event.extendedProps.note;
            eventEl.appendChild(noteEl);
        }

        // 添加分类emoji图标或订阅图标
        if (eventInfo.event.extendedProps.isSubscribed) {
            const subIcon = document.createElement('div');
            subIcon.className = 'reminder-category-indicator';
            subIcon.innerHTML = '🗓';
            subIcon.title = t("subscribedTask") || "订阅任务";
            wrapper.appendChild(subIcon);
        } else if (eventInfo.event.extendedProps.categoryId) {
            const category = this.categoryManager.getCategoryById(eventInfo.event.extendedProps.categoryId);
            if (category && category.icon) {
                const categoryIcon = document.createElement('div');
                categoryIcon.className = 'reminder-category-indicator';
                categoryIcon.innerHTML = category.icon;
                categoryIcon.title = category.name;
                wrapper.appendChild(categoryIcon);
            }
        }

        // 添加链接图标（如果有绑定块且不是快速提醒，且不是订阅任务）
        if (eventInfo.event.extendedProps.blockId && !eventInfo.event.extendedProps.isQuickReminder && !eventInfo.event.extendedProps.isSubscribed) {
            const linkIcon = document.createElement('div');
            linkIcon.className = 'reminder-link-indicator';
            linkIcon.innerHTML = '🔗';
            linkIcon.title = '已绑定块';
            wrapper.appendChild(linkIcon);
        }

        // 添加重复图标（如果是重复事件）
        if (eventInfo.event.extendedProps.isRepeated || eventInfo.event.extendedProps.repeat?.enabled) {
            const repeatIcon = document.createElement('div');
            repeatIcon.className = 'reminder-repeat-indicator';

            if (eventInfo.event.extendedProps.isRepeated) {
                // 重复事件实例
                repeatIcon.classList.add('instance');
                repeatIcon.innerHTML = '🔄';
                repeatIcon.title = t("repeatInstance");
            } else if (eventInfo.event.extendedProps.repeat?.enabled) {
                // 原始重复事件
                repeatIcon.classList.add('recurring');
                repeatIcon.innerHTML = '🔁';
                repeatIcon.title = t("repeatSeries");
            }

            wrapper.appendChild(repeatIcon);
        }

        wrapper.appendChild(checkbox);
        wrapper.appendChild(eventEl);

        return { domNodes: [wrapper] };
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
                    const isCompleted = completedInstances.includes(instanceDate);

                    if (isCompleted) {
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
                        await updateBlockReminderBookmark(blockId);
                        // 完成时自动处理任务列表
                        if (!isCompleted) {
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
                        await updateBlockReminderBookmark(blockId);
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

    private async handleEventClick(info) {
        const reminder = info.event.extendedProps;
        const blockId = reminder.blockId || info.event.id; // 兼容旧数据格式

        // 如果没有绑定块，提示用户绑定块 (订阅任务除外)
        if (!reminder.blockId) {
            if (reminder.isSubscribed) {
                showMessage(t("subscribedTaskReadOnly") || "订阅任务（只读）");
            } else {
                showMessage(t("unboundReminder") + "，请右键选择\"绑定到块\"");
            }
            return;
        }

        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开笔记失败:', error);

            // 询问用户是否删除无效的提醒
            const result = await confirm(
                t("openNoteFailedDelete"),
                t("noteBlockDeleted"),
                async () => {
                    // 删除当前提醒
                    await this.performDeleteEvent(info.event.id);
                },
                () => {
                    showMessage(t("openNoteFailed"));
                }
            );
        }
    }

    private async handleEventDrop(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例
        if (originalReminder.isRepeated) {
            // 检查该实例是否已经被修改过
            const originalId = originalReminder.originalId;
            const instanceDate = info.event.startStr.split('T')[0];

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
            // 检查该实例是否已经被修改过
            const originalId = originalReminder.originalId;
            const instanceDate = info.event.startStr.split('T')[0];

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
        if (view.type !== 'timeGridWeek' && view.type !== 'timeGridDay') {
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
            if (view.type !== 'timeGridWeek' && view.type !== 'timeGridDay') {
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

            // 使用原始事件的blockId生成新的提醒ID
            const blockId = originalReminder.blockId || originalReminder.id;
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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

            showMessage(t("eventTimeUpdated"));
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

        } catch (error) {
            console.error('更新重复事件系列失败:', error);
            showMessage(t("operationFailed"));
            info.revert();
        }
    }

    private async askApplyToAllInstances(): Promise<'single' | 'all' | 'cancel'> {
        return new Promise((resolve) => {
            const dialog = new Dialog({
                title: t("modifyRepeatEvent"),
                content: `
                    <div class="b3-dialog__content">
                        <div style="margin-bottom: 16px;">${t("howToApplyChanges")}</div>
                        <div class="fn__flex fn__flex-justify-center" style="gap: 8px;">
                            <button class="b3-button" id="btn-single">${t("onlyThisInstance")}</button>
                            <button class="b3-button b3-button--primary" id="btn-all">${t("allInstances")}</button>
                            <button class="b3-button b3-button--cancel" id="btn-cancel">${t("cancel")}</button>
                        </div>
                    </div>
                `,
                width: "400px",
                height: "200px"
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
            const newStartDate = info.event.start;
            const newEndDate = info.event.end;

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

            showMessage(t("instanceTimeUpdated"));
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));

        } catch (error) {
            console.error('更新单个实例失败:', error);
            showMessage(t("updateInstanceFailed"));
            info.revert();
        }
    }

    private async updateEventTime(reminderId: string, info, isResize: boolean) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[reminderId]) {
                const newStartDate = info.event.start;
                let newEndDate = info.event.end;

                // 如果是将全天事件拖动为定时事件，FullCalendar 可能不会提供 end。
                // 在这种情况下默认使用 1 小时时长，避免刷新后事件变短。
                if (!newEndDate && !info.event.allDay && info.oldEvent && info.oldEvent.allDay) {
                    newEndDate = new Date(newStartDate.getTime() + 60 * 60 * 1000); // 默认 1 小时
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

                showMessage(t("eventTimeUpdated"));
            } else {
                throw new Error('提醒数据不存在');
            }
        } catch (error) {
            console.error(isResize ? '调整事件大小失败:' : '更新事件时间失败:', error);
            showMessage(t("operationFailed"));
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
            .fc-today-custom {
                background-color: #a5bdc721 !important;
            }
            .fc-today-custom:hover {
                background-color: var(--b3-theme-primary-lightest) !important;
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
            
            .fc-event.completed .fc-event-title {
                text-decoration: line-through;
                font-weight: 500;
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
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('打开修改对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
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
                showMessage(t("reminderDataNotExist"));
            }
        } catch (error) {
            console.error('打开系列修改对话框失败:', error);
            showMessage(t("openModifyDialogFailed"));
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

                showMessage(calendarEvent.allDay ? t("changedToTimed") : t("changedToAllDay"));
            }
        } catch (error) {
            console.error('切换全天事件失败:', error);
            showMessage(t("toggleAllDayFailed"));
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
            defaultProjectId: this.currentProjectFilter !== 'all' && this.currentProjectFilter !== 'none' ? this.currentProjectFilter : undefined,
            defaultCategoryId: this.currentCategoryFilter !== 'all' && this.currentCategoryFilter !== 'none' ? this.currentCategoryFilter : undefined,
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
                defaultProjectId: this.currentProjectFilter !== 'all' && this.currentProjectFilter !== 'none' ? this.currentProjectFilter : undefined,
                defaultCategoryId: this.currentCategoryFilter !== 'all' && this.currentCategoryFilter !== 'none' ? this.currentCategoryFilter : undefined,
                plugin: this.plugin // 传入plugin实例
            }
        );

        quickDialog.show();

        // 清除选择
        this.calendar.unselect();
    }

    private async refreshEvents() {
        // 清除之前的刷新超时
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
        }

        // 使用防抖机制，避免频繁刷新
        this.refreshTimeout = window.setTimeout(async () => {
            try {
                // 先获取新的事件数据
                const events = await this.getEvents();

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
                }
            } catch (error) {
                console.error('刷新事件失败:', error);
            }
        }, 100); // 100ms 防抖延迟
    }

    private async getEvents() {
        try {
            const reminderData = await getAllReminders(this.plugin);
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

            // 转换为数组并过滤
            const allReminders = Object.values(reminderData) as any[];
            const filteredReminders = allReminders.filter(reminder => {
                if (!reminder || typeof reminder !== 'object') return false;
                if (!this.passesCategoryFilter(reminder)) return false;
                if (!this.passesProjectFilter(reminder)) return false;
                if (!this.passesCompletionFilter(reminder)) return false;
                return true;
            });

            // 批量预加载所有需要的文档标题
            await this.batchLoadDocTitles(filteredReminders);

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
                    reminder.parentBlockId = parentInfo.blockId;
                }

                // 如果有重复设置，则不显示原始事件（只显示实例）；否则显示原始事件
                if (!reminder.repeat?.enabled) {
                    this.addEventToList(events, reminder, reminder.id, false);
                } else {
                    // 生成重复事件实例
                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
                    const completedInstances = reminder.repeat?.completedInstances || [];
                    const instanceModifications = reminder.repeat?.instanceModifications || {};

                    // 用于跟踪已处理的实例（使用原始日期键）
                    const processedInstances = new Set<string>();

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
                        const instanceMod = instanceModifications[originalKey];

                        const instanceReminder = {
                            ...reminder,
                            date: instance.date,
                            endDate: instance.endDate,
                            time: instance.time,
                            endTime: instance.endTime,
                            completed: isInstanceCompleted,
                            note: instanceMod?.note || ''
                        };

                        // 事件 id 应使用原始实例键，以便后续的拖拽/保存逻辑能够基于原始实例键进行修改，避免产生重复的 instanceModifications 条目
                        const uniqueInstanceId = `${reminder.id}_instance_${originalKey}`;
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
                                note: mod.note || ''
                            };

                            const uniqueInstanceId = `${reminder.id}_instance_${originalDateKey}`;
                            this.addEventToList(events, instanceReminder, uniqueInstanceId, true, reminder.id);
                        }
                    }
                }
            }

            return events;
        } catch (error) {
            console.error('获取事件数据失败:', error);
            showMessage(t("loadReminderDataFailed"));
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

            // 批量查询获取docId（如果需要）
            const blockIdToDocId = new Map<string, string>();
            if (blockIdsToQuery.size > 0) {
                const promises = Array.from(blockIdsToQuery).map(async (blockId) => {
                    try {
                        const blockInfo = await getBlockByID(blockId);
                        if (blockInfo && blockInfo.root_id && blockInfo.root_id !== blockId) {
                            blockIdToDocId.set(blockId, blockInfo.root_id);
                            docIdsToQuery.add(blockInfo.root_id);
                        }
                    } catch (err) {
                        console.warn(`获取块 ${blockId} 的文档ID失败:`, err);
                    }
                });
                await Promise.all(promises);
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

                // 如果没有docId，从映射中获取
                if (!docId && blockId && blockIdToDocId.has(blockId)) {
                    docId = blockIdToDocId.get(blockId);
                    reminder.docId = docId;
                }

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
     * 确保提醒对象包含文档标题（保留用于单个调用场景）
     */
    private async ensureDocTitle(reminder: any, docTitleCache: Map<string, string>) {
        if (reminder.docTitle) {
            return; // 已经有文档标题
        }

        try {
            let docId = reminder.docId;
            const blockId = reminder.blockId || reminder.id;

            // 如果没有明确的docId，尝试从blockId获取
            if (!docId && blockId) {
                // 先检查缓存
                if (docTitleCache.has(blockId)) {
                    const cachedTitle = docTitleCache.get(blockId);
                    reminder.docTitle = cachedTitle;
                    return;
                }

                const blockInfo = await getBlockByID(blockId);
                if (blockInfo && blockInfo.root_id && blockInfo.root_id !== blockId) {
                    docId = blockInfo.root_id;
                    reminder.docId = docId; // 同时设置docId
                }
            }

            // 只有当docId存在且不等于blockId时才获取文档标题
            if (docId && docId !== blockId) {
                // 检查缓存
                if (docTitleCache.has(docId)) {
                    reminder.docTitle = docTitleCache.get(docId);
                    return;
                }

                const docBlock = await getBlockByID(docId);
                if (docBlock && docBlock.content) {
                    const docTitle = docBlock.content.trim();
                    reminder.docTitle = docTitle;
                    docTitleCache.set(docId, docTitle);

                    // 同时缓存blockId对应的文档标题
                    if (blockId && blockId !== docId) {
                        docTitleCache.set(blockId, docTitle);
                    }
                }
            } else {
                // 如果docId等于blockId，设置空字符串避免重复尝试
                reminder.docTitle = '';
            }
        } catch (error) {
            console.warn('获取文档标题失败:', error);
            // 设置空字符串以避免重复尝试
            reminder.docTitle = '';
        }
    }


    passesCategoryFilter(reminder: any): boolean {
        if (this.currentCategoryFilter === 'all') {
            return true;
        }

        if (this.currentCategoryFilter === 'none') {
            return !reminder.categoryId;
        }

        return reminder.categoryId === this.currentCategoryFilter;
    }

    passesProjectFilter(reminder: any): boolean {
        if (this.currentProjectFilter === 'all') {
            return true;
        }

        if (this.currentProjectFilter === 'none') {
            return !reminder.projectId;
        }

        return reminder.projectId === this.currentProjectFilter;
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
                    backgroundColor = '#95a5a6';
                    borderColor = '#7f8c8d';
                }
            } else if (this.colorBy === 'category') {
                if (reminder.categoryId) {
                    const categoryStyle = this.categoryManager.getCategoryStyle(reminder.categoryId);
                    backgroundColor = categoryStyle.backgroundColor;
                    borderColor = categoryStyle.borderColor;
                } else {
                    backgroundColor = '#95a5a6';
                    borderColor = '#7f8c8d';
                }
            } else { // colorBy === 'priority'
                switch (priority) {
                    case 'high':
                        backgroundColor = '#e74c3c';
                        borderColor = '#c0392b';
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
                        backgroundColor = '#95a5a6';
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
        classNames += (!reminder.blockId || reminder.isQuickReminder) ? ' no-block-binding' : ' has-block-binding';

        // 构建事件对象（优化：直接使用colors.backgroundColor和colors.borderColor）
        const eventObj: any = {
            id: eventId,
            title: reminder.title || t("unnamedNote"),
            backgroundColor: colors.backgroundColor,
            borderColor: colors.borderColor,
            textColor: isCompleted ? '#ffffffcc' : '#ffffff',
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
                blockId: reminder.blockId || reminder.id,
                docId: reminder.docId,
                docTitle: reminder.docTitle,
                parentId: reminder.parentId || null,
                parentTitle: reminder.parentTitle || null,
                parentBlockId: reminder.parentBlockId || null,
                isRepeated: isRepeated,
                originalId: originalId || reminder.id,
                repeat: reminder.repeat,
                isQuickReminder: reminder.isQuickReminder || false,
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
                    eventObj.title = `${reminder.title || t("unnamedNote")} (${reminder.time})`;
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
            this.tooltip.innerHTML = `<div style="color: var(--b3-theme-on-surface-light); font-size: 12px;">${t("loading")}</div>`;
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

        // 优化：使用数组收集HTML片段，最后一次性join，减少字符串拼接开销
        const htmlParts: string[] = [];

        try {
            // 1. 文档标题（只有当docId不等于blockId时才显示）
            if (reminder.docTitle && reminder.docId && reminder.blockId && reminder.docId !== reminder.blockId) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-background); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-align: left;">`,
                    `<span>📄</span>`,
                    `<span title="${t("belongsToDocument")}">${this.escapeHtml(reminder.docTitle)}</span>`,
                    `</div>`
                );
            }

            // 2. 事项名称
            let eventTitle = calendarEvent.title || t("unnamedNote");
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category?.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (eventTitle.startsWith(iconPrefix)) {
                        eventTitle = eventTitle.substring(iconPrefix.length);
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
                    `<span style="font-size: 13px;">${t("parentTask") || '父任务'}: ${this.escapeHtml(reminder.parentTitle)}</span>`,
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
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category) {
                    htmlParts.push(
                        `<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">`,
                        `<span style="opacity: 0.7;">🏷️</span>`,
                        `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background-color: ${category.color}; border-radius: 4px; color: white; font-size: 11px;">`
                    );
                    if (category.icon) {
                        htmlParts.push(`<span style="font-size: 12px;">${category.icon}</span>`);
                    }
                    htmlParts.push(
                        `<span>${this.escapeHtml(category.name)}</span>`,
                        `</span>`,
                        `</div>`
                    );
                }
            }

            // 6. 重复信息
            if (reminder.isRepeated) {
                htmlParts.push(
                    `<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">`,
                    `<span>🔄</span>`,
                    `<span>${t("repeatInstance")}</span>`,
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
                    `<div style="margin-bottom: 4px; opacity: 0.7;">${t("note")}:</div>`,
                    `<div>${this.escapeHtml(reminder.note)}</div>`,
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
                    `<span>${t("completed")}</span>`
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
            return `<div style="color: var(--b3-theme-error);">${t("loadFailed")}</div>`;
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
    /**
     * 格式化事件日期时间信息
     */
    private formatEventDateTime(reminder: any): string {
        try {
            const today = getLogicalDateString();
            const tomorrowStr = getRelativeDateString(1);

            let dateStr = '';
            if (reminder.date === today) {
                dateStr = t("today");
            } else if (reminder.date === tomorrowStr) {
                dateStr = t("tomorrow");
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
                    endDateStr = t("today");
                } else if (reminder.endDate === tomorrowStr) {
                    endDateStr = t("tomorrow");
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
            'high': { label: t("high"), icon: '🔴', color: '#e74c3c' },
            'medium': { label: t("medium"), icon: '🟡', color: '#f39c12' },
            'low': { label: t("low"), icon: '🔵', color: '#3498db' }
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
                    return repeat.interval === 1 ? t("dailyRepeat") : t("everyNDaysRepeat", { n: repeat.interval });
                case 'weekly':
                    return repeat.interval === 1 ? t("weeklyRepeat") : t("everyNWeeksRepeat", { n: repeat.interval });
                case 'monthly':
                    return repeat.interval === 1 ? t("monthlyRepeat") : t("everyNMonthsRepeat", { n: repeat.interval });
                case 'yearly':
                    return repeat.interval === 1 ? t("yearlyRepeat") : t("everyNYearsRepeat", { n: repeat.interval });
                case 'lunar-monthly':
                    return t("lunarMonthlyRepeat");
                case 'lunar-yearly':
                    return t("lunarYearlyRepeat");
                case 'custom':
                    return t("customRepeat");
                case 'ebbinghaus':
                    return t("ebbinghausRepeat");
                default:
                    return t("repeatEvent");
            }
        } catch (error) {
            console.error('获取重复描述失败:', error);
            return t("repeatEvent");
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
                showMessage(t("operationFailed"));
                return;
            }

            // 计算下一个周期日期
            const nextDate = this.calculateNextDate(originalReminder.date, originalReminder.repeat);
            if (!nextDate) {
                showMessage(t("operationFailed") + ": " + t("invalidRepeatConfig"));
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
            showMessage(t("operationFailed"));
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
            const newId = `${blockId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
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
            showMessage(t("seriesSplitSuccess"));

        } catch (error) {
            console.error('执行分割重复事件系列失败:', error);
            showMessage(t("operationFailed"));
        }
    }

    /**
     * 跳过首次发生 - 为原始事件添加排除日期
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
                    showMessage(t("firstOccurrenceSkipped"));
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: 'calendar' } }));
                } catch (error) {
                    console.error('跳过首次发生失败:', error);
                    showMessage(t("operationFailed"));
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
                    showMessage(t("reminderBoundToBlock"));
                    // 刷新日历显示
                    await this.refreshEvents();
                } catch (error) {
                    console.error('绑定提醒到块失败:', error);
                    showMessage(t("bindToBlockFailed"));
                }
            },
            {
                title: t("bindReminderToBlock"),
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
                reminderData[reminderId].isQuickReminder = false; // 移除快速提醒标记

                await saveReminders(this.plugin, reminderData);

                // 将绑定的块添加项目ID属性 custom-task-projectId
                const projectId = reminderData[reminderId].projectId;
                if (projectId) {
                    const { addBlockProjectId } = await import('../api');
                    await addBlockProjectId(blockId, projectId);
                    console.debug('CalendarView: bindReminderToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBlockReminderBookmark(blockId);

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

                confirmMessage += `\n\n\n选择"确定"将继承当前进度继续计时。`;
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
            const { readProjectData } = await import("../api");
            const projectData = await readProjectData();

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
     * 切换视图类型（timeGrid <-> dayGrid）
     */
    private async toggleViewType() {
        const currentView = this.calendar.view.type;
        let newView: string;
        const viewType = this.viewTypeSwitch.checked ? 'dayGrid' : 'timeGrid';

        if (currentView === 'timeGridWeek' || currentView === 'dayGridWeek') {
            newView = viewType === 'dayGrid' ? 'dayGridWeek' : 'timeGridWeek';
        } else if (currentView === 'timeGridDay' || currentView === 'dayGridDay') {
            newView = viewType === 'dayGrid' ? 'dayGridDay' : 'timeGridDay';
        } else {
            // 如果不是周或日视图，不做任何操作
            return;
        }

        await this.calendarConfigManager.setViewType(viewType);
        this.calendar.changeView(newView);
        // 更新配置中的视图模式
        this.calendarConfigManager.setViewMode(newView);
        // 更新按钮状态
        this.updateViewButtonStates();
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

        // 根据当前视图模式设置激活按钮
        switch (currentViewMode) {
            case 'dayGridMonth':
                this.monthBtn.classList.add('b3-button--primary');
                this.viewTypeSwitch.disabled = true;
                this.viewTypeSwitch.checked = false;
                break;
            case 'timeGridWeek':
            case 'dayGridWeek':
                this.weekBtn.classList.add('b3-button--primary');
                this.viewTypeSwitch.disabled = false;
                this.viewTypeSwitch.checked = this.calendarConfigManager.getViewType() === 'dayGrid';
                break;
            case 'timeGridDay':
            case 'dayGridDay':
                this.dayBtn.classList.add('b3-button--primary');
                this.viewTypeSwitch.disabled = false;
                this.viewTypeSwitch.checked = this.calendarConfigManager.getViewType() === 'dayGrid';
                break;
            case 'multiMonthYear':
                this.yearBtn.classList.add('b3-button--primary');
                this.viewTypeSwitch.disabled = true;
                this.viewTypeSwitch.checked = false;
                break;
        }
    }

    /**
     * 从文本中提取思源块ID
     * 支持以下格式：
     * 1. Markdown链接：[标题](siyuan://blocks/blockId)
     * 2. 块引用：((blockId '标题')) 或 ((blockId "标题"))
     * 3. 简单块引用：((blockId))
     */
    private extractBlockIdFromText(text: string): string | undefined {
        // 匹配 Markdown 链接格式：[标题](siyuan://blocks/blockId)
        const markdownLinkMatch = text.match(/\[([^\]]+)\]\(siyuan:\/\/blocks\/([^)]+)\)/);
        if (markdownLinkMatch) {
            const blockId = markdownLinkMatch[2];
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        // 匹配块引用格式：((blockId '标题')) 或 ((blockId "标题"))
        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'"]+)['"]\)\)/);
        if (blockRefWithTitleMatch) {
            const blockId = blockRefWithTitleMatch[1];
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        // 匹配简单块引用格式：((blockId))
        const simpleBlockRefMatch = text.match(/\(\(([^)]+)\)\)/);
        if (simpleBlockRefMatch) {
            const blockId = simpleBlockRefMatch[1].trim();
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        return undefined;
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

    /**
     * 应用周开始日设置到日历
     */
    private async applyWeekStartDay() {
        try {
            const weekStartDay = await this.getWeekStartDay();
            // 更新日历的firstDay设置
            this.calendar.setOption('firstDay', weekStartDay);
        } catch (error) {
            console.error('应用周开始日设置失败:', error);
        }
    }

    /**
     * 应用一天起始时间设置到日历
     */
    private async applyDayStartTime() {
        try {
            // 获取日历视图滚动位置
            const dayStartTime = await this.getDayStartTime();

            // 获取逻辑一天起始时间
            const todayStartTime = await this.getTodayStartTime();
            const slotMaxTime = this.calculateSlotMaxTime(todayStartTime);

            // 更新日历的时间范围设置
            this.calendar.setOption('scrollTime', dayStartTime); // 滚动位置
            this.calendar.setOption('slotMinTime', todayStartTime); // 逻辑一天起始
            this.calendar.setOption('slotMaxTime', slotMaxTime); // 逻辑一天结束
            this.calendar.setOption('nextDayThreshold', todayStartTime); // 跨天阈值
        } catch (error) {
            console.error('应用一天起始时间设置失败:', error);
        }
    }
}


