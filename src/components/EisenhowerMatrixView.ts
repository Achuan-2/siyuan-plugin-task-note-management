import { getFile, putFile, openBlock, getBlockByID, removeFile } from "../api";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import { ProjectManager } from "../utils/projectManager";
import { CategoryManager } from "../utils/categoryManager";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { showMessage, confirm, Menu, Dialog } from "siyuan";
import { i18n } from "../pluginInstance";
import { getLocalDateTimeString, getLocalDateString, compareDateStrings, getLogicalDateString, getLocaleTag } from "../utils/dateUtils";
import { getSolarDateLunarString } from "../utils/lunarUtils";
import { generateRepeatInstances, getRepeatDescription, generateSubtreeInstances } from "../utils/repeatUtils";
interface QuadrantTask {
    id: string;
    title: string;
    priority: 'high' | 'medium' | 'low' | 'none';
    isUrgent: boolean;
    projectId?: string;
    projectName?: string;
    groupName?: string;
    completed: boolean;
    date: string;
    time?: string;
    endTime?: string;
    note?: string;
    blockId?: string;
    extendedProps: any;
    quadrant?: 'important-urgent' | 'important-not-urgent' | 'not-important-urgent' | 'not-important-not-urgent';
    parentId?: string; // 父任务ID
    pomodoroCount?: number; // 番茄钟数量
    focusTime?: number; // 专注时长（分钟）
    sort?: number; // 排序值
    createdTime?: string; // 创建时间
    endDate?: string; // 结束日期
    categoryId?: string; // 分类ID
    repeat?: any; // 重复事件配置
    isRepeatInstance?: boolean; // 是否为重复事件实例
    originalId?: string; // 原始重复事件的ID
    isSubscribed?: boolean; // 是否为订阅任务
}

interface Quadrant {
    key: string;
    title: string;
    description: string;
    color: string;
    tasks: QuadrantTask[];
}

export class EisenhowerMatrixView {
    private container: HTMLElement;
    private plugin: any;
    private projectManager: ProjectManager;
    private categoryManager: CategoryManager;
    private quadrants: Quadrant[];
    private allTasks: QuadrantTask[] = [];
    private filteredTasks: QuadrantTask[] = [];
    private statusFilter: Set<string> = new Set();
    private reminderUpdatedHandler: (event?: CustomEvent) => void;
    private projectFilter: Set<string> = new Set();
    // 唯一标识，用于区分事件来源，避免响应自己触发的事件
    private viewId: string;
    private projectSortOrder: string[] = [];
    private currentProjectSortMode: 'name' | 'custom' = 'name';
    private kanbanStatusFilter: 'all' | 'doing' | 'todo' = 'doing'; // 任务状态筛选
    private criteriaSettings = {
        importanceThreshold: 'medium' as 'high' | 'medium' | 'low',
        urgencyDays: 3
    };
    private isDragging: boolean = false;
    private draggedTaskId: string | null = null;
    private collapsedTasks: Set<string> = new Set();
    private collapsedProjects: Map<string, Set<string>> = new Map(); // 每个象限中折叠的项目

    // 全局番茄钟管理器
    private pomodoroManager = PomodoroManager.getInstance();
    private lute: any;

