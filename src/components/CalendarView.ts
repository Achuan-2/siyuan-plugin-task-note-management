import { Calendar } from '@fullcalendar/core';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { showMessage, confirm, openTab, Menu, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, sql, updateBlock, getBlockKramdown, updateBlockReminderBookmark, openBlock } from "../api";
import { getLocalDateString, getLocalDateTime, getLocalDateTimeString } from "../utils/dateUtils";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { CategoryManager, Category } from "../utils/categoryManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { t } from "../utils/i18n";
import { generateRepeatInstances, RepeatInstance } from "../utils/repeatUtils";

export class CalendarView {
    private container: HTMLElement;
    private calendar: Calendar;
    private plugin: any;
    private resizeObserver: ResizeObserver;
    private resizeTimeout: number;
    private categoryManager: CategoryManager; // 添加分类管理器
    private currentCategoryFilter: string = 'all'; // 当前分类过滤
    private tooltip: HTMLElement | null = null; // 添加提示框元素
    private hideTooltipTimeout: number | null = null; // 添加提示框隐藏超时控制
    private tooltipShowTimeout: number | null = null; // 添加提示框显示延迟控制
    private lastClickTime: number = 0; // 添加双击检测
    private clickTimeout: number | null = null; // 添加单击延迟超时
    private refreshTimeout: number | null = null; // 添加刷新防抖超时

    // 添加静态变量来跟踪当前活动的番茄钟
    private static currentPomodoroTimer: PomodoroTimer | null = null;

    constructor(container: HTMLElement, plugin: any) {
        this.container = container;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(); // 初始化分类管理器
        this.initUI();
    }

    private async initUI() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        this.container.classList.add('reminder-calendar-view');

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'reminder-calendar-toolbar';
        this.container.appendChild(toolbar);



        // 视图切换按钮
        const viewGroup = document.createElement('div');
        viewGroup.className = 'reminder-calendar-view-group';
        toolbar.appendChild(viewGroup);

        const monthBtn = document.createElement('button');
        monthBtn.className = 'b3-button b3-button--outline';
        monthBtn.textContent = t("month");
        monthBtn.addEventListener('click', () => this.calendar.changeView('dayGridMonth'));
        viewGroup.appendChild(monthBtn);

        const weekBtn = document.createElement('button');
        weekBtn.className = 'b3-button b3-button--outline';
        weekBtn.textContent = t("week");
        weekBtn.addEventListener('click', () => this.calendar.changeView('timeGridWeek'));
        viewGroup.appendChild(weekBtn);

        const dayBtn = document.createElement('button');
        dayBtn.className = 'b3-button b3-button--outline';
        dayBtn.textContent = t("day");
        dayBtn.addEventListener('click', () => this.calendar.changeView('timeGridDay'));
        viewGroup.appendChild(dayBtn);


        // 添加分类过滤器
        const filterGroup = document.createElement('div');
        filterGroup.className = 'reminder-calendar-filter-group';
        toolbar.appendChild(filterGroup);
        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
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
        // 分类过滤下拉框
        const categoryFilterSelect = document.createElement('select');
        categoryFilterSelect.className = 'b3-select';
        categoryFilterSelect.addEventListener('change', () => {
            this.currentCategoryFilter = categoryFilterSelect.value;
            this.refreshEvents();
        });
        filterGroup.appendChild(categoryFilterSelect);

        // 渲染分类过滤器
        await this.renderCategoryFilter(categoryFilterSelect);

        // 分类管理按钮
        const categoryManageBtn = document.createElement('button');
        categoryManageBtn.className = 'b3-button b3-button--outline';
        categoryManageBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg>';
        categoryManageBtn.title = t("manageCategories");
        categoryManageBtn.addEventListener('click', () => {
            this.showCategoryManageDialog(categoryFilterSelect);
        });
        filterGroup.appendChild(categoryManageBtn);

        // 创建日历容器
        const calendarEl = document.createElement('div');
        calendarEl.className = 'reminder-calendar-container';
        this.container.appendChild(calendarEl);

