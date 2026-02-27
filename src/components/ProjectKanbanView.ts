import { showMessage, confirm, Menu, Dialog, Constants } from "siyuan";

import { refreshSql, getBlockByID, updateBindBlockAtrrs, openBlock, addBlockProjectId } from "../api";
import { i18n } from "../pluginInstance";
import { getLocalDateString, getLocalDateTimeString, compareDateStrings, getLogicalDateString, getRelativeDateString, getLocaleTag } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { PomodoroRecordManager } from "../utils/pomodoroRecord"; // Add import
import { generateRepeatInstances, getRepeatDescription, getDaysDifference, addDaysToDate, generateSubtreeInstances } from "../utils/repeatUtils";
import { getSolarDateLunarString } from "../utils/lunarUtils";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { getAllReminders, saveReminders } from '../utils/icsSubscription';
import { VipManager } from "../utils/vip";

import { PasteTaskDialog } from "./PasteTaskDialog";
import { ProjectDialog } from "./ProjectDialog";


export class ProjectKanbanView {
    private container: HTMLElement;
    private plugin: any;
    private projectId: string;
    private project: any;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private currentSort: string = 'priority';
    private kanbanMode: 'status' | 'custom' | 'list' = 'status';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private doneSort: string = 'completedTime';
    private doneSortOrder: 'asc' | 'desc' = 'desc';
    private tasks: any[] = [];
    private isDragging: boolean = false;
    private draggedTask: any = null;
    private draggedElement: HTMLElement | null = null;
    // 当前正在拖拽的分组ID（用于分组管理对话框的拖拽排序）
    private draggedGroupId: string | null = null;
    // 当前显示的分组拖拽指示器（绝对定位在 container 内）
    private _groupDropIndicator: HTMLElement | null = null;
    // 拖拽时用于 setDragImage 的克隆元素（用于预览整个 group-item）
    private _groupDragImageEl: HTMLElement | null = null;
    // 自定义分组列拖拽时的指示器（列间插入指示）
    private _columnDropIndicator: HTMLElement | null = null;
    private sortButton: HTMLButtonElement;
    private doneSortButton: HTMLButtonElement;
    private isLoading: boolean = false;
    private searchKeyword: string = '';
    private searchInput: HTMLInputElement;
    private collapsedTasks: Set<string> = new Set();
    // 临时保存要在下一次渲染后恢复的父任务折叠状态
    private _preserveCollapsedTasks: Set<string> | null = null;

    // 分页：每页最多显示的顶层任务数量
    private pageSize: number = 30;
    // 存储每列当前页，key 为 status 
    private pageIndexMap: { [status: string]: number } = { long_term: 1, short_term: 1, doing: 1, completed: 1 };

    // 自定义分组子分组折叠状态跟踪，key 为 "groupId-status" 格式
    private collapsedStatusGroups: Set<string> = new Set();
    private expandedStatusGroups: Set<string> = new Set();

    // 指示器状态跟踪
    private currentIndicatorType: 'none' | 'sort' | 'parentChild' = 'none';
    private currentIndicatorTarget: HTMLElement | null = null;
    private currentIndicatorPosition: 'top' | 'bottom' | 'middle' | null = null;

    // 全局番茄钟管理器
    private pomodoroManager = PomodoroManager.getInstance();
    private pomodoroRecordManager: PomodoroRecordManager; // Add property

    // 上一次选择的任务状态（用于记住新建任务时的默认选择）
    private lastSelectedStatus: string | null = null;
    // 上一次选择的自定义分组（用于记住新建任务时的默认分组）
    private lastSelectedCustomGroupId: string | null = null;
    // 防抖加载与滚动状态保存
    private _debounceTimer: any = null;
    private _debounceDelay: number = 250; // ms
    private _pendingLoadPromise: Promise<void> | null = null;
    private _pendingLoadResolve: (() => void) | null = null;

    // 用于临时保存滚动状态，避免界面刷新重置滚动条
    private _savedScrollState: {
        containerScrollLeft: number;
        columnScrollTopMap: { [key: string]: number };
    } | null = null;

    // 看板实例ID，用于区分事件来源
    private kanbanInstanceId: string = `kanban_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // 记录最后一次渲染的模式和项目ID，用于判断是否需要全量清空
    private _lastRenderMode: string | null = null;
    private _lastRenderedProjectId: string | null = null;

    // 缓存的任务数据
    private reminderData: any = null;

    // 标记是否已应用过默认的折叠策略（避免后续操作重复应用）
    private _defaultCollapseApplied: boolean = false;

    // 当前项目的看板状态配置
    private kanbanStatuses: import('../utils/projectManager').KanbanStatus[] = [];

    // 多选模式状态
    private isMultiSelectMode: boolean = false;
    // 选中的任务ID集合
    private selectedTaskIds: Set<string> = new Set();
    // 批量操作工具栏元素
    private batchToolbar: HTMLElement | null = null;
    // 筛选标签集合
    private selectedFilterTags: Set<string> = new Set();
    // 筛选里程碑集合 (groupId -> Set of milestoneIds)
    private selectedFilterMilestones: Map<string, Set<string>> = new Map();
    // 每个分组的所有可用里程碑ID (groupId -> Set of all available milestoneIds)
    private allAvailableMilestones: Map<string, Set<string>> = new Map();
    private milestoneFilterButton: HTMLButtonElement;
    private isFilterActive: boolean = false;
    private selectedDateFilters: Set<string> = new Set();
    private filterButton: HTMLButtonElement;
    // 上一次点击的任务ID（用于Shift多选范围）
    private lastClickedTaskId: string | null = null;
    private milestoneMap: Map<string, any> = new Map();
    // 里程碑分组折叠状态
    private collapsedMilestoneGroups: Set<string> = new Set();
    // 记录在经过搜索/标签/日期等过滤后，哪些状态/分组还有带里程碑的任务（用于显示筛选按钮）
    private _statusHasMilestoneTasks: Set<string> = new Set();
    // 记录在经过搜索/标签/日期等过滤后，当前视图中所有任务涉及到的所有里程碑 ID
    private _availableMilestonesInView: Set<string> = new Set();
    // 记录在经过搜索/标签/日期等过滤后，每个状态列下有哪些分组（用于里程碑筛选菜单的分组显示）
    private _statusGroupsInView: Map<string, Set<string>> = new Map();
    // 记录在经过搜索/标签/日期等过滤后，每个状态列下有哪些里程碑被实际使用（用于里程碑筛选菜单）
    private _statusMilestonesInView: Map<string, Set<string>> = new Map();

    private lute: any;

    constructor(container: HTMLElement, plugin: any, projectId: string) {
        this.container = container;
        this.plugin = plugin;
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin); // Initialization
        this.projectId = projectId;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);

        try {
            if ((window as any).Lute) {
                this.lute = (window as any).Lute.New();
            }
        } catch (e) {
            console.error(i18n('luteInitFailed'), e);
        }

        this.initializeAsync();
    }

    /**
     * 根据任务的日期和时间计算其“逻辑日期”（考虑一天起始时间设置）
     */
    private static getTaskLogicalDate(date?: string, time?: string): string {
        if (!date) return getLogicalDateString();
        if (time) {
            try {
                return getLogicalDateString(new Date(date + 'T' + time));
            } catch (e) {
                return date;
            }
        }
        return date;
    }

    // 实例包装，保持现有实例调用不变
    private getTaskLogicalDate(date?: string, time?: string): string {
        return (this.constructor as typeof ProjectKanbanView).getTaskLogicalDate(date, time);
    }

    /**
     * 解析提醒时间字符串，返回对应的日期
     * @param reminderTimeStr 提醒时间字符串（可能是时间、日期时间或完整的datetime-local格式）
     * @param taskDate 任务日期（用作默认日期）
     * @returns 日期字符串 YYYY-MM-DD
     */
    private parseReminderDate(reminderTimeStr: string, taskDate?: string): string | null {
        if (!reminderTimeStr) return null;

        const s = String(reminderTimeStr).trim();
        let datePart: string | null = null;
        let timePart: string | null = null;

        // 解析不同格式
        if (s.includes('T')) {
            // ISO格式: YYYY-MM-DDTHH:MM
            const parts = s.split('T');
            datePart = parts[0];
            timePart = parts[1] || null;
        } else if (s.includes(' ')) {
            // 空格分隔: YYYY-MM-DD HH:MM 或 HH:MM extra
            const parts = s.split(' ');
            if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                datePart = parts[0];
                timePart = parts.slice(1).join(' ') || null;
            } else {
                timePart = parts[0];
            }
        } else if (/^\d{2}:\d{2}/.test(s)) {
            // 仅时间: HH:MM
            timePart = s;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            // 仅日期: YYYY-MM-DD
            datePart = s;
        } else {
            timePart = s;
        }

        // 确定有效日期
        const effectiveDate = datePart || taskDate || getLogicalDateString();

        // 返回逻辑日期（考虑时间因素）
        return this.getTaskLogicalDate(effectiveDate, timePart || undefined);
    }

    /**
     * 格式化提醒时间显示
     * @param reminderTimeStr 提醒时间字符串
     * @param taskDate 任务日期
     * @param today 今天的日期
     * @returns 格式化后的显示文本
     */
    private formatReminderTimeDisplay(reminderTimeStr: string, taskDate: string | undefined, today: string): string {
        const s = String(reminderTimeStr).trim();
        let datePart: string | null = null;
        let timePart: string | null = null;

        // 解析格式（同上）
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
                timePart = parts[0];
            }
        } else if (/^\d{2}:\d{2}/.test(s)) {
            timePart = s;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            datePart = s;
        } else {
            timePart = s;
        }

        const effectiveDate = datePart || taskDate || today;
        const logicalDate = this.getTaskLogicalDate(effectiveDate, timePart || undefined);

        // 根据日期关系决定显示内容
        if (compareDateStrings(logicalDate, today) === 0) {
            // 今天：仅显示时间
            return timePart ? timePart.substring(0, 5) : effectiveDate;
        } else {
            // 未来：显示日期+时间
            const showTime = timePart ? ` ${timePart.substring(0, 5)}` : '';
            return `${effectiveDate}${showTime}`;
        }
    }

    private async createGroupDialog(container: HTMLElement) {
        const dialog = new Dialog({
            title: i18n('newGroup'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupName')}</label>
                        <input type="text" id="newGroupName" class="b3-text-field" placeholder="${i18n('pleaseEnterGroupName')}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('bindBlockId')} (${i18n('optional')})</label>
                        <input type="text" id="newGroupBlockId" class="b3-text-field" placeholder="${i18n('pleaseEnterBlockId')}" style="width: 100%;">
                        <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('bindBlockIdHint')}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupColor')}</label>
                        <input type="color" id="newGroupColor" class="b3-text-field" value="#3498db" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('iconOptional')}</label>
                        <input type="text" id="newGroupIcon" class="b3-text-field" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="newGroupCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="newGroupSave">${i18n('createGroup')}</button>
                </div>
            `,
            width: '420px'
        });

        const nameInput = dialog.element.querySelector('#newGroupName') as HTMLInputElement;
        const colorInput = dialog.element.querySelector('#newGroupColor') as HTMLInputElement;
        const iconInput = dialog.element.querySelector('#newGroupIcon') as HTMLInputElement;
        const blockIdInput = dialog.element.querySelector('#newGroupBlockId') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#newGroupCancel') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#newGroupSave') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const icon = iconInput.value.trim();
            const blockId = blockIdInput.value.trim();

            if (!name) {
                showMessage(i18n('pleaseEnterGroupName'));
                return;
            }

            try {
                const projectManager = this.projectManager;
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                const newGroup = {
                    id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    name,
                    color,
                    icon,
                    blockId: blockId || undefined,
                    sort: maxSort + 10
                }; currentGroups.push(newGroup);
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                await this.loadAndDisplayGroups(container);
                this.queueLoadTasks();

                showMessage(i18n('groupCreated'));
                dialog.destroy();
            } catch (error) {
                console.error(i18n('createGroupFailed'), error);
                showMessage(i18n('createGroupFailed'));
            }
        });
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.loadProject();
        await this.loadKanbanMode();

        // 加载项目排序设置
        this.currentSort = await this.projectManager.getProjectSortRule(this.projectId) || 'priority';
        this.currentSortOrder = await this.projectManager.getProjectSortOrder(this.projectId) || 'desc';

        this.initUI();
        await this.loadTasks();

        // 监听提醒更新事件（使用防抖加载以避免频繁重绘导致滚动重置）
        // 只有外部触发的事件才重新加载任务
        window.addEventListener('reminderUpdated', async (e: CustomEvent) => {
            // 如果是自己触发的更新，忽略
            if (e.detail?.source === this.kanbanInstanceId) {
                return;
            }
            // 外部触发的更新，需要刷新缓存 (但不强制读取文件，只使用插件内存缓存)
            this.reminderData = null;
            await this.getReminders(false);
            this.queueLoadTasks();
        });

        // 监听键盘事件，支持 Esc 退出多选模式
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.isMultiSelectMode) {
                this.toggleMultiSelectMode();
            }
        });

        this.checkVip();
    }

    private async loadProject() {
        try {
            const projectData = await this.plugin.loadProjectData();
            this.project = projectData[this.projectId];
            if (!this.project) {
                throw new Error(i18n('projectNotExist'));
            }
        } catch (error) {
            console.error(i18n('loadProjectFailed'), error);
            showMessage(i18n('loadProjectFailed'));
        }
    }

    private async loadKanbanMode() {
        try {
            // 使用项目管理器的方法来获取看板模式
            const projectManager = this.projectManager;
            this.kanbanMode = await projectManager.getProjectKanbanMode(this.projectId);
            // 同时加载看板状态配置
            this.kanbanStatuses = await projectManager.getProjectKanbanStatuses(this.projectId);
        } catch (error) {
            console.error(i18n('loadKanbanModeFailed'), error);
            this.kanbanMode = 'status';
            // 使用默认状态配置
            this.kanbanStatuses = this.projectManager.getDefaultKanbanStatuses();
        }
    }

    private async setKanbanMode(newMode: 'status' | 'custom' | 'list') {
        try {
            this.kanbanMode = newMode;

            // 使用项目管理器保存看板模式
            await this.projectManager.setProjectKanbanMode(this.projectId, newMode);

            // 更新下拉选择框选中状态
            this.updateModeSelect();

            // 触发自定义事件来更新管理按钮显示状态
            this.container.dispatchEvent(new CustomEvent('kanbanModeChanged'));

            // 使用防抖加载并保存/恢复滚动位置
            this.captureScrollState();
            await this.queueLoadTasks();

            const modeMap: { [key: string]: string } = {
                'status': i18n('taskStatus'),
                'custom': i18n('customGroup'),
                'list': i18n('taskList')
            };
            const modeName = modeMap[newMode] || newMode;
            showMessage(i18n('switchedToModeKanbanTemplate').replace('${mode}', modeName));
        } catch (error) {
            console.error(i18n('switchKanbanModeFailed'), error);
            showMessage(i18n('switchKanbanModeFailed'));
        }
    }

    private interactionBlocker = (e: Event) => {
        if (this.plugin.vip.isVip) return;

        // 允许在升级提示框内的点击和交互
        const target = e.target as HTMLElement;
        if (target && typeof target.closest === 'function' && target.closest('.vip-upgrade-prompt')) {
            return;
        }

        e.stopPropagation();
        e.preventDefault();
    };

    private async checkVip() {
        const status = await VipManager.checkAndUpdateVipStatus(this.plugin);
        this.plugin.vip.isVip = status.isVip;
        this.plugin.vip.expireDate = status.expireDate;

        const isVip = this.plugin.vip.isVip;
        const overlay = this.container.querySelector('.vip-mask-overlay');
        const prompt = this.container.querySelector('.vip-upgrade-prompt');

        if (isVip) {
            if (overlay) overlay.remove();
            if (prompt) prompt.remove();

            // 移除事件拦截
            const eventsToBlock = ['click', 'mousedown', 'mouseup', 'mousemove', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keyup'];
            eventsToBlock.forEach(eventType => {
                this.container.removeEventListener(eventType, this.interactionBlocker, true);
            });
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
                    ${i18n('vipOnlyFeature')}
                </div>
                <div style="font-size: 14px; opacity: 0.8; text-align: center;">
                    ${i18n('upgradeToVipTip')}
                </div>
                <button class="b3-button b3-button--text" style="padding: 8px 24px; font-weight: bold;">
                    ${i18n('upgradeNow')}
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

        // 添加事件拦截器，防止用户删除 DOM 后直接使用
        const eventsToBlock = ['click', 'mousedown', 'mouseup', 'mousemove', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchmove', 'touchend', 'keydown', 'keyup'];
        eventsToBlock.forEach(eventType => {
            this.container.addEventListener(eventType, this.interactionBlocker, true);
        });
    }

    private updateModeSelect() {
        const modeSelect = this.container.querySelector('.kanban-mode-select') as HTMLSelectElement;
        if (modeSelect) {
            modeSelect.value = this.kanbanMode;
        }
    }

    private async showManageGroupsDialog() {
        const dialog = new Dialog({
            title: i18n('manageCustomGroups'),
            content: `
                <div class="manage-groups-dialog">
                    <div class="b3-dialog__content">
                        <div class="groups-filter" style="display: flex; align-items: center; ">
                            <label class="b3-label" style="display: flex; align-items: center; gap: 4px; cursor: pointer; flex: 1;">
                                <input type="checkbox" id="hideNoDoingGroupCb" class="b3-switch b3-switch--small" ${this.project?.hideNoDoingGroups ? 'checked' : ''}>
                                <span style="font-size: 13px;">${i18n('hideNoDoingGroups')}</span>
                            </label>
                            <label class="b3-label" style="display: flex; align-items: center; gap: 4px; cursor: pointer; flex: 1;">
                                <input type="checkbox" id="hideNoTodayGroupCb" class="b3-switch b3-switch--small" ${this.project?.hideNoTodayGroups ? 'checked' : ''}>
                                <span style="font-size: 13px;">${i18n('hideNoTodayGroups')}</span>
                            </label>
                        </div>
                        <div class="groups-list" style="margin-bottom: 16px;">
                            <div class="groups-header" style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="margin: 0;">${i18n('existingGroups')}</h4>
                                <button id="addGroupBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newGroup')}
                                </button>
                            </div>
                            <div id="groupsContainer" class="groups-container" style="overflow-y: auto;">
                                <!-- 分组列表将在这里动态生成 -->
                            </div>
                        </div>

                        <div id="groupForm" class="group-form" style="display: none; padding: 16px; background: var(--b3-theme-surface-lighter); border-radius: 8px; border: 1px solid var(--b3-theme-border);">
                            <h4 id="formTitle" style="margin-top: 0;">${i18n('newGroup')}</h4>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('groupName')}</label>
                                <input type="text" id="groupNameInput" class="b3-text-field" placeholder="${i18n('pleaseEnterGroupName')}" style="width: 100%;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('groupColor')}</label>
                                <div class="color-picker" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                    <!-- 预设颜色选项 -->
                                </div>
                                <input type="color" id="groupColorInput" class="b3-text-field" value="#3498db" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('iconOptional')}</label>
                                <input type="text" id="groupIconInput" class="b3-text-field" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                            </div>
                            <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                                <button id="cancelFormBtn" class="b3-button b3-button--outline">${i18n('cancel')}</button>
                                <button id="saveGroupBtn" class="b3-button b3-button--primary">${i18n('save')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            width: "500px",
            height: "auto"
        });

        // 获取DOM元素
        const groupsContainer = dialog.element.querySelector('#groupsContainer') as HTMLElement;
        const hideNoDoingGroupCb = dialog.element.querySelector('#hideNoDoingGroupCb') as HTMLInputElement;
        const hideNoTodayGroupCb = dialog.element.querySelector('#hideNoTodayGroupCb') as HTMLInputElement;

        const updateFilters = async () => {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[this.projectId]) {
                projectData[this.projectId].hideNoDoingGroups = hideNoDoingGroupCb.checked;
                projectData[this.projectId].hideNoTodayGroups = hideNoTodayGroupCb.checked;
                await this.plugin.saveProjectData(projectData);
                await this.loadProject();
                this.queueLoadTasks(); // 刷新看板内容
            }
        };

        hideNoDoingGroupCb.addEventListener('change', updateFilters);
        hideNoTodayGroupCb.addEventListener('change', updateFilters);
        const addGroupBtn = dialog.element.querySelector('#addGroupBtn') as HTMLButtonElement;
        const groupForm = dialog.element.querySelector('#groupForm') as HTMLElement;
        const formTitle = dialog.element.querySelector('#formTitle') as HTMLElement;
        const groupNameInput = dialog.element.querySelector('#groupNameInput') as HTMLInputElement;
        const groupColorInput = dialog.element.querySelector('#groupColorInput') as HTMLInputElement;
        const groupIconInput = dialog.element.querySelector('#groupIconInput') as HTMLInputElement;
        const cancelFormBtn = dialog.element.querySelector('#cancelFormBtn') as HTMLButtonElement;
        const saveGroupBtn = dialog.element.querySelector('#saveGroupBtn') as HTMLButtonElement;
        const colorPicker = dialog.element.querySelector('.color-picker') as HTMLElement;

        let editingGroupId: string | null = null;

        // 预设颜色选项
        const presetColors = [
            '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
            '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
            '#16a085', '#27ae60', '#2980b9', '#8e44ad'
        ];

        presetColors.forEach(color => {
            const colorOption = document.createElement('div');
            colorOption.className = 'color-option';
            colorOption.style.cssText = `
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background-color: ${color};
                cursor: pointer;
                border: 2px solid transparent;
                transition: border-color 0.2s ease;
            `;
            colorOption.addEventListener('click', () => {
                colorPicker.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                colorOption.classList.add('selected');
                groupColorInput.value = color;
            });
            colorPicker.appendChild(colorOption);
        });

        // 加载并显示现有分组
        await this.loadAndDisplayGroups(groupsContainer);

        // 新建分组按钮：改为弹出独立的创建分组对话框（而不是页面内联表单）
        addGroupBtn.addEventListener('click', async () => {
            try {
                await this.createGroupDialog(groupsContainer);
            } catch (err) {
                console.error(i18n('openCreateGroupFailed'), err);
                showMessage(i18n('openCreateGroupFailed'));
            }
        });

        // 取消表单
        cancelFormBtn.addEventListener('click', () => {
            groupForm.style.display = 'none';
        });

        // 保存分组
        saveGroupBtn.addEventListener('click', async () => {
            const name = groupNameInput.value.trim();
            const color = groupColorInput.value;
            const icon = groupIconInput.value.trim();

            if (!name) {
                showMessage(i18n('pleaseEnterGroupName'));
                return;
            }

            try {
                // 获取当前项目的分组列表
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                let newGroup;
                if (editingGroupId) {
                    // 编辑现有分组
                    const groupIndex = currentGroups.findIndex((g: any) => g.id === editingGroupId);
                    if (groupIndex !== -1) {
                        currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon };
                        newGroup = currentGroups[groupIndex];
                    }
                    showMessage(i18n('groupUpdated'));
                } else {
                    // 创建新分组
                    const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                    newGroup = {
                        id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        name,
                        color,
                        icon,
                        sort: maxSort + 10
                    };
                    currentGroups.push(newGroup);
                    showMessage(i18n('groupCreated'));
                }

                // 保存到项目数据
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                // 刷新分组列表
                await this.loadAndDisplayGroups(groupsContainer);
                groupForm.style.display = 'none';

                // 刷新看板（使用防抖队列）
                await this.loadProject();
                this.queueLoadTasks();
            } catch (error) {
                console.error(i18n('saveGroupFailed'), error);
                showMessage(i18n('saveGroupFailed'));
            }
        });
    }

    /**
     * 显示管理任务状态对话框
     */
    private async showManageKanbanStatusesDialog() {
        const projectManager = this.projectManager;

        // 加载当前项目的状态配置
        let statuses = await projectManager.getProjectKanbanStatuses(this.projectId);

        const dialog = new Dialog({
            title: i18n('manageKanbanStatuses'),
            content: `
                <div class="manage-statuses-dialog">
                    <div class="b3-dialog__content">
                        <div class="statuses-list" style="margin-bottom: 16px;">
                            <div class="statuses-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <h4 style="margin: 0;">${i18n('existingStatuses')}</h4>
                                <button id="addStatusBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newStatus')}
                                </button>
                            </div>
                            <div id="statusesContainer" class="statuses-container" style="max-height: 350px; overflow-y: auto;">
                                <!-- 状态列表将在这里动态生成 -->
                            </div>
                        </div>
                        <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px;">
                            ${i18n('kanbanStatusHint')}
                        </div>
                    </div>
                </div>
            `,
            width: "480px",
            height: "auto"
        });

        const statusesContainer = dialog.element.querySelector('#statusesContainer') as HTMLElement;
        const addStatusBtn = dialog.element.querySelector('#addStatusBtn') as HTMLButtonElement;

        // 插入指示占位元素（用于显示拖拽时的插入位置） — 更细、更稳定
        const placeholder = document.createElement('div');
        placeholder.className = 'status-insert-placeholder';
        placeholder.style.cssText = `
            height: 3px;
            background: var(--b3-theme-primary);
            border-radius: 2px;
            margin: 6px 0;
            display: none;
            transition: opacity 120ms ease;
        `;
        statusesContainer.appendChild(placeholder);

        // 拖拽计数器，避免子元素触发导致闪烁
        let dragCounter = 0;

        // 当拖入容器时增加计数
        statusesContainer.addEventListener('dragenter', (ev: DragEvent) => {
            ev.preventDefault();
            dragCounter++;
        });

        // 当拖离容器时检测是否真正离开（relatedTarget 不在容器内）
        statusesContainer.addEventListener('dragleave', (ev: DragEvent) => {
            const related = (ev as any).relatedTarget as HTMLElement | null;
            if (!related || !statusesContainer.contains(related)) {
                dragCounter = 0;
                placeholder.style.display = 'none';
            } else {
                dragCounter = Math.max(0, dragCounter - 1);
            }
        });

        // 更稳健的 dragover：根据每个项的中点计算插入位置，避免因子节点触发导致闪烁
        statusesContainer.addEventListener('dragover', (ev: DragEvent) => {
            ev.preventDefault();
            const items = Array.from(statusesContainer.querySelectorAll('.status-item')) as HTMLElement[];
            if (items.length === 0) {
                statusesContainer.appendChild(placeholder);
                placeholder.style.display = 'block';
                return;
            }

            let inserted = false;
            for (const item of items) {
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (ev.clientY < midY) {
                    item.parentElement!.insertBefore(placeholder, item);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                statusesContainer.appendChild(placeholder);
            }
            placeholder.style.display = 'block';
        });

        // 处理放下事件：根据占位符位置重新排列 statuses 数组并保存
        statusesContainer.addEventListener('drop', async (ev: DragEvent) => {
            ev.preventDefault();
            placeholder.style.display = 'none';
            dragCounter = 0;
            const data = ev.dataTransfer?.getData('text/status-id') || ev.dataTransfer?.getData('text');
            if (!data) return;
            const draggedId = data as string;

            // 计算占位符之前有多少个 status-item，用作插入索引
            let beforeCount = 0;
            for (const child of Array.from(statusesContainer.children)) {
                if (child === placeholder) break;
                const el = child as HTMLElement;
                if (el.classList && el.classList.contains('status-item')) beforeCount++;
            }
            const insertIndex = beforeCount;

            // 在原数组中移动元素
            const fromIndex = statuses.findIndex(s => s.id === draggedId);
            if (fromIndex === -1) return;
            const [moved] = statuses.splice(fromIndex, 1);
            statuses.splice(insertIndex, 0, moved);
            // 重新分配排序值
            statuses.forEach((s, i) => { s.sort = i * 10; });
            // 保存并刷新
            await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
            renderStatuses();
            await this.loadProject();
            this.kanbanStatuses = statuses;
            this._lastRenderedProjectId = null;
            this.queueLoadTasks();
            showMessage(i18n('statusOrderSaved'));
        });

        // 渲染状态列表
        const renderStatuses = async () => {
            statusesContainer.innerHTML = '';

            if (statuses.length === 0) {
                statusesContainer.innerHTML = `< div style = "text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;" > ${i18n('noStatuses')} </div>`;
                return;
            }

            statuses.forEach((status, index) => {
                const statusItem = document.createElement('div');
                statusItem.className = 'status-item';
                statusItem.dataset.statusId = status.id;
                statusItem.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface-lighter);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 8px;
                    transition: all 0.2s ease;
                `;

                // 允许拖拽排序
                statusItem.draggable = true;
                statusItem.addEventListener('dragstart', (e: DragEvent) => {
                    try {
                        e.dataTransfer?.setData('text/status-id', status.id);
                    } catch (err) { }
                    e.dataTransfer!.effectAllowed = 'move';
                    statusItem.classList.add('dragging');
                    // 可选：使用克隆节点作为拖动图像
                    try {
                        const dragImage = statusItem.cloneNode(true) as HTMLElement;
                        dragImage.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                        dragImage.style.transform = 'scale(0.98)';
                        dragImage.style.position = 'absolute';
                        dragImage.style.top = '-9999px';
                        document.body.appendChild(dragImage);
                        e.dataTransfer?.setDragImage(dragImage, 10, 10);
                        setTimeout(() => document.body.removeChild(dragImage), 0);
                    } catch (err) { }
                });
                statusItem.addEventListener('dragend', () => {
                    statusItem.classList.remove('dragging');
                    placeholder.style.display = 'none';
                });

                // 拖拽手柄（所有状态都支持排序）
                const dragHandle = document.createElement('span');
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.style.cssText = `
                    font-size: 14px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.6;
                    cursor: move;
                    padding: 2px 4px;
                    user-select: none;
                `;
                dragHandle.title = i18n('dragToSort');
                statusItem.appendChild(dragHandle);

                // 颜色圆点
                const colorDot = document.createElement('span');
                colorDot.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background: ${status.color};
                    border: 2px solid var(--b3-theme-surface);
                    box-shadow: 0 0 0 1px var(--b3-theme-border);
                    flex-shrink: 0;
                `;
                statusItem.appendChild(colorDot);

                // 图标
                const iconSpan = document.createElement('span');
                iconSpan.textContent = status.icon || '';
                iconSpan.style.cssText = `
                    font-size: 16px;
                    flex-shrink: 0;
                    margin-left: 4px;
                `;
                statusItem.appendChild(iconSpan);

                // 状态名称
                const nameSpan = document.createElement('span');
                nameSpan.textContent = status.name + (status.isFixed ? ` (${i18n('fixed')})` : '');
                nameSpan.style.cssText = `
                    flex: 1;
                    font-weight: 500;
                    color: var(--b3-theme-on-surface);
                    margin-left: 4px;
                `;
                statusItem.appendChild(nameSpan);

                // 操作按钮组
                const actionsDiv = document.createElement('div');
                actionsDiv.style.cssText = 'display: flex; gap: 4px; align-items: center;';

                // 上移按钮（所有状态都可以排序，只要不是第一个）
                if (index > 0) {
                    const moveUpBtn = document.createElement('button');
                    moveUpBtn.className = 'b3-button b3-button--text';
                    moveUpBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconUp"></use></svg>';
                    moveUpBtn.title = i18n('moveUp');
                    moveUpBtn.style.cssText = 'padding: 2px; min-width: unset;';
                    moveUpBtn.addEventListener('click', async () => {
                        const currentIndex = statuses.findIndex(s => s.id === status.id);
                        if (currentIndex > 0) {
                            // 交换位置
                            [statuses[currentIndex], statuses[currentIndex - 1]] = [statuses[currentIndex - 1], statuses[currentIndex]];
                            // 重新分配排序值
                            statuses.forEach((s, i) => { s.sort = i * 10; });
                            // 保存
                            await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                            // 刷新列表
                            renderStatuses();
                            // 刷新看板 - 强制重新创建列
                            this.kanbanStatuses = statuses;
                            this._lastRenderedProjectId = null; // 强制重新创建列
                            this.queueLoadTasks();
                        }
                    });
                    actionsDiv.appendChild(moveUpBtn);
                }

                // 下移按钮（所有状态都可以排序，只要不是最后一个）
                if (index < statuses.length - 1) {
                    const moveDownBtn = document.createElement('button');
                    moveDownBtn.className = 'b3-button b3-button--text';
                    moveDownBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconDown"></use></svg>';
                    moveDownBtn.title = i18n('moveDown');
                    moveDownBtn.style.cssText = 'padding: 2px; min-width: unset;';
                    moveDownBtn.addEventListener('click', async () => {
                        const currentIndex = statuses.findIndex(s => s.id === status.id);
                        if (currentIndex < statuses.length - 1) {
                            // 交换位置
                            [statuses[currentIndex], statuses[currentIndex + 1]] = [statuses[currentIndex + 1], statuses[currentIndex]];
                            // 重新分配排序值
                            statuses.forEach((s, i) => { s.sort = i * 10; });
                            // 保存
                            await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                            // 刷新列表
                            renderStatuses();
                            // 刷新看板 - 强制重新创建列
                            this.kanbanStatuses = statuses;
                            this._lastRenderedProjectId = null; // 强制重新创建列
                            this.queueLoadTasks();
                        }
                    });
                    actionsDiv.appendChild(moveDownBtn);
                }

                // 编辑按钮（所有状态都可以编辑颜色和排序，固定状态不能修改名称）
                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--text';
                editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.title = status.isFixed ? i18n('editColor') : (i18n('edit') || '编辑');
                editBtn.style.cssText = 'padding: 2px; min-width: unset;';
                editBtn.addEventListener('click', () => showEditStatusDialog(status));
                actionsDiv.appendChild(editBtn);

                // 删除按钮（仅非固定状态可删除）
                if (!status.isFixed) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'b3-button b3-button--text';
                    deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px; color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
                    deleteBtn.title = i18n('delete');
                    deleteBtn.style.cssText = 'padding: 2px; min-width: unset;';
                    deleteBtn.addEventListener('click', () => {
                        const confirmMsg = i18n('confirmDeleteStatus', { name: status.name });
                        confirm(i18n('confirm'), confirmMsg, async () => {
                            // 检查该状态下是否有任务
                            const tasksInStatus = this.tasks.filter(t => this.getTaskStatus(t) === status.id);

                            if (tasksInStatus.length > 0) {
                                // 有任务，显示选择目标状态的弹窗
                                // 排除已完成状态，因为未完成任务不应该移动到已完成
                                const otherStatuses = statuses.filter(s => s.id !== status.id && s.id !== 'completed');
                                if (otherStatuses.length === 0) {
                                    showMessage(i18n('noOtherStatusToMove'));
                                    return;
                                }

                                // 默认选择第一个非进行中的状态，如果没有则选择进行中
                                let defaultTargetStatus = otherStatuses.find(s => s.id !== 'doing');
                                if (!defaultTargetStatus) {
                                    defaultTargetStatus = otherStatuses[0];
                                }

                                // 创建选择目标状态的对话框
                                const moveDialog = new Dialog({
                                    title: i18n('moveTasksTitle', { count: String(tasksInStatus.length) }),
                                    content: `
                                        <div class="b3-dialog__content">
                                            <div class="b3-form__group">
                                                <label class="b3-form__label">${i18n('selectTargetStatus')}</label>
                                                <select id="targetStatusSelect" class="b3-select" style="width: 100%;">
                                                    ${otherStatuses.map(s => `<option value="${s.id}" ${s.id === defaultTargetStatus?.id ? 'selected' : ''}>${s.icon || ''} ${s.name}</option>`).join('')}
                                                </select>
                                                <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">
                                                    ${i18n('moveTasksHint', { count: String(tasksInStatus.length) })}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="b3-dialog__action">
                                            <button class="b3-button b3-button--cancel" id="cancelMoveBtn">${i18n('cancel')}</button>
                                            <button class="b3-button b3-button--primary" id="confirmMoveBtn">${i18n('confirm')}</button>
                                        </div>
                                    `,
                                    width: "360px",
                                    height: "auto"
                                });

                                moveDialog.element.querySelector('#cancelMoveBtn')?.addEventListener('click', () => {
                                    moveDialog.destroy();
                                });

                                moveDialog.element.querySelector('#confirmMoveBtn')?.addEventListener('click', async () => {
                                    const targetStatusSelect = moveDialog.element.querySelector('#targetStatusSelect') as HTMLSelectElement;
                                    const targetStatusId = targetStatusSelect.value;

                                    // 移动任务到目标状态 - 批量处理
                                    const tasksToUpdate = [];
                                    for (const task of tasksInStatus) {
                                        // 修改状态
                                        if (targetStatusId === 'completed') {
                                            task.kanbanStatus = 'completed';
                                            task.completed = true;
                                            task.completedTime = getLocalDateTimeString(new Date());
                                        } else if (targetStatusId === 'doing') {
                                            task.completed = false;
                                            task.completedTime = undefined;
                                            task.kanbanStatus = 'doing';
                                        } else {
                                            task.completed = false;
                                            task.completedTime = undefined;
                                            task.kanbanStatus = targetStatusId;
                                        }
                                        tasksToUpdate.push(task);
                                    }

                                    // 批量保存任务
                                    await this.saveTasks(tasksToUpdate);

                                    moveDialog.destroy();

                                    // 继续删除状态并刷新列表
                                    statuses = await this.deleteStatusAndRefresh(statuses, status.id, projectManager);
                                    renderStatuses();
                                });
                            } else {
                                // 没有任务，直接删除状态并刷新列表
                                statuses = await this.deleteStatusAndRefresh(statuses, status.id, projectManager);
                                renderStatuses();
                            }
                        });
                    });
                    actionsDiv.appendChild(deleteBtn);
                }

                statusItem.appendChild(actionsDiv);
                statusesContainer.appendChild(statusItem);
            });
        };

        // 显示编辑状态对话框
        const showEditStatusDialog = (status: import('../utils/projectManager').KanbanStatus) => {
            const isFixed = status.isFixed;
            const editDialog = new Dialog({
                title: isFixed ? i18n('editStatusColor') : i18n('editStatus'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusName') || '状态名称'}</label>
                            <input type="text" id="editStatusName" class="b3-text-field" value="${status.name}" style="width: 100%;" ${isFixed ? 'disabled readonly' : ''}>
                            ${isFixed ? `<div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('fixedStatusCannotRename') || '固定状态不支持修改名称'}</div>` : ''}
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusIcon') || '状态图标'} <span style="font-weight: normal; color: var(--b3-theme-on-surface-light);">(${i18n('optional') || '可选'})</span></label>
                            <input type="text" id="editStatusIcon" class="b3-text-field" value="${status.icon || ''}" placeholder="${i18n('emojiIconExample') || '例如: 📋'}" style="width: 100%;">
                            <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('statusIconHint') || '使用 emoji 作为状态图标，留空则不显示图标'}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusColor') || '状态颜色'}</label>
                            <input type="color" id="editStatusColor" class="b3-text-field" value="${status.color}" style="width: 100%; height: 40px;">
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelEditBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="saveEditBtn">${i18n('save')}</button>
                    </div>
                `,
                width: "360px",
                height: "auto"
            });

            const nameInput = editDialog.element.querySelector('#editStatusName') as HTMLInputElement;
            const iconInput = editDialog.element.querySelector('#editStatusIcon') as HTMLInputElement;
            const colorInput = editDialog.element.querySelector('#editStatusColor') as HTMLInputElement;

            editDialog.element.querySelector('#cancelEditBtn')?.addEventListener('click', () => {
                editDialog.destroy();
            });

            editDialog.element.querySelector('#saveEditBtn')?.addEventListener('click', async () => {
                const newName = nameInput.value.trim();
                const newIcon = iconInput.value.trim();
                const newColor = colorInput.value;

                // 固定状态不验证名称（因为不能修改）
                if (!isFixed && !newName) {
                    showMessage(i18n('pleaseEnterStatusName') || '请输入状态名称');
                    return;
                }

                // 更新状态
                const index = statuses.findIndex(s => s.id === status.id);
                if (index !== -1) {
                    // 固定状态只更新颜色和图标，不更新名称
                    if (!isFixed) {
                        statuses[index].name = newName;
                    }
                    statuses[index].icon = newIcon || undefined;
                    statuses[index].color = newColor;
                    // 保存
                    await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                    // 刷新列表
                    renderStatuses();
                    // 刷新看板 - 强制重新创建列
                    this.kanbanStatuses = statuses;
                    this._lastRenderedProjectId = null; // 强制重新创建列
                    this.queueLoadTasks();
                    showMessage(i18n('statusUpdated'));
                }

                editDialog.destroy();
            });
        };

        // 显示新增状态对话框
        addStatusBtn.addEventListener('click', () => {
            const addDialog = new Dialog({
                title: i18n('newStatus'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusName') || '状态名称'}</label>
                            <input type="text" id="newStatusName" class="b3-text-field" placeholder="${i18n('pleaseEnterStatusName') || '请输入状态名称'}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusIcon') || '状态图标'} <span style="font-weight: normal; color: var(--b3-theme-on-surface-light);">(${i18n('optional') || '可选'})</span></label>
                            <input type="text" id="newStatusIcon" class="b3-text-field" placeholder="${i18n('emojiIconExample') || '例如: 📋'}" style="width: 100%;">
                            <div class="b3-label__text" style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-top: 4px;">${i18n('statusIconHint') || '使用 emoji 作为状态图标，留空则不显示图标'}</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('statusColor') || '状态颜色'}</label>
                            <input type="color" id="newStatusColor" class="b3-text-field" value="#3498db" style="width: 100%; height: 40px;">
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="cancelAddBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="confirmAddBtn">${i18n('save')}</button>
                    </div>
                `,
                width: "360px",
                height: "auto"
            });

            const nameInput = addDialog.element.querySelector('#newStatusName') as HTMLInputElement;
            const iconInput = addDialog.element.querySelector('#newStatusIcon') as HTMLInputElement;
            const colorInput = addDialog.element.querySelector('#newStatusColor') as HTMLInputElement;

            addDialog.element.querySelector('#cancelAddBtn')?.addEventListener('click', () => {
                addDialog.destroy();
            });

            addDialog.element.querySelector('#confirmAddBtn')?.addEventListener('click', async () => {
                const name = nameInput.value.trim();
                const icon = iconInput.value.trim();
                const color = colorInput.value;

                if (!name) {
                    showMessage(i18n('pleaseEnterStatusName') || '请输入状态名称');
                    return;
                }

                // 检查是否已存在相同名称
                if (statuses.some(s => s.name === name)) {
                    showMessage(i18n('statusNameExists') || '状态名称已存在');
                    return;
                }

                // 创建新状态
                const newStatus: import('../utils/projectManager').KanbanStatus = {
                    id: projectManager.generateKanbanStatusId(),
                    name,
                    color,
                    icon: icon || undefined,
                    isFixed: false,
                    sort: statuses.length * 10
                };

                statuses.push(newStatus);
                // 保存
                await projectManager.setProjectKanbanStatuses(this.projectId, statuses);
                // 刷新列表
                renderStatuses();
                // 刷新看板 - 强制重新创建列
                this.kanbanStatuses = statuses;
                this._lastRenderedProjectId = null; // 强制重新创建列
                this.queueLoadTasks();
                showMessage(i18n('statusCreated'));

                addDialog.destroy();
            });
        });

        // 初始渲染
        renderStatuses();
    }

    /**
     * 删除状态并刷新看板
     * 返回更新后的状态数组
     */
    private async deleteStatusAndRefresh(
        currentStatuses: import('../utils/projectManager').KanbanStatus[],
        statusIdToDelete: string,
        projectManager: import('../utils/projectManager').ProjectManager
    ): Promise<import('../utils/projectManager').KanbanStatus[]> {
        // 删除状态
        const updatedStatuses = currentStatuses.filter(s => s.id !== statusIdToDelete);
        // 重新分配排序值
        updatedStatuses.forEach((s, i) => { s.sort = i * 10; });
        // 保存
        await projectManager.setProjectKanbanStatuses(this.projectId, updatedStatuses);
        // 刷新看板状态
        this.kanbanStatuses = updatedStatuses;
        this._lastRenderedProjectId = null; // 强制重新创建列
        await this.queueLoadTasks();
        showMessage(i18n('statusDeleted'));
        return updatedStatuses;
    }


    private async showManageTagsDialog() {
        const dialog = new Dialog({
            title: i18n('manageProjectTags'),
            content: `
                <div class="manage-tags-dialog">
                    <div class="b3-dialog__content">
                        <div class="tags-list" style="margin-bottom: 16px;">
                            <div class="tags-header" style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="margin: 0;">${i18n('existingTags')}</h4>
                                <button id="addTagBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newTag')}
                                </button>
                            </div>
                            <div id="tagsContainer" class="tags-container" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;">
                                <!-- 标签列表将在这里动态生成 -->
                            </div>
                        </div>
                    </div>
                </div>
            `,
            width: "600px",
            height: "auto"
        });

        const tagsContainer = dialog.element.querySelector('#tagsContainer') as HTMLElement;
        const addTagBtn = dialog.element.querySelector('#addTagBtn') as HTMLButtonElement;

        // 加载并显示现有标签
        const loadAndDisplayTags = async () => {
            try {
                const projectManager = this.projectManager;
                const projectTags = await projectManager.getProjectTags(this.projectId);

                tagsContainer.innerHTML = '';

                if (projectTags.length === 0) {
                    tagsContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px; width: 100%;">${i18n('noTags')}</div>`;
                    return;
                }

                projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                    const tagItem = document.createElement('div');
                    tagItem.className = 'tag-item';
                    tagItem.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 6px 12px;
                        background: ${tag.color}20;
                        border: 1px solid ${tag.color};
                        border-radius: 16px;
                        font-size: 14px;
                        color: var(--b3-theme-on-surface);
                        cursor: pointer;
                    `;

                    const tagText = document.createElement('span');
                    tagText.textContent = `#${tag.name}`;
                    tagItem.appendChild(tagText);

                    // 编辑按钮
                    const editBtn = document.createElement('button');
                    editBtn.className = 'b3-button b3-button--text';
                    editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
                    editBtn.title = i18n('edit');
                    editBtn.style.cssText = `
                        padding: 2px;
                        min-width: unset;
                        opacity: 0.6;
                    `;
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showEditTagDialog(tag);
                    });
                    tagItem.appendChild(editBtn);

                    // 删除按钮
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'b3-button b3-button--text';
                    deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconClose"></use></svg>';
                    deleteBtn.title = i18n('delete');
                    deleteBtn.style.cssText = `
                        padding: 2px;
                        min-width: unset;
                        opacity: 0.6;
                    `;
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await deleteTag(tag.name);
                    });
                    tagItem.appendChild(deleteBtn);

                    tagsContainer.appendChild(tagItem);
                });
            } catch (error) {
                console.error(i18n('loadTagsFailed'), error);
                tagsContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">${i18n('loadTagsFailed')}</div>`;
            }
        };

        // 删除标签
        const deleteTag = async (tagNameToDelete: string) => {
            try {
                const projectManager = this.projectManager;
                const projectTags = await projectManager.getProjectTags(this.projectId);

                const updatedTags = projectTags.filter(tag => tag.name !== tagNameToDelete);
                await projectManager.setProjectTags(this.projectId, updatedTags);

                await loadAndDisplayTags();
                await this.loadProject();
                showMessage(i18n('tagDeleted'));
            } catch (error) {
                console.error(i18n('deleteTagFailed'), error);
                showMessage(i18n('deleteTagFailed'));
            }
        };

        // 编辑标签对话框
        const showEditTagDialog = (existingTag: { id: string, name: string, color: string }) => {
            showTagEditDialog(existingTag, async (updatedTag) => {
                try {
                    const projectManager = this.projectManager;
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    const index = projectTags.findIndex(t => t.id === existingTag.id);
                    if (index !== -1) {
                        projectTags[index] = updatedTag;
                        await projectManager.setProjectTags(this.projectId, projectTags);
                        await loadAndDisplayTags();
                        await this.loadProject();
                        showMessage(i18n('tagUpdated'));
                    }
                } catch (error) {
                    console.error(i18n('updateTagFailed'), error);
                    showMessage(i18n('updateTagFailed'));
                }
            });
        };

        // 新建/编辑标签对话框
        const showTagEditDialog = (existingTag: { id: string, name: string, color: string } | null, onSave: (tag: { id: string, name: string, color: string }) => void) => {
            const isEdit = existingTag !== null;
            const defaultColor = existingTag?.color || '#3498db';
            const defaultName = existingTag?.name || '';

            const tagDialog = new Dialog({
                title: isEdit ? i18n('editTag') : i18n('newTag'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('tagName')}</label>
                            <input type="text" id="tagNameInput" class="b3-text-field" placeholder="${i18n('pleaseEnterTagName')}" value="${defaultName}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group" style="margin-top: 12px;">
                            <label class="b3-form__label">${i18n('tagColor')}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="color" id="tagColorInput" value="${defaultColor}" style="width: 60px; height: 32px; border: 1px solid var(--b3-border-color); border-radius: 4px; cursor: pointer;">
                                <input type="text" id="tagColorText" class="b3-text-field" value="${defaultColor}" style="flex: 1;" readonly>
                                <div id="tagColorPreview" style="width: 80px; height: 32px; border-radius: 16px; border: 1px solid ${defaultColor}; background: ${defaultColor}20; display: flex; align-items: center; justify-content: center; font-size: 12px;">${i18n('preview')}</div>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="tagDialogCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="tagDialogSave">${i18n('save')}</button>
                    </div>
                `,
                width: '400px'
            });

            const nameInput = tagDialog.element.querySelector('#tagNameInput') as HTMLInputElement;
            const colorInput = tagDialog.element.querySelector('#tagColorInput') as HTMLInputElement;
            const colorText = tagDialog.element.querySelector('#tagColorText') as HTMLInputElement;
            const colorPreview = tagDialog.element.querySelector('#tagColorPreview') as HTMLElement;
            const cancelBtn = tagDialog.element.querySelector('#tagDialogCancel') as HTMLButtonElement;
            const saveBtn = tagDialog.element.querySelector('#tagDialogSave') as HTMLButtonElement;

            // 颜色选择器变化
            colorInput.addEventListener('input', () => {
                const color = colorInput.value;
                colorText.value = color;
                colorPreview.style.borderColor = color;
                colorPreview.style.background = `${color}20`;
            });

            cancelBtn.addEventListener('click', () => tagDialog.destroy());

            saveBtn.addEventListener('click', async () => {
                const tagName = nameInput.value.trim();
                const tagColor = colorInput.value;

                if (!tagName) {
                    showMessage(i18n('pleaseEnterTagName'));
                    return;
                }

                // 检查标签名是否已存在（编辑时排除自己）
                if (!isEdit || tagName !== existingTag.name) {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    if (projectTags.some(t => t.name === tagName)) {
                        showMessage(i18n('tagAlreadyExists'));
                        return;
                    }
                }

                // 生成ID（编辑时保留原ID，新建时生成新ID）
                const tagId = isEdit ? existingTag.id : `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                onSave({ id: tagId, name: tagName, color: tagColor });
                tagDialog.destroy();
            });
        };

        // 新建标签
        addTagBtn.addEventListener('click', () => {
            showTagEditDialog(null, async (newTag) => {
                try {
                    const projectManager = this.projectManager;
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    projectTags.push(newTag);
                    await projectManager.setProjectTags(this.projectId, projectTags);

                    await loadAndDisplayTags();
                    await this.loadProject();
                    showMessage(i18n('tagCreated'));
                } catch (error) {
                    console.error(i18n('createTagFailed'), error);
                    showMessage(i18n('createTagFailed'));
                }
            });
        });

        // 初始加载标签
        await loadAndDisplayTags();
    }

    private async showManageMilestonesDialog(groupId?: string) {
        const dialog = new Dialog({
            title: i18n('manageMilestones'),
            content: `
                <div class="manage-milestones-dialog" style="height: 100%; display: flex; flex-direction: column;">
                    <div class="b3-dialog__content" style="flex: 1; overflow-y: auto; padding: 16px;">
                        <div id="milestonesGroupsContainer"></div>
                    </div>
                </div>
            `,
            width: "650px",
            height: "600px"
        });

        const container = dialog.element.querySelector('#milestonesGroupsContainer') as HTMLElement;
        this.renderMilestonesInDialog(container, groupId);
    }

    private async renderMilestonesInDialog(container: HTMLElement, groupId?: string) {
        try {
            const projectManager = this.projectManager;
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];
            const defaultMilestones = project?.milestones || [];

            container.innerHTML = '';

            // 判断是否全局模式（未指定 groupId 时为全局模式）
            const isGlobalMode = !groupId;

            // 如果指定了 groupId，只显示该分组的里程碑
            if (groupId) {
                // 查找对应的分组
                const targetGroup = projectGroups.find(g => g.id === groupId);
                if (targetGroup) {
                    const groupKey = targetGroup.id;
                    const isCollapsed = this.collapsedMilestoneGroups.has(groupKey);
                    const groupSection = this.createMilestoneSection(targetGroup.name, targetGroup.id, targetGroup.milestones || [], container, isCollapsed, false);
                    container.appendChild(groupSection);
                }
                return;
            }

            // 1. 默认里程碑（未分组）
            const defaultGroupKey = 'global';
            const defaultIsCollapsed = this.collapsedMilestoneGroups.has(defaultGroupKey);
            const defaultSection = this.createMilestoneSection(i18n('defaultMilestones'), null, defaultMilestones, container, defaultIsCollapsed, isGlobalMode);
            container.appendChild(defaultSection);

            // 2. 分组里程碑
            for (const group of projectGroups) {
                const groupKey = group.id;
                const isCollapsed = this.collapsedMilestoneGroups.has(groupKey);
                const groupSection = this.createMilestoneSection(group.name, group.id, group.milestones || [], container, isCollapsed, isGlobalMode);
                container.appendChild(groupSection);
            }
        } catch (error) {
            console.error(i18n('renderMilestonesFailed'), error);
            container.innerHTML = `<div style="color: var(--b3-theme-error); text-align: center;">${i18n('loadFailed')}</div>`;
        }
    }

    private createMilestoneSection(title: string, groupId: string | null, milestones: any[], parentContainer: HTMLElement, isCollapsed: boolean, isGlobalMode: boolean = false): HTMLElement {
        const groupKey = groupId || 'global';
        const section = document.createElement('div');
        section.className = 'milestone-section';
        section.style.cssText = `
            margin-bottom: 24px;
            border: 1px solid var(--b3-theme-border);
            border-radius: 8px;
        `;

        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 16px;
            background: var(--b3-theme-surface-lighter);
            border-bottom: 1px solid var(--b3-theme-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 10;
        `;

        const titleEl = document.createElement('h4');
        titleEl.textContent = title;
        titleEl.style.margin = '0';
        header.appendChild(titleEl);

        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'b3-button b3-button--small';
        toggleBtn.innerHTML = isCollapsed ? '▶' : '▼';
        toggleBtn.style.marginRight = '8px';
        toggleBtn.addEventListener('click', () => {
            if (this.collapsedMilestoneGroups.has(groupKey)) {
                this.collapsedMilestoneGroups.delete(groupKey);
                list.style.display = 'block';
                toggleBtn.innerHTML = '▼';
            } else {
                this.collapsedMilestoneGroups.add(groupKey);
                list.style.display = 'none';
                toggleBtn.innerHTML = '▶';
            }
        });
        header.insertBefore(toggleBtn, titleEl);

        const addBtn = document.createElement('button');
        addBtn.className = 'b3-button b3-button--small b3-button--primary';
        addBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newMilestone')}`;
        addBtn.addEventListener('click', () => {
            // 全局模式下刷新所有里程碑，分组模式下只刷新该分组
            const refreshCallback = () => this.renderMilestonesInDialog(parentContainer, isGlobalMode ? undefined : groupId);
            this.showMilestoneEditDialog(null, groupId, refreshCallback, milestones);
        });
        header.appendChild(addBtn);

        section.appendChild(header);

        const list = document.createElement('div');
        list.style.padding = '8px 16px';
        list.className = 'milestone-list';
        list.style.display = isCollapsed ? 'none' : 'block';

        // 拖拽占位符
        const placeholder = document.createElement('div');
        placeholder.style.cssText = `
            height: 2px;
            background: var(--b3-theme-primary);
            margin: 4px 0;
            display: none;
        `;
        list.appendChild(placeholder);

        let draggedMilestoneId: string | null = null;

        if (milestones.length === 0) {
            list.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6;">${i18n('noMilestones')}</div>`;
        } else {
            milestones.sort((a, b) => (a.sort || 0) - (b.sort || 0)).forEach(ms => {
                const item = document.createElement('div');
                item.className = 'milestone-item';
                item.dataset.msId = ms.id;
                item.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 12px;
                    border-bottom: 1px solid var(--b3-theme-border);
                    transition: all 0.2s ease;
                    background: var(--b3-theme-surface);
                    margin: 2px 0;
                    border-radius: 4px;
                `;
                if (milestones.indexOf(ms) === milestones.length - 1) {
                    item.style.borderBottom = 'none';
                }

                const info = document.createElement('div');
                info.style.cssText = `display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;`;

                const icon = document.createElement('span');
                icon.textContent = ms.icon || '🚩';
                info.appendChild(icon);

                const name = document.createElement('span');
                name.textContent = ms.name;
                name.style.cssText = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500;`;
                if (ms.blockId) {
                    name.style.textDecoration = 'underline dotted';
                    name.style.color = 'var(--b3-theme-primary)';
                    name.style.cursor = 'pointer';
                    name.setAttribute('data-type', 'a');
                    name.setAttribute('data-href', `siyuan://blocks/${ms.blockId}`);
                    name.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openBlock(ms.blockId);
                    });
                }
                if (ms.archived) {
                    name.style.textDecoration = (name.style.textDecoration ? name.style.textDecoration + ' ' : '') + 'line-through';
                    name.style.opacity = '0.6';
                }
                info.appendChild(name);

                // 显示起止时间
                if (ms.startTime || ms.endTime) {
                    const timeRange = document.createElement('span');
                    timeRange.style.cssText = `font-size: 11px; color: var(--b3-theme-on-surface); opacity: 0.6; margin-left: 8px; flex-shrink: 0;`;
                    const startDisp = ms.startTime || '?';
                    const endDisp = ms.endTime || '?';
                    timeRange.textContent = `${startDisp} ~ ${endDisp}`;
                    info.appendChild(timeRange);
                }

                if (ms.archived) {
                    const archivedTag = document.createElement('span');
                    archivedTag.textContent = i18n('milestoneArchived');
                    archivedTag.style.cssText = `font-size: 11px; padding: 1px 4px; background: var(--b3-theme-surface); border-radius: 4px; opacity: 0.7;`;
                    info.appendChild(archivedTag);
                }

                item.appendChild(info);

                const actions = document.createElement('div');
                actions.style.cssText = `display: flex; gap: 8px;`;

                const viewTasksBtn = document.createElement('button');
                viewTasksBtn.className = 'b3-button b3-button--text';
                viewTasksBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg>';
                viewTasksBtn.title = i18n('viewTasks');
                viewTasksBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showMilestoneTasksDialog(ms, groupId);
                });
                actions.appendChild(viewTasksBtn);

                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--text';
                editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    // 全局模式下刷新所有里程碑，分组模式下只刷新该分组
                    const refreshCallback = () => this.renderMilestonesInDialog(parentContainer, isGlobalMode ? undefined : groupId);
                    this.showMilestoneEditDialog(ms, groupId, refreshCallback, milestones);
                });
                actions.appendChild(editBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'b3-button b3-button--text';
                deleteBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>';
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    confirm(
                        i18n('delete'),
                        i18n('confirmDeleteMilestone').replace('${name}', ms.name),
                        async () => {
                            await this.deleteMilestone(ms.id, groupId);
                            // 全局模式下刷新所有里程碑，分组模式下只刷新该分组
                            this.renderMilestonesInDialog(parentContainer, isGlobalMode ? undefined : groupId);
                        },
                        () => {
                        }
                    );
                });
                actions.appendChild(deleteBtn);

                item.appendChild(actions);

                // --- 拖拽事件 ---
                item.draggable = true;
                item.style.cursor = 'grab';

                item.addEventListener('dragstart', (ev) => {
                    draggedMilestoneId = ms.id;
                    item.style.opacity = '0.5';
                    if (ev.dataTransfer) {
                        ev.dataTransfer.setData('text/plain', ms.id);
                        ev.dataTransfer.effectAllowed = 'move';
                    }
                });

                item.addEventListener('dragend', () => {
                    draggedMilestoneId = null;
                    item.style.opacity = '1';
                    placeholder.style.display = 'none';
                });

                list.appendChild(item);
            });

            // 列表级别的拖拽处理
            list.addEventListener('dragover', (ev) => {
                ev.preventDefault();
                if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';

                const items = Array.from(list.querySelectorAll('.milestone-item')) as HTMLElement[];

                if (items.length === 0) {
                    list.appendChild(placeholder);
                    placeholder.style.display = 'block';
                    return;
                }

                let inserted = false;
                for (const el of items) {
                    if (el.dataset.msId === draggedMilestoneId) continue;
                    const rect = el.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (ev.clientY < midY) {
                        list.insertBefore(placeholder, el);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) {
                    list.appendChild(placeholder);
                }
                placeholder.style.display = 'block';
            });

            list.addEventListener('drop', async (ev) => {
                ev.preventDefault();
                placeholder.style.display = 'none';
                const id = ev.dataTransfer?.getData('text/plain');
                if (!id) return;

                // 找到被拖拽的里程碑对象
                const movedMs = milestones.find(m => m.id === id);
                if (!movedMs) return;

                // 移除原有的，重新按照 DOM 顺序排列
                const otherMs = milestones.filter(m => m.id !== id);

                // 计算插入点：找到 placeholder 后面的那个 milestone-item，在它前面插入
                let insertPoint = otherMs.length; // 默认放到最后
                const children = Array.from(list.children);
                const placeholderIndex = children.indexOf(placeholder);

                // 从 placeholder 后面开始找，找到第一个 milestone-item
                for (let i = placeholderIndex + 1; i < children.length; i++) {
                    const el = children[i] as HTMLElement;
                    if (el.classList.contains('milestone-item')) {
                        // 找到了 placeholder 后面的 milestone，获取它在 otherMs 中的索引
                        const nextId = el.dataset.msId;
                        const nextIndex = otherMs.findIndex(m => m.id === nextId);
                        if (nextIndex !== -1) {
                            insertPoint = nextIndex;
                        }
                        break;
                    }
                }

                otherMs.splice(insertPoint, 0, movedMs);

                // 更新 sort 值
                otherMs.forEach((m, idx) => {
                    m.sort = idx * 100;
                });

                // 保存
                if (groupId === null) {
                    const projectData = await this.plugin.loadProjectData() || {};
                    const project = projectData[this.projectId];
                    if (project) {
                        project.milestones = otherMs;
                        await this.plugin.saveProjectData(projectData);
                    }
                } else {
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const groups = await projectManager.getProjectCustomGroups(this.projectId);
                    const group = groups.find((g: any) => g.id === groupId);
                    if (group) {
                        group.milestones = otherMs;
                        await projectManager.setProjectCustomGroups(this.projectId, groups);
                    }
                }

                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                this.renderMilestonesInDialog(parentContainer, groupId);
            });
        }

        section.appendChild(list);
        return section;
    }

    /**
     * 显示里程碑关联的任务列表对话框
     */
    public async showMilestoneTasksDialog(milestone: any, groupId: string | null) {
        const dialog = new Dialog({
            title: `${milestone.name}${milestone.startTime || milestone.endTime ? ` (${milestone.startTime || '?'} ~ ${milestone.endTime || '?'})` : ''} - ${i18n('tasks')}`,
            content: `<div class="b3-dialog__content" style="padding: 0; display: flex; flex-direction: column; height: 100%;"></div>`,
            width: "600px",
            height: "70vh"
        });

        const content = dialog.element.querySelector('.b3-dialog__content') as HTMLElement;

        // 渲染任务列表
        await this.renderMilestoneTaskTree(content, milestone, groupId, dialog);
    }


    private async renderMilestoneTaskTree(container: HTMLElement, milestone: any, groupId: string | null, dialog: Dialog) {
        container.innerHTML = '';

        // 获取最新的任务数据
        const reminderData = await this.getReminders();

        // 筛选当前项目的任务
        const projectTasks = Object.values(reminderData).filter((reminder: any) =>
            reminder && reminder.projectId === this.projectId
        );

        const taskMap = new Map(projectTasks.map((t: any) => [t.id, t]));

        // 筛选属于该里程碑的任务
        const relevantTasks = projectTasks.filter((t: any) => {
            // 检查分组归属
            if (groupId && groupId !== 'ungrouped') {
                const taskGroupId = t.customGroupId || 'ungrouped';
                if (groupId !== taskGroupId) {
                    // 如果任务明确属于其他分组，则排除
                    return false;
                }
            }

            // 获取任务的有效里程碑（考虑继承父任务）
            let effectiveMilestoneId = t.milestoneId;
            if (!effectiveMilestoneId && t.parentId) {
                const parent = taskMap.get(t.parentId);
                if (parent) effectiveMilestoneId = parent.milestoneId;
            }

            return effectiveMilestoneId === milestone.id;
        });

        if (relevantTasks.length === 0) {
            container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--b3-theme-on-surface-light);">${i18n('noTasksInMilestone')}</div>`;
            return;
        }

        const list = document.createElement('div');
        list.style.cssText = 'overflow-y: auto; flex: 1; padding: 0;';

        // 构建层级关系
        // 2. 区分根任务和子任务 (在 relevantTasks 范围内)
        const relevantIds = new Set(relevantTasks.map(t => t.id));
        const rootTasks: any[] = [];
        const childMap = new Map<string, any[]>();

        relevantTasks.forEach(task => {
            // 如果父任务也在过滤结果中，则将其视为子任务；否则视为该视图下的根任务
            if (task.parentId && relevantIds.has(task.parentId)) {
                if (!childMap.has(task.parentId)) {
                    childMap.set(task.parentId, []);
                }
                childMap.get(task.parentId)!.push(task);
            } else {
                rootTasks.push(task);
            }
        });

        // 创建按钮容器
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin: 8px 16px;
            align-items: center;
        `;

        // 添加复制为 Markdown 按钮
        const copyBtn = document.createElement('button');
        copyBtn.className = 'b3-button b3-button--text';
        copyBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCopy"></use></svg> ${i18n('copyAsMarkdown')}`;
        copyBtn.style.cssText = `
            padding: 4px 12px;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            display: flex;
            align-items: center;
            gap: 4px;
        `;
        copyBtn.addEventListener('click', async () => {
            // 生成 Markdown 列表
            const generateMarkdown = (tasks: any[], level: number = 0): string => {
                const indent = '  '.repeat(level);
                return tasks.map(task => {
                    const checkbox = task.completed ? '[x]' : '[ ]';
                    const priorityMap: Record<string, string> = {
                        'high': ' 🔴',
                        'medium': '🟡',
                        'low': ' 🔵'
                    };
                    const priorityLabel = task.priority && task.priority !== 'none' ? priorityMap[task.priority] || '' : '';
                    const dateStr = task.date ? ` (${task.date})` : '';
                    let line = `${indent}- ${checkbox} ${task.title}${priorityLabel}${dateStr}`;

                    // 递归添加子任务
                    const children = childMap.get(task.id);
                    if (children && children.length > 0) {
                        // 对子任务也进行排序
                        const unfinishedChildren = children.filter((t: any) => !t.completed).sort((a: any, b: any) => this.compareByPriority(a, b));
                        const finishedChildren = children.filter((t: any) => t.completed).sort((a: any, b: any) => (b.completedTime || '').localeCompare(a.completedTime || ''));
                        const sortedChildren = [...unfinishedChildren, ...finishedChildren];
                        line += '\n' + generateMarkdown(sortedChildren, level + 1);
                    }
                    return line;
                }).join('\n');
            };

            // 对根任务排序
            const unfinishedRoot = rootTasks.filter(t => !t.completed).sort((a, b) => this.compareByPriority(a, b));
            const finishedRoot = rootTasks.filter(t => t.completed).sort((a, b) => (b.completedTime || '').localeCompare(a.completedTime || ''));
            const sortedRootTasks = [...unfinishedRoot, ...finishedRoot];

            const markdown = generateMarkdown(sortedRootTasks);

            try {
                await navigator.clipboard.writeText(markdown);
                showMessage(i18n('copiedToClipboard'));
            } catch (err) {
                console.error(i18n('copyFailed'), err);
                showMessage(i18n('copyFailed'));
            }
        });

        // 添加编辑里程碑按钮
        const editBtn = document.createElement('button');
        editBtn.className = 'b3-button b3-button--text';
        editBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg> ${i18n('editMilestone')}`;
        editBtn.style.cssText = `
            padding: 4px 12px;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            display: flex;
            align-items: center;
            gap: 4px;
        `;
        editBtn.addEventListener('click', async () => {
            // 关闭当前对话框
            dialog.destroy();

            // 打开编辑里程碑对话框
            await this.showMilestoneEditDialog(milestone, groupId, async () => {
                // 保存后刷新看板
                await this.loadTasks();
                this.render();
            });
        });

        buttonContainer.appendChild(copyBtn);
        buttonContainer.appendChild(editBtn);
        list.appendChild(buttonContainer);

        // 递归渲染函数
        const renderTaskTree = (tasks: any[], parentEl: HTMLElement, level: number) => {
            // 排序：未完成在前，然后按优先级，最后按时间
            const unfinished = tasks.filter(t => !t.completed).sort((a, b) => this.compareByPriority(a, b));
            const finished = tasks.filter(t => t.completed).sort((a, b) => (b.completedTime || '').localeCompare(a.completedTime || ''));
            const sortedTasks = [...unfinished, ...finished];

            sortedTasks.forEach(task => {
                const priority = task.priority || 'none';

                // 设置任务颜色（根据优先级）
                let backgroundColor = '';
                let borderColor = '';
                switch (priority) {
                    case 'high':
                        backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                        borderColor = 'var(--b3-card-error-color)';
                        break;
                    case 'medium':
                        backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                        borderColor = 'var(--b3-card-warning-color)';
                        break;
                    case 'low':
                        backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                        borderColor = 'var(--b3-card-info-color)';
                        break;
                    default:
                        backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                        borderColor = 'var(--b3-theme-background-light)';
                }

                // 任务卡片容器 - 与看板任务卡片一致
                const taskEl = document.createElement('div');
                taskEl.className = 'kanban-task milestone-task-card';
                if (priority !== 'none') {
                    taskEl.classList.add(`kanban-task-priority-${priority}`);
                }
                taskEl.style.cssText = `
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                    background-color: ${backgroundColor};
                    border: 1.5px solid ${borderColor};
                    margin-bottom: 8px;
                    margin-left: ${level * 20}px;
                    border-radius: 4px;
                    padding: 8px;
                    margin: 1px 5px;
                `;

                taskEl.addEventListener('mouseenter', () => {
                    taskEl.style.transform = 'translateY(-2px)';
                    taskEl.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                });
                taskEl.addEventListener('mouseleave', () => {
                    taskEl.style.transform = '';
                    taskEl.style.boxShadow = '';
                });

                // 主容器
                const taskMainContainer = document.createElement('div');
                taskMainContainer.className = 'kanban-task-main';
                taskMainContainer.style.cssText = `
                    display: flex;
                    gap: 8px;
                    align-items: flex-start;
                    padding: 1px;
                `;

                // 复选框
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'kanban-task-checkbox';
                checkbox.checked = task.completed;
                checkbox.style.marginTop = '2px';
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                });

                checkbox.addEventListener('change', async (e) => {
                    e.stopPropagation();
                    const isChecked = checkbox.checked;
                    try {
                        const reminderData = await this.getReminders();
                        if (reminderData[task.id]) {
                            const t = reminderData[task.id];
                            if (isChecked) {
                                t.completed = true;
                                t.completedTime = getLocalDateTimeString(new Date());
                                t.kanbanStatus = 'completed';
                            } else {
                                t.completed = false;
                                delete t.completedTime;
                                t.kanbanStatus = 'doing';
                            }
                            await saveReminders(this.plugin, reminderData);
                            this.dispatchReminderUpdate(true);
                            updateItemStyle(isChecked);
                            this.queueLoadTasks();
                        }
                    } catch (err) {
                        console.error(i18n('updateTaskStatusFailed'), err);
                        checkbox.checked = !isChecked;
                    }
                });
                taskMainContainer.appendChild(checkbox);

                // 内容容器
                const taskContentContainer = document.createElement('div');
                taskContentContainer.className = 'kanban-task-content';
                taskContentContainer.style.flex = '1';
                taskContentContainer.style.overflow = 'hidden';

                // 标题容器
                const titleContainer = document.createElement('div');
                titleContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 8px;';

                // 任务标题
                const titleEl = document.createElement('div');
                titleEl.className = 'kanban-task-title';

                if (task.blockId || task.docId) {
                    const targetId = task.blockId || task.docId;
                    titleEl.setAttribute('data-type', 'a');
                    titleEl.setAttribute('data-href', `siyuan://blocks/${targetId}`);
                    titleEl.style.cssText = `
                        font-weight: 500;
                        color: var(--b3-theme-primary);
                        line-height: 1.4;
                        cursor: pointer;
                        text-decoration: underline dotted;
                        text-decoration-style: dotted;
                        transition: color 0.2s ease;
                        width: fit-content;
                    `;
                    titleEl.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openBlock(targetId);
                    });
                } else {
                    titleEl.style.cssText = `
                        font-weight: 500;
                        color: var(--b3-theme-on-surface);
                        line-height: 1.4;
                        width: fit-content;
                    `;
                }

                titleEl.textContent = task.title || i18n('noContentHint');
                titleEl.title = (task.blockId || task.docId) ? i18n('clickToOpenBoundBlock', { title: task.title || i18n('noContentHint') }) : (task.title || i18n('noContentHint'));

                // 子任务数量
                const children = childMap.get(task.id);
                if (children && children.length > 0) {
                    const subtaskIndicator = document.createElement('span');
                    subtaskIndicator.className = 'subtask-indicator';
                    subtaskIndicator.textContent = ` (${children.length})`;
                    subtaskIndicator.title = i18n('containsNSubtasks', { count: String(children.length) });
                    subtaskIndicator.style.cssText = `
                        font-size: 12px;
                        color: var(--b3-theme-on-surface);
                        opacity: 0.7;
                    `;
                    titleEl.appendChild(subtaskIndicator);
                }

                titleContainer.appendChild(titleEl);
                taskContentContainer.appendChild(titleContainer);

                // 任务信息容器 - 包含优先级、日期等
                const infoEl = document.createElement('div');
                infoEl.className = 'kanban-task-info';
                infoEl.style.cssText = `
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                `;

                // 日期时间
                if (task.date || task.endDate) {
                    const dateEl = document.createElement('div');
                    dateEl.className = 'kanban-task-date';
                    dateEl.style.cssText = `
                        font-size: 12px;
                        color: var(--b3-theme-on-surface);
                        opacity: 0.7;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        flex-wrap: wrap;
                    `;

                    if (task.repeat?.enabled || task.isRepeatInstance) {
                        const repeatIcon = document.createElement('span');
                        repeatIcon.textContent = '🔄';
                        repeatIcon.title = task.repeat?.enabled ? getRepeatDescription(task.repeat) : '周期事件实例';
                        repeatIcon.style.cssText = 'cursor: help;';
                        dateEl.appendChild(repeatIcon);
                    }

                    const dateText = this.formatTaskDate(task);
                    let dateHtml = `<span>📅${dateText}</span>`;

                    if (!task.completed) {
                        const countdownInfo = this.getTaskCountdownInfo(task);
                        if (countdownInfo.type !== 'none' && countdownInfo.days >= 0) {
                            let urgencyClass = 'countdown-normal';
                            if (countdownInfo.days <= 1) {
                                urgencyClass = 'countdown-urgent';
                            } else if (countdownInfo.days <= 3) {
                                urgencyClass = 'countdown-warning';
                            }
                            dateHtml += `<span class="countdown-badge ${urgencyClass}">${countdownInfo.text}</span>`;
                        }
                    }

                    dateEl.innerHTML += dateHtml;
                    infoEl.appendChild(dateEl);
                }

                // 优先级
                if (priority !== 'none') {
                    const priorityEl = document.createElement('div');
                    priorityEl.className = `kanban-task-priority priority-label-${priority}`;

                    const priorityNames: Record<string, string> = {
                        'high': i18n('priorityHigh'),
                        'medium': i18n('priorityMedium'),
                        'low': i18n('priorityLow')
                    };

                    priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
                    infoEl.appendChild(priorityEl);
                }

                // 完成时间
                if (task.completed && task.completedTime) {
                    const completedTimeEl = document.createElement('div');
                    completedTimeEl.className = 'kanban-task-completed-time';
                    completedTimeEl.innerHTML = `<span>✅</span><span>${i18n('completedAtLabel')}${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
                    completedTimeEl.style.cssText = `
                        font-size: 12px;
                        color: var(--b3-theme-on-surface);
                        opacity: 0.7;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    `;
                    infoEl.appendChild(completedTimeEl);
                }

                // 显示未来的提醒时间
                if (!task.completed) {
                    const today = getLogicalDateString();
                    const futureReminderTimes: string[] = [];

                    // 处理 reminderTimes 数组（新格式）
                    if (task.reminderTimes && Array.isArray(task.reminderTimes)) {
                        task.reminderTimes.forEach((item: any) => {
                            const timeStr = typeof item === 'string' ? item : item?.time;
                            if (timeStr) {
                                const reminderDate = this.parseReminderDate(timeStr, task.date);
                                if (reminderDate && compareDateStrings(reminderDate, today) >= 0) {
                                    futureReminderTimes.push(timeStr);
                                }
                            }
                        });
                    }
                    // 处理 customReminderTime（旧格式向后兼容）
                    else if (task.customReminderTime) {
                        const reminderDate = this.parseReminderDate(task.customReminderTime, task.date);
                        if (reminderDate && compareDateStrings(reminderDate, today) >= 0) {
                            futureReminderTimes.push(task.customReminderTime);
                        }
                    }

                    // 显示未来提醒时间
                    if (futureReminderTimes.length > 0) {
                        const reminderEl = document.createElement('div');
                        reminderEl.className = 'kanban-task-reminder-times';
                        reminderEl.style.cssText = `
                            font-size: 12px;
                            color: var(--b3-theme-on-surface);
                            opacity: 0.7;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            flex-wrap: wrap;
                        `;
                        const timesText = futureReminderTimes.map(t => this.formatReminderTimeDisplay(t, task.date, today)).join(', ');
                        reminderEl.innerHTML = `<span>⏰${timesText}</span>`;
                        infoEl.appendChild(reminderEl);
                    }
                }

                if (infoEl.children.length > 0) {
                    taskContentContainer.appendChild(infoEl);
                }

                // 任务备注
                if (task.note) {
                    const noteEl = document.createElement('div');
                    noteEl.className = 'kanban-task-note';
                    noteEl.style.cssText = `
                        font-size: 12px;
                        color: var(--b3-theme-on-surface);
                        opacity: 0.8;
                        margin-top: 8px;
                        padding: 6px 8px;
                        background: var(--b3-theme-background);
                        border-radius: 4px;
                        border-left: 2px solid var(--b3-theme-primary-lighter);
                        line-height: 1.5;
                        max-height: 200px;
                        overflow-y: auto;
                    `;
                    noteEl.innerHTML = this.lute ? this.lute.Md2HTML(task.note) : task.note;
                    taskContentContainer.appendChild(noteEl);
                }

                taskMainContainer.appendChild(taskContentContainer);

                // 编辑按钮
                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--text';
                editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.title = i18n('edit');
                editBtn.style.cssText = `
                    color: var(--b3-theme-on-surface-light);
                    padding: 4px;
                    min-width: auto;
                    flex-shrink: 0;
                `;
                editBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    await this.editTask(task);
                    dialog.destroy();
                });
                taskMainContainer.appendChild(editBtn);

                taskEl.appendChild(taskMainContainer);
                // 优化完成任务的样式 - 定义在这里以便在checkbox事件中使用
                const updateItemStyle = (completed: boolean) => {
                    if (completed) {
                        titleEl.style.textDecoration = task.blockId ? 'line-through underline dotted ' : 'line-through';
                        titleEl.style.color = task.blockId ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface-light)';
                    } else {
                        titleEl.style.textDecoration = task.blockId ? 'underline dotted' : 'none';
                        titleEl.style.color = task.blockId ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)';
                    }
                };

                // 应用完成任务的样式
                updateItemStyle(task.completed);

                parentEl.appendChild(taskEl);

                // 递归渲染子任务
                if (children && children.length > 0) {
                    renderTaskTree(children, parentEl, level + 1);
                }
            });
        };

        renderTaskTree(rootTasks, list, 0);
        container.appendChild(list);
    }

    private showMilestoneEditDialog(milestone: any | null, groupId: string | null, onSave: () => void, currentMilestones?: any[]) {
        const isEdit = !!milestone;
        const dialog = new Dialog({
            title: isEdit ? i18n('editMilestone') : i18n('newMilestone'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('milestoneName')}</label>
                        <input type="text" id="msName" class="b3-text-field" value="${milestone?.name || ''}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('milestoneIcon')}</label>
                        <input type="text" id="msIcon" class="b3-text-field" value="${milestone?.icon || '🚩'}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('milestoneTimeRange')}</label>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="date" id="msStartTime" class="b3-text-field" value="${milestone?.startTime || ''}" style="flex: 1;">
                            <span style="opacity: 0.6;">~</span>
                            <input type="date" id="msEndTime" class="b3-text-field" value="${milestone?.endTime || ''}" style="flex: 1;">
                        </div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('milestoneBlockId')}</label>
                        <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                            <input type="text" id="msBlockId" class="b3-text-field" value="${milestone?.blockId || ''}" placeholder="." style="flex: 1;">
                            <button class="b3-button b3-button--outline" id="msBindBlockBtn" title="${i18n('bindBlock')}">
                                <svg class="b3-button__icon" style="width: 16px; height: 16px;"><use xlink:href="#iconAdd"></use></svg>
                            </button>
                        </div>
                    </div>
                    <div class="b3-form__group" style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="msArchived" ${milestone?.archived ? 'checked' : ''} class="b3-switch">
                        <label class="b3-form__label" style="margin: 0;">${i18n('milestoneArchived')}</label>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('milestoneNote')}</label>
                        <textarea id="msNote" class="b3-text-field" rows="4" placeholder="${i18n('milestoneNotePlaceholder') || ''}" style="width: 100%; resize: vertical;">${milestone?.note || ''}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="msCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="msSave">${i18n('save')}</button>
                </div>
            `,
            width: "400px"
        });

        const nameInput = dialog.element.querySelector('#msName') as HTMLInputElement;
        const iconInput = dialog.element.querySelector('#msIcon') as HTMLInputElement;
        const startTimeInput = dialog.element.querySelector('#msStartTime') as HTMLInputElement;
        const endTimeInput = dialog.element.querySelector('#msEndTime') as HTMLInputElement;
        const blockIdInput = dialog.element.querySelector('#msBlockId') as HTMLInputElement;
        const archivedInput = dialog.element.querySelector('#msArchived') as HTMLInputElement;
        const noteInput = dialog.element.querySelector('#msNote') as HTMLTextAreaElement;
        const saveBtn = dialog.element.querySelector('#msSave') as HTMLButtonElement;
        const cancelBtn = dialog.element.querySelector('#msCancel') as HTMLButtonElement;
        const bindBlockBtn = dialog.element.querySelector('#msBindBlockBtn') as HTMLButtonElement;

        // 绑定块按钮点击事件
        bindBlockBtn?.addEventListener('click', async () => {
            // 获取分组的绑定块ID（如果有）
            let defaultParentId: string | undefined;
            if (groupId) {
                const groups = await this.projectManager.getProjectCustomGroups(this.projectId);
                const group = groups.find((g: any) => g.id === groupId);
                if (group?.blockId) {
                    defaultParentId = group.blockId;
                }
            }

            const blockBindingDialog = new BlockBindingDialog(this.plugin, (blockId: string) => {
                blockIdInput.value = blockId;
            }, {
                title: i18n('bindMilestoneBlock'),
                defaultTab: 'heading',
                defaultParentId: defaultParentId || blockIdInput.value,
                defaultProjectId: this.projectId,
                defaultCustomGroupId: groupId,
                defaultTitle: nameInput.value,
                forMilestone: true,
            });
            blockBindingDialog.show();
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());
        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showMessage(i18n('pleaseEnterMilestoneName') || '请输入里程碑名称');
                return;
            }

            let sortValue = milestone?.sort;
            if (sortValue === undefined) {
                // 新建，放在最上面
                if (currentMilestones && currentMilestones.length > 0) {
                    const minSort = Math.min(...currentMilestones.map(m => m.sort || 0));
                    sortValue = minSort - 1000;
                } else {
                    sortValue = Date.now();
                }
            }

            const data = {
                id: milestone?.id || `ms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name,
                icon: iconInput.value.trim(),
                startTime: startTimeInput.value || undefined,
                endTime: endTimeInput.value || undefined,
                blockId: blockIdInput.value.trim(),
                archived: archivedInput.checked,
                note: noteInput.value.trim(),
                sort: sortValue
            };

            const oldBlockId = milestone?.blockId;
            await this.saveMilestone(data, groupId);

            // 更新块属性
            if (oldBlockId && oldBlockId !== data.blockId) {
                await this.updateMilestoneBlockAttrs(oldBlockId);
            }
            if (data.blockId) {
                await this.updateMilestoneBlockAttrs(data.blockId);
            }

            onSave();
            dialog.destroy();
            showMessage(i18n('milestoneSaved'));
        });
    }

    private async saveMilestone(milestone: any, groupId: string | null) {
        const projectManager = this.projectManager;
        if (groupId === null) {
            // 保存默认里程碑
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];
            if (project) {
                if (!project.milestones) project.milestones = [];
                const index = project.milestones.findIndex((m: any) => m.id === milestone.id);
                if (index !== -1) project.milestones[index] = milestone;
                else project.milestones.push(milestone);
                await this.plugin.saveProjectData(projectData);
            }
        } else {
            // 保存到指定分组
            const groups = await projectManager.getProjectCustomGroups(this.projectId);
            const group = groups.find((g: any) => g.id === groupId);
            if (group) {
                if (!group.milestones) group.milestones = [];
                const index = group.milestones.findIndex((m: any) => m.id === milestone.id);
                if (index !== -1) group.milestones[index] = milestone;
                else group.milestones.push(milestone);
                await projectManager.setProjectCustomGroups(this.projectId, groups);
            }
        }
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    private async deleteMilestone(milestoneId: string, groupId: string | null) {
        const projectManager = this.projectManager;

        // 记录被删除里程碑的 blockId，以便后续更新块属性
        let deletedBlockId: string | undefined;

        // 1. 从项目配置或分组配置中移除里程碑定义
        if (groupId === null) {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];
            if (project && project.milestones) {
                const milestone = project.milestones.find((m: any) => m.id === milestoneId);
                deletedBlockId = milestone?.blockId;
                project.milestones = project.milestones.filter((m: any) => m.id !== milestoneId);
                await this.plugin.saveProjectData(projectData);
            }
        } else {
            const groups = await projectManager.getProjectCustomGroups(this.projectId);
            const group = groups.find((g: any) => g.id === groupId);
            if (group && group.milestones) {
                const milestone = group.milestones.find((m: any) => m.id === milestoneId);
                deletedBlockId = milestone?.blockId;
                group.milestones = group.milestones.filter((m: any) => m.id !== milestoneId);
                await projectManager.setProjectCustomGroups(this.projectId, groups);
            }
        }

        // 2. 清理所有引用了该里程碑的任务（包括重复实例）
        try {
            const reminderData = await this.getReminders();
            let updatedCount = 0;
            const keys = Object.keys(reminderData);

            for (const key of keys) {
                const task = reminderData[key];
                if (!task) continue;

                let taskChanged = false;

                // 检查任务本身的 milestoneId
                if (task.milestoneId === milestoneId) {
                    delete task.milestoneId;
                    taskChanged = true;
                }

                // 检查重复实例的 milestoneId
                if (task.repeat && task.repeat.instanceModifications) {
                    const mods = task.repeat.instanceModifications;
                    for (const date in mods) {
                        if (mods[date] && mods[date].milestoneId === milestoneId) {
                            delete mods[date].milestoneId;
                            taskChanged = true;
                        }
                    }
                }

                if (taskChanged) {
                    updatedCount++;
                }
            }

            if (updatedCount > 0) {
                await saveReminders(this.plugin, reminderData);
                console.log(`Deleted milestone ${milestoneId} and updated ${updatedCount} related tasks.`);
            }
        } catch (err) {
            console.error('Failed to cleanup tasks for deleted milestone:', err);
        }

        // 3. 更新被删除里程碑绑定的块属性
        if (deletedBlockId) {
            await this.updateMilestoneBlockAttrs(deletedBlockId);
        }

        window.dispatchEvent(new CustomEvent('reminderUpdated'));
        showMessage(i18n('milestoneDeleted'));
    }

    private async updateMilestoneBlockAttrs(blockId: string) {
        if (!blockId) return;

        // 查找本项目中所有绑定到此 blockId 的里程碑
        const projectData = await this.plugin.loadProjectData() || {};
        const project = projectData[this.projectId];
        const groups = await this.projectManager.getProjectCustomGroups(this.projectId);

        const milestoneIds: string[] = [];

        // 来自项目里程碑
        (project?.milestones || []).forEach((m: any) => {
            if (m.blockId === blockId) milestoneIds.push(m.id);
        });

        // 来自分组里程碑
        groups.forEach((g: any) => {
            (g.milestones || []).forEach((m: any) => {
                if (m.blockId === blockId) milestoneIds.push(m.id);
            });
        });

        const { updateMilestoneBindBlockAttrs } = await import('../api');
        await updateMilestoneBindBlockAttrs(blockId, this.projectId, milestoneIds);
    }

    private async setTaskMilestone(task: any, milestoneId: string | null) {
        try {
            const reminderData = await this.getReminders();

            // 如果是重复实例，修改实例的里程碑
            if (task.isRepeatInstance && task.originalId) {
                const originalReminder = reminderData[task.originalId];
                if (originalReminder) {
                    const instMod = this.ensureInstanceModificationStructure(originalReminder, task.date);

                    if (milestoneId) {
                        instMod.milestoneId = milestoneId;
                    } else {
                        delete instMod.milestoneId;
                    }

                    await saveReminders(this.plugin, reminderData);

                    // 乐观更新
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) {
                        if (milestoneId) localTask.milestoneId = milestoneId;
                        else delete localTask.milestoneId;
                    }

                    this.queueLoadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    showMessage(i18n('milestoneSaved'));
                }
            } else if (reminderData[task.id]) {
                // 普通任务或原始周期事件
                if (milestoneId) {
                    reminderData[task.id].milestoneId = milestoneId;
                } else {
                    delete reminderData[task.id].milestoneId;
                }

                await saveReminders(this.plugin, reminderData);

                // 乐观更新
                const localTask = this.tasks.find(t => t.id === task.id);
                if (localTask) {
                    if (milestoneId) localTask.milestoneId = milestoneId;
                    else delete localTask.milestoneId;
                }

                this.queueLoadTasks();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                showMessage(i18n('milestoneSaved'));
            }
        } catch (error) {
            console.error(i18n('setTaskMilestoneFailed'), error);
            showMessage(i18n('updateTaskFailed'));
        }
    }

    private async buildMilestoneMap() {
        this.milestoneMap.clear();
        try {
            const projectManager = this.projectManager;
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];

            // 1. 默认里程碑
            (project?.milestones || []).forEach((ms: any) => {
                this.milestoneMap.set(ms.id, { name: ms.name, icon: ms.icon, blockId: ms.blockId, startTime: ms.startTime, endTime: ms.endTime, archived: ms.archived });
            });

            // 2. 分组里程碑
            projectGroups.forEach((group: any) => {
                (group.milestones || []).forEach((ms: any) => {
                    this.milestoneMap.set(ms.id, { name: ms.name, icon: ms.icon, blockId: ms.blockId, startTime: ms.startTime, endTime: ms.endTime, archived: ms.archived });
                });
            });
        } catch (error) {
            console.error(i18n('buildMilestoneMapFailed'), error);
        }
    }

    private async loadAndDisplayGroups(container: HTMLElement) {
        try {
            const projectManager = this.projectManager;
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

            container.innerHTML = '';

            if (projectGroups.length === 0) {
                container.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${i18n('noCustomGroups')}</div>`;
                return;
            }

            // 排序分组：先按归档状态（未归档在前），再按sort字段
            const sortedGroups = projectGroups.sort((a: any, b: any) => {
                // 首先按归档状态排序：未归档的在前，已归档的在后
                const archivedA = a.archived ? 1 : 0;
                const archivedB = b.archived ? 1 : 0;
                if (archivedA !== archivedB) {
                    return archivedA - archivedB;
                }
                // 然后按sort字段排序（确保按数值排序，防止字符串比较）
                const sortA = typeof a.sort === 'number' ? a.sort : parseInt(a.sort, 10) || 0;
                const sortB = typeof b.sort === 'number' ? b.sort : parseInt(b.sort, 10) || 0;
                return sortA - sortB;
            });

            // 添加拖拽排序样式
            container.style.cssText += `
                position: relative;
            `;

            sortedGroups.forEach((group: any) => {
                const groupItem = document.createElement('div');
                groupItem.className = 'group-item';
                // 标记 DOM 节点以便拖拽时可以识别并忽略自身
                groupItem.dataset.groupId = group.id;
                groupItem.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface-lighter);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 8px;
                    transition: background-color 0.2s ease;
                    cursor: move;
                    min-height: 48px;
                `;

                const groupInfo = document.createElement('div');
                groupInfo.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 0;
                `;

                // 拖拽手柄
                const dragHandle = document.createElement('span');
                dragHandle.className = 'group-drag-handle';
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.style.cssText = `
                    font-size: 14px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.6;
                    cursor: move;
                    padding: 4px 6px;
                    margin-right: 8px;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                    user-select: none;
                `;
                dragHandle.title = i18n('dragToSort');

                // 添加悬停效果
                dragHandle.draggable = true;
                dragHandle.addEventListener('mouseenter', () => {
                    dragHandle.style.backgroundColor = 'var(--b3-theme-surface)';
                    dragHandle.style.opacity = '0.8';
                });

                dragHandle.addEventListener('mouseleave', () => {
                    dragHandle.style.backgroundColor = 'transparent';
                    dragHandle.style.opacity = '0.6';
                });

                // 在手柄上也绑定 dragstart/dragend，保证拖拽手柄触发拖拽行为
                dragHandle.addEventListener('dragstart', (e) => {
                    // 设置全局 draggedGroupId 并修改父项样式以反映拖拽
                    this.draggedGroupId = group.id;
                    groupItem.style.opacity = '0.5';
                    groupItem.style.cursor = 'grabbing';
                    if (e.dataTransfer) {
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id); } catch (err) { }
                    }
                });

                dragHandle.addEventListener('dragend', () => {
                    this.draggedGroupId = null;
                    groupItem.style.opacity = '';
                    groupItem.style.cursor = 'move';
                    container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());
                });

                const groupIcon = document.createElement('span');
                groupIcon.textContent = group.icon || '📋';
                groupIcon.style.cssText = `
                    font-size: 18px;
                    flex-shrink: 0;
                `;

                const groupName = document.createElement('span');
                groupName.textContent = group.name;
                // 如果分组绑定了块，添加链接属性和样式
                const hasBlockId = !!group.blockId;
                groupName.style.cssText = `
                    font-weight: 500;
                    color: ${hasBlockId ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)'};
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                    ${hasBlockId ? 'cursor: pointer; text-decoration: underline dotted;' : ''}
                    ${group.archived ? 'text-decoration: line-through; opacity: 0.6;' : ''}
                `;
                if (hasBlockId) {
                    groupName.dataset.type = 'a';
                    groupName.dataset.href = `siyuan://blocks/${group.blockId}`;
                    groupName.title = `${group.name} (点击打开绑定块)`;
                } else {
                    groupName.title = group.name;
                }

                // 归档标签
                if (group.archived) {
                    const archivedTag = document.createElement('span');
                    archivedTag.textContent = i18n('archived') || '已归档';
                    archivedTag.style.cssText = `
                        font-size: 11px;
                        padding: 1px 6px;
                        background: var(--b3-theme-surface);
                        border-radius: 4px;
                        opacity: 0.7;
                        flex-shrink: 0;
                        margin-right: 8px;
                    `;
                    groupInfo.appendChild(archivedTag);
                }

                const groupColor = document.createElement('div');
                groupColor.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background-color: ${group.color};
                    border: 2px solid var(--b3-theme-surface);
                    box-shadow: 0 0 0 1px var(--b3-theme-border);
                    flex-shrink: 0;
                `;

                groupInfo.appendChild(dragHandle);
                groupInfo.appendChild(groupIcon);
                groupInfo.appendChild(groupColor);
                groupInfo.appendChild(groupName);

                const groupActions = document.createElement('div');
                groupActions.style.cssText = `
                    display: flex;
                    gap: 8px;
                    align-items: center;
                `;

                // 归档/取消归档按钮
                const archiveBtn = document.createElement('button');
                archiveBtn.className = 'b3-button b3-button--small b3-button--outline';
                archiveBtn.innerHTML = group.archived
                    ? '<svg class="b3-button__icon"><use xlink:href="#iconUndo"></use></svg>'
                    : '<svg class="b3-button__icon"><use xlink:href="#iconLock"></use></svg>';
                archiveBtn.title = group.archived
                    ? (i18n('unarchiveGroup') || '取消归档')
                    : (i18n('archiveGroup') || '归档分组');
                archiveBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                archiveBtn.addEventListener('click', async () => {
                    try {
                        const projectManager = this.projectManager;
                        const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);
                        const groupIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                        if (groupIndex !== -1) {
                            currentGroups[groupIndex].archived = !group.archived;
                            await projectManager.setProjectCustomGroups(this.projectId, currentGroups);
                            await this.loadAndDisplayGroups(container);
                            this.queueLoadTasks();
                            showMessage(group.archived
                                ? (i18n('groupUnarchived') || '分组已取消归档')
                                : (i18n('groupArchived') || '分组已归档'));
                            // reminderUpdate更新其他组件
                            this.dispatchReminderUpdate();
                        }
                    } catch (error) {
                        console.error(i18n('archiveUnarchiveGroupFailed'), error);
                        showMessage(i18n('archiveUnarchiveGroupFailed'));
                    }
                });

                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--small b3-button--outline';
                editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.title = i18n('editGroup');
                editBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                editBtn.addEventListener('click', () => {
                    this.editGroup(group, groupItem, container);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'b3-button b3-button--outline';
                deleteBtn.innerHTML = '<svg class="b3-button__icon" style="color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
                deleteBtn.title = i18n('deleteGroup');
                deleteBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                deleteBtn.addEventListener('click', () => {
                    this.deleteGroup(group.id, groupItem, container);
                });

                groupActions.appendChild(archiveBtn);
                groupActions.appendChild(editBtn);
                groupActions.appendChild(deleteBtn);

                groupItem.appendChild(groupInfo);
                groupItem.appendChild(groupActions);

                container.appendChild(groupItem);

                // 添加悬停效果
                groupItem.addEventListener('mouseenter', () => {
                    groupItem.style.backgroundColor = 'var(--b3-theme-surface)';
                    groupItem.style.borderColor = 'var(--b3-theme-primary)';
                });

                groupItem.addEventListener('mouseleave', () => {
                    groupItem.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
                    groupItem.style.borderColor = 'var(--b3-theme-border)';
                });

                // 添加拖拽排序功能
                this.addGroupDragAndDrop(groupItem, group, container);
            });
        } catch (error) {
            console.error(i18n('loadGroupsFailed'), error);
            container.innerHTML = `<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">${i18n('loadGroupsFailed')}</div>`;
        }
    }

    private async editGroup(group: any, _groupItem: HTMLElement, container: HTMLElement) {
        const dialog = new Dialog({
            title: i18n('editGroup'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupName')}</label>
                        <input type="text" id="editGroupName" class="b3-text-field" value="${group.name}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('bindBlockId')} (${i18n('optional')})</label>
                        <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                            <input type="text" id="editGroupBlockId" class="b3-text-field" value="${group.blockId || ''}" placeholder="${i18n('pleaseEnterBlockId')}" style="flex: 1;">
                            <button class="b3-button b3-button--outline" id="editGroupBindBlockBtn" title="${i18n('bindBlock')}">
                                <svg class="b3-button__icon" style="width: 16px; height: 16px;"><use xlink:href="#iconAdd"></use></svg>
                            </button>
                        </div>
                        <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${i18n('bindBlockIdHint')}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('groupColor')}</label>
                        <input type="color" id="editGroupColor" class="b3-text-field" value="${group.color}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('iconOptional')}</label>
                        <input type="text" id="editGroupIcon" class="b3-text-field" value="${group.icon || ''}" placeholder="${i18n('emojiIconExample')}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group" style="display: flex; align-items: center; gap: 8px;">
                        <input type="checkbox" id="editGroupArchived" class="b3-switch" ${group.archived ? 'checked' : ''}>
                        <label class="b3-form__label" style="margin: 0;">${i18n('archived')}</label>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="editSaveBtn">${i18n('save')}</button>
                </div>
            `,
            width: "400px"
        });

        const editGroupName = dialog.element.querySelector('#editGroupName') as HTMLInputElement;
        const editGroupBlockId = dialog.element.querySelector('#editGroupBlockId') as HTMLInputElement;
        const editGroupColor = dialog.element.querySelector('#editGroupColor') as HTMLInputElement;
        const editGroupIcon = dialog.element.querySelector('#editGroupIcon') as HTMLInputElement;
        const editGroupArchived = dialog.element.querySelector('#editGroupArchived') as HTMLInputElement;
        const editCancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const editSaveBtn = dialog.element.querySelector('#editSaveBtn') as HTMLButtonElement;
        const editGroupBindBlockBtn = dialog.element.querySelector('#editGroupBindBlockBtn') as HTMLButtonElement;

        // 绑定块按钮点击事件
        editGroupBindBlockBtn?.addEventListener('click', () => {
            const blockBindingDialog = new BlockBindingDialog(this.plugin, (blockId: string) => {
                editGroupBlockId.value = blockId;
            }, {
                title: i18n('bindGroupBlock'),
                defaultTab: 'heading',
                defaultParentId: editGroupBlockId.value,
                defaultProjectId: this.projectId,
                defaultCustomGroupId: group.id,
                defaultTitle: editGroupName.value,
                forGroup: true,
            });
            blockBindingDialog.show();
        });

        editCancelBtn.addEventListener('click', () => dialog.destroy());

        editSaveBtn.addEventListener('click', async () => {
            const name = editGroupName.value.trim();
            const blockId = editGroupBlockId.value.trim();
            const color = editGroupColor.value;
            const icon = editGroupIcon.value.trim();
            const archived = editGroupArchived.checked;

            if (!name) {
                showMessage(i18n('pleaseEnterGroupName'));
                return;
            }

            try {
                // 获取当前项目的分组列表
                const projectManager = this.projectManager;
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                // 更新分组信息
                const groupIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                if (groupIndex !== -1) {
                    currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon, blockId: blockId || undefined, archived };
                    await projectManager.setProjectCustomGroups(this.projectId, currentGroups);
                }

                // 刷新分组列表（更新对话框中的列表）
                await this.loadAndDisplayGroups(container);

                // 如果分组被归档，需要刷新看板以隐藏该分组
                if (archived !== group.archived) {
                    await this.loadProject();
                    this.queueLoadTasks();
                    this.dispatchReminderUpdate();
                } else {
                    // 直接更新 Kanban DOM，避免重绘
                    const columnId = `custom-group-${group.id}`;
                    // kanban-column-{columnId} 是在 createCustomGroupColumn 中生成的
                    const column = this.container.querySelector(`.kanban-column.kanban-column-${columnId}`) as HTMLElement;

                    if (column) {
                        // 1. 更新列头背景
                        const header = column.querySelector('.kanban-column-header') as HTMLElement;
                        if (header) {
                            header.style.background = `${color}15`;
                        }

                        // 2. 更新列头标题区域（包含图标和标题）
                        // 这里的结构参考 createCustomGroupColumn 中的 titleContainer
                        // 需要找到 titleContainer，通常它是 header 的第一个子元素（包含 icon 和 h3）
                        const titleContainer = header.querySelector('div') as HTMLElement; // titleContainer 是 header 的第一个 div 子元素
                        if (titleContainer) {
                            titleContainer.innerHTML = '';

                            // 重建图标
                            const groupIconEl = document.createElement('span');
                            groupIconEl.className = 'custom-group-header-icon';
                            groupIconEl.style.cssText = `margin-right:6px;`;
                            groupIconEl.textContent = icon || '📋';
                            titleContainer.appendChild(groupIconEl);

                            // 重建标题
                            const titleEl = document.createElement('h3');
                            titleEl.textContent = name;
                            titleEl.style.cssText = `
                                margin: 0;
                                font-size: 16px;
                                font-weight: 600;
                                color: ${color};
                            `;

                            // 处理 Block ID 绑定
                            const newBlockId = blockId || undefined;
                            if (newBlockId) {
                                titleEl.dataset.type = 'a';
                                titleEl.dataset.href = `siyuan://blocks/${newBlockId}`;
                                titleEl.style.cursor = 'pointer';
                                titleEl.style.textDecoration = 'underline dotted';
                                titleEl.style.paddingBottom = '2px';
                                titleEl.title = i18n('clickToJumpToBlock');
                                titleEl.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    openBlock(newBlockId);
                                });
                            }

                            titleContainer.appendChild(titleEl);
                        }

                        // 3. 更新计数的背景色
                        const countEl = column.querySelector('.kanban-column-count') as HTMLElement;
                        if (countEl) {
                            countEl.style.background = color;
                        }

                        // 4. 更新子分组（进行中、短期、长期等）的样式
                        // 这些是在 renderCustomGroupColumnWithStatuses 中创建的
                        const subGroupHeaders = column.querySelectorAll('.custom-status-group-header') as NodeListOf<HTMLElement>;
                        subGroupHeaders.forEach(sh => {
                            sh.style.background = `${color}15`;
                            sh.style.border = `1px solid ${color}30`;
                        });
                    }
                }

                showMessage(i18n('groupUpdated'));
                dialog.destroy();
            } catch (error) {
                console.error(i18n('updateGroupFailed'), error);
                showMessage(i18n('updateGroupFailed'));
            }
        });
    }

    private async deleteGroup(groupId: string, _groupItem: HTMLElement, container: HTMLElement) {
        // 获取分组信息用于显示名称
        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
        const groupToDelete = projectGroups.find((g: any) => g.id === groupId);

        if (!groupToDelete) {
            showMessage(i18n('groupNotExist'));
            return;
        }

        // 获取其他可用的分组
        const otherGroups = projectGroups.filter((g: any) => g.id !== groupId);

        // 检查该分组下是否有任务
        const reminderData = await this.getReminders();
        const tasksInGroup = Object.values(reminderData).filter((task: any) =>
            task && task.projectId === this.projectId && task.customGroupId === groupId
        );

        const hasTasks = tasksInGroup.length > 0;

        let confirmMessage = i18n('confirmDeleteGroup', { name: groupToDelete.name });

        if (hasTasks) {
            confirmMessage += `\n\n${i18n('groupHasTasks', { count: String(tasksInGroup.length) })}`;
        }

        const dialog = new Dialog({
            title: i18n('deleteGroup'),
            content: `
                <div class="delete-group-dialog" style="padding: 16px;">
                    <div class="b3-dialog__content">
                        <p style="margin-bottom: 16px; white-space: pre-wrap;">${confirmMessage}</p>
                        ${hasTasks ? `
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n('taskAction')}</label>
                                <div class="b3-form__group" style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
                                    <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                        <input type="radio" name="taskAction" value="ungroup" checked class="b3-radio">
                                        <span>${i18n('setTasksUngrouped')}</span>
                                    </label>
                                    <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                        <input type="radio" name="taskAction" value="delete" class="b3-radio">
                                        <span>${i18n('deleteAllTasks')}</span>
                                    </label>
                                    ${otherGroups.length > 0 ? `
                                        <div style="display: flex; flex-direction: column; gap: 4px;">
                                            <label class="b3-label" style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                                <input type="radio" name="taskAction" value="move" class="b3-radio" id="moveActionRadio">
                                                <span>${i18n('moveTasksToOtherGroup')}</span>
                                            </label>
                                            <select id="targetGroupSelect" class="b3-select fn__flex-1" style="margin-left: 24px; visibility: hidden;">
                                                ${otherGroups.map((g: any) => `<option value="${g.id}">${g.name}</option>`).join('')}
                                            </select>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="b3-dialog__action" style="margin-top: 24px;">
                        <button class="b3-button b3-button--cancel" id="deleteCancelBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--error" id="deleteConfirmBtn">${i18n('deleteGroup')}</button>
                    </div>
                </div>
            `,
            width: "450px"
        });

        if (hasTasks && otherGroups.length > 0) {
            const moveRadio = dialog.element.querySelector('#moveActionRadio') as HTMLInputElement;
            const targetSelect = dialog.element.querySelector('#targetGroupSelect') as HTMLSelectElement;
            const radios = dialog.element.querySelectorAll('input[name="taskAction"]');

            radios.forEach(radio => {
                radio.addEventListener('change', () => {
                    targetSelect.style.visibility = moveRadio.checked ? 'visible' : 'hidden';
                });
            });
        }

        const deleteCancelBtn = dialog.element.querySelector('#deleteCancelBtn') as HTMLButtonElement;
        const deleteConfirmBtn = dialog.element.querySelector('#deleteConfirmBtn') as HTMLButtonElement;

        deleteCancelBtn.addEventListener('click', () => dialog.destroy());

        deleteConfirmBtn.addEventListener('click', async () => {
            try {
                let taskAction: 'ungroup' | 'delete' | 'move' = 'ungroup';
                let targetGroupId: string | null = null;

                if (hasTasks) {
                    const selectedAction = dialog.element.querySelector('input[name="taskAction"]:checked') as HTMLInputElement;
                    taskAction = selectedAction.value as 'ungroup' | 'delete' | 'move';
                    if (taskAction === 'move') {
                        const targetSelect = dialog.element.querySelector('#targetGroupSelect') as HTMLSelectElement;
                        targetGroupId = targetSelect.value;
                    }
                }

                // 从项目数据中移除分组
                const updatedGroups = projectGroups.filter((g: any) => g.id !== groupId);
                await projectManager.setProjectCustomGroups(this.projectId, updatedGroups);

                // 处理分组下的任务
                if (hasTasks) {
                    if (taskAction === 'delete') {
                        // 删除所有任务
                        for (const task of tasksInGroup) {
                            const taskData = task as any;
                            delete reminderData[taskData.id];
                        }
                        showMessage(i18n('groupDeletedWithTasks', { count: String(tasksInGroup.length) }));
                    } else if (taskAction === 'move' && targetGroupId) {
                        // 转移到其他分组
                        for (const task of tasksInGroup) {
                            const taskData = task as any;
                            taskData.customGroupId = targetGroupId;
                        }
                        showMessage(i18n('groupDeletedTasksMoved', { count: String(tasksInGroup.length) }));
                    } else {
                        // 默认为 ungroup (包括 move 到无效目标或 ungroup 选项)
                        // 将任务设为未分组
                        for (const task of tasksInGroup) {
                            const taskData = task as any;
                            delete taskData.customGroupId;
                        }
                        showMessage(i18n('groupDeletedTasksUngrouped', { count: String(tasksInGroup.length) }));
                    }

                    // 保存任务数据
                    await saveReminders(this.plugin, reminderData);
                    this.dispatchReminderUpdate(true);
                } else {
                    showMessage(i18n('groupDeleted'));
                }

                // 刷新分组列表
                await this.loadAndDisplayGroups(container);

                // 强制触发看板重绘
                this._lastRenderedProjectId = null;
                // 刷新看板（使用防抖队列）
                await this.loadProject();
                this.queueLoadTasks();

                dialog.destroy();
            } catch (error) {
                console.error(i18n('deleteGroupFailed'), error);
                showMessage(i18n('deleteGroupFailed'));
                dialog.destroy();
            }
        });
    }

    private initUI() {
        this.container.classList.add('project-kanban-view');
        this.container.innerHTML = '';

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'project-kanban-toolbar';
        this.container.appendChild(toolbar);

        // 项目标题
        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-kanban-title';

        const titleEl = document.createElement('h2');
        titleEl.textContent = this.project?.title || i18n('projectKanban');
        titleEl.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        `;

        // 如果项目有关联的笔记ID，添加点击跳转功能
        if (this.project?.blockId) {
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline dotted';
            titleEl.style.textDecorationStyle = 'dotted';
            titleEl.title = i18n('clickToJumpToProjectNote');
            titleEl.setAttribute('data-has-note', 'true');

            titleEl.addEventListener('click', () => {
                this.openProjectNote(this.project.blockId);
            });

        }

        titleContainer.appendChild(titleEl);

        // 项目描述
        if (this.project?.note) {
            const descEl = document.createElement('div');
            descEl.className = 'project-kanban-description';
            descEl.textContent = this.project.note;
            descEl.style.cssText = `
                margin-top: 4px;
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
            `;
            titleContainer.appendChild(descEl);
        }

        toolbar.appendChild(titleContainer);

        // 控制按钮组
        const controlsGroup = document.createElement('div');
        controlsGroup.className = 'project-kanban-controls';

        // 新建任务按钮
        const addTaskBtn = document.createElement('button');
        addTaskBtn.className = 'b3-button b3-button--primary';
        addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${i18n('newTask')}`;
        addTaskBtn.addEventListener('click', () => this.showCreateTaskDialog());
        controlsGroup.appendChild(addTaskBtn);

        const pasteTaskBtn = document.createElement('button');
        pasteTaskBtn.className = 'b3-button';
        pasteTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg> ${i18n('pasteNew')}`;
        pasteTaskBtn.addEventListener('click', () => this.showPasteTaskDialog(undefined, undefined, undefined, true));
        controlsGroup.appendChild(pasteTaskBtn);

        // 排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.addEventListener('click', (e) => this.showSortMenu(e));
        controlsGroup.appendChild(this.sortButton);

        // 筛选按钮
        this.filterButton = document.createElement('button');
        this.filterButton.className = 'b3-button b3-button--outline';
        this.filterButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconFilter"></use></svg>';
        this.filterButton.addEventListener('click', (e) => this.showFilterMenu(e));
        // 如果有激活的筛选，高亮按钮
        if (this.selectedFilterTags.size > 0) {
            this.filterButton.classList.add('b3-button--primary');
            this.filterButton.classList.remove('b3-button--outline');
        }
        controlsGroup.appendChild(this.filterButton);

        // 搜索按钮和输入框
        const searchContainer = document.createElement('div');
        searchContainer.className = 'kanban-search-container';
        searchContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            position: relative;
        `;

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.className = 'b3-text-field search-input';
        searchInput.placeholder = i18n('searchReminders');
        searchInput.style.cssText = `
            width: 0;
            padding: 4px 0;
            border: none;
            transition: all 0.2s ease-in-out;
            opacity: 0;
            visibility: hidden;
            font-size: 14px;
            background: var(--b3-theme-surface);
            color: var(--b3-theme-on-surface);
        `;
        this.searchInput = searchInput;

        const searchBtn = document.createElement('button');
        searchBtn.className = 'b3-button b3-button--outline search-btn';
        searchBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSearch"></use></svg>';
        searchBtn.title = i18n('searchReminders');

        searchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = searchInput.style.visibility === 'hidden';
            if (isHidden) {
                searchInput.style.width = '150px';
                searchInput.style.padding = '4px 8px';
                searchInput.style.opacity = '1';
                searchInput.style.visibility = 'visible';
                searchInput.focus();
            } else {
                searchInput.style.width = '0';
                searchInput.style.padding = '4px 0';
                searchInput.style.opacity = '0';
                setTimeout(() => { searchInput.style.visibility = 'hidden'; }, 200);
                if (this.searchKeyword) {
                    this.searchKeyword = '';
                    searchInput.value = '';
                    this.queueLoadTasks();
                }
            }
        });

        searchInput.addEventListener('input', () => {
            this.searchKeyword = searchInput.value.trim();
            this.queueLoadTasks();
        });

        // 点击外部关闭搜索框（如果为空）
        document.addEventListener('click', (e) => {
            if (!searchContainer.contains(e.target as Node) && !this.searchKeyword && searchInput.style.visibility !== 'hidden') {
                searchInput.style.width = '0';
                searchInput.style.padding = '4px 0';
                searchInput.style.opacity = '0';
                setTimeout(() => { searchInput.style.visibility = 'hidden'; }, 200);
            }
        });

        searchContainer.appendChild(searchInput);
        searchContainer.appendChild(searchBtn);
        controlsGroup.appendChild(searchContainer);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = i18n('refresh');
        refreshBtn.addEventListener('click', async () => {
            // 重新加载项目信息（包括分组信息）
            await this.loadProject();
            // 重新加载任务数据
            await this.getReminders(true);
            // 强制触发看板重绘
            this._lastRenderedProjectId = null;
            this.queueLoadTasks();
        });
        controlsGroup.appendChild(refreshBtn);

        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'b3-button b3-button--outline';
        calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
        calendarBtn.title = i18n('openCalendarView');
        calendarBtn.addEventListener('click', () => this.openCalendarForProject());
        controlsGroup.appendChild(calendarBtn);

        // 看板模式选择下拉框
        const modeSelectContainer = document.createElement('div');
        modeSelectContainer.className = 'kanban-mode-select-container';
        modeSelectContainer.style.cssText = `
            position: relative;
            display: inline-block;
        `;

        const modeSelect = document.createElement('select');
        modeSelect.className = 'b3-select kanban-mode-select';
        modeSelect.style.cssText = `
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            min-width: 120px;
        `;

        // 添加选项
        // 添加选项
        const statusOption = document.createElement('option');
        statusOption.value = 'status';
        statusOption.textContent = i18n('statusKanban');
        if (this.kanbanMode === 'status') {
            statusOption.selected = true;
        }
        modeSelect.appendChild(statusOption);

        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = i18n('customGroupKanban');
        if (this.kanbanMode === 'custom') {
            customOption.selected = true;
        }
        modeSelect.appendChild(customOption);

        const listOption = document.createElement('option');
        listOption.value = 'list';
        listOption.textContent = i18n('taskList');
        if (this.kanbanMode === 'list') {
            listOption.selected = true;
        }
        modeSelect.appendChild(listOption);

        // 切换事件
        modeSelect.addEventListener('change', async () => {
            const newMode = modeSelect.value as 'status' | 'custom' | 'list';
            if (newMode !== this.kanbanMode) {
                await this.setKanbanMode(newMode);
            }
        });

        modeSelectContainer.appendChild(modeSelect);
        controlsGroup.appendChild(modeSelectContainer);

        // 更多设置按钮
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.title = i18n('more');
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            const menu = new Menu("project-kanban-more-menu");

            menu.addItem({
                icon: "iconSettings",
                label: i18n('editProject'),
                click: () => {
                    const dialog = new ProjectDialog(this.projectId, this.plugin);
                    dialog.show();
                }
            });

            menu.addItem({
                icon: "iconSettings",
                label: i18n('manageKanbanStatuses'),
                click: () => {
                    this.showManageKanbanStatusesDialog();
                }
            });

            menu.addItem({
                icon: "iconSettings",
                label: i18n('manageCustomGroups'),
                click: () => {
                    this.showManageGroupsDialog();
                }
            });

            menu.addItem({
                icon: "iconSettings",
                label: i18n('manageProjectTags'),
                click: () => {
                    this.showManageTagsDialog();
                }
            });


            menu.addItem({
                icon: "iconSettings",
                label: i18n('manageMilestones'),
                click: () => this.showManageMilestonesDialog()
            });

            // 插件设置
            menu.addItem({
                icon: 'iconSettings',
                label: i18n('pluginSettings'),
                click: () => {
                    try {
                        if (this.plugin && typeof this.plugin.openSetting === 'function') {
                            this.plugin.openSetting();
                        } else {
                            console.warn('plugin.openSetting is not available');
                        }
                    } catch (err) {
                        console.error(i18n('openPluginSettingsFailed'), err);
                    }
                }
            });

            // 显示菜单
            if (e.target instanceof HTMLElement) {
                const rect = e.target.getBoundingClientRect();
                menu.open({
                    x: rect.right,
                    y: rect.bottom + 4
                });
            } else {
                menu.open({
                    x: e.clientX,
                    y: e.clientY
                });
            }
        });
        controlsGroup.appendChild(moreBtn);

        // 多选模式按钮
        const multiSelectBtn = document.createElement('button');
        multiSelectBtn.className = 'b3-button b3-button--outline';
        multiSelectBtn.id = 'multiSelectBtn';
        multiSelectBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg> ${i18n('batchSelect')}`;
        multiSelectBtn.title = i18n('batchSelectMode');
        multiSelectBtn.addEventListener('click', () => this.toggleMultiSelectMode());
        controlsGroup.appendChild(multiSelectBtn);

        toolbar.appendChild(controlsGroup);

        // 创建看板容器
        const kanbanContainer = document.createElement('div');
        kanbanContainer.className = 'project-kanban-container';
        this.container.appendChild(kanbanContainer);

        // 创建四个列：进行中、短期、长期、已完成
        this.createKanbanColumn(kanbanContainer, 'doing', i18n('doing'), '#f39c12');
        this.createKanbanColumn(kanbanContainer, 'short_term', i18n('shortTerm'), '#3498db');
        this.createKanbanColumn(kanbanContainer, 'long_term', i18n('longTerm'), '#9b59b6');
        this.createKanbanColumn(kanbanContainer, 'completed', i18n('done'), '#27ae60');

        // 添加自定义样式
        this.addCustomStyles();

        // 更新排序按钮标题
        this.updateSortButtonTitle();
        this.updateDoneSortButtonTitle();

        // 更新模式选择下拉框
        this.updateModeSelect();
    }

    private updateMilestoneFilterButton(rightContainer: HTMLElement, groupId: string) {
        if (!rightContainer) return;

        const milestoneFilterSet = this.selectedFilterMilestones.get(groupId);
        const hasActiveMilestoneFilter = milestoneFilterSet && milestoneFilterSet.size > 0;
        // 检查当前状态列/分组是否实际有里程碑任务（基于当前过滤后的任务）
        const statusMilestones = this._statusMilestonesInView.get(groupId);
        const hasMilestonesInThisGroup = (statusMilestones && statusMilestones.size > 0) || !!hasActiveMilestoneFilter;

        if (hasMilestonesInThisGroup) {
            let milestoneFilterBtn = rightContainer.querySelector('.milestone-filter-btn') as HTMLButtonElement;
            if (!milestoneFilterBtn) {
                milestoneFilterBtn = document.createElement('button');
                milestoneFilterBtn.className = 'b3-button b3-button--outline milestone-filter-btn b3-button--small';
                milestoneFilterBtn.title = i18n('filterMilestone');
                milestoneFilterBtn.innerHTML = '🚩';
                milestoneFilterBtn.dataset.groupId = groupId;
                milestoneFilterBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.showMilestoneFilterMenu(e, groupId);
                });

                // 寻找插入位置：通常在 count 后面
                const count = rightContainer.querySelector('.kanban-column-count');
                if (count && count.nextSibling) {
                    rightContainer.insertBefore(milestoneFilterBtn, count.nextSibling);
                } else if (count) {
                    rightContainer.appendChild(milestoneFilterBtn);
                } else if (rightContainer.firstChild) {
                    rightContainer.insertBefore(milestoneFilterBtn, rightContainer.firstChild);
                } else {
                    rightContainer.appendChild(milestoneFilterBtn);
                }
            }

            // 更新高亮状态：只在部分选择时添加 b3-button--primary
            const allAvailableSet = this.allAvailableMilestones.get(groupId);
            const selectedSet = this.selectedFilterMilestones.get(groupId);
            const isPartialSelection = selectedSet && allAvailableSet &&
                selectedSet.size > 0 &&
                selectedSet.size < allAvailableSet.size;

            if (isPartialSelection) {
                milestoneFilterBtn.classList.add('b3-button--primary');
                milestoneFilterBtn.classList.remove('b3-button--outline');
            } else {
                milestoneFilterBtn.classList.remove('b3-button--primary');
                milestoneFilterBtn.classList.add('b3-button--outline');
            }
        } else {
            // 如果没有里程碑任务且没有激活过滤器，移除按钮
            const btn = rightContainer.querySelector('.milestone-filter-btn');
            if (btn) btn.remove();
        }
    }

    private async showMilestoneFilterMenu(event: MouseEvent, targetGroupId: string) {
        try {
            const projectManager = this.projectManager;
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];

            // 确定要显示的里程碑集合 (包含所有里程碑，包括已归档的，以便筛选历史任务)
            const defaultMilestones = (project?.milestones || []);
            let milestonesToShow: { title: string, milestones: any[], groupId: string }[] = [];

            // [新增] 使用在 loadTasks 中预先统计好的带里程碑的任务 ID 和所属分组
            // 这些统计已经考虑了搜索、标签、日期等过滤，但排除了里程碑过滤本身
            const usedMilestoneIds = this._availableMilestonesInView;
            const allowedGroups = this._statusGroupsInView.get(targetGroupId) || new Set<string>();

            // 检查 targetGroupId 是否为自定义分组 ID
            const targetGroup = projectGroups.find((g: any) => g.id === targetGroupId);
            const isCustomGroup = !!targetGroup;
            const isUngrouped = targetGroupId === 'ungrouped';

            if (isCustomGroup) {
                // 如果是特定自定义分组，只显示该分组的任务所使用的里程碑（排除已归档）
                const ms = (targetGroup.milestones || []).filter((m: any) => usedMilestoneIds.has(m.id) && !m.archived);
                if (ms.length > 0) {
                    milestonesToShow.push({
                        title: targetGroup.name,
                        milestones: ms,
                        groupId: targetGroupId
                    });
                }
            } else if (isUngrouped && this.kanbanMode !== 'status') {
                // 如果是 ungrouped 且不是 Status 视图，只显示被使用的默认里程碑（排除已归档）
                const ms = defaultMilestones.filter((m: any) => usedMilestoneIds.has(m.id) && !m.archived);
                if (ms.length > 0) {
                    milestonesToShow.push({
                        title: i18n('defaultMilestones') || '默认里程碑',
                        milestones: ms,
                        groupId: 'ungrouped'
                    });
                }
            } else {
                // Status 视图逻辑：只显示当前状态列中任务实际使用的里程碑
                // 获取当前 status 列中实际使用的里程碑 ID
                const statusMilestoneIds = this._statusMilestonesInView.get(targetGroupId) || new Set<string>();
                // 项目状态分组模式下，或者“已完成”列，允许显示已归档里程碑
                const allowArchived = targetGroupId === 'completed' || this.kanbanMode === 'status';

                // 默认里程碑 - 只显示当前 status 列中实际使用的（除非是已完成列或状态看板模式，否则排除已归档）
                if (defaultMilestones.length > 0 && allowedGroups.has('ungrouped')) {
                    const ms = defaultMilestones.filter(m => statusMilestoneIds.has(m.id) && (!m.archived || allowArchived));
                    if (ms.length > 0) {
                        milestonesToShow.push({
                            title: i18n('defaultMilestones') || '默认里程碑',
                            milestones: ms,
                            groupId: targetGroupId
                        });
                    }
                }

                // 分组里程碑 - 只显示当前 status 列中实际使用的（除非是已完成列或状态看板模式，否则排除已归档）
                projectGroups
                    .filter((g: any) => !g.archived)
                    .forEach((g: any) => {
                        if (!allowedGroups.has(g.id)) return;
                        const ms = (g.milestones || []).filter((m: any) => statusMilestoneIds.has(m.id) && (!m.archived || allowArchived));
                        if (ms.length > 0) {
                            milestonesToShow.push({
                                title: g.name,
                                milestones: ms,
                                groupId: targetGroupId
                            });
                        }
                    });
            }

            // 添加 "无里程碑" 选项
            milestonesToShow.unshift({
                title: i18n('noMilestone') || '无里程碑',
                milestones: [{
                    id: '__no_milestone__',
                    name: i18n('noMilestone') || '无里程碑',
                    icon: '🚫'
                }],
                groupId: targetGroupId // 在 Status 视图下，targetGroupId 是 Status ID；Custom 视图下是 Group ID
            });

            // 收集所有可用里程碑ID（用于后续比较是否全选）
            const allAvailableMilestoneIds = new Set<string>();
            milestonesToShow.forEach(group => {
                group.milestones.forEach(m => allAvailableMilestoneIds.add(m.id));
            });

            // 存储该分组的所有可用里程碑ID
            this.allAvailableMilestones.set(targetGroupId, allAvailableMilestoneIds);

            // 如果之前没有选择过，默认全选（不设置 Set 即代表全选/无论是否有新里程碑加入都显示）
            // const hasExistingFilter = this.selectedFilterMilestones.has(targetGroupId);
            // if (!hasExistingFilter) {
            //     // 移除此处自动填充逻辑，保持 selectedFilterMilestones 中无 key 状态
            // }

            // 创建弹窗容器
            const menu = document.createElement('div');
            menu.className = 'milestone-filter-dropdown-menu';
            menu.style.cssText = `
                display: block; 
                position: fixed; 
                z-index: 1000; 
                background-color: var(--b3-theme-background); 
                border: 1px solid var(--b3-border-color); 
                border-radius: 4px; 
                box-shadow: rgba(0, 0, 0, 0.15) 0px 2px 8px; 
                min-width: 220px; 
                max-height: 500px; 
                overflow-y: auto; 
                padding: 12px;
            `;

            const target = event.currentTarget as HTMLElement;
            const rect = target.getBoundingClientRect();

            // 操作按钮容器
            const btnsContainer = document.createElement('div');
            btnsContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px;';

            // 全选按钮（等于不筛选）
            const selectAllBtn = document.createElement('button');
            selectAllBtn.className = 'b3-button b3-button--text b3-button--small';
            selectAllBtn.style.flex = '1';
            selectAllBtn.textContent = i18n('selectAll') || '全选';
            selectAllBtn.addEventListener('click', () => {
                // 全选等于不筛选，删除该分组的筛选设置
                this.selectedFilterMilestones.delete(targetGroupId);

                // 更新 UI
                const checkboxes = menu.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
                checkboxes.forEach(cb => cb.checked = true);

                this.queueLoadTasks();
                this.updateMilestoneFilterButtonsState();
            });
            btnsContainer.appendChild(selectAllBtn);

            // 清除按钮
            const clearBtn = document.createElement('button');
            clearBtn.className = 'b3-button b3-button--text b3-button--small';
            clearBtn.style.flex = '1';
            clearBtn.textContent = i18n('clearSelection');
            clearBtn.addEventListener('click', () => {
                // 设置为空 Set，表示清除所有选择（不显示任何任务）
                this.selectedFilterMilestones.set(targetGroupId, new Set());
                const checkboxes = menu.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
                checkboxes.forEach(cb => cb.checked = false);
                this.queueLoadTasks();
                this.updateMilestoneFilterButtonsState();
            });
            btnsContainer.appendChild(clearBtn);

            // 管理按钮
            const manageBtn = document.createElement('button');
            manageBtn.className = 'b3-button b3-button--text b3-button--small';
            manageBtn.style.flex = '1';
            manageBtn.textContent = i18n('manage') || '管理';
            manageBtn.addEventListener('click', () => {
                // 关闭筛选菜单
                menu.remove();
                // 如果 targetGroup 存在，则只管理该分组；否则管理全部（Status 视图下显示全部）
                this.showManageMilestonesDialog(targetGroup ? targetGroupId : undefined);
            });
            btnsContainer.appendChild(manageBtn);

            menu.appendChild(btnsContainer);

            // 渲染列表项
            milestonesToShow.forEach(section => {
                // [修改] 如果是 Status 视图且里程碑列表不为空，显示分组标题进行区分
                // 排除 "无里程碑" 这一项
                if (this.kanbanMode === 'status' && section.milestones.length > 0 && section.title !== (i18n('noMilestone') || '无里程碑')) {
                    const groupTitle = document.createElement('div');
                    groupTitle.style.cssText = `
                        padding: 8px 8px 4px 8px;
                        font-size: 11px;
                        font-weight: bold;
                        color: var(--b3-theme-on-surface);
                        opacity: 0.8;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        border-top: 1px solid var(--b3-theme-border);
                        margin-top: 4px;
                    `;

                    // 找出第一个真正包含里程碑且不是“无里程碑”的分组，去掉它的顶部边距和边框
                    const firstVisibleGroup = milestonesToShow.find(s => s.milestones.length > 0 && s.title !== (i18n('noMilestone') || '无里程碑'));
                    if (section === firstVisibleGroup) {
                        groupTitle.style.borderTop = 'none';
                        groupTitle.style.marginTop = '0';
                    }

                    groupTitle.textContent = section.title;
                    menu.appendChild(groupTitle);
                }

                section.milestones.forEach(ms => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display: flex; align-items: center; padding: 6px 8px; cursor: pointer; border-radius: 4px; transition: background 0.2s;';
                    label.onmouseenter = () => label.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
                    label.onmouseleave = () => label.style.backgroundColor = '';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'b3-checkbox';
                    checkbox.style.marginRight = '8px';
                    // 使用 key: targetGroupId
                    const currentFilterSet = this.selectedFilterMilestones.get(section.groupId);
                    // 如果 Set 不存在，说明是“全选/不筛选”状态，应该显示为选中
                    checkbox.checked = !currentFilterSet || currentFilterSet.has(ms.id);

                    checkbox.addEventListener('change', () => {
                        const groupId = section.groupId;
                        let set = this.selectedFilterMilestones.get(groupId);

                        if (!set) {
                            // 当前是“全选”状态，用户取消勾选了一个
                            if (!checkbox.checked) {
                                // 初始化 Set 为“除了被取消勾选的这个之外的所有项”
                                const allAvailable = this.allAvailableMilestones.get(groupId);
                                set = new Set(allAvailable);
                                set.delete(ms.id);
                                this.selectedFilterMilestones.set(groupId, set);
                            }
                        } else {
                            // 当前是“筛选”状态
                            if (checkbox.checked) {
                                set.add(ms.id);

                                // 检查是否已全选：如果是，则恢复为“不筛选”状态
                                const allAvailable = this.allAvailableMilestones.get(groupId);
                                if (allAvailable && set.size === allAvailable.size) {
                                    this.selectedFilterMilestones.delete(groupId);
                                }
                            } else {
                                set.delete(ms.id);
                            }
                        }

                        this.queueLoadTasks();
                        this.updateMilestoneFilterButtonsState();
                    });

                    const icon = document.createElement('span');
                    icon.style.marginRight = '6px';
                    icon.textContent = ms.icon || '🚩';

                    const name = document.createElement('span');
                    name.textContent = ms.name;
                    name.style.flex = '1';
                    name.style.overflow = 'hidden';
                    name.style.textOverflow = 'ellipsis';
                    name.style.whiteSpace = 'nowrap';

                    // 已归档的里程碑显示为暗色
                    if (ms.archived) {
                        name.style.textDecoration = 'line-through';
                        name.style.opacity = '0.6';
                        name.style.color = 'var(--b3-theme-on-surface-light)';
                    }

                    label.appendChild(checkbox);
                    label.appendChild(icon);
                    label.appendChild(name);
                    menu.appendChild(label);
                });
            });

            if (milestonesToShow.length === 0) {
                const emptyTip = document.createElement('div');
                emptyTip.style.padding = '12px';
                emptyTip.style.color = 'var(--b3-theme-on-surface)';
                emptyTip.style.opacity = '0.6';
                emptyTip.style.textAlign = 'center';
                emptyTip.textContent = i18n('noMilestones') || '暂无里程碑';
                menu.appendChild(emptyTip);
            }

            // 添加到 body 并计算自适应位置
            document.body.appendChild(menu);

            // 计算自适应位置，防止超出屏幕
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;

            // 检查右侧是否超出屏幕，如果是则向左偏移
            if (rect.left + menuWidth > windowWidth) {
                menu.style.left = `${Math.max(8, rect.right - menuWidth)}px`;
            } else {
                menu.style.left = `${rect.left}px`;
            }

            // 检查底部是否超出屏幕，如果是则向上显示
            if (rect.bottom + 4 + menuHeight > windowHeight) {
                menu.style.top = `${Math.max(8, rect.top - menuHeight - 4)}px`;
            } else {
                menu.style.top = `${rect.bottom + 4}px`;
            }

            // 点击外部关闭
            const closeHandler = (e: MouseEvent) => {
                if (!menu.contains(e.target as Node) && !target.contains(e.target as Node)) {
                    menu.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        } catch (error) {
            console.error('加载里程碑筛选菜单失败:', error);
        }
    }

    private updateMilestoneFilterButtonsState() {
        const buttons = this.container.querySelectorAll('.milestone-filter-btn') as NodeListOf<HTMLButtonElement>;
        buttons.forEach(btn => {
            const groupId = btn.dataset.groupId;
            const selectedSet = groupId ? this.selectedFilterMilestones.get(groupId) : undefined;
            const allAvailableSet = groupId ? this.allAvailableMilestones.get(groupId) : undefined;

            // 检查是否是部分选择（有选择但不等于全部）
            const isPartialSelection = selectedSet && allAvailableSet &&
                selectedSet.size > 0 &&
                selectedSet.size < allAvailableSet.size;

            // 只在部分选择时添加 b3-button--primary
            if (isPartialSelection) {
                btn.classList.add('b3-button--primary');
                btn.classList.remove('b3-button--outline');
            } else {
                btn.classList.remove('b3-button--primary');
                btn.classList.add('b3-button--outline');
            }
        });
    }

    private createKanbanColumn(container: HTMLElement, status: string, title: string, color: string) {
        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${status}`;
        column.dataset.status = status;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        // 从 kanbanStatuses 获取状态图标
        const statusConfig = this.kanbanStatuses.find(s => s.id === status);
        const emoji = statusConfig?.icon || '';
        titleEl.textContent = emoji ? `${emoji}${title}` : title;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${color};
        `;
        titleContainer.appendChild(titleEl);

        if (status === 'completed') {
            this.doneSortButton = document.createElement('button');
            this.doneSortButton.className = 'b3-button b3-button--text';
            this.doneSortButton.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconSort"></use></svg>';
            this.doneSortButton.title = '排序';
            this.doneSortButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showDoneSortMenu(e);
            });
            titleContainer.appendChild(this.doneSortButton);
        }

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);

        // 新建任务按钮（针对该状态列），已完成列不显示新建按钮
        const rightContainer = document.createElement('div');
        rightContainer.className = 'custom-header-right';
        rightContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';
        rightContainer.appendChild(countEl);

        if (status !== 'completed') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--outline';
            addTaskBtn.title = i18n('newTask');
            addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCreateTaskDialog(undefined, this.lastSelectedCustomGroupId, status);
            });

            rightContainer.appendChild(addTaskBtn);

            // 粘贴新建任务按钮
            const pasteTaskBtn = document.createElement('button');
            pasteTaskBtn.className = 'b3-button b3-button--outline';
            pasteTaskBtn.title = i18n('pasteNew');
            pasteTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>`;
            pasteTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPasteTaskDialog(undefined, this.lastSelectedCustomGroupId, status, true);
            });

            rightContainer.appendChild(pasteTaskBtn);
        }

        header.appendChild(rightContainer);

        // 支持拖拽列头以排序状态
        header.draggable = true;
        header.dataset.statusId = status;
        header.addEventListener('dragstart', (e: DragEvent) => {
            try { e.dataTransfer?.setData('text/status-id', status); } catch (err) { }
            e.dataTransfer!.effectAllowed = 'move';
            header.classList.add('dragging');
        });
        header.addEventListener('dragend', () => {
            header.classList.remove('dragging');
            // 隐藏任何占位符（由容器处理）
            const ph = container.querySelector('.kanban-column-insert-placeholder') as HTMLElement | null;
            if (ph) ph.style.display = 'none';
        });

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 0px;
            overflow-y: auto;
            min-height: 200px;
            margin-top: 8px;
        `;

        // 添加拖拽事件
        this.addDropZoneEvents(content, status);

        column.appendChild(header);
        column.appendChild(content);

        // 分页容器（插入在列内容之后）
        const pagination = document.createElement('div');
        pagination.className = 'kanban-column-pagination';
        pagination.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 8px;
        `;

        column.appendChild(pagination);
        container.appendChild(column);

        // 仅在容器上初始化一次列拖拽处理
        if (!container.dataset.columnDragInit) {
            container.dataset.columnDragInit = '1';
            const columnPlaceholder = document.createElement('div');
            columnPlaceholder.className = 'kanban-column-insert-placeholder';
            columnPlaceholder.style.cssText = `
                width: 6px;
                background: var(--b3-theme-primary);
                border-radius: 3px;
                margin: 8px 4px;
                display: none;
                transition: opacity 120ms ease;
            `;
            container.appendChild(columnPlaceholder);

            let dragCounter = 0;

            container.addEventListener('dragenter', (ev: DragEvent) => {
                // 仅针对列头拖拽（设置了 text/status-id）处理进入计数，避免任务拖拽触发列插入占位
                const dt = ev.dataTransfer;
                const isColumnDrag = dt && ((dt.types && Array.from(dt.types).includes('text/status-id')) || !!dt.getData?.('text/status-id'));
                if (!isColumnDrag) return;
                ev.preventDefault();
                dragCounter++;
            });

            container.addEventListener('dragleave', (ev: DragEvent) => {
                const dt = ev.dataTransfer;
                const isColumnDrag = dt && ((dt.types && Array.from(dt.types).includes('text/status-id')) || !!dt.getData?.('text/status-id'));
                if (!isColumnDrag) return;
                const related = (ev as any).relatedTarget as HTMLElement | null;
                if (!related || !container.contains(related)) {
                    dragCounter = 0;
                    columnPlaceholder.style.display = 'none';
                } else {
                    dragCounter = Math.max(0, dragCounter - 1);
                }
            });

            container.addEventListener('dragover', (ev: DragEvent) => {
                // 仅在列头拖拽时显示列插入占位符；普通任务拖拽不应影响列顺序的可视提示
                const dt = ev.dataTransfer;
                const isColumnDrag = dt && ((dt.types && Array.from(dt.types).includes('text/status-id')) || !!dt.getData?.('text/status-id'));
                if (!isColumnDrag) return;
                ev.preventDefault();
                const columns = Array.from(container.querySelectorAll('.kanban-column')) as HTMLElement[];
                if (columns.length === 0) {
                    container.appendChild(columnPlaceholder);
                    columnPlaceholder.style.display = 'block';
                    return;
                }
                let inserted = false;
                for (const col of columns) {
                    const rect = col.getBoundingClientRect();
                    const midX = rect.left + rect.width / 2;
                    if (ev.clientX < midX) {
                        col.parentElement!.insertBefore(columnPlaceholder, col);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) container.appendChild(columnPlaceholder);
                columnPlaceholder.style.display = 'block';
            });

            container.addEventListener('drop', (ev: DragEvent) => {
                ev.preventDefault();
                columnPlaceholder.style.display = 'none';
                dragCounter = 0;
                const data = ev.dataTransfer?.getData('text/status-id') || ev.dataTransfer?.getData('text');
                if (!data) return;
                const draggedId = data as string;

                let beforeCount = 0;
                for (const child of Array.from(container.children)) {
                    if (child === columnPlaceholder) break;
                    const el = child as HTMLElement;
                    if (el.classList && el.classList.contains('kanban-column')) beforeCount++;
                }
                const insertIndex = beforeCount;

                const fromIndex = this.kanbanStatuses.findIndex(s => s.id === draggedId);
                if (fromIndex === -1) return;
                const [moved] = this.kanbanStatuses.splice(fromIndex, 1);
                this.kanbanStatuses.splice(insertIndex, 0, moved);
                this.kanbanStatuses.forEach((s, i) => s.sort = i * 10);

                (async () => {
                    try {
                        await this.projectManager.setProjectKanbanStatuses(this.projectId, this.kanbanStatuses);
                        this._lastRenderedProjectId = null;
                        this.queueLoadTasks();
                        showMessage(i18n('statusOrderSaved') || '状态顺序已保存');
                    } catch (err) {
                        console.error('保存状态顺序失败', err);
                    }
                })();
            });
        }

        return column;
    }

    private addDropZoneEvents(element: HTMLElement, status: string) {
        element.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain');

            if (this.isDragging && this.draggedTask) {
                // 检查是否可以改变状态或解除父子关系
                const currentStatus = this.getTaskStatus(this.draggedTask);
                const canChangeStatus = currentStatus !== status;
                const canUnsetParent = !!this.draggedTask.parentId;

                if (canChangeStatus || canUnsetParent) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            } else if (isExternalDrag || isSiYuanDrag) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                element.classList.add('kanban-drop-zone-active');
            }
        });

        element.addEventListener('dragleave', (_e) => {
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);
            }
        });

        element.addEventListener('drop', async (e) => {
            this.clearDropZoneHighlights();

            // 检查思源拖拽
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);

            if (isSiYuanDrag) {
                e.preventDefault();
                e.stopPropagation();
                await this.handleDrop(e, status, null);
                return;
            }

            // 检查批量拖拽
            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (multiData) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const taskIds = JSON.parse(multiData);
                    await this.batchUpdateTasks(taskIds, { kanbanStatus: status, projectId: this.projectId });
                } catch (err) { console.error(err); }
                return;
            }

            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                e.stopPropagation();
                // 使用 batchUpdateTasks 处理单个任务拖拽，确保可以自动解除父子关系并同步项目
                await this.batchUpdateTasks([this.draggedTask.id], { kanbanStatus: status, projectId: this.projectId });
            } else {
                let externalTaskId = '';
                const reminderPayload = e.dataTransfer?.getData('application/x-reminder');
                if (reminderPayload) {
                    try {
                        const payload = JSON.parse(reminderPayload);
                        externalTaskId = payload.id;
                    } catch (e) { }
                }
                if (!externalTaskId) {
                    externalTaskId = e.dataTransfer?.getData('text/plain');
                }

                if (externalTaskId) {
                    console.log('[Kanban] External Drop on Status:', { externalTaskId, status, projectId: this.projectId });
                    e.preventDefault();
                    e.stopPropagation();
                    await this.batchUpdateTasks([externalTaskId], { kanbanStatus: status, projectId: this.projectId });
                }
            }
        });
    }

    /**
     * 为自定义分组列添加拖拽事件（设置分组）
     */
    private addCustomGroupDropZoneEvents(element: HTMLElement, groupId: string | null) {
        element.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain');

            if (this.isDragging && this.draggedTask) {
                // 将 undefined 或字符串 'ungrouped' 视为 null，对比当前分组是否与目标一致
                const currentGroupRaw = (this.draggedTask.customGroupId as any);
                const currentGroup = (currentGroupRaw === undefined || currentGroupRaw === 'ungrouped') ? null : currentGroupRaw;
                const canSetGroup = currentGroup !== groupId;

                if (canSetGroup) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            } else if (isExternalDrag || isSiYuanDrag) {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                element.classList.add('kanban-drop-zone-active');
            }
        });

        element.addEventListener('dragleave', (_e) => {
            // 使用 contains 检查离开目标区域时清除样式
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', async (e) => {
            this.clearDropZoneHighlights();

            // 检查思源拖拽
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);

            if (isSiYuanDrag) {
                e.preventDefault();
                e.stopPropagation();
                // 在自定义分组列上放下，尝试使用之前的状态或默认状态
                await this.handleDrop(e, this.lastSelectedStatus || 'short_term', groupId);
                return;
            }

            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (multiData) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const taskIds = JSON.parse(multiData);
                    await this.batchUpdateTasks(taskIds, { customGroupId: groupId, projectId: this.projectId });
                } catch (err) { console.error(err); }
                return;
            }

            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                e.stopPropagation();
                await this.batchUpdateTasks([this.draggedTask.id], { customGroupId: groupId, projectId: this.projectId });
            } else {
                let externalTaskId = '';
                const reminderPayload = e.dataTransfer?.getData('application/x-reminder');
                if (reminderPayload) {
                    try {
                        const payload = JSON.parse(reminderPayload);
                        externalTaskId = payload.id;
                    } catch (e) { }
                }
                if (!externalTaskId) {
                    externalTaskId = e.dataTransfer?.getData('text/plain');
                }

                if (externalTaskId) {
                    console.log('[Kanban] External Drop on Group:', { externalTaskId, groupId, projectId: this.projectId });
                    e.preventDefault();
                    e.stopPropagation();
                    await this.batchUpdateTasks([externalTaskId], { customGroupId: groupId, projectId: this.projectId });
                }
            }
        });
    }

    /**
     * **[新增]** 为自定义分组下的状态子分组添加拖拽事件（设置任务状态）
     * @param element 目标DOM元素
     * @param targetStatus 目标状态 ('doing', 'short_term', 'long_term')
     */
    private addStatusSubGroupDropEvents(element: HTMLElement, targetStatus: string) {
        element.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain');

            if (this.isDragging && this.draggedTask) {
                const currentStatus = this.getTaskStatus(this.draggedTask);
                const statusGroup = element.closest('.custom-status-group') as HTMLElement;
                let targetGroupId: string | null | undefined = undefined;
                if (statusGroup && statusGroup.dataset.groupId) {
                    const groupId = statusGroup.dataset.groupId;
                    targetGroupId = groupId === 'ungrouped' ? null : groupId;
                }
                const currentGroupRaw = (this.draggedTask as any).customGroupId;
                const currentGroupId = (currentGroupRaw === undefined || currentGroupRaw === 'ungrouped') ? null : currentGroupRaw;

                const statusChanged = currentStatus !== targetStatus;
                const groupChanged = targetGroupId !== undefined && currentGroupId !== targetGroupId;

                if (statusChanged || groupChanged) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            } else if (isExternalDrag || isSiYuanDrag) {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                element.classList.add('kanban-drop-zone-active');
            }
        });

        element.addEventListener('dragleave', (e) => {
            if (!element.contains((e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', async (e) => {
            this.clearDropZoneHighlights();
            const statusGroup = element.closest('.custom-status-group') as HTMLElement;
            let targetGroupId: string | null | undefined = undefined;
            if (statusGroup && statusGroup.dataset.groupId) {
                const groupId = statusGroup.dataset.groupId;
                targetGroupId = groupId === 'ungrouped' ? null : groupId;
            }

            // 检查思源拖拽
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);

            if (isSiYuanDrag) {
                e.preventDefault();
                e.stopPropagation();
                await this.handleDrop(e, targetStatus, targetGroupId || null);
                return;
            }

            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (multiData) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    const taskIds = JSON.parse(multiData);
                    await this.batchUpdateTasks(taskIds, { kanbanStatus: targetStatus, customGroupId: targetGroupId, projectId: this.projectId });
                } catch (err) { console.error(err); }
                return;
            }

            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                e.stopPropagation();
                await this.batchUpdateTasks([this.draggedTask.id], { kanbanStatus: targetStatus, customGroupId: targetGroupId, projectId: this.projectId });
            } else {
                let externalTaskId = '';
                const reminderPayload = e.dataTransfer?.getData('application/x-reminder');
                if (reminderPayload) {
                    try {
                        const payload = JSON.parse(reminderPayload);
                        externalTaskId = payload.id;
                    } catch (e) { }
                }
                if (!externalTaskId) {
                    externalTaskId = e.dataTransfer?.getData('text/plain');
                }

                if (externalTaskId) {
                    console.log('[Kanban] External Drop on SubGroup:', { externalTaskId, targetStatus, targetGroupId, projectId: this.projectId });
                    e.preventDefault();
                    e.stopPropagation();
                    await this.batchUpdateTasks([externalTaskId], { kanbanStatus: targetStatus, customGroupId: targetGroupId, projectId: this.projectId });
                }
            }
        });
    }


    /**
     * 设置任务的自定义分组
     */
    private async setTaskCustomGroup(task: any, groupId: string | null) {
        try {
            // 归一化：确保 'ungrouped' 字符串也会被当作 null 处理
            if (groupId === 'ungrouped') groupId = null;
            const reminderData = await this.getReminders();
            // 支持重复实例：如果是实例，写入原始提醒的 repeat.instanceModifications[date]
            if (task.isRepeatInstance && task.originalId) {
                const instanceDate = task.date;
                const originalId = task.originalId;
                // 获取原始及其后代原始ID
                const originalIds = [originalId, ...this.getAllDescendantIds(originalId, reminderData)];
                let updatedCount = 0;

                for (const oid of originalIds) {
                    const orig = reminderData[oid];
                    if (!orig) continue;
                    const instMod = this.ensureInstanceModificationStructure(orig, instanceDate);
                    if (groupId === null) {
                        if (instMod.customGroupId !== undefined) {
                            delete instMod.customGroupId;
                            updatedCount++;
                        }
                    } else {
                        if (instMod.customGroupId !== groupId) {
                            instMod.customGroupId = groupId;
                            updatedCount++;
                        }
                    }
                }

                if (updatedCount === 0) {
                    showMessage('没有需要更新的任务分组');
                    return;
                }

                await saveReminders(this.plugin, reminderData);

                this.dispatchReminderUpdate(true);

                if (groupId === null) {
                    showMessage(`已将 ${updatedCount} 个任务实例移出分组`);
                } else {
                    showMessage(`已将 ${updatedCount} 个任务实例添加到分组`);
                }

                await this.queueLoadTasks();
                return;
            }

            // 非实例情况：按原逻辑更新实际任务及其后代
            if (!reminderData[task.id]) {
                showMessage("任务不存在");
                return;
            }

            // 计算要更新的任务列表：包含当前任务及其所有后代
            const toUpdateIds = [task.id, ...this.getAllDescendantIds(task.id, reminderData)];

            let updatedCount = 0;
            toUpdateIds.forEach(id => {
                const item = reminderData[id];
                if (!item) return;
                if (groupId === null) {
                    // 明确移除分组
                    if (item.customGroupId !== undefined) {
                        delete item.customGroupId;
                        updatedCount++;
                    }
                } else {
                    if (item.customGroupId !== groupId) {
                        item.customGroupId = groupId;
                        updatedCount++;
                    }
                }
            });

            if (updatedCount === 0) {
                showMessage('没有需要更新的任务分组');
                return;
            }

            await saveReminders(this.plugin, reminderData);

            // 广播更新事件
            this.dispatchReminderUpdate(true);

            // 提示更新的任务数
            if (groupId === null) {
                showMessage(`已将 ${updatedCount} 个任务移出分组`);
            } else {
                showMessage(`已将 ${updatedCount} 个任务添加到分组`);
            }

            // 重新加载任务以更新显示（使用防抖队列）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('设置任务分组失败:', error);
            showMessage("设置任务分组失败");
        }
    }

    /**
     * 切换任务的标签（添加或移除）
     * @param task 任务对象
     * @param tagId 标签ID
     */
    private async toggleTaskTag(task: any, tagId: string) {
        try {
            const reminderData = await this.getReminders();

            // 如果是重复实例，优先走实例处理逻辑；否则确保目标任务存在
            if (!(task.isRepeatInstance && task.originalId)) {
                if (!reminderData[task.id]) {
                    showMessage("任务不存在");
                    return;
                }
            }

            // 获取标签名称用于显示
            const projectManager = this.projectManager;
            const projectTags = await projectManager.getProjectTags(this.projectId);
            const tag = projectTags.find(t => t.id === tagId);
            const tagName = tag?.name || tagId;

            // 支持重复实例：如果是实例，写入原始提醒的 repeat.instanceModifications[date]
            if (task.isRepeatInstance && task.originalId) {
                const instanceDate = task.date;
                const originalId = task.originalId;
                // 获取原始及其后代原始ID
                const originalIds = [originalId, ...this.getAllDescendantIds(originalId, reminderData)];
                let updatedCount = 0;

                // 判断原始任务当前实例是否包含该标签（用于判断是添加还是移除）
                const origFirst = reminderData[originalId];
                const origInstanceMods = origFirst?.repeat?.instanceModifications || {};
                const instanceModExample = origInstanceMods[instanceDate] || {};
                const instanceTags = instanceModExample.tagIds || origFirst?.tagIds || [];
                const isAdding = instanceTags.indexOf(tagId) === -1;

                for (const oid of originalIds) {
                    const orig = reminderData[oid];
                    if (!orig) continue;
                    const instMod = this.ensureInstanceModificationStructure(orig, instanceDate);
                    if (!instMod.tagIds) {
                        // 如果实例层没有定义标签，初始化为原始任务的标签副本（避免覆盖原始）
                        instMod.tagIds = Array.isArray(orig.tagIds) ? [...orig.tagIds] : [];
                    }

                    const idx = instMod.tagIds.indexOf(tagId);
                    if (isAdding) {
                        if (idx === -1) {
                            instMod.tagIds.push(tagId);
                            updatedCount++;
                        }
                    } else {
                        if (idx > -1) {
                            instMod.tagIds.splice(idx, 1);
                            updatedCount++;
                        }
                    }
                }

                if (updatedCount === 0) {
                    showMessage('没有需要更新的任务标签');
                    return;
                }

                await saveReminders(this.plugin, reminderData);
                this.dispatchReminderUpdate(true);
                if (isAdding) {
                    showMessage(`已为 ${updatedCount} 个任务实例添加标签"${tagName}"`);
                } else {
                    showMessage(`已从 ${updatedCount} 个任务实例移除标签"${tagName}"`);
                }

                await this.queueLoadTasks();
                return;
            }

            // 计算要更新的任务列表：包含当前任务及其所有后代
            const toUpdateIds = [task.id, ...this.getAllDescendantIds(task.id, reminderData)];

            // 更新所有相关任务的标签
            let updatedCount = 0;
            const currentTags = reminderData[task.id].tagIds || [];
            const tagIndex = currentTags.indexOf(tagId);
            const isAdding = tagIndex === -1;

            for (const taskId of toUpdateIds) {
                if (reminderData[taskId]) {
                    if (!reminderData[taskId].tagIds) {
                        reminderData[taskId].tagIds = [];
                    }

                    const tags = reminderData[taskId].tagIds;
                    const idx = tags.indexOf(tagId);

                    if (isAdding) {
                        // 添加标签
                        if (idx === -1) {
                            tags.push(tagId);
                            updatedCount++;
                        }
                    } else {
                        // 移除标签
                        if (idx > -1) {
                            tags.splice(idx, 1);
                            updatedCount++;
                        }
                    }
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 广播更新事件
            this.dispatchReminderUpdate(true);

            // 提示更新的任务数
            if (isAdding) {
                showMessage(`已为 ${updatedCount} 个任务添加标签"${tagName}"`);
            } else {
                showMessage(`已从 ${updatedCount} 个任务移除标签"${tagName}"`);
            }

            // 重新加载任务以更新显示（使用防抖队列）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('切换任务标签失败:', error);
            showMessage("设置任务标签失败");
        }
    }

    private async getReminders(forceRefresh: boolean = false): Promise<any> {
        if (forceRefresh || !this.reminderData) {
            this.reminderData = await getAllReminders(this.plugin, undefined, forceRefresh);
        }
        return this.reminderData;
    }

    /**
     * 过滤已归档分组的未完成任务
     */
    private async filterArchivedGroupTasks(tasks: any[]): Promise<any[]> {
        try {
            // 获取当前项目的分组信息
            const groups = await this.projectManager.getProjectCustomGroups(this.projectId);

            // 构建已归档分组的ID集合
            const archivedGroupIds = new Set<string>();
            groups.forEach((g: any) => {
                if (g.archived) {
                    archivedGroupIds.add(g.id);
                }
            });

            // 过滤：如果任务属于已归档分组且未完成，则过滤掉
            return tasks.filter(t => {
                if (t.customGroupId && archivedGroupIds.has(t.customGroupId) && !t.completed) {
                    return false;
                }
                return true;
            });
        } catch (error) {
            console.error('过滤已归档分组任务失败', error);
            return tasks;
        }
    }

    private async loadTasks() {
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        try {
            // 保存当前滚动状态，避免界面刷新时丢失滚动位置
            this.captureScrollState();

            // 构造里程碑映射
            await this.buildMilestoneMap();

            const reminderData = await this.getReminders();
            let projectTasks = Object.values(reminderData).filter((reminder: any) => reminder && reminder.projectId === this.projectId);

            // 过滤已归档分组的未完成任务
            projectTasks = await this.filterArchivedGroupTasks(projectTasks);

            // 修复遗留：如果任务中存在 customGroupId === 'ungrouped'，视为未分组（删除该字段）
            projectTasks.forEach((t: any) => {
                if (t && t.customGroupId === 'ungrouped') {
                    delete t.customGroupId;
                }
            });
            // 为没有设置状态或状态无效的任务默认设置为 doing（进行中）
            const validStatusIds = new Set(this.kanbanStatuses.map(s => s.id));
            let hasInvalidStatus = false;
            projectTasks.forEach((t: any) => {
                if (t && !t.completed) {
                    // 检查状态是否存在且有效（属于当前项目的状态）
                    if (!t.kanbanStatus || !validStatusIds.has(t.kanbanStatus)) {
                        t.kanbanStatus = 'doing';
                        // 同步更新 reminderData 以便保存
                        if (reminderData[t.id]) {
                            reminderData[t.id].kanbanStatus = 'doing';
                        }
                        hasInvalidStatus = true;
                    }
                }
            });
            // 如果有任务状态被修正，保存到存储
            if (hasInvalidStatus) {
                saveReminders(this.plugin, reminderData).catch(err => {
                    console.error('保存任务状态修正失败:', err);
                });
            }
            // 根据日期自动将到期（今天或过去）且未完成的父任务设置为 doing，并级联到所有后代
            try {
                const todayForDateCheck = getLogicalDateString();
                const hasDoingStatus = this.kanbanStatuses.some(s => s.id === 'doing');
                let dateCascadeChanged = false;

                if (hasDoingStatus) {
                    for (const t of projectTasks) {
                        if (!t) continue;
                        // 仅对未完成且有明确 date 的任务处理（不处理实例层的逻辑，这里作用于原始提醒与普通任务）
                        if (!t.completed && t.date && compareDateStrings(t.date, todayForDateCheck) <= 0) {
                            // 如果父任务已经是进行中，则跳过，避免重复设置及不必要的级联
                            if (t.kanbanStatus === 'doing') {
                                continue;
                            }

                            // 仅当父任务不是 doing 时，设置为 doing 并级联到后代
                            t.kanbanStatus = 'doing';
                            if (reminderData[t.id]) {
                                reminderData[t.id].kanbanStatus = 'doing';
                            }
                            dateCascadeChanged = true;

                            // 级联到后代
                            try {
                                const descendantIds = this.getAllDescendantIds(t.id, reminderData);
                                for (const did of descendantIds) {
                                    const desc = reminderData[did];
                                    if (!desc) continue;
                                    if (!desc.completed && desc.kanbanStatus !== 'doing') {
                                        desc.kanbanStatus = 'doing';
                                        dateCascadeChanged = true;
                                    }
                                }
                            } catch (err) {
                                console.warn('date cascade descendants failed', err);
                            }
                        }
                    }
                }

                if (dateCascadeChanged) {
                    await saveReminders(this.plugin, reminderData);
                }
            } catch (err) {
                console.warn('自动根据日期级联设置状态失败:', err);
            }
            const taskMap = new Map(projectTasks.map((t: any) => [t.id, { ...t }]));

            const getRootStatus = (task: any): string => {
                let current = task;
                while (current.parentId && taskMap.has(current.parentId)) {
                    current = taskMap.get(current.parentId);
                }
                return this.getTaskStatus(current);
            };

            // 处理周期事件：生成实例并筛选
            const today = getLogicalDateString();
            const allTasksWithInstances: any[] = [];

            projectTasks.forEach((reminder: any) => {
                // 对于农历重复任务，只添加符合农历日期的实例，不添加原始日期
                const isLunarRepeat = reminder.repeat?.enabled &&
                    (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

                // 修改后的逻辑：对于所有重复事件，只显示实例，不显示原始任务
                // 同时，如果任务有任何祖先是重复任务，也不显示原始任务（因为它会作为 ghost 实例显示）
                if (!reminder.repeat?.enabled) {
                    let hasRepeatingAncestor = false;
                    let current = reminder;
                    while (current.parentId && taskMap.has(current.parentId)) {
                        const parent = taskMap.get(current.parentId);
                        if (parent && parent.repeat?.enabled) {
                            hasRepeatingAncestor = true;
                            break;
                        }
                        current = parent;
                    }

                    if (!hasRepeatingAncestor) {
                        // 既不是周期任务，也没有周期祖先，正常添加
                        allTasksWithInstances.push(reminder);
                    }
                }
                // 对于所有重复事件（农历和非农历），都不添加原始任务，只添加实例

                // 如果是周期事件，生成实例
                if (reminder.repeat?.enabled) {
                    // 智能确定时间范围，确保至少能找到下一个未来实例
                    const repeatInstances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);

                    // 过滤实例：保留过去未完成、今天的、未来第一个未完成，以及所有已完成的实例
                    const completedInstances = reminder.repeat?.completedInstances || [];

                    // 将实例分类为：过去未完成、今天未完成、未来未完成、未来已完成、过去已完成
                    let pastIncompleteList: any[] = [];
                    let todayIncompleteList: any[] = [];
                    let futureIncompleteList: any[] = [];
                    let futureCompletedList: any[] = [];
                    let pastCompletedList: any[] = [];

                    repeatInstances.forEach(instance => {
                        const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                        const originalKey = instanceIdStr.split('_').pop() || instance.date;
                        // 对于所有重复事件，只添加实例，不添加原始任务
                        const isInstanceCompleted = completedInstances.includes(originalKey);

                        const instanceTask = {
                            ...reminder,
                            ...instance,
                            id: instance.instanceId,
                            isRepeatInstance: true,
                            completed: isInstanceCompleted,
                            // 为已完成的实例添加完成时间（用于排序）
                            completedTime: isInstanceCompleted ? (instance.completedTime || reminder.repeat?.instanceCompletedTimes?.[originalKey] || getLocalDateTimeString(new Date(instance.date))) : undefined
                        };

                        // 按日期和完成状态分类（使用逻辑日期）
                        const instanceLogical = this.getTaskLogicalDate(instance.date, instance.time);
                        const dateComparison = compareDateStrings(instanceLogical, today);

                        let targetSubList;
                        if (dateComparison < 0) {
                            // 过去的日期
                            if (isInstanceCompleted) {
                                targetSubList = pastCompletedList;
                            } else {
                                targetSubList = pastIncompleteList;
                            }
                        } else if (dateComparison === 0) {
                            // 今天的日期（只收集未完成的）
                            if (!isInstanceCompleted) {
                                targetSubList = todayIncompleteList;
                            } else {
                                targetSubList = pastCompletedList; // 今天已完成算作过去
                            }
                        } else {
                            // 未来的日期
                            if (isInstanceCompleted) {
                                targetSubList = futureCompletedList;
                            } else {
                                targetSubList = futureIncompleteList;
                            }
                        }

                        targetSubList.push(instanceTask);
                        // Calculate cutoff time for subtask generation (prevent new subtasks in completed instances)
                        let cutoffTime: number | undefined;
                        // Use the exact completion time if available
                        const realCompletedTimeStr = instance.completedTime || reminder.repeat?.instanceCompletedTimes?.[originalKey] || reminder.repeat?.completedTimes?.[originalKey];

                        // If explicit time exists, use it
                        if (realCompletedTimeStr) {
                            cutoffTime = new Date(realCompletedTimeStr).getTime();
                        } else if (isInstanceCompleted) {
                            // If implicitly completed (e.g. past) or no time recorded, default to end of the instance date
                            // ensuring tasks created ON that day are included, but future tasks are excluded.
                            cutoffTime = new Date(`${instance.date}T23:59:59`).getTime();
                        }

                        // [NEW] 递归处理子任务的 ghost 实例
                        generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, targetSubList, reminderData, cutoffTime);
                    });

                    // 在合并前按 sort 排序，确保实例层的 sort 被应用
                    const sortBySort = (a: any, b: any) => (a.sort || 0) - (b.sort || 0);
                    pastIncompleteList.sort(sortBySort);
                    todayIncompleteList.sort(sortBySort);
                    futureIncompleteList.sort(sortBySort);
                    pastCompletedList.sort(sortBySort);
                    futureCompletedList.sort(sortBySort);

                    // 添加过去的未完成实例
                    allTasksWithInstances.push(...pastIncompleteList);

                    // 添加今天的未完成实例
                    allTasksWithInstances.push(...todayIncompleteList);

                    // 添加未来的第一个未完成实例（如果存在）
                    // 这样即使有多个已完成的未来实例，也能显示下一个未完成的实例
                    if (futureIncompleteList.length > 0) {
                        // 对于所有重复事件，如果今天没有未完成实例，就添加未来第一个未完成的
                        const hasTodayIncomplete = todayIncompleteList.length > 0;
                        if (!hasTodayIncomplete) {
                            // [Ghost logic] 确保同时添加该实例的所有 ghost 子任务
                            const firstInstanceDate = futureIncompleteList[0].date;
                            const firstInstanceGroup = futureIncompleteList.filter(inst => inst.date === firstInstanceDate);
                            allTasksWithInstances.push(...firstInstanceGroup);
                        }
                    }

                    // 添加所有已完成的实例（包括过去和未来的）- ProjectKanbanView需要显示已完成的实例
                    allTasksWithInstances.push(...pastCompletedList);
                    allTasksWithInstances.push(...futureCompletedList);
                }
            });

            this.tasks = await Promise.all(allTasksWithInstances.map(async (reminder: any) => {
                let status;
                if (reminder.parentId && taskMap.has(reminder.parentId)) {
                    // For ALL subtasks, their column is determined by their root parent's status
                    status = getRootStatus(reminder);
                } else {
                    // For top-level tasks, use their own status
                    status = this.getTaskStatus(reminder);
                }
                // 获取番茄钟计数（支持重复实例的单独计数）
                const pomodoroCount = await this.getReminderPomodoroCount(reminder.id, reminder, reminderData);
                const focusTime = await this.getReminderFocusTime(reminder.id, reminder, reminderData);

                let totalRepeatingPomodoroCount = 0;
                let totalRepeatingFocusTime = 0;
                if (reminder.isRepeatInstance) {
                    totalRepeatingPomodoroCount = this.pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(reminder.originalId);
                    totalRepeatingFocusTime = this.pomodoroRecordManager.getRepeatingEventTotalFocusTime(reminder.originalId);
                }

                return {
                    ...reminder,
                    status: status,
                    pomodoroCount: pomodoroCount,
                    focusTime: focusTime || 0,
                    totalRepeatingPomodoroCount,
                    totalRepeatingFocusTime
                };
            }));

            // [NEW] 搜索过滤逻辑
            if (this.searchKeyword) {
                const keywords = this.searchKeyword.toLowerCase().split(/\s+/).filter(k => !!k);
                const matches = (t: any) => {
                    const title = (t.title || '').toLowerCase();
                    const note = (t.note || '').toLowerCase();
                    const combined = `${title} ${note}`;
                    return keywords.every(k => combined.includes(k));
                };

                const matchingIds = new Set<string>();
                const taskMap = new Map(this.tasks.map(t => [t.id, t]));

                this.tasks.forEach(t => {
                    if (matches(t)) {
                        // 匹配的任务及其所有祖先都需要保留，以维持层级显示
                        let current = t;
                        while (current) {
                            matchingIds.add(current.id);
                            current = current.parentId ? taskMap.get(current.parentId) : null;
                        }
                    }
                });

                this.tasks = this.tasks.filter(t => matchingIds.has(t.id));
            }


            // [NEW] 标签(Tag)过滤逻辑
            if (this.isFilterActive) {
                if (this.selectedFilterTags.size === 0) {
                    this.tasks = [];
                } else {
                    const matchesTag = (t: any) => {
                        const tagIds = t.tagIds || [];
                        const hasNoTags = tagIds.length === 0;

                        if (this.selectedFilterTags.has('__no_tag__') && hasNoTags) return true;

                        // 如果任务有标签，检查是否有交集
                        if (tagIds.length > 0) {
                            return tagIds.some((id: string) => this.selectedFilterTags.has(id));
                        }

                        return false;
                    };

                    const matchingIds = new Set<string>();
                    const taskMap = new Map(this.tasks.map(t => [t.id, t]));

                    this.tasks.forEach(t => {
                        if (matchesTag(t)) {
                            // 匹配的任务及其所有祖先都需要保留
                            let current = t;
                            while (current) {
                                matchingIds.add(current.id);
                                current = current.parentId ? taskMap.get(current.parentId) : null;
                            }
                        }
                    });

                    this.tasks = this.tasks.filter(t => matchingIds.has(t.id));
                }
            }

            // [NEW] 日期过滤逻辑
            if (this.selectedDateFilters.size > 0 && !this.selectedDateFilters.has('all')) {
                const today = getLocalDateTimeString(new Date()).split(' ')[0];
                const startOfToday = new Date(today).getTime();
                // Get tomorrow date string
                const tomorrowDate = new Date();
                tomorrowDate.setDate(tomorrowDate.getDate() + 1);
                const tomorrow = getLocalDateTimeString(tomorrowDate).split(' ')[0];

                const matchesDate = (t: any) => {
                    // Check Completed Today
                    if (this.selectedDateFilters.has('completed_today')) {
                        if (t.completed && t.completedTime) {
                            if (t.completedTime.startsWith(today)) return true;
                        }
                    }

                    // For date-based filters, we look at active tasks or tasks with due dates
                    // (Unless user wants 'Today' to also include completed today? Usually 'Today' filter in Kanban implies Due Today)

                    // If task is completed, it usually doesn't show in "Today" unless it's "Completed Today" special filter.
                    // But if I have "Today" selected, and a task was done today, should it show?
                    // "Today" usually means "Due Today".
                    // "Today Completed" means "Done Today".

                    // Let's implement strict logic:
                    // 'today': logical date is today.
                    // 'tomorrow': logical date is tomorrow.

                    const logicalDate = this.getTaskLogicalDate(t.date, t.time);
                    // 获取任务的结束日期（逻辑日期，考虑时间因素）
                    const logicalEndDate = t.endDate ? this.getTaskLogicalDate(t.endDate, t.endTime) : null;

                    if (this.selectedDateFilters.has('today')) {
                        // 检查今天是否在任务的日期范围内
                        if (t.date) {
                            // 有结束日期：检查今天是否在 [开始日期, 结束日期] 范围内
                            if (logicalEndDate) {
                                if (compareDateStrings(today, logicalDate) >= 0 && compareDateStrings(today, logicalEndDate) <= 0) {
                                    return true;
                                }
                            } else {
                                // 无结束日期：只匹配开始日期为今天的任务
                                if (compareDateStrings(logicalDate, today) === 0) return true;
                            }
                        }
                    }

                    if (this.selectedDateFilters.has('tomorrow')) {
                        // 检查明天是否在任务的日期范围内
                        if (t.date) {
                            // 有结束日期：检查明天是否在 [开始日期, 结束日期] 范围内
                            if (logicalEndDate) {
                                if (compareDateStrings(tomorrow, logicalDate) >= 0 && compareDateStrings(tomorrow, logicalEndDate) <= 0) {
                                    return true;
                                }
                            } else {
                                // 无结束日期：只匹配开始日期为明天的任务
                                if (compareDateStrings(logicalDate, tomorrow) === 0) return true;
                            }
                        }
                    }




                    if (this.selectedDateFilters.has('other_date')) {
                        // Check if task has date, and it is NOT today and NOT tomorrow
                        if (t.date && compareDateStrings(logicalDate, today) !== 0 && compareDateStrings(logicalDate, tomorrow) !== 0) return true;
                    }

                    if (this.selectedDateFilters.has('no_date')) {
                        // Check if task has NO date property set
                        if (!t.date && !t.startDate && !t.createdTime) { // createdTime almost always exists, maybe too strict?
                            // Usually "No Date" means no 'date' or 'startDate' field.
                            return !t.date;
                        }
                        if (!t.date) return true;
                    }

                    return false;
                };

                const matchingIds = new Set<string>();
                const taskMap = new Map(this.tasks.map(t => [t.id, t]));

                this.tasks.forEach(t => {
                    if (matchesDate(t)) {
                        let current = t;
                        while (current) {
                            matchingIds.add(current.id);
                            current = current.parentId ? taskMap.get(current.parentId) : null;
                        }
                    }
                });

                this.tasks = this.tasks.filter(t => matchingIds.has(t.id));
            }

            // [NEW] 在应用里程碑过滤之前，统计每个状态/分组下是否“存在”带里程碑的任务
            // 这决定了对应的筛选按钮是否需要显示（即使当前已经被里程碑过滤器过滤掉了部分任务，按钮也应保留以便取消过滤）
            this._statusHasMilestoneTasks.clear();
            this._availableMilestonesInView.clear();
            this._statusGroupsInView.clear();
            this._statusMilestonesInView.clear();
            // 创建任务映射以便查找父任务
            const taskMapForStats = new Map(this.tasks.map(t => [t.id, t]));

            this.tasks.forEach(t => {
                const status = t.status || this.getTaskStatus(t);
                const customGroup = t.customGroupId || 'ungrouped';

                // 统计每个状态列下有哪些分组存在（用于筛选菜单显示）
                if (!this._statusGroupsInView.has(status)) {
                    this._statusGroupsInView.set(status, new Set());
                }
                this._statusGroupsInView.get(status)!.add(customGroup);

                // 获取任务的有效里程碑（考虑继承父任务的情况）
                let effectiveMilestoneId = t.milestoneId;
                if (!effectiveMilestoneId && t.parentId) {
                    // 如果子任务没有里程碑，尝试继承父任务的里程碑
                    const parentTask = taskMapForStats.get(t.parentId);
                    if (parentTask) {
                        effectiveMilestoneId = parentTask.milestoneId;
                    }
                }

                if (effectiveMilestoneId) {
                    // 检查是否为已归档里程碑
                    const msInfo = this.milestoneMap.get(effectiveMilestoneId);
                    // 已完成任务或任务状态看板模式下，允许显示已归档里程碑
                    const allowArchived = status === 'completed' || this.kanbanMode === 'status';
                    if (msInfo && (!msInfo.archived || allowArchived)) {
                        this._statusHasMilestoneTasks.add(status);
                        this._statusHasMilestoneTasks.add(customGroup);
                        this._availableMilestonesInView.add(effectiveMilestoneId);
                        // 统计每个状态列下使用的里程碑
                        if (!this._statusMilestonesInView.has(status)) {
                            this._statusMilestonesInView.set(status, new Set());
                        }
                        this._statusMilestonesInView.get(status)!.add(effectiveMilestoneId);
                        // 同时统计自定义分组下的里程碑（用于自定义分组视图）
                        if (!this._statusMilestonesInView.has(customGroup)) {
                            this._statusMilestonesInView.set(customGroup, new Set());
                        }
                        this._statusMilestonesInView.get(customGroup)!.add(effectiveMilestoneId);
                    }
                }
            });

            // 里程碑过滤逻辑 (移动至此处，以便在统计"任务是否有里程碑"后进行应用)
            if (this.selectedFilterMilestones.size > 0) {
                const matchesMilestone = (t: any) => {
                    let filterKey: string | null = null;
                    if (this.kanbanMode === 'custom') {
                        filterKey = t.customGroupId || 'ungrouped';
                    } else if (this.kanbanMode === 'status') {
                        // 使用已计算好的 status 字段
                        filterKey = t.status;
                    } else if (this.kanbanMode === 'list') {
                        filterKey = t.customGroupId || 'ungrouped';
                    }

                    if (!filterKey || !this.selectedFilterMilestones.has(filterKey)) {
                        return true;
                    }

                    const set = this.selectedFilterMilestones.get(filterKey);
                    if (!set) return true;

                    // 如果 Set 为空，不显示任何任务
                    if (set.size === 0) {
                        return false;
                    }

                    // 获取任务的有效里程碑（考虑继承父任务的情况）
                    let effectiveMilestoneId = t.milestoneId;
                    if (!effectiveMilestoneId && t.parentId) {
                        const parentTask = taskMap.get(t.parentId);
                        if (parentTask) {
                            effectiveMilestoneId = parentTask.milestoneId;
                        }
                    }

                    if (!effectiveMilestoneId) {
                        return set.has('__no_milestone__');
                    }
                    return set.has(effectiveMilestoneId);
                };

                const taskMap = new Map(this.tasks.map(t => [t.id, t]));
                const childrenMap = new Map<string, any[]>();
                this.tasks.forEach(t => {
                    if (t.parentId && taskMap.has(t.parentId)) {
                        if (!childrenMap.has(t.parentId)) childrenMap.set(t.parentId, []);
                        childrenMap.get(t.parentId)!.push(t);
                    }
                });

                // 1. 识别直接匹配里程碑过滤器的任务
                const directMatches = new Set<string>();
                this.tasks.forEach(t => {
                    if (matchesMilestone(t)) {
                        directMatches.add(t.id);
                    }
                });

                // 2. 收集包含子任务的集合
                const includedIds = new Set<string>();
                const addWithDescendants = (taskId: string) => {
                    if (includedIds.has(taskId)) return;
                    includedIds.add(taskId);

                    const children = childrenMap.get(taskId) || [];
                    for (const child of children) {
                        // [关键改动] 如果子任务没有设置里程碑，则跟随父任务显示
                        if (!child.milestoneId) {
                            addWithDescendants(child.id);
                        }
                    }
                };

                directMatches.forEach(id => addWithDescendants(id));

                // 3. 向上追溯祖先，确保路径完整
                const finalIds = new Set<string>();
                includedIds.forEach(id => {
                    let current = taskMap.get(id);
                    while (current) {
                        finalIds.add(current.id);
                        current = current.parentId ? taskMap.get(current.parentId) : null;
                    }
                });

                this.tasks = this.tasks.filter(t => finalIds.has(t.id));
            }

            this.sortTasks();

            // 默认折叠逻辑：
            // - 首次加载（或用户无任何折叠偏好）时，按照旧逻辑为非 doing 的父任务设置为折叠状态；
            // - 之后的加载尽量保留用户通过界面展开/折叠的偏好（即不再盲目 clear 并重新折叠已展开的父任务）；
            // - 同时移除那些已经不存在的任务 id，防止内存泄漏或过期状态。
            try {
                // 如果外部（例如 queueLoadTasks）请求在本次加载后恢复某些父任务折叠状态，优先恢复
                if (this._preserveCollapsedTasks && this._preserveCollapsedTasks.size > 0) {
                    this.collapsedTasks = new Set(this._preserveCollapsedTasks);
                    this._preserveCollapsedTasks = null;
                }
                const taskIds = new Set(this.tasks.map(t => t.id));

                // 清理 collapsedTasks 中已不存在的任务 id
                for (const id of Array.from(this.collapsedTasks)) {
                    if (!taskIds.has(id)) {
                        this.collapsedTasks.delete(id);
                    }
                }

                // 收集父任务及其子任务
                const parentMap = new Map<string, any[]>();
                this.tasks.forEach(t => {
                    if (t.parentId && taskIds.has(t.parentId)) {
                        if (!parentMap.has(t.parentId)) parentMap.set(t.parentId, []);
                        parentMap.get(t.parentId)!.push(t);
                    }
                    // 初始化折叠状态：如果任务有明确的 fold 属性，则根据该属性设置
                    if (t.fold === true) {
                        this.collapsedTasks.add(t.id);
                    } else if (t.fold === false) {
                        this.collapsedTasks.delete(t.id);
                    }
                });

                // 仅在首次加载且用户既没有明确的折叠/展开偏号（tasks 中都没有 fold 属性）
                // 且当前 collapsedTasks 为空时，才应用默认折叠策略
                const hasExplicitFold = this.tasks.some(t => t.fold !== undefined);
                if (!this._defaultCollapseApplied && !hasExplicitFold && this.collapsedTasks.size === 0) {
                    parentMap.forEach((_children, parentId) => {
                        const parent = this.tasks.find(p => p.id === parentId);
                        if (!parent) return;
                        // 默认折叠所有父任务
                        this.collapsedTasks.add(parentId);
                    });
                    this._defaultCollapseApplied = true;
                }
            } catch (err) {
                console.warn('设置默认折叠任务失败:', err);
            }


            // 重置分页索引，防止页码超出范围
            try {
                const counts = {
                    doing: this.tasks.filter(t => t.status === 'doing').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    short_term: this.tasks.filter(t => t.status === 'short_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    long_term: this.tasks.filter(t => t.status === 'long_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    completed: this.tasks.filter(t => t.status === 'completed').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                };
                for (const status of ['doing', 'short_term', 'long_term', 'completed']) {
                    const totalTop = counts[status as keyof typeof counts] || 0;
                    const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
                    const current = this.pageIndexMap[status] || 1;
                    this.pageIndexMap[status] = Math.min(Math.max(1, current), totalPages);
                }
            } catch (err) {
                // ignore
            }

            this.renderKanban();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage("加载任务失败");
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 防抖加载任务队列：避免短时间多次触发导致界面频繁重绘和滚动位置丢失
     */
    private queueLoadTasks(): Promise<void> {
        // 如果已有挂起的 promise，则复用
        if (!this._pendingLoadPromise) {
            this._pendingLoadPromise = new Promise<void>((resolve) => { this._pendingLoadResolve = resolve; });
        }

        // 在防抖定时执行前，缓存当前父任务折叠状态，避免在短时间内新建子任务等操作导致折叠状态丢失或被重置
        try {
            this._preserveCollapsedTasks = new Set(this.collapsedTasks);
        } catch (e) {
            this._preserveCollapsedTasks = null;
        }

        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        this._debounceTimer = setTimeout(async () => {
            try {
                await this.loadTasks();
            } catch (e) {
                console.error('queueLoadTasks 执行 loadTasks 时出错', e);
            } finally {
                if (this._pendingLoadResolve) {
                    this._pendingLoadResolve();
                }
                this._pendingLoadPromise = null;
                this._pendingLoadResolve = null;
                this._debounceTimer = null;
            }
        }, this._debounceDelay);

        return this._pendingLoadPromise as Promise<void>;
    }

    /**
     * 保存当前水平滚动（看板容器）和每列纵向滚动位置
     */
    private captureScrollState() {
        try {
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement | null;
            const containerScrollLeft = kanbanContainer ? kanbanContainer.scrollLeft : this.container.scrollLeft;
            const columnScrollTopMap: { [key: string]: number } = {};

            const columns = this.container.querySelectorAll('.kanban-column');
            columns.forEach((col) => {
                const content = col.querySelector('.kanban-column-content') as HTMLElement | null;
                if (content) {
                    const htmlCol = col as HTMLElement;
                    const status = (htmlCol.getAttribute('data-status') || htmlCol.dataset.status) || (htmlCol.getAttribute('data-group-id') || htmlCol.dataset.groupId) || '';
                    const key = status ? status : `col-${Array.prototype.indexOf.call(columns, col)}`;
                    columnScrollTopMap[key] = content.scrollTop || 0;
                }
            });

            this._savedScrollState = {
                containerScrollLeft: containerScrollLeft || 0,
                columnScrollTopMap
            };
        } catch (err) {
            console.warn('保存滚动状态失败', err);
            this._savedScrollState = null;
        }
    }

    /**
     * 恢复之前保存的滚动位置
     */
    private restoreScrollState() {
        if (!this._savedScrollState) return;
        try {
            const { containerScrollLeft, columnScrollTopMap } = this._savedScrollState;
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement | null;
            if (kanbanContainer) {
                // 立即恢复，如果失败再使用 setTimeout
                try {
                    kanbanContainer.scrollLeft = containerScrollLeft;
                } catch (e) { /* ignore */ }

                // setTimeout to ensure layout updated (as a safety fallback)
                setTimeout(() => {
                    try {
                        kanbanContainer.scrollLeft = Math.max(0, Math.min(kanbanContainer.scrollWidth - kanbanContainer.clientWidth, containerScrollLeft));
                    } catch (e) { /* ignore */ }
                }, 0);
            } else {
                // fallback
                try { this.container.scrollLeft = containerScrollLeft; } catch (e) { /* ignore */ }
            }

            // Restore columns' vertical scroll
            Object.keys(columnScrollTopMap).forEach(key => {
                // try find by status first
                let content: HTMLElement | null = null;
                if (key.startsWith('col-')) {
                    // index-based key
                    const idx = parseInt(key.replace('col-', ''), 10);
                    const columns = this.container.querySelectorAll('.kanban-column');
                    const col = columns && columns[idx] as HTMLElement | undefined;
                    content = col ? col.querySelector('.kanban-column-content') as HTMLElement : null;
                } else {
                    // try match by data-status or data-group-id
                    content = this.container.querySelector(`.kanban-column[data-status="${key}"] .kanban-column-content`) as HTMLElement;
                    if (!content) {
                        content = this.container.querySelector(`.kanban-column[data-group-id="${key}"] .kanban-column-content`) as HTMLElement;
                    }
                }
                if (content) {
                    const top = columnScrollTopMap[key] || 0;
                    // 立即恢复垂直滚动
                    try {
                        content.scrollTop = top;
                    } catch (e) { /* ignore */ }

                    // setTimeout as fallback
                    setTimeout(() => {
                        try {
                            content.scrollTop = Math.max(0, Math.min(content.scrollHeight - content.clientHeight, top));
                        } catch (e) { /* ignore */ }
                    }, 0);
                }
            });
        } catch (err) {
            console.warn('恢复滚动状态失败', err);
        } finally {
            this._savedScrollState = null;
        }
    }

    /**
     * 获取提醒的番茄钟计数（支持重复实例的单独计数）
     * @param reminderId 提醒ID
     * @returns 番茄钟计数
     */
    private async getReminderPomodoroCount(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const pomodoroManager = this.pomodoroRecordManager;
            // Repeat instances should be shown as per-instance totals
            if (reminder && reminder.isRepeatInstance) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        rawData = await this.getReminders();
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

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
            // For parent: return aggregated count
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
            const pomodoroManager = this.pomodoroRecordManager;
            // If repeat instance, use per-event total
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

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        rawData = await this.getReminders();
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
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
                    if (!pomodoroManager['isInitialized']) await pomodoroManager.initialize();
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
            }

            // default to per-event total
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
     * 静态方法：计算给定项目的顶级任务在 kanbanStatus 上的数量（只计顶级，即没有 parentId）
     * 使用与 getTaskStatus 相同的逻辑，包括日期自动归档到进行中的逻辑
     */
    public static countTopLevelTasksByStatus(projectId: string, reminderData: any, kanbanStatuses?: Array<{ id: string; name?: string }>): { counts: Record<string, number>; completed: number } {
        const allReminders = reminderData && typeof reminderData === 'object' ? Object.values(reminderData) : [];
        const today = getLogicalDateString();

        // Build initial counts map based on provided kanbanStatuses or fallback to legacy keys
        const counts: Record<string, number> = {};
        if (kanbanStatuses && Array.isArray(kanbanStatuses) && kanbanStatuses.length > 0) {
            kanbanStatuses.forEach(s => counts[s.id] = 0);
            if (!counts['completed']) counts['completed'] = 0;
        } else {
            counts['doing'] = 0;
            counts['short_term'] = 0;
            counts['long_term'] = 0;
            counts['completed'] = 0;
        }

        const firstNonCompletedStatus = Object.keys(counts).find(k => k !== 'completed') || null;

        const safeInc = (statusId: string | null) => {
            if (!statusId) {
                if (firstNonCompletedStatus) counts[firstNonCompletedStatus] = (counts[firstNonCompletedStatus] || 0) + 1;
                return;
            }
            if (counts.hasOwnProperty(statusId)) counts[statusId] = (counts[statusId] || 0) + 1;
            else if (firstNonCompletedStatus) counts[firstNonCompletedStatus] = (counts[firstNonCompletedStatus] || 0) + 1;
        };

        allReminders.forEach((r: any) => {
            if (!r || typeof r !== 'object') return;
            const hasParent = r.hasOwnProperty('parentId') && r.parentId !== undefined && r.parentId !== null && String(r.parentId).trim() !== '';
            if (r.projectId !== projectId || hasParent) return;

            const isCompletedFlag = !!r.completed || (r.completedTime !== undefined && r.completedTime !== null && String(r.completedTime).trim() !== '');

            if (r.repeat && r.repeat.enabled) {
                const completedInstances = r.repeat.completedInstances || [];

                const rangeStart = r.startDate || r.date || r.createdTime?.split('T')[0] || '2020-01-01';
                const futureDate = new Date();
                futureDate.setDate(futureDate.getDate() + 365);
                const rangeEnd = getLocalDateString(futureDate);

                let repeatInstances: any[] = [];
                try {
                    repeatInstances = generateRepeatInstances(r, rangeStart, rangeEnd);
                } catch (e) {
                    console.error('生成重复实例失败', e);
                    repeatInstances = [];
                }

                let hasTodayIncomplete = false;
                const futureIncompleteList: any[] = [];

                repeatInstances.forEach((instance: any) => {
                    const instanceIdStr = (instance as any).instanceId || `${r.id}_${instance.date}`;
                    const originalKey = instanceIdStr.split('_').pop() || instance.date;
                    const isInstanceCompleted = completedInstances.includes(originalKey);
                    const instanceLogical = this.getTaskLogicalDate(instance.date, instance.time);
                    const dateComparison = compareDateStrings(instanceLogical, today);

                    if (isInstanceCompleted) {
                        counts['completed'] = (counts['completed'] || 0) + 1;
                    } else {
                        const effectiveStatus = instance.kanbanStatus || null;
                        if (dateComparison <= 0) {
                            // past or today -> prefer a 'doing' status if present
                            if (counts.hasOwnProperty('doing')) safeInc('doing');
                            else safeInc(effectiveStatus);
                            if (dateComparison === 0) hasTodayIncomplete = true;
                        } else {
                            futureIncompleteList.push({ ...instance });
                        }
                    }
                });

                if (!hasTodayIncomplete && futureIncompleteList.length > 0) {
                    const firstFuture = futureIncompleteList[0];
                    const eff = firstFuture.kanbanStatus || null;
                    if (eff) safeInc(eff);
                    else if (firstFuture.termType === 'long_term' && counts.hasOwnProperty('long_term')) safeInc('long_term');
                    else if (counts.hasOwnProperty('short_term')) safeInc('short_term');
                    else safeInc(null);
                }

            } else {
                if (isCompletedFlag) {
                    counts['completed'] = (counts['completed'] || 0) + 1;
                    return;
                }

                const eff = r.kanbanStatus || null;
                if (eff && eff !== 'completed') {
                    safeInc(eff);
                    return;
                }

                if (r.date) {
                    const logicalR = this.getTaskLogicalDate(r.date, r.time);
                    const dateComparison = compareDateStrings(logicalR, today);
                    if (dateComparison <= 0) {
                        if (counts.hasOwnProperty('doing')) safeInc('doing');
                        else safeInc(null);
                        return;
                    }
                }

                if (r.termType === 'long_term' && counts.hasOwnProperty('long_term')) {
                    safeInc('long_term');
                } else if (r.termType === 'doing' && counts.hasOwnProperty('doing')) {
                    safeInc('doing');
                } else if (counts.hasOwnProperty('short_term')) {
                    safeInc('short_term');
                } else {
                    safeInc(null);
                }
            }
        });

        return { counts, completed: counts['completed'] || 0 };
    }

    /**
     * 计算任务的看板状态
     * 优先使用kanbanStatus
     */
    private getTaskStatus(task: any): string {
        // 如果任务已完成，直接返回
        if (task.completed) return 'completed';

        // 如果有 kanbanStatus 且是有效的状态ID，使用之
        if (task.kanbanStatus) {
            const validStatus = this.kanbanStatuses.find(s => s.id === task.kanbanStatus);
            if (validStatus) return task.kanbanStatus;
        }

        // 默认返回进行中
        return 'doing';
    }

    /**
     * 计算任务的嵌套层级
     * @param taskId 任务ID
     * @returns 层级（0为顶层）
     */
    private calculateTaskLevel(taskId: string): number {
        let level = 0;
        let currentId = taskId;
        const taskMap = new Map();
        this.tasks.forEach(t => taskMap.set(t.id, t));

        const visited = new Set();
        while (currentId && !visited.has(currentId)) {
            visited.add(currentId);
            const task = taskMap.get(currentId);
            if (!task || !task.parentId) break;

            // 检查父任务是否存在于当前任务列表中
            const parentTask = taskMap.get(task.parentId);
            if (!parentTask) break;

            level++;
            currentId = task.parentId;
            if (level > 10) break; // 限制最大深度
        }
        return level;
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': i18n('sortingTime'),
                'priority': i18n('sortingPriority'),
                'title': i18n('sortingTitle')
            };
            const orderNames = {
                'asc': i18n('ascendingOrder'),
                'desc': i18n('descendingOrder')
            };
            this.sortButton.title = `${i18n('sortBy')}: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private updateDoneSortButtonTitle() {
        if (this.doneSortButton) {
            const sortNames = {
                'completedTime': i18n('sortByCompletedTime'),
                'title': i18n('sortingTitle'),
                'priority': i18n('sortingPriority'),
                'time': i18n('sortBySetTime')
            };
            const orderNames = {
                'asc': i18n('ascendingOrder'),
                'desc': i18n('descendingOrder')
            };
            this.doneSortButton.title = `${i18n('sortBy')}: ${sortNames[this.doneSort] || i18n('sortByCompletedTime')} (${orderNames[this.doneSortOrder] || i18n('descendingOrder')})`;
        }
    }

    private sortTasks() {
        this.tasks.sort((a, b) => {
            // 特殊处理时间排序：无日期任务总是排在最后
            if (this.currentSort === 'time') {
                const hasDateA = !!a.date;
                const hasDateB = !!b.date;

                if (hasDateA && !hasDateB) return -1;
                if (!hasDateA && hasDateB) return 1;
                if (!hasDateA && !hasDateB) {
                    return this.compareByCreatedAt(b, a);
                }

                const result = this.compareByTime(a, b);
                return this.currentSortOrder === 'desc' ? -result : result;
            }

            let result = 0;

            switch (this.currentSort) {
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                case 'createdAt':
                    result = this.compareByCreatedAt(a, b);
                    break;
                default:
                    result = this.compareByPriority(a, b);
            }

            // 优先级排序的结果相反
            if (this.currentSort === 'priority') {
                result = -result;
            }

            return this.currentSortOrder === 'desc' ? -result : result;
        });
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 1. 按优先级排序
        const priorityDiff = priorityB - priorityA; // 高优先级在前
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 2. 同优先级内按手动排序（支持重复实例）
        const sortA = this.getTaskSortValue(a);
        const sortB = this.getTaskSortValue(b);

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 3. 如果手动排序值也相同，按时间排序（考虑跨天事件和全天事件）
        const timeResult = this.compareByTime(a, b);
        if (timeResult !== 0) {
            return timeResult;
        }

        // 4. 最后兜底：按创建时间排序
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeB - timeA; // 最新创建的在前
    }

    /**
     * 获取任务的排序值（支持重复实例）
     */
    private getTaskSortValue(task: any): number {
        if (!task) return 0;

        // 如果是重复实例，从 instanceModifications 中读取
        // 使用原始日期（从 ID 中提取）作为键，因为 date 可能已被修改
        if (task.isRepeatInstance && task.originalId && task.id && task.id.includes('_')) {
            const originalInstanceDate = task.id.split('_').pop();
            // 从 reminderData 缓存中查找原始任务
            const originalTask = this.reminderData?.[task.originalId];
            if (originalTask?.repeat?.instanceModifications?.[originalInstanceDate]) {
                return originalTask.repeat.instanceModifications[originalInstanceDate].sort ?? task.sort ?? 0;
            }
        }

        // 普通任务或没有 instanceModifications 的实例
        return task.sort || 0;
    }

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

    // 优先级数值比较（用于时间相同时的排序）
    private compareByPriorityValue(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        return priorityB - priorityA; // 高优先级在前
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const titleCompare = titleA.localeCompare(titleB, 'zh-CN');
        if (titleCompare !== 0) {
            return titleCompare;
        }
        // 标题相同时，按手动排序值排序（支持重复实例）
        const sortA = this.getTaskSortValue(a);
        const sortB = this.getTaskSortValue(b);
        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }
        // 手动排序值也相同时，按时间排序（考虑跨天事件和全天事件）
        const timeResult = this.compareByTime(a, b);
        if (timeResult !== 0) {
            return timeResult;
        }
        // 最后兜底：按创建时间排序
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeB - timeA; // 最新创建的在前
    }

    private compareByCreatedAt(a: any, b: any): number {
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeA - timeB;
    }

    private compareByCompletedTime(a: any, b: any): number {
        const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
        const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
        if (timeA === timeB) {
            return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
        }
        return timeA - timeB;
    }

    private openCalendarForProject() {
        this.plugin.openCalendarTab({ projectFilter: this.projectId });
    }

    private sortDoneTasks(tasks: any[]): any[] {
        const sortedTasks = [...tasks];
        sortedTasks.sort((a, b) => {
            // 特殊处理时间排序
            if (this.doneSort === 'time') {
                const hasDateA = !!a.date;
                const hasDateB = !!b.date;

                if (hasDateA && !hasDateB) return -1;
                if (!hasDateA && hasDateB) return 1;
                if (!hasDateA && !hasDateB) {
                    return this.compareByCreatedAt(b, a);
                }

                const result = this.compareByTime(a, b);
                return this.doneSortOrder === 'desc' ? -result : result;
            }

            let result = 0;
            switch (this.doneSort) {
                case 'completedTime':
                    result = this.compareByCompletedTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'createdAt':
                    result = this.compareByCreatedAt(a, b);
                    break;
                default:
                    result = this.compareByCompletedTime(a, b);
            }

            if (this.doneSort === 'priority') {
                result = -result;
            }

            return this.doneSortOrder === 'desc' ? -result : result;
        });
        return sortedTasks;
    }

    private async renderKanban() {
        // 保存滚动位置（如果还没有被上层保存）
        if (!this._savedScrollState) this.captureScrollState();

        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (kanbanContainer) {
            // 只有在项目变了或者模式变了的时候才全量清空，避免水平滚动条跳动
            if (this._lastRenderedProjectId !== this.projectId || this._lastRenderMode !== this.kanbanMode) {
                kanbanContainer.innerHTML = '';
                this._lastRenderedProjectId = this.projectId;
                this._lastRenderMode = this.kanbanMode;
            }
        }

        if (this.kanbanMode === 'status') {
            await this.renderStatusKanban();
        } else if (this.kanbanMode === 'list') {
            await this.renderListKanban();
        } else {
            await this.renderCustomGroupKanban();
        }

        // 恢复滚动位置（如果有的话）
        this.restoreScrollState();
        this.checkVip();
    }

    private async renderCustomGroupKanban() {
        // 使用项目管理器获取自定义分组
        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

        // 过滤掉已归档的分组，并按 sort 字段排序
        const activeGroups = projectGroups
            .filter((g: any) => !g.archived)
            .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        if (activeGroups.length === 0) {
            // 如果没有自定义分组，显示提示
            this.renderEmptyCustomGroupKanban();
            return;
        }

        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // [修改/完善] 移除不再存在的分组列（例如已归档或已删除的分组）
        const activeGroupIds = new Set(activeGroups.map((g: any) => g.id));
        activeGroupIds.add('ungrouped'); // 虽然未分组在后面单独处理，但这里先排除它防止被提前移除

        const allColumns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
        allColumns.forEach(col => {
            const gid = (col as HTMLElement).dataset.groupId;
            // 只有属于自定义分组的列才在这里处理
            if (gid && (col.classList.contains(`kanban-column-custom-group-${gid}`) || gid === 'ungrouped')) {
                if (!activeGroupIds.has(gid)) {
                    col.remove();
                }
            }
        });

        // 移除可能存在的空状态提示
        const emptyState = kanbanContainer.querySelector('.empty-custom-group-state');
        if (emptyState) {
            emptyState.remove();
        }

        // 按 kanbanStatuses 中定义的所有状态分组任务
        const statusTasks: { [status: string]: any[] } = {};
        this.kanbanStatuses.forEach(status => {
            if (status.id === 'completed') {
                // 已完成任务单独处理（按完成时间排序）
                const completed = this.tasks.filter(task => task.completed);
                completed.sort((a, b) => {
                    const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
                    const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
                    return timeB - timeA;
                });
                statusTasks[status.id] = completed;
            } else {
                // 未完成任务按状态分组
                statusTasks[status.id] = this.tasks.filter(task => !task.completed && this.getTaskStatus(task) === status.id);
            }
        });

        const todayStr = getLogicalDateString();

        // 为每个自定义分组创建状态子列（使用 kanbanStatuses 中定义的所有状态）
        activeGroups.forEach((group: any) => {
            const groupStatusTasks: { [status: string]: any[] } = {};
            this.kanbanStatuses.forEach(status => {
                groupStatusTasks[status.id] = statusTasks[status.id].filter(task => task.customGroupId === group.id);
            });

            if (this.project?.hideNoDoingGroups) {
                const doingTasks = groupStatusTasks['doing'] || [];
                if (doingTasks.length === 0) {
                    const columnId = `custom-group-${group.id}`;
                    const column = kanbanContainer.querySelector(`.kanban-column-${columnId}`);
                    if (column) column.remove();
                    return; // 隐藏没有进行中任务的分组
                }
            }

            if (this.project?.hideNoTodayGroups) {
                let hasToday = false;
                for (const statusId in groupStatusTasks) {
                    if (groupStatusTasks[statusId].some(task => {
                        return task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), todayStr) === 0;
                    })) {
                        hasToday = true;
                        break;
                    }
                }
                if (!hasToday) {
                    const columnId = `custom-group-${group.id}`;
                    const column = kanbanContainer.querySelector(`.kanban-column-${columnId}`);
                    if (column) column.remove();
                    return; // 隐藏没有今日任务的分组
                }
            }

            // 即使没有任务也要显示分组列
            this.renderCustomGroupColumnWithStatuses(group, groupStatusTasks);

            // 确保 DOM 顺序正确：通过重新 append 将列移动到正确的位置
            const columnId = `custom-group-${group.id}`;
            const column = kanbanContainer.querySelector(`.kanban-column-${columnId}`);
            if (column) {
                kanbanContainer.appendChild(column);
            }
        });

        // 处理未分组任务：仅在存在未分组任务时显示未分组列
        const validGroupIds = new Set(activeGroups.map((g: any) => g.id));
        const ungroupedStatusTasks: { [status: string]: any[] } = {};
        let hasUngrouped = false;
        this.kanbanStatuses.forEach(status => {
            ungroupedStatusTasks[status.id] = statusTasks[status.id].filter(task => !task.customGroupId || !validGroupIds.has(task.customGroupId));
            if (ungroupedStatusTasks[status.id].length > 0) {
                hasUngrouped = true;
            }
        });

        if (this.project?.hideNoDoingGroups) {
            const doingTasks = ungroupedStatusTasks['doing'] || [];
            if (doingTasks.length === 0) {
                hasUngrouped = false;
            }
        }

        if (this.project?.hideNoTodayGroups && hasUngrouped) {
            let hasToday = false;
            for (const statusId in ungroupedStatusTasks) {
                if (ungroupedStatusTasks[statusId].some(task => {
                    return task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), todayStr) === 0;
                })) {
                    hasToday = true;
                    break;
                }
            }
            if (!hasToday) {
                hasUngrouped = false;
            }
        }

        if (hasUngrouped) {
            // 获取项目的所有未归档默认里程碑
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];
            const defaultMilestones = (project?.milestones || []).filter((m: any) => !m.archived);

            const ungroupedGroup = {
                id: 'ungrouped',
                name: '未分组',
                color: '#95a5a6',
                icon: '📋',
                milestones: defaultMilestones
            };
            this.renderCustomGroupColumnWithStatuses(ungroupedGroup, ungroupedStatusTasks);

            // 确保未分组列在最后
            const ungroupedColumn = kanbanContainer.querySelector(`.kanban-column-custom-group-ungrouped`);
            if (ungroupedColumn) {
                kanbanContainer.appendChild(ungroupedColumn);
            }
        } else {
            // 如果没有未分组任务，移除可能存在的未分组列 DOM
            const existing = kanbanContainer.querySelector(`.kanban-column-custom-group-ungrouped`);
            if (existing && existing.parentNode) {
                existing.parentNode.removeChild(existing);
            }
        }

        // 为自定义分组列添加列级拖拽支持（可以直接拖动列头调整分组顺序）
        try {
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
            if (kanbanContainer && !kanbanContainer.dataset.hasColumnDropHandlers) {
                kanbanContainer.dataset.hasColumnDropHandlers = '1';

                kanbanContainer.addEventListener('dragover', (e) => {
                    try {
                        const dt = (e as DragEvent).dataTransfer;
                        if (!dt && !this.draggedGroupId) return;

                        let draggedId = '';
                        try { if (dt) draggedId = dt.getData('text/plain') || ''; } catch (err) { draggedId = ''; }
                        if (!draggedId) draggedId = this.draggedGroupId || '';
                        if (!draggedId) return;

                        e.preventDefault();
                        if (dt) dt.dropEffect = 'move';

                        // 清除已有指示器（DOM 中的）
                        if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                            this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                            this._columnDropIndicator = null;
                        }

                        // 获取所有自定义分组列（含未分组），并过滤掉被拖拽的列
                        let columns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
                        columns = columns.filter(c => !!c.dataset.groupId);
                        columns = columns.filter(c => (c.dataset.groupId || '') !== draggedId);

                        const createIndicator = (beforeEl: HTMLElement | null) => {
                            const indicator = document.createElement('div');
                            indicator.className = 'column-drop-indicator';
                            indicator.style.cssText = `
                                width: 6px;
                                background-color: var(--b3-theme-primary);
                                border-radius: 3px;
                                margin: 0 6px;
                                align-self: stretch;
                            `;
                            if (beforeEl) kanbanContainer.insertBefore(indicator, beforeEl);
                            else kanbanContainer.appendChild(indicator);
                            this._columnDropIndicator = indicator;
                        };

                        if (columns.length === 0) {
                            createIndicator(null);
                            return;
                        }

                        const clientX = (e as DragEvent).clientX;
                        let inserted = false;
                        for (const col of columns) {
                            const rect = col.getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (clientX < midpoint) {
                                createIndicator(col);
                                inserted = true;
                                break;
                            }
                        }

                        if (!inserted) createIndicator(null);
                    } catch (err) {
                        // ignore
                    }
                });

                kanbanContainer.addEventListener('dragleave', (e) => {
                    const related = (e as any).relatedTarget as Node;
                    if (!related || !kanbanContainer.contains(related)) {
                        if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                            this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                        }
                        this._columnDropIndicator = null;
                    }
                });

                kanbanContainer.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                        this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                    }
                    this._columnDropIndicator = null;

                    let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || '';
                    if (!draggedId) draggedId = this.draggedGroupId || '';
                    if (!draggedId) return;

                    try {
                        const projectManager = this.projectManager;
                        const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                        const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
                        if (draggedIndex === -1) return;

                        // 基于鼠标位置计算插入索引（忽略被拖拽列）
                        let columns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
                        columns = columns.filter(c => !!c.dataset.groupId);
                        // 排除被拖拽的列 DOM
                        const columnsFiltered = columns.filter(c => (c.dataset.groupId || '') !== draggedId);

                        const clientX = (e as DragEvent).clientX;
                        let insertIndex = columnsFiltered.length; // 默认末尾
                        for (let i = 0; i < columnsFiltered.length; i++) {
                            const rect = columnsFiltered[i].getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (clientX < midpoint) { insertIndex = i; break; }
                        }

                        // 从原数组移除并插入到目标位置
                        const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                        currentGroups.splice(insertIndex, 0, draggedGroup);

                        // 重新分配排序值并保存
                        currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                        await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                        // 刷新看板（使用防抖队列以避免滚动位置被重置）
                        this.queueLoadTasks();
                        showMessage('分组顺序已更新');
                    } catch (error) {
                        console.error('更新自定义分组顺序失败:', error);
                        showMessage('更新分组顺序失败');
                    }
                });
            }
        } catch (err) {
            // ignore
        }
    }

    /**
     * 批量设置标签
     */
    private async batchSetTags(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        try {
            const tags = await this.projectManager.getProjectTags(this.projectId);

            const dialog = new Dialog({
                title: i18n('batchSetTags') || '批量设置标签',
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('selectTags') || '选择标签'}</label>
                            <div class="tags-container" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                                <!-- Tags will be rendered here -->
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchTagsCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="batchTagsSave">${i18n('save')}</button>
                    </div>
                `,
                width: '400px'
            });

            const tagsContainer = dialog.element.querySelector('.tags-container') as HTMLElement;
            const cancelBtn = dialog.element.querySelector('#batchTagsCancel') as HTMLButtonElement;
            const saveBtn = dialog.element.querySelector('#batchTagsSave') as HTMLButtonElement;

            const selectedTags = new Set<string>();

            // 渲染标签列表
            if (tags.length === 0) {
                tagsContainer.innerHTML = `<div style="color: var(--b3-theme-on-surface-light); text-align: center; padding: 10px;">${i18n('noTags') || '暂无标签'}</div>`;
            } else {
                tags.forEach(tag => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display: flex; align-items: center; padding: 4px; cursor: pointer; user-select: none;';
                    label.className = 'b3-label';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'b3-switch';
                    checkbox.style.marginRight = '8px';
                    checkbox.value = tag.id;

                    checkbox.addEventListener('change', () => {
                        if (checkbox.checked) {
                            selectedTags.add(tag.id);
                        } else {
                            selectedTags.delete(tag.id);
                        }
                    });

                    const colorDot = document.createElement('span');
                    colorDot.style.cssText = `
                        display: inline-block;
                        width: 12px;
                        height: 12px;
                        border-radius: 50%;
                        background-color: ${tag.color};
                        margin-right: 8px;
                    `;

                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = tag.name;

                    label.appendChild(checkbox);
                    label.appendChild(colorDot);
                    label.appendChild(nameSpan);
                    tagsContainer.appendChild(label);
                });
            }

            cancelBtn.addEventListener('click', () => dialog.destroy());

            saveBtn.addEventListener('click', async () => {
                const newTagIds = Array.from(selectedTags);
                dialog.destroy();
                await this.batchUpdateTasks(selectedIds, { tagIds: newTagIds });
            });

        } catch (err) {
            console.error('批量设置标签失败:', err);
            showMessage(i18n('batchSetTagsFailed') || '批量设置标签失败');
        }
    }

    private async renderStatusKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // [新增] 移除不再存在的状态列
        const validStatusIds = new Set(this.kanbanStatuses.map(s => s.id));
        const allColumns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
        allColumns.forEach(col => {
            const classList = Array.from(col.classList);
            const statusClass = classList.find(c => c.startsWith('kanban-column-') && !c.includes('-custom-group-'));
            if (statusClass) {
                const statusId = statusClass.replace('kanban-column-', '');
                if (!validStatusIds.has(statusId)) {
                    col.remove();
                }
            }
        });

        // 确保状态列存在，如果不存在才创建
        await this.ensureStatusColumnsExist(kanbanContainer);

        // 按任务状态分组 - 使用kanbanStatuses中定义的所有状态
        const statusTasks: { [status: string]: any[] } = {};
        this.kanbanStatuses.forEach(status => {
            if (status.id === 'completed') {
                // 已完成任务单独处理
                statusTasks[status.id] = this.tasks.filter(task => task.completed);
            } else {
                // 未完成任务按状态分组，使用 getTaskStatus 确保正确获取 kanbanStatus
                statusTasks[status.id] = this.tasks.filter(task => !task.completed && this.getTaskStatus(task) === status.id);
            }
        });

        // 渲染带分组的任务（在稳定的子分组容器内）
        for (const status of this.kanbanStatuses) {
            if (status.id === 'completed') {
                const sortedDoneTasks = this.sortDoneTasks(statusTasks[status.id] || []);
                await this.renderStatusColumnWithStableGroups('completed', sortedDoneTasks);
                this.showColumn('completed');
            } else {
                await this.renderStatusColumnWithStableGroups(status.id, statusTasks[status.id] || []);
            }
        }
    }

    private async ensureStatusColumnsExist(kanbanContainer: HTMLElement) {
        // 1. 加载项目数据和里程碑
        const projectData = await this.plugin.loadProjectData() || {};
        const project = projectData[this.projectId];
        const defaultMilestones = (project?.milestones || []).filter((m: any) => !m.archived);
        const projectGroups = await this.projectManager.getProjectCustomGroups(this.projectId);

        // 2. 检查并创建必要的状态列 - 使用kanbanStatuses中定义的状态
        this.kanbanStatuses.forEach(status => {
            let column = kanbanContainer.querySelector(`.kanban-column-${status.id}`) as HTMLElement;
            if (!column) {
                column = this.createKanbanColumn(kanbanContainer, status.id, status.name, status.color);
            }

            // [统一处理] 更新标题、图标、计数背景以及里程碑筛选按钮
            const header = column.querySelector('.kanban-column-header') as HTMLElement;
            if (header) {
                // 更新标题和图标
                const titleEl = header.querySelector('h3') as HTMLElement;
                if (titleEl) {
                    const emoji = status.icon || '';
                    titleEl.textContent = emoji ? `${emoji}${status.name}` : status.name;
                }

                header.style.background = `${status.color}15`;

                let rightContainer = header.querySelector('.custom-header-right') as HTMLElement;
                if (!rightContainer) {
                    rightContainer = document.createElement('div');
                    rightContainer.className = 'custom-header-right';
                    rightContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';
                    header.appendChild(rightContainer);
                }

                // 确保 count 存在
                let count = rightContainer.querySelector('.kanban-column-count') as HTMLElement;
                if (!count) {
                    count = document.createElement('span');
                    count.className = 'kanban-column-count';

                    const titleH3 = header.querySelector('h3');
                    const titleColor = titleH3?.style?.color || status.color || 'var(--b3-theme-primary)';

                    count.style.cssText = `
                        background: ${titleColor};
                        color: white;
                        border-radius: 12px;
                        padding: 2px 8px;
                        font-size: 12px;
                        font-weight: 500;
                        min-width: 20px;
                        text-align: center;
                    `;
                    rightContainer.insertBefore(count, rightContainer.firstChild);
                }

                // [修改部分] 使用统一的 helper 方法更新里程碑筛选按钮
                this.updateMilestoneFilterButton(rightContainer, status.id);
            }

            // 确保列内有稳定的子分组容器结构
            this.ensureColumnHasStableGroups(column, status.id);
        });
    }

    private ensureColumnHasStableGroups(column: HTMLElement, status: string) {
        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        if (!content) return;

        // 检查是否已有稳定的分组容器
        let groupsContainer = content.querySelector('.status-column-stable-groups') as HTMLElement;
        if (!groupsContainer) {
            // 创建稳定的分组容器
            groupsContainer = document.createElement('div');
            groupsContainer.className = 'status-column-stable-groups';
            groupsContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 16px;
            `;

            // 根据状态列类型创建相应的子分组
            const groupConfigs = this.getGroupConfigsForStatus(status);

            groupConfigs.forEach(config => {
                const groupContainer = this.createStableStatusGroup(config);
                groupsContainer.appendChild(groupContainer);
            });

            // 清空内容并添加分组容器
            content.innerHTML = '';
            content.appendChild(groupsContainer);
        }
    }

    private getGroupConfigsForStatus(statusId: string): Array<{ status: string, label: string, icon: string }> {
        // 从kanbanStatuses中查找对应的状态配置
        const status = this.kanbanStatuses.find(s => s.id === statusId);
        if (!status) return [];

        // 默认图标映射（当 kanbanStatuses 中没有设置图标时使用）
        const defaultIcons: { [key: string]: string } = {
            'doing': '⏳',
            'short_term': '📋',
            'long_term': '🤔',
            'completed': '✅'
        };

        return [{
            status: statusId,
            label: status.name,
            icon: status.icon || defaultIcons[statusId] || '📋'
        }];
    }

    private createStableStatusGroup(config: { status: string, label: string, icon: string }): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = `status-stable-group status-stable-${config.status}`;
        groupContainer.dataset.status = config.status;

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'status-stable-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px; padding-right: 8px;
            padding-top: 8px;
            min-height: 20px;
        `;

        // 为非已完成分组添加拖放事件
        if (config.status !== 'completed') {
            this.addStatusSubGroupDropEvents(groupTasksContainer, config.status);
        }

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private async renderStatusColumnWithStableGroups(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 获取稳定的分组容器
        const groupsContainer = content.querySelector('.status-column-stable-groups') as HTMLElement;
        if (!groupsContainer) return;

        // 获取项目自定义分组
        // 注意：这里我们简化处理，如果有自定义分组，则按分组渲染；否则直接在状态子分组中渲染任务
        // 为了保持向后兼容，我们仍然支持自定义分组的显示逻辑

        // 检查是否有自定义分组
        const hasCustomGroups = await this.hasProjectCustomGroups();

        if (hasCustomGroups) {
            // 如果有自定义分组，使用原有的分组渲染逻辑
            await this.renderTasksGroupedByCustomGroupInStableContainer(groupsContainer, tasks, status);
        } else {
            // 如果没有自定义分组，直接在状态子分组中渲染任务
            this.renderTasksInStableStatusGroups(groupsContainer, tasks, status);
        }

        // 更新列顶部计数
        if (count) {
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            count.textContent = topLevelTasks.length.toString();
        }
    }

    private async hasProjectCustomGroups(): Promise<boolean> {
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            // 只计算未归档的分组
            return projectGroups.some((g: any) => !g.archived);
        } catch (error) {
            console.error('检查项目分组失败:', error);
            return false;
        }
    }

    private renderTasksInStableStatusGroups(groupsContainer: HTMLElement, tasks: any[], status: string) {
        // 获取对应的状态分组容器
        const groupContainer = groupsContainer.querySelector(`.status-stable-group[data-status="${status}"]`) as HTMLElement;
        if (!groupContainer) return;

        const groupTasksContainer = groupContainer.querySelector('.status-stable-group-tasks') as HTMLElement;
        const taskCount = groupContainer.querySelector('.status-stable-group-count') as HTMLElement;

        // 清空任务容器并重新渲染任务
        // 锁定高度防止抖动
        const oldHeight = groupTasksContainer.offsetHeight;
        if (oldHeight > 0) groupTasksContainer.style.minHeight = `${oldHeight}px`;

        groupTasksContainer.innerHTML = '';

        const pageKey = `status-stable-${status}`;
        const currentPage = this.pageIndexMap[pageKey] || 1;
        this.pageIndexMap[pageKey] = currentPage;

        const { pagedTasks, hasMore } = this.paginateTasks(tasks, currentPage);
        this.renderTasksInColumn(groupTasksContainer, pagedTasks);

        if (hasMore) {
            this.renderLoadMoreButton(groupTasksContainer, pageKey);
        }

        // 恢复高度
        if (oldHeight > 0) {
            requestAnimationFrame(() => {
                groupTasksContainer.style.minHeight = '';
            });
        }

        // 更新分组任务计数
        if (taskCount) {
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            taskCount.textContent = topLevelTasks.length.toString();
        }
    }

    private async renderTasksGroupedByCustomGroupInStableContainer(groupsContainer: HTMLElement, tasks: any[], status: string) {
        // 获取项目自定义分组
        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
        // 过滤掉已归档的分组，并按 sort 字段排序
        const allActiveGroups = projectGroups
            .filter((g: any) => !g.archived)
            .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        let displayGroups = allActiveGroups;
        const todayStr = getLogicalDateString();

        if (this.project?.hideNoDoingGroups) {
            displayGroups = displayGroups.filter((g: any) => {
                return this.tasks.some(task => task.customGroupId === g.id && !task.completed && this.getTaskStatus(task) === 'doing');
            });
        }
        if (this.project?.hideNoTodayGroups) {
            displayGroups = displayGroups.filter((g: any) => {
                return this.tasks.some(task => task.customGroupId === g.id && task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), todayStr) === 0);
            });
        }

        // 获取对应的状态分组容器
        const groupContainer = groupsContainer.querySelector(`.status-stable-group[data-status="${status}"]`) as HTMLElement;
        if (!groupContainer) return;

        const groupTasksContainer = groupContainer.querySelector('.status-stable-group-tasks') as HTMLElement;
        const taskCount = groupContainer.querySelector('.status-stable-group-count') as HTMLElement;

        // 在状态分组容器内渲染自定义分组
        // 锁定高度防止抖动
        const oldHeight = groupTasksContainer.offsetHeight;
        if (oldHeight > 0) groupTasksContainer.style.minHeight = `${oldHeight}px`;

        groupTasksContainer.innerHTML = '';

        if (allActiveGroups.length === 0) {
            // 如果没有自定义分组，直接渲染任务
            this.renderTasksInColumn(groupTasksContainer, tasks);
        } else {
            // 按自定义分组渲染任务组
            const groupsSubContainer = document.createElement('div');
            groupsSubContainer.className = 'status-column-groups-in-stable';
            groupsSubContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 12px;
            `;

            // 为每个自定义分组创建子容器
            const isCollapsedDefault = status === 'completed';
            const validGroupIds = new Set(allActiveGroups.map((g: any) => g.id));

            displayGroups.forEach((group: any) => {
                const groupTasks = tasks.filter(task => task.customGroupId === group.id);
                if (groupTasks.length > 0) {
                    const groupSubContainer = this.createCustomGroupInStatusColumn(group, groupTasks, isCollapsedDefault, status);
                    groupsSubContainer.appendChild(groupSubContainer);
                }
            });

            // 添加未分组任务（包括指向不存在分组的任务）
            const ungroupedTasks = tasks.filter(task => !task.customGroupId || !validGroupIds.has(task.customGroupId));
            let showUngrouped = ungroupedTasks.length > 0;

            if (showUngrouped && this.project?.hideNoDoingGroups) {
                const hasDoing = this.tasks.some(task => (!task.customGroupId || !validGroupIds.has(task.customGroupId)) && !task.completed && this.getTaskStatus(task) === 'doing');
                if (!hasDoing) showUngrouped = false;
            }
            if (showUngrouped && this.project?.hideNoTodayGroups) {
                const hasToday = this.tasks.some(task => (!task.customGroupId || !validGroupIds.has(task.customGroupId)) && task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), todayStr) === 0);
                if (!hasToday) showUngrouped = false;
            }

            if (showUngrouped) {
                const ungroupedGroup = {
                    id: 'ungrouped',
                    name: '未分组',
                    color: '#95a5a6',
                    icon: '📋'
                };
                const ungroupedContainer = this.createCustomGroupInStatusColumn(ungroupedGroup, ungroupedTasks, isCollapsedDefault, status);
                groupsSubContainer.appendChild(ungroupedContainer);
            }

            groupTasksContainer.appendChild(groupsSubContainer);
        }

        // 恢复高度
        if (oldHeight > 0) {
            requestAnimationFrame(() => {
                groupTasksContainer.style.minHeight = '';
            });
        }

        // 更新分组任务计数
        if (taskCount) {
            taskCount.textContent = tasks.length.toString();
        }
    }


    private renderEmptyCustomGroupKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        kanbanContainer.innerHTML = `
            <div class="empty-custom-group-state" style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 300px;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                width: 100%;
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                <div style="font-size: 16px; margin-bottom: 8px;">暂无自定义分组</div>
                <div style="font-size: 14px;">请在项目设置中添加自定义分组</div>
            </div>
        `;
    }

    private async renderListKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // Ensure container is clean if switching modes
        if (this._lastRenderMode !== 'list') {
            kanbanContainer.innerHTML = '';
            this._lastRenderMode = 'list';
        }

        const projectManager = this.projectManager;
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
        // 过滤掉已归档的分组
        const activeGroups = projectGroups.filter((g: any) => !g.archived);

        if (activeGroups.length === 0) {
            // No custom grouping -> Single column
            await this.renderSingleListColumn(kanbanContainer);
        } else {
            // With custom grouping -> Columns per group
            await this.renderGroupedListColumns(kanbanContainer, activeGroups);
        }
    }

    private async renderSingleListColumn(container: HTMLElement) {
        // Create or get the single column
        let column = container.querySelector('.kanban-column-list-single') as HTMLElement;
        if (!column) {
            column = document.createElement('div');
            column.className = 'kanban-column kanban-column-list-single';
            column.style.cssText = 'min-width: 400px; flex: 1; display: flex; flex-direction: column; height: 100%; margin: 0 auto; max-width: 800px;';
            column.dataset.status = 'doing'; // Virtual status for drop handling

            // Header
            const header = document.createElement('div');
            header.className = 'kanban-column-header';
            header.style.cssText = `
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-surface-lighter);
                border-radius: 8px 8px 0 0;
                display: flex;
                align-items: center;
                justify-content: space-between;
            `;

            const titleContainer = document.createElement('div');
            titleContainer.style.display = 'flex';
            titleContainer.style.alignItems = 'center';
            titleContainer.style.gap = '8px';
            titleContainer.innerHTML = `<span style="font-size: 16px;">📝</span><span style="font-size: 16px; font-weight: 600;">${i18n('taskList') || '任务列表'}</span>`;
            header.appendChild(titleContainer);

            const headerRight = document.createElement('div');
            headerRight.className = 'custom-header-right';
            headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';

            // Count badge
            const countBadge = document.createElement('span');
            countBadge.className = 'kanban-column-count';
            countBadge.style.cssText = 'background: var(--b3-theme-primary); color: white; border-radius: 12px; padding: 2px 8px; font-size: 12px; min-width: 20px; text-align: center;';
            headerRight.appendChild(countBadge);

            // Add Task Button
            const addBtn = document.createElement('button');
            addBtn.className = 'b3-button b3-button--outline';
            addBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
            addBtn.title = i18n('newTask');
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCreateTaskDialog(undefined, undefined, 'doing');
            });
            headerRight.appendChild(addBtn);

            // Paste Task Button
            const pasteBtn = document.createElement('button');
            pasteBtn.className = 'b3-button b3-button--outline';
            pasteBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>`;
            pasteBtn.title = i18n('pasteNew');
            pasteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPasteTaskDialog(undefined, undefined, 'doing', true);
            });
            headerRight.appendChild(pasteBtn);

            header.appendChild(headerRight);
            column.appendChild(header);

            const content = document.createElement('div');
            content.className = 'kanban-column-content';
            content.style.cssText = 'flex: 1; overflow-y: auto; padding: 0;';
            column.appendChild(content);

            // Just in case
            if (container.innerHTML !== '') container.innerHTML = '';
            container.appendChild(column);
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const countBadge = column.querySelector('.kanban-column-count') as HTMLElement;

        // Filter tasks
        const unfinishedTasks = this.tasks.filter(t => !t.completed);
        const finishedTasks = this.sortDoneTasks(this.tasks.filter(t => t.completed));

        if (countBadge) {
            // Count total top-level unfinished tasks
            const taskMap = new Map(unfinishedTasks.map(t => [t.id, t]));
            const topLevel = unfinishedTasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            countBadge.textContent = topLevel.length.toString();
        }

        this.renderListSections(content, unfinishedTasks, finishedTasks, null);

        // [新增] 更新列顶部的里程碑筛选按钮
        const headerRight = column.querySelector('.custom-header-right') as HTMLElement;
        if (headerRight) {
            this.updateMilestoneFilterButton(headerRight, 'ungrouped');
        }
    }

    private async renderGroupedListColumns(container: HTMLElement, groups: any[]) {
        // Handle ungrouped tasks (orphaned tasks should be considered ungrouped)
        const validGroupIds = new Set(groups.map(g => g.id));
        const ungroupedTasks = this.tasks.filter(t => !t.customGroupId || !validGroupIds.has(t.customGroupId));

        let displayGroups = [...groups].sort((a, b) => (a.sort || 0) - (b.sort || 0));
        const todayStr = getLogicalDateString();

        if (this.project?.hideNoDoingGroups) {
            displayGroups = displayGroups.filter((g: any) => {
                return this.tasks.some(task => task.customGroupId === g.id && !task.completed && this.getTaskStatus(task) === 'doing');
            });
        }
        if (this.project?.hideNoTodayGroups) {
            displayGroups = displayGroups.filter((g: any) => {
                return this.tasks.some(task => task.customGroupId === g.id && task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), todayStr) === 0);
            });
        }

        // Use a set to track rendered group IDs to remove obsolete columns
        const renderedGroupIds = new Set<string>();

        // Render groups
        for (const group of displayGroups) {
            const groupTasks = this.tasks.filter(t => t.customGroupId === group.id);
            await this.renderListModeGroupColumn(container, group, groupTasks);
            renderedGroupIds.add(`custom-group-${group.id}`);
        }

        let showUngrouped = ungroupedTasks.length > 0;

        if (showUngrouped && this.project?.hideNoDoingGroups) {
            const hasDoing = this.tasks.some(task => (!task.customGroupId || !validGroupIds.has(task.customGroupId)) && !task.completed && this.getTaskStatus(task) === 'doing');
            if (!hasDoing) showUngrouped = false;
        }
        if (showUngrouped && this.project?.hideNoTodayGroups) {
            const hasToday = this.tasks.some(task => (!task.customGroupId || !validGroupIds.has(task.customGroupId)) && task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), todayStr) === 0);
            if (!hasToday) showUngrouped = false;
        }

        if (showUngrouped) {
            const ungroupedGroup = { id: 'ungrouped', name: i18n('ungrouped') || '未分组', color: '#95a5a6', icon: '📋' };
            await this.renderListModeGroupColumn(container, ungroupedGroup, ungroupedTasks);
            renderedGroupIds.add('custom-group-ungrouped');
        }

        // Cleanup obsolete columns
        const existingColumns = Array.from(container.querySelectorAll('.kanban-column'));
        existingColumns.forEach(col => {
            const colId = Array.from(col.classList).find(c => c.startsWith('kanban-column-custom-group-'));
            if (colId && !renderedGroupIds.has(colId.replace('kanban-column-', ''))) {
                col.remove();
            }
        });
    }

    private async renderListModeGroupColumn(container: HTMLElement, group: any, tasks: any[]) {
        const columnId = `custom-group-${group.id}`;
        let column = container.querySelector(`.kanban-column-${columnId}`) as HTMLElement;

        if (!column) {
            // Reusing the createCustomGroupColumn method for consistent styling
            column = this.createCustomGroupColumn(columnId, group);
        }

        // Ensure column is in the container (in case createCustomGroupColumn didn't append it or order changed)
        if (!column.parentElement) {
            container.appendChild(column);
        } else {
            // Ensure order (simple append moves it to end)
            container.appendChild(column);
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const unfinishedTasks = tasks.filter(t => !t.completed);
        const finishedTasks = this.sortDoneTasks(tasks.filter(t => t.completed));

        // Update total count in header
        const count = column.querySelector('.kanban-column-count');
        if (count) {
            // Count unfinished top level tasks
            const taskMap = new Map(unfinishedTasks.map(t => [t.id, t]));
            const topLevel = unfinishedTasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            count.textContent = topLevel.length.toString();
        }

        this.renderListSections(content, unfinishedTasks, finishedTasks, group.id);

        // [新增] 更新列顶部的里程碑筛选按钮
        const rightContainer = column.querySelector('.custom-header-right') as HTMLElement;
        if (rightContainer) {
            this.updateMilestoneFilterButton(rightContainer, group.id);
        }
    }

    private paginateTasks(tasks: any[], page: number): { pagedTasks: any[], hasMore: boolean } {
        if (tasks.length === 0) return { pagedTasks: [], hasMore: false };

        const taskMap = new Map(tasks.map(t => [t.id, t]));
        // Roots within this subset (tasks passed in are already filtered by status/group)
        const roots = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));

        if (roots.length <= page * this.pageSize) {
            return { pagedTasks: tasks, hasMore: false };
        }

        const pagedRoots = roots.slice(0, page * this.pageSize);
        const result: any[] = [...pagedRoots];

        // Collect descendants
        const childrenMap = new Map<string, any[]>();
        for (const t of tasks) {
            if (t.parentId && taskMap.has(t.parentId)) {
                const pid = t.parentId;
                if (!childrenMap.has(pid)) childrenMap.set(pid, []);
                childrenMap.get(pid)!.push(t);
            }
        }

        const addDescendants = (parent: any) => {
            const children = childrenMap.get(parent.id);
            if (children) {
                for (const child of children) {
                    result.push(child);
                    addDescendants(child);
                }
            }
        };

        for (const root of pagedRoots) {
            addDescendants(root);
        }

        return { pagedTasks: result, hasMore: true };
    }

    private renderLoadMoreButton(container: HTMLElement, pageKey: string) {
        const btnContainer = document.createElement('div');
        btnContainer.className = 'kanban-load-more';
        btnContainer.style.textAlign = 'center';
        btnContainer.style.padding = '8px';
        btnContainer.style.borderTop = '1px dashed var(--b3-theme-surface-lighter)';

        const btn = document.createElement('button');
        btn.className = 'b3-button b3-button--text';
        btn.textContent = i18n('loadMore');
        btn.style.fontSize = '12px';
        btn.style.padding = '4px 8px';
        btn.style.height = '24px';

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pageIndexMap[pageKey] = (this.pageIndexMap[pageKey] || 1) + 1;
            this.renderKanban();
        });

        btnContainer.appendChild(btn);
        container.appendChild(btnContainer);
    }

    private renderListSections(content: HTMLElement, unfinished: any[], finished: any[], groupId: string | null) {
        // Unfinished Section
        let unfinishedSection = content.querySelector('.list-section-unfinished') as HTMLElement;
        if (!unfinishedSection) {
            unfinishedSection = document.createElement('div');
            unfinishedSection.className = 'list-section list-section-unfinished';
            // unfinishedSection.style.padding = '8px 12px'; // Moved padding to children
            unfinishedSection.style.display = 'flex';
            unfinishedSection.style.flexDirection = 'column';

            const header = document.createElement('div');
            header.className = 'list-section-header';
            header.style.cssText = `
                font-size: 13px; 
                font-weight: 600; 
                color: var(--b3-theme-on-surface); 
                padding: 10px 12px;
                background: var(--b3-theme-background);
                position: sticky;
                top: 0;
                z-index: 2;
                opacity: 0.95; 
                display: flex; 
                align-items: center; 
                justify-content: space-between; 
                cursor: pointer;
                border-bottom: 1px solid var(--b3-theme-surface-lighter);
            `;

            const titleWrap = document.createElement('div');
            titleWrap.style.display = 'flex';
            titleWrap.style.alignItems = 'center';
            titleWrap.style.gap = '4px';

            const toggleIcon = document.createElement('span');
            toggleIcon.innerHTML = '<svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#iconDown"></use></svg>';
            titleWrap.appendChild(toggleIcon);

            const titleLabel = document.createElement('span');
            titleLabel.textContent = i18n('unfinished') || '进行中';
            titleWrap.appendChild(titleLabel);

            header.appendChild(titleWrap);

            const countLabel = document.createElement('span');
            countLabel.className = 'list-section-count';
            countLabel.style.fontSize = '12px';
            countLabel.style.opacity = '0.7';
            header.appendChild(countLabel);

            unfinishedSection.appendChild(header);

            const taskContainer = document.createElement('div');
            taskContainer.className = 'list-section-tasks';
            taskContainer.style.minHeight = '50px';
            taskContainer.style.padding = '0 12px 8px 12px';
            unfinishedSection.appendChild(taskContainer);

            content.appendChild(unfinishedSection);

            this.addListSectionDropEvents(taskContainer, 'unfinished', groupId);

            // Toggle Collapse
            let isCollapsed = false;
            const toggleKey = `list-unfinished-${groupId || 'single'}`;
            if (this.collapsedStatusGroups.has(toggleKey)) {
                isCollapsed = true;
            }

            const updateState = () => {
                taskContainer.style.display = isCollapsed ? 'none' : 'block';
                toggleIcon.innerHTML = `<svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            };
            updateState();

            header.addEventListener('click', () => {
                isCollapsed = !isCollapsed;
                if (isCollapsed) this.collapsedStatusGroups.add(toggleKey);
                else this.collapsedStatusGroups.delete(toggleKey);
                updateState();
            });
        }

        const unfinishedContainer = unfinishedSection.querySelector('.list-section-tasks') as HTMLElement;
        unfinishedContainer.innerHTML = '';

        const unfinishedKey = `list-unfinished-${groupId || 'single'}`;
        const unfinishedPage = this.pageIndexMap[unfinishedKey] || 1;
        this.pageIndexMap[unfinishedKey] = unfinishedPage;

        const { pagedTasks: pagedUnfinished, hasMore: hasMoreUnfinished } = this.paginateTasks(unfinished, unfinishedPage);
        this.renderTasksInColumn(unfinishedContainer, pagedUnfinished);

        if (hasMoreUnfinished) {
            this.renderLoadMoreButton(unfinishedContainer, unfinishedKey);
        }

        const unfinishedCountLabel = unfinishedSection.querySelector('.list-section-count');
        if (unfinishedCountLabel) unfinishedCountLabel.textContent = unfinished.length.toString();

        // Finished Section
        let finishedSection = content.querySelector('.list-section-finished') as HTMLElement;
        if (!finishedSection) {
            finishedSection = document.createElement('div');
            finishedSection.className = 'list-section list-section-finished';
            // finishedSection.style.padding = '8px 12px'; // Moved padding to children
            finishedSection.style.display = 'flex';
            finishedSection.style.flexDirection = 'column';
            // finishedSection.style.marginTop = '8px'; // Moved to margin-top of header potentially or keep here

            const header = document.createElement('div');
            header.className = 'list-section-header';
            header.style.cssText = `
                font-size: 13px; 
                font-weight: 600; 
                color: var(--b3-theme-on-surface); 
                padding: 10px 12px;
                background: var(--b3-theme-background);
                position: sticky;
                top: 0;
                z-index: 2;
                opacity: 0.95;
                display: flex; 
                align-items: center; 
                justify-content: space-between; 
                cursor: pointer;
                border-bottom: 1px solid var(--b3-theme-surface-lighter);
                border-top: 4px solid var(--b3-theme-background); /* Visual separation */
            `;

            const titleWrap = document.createElement('div');
            titleWrap.style.display = 'flex';
            titleWrap.style.alignItems = 'center';
            titleWrap.style.gap = '4px';

            const toggleIcon = document.createElement('span');
            toggleIcon.innerHTML = '<svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#iconDown"></use></svg>';
            titleWrap.appendChild(toggleIcon);

            const titleLabel = document.createElement('span');
            titleLabel.textContent = i18n('finished');
            titleWrap.appendChild(titleLabel);

            header.appendChild(titleWrap);

            const countLabel = document.createElement('span');
            countLabel.className = 'list-section-count';
            countLabel.style.fontSize = '12px';
            countLabel.style.opacity = '0.7';
            header.appendChild(countLabel);

            finishedSection.appendChild(header);

            const taskContainer = document.createElement('div');
            taskContainer.className = 'list-section-tasks';
            taskContainer.style.minHeight = '30px';
            taskContainer.style.padding = '0 12px 8px 12px';
            finishedSection.appendChild(taskContainer);

            content.appendChild(finishedSection);

            this.addListSectionDropEvents(taskContainer, 'finished', groupId);

            // Toggle Collapse
            let isCollapsed = true; // Default to collapsed
            // Try to restore state
            const toggleKey = `list-finished-${groupId || 'single'}`;
            if (this.expandedStatusGroups.has(toggleKey)) {
                isCollapsed = false;
            }

            const updateState = () => {
                taskContainer.style.display = isCollapsed ? 'none' : 'block';
                toggleIcon.innerHTML = `<svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            };
            updateState();

            header.addEventListener('click', () => {
                isCollapsed = !isCollapsed;
                // Save state
                if (!isCollapsed) {
                    this.expandedStatusGroups.add(toggleKey);
                } else {
                    this.expandedStatusGroups.delete(toggleKey);
                }
                updateState();
            });
        }

        const finishedContainer = finishedSection.querySelector('.list-section-tasks') as HTMLElement;
        finishedContainer.innerHTML = '';

        const finishedKey = `list-finished-${groupId || 'single'}`;
        const finishedPage = this.pageIndexMap[finishedKey] || 1;
        this.pageIndexMap[finishedKey] = finishedPage;

        const { pagedTasks: pagedFinished, hasMore: hasMoreFinished } = this.paginateTasks(finished, finishedPage);
        this.renderTasksInColumn(finishedContainer, pagedFinished);

        if (hasMoreFinished) {
            this.renderLoadMoreButton(finishedContainer, finishedKey);
        }

        const finishedCountLabel = finishedSection.querySelector('.list-section-count');
        if (finishedCountLabel) finishedCountLabel.textContent = finished.length.toString();
    }

    private addListSectionDropEvents(element: HTMLElement, type: 'unfinished' | 'finished', groupId: string | null) {
        element.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);

            e.preventDefault();
            e.dataTransfer!.dropEffect = 'move';
            if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                this._columnDropIndicator = null;
            }
            element.classList.add('kanban-drop-hover');
        });

        element.addEventListener('dragleave', (e) => {
            element.classList.remove('kanban-drop-hover');
        });

        element.addEventListener('drop', async (e) => {
            this.clearDropZoneHighlights();
            e.preventDefault();
            e.stopPropagation();

            // 检查思源拖拽
            const types = e.dataTransfer?.types || [];
            const isSiYuanDrag = types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) ||
                types.includes(Constants.SIYUAN_DROP_FILE) ||
                types.includes(Constants.SIYUAN_DROP_TAB);

            if (isSiYuanDrag) {
                const status = type === 'finished' ? 'completed' : 'doing';
                await this.handleDrop(e, status, groupId);
                return;
            }

            let taskId = '';
            const reminderPayload = e.dataTransfer?.getData('application/x-reminder');
            if (reminderPayload) {
                try {
                    const payload = JSON.parse(reminderPayload);
                    taskId = payload.id;
                } catch (e) { }
            }
            if (!taskId) {
                taskId = e.dataTransfer?.getData('text/plain');
            }

            if (!taskId) return;

            const updates: any = {};
            updates.projectId = this.projectId; // Ensure project is updated when dragging from sidebar

            if (type === 'finished') {
                updates.completed = true;
                updates.kanbanStatus = 'completed';
                updates.completedTime = getLocalDateTimeString(new Date());
            } else {
                updates.completed = false;
                updates.kanbanStatus = 'doing'; // Default to doing when moving to unfinished
                // We don't clear completedTime usually, or we should?
            }

            if (groupId !== null) {
                updates.customGroupId = groupId === 'ungrouped' ? '' : groupId;
            }

            // Handle multi-select
            if (this.selectedTaskIds.has(taskId)) {
                await this.batchUpdateTasks(Array.from(this.selectedTaskIds), updates);
            } else {
                await this.batchUpdateTasks([taskId], updates);
            }
        });
    }

    private renderColumn(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        // If this is a configured kanban status (including custom ones), use the stable groups renderer
        // This prevents destroying the grouping structure and avoids duplicating header buttons
        if (this.kanbanStatuses && this.kanbanStatuses.find(s => s.id === status)) {
            this.ensureColumnHasStableGroups(column, status);
            this.renderStatusColumnWithStableGroups(status, tasks).catch(err => console.error('Render stable group failed:', err));
            return;
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        let count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 确保 header 上存在右侧容器（计数 + 新建按钮），如果列是旧的没有该按钮，则创建它
        const header = column.querySelector('.kanban-column-header') as HTMLElement;
        if (header) {
            let headerRight = header.querySelector('.custom-header-right') as HTMLElement | null;
            if (!headerRight) {
                // 如果 count 元素不存在（可能是旧列），尝试创建新的 count
                if (!count) {
                    count = document.createElement('span');
                    count.className = 'kanban-column-count';

                    // 尝试从标题获取颜色作为计数背景色
                    const titleEl = header.querySelector('h3') as HTMLElement | null;
                    const titleColor = titleEl?.style?.color || 'var(--b3-theme-primary)';

                    count.style.cssText = `
                        background: ${titleColor};
                        color: white;
                        border-radius: 12px;
                        padding: 2px 8px;
                        font-size: 12px;
                        font-weight: 500;
                        min-width: 20px;
                        text-align: center;
                    `;
                }

                headerRight = document.createElement('div');
                headerRight.className = 'custom-header-right';
                headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
                headerRight.appendChild(count);

                // 里程碑筛选按钮
                const milestoneFilterSet = this.selectedFilterMilestones.get(status);
                const hasMilestonesInThisStatus = this._statusHasMilestoneTasks.has(status) || (milestoneFilterSet && milestoneFilterSet.size > 0);

                if (hasMilestonesInThisStatus) {
                    const milestoneFilterBtn = document.createElement('button');
                    milestoneFilterBtn.className = 'b3-button b3-button--outline milestone-filter-btn b3-button--small';
                    milestoneFilterBtn.title = i18n('filterMilestone');
                    milestoneFilterBtn.innerHTML = '🚩';
                    milestoneFilterBtn.dataset.groupId = status;
                    milestoneFilterBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.showMilestoneFilterMenu(e, status);
                    });
                    // 只在部分选择时添加 b3-button--primary
                    const allAvailableSet = this.allAvailableMilestones.get(status);
                    const isPartialSelection = milestoneFilterSet && allAvailableSet &&
                        milestoneFilterSet.size > 0 &&
                        milestoneFilterSet.size < allAvailableSet.size;
                    if (isPartialSelection) {
                        milestoneFilterBtn.classList.add('b3-button--primary');
                        milestoneFilterBtn.classList.remove('b3-button--outline');
                    }
                    headerRight.appendChild(milestoneFilterBtn);
                }

                // 不在已完成列显示新建按钮
                if (status !== 'completed') {
                    const addGroupTaskBtn = document.createElement('button');
                    addGroupTaskBtn.className = 'b3-button b3-button--small b3-button--primary';
                    addGroupTaskBtn.title = i18n('newTask');
                    addGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
                    addGroupTaskBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 直接把列的 status 作为默认状态传入（支持自定义状态 id）
                        this.showCreateTaskDialog(undefined, this.lastSelectedCustomGroupId, status);
                    });

                    headerRight.appendChild(addGroupTaskBtn);
                }
                header.appendChild(headerRight);
            }
        }

        content.innerHTML = '';

        // 为了确保父任务下显示所有后代（包括已完成的子任务），扩展传入的任务列表
        const expandedTasks = this.augmentTasksWithDescendants(tasks);
        const taskMap = new Map(expandedTasks.map(t => [t.id, t]));
        const topLevelTasks = expandedTasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = expandedTasks.filter(t => t.parentId && taskMap.has(t.parentId));

        // 分页计算
        const totalTop = topLevelTasks.length;
        const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
        const currentPage = Math.min(Math.max(1, this.pageIndexMap[status] || 1), totalPages);

        const startIdx = (currentPage - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const pagedTopLevel = topLevelTasks.slice(startIdx, endIdx);

        // 子任务排序函数：根据当前排序设置排序
        const sortChildren = (children: any[]) => {
            const sorted = [...children];
            switch (this.currentSort) {
                case 'priority':
                    sorted.sort((a, b) => this.compareByPriority(a, b));
                    break;
                case 'time':
                    sorted.sort((a, b) => this.compareByTime(a, b));
                    break;
                case 'title':
                    sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                    break;
                case 'createdAt':
                    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    break;
                default:
                    sorted.sort((a, b) => (a.sort || 0) - (b.sort || 0));
            }
            // 应用排序方向
            if (this.currentSortOrder === 'asc') {
                sorted.reverse();
            }
            return sorted;
        };

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            let children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                // 对子任务进行排序
                children = sortChildren(children);
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        pagedTopLevel.forEach(task => renderTaskWithChildren(task, 0));

        // 更新列顶部计数为仅统计顶层任务数量
        if (count) {
            count.textContent = totalTop.toString();
        }

        // 渲染分页控件：仅在顶层任务数量超过 pageSize 时显示分页
        const pagination = column.querySelector('.kanban-column-pagination') as HTMLElement;
        if (pagination) {
            // 如果不需要分页，则隐藏分页容器
            if (totalTop <= this.pageSize) {
                pagination.innerHTML = '';
                pagination.style.display = 'none';
            } else {
                pagination.style.display = 'flex';
                pagination.innerHTML = '';

                // 上一页按钮
                const prevBtn = document.createElement('button');
                prevBtn.className = 'b3-button b3-button--text';
                prevBtn.textContent = '上一页';
                prevBtn.disabled = currentPage <= 1;
                prevBtn.addEventListener('click', () => {
                    this.pageIndexMap[status] = Math.max(1, currentPage - 1);
                    this.queueLoadTasks();
                });
                pagination.appendChild(prevBtn);

                // 页码信息
                const pageInfo = document.createElement('div');
                pageInfo.style.cssText = 'min-width: 120px; text-align: center; font-size: 13px; color: var(--b3-theme-on-surface);';
                pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页（共 ${totalTop} 项）`;
                pagination.appendChild(pageInfo);

                // 下一页按钮
                const nextBtn = document.createElement('button');
                nextBtn.className = 'b3-button b3-button--text';
                nextBtn.textContent = '下一页';
                nextBtn.disabled = currentPage >= totalPages;
                nextBtn.addEventListener('click', () => {
                    this.pageIndexMap[status] = Math.min(totalPages, currentPage + 1);
                    this.queueLoadTasks();
                });
                pagination.appendChild(nextBtn);
            }
        }
    }

    private renderCustomGroupColumn(group: any, tasks: any[]) {
        // 按 kanbanStatuses 中定义的所有状态分组任务
        const statusTasks: { [status: string]: any[] } = {};
        this.kanbanStatuses.forEach(status => {
            if (status.id === 'completed') {
                // 已完成任务单独处理（按完成时间排序）
                const completed = tasks.filter(task => task.completed);
                completed.sort((a, b) => {
                    const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
                    const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
                    return timeB - timeA;
                });
                statusTasks[status.id] = completed;
            } else {
                // 未完成任务按状态分组
                statusTasks[status.id] = tasks.filter(task => !task.completed && this.getTaskStatus(task) === status.id);
            }
        });

        this.renderCustomGroupColumnWithStatuses(group, statusTasks);
    }

    private createCustomGroupColumn(columnId: string, group: any): HTMLElement {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return document.createElement('div');

        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${columnId}`;
        column.dataset.groupId = group.id;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${group.color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        // 显示分组的 emoji（如果有），然后显示名称
        const groupIconEl = document.createElement('span');
        groupIconEl.className = 'custom-group-header-icon';
        groupIconEl.style.cssText = `margin-right:6px;`;
        groupIconEl.textContent = group.icon || '📋';
        titleContainer.appendChild(groupIconEl);

        titleEl.textContent = group.name;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${group.color};
        `;

        // 如果分组绑定了块ID，添加预览和跳转功能
        if (group.blockId) {
            titleEl.dataset.type = 'a';
            titleEl.dataset.href = `siyuan://blocks/${group.blockId}`;
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline dotted';
            titleEl.style.paddingBottom = '2px';
            titleEl.title = i18n('clickToJumpToBlock');
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openBlock(group.blockId);
            });
        }

        titleContainer.appendChild(titleEl);

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);

        // 新建任务按钮（对应该自定义分组）
        const addGroupTaskBtn = document.createElement('button');
        addGroupTaskBtn.className = 'b3-button b3-button--outline';
        addGroupTaskBtn.title = i18n('newTask');
        addGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
        addGroupTaskBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gid = group.id === 'ungrouped' ? null : group.id;
            this.showCreateTaskDialog(undefined, gid);
        });

        // 粘贴新建任务按钮（对应该自定义分组）
        const pasteGroupTaskBtn = document.createElement('button');
        pasteGroupTaskBtn.className = 'b3-button b3-button--outline';
        pasteGroupTaskBtn.title = i18n('pasteNew');
        pasteGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>`;
        pasteGroupTaskBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gid = group.id === 'ungrouped' ? null : group.id;
            // 显示选择器
            this.showPasteTaskDialog(undefined, gid, undefined, true);
        });

        const headerRight = document.createElement('div');
        headerRight.className = 'custom-header-right';
        headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
        headerRight.appendChild(countEl);

        headerRight.appendChild(addGroupTaskBtn);
        headerRight.appendChild(pasteGroupTaskBtn);

        header.appendChild(headerRight);

        // 使列头可以拖拽以调整分组顺序（直接在看板中拖动 header 调整顺序）
        header.draggable = true;
        header.dataset.groupId = group.id;

        header.addEventListener('dragstart', (e) => {
            this.draggedGroupId = group.id;
            column.style.opacity = '0.5';
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', group.id);
                }
            } catch (err) {
                // ignore
            }
        });

        header.addEventListener('dragend', () => {
            this.draggedGroupId = null;
            column.style.opacity = '';
            // 清除列插入指示器
            if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
            }
            this._columnDropIndicator = null;
        });

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 0px;
            overflow-y: auto;
            min-height: 200px;
            margin-top: 8px;
        `;

        column.appendChild(header);
        column.appendChild(content);

        // 为自定义分组列添加拖拽事件（设置分组）
        // 如果是未分组列，传入 null 以表示移除分组目标
        const targetGroupId = group.id === 'ungrouped' ? null : group.id;
        this.addCustomGroupDropZoneEvents(content, targetGroupId);

        kanbanContainer.appendChild(column);
        return column;
    }

    private renderUngroupedColumn(tasks: any[]) {
        const ungroupedGroup = {
            id: 'ungrouped',
            name: '未分组',
            color: '#95a5a6',
            icon: '📋'
        };
        this.renderCustomGroupColumn(ungroupedGroup, tasks);
    }

    private renderCustomGroupColumnWithStatuses(group: any, statusTasks: { [status: string]: any[] }) {
        const columnId = `custom-group-${group.id}`;
        let column = this.container.querySelector(`.kanban-column-${columnId}`) as HTMLElement;

        if (!column) {
            // 如果列不存在，创建新列
            column = this.createCustomGroupColumn(columnId, group);
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 锁定高度防止抖动
        const oldHeight = content.offsetHeight;
        if (oldHeight > 0) content.style.minHeight = `${oldHeight}px`;

        content.innerHTML = '';

        // 创建分组容器（参考状态分组样式）
        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'custom-group-status-container';
        groupsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        // 按 kanbanStatuses 顺序创建所有状态分组
        const expandedTasksMap: { [status: string]: any[] } = {};
        const nonCompletedIncludedIds = new Set<string>();

        // 第一遍：收集所有非已完成状态的扩展任务，用于过滤已完成的重复任务
        this.kanbanStatuses.forEach(status => {
            if (status.id !== 'completed') {
                const tasks = statusTasks[status.id] || [];
                expandedTasksMap[status.id] = this.augmentTasksWithDescendants(tasks, group.id);
                expandedTasksMap[status.id].forEach(t => nonCompletedIncludedIds.add(t.id));
            }
        });

        // 第二遍：创建所有状态分组
        this.kanbanStatuses.forEach(status => {
            let tasks: any[];
            if (status.id === 'completed') {
                // 已完成任务需要过滤掉已经在其他分组中显示的任务
                const completedTasks = statusTasks[status.id] || [];
                tasks = completedTasks.filter(t => !nonCompletedIncludedIds.has(t.id));
            } else {
                tasks = expandedTasksMap[status.id] || [];
            }

            const statusGroupContainer = this.createStatusGroupInCustomColumn(
                group,
                tasks,
                status.id,
                status.name
            );
            groupsContainer.appendChild(statusGroupContainer);
        });

        content.appendChild(groupsContainer);

        // 恢复高度
        if (oldHeight > 0) {
            requestAnimationFrame(() => {
                content.style.minHeight = '';
            });
        }

        // 更新列顶部计数 — 只统计顶层（父）任务，不包括子任务
        if (count) {
            let allTasks: any[] = [];
            this.kanbanStatuses.forEach(status => {
                if (status.id === 'completed') {
                    const completedTasks = statusTasks[status.id] || [];
                    allTasks.push(...completedTasks.filter(t => !nonCompletedIncludedIds.has(t.id)));
                } else {
                    allTasks.push(...(expandedTasksMap[status.id] || []));
                }
            });
            const mapCombined = new Map(allTasks.map((t: any) => [t.id, t]));
            const topLevelCombined = allTasks.filter((t: any) => !t.parentId || !mapCombined.has(t.parentId));
            count.textContent = topLevelCombined.length.toString();
        }

        // [新增] 更新列顶部的里程碑筛选按钮
        const rightContainer = column.querySelector('.custom-header-right') as HTMLElement;
        if (rightContainer) {
            this.updateMilestoneFilterButton(rightContainer, group.id);
        }
    }

    private createStatusGroupInCustomColumn(group: any, tasks: any[], status: string, statusLabel: string): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = `custom-status-group custom-status-${status}`;
        groupContainer.dataset.groupId = group.id;
        groupContainer.dataset.status = status;

        // 从 kanbanStatuses 获取状态配置（颜色、图标）
        const statusConfig = this.kanbanStatuses.find(s => s.id === status);
        const statusColor = statusConfig?.color || group.color;

        // 分组标题 wrapper（吸顶+背景色，避免滚动时文字看不清）
        const groupHeaderWrapper = document.createElement('div');
        groupHeaderWrapper.className = 'custom-status-group-header-wrapper';
        groupHeaderWrapper.style.cssText = `
            position: sticky;
            top: 0;
            z-index: 10;
            background: var(--b3-theme-background);
        `;

        // 分组标题（参考状态分组下的自定义分组样式）
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-status-group-header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: ${statusColor}15;
            border: 1px solid ${statusColor}30;
            border-radius: 6px;
            cursor: pointer;
        `;

        const groupTitle = document.createElement('div');
        groupTitle.className = 'custom-status-group-title';
        groupTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: ${statusColor};
            font-size: 13px;
        `;

        const groupIcon = document.createElement('span');
        // 对于自定义分组下的状态子分组，使用不同的固定图标
        const defaultIcons: { [key: string]: string } = {
            'doing': '⏳',
            'short_term': '📋',
            'long_term': '🤔',
            'completed': '✅',
            'incomplete': '🗓'
        };
        // 优先使用 kanbanStatuses 中设置的图标，其次使用默认图标
        groupIcon.textContent = statusConfig?.icon || defaultIcons[status] || '📋';
        groupTitle.appendChild(groupIcon);

        const groupName = document.createElement('span');
        groupName.textContent = statusLabel;
        groupTitle.appendChild(groupName);

        const taskCount = document.createElement('span');
        taskCount.className = 'custom-status-group-count';
        // 所有状态分组都只显示顶层任务数量
        const taskMapLocal = new Map(tasks.map((t: any) => [t.id, t]));
        const topLevel = tasks.filter((t: any) => !t.parentId || !taskMapLocal.has(t.parentId));
        taskCount.textContent = topLevel.length.toString();
        taskCount.style.cssText = `
            background: ${statusColor};
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: 500;
            min-width: 18px;
            text-align: center;
        `;

        groupHeader.appendChild(groupTitle);

        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
        headerRight.appendChild(taskCount);

        // 为所有非"已完成"状态添加新建按钮和粘贴新建按钮
        if (status !== 'completed') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--text';
            addTaskBtn.style.cssText = 'padding: 2px; margin-left: 4px;';
            addTaskBtn.title = i18n('newTask');
            addTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCreateTaskDialog(undefined, group.id, status as any);
            });
            headerRight.appendChild(addTaskBtn);

            const pasteTaskBtn = document.createElement('button');
            pasteTaskBtn.className = 'b3-button b3-button--text';
            pasteTaskBtn.style.cssText = 'padding: 2px; margin-left: 2px;';
            pasteTaskBtn.title = i18n('pasteNew');
            pasteTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconPaste"></use></svg>`;
            pasteTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 显示选择器
                this.showPasteTaskDialog(undefined, group.id, status as any, true);
            });
            headerRight.appendChild(pasteTaskBtn);
        }

        groupHeader.appendChild(headerRight);
        groupHeaderWrapper.appendChild(groupHeader);

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'custom-status-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px; padding-right: 8px;
            padding-top: 8px; /* 添加一点顶部间距 */
            min-height: 20px; /* 确保即使没有任务也有拖放区域 */
        `;

        // 为子分组添加拖放事件处理器
        this.addStatusSubGroupDropEvents(groupTasksContainer, status);


        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'b3-button b3-button--text custom-status-group-collapse-btn';
        collapseBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>';
        collapseBtn.title = '折叠分组';
        collapseBtn.style.cssText = `
            padding: 2px;
            min-width: auto;
            margin-right: 4px;
        `;

        const groupKey = `${group.id}-${status}`;
        // 检查是否已有明确的折叠/展开记录
        let isCollapsed = false;
        if (this.collapsedStatusGroups.has(groupKey)) {
            isCollapsed = true;
        } else if (this.expandedStatusGroups.has(groupKey)) {
            isCollapsed = false;
        } else {
            // 没有任何记录，则使用默认值
            isCollapsed = status === 'completed';
        }

        // 设置初始显示状态
        groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

            // 更新持久化状态
            if (isCollapsed) {
                this.collapsedStatusGroups.add(groupKey);
                this.expandedStatusGroups.delete(groupKey);
            } else {
                this.collapsedStatusGroups.delete(groupKey);
                this.expandedStatusGroups.add(groupKey);
            }
        });

        groupTitle.insertBefore(collapseBtn, groupIcon);

        groupContainer.appendChild(groupHeaderWrapper);

        // 渲染任务
        const pageKey = `custom-mode-${groupKey}`;
        const currentPage = this.pageIndexMap[pageKey] || 1;
        this.pageIndexMap[pageKey] = currentPage;

        const { pagedTasks, hasMore } = this.paginateTasks(tasks, currentPage);
        this.renderTasksInColumn(groupTasksContainer, pagedTasks);

        if (hasMore) {
            this.renderLoadMoreButton(groupTasksContainer, pageKey);
        }

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }


    private renderTasksInColumn(content: HTMLElement, tasks: any[]) {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = tasks.filter(t => t.parentId && taskMap.has(t.parentId));

        // 子任务排序函数：根据当前排序设置排序
        const sortChildren = (children: any[]) => {
            const sorted = [...children];
            switch (this.currentSort) {
                case 'priority':
                    sorted.sort((a, b) => this.compareByPriority(a, b));
                    break;
                case 'time':
                    sorted.sort((a, b) => this.compareByTime(a, b));
                    break;
                case 'title':
                    sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
                    break;
                case 'createdAt':
                    sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                    break;
                default:
                    // 默认按 sort 字段排序（与 SubtasksDialog 一致）
                    sorted.sort((a, b) => (a.sort || 0) - (b.sort || 0));
            }
            // 应用排序方向
            if (this.currentSortOrder === 'asc') {
                sorted.reverse();
            }
            return sorted;
        };

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            let children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                // 对子任务进行排序
                children = sortChildren(children);
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        topLevelTasks.forEach(task => renderTaskWithChildren(task, 0));
    }

    private async renderTasksGroupedByCustomGroup(content: HTMLElement, tasks: any[], projectGroups: any[]) {
        // 创建分组容器
        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'status-column-groups';
        groupsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        // 为每个自定义分组创建子容器
        projectGroups.forEach((group: any) => {
            const groupTasks = tasks.filter(task => task.customGroupId === group.id);
            if (groupTasks.length > 0) {
                const groupContainer = this.createCustomGroupInStatusColumn(group, groupTasks, false, '');
                groupsContainer.appendChild(groupContainer);
            }
        });

        // 添加未分组任务
        const ungroupedTasks = tasks.filter(task => !task.customGroupId);
        if (ungroupedTasks.length > 0) {
            const ungroupedGroup = {
                id: 'ungrouped',
                name: '未分组',
                color: '#95a5a6',
                icon: '📋'
            };
            const ungroupedContainer = this.createCustomGroupInStatusColumn(ungroupedGroup, ungroupedTasks, false, '');
            groupsContainer.appendChild(ungroupedContainer);
        }

        content.appendChild(groupsContainer);
    }

    private createCustomGroupInStatusColumn(group: any, tasks: any[], isCollapsedDefault: boolean = false, status: string = ''): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'custom-group-in-status';
        groupContainer.dataset.groupId = group.id;

        // 分组标题 wrapper（吸顶+背景色，避免滚动时文字看不清）
        const groupHeaderWrapper = document.createElement('div');
        groupHeaderWrapper.className = 'custom-group-header-wrapper';
        groupHeaderWrapper.style.cssText = `
            position: sticky;
            top: 0;
            z-index: 10;
            background: var(--b3-theme-background);
        `;

        // 分组标题
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-group-header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: ${group.color}15;
            border: 1px solid ${group.color}30;
            border-radius: 6px;
            cursor: pointer;
        `;

        const groupTitle = document.createElement('div');
        groupTitle.className = 'custom-group-title';
        groupTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: ${group.color};
            font-size: 13px;
        `;

        const groupIcon = document.createElement('span');
        groupIcon.textContent = group.icon || '📋';
        groupTitle.appendChild(groupIcon);

        const groupName = document.createElement('span');
        groupName.textContent = group.name;
        groupTitle.appendChild(groupName);

        const taskCount = document.createElement('span');
        taskCount.className = 'custom-group-count';
        // 在状态列中，分组徽章：只统计顶层任务数量（子任务不计入）
        // 扩展 tasks 以包含后代任务，确保已完成子任务也能显示
        const expandedTasks = this.augmentTasksWithDescendants(tasks, group.id);
        const taskMapLocal = new Map(expandedTasks.map((t: any) => [t.id, t]));
        const topLevel = expandedTasks.filter((t: any) => !t.parentId || !taskMapLocal.has(t.parentId));
        taskCount.textContent = topLevel.length.toString();
        taskCount.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: 500;
            min-width: 18px;
            text-align: center;
        `;

        groupHeader.appendChild(groupTitle);

        // 右侧容器：任务计数 + 新建按钮 + 粘贴按钮
        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex; align-items:center; gap:4px;';
        headerRight.appendChild(taskCount);

        // 非已完成状态显示新建按钮和粘贴按钮
        if (status !== 'completed') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--text';
            addTaskBtn.style.cssText = 'padding: 2px; margin-left: 2px;';
            addTaskBtn.title = i18n('newTask');
            addTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const gid = group.id === 'ungrouped' ? null : group.id;
                this.showCreateTaskDialog(undefined, gid, status as any);
            });
            headerRight.appendChild(addTaskBtn);

            const pasteTaskBtn = document.createElement('button');
            pasteTaskBtn.className = 'b3-button b3-button--text';
            pasteTaskBtn.style.cssText = 'padding: 2px; margin-left: 2px;';
            pasteTaskBtn.title = i18n('pasteNew');
            pasteTaskBtn.innerHTML = `<svg style="width: 14px; height: 14px;"><use xlink:href="#iconPaste"></use></svg>`;
            pasteTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const gid = group.id === 'ungrouped' ? null : group.id;
                // 显示选择器
                this.showPasteTaskDialog(undefined, gid, status as any, true);
            });
            headerRight.appendChild(pasteTaskBtn);
        }

        groupHeader.appendChild(headerRight);
        groupHeaderWrapper.appendChild(groupHeader);

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'custom-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px; padding-right: 8px;
            display: ${isCollapsedDefault ? 'none' : 'block'};
        `;

        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'b3-button b3-button--text custom-group-collapse-btn';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsedDefault ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsedDefault ? '展开分组' : '折叠分组';
        collapseBtn.style.cssText = `
            padding: 2px;
            min-width: auto;
            margin-right: 4px;
        `;

        const groupKey = `${group.id}-status-mode-${status}`; // 状态模式下的唯一Key

        // 检查是否已有明确的折叠/展开记录
        let isCollapsed = false;
        if (this.collapsedStatusGroups.has(groupKey)) {
            isCollapsed = true;
        } else if (this.expandedStatusGroups.has(groupKey)) {
            isCollapsed = false;
        } else {
            // 没有记录，使用配置的默认值
            isCollapsed = isCollapsedDefault;
        }

        // 设置初始效果
        groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

            // 更新持久化状态
            if (isCollapsed) {
                this.collapsedStatusGroups.add(groupKey);
                this.expandedStatusGroups.delete(groupKey);
            } else {
                this.collapsedStatusGroups.delete(groupKey);
                this.expandedStatusGroups.add(groupKey);
            }
        });

        groupTitle.insertBefore(collapseBtn, groupIcon);

        groupContainer.appendChild(groupHeaderWrapper);

        // 渲染任务（使用扩展后的任务列表）
        const pageKey = `status-mode-${groupKey}`;
        const currentPage = this.pageIndexMap[pageKey] || 1;
        this.pageIndexMap[pageKey] = currentPage;

        const { pagedTasks, hasMore } = this.paginateTasks(expandedTasks, currentPage);
        this.renderTasksInColumn(groupTasksContainer, pagedTasks);

        if (hasMore) {
            this.renderLoadMoreButton(groupTasksContainer, pageKey);
        }

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private showColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'flex';
        }
    }



    private createTaskElement(task: any, level: number = 0): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = 'kanban-task';
        if (level > 0) {
            taskEl.classList.add('is-subtask');
        }
        taskEl.draggable = !task.isSubscribed;
        if (task.isSubscribed) {
            taskEl.style.cursor = 'default';
        }
        taskEl.dataset.taskId = task.id;
        taskEl.dataset.level = level.toString();

        const priority = task.priority || 'none';

        // 存储任务数据到元素
        taskEl.dataset.priority = priority;

        // 添加优先级样式类
        if (priority !== 'none') {
            taskEl.classList.add(`kanban-task-priority-${priority}`);
        }

        // 设置任务颜色（根据优先级）
        let backgroundColor = '';
        let borderColor = '';
        switch (task.priority) {
            case 'high':
                backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                borderColor = 'var(--b3-theme-background-light)';
        }

        // 设置任务元素的背景色和边框
        taskEl.style.cssText = `
            cursor: grab;
            transition: all 0.2s ease;
            position: relative;
            background-color: ${backgroundColor};
            border: 1.5px solid ${borderColor};
        `;

        if (task.completed) {
            taskEl.style.opacity = '0.5';
        }

        if (level > 0) {
            taskEl.style.marginLeft = `${level * 20}px`;
        }

        // 多选模式下添加选中状态样式
        if (this.isMultiSelectMode && this.selectedTaskIds.has(task.id)) {
            taskEl.classList.add('kanban-task-selected');
            taskEl.style.boxShadow = '0 0 0 2px var(--b3-theme-primary)';
        }

        const taskMainContainer = document.createElement('div');
        taskMainContainer.className = 'kanban-task-main';
        taskMainContainer.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: flex-start;
        `;

        // 多选复选框（仅在多选模式下显示）
        let multiSelectCheckbox: HTMLInputElement | null = null;
        if (this.isMultiSelectMode) {
            multiSelectCheckbox = document.createElement('input');
            multiSelectCheckbox.type = 'checkbox';
            multiSelectCheckbox.className = 'kanban-task-multiselect-checkbox';
            multiSelectCheckbox.checked = this.selectedTaskIds.has(task.id);
            multiSelectCheckbox.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleTaskSelection(task.id, multiSelectCheckbox!.checked);
            });
            taskMainContainer.appendChild(multiSelectCheckbox);

            // 多选模式下点击整个任务卡片切换选择
            taskEl.addEventListener('click', (e) => {
                // 如果点击的是多选复选框本身，不处理（让复选框自己的事件处理）
                if ((e.target as HTMLElement).classList.contains('kanban-task-multiselect-checkbox')) {
                    // 更新最后点击的任务ID，以便作为下次Shift选取的起点
                    this.lastClickedTaskId = task.id;
                    return;
                }

                // 支持 Shift 键范围选择
                if (e.shiftKey && this.lastClickedTaskId) {
                    // 获取当前所有可视任务的ID顺序
                    const allTaskEls = Array.from(this.container.querySelectorAll('.kanban-task'));
                    const allTaskIds = allTaskEls.map(el => (el as HTMLElement).dataset.taskId);

                    const lastIndex = allTaskIds.indexOf(this.lastClickedTaskId);
                    const currentIndex = allTaskIds.indexOf(task.id);

                    if (lastIndex !== -1 && currentIndex !== -1) {
                        const start = Math.min(lastIndex, currentIndex);
                        const end = Math.max(lastIndex, currentIndex);

                        // 选中范围内的所有任务
                        for (let i = start; i <= end; i++) {
                            const tid = allTaskIds[i];
                            if (tid && !this.selectedTaskIds.has(tid)) {
                                this.toggleTaskSelection(tid, true);
                            }
                        }

                        // 更新复选框状态（如果是当前点击的任务）
                        if (multiSelectCheckbox) {
                            multiSelectCheckbox.checked = true;
                        }
                        // Shift选择不更新 anchor (lastClickedTaskId)，这是常见习惯，或者更新？
                        // 这里选择不更新，保持 Anchor 不变，类似 Windows 文件资源管理器 behavior
                        return;
                    }
                }

                // 切换选择状态
                const newSelected = !this.selectedTaskIds.has(task.id);
                this.toggleTaskSelection(task.id, newSelected);
                // 更新复选框状态
                if (multiSelectCheckbox) {
                    multiSelectCheckbox.checked = newSelected;
                }

                // 记录最后一次点击的任务ID
                this.lastClickedTaskId = task.id;
            });
        } else {
            // 非多选模式下支持 Ctrl+点击 快速进入多选模式
            taskEl.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.stopPropagation();
                    // 进入多选模式并选中当前任务
                    this.toggleMultiSelectMode();
                    this.toggleTaskSelection(task.id, true);
                    this.lastClickedTaskId = task.id;
                }
            });
        }

        const taskIndentContainer = document.createElement('div');
        taskIndentContainer.className = 'kanban-task-indent';
        taskIndentContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 0px; /* 固定宽度以便对齐 */
            flex-shrink: 0;
        `;

        // 折叠按钮
        const childTasks = this.tasks.filter(t => t.parentId === task.id);
        if (childTasks.length > 0) {
            const isCollapsed = this.collapsedTasks.has(task.id);
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text kanban-task-collapse-btn';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? i18n('expandSubtasks') : i18n('collapseSubtasks');
            collapseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                // 加载最新数据以便持久化 fold 属性
                const reminderData = await getAllReminders(this.plugin);
                const targetId = task.isRepeatInstance ? (task.originalId || task.id) : task.id;
                const targetReminder = reminderData[targetId];

                if (isCollapsed) {
                    this.collapsedTasks.delete(task.id);
                    task.fold = false;
                    if (targetReminder) targetReminder.fold = false;
                } else {
                    this.collapsedTasks.add(task.id);
                    task.fold = true;
                    if (targetReminder) targetReminder.fold = true;
                }

                // 持久化保存
                if (targetReminder) {
                    await saveReminders(this.plugin, reminderData);
                }

                this.renderKanban();
            });
            taskIndentContainer.appendChild(collapseBtn);
        }

        taskMainContainer.appendChild(taskIndentContainer);

        // 复选框（非多选模式下显示）
        if (!this.isMultiSelectMode) {
            const checkboxEl = document.createElement('input');
            checkboxEl.type = 'checkbox';
            checkboxEl.className = 'kanban-task-checkbox';
            checkboxEl.checked = task.completed;
            checkboxEl.title = '点击完成/取消完成任务';
            if (task.isSubscribed) {
                checkboxEl.disabled = true;
                checkboxEl.title = i18n("subscribedTaskReadOnly") || "订阅任务（只读）";
            } else {
                checkboxEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const completed = checkboxEl.checked;
                    this.toggleTaskCompletion(task, completed);
                });
            }
            taskMainContainer.appendChild(checkboxEl);
        }

        const taskContentContainer = document.createElement('div');
        taskContentContainer.className = 'kanban-task-content';
        taskContentContainer.style.flex = '1';
        taskContentContainer.style.overflow = 'auto';

        // 如果是子任务且状态与父任务不同，且不是作为嵌套子任务显示（level=0表示顶层任务），则显示父任务名称
        // level > 0 表示该任务是作为父任务的子任务嵌套显示的，此时不需要显示父任务名
        if (task.parentId && level === 0) {
            const parentTask = this.tasks.find(t => t.id === task.parentId);
            if (parentTask) {
                const taskStatus = this.getTaskStatus(task);
                const parentStatus = this.getTaskStatus(parentTask);

                if (taskStatus !== parentStatus) {
                    const parentNameEl = document.createElement('div');
                    parentNameEl.className = 'kanban-task-parent-name';
                    parentNameEl.style.cssText = `
                        font-size: 11px;
                        color: var(--b3-theme-on-surface);
                        opacity: 0.6;
                        margin-bottom: 4px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    `;

                    const parentIcon = document.createElement('span');
                    parentIcon.textContent = '父任务：';
                    parentIcon.style.cssText = 'font-size: 12px;';

                    const parentTitle = document.createElement('span');
                    parentTitle.textContent = parentTask.title || i18n('noContentHint');
                    parentTitle.style.cssText = `
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    `;
                    parentTitle.title = i18n('parentTask') + ': ' + (parentTask.title || i18n('noContentHint'));

                    // 如果父任务有绑定块，可以点击跳转
                    if (parentTask.blockId || parentTask.docId) {
                        const targetId = parentTask.blockId || parentTask.docId;
                        parentTitle.style.cursor = 'pointer';
                        parentTitle.style.textDecoration = 'underline dotted';
                        parentTitle.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this.openBlockTab(targetId);
                        });
                        parentTitle.addEventListener('mouseenter', () => {
                            parentTitle.style.opacity = '0.8';
                        });
                        parentTitle.addEventListener('mouseleave', () => {
                            parentTitle.style.opacity = '0.6';
                        });
                    }

                    parentNameEl.appendChild(parentIcon);
                    parentNameEl.appendChild(parentTitle);
                    taskContentContainer.appendChild(parentNameEl);
                }
            }
        }

        // 任务标题
        const titleEl = document.createElement('div');
        titleEl.className = 'kanban-task-title';

        if (task.blockId || task.docId) {
            // 如果有绑定块，标题显示为可点击的超链接
            const targetId = task.blockId || task.docId;
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${targetId}`);
            titleEl.style.cssText = `
                font-weight: 500;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                cursor: pointer;
                text-decoration: underline dotted;
                text-decoration-style: dotted;
                transition: color 0.2s ease;
                width: fit-content;
            `;

            // 点击事件：打开块
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openBlockTab(targetId);
            });

        } else {
            // 没有绑定块，普通标题样式
            titleEl.style.cssText = `
                font-weight: 500;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
                width: fit-content;
            `;
        }

        titleEl.textContent = task.title || i18n('noContentHint');
        titleEl.title = (task.blockId || task.docId) ? i18n('clickToOpenBoundBlock', { title: task.title || i18n('noContentHint') }) : (task.title || i18n('noContentHint'));

        // 如果有子任务，添加数量指示器
        if (childTasks.length > 0) {
            const subtaskIndicator = document.createElement('span');
            subtaskIndicator.className = 'subtask-indicator';
            subtaskIndicator.textContent = ` (${childTasks.length})`;
            subtaskIndicator.title = i18n('containsNSubtasks', { count: String(childTasks.length) });
            subtaskIndicator.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            `;
            titleEl.appendChild(subtaskIndicator);
        }

        // 创建标题和链接的容器
        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 8px;';
        titleContainer.appendChild(titleEl);

        // 添加URL链接图标作为兄弟节点
        if (task.url) {
            const urlIcon = document.createElement('a');
            urlIcon.className = 'kanban-task-url-icon';
            urlIcon.href = task.url;
            urlIcon.target = '_blank';
            urlIcon.title = i18n("openUrl") + ': ' + task.url;
            urlIcon.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconLink"></use></svg>';
            urlIcon.style.cssText = 'color: var(--b3-theme-primary); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; flex-shrink: 0;';
            urlIcon.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            titleContainer.appendChild(urlIcon);
        }

        taskContentContainer.appendChild(titleContainer);

        // 任务信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'kanban-task-info';
        infoEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        if (task.completed && task.completedTime) {
            const completedTimeEl = document.createElement('div');
            completedTimeEl.className = 'kanban-task-completed-time';
            completedTimeEl.innerHTML = `<span>✅</span><span>完成于: ${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
            completedTimeEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            infoEl.appendChild(completedTimeEl);
        }

        // 日期时间
        const hasDate = task.date || task.endDate;
        if (hasDate) {
            const dateEl = document.createElement('div');
            dateEl.className = 'kanban-task-date';
            dateEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
                flex-wrap: wrap;
            `;

            // 添加周期图标（如果是周期事件或周期实例）
            if (task.repeat?.enabled || task.isRepeatInstance) {
                const repeatIcon = document.createElement('span');
                repeatIcon.textContent = '🔄';
                repeatIcon.title = task.repeat?.enabled ? getRepeatDescription(task.repeat) : '周期事件实例';
                repeatIcon.style.cssText = 'cursor: help;';
                dateEl.appendChild(repeatIcon);
            }

            const dateText = this.formatTaskDate(task);
            let dateHtml = `<span>📅${dateText}</span>`;

            // 添加倒计时显示
            if (!task.completed) {
                const countdownInfo = this.getTaskCountdownInfo(task);
                if (countdownInfo.type !== 'none' && countdownInfo.days >= 0) {
                    let urgencyClass = 'countdown-normal';
                    if (countdownInfo.days <= 1) {
                        urgencyClass = 'countdown-urgent';
                    } else if (countdownInfo.days <= 3) {
                        urgencyClass = 'countdown-warning';
                    }

                    dateHtml += `<span class="countdown-badge ${urgencyClass}">${countdownInfo.text}</span>`;
                }
            }

            dateEl.innerHTML += dateHtml;
            infoEl.appendChild(dateEl);
        }

        // 显示未来的提醒时间（独立显示，不与任务日期混在一起）
        if (!task.completed) {
            const today = getLogicalDateString();
            const futureReminderTimes: string[] = [];

            // 处理 reminderTimes 数组（新格式）
            if (task.reminderTimes && Array.isArray(task.reminderTimes)) {
                task.reminderTimes.forEach((item: any) => {
                    const timeStr = typeof item === 'string' ? item : item?.time;
                    if (timeStr) {
                        const reminderDate = this.parseReminderDate(timeStr, task.date);
                        if (reminderDate && compareDateStrings(reminderDate, today) >= 0) {
                            futureReminderTimes.push(timeStr);
                        }
                    }
                });
            }
            // 处理 customReminderTime（旧格式向后兼容）
            else if (task.customReminderTime) {
                const reminderDate = this.parseReminderDate(task.customReminderTime, task.date);
                if (reminderDate && compareDateStrings(reminderDate, today) >= 0) {
                    futureReminderTimes.push(task.customReminderTime);
                }
            }

            // 显示未来提醒时间
            if (futureReminderTimes.length > 0) {
                const reminderEl = document.createElement('div');
                reminderEl.className = 'kanban-task-reminder-times';
                reminderEl.style.cssText = `
                    font-size: 12px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.7;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    flex-wrap: wrap;
                `;
                const timesText = futureReminderTimes.map(t => this.formatReminderTimeDisplay(t, task.date, today)).join(', ');
                reminderEl.innerHTML = `<span>⏰${timesText}</span>`;
                infoEl.appendChild(reminderEl);
            }
        }

        // 优先级
        if (priority !== 'none') {
            const priorityEl = document.createElement('div');
            priorityEl.className = `kanban-task-priority priority-label-${priority}`;

            const priorityNames = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };

            priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
            infoEl.appendChild(priorityEl);
        }

        // 里程碑
        if (task.milestoneId) {
            const milestone = this.milestoneMap.get(task.milestoneId);
            if (milestone) {
                const milestoneEl = document.createElement('div');
                milestoneEl.className = 'kanban-task-milestone';
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
                // 如果里程碑绑定了块，添加悬浮预览支持
                if (milestone.blockId) {
                    milestoneEl.setAttribute('data-type', 'a');
                    milestoneEl.setAttribute('data-href', `siyuan://blocks/${milestone.blockId}`);
                    milestoneEl.style.color = 'var(--b3-theme-primary)';
                    milestoneEl.style.cursor = 'pointer';
                    milestoneEl.style.textDecoration = 'underline dotted';
                }
                milestoneEl.innerHTML = `<span>${milestone.icon || '🚩'}</span><span style="font-weight: 500;">${milestone.name}</span>`;
                infoEl.appendChild(milestoneEl);
            }
        }

        // 分类（支持多分类）
        if (task.categoryId) {
            const categoryContainer = document.createElement('div');
            categoryContainer.className = 'kanban-task-categories';
            categoryContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                align-self: flex-start;
            `;

            const categoryIds = typeof task.categoryId === 'string' ? task.categoryId.split(',') : [task.categoryId];
            let hasValidCategory = false;

            categoryIds.forEach((catId: string) => {
                const id = catId.trim();
                if (!id) return;

                const category = this.categoryManager.getCategoryById(id);
                if (category) {
                    hasValidCategory = true;
                    const categoryEl = document.createElement('div');
                    categoryEl.className = 'kanban-task-category';
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

        // 备注
        if (task.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'kanban-task-note';

            // 渲染 HTML
            if (this.lute) {
                noteEl.innerHTML = this.lute.Md2HTML(task.note);
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
            } else {
                noteEl.textContent = task.note;
            }

            noteEl.style.cssText = `
                font-size: 12px;
                opacity: 0.8;
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
            `;

            // 点击编辑备注
            noteEl.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();

                // 使用 Dialog 编辑
                new QuickReminderDialog(
                    undefined, undefined, undefined, undefined,
                    {
                        plugin: this.plugin,
                        mode: 'note',
                        reminder: task,
                        onSaved: async (updatedReminder) => {
                            // 乐观更新 UI
                            task.note = updatedReminder.note;
                            noteEl.innerHTML = this.lute ? this.lute.Md2HTML(task.note) : task.note;

                            // 触发全局更新事件（这会通知其他视图，比如 ReminderPanel）
                            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                                detail: {
                                    reminderId: updatedReminder?.id || task.id,
                                    source: this.kanbanInstanceId
                                }
                            }));

                            // 刷新当前看板视图
                            // 使用 queueLoadTasks 以防抖方式刷新
                            this.queueLoadTasks();
                        }
                    }
                ).show();
            });

            infoEl.appendChild(noteEl);
        }

        // 标签显示（使用标签ID）
        if (task.tagIds && task.tagIds.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'kanban-task-tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            // 获取项目标签配置以获取颜色和名称
            (async () => {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    // 创建标签ID到标签对象的映射
                    const tagMap = new Map(projectTags.map(t => [t.id, t]));

                    // 过滤出有效的标签ID
                    const validTagIds = task.tagIds.filter((tagId: string) => tagMap.has(tagId));

                    // 如果有无效标签，自动清理
                    if (validTagIds.length !== task.tagIds.length) {

                        // 异步清理无效标签
                        (async () => {
                            try {
                                const reminderData = await this.getReminders();
                                if (reminderData[task.id]) {
                                    reminderData[task.id].tagIds = validTagIds;
                                    await saveReminders(this.plugin, reminderData);
                                }
                            } catch (error) {
                                console.error('清理无效标签失败:', error);
                            }
                        })();
                    }

                    // 显示有效标签
                    validTagIds.forEach((tagId: string) => {
                        const tag = tagMap.get(tagId);
                        if (tag) {
                            const tagEl = document.createElement('span');
                            tagEl.className = 'kanban-task-tag';
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
                    console.error('加载标签失败:', error);
                }
            })();

            infoEl.appendChild(tagsContainer);
        }

        // 番茄钟数量 + 总专注时长 + 预计番茄时长
        if ((task.pomodoroCount && task.pomodoroCount > 0) || (typeof task.focusTime === 'number' && task.focusTime > 0) || task.estimatedPomodoroDuration || (task.totalRepeatingPomodoroCount && task.totalRepeatingPomodoroCount > 0)) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'kanban-task-pomodoro-count';
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
            const tomatoEmojis = `🍅 ${task.pomodoroCount || 0}`;
            const focusMinutes = task.focusTime || 0;
            const formatMinutesToString = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            };
            const focusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusMinutes)}` : '';
            const extraCount = '';

            // 预计番茄时长（第一行）
            const estimatedLine = task.estimatedPomodoroDuration ? `<span title='预计番茄时长'>预计: ${task.estimatedPomodoroDuration}</span>` : '';

            // 实际番茄钟数量和专注时长（第二行）
            let actualLine = '';

            if (task.isRepeatInstance) {
                const repeatingTotal = task.totalRepeatingPomodoroCount || 0;
                const repeatingFocus = task.totalRepeatingFocusTime || 0;
                const instanceCount = task.pomodoroCount || 0;

                const repeatingFocusText = repeatingFocus > 0 ? ` ⏱ ${formatMinutesToString(repeatingFocus)}` : '';
                const instanceFocusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusMinutes)}` : '';

                actualLine = `<div style="margin-top:${estimatedLine ? '6px' : '0'}">
                    <div title="系列累计番茄钟: ${repeatingTotal}">
                        <span>系列: 🍅 ${repeatingTotal}</span>
                        <span style="margin-left:8px; opacity:0.9;">${repeatingFocusText}</span>
                    </div>
                    <div title="本实例番茄钟: ${instanceCount}" style="margin-top:4px; opacity:0.95;">
                        <span>本次: 🍅 ${instanceCount}</span>
                        <span style="margin-left:8px; opacity:0.9;">${instanceFocusText}</span>
                    </div>
                 </div>`;
            } else {
                actualLine = (task.pomodoroCount > 0 || focusMinutes > 0) ? `<div style="margin-top:${estimatedLine ? '6px' : '0'}"><span title="完成的番茄钟数量: ${task.pomodoroCount}">总共：${tomatoEmojis}${extraCount}</span><span title="总专注时长: ${focusMinutes} 分钟" style="margin-left:8px; opacity:0.9;">${focusText}</span></div>` : '';
            }

            pomodoroDisplay.innerHTML = `${estimatedLine}${actualLine}`;

            infoEl.appendChild(pomodoroDisplay);
        }

        taskContentContainer.appendChild(infoEl);
        taskMainContainer.appendChild(taskContentContainer);

        // 不再单独显示绑定块信息，因为已经集成到标题中

        taskEl.appendChild(taskMainContainer);

        // 如果为父任务，计算子任务完成进度并在底部显示进度条
        const directChildren = this.tasks.filter(t => t.parentId === task.id);
        if (directChildren.length > 0) {
            const completedCount = directChildren.filter(c => c.completed).length;
            const percent = Math.round((completedCount / directChildren.length) * 100);

            const progressContainer = document.createElement('div');
            progressContainer.className = 'kanban-task-progress-container';
            progressContainer.style.cssText = `
                margin-top: 8px;
                padding: 6px 0 0 0;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const progressBarWrap = document.createElement('div');
            progressBarWrap.className = 'kanban-task-progress-wrap';
            progressBarWrap.style.cssText = `
                flex: 1;
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            `;

            const progressBar = document.createElement('div');
            progressBar.className = 'kanban-task-progress-bar';
            progressBar.style.cssText = `
                width: ${percent}%;
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
            `;

            progressBarWrap.appendChild(progressBar);

            const percentLabel = document.createElement('div');
            percentLabel.className = 'kanban-task-progress-text';
            percentLabel.textContent = `${percent}%`;
            percentLabel.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.85;
                min-width: 34px;
                text-align: right;
            `;

            progressContainer.appendChild(progressBarWrap);
            progressContainer.appendChild(percentLabel);
            taskEl.appendChild(progressContainer);
        }

        // 所有任务均启用拖拽（订阅任务也支持排序）
        taskEl.draggable = true;
        this.addTaskDragEvents(taskEl, task);
        taskEl.addEventListener('dragover', (e) => {
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain');
            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) return;

                const rect = taskEl.getBoundingClientRect();
                const mouseY = e.clientY;
                const taskTop = rect.top;
                const taskBottom = rect.bottom;
                const taskHeight = rect.height;

                // 定义区域：上边缘20%和下边缘20%用于排序，中间60%用于父子关系
                const sortZoneHeight = taskHeight * 0.2;
                const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;
                const isInParentChildZone = !isInTopSortZone && !isInBottomSortZone;

                // 排序检查 (支持现有同级排序和新的成为同级排序)
                const canSort = this.canDropForSort(this.draggedTask, targetTask);
                const canBecomeSibling = this.canBecomeSiblingOf(this.draggedTask, targetTask);
                const canSetParentChild = this.canSetAsParentChild(this.draggedTask, targetTask);

                // --- [新逻辑] ---
                // 检查是否允许改变状态、分组或优先级
                let isStructuralChange = false;
                const draggedStatus = this.getTaskStatus(this.draggedTask);
                const draggedGroup = this.draggedTask.customGroupId;
                const draggedPriority = this.draggedTask.priority || 'none';

                const draggedParentId = this.draggedTask.parentId;

                let targetStatus: string | undefined;
                if (this.kanbanMode === 'custom') {
                    const targetSubGroup = taskEl.closest('.custom-status-group') as HTMLElement;
                    targetStatus = targetSubGroup?.dataset.status;
                } else {
                    targetStatus = this.getTaskStatus(targetTask);
                }
                const targetGroup = targetTask.customGroupId;
                const targetPriority = targetTask.priority || 'none';
                const targetParentId = targetTask.parentId;

                if ((targetStatus && targetStatus !== draggedStatus) ||
                    (targetGroup !== draggedGroup) ||
                    (targetPriority !== draggedPriority) ||
                    (targetParentId !== draggedParentId)) {
                    if (!this.draggedTask.isSubscribed) {
                        isStructuralChange = true;
                    }
                }
                // --- [新逻辑结束] ---

                if ((isInTopSortZone || isInBottomSortZone)) {
                    // 排序操作
                    // 如果可以排序、成为同级 或 改变结构，则允许放置
                    if (canSort || canBecomeSibling || isStructuralChange) {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        const position = isInTopSortZone ? 'top' : 'bottom';
                        this.updateIndicator('sort', taskEl, position, e);
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else if (isInParentChildZone) {
                    // 父子任务操作
                    if (canSetParentChild || isStructuralChange) {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        this.updateIndicator('parentChild', taskEl, 'middle');
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else {
                    // 清除所有指示器
                    this.updateIndicator('none', null, null);
                }
            } else if (isExternalDrag) {
                // 允许外部拖拽冒泡到列区域
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                this.updateIndicator('none', null, null);
            }
        });

        taskEl.addEventListener('dragleave', (_e) => {
            // 检查是否真的离开了目标区域
            if (!taskEl.contains((_e as any).relatedTarget as Node)) {
                this.updateIndicator('none', null, null);
            }
        });

        taskEl.addEventListener('drop', (e) => {
            const multiData = e.dataTransfer?.getData('application/vnd.siyuan.kanban-tasks');
            if (this.isDragging || multiData || e.dataTransfer?.types.includes('application/x-reminder')) {
                this.clearDropZoneHighlights();
            }
            // Check for batch data first
            if (multiData) {
                e.preventDefault();
                e.stopPropagation();

                try {
                    const taskIds = JSON.parse(multiData);
                    if (Array.isArray(taskIds) && taskIds.length > 0) {
                        const targetTask = this.getTaskFromElement(taskEl);
                        if (!targetTask || taskIds.includes(targetTask.id)) {
                            this.updateIndicator('none', null, null);
                            return;
                        }

                        const rect = taskEl.getBoundingClientRect();
                        const mouseY = e.clientY;
                        const taskTop = rect.top;
                        const taskBottom = rect.bottom;
                        const taskHeight = rect.height;
                        const sortZoneHeight = taskHeight * 0.2;

                        const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                        const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;

                        if (isInTopSortZone || isInBottomSortZone) {
                            const insertBefore = isInTopSortZone;
                            this.handleBatchSortDrop(taskIds, targetTask, insertBefore, e);
                        }
                    }
                } catch (err) { console.error(err); }

                this.updateIndicator('none', null, null);
                return;
            }

            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                e.preventDefault();
                e.stopPropagation(); // 阻止事件冒泡到列的 drop 区域

                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) {
                    this.updateIndicator('none', null, null);
                    return;
                }

                const rect = taskEl.getBoundingClientRect();
                const mouseY = e.clientY;
                const taskTop = rect.top;
                const taskBottom = rect.bottom;
                const taskHeight = rect.height;

                // 定义区域
                const sortZoneHeight = taskHeight * 0.2;
                const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;
                const isInParentChildZone = !isInTopSortZone && !isInBottomSortZone;

                const canSort = this.canDropForSort(this.draggedTask, targetTask);
                const canBecomeSibling = this.canBecomeSiblingOf(this.draggedTask, targetTask);
                const canSetParentChild = this.canSetAsParentChild(this.draggedTask, targetTask);

                // --- [新逻辑] ---
                let isStructuralChange = false;
                const draggedStatus = this.getTaskStatus(this.draggedTask);
                const draggedGroup = this.draggedTask.customGroupId;
                const draggedPriority = this.draggedTask.priority || 'none';

                const draggedParentId = this.draggedTask.parentId;

                let targetStatus: string | undefined;
                if (this.kanbanMode === 'custom') {
                    const targetSubGroup = taskEl.closest('.custom-status-group') as HTMLElement;
                    targetStatus = targetSubGroup?.dataset.status;
                } else {
                    targetStatus = this.getTaskStatus(targetTask);
                }
                const targetGroup = targetTask.customGroupId;
                const targetPriority = targetTask.priority || 'none';
                const targetParentId = targetTask.parentId;

                if ((targetStatus && targetStatus !== draggedStatus) ||
                    (targetGroup !== draggedGroup) ||
                    (targetPriority !== draggedPriority) ||
                    (targetParentId !== draggedParentId)) {
                    if (!this.draggedTask.isSubscribed) {
                        isStructuralChange = true;
                    }
                }
                // --- [新逻辑结束] ---

                if ((isInTopSortZone || isInBottomSortZone)) {
                    if (canSort || isStructuralChange) {
                        // 执行排序
                        this.handleSortDrop(targetTask, e);
                    } else if (canBecomeSibling) {
                        // 执行成为兄弟任务并排序的操作
                        this.handleBecomeSiblingDrop(this.draggedTask, targetTask, e);
                    }
                } else if (isInParentChildZone) {
                    if (canSetParentChild) {
                        // 执行父子任务设置
                        this.handleParentChildDrop(targetTask);
                    } else if (canSort || isStructuralChange) {
                        // [Fallback] Cannot become child, but can sort (e.g. move across groups/status)
                        this.handleSortDrop(targetTask, e);
                    }
                }
            }
            this.updateIndicator('none', null, null);
        });

        // 添加右键菜单
        taskEl.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (task.isSubscribed) {
                this.showSubscribedTaskContextMenu(e, task);
                return;
            }
            await this.showTaskContextMenu(e, task);
        });

        // 添加悬停效果
        taskEl.addEventListener('mouseenter', () => {
            taskEl.style.transform = 'translateY(-2px)';
            taskEl.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
        });

        taskEl.addEventListener('mouseleave', () => {
            if (!this.isDragging) {
                taskEl.style.transform = 'translateY(0)';
                taskEl.style.boxShadow = 'none';
            }
        });

        return taskEl;
    }

    private formatTaskDate(task: any): string {
        const today = getLogicalDateString();
        const tomorrowStr = getRelativeDateString(1);

        // 获取当前年份
        const currentYear = new Date().getFullYear();

        // 辅助函数：格式化日期显示
        const formatDateWithYear = (date: Date): string => {
            const year = date.getFullYear();
            return year !== currentYear
                ? date.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'short', day: 'numeric' })
                : date.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
        };

        // 辅助函数：计算过期天数
        const getExpiredDays = (targetDate: string): number => {
            return Math.ceil((new Date(today).getTime() - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24));
        };

        // 辅助函数：创建过期徽章（completed 为 true 时使用“X天前”的词语）
        const createExpiredBadge = (days: number, completed: boolean = false): string => {
            const text = completed ? i18n('daysAgo', { days: String(days) }) : i18n('overdueDays', { days: String(days) });
            return `<span class="countdown-badge countdown-normal" style="background-color: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3);">${text}</span>`;
        };

        // 使用逻辑日期判断（考虑一天起始时间）
        const logicalStart = this.getTaskLogicalDate(task.date, task.time);
        const logicalEnd = this.getTaskLogicalDate(task.endDate || task.date, task.endTime || task.time);

        // 如果只有截止时间，显示截止时间（基于逻辑结束日判断过期/今天/明天）
        if (!task.date && task.endDate) {
            const endDate = new Date(task.endDate);

            // 检查是否过期（使用逻辑结束日期）
            if (compareDateStrings(logicalEnd, today) < 0) {
                const daysDiff = getExpiredDays(task.endDate);
                const dateStr = formatDateWithYear(endDate);
                return `${dateStr} ${createExpiredBadge(daysDiff, !!task.completed)}`;
            }

            if (logicalEnd === today) {
                return i18n('todayDeadline');
            } else if (logicalEnd === tomorrowStr) {
                return i18n('tomorrowDeadline');
            } else {
                const dateStr = formatDateWithYear(endDate);
                return `${dateStr} ${i18n('countdownEnd')}`;
            }
        }

        // 如果有开始时间，按逻辑日期显示
        let dateStr = '';
        if (logicalStart === today) {
            dateStr = i18n('today');
        } else if (logicalStart === tomorrowStr) {
            dateStr = i18n('tomorrow');
        } else {
            const taskDate = new Date(task.date);

            // 检查是否过期（使用逻辑起始日期）
            if (compareDateStrings(logicalStart, today) < 0) {
                const formattedDate = formatDateWithYear(taskDate);
                // 如果任务有结束日期且和开始日期不同，避免在开始日期处显示过期徽章（只在结束日期处显示一次）
                if (task.endDate && task.endDate !== task.date) {
                    dateStr = formattedDate;
                } else {
                    const daysDiff = getExpiredDays(task.date);
                    dateStr = `${formattedDate} ${createExpiredBadge(daysDiff, !!task.completed)} `;
                }
            } else {
                // 如果不在今年，显示年份
                dateStr = formatDateWithYear(taskDate);
            }
        }

        // 如果是农历循环事件，添加农历日期显示
        if (task.repeat?.enabled && (task.repeat.type === 'lunar-monthly' || task.repeat.type === 'lunar-yearly')) {
            try {
                const lunarStr = getSolarDateLunarString(task.date);
                if (lunarStr) {
                    dateStr = `${dateStr} (${lunarStr})`;
                }
            } catch (error) {
                console.error('Failed to format lunar date:', error);
            }
        }

        let endDateStr = '';
        if (task.endDate && task.endDate !== task.date) {
            const taskEndDate = new Date(task.endDate);

            // 检查结束日期是否过期（使用逻辑结束日期）
            if (compareDateStrings(logicalEnd, today) < 0) {
                const daysDiff = getExpiredDays(task.endDate);
                const formattedEndDate = formatDateWithYear(taskEndDate);
                endDateStr = `${formattedEndDate} ${createExpiredBadge(daysDiff, !!task.completed)} `;
            } else {
                // 如果结束日期不在今年，显示年份
                endDateStr = formatDateWithYear(taskEndDate);
            }
        }

        if (task.time) {
            dateStr += ` ${task.time}`;
        }

        if (endDateStr) {
            // 如果有截止时间，加到截止日期后面
            if (task.endTime) {
                endDateStr += ` ${task.endTime}`;
            }
            return `${dateStr} → ${endDateStr} `;
        }

        // 如果是同一天，但是有结束时间（比如 14:00 - 16:00）
        if (task.endTime && task.endTime !== task.time) {
            return `${dateStr} - ${task.endTime}`;
        }

        return dateStr || "未设置日期";
    }

    private getTaskCountdownInfo(task: any): { text: string; days: number; type: 'start' | 'end' | 'none' } {
        // 使用逻辑日期计算天数差（考虑一天起始时间）
        const today = getLogicalDateString();

        const calcDays = (targetLogicalDate: string) => {
            const target = new Date(targetLogicalDate + 'T00:00:00');
            const base = new Date(today + 'T00:00:00');
            return Math.ceil((target.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
        };

        // 如果同时有开始日期和结束日期，则仅基于结束日期显示倒计时（避免同时显示开始和结束倒计时）
        if (task.date && task.endDate) {
            const logicalEnd = this.getTaskLogicalDate(task.endDate, task.endTime || task.time);
            const endDays = calcDays(logicalEnd);

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? i18n('todayEnd') : i18n('endsInNDays', { days: String(endDays) }),
                    days: endDays,
                    type: 'end'
                };
            }
            return { text: '', days: endDays, type: 'none' };
        }

        // 如果只有开始日期
        if (task.date) {
            const logicalStart = this.getTaskLogicalDate(task.date, task.time);
            const startDays = calcDays(logicalStart);

            // 如果还没开始
            if (startDays > 0) {
                return {
                    text: i18n('startsInNDays', { days: String(startDays) }),
                    days: startDays,
                    type: 'start'
                };
            }

            // 否则没有有效的开始倒计时，继续检查结束日期（如果存在）
            if (task.endDate) {
                const logicalEnd = this.getTaskLogicalDate(task.endDate, task.endTime || task.time);
                const endDays = calcDays(logicalEnd);

                if (endDays >= 0) {
                    return {
                        text: endDays === 0 ? i18n('todayEnd') : i18n('endsInNDays', { days: String(endDays) }),
                        days: endDays,
                        type: 'end'
                    };
                }
            }
        }

        // 只有结束日期的情况
        if (task.endDate) {
            const logicalEnd = this.getTaskLogicalDate(task.endDate, task.endTime || task.time);
            const endDays = calcDays(logicalEnd);

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? i18n('todayEnd') : i18n('endsInNDays', { days: String(endDays) }),
                    days: endDays,
                    type: 'end'
                };
            }
        }

        return { text: '', days: 0, type: 'none' };
    }

    private addTaskDragEvents(element: HTMLElement, task: any) {
        element.addEventListener('dragover', (e) => {
            const types = e.dataTransfer?.types || [];
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain') ||
                types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) || types.includes('application/vnd.siyuan-gutter') ||
                types.includes(Constants.SIYUAN_DROP_FILE) || types.includes('application/vnd.siyuan-file') ||
                types.includes(Constants.SIYUAN_DROP_TAB) || types.includes('application/vnd.siyuan-tab');

            if (isExternalDrag && !this.isDragging) {
                e.preventDefault();
                e.dataTransfer!.dropEffect = 'move'; // Explicitly set dropEffect

                // Draw external drop sort indicator
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                if (e.clientY < midPoint) {
                    this.updateIndicator('sort', element, 'top', e);
                } else {
                    this.updateIndicator('sort', element, 'bottom', e);
                }
                return;
            }
            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
            // ... internal task drag logic ...
            // 仅允许子任务拖拽到父任务上边缘
            if (task.id === this.draggedTask.parentId) {
                const rect = element.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                if (offsetY < 16) { // 上边缘区域
                    e.preventDefault();
                    this.updateIndicator('parentChild', element, 'top', e);
                } else {
                    this.updateIndicator('none', null, null);
                }
            }
        });

        element.addEventListener('dragleave', () => {
            this.updateIndicator('none', null, null);
        });

        element.addEventListener('drop', async (e) => {
            // Handle external drop on task (for sorting)
            const types = e.dataTransfer?.types || [];
            const isExternalDrag = e.dataTransfer?.types.includes('application/x-reminder') || e.dataTransfer?.types.includes('text/plain') ||
                types.some(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER)) || types.includes('application/vnd.siyuan-gutter') ||
                types.includes(Constants.SIYUAN_DROP_FILE) || types.includes('application/vnd.siyuan-file') ||
                types.includes(Constants.SIYUAN_DROP_TAB) || types.includes('application/vnd.siyuan-tab');

            if (isExternalDrag && !this.isDragging) {
                this.clearAllIndicators();
                e.preventDefault();
                e.stopPropagation();
                // Determine sort position based on drop
                // Logic delegates to handleDrop on the column/group/status which called this creation, or we handle it here if possible.
                // However, external drop handling is currently in the container/column 'drop' event.
                // But the 'drop' event bubbles. The column handler will catch it.
                // To support sorting, we need to pass the target task info to handleDrop.
                // We can attach the target info to the event object or use a shared state, 
                // but since handleDrop is called by the container 'drop' listener, we can modify handleDrop to check for the drop target.

                // Let's manually trigger handleDrop with target context
                const rect = element.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const insertBefore = e.clientY < midPoint;

                // Find parameters for handleDrop
                const status = this.getTaskStatus(task);
                const customGroupId = task.customGroupId;

                await this.handleDrop(e, status, customGroupId, { targetTask: task, insertBefore });
                return;
            }

            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
            if (task.id === this.draggedTask.parentId) {
                const rect = element.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                if (offsetY < 16) {
                    // 解除父子关系
                    await this.unsetParentChildRelation(this.draggedTask);
                    this.clearAllIndicators();
                }
            }
        });
        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedTask = task;
            this.draggedElement = element;
            element.style.opacity = '0.5';
            element.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';

                // 支持批量拖拽
                if (this.isMultiSelectMode && this.selectedTaskIds.has(task.id)) {
                    const selectedIds = Array.from(this.selectedTaskIds);
                    e.dataTransfer.setData('application/vnd.siyuan.kanban-tasks', JSON.stringify(selectedIds));

                    // 设置拖拽样式
                    const dragIcon = document.createElement('div');
                    dragIcon.style.cssText = `
                        background: var(--b3-theme-primary);
                        color: white;
                        padding: 6px 10px;
                        border-radius: 4px;
                        font-size: 12px;
                        position: absolute;
                        top: -1000px;
                        font-weight: bold;
                        z-index: 10000;
                    `;
                    const count = selectedIds.length;
                    dragIcon.textContent = `${count} ${i18n('tasks') || '个任务'}`;
                    document.body.appendChild(dragIcon);
                    try {
                        e.dataTransfer.setDragImage(dragIcon, 0, 0);
                    } catch (err) {
                        // ignore setDragImage errors
                    }
                    setTimeout(() => dragIcon.remove(), 0);
                }

                e.dataTransfer.setData('text/html', element.outerHTML);
                // 支持拖动到日历：携带任务的最小必要信息，格式与 ReminderPanel 保持一致
                try {
                    const payload = {
                        id: task.id,
                        title: task.title || '',
                        date: task.date || null,
                        time: task.time || null,
                        endDate: task.endDate || null,
                        endTime: task.endTime || null,
                        durationMinutes: (() => {
                            try {
                                if (task.time && task.endTime) {
                                    const [sh, sm] = (task.time || '00:00').split(':').map(Number);
                                    const [eh, em] = (task.endTime || task.time || '00:00').split(':').map(Number);
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
                    e.dataTransfer.setData('text/plain', task.id);
                } catch (err) {
                    // ignore
                }
            }
        });

        element.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedTask = null;
            this.draggedElement = null;
            element.style.opacity = '';
            element.style.cursor = 'grab';
            element.style.transform = 'translateY(0)';
            element.style.boxShadow = 'none';

            // 清理所有拖拽状态
            this.container.querySelectorAll('.kanban-drop-zone-active').forEach(el => {
                el.classList.remove('kanban-drop-zone-active');
            });
            // 清除所有指示器和状态
            this.updateIndicator('none', null, null);
        });
    }

    private showSubscribedTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("subscribedTaskContextMenu");

        menu.addItem({
            iconHTML: "ℹ️",
            label: i18n("subscribedTaskReadOnly") || "订阅任务（只读）",
            disabled: true
        });
        menu.addSeparator();

        // 导航选项
        const targetId = task.blockId || task.docId;
        if (targetId) {
            menu.addItem({
                iconHTML: "📖",
                label: i18n("openNote") || "打开笔记",
                click: () => this.openBlockTab(targetId)
            });
            menu.addItem({
                iconHTML: "📋",
                label: i18n("copyBlockRef") || "复制块引用",
                click: () => this.copyBlockRef(task)
            });
        }

        menu.addSeparator();

        // 生产力工具
        menu.addItem({
            iconHTML: "🍅",
            label: i18n("startPomodoro") || "开始番茄钟",
            click: () => this.startPomodoro(task)
        });
        menu.addItem({
            iconHTML: "⏱️",
            label: i18n("startCountUp") || "开始正向计时",
            click: () => this.startPomodoroCountUp(task)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY,
        });
    }

    private async showTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("kanbanTaskContextMenu");

        const childTasks = this.tasks.filter(t => t.parentId === task.id);

        // 编辑任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示修改此实例和修改所有实例
            menu.addItem({
                iconHTML: "📝",
                label: i18n('modifyThisInstance'),
                click: () => this.editInstanceReminder(task)
            });
            menu.addItem({
                iconHTML: "🔄",
                label: i18n('modifyAllInstances'),
                click: () => this.editTask(task)
            });
        } else if (task.repeat?.enabled) {
            // 原始周期事件 - 只显示编辑选项
            menu.addItem({
                iconHTML: "📝",
                label: i18n('editTask'),
                click: () => this.editTask(task)
            });
        } else {
            // 普通任务
            menu.addItem({
                iconHTML: "📝",
                label: i18n('editTask'),
                click: () => this.editTask(task)
            });
            // 绑定块功能
            if (task.blockId || task.docId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: i18n('copyBlockRef'),
                    click: () => this.copyBlockRef(task)
                });
            } else {
                menu.addItem({
                    iconHTML: "🔗",
                    label: i18n('bindToBlock'),
                    click: () => this.showBindToBlockDialog(task)
                });
            }
        }

        menu.addItem({
            iconHTML: "➕",
            label: i18n('createSubtask'),
            click: () => this.showCreateTaskDialog(task)
        });

        // 粘贴新建子任务
        menu.addItem({
            iconHTML: "📋",
            label: i18n('pasteCreateSubtask'),
            click: () => this.showPasteTaskDialog(task)
        });

        // 父子任务管理
        if (task.parentId) {
            menu.addItem({
                iconHTML: "🔗",
                label: i18n('unsetParentRelation'),
                click: () => this.unsetParentChildRelation(task)
            });
        }
        // 复制子任务为多级 Markdown 列表
        if (childTasks.length > 0) {
            menu.addItem({
                iconHTML: "📋",
                label: i18n('copySubtasksAsList'),
                click: () => {
                    const childLines = this.buildMarkdownListFromChildren(task.id);
                    if (childLines && childLines.length > 0) {
                        const text = childLines.join('\n');
                        // 复制到剪贴板
                        try {
                            navigator.clipboard.writeText(text);
                            showMessage(i18n('copiedSubtasksList'));
                        } catch (err) {
                            // 备用：使用临时 textarea
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            showMessage(i18n('copiedSubtasksList'));
                        }
                    } else {
                        showMessage(i18n('noSubtasksToCopy'));
                    }
                }
            });
        }

        menu.addSeparator();
        // Helper: quick date submenu items (快速调整日期)
        const createQuickDateMenuItems = (targetTask: any, onlyThisInstance: boolean = false) => {
            const items: any[] = [];
            const todayStr = getLogicalDateString();
            const tomorrowStr = getRelativeDateString(1);
            const dayAfterStr = getRelativeDateString(2);
            const nextWeekStr = getRelativeDateString(7);

            const apply = async (newDate: string | null) => {
                try {
                    if (targetTask.isRepeatInstance && onlyThisInstance) {
                        // 使用原始实例日期作为键（如果实例曾被移动，task.date 可能已改变）
                        const originalInstanceDate = (targetTask.id && targetTask.id.includes('_')) ? targetTask.id.split('_').pop()! : targetTask.date;
                        const reminderData = await getAllReminders(this.plugin);
                        const originalReminder = reminderData[targetTask.originalId];
                        if (!originalReminder) {
                            showMessage(i18n("reminderNotExist"));
                            return;
                        }

                        if (!originalReminder.repeat) originalReminder.repeat = {};
                        if (!originalReminder.repeat.instanceModifications) originalReminder.repeat.instanceModifications = {};
                        if (!originalReminder.repeat.instanceModifications[originalInstanceDate]) originalReminder.repeat.instanceModifications[originalInstanceDate] = {};

                        if (newDate === null) {
                            // 标记为移除该实例（generateRepeatInstances 会跳过 date 为 null 的修改）
                            originalReminder.repeat.instanceModifications[originalInstanceDate].date = null;
                            delete originalReminder.repeat.instanceModifications[originalInstanceDate].endDate;
                        } else {
                            originalReminder.repeat.instanceModifications[originalInstanceDate].date = newDate;

                            // 如果原始为跨天，保持跨度
                            if (originalReminder.endDate && originalReminder.date) {
                                const span = getDaysDifference(originalReminder.date, originalReminder.endDate);
                                originalReminder.repeat.instanceModifications[originalInstanceDate].endDate = addDaysToDate(newDate, span);
                            }
                        }

                        await saveReminders(this.plugin, reminderData);

                        this.dispatchReminderUpdate(true);
                        this.queueLoadTasks();
                        showMessage(i18n("instanceTimeUpdated") || "实例时间已更新");
                    } else {
                        const targetId = targetTask.isRepeatInstance ? targetTask.originalId : targetTask.id;
                        const reminderData = await getAllReminders(this.plugin);
                        const reminder = reminderData[targetId];
                        if (!reminder) {
                            showMessage(i18n("reminderNotExist"));
                            return;
                        }

                        const oldDate: string | undefined = reminder.date;
                        const oldEndDate: string | undefined = reminder.endDate;

                        if (newDate === null) {
                            // 清除日期和相关结束日期/时间
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

                        this.dispatchReminderUpdate(true);
                        this.queueLoadTasks();
                        showMessage(i18n("operationSuccessful"));
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
            items.push({ iconHTML: "❌", label: i18n('clearDate') || '清除日期', click: () => apply(null) });
            return items;
        };

        // 快速调整日期
        menu.addItem({
            iconHTML: "📆",
            label: i18n('quickReschedule') || '快速调整日期',
            submenu: createQuickDateMenuItems(task, !!task.isRepeatInstance)
        });



        // 设置优先级子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: i18n('priorityHigh'), icon: '🔴' },
            { key: 'medium', label: i18n('priorityMedium'), icon: '🟡' },
            { key: 'low', label: i18n('priorityLow'), icon: '🔵' },
            { key: 'none', label: i18n('none'), icon: '⚫' }
        ];

        const currentPriority = task.priority || 'none';
        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => this.setPriority(task, priority.key)
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: i18n('setPriority'),
            submenu: priorityMenuItems
        });

        // 状态切换：显示“设置状态”子菜单，列出所有可用状态（优先使用项目自定义的看板状态）
        const currentStatus = this.getTaskStatus(task);

        const statuses = (this.kanbanStatuses && this.kanbanStatuses.length > 0)
            ? this.kanbanStatuses
            : this.projectManager.getDefaultKanbanStatuses();

        const statusMenuItems: any[] = [];
        statuses.forEach((s: any) => {
            statusMenuItems.push({
                iconHTML: s.icon || '',
                label: s.name || s.id,
                current: currentStatus === s.id,
                click: () => this.changeTaskStatus(task, s.id)
            });
        });

        menu.addItem({
            iconHTML: "🔀",
            label: i18n('setStatus') || '设置状态',
            submenu: statusMenuItems
        });

        // 设置分组子菜单（仅在项目有自定义分组时显示）
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

            // 过滤掉已归档的分组
            const activeGroups = projectGroups.filter((g: any) => !g.archived);

            if (activeGroups.length > 0) {
                const groupMenuItems = [];
                const currentGroupId = task.customGroupId;

                // 添加"移除分组"选项
                groupMenuItems.push({
                    iconHTML: "❌",
                    label: i18n('removeGroup'),
                    current: !currentGroupId,
                    // 传入 task 对象（setTaskCustomGroup 期望第一个参数为 task 对象）
                    click: () => this.setTaskCustomGroup(task, null)
                });

                // 添加所有未归档分组选项
                activeGroups.forEach((group: any) => {
                    groupMenuItems.push({
                        iconHTML: group.icon || "📋",
                        label: group.name,
                        current: currentGroupId === group.id,
                        // 传入 task 对象（setTaskCustomGroup 期望第一个参数为 task 对象）
                        click: () => this.setTaskCustomGroup(task, group.id)
                    });
                });

                menu.addItem({
                    iconHTML: "📂",
                    label: i18n('setGroup'),
                    submenu: groupMenuItems
                });
            }
        } catch (error) {
            console.error('加载分组信息失败:', error);
        }
        // 设置标签子菜单（仅在项目有标签时显示）
        try {
            const projectTags = await this.projectManager.getProjectTags(this.projectId);

            if (projectTags.length > 0) {
                const tagMenuItems = [];
                const currentTagIds = task.tagIds || [];

                projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                    const isSelected = currentTagIds.includes(tag.id);

                    // 创建带颜色的标签HTML，固定宽度并支持省略号
                    const tagBadgeHTML = `
                        <div style="
                            display: flex;
                            align-items: center;
                            width: 100%;
                        ">
                            <span style="
                                display: inline-flex;
                                align-items: center;
                                padding: 2px 8px;
                                font-size: 11px;
                                border-radius: 12px;
                                background: ${tag.color}20;
                                border: 1px solid ${tag.color};
                                color: var(--b3-theme-on-surface);
                                font-weight: 500;
                                max-width: 150px;
                                min-width: 80px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                            " title="${tag.name}">#${tag.name}</span>
                        </div>
                    `;

                    tagMenuItems.push({
                        iconHTML: isSelected ? "✓" : "",
                        label: tagBadgeHTML,
                        click: () => this.toggleTaskTag(task, tag.id)
                    });
                });

                menu.addItem({
                    iconHTML: "🏷️",
                    label: i18n('setTags'),
                    submenu: tagMenuItems
                });
            }
        } catch (error) {
            console.error('加载项目标签失败:', error);
        }

        // 设置里程碑子菜单
        try {
            const projectManager = this.projectManager;
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[this.projectId];

            const currentMilestoneId = task.milestoneId;
            const taskGroupId = task.customGroupId;

            let availableMilestones = [];
            if (!taskGroupId || taskGroupId === 'ungrouped') {
                availableMilestones = (project?.milestones || []).filter((m: any) => !m.archived);
            } else {
                const group = projectGroups.find((g: any) => g.id === taskGroupId);
                availableMilestones = (group?.milestones || []).filter((m: any) => !m.archived);
            }

            if (availableMilestones.length > 0) {
                const milestoneMenuItems = [];

                // 添加“移除里程碑”选项
                milestoneMenuItems.push({
                    iconHTML: "❌",
                    label: i18n('noMilestone') || '无里程碑',
                    current: !currentMilestoneId,
                    click: () => this.setTaskMilestone(task, null)
                });

                availableMilestones.forEach(ms => {
                    milestoneMenuItems.push({
                        iconHTML: ms.icon || "🚩",
                        label: ms.name,
                        current: currentMilestoneId === ms.id,
                        click: () => this.setTaskMilestone(task, ms.id)
                    });
                });

                menu.addItem({
                    iconHTML: "🚩",
                    label: i18n('setMilestone') || "设置里程碑",
                    submenu: milestoneMenuItems
                });
            }
        } catch (error) {
            console.error('加载项目里程碑失败:', error);
        }




        menu.addSeparator();

        // 番茄钟
        menu.addItem({
            iconHTML: "🍅",
            label: i18n('startPomodoro'),
            click: () => this.startPomodoro(task)
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: i18n('startStopwatch'),
            click: () => this.startPomodoroCountUp(task)
        });

        menu.addSeparator();

        // 删除任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示删除此实例和删除所有实例
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteThisInstance'),
                click: () => this.deleteInstanceOnly(task)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteAllInstances'),
                click: () => this.deleteTask(task)
            });
        } else {
            // 普通任务或原始周期事件
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteTask'),
                click: () => this.deleteTask(task)
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async toggleTaskCompletion(task: any, completed: boolean) {
        // 1. 乐观更新 UI (Optimistic UI Update)
        const optimisticTask = this.tasks.find(t => t.id === task.id);
        if (optimisticTask) {
            optimisticTask.completed = completed;
            if (completed) {
                // 设置一个临时的完成时间用于排序
                optimisticTask.completedTime = getLocalDateTimeString(new Date());
            } else {
                delete optimisticTask.completedTime;
            }

            // 重新渲染：统一通过防抖刷新以保证数据一致性，避免局部渲染留下旧 DOM
            // 这会在短延迟后调用 loadTasks()，并由事件广播/队列保证最终一致性。
            this.queueLoadTasks();
        }

        // 2. 后台执行保存逻辑
        (async () => {
            try {
                if (task.isRepeatInstance && task.originalId) {
                    // 对于重复实例,使用不同的完成逻辑
                    await this.toggleRepeatInstanceCompletion(task, completed);
                } else {
                    // 对于普通任务
                    const reminderData = await this.getReminders();
                    if (reminderData[task.id]) {
                        reminderData[task.id].completed = completed;
                        const affectedBlockIds = new Set<string>();
                        if (task.blockId || task.docId) {
                            affectedBlockIds.add(task.blockId || task.docId);
                        }

                        if (completed) {
                            reminderData[task.id].completedTime = getLocalDateTimeString(new Date());
                            // 父任务完成时，自动完成所有子任务
                            await this.completeAllChildTasks(task.id, reminderData, affectedBlockIds);
                        } else {
                            delete reminderData[task.id].completedTime;
                            // 取消完成父任务时，通常不自动取消子任务
                        }

                        await saveReminders(this.plugin, reminderData);

                        // 更新所有受影响块的书签状态
                        for (const bId of affectedBlockIds) {
                            try {
                                await updateBindBlockAtrrs(bId, this.plugin);
                            } catch (err) {
                                console.warn('更新块书签失败:', bId, err);
                            }
                        }

                        // 广播更新事件并刷新
                        this.dispatchReminderUpdate(true);
                        // 确保最终一致
                        this.queueLoadTasks();
                    }
                }
            } catch (error) {
                console.error('切换任务完成状态失败:', error);
                showMessage('操作失败，正在恢复...');
                this.queueLoadTasks(); // 失败回滚
            }
        })();
    }

    /**
     * 切换重复实例的完成状态
     * @param task 重复实例任务
     * @param completed 是否完成
     */
    private async toggleRepeatInstanceCompletion(task: any, completed: boolean) {
        try {
            const reminderData = await this.getReminders();
            const originalReminder = reminderData[task.originalId];
            let affectedBlockIds: Set<string>;

            if (!originalReminder) {
                showMessage("原始重复事件不存在");
                return;
            }

            // [FIX] 确保 repeat 对象存在
            if (!originalReminder.repeat) {
                originalReminder.repeat = {};
            }

            // 初始化完成实例列表
            if (!originalReminder.repeat.completedInstances) {
                originalReminder.repeat.completedInstances = [];
            }

            const instanceDate = task.date;
            const completedInstances = originalReminder.repeat.completedInstances;

            if (completed) {
                // 添加到完成列表（如果还没有的话）
                if (!completedInstances.includes(instanceDate)) {
                    completedInstances.push(instanceDate);
                }

                // 记录完成时间
                if (!originalReminder.repeat.instanceCompletedTimes) {
                    originalReminder.repeat.instanceCompletedTimes = {};
                }
                originalReminder.repeat.instanceCompletedTimes[instanceDate] = getLocalDateTimeString(new Date());

                // 收集受影响的块 ID
                affectedBlockIds = new Set<string>();

                // 递归完成所有子任务的对应实例或本身，包括普通子任务
                await this.completeAllChildInstances(task.originalId, instanceDate, reminderData, affectedBlockIds, task.id);
            } else {
                // 从完成列表中移除
                const index = completedInstances.indexOf(instanceDate);
                if (index > -1) {
                    completedInstances.splice(index, 1);
                }

                // 移除完成时间记录
                if (originalReminder.repeat.instanceCompletedTimes) {
                    delete originalReminder.repeat.instanceCompletedTimes[instanceDate];
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 如果是标记为完成，更新受影响子任务的块属性
            if (completed) {
                // 必须在 saveReminders 之后执行，以确保 updateBindBlockAtrrs 读取到最新的 reminderData
                // (虽然 updateBindBlockAtrrs 内部会重新读取，但最好保证数据一致)
                // 实际上 updateBindBlockAtrrs 会读取 block 属性并更新样式，它依赖的是插件的 reminder 数据是否已更新完成状态
                // 这里 affectedBlockIds 可能包含普通子任务的 blockId
                for (const bId of affectedBlockIds) {
                    try {
                        await updateBindBlockAtrrs(bId, this.plugin);
                    } catch (err) {
                        console.warn('更新块书签失败:', bId, err);
                    }
                }
            }

            // 更新本地缓存
            const localTask = this.tasks.find(t => t.id === task.id);
            if (localTask) {
                localTask.completed = completed;
                if (completed) {
                    localTask.completedTime = originalReminder.repeat.instanceCompletedTimes?.[instanceDate];
                } else {
                    delete localTask.completedTime;
                }

                // 更新 DOM
                this.updateTaskElementDOM(localTask.id, {
                    completed,
                    completedTime: localTask.completedTime
                });
            }

            // 广播更新事件
            this.dispatchReminderUpdate(true);
        } catch (error) {
            console.error('切换重复实例完成状态失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async changeTaskStatus(task: any, newStatus: string) {
        try {
            // 保存旧状态,用于后续的DOM移动
            const oldStatus = this.getTaskStatus(task);

            // 如果当前是通过拖拽触发的状态变更，并且任务有设置日期且该日期为今天或已过
            // 则阻止直接把它移出 "进行中"，提示用户需要修改任务时间才能移出。
            try {
                const today = getLogicalDateString();
                // 如果任务未完成且有设置日期，且该日期为今天或已过，且目标状态不是“进行中/完成”，
                // 无论是通过拖拽还是右键菜单修改，都应提示用户：系统会自动将该任务显示在“进行中”列，
                // 如要移出“进行中”需先修改任务的日期或时间。
                if (task && !task.completed && task.date && compareDateStrings(this.getTaskLogicalDate(task.date, task.time), today) <= 0 && newStatus !== 'doing' && newStatus !== 'completed') {
                    const dialog = new Dialog({
                        title: '提示',
                        content: `
                            <div class="b3-dialog__content">
                                <p>该任务的日期为今天或已过，系统会将其自动显示在“进行中”列。</p>
                                <p>要将任务移出“进行中”，需要修改任务的日期或时间。</p>
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                                <button class="b3-button b3-button--primary" id="editBtn">编辑任务时间</button>
                            </div>
                        `,
                        width: "420px"
                    });

                    const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
                    const editBtn = dialog.element.querySelector('#editBtn') as HTMLButtonElement;

                    cancelBtn.addEventListener('click', () => dialog.destroy());
                    editBtn.addEventListener('click', async () => {
                        dialog.destroy();
                        // 打开编辑对话框以便用户修改时间
                        await this.editTask(task);
                    });

                    return; // 中断后续状态切换
                }
            } catch (err) {
                // ignore parsing errors and continue
            }
            const reminderData = await this.getReminders();

            // 对于周期实例，使用 originalId；否则使用 task.id
            const actualTaskId = task.isRepeatInstance ? task.originalId : task.id;

            if (reminderData[actualTaskId]) {
                const affectedBlockIds = new Set<string>();
                if (task.blockId || task.docId) {
                    affectedBlockIds.add(task.blockId || task.docId);
                }

                // 如果是周期实例，需要更新实例的完成状态
                if (task.isRepeatInstance) {
                    // 处理周期实例的完成状态
                    if (newStatus === 'completed') {
                        // 标记这个特定日期的实例为已完成
                        if (!reminderData[actualTaskId].repeat) {
                            reminderData[actualTaskId].repeat = {};
                        }
                        if (!reminderData[actualTaskId].repeat.completedInstances) {
                            reminderData[actualTaskId].repeat.completedInstances = [];
                        }
                        // 添加到已完成实例列表（如果还没有）
                        if (!reminderData[actualTaskId].repeat.completedInstances.includes(task.date)) {
                            reminderData[actualTaskId].repeat.completedInstances.push(task.date);
                        }

                        // 周期实例完成时，也自动完成所有子任务的对应实例
                        await this.completeAllChildInstances(actualTaskId, task.date, reminderData, affectedBlockIds, task.id);
                    } else {
                        // [FIX] 对于周期实例的状态修改，应该只影响该实例及其 Ghost 子任务
                        // 而不是修改原始任务的全局状态
                        const instanceDate = task.date;
                        // Use originalId if available for recursion
                        const targetId = task.isRepeatInstance ? task.originalId : task.id;
                        const originalIdsToUpdate = [targetId, ...this.getAllDescendantIds(targetId, reminderData)];

                        for (const oid of originalIdsToUpdate) {
                            const originalTask = reminderData[oid];
                            if (!originalTask) continue;

                            // 1. Ensure repeat structure exists for instance modification
                            const instMod = this.ensureInstanceModificationStructure(originalTask, instanceDate);

                            // 2. Update status
                            instMod.kanbanStatus = newStatus;

                            // 3. Ensure not marked as completed for this date (un-complete if needed)
                            if (originalTask.repeat?.completedInstances) {
                                const idx = originalTask.repeat.completedInstances.indexOf(instanceDate);
                                if (idx > -1) originalTask.repeat.completedInstances.splice(idx, 1);
                            }
                            if (originalTask.repeat?.instanceCompletedTimes && originalTask.repeat.instanceCompletedTimes[instanceDate]) {
                                delete originalTask.repeat.instanceCompletedTimes[instanceDate];
                            }

                            // 4. Collect affected blocks
                            if (originalTask.blockId || originalTask.docId) {
                                affectedBlockIds.add(originalTask.blockId || originalTask.docId);
                            }
                        }
                    }
                } else {
                    // 非周期实例的正常处理
                    if (newStatus === 'completed') {
                        reminderData[actualTaskId].completed = true;
                        reminderData[actualTaskId].completedTime = getLocalDateTimeString(new Date());

                        // 父任务完成时，自动完成所有子任务
                        await this.completeAllChildTasks(actualTaskId, reminderData, affectedBlockIds);
                    } else {
                        reminderData[actualTaskId].completed = false;
                        delete reminderData[actualTaskId].completedTime;

                        // 根据新状态设置kanbanStatus
                        if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                        } else {
                            // 支持自定义 kanban status id（非 long_term/short_term/doing）
                            reminderData[actualTaskId].kanbanStatus = newStatus;
                        }
                    }
                }

                await saveReminders(this.plugin, reminderData);

                // 更新受影响块的书签状态
                for (const bId of affectedBlockIds) {
                    try {
                        await updateBindBlockAtrrs(bId, this.plugin);
                    } catch (err) {
                        console.warn('更新块书签失败:', bId, err);
                    }
                }

                // 触发更新事件（debounced 由 listener 自动处理）
                this.dispatchReminderUpdate(true);

                // 如果是拖拽操作,尝试使用智能DOM移动
                if (this.isDragging) {
                    // 更新本地缓存
                    const localTask = this.tasks.find(t => t.id === actualTaskId);
                    if (localTask) {
                        if (newStatus === 'done') {
                            localTask.completed = true;
                            localTask.completedTime = reminderData[actualTaskId].completedTime;
                        } else {
                            localTask.completed = false;
                            delete localTask.completedTime;
                            localTask.kanbanStatus = newStatus;
                        }
                    }

                    // 尝试智能移动DOM
                    const taskEl = this.container.querySelector(`[data-task-id="${actualTaskId}"]`) as HTMLElement;
                    if (taskEl) {
                        const moved = this.moveTaskCardToColumn(taskEl, oldStatus, newStatus);
                        if (moved) {
                            // 刷新任务元素以应用新的样式（如已完成状态的透明度）
                            this.refreshTaskElement(actualTaskId);
                        } else {
                            // 移动失败,重新加载
                            await this.queueLoadTasks();
                        }
                    } else {
                        // 找不到元素,重新加载
                        await this.queueLoadTasks();
                    }
                } else {
                    // 非拖拽操作,重新加载以确保正确性
                    await this.queueLoadTasks();
                }
            }
        } catch (error) {
            console.error('切换任务状态失败:', error);
            showMessage("状态切换失败");
        }
    }

    /**
     * 当父任务完成时，自动完成所有子任务
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     */
    private async completeAllChildTasks(parentId: string, reminderData: any, affectedBlockIds?: Set<string>): Promise<void> {
        try {
            // 获取所有子任务ID（递归获取所有后代）
            const descendantIds = this.getAllDescendantIds(parentId, reminderData);

            if (descendantIds.length === 0) {
                return; // 没有子任务，直接返回
            }

            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            // 自动完成所有子任务
            for (const childId of descendantIds) {
                const childTask = reminderData[childId];
                if (childTask && !childTask.completed) {
                    childTask.completed = true;
                    childTask.completedTime = currentTime;
                    completedCount++;

                    // 收集需要更新的块ID
                    if (affectedBlockIds && (childTask.blockId || childTask.docId)) {
                        affectedBlockIds.add(childTask.blockId || childTask.docId);
                    }
                }
            }

            if (completedCount > 0) {
                showMessage(i18n('autoCompleteSubtasks', { count: String(completedCount) }), 2000);
            }
        } catch (error) {
            console.error('自动完成子任务失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 当周期任务实例完成时，自动完成所有子任务的对应实例或子任务本身
     * @param parentId 父任务原始ID
     * @param date 实例日期
     * @param reminderData 全量任务数据
     */
    private async completeAllChildInstances(parentId: string, date: string, reminderData: any, affectedBlockIds?: Set<string>, instanceId?: string): Promise<void> {
        try {
            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            // 1. 处理 Ghost 子任务 (基于 originalId 的后代)
            const ghostDescendantIds = this.getAllDescendantIds(parentId, reminderData);

            for (const childId of ghostDescendantIds) {
                const childTask = reminderData[childId];
                if (!childTask) continue;

                // 确保 repeat 结构存在，记录实例完成状态
                if (!childTask.repeat) {
                    childTask.repeat = {};
                }
                if (!childTask.repeat.completedInstances) {
                    childTask.repeat.completedInstances = [];
                }

                if (!childTask.repeat.completedInstances.includes(date)) {
                    childTask.repeat.completedInstances.push(date);

                    // 记录实例完成时间
                    if (!childTask.repeat.instanceCompletedTimes) {
                        childTask.repeat.instanceCompletedTimes = {};
                    }
                    childTask.repeat.instanceCompletedTimes[date] = currentTime;
                    completedCount++;

                    // 收集需要更新的块ID
                    if (affectedBlockIds && (childTask.blockId || childTask.docId)) {
                        affectedBlockIds.add(childTask.blockId || childTask.docId);
                    }
                }
            }

            // 2. 处理普通子任务 (直接绑定到 instanceId 的后代)
            // 如果未传入 instanceId，尝试构造可能的 instanceId
            const currentInstanceId = instanceId || `reminder_${parentId}_${date}`;

            // 获取该实例的直接后代（普通子任务）
            const realDescendantIds = this.getAllDescendantIds(currentInstanceId, reminderData);

            for (const childId of realDescendantIds) {
                const childTask = reminderData[childId];
                if (childTask && !childTask.completed) {
                    childTask.completed = true;
                    childTask.completedTime = currentTime;
                    completedCount++;

                    // 收集需要更新的块ID
                    if (affectedBlockIds && (childTask.blockId || childTask.docId)) {
                        affectedBlockIds.add(childTask.blockId || childTask.docId);
                    }
                }
            }

            if (completedCount > 0) {
                showMessage(i18n('autoCompleteSubtasks', { count: String(completedCount) }), 2000);
            }
        } catch (error) {
            console.error('自动完成子任务实例失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 递归获取所有后代任务ID
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     * @returns 所有后代任务ID数组
     */
    private getAllDescendantIds(parentId: string, reminderData: any): string[] {
        const result: string[] = [];
        const visited = new Set<string>(); // 防止循环引用

        const getChildren = (currentParentId: string) => {
            if (visited.has(currentParentId)) {
                return; // avoid cycles
            }
            visited.add(currentParentId);

            // Normalize reminderData into iterable list
            let values: any[] = [];
            try {
                if (!reminderData) values = [];
                else if (reminderData instanceof Map) values = Array.from(reminderData.values());
                else if (Array.isArray(reminderData)) values = reminderData;
                else values = Object.values(reminderData);
            } catch (e) {
                values = [];
            }

            for (const task of values) {
                if (task && task.parentId === currentParentId) {
                    result.push(task.id);
                    getChildren(task.id);
                }
            }
        };

        getChildren(parentId);
        return result;
    }

    /**
     * 收集给定任务ID集合的所有后代任务ID（基于 this.tasks）
     * @param taskIds 初始任务ID集合
     */
    private collectDescendantIds(taskIds: Set<string>): Set<string> {
        const idToTask = new Map(this.tasks.map(t => [t.id, t]));
        const visited = new Set<string>();
        const result = new Set<string>();
        const stack = Array.from(taskIds);

        while (stack.length > 0) {
            const id = stack.pop();
            if (!id || visited.has(id)) continue;
            visited.add(id);
            // 查找直接子任务
            for (const t of this.tasks) {
                if (t.parentId === id && !result.has(t.id)) {
                    result.add(t.id);
                    stack.push(t.id);
                }
            }
        }
        return result;
    }

    /**
     * 扩展一组任务，使其包含所有后代任务（可能包括已完成的子任务），以便在父任务下显示
     * @param tasksParam 需要扩展的任务数组（顶层任务列表）
     */
    private augmentTasksWithDescendants(tasksParam: any[], groupId?: string | null): any[] {
        if (!tasksParam || tasksParam.length === 0) return [];
        const idToTask = new Map(this.tasks.map(t => [t.id, t]));
        const resultMap = new Map<string, any>();

        // 初始添加（包含传入的任务）
        for (const t of tasksParam) {
            resultMap.set(t.id, t);
        }

        // 收集所有顶层任务 id
        const rootIds = new Set<string>(tasksParam.map(t => t.id));
        const descIds = this.collectDescendantIds(rootIds);
        for (const dId of descIds) {
            const dt = idToTask.get(dId);
            // 仅当子任务没有被分配到另一个自定义分组或其 customGroupId 与当前 groupId 匹配时，才作为后代添加
            if (dt) {
                if (!groupId || !dt.customGroupId || dt.customGroupId === groupId) {
                    resultMap.set(dId, dt);
                }
            }
        }

        // 返回数组形式，保持原来 tasksParam 的顺序尽可能不变：先原数组，然后添加后代（按 this.tasks 的顺序）
        const result: any[] = [];
        for (const t of tasksParam) result.push(t);
        for (const t of this.tasks) {
            if (resultMap.has(t.id) && !tasksParam.find(pt => pt.id === t.id)) {
                result.push(t);
            }
        }
        return result;
    }



    private async showFilterMenu(event: MouseEvent) {
        // 获取项目标签
        const tags = await this.projectManager.getProjectTags(this.projectId);
        const allTagIds = tags.map(t => t.id);
        allTagIds.push('__no_tag__');

        // 如果未激活筛选，则激活并默认全选（仅针对标签，日期默认为空即全选）
        if (!this.isFilterActive) {
            this.isFilterActive = true;
            allTagIds.forEach(id => this.selectedFilterTags.add(id));
            this.queueLoadTasks(); // This might be redundant if we just opened the menu, but keeps state consistent
        }

        // 创建弹窗容器
        const menu = document.createElement('div');
        menu.className = 'filter-dropdown-menu';
        menu.style.cssText = `
            display: block; 
            position: fixed; 
            z-index: 1000; 
            background-color: var(--b3-theme-background); 
            border: 1px solid var(--b3-border-color); 
            border-radius: 4px; 
            box-shadow: rgba(0, 0, 0, 0.15) 0px 2px 8px; 
            min-width: 200px; 
            max-height: 500px; 
            overflow-y: auto; 
            padding: 12px;
        `;

        // 计算定位
        const rect = (event.target as HTMLElement).getBoundingClientRect();

        // --- Helper to render section title ---
        const renderSectionTitle = (title: string) => {
            const div = document.createElement('div');
            div.style.cssText = `
                font-size: 12px;
                font-weight: 600;
                color: var(--b3-theme-on-surface-light);
                margin: 8px 0 4px 0;
                padding-left: 4px;
            `;
            div.textContent = title;
            menu.appendChild(div);
        };

        // --- Helper to render checkbox item ---
        const renderItem = (id: string, name: string, type: 'tag' | 'date', color?: string, icon?: string, checked?: boolean, onChange?: (isChecked: boolean) => void) => {
            const label = document.createElement('label');
            label.style.cssText = 'display: flex; align-items: center; padding: 6px 8px; cursor: pointer; user-select: none; border-radius: 4px; transition: background 0.1s;';
            label.addEventListener('mouseenter', () => label.style.backgroundColor = 'var(--b3-theme-on-surface-light)');
            label.addEventListener('mouseleave', () => label.style.backgroundColor = '');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'b3-switch'; // Or standard checkbox
            checkbox.style.cssText = 'margin-right: 8px;';
            checkbox.dataset.type = type;
            if (id) checkbox.dataset.val = id;

            checkbox.checked = checked !== undefined ? checked : (type === 'tag' ? this.selectedFilterTags.has(id) : this.selectedDateFilters.has(id));

            checkbox.addEventListener('change', () => {
                if (onChange) {
                    onChange(checkbox.checked);
                } else {
                    if (type === 'tag') {
                        if (checkbox.checked) this.selectedFilterTags.add(id);
                        else this.selectedFilterTags.delete(id);
                    } else {
                        if (checkbox.checked) this.selectedDateFilters.add(id);
                        else this.selectedDateFilters.delete(id);
                    }
                    this.queueLoadTasks();
                    this.updateFilterButtonState(allTagIds.length);
                }
            });

            // Color/Icon
            let iconHtml = '';
            if (icon) {
                iconHtml = `<span style="margin-right: 6px;">${icon}</span>`;
            } else if (color) {
                iconHtml = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${color}; margin-right: 8px;"></span>`;
            }

            const span = document.createElement('span');
            span.innerHTML = `${iconHtml}${name}`;
            span.style.cssText = 'display: flex; align-items: center; flex: 1;';

            label.appendChild(checkbox);
            label.appendChild(span);
            menu.appendChild(label);
        };

        // --- Date Section ---
        renderSectionTitle(i18n('date'));

        // Date Action Buttons
        const dateActions = document.createElement('div');
        dateActions.style.cssText = 'display: flex; gap: 8px; margin: 4px 8px 8px 8px;';

        const selectAllDatesBtn = document.createElement('button');
        selectAllDatesBtn.className = 'b3-button b3-button--text';
        selectAllDatesBtn.style.cssText = 'flex: 1; justify-content: center; font-size: 12px; height: 24px; line-height: 24px; padding: 0;';
        selectAllDatesBtn.textContent = i18n('selectAll') || '全选';
        selectAllDatesBtn.addEventListener('click', () => {
            // Select all specific date filters
            ['today', 'tomorrow', 'other_date', 'no_date', 'completed_today'].forEach(id => this.selectedDateFilters.add(id));
            this.selectedDateFilters.delete('all'); // Explicitly not "All Dates"

            const checkboxes = menu.querySelectorAll('input[data-type="date"]') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => {
                const val = cb.dataset.val;
                if (val !== 'all') cb.checked = true;
                else cb.checked = false;
            });
            this.queueLoadTasks();
            this.updateFilterButtonState(allTagIds.length);
        });

        const clearDatesBtn = document.createElement('button');
        clearDatesBtn.className = 'b3-button b3-button--text';
        clearDatesBtn.style.cssText = 'flex: 1; justify-content: center; font-size: 12px; height: 24px; line-height: 24px; padding: 0;';
        clearDatesBtn.textContent = i18n('clearSelection');
        clearDatesBtn.addEventListener('click', () => {
            this.selectedDateFilters.clear();
            // Clearing date filters means none selected -> effectively "All Dates" logic in loadTasks IF empty set means no filter?
            // Actually, my loadTasks logic: if (size > 0 && !has('all')) filter.
            // So empty set = All Dates.

            const checkboxes = menu.querySelectorAll('input[data-type="date"]') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => {
                if (cb.dataset.val !== 'all') cb.checked = false;
                else cb.checked = true; // "All Dates" is active
            });
            this.queueLoadTasks();
            this.updateFilterButtonState(allTagIds.length);
        });

        dateActions.appendChild(selectAllDatesBtn);
        dateActions.appendChild(clearDatesBtn);
        menu.appendChild(dateActions);

        // All Dates
        renderItem('all', i18n('allDates'), 'date', undefined, '📅', this.selectedDateFilters.size === 0 || this.selectedDateFilters.has('all'), (checked) => {
            if (checked) {
                this.selectedDateFilters.clear(); // Clear all specific date filters
                // Uncheck others
                const checkboxes = menu.querySelectorAll('input[data-type="date"]') as NodeListOf<HTMLInputElement>;
                checkboxes.forEach(cb => {
                    if (cb.dataset.val !== 'all') cb.checked = false;
                });
            } else {
                // Unchecking "All Dates" doesn't strictly mean anything unless we select something else.
                // But logically, if I uncheck "All Dates", I might expect to show nothing?
                // Or it just removes the "explicit" state. 
                // Let's say if we uncheck All, we essentially are in "Custom" mode but with nothing selected yet => Show Nothing (if strict).
                // However, my loadTasks logic says: if selectedDateFilters.size > 0 && !has('all') -> filter.
                // If size == 0, show all.
                // So unchecking 'all' (clearing the set) actually Shows All.
                // To make it intuitive: "All Dates" is a radio-like behavior.
                // If I select "Today", "All Dates" should be unchecked.
            }
            this.queueLoadTasks();
            this.updateFilterButtonState(allTagIds.length);
        });

        const dateFilters = [

            { id: 'today', name: i18n('today') || '今日', icon: '📅' },
            { id: 'tomorrow', name: i18n('tomorrow') || '明日', icon: '🗓️' },
            { id: 'other_date', name: i18n('otherDate'), icon: '📆' },

            { id: 'no_date', name: i18n('noDateReminders') || '无日期', icon: '🚫' },
            { id: 'completed_today', name: i18n('todayCompletedReminders') || '今日完成', icon: '✅' }
        ];

        dateFilters.forEach(f => {
            renderItem(f.id, f.name, 'date', undefined, f.icon, this.selectedDateFilters.has(f.id), (checked) => {
                if (checked) {
                    this.selectedDateFilters.add(f.id);
                    this.selectedDateFilters.delete('all');
                    // Uncheck "All Dates"
                    const allDatesCb = menu.querySelector('input[data-val="all"]') as HTMLInputElement;
                    if (allDatesCb) allDatesCb.checked = false;
                } else {
                    this.selectedDateFilters.delete(f.id);
                    // If no dates selected, check "All Dates" ?
                    if (this.selectedDateFilters.size === 0) {
                        const allDatesCb = menu.querySelector('input[data-val="all"]') as HTMLInputElement;
                        if (allDatesCb) allDatesCb.checked = true;
                    }
                }
                this.queueLoadTasks();
                this.updateFilterButtonState(allTagIds.length);
            });
        });

        const divider = document.createElement('div');
        divider.style.cssText = 'border-top: 1px solid var(--b3-border-color); margin: 8px 0px;';
        menu.appendChild(divider);

        // --- Tags Section ---
        renderSectionTitle(i18n('tags') || '标签');

        // Tags Action Buttons
        const tagsActions = document.createElement('div');
        tagsActions.style.cssText = 'display: flex; gap: 8px; margin: 4px 8px 8px 8px;';

        const selectAllTagsBtn = document.createElement('button');
        selectAllTagsBtn.className = 'b3-button b3-button--text';
        selectAllTagsBtn.style.cssText = 'flex: 1; justify-content: center; font-size: 12px; height: 24px; line-height: 24px; padding: 0;';
        selectAllTagsBtn.textContent = i18n('selectAll') || '全选';
        selectAllTagsBtn.addEventListener('click', () => {
            allTagIds.forEach(id => this.selectedFilterTags.add(id));
            const checkboxes = menu.querySelectorAll('input[data-type="tag"]') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => cb.checked = true);
            this.queueLoadTasks();
            this.updateFilterButtonState(allTagIds.length);
        });

        const clearTagsBtn = document.createElement('button');
        clearTagsBtn.className = 'b3-button b3-button--text';
        clearTagsBtn.style.cssText = 'flex: 1; justify-content: center; font-size: 12px; height: 24px; line-height: 24px; padding: 0;';
        clearTagsBtn.textContent = i18n('clearSelection');
        clearTagsBtn.addEventListener('click', () => {
            this.selectedFilterTags.clear();
            const checkboxes = menu.querySelectorAll('input[data-type="tag"]') as NodeListOf<HTMLInputElement>;
            checkboxes.forEach(cb => cb.checked = false);
            this.queueLoadTasks();
            this.updateFilterButtonState(allTagIds.length);
        });

        tagsActions.appendChild(selectAllTagsBtn);
        tagsActions.appendChild(clearTagsBtn);
        menu.appendChild(tagsActions);

        renderItem('__no_tag__', i18n('noTag'), 'tag', undefined, '🚫');
        tags.forEach(tag => {
            renderItem(tag.id, tag.name, 'tag', tag.color);
        });

        // 添加到 body 并计算自适应位置
        document.body.appendChild(menu);

        // 计算自适应位置，防止超出屏幕
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // 检查右侧是否超出屏幕，如果是则向左偏移
        if (rect.left + menuWidth > windowWidth) {
            menu.style.left = `${Math.max(8, rect.right - menuWidth)}px`;
        } else {
            menu.style.left = `${rect.left}px`;
        }

        // 检查底部是否超出屏幕，如果是则向上显示
        if (rect.bottom + 4 + menuHeight > windowHeight) {
            menu.style.top = `${Math.max(8, rect.top - menuHeight - 4)}px`;
        } else {
            menu.style.top = `${rect.bottom + 4}px`;
        }

        // 点击外部关闭
        const closeHandler = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node) && !this.filterButton.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }

    private updateFilterButtonState(totalTagCount: number) {
        // Tag filter active if not all tags selected (assuming default is all selected)
        // Actually, logic is: user customized filter.
        // My logic: if selectedFilterTags.size != totalTagCount (including no_tag) OR selectedDateFilters.size > 0
        const isTagFiltered = this.selectedFilterTags.size !== totalTagCount;
        const isDateFiltered = this.selectedDateFilters.size > 0 && !this.selectedDateFilters.has('all');

        if (isTagFiltered || isDateFiltered) {
            this.filterButton.classList.add('b3-button--primary');
            this.filterButton.classList.remove('b3-button--outline');
        } else {
            this.filterButton.classList.remove('b3-button--primary');
            this.filterButton.classList.add('b3-button--outline');
        }
    }

    private showSortMenu(event: MouseEvent) {
        if (document.querySelector('.kanban-sort-menu')) {
            return;
        }

        const menuEl = document.createElement('div');
        menuEl.className = 'kanban-sort-menu';
        menuEl.style.cssText = `
            position: absolute;
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-border);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                padding: 8px;
            z-index: 100;
                display: flex;
            flex-direction: column;
                gap: 4px;
                `;

        const sortOptions = [
            { key: 'priority', label: i18n('sortByPriority'), icon: '🎯' },
            { key: 'time', label: i18n('sortByTime'), icon: '🕐' },
            { key: 'createdAt', label: i18n('sortByCreated'), icon: '📅' },
            { key: 'title', label: i18n('sortByTitle'), icon: '📝' },
        ];

        const createOption = (option: any, order: 'asc' | 'desc') => {
            const button = document.createElement('button');
            button.className = 'b3-button b3-button--outline';
            const isActive = this.currentSort === option.key && this.currentSortOrder === order;
            button.style.cssText = `
                width: 100%;
                display: flex;
                align-items: center;
                gap: 8px;
                justify-content: flex-start;
                text-align: left;
                background-color: ${isActive ? 'var(--b3-theme-primary-lightest)' : 'transparent'};
                color: ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)'};
                `;
            // Use valid <span> tags (no stray spaces in tag names), and keep layout compact
            button.innerHTML = `
                    <span style="font-size: 16px; margin-right: 8px;">${option.icon}</span>
                    <span>${option.label} (${order === 'asc' ? i18n('ascendingOrder') : i18n('descendingOrder')})</span>
                `;
            button.addEventListener('click', async () => {
                this.currentSort = option.key;
                this.currentSortOrder = order;

                // 保存排序设置
                await this.projectManager.setProjectSortRule(this.projectId, option.key);
                await this.projectManager.setProjectSortOrder(this.projectId, order);

                this.updateSortButtonTitle();
                this.sortTasks();
                this.renderKanban();
                closeMenu();
            });
            return button;
        };

        sortOptions.forEach(option => {
            menuEl.appendChild(createOption(option, 'desc'));
            menuEl.appendChild(createOption(option, 'asc'));
        });

        document.body.appendChild(menuEl);

        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        // Remove stray whitespace before 'px' (invalid CSS) and ensure the menu stays aligned to trigger element
        menuEl.style.top = `${rect.bottom + 4}px`;
        menuEl.style.left = `${rect.right - menuEl.offsetWidth}px`;
        // Ensure a minimum width so the content doesn't wrap awkwardly
        menuEl.style.minWidth = '180px';
        // preferable box-sizing for predictable width calculations
        menuEl.style.boxSizing = 'border-box';

        // Prevent the menu from going outside the viewport
        let left = rect.right - menuEl.offsetWidth;
        let top = rect.bottom + 4;
        if (left < 4) left = 4;
        if (left + menuEl.offsetWidth > window.innerWidth - 4) left = Math.max(4, window.innerWidth - menuEl.offsetWidth - 4);
        if (top + menuEl.offsetHeight > window.innerHeight - 4) top = Math.max(4, rect.top - menuEl.offsetHeight - 4);
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;

        const closeMenu = () => {
            menuEl.remove();
            document.removeEventListener('click', handleClickOutside);
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (!menuEl.contains(e.target as Node) && e.target !== event.currentTarget) {
                closeMenu();
            }
        };

        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }

    private showDoneSortMenu(event: MouseEvent) {
        const menu = new Menu("kanbanDoneSortMenu");

        const addMenuItem = (label: string, sortKey: string, sortOrder: 'asc' | 'desc') => {
            menu.addItem({
                label: label,
                current: this.doneSort === sortKey && this.doneSortOrder === sortOrder,
                click: () => {
                    this.doneSort = sortKey;
                    this.doneSortOrder = sortOrder;

                    this.updateDoneSortButtonTitle();
                    this.renderKanban();
                }
            });
        };

        addMenuItem(`${i18n('sortByCompletedTime')} (${i18n('descendingOrder')})`, 'completedTime', 'desc');
        addMenuItem(`${i18n('sortByCompletedTime')} (${i18n('ascendingOrder')})`, 'completedTime', 'asc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortingPriority')} (${i18n('descendingOrder')})`, 'priority', 'desc');
        addMenuItem(`${i18n('sortingPriority')} (${i18n('ascendingOrder')})`, 'priority', 'asc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortBySetTime')} (${i18n('descendingOrder')})`, 'time', 'desc');
        addMenuItem(`${i18n('sortBySetTime')} (${i18n('ascendingOrder')})`, 'time', 'asc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortingTitle')} (${i18n('ascendingOrder')})`, 'title', 'asc');
        addMenuItem(`${i18n('sortingTitle')} (${i18n('descendingOrder')})`, 'title', 'desc');
        menu.addSeparator();
        addMenuItem(`${i18n('sortByCreated')} (${i18n('descendingOrder')})`, 'createdAt', 'desc');
        addMenuItem(`${i18n('sortByCreated')} (${i18n('ascendingOrder')})`, 'createdAt', 'asc');

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    // 使用 QuickReminderDialog 创建任务
    private showCreateTaskDialog(parentTask?: any, defaultCustomGroupId?: string | null, defaultStatus?: any, defaultMilestoneId?: string) {
        // Calculate max sort value to place new task at the end
        const maxSort = this.tasks.reduce((max, task) => Math.max(max, task.sort || 0), 0);
        const defaultSort = maxSort + 10000;

        const quickDialog = new QuickReminderDialog(
            undefined, // 项目看板创建任务默认不设置日期
            undefined, // 无初始时间
            async (savedTask: any) => {
                // 保存成功后尝试增量更新 DOM
                if (savedTask && typeof savedTask === 'object') {
                    try {
                        // 1. 更新本地缓存
                        if (this.reminderData) {
                            this.reminderData[savedTask.id] = savedTask;
                        }
                        // 确保 task 不重复添加
                        const existingIndex = this.tasks.findIndex(t => t.id === savedTask.id);

                        // 兼容性处理：新任务只有 createdAt，补齐 createdTime 以便排序
                        if (savedTask.createdAt && !savedTask.createdTime) {
                            savedTask.createdTime = savedTask.createdAt;
                        }

                        if (existingIndex >= 0) {
                            this.tasks[existingIndex] = savedTask;
                        } else {
                            this.tasks.push(savedTask);
                        }

                        // 立即排序，确保乐观更新时顺序正确
                        this.sortTasks();

                        // 2. 刷新对应列（增量渲染）
                        if (this.kanbanMode === 'custom') {
                            const group = this.project?.customGroups?.find((g: any) => g.id === savedTask.customGroupId);
                            if (group) {
                                const groupTasks = this.tasks.filter(t => t.customGroupId === group.id);
                                this.renderCustomGroupColumn(group, groupTasks);
                            } else {
                                const ungroupedTasks = this.tasks.filter(t => !t.customGroupId);
                                this.renderUngroupedColumn(ungroupedTasks);
                            }
                        } else {
                            const status = this.getTaskStatus(savedTask);
                            // 过滤出该状态列的所有任务
                            // 使用 getTaskStatus 确保逻辑一致（处理完成状态、日期自动归档、忽略自定义分组ID对列的影响）
                            const tasksInColumn = this.tasks.filter(t => this.getTaskStatus(t) === status);
                            this.renderColumn(status, tasksInColumn);
                        }

                        this.dispatchReminderUpdate(true);
                    } catch (e) {
                        console.error("增量更新新任务失败，回退到完整重载", e);
                        this.queueLoadTasks();
                    }
                } else {
                    this.queueLoadTasks();
                }
            },
            undefined, // 无时间段选项
            {
                defaultProjectId: this.projectId, // 默认项目ID
                defaultParentId: parentTask?.id, // 传递父任务ID
                defaultCategoryId: parentTask?.categoryId || this.project.categoryId, // 如果是子任务，继承父任务分类；否则使用项目分类
                defaultPriority: parentTask?.priority, // 如果是子任务，继承父任务优先级
                defaultTitle: parentTask ? '' : undefined, // 子任务不预填标题
                // 传入默认 custom group id（可能为 undefined 或 null）
                defaultCustomGroupId: parentTask?.customGroupId ?? defaultCustomGroupId,
                // 传入默认里程碑 id（优先使用父任务的里程碑）
                defaultMilestoneId: parentTask?.milestoneId ?? defaultMilestoneId,
                hideProjectSelector: true, // 隐藏项目选择器
                showKanbanStatus: 'term', // 显示任务类型选择
                // 使用父任务的状态优先；否则使用传入的 defaultStatus 或上一次选择的 status
                defaultStatus: parentTask ? this.getTaskStatus(parentTask) : (defaultStatus || this.lastSelectedStatus),
                plugin: this.plugin, // 传入plugin实例
                defaultSort: defaultSort
            }
        );

        quickDialog.show();

        // 重写保存回调，保存用户选择的 status 和自定义分组
        const originalOnSaved = quickDialog['onSaved'];
        quickDialog['onSaved'] = async (savedTask: any) => {
            if (originalOnSaved) {
                originalOnSaved(savedTask);
            }

            // 保存用户选择的 status 到内存中
            try {
                const selectedStatus = quickDialog['dialog']?.element?.querySelector('#quickStatusSelector .task-status-option.selected') as HTMLElement;
                const status = selectedStatus?.getAttribute('data-status-type');
                if (status && status !== this.lastSelectedStatus) {
                    this.lastSelectedStatus = status;
                }
            } catch (error) {
                console.error('保存上一次选择的 status 失败:', error);
            }

            // 保存用户选择的自定义分组到内存中（空字符串视为 null）
            try {
                const groupEl = quickDialog['dialog']?.element?.querySelector('#quickCustomGroupSelector') as HTMLSelectElement;
                if (groupEl) {
                    const val = groupEl.value;
                    const groupId = (val === '' ? null : val);
                    if (groupId !== this.lastSelectedCustomGroupId) {
                        this.lastSelectedCustomGroupId = groupId;
                    }
                }
            } catch (error) {
                console.error('保存上一次选择的自定义分组失败:', error);
            }
        };
    }

    private async editTask(task: any) {
        try {
            // 对于周期实例，需要编辑原始周期事件
            // 注意：不能直接使用实例对象，需要从数据中读取原始事件
            let taskToEdit = task;

            if (task.isRepeatInstance && task.originalId) {
                const reminderData = await this.getReminders();
                const originalReminder = reminderData[task.originalId];
                if (!originalReminder) {
                    showMessage("原始周期事件不存在");
                    return;
                }
                // 使用原始事件对象而不是实例对象
                taskToEdit = originalReminder;
            }

            // 优化：乐观更新 + 立即渲染 + 后台数据刷新
            const callback = (savedTask?: any) => {
                if (savedTask) {
                    // 1. 乐观更新内存中的任务数据
                    const taskIndex = this.tasks.findIndex(t => t.id === savedTask.id);
                    // 兼容性处理：如果返回的任务只有 createdAt，补齐 createdTime
                    if (savedTask.createdAt && !savedTask.createdTime) {
                        savedTask.createdTime = savedTask.createdAt;
                    }

                    if (taskIndex >= 0) {
                        // 保留原有的 status、pomodoroCount、focusTime 等衍生字段
                        const oldTask = this.tasks[taskIndex];
                        this.tasks[taskIndex] = {
                            ...savedTask,
                            status: oldTask.status || this.getTaskStatus(savedTask),
                            pomodoroCount: oldTask.pomodoroCount || 0,
                            focusTime: oldTask.focusTime || 0,
                            totalRepeatingPomodoroCount: oldTask.totalRepeatingPomodoroCount || 0,
                            totalRepeatingFocusTime: oldTask.totalRepeatingFocusTime || 0
                        };
                    } else {
                        // 理论上编辑任务不应该走到这里，但以防万一
                        this.tasks.push({
                            ...savedTask,
                            status: this.getTaskStatus(savedTask),
                            pomodoroCount: 0,
                            focusTime: 0
                        });
                    }

                    // 2. 立即重新排序和渲染（无延迟）
                    this.sortTasks();
                    this.renderKanban();

                    // 3. 清除缓存，触发后台防抖刷新以确保数据一致性
                    this.reminderData = null;
                    this.queueLoadTasks();
                }

                this.dispatchReminderUpdate(true);
            };

            const editDialog = new QuickReminderDialog(undefined, undefined, callback, undefined, {
                mode: 'edit',
                reminder: taskToEdit,
                plugin: this.plugin,
                defaultProjectId: taskToEdit.projectId,
                defaultCustomGroupId: taskToEdit.customGroupId
            });
            editDialog.show();
        } catch (error) {
            console.error('打开编辑对话框失败:', error);
            showMessage("打开编辑对话框失败");
        }
    }

    private async showPasteTaskDialog(parentTask?: any, customGroupId?: string, defaultStatus?: string, showSelectors: boolean = false) {
        // 如果需要显示选择器，获取项目配置
        let projectGroups: any[] = [];
        let projectMilestones: any[] = [];
        let kanbanStatuses: any[] = this.kanbanStatuses;

        if (showSelectors && !parentTask) {
            try {
                projectGroups = await this.projectManager.getProjectCustomGroups(this.projectId);
                projectMilestones = await this.projectManager.getProjectMilestones(this.projectId);
            } catch (error) {
                console.error('获取项目配置失败:', error);
            }
        }

        // 如果有父任务，则默认采用父任务的状态；否则使用传入的 defaultStatus
        const effectiveDefaultStatus = parentTask ? this.getTaskStatus(parentTask) : defaultStatus;

        const dialog = new PasteTaskDialog({
            plugin: this.plugin,
            parentTask,
            projectId: this.projectId,
            customGroupId,
            defaultStatus: effectiveDefaultStatus,
            showStatusSelector: showSelectors && !parentTask, // 只在非子任务且显示选择器时显示
            showGroupSelector: showSelectors && !parentTask,  // 只在非子任务且显示选择器时显示
            projectGroups,
            projectMilestones,
            kanbanStatuses,
            onSuccess: (totalCount) => {
                showMessage(`${totalCount} 个任务已创建`);
                this.reminderData = null; // 清理缓存，确保 queueLoadTasks 读取最新数据
                this.queueLoadTasks();
                this.dispatchReminderUpdate(true);
            }
        });
        dialog.show();
    }

    private async deleteTask(task: any) {
        // 对于周期实例，删除原始周期事件（所有实例）
        const taskToDelete = task.isRepeatInstance ?
            { ...task, id: task.originalId, isRepeatInstance: false } : task;

        // 先尝试读取数据以计算所有后代任务数量，用于更准确的确认提示
        let confirmMessage = task.isRepeatInstance ?
            i18n('confirmDeleteRepeat', { title: task.title }) :
            i18n('confirmDeleteTask', { title: task.title });
        try {
            const reminderDataForPreview = await this.getReminders();
            const descendantIdsPreview = this.getAllDescendantIds(taskToDelete.id, reminderDataForPreview);
            if (descendantIdsPreview.length > 0) {
                confirmMessage += `\n\n${i18n('includesNSubtasks', { count: String(descendantIdsPreview.length) })}`;
            }
        } catch (err) {
            // 无法读取数据时，仍然显示通用提示
        }

        confirm(
            i18n('deleteTask'),
            confirmMessage,
            async () => {
                // --- Optimistic UI Update ---
                try {
                    const idsToRemove = new Set<string>();

                    // 1. Identify main tasks to remove
                    if (task.isRepeatInstance) {
                        // If deleting all instances of a recurring task, find all instances in the current view
                        const originalId = task.originalId;
                        this.tasks.forEach(t => {
                            if (t.id === originalId || t.originalId === originalId) {
                                idsToRemove.add(t.id);
                            }
                        });
                    } else {
                        idsToRemove.add(taskToDelete.id);
                    }

                    // 2. Identify descendants (using local cache)
                    const initialTargets = Array.from(idsToRemove);
                    for (const parentId of initialTargets) {
                        const descendantIds = this.getAllDescendantIds(parentId, this.tasks);
                        descendantIds.forEach(id => idsToRemove.add(id));
                    }

                    // 3. Remove from DOM and local cache
                    idsToRemove.forEach(id => {
                        const el = this.container.querySelector(`[data-task-id="${id}"]`);
                        if (el) el.remove();
                    });

                    this.tasks = this.tasks.filter(t => !idsToRemove.has(t.id));

                } catch (e) {
                    console.error("Optimistic UI update failed:", e);
                }
                // -----------------------------

                try {
                    // 重读数据以确保删除时数据为最新
                    const reminderData = await this.getReminders();

                    // 获取所有后代任务ID（递归）
                    const descendantIds = this.getAllDescendantIds(taskToDelete.id, reminderData);

                    const tasksToDelete = [taskToDelete.id, ...descendantIds];
                    const boundIdsToUpdate = new Set<string>();

                    // 删除并收集需要更新的绑定块ID
                    for (const taskId of tasksToDelete) {
                        const t = reminderData[taskId];
                        if (t) {
                            // 收集绑定了块或文档的ID
                            if (t.blockId || t.docId) {
                                boundIdsToUpdate.add(t.blockId || t.docId);
                            }
                            // 删除数据项
                            delete reminderData[taskId];
                        }
                    }

                    // 先保存数据
                    await saveReminders(this.plugin, reminderData);

                    // 保存后再批量更新块的书签状态（忽略错误）
                    for (const boundId of boundIdsToUpdate) {
                        try {
                            await updateBindBlockAtrrs(boundId, this.plugin);
                        } catch (err) {
                            console.warn(`更新已删除任务属性失败: `, boundId, err);
                        }
                    }

                    // 触发更新事件
                    this.dispatchReminderUpdate(true);

                    // 重新加载任务（使用防抖队列，确保最终一致性）
                    await this.queueLoadTasks();

                    // showMessage("任务已删除");
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage("删除任务失败");
                    // Keep UI consistent or facilitate retry by reloading
                    await this.queueLoadTasks();
                }
            }
        );
    }

    private startPomodoro(task: any) {
        if (!this.plugin) {
            showMessage(i18n('pomodoroUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || i18n('currentPomodoroTask');
            const newTitle = task.title || i18n('newPomodoroTask');

            let confirmMessage = `${i18n('currentPomodoroTask')}："${currentTitle}"，${i18n('switchPomodoroTask')}："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n${i18n('switchAndInherit')}`;
            }

            confirm(
                i18n('switchPomodoroTask'),
                confirmMessage,
                () => {
                    this.performStartPomodoro(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            this.pomodoroManager.resumeCurrentTimer();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            this.performStartPomodoro(task);
        }
    }

    private startPomodoroCountUp(task: any) {
        if (!this.plugin) {
            showMessage(i18n('pomodoroUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || i18n('currentPomodoroTask');
            const newTitle = task.title || i18n('newPomodoroTask');

            let confirmMessage = `${i18n('currentPomodoroTask')}："${currentTitle}"，${i18n('switchToStopwatch')}："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n${i18n('switchAndInherit')}`;
            }

            confirm(
                i18n('switchToStopwatch'),
                confirmMessage,
                () => {
                    this.performStartPomodoroCountUp(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            this.pomodoroManager.resumeCurrentTimer();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            this.performStartPomodoroCountUp(task);
        }
    }

    private async performStartPomodoro(task: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
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

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);
            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换任务并继承${phaseText}进度`, 2000);
            }
        }
    }

    private async performStartPomodoroCountUp(task: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, true, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? i18n('workTime') : i18n('breakTime');
                    showMessage(i18n('switchToStopwatchWithInherit', { phase: phaseText }), 2000);
                } else {
                    showMessage(i18n('startStopwatchSuccess'), 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState, this.plugin);
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

    private addCustomStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#project-kanban-custom-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'project-kanban-custom-styles';
        style.textContent = `
            .project-kanban-view {
                height: 100%;
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
                position: relative;
            }

            .project-kanban-toolbar {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                padding: 16px 24px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-background);
                gap: 16px;
            }

            .project-kanban-title {
                width: 100%;
                border-bottom: 1px solid var(--b3-theme-border);
            }

            .project-kanban-controls {
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
                margin-left: auto;
            }

            /* 响应式布局 - 窄屏优化 */
            @media (max-width: 600px) {
                .project-kanban-toolbar {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 12px;
                }

                .project-kanban-title {
                    width: 100%;
                    min-width: auto;
                }

                .project-kanban-controls {
                    width: 100%;
                    justify-content: flex-start;
                    margin-left: 0;
                    gap: 6px;
                }

                .project-kanban-controls .b3-button {
                    flex: 0 1 auto;
                    min-width: auto;
                    font-size: 12px;
                    padding: 4px 8px;
                }
            }

            @media (max-width: 400px) {
                .project-kanban-toolbar {
                    padding: 8px 12px;
                }

                .project-kanban-title h2 {
                    font-size: 16px;
                }

                .project-kanban-description {
                    font-size: 12px;
                }

                .project-kanban-controls {
                    gap: 4px;
                }

                .project-kanban-controls .b3-button {
                    padding: 4px 6px;
                    font-size: 11px;
                }
                
                .project-kanban-controls .b3-button__icon {
                    width: 14px;
                    height: 14px;
                }
            }

            .project-kanban-container {
                flex: 1;
                display: flex;
                gap: 16px;
                padding: 16px;
                overflow-x: auto;
                overflow-y: auto;
                min-height: 0;
                /* 水平滚动布局：每列固定宽度 */
            }

            /* 确保在极窄屏幕上也能正常显示 */
            @media (max-width: 320px) {
                .project-kanban-container {
                    padding: 8px;
                    gap: 8px;
                }
            }

            .kanban-column {
                background: var(--b3-theme-background);
                border-radius: 8px;
                border: 2px solid var(--b3-border-color);
                display: flex;
                flex-direction: column;
                min-width: 280px; /* 固定最小宽度 */
                flex: 1; /* 均匀分布宽度 */
                max-height: 100%;
                max-width: 500px;
            }

            .kanban-column-header {
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .kanban-column-content {
                flex: 1;
                padding: 0px;
                overflow-y: auto;
                min-height: 200px;
                /* Reserve space for scrollbar so right padding doesn't appear larger
                   when the vertical scrollbar shows up */
                scrollbar-gutter: stable both-edges;
                /* Make scrollbar thinner where supported (Firefox) */
                scrollbar-width: thin;
            }

            .kanban-column-count {
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 12px;
                font-weight: 500;
                min-width: 20px;
                text-align: center;
            }

            /* 基础任务卡片样式 */
            .kanban-task {
                background: var(--b3-theme-surface-lighter);
                border: 1px solid var(--b3-theme-border);
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
                cursor: grab;
                transition: all 0.2s ease;
                position: relative;
            }

            .kanban-task:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }

            .kanban-task.dragging {
                opacity: 0.5;
                cursor: grabbing;
            }

            /* 优先级样式美化 - 使用思源主题颜色 */

            .kanban-task-priority-high:hover {
                box-shadow: 0 0 0 1px var(--b3-card-error-color), 0 4px 12px rgba(231, 76, 60, 0.25) !important;
            }


            .kanban-task-priority-medium:hover {
                box-shadow: 0 0 0 1px var(--b3-card-warning-color), 0 4px 12px rgba(243, 156, 18, 0.25) !important;
            }



            .kanban-task-priority-low:hover {
                box-shadow: 0 0 0 1px var(--b3-card-info-color), 0 4px 12px rgba(52, 152, 219, 0.25) !important;
            }

            .kanban-task-title {
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
            }

            .kanban-task-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .kanban-task-date {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            /* 优先级标签样式 - 参考 project-priority-label */
            .kanban-task-priority {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                margin-top: 2px;
                width: fit-content;
                align-self: flex-start;
            }

            .priority-label-high {
                background-color: rgba(231, 76, 60, 0.1);
                color: #e74c3c;
            }

            .priority-label-medium {
                background-color: rgba(243, 156, 18, 0.1);
                color: #f39c12;
            }

            .priority-label-low {
                background-color: rgba(52, 152, 219, 0.1);
                color: #3498db;
            }

            .priority-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
            }

            .priority-dot.high {
                background: #e74c3c;
            }

            .priority-dot.medium {
                background: #f39c12;
            }

            .priority-dot.low {
                background: #3498db;
            }

            .priority-dot.none {
                background: #95a5a6;
            }

            .kanban-task-category {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                color: white;
                font-weight: 500;
                align-self: flex-start;
            }

            .kanban-task-note {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 4px 8px;
                border-radius: 4px;
                border: 1px solid var(--b3-border-color);
                transition: all 0.2s ease;
            }
            .kanban-task-note:hover {
                background-color: var(--b3-theme-surface-lighter) !important;
                color: var(--b3-theme-primary) !important;
            }
            /* 优先级任务的备注样式 */
            .kanban-task-priority-high .kanban-task-note {
                background-color: rgba(231, 76, 60, 0.08);
                border-color: rgba(231, 76, 60, 0.2);
                color: var(--b3-card-error-color);
            }

            .kanban-task-priority-medium .kanban-task-note {
                background-color: rgba(243, 156, 18, 0.08);
                border-color: rgba(243, 156, 18, 0.2);
                color: var(--b3-card-warning-color);
            }

            .kanban-task-priority-low .kanban-task-note {
                background-color: rgba(52, 152, 219, 0.08);
                border-color: rgba(52, 152, 219, 0.2);
                color: var(--b3-card-info-color);
            }

            .kanban-drop-zone-active {
                background: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            /* 父子任务拖拽样式 */
            .parent-child-drop-target {
                border: 2px dashed var(--b3-theme-primary) !important;
                background: var(--b3-theme-primary-lightest) !important;
                transform: scale(1.02) !important;
                box-shadow: 0 4px 20px rgba(0, 123, 255, 0.3) !important;
                position: relative;
            }

            .parent-child-indicator {
                animation: fadeInUp 0.2s ease-out;
            }

            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }

            .parent-child-hint {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            /* 排序拖拽提示样式 */
            .sort-hint {
                animation: fadeInRight 0.2s ease-out;
            }

            @keyframes fadeInRight {
                from {
                    opacity: 0;
                    transform: translateX(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            
            .task-status-selector {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                align-items: flex-start;
            }
            .task-status-option {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                margin: 6px 8px 0 0;
                border-radius: 20px;
                cursor: pointer;
                border: 2px solid var(--b3-theme-border);
                transition: all 0.2s ease;
                background-color: var(--b3-theme-surface);
                white-space: nowrap;
            }
            .task-status-option:hover {
                background-color: var(--b3-theme-surface-lighter);
                border-color: var(--b3-theme-primary-lighter);
            }
            .task-status-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }


            .kanban-task-block-info {
                font-size: 11px;
                color: var(--b3-theme-on-background);
                margin-top: 4px;
                opacity: 0.9;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                background-color: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }

            .kanban-task-block-info:hover {
                background-color: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            .kanban-task-block-info span[data-type="a"] {
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline dotted;
                text-decoration-style: dotted;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                transition: color 0.2s ease;
            }

            .kanban-task-block-info span[data-type="a"]:hover {
                color: var(--b3-theme-primary-light);
            }

            .kanban-task-pomodoro-count {
                /* Styles for pomodoro count */
            }

            /* 倒计时样式 */
            .countdown-badge {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 10px;
                font-weight: 500;
                margin-left: 4px;
                display: inline-block;
            }

            .countdown-urgent {
                background-color: rgba(231, 76, 60, 0.15);
                color: #e74c3c;
                border: 1px solid rgba(231, 76, 60, 0.3);
            }

            .countdown-warning {
                background-color: rgba(243, 156, 18, 0.15);
                color: #f39c12;
                border: 1px solid rgba(243, 156, 18, 0.3);
            }

            .countdown-normal {
                background-color: rgba(46, 204, 113, 0.15);
                color: #2ecc71;
                border: 1px solid rgba(46, 204, 113, 0.3);
            }

            /* 过期任务样式 - 复用倒计时样式 */
            .countdown-badge.countdown-normal[style*="rgba(231, 76, 60"] {
                background-color: rgba(231, 76, 60, 0.15) !important;
                color: #e74c3c !important;
                border: 1px solid rgba(231, 76, 60, 0.3) !important;
            }

           .kanban-task-checkbox {
                -webkit-appearance: none;
                appearance: none;
                background-color: background-color: rgba(from var(--b3-theme-background-light) r g b / .1);
                margin: 0;
                margin-top: 5px; /* 微调对齐 */
                font: inherit;
                color: var(--b3-theme-on-surface);
                width: 1.15em;
                height: 1.15em;
                border: 0.1em solid var(--b3-theme-on-surface);
                border-radius: 0.25em;
                transform: translateY(-0.075em);
                display: grid;
                place-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                flex-shrink: 0;
            }

           .kanban-task-checkbox:hover {
                border-color: var(--b3-theme-primary);
            }

           .kanban-task-checkbox::before {
                content: "";
                width: 0.65em;
                height: 0.65em;
                transform: scale(0);
                transition: 120ms transform ease-in-out;
                box-shadow: inset 1em 1em var(--b3-theme-primary);
                transform-origin: bottom left;
                clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
            }

           .kanban-task-checkbox:checked {
                background: var(--b3-theme-primary);
                border-color: var(--b3-theme-primary);
            }

           .kanban-task-checkbox:checked::before {
                transform: scale(1);
                box-shadow: inset 1em 1em var(--b3-theme-surface);
            }

           .kanban-task-collapse-btn {
                width: 10px;
                min-width: auto;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                display: flex;
                align-items: center;
                justify-content: center;
            }
           .kanban-task-collapse-btn .b3-button__icon {
                margin: 0;
            }
            .kanban-task-collapse-btn svg{
                height: 10px;
                width: 10px;
            }
           .kanban-task-collapse-btn:hover {
                opacity: 1;
                color: var(--b3-theme-primary);
                background: var(--b3-theme-surface-lighter);
            }

           /* 项目标题点击样式 */
           .project-kanban-title h2 {
                cursor: pointer;
                transition: color 0.2s ease;
            }
           
           .project-kanban-title h2:hover {
                color: var(--b3-theme-primary);
            }
           
           .project-kanban-title h2[data-has-note="true"] {
                text-decoration: underline dotted;
                text-decoration-style: dotted;
            }
           
           .project-kanban-title h2[data-has-note="true"]:hover {
                color: var(--b3-theme-primary);
            }
            /* 父任务子任务进度条 */
            .kanban-task-progress-container {
                margin-top: 8px;
            }

            .kanban-task-progress-wrap {
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            }

            .kanban-task-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
                border-radius: 6px 0 0 6px;
            }

            .kanban-task-progress-text {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.9;
                min-width: 34px;
                text-align: right;
            }

            /* 自定义分组样式 */
            .custom-group-in-status {
                background: var(--b3-theme-background);
                border-radius: 8px;
                border: 1px solid var(--b3-border-color);
            }

            .custom-group-header {
                user-select: none;
                position: sticky;
                top: 0;
                z-index: 10;
                margin-bottom: 6px;
            }

            .custom-group-header:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .custom-group-title {
                font-weight: 600 !important;
            }

            .custom-group-collapse-btn {
                width: 16px;
                height: 16px;
                min-width: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .custom-group-collapse-btn:hover {
                opacity: 1;
            }

            .custom-group-collapse-btn svg {
                width: 12px;
                height: 12px;
            }

            .custom-group-tasks {
                transition: all 0.3s ease;
            }

            .status-column-groups {
                padding: 4px;
            }

            /* 自定义分组状态容器样式 */
            .custom-group-status-container {
                padding: 4px;
            }

            .custom-status-group {
                background: var(--b3-theme-background);
                border-radius: 8px;
                border: 1px solid var(--b3-border-color);
            }

            .custom-status-group-header {
                user-select: none;
                position: sticky;
                top: 0;
                z-index: 10;
            }

            .custom-status-group-header:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .custom-status-group-title {
                font-weight: 600 !important;
            }

            .custom-status-group-collapse-btn {
                width: 16px;
                height: 16px;
                min-width: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .custom-status-group-collapse-btn:hover {
                opacity: 1;
            }

            .custom-status-group-collapse-btn svg {
                width: 12px;
                height: 12px;
            }

            .custom-status-group-tasks {
                transition: all 0.3s ease;
            }

            /* 分组管理对话框样式 */
            .manage-groups-dialog .groups-container {
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                background: var(--b3-theme-surface);
            }

            .group-item:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .color-option {
                position: relative;
            }

            .color-option.selected {
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
            }

            .color-option:hover {
                transform: scale(1.1);
            }

            .group-form {
                animation: slideIn 0.3s ease-out;
            }

            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            /* 删除分组对话框样式 */
            .delete-group-dialog .b3-radio {
                margin-top: 8px;
            }

            .delete-group-dialog .b3-radio label {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
                cursor: pointer;
            }

            .delete-group-dialog .b3-radio__mark {
                margin-right: 8px;
            }

            /* 看板模式选择下拉框样式 */
            .kanban-mode-select {
                background: var(--b3-theme-background) !important;
                border: 1px solid var(--b3-theme-border) !important;
                border-radius: 4px !important;
                font-size: 14px !important;
                color: var(--b3-theme-on-surface) !important;
                cursor: pointer !important;
                min-width: 140px !important;
                transition: all 0.2s ease !important;
            }

            .kanban-mode-select:hover {
                border-color: var(--b3-theme-primary) !important;
                background: var(--b3-theme-primary-lightest) !important;
            }

            .kanban-mode-select:focus {
                outline: none !important;
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest) !important;
            }

            .kanban-mode-select option {
                background: var(--b3-theme-background) !important;
                color: var(--b3-theme-on-surface) !important;
                padding: 4px 8px !important;
            }

            /* ==================== 批量多选样式 ==================== */

            /* 多选复选框样式 - 圆形 */
            .kanban-task-multiselect-checkbox {
                width: 20px !important;
                height: 20px !important;
                cursor: pointer !important;
                flex-shrink: 0 !important;
                margin-top: 2px !important;
                border-radius: 50% !important;
                border: 2px solid var(--b3-theme-primary) !important;
                background: var(--b3-theme-background) !important;
                appearance: none !important;
                -webkit-appearance: none !important;
                position: relative !important;
                transition: all 0.2s ease !important;
            }

            /* 选中状态 */
            .kanban-task-multiselect-checkbox:checked {
                background: var(--b3-theme-primary) !important;
            }

            /* 选中时的对勾图标 */
            .kanban-task-multiselect-checkbox:checked::after {
                content: '' !important;
                position: absolute !important;
                left: 5px !important;
                top: 2px !important;
                width: 6px !important;
                height: 10px !important;
                border: solid white !important;
                border-width: 0 2px 2px 0 !important;
                transform: rotate(45deg) !important;
            }

            .kanban-task-multiselect-checkbox:hover {
                transform: scale(1.1);
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest) !important;
            }

            /* 选中状态的任务卡片 */
            .kanban-task-selected {
                box-shadow: 0 0 0 2px var(--b3-theme-primary) !important;
                border-color: var(--b3-theme-primary) !important;
            }

            .kanban-task-selected:hover {
                box-shadow: 0 0 0 3px var(--b3-theme-primary), 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            }

            /* 批量操作工具栏 */
            .kanban-batch-toolbar {
                animation: batchToolbarSlideUp 0.3s ease-out;
            }

            @keyframes batchToolbarSlideUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }

            .kanban-batch-toolbar .batch-toolbar-count {
                font-weight: 600;
                color: var(--b3-theme-primary);
                min-width: 100px;
                white-space: nowrap;
            }

            /* 多选模式下的任务卡片悬停效果 */
            .kanban-task:has(.kanban-task-multiselect-checkbox):hover {
                background-color: var(--b3-theme-surface) !important;
            }

            /* 响应式：批量工具栏在窄屏下的适配 */
            @media (max-width: 768px) {
                .kanban-batch-toolbar {
                    min-width: auto !important;
                    width: 95vw !important;
                    padding: 10px 12px !important;
                    gap: 8px !important;
                    flex-wrap: wrap !important;
                }

                .kanban-batch-toolbar .batch-toolbar-count {
                    width: 100%;
                    text-align: center;
                    margin-bottom: 4px;
                }

                .kanban-batch-toolbar > div:nth-child(2) {
                    display: none;
                }

                .kanban-batch-toolbar > div:nth-child(3) {
                    width: 100%;
                    justify-content: center;
                    margin: 4px 0;
                }

                .kanban-batch-toolbar > div:last-child {
                    width: 100%;
                    justify-content: center;
                    margin-left: 0 !important;
                }
            }
            `;
        document.head.appendChild(style);
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

    // 设置任务优先级
    private async setPriority(task: any, priority: string) {
        // 1. 乐观更新内存数据和 DOM
        const optimisticTask = this.tasks.find(t => t.id === task.id);
        if (optimisticTask) {
            optimisticTask.priority = priority;
        }

        const taskEl = this.container.querySelector(`.kanban-task[data-task-id="${task.id}"]`) as HTMLElement;
        if (taskEl) {
            // 更新 CSS 类
            taskEl.classList.remove('kanban-task-priority-high', 'kanban-task-priority-medium', 'kanban-task-priority-low');
            if (priority !== 'none') {
                taskEl.classList.add(`kanban-task-priority-${priority}`);
            }

            // 更新背景和边框
            let backgroundColor = '';
            let borderColor = '';
            switch (priority) {
                case 'high':
                    backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                    borderColor = 'var(--b3-card-error-color)';
                    break;
                case 'medium':
                    backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                    borderColor = 'var(--b3-card-warning-color)';
                    break;
                case 'low':
                    backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                    borderColor = 'var(--b3-card-info-color)';
                    break;
                default:
                    backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                    borderColor = 'var(--b3-theme-background-light)';
            }
            taskEl.style.backgroundColor = backgroundColor;
            taskEl.style.borderColor = borderColor;

            // 更新优先级标签
            let priorityEl = taskEl.querySelector('.kanban-task-priority') as HTMLElement;
            if (priority === 'none') {
                if (priorityEl) priorityEl.remove();
            } else {
                if (!priorityEl) {
                    priorityEl = document.createElement('div');
                    priorityEl.className = 'kanban-task-priority';
                    const infoEl = taskEl.querySelector('.kanban-task-info');
                    if (infoEl) infoEl.appendChild(priorityEl);
                }
                const priorityNames = {
                    'high': '高优先级',
                    'medium': '中优先级',
                    'low': '低优先级'
                };
                priorityEl.className = `kanban-task-priority priority-label-${priority}`;
                priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
            }
        }

        // 2. 后台保存数据
        try {
            const reminderData = await this.getReminders();

            // 如果是重复实例，修改实例的优先级
            if (task.isRepeatInstance && task.originalId) {
                // [FIX] 更新所有相关 Ghost 子实例的优先级
                const instanceDate = task.date;
                const originalIdsToUpdate = [task.originalId, ...this.getAllDescendantIds(task.originalId, reminderData)];

                for (const oid of originalIdsToUpdate) {
                    const originalTask = reminderData[oid];
                    if (!originalTask) continue;

                    const instMod = this.ensureInstanceModificationStructure(originalTask, instanceDate);
                    instMod.priority = priority;
                }

                await saveReminders(this.plugin, reminderData);
            } else {
                // 普通任务或原始重复事件，直接修改
                if (reminderData[task.id]) {
                    reminderData[task.id].priority = priority;

                    // 如果是重复事件，清除所有实例的优先级覆盖（因为修改主任务通常意味着重置/统一优先级，或者看具体需求，这里保持原有逻辑）
                    if (reminderData[task.id].repeat?.enabled && reminderData[task.id].repeat?.instanceModifications) {
                        const modifications = reminderData[task.id].repeat.instanceModifications;
                        Object.keys(modifications).forEach(date => {
                            if (modifications[date].priority !== undefined) {
                                delete modifications[date].priority;
                            }
                        });
                    }

                    await saveReminders(this.plugin, reminderData);
                } else {
                    // 任务不存在
                    return;
                }
            }
            // 防抖加载
            this.queueLoadTasks();
            // 保存成功后，分发更新事件（通知其他视图），但不请求重新加载当前视图（因为已经乐观更新了）
            this.dispatchReminderUpdate(true);

        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage("设置优先级失败，正在恢复...");
            // 如果失败，强制重载以恢复正确状态
            await this.queueLoadTasks();
        }
    }

    // 复制块引用
    private async copyBlockRef(task: any) {
        try {
            const blockId = task.blockId;
            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            const title = task.title || "未命名任务";
            const blockRef = `((${blockId} "${title}"))`;

            await navigator.clipboard.writeText(blockRef);
            showMessage("块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引用失败:', error);
            showMessage("复制块引用失败");
        }
    }

    // 显示绑定到块的对话框（支持绑定现有块或创建新文档并绑定）
    private showBindToBlockDialog(reminder: any) {
        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            try {
                await this.bindReminderToBlock(reminder, blockId);
                showMessage(i18n("reminderBoundToBlock"));
                this.queueLoadTasks();
            } catch (error) {
                console.error('绑定提醒到块失败:', error);
                showMessage(i18n("bindToBlockFailed"));
            }
        }, {
            defaultTab: 'heading',
            defaultParentId: reminder.parentId,
            defaultProjectId: this.projectId, // 使用当前项目ID
            defaultCustomGroupId: reminder.customGroupId,
            reminder: reminder
        });
        blockBindingDialog.show();
    }



    /**
     * 将提醒绑定到指定的块（adapted from ReminderPanel）
     */
    private async bindReminderToBlock(reminder: any, blockId: string) {
        // 1. 乐观更新内存数据和 DOM
        const optimisticTask = this.tasks.find(t => t.id === reminder.id);
        if (optimisticTask) {
            optimisticTask.blockId = blockId;
        }

        const taskEl = this.container.querySelector(`.kanban-task[data-task-id="${reminder.id}"]`) as HTMLElement;
        if (taskEl) {
            const titleEl = taskEl.querySelector('.kanban-task-title') as HTMLElement;
            if (titleEl) {
                // 直接更新样式和行为，避免全量重绘导致的闪烁
                titleEl.style.color = 'var(--b3-theme-primary)';
                titleEl.style.textDecoration = 'underline dotted';
                titleEl.style.cursor = 'pointer';
                titleEl.title = i18n('clickToOpenBoundBlock', { title: reminder.title || i18n('noContentHint') });

                const newTitleEl = titleEl.cloneNode(true) as HTMLElement;
                newTitleEl.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.openBlockTab(blockId);
                });
                titleEl.parentNode?.replaceChild(newTitleEl, titleEl);
            }
        }

        try {
            let reminderData = await this.getReminders();
            let reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

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
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBindBlockAtrrs(blockId, this.plugin);
                // 防抖加载
                this.queueLoadTasks();
                // 触发更新事件
                this.dispatchReminderUpdate(true);


            } else {
                throw new Error('提醒不存在');
            }
        } catch (error) {
            console.error('绑定提醒到块失败:', error);
            // 失败时回滚/刷新
            this.queueLoadTasks();
            throw error;
        }
    }


    /**
     * 打开块标签页
     * @param blockId 块ID
     */
    private async openBlockTab(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的绑定
            await confirm(
                "打开块失败",
                "绑定的块可能已被删除，是否解除绑定？",
                async () => {
                    // 解除任务的块绑定
                    await this.unbindTaskFromBlock(blockId);
                },
                () => {
                    showMessage("打开块失败");
                }
            );
        }
    }

    /**
     * 打开项目笔记
     * @param blockId 项目笔记的块ID
     */
    private async openProjectNote(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开项目笔记失败:', error);
            showMessage("打开项目笔记失败");
        }
    }

    /**
     * 解除任务与块的绑定
     * @param blockId 块ID
     */
    private async unbindTaskFromBlock(blockId: string) {
        try {
            const reminderData = await this.getReminders();
            let unboundCount = 0;

            // 找到所有绑定到该块的任务并解除绑定
            Object.keys(reminderData).forEach(taskId => {
                const task = reminderData[taskId];
                if (task && task.blockId === blockId) {
                    delete task.blockId;
                    delete task.docId;
                    unboundCount++;
                }
            });

            if (unboundCount > 0) {
                await saveReminders(this.plugin, reminderData);

                // 触发更新事件
                this.dispatchReminderUpdate(true);

                showMessage(`已解除 ${unboundCount} 个任务的块绑定`);
                await this.queueLoadTasks();
            } else {
                showMessage("未找到相关的任务绑定");
            }
        } catch (error) {
            console.error('解除块绑定失败:', error);
            showMessage("解除块绑定失败");
        }
    }

    /**
     * Get task object from a task element, with customGroupId extracted from DOM
     */
    private getTaskFromElement(element: HTMLElement): any {
        const taskId = element.dataset.taskId;
        if (!taskId) return null;

        // Find the task in our tasks array
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return null;

        // Clone the task to avoid modifying the original
        const taskCopy = { ...task };

        // Extract customGroupId from DOM structure
        // Look for the closest custom-status-group element first
        const statusGroup = element.closest('.custom-status-group') as HTMLElement;
        if (statusGroup && statusGroup.dataset.groupId) {
            // In custom mode with status sub-groups
            const groupId = statusGroup.dataset.groupId;
            taskCopy.customGroupId = groupId === 'ungrouped' ? undefined : groupId;
        } else {
            // Look for the closest kanban-column element
            const column = element.closest('.kanban-column') as HTMLElement;
            if (column && column.dataset.groupId) {
                const groupId = column.dataset.groupId;
                taskCopy.customGroupId = groupId === 'ungrouped' ? undefined : groupId;
            }
        }

        return taskCopy;
    }

    private canDropForSort(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 情况1：同级顶层任务之间排序
        if (!draggedTask.parentId && !targetTask.parentId) {
            // 允许跨优先级拖拽，后续在 reorderTasks 中会自动更新优先级
            return true;
        }

        // 情况2：子任务之间排序（同一个父任务下）
        if (draggedTask.parentId && targetTask.parentId) {
            return draggedTask.parentId === targetTask.parentId;
        }

        // 情况3：不允许顶层任务与子任务之间排序
        return false;
    }

    /**
     * Checks if a dragged task can become a sibling of a target task.
     * This is true if the target is a subtask and the dragged task is not an ancestor of the target.
     * @param draggedTask The task being dragged
     * @param targetTask The drop target task
     * @returns boolean
     */
    private canBecomeSiblingOf(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // Either the target task must be a subtask, OR the dragged task is a subtask moving to top level.
        if (!targetTask.parentId && !draggedTask.parentId) return false;

        // Dragged task cannot be the same as the target task.
        if (draggedTask.id === targetTask.id) return false;

        // Dragged task cannot be the parent of the target task.
        if (draggedTask.id === targetTask.parentId) return false;

        // If dragged task is already a sibling, this case is handled by canDropForSort.
        if (draggedTask.parentId === targetTask.parentId) return false;

        // To prevent circular dependencies, the dragged task cannot be an ancestor of the target task.
        if (this.isDescendant(targetTask, draggedTask)) return false;

        return true;
    }

    /**
     * 检查是否可以设置父子任务关系
     * @param draggedTask 被拖拽的任务
     * @param targetTask 目标任务（潜在的父任务）
     * @returns 是否可以设置为父子关系
     */
    private canSetAsParentChild(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 不能将任务拖拽到自己身上
        if (draggedTask.id === targetTask.id) return false;

        // 订阅任务不支持设置父子关系
        if (draggedTask.isSubscribed || targetTask.isSubscribed) return false;

        // 如果两个任务都是子任务且属于同一个父任务，不显示父子关系提示
        // （应该显示排序提示）
        if (draggedTask.parentId && targetTask.parentId &&
            draggedTask.parentId === targetTask.parentId) {
            return false;
        }

        // 不能将父任务拖拽到自己的子任务上（防止循环依赖）
        if (this.isDescendant(targetTask, draggedTask)) return false;

        // 不能将任务拖拽到已经是其父任务的任务上
        if (draggedTask.parentId === targetTask.id) return false;

        return true;
    }

    /**
     * 检查 potential_child 是否是 potential_parent 的后代
     * @param potentialChild 潜在的子任务
     * @param potentialParent 潜在的父任务
     * @returns 是否是后代关系
     */
    private isDescendant(potentialChild: any, potentialParent: any): boolean {
        if (!potentialChild || !potentialParent) return false;

        let currentTask = potentialChild;
        const visited = new Set(); // 防止无限循环

        while (currentTask && currentTask.parentId && !visited.has(currentTask.id)) {
            visited.add(currentTask.id);

            if (currentTask.parentId === potentialParent.id) {
                return true;
            }

            // 查找父任务
            currentTask = this.tasks.find(t => t.id === currentTask.parentId);
        }

        return false;
    }

    /**
     * 统一的指示器更新方法，避免频繁的DOM操作导致闪烁
     * @param type 指示器类型
     * @param target 目标元素
     * @param position 位置
     * @param event 可选的拖拽事件
     */
    private updateIndicator(
        type: 'none' | 'sort' | 'parentChild',
        target: HTMLElement | null,
        position: 'top' | 'bottom' | 'middle' | null,
        event?: DragEvent
    ) {
        // 检查是否需要更新
        const needsUpdate = this.currentIndicatorType !== type ||
            this.currentIndicatorTarget !== target ||
            this.currentIndicatorPosition !== position;

        if (!needsUpdate) {
            return; // 状态没有改变，不需要更新
        }

        // 清除现有的所有指示器
        this.clearAllIndicators();

        // 更新状态
        this.currentIndicatorType = type;
        this.currentIndicatorTarget = target;
        this.currentIndicatorPosition = position;

        // 显示新的指示器
        switch (type) {
            case 'sort':
                if (target && event) {
                    this.createSortIndicator(target, event);
                }
                break;
            case 'parentChild':
                if (target && position === 'top') {
                    this.createParentChildIndicator(target, 'top');
                } else if (target) {
                    this.createParentChildIndicator(target);
                }
                break;
            case 'none':
            default:
                // 已经清除了所有指示器，无需额外操作
                break;
        }
    }

    /**
     * 清除所有指示器
     */
    private clearAllIndicators() {
        // 移除排序指示器
        this.container.querySelectorAll('.drop-indicator').forEach(indicator => indicator.remove());

        // 移除父子关系指示器
        this.container.querySelectorAll('.parent-child-indicator').forEach(indicator => indicator.remove());
        this.container.querySelectorAll('.parent-child-drop-target').forEach(el => {
            el.classList.remove('parent-child-drop-target');
        });

        // 重置position样式
        this.container.querySelectorAll('.kanban-task').forEach((el: HTMLElement) => {
            if (el.style.position === 'relative') {
                el.style.position = '';
            }
        });
    }

    /**
     * 创建排序指示器
     * @param element 目标元素
     * @param event 拖拽事件
     */
    private createSortIndicator(element: HTMLElement, event: DragEvent) {
        const rect = element.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            height: 2px;
            background-color: var(--b3-theme-primary);
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 0 4px var(--b3-theme-primary);
        `;

        element.style.position = 'relative';

        if (event.clientY < midpoint) {
            indicator.style.top = '-1px';
        } else {
            indicator.style.bottom = '-1px';
        }

        // 不再添加排序提示文字，只显示蓝色指示线
        element.appendChild(indicator);
    }

    /**
     * 创建父子任务指示器
     * @param element 目标元素
     */
    /**
     * 创建父子任务指示器，支持指定位置
     */
    private createParentChildIndicator(element: HTMLElement, _position: 'top' | 'middle' = 'middle') {
        element.classList.add('parent-child-drop-target');

    }

    /**
     * 处理父子任务拖拽放置
     * @param targetTask 目标任务（将成为父任务）
     */
    private async handleParentChildDrop(targetTask: any) {
        if (!this.draggedTask) return;
        console.log('[Kanban] handleParentChildDrop:', { dragged: this.draggedTask.id, target: targetTask.id });
        try {
            await this.setParentChildRelation(this.draggedTask, targetTask);
            showMessage(`"${this.draggedTask.title}" 已设置为 "${targetTask.title}" 的子任务`);
        } catch (error) {
            // showMessage("设置父子任务关系失败");
        }
    }

    /**
     * 设置任务的父子关系
     * @param childTask 子任务
     * @param parentTask 父任务
     */
    private async setParentChildRelation(childTask: any, parentTask: any) {
        try {
            const reminderData = await this.getReminders();

            if (!reminderData[childTask.id]) {
                throw new Error("子任务不存在");
            }

            if (!reminderData[parentTask.id]) {
                throw new Error("父任务不存在");
            }

            // 设置子任务的父任务ID
            reminderData[childTask.id].parentId = parentTask.id;

            // 子任务继承父任务的状态和分组
            const parentInDb = reminderData[parentTask.id];
            const childInDb = reminderData[childTask.id];
            const parentStatus = this.getTaskStatus(parentInDb);

            // 1. 继承状态
            if (parentStatus === 'completed') {
                if (!childInDb.completed) {
                    childInDb.kanbanStatus = 'completed';
                    childInDb.completed = true;
                    childInDb.completedTime = getLocalDateTimeString(new Date());
                }
            } else {
                // 如果父任务未完成，子任务跟随父任务状态，并重置完成状态
                childInDb.kanbanStatus = parentStatus;
                if (childInDb.completed) {
                    childInDb.completed = false;
                    delete childInDb.completedTime;
                }
            }

            // 2. 继承分组
            if (childInDb.customGroupId !== parentInDb.customGroupId) {
                if (parentInDb.customGroupId === undefined) {
                    delete childInDb.customGroupId;
                } else {
                    childInDb.customGroupId = parentInDb.customGroupId;
                }
            }

            // 3. 继承项目 (新增)
            if (parentInDb.projectId) {
                childInDb.projectId = parentInDb.projectId;
            } else if (childInDb.projectId) {
                delete childInDb.projectId;
            }

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存
            const localChild = this.tasks.find(t => t.id === childTask.id);
            if (localChild) {
                localChild.parentId = parentTask.id;
                // 同步本地缓存状态
                if (parentStatus === 'completed') {
                    localChild.kanbanStatus = 'completed';
                    localChild.completed = true;
                    localChild.completedTime = getLocalDateTimeString(new Date());
                } else {
                    localChild.kanbanStatus = parentStatus;
                    localChild.completed = false;
                    delete localChild.completedTime;
                }
                // 同步本地缓存分组
                localChild.customGroupId = parentInDb.customGroupId;
                // 同步本地缓存项目 (新增)
                localChild.projectId = parentInDb.projectId;
            }

            this.dispatchReminderUpdate(true);

            // 父子关系改变会影响任务层级显示,需要重新加载
            // 但只在拖拽操作时使用防抖,避免频繁重载
            await this.queueLoadTasks();
        } catch (error) {
            console.error('设置父子关系失败:', error);
            throw error;
        }
    }

    /**
     * 解除任务的父子关系
     * @param childTask 子任务
     */
    private async unsetParentChildRelation(childTask: any) {
        try {
            const reminderData = await this.getReminders();

            if (!reminderData[childTask.id]) {
                throw new Error("任务不存在");
            }

            if (!childTask.parentId) {
                return; // 没有父任务，不需要解除关系
            }

            // 查找父任务的标题用于提示
            const parentTask = reminderData[childTask.parentId];
            const parentTitle = parentTask ? parentTask.title : '未知任务';

            // 移除父任务ID
            delete reminderData[childTask.id].parentId;

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存
            const localTask = this.tasks.find(t => t.id === childTask.id);
            if (localTask) {
                delete localTask.parentId;
            }

            this.dispatchReminderUpdate(true);


            // 解除父子关系会影响任务层级显示,需要重新加载
            // 使用防抖避免频繁重载
            await this.queueLoadTasks();
        } catch (error) {
            console.error('解除父子关系失败:', error);
            showMessage("解除父子关系失败");
        }
    }

    private async handleSortDrop(targetTask: any, event: DragEvent) {
        if (!this.draggedTask) return;

        try {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            // 如果是订阅任务且试图改变状态（KanbanStatus），则由于只读限制应阻止（除了同状态内的排序）
            // 但如果 reorderTasks 中处理了这些逻辑，我们直接调用

            // 不再进行乐观 DOM 更新；等待后端保存并由 reorderTasks 在成功后更新 DOM
            await this.reorderTasks(this.draggedTask, targetTask, insertBefore);

        } catch (error) {
            console.error('处理拖放排序失败:', error);
            showMessage(i18n("sortUpdateFailed") || "排序更新失败");
        }
    }

    /**
     * Handles the drop event for making a task a sibling of another and sorting it.
     * @param draggedTask The task that was dragged
     * @param targetTask The task that was the drop target
     * @param event The drop event
     */
    private async handleBecomeSiblingDrop(draggedTask: any, targetTask: any, event: DragEvent) {
        if (!draggedTask || !targetTask) return;
        // If both are top level, it should have been handled by canDropForSort/handleSortDrop
        if (!targetTask.parentId && !draggedTask.parentId) return;

        try {
            const reminderData = await this.getReminders();
            const draggedTaskInDb = reminderData[draggedTask.id];
            if (!draggedTaskInDb) {
                throw new Error("Dragged task not found in data");
            }

            const newParentId = targetTask.parentId;

            // 1. Set/Clear parentId for the dragged task
            if (newParentId) {
                const parentTaskInDb = reminderData[newParentId];
                if (!parentTaskInDb) {
                    throw new Error("Parent task not found in data");
                }
                draggedTaskInDb.parentId = newParentId;

                // Sync group from parent
                try {
                    const parentGroup = parentTaskInDb.customGroupId === undefined ? null : parentTaskInDb.customGroupId;
                    if (parentGroup === null) {
                        delete draggedTaskInDb.customGroupId;
                    } else {
                        draggedTaskInDb.customGroupId = parentGroup;
                    }
                } catch (err) { }

                // Inherit status from parent
                const parentStatus = this.getTaskStatus(parentTaskInDb);
                if (!draggedTaskInDb.completed) {
                    draggedTaskInDb.kanbanStatus = (parentStatus === 'long_term' || parentStatus === 'short_term') ? parentStatus : 'doing';
                }
            } else {
                // Moving to top level - clear parentId
                delete draggedTaskInDb.parentId;

                // Inherit status and group from the target task (since we are placing it near it)
                const targetTaskInDb = reminderData[targetTask.id];
                if (targetTaskInDb) {
                    const targetStatus = this.getTaskStatus(targetTaskInDb);
                    if (!draggedTaskInDb.completed) {
                        if (targetStatus === 'completed') {
                            draggedTaskInDb.completed = true;
                            draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                            draggedTaskInDb.kanbanStatus = 'completed';
                        } else {
                            draggedTaskInDb.kanbanStatus = targetStatus;
                        }
                    }
                    const targetGroup = targetTaskInDb.customGroupId === undefined ? null : targetTaskInDb.customGroupId;
                    if (targetGroup === null) delete draggedTaskInDb.customGroupId;
                    else draggedTaskInDb.customGroupId = targetGroup;
                }
            }

            // 3. Reorder siblings
            const siblingTasks = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && r.parentId === newParentId && r.id !== draggedTask.id)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            const targetElement = event.target as HTMLElement;
            if (!targetElement) throw new Error("Event target is null");
            const taskElement = targetElement.closest('.kanban-task') as HTMLElement;
            if (!taskElement) throw new Error("Could not find task element");

            const rect = taskElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetTask.id);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            siblingTasks.splice(insertIndex, 0, draggedTaskInDb);
            siblingTasks.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存的 sort 值，避免编辑时使用旧值
            siblingTasks.forEach((task: any) => {
                const localTask = this.tasks.find(t => t.id === task.id);
                if (localTask) {
                    localTask.sort = task.sort;
                }
            });

            this.dispatchReminderUpdate(true);

        } catch (error) {
            console.error('Failed to set task as sibling and sort:', error);
            showMessage("移动任务失败");
        }
    }

    /**
     * 处理重复实例的高级排序（收集所有任务和实例，统一排序）
     */
    private async handleAdvancedInstanceReorder(
        reminderData: any,
        draggedTask: any,
        targetTask: any,
        insertBefore: boolean,
        targetStatus?: string,
        targetGroup?: string | null,
        targetPriority: string = 'none'
    ): Promise<boolean> {
        try {
            const isDraggedInstance = draggedTask.isRepeatInstance && draggedTask.originalId;
            const isTargetInstance = targetTask.isRepeatInstance && targetTask.originalId;

            const draggedOriginalId = isDraggedInstance ? draggedTask.originalId : draggedTask.id;
            // 使用原始日期（从 ID 中提取），因为 date 可能已被修改
            const draggedInstanceDate = isDraggedInstance ? draggedTask.id.split('_').pop() : null;

            const targetOriginalId = isTargetInstance ? targetTask.originalId : targetTask.id;
            // 使用原始日期（从 ID 中提取），因为 date 可能已被修改
            const targetInstanceDate = isTargetInstance ? targetTask.id.split('_').pop() : null;

            // 收集该状态下所有普通任务和实例
            const items: Array<{
                id: string;
                originalId: string;
                date?: string;
                sort: number;
                isInstance: boolean;
                status: string;
                group: string | null;
                priority: string;
            }> = [];

            // 收集普通任务（属于当前项目、匹配目标状态/分组/优先级）
            Object.values(reminderData).forEach((task: any) => {
                if (!task || task.projectId !== this.projectId) return;
                if (task.parentId) return; // 只收集顶层任务
                if (task.repeat?.enabled) return; // 跳过重复任务模板，只收集实例

                const taskStatus = this.getTaskStatus(task);
                const taskGroup = task.customGroupId === undefined ? null : task.customGroupId;
                const taskPriority = task.priority || 'none';

                // 匹配目标状态/分组/优先级
                const statusMatch = targetStatus === undefined || taskStatus === targetStatus;
                const groupMatch = targetGroup === undefined || taskGroup === targetGroup;
                const priorityMatch = taskPriority === targetPriority;

                if (statusMatch && groupMatch && priorityMatch) {
                    items.push({
                        id: task.id,
                        originalId: task.id,
                        sort: task.sort || 0,
                        isInstance: false,
                        status: taskStatus,
                        group: taskGroup,
                        priority: taskPriority
                    });
                }
            });

            // 收集重复实例（从 instanceModifications 中）
            Object.values(reminderData).forEach((task: any) => {
                if (!task || !task.repeat?.enabled || !task.repeat?.instanceModifications) return;

                Object.entries(task.repeat.instanceModifications).forEach(([date, mod]: [string, any]) => {
                    if (!mod) return;

                    const instStatus = mod.kanbanStatus !== undefined ? mod.kanbanStatus : this.getTaskStatus(task);
                    const instGroup = mod.customGroupId !== undefined ? mod.customGroupId : (task.customGroupId === undefined ? null : task.customGroupId);
                    const instPriority = mod.priority !== undefined ? mod.priority : (task.priority || 'none');

                    // 匹配目标状态/分组/优先级
                    const statusMatch = targetStatus === undefined || instStatus === targetStatus;
                    const groupMatch = targetGroup === undefined || instGroup === targetGroup;
                    const priorityMatch = instPriority === targetPriority;

                    if (statusMatch && groupMatch && priorityMatch) {
                        items.push({
                            id: `${task.id}_${date}`,
                            originalId: task.id,
                            date: date,
                            sort: mod.sort !== undefined ? mod.sort : (task.sort || 0),
                            isInstance: true,
                            status: instStatus,
                            group: instGroup,
                            priority: instPriority
                        });
                    }
                });
            });

            // 确保拖拽项在列表中
            const draggedFullId = isDraggedInstance ? `${draggedOriginalId}_${draggedInstanceDate}` : draggedOriginalId;
            const draggedExists = items.some(item => item.id === draggedFullId);
            if (!draggedExists) {
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
                    date: draggedInstanceDate || undefined,
                    sort: sort,
                    isInstance: !!isDraggedInstance,
                    status: targetStatus || this.getTaskStatus(draggedTask),
                    group: targetGroup !== undefined ? targetGroup : (draggedTask.customGroupId === undefined ? null : draggedTask.customGroupId),
                    priority: targetPriority
                });
            }

            // 确保目标项在列表中
            const targetFullId = isTargetInstance ? `${targetOriginalId}_${targetInstanceDate}` : targetOriginalId;
            const targetExists = items.some(item => item.id === targetFullId);
            if (!targetExists) {
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
                    date: targetInstanceDate || undefined,
                    sort: sort,
                    isInstance: !!isTargetInstance,
                    status: targetStatus || this.getTaskStatus(targetTask),
                    group: targetGroup !== undefined ? targetGroup : (targetTask.customGroupId === undefined ? null : targetTask.customGroupId),
                    priority: targetPriority
                });
            }

            // 按 sort 排序
            items.sort((a, b) => a.sort - b.sort);

            // 找到目标索引和拖拽索引
            const targetIndex = items.findIndex(item => item.id === targetFullId);
            const draggedIndex = items.findIndex(item => item.id === draggedFullId);

            if (targetIndex === -1 || draggedIndex === -1) {
                console.error('找不到拖拽或目标任务', { draggedFullId, targetFullId, items: items.map(i => i.id) });
                return false;
            }

            // 计算插入位置
            let insertIndex = insertBefore ? targetIndex : targetIndex + 1;

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
                const newSort = index * 10;
                if (item.isInstance) {
                    // 更新 instanceModifications 中的 sort
                    const originalTask = reminderData[item.originalId];
                    if (originalTask && originalTask.repeat) {
                        const instMod = this.ensureInstanceModificationStructure(originalTask, item.date!);
                        instMod.sort = newSort;
                    }
                } else {
                    // 更新普通任务的 sort
                    if (reminderData[item.id]) {
                        reminderData[item.id].sort = newSort;
                    }
                }
            });

            // 如果被拖拽的是实例，同步更新其状态/分组/优先级到 instanceModifications
            if (isDraggedInstance) {
                const original = reminderData[draggedOriginalId];
                if (original) {
                    const instMod = this.ensureInstanceModificationStructure(original, draggedInstanceDate!);
                    if (targetStatus !== undefined) instMod.kanbanStatus = targetStatus;
                    if (targetGroup !== undefined) instMod.customGroupId = targetGroup;
                    if (targetPriority !== undefined) instMod.priority = targetPriority;

                    // 递归更新 ghost 子任务
                    const originalIdsToUpdate = [draggedOriginalId, ...this.getAllDescendantIds(draggedOriginalId, reminderData)];
                    for (const oid of originalIdsToUpdate) {
                        const originalTask = reminderData[oid];
                        if (!originalTask) continue;
                        const currentInstMod = this.ensureInstanceModificationStructure(originalTask, draggedInstanceDate!);
                        if (targetStatus !== undefined) currentInstMod.kanbanStatus = targetStatus;
                        if (targetGroup !== undefined) currentInstMod.customGroupId = targetGroup;
                        if (targetPriority !== undefined) currentInstMod.priority = targetPriority;
                    }
                }
            }

            // 如果被拖拽的是普通任务，直接更新其属性
            if (!isDraggedInstance && reminderData[draggedOriginalId]) {
                const task = reminderData[draggedOriginalId];
                if (targetStatus !== undefined) {
                    if (targetStatus === 'completed') {
                        task.completed = true;
                        task.completedTime = getLocalDateTimeString(new Date());
                    } else {
                        task.completed = false;
                        delete task.completedTime;
                        task.kanbanStatus = targetStatus;
                    }
                }
                if (targetGroup !== undefined) {
                    if (targetGroup === null) delete task.customGroupId;
                    else task.customGroupId = targetGroup;
                }
                if (targetPriority !== undefined) {
                    task.priority = targetPriority;
                }

                // 递归更新子任务
                const descIds = this.getAllDescendantIds(draggedOriginalId, reminderData);
                for (const did of descIds) {
                    const desc = reminderData[did];
                    if (!desc) continue;
                    if (targetStatus !== undefined) {
                        if (targetStatus === 'completed') {
                            desc.completed = true;
                            desc.completedTime = getLocalDateTimeString(new Date());
                            desc.kanbanStatus = 'completed';
                        } else {
                            desc.completed = false;
                            delete desc.completedTime;
                            desc.kanbanStatus = targetStatus === 'doing' ? 'doing' : targetStatus;
                        }
                    }
                    if (targetGroup !== undefined) {
                        if (targetGroup === null) delete desc.customGroupId;
                        else desc.customGroupId = targetGroup;
                    }
                    if (targetPriority !== undefined) {
                        desc.priority = targetPriority;
                    }
                }
            }

            await saveReminders(this.plugin, reminderData);

            // 更新本地缓存
            items.forEach(item => {
                const localTask = this.tasks.find(t => t.id === item.id);
                if (localTask) {
                    localTask.sort = item.sort;
                    if (item.isInstance) {
                        const originalTask = reminderData[item.originalId];
                        if (originalTask?.repeat?.instanceModifications?.[item.date!]) {
                            const instSaved = originalTask.repeat.instanceModifications[item.date!];
                            if (instSaved.kanbanStatus !== undefined) localTask.kanbanStatus = instSaved.kanbanStatus;
                            if (instSaved.customGroupId !== undefined) localTask.customGroupId = instSaved.customGroupId;
                            if (instSaved.priority !== undefined) localTask.priority = instSaved.priority;
                        }
                    }
                }
            });

            this.dispatchReminderUpdate(true);

            // 尝试立即更新 DOM
            try {
                const domUpdated = this.reorderTasksDOM(draggedFullId, targetFullId, insertBefore);
                if (domUpdated) this.refreshTaskElement(draggedFullId);
            } catch (err) {
                // 忽略 DOM 更新错误
            }

            await this.queueLoadTasks();
            return true;
        } catch (err) {
            console.warn('Advanced instance reorder failed', err);
            return false;
        }
    }

    private async reorderTasks(draggedTask: any, targetTask: any, insertBefore: boolean): Promise<boolean> {
        // [New Logic] If not in 'priority' sort mode, switch to it automatically when manual reorder is triggered
        if (this.currentSort !== 'priority') {
            this.currentSort = 'priority';
            this.projectManager.setProjectSortRule(this.projectId, 'priority');
            this.updateSortButtonTitle();
            showMessage("已切换为手动操作排序模式");
        }

        try {
            const reminderData = await this.getReminders();

            const draggedId = draggedTask.id;
            const targetId = targetTask.id;

            let draggedTaskInDb = reminderData[draggedId];
            let targetTaskInDb = reminderData[targetId];

            // 支持对重复实例排序：如果被拖拽项或目标项为实例（有 originalId 且实例本身不在 reminderData 中），
            // 则将该实例的 sort 写入原始提醒的 repeat.instanceModifications[date].sort
            const handleInstanceReorder = async (): Promise<boolean> => {
                try {
                    // 处理被拖拽项为实例的情况
                    const isDraggedInstance = draggedTask.isRepeatInstance && draggedTask.originalId;
                    // 处理目标为实例的情况
                    const isTargetInstance = targetTask.isRepeatInstance && targetTask.originalId;

                    if (isDraggedInstance || isTargetInstance) {
                        // 获取目标状态/分组/优先级信息
                        let targetStatus: string | undefined;
                        let targetGroup: string | null | undefined;
                        let targetPriority: string = 'none';

                        if (targetTaskInDb) {
                            targetStatus = this.getTaskStatus(targetTaskInDb);
                            targetGroup = targetTaskInDb.customGroupId === undefined ? null : targetTaskInDb.customGroupId;
                            targetPriority = targetTaskInDb.priority || 'none';
                        } else if (isTargetInstance && reminderData[targetTask.originalId]) {
                            const tOrig = reminderData[targetTask.originalId];
                            const tDate = targetTask.date;
                            const tMods = tOrig.repeat?.instanceModifications || {};
                            const tInst = tMods[tDate] || {};
                            targetStatus = tInst.kanbanStatus !== undefined ? tInst.kanbanStatus : this.getTaskStatus(tOrig);
                            targetGroup = tInst.customGroupId !== undefined ? tInst.customGroupId : (tOrig.customGroupId === undefined ? null : tOrig.customGroupId);
                            targetPriority = tInst.priority !== undefined ? tInst.priority : (tOrig.priority || 'none');
                        } else if (targetTask) {
                            targetStatus = targetTask.kanbanStatus !== undefined ? this.getTaskStatus(targetTask) : undefined;
                            targetGroup = (targetTask.customGroupId === undefined) ? undefined : targetTask.customGroupId;
                            targetPriority = targetTask.priority || 'none';
                        }

                        // 使用改进的排序逻辑：收集所有相关任务（普通任务+实例），统一排序
                        const success = await this.handleAdvancedInstanceReorder(
                            reminderData,
                            draggedTask,
                            targetTask,
                            insertBefore,
                            targetStatus,
                            targetGroup,
                            targetPriority
                        );
                        if (success) return true;
                    }
                    return false;
                } catch (err) {
                    console.warn('Instance reorder failed', err);
                    return false;
                }
            };

            // 如果任一端是实例，尝试实例排序处理（实例的排序信息存储在原始任务的 instanceModifications 中）
            if (draggedTask.isRepeatInstance || targetTask.isRepeatInstance) {
                const instHandled = await handleInstanceReorder();
                if (instHandled) return true;
            }

            if (!draggedTaskInDb || !targetTaskInDb) {
                throw new Error("Task not found in data");
            }

            const oldStatus = this.getTaskStatus(draggedTaskInDb);
            const newStatus = this.getTaskStatus(targetTaskInDb);

            // 如果尝试通过拖拽改变状态，且任务未完成且任务日期为今天或已过，弹窗提示用户
            try {
                const today = getLogicalDateString();
                if (oldStatus !== newStatus && !draggedTaskInDb.completed && draggedTaskInDb.date && compareDateStrings(this.getTaskLogicalDate(draggedTaskInDb.date, draggedTaskInDb.time), today) <= 0) {
                    // 弹窗：取消 / 编辑任务时间
                    const dialog = new Dialog({
                        title: '提示',
                        content: `
                            <div class="b3-dialog__content">
                                <p>该任务的日期为今天或已过，系统会将其自动显示在“进行中”列。</p>
                                <p>要将任务移出“进行中”，需要修改任务的日期或时间。</p>
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                                <button class="b3-button b3-button--primary" id="editBtn">编辑任务时间</button>
                            </div>
                        `,
                        width: "460px"
                    });

                    const choice = await new Promise<string>((resolve) => {
                        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
                        const editBtn = dialog.element.querySelector('#editBtn') as HTMLButtonElement;

                        cancelBtn.addEventListener('click', () => { dialog.destroy(); resolve('cancel'); });
                        editBtn.addEventListener('click', () => { dialog.destroy(); resolve('edit'); });
                    });

                    if (choice === 'cancel') {
                        return false; // 中断移动
                    }
                    if (choice === 'edit') {
                        await this.editTask(draggedTaskInDb);
                        return false; // 中断，等待用户编辑
                    }
                    // 如果选择 'force' 则继续后续逻辑并强制变更状态
                }
            } catch (err) {
                // 忽略日期解析错误，继续执行
            }


            // 如果当前为自定义分组看板模式，且目标任务所在分组与被拖拽任务不同，
            // 则将被拖拽任务移动到目标任务的分组（上下放置时也应修改分组）并在该分组内重新排序
            // 如果当前为自定义分组看板模式，且目标任务所在分组与被拖拽任务不同，
            // 则将被拖拽任务移动到目标任务的分组（上下放置时也应修改分组）并在该分组内重新排序
            if (this.kanbanMode === 'custom') {
                // ... (existing code for custom mode) ... 
                const draggedGroup = draggedTaskInDb.customGroupId === undefined ? null : draggedTaskInDb.customGroupId;

                // CRITICAL FIX: Use the customGroupId from the targetTask parameter (which was extracted from DOM)
                // instead of from the database, because the DOM reflects the actual drop location
                const actualTargetGroup = targetTask.customGroupId === undefined ? null : targetTask.customGroupId;

                // 1. Update Group if different
                if (draggedGroup !== actualTargetGroup) {
                    if (actualTargetGroup === null) {
                        delete reminderData[draggedId].customGroupId;
                    } else {
                        reminderData[draggedId].customGroupId = actualTargetGroup;
                    }
                }

                // 2. Update Status if different
                if (oldStatus !== newStatus) {
                    if (newStatus === 'completed') {
                        draggedTaskInDb.completed = true;
                        draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                    } else {
                        draggedTaskInDb.completed = false;
                        delete draggedTaskInDb.completedTime;

                        // Update kanbanStatus based on newStatus
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            draggedTaskInDb.kanbanStatus = newStatus;
                        } else if (newStatus === 'doing') {
                            draggedTaskInDb.kanbanStatus = 'doing';
                        }
                    }
                }

                // ... (priority update and sorting logic for custom mode) ...
                const oldPriority = draggedTaskInDb.priority || 'none';
                const targetPriority = targetTaskInDb.priority || 'none';
                let newPriority = oldPriority;

                if (oldPriority !== targetPriority) {
                    newPriority = targetPriority;
                    draggedTaskInDb.priority = newPriority;
                }

                let sourceList: any[] = [];
                // Source list cleanup - filter by BOTH group AND status
                if (draggedGroup !== actualTargetGroup || oldStatus !== newStatus || oldPriority !== newPriority) {
                    sourceList = Object.values(reminderData)
                        .filter((r: any) => r && r.projectId === this.projectId && !r.parentId)
                        .filter((r: any) => {
                            const rGroup = (r.customGroupId === undefined) ? null : r.customGroupId;
                            return rGroup === draggedGroup;
                        })
                        .filter((r: any) => {
                            // Filter by status as well
                            const rStatus = this.getTaskStatus(r);
                            return rStatus === oldStatus;
                        })
                        .filter((r: any) => r.id !== draggedId) // Exclude the dragged task
                        .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                    sourceList.forEach((t: any, index: number) => {
                        reminderData[t.id].sort = index * 10;
                    });
                    // update local cache for source list
                    sourceList.forEach((task: any) => {
                        const localTask = this.tasks.find(t => t.id === task.id);
                        if (localTask) localTask.sort = task.sort;
                    });
                }

                // Target list update - filter by BOTH group AND status
                const targetList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId)
                    .filter((r: any) => {
                        const rGroup = (r.customGroupId === undefined) ? null : r.customGroupId;
                        return rGroup === actualTargetGroup;  // Use actualTargetGroup here too!
                    })
                    .filter((r: any) => {
                        // Filter by status as well (using the NEW status after update)
                        const rStatus = this.getTaskStatus(r);
                        return rStatus === newStatus;
                    })
                    .filter((r: any) => r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));


                // 在保存前，将相同的状态/分组更新级联到所有后代任务
                try {
                    const descendantIds = this.getAllDescendantIds(draggedId, reminderData);
                    for (const did of descendantIds) {
                        const desc = reminderData[did];
                        if (!desc) continue;
                        // 同步分组
                        if (actualTargetGroup === null) {
                            if (desc.customGroupId !== undefined) {
                                delete desc.customGroupId;
                            }
                        } else {
                            if (desc.customGroupId !== actualTargetGroup) {
                                desc.customGroupId = actualTargetGroup;
                            }
                        }
                        // 同步状态
                        if (newStatus === 'completed') {
                            if (!desc.completed) {
                                desc.completed = true;
                                desc.completedTime = getLocalDateTimeString(new Date());
                                desc.kanbanStatus = 'completed';
                            }
                        } else {
                            if (desc.completed || desc.kanbanStatus !== newStatus) {
                                desc.completed = false;
                                delete desc.completedTime;
                                desc.kanbanStatus = newStatus === 'doing' ? 'doing' : newStatus;
                            }
                        }
                        // 同步优先级
                        if (desc.priority !== newPriority) {
                            desc.priority = newPriority;
                        }

                    }
                } catch (err) {
                    console.warn('Cascade update for descendants failed', err);
                }

                const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : (targetIndex === -1 ? targetList.length : targetIndex + 1);

                targetList.splice(insertIndex, 0, reminderData[draggedId]);

                targetList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });

                await saveReminders(this.plugin, reminderData);

                // Update local cache for ALL tasks involved (to keep status/priority/sort in sync)
                [...sourceList, ...targetList].forEach((task: any) => {
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) {
                        localTask.sort = task.sort;
                        localTask.priority = task.priority;
                        localTask.kanbanStatus = task.kanbanStatus;
                        localTask.customGroupId = task.customGroupId;
                        localTask.completed = task.completed;
                        localTask.completedTime = task.completedTime;
                    }
                });

                // Also update local cache for descendants so UI updates immediately
                try {
                    const descendantIdsForDragged = this.getAllDescendantIds(draggedId, reminderData);
                    for (const did of descendantIdsForDragged) {
                        const rd = reminderData[did];
                        if (!rd) continue;
                        const localDesc = this.tasks.find(t => t.id === did);
                        if (localDesc) {
                            localDesc.customGroupId = rd.customGroupId === undefined ? undefined : rd.customGroupId;
                            localDesc.kanbanStatus = rd.kanbanStatus;
                            localDesc.completed = !!rd.completed;
                            localDesc.completedTime = rd.completedTime;
                            localDesc.milestoneId = rd.milestoneId;
                            localDesc.projectId = rd.projectId;
                            // update DOM element for the descendant
                            this.updateTaskElementDOM(did, { completed: localDesc.completed, kanbanStatus: localDesc.kanbanStatus, customGroupId: localDesc.customGroupId });
                        }
                    }
                } catch (err) { console.warn('Update local descendants failed', err); }

                // Optimistic DOM update
                const domUpdated = this.reorderTasksDOM(draggedId, targetId, insertBefore);

                // Refresh the dragged task's visual appearance to reflect changes in priority/status
                if (domUpdated) {
                    this.refreshTaskElement(draggedId);
                } else {
                    await this.queueLoadTasks();
                }

                this.dispatchReminderUpdate(true);
                return true;
            }

            // --- Fallback (Status Mode) Logic ---

            // 0. Update Custom Group if different (Enhanced Fallback)
            const draggedGroup = draggedTaskInDb.customGroupId === undefined ? null : draggedTaskInDb.customGroupId;
            const targetGroup = targetTaskInDb.customGroupId === undefined ? null : targetTaskInDb.customGroupId;
            if (draggedGroup !== targetGroup) {
                if (targetGroup === null) {
                    delete reminderData[draggedId].customGroupId;
                } else {
                    reminderData[draggedId].customGroupId = targetGroup;
                }
            }

            // ... (subtask check logic unchanged) ...
            const isSubtaskReorder = draggedTaskInDb.parentId && targetTaskInDb.parentId &&
                draggedTaskInDb.parentId === targetTaskInDb.parentId;

            if (isSubtaskReorder) {
                // ... (subtask existing logic) ...
                const parentId = draggedTaskInDb.parentId;
                const siblingTasks = Object.values(reminderData)
                    .filter((r: any) => r && r.parentId === parentId && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

                siblingTasks.splice(insertIndex, 0, draggedTaskInDb);
                siblingTasks.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
                await saveReminders(this.plugin, reminderData);
                siblingTasks.forEach((task: any) => {
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) localTask.sort = task.sort;
                });
                const domUpdated = this.reorderTasksDOM(draggedId, targetId, insertBefore);
                if (!domUpdated) await this.queueLoadTasks();
                this.dispatchReminderUpdate(true);
                return true;
            }

            // ... (top level logic) ...
            const oldPriority = draggedTaskInDb.priority || 'none';
            const targetPriority = targetTaskInDb.priority || 'none';
            let newPriority = oldPriority;

            if (oldPriority !== targetPriority) {
                newPriority = targetPriority;
                draggedTaskInDb.priority = newPriority;
            }

            // --- Update Project (New) ---
            if (draggedTaskInDb.projectId !== this.projectId) {
                draggedTaskInDb.projectId = this.projectId;
            }

            // --- Clear parentId if moving to top level ---
            if (draggedTaskInDb.parentId) {
                delete draggedTaskInDb.parentId;
            }

            // --- Update status of dragged task (Enhanced) ---
            if (oldStatus !== newStatus) {
                if (newStatus === 'completed') {
                    draggedTaskInDb.completed = true;
                    draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                } else {
                    draggedTaskInDb.completed = false;
                    delete draggedTaskInDb.completedTime;

                    // Update kanbanStatus based on newStatus
                    if (newStatus === 'long_term' || newStatus === 'short_term') {
                        draggedTaskInDb.kanbanStatus = newStatus;
                    } else if (newStatus === 'doing') {
                        draggedTaskInDb.kanbanStatus = 'doing';
                    }
                }
            }

            let sourceList: any[] = [];

            // 将状态/分组的变更级联到后代
            try {
                const descendantIds = this.getAllDescendantIds(draggedId, reminderData);
                for (const did of descendantIds) {
                    const desc = reminderData[did];
                    if (!desc) continue;
                    // 分组
                    if (targetGroup === null) {
                        if (desc.customGroupId !== undefined) {
                            delete desc.customGroupId;
                        }
                    } else {
                        if (desc.customGroupId !== targetGroup) {
                            desc.customGroupId = targetGroup;
                        }
                    }
                    // 状态
                    if (oldStatus !== newStatus) {
                        if (newStatus === 'completed') {
                            if (!desc.completed) {
                                desc.completed = true;
                                desc.completedTime = getLocalDateTimeString(new Date());
                                desc.kanbanStatus = 'completed';
                            }
                        } else {
                            if (desc.completed || desc.kanbanStatus !== newStatus) {
                                desc.completed = false;
                                delete desc.completedTime;
                                desc.kanbanStatus = newStatus === 'doing' ? 'doing' : newStatus;
                            }
                        }
                    }
                    // 同步项目 (新增)
                    // 同步项目 (新增)
                    if (desc.projectId !== this.projectId) {
                        desc.projectId = this.projectId;
                    }

                    // 同步优先级
                    if (desc.priority !== newPriority) {
                        desc.priority = newPriority;
                    }
                }
            } catch (err) { console.warn('Cascade fallback failed', err); }
            // --- Reorder source list ---
            if (oldStatus !== newStatus || oldPriority !== newPriority) {
                sourceList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === oldStatus && (r.priority || 'none') === oldPriority && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                sourceList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
                // update local cache for source
                sourceList.forEach((task: any) => {
                    const localTask = this.tasks.find(t => t.id === task.id);
                    if (localTask) localTask.sort = task.sort;
                });
            }

            // --- Reorder target list ---
            const targetList = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === newStatus && (r.priority || 'none') === newPriority && r.id !== draggedId)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;
            targetList.splice(insertIndex, 0, draggedTaskInDb);
            targetList.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });
            console.log('[Kanban] handleSortDrop DB update:', { draggedId, newStatus, newPriority, targetProjectId: this.projectId });
            await saveReminders(this.plugin, reminderData);

            // Update local cache for ALL tasks involved
            [...sourceList, ...targetList].forEach((task: any) => {
                const localTask = this.tasks.find(t => t.id === task.id);
                if (localTask) {
                    localTask.sort = task.sort;
                    localTask.priority = task.priority;
                    localTask.kanbanStatus = task.kanbanStatus;
                    localTask.customGroupId = task.customGroupId;
                    localTask.completed = task.completed;
                    localTask.completedTime = task.completedTime;
                }
            });

            // Also update local cache for descendants so UI updates immediately (fallback branch)
            try {
                const descendantIdsForDragged = this.getAllDescendantIds(draggedId, reminderData);
                for (const did of descendantIdsForDragged) {
                    const rd = reminderData[did];
                    if (!rd) continue;
                    const localDesc = this.tasks.find(t => t.id === did);
                    if (localDesc) {
                        localDesc.customGroupId = rd.customGroupId === undefined ? undefined : rd.customGroupId;
                        localDesc.kanbanStatus = rd.kanbanStatus;
                        localDesc.completed = !!rd.completed;
                        localDesc.completedTime = rd.completedTime;
                        localDesc.milestoneId = rd.milestoneId;
                        localDesc.projectId = rd.projectId;
                        this.updateTaskElementDOM(did, { completed: localDesc.completed, kanbanStatus: localDesc.kanbanStatus, customGroupId: localDesc.customGroupId });
                    }
                }
            } catch (err) { console.warn('Update local descendants (fallback) failed', err); }

            // 尝试直接更新DOM,失败时才重新加载
            const domUpdated = this.reorderTasksDOM(draggedId, targetId, insertBefore);
            if (domUpdated) {
                // Refresh the dragged task's visual appearance
                this.refreshTaskElement(draggedId);
            } else {
                await this.queueLoadTasks();
            }

            this.dispatchReminderUpdate(true);

            return true;
        } catch (error) {
            console.error('重新排序任务失败:', error);
            throw error;
        }
    }

    /**
     * 递归收集指定父任务的所有直接子任务和后代，保持原有的任务顺序。
     * 返回一个按层级组织的节点数组，节点包含 task 对象和 level。
     */
    private collectChildrenRecursively(parentId: string): Array<{ task: any; level: number }> {
        const result: Array<{ task: any; level: number }> = [];

        const children = this.tasks.filter(t => t.parentId === parentId);

        const walk = (items: any[], level: number) => {
            for (const it of items) {
                result.push({ task: it, level });
                const sub = this.tasks.filter(t => t.parentId === it.id);
                if (sub && sub.length > 0) {
                    walk(sub, level + 1);
                }
            }
        };

        walk(children, 0);
        return result;
    }

    /**
     * 编辑周期任务的单个实例
     */
    private async editInstanceReminder(task: any) {
        try {
            const reminderData = await this.getReminders();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始周期事件不存在");
                return;
            }

            // 从 instanceId (格式: originalId_YYYY-MM-DD) 中提取原始生成日期
            const originalInstanceDate = task.id ? task.id.split('_').pop() : task.date;

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[originalInstanceDate];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: task.id,
                title: instanceMod?.title !== undefined ? instanceMod.title : originalReminder.title,
                date: task.date,
                endDate: task.endDate,
                time: task.time,
                endTime: task.endTime,
                note: instanceMod?.note !== undefined ? instanceMod.note : (originalReminder.note || ''),
                priority: instanceMod?.priority !== undefined ? instanceMod.priority : (originalReminder.priority || 'none'),
                isInstance: true,
                originalId: task.originalId,
                instanceDate: originalInstanceDate  // 使用原始生成日期而非当前显示日期
            };

            // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
            // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
            const callback = () => {
                this.dispatchReminderUpdate(true);
            };

            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                callback,
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
            showMessage("打开编辑对话框失败");
        }
    }

    /**
     * 删除周期任务的单个实例
     */
    private async deleteInstanceOnly(task: any) {
        await confirm(
            i18n('deleteThisInstance'),
            i18n('confirmDeleteInstanceOf', { title: task.title, date: task.date }),
            async () => {
                // --- Optimistic UI Update ---
                try {
                    const el = this.container.querySelector(`[data-task-id="${task.id}"]`);
                    if (el) el.remove();
                    this.tasks = this.tasks.filter(t => t.id !== task.id);
                } catch (e) {
                    console.error("Optimistic UI update failed (instance):", e);
                }
                // -----------------------------

                try {
                    const originalId = task.originalId;
                    const instanceDate = task.date;

                    // 将当前日期添加到 excludeDates（适用于普通重复实例和 ghost 子任务）
                    await this.addExcludedDate(originalId, instanceDate);

                    // 如果该实例绑定了块或文档，更新块属性（忽略错误）
                    if (task.blockId || task.docId) {
                        try {
                            await updateBindBlockAtrrs(task.blockId || task.docId, this.plugin);
                        } catch (err) {
                            console.warn('更新已删除实例的块书签失败:', err);
                        }
                    }

                    showMessage("实例已删除");
                    await this.queueLoadTasks();
                    this.dispatchReminderUpdate(true);
                } catch (error) {
                    console.error('删除周期实例失败:', error);
                    showMessage("删除实例失败");
                    await this.queueLoadTasks();
                }
            }
        );
    }

    /**
     * 为原始周期事件添加排除日期（适用于普通重复实例和 ghost 子任务）
     */
    private async addExcludedDate(originalId: string, excludeDate: string) {
        try {
            const reminderData = await this.getReminders();

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
                const instanceLogical = this.getTaskLogicalDate(instance.date, instance.time);
                return compareDateStrings(instanceLogical, today) > 0 && !completedInstances.includes(originalKey);
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
     * 根据父任务ID生成多级 Markdown 列表文本数组，每行为一行 Markdown。
     * 对于绑定块的任务，使用 siyuan://blocks/<id> 格式的链接。
     */
    private buildMarkdownListFromChildren(parentId: string): string[] {
        const nodes = this.collectChildrenRecursively(parentId);
        if (!nodes || nodes.length === 0) return [];

        const lines: string[] = [];
        for (const node of nodes) {
            const indent = '  '.repeat(node.level);
            const t = node.task;
            let title = t.title || '未命名任务';
            if (t.blockId || t.docId) {
                // 使用思源块链接
                const targetId = t.blockId || t.docId;
                title = `[${title}](siyuan://blocks/${targetId})`;
            }
            lines.push(`${indent}- ${title}`);
        }
        return lines;
    }

    /**
     * 为分组项添加拖拽排序功能
     */
    private addGroupDragAndDrop(groupItem: HTMLElement, group: any, container: HTMLElement) {
        // 使用和 CategoryManageDialog 一致的拖拽处理模式：通过类名指示上/下插入位置
        groupItem.draggable = true;

        groupItem.addEventListener('dragstart', (e) => {
            this.draggedGroupId = group.id;
            groupItem.classList.add('dragging');

            // 创建可作为拖拽预览的克隆元素并放置到 body，用作 setDragImage
            try {
                const clone = groupItem.cloneNode(true) as HTMLElement;
                clone.style.position = 'absolute';
                clone.style.top = '-9999px';
                clone.style.left = '-9999px';
                clone.style.width = `${groupItem.getBoundingClientRect().width}px`;
                clone.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
                document.body.appendChild(clone);
                this._groupDragImageEl = clone;

                if (e.dataTransfer) {
                    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id); e.dataTransfer.setDragImage(clone, 10, 10); } catch (err) { }
                }
            } catch (err) {
                // ignore
            }
        });

        groupItem.addEventListener('dragend', () => {
            groupItem.classList.remove('dragging');
            this.draggedGroupId = null;

            // 清理所有项的拖拽相关样式
            container.querySelectorAll('.group-item').forEach((el) => {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            // 清理 drag image clone
            if (this._groupDragImageEl && this._groupDragImageEl.parentNode) {
                this._groupDragImageEl.parentNode.removeChild(this._groupDragImageEl);
            }
            this._groupDragImageEl = null;

            // 清理容器级指示器
            if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
            }
            this._groupDropIndicator = null;
        });

        groupItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (err) { }

            // 使用容器级绝对定位的指示器来显示插入位置（跨项一致）
            if (this.draggedGroupId && this.draggedGroupId !== group.id) {
                const rect = groupItem.getBoundingClientRect();
                const mouseY = (e as DragEvent).clientY;
                const insertTop = mouseY < rect.top + rect.height / 2;

                // 创建或更新指示器
                if (!this._groupDropIndicator) {
                    const ind = document.createElement('div');
                    ind.className = 'group-drop-indicator';
                    ind.style.position = 'absolute';
                    ind.style.height = '3px';
                    ind.style.backgroundColor = 'var(--b3-theme-primary)';
                    ind.style.boxShadow = '0 0 8px var(--b3-theme-primary)';
                    ind.style.zIndex = '2000';
                    ind.style.pointerEvents = 'none';
                    container.appendChild(ind);
                    this._groupDropIndicator = ind;
                }

                const indicator = this._groupDropIndicator!;
                // 计算指示器相对于 container 的位置
                const containerRect = container.getBoundingClientRect();
                if (insertTop) {
                    indicator.style.width = `${rect.width}px`;
                    indicator.style.left = `${rect.left - containerRect.left}px`;
                    indicator.style.top = `${rect.top - containerRect.top - 2}px`;
                } else {
                    indicator.style.width = `${rect.width}px`;
                    indicator.style.left = `${rect.left - containerRect.left}px`;
                    indicator.style.top = `${rect.bottom - containerRect.top}px`;
                }
            }
        });

        groupItem.addEventListener('dragleave', (e) => {
            // 仅当鼠标真正离开元素时才清除样式
            const rect = groupItem.getBoundingClientRect();
            const x = (e as DragEvent).clientX;
            const y = (e as DragEvent).clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                groupItem.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        groupItem.addEventListener('drop', async (e) => {
            e.preventDefault();
            groupItem.classList.remove('drag-over-top', 'drag-over-bottom');

            let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || this.draggedGroupId;
            if (!draggedId || draggedId === group.id) return;

            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
                const targetIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

                // 判断插入位置
                const rect = groupItem.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const insertBefore = (e as DragEvent).clientY < midPoint;

                // 计算目标插入位置（在 splice 之前）
                let targetInsertIndex: number;
                if (insertBefore) {
                    targetInsertIndex = targetIndex;
                } else {
                    targetInsertIndex = targetIndex + 1;
                }

                // 如果是向下拖动，需要调整插入索引
                if (draggedIndex < targetInsertIndex) {
                    targetInsertIndex -= 1;
                }


                // 移除被拖拽的元素
                const [draggedGroup] = currentGroups.splice(draggedIndex, 1);


                // 插入到新位置
                currentGroups.splice(targetInsertIndex, 0, draggedGroup);


                // 重新分配 sort 值
                currentGroups.forEach((g: any, index: number) => {
                    g.sort = (index + 1) * 10;
                });


                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                // 清理指示器
                if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                    this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                }
                this._groupDropIndicator = null;

                // 刷新 UI
                await this.loadAndDisplayGroups(container);
                this.queueLoadTasks();
                showMessage('分组顺序已更新');
            } catch (error) {
                console.error('更新分组顺序失败:', error);
                showMessage('更新分组顺序失败');
            }
        });



    }

    /**
     * 触发reminderUpdated事件，带源标识
     * @param skipSelfUpdate 是否跳过自己的更新（默认true）
     */
    private async handleDrop(event: DragEvent, status: string, customGroupId: string | null = null, options?: { targetTask?: any, insertBefore?: boolean }) {
        event.preventDefault();
        event.stopPropagation();

        const dt = event.dataTransfer;
        if (!dt) return;

        let blockIds: string[] = [];
        const types = Array.from(dt.types);

        // helper to extract IDs from dragElement for file drops (handling multi-select)
        const getIdsFromDragElement = () => {
            const ele: HTMLElement = (window as any).siyuan?.dragElement;
            if (ele && ele.innerText) {
                const blockIdStr = ele.innerText;
                return blockIdStr.split(',').map(id => id.trim()).filter(id => id && id !== '/');
            }
            return [];
        };

        const gutterType = types.find(t => t.startsWith(Constants.SIYUAN_DROP_GUTTER));
        if (gutterType) {
            const data = dt.getData(gutterType) || dt.getData(Constants.SIYUAN_DROP_GUTTER);
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) {
                        blockIds = parsed.map(item => item.id);
                    } else if (parsed && parsed.id) {
                        blockIds = [parsed.id];
                    }
                } catch (e) {
                    // Try parsing from the type string itself as fallback
                    const meta = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, '');
                    const info = meta.split('\u200b'); // ZWSP
                    if (info && info.length >= 3) {
                        const blockIdStr = info[2];
                        if (blockIdStr) {
                            blockIds = blockIdStr.split(',').map(id => id.trim()).filter(id => id && id !== '/');
                        }
                    }
                    if (blockIds.length === 0) {
                        console.error('Parse SIYUAN_DROP_GUTTER failed', e);
                    }
                }
            } else {
                // No data but type matches, try parsing from the type string
                const meta = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, '');
                const info = meta.split('\u200b'); // ZWSP
                if (info && info.length >= 3) {
                    const blockIdStr = info[2];
                    if (blockIdStr) {
                        blockIds = blockIdStr.split(',').map(id => id.trim()).filter(id => id && id !== '/');
                    }
                }
            }
        } else if (types.includes(Constants.SIYUAN_DROP_FILE)) {
            // 优先尝试从 dragElement 获取ID，这对于多选拖拽更可靠
            const idsFromEle = getIdsFromDragElement();
            if (idsFromEle.length > 0) {
                blockIds = idsFromEle;
            } else {
                const data = dt.getData(Constants.SIYUAN_DROP_FILE);
                if (data) {
                    try {
                        const parsed = JSON.parse(data);
                        if (Array.isArray(parsed)) {
                            blockIds = parsed.map(item => item.id || item);
                        } else if (parsed && parsed.id) {
                            blockIds = [parsed.id];
                        } else {
                            if (typeof parsed === 'string') blockIds = [parsed];
                        }
                    } catch (e) {
                        blockIds = [data];
                    }
                }
            }
        } else if (types.includes(Constants.SIYUAN_DROP_TAB)) {
            const data = dt.getData(Constants.SIYUAN_DROP_TAB);
            if (data) {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && parsed.id) {
                        blockIds = [parsed.id];
                    } else if (typeof parsed === 'string') {
                        blockIds = [parsed];
                    }
                } catch (e) {
                    blockIds = [data];
                }
            }
        }

        if (blockIds.length > 0) {
            // Calculate sort order if dropping onto a target task
            let targetSortPercentage = 0; // default for no target
            let useSort = false;
            let targetPriority = 'none';

            if (options?.targetTask) {
                const targetTask = options.targetTask;
                // If dropping onto a task, we might want to adopt its priority if it's not the default
                if (targetTask.priority && targetTask.priority !== 'none') {
                    targetPriority = targetTask.priority;
                }

                if (options.insertBefore) {
                    // Insert before target task.
                    // IMPORTANT: siblings must be sorted to match VISUAL order.
                    // sortTasks logic:
                    // DESC (default): Small sort value first -> sort by (a.sort - b.sort)
                    // ASC: Large sort value first -> sort by (b.sort - a.sort)
                    const siblings = this.tasks.filter(t =>
                        this.getTaskStatus(t) === status &&
                        (t.customGroupId || 'ungrouped') === (customGroupId || 'ungrouped')
                    ).sort((a, b) => (this.currentSortOrder === 'asc' ? b.sort - a.sort : a.sort - b.sort));

                    const targetIndex = siblings.findIndex(t => t.id === targetTask.id);
                    if (targetIndex !== -1) {
                        const targetSort = targetTask.sort;
                        if (this.currentSortOrder === 'asc') {
                            // In Priority-ASC mode, larger sort values actually appear visually BEFORE smaller ones.
                            // So "Before" means LARGER.
                            const prevTask = siblings[targetIndex - 1];
                            const prevSort = prevTask ? prevTask.sort : targetSort + 2000;
                            targetSortPercentage = (targetSort + prevSort) / 2;
                        } else {
                            // In Priority-DESC (default) mode, smaller sort values appear VISUALLY FIRST (on top).
                            // So "Before" (above) means a SMALLER sort value. (Target - offset)
                            const prevTask = siblings[targetIndex - 1]; // Visually above
                            const prevSort = prevTask ? prevTask.sort : targetSort - 2000;
                            targetSortPercentage = (targetSort + prevSort) / 2;
                        }
                        useSort = true;
                    }
                } else {
                    // Insert After
                    const siblings = this.tasks.filter(t =>
                        this.getTaskStatus(t) === status &&
                        (t.customGroupId || 'ungrouped') === (customGroupId || 'ungrouped')
                    ).sort((a, b) => (this.currentSortOrder === 'asc' ? b.sort - a.sort : a.sort - b.sort));

                    const targetIndex = siblings.findIndex(t => t.id === targetTask.id);
                    if (targetIndex !== -1) {
                        const targetSort = targetTask.sort;
                        if (this.currentSortOrder === 'asc') {
                            // In ASC, After means SMALLER
                            const nextTask = siblings[targetIndex + 1];
                            const nextSort = nextTask ? nextTask.sort : targetSort - 2000;
                            targetSortPercentage = (targetSort + nextSort) / 2;
                        } else {
                            // In DESC (default), After (below) means LARGER sort value.
                            const nextTask = siblings[targetIndex + 1];
                            const nextSort = nextTask ? nextTask.sort : targetSort + 2000;
                            targetSortPercentage = (targetSort + nextSort) / 2;
                        }
                        useSort = true;
                    }
                }
            }

            // Iterate and add/update
            // If multiple items, we need to distribute their sort values so they appear in order
            let currentSort = useSort ? targetSortPercentage : 0;
            // In DESC (default): top=smaller, bottom=larger. To keep dropped items in order (1, 2, 3), 
            // each subsequent item needs a LARGER sort value. So sortStep = +10.
            const sortStep = (this.currentSortOrder === 'asc' ? -10 : 10); // Spacing

            // Reverse blockIds if we are inserting 'before' in DESC mode or 'after' in ASC mode?
            // Dragging multiple items usually keeps their relative order.
            // If we calculate `currentSort` as the starting point, we should increment/decrement for subsequent items.

            for (let i = 0; i < blockIds.length; i++) {
                const id = blockIds[i];
                const itemSort = useSort ? (currentSort + (i * sortStep)) : undefined; // distribute
                await this.addItemByBlockId(id, status, customGroupId, itemSort, targetPriority);
            }
            // Explicitly reload to ensure UI reflects new tasks
            this.dispatchReminderUpdate(true);

            // Immediate UI update sequence
            this.sortTasks();
            this.renderKanban();

            // Sync with storage fully
            this.queueLoadTasks();

            showMessage(i18n('taskCreated') || '任务已创建');
        }
    }

    private async addItemByBlockId(blockId: string, status: string, customGroupId: string | null = null, sort?: number, priority: string = 'none') {
        if (!blockId) return;
        try {
            await refreshSql();
            const block = await getBlockByID(blockId);
            if (!block) {
                // Since this might happen in loop, just log warn to avoid spamming UI
                console.warn(`Block ${blockId} not found`);
                return;
            }

            const reminderData = await this.plugin.loadReminderData();

            // Check if already bound
            const existingReminder = Object.values(reminderData).find((r: any) => r && r.blockId === blockId && r.projectId === this.projectId);
            if (existingReminder) {
                // If exists in same project, just update its status and group
                const updates: any = {
                    kanbanStatus: status,
                    customGroupId: customGroupId,
                    projectId: this.projectId
                };
                if (sort !== undefined) updates.sort = sort;
                if (priority !== 'none') updates.priority = priority;

                await this.batchUpdateTasks([(existingReminder as any).id], updates);
                // showMessage(i18n('taskUpdated') || '任务已更新');
                return;
            }

            const reminderId = window.Lute?.NewNodeID?.() || `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            let title = block.content || i18n('unnamedNote') || '未命名任务';
            if (title.length > 100) title = title.substring(0, 100) + '...';

            const newReminder: any = {
                id: reminderId,
                title: title.trim(),
                blockId: blockId,
                docId: block.root_id || (block.type === 'd' ? block.id : null),
                projectId: this.projectId,
                categoryId: this.project?.categoryId || undefined,
                kanbanStatus: status,
                customGroupId: customGroupId,
                priority: priority,
                createdAt: new Date().toISOString(),
                createdTime: new Date().toISOString(),
                completed: status === 'completed',
                sort: sort !== undefined ? sort : ((this.tasks.reduce((max, t) => Math.max(max, t.sort || 0), 0)) + 10)
            };

            reminderData[reminderId] = newReminder;
            await this.plugin.saveReminderData(reminderData);

            // Update local cache to prevent task disappearing on next loadTasks
            if (!this.reminderData) {
                this.reminderData = reminderData;
            } else {
                this.reminderData[reminderId] = newReminder;
            }

            await updateBindBlockAtrrs(blockId, this.plugin);
            await addBlockProjectId(blockId, this.projectId);

            this.tasks.push(newReminder);
            // Don't full sort here, we handle bulk refresh later or queueLoadTasks will do it
        } catch (error) {
            console.error('addItemByBlockId failed:', error);
            showMessage(i18n('createFailed') || '创建失败', 3000, 'error');
        }
    }

    private dispatchReminderUpdate(skipSelfUpdate: boolean = true) {

        window.dispatchEvent(new CustomEvent('reminderUpdated', {
            detail: {
                source: skipSelfUpdate ? this.kanbanInstanceId : null,
                projectId: this.projectId
            }
        }));
    }



    /**
     * 更新任务DOM元素
     * @param taskId 任务ID
     * @param updates 更新的字段
     */
    private updateTaskElementDOM(taskId: string, updates: Partial<any>) {
        const taskEl = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
        if (!taskEl) {
            // 如果找不到DOM元素，可能需要重新渲染
            this.queueLoadTasks();
            return;
        }

        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 根据更新内容选择性更新 DOM
        if ('title' in updates) {
            const titleEl = taskEl.querySelector('.kanban-task-title');
            if (titleEl) {
                // 保留子任务数量指示器
                const subtaskIndicator = titleEl.querySelector('.subtask-indicator');
                titleEl.textContent = task.title || i18n('noContentHint');
                if (subtaskIndicator) {
                    titleEl.appendChild(subtaskIndicator);
                }
            }
        }

        if ('completed' in updates) {
            const checkbox = taskEl.querySelector('.kanban-task-checkbox') as HTMLInputElement;
            if (checkbox) checkbox.checked = task.completed;
            taskEl.style.opacity = task.completed ? '0.5' : '1';

            // 更新完成时间显示
            const infoEl = taskEl.querySelector('.kanban-task-info') as HTMLElement;
            if (infoEl) {
                let completedTimeEl = infoEl.querySelector('.kanban-task-completed-time') as HTMLElement;
                if (task.completed && task.completedTime) {
                    if (!completedTimeEl) {
                        completedTimeEl = document.createElement('div');
                        completedTimeEl.className = 'kanban-task-completed-time';
                        completedTimeEl.style.cssText = `
                            font-size: 12px;
                            color: var(--b3-theme-on-surface);
                            opacity: 0.7;
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            margin-bottom: 4px;
                        `;
                        infoEl.insertBefore(completedTimeEl, infoEl.firstChild);
                    }
                    completedTimeEl.innerHTML = `<span>✅</span><span>完成于: ${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
                } else if (completedTimeEl) {
                    completedTimeEl.remove();
                }
            }
        }

        if ('priority' in updates) {
            // 移除旧的优先级类
            taskEl.className = taskEl.className.replace(/kanban-task-priority-\w+/g, '');
            if (task.priority && task.priority !== 'none') {
                taskEl.classList.add(`kanban-task-priority-${task.priority}`);
            }

            // 更新优先级背景色和边框
            let backgroundColor = '';
            let borderColor = '';
            switch (task.priority) {
                case 'high':
                    backgroundColor = 'rgba(from var(--b3-card-error-background) r g b / .5)';
                    borderColor = 'var(--b3-card-error-color)';
                    break;
                case 'medium':
                    backgroundColor = 'rgba(from var(--b3-card-warning-background) r g b / .5)';
                    borderColor = 'var(--b3-card-warning-color)';
                    break;
                case 'low':
                    backgroundColor = 'rgba(from var(--b3-card-info-background) r g b / .7)';
                    borderColor = 'var(--b3-card-info-color)';
                    break;
                default:
                    backgroundColor = 'rgba(from var(--b3-theme-background-light) r g b / .1)';
                    borderColor = 'var(--b3-theme-background-light)';
            }
            taskEl.style.backgroundColor = backgroundColor;
            taskEl.style.borderColor = borderColor;
        }

        // 如果状态改变，智能移动任务卡片到新列
        if ('kanbanStatus' in updates || 'completed' in updates || 'date' in updates) {
            const newStatus = this.getTaskStatus(task);
            // 尝试从最近的带 data-status 的祖先元素获取当前状态，兼容自定义分组模式下的子状态容器
            const statusAncestor = taskEl.closest('[data-status]') as HTMLElement | null;
            const currentStatus = statusAncestor?.dataset.status || null;

            if (currentStatus !== newStatus) {
                // 尝试智能移动任务卡片
                const moved = this.moveTaskCardToColumn(taskEl, currentStatus, newStatus);
                if (!moved) {
                    // 如果移动失败，才重新渲染
                    this.queueLoadTasks();
                }
            }
        }
    }

    /**
     * 智能移动任务卡片到新列
     * @param taskEl 任务DOM元素
     * @param fromStatus 原状态
     * @param toStatus 目标状态
     * @returns 是否成功移动
     */
    private moveTaskCardToColumn(taskEl: HTMLElement, fromStatus: string | null | undefined, toStatus: string): boolean {
        try {
            let targetContent: HTMLElement | null = null;
            let targetColumn: HTMLElement | null = null;
            const targetStatus = (toStatus === 'done' || toStatus === 'completed') ? 'completed' : toStatus;

            if (this.kanbanMode === 'custom') {
                // 自定义分组模式：在当前分组内移动到对应的状态子分组 (使用 completed)
                const groupColumn = taskEl.closest('.kanban-column') as HTMLElement;
                if (!groupColumn) {
                    console.warn('找不到任务所属的分组列');
                    return false;
                }

                targetColumn = groupColumn.querySelector(`.custom-status-${targetStatus}`) as HTMLElement;
                if (!targetColumn) {
                    console.warn('找不到目标状态分组:', targetStatus);
                    return false;
                }
                targetContent = targetColumn.querySelector('.custom-status-group-tasks') as HTMLElement;
            } else {
                // 状态模式：使用 completed

                targetColumn = this.container.querySelector(`.kanban-column-${targetStatus}`) as HTMLElement;
                if (!targetColumn) {
                    console.warn('找不到目标列:', targetStatus);
                    return false;
                }

                // 状态模式下，如果启用了自定义分组，需要找到具体的子容器
                const statusGroupTasks = targetColumn.querySelector(`.status-stable-group[data-status="${targetStatus}"] .status-stable-group-tasks`) as HTMLElement;
                if (statusGroupTasks) {
                    // 尝试根据任务的 groupId 找容器
                    const groupId = taskEl.dataset.groupId || (this.draggedTask?.customGroupId) || 'ungrouped';
                    const customGroupContainer = statusGroupTasks.querySelector(`.custom-group-in-status[data-group-id="${groupId}"] .custom-group-tasks`) as HTMLElement;

                    if (customGroupContainer) {
                        targetContent = customGroupContainer;
                    } else {
                        // 如果没找到具体的自定义分组容器（可能该组在目标列当前为空），
                        // 返回 false 以触发 queueLoadTasks 进行全量重新渲染，确保生成正确的分组结构
                        return false;
                    }
                } else {
                    targetContent = targetColumn.querySelector('.kanban-column-content') as HTMLElement;
                }
            }

            if (!targetContent) {
                console.warn('找不到目标内容区域');
                return false;
            }

            // 移除当前位置的任务卡片
            taskEl.remove();

            // 插入到目标容器 (已完成状态按时间倒序排列)
            if (targetStatus === 'completed') {
                const existingTasks = Array.from(targetContent.querySelectorAll('.kanban-task')) as HTMLElement[];
                const currentTask = this.tasks.find(t => t.id === taskEl.dataset.taskId);

                const insertBeforeTask = existingTasks.find(el => {
                    const elId = el.dataset.taskId;
                    const elTask = this.tasks.find(t => t.id === elId);
                    if (!elTask || !elTask.completed || !elTask.completedTime) return false;
                    if (!currentTask || !currentTask.completedTime) return false;

                    const timeCurrent = new Date(currentTask.completedTime).getTime();
                    const timeEl = new Date(elTask.completedTime).getTime();
                    return timeCurrent > timeEl; // 倒序：新的在前
                });

                if (insertBeforeTask) {
                    targetContent.insertBefore(taskEl, insertBeforeTask);
                } else {
                    targetContent.appendChild(taskEl);
                }
            } else {
                targetContent.appendChild(taskEl);
            }

            // 更新列的任务计数
            if (this.kanbanMode === 'custom') {
                try {
                    // 在自定义分组模式下，更新具体分组下的子状态计数（如果存在）
                    const sourceGroupColumn = (taskEl as HTMLElement).closest('.kanban-column') as HTMLElement | null;
                    const targetGroupColumn = (targetContent as HTMLElement).closest('.kanban-column') as HTMLElement | null;

                    const adjustCount = (col: HTMLElement | null, statusKey: string, delta: number) => {
                        if (!col) return;
                        const countEl = col.querySelector(`.custom-status-${statusKey} .custom-status-group-count`) as HTMLElement | null;
                        if (countEl) {
                            const cur = parseInt(countEl.textContent || '0', 10);
                            countEl.textContent = Math.max(0, cur + delta).toString();
                        } else {
                            // fallback: 更新列顶部计数
                            const topCountEl = col.querySelector('.kanban-column-count') as HTMLElement | null;
                            if (topCountEl) {
                                const cur = parseInt(topCountEl.textContent || '0', 10);
                                topCountEl.textContent = Math.max(0, cur + delta).toString();
                            }
                        }
                    };

                    if (fromStatus) adjustCount(sourceGroupColumn, fromStatus, -1);
                    adjustCount(targetGroupColumn, toStatus, 1);
                } catch (e) {
                    // 如果出错，回退到通用的列计数更新
                    if (fromStatus) this.updateColumnCount(fromStatus, -1);
                    this.updateColumnCount(toStatus, 1);
                }
            } else {
                if (fromStatus) {
                    this.updateColumnCount(fromStatus, -1);
                }
                this.updateColumnCount(toStatus, 1);
            }

            return true;
        } catch (error) {
            console.error('移动任务卡片失败:', error);
            return false;
        }
    }

    /**
     * 更新列的任务计数
     * @param status 列状态
     * @param delta 变化量
     */
    private updateColumnCount(status: string, delta: number) {
        try {
            const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
            if (!column) return;

            const countEl = column.querySelector('.kanban-column-count') as HTMLElement;
            if (!countEl) return;

            const currentCount = parseInt(countEl.textContent || '0', 10);
            const newCount = Math.max(0, currentCount + delta);
            countEl.textContent = newCount.toString();
        } catch (error) {
            console.error('更新列计数失败:', error);
        }
    }

    /**
     * 刷新单个任务元素的显示（不重绘整列）
     * @param taskId 任务ID
     */
    private refreshTaskElement(taskId: string) {
        try {
            const oldEl = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
            if (!oldEl) return;

            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;

            // 优先根据最新的任务数据计算嵌套层级，以保证缩进样式正确
            const level = this.calculateTaskLevel(taskId);
            const newEl = this.createTaskElement(task, level);

            oldEl.replaceWith(newEl);
        } catch (error) {
            console.error('刷新任务元素失败:', error);
        }
    }

    /**
     * 拖拽排序后直接更新DOM,避免重新加载
     * @param draggedTaskId 被拖拽的任务ID
     * @param targetTaskId 目标任务ID
     * @param insertBefore 是否插入到目标任务之前
     * @returns 是否成功更新DOM
     */
    private reorderTasksDOM(draggedTaskId: string, targetTaskId: string, insertBefore: boolean): boolean {
        try {
            // 1. 找到被拖拽的任务元素
            const draggedEl = this.container.querySelector(`[data-task-id="${draggedTaskId}"]`) as HTMLElement;
            if (!draggedEl) {
                console.warn('找不到被拖拽的任务元素:', draggedTaskId);
                return false;
            }

            // 2. 找到目标任务元素
            const targetEl = this.container.querySelector(`[data-task-id="${targetTaskId}"]`) as HTMLElement;
            if (!targetEl) {
                console.warn('找不到目标任务元素:', targetTaskId);
                return false;
            }

            // 3. 获取父容器
            const parentContainer = targetEl.parentElement;
            if (!parentContainer) {
                console.warn('找不到父容器');
                return false;
            }

            // 4. 移除被拖拽的元素
            draggedEl.remove();

            // 5. 插入到正确位置
            if (insertBefore) {
                parentContainer.insertBefore(draggedEl, targetEl);
            } else {
                // 插入到目标元素之后
                const nextSibling = targetEl.nextSibling;
                if (nextSibling) {
                    parentContainer.insertBefore(draggedEl, nextSibling);
                } else {
                    parentContainer.appendChild(draggedEl);
                }
            }

            return true;
        } catch (error) {
            console.error('DOM重排失败:', error);
            return false;
        }
    }

    private async handleBatchSortDrop(taskIds: string[], targetTask: any, insertBefore: boolean, event: DragEvent) {
        try {
            // 执行批量重排并在成功后再更新 DOM，避免用户在弹窗取消时造成 DOM 已经变更的视觉问题
            const proceeded = await this.batchReorderTasks(taskIds, targetTask, insertBefore);
            if (proceeded) {
                this.batchReorderTasksDOM(taskIds, targetTask.id, insertBefore);
            }
        } catch (error) {
            console.error('批量排序失败:', error);
            showMessage(i18n("sortUpdateFailed") || "排序更新失败");
            await this.queueLoadTasks(); // Revert on failure
        }
    }

    private batchReorderTasksDOM(taskIds: string[], targetTaskId: string, insertBefore: boolean): boolean {
        try {
            const targetEl = this.container.querySelector(`[data-task-id="${targetTaskId}"]`) as HTMLElement;
            if (!targetEl) return false;
            const parentContainer = targetEl.parentElement;
            if (!parentContainer) return false;

            let referenceNode = insertBefore ? targetEl : targetEl.nextSibling;

            for (const taskId of taskIds) {
                const el = this.container.querySelector(`[data-task-id="${taskId}"]`) as HTMLElement;
                if (el) {
                    parentContainer.insertBefore(el, referenceNode);
                    // For inserts, we just keep inserting before the reference. 
                    // This creates correct order [A, B, C] + Ref
                }
            }
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    private async batchReorderTasks(taskIds: string[], targetTask: any, insertBefore: boolean): Promise<boolean> {
        // [New Logic] If not in 'priority' sort mode, switch to it automatically
        if (this.currentSort !== 'priority') {
            this.currentSort = 'priority';
            this.projectManager.setProjectSortRule(this.projectId, 'priority');
            this.updateSortButtonTitle();
            showMessage("已切换为手动操作排序模式");
        }
        try {
            const reminderData = await this.getReminders();
            const blocksToUpdate = new Set<string>();
            const targetId = targetTask.id;
            const targetTaskInDb = reminderData[targetId];
            if (!targetTaskInDb) throw new Error("Target task not found");

            const newStatus = this.getTaskStatus(targetTaskInDb);
            const targetGroup = targetTaskInDb.customGroupId === undefined ? null : targetTaskInDb.customGroupId;
            const targetPriority = targetTaskInDb.priority || 'none';

            // Filter out tasks that are not found
            const validTaskIds = taskIds.filter(id => reminderData[id]);

            // 如果尝试将一组任务移动到另一个状态，且其中有未完成且日期为今天或已过的任务，弹窗提示用户
            try {
                const today = getLogicalDateString();
                const offending = validTaskIds.filter(id => {
                    const t = reminderData[id];
                    if (!t) return false;
                    const oldStatus = this.getTaskStatus(t);
                    if (oldStatus === newStatus) return false; // 状态未变则不算
                    if (t.completed) return false; // 已完成的忽略
                    if (!t.date) return false; // 无日期的忽略
                    try {
                        const logical = this.getTaskLogicalDate(t.date, t.time);
                        return compareDateStrings(logical, today) <= 0;
                    } catch (err) {
                        return false;
                    }
                });

                if (offending.length > 0) {
                    const listHtml = offending.slice(0, 6).map(id => `- ${(reminderData[id] && reminderData[id].title) || id}`).join('<br>');
                    const dialog = new Dialog({
                        title: '提示',
                        content: `
                            <div class="b3-dialog__content">
                                <p>所选任务中包含以下日期为今天或已过的未完成任务，系统会将它们自动显示在“进行中”列：</p>
                                <div style="max-height:180px;overflow:auto;margin:8px 0;padding:6px;border:1px solid var(--b3-border);">${listHtml}${offending.length > 6 ? '<div>...</div>' : ''}</div>
                                <p>要将这些任务移出“进行中”，需要修改任务的日期或时间。</p>
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                                <button class="b3-button" id="continueBtn">继续（跳过这些任务）</button>
                                <button class="b3-button b3-button--primary" id="editBtn">编辑第一个任务时间</button>
                            </div>
                        `,
                        width: "520px"
                    });

                    const choice = await new Promise<string>((resolve) => {
                        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
                        const continueBtn = dialog.element.querySelector('#continueBtn') as HTMLButtonElement;
                        const editBtn = dialog.element.querySelector('#editBtn') as HTMLButtonElement;

                        cancelBtn.addEventListener('click', () => { dialog.destroy(); resolve('cancel'); });
                        continueBtn.addEventListener('click', () => { dialog.destroy(); resolve('continue'); });
                        editBtn.addEventListener('click', () => { dialog.destroy(); resolve('edit'); });
                    });

                    if (choice === 'cancel') {
                        return false; // 中断批量移动
                    }
                    if (choice === 'edit') {
                        await this.editTask(reminderData[offending[0]]);
                        return false; // 中断，等待用户编辑
                    }
                    if (choice === 'continue') {
                        // 从 validTaskIds 中移除 offending
                        for (const id of offending) {
                            const idx = validTaskIds.indexOf(id);
                            if (idx !== -1) validTaskIds.splice(idx, 1);
                        }
                        if (validTaskIds.length === 0) {
                            showMessage(i18n('noTasksToMove') || '没有可移动的任务');
                            return false;
                        }
                    }
                }
            } catch (err) {
                // 忽略日期解析错误，继续执行批量重排
            }
            // Current Target List (based on target context)
            const targetList = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && !r.parentId)
                .filter((r: any) => {
                    const rGroup = (r.customGroupId === undefined) ? null : r.customGroupId;
                    const rStatus = this.getTaskStatus(r);
                    const tPriority = r.priority || 'none';
                    return rGroup === targetGroup && rStatus === newStatus && tPriority === targetPriority;
                })
                .filter((r: any) => !validTaskIds.includes(r.id)) // Exclude dragged tasks
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // Find insertion index
            let insertIndex = targetList.findIndex((t: any) => t.id === targetId);
            if (insertIndex === -1 && targetList.length > 0) {
                // Fallback if target logic fails
                insertIndex = targetList.length;
            } else {
                if (!insertBefore) insertIndex += 1;
            }

            // Update dragged tasks and their descendants
            const allToUpdateIds: string[] = [];
            validTaskIds.forEach(originalId => {
                allToUpdateIds.push(originalId);
                allToUpdateIds.push(...this.getAllDescendantIds(originalId, reminderData));
            });

            // Ensure unique IDs in case of overlap (though unlikely)
            const uniqueToUpdateIds = Array.from(new Set(allToUpdateIds));

            uniqueToUpdateIds.forEach(uid => {
                const task = reminderData[uid];
                if (!task) return;

                let itemChanged = false;

                // Update Status
                const oldStatus = this.getTaskStatus(task);
                if (oldStatus !== newStatus) {
                    if (newStatus === 'completed') {
                        if (!task.completed) {
                            task.completed = true;
                            task.completedTime = getLocalDateTimeString(new Date());
                            task.kanbanStatus = 'completed';
                            itemChanged = true;
                        }
                    } else {
                        if (task.completed || task.kanbanStatus !== newStatus) {
                            task.completed = false;
                            delete task.completedTime;
                            task.kanbanStatus = newStatus === 'doing' ? 'doing' : newStatus;
                            itemChanged = true;
                        }
                    }
                }

                // Update Group
                const oldGroup = task.customGroupId === undefined ? null : task.customGroupId;
                if (oldGroup !== targetGroup) {
                    if (targetGroup === null) {
                        delete task.customGroupId;
                    } else {
                        task.customGroupId = targetGroup;
                    }
                    itemChanged = true;
                }

                // Update Priority
                const oldPrio = task.priority || 'none';
                if (oldPrio !== targetPriority) {
                    task.priority = targetPriority;
                    itemChanged = true;
                }

                // Parent detachment: only for the primary tasks being dragged 
                // AND only if they have a parent in the current view context
                if (validTaskIds.includes(uid) && task.parentId) {
                    // If we moved it to a new location, it becomes a top-level task in that context
                    delete task.parentId;
                    itemChanged = true;
                }

                if (itemChanged && (task.blockId || task.docId)) {
                    blocksToUpdate.add(task.blockId || task.docId);
                }
            });

            // Get the primary dragged tasks for insertion into targetList
            const draggedTasks = validTaskIds.map(id => reminderData[id]);

            // Insert
            targetList.splice(insertIndex, 0, ...draggedTasks);

            // Re-sort entire list
            targetList.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await saveReminders(this.plugin, reminderData);

            // Update local cache
            validTaskIds.forEach(id => {
                const task = reminderData[id];
                const local = this.tasks.find(t => t.id === id);
                if (local) {
                    local.sort = task.sort;
                    local.priority = task.priority;
                    local.kanbanStatus = task.kanbanStatus;
                    local.customGroupId = task.customGroupId;
                    local.completed = task.completed;
                    local.completedTime = task.completedTime;
                }
            });
            targetList.forEach((task: any) => {
                const local = this.tasks.find(t => t.id === task.id);
                if (local) local.sort = task.sort;
            });

            this.dispatchReminderUpdate(true);
            validTaskIds.forEach(id => this.refreshTaskElement(id));

            return true;

        } catch (e) {
            console.error(e);
            throw e;
        }
    }

    // ==================== 批量多选功能 ====================



    /**
     * 批量保存任务
     */
    private async saveTasks(tasks: any[]): Promise<void> {
        try {
            let reminderData = await this.getReminders();

            for (const task of tasks) {
                reminderData[task.id] = {
                    ...reminderData[task.id],
                    ...task,
                    projectId: this.projectId,
                    updatedAt: new Date().toISOString()
                };
            }

            await saveReminders(this.plugin, reminderData);

            // 触发更新事件
            this.dispatchReminderUpdate(true);
        } catch (error) {
            console.error('批量保存任务失败:', error);
            throw error;
        }
    }

    /**
     * 切换多选模式
     */
    private toggleMultiSelectMode(): void {
        this.isMultiSelectMode = !this.isMultiSelectMode;

        if (!this.isMultiSelectMode) {
            // 退出多选模式时清空选择
            this.selectedTaskIds.clear();
            this.lastClickedTaskId = null;
            this.hideBatchToolbar();
        } else {
            this.lastClickedTaskId = null;
        }

        // 更新多选按钮状态
        const multiSelectBtn = this.container.querySelector('#multiSelectBtn') as HTMLButtonElement;
        if (multiSelectBtn) {
            if (this.isMultiSelectMode) {
                multiSelectBtn.classList.add('b3-button--primary');
                multiSelectBtn.classList.remove('b3-button--outline');
                multiSelectBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg> ${i18n('exitBatchSelect')}`;
            } else {
                multiSelectBtn.classList.remove('b3-button--primary');
                multiSelectBtn.classList.add('b3-button--outline');
                multiSelectBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg> ${i18n('batchSelect') || '批量选择'}`;
            }
        }

        // 重新渲染看板以显示/隐藏多选复选框
        this.renderKanban();

        // 无论是否选中任务，只要开启多选模式就显示工具栏
        this.updateBatchToolbar();

        showMessage(this.isMultiSelectMode ? (i18n('batchSelectModeOn') || '已进入批量选择模式') : (i18n('batchSelectModeOff') || '已退出批量选择模式'));
    }

    /**
     * 切换任务选中状态
     */
    private toggleTaskSelection(taskId: string, selected: boolean): void {
        if (selected) {
            this.selectedTaskIds.add(taskId);
        } else {
            this.selectedTaskIds.delete(taskId);
        }

        // 更新任务卡片样式
        const taskEl = this.container.querySelector(`.kanban-task[data-task-id="${taskId}"]`) as HTMLElement;
        if (taskEl) {
            if (selected) {
                taskEl.classList.add('kanban-task-selected');
                taskEl.style.boxShadow = '0 0 0 2px var(--b3-theme-primary)';
                const checkbox = taskEl.querySelector('.kanban-task-multiselect-checkbox') as HTMLInputElement;
                if (checkbox) checkbox.checked = true;
            } else {
                taskEl.classList.remove('kanban-task-selected');
                taskEl.style.boxShadow = '';
                const checkbox = taskEl.querySelector('.kanban-task-multiselect-checkbox') as HTMLInputElement;
                if (checkbox) checkbox.checked = false;
            }
        }

        // 更新批量工具栏
        this.updateBatchToolbar();
    }

    /**
     * 显示/更新批量操作工具栏
     */
    private updateBatchToolbar(): void {
        const selectedCount = this.selectedTaskIds.size;

        if (!this.isMultiSelectMode) {
            this.hideBatchToolbar();
            return;
        }

        if (!this.batchToolbar) {
            this.createBatchToolbar();
        }

        // 更新计数显示
        const countEl = this.batchToolbar?.querySelector('.batch-toolbar-count') as HTMLElement;
        if (countEl) {
            countEl.textContent = `${selectedCount} ${i18n('tasksSelected') || '个任务已选择'}`;
        }

        // 更新操作按钮的禁用状态
        const actionButtons = this.batchToolbar?.querySelectorAll('.b3-button--small:not(.b3-button--text)');
        if (actionButtons) {
            actionButtons.forEach(btn => {
                const button = btn as HTMLButtonElement;
                if (selectedCount === 0) {
                    button.disabled = true;
                    button.style.opacity = '0.5';
                    button.style.cursor = 'not-allowed';
                } else {
                    button.disabled = false;
                    button.style.opacity = '1';
                    button.style.cursor = 'pointer';
                }
            });
        }

        // 更新里程碑按钮可见性
        const milestoneBtn = this.batchToolbar?.querySelector('#batchSetMilestoneBtn') as HTMLElement;
        if (milestoneBtn) {
            let showMilestoneBtn = false;
            if (selectedCount > 0) {
                const firstId = this.selectedTaskIds.values().next().value;
                const firstTask = this.tasks.find(t => t.id === firstId);
                if (firstTask) {
                    const targetGroupId = firstTask.customGroupId;
                    // Verify if all selected tasks are in the same group
                    const allSameGroup = Array.from(this.selectedTaskIds).every(id => {
                        const t = this.tasks.find(task => task.id === id);
                        return t && t.customGroupId === targetGroupId;
                    });

                    if (allSameGroup) {
                        // Check for milestones availability in the target group (or project)
                        if (targetGroupId) {
                            const group = this.project?.customGroups?.find((g: any) => g.id === targetGroupId);
                            if (group && group.milestones && group.milestones.length > 0) {
                                if (group.milestones.some((m: any) => !m.archived)) {
                                    showMilestoneBtn = true;
                                }
                            }
                        } else {
                            // Ungrouped - check project milestones
                            if (this.project?.milestones && this.project.milestones.length > 0) {
                                if (this.project.milestones.some((m: any) => !m.archived)) {
                                    showMilestoneBtn = true;
                                }
                            }
                        }
                    }
                }
            }
            milestoneBtn.style.display = showMilestoneBtn ? 'inline-flex' : 'none';
        }
    }

    /**
     * 创建批量操作工具栏
     */
    private createBatchToolbar(): void {
        this.batchToolbar = document.createElement('div');
        this.batchToolbar.className = 'kanban-batch-toolbar';
        this.batchToolbar.style.cssText = `
            position: absolute;
            bottom: 48px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--b3-theme-background);
            border: 1px solid var(--b3-theme-border);
            border-radius: 8px;
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 16px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            width: 55%;
        `;

        // 选择计数
        const countEl = document.createElement('span');
        countEl.className = 'batch-toolbar-count';
        countEl.style.cssText = `
            font-weight: 600;
            color: var(--b3-theme-primary);
            min-width: 100px;
        `;
        countEl.textContent = `0 ${i18n('tasksSelected') || '个任务已选择'}`;
        this.batchToolbar.appendChild(countEl);

        // 分隔线
        const divider = document.createElement('div');
        divider.style.cssText = `
            width: 1px;
            height: 24px;
            background: var(--b3-theme-border);
        `;
        this.batchToolbar.appendChild(divider);

        // 按钮组
        const buttonsGroup = document.createElement('div');
        buttonsGroup.style.cssText = `
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        `;
        // 设置已完成按钮
        const setCompletedBtn = document.createElement('button');
        setCompletedBtn.className = 'b3-button b3-button--outline b3-button--small';
        setCompletedBtn.innerHTML = `✅ ${i18n('setCompleted') || '设置已完成'}`;
        setCompletedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetCompleted();
        });
        buttonsGroup.appendChild(setCompletedBtn);
        // 设置日期按钮
        const setDateBtn = document.createElement('button');
        setDateBtn.className = 'b3-button b3-button--outline b3-button--small';
        setDateBtn.innerHTML = `🗓 ${i18n('setDate') || '设置日期'}`;
        setDateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetDate();
        });
        buttonsGroup.appendChild(setDateBtn);

        // 设置状态按钮
        const setStatusBtn = document.createElement('button');
        setStatusBtn.className = 'b3-button b3-button--outline b3-button--small';
        setStatusBtn.innerHTML = `🔀 ${i18n('setStatus') || '设置状态'}`;
        setStatusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetStatus();
        });
        buttonsGroup.appendChild(setStatusBtn);


        // 设置分组按钮（只显示有未归档分组时）
        const hasActiveGroups = this.project?.customGroups?.some((g: any) => !g.archived);
        if (hasActiveGroups) {
            const setGroupBtn = document.createElement('button');
            setGroupBtn.className = 'b3-button b3-button--outline b3-button--small';
            setGroupBtn.innerHTML = `📂 ${i18n('setGroup')}`;
            setGroupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.batchSetGroup();
            });
            buttonsGroup.appendChild(setGroupBtn);
        }

        // 设置里程碑按钮 (默认隐藏，由 updateBatchToolbar 控制显示)
        const setMilestoneBtn = document.createElement('button');
        setMilestoneBtn.id = 'batchSetMilestoneBtn';
        setMilestoneBtn.className = 'b3-button b3-button--outline b3-button--small';
        setMilestoneBtn.style.display = 'none';
        setMilestoneBtn.innerHTML = `🚩 ${i18n('setMilestone') || '设置里程碑'}`;
        setMilestoneBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetMilestone();
        });
        buttonsGroup.appendChild(setMilestoneBtn);

        // 设置标签按钮
        if (this.project?.tags && this.project.tags.length > 0) {
            const setTagsBtn = document.createElement('button');
            setTagsBtn.className = 'b3-button b3-button--outline b3-button--small';
            setTagsBtn.innerHTML = `🏷️ ${i18n('setTags') || '设置标签'}`;
            setTagsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.batchSetTags();
            });
            buttonsGroup.appendChild(setTagsBtn);
        }

        // 设置优先级按钮
        const setPriorityBtn = document.createElement('button');
        setPriorityBtn.className = 'b3-button b3-button--outline b3-button--small';
        setPriorityBtn.innerHTML = `🎯 ${i18n('setPriority') || '设置优先级'}`;
        setPriorityBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.batchSetPriority();
        });
        buttonsGroup.appendChild(setPriorityBtn);

        // 删除按钮
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'b3-button b3-button--outline b3-button--small';
        deleteBtn.style.color = 'var(--b3-card-error-color)';
        deleteBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg> ${i18n('delete') || '删除'}`;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            this.batchDelete();
        });
        buttonsGroup.appendChild(deleteBtn);

        this.batchToolbar.appendChild(buttonsGroup);

        // 右侧：全选和取消按钮
        const rightGroup = document.createElement('div');
        rightGroup.style.cssText = `
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        `;

        // 全选按钮
        const selectAllBtn = document.createElement('button');
        selectAllBtn.className = 'b3-button b3-button--text b3-button--small';
        selectAllBtn.textContent = i18n('selectAll') || '全选';
        selectAllBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAllTasks();
        });
        rightGroup.appendChild(selectAllBtn);

        // 全选未完成按钮
        const selectUnfinishedBtn = document.createElement('button');
        selectUnfinishedBtn.className = 'b3-button b3-button--text b3-button--small';
        selectUnfinishedBtn.textContent = i18n('selectAllUnfinished') || '全选未完成';
        selectUnfinishedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectAllUnfinishedTasks();
        });
        rightGroup.appendChild(selectUnfinishedBtn);

        // 取消选择按钮
        const clearBtn = document.createElement('button');
        clearBtn.className = 'b3-button b3-button--text b3-button--small';
        clearBtn.textContent = i18n('clearSelection');
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearSelection();
        });
        rightGroup.appendChild(clearBtn);

        // 退出多选按钮
        const exitMultiSelectBtn = document.createElement('button');
        exitMultiSelectBtn.className = 'b3-button b3-button--text b3-button--small';
        exitMultiSelectBtn.textContent = i18n('exitBatchSelect');
        exitMultiSelectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMultiSelectMode();
        });
        rightGroup.appendChild(exitMultiSelectBtn);

        this.batchToolbar.appendChild(rightGroup);

        // 添加到容器
        this.container.appendChild(this.batchToolbar);
    }

    /**
     * 隐藏批量操作工具栏
     */
    private hideBatchToolbar(): void {
        if (this.batchToolbar) {
            this.batchToolbar.remove();
            this.batchToolbar = null;
        }
    }

    /**
     * 选择所有任务
     */
    private selectAllTasks(): void {
        this.tasks.forEach(task => {
            this.selectedTaskIds.add(task.id);
        });
        this.renderKanban();
        this.updateBatchToolbar();
    }

    /**
     * 选择所有未完成的任务
     */
    private selectAllUnfinishedTasks(): void {
        this.selectedTaskIds.clear();
        this.tasks.forEach(task => {
            if (!task.completed) {
                this.selectedTaskIds.add(task.id);
            }
        });
        this.renderKanban();
        this.updateBatchToolbar();
    }

    /**
     * 清空选择
     */
    private clearSelection(): void {
        this.selectedTaskIds.clear();
        this.renderKanban();
        this.updateBatchToolbar();
    }

    /**
     * 批量设置日期
     */
    private async batchSetDate(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 创建日期选择对话框
        const dialog = new Dialog({
            title: i18n('batchSetDate') || '批量设置日期',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectDate') || '选择日期'}</label>
                        <input type="date" id="batchDateInput" class="b3-text-field" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('clearDate') || '清空日期'}</label>
                        <input type="checkbox" id="clearDateCheck" style="margin-left: 8px;">
                        <span style="color: var(--b3-theme-on-surface-light); font-size: 12px;">${i18n('clearDateHint') || '勾选后将清空所选任务的日期'}</span>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchDateCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchDateConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '360px'
        });

        const dateInput = dialog.element.querySelector('#batchDateInput') as HTMLInputElement;
        const clearCheck = dialog.element.querySelector('#clearDateCheck') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#batchDateCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchDateConfirm') as HTMLButtonElement;

        // 设置今天为默认日期
        dateInput.value = new Date().toISOString().split('T')[0];

        clearCheck.addEventListener('change', () => {
            dateInput.disabled = clearCheck.checked;
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const clearDate = clearCheck.checked;
            const dateValue = dateInput.value;

            if (!clearDate && !dateValue) {
                showMessage(i18n('pleaseSelectDate') || '请选择日期');
                return;
            }

            dialog.destroy();

            try {
                let successCount = 0;
                const tasksToUpdate = [];

                for (const taskId of selectedIds) {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task) {
                        task.date = clearDate ? undefined : dateValue;
                        tasksToUpdate.push(task);
                        successCount++;
                    }
                }

                // 批量保存任务
                await this.saveTasks(tasksToUpdate);
                showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);
                this.queueLoadTasks();
            } catch (error) {
                console.error('批量设置日期失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }

    /**
     * 批量设置状态
     */
    private async batchSetStatus(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 获取可用的状态列表（kanbanStatuses 已包含已完成状态）
        const statuses = this.kanbanStatuses.length > 0 ? this.kanbanStatuses : this.projectManager.getDefaultKanbanStatuses();

        const statusOptions = statuses.map(s =>
            `<option value="${s.id}">${s.icon ? s.icon + ' ' : ''}${s.name}</option>`
        ).join('');

        const dialog = new Dialog({
            title: i18n('batchSetStatus') || '批量设置状态',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectStatus') || '选择状态'}</label>
                        <select id="batchStatusSelect" class="b3-select" style="width: 100%;">
                            ${statusOptions}
                        </select>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchStatusCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchStatusConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '320px'
        });

        const statusSelect = dialog.element.querySelector('#batchStatusSelect') as HTMLSelectElement;
        const cancelBtn = dialog.element.querySelector('#batchStatusCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchStatusConfirm') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const newStatus = statusSelect.value;
            dialog.destroy();

            try {
                let successCount = 0;
                const tasksToUpdate = [];
                const blocksToUpdate = [];

                for (const taskId of selectedIds) {
                    const task = this.tasks.find(t => t.id === taskId);
                    if (task) {
                        const wasCompleted = task.completed;
                        // 修改状态
                        if (newStatus === 'completed') {
                            task.kanbanStatus = 'completed';
                            task.completed = true;
                            task.completedTime = getLocalDateTimeString(new Date());
                        } else if (newStatus === 'doing') {
                            task.completed = false;
                            task.completedTime = undefined;
                            task.kanbanStatus = 'doing';
                        } else {
                            // 其他状态（长期、短期、自定义状态）
                            task.completed = false;
                            task.completedTime = undefined;
                            task.kanbanStatus = newStatus;
                        }

                        tasksToUpdate.push(task);

                        // 如果有绑定块且完成状态变化，记录
                        if ((task.blockId || task.docId) && wasCompleted !== task.completed) {
                            blocksToUpdate.push(task.blockId || task.docId);
                        }

                        successCount++;
                    }
                }

                // 批量保存任务
                await this.saveTasks(tasksToUpdate);

                // 更新任务
                this.queueLoadTasks();
                showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);
                // 批量更新绑定块属性
                for (const blockId of blocksToUpdate) {
                    await updateBindBlockAtrrs(blockId, this.plugin);
                }
            } catch (error) {
                console.error('批量设置状态失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }

    /**
     * 批量设置已完成
     */
    private async batchSetCompleted(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        try {
            let successCount = 0;
            const tasksToUpdate = [];
            const blocksToUpdate = [];

            for (const taskId of selectedIds) {
                const task = this.tasks.find(t => t.id === taskId);
                if (task) {
                    const wasCompleted = task.completed;

                    // 设置为完成状态
                    task.kanbanStatus = 'completed';
                    task.completed = true;
                    // 如果已经有完成时间，保持原样？或者更新？
                    // 通常批量设置为完成意味着"现在完成"，所以更新时间比较合理，或者如果已经完成就不动?
                    // 但用户显式点击"设置已完成"，意味着强制设为完成。
                    if (!wasCompleted) {
                        task.completedTime = getLocalDateTimeString(new Date());
                    } else if (!task.completedTime) {
                        task.completedTime = getLocalDateTimeString(new Date());
                    }

                    tasksToUpdate.push(task);

                    // 记录需要更新的绑定块
                    if (task.blockId || task.docId) {
                        blocksToUpdate.push(task.blockId || task.docId);
                    }

                    successCount++;
                }
            }

            if (tasksToUpdate.length === 0) {
                return;
            }

            // 批量保存任务
            await this.saveTasks(tasksToUpdate);

            // 更新任务
            this.queueLoadTasks();
            showMessage(i18n('batchUpdateSuccess', { count: String(successCount) }) || `成功更新 ${successCount} 个任务`);

            // 批量更新绑定块属性
            for (const blockId of blocksToUpdate) {
                await updateBindBlockAtrrs(blockId, this.plugin);
            }
        } catch (error) {
            console.error('批量设置已完成失败:', error);
            showMessage(i18n('batchUpdateFailed') || '批量更新失败');
        }
    }



    private clearDropZoneHighlights() {
        this.container.querySelectorAll('.kanban-drop-zone-active, .kanban-drop-hover').forEach(el => {
            el.classList.remove('kanban-drop-zone-active', 'kanban-drop-hover');
        });
        this.updateIndicator('none', null, null);
    }

    private findOrCreateUiTask(taskId: string, reminderData: any) {
        let uiTask = this.tasks.find(t => t.id === taskId);
        if (uiTask) return uiTask;

        // 改进：识别 YYYYMMDD 或 YYYY-MM-DD 格式的实例后缀
        const isInstance = /_(\d{8}|\d{4}-\d{2}-\d{2})$/.test(taskId);
        const dbId = isInstance ? taskId.substring(0, taskId.lastIndexOf('_')) : taskId;

        const taskInDb = reminderData[dbId];
        if (taskInDb) {
            return {
                ...taskInDb,
                id: taskId,
                isRepeatInstance: isInstance,
                originalId: isInstance ? dbId : undefined,
                date: isInstance ? taskId.split('_').pop() : taskInDb.date
            };
        }
        console.warn('[Kanban] findOrCreateUiTask: Task not found in DB', { taskId, dbId, isInstance });
        return null;
    }

    /**
     * 批量更新任务属性 (用于拖拽)
     */
    private async batchUpdateTasks(taskIds: string[], updates: { kanbanStatus?: string, customGroupId?: string | null, tagIds?: string[], milestoneId?: string | null, projectId?: string | null, priority?: string }) {
        // console.log('[Kanban] batchUpdateTasks called:', { taskIds, updates });
        try {
            const reminderData = await this.getReminders();
            // 如果尝试修改状态（尤其是将任务移出 doing/completed），在执行前先检查是否有未完成且日期为今天或已过的任务。
            // 若存在此类任务，提示用户需先修改任务时间才能移出“进行中”。
            try {
                const today = getLogicalDateString();
                const offendingTasks: any[] = [];
                if (updates.kanbanStatus) {
                    for (const tid of taskIds) {
                        const uiTask = this.findOrCreateUiTask(tid, reminderData);
                        if (!uiTask) continue;
                        if (uiTask.completed) continue;
                        if (uiTask.date && compareDateStrings(this.getTaskLogicalDate(uiTask.date, uiTask.time), today) <= 0) {
                            const target = updates.kanbanStatus;
                            if (target !== 'doing' && target !== 'completed') {
                                offendingTasks.push(uiTask);
                            }
                        }
                    }
                }

                if (offendingTasks.length > 0) {
                    // 弹窗提示：告知哪些任务为今天或已过。用户可选择：取消、继续移动其余任务（跳过这些任务）、编辑首个任务时间。
                    const listHtml = offendingTasks.slice(0, 6).map(t => `<li style="margin-bottom:4px;">${(t.title || '（无标题）')}</li>`).join('');
                    const moreNote = offendingTasks.length > 6 ? `<div style="margin-top:6px; color:var(--b3-theme-on-surface-light);">... 还有 ${offendingTasks.length - 6} 个任务</div>` : '';
                    const dialog = new Dialog({
                        title: '警告：包含今日/已过任务',
                        content: `
                            <div class="b3-dialog__content">
                                <p>所选任务中有 <strong>${offendingTasks.length}</strong> 个任务的日期为今天或已过，系统会将这些任务自动显示在“进行中”列。</p>
                                <p>要将这些任务移出“进行中”，请先修改它们的日期或时间。</p>
                                <ul style="margin-top:8px; padding-left:16px;">${listHtml}</ul>
                                ${moreNote}
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                                <button class="b3-button b3-button--outline" id="continueBtn">继续移动其余任务（跳过这些）</button>
                                <button class="b3-button b3-button--primary" id="editBtn">编辑第一个任务时间</button>
                            </div>
                        `,
                        width: "520px"
                    });

                    const choice = await new Promise<string>((resolve) => {
                        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
                        const continueBtn = dialog.element.querySelector('#continueBtn') as HTMLButtonElement;
                        const editBtn = dialog.element.querySelector('#editBtn') as HTMLButtonElement;

                        cancelBtn.addEventListener('click', () => { dialog.destroy(); resolve('cancel'); });
                        continueBtn.addEventListener('click', () => { dialog.destroy(); resolve('continue'); });
                        editBtn.addEventListener('click', async () => { dialog.destroy(); resolve('edit'); });
                    });

                    if (choice === 'cancel') {
                        return; // 中断所有操作
                    }

                    if (choice === 'edit') {
                        // 编辑第一个有问题的任务
                        await this.editTask(offendingTasks[0]);
                        return;
                    }

                    if (choice === 'continue') {
                        // 过滤掉有问题的任务，继续处理其余任务
                        const offendingIds = new Set(offendingTasks.map(t => t.id));
                        taskIds = taskIds.filter(id => !offendingIds.has(id));
                        if (taskIds.length === 0) return; // 没有剩余任务可处理
                    }
                }
            } catch (err) {
                // 忽略日期解析错误，继续后续更新
            }
            const blocksToUpdate = new Set<string>();
            let hasChanges = false;
            let updatedCount = 0;

            for (const taskId of taskIds) {
                const uiTask = this.findOrCreateUiTask(taskId, reminderData);
                if (!uiTask) {
                    console.log('[Kanban] Skipping task (no uiTask):', taskId);
                    continue;
                }

                // 确定DB中的ID（兼容重复实例）
                const dbId = uiTask.isRepeatInstance ? uiTask.originalId : uiTask.id;
                const taskInDb = reminderData[dbId];
                if (!taskInDb) {
                    console.log('[Kanban] Skipping task (not in DB):', { taskId, dbId });
                    continue;
                }

                // console.log('[Kanban] Processing task update:', { taskId, title: taskInDb.title, dbId });

                if (uiTask.isRepeatInstance && uiTask.originalId) {
                    const instanceDate = uiTask.date;
                    // [FIX] 收集包括自身在内的所有相关 ghost 实例对应的原始 ID
                    // 因为 ghost 实例的修改是存储在原始任务的 instanceModifications 中的
                    const originalId = uiTask.originalId;
                    const originalIdsToUpdate = [originalId, ...this.getAllDescendantIds(originalId, reminderData)];

                    let instanceDescendantChanged = false;

                    for (const oid of originalIdsToUpdate) {
                        const originalTask = reminderData[oid];
                        if (!originalTask) continue;

                        const instMod = this.ensureInstanceModificationStructure(originalTask, instanceDate);
                        let instanceChanged = false;

                        // Instance Status Update
                        if (updates.kanbanStatus) {
                            const newStatus = updates.kanbanStatus;
                            if (instMod.kanbanStatus !== newStatus) {
                                instMod.kanbanStatus = newStatus;
                                instanceChanged = true;
                            }
                        }

                        // Instance Group Update
                        if (updates.customGroupId !== undefined) {
                            const newGroup = updates.customGroupId;
                            if (newGroup === null) {
                                delete instMod.customGroupId;
                                instanceChanged = true;
                            } else {
                                if (instMod.customGroupId !== newGroup) {
                                    instMod.customGroupId = newGroup;
                                    instanceChanged = true;
                                }
                            }
                        }

                        // Instance Priority Update
                        if (updates.priority !== undefined) {
                            const newPriority = updates.priority;
                            if (instMod.priority !== newPriority) {
                                instMod.priority = newPriority;
                                instanceChanged = true;
                            }
                        }

                        // Series Project Update (Applied to original task definition)
                        if (updates.projectId !== undefined) {
                            const newProject = updates.projectId;
                            if (newProject === null) {
                                if (originalTask.projectId !== undefined) {
                                    delete originalTask.projectId;
                                    instanceChanged = true;
                                }
                            } else {
                                if (originalTask.projectId !== newProject) {
                                    originalTask.projectId = newProject;
                                    instanceChanged = true;
                                }
                            }
                        }

                        if (instanceChanged) {
                            instanceDescendantChanged = true;
                            if (originalTask.blockId || originalTask.docId) {
                                blocksToUpdate.add(originalTask.blockId || originalTask.docId);
                            }
                        }
                    }

                    // [更正/新增] 同步基准任务定义 (Base Task Definition)
                    // 确保原始任务 (originalId) 的 projectId, customGroupId, kanbanStatus 也被更新
                    // 这样未来生成的实例才会继续属于该项目
                    const baseTask = reminderData[originalId];
                    if (baseTask) {
                        let baseTaskChanged = false;
                        if (updates.projectId !== undefined && baseTask.projectId !== updates.projectId) {
                            baseTask.projectId = updates.projectId;
                            baseTaskChanged = true;
                        }
                        if (updates.customGroupId !== undefined && baseTask.customGroupId !== updates.customGroupId) {
                            if (updates.customGroupId === null) delete baseTask.customGroupId;
                            else baseTask.customGroupId = updates.customGroupId;
                            baseTaskChanged = true;
                        }
                        if (updates.kanbanStatus && updates.kanbanStatus !== 'completed' && baseTask.kanbanStatus !== updates.kanbanStatus) {
                            baseTask.kanbanStatus = updates.kanbanStatus;
                            baseTaskChanged = true;
                        }

                        if (baseTaskChanged) {
                            if (baseTask.blockId || baseTask.docId) {
                                blocksToUpdate.add(baseTask.blockId || baseTask.docId);
                            }
                            hasChanges = true;
                        }
                    }

                    // [新增] 对于重复实例的“普通子任务” (Real Subtasks)，它们是独立的DB记录，需要在此同步更新
                    // 包括：1. 原始任务系列的子任务 (originalIdsToUpdate)
                    //       2. 直接挂载在该实例下的子任务 (instance specific subtasks)
                    const instanceSpecificSubtasks = this.getAllDescendantIds(uiTask.id, reminderData);
                    const allSubtaskIdsToUpdate = new Set([...originalIdsToUpdate, ...instanceSpecificSubtasks]);

                    for (const oid of allSubtaskIdsToUpdate) {
                        if (oid === originalId) continue; // 跳过根任务，根任务的普通更新在 instMod 循环外由 normal item 逻辑或后续逻辑处理并不准确，
                        // 实际上这里的逻辑是处理 “当拖动实例 A 时，A 的子任务 B (也是DB中的一条记录) 该如何更新”。

                        const subTaskInDb = reminderData[oid];
                        if (!subTaskInDb) continue;

                        let subTaskChanged = false;

                        // 同步项目
                        if (updates.projectId !== undefined) {
                            if (subTaskInDb.projectId !== updates.projectId) {
                                subTaskInDb.projectId = updates.projectId;
                                subTaskChanged = true;
                            }
                        }

                        // 同步状态 (如果不是 completed，我们通常让普通子任务同步系列状态)
                        if (updates.kanbanStatus && updates.kanbanStatus !== 'completed') {
                            if (subTaskInDb.kanbanStatus !== updates.kanbanStatus) {
                                subTaskInDb.kanbanStatus = updates.kanbanStatus;
                                subTaskChanged = true;
                            }
                        }

                        if (subTaskChanged) {
                            if (subTaskInDb.blockId || subTaskInDb.docId) {
                                blocksToUpdate.add(subTaskInDb.blockId || subTaskInDb.docId);
                            }
                            hasChanges = true;
                        }
                    }

                    if (instanceDescendantChanged) {
                        hasChanges = true;
                        updatedCount++;
                    }
                } else {
                    // 计算要更新的任务：包括当前任务及其所有后代（基于 reminderData）
                    const toUpdateIds = [dbId, ...this.getAllDescendantIds(dbId, reminderData)];

                    // 对于实例性操作（拖动实例），保留原先的逻辑只对原始任务做更改；但一般拖动应作用于原始与其后代
                    for (const uid of toUpdateIds) {
                        const item = reminderData[uid];
                        if (!item) continue;

                        let itemChanged = false;

                        // Status Update (只对非实例任务的定义进行修改)
                        if (updates.kanbanStatus) {
                            const newStatus = updates.kanbanStatus;
                            if (newStatus === 'completed') {
                                if (!item.completed) {
                                    item.completed = true;
                                    item.completedTime = getLocalDateTimeString(new Date());
                                    item.kanbanStatus = 'completed';
                                    itemChanged = true;
                                }
                            } else {
                                if (item.completed || item.kanbanStatus !== newStatus) {
                                    item.completed = false;
                                    delete item.completedTime;
                                    item.kanbanStatus = newStatus === 'doing' ? 'doing' : newStatus;
                                    itemChanged = true;
                                }
                            }
                        }

                        // Group Update
                        if (updates.customGroupId !== undefined) {
                            const newGroup = updates.customGroupId;
                            if (newGroup === null) {
                                if (item.customGroupId !== undefined) {
                                    delete item.customGroupId;
                                    itemChanged = true;
                                }
                            } else {
                                if (item.customGroupId !== newGroup) {
                                    item.customGroupId = newGroup;
                                    itemChanged = true;
                                }
                            }
                        }

                        // Tag Update
                        if (updates.tagIds !== undefined) {
                            const newTags = updates.tagIds || [];
                            const currentTags = item.tagIds || [];
                            const hasDifference = currentTags.length !== newTags.length || !newTags.every((t: string) => currentTags.includes(t));
                            if (hasDifference) {
                                item.tagIds = [...newTags];
                                itemChanged = true;
                            }
                        }

                        // Milestone Update
                        if (updates.milestoneId !== undefined) {
                            const newMilestone = updates.milestoneId;
                            if (newMilestone === null) {
                                if (item.milestoneId !== undefined) {
                                    delete item.milestoneId;
                                    itemChanged = true;
                                }
                            } else {
                                if (item.milestoneId !== newMilestone) {
                                    item.milestoneId = newMilestone;
                                    itemChanged = true;
                                }
                            }
                        }

                        // Priority Update
                        if (updates.priority !== undefined) {
                            const newPriority = updates.priority;
                            if (item.priority !== newPriority) {
                                item.priority = newPriority;
                                itemChanged = true;
                            }
                        }

                        // Project Update
                        if (updates.projectId !== undefined) {
                            const newProject = updates.projectId;
                            if (newProject === null) {
                                if (item.projectId !== undefined) {
                                    delete item.projectId;
                                    itemChanged = true;
                                }
                            } else {
                                if (item.projectId !== newProject) {
                                    item.projectId = newProject;
                                    itemChanged = true;
                                }
                            }
                        }

                        // Parent detachment: 仅对被直接拖动的任务执行（保持对子任务的父子关系）
                        // [新增] 当 projectId 发生变化时，如果旧父任务不在新项目中，也应脱离
                        const projectChanged = updates.projectId !== undefined && item.projectId !== updates.projectId;

                        if (uid === dbId && (updates.kanbanStatus || updates.customGroupId !== undefined || projectChanged) && item.parentId) {
                            delete item.parentId;
                            itemChanged = true;
                        }

                        if (itemChanged) {
                            // console.log('[Kanban] Task updated in DB cache:', { taskId: item.id, itemChanged, finalProject: item.projectId, finalStatus: item.kanbanStatus });
                            hasChanges = true;
                            updatedCount++;
                            if (item.blockId || item.docId) {
                                blocksToUpdate.add(item.blockId || item.docId);
                            }
                        }
                    }
                }
            }

            if (hasChanges) {
                await saveReminders(this.plugin, reminderData);
                this.dispatchReminderUpdate(true);
                await this.queueLoadTasks(); // Full reload
                showMessage(i18n('batchUpdateSuccess', { count: String(updatedCount) }) || `成功更新 ${updatedCount} 个任务`);

                for (const blockId of blocksToUpdate) {
                    try {
                        await updateBindBlockAtrrs(blockId, this.plugin);
                    } catch (err) { console.warn(err); }
                }
            }

        } catch (e) {
            console.error("Batch update failed", e);
            showMessage("Batch update failed");
        }
    }

    /**
     * 批量设置分组
     */
    private async batchSetGroup(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const groups = await projectManager.getProjectCustomGroups(this.projectId);

            // 过滤掉已归档的分组
            const activeGroups = groups.filter((g: any) => !g.archived);

            const groupOptions = [
                `<option value="">${i18n('noGroup') || '无分组'}</option>`,
                ...activeGroups.map(g => `<option value="${g.id}">${g.icon || '📋'} ${g.name}</option>`)
            ].join('');

            const dialog = new Dialog({
                title: i18n('batchSetGroup') || '批量设置分组',
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('selectGroup') || '选择分组'}</label>
                            <select id="batchGroupSelect" class="b3-select" style="width: 100%;">
                                ${groupOptions}
                            </select>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="batchGroupCancel">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="batchGroupConfirm">${i18n('confirm')}</button>
                    </div>
                `,
                width: '320px'
            });

            const groupSelect = dialog.element.querySelector('#batchGroupSelect') as HTMLSelectElement;
            const cancelBtn = dialog.element.querySelector('#batchGroupCancel') as HTMLButtonElement;
            const confirmBtn = dialog.element.querySelector('#batchGroupConfirm') as HTMLButtonElement;

            cancelBtn.addEventListener('click', () => dialog.destroy());

            confirmBtn.addEventListener('click', async () => {
                const groupId = groupSelect.value || null;
                dialog.destroy();

                try {
                    await this.batchUpdateTasks(selectedIds, { customGroupId: groupId });
                    this.queueLoadTasks(); // batchUpdateTasks calls saveReminders and dispatch, but we can queue refresh just in case
                } catch (error) {
                    console.error('批量设置分组失败:', error);
                    showMessage(i18n('batchUpdateFailed') || '批量更新失败');
                }
            });
        } catch (error) {
            console.error('获取分组列表失败:', error);
            showMessage(i18n('loadGroupsFailed') || '加载分组失败');
        }
    }


    /**
     * 批量设置里程碑
     */
    private async batchSetMilestone(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 再次校验分组一致性
        const firstId = selectedIds[0];
        const firstTask = this.tasks.find(t => t.id === firstId);
        if (!firstTask) return;

        const targetGroupId = firstTask.customGroupId;
        const allSameGroup = selectedIds.every(id => {
            const t = this.tasks.find(task => task.id === id);
            return t && t.customGroupId === targetGroupId;
        });

        if (!allSameGroup) {
            showMessage(i18n('batchMilestoneMixedGroups') || '批量设置里程碑仅支持同一分组内的任务');
            return;
        }

        // 获取可用里程碑
        let milestones: any[] = [];
        try {
            if (targetGroupId) {
                const groups = await this.projectManager.getProjectCustomGroups(this.projectId);
                const group = groups.find((g: any) => g.id === targetGroupId);
                if (group && group.milestones) {
                    milestones = group.milestones.filter((m: any) => !m.archived);
                }
            } else {
                const projectData = await this.plugin.loadProjectData() || {};
                const project = projectData[this.projectId];
                if (project && project.milestones) {
                    milestones = project.milestones.filter((m: any) => !m.archived);
                }
            }
        } catch (e) {
            console.error('获取里程碑失败', e);
        }

        if (milestones.length === 0) {
            showMessage(i18n('noMilestonesInGroup') || '该分组无可用里程碑');
            return;
        }

        const milestoneOptions = [
            `<option value="">${i18n('noMilestone') || '无里程碑'}</option>`,
            ...milestones.map(m => `<option value="${m.id}">${m.icon || '🚩'} ${m.name}</option>`)
        ].join('');

        const dialog = new Dialog({
            title: i18n('batchSetMilestone') || '批量设置里程碑',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectMilestone') || '选择里程碑'}</label>
                        <select id="batchMilestoneSelect" class="b3-select" style="width: 100%;">
                            ${milestoneOptions}
                        </select>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchMilestoneCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchMilestoneConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '320px'
        });

        const milestoneSelect = dialog.element.querySelector('#batchMilestoneSelect') as HTMLSelectElement;
        const cancelBtn = dialog.element.querySelector('#batchMilestoneCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchMilestoneConfirm') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const milestoneId = milestoneSelect.value || null;
            dialog.destroy();

            try {
                await this.batchUpdateTasks(selectedIds, { milestoneId: milestoneId });
                this.queueLoadTasks();
            } catch (error) {
                console.error('批量设置里程碑失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }

    /**
     * 批量设置优先级
     */
    private async batchSetPriority(): Promise<void> {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        const priorities = [
            { id: 'none', name: i18n('noPriority') || '无优先级', icon: '' },
            { id: 'low', name: i18n('lowPriority') || '低优先级', icon: '🔵' },
            { id: 'medium', name: i18n('mediumPriority') || '中优先级', icon: '🟡' },
            { id: 'high', name: i18n('highPriority') || '高优先级', icon: '🔴' }
        ];

        const priorityOptions = priorities.map(p =>
            `<option value="${p.id}">${p.icon} ${p.name}</option>`
        ).join('');

        const dialog = new Dialog({
            title: i18n('batchSetPriority') || '批量设置优先级',
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${i18n('selectPriority') || '选择优先级'}</label>
                        <select id="batchPrioritySelect" class="b3-select" style="width: 100%;">
                            ${priorityOptions}
                        </select>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="batchPriorityCancel">${i18n('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="batchPriorityConfirm">${i18n('confirm')}</button>
                </div>
            `,
            width: '320px'
        });

        const prioritySelect = dialog.element.querySelector('#batchPrioritySelect') as HTMLSelectElement;
        const cancelBtn = dialog.element.querySelector('#batchPriorityCancel') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#batchPriorityConfirm') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        confirmBtn.addEventListener('click', async () => {
            const newPriority = prioritySelect.value;
            dialog.destroy();

            try {
                await this.batchUpdateTasks(selectedIds, { priority: newPriority });
                this.queueLoadTasks();
            } catch (error) {
                console.error('批量设置优先级失败:', error);
                showMessage(i18n('batchUpdateFailed') || '批量更新失败');
            }
        });
    }

    /**
     * 批量删除任务
     */
    private batchDelete(): void {
        const selectedIds = Array.from(this.selectedTaskIds);
        if (selectedIds.length === 0) return;

        // 确认对话框 - 思源 confirm 使用回调方式
        confirm(
            i18n('confirmBatchDelete') || '确认批量删除',
            i18n('confirmBatchDeleteMessage', { count: String(selectedIds.length) }) || `确定要删除选中的 ${selectedIds.length} 个任务吗？此操作不可恢复。`,
            async () => {
                try {
                    await this.deleteTasksByIds(selectedIds);

                    // 清空选择
                    this.selectedTaskIds.clear();

                    showMessage(i18n('batchDeleteSuccess', { count: String(selectedIds.length) }) || `成功删除 ${selectedIds.length} 个任务`);
                } catch (error) {
                    console.error('批量删除失败:', error);
                    showMessage(i18n('batchDeleteFailed') || '批量删除失败');
                }
            }
        );
    }


    /**
     * 批量删除任务
     */
    private async deleteTasksByIds(taskIds: string[]): Promise<void> {
        let reminderData = await this.getReminders();
        const boundIds: string[] = [];

        // 收集所有要删除的任务ID，包括子任务
        const allTaskIdsToDelete = new Set<string>();

        const collectTasksToDelete = (ids: string[]) => {
            for (const id of ids) {
                if (allTaskIdsToDelete.has(id)) continue;
                allTaskIdsToDelete.add(id);

                // 递归收集子任务
                const children = this.tasks.filter(t => t.parentId === id);
                collectTasksToDelete(children.map(t => t.id));
            }
        };

        collectTasksToDelete(taskIds);

        // 从提醒数据中删除，并收集绑定块ID
        for (const taskId of allTaskIdsToDelete) {
            if (reminderData[taskId]) {
                const boundId = reminderData[taskId].blockId || reminderData[taskId].docId;
                if (boundId) {
                    boundIds.push(boundId);
                }
                delete reminderData[taskId];
            }
        }

        // 保存更新后的提醒数据
        await saveReminders(this.plugin, reminderData);



        // 从 this.tasks 中移除
        this.tasks = this.tasks.filter(t => !allTaskIdsToDelete.has(t.id));
        this.queueLoadTasks();

        // 触发更新事件
        this.dispatchReminderUpdate(true);

        // 更新绑定块属性
        for (const boundId of boundIds) {
            try {
                await updateBindBlockAtrrs(boundId, this.plugin);
            } catch (e) {
                /* ignore */
            }
        }
    }

    private ensureInstanceModificationStructure(reminder: any, instanceDate: string) {
        if (!reminder.repeat) {
            reminder.repeat = {};
        }
        if (!reminder.repeat.instanceModifications) {
            reminder.repeat.instanceModifications = {};
        }
        if (!reminder.repeat.instanceModifications[instanceDate]) {
            reminder.repeat.instanceModifications[instanceDate] = {};
        }
        return reminder.repeat.instanceModifications[instanceDate];
    }

}