    constructor(container: HTMLElement, plugin: any) {
        this.container = container;
        this.plugin = plugin;
        this.viewId = `eisenhower-matrix_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        this.projectManager = ProjectManager.getInstance(plugin);
        this.categoryManager = CategoryManager.getInstance(plugin);
        // 监听事件时，如果是自己触发的事件则跳过
        this.reminderUpdatedHandler = (event?: CustomEvent) => {
            if (event && event.detail && event.detail.source === this.viewId) {
                return; // 跳过自己触发的事件
            }
            this.refresh(false);
        };
        try {
            if ((window as any).Lute) {
                this.lute = (window as any).Lute.New();
            }
        } catch (e) {
            console.error('EisenhowerMatrixView: Lute init failed', e);
        }
        this.initQuadrants();

    }

    private initQuadrants() {
        this.quadrants = [
            {
                key: 'important-urgent',
                title: i18n('quadrantImportantUrgent'),
                description: i18n('quadrantImportantUrgentDesc'),
                color: '#e74c3c',
                tasks: []
            },
            {
                key: 'important-not-urgent',
                title: i18n('quadrantImportantNotUrgent'),
                description: i18n('quadrantImportantNotUrgentDesc'),
                color: '#f39c12',
                tasks: []
            },
            {
                key: 'not-important-urgent',
                title: i18n('quadrantNotImportantUrgent'),
                description: i18n('quadrantNotImportantUrgentDesc'),
                color: '#3498db',
                tasks: []
            },
            {
                key: 'not-important-not-urgent',
                title: i18n('quadrantNotImportantNotUrgent'),
                description: i18n('quadrantNotImportantNotUrgentDesc'),
                color: '#95a5a6',
                tasks: []
            }
        ];
    }

    async initialize() {
        await this.projectManager.initialize();
        await this.categoryManager.initialize();
        await this.loadProjectSortOrder();
        await this.loadCriteriaSettings();
        this.setupUI();
        await this.loadTasks();
        this.renderMatrix();
        this.setupEventListeners();
    }

    private setupUI() {
        this.container.innerHTML = '';
        this.container.className = 'eisenhower-matrix-view';

        // 添加标题和切换按钮
        const headerEl = document.createElement('div');
        headerEl.className = 'matrix-header';
        headerEl.innerHTML = `
            <div class="matrix-header-buttons">
                <button class="b3-button b3-button--primary new-task-btn" title="${i18n("newTask")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                    ${i18n("newTask")}
                </button>
                <button class="b3-button b3-button--primary kanban-status-filter-btn" title="${i18n("statusFilter")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconList"></use></svg>
                    ${i18n("eisenhowerDoingTasks")}
                    <svg class="dropdown-arrow" style="margin-left: 4px; width: 12px; height: 12px;"><use xlink:href="#iconDown"></use></svg>
                </button>
                <div class="header-v-separator"></div>
                <button class="b3-button b3-button--outline project-sort-btn" title="${i18n("projectSorting")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>
                </button>
                <button class="b3-button b3-button--outline filter-btn" title="${i18n("eisenhowerFilter")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconFilter"></use></svg>
                </button>
                <button class="b3-button b3-button--outline settings-btn" title="${i18n("eisenhowerSettingsBtn")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                </button>
                <button class="b3-button b3-button--outline refresh-btn" title="${i18n("refresh")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                </button>
            </div>
        `;
        this.container.appendChild(headerEl);

        // 创建四象限网格
        const matrixGrid = document.createElement('div');
        matrixGrid.className = 'matrix-grid';

        this.quadrants.forEach(quadrant => {
            const quadrantEl = this.createQuadrantElement(quadrant);
            matrixGrid.appendChild(quadrantEl);
        });

        this.container.appendChild(matrixGrid);

        // 添加样式
        this.addStyles();
    }

    private createQuadrantElement(quadrant: Quadrant): HTMLElement {
        const quadrantEl = document.createElement('div');
        quadrantEl.className = `quadrant quadrant-${quadrant.key}`;
        quadrantEl.setAttribute('data-quadrant', quadrant.key);

        const header = document.createElement('div');
        header.className = 'quadrant-header';
        header.style.backgroundColor = quadrant.color;
        header.innerHTML = `
            <div class="quadrant-title" style="color: white">${quadrant.title}</div>
            <button class="b3-button b3-button--outline add-task-btn" data-quadrant="${quadrant.key}">
                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                ${i18n("newTask")}
            </button>
        `;

        const content = document.createElement('div');
        content.className = 'quadrant-content';
        content.setAttribute('data-quadrant-content', quadrant.key);

        // 设置为可放置区域
        content.setAttribute('data-drop-zone', 'true');

        quadrantEl.appendChild(header);
        quadrantEl.appendChild(content);

        return quadrantEl;
    }

    private async loadTasks(force: boolean = false) {
        try {
            const reminderData = await getAllReminders(this.plugin, undefined, force);
            const today = getLogicalDateString();
            this.allTasks = [];

            // 辅助函数：检查祖先是否已完成
            const isAncestorCompleted = (r: any): boolean => {
                let current = r;
                while (current && current.parentId) {
                    const parent = reminderData[current.parentId];
                    if (!parent) break;
                    if (parent.completed) return true;
                    current = parent;
                }
                return false;
            };

            // 第一步：生成所有任务（包括重复实例）
            const allRemindersWithInstances: any[] = [];

            for (const [id, reminderObj] of Object.entries(reminderData as any)) {
                const reminder = reminderObj as any;
                if (!reminder || typeof reminder !== 'object') continue;

                // 如果该任务或其任一祖先父任务已完成，则跳过
                if (isAncestorCompleted(reminder)) continue;

                // 对于子任务，即使已完成也要保留（用于计算父任务进度）
                // 只跳过已完成的顶层任务
                if (reminder?.completed && !reminder?.parentId) continue;

                // 对于农历重复任务，只添加符合农历日期的实例，不添加原始日期
                const isLunarRepeat = reminder.repeat?.enabled &&
                    (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

                // 修改后的逻辑：对于所有重复事件，只显示实例，不显示原始任务
                // 同时，如果任务有任何祖先是重复任务，也不显示原始任务（因为它会作为 ghost 实例显示）
                if (!reminder.repeat?.enabled) {
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

                    if (!hasRepeatingAncestor) {
                        // 非周期任务且没有周期祖先，正常添加
                        allRemindersWithInstances.push({ ...reminder, id });
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

                        // Calculate cutoff time for subtask generation filtering
                        let cutoffTime: number | undefined;
                        const instanceCompletedTimes = reminder.repeat?.instanceCompletedTimes || {};
                        const completedTimesLegacy = reminder.repeat?.completedTimes || {};

                        const realCompletedTimeStr = instance.completedTime || instanceCompletedTimes[originalKey] || completedTimesLegacy[originalKey];

                        if (realCompletedTimeStr) {
                            cutoffTime = new Date(realCompletedTimeStr).getTime();
                        } else if (isInstanceCompleted) {
                            cutoffTime = new Date(`${instance.date}T23:59:59`).getTime();
                        }

                        const instanceTask = {
                            ...reminder,
                            ...instance,
                            id: instance.instanceId,
                            isRepeatInstance: true,
                            completed: isInstanceCompleted,
                            // 为已完成的实例添加完成时间（用于排序）
                            completedTime: isInstanceCompleted ? (realCompletedTimeStr || getLocalDateTimeString(new Date(instance.date))) : undefined
                        };

                        // 按日期和完成状态分类
                        const dateComparison = compareDateStrings(instance.date, today);

                        if (dateComparison < 0) {
                            // 过去的日期
                            if (isInstanceCompleted) {
                                pastCompletedList.push(instanceTask);
                                generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, pastCompletedList, reminderData, cutoffTime);
                            } else {
                                pastIncompleteList.push(instanceTask);
                                generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, pastIncompleteList, reminderData, cutoffTime);
                            }
                        } else if (dateComparison === 0) {
                            // 今天的日期（只收集未完成的）
                            if (!isInstanceCompleted) {
                                todayIncompleteList.push(instanceTask);
                                generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, todayIncompleteList, reminderData, cutoffTime);
                            } else {
                                pastCompletedList.push(instanceTask); // 今天已完成算作过去
                                generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, pastCompletedList, reminderData, cutoffTime);
                            }
                        } else {
                            // 未来的日期
                            if (isInstanceCompleted) {
                                futureCompletedList.push(instanceTask);
                                generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, futureCompletedList, reminderData, cutoffTime);
                            } else {
                                futureIncompleteList.push(instanceTask);
                                generateSubtreeInstances(reminder.id, instanceTask.id, instance.date, futureIncompleteList, reminderData, cutoffTime);
                            }
                        }
                    });

                    // 添加过去的未完成实例（含子任务 ghost）
                    allRemindersWithInstances.push(...pastIncompleteList);

                    // 添加今天的未完成实例（含子任务 ghost）
                    allRemindersWithInstances.push(...todayIncompleteList);

                    // 添加未来的第一个未完成实例及其完整的子任务树
                    if (futureIncompleteList.length > 0) {
                        const hasTodayIncomplete = todayIncompleteList.length > 0;
                        if (!hasTodayIncomplete) {
                            // 注意：需要添加第一个未完成主任务及其对应的所有 ghost 子任务
                            // 由于 futureIncompleteList 已经包含了 generateSubtreeInstances 生成的所有子任务
                            // 我们需要找到第一个主任务及其随后的所有子任务（直到下一个主任务）
                            const firstMainTask = futureIncompleteList[0];
                            allRemindersWithInstances.push(firstMainTask);

                            // 查找紧随其后的所有子任务（它们会有相同的 isRepeatInstance 和 date，且 parentId 会链式指向主任务或其子任务）
                            for (let i = 1; i < futureIncompleteList.length; i++) {
                                const nextTask = futureIncompleteList[i];
                                if (nextTask.date === firstMainTask.date && nextTask.originalId !== undefined) {
                                    // 它是 ghost 子任务
                                    allRemindersWithInstances.push(nextTask);
                                } else {
                                    // 遇到了下一个未来实例的主任务
                                    break;
                                }
                            }
                        }
                    }

                    // 注意：不再添加已完成的实例，按照用户要求隐藏已完成的实例
                }
            }

            // 过滤已归档分组的未完成任务
            const filteredReminders = await this.filterArchivedGroupTasks(allRemindersWithInstances);

            // 预加载项目分组信息
            const projectIdsToFetch = new Set<string>();
            filteredReminders.forEach((r: any) => { if (r.projectId) projectIdsToFetch.add(r.projectId); });
            const projectGroupsMap = new Map<string, any[]>();

            // 并行获取所有涉及项目的分组信息
            await Promise.all(Array.from(projectIdsToFetch).map(async pid => {
                try {
                    const groups = await this.projectManager.getProjectCustomGroups(pid);
                    projectGroupsMap.set(pid, groups);
                } catch (e) {
                    // ignore error
                }
            }));

            // 第二步：将提醒转换为 QuadrantTask
            for (const reminder of filteredReminders) {

                // 判断重要性
                const importanceOrder = { 'none': 0, 'low': 1, 'medium': 2, 'high': 3 };
                const thresholdValue = importanceOrder[this.criteriaSettings.importanceThreshold];
                const taskValue = importanceOrder[reminder?.priority || 'none'];
                const isImportant = taskValue >= thresholdValue;

                // 判断紧急性
                const isUrgent = this.isTaskUrgent(reminder);

                // 确定象限
                let quadrant: QuadrantTask['quadrant'];

                // 如果是子任务，继承父任务的象限
                if (reminder?.parentId) {
                    // 先尝试从已加载的任务中找父任务
                    const parentTask = this.allTasks.find(t => t.id === reminder.parentId);
                    if (parentTask) {
                        quadrant = parentTask.quadrant!;
                    } else {
                        // 如果父任务还没加载，从allRemindersWithInstances中查找
                        const parentReminder = allRemindersWithInstances.find(r => r.id === reminder.parentId);
                        if (parentReminder && parentReminder?.quadrant && this.isValidQuadrant(parentReminder.quadrant)) {
                            quadrant = parentReminder.quadrant;
                        } else {
                            // 如果父任务没有设置象限，按父任务的重要性和紧急性计算
                            if (parentReminder) {
                                const parentImportanceValue = importanceOrder[parentReminder?.priority || 'none'];
                                const parentIsImportant = parentImportanceValue >= thresholdValue;
                                const parentIsUrgent = this.isTaskUrgent(parentReminder);

                                if (parentIsImportant && parentIsUrgent) {
                                    quadrant = 'important-urgent';
                                } else if (parentIsImportant && !parentIsUrgent) {
                                    quadrant = 'important-not-urgent';
                                } else if (!parentIsImportant && parentIsUrgent) {
                                    quadrant = 'not-important-urgent';
                                } else {
                                    quadrant = 'not-important-not-urgent';
                                }
                            } else {
                                // 父任务不存在，按自身属性计算
                                if (isImportant && isUrgent) {
                                    quadrant = 'important-urgent';
                                } else if (isImportant && !isUrgent) {
                                    quadrant = 'important-not-urgent';
                                } else if (!isImportant && isUrgent) {
                                    quadrant = 'not-important-urgent';
                                } else {
                                    quadrant = 'not-important-not-urgent';
                                }
                            }
                        }
                    }
                } else {
                    // 非子任务，按原逻辑计算象限
                    if (isImportant && isUrgent) {
                        quadrant = 'important-urgent';
                    } else if (isImportant && !isUrgent) {
                        quadrant = 'important-not-urgent';
                    } else if (!isImportant && isUrgent) {
                        quadrant = 'not-important-urgent';
                    } else {
                        quadrant = 'not-important-not-urgent';
                    }

                    // 如果有手动设置的象限属性，则使用手动设置（仅对父任务）
                    if (reminder?.quadrant && this.isValidQuadrant(reminder.quadrant)) {
                        quadrant = reminder.quadrant;
                    }
                }

                // 获取项目信息
                let projectName = '';
                let groupName = '';
                if (reminder?.projectId) {
                    const project = this.projectManager.getProjectById(reminder.projectId);
                    projectName = project ? project.name : '';

                    if (reminder?.customGroupId) {
                        const groups = projectGroupsMap.get(reminder.projectId);
                        if (groups) {
                            const group = groups.find((g: any) => g.id === reminder.customGroupId);
                            if (group) {
                                groupName = group.name;
                            }
                        }
                    }
                }

                // 获取正确的排序值（支持重复实例）
                // 使用原始日期（从 ID 中提取）作为键，因为 date 可能已被修改
                let taskSort = reminder?.sort || 0;
                if (reminder?.isRepeatInstance && reminder?.originalId && reminder?.id && reminder?.id.includes('_')) {
                    const originalInstanceDate = reminder.id.split('_').pop();
                    const originalReminder = reminderData[reminder.originalId];
                    if (originalReminder?.repeat?.instanceModifications?.[originalInstanceDate]) {
                        taskSort = originalReminder.repeat.instanceModifications[originalInstanceDate].sort ?? reminder.sort ?? 0;
                    }
                }

                const task: QuadrantTask = {
                    id: reminder.id,
                    title: reminder?.title || i18n('unnamedNote'),
                    priority: reminder?.priority || 'none',
                    isUrgent,
                    projectId: reminder?.projectId,
                    projectName,
                    groupName,
                    completed: reminder?.completed || false,
                    date: reminder?.date,
                    time: reminder?.time,
                    endTime: reminder?.endTime,
                    note: reminder?.note,
                    blockId: reminder?.blockId,
                    extendedProps: reminder,
                    quadrant,
                    parentId: reminder?.parentId,
                    pomodoroCount: await this.getReminderPomodoroCount(reminder.id, reminder, reminderData),
                    focusTime: await this.getReminderFocusTime(reminder.id, reminder, reminderData),
                    sort: taskSort,
                    createdTime: reminder?.createdTime,
                    endDate: reminder?.endDate,
                    categoryId: reminder?.categoryId,
                    repeat: reminder?.repeat,
                    isRepeatInstance: reminder?.isRepeatInstance,
                    originalId: reminder?.originalId,
                    isSubscribed: reminder?.isSubscribed
                };

                this.allTasks.push(task);
            }

            // 应用筛选并按象限分组任务
            this.applyFiltersAndGroup();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage(i18n('loadTasksFailed'));
        }
    }

    /**
     * 获取提醒的番茄钟计数（支持重复实例的单独计数）
     * @param reminderId 提醒ID
     * @returns 番茄钟计数
     */
    private async getReminderPomodoroCount(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance(this.plugin);
            if (reminder && reminder.isRepeatInstance) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        rawData = await getAllReminders(this.plugin);
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
            const pomodoroManager = PomodoroRecordManager.getInstance(this.plugin);
            if (reminder && reminder.isRepeatInstance) {
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
                        rawData = await getAllReminders(this.plugin);
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
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
            }

            if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                return pomodoroManager.getEventTotalFocusTime(reminderId);
            }
            return 0;
        } catch (error) {
            console.error('获取番茄钟总专注时长失败:', error);
            return 0;
        }
    }

    private isTaskUrgent(reminder: any): boolean {
        if (!reminder?.date) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0); // 重置时间到当天开始

        // 如果有结束日期，使用结束日期判断紧急性，否则使用开始日期
        const taskDate = new Date(reminder.endDate || reminder.date);
        taskDate.setHours(0, 0, 0, 0);

        // 如果任务未完成且已过期，则认为是紧急的
        if (!reminder.completed && taskDate < today) {
            return true;
        }

        const urgencyDate = new Date();
        urgencyDate.setDate(urgencyDate.getDate() + this.criteriaSettings.urgencyDays);
        urgencyDate.setHours(23, 59, 59, 999); // 设置到当天结束

        // 根据设置的天数判断紧急性，如果任务日期在今天或紧急日期范围内
        return taskDate >= today && taskDate <= urgencyDate;
    }

    private isValidQuadrant(quadrant: string): quadrant is QuadrantTask['quadrant'] {
        return ['important-urgent', 'important-not-urgent', 'not-important-urgent', 'not-important-not-urgent'].includes(quadrant);
    }

    /**
     * 检查任务本身或其父任务是否为进行中状态
     * 今天或过去的任务也视为进行中状态
     * @param task 要检查的任务
     * @returns 如果任务或其父任务是进行中状态，返回true
     */
    private isTaskOrParentDoing(task: QuadrantTask): boolean {
        // 检查任务本身是否是进行中
        if (task.extendedProps?.kanbanStatus === 'doing') {
            return true;
        }

        // 检查任务日期：今天或过去的任务视为进行中（但已完成的任务除外）
        if (!task.completed && task.date) {
            const today = new Date();
            today.setHours(0, 0, 0, 0); // 重置时间到当天开始

            // 如果有结束日期，使用结束日期判断，否则使用开始日期
            const taskDate = new Date(task.endDate || task.date);
            taskDate.setHours(0, 0, 0, 0);

            // 如果任务日期是今天或过去，则视为进行中
            if (taskDate <= today) {
                return true;
            }
        }

        // 检查父任务是否是进行中
        if (task.parentId) {
            const parentTask = this.allTasks.find(t => t.id === task.parentId);
            if (parentTask && parentTask.extendedProps?.kanbanStatus === 'doing') {
                return true;
            }

            // 检查父任务的日期：今天或过去的父任务也视为进行中
            if (parentTask && !parentTask.completed && parentTask.date) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const parentTaskDate = new Date(parentTask.endDate || parentTask.date);
                parentTaskDate.setHours(0, 0, 0, 0);

                if (parentTaskDate <= today) {
                    return true;
                }
            }
        }

        return false;
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

    private applyFiltersAndGroup() {
        // 应用筛选
        this.filteredTasks = this.allTasks.filter(task => {
            // 任务状态筛选（基于 kanbanStatus）
            if (this.kanbanStatusFilter !== 'all') {
                if (this.kanbanStatusFilter === 'doing') {
                    // 筛选进行中任务：任务本身是进行中，或者父任务是进行中
                    if (!this.isTaskOrParentDoing(task)) {
                        return false;
                    }
                } else if (this.kanbanStatusFilter === 'todo') {
                    // "待办任务"筛选"为非进行中"且"非已完成"的任务
                    const kanbanStatus = task.extendedProps?.kanbanStatus;
                    if (kanbanStatus === 'doing' || kanbanStatus === 'completed' || task.completed) {
                        return false;
                    }
                }
            }

            // 状态筛选
            if (this.statusFilter.size > 0) {
                const projectStatus = task.projectId ?
                    this.projectManager.getProjectById(task.projectId)?.status || 'active' :
                    'no-project';
                if (!this.statusFilter.has(projectStatus)) {
                    return false;
                }
            }

            // 项目筛选
            if (this.projectFilter.size > 0) {
                const projectKey = task.projectId || 'no-project';
                if (!this.projectFilter.has(projectKey)) {
                    return false;
                }
            }

            return true;
        });

        // 清空现有任务
        this.quadrants.forEach(q => q.tasks = []);

        // 按象限分组
        this.filteredTasks.forEach(task => {
            const quadrant = this.quadrants.find(q => q.key === task.quadrant);
            if (quadrant) {
                quadrant.tasks.push(task);
            }
        });

        // 在每个象限内按项目分组
        this.quadrants.forEach(quadrant => {
            const groupedTasks = this.groupTasksByProject(quadrant.tasks);
            quadrant.tasks = groupedTasks;
        });
    }

    private groupTasksByProject(tasks: QuadrantTask[]): QuadrantTask[] {
        const grouped = new Map<string, QuadrantTask[]>();

        tasks.forEach(task => {
            const projectKey = task.projectId || 'no-project';
            if (!grouped.has(projectKey)) {
                grouped.set(projectKey, []);
            }
            grouped.get(projectKey)!.push(task);
        });

        // 在每个项目分组内按优先级排序，同时支持手动排序
        grouped.forEach((projectTasks) => {
            // 按优先级排序（高到低），同优先级按sort字段排序
            projectTasks.sort((a, b) => {
                const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                const priorityA = priorityOrder[a.priority || 'none'];
                const priorityB = priorityOrder[b.priority || 'none'];

                // 优先级不同，按优先级降序排序
                if (priorityA !== priorityB) {
                    return priorityB - priorityA;
                }

                // 同优先级内，按手动排序值排序（升序）
                // 使用 task.sort，它已经在创建时从 instanceModifications 中读取了正确的值
                const sortA = a.sort || 0;
                const sortB = b.sort || 0;
                if (sortA !== sortB) {
                    return sortA - sortB;
                }

                // 如果排序值相同，按创建时间排序
                return new Date(b.createdTime || 0).getTime() - new Date(a.createdTime || 0).getTime();
            });
        });

        // 转换为数组并保持顺序
        const result: QuadrantTask[] = [];

        // 获取所有项目ID（排除无项目）
        const projectIds = Array.from(grouped.keys()).filter(key => key !== 'no-project');

        // 根据排序模式排序项目
        let sortedProjectIds: string[];

        if (this.currentProjectSortMode === 'custom' && this.projectSortOrder.length > 0) {
            // 使用自定义排序
            sortedProjectIds = [...this.projectSortOrder.filter(id => projectIds.includes(id))];
            // 添加未排序的项目
            const unsortedProjects = projectIds.filter(id => !this.projectSortOrder.includes(id));
            sortedProjectIds = [...sortedProjectIds, ...unsortedProjects.sort((a, b) => {
                const nameA = grouped.get(a)?.[0]?.projectName || '';
                const nameB = grouped.get(b)?.[0]?.projectName || '';
                return nameA.localeCompare(nameB);
            })];
        } else {
            // 使用名称排序作为默认排序
            sortedProjectIds = projectIds.sort((a, b) => {
                const projectA = grouped.get(a)?.[0];
                const projectB = grouped.get(b)?.[0];

                if (!projectA || !projectB) return 0;

                // 按项目名称排序
                return (projectA.projectName || '').localeCompare(projectB.projectName || '');
            });
        }

        // 按排序后的项目ID顺序添加任务
        sortedProjectIds.forEach(projectId => {
            const tasks = grouped.get(projectId);
            if (tasks) {
                result.push(...tasks);
            }
        });

        // 添加无项目的任务
        if (grouped.has('no-project')) {
            result.push(...grouped.get('no-project')!);
        }

        return result;
    }

    private renderMatrix() {
        this.quadrants.forEach(quadrant => {
            const contentEl = this.container.querySelector(`[data-quadrant-content="${quadrant.key}"]`) as HTMLElement;
            if (!contentEl) return;

            contentEl.innerHTML = '';

            if (quadrant.tasks.length === 0) {
                const emptyEl = document.createElement('div');
                emptyEl.className = 'empty-quadrant';
                emptyEl.textContent = i18n('noTasksInQuadrant');
                contentEl.appendChild(emptyEl);
                return;
            }

            // 按项目分组显示
            const projectGroups = new Map<string, QuadrantTask[]>();
            quadrant.tasks.forEach(task => {
                const projectKey = task.projectId || 'no-project';
                if (!projectGroups.has(projectKey)) {
                    projectGroups.set(projectKey, []);
                }
                projectGroups.get(projectKey)!.push(task);
            });

            projectGroups.forEach((tasks, projectKey) => {
                const projectGroup = document.createElement('div');
                projectGroup.className = 'project-group';

                const projectHeader = document.createElement('div');
                projectHeader.className = 'project-header';

                // 获取项目颜色（如果有）
                let projectColor = '';
                if (projectKey !== 'no-project') {
                    const project = this.projectManager.getProjectById(projectKey);
                    projectColor = project?.color || '';
                }
                // 如果没有项目颜色，使用默认的 surface-lighter
                if (projectColor) {
                    projectHeader.style.backgroundColor = `${projectColor}20`;
                    projectHeader.style.border = `1px solid ${projectColor}`;
                }

                // 获取当前象限的折叠项目集合
                if (!this.collapsedProjects.has(quadrant.key)) {
                    this.collapsedProjects.set(quadrant.key, new Set());
                }
                const collapsedProjectsInQuadrant = this.collapsedProjects.get(quadrant.key)!;
                const isProjectCollapsed = collapsedProjectsInQuadrant.has(projectKey);

                // 创建折叠/展开按钮
                const collapseBtn = document.createElement('button');
                collapseBtn.className = 'project-collapse-btn b3-button b3-button--text';
                collapseBtn.innerHTML = `<svg class="b3-button__icon" style="width: 12px; height: 12px;"><use xlink:href="#${isProjectCollapsed ? 'iconRight' : 'iconDown'}"></use></svg>`;
                collapseBtn.title = isProjectCollapsed ? '展开' : '折叠';
                collapseBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggleProjectCollapse(quadrant.key, projectKey);
                });
                projectHeader.appendChild(collapseBtn);

                // 项目名称
                const projectNameSpan = document.createElement('span');
                projectNameSpan.className = 'project-name';
                if (projectKey !== 'no-project') {
                    projectNameSpan.textContent = tasks[0].projectName || i18n('noProject');
                    projectNameSpan.style.cursor = 'pointer';
                    projectNameSpan.style.color = 'var(--b3-theme-primary)';
                    projectNameSpan.title = i18n('openProjectKanban');

                    // 添加点击事件打开项目看板
                    projectNameSpan.addEventListener('click', () => {
                        this.openProjectKanban(projectKey);
                    });
                } else {
                    projectNameSpan.textContent = i18n('noProject');
                }
                projectHeader.appendChild(projectNameSpan);

                // 任务计数
                const taskCountSpan = document.createElement('span');
                taskCountSpan.className = 'project-task-count';
                taskCountSpan.textContent = `(${tasks.length})`;
                taskCountSpan.style.cssText = `
                    margin-left: 8px;
                    font-size: 12px;
                    color: var(--b3-theme-on-surface-light);
                    opacity: 0.7;
                `;
                projectHeader.appendChild(taskCountSpan);

                projectGroup.appendChild(projectHeader);

                // 任务容器（用于折叠/展开）
                const tasksContainer = document.createElement('div');
                tasksContainer.className = 'project-tasks-container';
                tasksContainer.style.display = isProjectCollapsed ? 'none' : 'block';

                // 支持子任务的层级显示
                const taskMap = new Map(tasks.map(t => [t.id, t]));
                const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
                const renderTaskWithChildren = (task: QuadrantTask, level: number) => {
                    // 只渲染未完成的子任务，已完成的子任务不显示但用于进度计算
                    if (task.completed && level > 0) {
                        return;
                    }

                    const taskEl = this.createTaskElement(task, level);
                    tasksContainer.appendChild(taskEl);

                    // 渲染子任务（只渲染未完成的）
                    const childTasks = tasks.filter(t => t.parentId === task.id && !t.completed);
                    if (childTasks.length > 0 && !this.collapsedTasks.has(task.id)) {
                        childTasks.forEach(childTask => renderTaskWithChildren(childTask, level + 1));
                    }
                };

                topLevelTasks.forEach(task => renderTaskWithChildren(task, 0));

                projectGroup.appendChild(tasksContainer);
                contentEl.appendChild(projectGroup);
            });
        });
    }

    private createTaskElement(task: QuadrantTask, level: number = 0): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = `quick_item ${task.completed ? 'completed' : ''}`;
        if (level > 0) {
            taskEl.classList.add('child-task');
            taskEl.style.marginLeft = `${level * 20}px`;
        }
        taskEl.setAttribute('data-task-id', task.id);
        taskEl.setAttribute('draggable', 'true'); // 整个任务元素可拖拽
        taskEl.setAttribute('data-project-id', task.projectId || 'no-project');
        taskEl.setAttribute('data-priority', task.priority || 'none');

        // 添加优先级样式类（参考项目看板）
        if (task.priority && task.priority !== 'none') {
            taskEl.classList.add(`task-priority-${task.priority}`);
        }

        // 设置任务颜色（根据优先级）- 参考项目看板的样式
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
        taskEl.style.backgroundColor = backgroundColor;
        taskEl.style.border = `1.5px solid ${borderColor}`;

        // 创建任务内容容器
        const taskContent = document.createElement('div');
        taskContent.className = 'task-content';

        // 创建复选框容器
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'task-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        if (task.isSubscribed) {
            checkbox.disabled = true;
            checkbox.title = i18n("subscribedTaskReadonly");
        }
        checkboxContainer.appendChild(checkbox);

        // 创建任务信息容器
        const taskInfo = document.createElement('div');
        taskInfo.className = 'task-info';

        // 订阅任务标识
        if (task.isSubscribed) {
            const subBadge = document.createElement('span');
            subBadge.innerHTML = `<svg style="width: 12px; height: 12px; margin-right: 4px; vertical-align: middle;"><use xlink:href="#iconCloud"></use></svg>`;
            subBadge.title = i18n("icsSubscribedTask");
            taskInfo.appendChild(subBadge);
        }

        // 创建控制按钮容器（仅保留折叠按钮）
        const taskControlContainer = document.createElement('div');
        taskControlContainer.className = 'task-control-container';
        taskControlContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            gap: 2px;
        `;

        // 折叠按钮（仅对有子任务的父任务显示）
        const childTasks = this.allTasks.filter(t => t.parentId === task.id);
        if (childTasks.length > 0) {
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'task-collapse-btn b3-button b3-button--outline';
            const isCollapsed = this.collapsedTasks.has(task.id);
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#${isCollapsed ? 'iconRight' : 'iconDown'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开子任务' : '折叠子任务';
            collapseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.toggleTaskCollapse(task.id);
            });
            taskControlContainer.appendChild(collapseBtn);
        }

        // 创建任务标题
        const taskTitle = document.createElement('div');
        taskTitle.className = 'task-title';

        // 如果任务有绑定块，设置为链接样式
        if (task.blockId) {
            taskTitle.setAttribute('data-type', 'a');
            taskTitle.setAttribute('data-href', `siyuan://blocks/${task.blockId}`);
            taskTitle.style.cssText += `
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline;
                font-weight: 500;
            `;
            taskTitle.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openTaskBlock(task.blockId!);
            });
        }

        taskTitle.textContent = task.title;
        taskTitle.title = task.blockId ? `点击打开绑定块: ${task.title}` : task.title;

        // 如果有子任务，添加数量指示器
        if (childTasks.length > 0) {
            const childCountSpan = document.createElement('span');
            childCountSpan.className = 'child-task-count';
            childCountSpan.textContent = ` (${childTasks.length})`;
            childCountSpan.style.cssText = `
                color: var(--b3-theme-on-surface-light);
                font-size: 12px;
                margin-left: 4px;
            `;
            taskTitle.appendChild(childCountSpan);
        }

        // 创建项目/分组信息（单独一行）
        let projectDiv: HTMLElement | null = null;
        if (task.projectName) {
            projectDiv = document.createElement('div');
            projectDiv.className = 'task-project-info';
            let projectText = task.projectName;
            if (task.groupName) {
                projectText += ` / ${task.groupName}`;
            }
            projectDiv.textContent = `📂 ${projectText}`;
            projectDiv.style.cssText = `
                 font-size: 11px;
                 color: var(--b3-theme-on-surface-light);
                 margin-top: 4px;
                 display: flex;
                 align-items: center;
                 gap: 4px;
                 opacity: 0.8;
             `;
        }

        // 创建时间信息（单独一行）
        let dateDiv: HTMLElement | null = null;
        if (task.date) {
            dateDiv = document.createElement('div');
            dateDiv.className = 'task-date-info';
            dateDiv.style.cssText = `
                 margin-top: 4px;
                 font-size: 11px;
                 display: flex;
                 align-items: center;
                 flex-wrap: wrap;
                 gap: 6px;
                 color: var(--b3-theme-on-surface-light);
            `;

            const dateSpan = document.createElement('span');
            dateSpan.className = 'task-date';
            dateSpan.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 4px;
            `;

            // 获取当前年份
            const currentYear = new Date().getFullYear();

            // 辅助函数：格式化日期显示
            const formatDateWithYear = (dateStr: string): string => {
                const date = new Date(dateStr);
                const year = date.getFullYear();
                return year !== currentYear
                    ? date.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'short', day: 'numeric' })
                    : date.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
            };

            // 辅助函数：计算过期天数
            const getExpiredDays = (targetDate: string): number => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const taskDate = new Date(targetDate);
                taskDate.setHours(0, 0, 0, 0);
                const diffTime = today.getTime() - taskDate.getTime();
                return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            };

            // 辅助函数：创建过期徽章
            const createExpiredBadge = (days: number): string => {
                return `<span class="countdown-badge countdown-normal" style="background-color: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3); font-size: 11px; padding: 2px 6px; border-radius: 10px; font-weight: 500; margin-left: 4px; display: inline-block;">已过期${days}天</span>`;
            };

            // 添加周期图标
            if (task.extendedProps?.repeat?.enabled || task.extendedProps?.isRepeatInstance) {
                const repeatIcon = document.createElement('span');
                repeatIcon.textContent = '🔄';
                repeatIcon.title = task.extendedProps?.repeat?.enabled ? getRepeatDescription(task.extendedProps.repeat) : '周期事件实例';
                repeatIcon.style.cssText = 'cursor: help;';
                dateSpan.appendChild(repeatIcon);
            }

            // 日期显示逻辑
            let dateText = '';
            if (task.endDate && task.endDate !== task.date) {
                // 检查结束日期是否过期
                if (task.endDate < getLogicalDateString()) {
                    const daysDiff = getExpiredDays(task.endDate);
                    const formattedEndDate = formatDateWithYear(task.endDate);
                    dateText = `${formatDateWithYear(task.date)} ~ ${formattedEndDate} ${createExpiredBadge(daysDiff)}`;
                } else {
                    dateText = `${formatDateWithYear(task.date)} ~ ${formatDateWithYear(task.endDate)}`;
                }
            } else {
                // 检查开始日期是否过期
                if (task.date < getLogicalDateString()) {
                    const daysDiff = getExpiredDays(task.date);
                    const formattedDate = formatDateWithYear(task.date);
                    dateText = `${formattedDate} ${createExpiredBadge(daysDiff)}`;
                } else {
                    dateText = formatDateWithYear(task.date);
                }
            }

            // 农历显示
            if (task.extendedProps?.repeat?.enabled &&
                (task.extendedProps.repeat.type === 'lunar-monthly' || task.extendedProps.repeat.type === 'lunar-yearly')) {
                try {
                    const lunarStr = getSolarDateLunarString(task.date);
                    if (lunarStr) {
                        dateText = `${dateText} (${lunarStr})`;
                    }
                } catch (error) {
                    console.error('Failed to format lunar date:', error);
                }
            }

            const dateTextSpan = document.createElement('span');
            dateTextSpan.innerHTML = `📅 ${dateText}`;
            dateSpan.appendChild(dateTextSpan);
            dateDiv.appendChild(dateSpan);

            // Time
            if (task.time) {
                const timeSpan = document.createElement('span');
                timeSpan.className = 'task-time';
                timeSpan.textContent = `🕐 ${task.time}`;
                dateDiv.appendChild(timeSpan);
            }
        }

        // 创建任务元数据
        const taskMeta = document.createElement('div');
        taskMeta.className = 'task-meta';

        // 显示优先级标签（参考项目看板样式）
        if (task.priority && task.priority !== 'none') {
            const priorityEl = document.createElement('span');
            priorityEl.className = `task-priority-label priority-label-${task.priority}`;

            const priorityNames: Record<string, string> = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };

            priorityEl.innerHTML = `<span class="priority-dot ${task.priority}"></span><span>${priorityNames[task.priority]}</span>`;
            taskMeta.appendChild(priorityEl);
        }

        // 显示看板状态（仅当任务未完成且不是子任务时显示）
        if (!task.completed && level === 0) {
            const kanbanStatus = task.extendedProps?.kanbanStatus || 'short_term';

            // 根据kanbanStatus确定状态配置
            const statusConfig: { [key: string]: { icon: string; label: string; color: string } } = {
                'doing': { icon: '⏳', label: '进行中', color: '#f39c12' },
                'short_term': { icon: '📋', label: '短期', color: '#3498db' },
                'long_term': { icon: '🤔', label: '长期', color: '#9b59b6' }
            };
            const statusInfo = statusConfig[kanbanStatus] || { icon: '📋', label: '短期', color: '#3498db' };

            const statusSpan = document.createElement('span');
            statusSpan.className = 'task-kanban-status';
            statusSpan.textContent = `${statusInfo.icon} ${statusInfo.label}`;
            statusSpan.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 500;
                background-color: ${statusInfo.color}20;
                color: ${statusInfo.color};
                border: 1px solid ${statusInfo.color}40;
            `;
            taskMeta.appendChild(statusSpan);
        }



        // 如果任务已完成，显示完成时间（从 extendedProps.completedTime 中读取）
        if (task.completed) {
            const completedTimeStr = task.extendedProps?.completedTime || '';
            if (completedTimeStr) {
                const completedSpan = document.createElement('span');
                completedSpan.className = 'task-completed-time';
                completedSpan.textContent = `✅ ${this.formatCompletedTime(completedTimeStr)}`;
                completedSpan.title = this.formatCompletedTime(completedTimeStr);
                taskMeta.appendChild(completedSpan);
            }
        }

        // 番茄钟数量 + 总专注时长
        if ((task.pomodoroCount && task.pomodoroCount > 0) || (typeof task.focusTime === 'number' && task.focusTime > 0)) {
            const pomodoroSpan = document.createElement('span');
            pomodoroSpan.className = 'task-pomodoro-count';
            const focusMinutes = task.focusTime || 0;
            const formatMinutesToString = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            };
            const focusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusMinutes)}` : '';
            pomodoroSpan.textContent = `🍅 ${task.pomodoroCount || 0}${focusText}`;
            pomodoroSpan.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 11px;
                background-color: rgba(255, 99, 71, 0.1);
                color: #ff6347;
            `;
            taskMeta.appendChild(pomodoroSpan);
        }

        // 组装元素
        taskInfo.appendChild(taskTitle);

        if (projectDiv) {
            taskInfo.appendChild(projectDiv);
        }

        if (dateDiv) {
            taskInfo.appendChild(dateDiv);
        }
        // 备注 (调整位置到标题后)
        if (task.note) {
            const noteDiv = document.createElement('div');
            noteDiv.className = 'task-note';

            // 渲染 HTML
            if (this.lute) {
                noteDiv.innerHTML = this.lute.Md2HTML(task.note);
                // 移除 p 标签的外边距以保持紧凑
                const pTags = noteDiv.querySelectorAll('p');
                pTags.forEach(p => {
                    p.style.margin = '0';
                    p.style.lineHeight = 'inherit';
                });
                // 处理列表样式
                const listTags = noteDiv.querySelectorAll('ul, ol');
                listTags.forEach(list => {
                    (list as HTMLElement).style.margin = '0';
                    (list as HTMLElement).style.paddingLeft = '20px';
                });

                const quoteTags = noteDiv.querySelectorAll('blockquote');
                quoteTags.forEach(quote => {
                    (quote as HTMLElement).style.margin = '0';
                    (quote as HTMLElement).style.paddingLeft = '10px';
                    (quote as HTMLElement).style.borderLeft = '2px solid var(--b3-theme-on-surface-light)';
                    (quote as HTMLElement).style.opacity = '0.8';
                });
            } else {
                noteDiv.textContent = task.note;
            }

            noteDiv.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
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
                transition: background-color 0.2s;
            `;



            // 点击编辑
            noteDiv.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();

                new QuickReminderDialog(
                    undefined, undefined, undefined, undefined,
                    {
                        plugin: this.plugin,
                        mode: 'note',
                        reminder: task,
                        onSaved: async (_) => {
                            // 刷新
                            // EisenhowerMatrixView 似乎没有直接的 loadReminders，而是 loadTasks
                            // 并且有 reminderUpdatedHandler
                            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
                            await this.loadTasks(); // 重新加载任务
                            this.renderMatrix(); // 重新渲染
                        }
                    }
                ).show();
            });

            taskInfo.appendChild(noteDiv);
        }
        taskInfo.appendChild(taskMeta);

        // 使用flex布局包含控制按钮、复选框和任务信息
        const taskInnerContent = document.createElement('div');
        taskInnerContent.className = 'task-inner-content';
        taskInnerContent.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 8px;
            width: 100%;
        `;

        taskInnerContent.appendChild(taskControlContainer);
        taskInnerContent.appendChild(checkboxContainer);
        taskInnerContent.appendChild(taskInfo);

        taskContent.appendChild(taskInnerContent);
        taskEl.appendChild(taskContent);

        // 如果有子任务且为父任务，添加进度条容器（显示在任务元素底部）
        if (childTasks.length > 0) {
            const progressContainer = document.createElement('div');
            progressContainer.className = 'task-progress-container';
            // ensure the progress bar fills vertically and the percent text sits to the right
            progressContainer.style.cssText = `display:flex; align-items:stretch; gap:8px; justify-content:space-between;`;

            const progressWrap = document.createElement('div');
            // make sure the wrapper enforces the desired height so the inner bar can expand
            progressWrap.style.cssText = `flex:1; min-width:0;  display:flex; align-items:center;`;

            const progressBar = document.createElement('div');
            progressBar.className = 'task-progress';
            const percent = this.calculateChildCompletionPercent(task.id);
            progressBar.style.width = `${percent}%`;
            progressBar.setAttribute('data-progress', String(percent));
            // ensure bar takes full height of wrapper
            progressBar.style.cssText = `height:8px; width:${percent}%; display:block; border-radius:6px; background:linear-gradient(90deg, #2ecc71, #27ae60); transition:width 300ms ease-in-out;`;

            progressWrap.appendChild(progressBar);

            const percentText = document.createElement('span');
            percentText.className = 'task-progress-percent';
            percentText.textContent = `${percent}%`;
            percentText.title = `${percent}% 完成`;

            progressContainer.appendChild(progressWrap);
            progressContainer.appendChild(percentText);
            taskEl.appendChild(progressContainer);
        }

        // 添加事件监听
        taskEl.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT' && !task.blockId) {
                this.handleTaskClick(task);
            }
        });

        taskEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTaskContextMenu(task, e as MouseEvent);
        });

        checkbox.addEventListener('change', (e) => {
            this.toggleTaskCompletion(task, (e.target as HTMLInputElement).checked);
        });

        // 任务元素拖拽事件 - 整个 quick_item 可拖拽
        taskEl.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer!.setData('text/plain', task.id);
            e.dataTransfer!.setData('task/project-id', task.projectId || 'no-project');
            e.dataTransfer!.setData('task/priority', task.priority || 'none');
            taskEl.classList.add('dragging');
            taskEl.style.cursor = 'grabbing';
            this.isDragging = true;
            this.draggedTaskId = task.id;
        });

        taskEl.addEventListener('dragend', (e) => {
            e.stopPropagation();
            taskEl.classList.remove('dragging');
            taskEl.style.cursor = 'pointer';
            this.hideDropIndicators();
            this.isDragging = false;
            this.draggedTaskId = null;
        });

        // 添加拖放排序支持 - 支持跨优先级排序
        taskEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // 检查是否有拖拽操作进行中
            if (!this.isDragging || !this.draggedTaskId) {
                return;
            }

            // 使用内部状态而不是依赖 dataTransfer
            const draggedTaskId = this.draggedTaskId;

            if (draggedTaskId && draggedTaskId !== task.id) {
                // 找到被拖拽的任务
                const draggedTask = this.filteredTasks.find(t => t.id === draggedTaskId);
                if (!draggedTask) {
                    return;
                }

                const draggedProjectId = draggedTask.projectId || 'no-project';
                const draggedPriority = draggedTask.priority || 'none';
                const currentProjectId = task.projectId || 'no-project';
                const currentPriority = task.priority || 'none';

                // 只允许在同一项目内排序（支持跨优先级）
                if (draggedProjectId === currentProjectId) {
                    this.showDropIndicator(taskEl, e);
                    taskEl.classList.add('drag-over');

                    // 跨优先级拖拽时添加视觉提示
                    if (draggedPriority !== currentPriority) {
                        taskEl.classList.add(`priority-drop-${currentPriority}`);
                        // 添加提示文字
                        const indicator = taskEl.querySelector('.drop-indicator');
                        if (indicator) {
                            (indicator as HTMLElement).style.backgroundColor = this.getPriorityColor(currentPriority);
                        }
                    }
                }
            }
        });

        taskEl.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            this.hideDropIndicators();
            taskEl.classList.remove('drag-over', 'priority-drop-high', 'priority-drop-medium', 'priority-drop-low', 'priority-drop-none');
        });

        taskEl.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (!this.isDragging || !this.draggedTaskId) {
                this.hideDropIndicators();
                taskEl.classList.remove('drag-over');
                return;
            }

            const draggedTaskId = this.draggedTaskId;

            if (draggedTaskId && draggedTaskId !== task.id) {
                // 找到被拖拽的任务
                const draggedTask = this.filteredTasks.find(t => t.id === draggedTaskId);
                if (draggedTask) {
                    const draggedProjectId = draggedTask.projectId || 'no-project';
                    const currentProjectId = task.projectId || 'no-project';

                    // 只允许在同一项目内排序（支持跨优先级）
                    if (draggedProjectId === currentProjectId) {
                        this.handleTaskReorder(draggedTaskId, task.id, e);
                    }
                }
            }
            this.hideDropIndicators();
            taskEl.classList.remove('drag-over', 'priority-drop-high', 'priority-drop-medium', 'priority-drop-low', 'priority-drop-none');
        });

        return taskEl;
    }

    /**
     * 获取优先级对应的颜色
     */
    private getPriorityColor(priority: string): string {
        const colors: Record<string, string> = {
            'high': '#e74c3c',
            'medium': '#f39c12',
            'low': '#3498db',
            'none': '#95a5a6'
        };
        return colors[priority] || colors['none'];
    }

    private setupEventListeners() {
        // 拖拽放置区域
        const dropZones = this.container.querySelectorAll('[data-drop-zone="true"]');
        dropZones.forEach(zone => {
            zone.addEventListener('dragover', (e) => {
                e.preventDefault();
                zone.classList.add('drag-over');
            });

            zone.addEventListener('dragleave', () => {
                zone.classList.remove('drag-over');
            });

            zone.addEventListener('drop', async (e) => {
                e.preventDefault();
                zone.classList.remove('drag-over');

                const taskId = (e as DragEvent).dataTransfer!.getData('text/plain');
                const quadrantKey = zone.getAttribute('data-quadrant-content');

                if (taskId && quadrantKey) {
                    await this.moveTaskToQuadrant(taskId, quadrantKey as QuadrantTask['quadrant']);
                }
            });
        });

        // 新建任务按钮（象限内的）
        const newTaskButtons = this.container.querySelectorAll('.add-task-btn');
        newTaskButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quadrant = btn.getAttribute('data-quadrant');
                this.showCreateTaskDialog(quadrant as QuadrantTask['quadrant']);
            });
        });

        // 顶部新建任务按钮（通用的）
        const topNewTaskBtn = this.container.querySelector('.new-task-btn');
        if (topNewTaskBtn) {
            topNewTaskBtn.addEventListener('click', () => {
                this.showCreateGeneralTaskDialog();
            });
        }

        // 看板状态筛选按钮
        const kanbanStatusFilterBtn = this.container.querySelector('.kanban-status-filter-btn');
        if (kanbanStatusFilterBtn) {
            kanbanStatusFilterBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showKanbanStatusFilterDropdown(kanbanStatusFilterBtn as HTMLElement);
            });
        }

        // 筛选按钮
        const filterBtn = this.container.querySelector('.filter-btn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => {
                this.showFilterDialog();
            });
        }

        // 设置按钮
        const settingsBtn = this.container.querySelector('.settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.showSettingsDialog();
            });
        }

        // 项目排序按钮
        const sortProjectsBtn = this.container.querySelector('.sort-projects-btn');
        if (sortProjectsBtn) {
            sortProjectsBtn.addEventListener('click', () => {
                this.showProjectSortDialog();
            });
        }

        // 刷新按钮
        const refreshBtn = this.container.querySelector('.refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refresh(true);
            });
        }

        // 监听任务更新事件
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
    }

    private async moveTaskToQuadrant(taskId: string, newQuadrant: QuadrantTask['quadrant']) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            // 处理重复任务实例的情况
            const isInstance = taskId.includes('_') && !reminderData[taskId];
            const originalId = isInstance ? taskId.substring(0, taskId.lastIndexOf('_')) : taskId;

            if (reminderData[originalId]) {
                // 更新当前任务的象限
                reminderData[originalId].quadrant = newQuadrant;

                // 递归更新所有子任务的象限
                const updateChildrenQuadrant = (parentId: string) => {
                    Object.values(reminderData).forEach((reminder: any) => {
                        if (reminder && reminder.parentId === parentId) {
                            reminder.quadrant = newQuadrant;
                            // 递归更新孙子任务
                            updateChildrenQuadrant(reminder.id);
                        }
                    });
                };

                updateChildrenQuadrant(originalId);
                await saveReminders(this.plugin, reminderData);

                await this.refresh();
                showMessage(i18n('taskMovedToQuadrant').replace('${quadrant}', this.getQuadrantDisplayName(newQuadrant)));
            }
        } catch (error) {
            console.error('移动任务失败:', error);
            showMessage(i18n('moveTaskFailed'));
        }
    }

    private getQuadrantDisplayName(quadrant: QuadrantTask['quadrant']): string {
        const quadrantInfo = this.quadrants.find(q => q.key === quadrant);
        return quadrantInfo ? quadrantInfo.title : quadrant;
    }






    private async toggleTaskCompletion(task: QuadrantTask, completed: boolean) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (task.isRepeatInstance && task.originalId) {
                // 对于重复实例，使用不同的完成逻辑
                await this.toggleRepeatInstanceCompletion(task, completed);
            } else if (reminderData[task.id]) {
                // 对于普通任务，使用原有逻辑
                reminderData[task.id].completed = completed;

                // 如果是完成任务，记录完成时间并自动完成所有子任务
                if (completed) {
                    reminderData[task.id].completedTime = getLocalDateTimeString(new Date());
                    await this.completeAllChildTasks(task.id, reminderData);
                } else {
                    delete reminderData[task.id].completedTime;
                }

                await saveReminders(this.plugin, reminderData);

                // 更新本地缓存 this.allTasks 中对应任务的状态
                const localTask = this.allTasks.find(t => t.id === task.id);
                if (localTask) {
                    localTask.completed = completed;
                    if (completed) {
                        localTask.extendedProps = localTask.extendedProps || {};
                        localTask.extendedProps.completedTime = reminderData[task.id].completedTime;
                    } else {
                        if (localTask.extendedProps) delete localTask.extendedProps.completedTime;
                    }
                }

                // 如果该任务是子任务，局部更新父任务的进度UI；如果是父任务并自动完成了子任务，则更新对应子任务所在父的进度
                if (task.parentId) {
                    this.updateParentProgressUI(task.parentId);
                } else {
                    // 如果父任务自身被完成并触发对子任务的自动完成，更新所有被影响父级（本任务可能有父级）
                    // 更新自身所在父级（如果有）
                    if ((task as any).parentId) {
                        this.updateParentProgressUI((task as any).parentId);
                    }
                }

                // 广播更新事件以便其他组件和自身刷新视图（例如在“进行中任务”筛选下，已完成的任务会被移除）
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
            }
        } catch (error) {
            console.error('更新任务状态失败:', error);
            showMessage(i18n('updateTaskStatusFailed'));
        }
    }

    /**
     * 切换重复实例的完成状态
     * @param task 重复实例任务
     * @param completed 是否完成
     */
    private async toggleRepeatInstanceCompletion(task: QuadrantTask, completed: boolean) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[task.originalId!];

            if (!originalReminder) {
                showMessage(i18n('originalRepeatEventNotExist'));
                return;
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

                // [NEW] 递归完成该实例下的所有子任务实例
                await this.completeAllChildInstances(task.originalId!, instanceDate, reminderData);
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

            // 更新本地缓存
            const localTask = this.allTasks.find(t => t.id === task.id);
            if (localTask) {
                localTask.completed = completed;
                if (completed) {
                    localTask.extendedProps = localTask.extendedProps || {};
                    localTask.extendedProps.completedTime = originalReminder.repeat.instanceCompletedTimes?.[instanceDate];
                } else {
                    if (localTask.extendedProps) delete localTask.extendedProps.completedTime;
                }
            }

            // 广播更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
        } catch (error) {
            console.error('切换重复实例完成状态失败:', error);
            showMessage(i18n('operationFailed'));
        }
    }

    /**
     * 局部更新父任务的进度条和百分比文本
     * @param parentId 父任务ID
     */
    private updateParentProgressUI(parentId: string) {
        try {
            const percent = this.calculateChildCompletionPercent(parentId);

            // 找到父任务元素
            const parentEl = this.container.querySelector(`[data-task-id="${parentId}"]`) as HTMLElement | null;
            if (!parentEl) return;

            const progressBar = parentEl.querySelector('.task-progress') as HTMLElement | null;
            const percentText = parentEl.querySelector('.task-progress-percent') as HTMLElement | null;

            if (progressBar) {
                progressBar.style.width = `${percent}%`;
                progressBar.setAttribute('data-progress', String(percent));
            }

            if (percentText) {
                percentText.textContent = `${percent}%`;
                percentText.title = `${percent}% 完成`;
            }
        } catch (error) {
            console.error('更新父任务进度UI失败:', error);
        }
    }

    private formatCompletedTime(completedTime: string): string {
        try {
            const d = new Date(completedTime);
            if (isNaN(d.getTime())) return completedTime;
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const hh = String(d.getHours()).padStart(2, '0');
            const mi = String(d.getMinutes()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
        } catch (error) {
            return completedTime;
        }
    }

    /**
     * 递归完成子任务的特定日期实例
     * @param parentId 父任务ID (原始 ID)
     * @param date 实例日期
     * @param reminderData 任务数据
     */
    private async completeAllChildInstances(parentId: string, date: string, reminderData: any): Promise<void> {
        // 1. 处理 Ghost 子任务 (基于 originalId 的后代)
        const ghostChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === parentId);

        for (const child of ghostChildren) {
            // [FIX] 无论子任务是否自身开启了重复，只要它是重复父任务的后代，
            // 我们就应该在 completedInstances 中记录该日期的完成状态
            if (!child.repeat) {
                child.repeat = {};
            }
            if (!child.repeat.completedInstances) {
                child.repeat.completedInstances = [];
            }

            if (!child.repeat.completedInstances.includes(date)) {
                child.repeat.completedInstances.push(date);

                // 记录完成时间
                if (!child.repeat.instanceCompletedTimes) {
                    child.repeat.instanceCompletedTimes = {};
                }
                child.repeat.instanceCompletedTimes[date] = getLocalDateTimeString(new Date());
            }

            // 递归处理孙子实例
            await this.completeAllChildInstances(child.id, date, reminderData);
        }

        // 2. 处理普通子任务 (直接绑定到 instanceId 的后代)
        // 这些是该特定实例下创建的非重复子任务，它们的 parentId 是 parentId_date
        const instanceId = `${parentId}_${date}`;
        await this.completeAllChildTasks(instanceId, reminderData);
    }

    /**
     * 当父任务完成时，自动完成所有子任务
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     */
    private async completeAllChildTasks(parentId: string, reminderData: any): Promise<void> {
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
                }
            }

            if (completedCount > 0) {
                console.log(`父任务 ${parentId} 完成时，自动完成了 ${completedCount} 个子任务`);
                showMessage(i18n('autoCompleteSubtasks').replace('${count}', completedCount.toString()), 2000);
            }
        } catch (error) {
            console.error('自动完成子任务失败:', error);
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

            // Normalize reminderData into an iterable array of tasks
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
                    getChildren(task.id); // deep recursion
                }
            }
        };

        getChildren(parentId);
        return result;
    }

    /**
     * 计算指定父任务的子任务完成百分比（已完成子任务数 / 子任务总数 * 100）
     * @param parentId 父任务ID
     */
    private calculateChildCompletionPercent(parentId: string): number {
        try {
            const childTasks = this.allTasks.filter(t => t.parentId === parentId);
            if (childTasks.length === 0) return 0;
            const completedCount = childTasks.filter(t => t.completed).length;
            const percent = Math.round((completedCount / childTasks.length) * 100);
            return Math.min(100, Math.max(0, percent));
        } catch (error) {
            console.error('计算子任务完成百分比失败:', error);
            return 0;
        }
    }

    private async openTaskBlock(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开思源笔记块失败:', error);
            confirm(
                '打开笔记失败',
                '笔记块可能已被删除，是否删除相关的任务记录？',
                async () => {
                    await this.deleteTaskByBlockId(blockId);
                },
                () => {
                    showMessage(i18n('openNoteFailed'));
                }
            );
        }
    }

    private async deleteTaskByBlockId(blockId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            let taskFound = false;

            for (const [taskId, reminder] of Object.entries(reminderData as any)) {
                if (reminder && typeof reminder === 'object' && (reminder as any).blockId === blockId) {
                    delete reminderData[taskId];
                    taskFound = true;
                }
            }

            if (taskFound) {
                await saveReminders(this.plugin, reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
                showMessage(i18n('reminderDeleted'));
                await this.refresh();
            } else {
                showMessage(i18n('reminderNotExist'));
            }
        } catch (error) {
            console.error('删除任务记录失败:', error);
            showMessage(i18n('deleteReminderFailed'));
        }
    }

    private handleTaskClick(task: QuadrantTask) {
        // 如果任务有绑定块，直接打开
        if (task.blockId) {
            this.openTaskBlock(task.blockId);
            return;
        }

        // 如果没有绑定块，显示右键菜单提供选项
        this.showTaskFallbackMenu(task);
    }

    private showTaskFallbackMenu(task: QuadrantTask) {
        // 创建右键菜单
        const menu = new Menu();

        menu.addItem({
            label: i18n('editTask'),
            iconHTML: '📝',
            click: () => {
                this.showTaskEditDialog(task);
            }
        });

        menu.addSeparator();

        // 项目分配选项
        if (task.projectId) {
            menu.addItem({
                label: i18n('openProjectKanban'),
                icon: 'iconProject',
                click: () => {
                    this.openProjectKanban(task.projectId!);
                }
            });
        } else {
            menu.addItem({
                label: i18n('addToProject'),
                icon: 'iconProject',
                click: () => {
                    this.assignTaskToProject(task);
                }
            });
        }

        menu.open({ x: 0, y: 0 });
    }

    private async showTaskEditDialog(task: QuadrantTask) {
        // 如果是重复事件实例，需要加载原始任务数据
        let taskData = task.extendedProps;

        if (task.isRepeatInstance && task.originalId) {
            try {
                const reminderData = await getAllReminders(this.plugin);
                const originalReminder = reminderData[task.originalId];

                if (originalReminder) {
                    taskData = originalReminder;
                } else {
                    showMessage(i18n('originalRepeatTaskNotFound'));
                    return;
                }
                if (task.isSubscribed) {
                    showMessage(i18n('subscribedTaskReadonly'));
                    return;
                }
            } catch (error) {
                console.error('加载原始任务失败:', error);
                showMessage(i18n('loadTaskDataFailed'));
                return;
            }
        }

        const editDialog = new QuickReminderDialog(
            undefined,
            undefined,
            async () => {
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
            },
            undefined,
            {
                mode: 'edit',
                reminder: taskData,
                plugin: this.plugin
            }
        );

        // 添加项目选择功能到编辑对话框
        (editDialog as any).showProjectSelector = () => {
            this.showProjectSelectorForTask(task);
        };

        editDialog.show();
    }

    private showProjectSelectorForTask(task: QuadrantTask) {
        const groupedProjects = this.projectManager.getProjectsGroupedByStatus();
        const activeProjects = groupedProjects['active'] || [];

        if (activeProjects.length === 0) {
            showMessage(i18n('noActiveProjects'));
            return;
        }

        const menu = new Menu();

        // 当前项目显示
        if (task.projectId) {
            const currentProject = this.projectManager.getProjectById(task.projectId);
            menu.addItem({
                label: `${i18n('current')}: ${currentProject?.name || i18n('noProject')}`,
                disabled: true
            });
            menu.addSeparator();
        }

        // 无项目选项
        menu.addItem({
            label: i18n('noProject'),
            icon: task.projectId ? 'iconRemove' : 'iconCheck',
            click: async () => {
                await this.updateTaskProject(task.id, null);
                showMessage(i18n('projectUpdated'));
            }
        });

        // 分隔线
        menu.addSeparator();

        // 列出所有活跃项目
        activeProjects.forEach(project => {
            const isCurrent = task.projectId === project.id;
            menu.addItem({
                label: project.name,
                icon: isCurrent ? 'iconCheck' : undefined,
                click: async () => {
                    if (!isCurrent) {
                        await this.updateTaskProject(task.id, project.id);
                        showMessage(i18n('projectUpdated'));
                    }
                }
            });
        });

        // 新建项目选项
        menu.addSeparator();
        menu.addItem({
            label: i18n('createNewDocument'),
            icon: 'iconAdd',
            click: async () => {
                const projectName = prompt(i18n('pleaseEnterProjectName'));
                if (projectName) {
                    // 注意：这里需要根据实际的 ProjectManager API 调整
                    // const project = await this.projectManager.createProject(projectName);
                    showMessage(i18n('featureNotImplemented'));
                    return;
                }
            }
        });

        menu.open({ x: 0, y: 0 });
    }

    private openProjectKanban(projectId: string) {
        try {
            // 使用openProjectKanbanTab打开项目看板
            const project = this.projectManager.getProjectById(projectId);
            if (!project) {
                showMessage(i18n('projectNotExist'));
                return;
            }

            this.plugin.openProjectKanbanTab(project.id, project.name);
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage(i18n('openProjectKanbanFailed'));
        }
    }



    private addStyles() {
        if (document.querySelector('#eisenhower-matrix-styles')) return;

        const style = document.createElement('style');
        style.id = 'eisenhower-matrix-styles';
        style.textContent = `
            .eisenhower-matrix-view {
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
                color: var(--b3-theme-on-background);
                overflow: hidden;
                width: 100%;
                /* 启用容器查询 */
                container-type: inline-size;
                container-name: matrix-view;
            }

            .matrix-header {
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                padding: 8px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-background);
                flex-shrink: 0;
                align-items: center;
            }


            .matrix-header-buttons {
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
                margin-left: auto;
            }

            .new-task-btn {
                font-weight: 600;
                background-color: var(--b3-theme-primary);
                color: var(--b3-theme-on-primary) !important;
                border-color: var(--b3-theme-primary);
            }



            .refresh-btn,
            .switch-to-calendar-btn {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                font-size: 12px;
            }

            .matrix-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                grid-auto-rows: minmax(250px, auto);
                gap: 8px;
                flex: 1;
                padding: 8px;
                overflow-y: auto;
                min-height: 0;
            }

            /* 容器查询：当容器宽度 < 768px 时，使用横向滚动布局 */
            @container matrix-view (max-width: 767px) {
                .matrix-grid {
                    display: flex;
                    flex-direction: row;
                    flex-wrap: nowrap;
                    overflow-x: auto;
                    overflow-y: hidden;
                    gap: 12px;
                    padding: 8px;
                    scroll-snap-type: x mandatory;
                    -webkit-overflow-scrolling: touch;
                }
                
                .matrix-grid .quadrant {
                    flex: 0 0 auto;
                    width: calc(100% - 32px);
                    min-width: 280px;
                    max-width: 360px;
                    min-height: calc(100% - 16px);
                    scroll-snap-align: start;
                }
            }

            .quadrant {
                background: var(--b3-theme-background);
                border: 3px solid;
                border-radius: 8px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: relative;
                min-height: 250px;
            }

            .quadrant-important-urgent {
                border-color: #e74c3c;
            }

            .quadrant-important-not-urgent {
                border-color: #3498db;
            }

            .quadrant-not-important-urgent {
                border-color: #f39c12;
            }

            .quadrant-not-important-not-urgent {
                border-color: #95a5a6;
            }

            .quadrant-header {
                padding: 0px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                flex-shrink: 0;
                border-bottom: 1px solid var(--b3-theme-border);
            }

            .quadrant-title {
                font-size: 14px;
                font-weight: 600;
                margin: 0;
            }

            .add-task-btn {
                padding: 4px 8px !important;
                font-size: 12px !important;
                align-self: center;
                color: white !important;
                border-color: rgba(255, 255, 255, 0.3) !important;
            }
            
            .add-task-btn:hover {
                background-color: rgba(255, 255, 255, 0.1) !important;
                color: white !important;
            }

            .quadrant-content {
                flex: 1;
                padding: 8px;
                overflow-y: auto;
                min-height: 0;
            }

            /* 窄屏时确保内容区域可以滚动 */
            @container matrix-view (max-width: 767px) {
                .quadrant-content {
                    max-height: none;
                }
            }

            .quadrant-content[data-drop-zone="true"] {
                transition: background-color 0.2s;
            }

            .quadrant-content.drag-over {
                background-color: var(--b3-theme-primary-lightest) !important;
            }

            .empty-quadrant {
                text-align: center;
                color: var(--b3-theme-on-surface-light);
                font-style: italic;
                padding: 40px 20px;
            }

            .project-group {
                margin-bottom: 16px;
            }

            .eisenhower-matrix-view .project-header {
                font-weight: 600;
                font-size: 14px;
                color: var(--b3-theme-primary);
                margin-bottom: 8px;
                padding: 4px 8px;
                border-radius: 4px;
            }

            .task-item {
                background: var(--b3-theme-background);
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                margin-bottom: 4px;
                padding: 8px;
                cursor: pointer;
                transition: all 0.2s;
                user-select: none;
            }

            .task-item:hover {
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                transform: translateY(-1px);
            }

            .task-item.dragging {
                opacity: 0.5;
                transform: rotate(5deg);
            }

            .task-item.completed {
                opacity: 0.6;
            }

            .task-item.completed .task-title {
                text-decoration: line-through;
            }
            .quick_item{
                margin-top: 2px;
                border-radius: 4px;
            }
            .task-content {
                display: flex;
                align-items: flex-start;
                gap: 8px;
            }

            .task-checkbox {
                margin-top: 2px;
            }

            .task-info {
                flex: 1;
                min-width: 0;
            }

            .task-title {
                font-size: 14px;
                margin-bottom: 4px;
                word-break: break-word;
                width: fit-content;
            }

            .task-meta {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
            }

            .task-date, .task-time {
                display: flex;
                align-items: center;
                gap: 2px;
            }

            /* 容器查询：窄容器时的紧凑样式 */
            @container matrix-view (max-width: 767px) {
                .quadrant-header {
                    padding: 6px 10px;
                }

                .quadrant-title {
                    font-size: 13px;
                }

                .add-task-btn {
                    padding: 2px 6px !important;
                    font-size: 11px !important;
                }

                /* 滚动条美化 */
                .matrix-grid::-webkit-scrollbar {
                    height: 6px;
                }
                
                .matrix-grid::-webkit-scrollbar-track {
                    background: var(--b3-theme-surface-lighter);
                    border-radius: 3px;
                }
                
                .matrix-grid::-webkit-scrollbar-thumb {
                    background: var(--b3-theme-primary-lighter);
                    border-radius: 3px;
                }
                
                .matrix-grid::-webkit-scrollbar-thumb:hover {
                    background: var(--b3-theme-primary);
                }

                /* 象限阴影效果 */
                .matrix-grid .quadrant {
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
                }
            }
            
            /* 筛选对话框样式 */
            .filter-dialog .filter-section {
                margin-bottom: 20px;
            }
            
            .filter-dialog .filter-section h3 {
                margin: 0 0 10px 0;
                font-size: 14px;
                font-weight: 600;
                color: var(--b3-theme-on-surface);
            }
            
            .filter-checkboxes {
                max-height: 300px;
                overflow-y: auto;
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                padding: 8px;
            }
            
            .filter-checkbox-container {
                display: flex;
                align-items: center;
                padding: 4px 0;
                cursor: pointer;
            }
            
            .filter-checkbox-container input[type="checkbox"] {
                margin-right: 8px;
            }
            
            .filter-checkbox-container span {
                font-size: 13px;
                color: var(--b3-theme-on-surface);
            }
            
            .filter-group-label {
                font-weight: 600;
                color: var(--b3-theme-primary);
                margin: 8px 0 4px 0;
                font-size: 12px;
                border-bottom: 1px solid var(--b3-theme-border);
                padding-bottom: 2px;
            }
            
            .filter-group-label:first-child {
                margin-top: 0;
            }

            /* 拖拽排序指示器样式 */
            .drop-indicator {
                position: absolute !important;
                left: 0 !important;
                right: 0 !important;
                height: 2px !important;
                background-color: var(--b3-theme-primary) !important;
                z-index: 1000 !important;
                pointer-events: none !important;
                border-radius: 1px !important;
            }
            
            @keyframes drop-indicator-pulse {
                0% { opacity: 0.6; transform: scaleX(0.8); }
                50% { opacity: 1; transform: scaleX(1); }
                100% { opacity: 0.6; transform: scaleX(0.8); }
            }
            
            /* 跨优先级拖拽时的视觉提示 - 仅改变边框颜色 */
            .quick_item.priority-drop-high.drag-over {
                border-color: var(--b3-card-error-color) !important;
            }

            .quick_item.priority-drop-medium.drag-over {
                border-color: var(--b3-card-warning-color) !important;
            }

            .quick_item.priority-drop-low.drag-over {
                border-color: var(--b3-card-info-color) !important;
            }
            
            

            .task-collapse-btn {
                width: 14px;
                height: 14px;
                min-width: 14px;
                padding: 0;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid var(--b3-theme-border);
                border-radius: 2px;
                background: var(--b3-theme-background);
                margin-bottom: 2px;
            }
            .task-collapse-btn:hover {
                opacity: 1;
                color: var(--b3-theme-primary);
                background: var(--b3-theme-surface-lighter);
                border-color: var(--b3-theme-primary);
            }
            .task-collapse-btn .b3-button__icon {
                margin: 0;
            }
            .task-collapse-btn svg {
                height: 8px;
                width: 8px;
            }
            
            .task-control-container {
                align-self: flex-start;
                margin-top: 2px;
            }
            
            /* 优先级标签样式 - 参考项目看板 */
            .task-priority-label {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 11px;
                font-weight: 500;
                white-space: nowrap;
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

            /* 优先级任务悬停效果 */
            .task-priority-high:hover {
                box-shadow: 0 0 0 1px var(--b3-card-error-color), 0 4px 12px rgba(231, 76, 60, 0.25) !important;
            }

            .task-priority-medium:hover {
                box-shadow: 0 0 0 1px var(--b3-card-warning-color), 0 4px 12px rgba(243, 156, 18, 0.25) !important;
            }

            .task-priority-low:hover {
                box-shadow: 0 0 0 1px var(--b3-card-info-color), 0 4px 12px rgba(52, 152, 219, 0.25) !important;
            }

            /* 任务拖拽样式 */
            .quick_item {
                margin-top: 2px;
                border-radius: 4px;
                cursor: grab;
                transition: all 0.2s ease;
                position: relative;
            }

            .quick_item.dragging {
                opacity: 0.5;
                transform: rotate(2deg);
                cursor: grabbing;
            }

            .quick_item:hover {
                transform: translateY(-1px);
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }

            /* 项目标题栏样式 */
            .eisenhower-matrix-view .project-header {
                display: flex;
                align-items: center;
                font-weight: 600;
                font-size: 14px;
                margin-bottom: 8px;
                padding: 6px 10px;
                border-radius: 6px;
                background: var(--b3-theme-surface-lighter);
                border: 1.5px solid var(--b3-theme-border);
                gap: 6px;
                transition: all 0.2s ease;
            }

            .eisenhower-matrix-view .project-header:hover {
                background: var(--b3-theme-surface) !important;
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
            }

            .project-name {
                font-weight: 600;
                font-size: 14px;
                color: var(--b3-theme-primary);
                transition: color 0.2s;
                line-height: 1.4;
            }

            .project-name:hover {
                text-decoration: underline;
            }

            .project-task-count {
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
                opacity: 0.7;
                margin-left: auto;
                padding-left: 8px;
            }

            .project-collapse-btn {
                padding: 2px !important;
                min-width: 20px !important;
                min-height: 20px !important;
                width: 20px !important;
                height: 20px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                flex-shrink: 0;
                border-radius: 4px;
                border: none;
                background: transparent !important;
                color: var(--b3-theme-on-surface-light) !important;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            .project-collapse-btn:hover {
                background: var(--b3-theme-surface) !important;
                color: var(--b3-theme-primary) !important;
            }

            .project-collapse-btn svg {
                width: 12px;
                height: 12px;
                fill: currentColor;
            }

            .project-tasks-container {
                transition: all 0.2s ease;
                padding-left: 4px;
            }

            /* 父任务底部进度条 */
            .task-progress-container {
                width: 100%;
                border-radius: 6px;
                margin-top: 6px;
                overflow: hidden;
            }

            .task-progress {
                height: 100%;
                width: 0%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                border-radius: 6px;
                transition: width 300ms ease-in-out;
            }
            .task-progress-percent {
                flex-shrink: 0;
                min-width: 36px;
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
                padding-left: 6px;
            }
            .task-completed-time {
                display: inline-block;
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
                margin-left: 8px;
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
            
            /* 象限预览样式 */
            .quadrant-preview {
                transition: background-color 0.2s, color 0.2s;
                border-radius: 4px;
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            /* 新建任务对话框额外样式 */
            .reminder-dialog .b3-form__help {
                font-size: 12px;
                color: var(--b3-theme-on-surface-light);
                margin-top: 4px;
            }

            /* 下拉菜单样式 */
            .kanban-status-filter-dropdown {
                position: absolute;
                background: var(--b3-theme-surface);
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 1000;
                min-width: 160px;
                padding: 4px 0;
                overflow: hidden;
            }

            .dropdown-menu-item {
                padding: 8px 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                color: var(--b3-theme-on-surface);
                transition: background-color 0.2s;
            }

            .dropdown-menu-item:hover {
                background-color: var(--b3-theme-surface-lighter);
            }

            .dropdown-menu-item .b3-button__icon {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }
        `;
        document.head.appendChild(style);
    }

    private showTaskContextMenu(task: QuadrantTask, event: MouseEvent) {
        const menu = new Menu();

        if (task.isSubscribed) {
            menu.addItem({
                iconHTML: "ℹ️",
                label: i18n("subscribedTaskReadonly"),
                disabled: true
            });
            menu.addSeparator();

            if (task.blockId) {
                menu.addItem({
                    iconHTML: "🔗",
                    label: i18n("openBoundBlock"),
                    click: () => this.openTaskBlock(task.blockId!)
                });

                menu.addItem({
                    iconHTML: "📋",
                    label: i18n("copyBlockRef"),
                    click: () => this.copyBlockRef(task)
                });
            }

            // 番茄钟功能对订阅任务仍然可用
            menu.addItem({
                iconHTML: "🍅",
                label: i18n("startPomodoro"),
                click: () => this.startPomodoro(task)
            });

            menu.addItem({
                iconHTML: "⏱️",
                label: i18n("startCountUp"),
                click: () => this.startPomodoroCountUp(task)
            });

            menu.open({ x: event.clientX, y: event.clientY });
            return;
        }
        // 编辑任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance || task.repeat?.enabled) {
            // 周期事件（包括实例和原始事件） - 显示修改此实例和修改所有实例
            menu.addItem({
                iconHTML: "📝",
                label: i18n("modifyThisInstance"),
                click: () => this.editInstanceReminder(task)
            });
            menu.addItem({
                iconHTML: "🔄",
                label: i18n("modifyAllInstances"),
                click: () => this.showTaskEditDialog(task)
            });
        } else {
            // 普通任务
            menu.addItem({
                label: i18n('editTask'),
                iconHTML: "📝",
                click: () => this.showTaskEditDialog(task)
            });
        }
        // 创建子任务选项
        menu.addItem({
            iconHTML: "➕",
            label: i18n("createSubtask"),
            click: () => this.showCreateTaskDialog(task.quadrant, task)
        });
        menu.addSeparator();

        // 绑定块功能
        if (task.blockId) {
            menu.addItem({
                iconHTML: "🔗",
                label: i18n("openBoundBlock"),
                click: () => this.openTaskBlock(task.blockId!)
            });

            menu.addItem({
                iconHTML: "📋",
                label: i18n("copyBlockRef"),
                click: () => this.copyBlockRef(task)
            });

        } else {
            menu.addItem({
                iconHTML: "🔗",
                label: i18n("bindToBlock"),
                click: () => this.showBindToBlockDialog(task)
            });
        }
        menu.addSeparator();


        // 设置优先级子菜单
        const createPriorityMenuItems = () => {
            const priorities = [
                { key: 'high', label: i18n("highPriority"), icon: '🔴' },
                { key: 'medium', label: i18n("mediumPriority"), icon: '🟡' },
                { key: 'low', label: i18n("lowPriority"), icon: '🔵' },
                { key: 'none', label: i18n("noPriority"), icon: '⚫' }
            ];

            const currentPriority = task.priority || 'none';

            return priorities.map(priority => ({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => {
                    this.setTaskPriority(task.id, priority.key);
                }
            }));
        };

        menu.addItem({
            iconHTML: "🎯",
            label: i18n("setPriority"),
            submenu: createPriorityMenuItems()
        });

        // 设置看板状态子菜单
        const createKanbanStatusMenuItems = () => {
            // 使用固定的状态列表（doing, short_term, long_term）
            const statuses: Array<{
                key: string;
                label: string;
                icon: string;
                kanbanStatus: string;
            }> = [
                    { key: 'doing', label: i18n('doing'), icon: '⏳', kanbanStatus: 'doing' },
                    { key: 'short_term', label: i18n('shortTerm'), icon: '📋', kanbanStatus: 'short_term' },
                    { key: 'long_term', label: i18n('longTerm'), icon: '🤔', kanbanStatus: 'long_term' }
                ];

            const currentKanbanStatus = task.extendedProps?.kanbanStatus || 'short_term';

            return statuses.map(status => {
                const isCurrent = currentKanbanStatus === status.kanbanStatus;

                return {
                    iconHTML: status.icon,
                    label: status.label,
                    current: isCurrent,
                    click: () => {
                        this.setTaskStatusAndTerm(task.id, status.kanbanStatus);
                    }
                };
            });
        };

        menu.addItem({
            iconHTML: "📊",
            label: i18n("setStatus"),
            submenu: createKanbanStatusMenuItems()
        });

        menu.addSeparator();

        menu.addItem({
            iconHTML: "🍅",
            label: i18n("startPomodoro"),
            click: () => this.startPomodoro(task)
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: i18n("startStopwatch"),
            click: () => this.startPomodoroCountUp(task)
        });



        menu.addSeparator();


        // 删除任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance || task.repeat?.enabled) {
            // 周期事件（包括实例和原始事件） - 显示删除此实例和删除所有实例
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n("deleteThisInstance"),
                click: () => this.deleteInstanceOnly(task)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: i18n('deleteAllInstances'),
                click: async () => await this.deleteTask(task)
            });
        } else {
            // 普通任务
            menu.addItem({
                label: i18n('deleteTask'),
                iconHTML: "🗑️",
                click: async () => {
                    await this.deleteTask(task);
                }
            });
        }

        menu.open({ x: event.clientX, y: event.clientY });
    }

    private async assignTaskToProject(task: QuadrantTask, event?: MouseEvent) {
        try {
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();
            const allProjects = [];

            // 收集所有非归档状态的项目
            Object.keys(groupedProjects).forEach(statusKey => {
                const projects = groupedProjects[statusKey] || [];
                // 排除已归档的项目
                projects.forEach(project => {
                    const projectStatus = this.projectManager.getProjectById(project.id)?.status || 'doing';
                    if (projectStatus !== 'archived') {
                        allProjects.push(project);
                    }
                });
            });

            if (allProjects.length === 0) {
                showMessage(i18n('noActiveProjects'));
                return;
            }

            const menu = new Menu();

            // 按状态分组显示项目
            Object.keys(groupedProjects).forEach(statusKey => {
                const projects = groupedProjects[statusKey] || [];
                const nonArchivedProjects = projects.filter(project => {
                    const projectStatus = this.projectManager.getProjectById(project.id)?.status || 'doing';
                    return projectStatus !== 'archived';
                });

                if (nonArchivedProjects.length > 0) {
                    // 添加状态标题
                    menu.addItem({
                        label: this.getStatusDisplayName(statusKey),
                        disabled: true
                    });

                    nonArchivedProjects.forEach(project => {
                        menu.addItem({
                            label: project.name,
                            click: async () => {
                                await this.updateTaskProject(task.id, project.id);
                                showMessage(`${i18n('addedToProjectSuccess').replace('${count}', '1')}`);
                            }
                        });
                    });

                    menu.addSeparator();
                }
            });

            // 添加新建项目选项
            menu.addSeparator();
            menu.addItem({
                label: i18n('createNewDocument'),
                icon: 'iconAdd',
                click: () => {
                    this.createNewProjectAndAssign(task);
                }
            });

            if (event) {
                menu.open({ x: event.clientX, y: event.clientY });
            } else {
                menu.open({ x: 0, y: 0 });
            }
        } catch (error) {
            console.error('分配项目失败:', error);
            showMessage(i18n('addedToProjectFailed'));
        }
    }

    private async removeTaskFromProject(task: QuadrantTask) {
        try {
            await this.updateTaskProject(task.id, null);
            showMessage(i18n('removedFromProject'));
        } catch (error) {
            console.error('移除项目失败:', error);
            showMessage(i18n('operationFailedRetry'));
        }
    }

    private async updateTaskProject(taskId: string, projectId: string | null) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const isInstance = taskId.includes('_') && !reminderData[taskId];
            const originalId = isInstance ? taskId.substring(0, taskId.lastIndexOf('_')) : taskId;

            if (reminderData[originalId]) {
                reminderData[originalId].projectId = projectId;
                await saveReminders(this.plugin, reminderData);

                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
            }
        } catch (error) {
            console.error('更新任务项目失败:', error);
            throw error;
        }
    }

    private async setTaskPriority(taskId: string, priority: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const isInstance = taskId.includes('_') && !reminderData[taskId];
            const originalId = isInstance ? taskId.substring(0, taskId.lastIndexOf('_')) : taskId;

            if (reminderData[originalId]) {
                reminderData[originalId].priority = priority;
                await saveReminders(this.plugin, reminderData);

                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
                showMessage(i18n("priorityUpdated"));
            } else {
                showMessage(i18n("taskNotExist"));
            }
        } catch (error) {
            console.error('设置任务优先级失败:', error);
            showMessage(i18n("setPriorityFailed"));
        }
    }

    private async setTaskStatusAndTerm(taskId: string, kanbanStatus: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const isInstance = taskId.includes('_') && !reminderData[taskId];
            const originalId = isInstance ? taskId.substring(0, taskId.lastIndexOf('_')) : taskId;

            if (reminderData[originalId]) {
                reminderData[originalId].kanbanStatus = kanbanStatus;
                await saveReminders(this.plugin, reminderData);

                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
                showMessage(i18n('statusUpdated'));
            } else {
                showMessage(i18n('taskNotExist'));
            }
        } catch (error) {
            console.error('设置任务看板状态失败:', error);
            showMessage(i18n('statusSwitchFailed'));
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    private async createNewProjectAndAssign(_task: QuadrantTask) {
        try {
            const projectName = prompt(i18n('pleaseEnterProjectName'));
            if (!projectName) return;

            // 注意：这里需要根据实际的 ProjectManager API 调整
            // const project = await this.projectManager.createProject(projectName);
                    showMessage(i18n('featureNotImplemented'));
            return;
        } catch (error) {
            console.error('创建项目并分配失败:', error);
            showMessage(i18n('operationFailed'));
        }
    }

    private async deleteTask(task: QuadrantTask) {
        // 如果是重复事件实例，需要使用原始ID
        const taskToDelete = task.isRepeatInstance ?
            { ...task, id: task.originalId!, isRepeatInstance: false } : task;

        // 检查是否有子任务
        const childTasks = this.allTasks.filter(t => t.parentId === taskToDelete.id);
        const hasChildren = childTasks.length > 0;

        let title;
        let content;

        if (childTasks.length === 0) {
            title = i18n('delete');
            content = i18n('confirmDeleteTask');
        } else {
            title = i18n('deleteTaskAndSubtasks');
            content = i18n('confirmDeleteTaskWithSubtasks');
        }

        content = content
            .replace(/\${title}/g, task.title)
            .replace(/\${count}/g, childTasks.length.toString());

        confirm(
            title,
            content,
            async () => {
                try {
                    const reminderData = await getAllReminders(this.plugin);
                    if (!reminderData) {
                        console.warn('No reminder data found');
                        showMessage(i18n('reminderDataNotExist'));
                        return;
                    }

                    // 收集所有要删除的任务ID（包括子任务）
                    const taskIdsToDelete = new Set<string>();
                    taskIdsToDelete.add(taskToDelete.id);

                    // 递归收集所有子任务
                    const collectChildTasks = (parentId: string) => {
                        Object.entries(reminderData).forEach(([id, reminder]) => {
                            if (reminder && typeof reminder === 'object' && (reminder as any).parentId === parentId) {
                                taskIdsToDelete.add(id);
                                // 递归收集孙子任务
                                collectChildTasks(id);
                            }
                        });
                    };

                    collectChildTasks(taskToDelete.id);

                    // 删除所有相关任务
                    let deletedCount = 0;
                    taskIdsToDelete.forEach(taskId => {
                        if (reminderData[taskId]) {
                            delete reminderData[taskId];
                            deletedCount++;
                        }
                    });

                    if (deletedCount > 0) {
                        await saveReminders(this.plugin, reminderData);
                        await this.refresh();
                        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));

                        if (deletedCount > 1) {
                            showMessage(i18n('deletedTasksWithSubtasks').replace('${count}', deletedCount.toString()));
                        } else {
                            showMessage(i18n('reminderDeleted'));
                        }
                    } else {
                        console.warn('No tasks found to delete');
                        showMessage(i18n('taskNotExistOrDeleted'));
                    }
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage(i18n('deleteReminderFailed'));
                }
            },
            () => {
                // 取消回调
            }
        );
    }

    private showDropIndicator(element: HTMLElement, event: DragEvent) {
        this.hideDropIndicators();

        const rect = element.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';

        // 确保父元素有相对定位
        if (!element.style.position || element.style.position === 'static') {
            element.style.position = 'relative';
        }

        if (event.clientY < midpoint) {
            // 插入到目标元素之前
            indicator.style.top = '-2px';
        } else {
            // 插入到目标元素之后
            indicator.style.bottom = '-2px';
        }

        element.appendChild(indicator);
    }

    private hideDropIndicators() {
        const indicators = this.container.querySelectorAll('.drop-indicator');
        indicators.forEach(indicator => indicator.remove());

        this.container.querySelectorAll('.quick_item').forEach((el: HTMLElement) => {
            if (el.style.position === 'relative') {
                el.style.position = '';
            }
            el.classList.remove('drag-over', 'priority-drop-high', 'priority-drop-medium', 'priority-drop-low', 'priority-drop-none');
        });
    }

    private async handleTaskReorder(draggedTaskId: string, targetTaskId: string, event: DragEvent) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            // 处理重复任务实例的情况
            const isDraggedInstance = draggedTaskId.includes('_') && !reminderData[draggedTaskId];
            const isTargetInstance = targetTaskId.includes('_') && !reminderData[targetTaskId];

            // 获取原始任务ID（如果是实例）
            const draggedReminderId = isDraggedInstance ? draggedTaskId.substring(0, draggedTaskId.lastIndexOf('_')) : draggedTaskId;
            const targetReminderId = isTargetInstance ? targetTaskId.substring(0, targetTaskId.lastIndexOf('_')) : targetTaskId;

            let draggedTask = reminderData[draggedReminderId];
            let targetTask = reminderData[targetReminderId];

            // 如果找不到原始任务，可能是数据同步问题，尝试从 filteredTasks 中查找
            if (!draggedTask) {
                const draggedTaskInfo = this.filteredTasks.find(t => t.id === draggedTaskId || t.id === draggedReminderId);
                if (draggedTaskInfo && draggedTaskInfo.originalId) {
                    draggedTask = reminderData[draggedTaskInfo.originalId];
                }
            }

            if (!targetTask) {
                const targetTaskInfo = this.filteredTasks.find(t => t.id === targetTaskId || t.id === targetReminderId);
                if (targetTaskInfo && targetTaskInfo.originalId) {
                    targetTask = reminderData[targetTaskInfo.originalId];
                }
            }

            if (!draggedTask) {
                console.error('拖拽任务不存在:', draggedTaskId, draggedReminderId);
                return;
            }
            if (!targetTask) {
                console.error('目标任务不存在:', targetTaskId, targetReminderId);
                return;
            }

            // 确保在同一项目内
            const draggedProjectId = draggedTask.projectId || 'no-project';
            const targetProjectId = targetTask.projectId || 'no-project';

            if (draggedProjectId !== targetProjectId) {
                return;
            }

            const oldPriority = draggedTask.priority || 'none';
            const newPriority = targetTask.priority || 'none';

            // 检查是否跨优先级拖拽
            if (oldPriority !== newPriority) {
                // 跨优先级排序：自动调整优先级
                await this.handleCrossPriorityReorder(
                    reminderData,
                    draggedTask,
                    targetTask,
                    draggedTaskId, // Pass the full instance ID
                    targetTaskId, // Pass the full instance ID
                    isDraggedInstance,
                    isTargetInstance,
                    event
                );
            } else {
                // 同优先级排序
                await this.handleSamePriorityReorder(
                    reminderData,
                    draggedTask,
                    targetTask,
                    draggedTaskId, // Pass the full instance ID
                    targetTaskId, // Pass the full instance ID
                    isDraggedInstance,
                    isTargetInstance,
                    event
                );
            }
        } catch (error) {
            console.error('重新排序任务失败:', error);
            showMessage(i18n('sortUpdateFailed'));
        }
    }

    /**
     * 处理同优先级排序（包括重复任务实例）
     */
    private async handleSamePriorityReorder(
        reminderData: any,
        draggedTask: any,
        _targetTask: any,
        draggedTaskId: string,
        targetTaskId: string,
        isDraggedInstance: boolean,
        isTargetInstance: boolean,
        event: DragEvent
    ) {
        // 获取被拖拽项的优先级和项目ID（如果是实例，从 instanceModifications 中读取）
        const draggedDate = isDraggedInstance ? draggedTaskId.split('_').pop() : null;
        let priority = draggedTask.priority || 'none';
        let projectId = draggedTask.projectId || 'no-project';

        if (isDraggedInstance && draggedDate && draggedTask.repeat?.instanceModifications?.[draggedDate]) {
            const instMod = draggedTask.repeat.instanceModifications[draggedDate];
            if (instMod.priority !== undefined) priority = instMod.priority;
            if (instMod.projectId !== undefined) projectId = instMod.projectId;
        }

        // 如果是重复实例排序，需要使用特殊的排序逻辑
        if (isDraggedInstance || isTargetInstance) {
            await this.handleInstanceReorder(
                reminderData,
                draggedTask,
                draggedTaskId,
                targetTaskId,
                isDraggedInstance,
                isTargetInstance,
                event,
                priority,
                projectId
            );
            return;
        }

        const draggedReminderId = draggedTaskId;
        const targetReminderId = targetTaskId;

        // 获取所有相关任务（同一项目和优先级）
        const relatedTasks = Object.values(reminderData)
            .filter((task: any) =>
                (task.projectId || 'no-project') === projectId &&
                (task.priority || 'none') === priority
            )
            .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        // 找到目标任务的索引
        const targetIndex = relatedTasks.findIndex((task: any) => task.id === targetReminderId);
        const draggedIndex = relatedTasks.findIndex((task: any) => task.id === draggedReminderId);

        if (targetIndex === -1 || draggedIndex === -1) {
            console.error('找不到拖拽或目标任务');
            return;
        }

        // 计算插入位置（基于鼠标位置）
        let insertIndex = targetIndex;
        if (event.currentTarget instanceof HTMLElement) {
            const rect = event.currentTarget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            insertIndex = event.clientY < midpoint ? targetIndex : targetIndex + 1;
        }

        // 重新排序
        const draggedTaskObj = relatedTasks[draggedIndex];

        // 从原位置移除
        relatedTasks.splice(draggedIndex, 1);

        // 调整插入索引（如果拖拽项在插入点之前被移除）
        if (draggedIndex < insertIndex) {
            insertIndex--;
        }

        // 确保索引有效
        const validInsertIndex = Math.max(0, Math.min(insertIndex, relatedTasks.length));

        // 插入到新位置
        relatedTasks.splice(validInsertIndex, 0, draggedTaskObj);

        // 更新排序值
        relatedTasks.forEach((task: any, index: number) => {
            task.sort = index * 10;
        });

        await saveReminders(this.plugin, reminderData);
        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
        await this.refresh();
    }

    /**
     * 处理重复任务实例的排序
     * 重复实例的 sort 值存储在 instanceModifications 中
     */
    private async handleInstanceReorder(
        reminderData: any,
        draggedTask: any,
        draggedTaskId: string,
        targetTaskId: string,
        isDraggedInstance: boolean,
        isTargetInstance: boolean,
        event: DragEvent,
        priority: string,
        projectId: string
    ) {
        // 解析拖拽和目标的实例日期
        const draggedDate = isDraggedInstance ? draggedTaskId.split('_').pop() : null;
        const targetDate = isTargetInstance ? targetTaskId.split('_').pop() : null;
        const draggedOriginalId = isDraggedInstance ? draggedTaskId.substring(0, draggedTaskId.lastIndexOf('_')) : draggedTaskId;
        const targetOriginalId = isTargetInstance ? targetTaskId.substring(0, targetTaskId.lastIndexOf('_')) : targetTaskId;

        if (!draggedDate && isDraggedInstance) {
            console.error('无法解析拖拽实例日期:', draggedTaskId);
            return;
        }

        // 获取所有重复实例（包括当前项目的所有重复任务实例）
        const allInstances: Array<{ id: string; originalId: string; date: string; sort: number; isInstance: boolean }> = [];

        // 收集所有普通任务（不排除带下划线的 ID，因为许多任务 ID 本身就带下划线）
        Object.values(reminderData).forEach((task: any) => {
            if ((task.projectId || 'no-project') === projectId &&
                (task.priority || 'none') === priority) {

                // 如果是重复任务的模板，我们在下面的循环中处理其实例
                // 这里只收集非重复任务，或者虽然是重复任务但我们要把模板也作为一个可排选项（通常不建议）
                // 为了与之前的逻辑保持最大兼容并修复 bug，我们收集所有匹配的项目
                // 但要排除已经是实例 ID 的情况（虽然 reminderData 中不该有实例 ID）
                const isTemplate = task.repeat?.enabled;
                if (!isTemplate) {
                    allInstances.push({
                        id: task.id,
                        originalId: task.id,
                        date: task.date,
                        sort: task.sort || 0,
                        isInstance: false
                    });
                }
            }
        });

        // 收集所有重复实例（从 repeatInstances 或 instanceModifications 中）
        Object.values(reminderData).forEach((task: any) => {
            if (!task.repeat?.enabled) return;

            // 获取该重复任务在当前项目/优先级下的所有实例
            // 从 instanceModifications 收集已经有修改记录的实例
            const processedDates = new Set<string>();
            if (task.repeat.instanceModifications) {
                Object.entries(task.repeat.instanceModifications).forEach(([date, mod]: [string, any]) => {
                    if (!mod) return;
                    processedDates.add(date);
                    const instProjectId = mod.projectId || task.projectId || 'no-project';
                    const instPriority = mod.priority || task.priority || 'none';
                    if (instProjectId === projectId && instPriority === priority) {
                        allInstances.push({
                            id: `${task.id}_${date}`,
                            originalId: task.id,
                            date: date,
                            sort: mod.sort !== undefined ? mod.sort : (task.sort || 0),
                            isInstance: true
                        });
                    }
                });
            }

            // 如果被拖拽或目标的实例还没有被处理，确保它们被包含
            // 这处理那些还没有 instanceModifications 的新实例
            if (isDraggedInstance && draggedDate && task.id === draggedOriginalId && !processedDates.has(draggedDate)) {
                if ((task.projectId || 'no-project') === projectId && (task.priority || 'none') === priority) {
                    allInstances.push({
                        id: draggedTaskId,
                        originalId: draggedOriginalId,
                        date: draggedDate,
                        sort: task.sort || 0,
                        isInstance: true
                    });
                }
            }
            if (isTargetInstance && targetDate && task.id === targetOriginalId && !processedDates.has(targetDate)) {
                if ((task.projectId || 'no-project') === projectId && (task.priority || 'none') === priority) {
                    allInstances.push({
                        id: targetTaskId,
                        originalId: targetOriginalId,
                        date: targetDate,
                        sort: task.sort || 0,
                        isInstance: true
                    });
                }
            }
        });

        // 确保当前拖拽的实例被包含（如果没有的话）
        const draggedExists = allInstances.some(inst => inst.id === draggedTaskId);
        if (!draggedExists) {
            let sort = 0;
            if (draggedTask) {
                sort = draggedTask.repeat?.instanceModifications?.[draggedDate!]?.sort ?? draggedTask.sort ?? 0;
            } else {
                // 如果找不到原始任务，尝试从 filteredTasks 获取
                const draggedTaskInfo = this.filteredTasks.find(t => t.id === draggedTaskId);
                sort = draggedTaskInfo?.sort || 0;
            }

            allInstances.push({
                id: draggedTaskId,
                originalId: draggedOriginalId,
                date: draggedDate || '',
                sort: sort,
                isInstance: !!draggedDate
            });
        }

        // 确保目标实例被包含（如果没有的话）
        const targetExists = allInstances.some(inst => inst.id === targetTaskId);
        if (!targetExists) {
            const targetTask = reminderData[targetOriginalId];
            let sort = 0;
            if (targetTask) {
                sort = targetTask.repeat?.instanceModifications?.[targetDate!]?.sort ?? targetTask.sort ?? 0;
            } else {
                const targetTaskInfo = this.filteredTasks.find(t => t.id === targetTaskId);
                sort = targetTaskInfo?.sort || 0;
            }

            allInstances.push({
                id: targetTaskId,
                originalId: targetOriginalId,
                date: targetDate || '',
                sort: sort,
                isInstance: !!targetDate
            });
        }

        // 按 sort 排序
        allInstances.sort((a, b) => a.sort - b.sort);

        // 找到目标索引
        const targetIndex = allInstances.findIndex((inst) => inst.id === targetTaskId);
        const draggedIndex = allInstances.findIndex((inst) => inst.id === draggedTaskId);

        if (targetIndex === -1 || draggedIndex === -1) {
            console.error('找不到拖拽或目标任务', { draggedTaskId, targetTaskId, allInstances: allInstances.map(i => i.id) });
            return;
        }

        // 计算插入位置
        let insertIndex = targetIndex;
        if (event.currentTarget instanceof HTMLElement) {
            const rect = event.currentTarget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            insertIndex = event.clientY < midpoint ? targetIndex : targetIndex + 1;
        }

        // 重新排序
        const draggedInst = allInstances[draggedIndex];
        allInstances.splice(draggedIndex, 1);

        // 调整插入索引（如果拖拽项在插入点之前被移除）
        if (draggedIndex < insertIndex) {
            insertIndex--;
        }

        const validInsertIndex = Math.max(0, Math.min(insertIndex, allInstances.length));
        allInstances.splice(validInsertIndex, 0, draggedInst);

        // 更新排序值
        allInstances.forEach((inst, index) => {
            const newSort = index * 10;
            if (inst.isInstance) {
                // 更新 instanceModifications 中的 sort
                const originalTask = reminderData[inst.originalId];
                if (originalTask && originalTask.repeat) {
                    if (!originalTask.repeat.instanceModifications) {
                        originalTask.repeat.instanceModifications = {};
                    }
                    if (!originalTask.repeat.instanceModifications[inst.date]) {
                        originalTask.repeat.instanceModifications[inst.date] = {};
                    }
                    originalTask.repeat.instanceModifications[inst.date].sort = newSort;
                }
            } else {
                // 更新普通任务的 sort
                if (reminderData[inst.id]) {
                    reminderData[inst.id].sort = newSort;
                }
            }
        });

        await saveReminders(this.plugin, reminderData);
        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
        await this.refresh();
    }

    /**
     * 处理跨优先级排序：自动调整优先级
     */
    private async handleCrossPriorityReorder(
        reminderData: any,
        draggedTask: any,
        targetTask: any,
        draggedTaskId: string,
        targetTaskId: string,
        isDraggedInstance: boolean,
        isTargetInstance: boolean,
        event: DragEvent
    ) {
        // 获取被拖拽项和目标项的实例日期
        const draggedInstanceDate = isDraggedInstance ? draggedTaskId.split('_').pop() : null;
        const targetInstanceDate = isTargetInstance ? targetTaskId.split('_').pop() : null;

        // 获取优先级（如果是实例，从 instanceModifications 中读取）
        let oldPriority = draggedTask.priority || 'none';
        let newPriority = targetTask.priority || 'none';
        let projectId = draggedTask.projectId || 'no-project';

        if (isDraggedInstance && draggedInstanceDate && draggedTask.repeat?.instanceModifications?.[draggedInstanceDate]) {
            const instMod = draggedTask.repeat.instanceModifications[draggedInstanceDate];
            if (instMod.priority !== undefined) oldPriority = instMod.priority;
            if (instMod.projectId !== undefined) projectId = instMod.projectId;
        }

        if (isTargetInstance && targetInstanceDate && targetTask.repeat?.instanceModifications?.[targetInstanceDate]) {
            const instMod = targetTask.repeat.instanceModifications[targetInstanceDate];
            if (instMod.priority !== undefined) newPriority = instMod.priority;
        }

        // 如果是重复实例，需要特殊处理
        if (isDraggedInstance) {
            await this.handleInstanceCrossPriorityReorder(
                reminderData,
                draggedTask,
                targetTask,
                draggedTaskId,
                targetTaskId,
                isDraggedInstance,
                isTargetInstance,
                event,
                oldPriority,
                newPriority,
                projectId
            );
            return;
        }

        const draggedReminderId = isDraggedInstance ? draggedTaskId.substring(0, draggedTaskId.lastIndexOf('_')) : draggedTaskId;
        const targetReminderId = isTargetInstance ? targetTaskId.substring(0, targetTaskId.lastIndexOf('_')) : targetTaskId;

        // 1. 更新被拖拽任务的优先级
        draggedTask.priority = newPriority;

        // 2. 处理旧优先级分组：移除被拖拽项并重新排序
        const oldGroup = Object.values(reminderData)
            .filter((task: any) =>
                (task.projectId || 'no-project') === projectId &&
                (task.priority || 'none') === oldPriority &&
                task.id !== draggedReminderId
            )
            .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        oldGroup.forEach((task: any, index: number) => {
            if (reminderData[task.id]) reminderData[task.id].sort = index * 10;
        });

        // 3. 处理新优先级分组：插入并重新排序
        const newGroup = Object.values(reminderData)
            .filter((task: any) =>
                (task.projectId || 'no-project') === projectId &&
                (task.priority || 'none') === newPriority &&
                task.id !== draggedReminderId
            )
            .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

        // 找到目标位置
        let targetIndex = newGroup.findIndex((task: any) => task.id === targetReminderId);
        if (targetIndex === -1) targetIndex = newGroup.length;

        // 计算插入位置（根据鼠标位置决定是在目标之前还是之后）
        let insertIndex = targetIndex;
        if (event.currentTarget instanceof HTMLElement) {
            const rect = event.currentTarget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            insertIndex = event.clientY < midpoint ? targetIndex : targetIndex + 1;
        }

        // 插入被拖拽的任务
        newGroup.splice(insertIndex, 0, draggedTask);

        // 重新分配排序值
        newGroup.forEach((task: any, index: number) => {
            if (reminderData[task.id]) reminderData[task.id].sort = index * 10;
        });

        await saveReminders(this.plugin, reminderData);
        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
        showMessage(i18n('priorityAutoAdjusted').replace('${priority}', this.getPriorityLabel(newPriority)));
        await this.refresh();
    }

    /**
     * 处理重复任务实例的跨优先级排序
     */
    private async handleInstanceCrossPriorityReorder(
        reminderData: any,
        draggedTask: any,
        targetTask: any,
        draggedTaskId: string,
        targetTaskId: string,
        isDraggedInstance: boolean,
        isTargetInstance: boolean,
        event: DragEvent,
        oldPriority: string,
        newPriority: string,
        projectId: string
    ) {
        // 提取实例日期
        const draggedInstanceDate = isDraggedInstance ? draggedTaskId.split('_').pop() : null;
        const targetInstanceDate = isTargetInstance ? targetTaskId.split('_').pop() : null;

        if (!draggedInstanceDate) {
            console.error('无法获取实例日期');
            return;
        }

        // 1. 更新重复实例的优先级（存储在 instanceModifications 中）
        if (!draggedTask.repeat.instanceModifications) {
            draggedTask.repeat.instanceModifications = {};
        }
        if (!draggedTask.repeat.instanceModifications[draggedInstanceDate]) {
            draggedTask.repeat.instanceModifications[draggedInstanceDate] = {};
        }
        draggedTask.repeat.instanceModifications[draggedInstanceDate].priority = newPriority;

        // 2. 处理旧优先级分组：收集所有实例 and 普通任务，移除被拖拽项并重新排序
        const oldGroup = this.collectTasksAndInstances(reminderData, projectId, oldPriority, draggedTaskId);

        oldGroup.forEach((item: any, index: number) => {
            this.updateItemSort(reminderData, item, index * 10);
        });

        // 3. 处理新优先级分组：插入并重新排序
        const newGroup = this.collectTasksAndInstances(reminderData, projectId, newPriority, draggedTaskId);

        // 找到目标位置
        let targetIndex = -1;
        if (isTargetInstance && targetInstanceDate) {
            targetIndex = newGroup.findIndex((item: any) =>
                item.id === targetTaskId || (item.originalId === targetTaskId.substring(0, targetTaskId.lastIndexOf('_')) && item.date === targetInstanceDate)
            );
        } else {
            targetIndex = newGroup.findIndex((item: any) => item.id === targetTaskId);
        }
        if (targetIndex === -1) targetIndex = newGroup.length;

        // 计算插入位置
        let insertIndex = targetIndex;
        if (event.currentTarget instanceof HTMLElement) {
            const rect = event.currentTarget.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            insertIndex = event.clientY < midpoint ? targetIndex : targetIndex + 1;
        }

        // 构建被拖拽的实例项
        const draggedItem = {
            id: draggedTaskId,
            originalId: draggedTask.id,
            date: draggedInstanceDate,
            sort: draggedTask.repeat.instanceModifications[draggedInstanceDate!]?.sort || draggedTask.sort || 0,
            isInstance: true
        };

        // 插入被拖拽的任务
        newGroup.splice(insertIndex, 0, draggedItem);

        // 重新分配排序值
        newGroup.forEach((item: any, index: number) => {
            this.updateItemSort(reminderData, item, index * 10);
        });

        await saveReminders(this.plugin, reminderData);
        window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
        showMessage(i18n('priorityAutoAdjusted').replace('${priority}', this.getPriorityLabel(newPriority)));
        await this.refresh();
    }

    /**
     * 收集指定项目和优先级的所有任务和实例
     */
    private collectTasksAndInstances(reminderData: any, projectId: string, priority: string, excludeId?: string): any[] {
        const items: any[] = [];

        // 收集普通任务
        Object.values(reminderData).forEach((task: any) => {
            if ((task.projectId || 'no-project') === projectId &&
                (task.priority || 'none') === priority &&
                (!excludeId || task.id !== excludeId)) {
                items.push({
                    id: task.id,
                    originalId: task.id,
                    date: task.date,
                    sort: task.sort || 0,
                    isInstance: false
                });
            }
        });

        // 收集重复实例
        Object.values(reminderData).forEach((task: any) => {
            if (!task.repeat?.enabled) return;

            // 从 instanceModifications 收集
            if (task.repeat?.instanceModifications) {
                const mods = task.repeat.instanceModifications;
                Object.entries(mods).forEach(([date, mod]: [string, any]) => {
                    const instanceId = `${task.id}_${date}`;
                    if ((!excludeId || instanceId !== excludeId) &&
                        (mod.projectId || task.projectId || 'no-project') === projectId &&
                        (mod.priority || task.priority || 'none') === priority) {
                        items.push({
                            id: instanceId,
                            originalId: task.id,
                            date: date,
                            sort: mod.sort !== undefined ? mod.sort : (task.sort || 0),
                            isInstance: true
                        });
                    }
                });
            }
        });

        // 按 sort 排序
        items.sort((a, b) => a.sort - b.sort);

        return items;
    }

    /**
     * 更新任务或实例的 sort 值
     */
    private updateItemSort(reminderData: any, item: any, sort: number) {
        if (item.isInstance) {
            const originalTask = reminderData[item.originalId];
            if (originalTask && originalTask.repeat) {
                if (!originalTask.repeat.instanceModifications) {
                    originalTask.repeat.instanceModifications = {};
                }
                if (!originalTask.repeat.instanceModifications[item.date]) {
                    originalTask.repeat.instanceModifications[item.date] = {};
                }
                originalTask.repeat.instanceModifications[item.date].sort = sort;
            }
        } else {
            if (reminderData[item.id]) {
                reminderData[item.id].sort = sort;
            }
        }
    }

    /**
     * 获取优先级显示标签
     */
    private getPriorityLabel(priority: string): string {
        const labels: Record<string, string> = {
            'high': '高优先级',
            'medium': '中优先级',
            'low': '低优先级',
            'none': '无优先级'
        };
        return labels[priority] || priority;
    }

    private toggleTaskCollapse(taskId: string) {
        if (this.collapsedTasks.has(taskId)) {
            this.collapsedTasks.delete(taskId);
        } else {
            this.collapsedTasks.add(taskId);
        }
        this.renderMatrix();
    }

    private toggleProjectCollapse(quadrantKey: string, projectKey: string) {
        if (!this.collapsedProjects.has(quadrantKey)) {
            this.collapsedProjects.set(quadrantKey, new Set());
        }
        const collapsedProjects = this.collapsedProjects.get(quadrantKey)!;
        if (collapsedProjects.has(projectKey)) {
            collapsedProjects.delete(projectKey);
        } else {
            collapsedProjects.add(projectKey);
        }
        this.renderMatrix();
    }

    async refresh(force: boolean = false) {
        await this.loadTasks(force);
        this.renderMatrix();
        // 刷新后保持按钮状态
        this.updateKanbanStatusFilterButton();
    }

    private updateKanbanStatusFilterButton() {
        const kanbanStatusFilterBtn = this.container.querySelector('.kanban-status-filter-btn');
        if (kanbanStatusFilterBtn) {
            if (this.kanbanStatusFilter === 'doing') {
                kanbanStatusFilterBtn.innerHTML = `
                    <svg class="b3-button__icon"><use xlink:href="#iconPlay"></use></svg>
                    进行中任务
                    <svg class="dropdown-arrow" style="margin-left: 4px; width: 12px; height: 12px;"><use xlink:href="#iconDown"></use></svg>
                `;
                kanbanStatusFilterBtn.classList.add('b3-button--primary');
                kanbanStatusFilterBtn.classList.remove('b3-button--outline');
            } else if (this.kanbanStatusFilter === 'todo') {
                kanbanStatusFilterBtn.innerHTML = `
                    <svg class="b3-button__icon"><use xlink:href="#iconClock"></use></svg>
                    待办任务
                    <svg class="dropdown-arrow" style="margin-left: 4px; width: 12px; height: 12px;"><use xlink:href="#iconDown"></use></svg>
                `;
                kanbanStatusFilterBtn.classList.add('b3-button--primary');
                kanbanStatusFilterBtn.classList.remove('b3-button--outline');
            } else {
                kanbanStatusFilterBtn.innerHTML = `
                    <svg class="b3-button__icon"><use xlink:href="#iconList"></use></svg>
                    全部任务
                    <svg class="dropdown-arrow" style="margin-left: 4px; width: 12px; height: 12px;"><use xlink:href="#iconDown"></use></svg>
                `;
                kanbanStatusFilterBtn.classList.remove('b3-button--primary');
                kanbanStatusFilterBtn.classList.add('b3-button--outline');
            }
        }
    }

    private showKanbanStatusFilterDropdown(button: HTMLElement) {
        // 移除现有的下拉菜单
        const existingDropdown = document.querySelector('.kanban-status-filter-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        // 创建下拉菜单
        const dropdown = document.createElement('div');
        dropdown.className = 'kanban-status-filter-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 4px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 1000;
            min-width: 160px;
            padding: 4px 0;
        `;

        // 获取按钮位置
        const rect = button.getBoundingClientRect();
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 4}px`;

        // 创建菜单项
        const menuItems = [
            { key: 'all', label: '全部任务', icon: 'iconList' },
            { key: 'doing', label: '进行中任务', icon: 'iconPlay' },
            { key: 'todo', label: '待办任务', icon: 'iconClock' }
        ];

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'dropdown-menu-item';
            menuItem.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                color: var(--b3-theme-on-surface);
                ${this.kanbanStatusFilter === item.key ? 'background: var(--b3-theme-primary-lightest); color: var(--b3-theme-primary); font-weight: 600;' : ''}
            `;

            menuItem.innerHTML = `
                <svg class="b3-button__icon" style="width: 16px; height: 16px;"><use xlink:href="#${item.icon}"></use></svg>
                ${item.label}
                ${this.kanbanStatusFilter === item.key ? '<svg class="b3-button__icon" style="margin-left: auto; width: 14px; height: 14px;"><use xlink:href="#iconCheck"></use></svg>' : ''}
            `;

            menuItem.addEventListener('click', () => {
                this.kanbanStatusFilter = item.key as 'all' | 'doing' | 'todo';
                this.updateKanbanStatusFilterButton();
                this.applyFiltersAndGroup();
                this.renderMatrix();
                dropdown.remove();
            });

            menuItem.addEventListener('mouseenter', () => {
                menuItem.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
            });

            menuItem.addEventListener('mouseleave', () => {
                menuItem.style.backgroundColor = this.kanbanStatusFilter === item.key ? 'var(--b3-theme-primary-lightest)' : '';
            });

            dropdown.appendChild(menuItem);
        });

        // 添加到页面
        document.body.appendChild(dropdown);

        // 点击其他地方关闭下拉菜单
        const closeDropdown = (e: Event) => {
            if (!dropdown.contains(e.target as Node) && e.target !== button) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };

        // 延迟添加事件监听器，避免立即触发
        setTimeout(() => {
            document.addEventListener('click', closeDropdown);
        }, 0);
    }

    private async loadProjectSortOrder() {
        try {
            const settings = await this.plugin.loadSettings();


            this.projectSortOrder = settings.projectSortOrder || [];
            this.currentProjectSortMode = settings.projectSortMode || 'custom'; // 默认改为custom
        } catch (error) {
            this.projectSortOrder = [];
            this.currentProjectSortMode = 'custom'; // 默认改为custom
        }
    }

    private async loadCriteriaSettings() {
        try {
            const settings = await this.plugin.loadSettings();

            this.criteriaSettings = {
                importanceThreshold: settings.eisenhowerImportanceThreshold || 'medium',
                urgencyDays: settings.eisenhowerUrgencyDays || 3
            };
        } catch (error) {
            this.criteriaSettings = {
                importanceThreshold: 'medium',
                urgencyDays: 3
            };
        }
    }

    private async saveCriteriaSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            settings.eisenhowerImportanceThreshold = this.criteriaSettings.importanceThreshold;
            settings.eisenhowerUrgencyDays = this.criteriaSettings.urgencyDays;
            await this.plugin.saveSettings(settings);
        } catch (error) {
            console.error('保存标准设置失败:', error);
        }
    }

    private async saveProjectSortOrder() {
        try {
            const settings = await this.plugin.loadSettings();
            settings.projectSortOrder = this.projectSortOrder;
            settings.projectSortMode = this.currentProjectSortMode;
            await this.plugin.saveSettings(settings);
        } catch (error) {
            console.error('保存项目排序失败:', error);
        }
    }

    private showProjectSortDialog() {
        const dialog = new Dialog({
            title: "项目排序设置",
            content: `
                <div class="project-sort-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">项目排序（拖拽调整顺序）</label>
                            <div id="projectSortList" class="project-sort-list" style="border: 1px solid var(--b3-theme-border); border-radius: 4px; padding: 8px; max-height: 400px; overflow-y: auto;">
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="sortCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="sortSaveBtn">保存</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "650px"
        });

        const projectSortList = dialog.element.querySelector('#projectSortList') as HTMLElement;
        const cancelBtn = dialog.element.querySelector('#sortCancelBtn') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#sortSaveBtn') as HTMLButtonElement;

        // 获取所有项目
        const allProjects = this.projectManager.getProjectsGroupedByStatus();
        const activeProjects: any[] = [];
        Object.values(allProjects).forEach((projects: any[]) => {
            if (projects && projects.length > 0) {
                activeProjects.push(...projects.filter(p => p && p.status !== 'archived'));
            }
        });

        // 如果没有任何项目，显示提示信息
        if (activeProjects.length === 0) {
            projectSortList.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--b3-theme-on-surface-light);">没有可用的项目</div>';
            return;
        }

        // 渲染项目排序列表
        const renderProjectList = () => {
            projectSortList.innerHTML = '';

            let projectsToShow: any[];
            if (this.projectSortOrder.length > 0) {
                // 使用自定义排序的项目
                const orderedProjects = this.projectSortOrder
                    .map(id => activeProjects.find(p => p.id === id))
                    .filter(Boolean);
                const remainingProjects = activeProjects.filter(p => !this.projectSortOrder.includes(p.id));
                projectsToShow = [...orderedProjects, ...remainingProjects.sort((a, b) => a.name.localeCompare(b.name))];
            } else {
                // 按名称排序
                projectsToShow = [...activeProjects].sort((a, b) => a.name.localeCompare(b.name));
            }

            projectsToShow.forEach(project => {
                const item = document.createElement('div');
                item.className = 'project-sort-item';
                item.style.cssText = `
                    padding: 8px;
                    margin: 4px 0;
                    background: var(--b3-theme-surface-lighter);
                    border-radius: 4px;
                    cursor: grab;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                `;
                item.setAttribute('data-project-id', project.id);
                item.setAttribute('draggable', 'true');
                item.innerHTML = `
                    <span style="cursor: grab; color: var(--b3-theme-on-surface); opacity: 0.7;">⋮⋮</span>
                    <span>${project.name}</span>
                    <span style="color: var(--b3-theme-on-surface-light); font-size: 12px; margin-left: auto;">${this.getStatusDisplayName(project.status)}</span>
                `;
                projectSortList.appendChild(item);
            });
        };

        renderProjectList();




        // 自定义项目排序拖拽功能
        let draggedProjectElement: HTMLElement | null = null;

        projectSortList.addEventListener('dragstart', (e) => {
            draggedProjectElement = e.target as HTMLElement;
            (e.target as HTMLElement).classList.add('dragging');
        });

        projectSortList.addEventListener('dragend', (e) => {
            (e.target as HTMLElement).classList.remove('dragging');
            draggedProjectElement = null;
        });

        projectSortList.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(projectSortList, e.clientY);
            if (draggedProjectElement) {
                if (afterElement) {
                    projectSortList.insertBefore(draggedProjectElement, afterElement);
                } else {
                    projectSortList.appendChild(draggedProjectElement);
                }
            }
        });

        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        saveBtn.addEventListener('click', async () => {
            // 始终使用自定义排序模式
            this.currentProjectSortMode = 'custom';

            // 获取当前排序
            const items = projectSortList.querySelectorAll('.project-sort-item');
            this.projectSortOrder = Array.from(items).map(item => item.getAttribute('data-project-id')).filter(Boolean) as string[];

            await this.saveProjectSortOrder();
            dialog.destroy();
            await this.refresh();
            showMessage(i18n('projectSortUpdated'));
        });
    }

    private getDragAfterElement(container: HTMLElement, y: number): HTMLElement | null {
        const draggableElements = [...container.querySelectorAll('.project-sort-item:not(.dragging)')] as HTMLElement[];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;

            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY, element: null as HTMLElement | null }).element || null;
    }

    private showSettingsDialog() {
        const dialog = new Dialog({
            title: i18n('eisenhowerSettings'),
            content: `
                <div class="settings-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('importanceThreshold')}</label>
                            <div class="importance-selector">
                                <label class="b3-form__radio">
                                    <input type="radio" name="importanceThreshold" value="high" ${this.criteriaSettings.importanceThreshold === 'high' ? 'checked' : ''}>
                                    <span>${i18n('priorityHigh')}</span>
                                </label>
                                <label class="b3-form__radio">
                                    <input type="radio" name="importanceThreshold" value="medium" ${this.criteriaSettings.importanceThreshold === 'medium' ? 'checked' : ''}>
                                    <span>${i18n('priorityMedium')}</span>
                                </label>
                                <label class="b3-form__radio">
                                    <input type="radio" name="importanceThreshold" value="low" ${this.criteriaSettings.importanceThreshold === 'low' ? 'checked' : ''}>
                                    <span>${i18n('priorityLow')}</span>
                                </label>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n('urgencyThreshold')}</label>
                            <input type="number" id="urgencyDays" class="b3-text-field" value="${this.criteriaSettings.urgencyDays}" min="1" max="30">
                            <div class="b3-form__help">${i18n('urgencyThresholdDesc')}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="settingsCancelBtn">${i18n('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="settingsSaveBtn">${i18n('save')}</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "auto"
        });

        const cancelBtn = dialog.element.querySelector('#settingsCancelBtn') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#settingsSaveBtn') as HTMLButtonElement;
        const urgencyDaysInput = dialog.element.querySelector('#urgencyDays') as HTMLInputElement;
        const importanceRadios = dialog.element.querySelectorAll('input[name="importanceThreshold"]') as NodeListOf<HTMLInputElement>;

        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        saveBtn.addEventListener('click', async () => {
            const urgencyDays = parseInt(urgencyDaysInput.value);
            if (isNaN(urgencyDays) || urgencyDays < 1 || urgencyDays > 30) {
                showMessage(i18n('invalidUrgencyDays'));
                return;
            }

            const selectedImportance = Array.from(importanceRadios).find(r => r.checked)?.value as 'high' | 'medium' | 'low';

            this.criteriaSettings = {
                importanceThreshold: selectedImportance,
                urgencyDays: urgencyDays
            };

            await this.saveCriteriaSettings();
            dialog.destroy();

            await this.refresh();
            showMessage(i18n('settingsSaved'));
        });
    }

    private showFilterDialog() {
        const dialog = new Dialog({
            title: "筛选设置",
            content: `
                <div class="filter-dialog">
                    <div class="b3-dialog__content">
                        <div class="filter-section">
                            <h3>项目状态</h3>
                            <div id="statusFilters" class="filter-checkboxes"></div>
                        </div>
                        <div class="filter-section">
                            <h3>项目筛选</h3>
                            <div id="projectFilters" class="filter-checkboxes"></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="filterCancelBtn">${i18n('cancel')}</button>
                        <button class="b3-button" id="filterResetBtn">${i18n('eisenhowerResetBtn')}</button>
                        <button class="b3-button b3-button--primary" id="filterApplyBtn">${i18n('eisenhowerApplyBtn')}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "auto"
        });

        this.renderFilterOptions(dialog);
        this.setupFilterDialogEvents(dialog);
    }

    private renderFilterOptions(dialog: Dialog) {
        const statusFiltersEl = dialog.element.querySelector('#statusFilters');
        const projectFiltersEl = dialog.element.querySelector('#projectFilters');

        if (statusFiltersEl) {
            // 获取所有可能的状态
            const statusManager = this.projectManager.getStatusManager();
            const allStatuses = statusManager.getStatuses();

            // 添加"无项目"选项
            const noProjectCheckbox = this.createCheckbox('no-project', i18n('noProject'), this.statusFilter.has('no-project'));
            statusFiltersEl.appendChild(noProjectCheckbox);

            // 添加项目状态选项
            allStatuses.forEach(status => {
                const checkbox = this.createCheckbox(status.id, status.name, this.statusFilter.has(status.id));
                statusFiltersEl.appendChild(checkbox);
            });
        }

        if (projectFiltersEl) {
            // 获取所有项目 - 需要根据实际 API 调整
            const allGroupedProjects = this.projectManager.getProjectsGroupedByStatus();
            const allProjects: any[] = [];
            Object.values(allGroupedProjects).forEach((projects: any[]) => {
                allProjects.push(...projects);
            });

            // 添加"无项目"选项
            const noProjectCheckbox = this.createCheckbox('no-project', i18n('noProject'), this.projectFilter.has('no-project'));
            projectFiltersEl.appendChild(noProjectCheckbox);

            // 按状态分组显示项目
            Object.keys(allGroupedProjects).forEach(statusKey => {
                const projects = allGroupedProjects[statusKey] || [];
                if (projects.length > 0) {
                    const statusName = this.getStatusDisplayName(statusKey);
                    const groupLabel = document.createElement('div');
                    groupLabel.className = 'filter-group-label';
                    groupLabel.textContent = statusName;
                    projectFiltersEl.appendChild(groupLabel);

                    projects.forEach(project => {
                        const checkbox = this.createCheckbox(project.id, project.name, this.projectFilter.has(project.id));
                        projectFiltersEl.appendChild(checkbox);
                    });
                }
            });
        }
    }

    private createCheckbox(value: string, label: string, checked: boolean): HTMLElement {
        const checkboxContainer = document.createElement('label');
        checkboxContainer.className = 'filter-checkbox-container';
        checkboxContainer.innerHTML = `
            <input type="checkbox" value="${value}" ${checked ? 'checked' : ''}/>
            <span>${label}</span>
        `;
        return checkboxContainer;
    }

    private setupFilterDialogEvents(dialog: Dialog) {
        const cancelBtn = dialog.element.querySelector('#filterCancelBtn');
        const resetBtn = dialog.element.querySelector('#filterResetBtn');
        const applyBtn = dialog.element.querySelector('#filterApplyBtn');

        cancelBtn?.addEventListener('click', () => {
            dialog.destroy();
        });

        resetBtn?.addEventListener('click', () => {
            // 重置所有筛选器
            this.statusFilter.clear();
            this.projectFilter.clear();

            // 更新复选框状态
            const checkboxes = dialog.element.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {
                (checkbox as HTMLInputElement).checked = false;
            });
        });

        applyBtn?.addEventListener('click', () => {
            // 收集状态筛选
            const statusCheckboxes = dialog.element.querySelectorAll('#statusFilters input[type="checkbox"]');
            this.statusFilter.clear();
            statusCheckboxes.forEach(checkbox => {
                if ((checkbox as HTMLInputElement).checked) {
                    this.statusFilter.add((checkbox as HTMLInputElement).value);
                }
            });

            // 收集项目筛选
            const projectCheckboxes = dialog.element.querySelectorAll('#projectFilters input[type="checkbox"]');
            this.projectFilter.clear();
            projectCheckboxes.forEach(checkbox => {
                if ((checkbox as HTMLInputElement).checked) {
                    this.projectFilter.add((checkbox as HTMLInputElement).value);
                }
            });

            // 应用筛选
            this.applyFiltersAndGroup();
            this.renderMatrix();

            dialog.destroy();
            showMessage(i18n('eisenhowerFilterApplied'));
        });
    }

    private showCreateTaskDialog(quadrant: QuadrantTask['quadrant'], parentTask?: QuadrantTask) {
        let date: string | undefined;
        let time: string | undefined;

        if (!parentTask) {
            // 根据象限和当前设置计算推荐的日期和时间
            const recommended = this.calculateRecommendedDateTime(quadrant);
            date = recommended.date;
            time = recommended.time;
        }

        // 创建 QuickReminderDialog，传入象限信息
        const quickDialog = new QuickReminderDialog(
            date,
            time,
            async () => {
                // 任务创建成功后的回调
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
            },
            undefined, // timeRangeOptions
            {
                defaultParentId: parentTask?.id,
                defaultProjectId: parentTask?.projectId,
                // 如果是子任务，使用父任务的象限；否则使用当前点击的象限
                defaultQuadrant: parentTask ? parentTask.quadrant : quadrant,
                plugin: this.plugin, // 传入plugin实例
            }
        );

        // 显示对话框
        quickDialog.show();
    }

    /**
     * 显示通用新建任务对话框（不指定特定象限）
     */
    private showCreateGeneralTaskDialog() {
        // 使用今天作为默认日期，不指定特定时间
        const today = new Date();
        const defaultDate = today.toISOString().split('T')[0];

        // 创建 QuickReminderDialog，不传入象限信息
        const quickDialog = new QuickReminderDialog(
            defaultDate,
            undefined, // 不指定时间
            async () => {
                // 任务创建成功后的回调
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
            },
            undefined, // timeRangeOptions
            {
                // 不指定默认项目和象限，让任务根据优先级和日期自动分配
                defaultProjectId: undefined,
                defaultQuadrant: undefined,
                plugin: this.plugin, // 传入plugin实例
            }
        );

        // 显示对话框
        quickDialog.show();
    }

    /**
     * 根据象限计算推荐的日期和时间
     */
    private calculateRecommendedDateTime(quadrant: QuadrantTask['quadrant']): { date: string; time?: string } {
        const today = new Date();
        let recommendedDate = today;
        let recommendedTime: string | undefined;

        switch (quadrant) {
            case 'important-urgent':
                // 重要且紧急：今天，建议有具体时间
                recommendedDate = today;
                recommendedTime = this.getNextAvailableTime();
                break;
            case 'important-not-urgent':
                // 重要不紧急：一周后
                recommendedDate = new Date(today);
                recommendedDate.setDate(today.getDate() + 7);
                break;
            case 'not-important-urgent':
                // 不重要但紧急：紧急期限内
                recommendedDate = new Date(today);
                recommendedDate.setDate(today.getDate() + Math.max(1, this.criteriaSettings.urgencyDays - 1));
                recommendedTime = this.getNextAvailableTime();
                break;
            case 'not-important-not-urgent':
                // 不重要不紧急：较远的将来
                recommendedDate = new Date(today);
                recommendedDate.setDate(today.getDate() + 14);
                break;
        }

        return {
            date: recommendedDate.toISOString().split('T')[0],
            time: recommendedTime
        };
    }

    /**
     * 获取下一个可用时间（避免过去的时间）
     */
    private getNextAvailableTime(): string {
        const now = new Date();
        const currentHour = now.getHours();

        // 如果当前时间在合理的工作时间内，推荐下一个整点
        if (currentHour >= 8 && currentHour < 18) {
            const nextHour = currentHour + 1;
            return `${nextHour.toString().padStart(2, '0')}:00`;
        } else if (currentHour < 8) {
            // 如果是早晨，推荐9点
            return '09:00';
        } else {
            // 如果是晚上，推荐明天上午9点（但这种情况下日期计算会在调用处处理）
            return '09:00';
        }
    }



    private startPomodoro(task: QuadrantTask) {
        if (!this.plugin) {
            showMessage(i18n('pluginInstanceUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            confirm(
                '已有番茄钟运行',
                '已经有一个番茄钟正在运行。是否要停止当前番茄钟并启动新的？',
                () => {
                    const currentState = currentTimer.getCurrentState();
                    this.pomodoroManager.closeCurrentTimer();
                    this.performStartPomodoro(task, currentState);
                }
            );
        } else {
            this.performStartPomodoro(task);
        }
    }

    private startPomodoroCountUp(task: QuadrantTask) {
        if (!this.plugin) {
            showMessage(i18n('pluginInstanceUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            confirm(
                '已有番茄钟运行',
                '已经有一个番茄钟正在运行。是否要停止当前番茄钟并启动新的？',
                () => {
                    const currentState = currentTimer.getCurrentState();
                    this.pomodoroManager.closeCurrentTimer();
                    this.performStartPomodoroCountUp(task, currentState);
                }
            );
        } else {
            this.performStartPomodoroCountUp(task);
        }
    }

    private async performStartPomodoro(task: QuadrantTask, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟');

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
                    const phaseText = inheritState.isWorkPhase ? i18n('workTime') : i18n('breakTime');
                    showMessage(i18n('taskSwitchedInherit').replace('${phase}', phaseText), 2000);
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
                const phaseText = inheritState.isWorkPhase ? i18n('workTime') : i18n('breakTime');
                showMessage(i18n('taskSwitchedInherit').replace('${phase}', phaseText), 2000);
            }
        }
    }

    private async performStartPomodoroCountUp(task: QuadrantTask, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟（正计时模式）');

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
                    showMessage(i18n('stopwatchSwitchedInherit').replace('${phase}', phaseText), 2000);
                } else {
                    showMessage(i18n('stopwatchStarted'), 2000);
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
                const phaseText = inheritState.isWorkPhase ? i18n('workTime') : i18n('breakTime');
                showMessage(i18n('stopwatchSwitchedInherit').replace('${phase}', phaseText), 2000);
            } else {
                showMessage(i18n('stopwatchStarted'), 2000);
            }
        }
    }

    // 复制块引用
    private async copyBlockRef(task: QuadrantTask) {
        try {
            if (!task.blockId) {
                showMessage(i18n('taskNotBoundToBlock'));
                return;
            }

            const blockRef = `((${task.blockId} '${task.title}'))`;
            await navigator.clipboard.writeText(blockRef);
            showMessage(i18n('copiedBlockRef'));
        } catch (error) {
            console.error('复制块引用失败:', error);
            showMessage(i18n('copyFailed'));
        }
    }

    // 显示绑定到块的对话框
    private showBindToBlockDialog(task: QuadrantTask) {
        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            try {
                await this.bindTaskToBlock(task, blockId);
                showMessage(i18n('bindSuccess'));
            } catch (error) {
                console.error('绑定失败:', error);
                showMessage(i18n('bindToBlockFailed'));
            }
        }, {
            defaultTab: 'bind',
            reminder: task
        });
        blockBindingDialog.show();
    }

    // 将任务绑定到指定的块
    private async bindTaskToBlock(task: QuadrantTask, blockId: string) {
        try {
            const reminderData = await getAllReminders(this.plugin);

            if (reminderData[task.id]) {
                reminderData[task.id].blockId = blockId;
                await saveReminders(this.plugin, reminderData);

                // 将绑定的块添加项目ID属性 custom-task-projectId
                const projectId = reminderData[task.id].projectId;
                if (projectId) {
                    const { addBlockProjectId } = await import('../api');
                    await addBlockProjectId(blockId, projectId);
                    console.debug('EisenhowerMatrixView: bindTaskToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                const { updateBindBlockAtrrs } = await import('../api');
                await updateBindBlockAtrrs(blockId, this.plugin);

                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
            }
        } catch (error) {
            console.error('绑定任务到块失败:', error);
            throw error;
        }
    }


    /**
     * 编辑周期任务的单个实例
     */
    private async editInstanceReminder(task: QuadrantTask) {
        try {
            const reminderData = await getAllReminders(this.plugin);
            const originalReminder = reminderData[task.originalId!];

            if (!originalReminder) {
                showMessage(i18n('originalRepeatEventNotExist'));
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

            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                async () => {
                    await this.loadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
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
            showMessage(i18n('openModifyDialogFailed'));
        }
    }

    /**
     * 删除周期任务的单个实例
     */
    private async deleteInstanceOnly(task: QuadrantTask) {
        confirm(
            i18n('deleteThisInstance'),
            i18n('confirmDeleteInstanceOnDateMsg').replace('${title}', task.title).replace('${date}', task.date),
            async () => {
                try {
                    const originalId = task.originalId!;
                    const instanceDate = task.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage(i18n('instanceDeleted'));
                    await this.loadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { source: this.viewId } }));
                } catch (error) {
                    console.error('删除周期实例失败:', error);
                    showMessage(i18n('deleteInstanceFailed'));
                }
            }
        );
    }

    /**
     * 为原始周期事件添加排除日期
     */
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

    destroy() {
        // 清理事件监听器
        window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);

        // 清理样式
        const style = document.querySelector('#eisenhower-matrix-styles');
        if (style) {
            style.remove();
        }
    }
}