        // 初始化日历
        this.calendar = new Calendar(calendarEl, {
            plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
            initialView: 'timeGridWeek',
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
            scrollTime: '08:00:00', // 视图将滚动到此时间
            firstDay: 1, // 设置周一为每周第一天
            nowIndicator: true, // 显示当前时间指示线
            eventClassNames: 'reminder-calendar-event',
            eventContent: this.renderEventContent.bind(this),
            eventClick: this.handleEventClick.bind(this),
            eventDrop: this.handleEventDrop.bind(this),
            eventResize: this.handleEventResize.bind(this),
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
            },
            // 添加视图切换和日期变化的监听
            datesSet: (info) => {
                // 当视图的日期范围改变时（包括切换前后时间），刷新事件
                this.refreshEvents();
            }
        });

        this.calendar.render();

        // 初始加载事件 - 延迟执行避免与 datesSet 冲突
        setTimeout(() => {
            this.refreshEvents();
        }, 50);

        // 添加自定义样式
        this.addCustomStyles();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', () => this.refreshEvents());

        // 添加窗口大小变化监听器
        this.addResizeListeners();
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

    private showCategoryManageDialog(categoryFilterSelect: HTMLSelectElement) {
        const categoryDialog = new CategoryManageDialog(() => {
            // 分类更新后重新渲染过滤器和事件
            this.renderCategoryFilter(categoryFilterSelect);
            this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        categoryDialog.show();
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

        // 添加复制块引选项 - 只对已绑定块的事件显示
        if (calendarEvent.extendedProps.blockId) {
            menu.addItem({
                iconHTML: "📋",
                label: t("copyBlockRef"),
                click: () => {
                    this.copyBlockRef(calendarEvent);
                }
            });
        }

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
        const instanceDate = calendarEvent.extendedProps.date;

        try {
            const reminderData = await readReminderData();
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
                // 修改备注逻辑：只有实例有明确的备注时才使用，否则为空
                note: instanceMod?.note || '',  // 每个实例的备注都是独立的，默认为空
                isInstance: true,
                originalId: originalId,
                instanceDate: instanceDate
            };

            const editDialog = new ReminderEditDialog(instanceData, async () => {
                await this.refreshEvents();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            });
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
                    const instanceDate = calendarEvent.extendedProps.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(t("instanceDeleted"));
                    await this.refreshEvents();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
            const reminderData = await readReminderData();

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

                await writeReminderData(reminderData);
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

    private async setPriority(calendarEvent: any, priority: string) {
        try {
            // 获取正确的提醒ID - 对于重复事件实例，使用原始ID
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                reminderData[reminderId].priority = priority;
                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

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
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const blockId = reminderData[reminderId].blockId;
                delete reminderData[reminderId];
                await writeReminderData(reminderData);

                // 更新块的书签状态
                if (blockId) {
                    await updateBlockReminderBookmark(blockId);
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated'));

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
        checkbox.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            this.toggleEventCompleted(eventInfo.event);
        });

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

        // 添加备注（如果存在）
        if (eventInfo.event.extendedProps.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'reminder-calendar-event-note';
            noteEl.textContent = eventInfo.event.extendedProps.note;
            eventEl.appendChild(noteEl);
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
            const reminderData = await readReminderData();

            if (event.extendedProps.isRepeated) {
                // 处理重复事件实例
                const originalId = event.extendedProps.originalId;
                const instanceDate = event.extendedProps.date;

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

                    await writeReminderData(reminderData);

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
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

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

                    await writeReminderData(reminderData);

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
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

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

        // 如果没有绑定块，提示用户绑定块
        if (!reminder.blockId) {
            showMessage(t("unboundReminder") + "，请右键选择\"绑定到块\"");
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

        // 如果是重复事件实例，询问用户如何应用更改
        if (originalReminder.isRepeated) {
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
        }
    }

    private async handleEventResize(info) {
        const reminderId = info.event.id;
        const originalReminder = info.event.extendedProps;

        // 如果是重复事件实例，询问用户如何应用更改
        if (originalReminder.isRepeated) {
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
        }
    }

    private async updateRecurringEventSeries(info: any) {
        try {
            const originalId = info.event.extendedProps.originalId;
            const reminderData = await readReminderData();
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
            if (!originalReminder.repeat) { originalReminder.repeat = {}; }
            originalReminder.repeat.endDate = newEndDateStr;

            // 2. 为新的、修改过的系列创建一个新的重复事件。
            const newReminder = JSON.parse(JSON.stringify(originalReminder));

            // 清理新提醒以开始新的生命周期。
            // 它不应从原始事件继承系列结束日期。
            delete newReminder.repeat.endDate;
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
            await writeReminderData(reminderData);

            showMessage(t("eventTimeUpdated"));
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

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
            const instanceDate = info.event.extendedProps.date;
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
                instanceDate,
                ...instanceModification
            });

            showMessage(t("instanceTimeUpdated"));
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('更新单个实例失败:', error);
            showMessage(t("updateInstanceFailed"));
            info.revert();
        }
    }

    private async updateEventTime(reminderId: string, info, isResize: boolean) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const newStartDate = info.event.start;
                const newEndDate = info.event.end;

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

                // 重置通知状态
                if (shouldResetNotified) {
                    reminderData[reminderId].notified = false;
                }

                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                showMessage(t("eventTimeUpdated"));

                // 立即刷新事件显示
                await this.refreshEvents();
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

            const reminderData = await readReminderData();

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            // 保存此实例的修改数据
            reminderData[originalId].repeat.instanceModifications[instanceDate] = {
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

            await writeReminderData(reminderData);

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
        `;
        document.head.appendChild(style);
    }

    private async showTimeEditDialog(calendarEvent: any) {
        try {
            // 对于重复事件实例，需要使用原始ID来获取原始提醒数据
            const reminderId = calendarEvent.extendedProps.isRepeated ?
                calendarEvent.extendedProps.originalId :
                calendarEvent.id;

            const reminderData = await readReminderData();

            if (reminderData[reminderId]) {
                const reminder = reminderData[reminderId];

                const editDialog = new ReminderEditDialog(reminder, async () => {
                    // 刷新日历事件
                    await this.refreshEvents();

                    // 触发全局更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                });

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

            const reminderData = await readReminderData();

            if (reminderData[originalId]) {
                const reminder = reminderData[originalId];

                const editDialog = new ReminderEditDialog(reminder, async () => {
                    // 刷新日历事件
                    await this.refreshEvents();

                    // 触发全局更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                });

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

            const reminderData = await readReminderData();

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

                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

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

        // 创建快速提醒对话框
        const quickDialog = new QuickReminderDialog(clickedDate, clickedTime, async () => {
            // 刷新日历事件
            await this.refreshEvents();
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

        // 创建快速提醒对话框，传递时间段信息
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

                // 添加新事件 - 逐个添加确保不重复
                events.forEach(event => {
                    this.calendar.addEvent(event);
                });

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
            const reminderData = await readReminderData();
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

            // 预加载文档标题缓存
            const docTitleCache = new Map<string, string>();

            for (const reminder of Object.values(reminderData) as any[]) {
                if (!reminder || typeof reminder !== 'object') continue;

                // 应用分类过滤
                if (!this.passesCategoryFilter(reminder)) continue;

                // 获取文档标题（如果还没有缓存）
                await this.ensureDocTitle(reminder, docTitleCache);

                // 添加原始事件
                this.addEventToList(events, reminder, reminder.id, false);

                // 如果有重复设置，生成重复事件实例
                if (reminder.repeat?.enabled) {
                    const repeatInstances = generateRepeatInstances(reminder, startDate, endDate);
                    repeatInstances.forEach(instance => {
                        // 跳过与原始事件相同日期的实例
                        if (instance.date !== reminder.date) {
                            // 检查实例级别的完成状态
                            const completedInstances = reminder.repeat?.completedInstances || [];
                            const isInstanceCompleted = completedInstances.includes(instance.date);

                            // 检查实例级别的修改
                            const instanceModifications = reminder.repeat?.instanceModifications || {};
                            const instanceMod = instanceModifications[instance.date];

                            const instanceReminder = {
                                ...reminder,
                                date: instance.date,
                                endDate: instance.endDate,
                                time: instance.time,
                                endTime: instance.endTime,
                                completed: isInstanceCompleted,
                                note: instanceMod?.note || '',
                                docTitle: reminder.docTitle // 保持文档标题
                            };

                            // 确保实例ID的唯一性，避免重复
                            const uniqueInstanceId = `${reminder.id}_instance_${instance.date}`;
                            this.addEventToList(events, instanceReminder, uniqueInstanceId, true, instance.originalId);
                        }
                    });
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
     * 确保提醒对象包含文档标题
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

    private passesCategoryFilter(reminder: any): boolean {
        if (this.currentCategoryFilter === 'all') {
            return true;
        }

        if (this.currentCategoryFilter === 'none') {
            return !reminder.categoryId;
        }

        return reminder.categoryId === this.currentCategoryFilter;
    }

    private addEventToList(events: any[], reminder: any, eventId: string, isRepeated: boolean, originalId?: string) {
        const priority = reminder.priority || 'none';
        let backgroundColor, borderColor;

        // 如果有分类，使用分类颜色；否则使用优先级颜色
        if (reminder.categoryId) {
            const categoryStyle = this.categoryManager.getCategoryStyle(reminder.categoryId);
            backgroundColor = categoryStyle.backgroundColor;
            borderColor = categoryStyle.borderColor;
        } else {
            // 根据优先级设置颜色
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

        // 如果是快速创建的提醒（没有绑定块），使用特殊的样式
        if (reminder.isQuickReminder || !reminder.blockId) {
            backgroundColor = backgroundColor + 'aa'; // 添加透明度
            borderColor = borderColor + 'aa';
        }

        // 检查完成状态
        let isCompleted = false;
        if (isRepeated && originalId) {
            isCompleted = reminder.completed || false;
        } else {
            isCompleted = reminder.completed || false;
        }

        // 如果任务已完成，使用灰色
        if (isCompleted) {
            backgroundColor = '#e3e3e3';
            borderColor = '#e3e3e3';
        }

        // 重复事件使用稍微不同的样式
        if (isRepeated) {
            backgroundColor = backgroundColor + 'dd';
            borderColor = borderColor + 'dd';
        }

        // 构建 className，包含已完成状态
        const classNames = [
            `reminder-priority-${priority}`,
            isRepeated ? 'reminder-repeated' : '',
            isCompleted ? 'completed' : '' // 将 completed 类添加到 FullCalendar 事件元素上
        ].filter(Boolean).join(' ');

        let eventObj: any = {
            id: eventId,
            title: reminder.title || t("unnamedNote"),
            backgroundColor: backgroundColor,
            borderColor: borderColor,
            textColor: isCompleted ? '#999999' : '#ffffff',
            className: classNames,
            extendedProps: {
                completed: isCompleted,
                note: reminder.note || '',
                date: reminder.date,
                endDate: reminder.endDate || null,
                time: reminder.time || null,
                endTime: reminder.endTime || null,
                priority: priority,
                categoryId: reminder.categoryId,
                blockId: reminder.blockId || reminder.id,
                docId: reminder.docId, // 添加docId
                docTitle: reminder.docTitle, // 添加文档标题
                isRepeated: isRepeated,
                originalId: originalId || reminder.id,
                repeat: reminder.repeat,
                isQuickReminder: reminder.isQuickReminder || false // 添加快速提醒标记
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

        // 添加分类信息到标题
        if (reminder.categoryId) {
            const category = this.categoryManager.getCategoryById(reminder.categoryId);
            if (category && category.icon) {
                eventObj.title = `${category.icon} ${eventObj.title}`;
            }
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
        const parts: string[] = [];

        try {
            // 1. 文档标题（只有当docId不等于blockId时才显示）
            let docTitleAdded = false;

            // 只有当docId存在且不等于blockId时才显示文档标题
            if (reminder.docTitle &&
                reminder.docId &&
                reminder.blockId &&
                reminder.docId !== reminder.blockId) {
                parts.push(`<div style="color: var(--b3-theme-on-background); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-align: left;">
                    <span>📄</span>
                    <span title="${t("belongsToDocument")}">${this.escapeHtml(reminder.docTitle)}</span>
                </div>`);
                docTitleAdded = true;
            }

            // 如果还没有文档标题且有blockId，尝试获取（这是一个备用逻辑）
            if (!docTitleAdded && reminder.blockId) {
                try {
                    const blockInfo = await getBlockByID(reminder.blockId);
                    if (blockInfo && blockInfo.root_id && blockInfo.root_id !== reminder.blockId) {
                        // 获取根文档的信息
                        const rootBlock = await getBlockByID(blockInfo.root_id);
                        if (rootBlock && rootBlock.content) {
                            parts.push(`<div style="color: var(--b3-theme-on-background); font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px; text-align: left;">
                                <span>📄</span>
                                <span title="${t("belongsToDocument")}">${this.escapeHtml(rootBlock.content)}</span>
                            </div>`);
                            docTitleAdded = true;
                        }
                    }
                } catch (error) {
                    console.warn('获取块父文档标题失败:', error);
                }
            }

            // 2. 事项名称 - 明确设置居左显示
            let eventTitle = calendarEvent.title || t("unnamedNote");

            // 移除分类图标前缀（如果存在）
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category && category.icon) {
                    const iconPrefix = `${category.icon} `;
                    if (eventTitle.startsWith(iconPrefix)) {
                        eventTitle = eventTitle.substring(iconPrefix.length);
                    }
                }
            }

            parts.push(`<div style="font-weight: 600; color: var(--b3-theme-on-surface); margin-bottom: 8px; font-size: 14px; text-align: left; width: 100%;">
                ${this.escapeHtml(eventTitle)}
            </div>`);

            // 3. 日期时间信息
            const dateTimeInfo = this.formatEventDateTime(reminder);
            if (dateTimeInfo) {
                parts.push(`<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                    <span style="opacity: 0.7;">🕐</span>
                    <span>${dateTimeInfo}</span>
                </div>`);
            }

            // 4. 优先级信息
            if (reminder.priority && reminder.priority !== 'none') {
                const priorityInfo = this.formatPriorityInfo(reminder.priority);
                if (priorityInfo) {
                    parts.push(`<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                        ${priorityInfo}
                    </div>`);
                }
            }

            // 5. 分类信息
            if (reminder.categoryId) {
                const category = this.categoryManager.getCategoryById(reminder.categoryId);
                if (category) {
                    parts.push(`<div style="color: var(--b3-theme-on-surface); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                        <span style="opacity: 0.7;">🏷️</span>
                        <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 6px; background-color: ${category.color}; border-radius: 4px; color: white; font-size: 11px;">
                            ${category.icon ? `<span style="font-size: 12px;">${category.icon}</span>` : ''}
                            <span>${this.escapeHtml(category.name)}</span>
                        </span>
                    </div>`);
                }
            }

            // 6. 重复信息
            if (reminder.isRepeated) {
                parts.push(`<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">
                    <span>🔄</span>
                    <span>${t("repeatInstance")}</span>
                </div>`);
            } else if (reminder.repeat?.enabled) {
                const repeatDescription = this.getRepeatDescription(reminder.repeat);
                if (repeatDescription) {
                    parts.push(`<div style="color: var(--b3-theme-on-surface-light); margin-bottom: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">
                        <span>🔁</span>
                        <span>${repeatDescription}</span>
                    </div>`);
                }
            }

            // 7. 备注信息
            if (reminder.note && reminder.note.trim()) {
                parts.push(`<div style="color: var(--b3-theme-on-surface-light); margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--b3-theme-border); font-size: 12px;">
                    <div style="margin-bottom: 4px; opacity: 0.7;">${t("note")}:</div>
                    <div>${this.escapeHtml(reminder.note)}</div>
                </div>`);
            }

            // 8. 完成状态和完成时间
            if (reminder.completed) {
                // 获取完成时间 - 修复逻辑
                let completedTime = null;

                try {
                    const reminderData = await readReminderData();

                    if (reminder.isRepeated) {
                        // 重复事件实例的完成时间
                        const originalReminder = reminderData[reminder.originalId];
                        if (originalReminder && originalReminder.repeat?.completedTimes) {
                            completedTime = originalReminder.repeat.completedTimes[reminder.date];
                        }
                    } else {
                        // 普通事件的完成时间 - 从最新的 reminderData 中获取
                        const currentReminder = reminderData[calendarEvent.id];
                        if (currentReminder) {
                            completedTime = currentReminder.completedTime;
                        }
                    }
                } catch (error) {
                    console.error('获取完成时间失败:', error);
                }

                let completedInfo = `<div style="color: var(--b3-theme-success); margin-top: 6px; display: flex; align-items: center; gap: 4px; font-size: 12px;">
                    <span>✅</span>
                    <span>${t("completed")}</span>`;

                // 如果有完成时间，添加完成时间显示
                if (completedTime) {
                    const formattedCompletedTime = this.formatCompletedTimeForTooltip(completedTime);
                    completedInfo += `<span style="margin-left: 8px; opacity: 0.7;">${formattedCompletedTime}</span>`;
                }

                completedInfo += `</div>`;
                parts.push(completedInfo);
            }

            return parts.join('');

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
            const today = getLocalDateString();
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
            const today = getLocalDateString();
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const tomorrowStr = getLocalDateString(tomorrow);

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

        // 调用清理函数
        const cleanup = (this.container as any)._calendarCleanup;
        if (cleanup) {
            cleanup();
        }

        // 移除事件监听器
        window.removeEventListener('reminderUpdated', () => this.refreshEvents());

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
            const reminderData = await readReminderData();
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
            const editDialog = new ReminderEditDialog(editData, async (modifiedReminder) => {
                await this.performSplitOperation(originalReminder, modifiedReminder);
            });
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
            const reminderData = await readReminderData();

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

            // 清理新提醒的重复历史数据
            delete newReminder.repeat.endDate;
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
                delete newReminder.repeat.endDate;
            } else {
                newReminder.repeat = { ...originalReminder.repeat };
                delete newReminder.repeat.endDate;
            }

            // 4. 保存修改
            reminderData[originalReminder.id] = singleReminder;
            reminderData[newId] = newReminder;
            await writeReminderData(reminderData);

            // 5. 更新界面
            await this.refreshEvents();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
                    const reminderData = await readReminderData();
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

                    await writeReminderData(reminderData);
                    showMessage(t("firstOccurrenceSkipped"));
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
        const dialog = new Dialog({
            title: t("bindReminderToBlock"),
            content: `
                <div class="bind-to-block-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <div class="b3-form__desc" style="margin-bottom: 12px;">选择绑定方式：</div>
                            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                                <button class="b3-button b3-button--outline" id="bindExistingBtn" style="flex: 1;">
                                    <svg style="width: 16px; height: 16px; margin-right: 4px;"><use xlink:href="#iconLink"></use></svg>
                                    绑定现有块
                                </button>
                                <button class="b3-button b3-button--outline" id="createNewDocBtn" style="flex: 1;">
                                    <svg style="width: 16px; height: 16px; margin-right: 4px;"><use xlink:href="#iconAdd"></use></svg>
                                    ${t("createNewDocument")}
                                </button>
                            </div>
                        </div>
                        
                        <div id="bindExistingPanel" style="display: none;">
                            <div class="b3-form__group">
                                <label class="b3-form__label">输入块ID</label>
                                <div class="b3-form__desc">请输入要绑定的块ID</div>
                                <input type="text" id="blockIdInput" class="b3-text-field" placeholder="请输入块ID" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group" id="selectedBlockInfo" style="display: none;">
                                <label class="b3-form__label">块信息预览</label>
                                <div id="blockContent" class="block-content-preview" style="
                                    padding: 8px;
                                    background-color: var(--b3-theme-surface-lighter);
                                    border-radius: 4px;
                                    border: 1px solid var(--b3-theme-border);
                                    max-height: 100px;
                                    overflow-y: auto;
                                    font-size: 12px;
                                    color: var(--b3-theme-on-surface);
                                "></div>
                            </div>
                        </div>

                        <div id="createNewDocPanel" style="display: none;">
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档标题</label>
                                <input type="text" id="docTitleInput" class="b3-text-field" placeholder="请输入文档标题" style="width: 100%; margin-top: 8px;" value="${calendarEvent.title || ''}">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档内容（可选）</label>
                                <textarea id="docContentInput" class="b3-text-field" placeholder="请输入文档内容..." style="width: 100%; height: 80px; margin-top: 8px; resize: vertical;"></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="bindCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="bindConfirmBtn" style="display: none;">${t("bindToBlock")}</button>
                        <button class="b3-button b3-button--primary" id="createDocConfirmBtn" style="display: none;">${t("createDocumentAndBind")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "400px"
        });

        const bindExistingBtn = dialog.element.querySelector('#bindExistingBtn') as HTMLButtonElement;
        const createNewDocBtn = dialog.element.querySelector('#createNewDocBtn') as HTMLButtonElement;
        const bindExistingPanel = dialog.element.querySelector('#bindExistingPanel') as HTMLElement;
        const createNewDocPanel = dialog.element.querySelector('#createNewDocPanel') as HTMLElement;

        const blockIdInput = dialog.element.querySelector('#blockIdInput') as HTMLInputElement;
        const selectedBlockInfo = dialog.element.querySelector('#selectedBlockInfo') as HTMLElement;
        const blockContentEl = dialog.element.querySelector('#blockContent') as HTMLElement;

        const docTitleInput = dialog.element.querySelector('#docTitleInput') as HTMLInputElement;
        const docContentInput = dialog.element.querySelector('#docContentInput') as HTMLTextAreaElement;

        const cancelBtn = dialog.element.querySelector('#bindCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#bindConfirmBtn') as HTMLButtonElement;
        const createDocConfirmBtn = dialog.element.querySelector('#createDocConfirmBtn') as HTMLButtonElement;

        // 切换到绑定现有块模式
        bindExistingBtn.addEventListener('click', () => {
            bindExistingBtn.classList.add('b3-button--primary');
            bindExistingBtn.classList.remove('b3-button--outline');
            createNewDocBtn.classList.remove('b3-button--primary');
            createNewDocBtn.classList.add('b3-button--outline');

            bindExistingPanel.style.display = 'block';
            createNewDocPanel.style.display = 'none';
            confirmBtn.style.display = 'inline-block';
            createDocConfirmBtn.style.display = 'none';

            setTimeout(() => blockIdInput.focus(), 100);
        });

        // 切换到新建文档模式
        createNewDocBtn.addEventListener('click', () => {
            createNewDocBtn.classList.add('b3-button--primary');
            createNewDocBtn.classList.remove('b3-button--outline');
            bindExistingBtn.classList.remove('b3-button--primary');
            bindExistingBtn.classList.add('b3-button--outline');

            createNewDocPanel.style.display = 'block';
            bindExistingPanel.style.display = 'none';
            confirmBtn.style.display = 'none';
            createDocConfirmBtn.style.display = 'inline-block';

            setTimeout(() => docTitleInput.focus(), 100);
        });

        // 监听块ID输入变化
        blockIdInput.addEventListener('input', async () => {
            const blockId = blockIdInput.value.trim();
            if (blockId.length >= 20) { // 块ID通常是20位字符
                try {
                    const block = await getBlockByID(blockId);
                    if (block) {
                        const blockContent = block.content || block.fcontent || '未命名块';
                        blockContentEl.textContent = blockContent;
                        selectedBlockInfo.style.display = 'block';
                    } else {
                        selectedBlockInfo.style.display = 'none';
                    }
                } catch (error) {
                    selectedBlockInfo.style.display = 'none';
                }
            } else {
                selectedBlockInfo.style.display = 'none';
            }
        });

        // 取消按钮
        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        // 确认绑定现有块
        confirmBtn.addEventListener('click', async () => {
            const blockId = blockIdInput.value.trim();
            if (!blockId) {
                showMessage('请输入块ID');
                return;
            }

            try {
                await this.bindReminderToBlock(calendarEvent, blockId);
                showMessage(t("reminderBoundToBlock"));
                dialog.destroy();

                // 刷新日历显示
                await this.refreshEvents();
            } catch (error) {
                console.error('绑定提醒到块失败:', error);
                showMessage(t("bindToBlockFailed"));
            }
        });

        // 确认新建文档并绑定
        createDocConfirmBtn.addEventListener('click', async () => {
            const title = docTitleInput.value.trim();
            const content = docContentInput.value.trim();

            if (!title) {
                showMessage('请输入文档标题');
                return;
            }

            try {
                const blockId = await this.createDocumentAndBind(calendarEvent, title, content);
                showMessage(t("documentCreated"));
                dialog.destroy();

                // 刷新日历显示
                await this.refreshEvents();
            } catch (error) {
                console.error('创建文档并绑定失败:', error);
                showMessage(t("createDocumentFailed"));
            }
        });

        // 默认显示绑定现有块模式
        bindExistingBtn.click();
    }

    /**
     * 创建文档并绑定提醒
     */
    private async createDocumentAndBind(calendarEvent: any, title: string, content: string): Promise<string> {
        try {
            // 获取插件设置
            const settings = await this.plugin.loadSettings();
            const notebook = settings.newDocNotebook;
            const pathTemplate = settings.newDocPath || '/任务管理/{{now | date "2006-01-02"}}/{{.title}}';

            if (!notebook) {
                throw new Error(t("pleaseConfigureNotebook"));
            }

            // 导入API函数
            const { renderSprig, createDocWithMd } = await import("../api");

            // 准备模板变量
            const templateVars = {
                title: title,
                content: content,
                date: calendarEvent.extendedProps?.date || new Date().toISOString().split('T')[0],
                time: calendarEvent.extendedProps?.time || '',
            };


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
            const docContent = content || `# ${title}\n\n`;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);

            // 绑定提醒到新创建的文档
            await this.bindReminderToBlock(calendarEvent, docId);

            return docId;
        } catch (error) {
            console.error('创建文档并绑定失败:', error);
            throw error;
        }
    }

    /**
     * 将提醒绑定到指定的块
     */
    private async bindReminderToBlock(calendarEvent: any, blockId: string) {
        try {
            const reminderData = await readReminderData();
            const reminderId = calendarEvent.id;

            if (reminderData[reminderId]) {
                // 获取块信息
                const block = await getBlockByID(blockId);
                if (!block) {
                    throw new Error('目标块不存在');
                }

                // 更新提醒数据
                reminderData[reminderId].blockId = blockId;
                reminderData[reminderId].docId = block.root_id || blockId;
                reminderData[reminderId].isQuickReminder = false; // 移除快速提醒标记

                await writeReminderData(reminderData);

                // 更新块的书签状态
                await updateBlockReminderBookmark(blockId);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
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
        if (CalendarView.currentPomodoroTimer && CalendarView.currentPomodoroTimer.isWindowActive()) {
            // 获取当前番茄钟的状态
            const currentState = CalendarView.currentPomodoroTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = calendarEvent.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                try {
                    CalendarView.currentPomodoroTimer.pauseFromExternal();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
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
                        try {
                            CalendarView.currentPomodoroTimer.resumeFromExternal();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            // 没有活动番茄钟或窗口已关闭，清理引用并直接启动
            if (CalendarView.currentPomodoroTimer && !CalendarView.currentPomodoroTimer.isWindowActive()) {
                CalendarView.currentPomodoroTimer = null;
            }
            this.performStartPomodoro(calendarEvent);
        }
    }

    private startPomodoroCountUp(calendarEvent: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟并且窗口仍然存在
        if (CalendarView.currentPomodoroTimer && CalendarView.currentPomodoroTimer.isWindowActive()) {
            // 获取当前番茄钟的状态
            const currentState = CalendarView.currentPomodoroTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = calendarEvent.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            // 如果当前番茄钟正在运行，先暂停并询问是否继承时间
            if (currentState.isRunning && !currentState.isPaused) {
                // 先暂停当前番茄钟
                try {
                    CalendarView.currentPomodoroTimer.pauseFromExternal();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                const timeDisplay = currentState.isWorkPhase ?
                    `工作时间 ${Math.floor(currentState.timeElapsed / 60)}:${(currentState.timeElapsed % 60).toString().padStart(2, '0')}` :
                    `休息时间 ${Math.floor(currentState.timeLeft / 60)}:${(currentState.timeLeft % 60).toString().padStart(2, '0')}`;

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
                        try {
                            CalendarView.currentPomodoroTimer.resumeFromExternal();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            // 没有活动番茄钟或窗口已关闭，清理引用并直接启动
            if (CalendarView.currentPomodoroTimer && !CalendarView.currentPomodoroTimer.isWindowActive()) {
                CalendarView.currentPomodoroTimer = null;
            }
            this.performStartPomodoroCountUp(calendarEvent);
        }
    }

    private async performStartPomodoro(calendarEvent: any, inheritState?: any) {
        // 如果已经有活动的番茄钟，先关闭它
        if (CalendarView.currentPomodoroTimer) {
            try {
                CalendarView.currentPomodoroTimer.close();
                CalendarView.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = await this.plugin.getPomodoroSettings();
        console.log('结果', settings);

        // 构建提醒对象
        const reminder = {
            id: calendarEvent.id,
            title: calendarEvent.title,
            blockId: calendarEvent.extendedProps.blockId,
            isRepeatInstance: calendarEvent.extendedProps.isRepeated,
            originalId: calendarEvent.extendedProps.originalId
        };

        const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState);

        // 设置当前活动的番茄钟实例
        CalendarView.currentPomodoroTimer = pomodoroTimer;

        pomodoroTimer.show();

        // 如果继承了状态且原来正在运行，显示继承信息
        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
            showMessage(`已切换任务并继承${phaseText}进度`, 2000);
        }
    }

    private async performStartPomodoroCountUp(calendarEvent: any, inheritState?: any) {
        // 如果已经有活动的番茄钟，先关闭它
        if (CalendarView.currentPomodoroTimer) {
            try {
                CalendarView.currentPomodoroTimer.close();
                CalendarView.currentPomodoroTimer = null;
            } catch (error) {
                console.error('关闭之前的番茄钟失败:', error);
            }
        }

        const settings = await this.plugin.getPomodoroSettings();

        // 构建提醒对象
        const reminder = {
            id: calendarEvent.id,
            title: calendarEvent.title,
            blockId: calendarEvent.extendedProps.blockId,
            isRepeatInstance: calendarEvent.extendedProps.isRepeated,
            originalId: calendarEvent.extendedProps.originalId
        };

        const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState);

        // 设置当前活动的番茄钟实例并直接切换到正计时模式
        CalendarView.currentPomodoroTimer = pomodoroTimer;

        pomodoroTimer.show();

        // 如果继承了状态且原来正在运行，显示继承信息
        if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
            const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
            showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
        } else {
            showMessage("已启动正计时番茄钟", 2000);
        }
    }

    // 添加静态方法获取当前番茄钟实例
    public static getCurrentPomodoroTimer(): PomodoroTimer | null {
        return CalendarView.currentPomodoroTimer;
    }

    // 添加静态方法清理当前番茄钟实例
    public static clearCurrentPomodoroTimer(): void {
        if (CalendarView.currentPomodoroTimer) {
            try {
                // 检查窗口是否仍然活动，如果不活动则直接清理引用
                if (!CalendarView.currentPomodoroTimer.isWindowActive()) {
                    CalendarView.currentPomodoroTimer = null;
                    return;
                }
                CalendarView.currentPomodoroTimer.destroy();
            } catch (error) {
                console.error('清理番茄钟实例失败:', error);
            }
            CalendarView.currentPomodoroTimer = null;
        }
    }
}
