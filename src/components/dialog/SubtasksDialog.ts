import { Dialog, Menu, showMessage, confirm } from "siyuan";
import { TaskActionUndo } from "../../utils/taskActionUndo";
import { openBlock, updateBindBlockAtrrs } from "../../api";
import { i18n } from "../../pluginInstance";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { PasteTaskDialog } from "./PasteTaskDialog";
import { SortMenuDialog } from "./SortMenuDialog";
import { TaskRenderer, type TaskRenderCallbacks, type TaskRenderContext } from "../render/TaskRenderer";
import { CategoryManager } from "../dataManager/categoryManager";
import { ProjectManager } from "../dataManager/projectManager";
import { getLogicalDateString } from "../../utils/dateUtils";
import { getSortCriterionName, loadSubtaskSortCriteria, saveSubtaskSortCriteria, type SortCriterion } from "../../utils/sortConfig";
import { excludeRepeatInstance, resolveRepeatReminderTimes, addDaysToDate, getDaysDifference, getRepeatInstanceCompletedTime, setRepeatInstanceCompletion, getRepeatInstanceState, patchRepeatInstanceState, parseReminderInstanceId } from "../dataManager/repeatUtils";
import { getLuteInstance } from "../../utils/luteSingleton";
import { collectTaskDeletionIds } from "../../utils/taskTreeDeletion";
import { cloneTaskData } from "../../utils/taskUndoPatch";

interface InlineSubtaskTitle {
    id: string;
    input: HTMLTextAreaElement;
    row: HTMLElement;
    parentId: string;
    afterTaskId?: string;
    task?: any;
    wasDraggable: boolean;
    committed?: boolean;
}

type SubtaskDropPosition = 'before' | 'after' | 'inside';

export class SubtasksDialog {
    private dialog: Dialog;
    private embeddedContainer?: HTMLElement;
    private parentId: string;
    private plugin: any;
    private subtasks: any[] = [];
    private onUpdate?: () => void;
    private closed = false;
    private reminderUpdatedHandler = async (event: CustomEvent) => {
        if (this.closed || this.isTempMode || !event.detail?.taskUndo) return;
        await this.loadSubtasks();
        if (this.closed) return;
        this.renderSubtasks();
        this.onUpdate?.();
    };
    private draggingId: string | null = null;
    private subtaskDropTarget?: HTMLElement;
    private pendingSubtaskDrop?: Promise<boolean>;
    private pendingSubtaskDeletion?: Promise<boolean>;
    private currentSortCriteria: SortCriterion[] = [];
    private isTempMode: boolean = false; // 是否为临时模式（新建任务的子任务）
    private tempSubtasks: any[] = []; // 临时子任务列表
    private onTempSubtasksUpdate?: (subtasks: any[]) => void; // 临时子任务更新回调
    private isInstanceEdit: boolean = false; // 是否为编辑单个重复实例模式
    private isModifyAllInstances: boolean = false; // 是否为编辑所有重复实例模式
    private collapsedSubtaskIds: Set<string> = new Set();
    private selectedSubtaskIds = new Set<string>();
    private tempParentName?: string | (() => string);
    private tempParentTask?: any | (() => any);
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private milestoneMap: Map<string, any> = new Map();
    private lute: any;
    private readOnly: boolean = false; // 是否为只读模式
    private inlineTitle?: InlineSubtaskTitle;
    private dirtyInlineTitles = new Set<InlineSubtaskTitle>();
    private pendingTitleSave?: Promise<boolean>;
    private subtaskRenderPending = false;
    private movingInlineDraft = false;
    private parentTaskCache?: any;

    constructor(
        parentId: string,
        plugin: any,
        onUpdate?: () => void,
        tempSubtasks: any[] = [],
        onTempSubtasksUpdate?: (subtasks: any[]) => void,
        isInstanceEdit?: boolean,
        isModifyAllInstances?: boolean,
        tempParentName?: string | (() => string),
        readOnly?: boolean,
        tempParentTask?: any | (() => any)
    ) {
        this.parentId = parentId;
        this.plugin = plugin;
        this.onUpdate = onUpdate;
        // 如果 parentId 为空，说明是新建任务的临时子任务模式
        this.isTempMode = !parentId;
        this.tempSubtasks = tempSubtasks || [];
        this.onTempSubtasksUpdate = onTempSubtasksUpdate;
        this.isInstanceEdit = isInstanceEdit || false;
        this.isModifyAllInstances = isModifyAllInstances || false;
        this.tempParentName = tempParentName;
        this.tempParentTask = tempParentTask;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);
        this.readOnly = !!readOnly;
        // 使用插件全局共享的 Lute 实例
        this.lute = getLuteInstance();
    }

    private getResolvedTempParentTask(): any | null {
        if (!this.tempParentTask) return null;
        return typeof this.tempParentTask === 'function' ? this.tempParentTask() : this.tempParentTask;
    }

    private getResolvedRootParentTask(): any | null {
        const liveParent = this.getResolvedTempParentTask();
        if (this.isTempMode) {
            return liveParent;
        }
        if (liveParent && this.parentTaskCache) {
            return { ...this.parentTaskCache, ...liveParent };
        }
        return liveParent ?? this.parentTaskCache ?? null;
    }

    private getSubtaskBadgeVisibility(
        task: any,
        rootParentId: string,
        rootParentTask: any | null,
        subtasksById: Map<string, any>
    ): Pick<TaskRenderContext, 'showCategoryBadge' | 'showMilestoneBadge' | 'showTagBadge' | 'showProjectTagBadge'> {
        const parentId = this.getRenderedParentId(task);
        const parentTask = parentId === rootParentId
            ? rootParentTask
            : (subtasksById.get(parentId) ?? null);
        if (!parentTask) {
            return {
                showCategoryBadge: true,
                showMilestoneBadge: true,
                showTagBadge: true,
                showProjectTagBadge: true,
            };
        }

        const normalizeId = (value: unknown): string => String(value || '').trim();
        const normalizeCategories = (categoryId: unknown): string => Array.from(new Set(
            String(categoryId || '').split(',').map(id => id.trim()).filter(Boolean)
        )).sort().join(',');
        const normalizeStringList = (values: unknown): string => JSON.stringify(
            Array.from(new Set(
                (Array.isArray(values) ? values : [])
                    .map(item => String(item || '').trim())
                    .filter(Boolean)
            )).sort()
        );

        const taskCategories = normalizeCategories(task.categoryId);
        const hasSameParentCategories = !!taskCategories
            && taskCategories === normalizeCategories(parentTask.categoryId);

        const taskMilestoneId = normalizeId(task.milestoneId);
        const hasSameParentMilestone = !!taskMilestoneId
            && taskMilestoneId === normalizeId(parentTask.milestoneId);

        const taskTags = normalizeStringList(task.tags);
        const hasSameParentTags = taskTags !== '[]'
            && taskTags === normalizeStringList(parentTask.tags);

        const taskProjectId = normalizeId(task.projectId);
        const taskTagIds = normalizeStringList(task.tagIds);
        const hasSameParentProjectTags = !!taskProjectId
            && taskProjectId === normalizeId(parentTask.projectId)
            && taskTagIds !== '[]'
            && taskTagIds === normalizeStringList(parentTask.tagIds);

        return {
            showCategoryBadge: !hasSameParentCategories,
            showMilestoneBadge: !hasSameParentMilestone,
            showTagBadge: !hasSameParentTags,
            showProjectTagBadge: !hasSameParentProjectTags,
        };
    }

    public refreshDisplay() {
        if (this.closed) return;
        this.renderSubtasks();
    }

    private getRootElement(): HTMLElement {
        return this.embeddedContainer || this.dialog.element;
    }

    private async ensureRenderDependencies() {
        try {
            this.currentSortCriteria = this.normalizeSubtaskSortCriteria(await loadSubtaskSortCriteria(this.plugin));
        } catch (error) {
            console.warn('Failed to load subtask sort settings:', error);
        }

        try {
            await this.categoryManager.initialize();
        } catch (error) {
            console.warn("Failed to initialize category manager:", error);
        }

        try {
            await this.projectManager.initialize();
            this.buildMilestoneMap();
        } catch (error) {
            console.warn("Failed to initialize project manager:", error);
        }
    }

    private buildMilestoneMap() {
        this.milestoneMap.clear();
        this.projectManager.getProjects().forEach((project: any) => {
            const projectName = project.name || project.title || '';
            (project.milestones || []).forEach((milestone: any) => {
                if (milestone?.id) {
                    this.milestoneMap.set(milestone.id, { ...milestone, projectId: project.id, projectName });
                }
            });
            (project.customGroups || []).forEach((group: any) => {
                (group.milestones || []).forEach((milestone: any) => {
                    if (milestone?.id) {
                        this.milestoneMap.set(milestone.id, {
                            ...milestone,
                            projectId: project.id,
                            projectName: group.name ? `${projectName} - ${group.name}` : projectName
                        });
                    }
                });
            });
        });
    }

    private renderContent(showCloseButton: boolean): string {
        return `
                <div class="subtasks-dialog" style="${showCloseButton ? 'padding: 16px;' : ''} display: flex; flex-direction: column; gap: 16px; max-height: ${showCloseButton ? '80vh' : '100%'};">
                    <div class="subtasks-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--b3-border-color); flex-wrap: wrap;">
                        <button id="sortBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>
                            ${i18n("sort") || "排序"}
                        </button>
                        ${this.readOnly ? '' : `
                        <div class="subtasks-header__actions" style="display: flex; align-items: center; gap: 8px; margin-left: auto; flex-wrap: wrap;">
                            <button type="button" id="addSubtaskTopBtn" class="b3-button b3-button--primary">
                                <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                ${i18n("createSubtask")}
                            </button>
                            <button id="pasteSubtaskBtn" class="b3-button b3-button--outline">
                                <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                                ${i18n("pasteSubtasks") || "粘贴新建"}
                            </button>
                        </div>
                        `}
                    </div>
                    <div id="subtasksList" class="subtasks-dialog__list"></div>
                    ${this.readOnly ? '' : `
                    <button type="button" id="addSubtaskBtn" class="b3-button b3-button--text subtasks-dialog__add">
                        <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                        ${i18n("createSubtask")}
                    </button>
                    `}
                    ${showCloseButton ? `
                    <div class="subtasks-actions" style="display: flex; gap: 8px; justify-content: flex-end; padding-top: 8px; border-top: 1px solid var(--b3-border-color); flex-wrap: wrap;">
                        <button id="closeSubtasksBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                            ${i18n("close") || "关闭"}
                        </button>
                    </div>
                    ` : ''}
                </div>
            `;
    }

    public async mount(container: HTMLElement) {
        this.embeddedContainer = container;
        await this.ensureRenderDependencies();

        if (this.isTempMode) {
            this.subtasks = [...this.tempSubtasks];
        } else {
            await this.loadSubtasks();
        }

        if (this.closed) return;
        container.innerHTML = this.renderContent(false);
        this.renderSubtasks();
        this.bindEvents();
        this.updateSortDisplay();
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
    }

    public async show() {
        await this.ensureRenderDependencies();

        if (this.isTempMode) {
            // 临时模式：使用传入的临时子任务列表
            this.subtasks = [...this.tempSubtasks];
        } else {
            await this.loadSubtasks();
        }

        this.dialog = new Dialog({
            title: this.renderDialogTitle(),
            content: this.renderContent(true),
            width: "420px",
            destroyCallback: () => {
                this.dispose();
                this.onUpdate?.();
            }
        });
        this.closed = false;
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);

        this.renderSubtasks();
        this.bindEvents();
        this.updateSortDisplay();
    }

    public dispose() {
        this.closed = true;
        window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
    }

    private renderDialogTitle(): string {
        const baseTitle = this.isTempMode
            ? (i18n("newSubtasks") || "新建子任务")
            : (i18n("subtasks") || "子任务");
        const sortText = this.getActiveSortCriteria()
            .map(criterion => getSortCriterionName(criterion))
            .join(' > ');
        return sortText ? `${baseTitle} (${sortText})` : baseTitle;
    }

    private parseInstanceParentId(parentId: string): { targetParentId: string; instanceDate?: string } {
        const lastUnderscoreIndex = parentId.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = parentId.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                return {
                    targetParentId: parentId.substring(0, lastUnderscoreIndex),
                    instanceDate: potentialDate
                };
            }
        }
        return { targetParentId: parentId };
    }

    private async loadSubtasks() {
        const reminderData = await this.plugin.loadReminderData() || {};
        const allTasks = Object.values(reminderData) as any[];
        const { targetParentId, instanceDate } = this.parseInstanceParentId(this.parentId);
        const parentTemplate = reminderData[this.parentId] || reminderData[targetParentId];
        this.parentTaskCache = parentTemplate
            ? (instanceDate ? { ...parentTemplate, ...getRepeatInstanceState(parentTemplate, instanceDate) } : parentTemplate)
            : undefined;
        const combined: any[] = [];
        const seen = new Set<string>();

        const addTask = (task: any, templateParentId?: string) => {
            if (!task?.id || seen.has(task.id)) return;
            seen.add(task.id);
            
            let resolvedTask = task;
            if (task.repeat?.enabled && !task.isRepeatInstance) {
                const instanceDateVal = task.date;
                const defaultEndDate = task.endDate && task.date
                    ? addDaysToDate(instanceDateVal, getDaysDifference(task.date, task.endDate))
                    : undefined;
                const instanceEndDate = task.endDate !== undefined ? task.endDate : defaultEndDate;
                const reminderTimes = resolveRepeatReminderTimes(
                    task.reminderTimes,
                    instanceDateVal,
                    instanceEndDate,
                    task.date,
                    task.endDate
                );
                resolvedTask = {
                    ...task,
                    date: instanceDateVal,
                    endDate: instanceEndDate,
                    reminderTimes
                };
            }
            
            combined.push(resolvedTask);
            collectChildren(task.id, templateParentId);
        };

        const createGhostTask = (templateTask: any, renderedParentId: string) => {
            const ghostId = `${templateTask.id}_${instanceDate}`;
            const instanceState = getRepeatInstanceState(templateTask, instanceDate!) || {};
            const instanceDateVal = instanceState.date !== undefined ? instanceState.date : instanceDate!;
            const defaultEndDate = templateTask.endDate && templateTask.date
                ? addDaysToDate(instanceDateVal, getDaysDifference(templateTask.date, templateTask.endDate))
                : undefined;
            const instanceEndDate = instanceState.endDate !== undefined ? instanceState.endDate : defaultEndDate;
            const reminderTimesSource = instanceState.reminderTimes !== undefined ? instanceState.reminderTimes : templateTask.reminderTimes;
            const reminderTimes = instanceState.preservedFromSeriesEdit
                ? reminderTimesSource || undefined
                : resolveRepeatReminderTimes(
                    reminderTimesSource,
                    instanceDateVal,
                    instanceEndDate,
                    templateTask.date,
                    templateTask.endDate
                );

            return {
                ...templateTask,
                ...instanceState,
                id: ghostId,
                parentId: renderedParentId,
                isRepeatInstance: true,
                originalId: templateTask.id,
                completed: instanceState.completed || false,
                completedTime: instanceState.completedTime,
                title: instanceState.title || templateTask.title || i18n("untitledInParentheses"),
                date: instanceDateVal,
                endDate: instanceEndDate,
                time: instanceState.time !== undefined ? instanceState.time : templateTask.time,
                endTime: instanceState.endTime !== undefined ? instanceState.endTime : templateTask.endTime,
                reminderTimes
            };
        };

        const collectChildren = (renderedParentId: string, templateParentId?: string) => {
            // 真实实例子任务优先加入；这些任务可能只属于当前重复实例。
            allTasks
                .filter((task: any) => task.parentId === renderedParentId)
                .forEach((task: any) => addTask(task));

            if (!instanceDate || !templateParentId) return;

            // 重复实例：从模板任务生成 ghost 子任务，并沿模板树继续展开。
            allTasks
                .filter((task: any) => task.parentId === templateParentId)
                .filter((task: any) => !task.repeat?.excludeDates?.includes(instanceDate))
                .forEach((templateTask: any) => {
                    const ghostTask = createGhostTask(templateTask, renderedParentId);
                    addTask(ghostTask, templateTask.id);
                });
        };

        collectChildren(this.parentId, instanceDate ? targetParentId : undefined);
        this.subtasks = combined;
    }

    private normalizeSubtaskSortCriteria(criteria: any): SortCriterion[] {
        const availableMethods = new Set(['category', 'project', 'priority', 'time', 'startDate', 'endDate', 'completed', 'created', 'title']);
        return Array.isArray(criteria)
            ? criteria
                .filter((criterion: any) => criterion && availableMethods.has(criterion.method))
                .map((criterion: any) => ({
                    method: criterion.method,
                    order: criterion.order === 'desc' ? 'desc' : 'asc'
                }))
            : [];
    }

    private getActiveSortCriteria(): SortCriterion[] {
        return this.normalizeSubtaskSortCriteria(this.currentSortCriteria);
    }

    private compareSubtasks(a: any, b: any): number {
        const criteria = this.getActiveSortCriteria();
        for (const criterion of criteria) {
            const result = this.compareByCriterion(a, b, criterion);
            if (result !== 0) return result;
        }

        if (!criteria.some(criterion => criterion.method === 'priority')) {
            const sortDiff = this.getReminderSortValue(a) - this.getReminderSortValue(b);
            if (sortDiff !== 0) return sortDiff;
        }

        return this.compareByCreatedTime(a, b);
    }

    private compareByCriterion(a: any, b: any, criterion: SortCriterion): number {
        let result = 0;

        switch (criterion.method) {
            case 'time':
            case 'startDate': {
                const hasDateA = !!(a.date || a.endDate);
                const hasDateB = !!(b.date || b.endDate);
                if (!hasDateA && !hasDateB) {
                    result = 0;
                } else if (!hasDateA) {
                    result = 1;
                } else if (!hasDateB) {
                    result = -1;
                } else {
                    result = this.compareByTime(a, b);
                }
                break;
            }
            case 'endDate': {
                const hasEndDateA = !!(a.endDate || a.date);
                const hasEndDateB = !!(b.endDate || b.date);
                if (!hasEndDateA && !hasEndDateB) {
                    result = 0;
                } else if (!hasEndDateA) {
                    result = 1;
                } else if (!hasEndDateB) {
                    result = -1;
                } else {
                    result = this.compareByEndDate(a, b);
                }
                break;
            }
            case 'priority':
                result = this.compareByPriorityValue(a, b);
                if (result === 0) {
                    return this.getReminderSortValue(a) - this.getReminderSortValue(b);
                }
                return criterion.order === 'desc' ? -result : result;
            case 'project':
                return this.compareByProject(a, b, criterion.order);
            case 'title':
                result = this.compareByTitle(a, b);
                break;
            case 'created':
                result = this.compareByCreatedTime(a, b);
                break;
            case 'category':
                result = this.compareByCategory(a, b);
                break;
            case 'completed':
                return this.compareByCompletedTime(a, b, criterion.order);
            default:
                result = 0;
        }

        return criterion.order === 'desc' ? -result : result;
    }

    private compareByTime(a: any, b: any): number {
        const hasDateA = !!a.date;
        const hasDateB = !!b.date;

        if (!hasDateA && !hasDateB) return 0;
        if (!hasDateA) return 1;
        if (!hasDateB) return -1;

        const dateA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00'));
        const dateB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00'));

        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
            return isNaN(dateA.getTime()) ? 1 : -1;
        }

        const timeDiff = dateA.getTime() - dateB.getTime();
        if (timeDiff !== 0) return timeDiff;

        const isSpanningA = a.endDate && a.endDate !== a.date;
        const isSpanningB = b.endDate && b.endDate !== b.date;
        const isAllDayA = !a.time;
        const isAllDayB = !b.time;

        if (isSpanningA && !isSpanningB) return -1;
        if (!isSpanningA && isSpanningB) return 1;
        if (!isSpanningA && !isSpanningB) {
            if (!isAllDayA && isAllDayB) return -1;
            if (isAllDayA && !isAllDayB) return 1;
        }

        return 0;
    }

    private compareByEndDate(a: any, b: any): number {
        const endDateStrA = a.endDate || a.date;
        const endDateStrB = b.endDate || b.date;
        const hasDateA = !!endDateStrA;
        const hasDateB = !!endDateStrB;

        if (!hasDateA && !hasDateB) return 0;
        if (!hasDateA) return 1;
        if (!hasDateB) return -1;

        const timeStrA = a.endDate ? (a.endTime || a.time) : a.time;
        const timeStrB = b.endDate ? (b.endTime || b.time) : b.time;

        const dateA = new Date(endDateStrA + (timeStrA ? `T${timeStrA}` : 'T00:00'));
        const dateB = new Date(endDateStrB + (timeStrB ? `T${timeStrB}` : 'T00:00'));

        if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
            if (isNaN(dateA.getTime()) && isNaN(dateB.getTime())) return 0;
            return isNaN(dateA.getTime()) ? 1 : -1;
        }

        const timeDiff = dateA.getTime() - dateB.getTime();
        if (timeDiff !== 0) return timeDiff;

        const isSpanningA = a.endDate && a.date && a.endDate !== a.date;
        const isSpanningB = b.endDate && b.date && b.endDate !== b.date;
        const isAllDayA = !timeStrA;
        const isAllDayB = !timeStrB;

        if (isSpanningA && !isSpanningB) return -1;
        if (!isSpanningA && isSpanningB) return 1;
        if (!isSpanningA && !isSpanningB) {
            if (!isAllDayA && isAllDayB) return -1;
            if (isAllDayA && !isAllDayB) return 1;
        }

        return 0;
    }

    private compareByPriorityValue(a: any, b: any): number {
        const priorityOrder = { high: 3, medium: 2, low: 1, none: 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;
        return priorityA - priorityB;
    }

    private compareByTitle(a: any, b: any): number {
        return (a.title || '').toLowerCase().localeCompare((b.title || '').toLowerCase(), 'zh-CN');
    }

    private compareByCreatedTime(a: any, b: any): number {
        const timeA = a.createdTime ? new Date(a.createdTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const timeB = b.createdTime ? new Date(b.createdTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return timeA - timeB;
    }

    private getReminderSortValue(reminder: any): number {
        const sort = Number(reminder?.sort);
        return Number.isFinite(sort) ? sort : 0;
    }

    private getHighestPriorityCategoryId(task: any): string {
        const categoryId = task?.categoryId;
        if (!categoryId) return 'none';

        const categoryOrder = new Map<string, number>();
        this.categoryManager.getCategories().forEach((category: any, index: number) => {
            categoryOrder.set(category.id, index);
        });

        const ids = String(categoryId).split(',').map(id => id.trim()).filter(Boolean);
        if (ids.length === 0) return 'none';

        return ids.reduce((bestId, id) => {
            const bestOrder = categoryOrder.get(bestId) ?? Number.MAX_SAFE_INTEGER;
            const order = categoryOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
            return order < bestOrder ? id : bestId;
        }, ids[0]);
    }

    private compareByCategory(a: any, b: any): number {
        const categoryOrder = new Map<string, number>();
        this.categoryManager.getCategories().forEach((category: any, index: number) => {
            categoryOrder.set(category.id, index);
        });

        const catA = this.getHighestPriorityCategoryId(a);
        const catB = this.getHighestPriorityCategoryId(b);
        if (catA === 'none' && catB === 'none') return 0;
        if (catA === 'none') return 1;
        if (catB === 'none') return -1;

        return (categoryOrder.get(catA) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(catB) ?? Number.MAX_SAFE_INTEGER);
    }

    private compareByProject(a: any, b: any, order: 'asc' | 'desc' = 'asc'): number {
        const projectA = a?.projectId || '';
        const projectB = b?.projectId || '';
        if (!!projectA !== !!projectB) return projectA ? -1 : 1;
        if (!projectA && !projectB) return 0;

        const projectOrder = new Map<string, number>();
        this.projectManager.getProjects().forEach((project: any, index: number) => {
            projectOrder.set(project.id, index);
        });

        let result = (projectOrder.get(projectA) ?? Number.MAX_SAFE_INTEGER) - (projectOrder.get(projectB) ?? Number.MAX_SAFE_INTEGER);
        if (result === 0 && projectA !== projectB) {
            result = String(projectA).localeCompare(String(projectB));
        }
        return order === 'desc' ? -result : result;
    }

    private getCompletedTime(task: any): string | null {
        if (task?.completedTime) return task.completedTime;
        if (task?.isRepeatInstance) {
            const parsed = this.parseInstanceParentId(task.id);
            const instanceDate = task.instanceDate || parsed.instanceDate || task.date;
            return getRepeatInstanceCompletedTime(task, instanceDate) || null;
        }
        return null;
    }

    private compareByCompletedTime(a: any, b: any, order: 'asc' | 'desc' = 'desc'): number {
        const completedA = !!a.completed;
        const completedB = !!b.completed;
        if (completedA !== completedB) return completedA === (order === 'desc') ? -1 : 1;

        if (completedA) {
            const timeA = Date.parse(this.getCompletedTime(a) ?? '');
            const timeB = Date.parse(this.getCompletedTime(b) ?? '');
            const hasTimeA = Number.isFinite(timeA);
            const hasTimeB = Number.isFinite(timeB);
            if (hasTimeA && hasTimeB) return order === 'desc' ? timeB - timeA : timeA - timeB;
            if (hasTimeA !== hasTimeB) return hasTimeA ? -1 : 1;
        }

        const hasDateA = !!a.date;
        const hasDateB = !!b.date;
        if (hasDateA && !hasDateB) return -1;
        if (!hasDateA && hasDateB) return 1;
        if (hasDateA && hasDateB) {
            const dateValueA = new Date(a.date + (a.time ? `T${a.time}` : 'T00:00')).getTime();
            const dateValueB = new Date(b.date + (b.time ? `T${b.time}` : 'T00:00')).getTime();
            if (!isNaN(dateValueA) && !isNaN(dateValueB) && dateValueA !== dateValueB) {
                return order === 'desc' ? dateValueB - dateValueA : dateValueA - dateValueB;
            }
        }

        const createdDiff = this.compareByCreatedTime(a, b);
        if (createdDiff !== 0) return order === 'desc' ? -createdDiff : createdDiff;
        return (a.id || '').localeCompare(b.id || '');
    }

    private getVisibleSubtaskEntries(): Array<{ task: any; level: number }> {
        const childrenByParent = new Map<string, any[]>();
        this.subtasks.forEach(task => {
            const parentId = task.parentId || '';
            const children = childrenByParent.get(parentId) || [];
            children.push(task);
            childrenByParent.set(parentId, children);
        });
        childrenByParent.forEach(children => children.sort((a, b) => this.compareSubtasks(a, b)));

        const rootParentId = this.isTempMode ? '__TEMP_PARENT__' : this.parentId;
        const entries: Array<{ task: any; level: number }> = [];
        const visited = new Set<string>();

        const visit = (parentId: string, level: number, visible = true) => {
            const children = childrenByParent.get(parentId) || [];
            for (const child of children) {
                if (!child?.id || visited.has(child.id)) continue;
                visited.add(child.id);
                if (visible) entries.push({ task: child, level });
                visit(child.id, level + 1, visible && !this.collapsedSubtaskIds.has(child.id));
            }
        };

        visit(rootParentId, 0);

        // 容错：如果存在父级缺失的子任务，仍显示出来，避免数据异常导致列表空白。
        this.subtasks
            .filter(task => task?.id && !visited.has(task.id))
            .sort((a, b) => this.compareSubtasks(a, b))
            .forEach(task => entries.push({ task, level: 0 }));

        return entries;
    }

    private renderSubtasks(preserveRows = false, changedParentId?: string) {
        const listEl = this.getRootElement().querySelector("#subtasksList") as HTMLElement;
        if (!listEl) return;

        // 保留正在输入的节点，等保存或取消后再刷新列表。
        if (this.inlineTitle || this.dirtyInlineTitles.size) {
            this.subtaskRenderPending = true;
            return;
        }
        this.subtaskRenderPending = false;
        const taskIds = new Set(this.subtasks.map(task => task.id));
        for (const id of this.selectedSubtaskIds) {
            if (!taskIds.has(id)) this.selectedSubtaskIds.delete(id);
        }
        if (this.subtasks.length === 0) {
            listEl.innerHTML = this.readOnly ? `<div class="subtasks-dialog__empty">${i18n("noSubtasks")}</div>` : '';
            return;
        }

        const entries = this.getVisibleSubtaskEntries();
        const rootParentId = this.isTempMode ? '__TEMP_PARENT__' : this.parentId;
        const rootParentTask = this.getResolvedRootParentTask();
        const subtasksById = new Map(this.subtasks.filter(item => item?.id).map(item => [item.id, item]));
        const context: TaskRenderContext = {
            plugin: this.plugin,
            today: getLogicalDateString(),
            collapsedTasks: this.collapsedSubtaskIds,
            selectedTaskIds: this.selectedSubtaskIds,
            showProjectBadge: false,
            showCategoryBadge: true,
            showDocumentTitle: true,
            allTasks: this.subtasks,
            categoryManager: this.categoryManager,
            milestoneMap: this.milestoneMap,
            lute: this.lute,
            isMobileClient: this.plugin?.isInMobileApp,
            isTaskCollapsed: (task: any) => this.collapsedSubtaskIds.has(task.id),
            isReminderPinned: (t: any) => !!t.pinned,
            getTaskStatus: (t: any) => t.completed ? 'completed' : (t.kanbanStatus || t.status || 'todo')
        };
        const callbacks: TaskRenderCallbacks = {
            onCheckboxClick: async (task: any, checked: boolean, event: Event) => {
                if (await this.finishPendingChanges() === false) {
                    (event.target as HTMLInputElement).checked = !checked;
                    return;
                }
                await this.toggleSubtask(task.id, checked);
            },
            onCollapseClick: (task: any, collapsed: boolean) => {
                if (collapsed) {
                    this.collapsedSubtaskIds.add(task.id);
                } else {
                    this.collapsedSubtaskIds.delete(task.id);
                }
                this.renderSubtasks();
            },
            onMoreClick: (task: any, element: HTMLElement, event: MouseEvent) => {
                this.showSubtaskActionMenu(task, element, event);
            },
            onCardDoubleClick: (task: any, event: MouseEvent) => {
                if (event.ctrlKey || event.metaKey) return;
                void this.editSubtask(task);
            },
            onTitleClick: (task: any) => {
                const targetId = task.blockId || task.docId;
                if (targetId) {
                    void openBlock(targetId);
                }
            },
            onDocumentTitleClick: (_task: any, docId: string) => {
                void openBlock(docId);
            },
            onNoteClick: (task: any) => {
                this.editSubtask(task);
            },
            setupDragAndDrop: (taskEl: HTMLElement, task: any) => {
                this.setupSubtaskDragAndDrop(taskEl, task);
            }
        };

        const existingRows = new Map<string, HTMLElement>();
        if (preserveRows) {
            listEl.querySelectorAll<HTMLElement>(':scope > [data-task-id]').forEach(row => {
                if (row.dataset.taskId !== changedParentId) existingRows.set(row.dataset.taskId!, row);
            });
        }
        const rows = entries.map(({ task, level }) => {
            const existing = existingRows.get(task.id);
            if (existing) return existing;
            const taskContext: TaskRenderContext = {
                ...context,
                ...this.getSubtaskBadgeVisibility(task, rootParentId, rootParentTask, subtasksById),
            };
            const taskEl = TaskRenderer.render(task, taskContext, callbacks, level, this.subtasks);
            if (this.readOnly) {
                const checkbox = taskEl.querySelector<HTMLInputElement>('.reminder-task-checkbox');
                if (checkbox) checkbox.disabled = true;
            } else {
                this.bindSubtaskSelection(taskEl, task.id);
                if (!task.isSubscribed) this.bindInlineTitle(task, taskEl);
            }
            return taskEl;
        });

        if (!preserveRows) {
            listEl.replaceChildren(...rows);
            return;
        }
        // 保留未改动的行，失焦保存时仍能接收到用户在其他行的点击。
        const visibleRows = new Set(rows);
        Array.from(listEl.children).forEach(row => {
            if (!visibleRows.has(row as HTMLElement)) row.remove();
        });
        rows.forEach((row, index) => {
            if (row !== listEl.children[index]) listEl.insertBefore(row, listEl.children[index] ?? null);
        });
    }

    private bindSubtaskSelection(row: HTMLElement, id: string) {
        const isSelectionClick = (event: MouseEvent) => event.button === 0
            && (event.ctrlKey || event.metaKey)
            && !(event.target as Element).closest('button, input, select, a, [contenteditable], .reminder-item__progress-wrap');

        // 在标题输入框获得焦点前拦截多选手势，普通点击仍可行内编辑。
        row.addEventListener('mousedown', event => {
            if (isSelectionClick(event)) event.preventDefault();
        }, true);
        row.addEventListener('click', event => {
            if (!isSelectionClick(event)) return;
            event.preventDefault();
            event.stopPropagation();
            if (this.selectedSubtaskIds.has(id)) {
                this.selectedSubtaskIds.delete(id);
                row.classList.remove('reminder-item--selected');
            } else {
                this.selectedSubtaskIds.add(id);
                row.classList.add('reminder-item--selected');
            }
        }, true);
    }

    private showSubtaskActionMenu(task: any, element: HTMLElement, event: MouseEvent) {
        const menu = new Menu();
        if (!this.readOnly && this.selectedSubtaskIds.size > 0) {
            this.selectedSubtaskIds.add(task.id);
            element.closest('.reminder-item')?.classList.add('reminder-item--selected');
            const ids = Array.from(this.selectedSubtaskIds);
            menu.addItem({
                icon: 'iconTrashcan',
                label: i18n('delete'),
                click: () => { void this.confirmSubtaskDeletion(ids); },
            });
            menu.addItem({
                icon: 'iconClose',
                label: i18n('exitBatchSelect'),
                click: () => this.clearSubtaskSelection(),
            });
        } else {
            this.addSingleSubtaskActions(menu, task);
        }

        if (event.type === 'contextmenu') {
            menu.open({ x: event.clientX, y: event.clientY });
        } else {
            const rect = element.getBoundingClientRect();
            menu.open({ x: rect.right, y: rect.bottom + 4, isLeft: true });
        }
    }

    private clearSubtaskSelection() {
        this.selectedSubtaskIds.clear();
        this.getRootElement().querySelectorAll('#subtasksList > .reminder-item--selected').forEach(row => {
            row.classList.remove('reminder-item--selected');
        });
    }

    private addSingleSubtaskActions(menu: Menu, task: any) {
        if (!this.readOnly) {
            menu.addItem({
                icon: 'iconAdd',
                label: i18n('createSubtask'),
                click: () => { void this.startInlineSubtask(task.id); },
            });
            const boundBlockId = task.blockId || task.docId;
            if (boundBlockId && !task.isSubscribed) {
                menu.addItem({
                    icon: 'iconOpenWindow',
                    label: i18n('openBoundBlock'),
                    click: () => { void openBlock(boundBlockId); },
                });
            }
        }
        menu.addItem({
            icon: 'iconEdit',
            label: i18n(this.readOnly ? 'viewTasks' : 'edit'),
            click: () => { void this.editSubtask(task); },
        });
        if (!this.readOnly) {
            menu.addItem({
                icon: 'iconTrashcan',
                label: i18n('delete'),
                click: () => this.confirmSubtaskDeletion([task.id]),
            });
        }
    }

    private bindEvents() {
        const rootElement = this.getRootElement();

        rootElement.querySelectorAll("#addSubtaskTopBtn, #addSubtaskBtn").forEach(button => {
            button.addEventListener("click", () => { void this.startInlineSubtask(); });
        });

        rootElement.querySelector("#pasteSubtaskBtn")?.addEventListener("click", () => {
            this.showPasteSubtaskDialog();
        });

        rootElement.querySelector("#closeSubtasksBtn")?.addEventListener("click", async () => {
            if (await this.finishPendingChanges() !== false) this.dialog.destroy();
        });

        rootElement.querySelector("#sortBtn")?.addEventListener("click", (e) => {
            this.showSortMenu(e as MouseEvent);
        });
    }

    private async showSortMenu(_event: MouseEvent) {
        const dialog = new SortMenuDialog({
            plugin: this.plugin,
            currentCriteria: this.getActiveSortCriteria(),
            allowEmptyCriteria: true,
            onSave: criteria => this.applySortCriteria(criteria),
            onChange: criteria => this.applySortCriteria(criteria),
        });
        dialog.show();
    }

    private async applySortCriteria(criteria: SortCriterion[]) {
        this.currentSortCriteria = this.normalizeSubtaskSortCriteria(criteria);
        this.renderSubtasks();
        this.updateSortDisplay();
        try {
            await saveSubtaskSortCriteria(this.plugin, this.currentSortCriteria);
        } catch (error) {
            console.error('Failed to save subtask sort settings:', error);
            showMessage(i18n('saveFailed'), 3000, 'error');
        }
    }

    private updateSortDisplay() {
        const titleEl = this.embeddedContainer ? null : this.dialog.element.querySelector('.b3-dialog__header');
        if (titleEl) {
            titleEl.textContent = this.renderDialogTitle();
        }

        const sortBtn = this.getRootElement().querySelector('#sortBtn') as HTMLButtonElement;
        if (sortBtn) {
            sortBtn.classList.add('ariaLabel');
            const sortLabel = i18n('sortBy') || '排序';
            const sortText = this.getActiveSortCriteria().map(getSortCriterionName).join('<br>');
            sortBtn.setAttribute('aria-label', sortText ? `${sortLabel}:<br>${sortText}` : sortLabel);
        }
    }

    private bindInlineTitle(task: any, row: HTMLElement) {
        const title = row.querySelector('.reminder-item__title');
        if (!title) return;
        title.replaceWith(this.createInlineTitle(row, this.getRenderedParentId(task), task));
    }

    private async startInlineSubtask(parentId = this.getRenderedParentId(null)) {
        if (this.readOnly) return;
        if (this.inlineTitle && !this.inlineTitle.task && this.inlineTitle.parentId === parentId) {
            this.inlineTitle.input.focus();
            return;
        }
        if (await this.finishPendingChanges() !== false && !this.inlineTitle) this.openSubtaskDraft(parentId);
    }

    private positionSubtaskDraft(row: HTMLElement, parentId: string, afterTaskId?: string): string | undefined {
        const list = this.getRootElement().querySelector<HTMLElement>('#subtasksList');
        if (!list?.isConnected) return undefined;
        const rows = Array.from(list.children).filter((el): el is HTMLElement => el !== row);
        const parentRow = rows.find(item => item.dataset.taskId === parentId);
        const afterRow = afterTaskId ? rows.find(item => item.dataset.taskId === afterTaskId) : undefined;
        const level = parentRow ? Number(parentRow.getAttribute('data-level')) + 1 : 0;
        const firstOutsideLevel = afterRow ? level + 1 : level;
        let nextRow = (afterRow || parentRow)?.nextElementSibling ?? null;
        while (nextRow === row || (nextRow && Number(nextRow.getAttribute('data-level')) >= firstOutsideLevel)) {
            nextRow = nextRow.nextElementSibling;
        }
        row.setAttribute('data-level', String(level));
        row.style.marginLeft = `${level * 20}px`;
        if (row.parentElement !== list || row.nextElementSibling !== nextRow) {
            list.insertBefore(row, nextRow);
        }
        return afterRow ? afterTaskId : undefined;
    }

    private openSubtaskDraft(parentId: string, afterTaskId?: string) {
        const list = this.getRootElement().querySelector<HTMLElement>('#subtasksList');
        if (!list?.isConnected) return;
        if (this.collapsedSubtaskIds.delete(parentId)) this.renderSubtasks();

        const row = document.createElement('div');
        row.className = 'reminder-item subtasks-dialog__draft';
        row.innerHTML = `
            <div class="reminder-item__content">
                <div class="reminder-item__left-controls">
                    <input type="checkbox" class="reminder-task-checkbox" disabled aria-hidden="true">
                </div>
                <div class="reminder-item__info">
                    <div class="reminder-item__title-container">
                        <div class="reminder-item__title-row"></div>
                    </div>
                </div>
            </div>`;
        const resolvedAfterTaskId = this.positionSubtaskDraft(row, parentId, afterTaskId);
        const input = this.createInlineTitle(row, parentId, undefined, resolvedAfterTaskId);
        row.querySelector('.reminder-item__title-row')!.appendChild(input);
        input.focus();
    }

    private createInlineTitle(row: HTMLElement, parentId: string, task?: any, afterTaskId?: string): HTMLTextAreaElement {
        const input = document.createElement('textarea');
        input.className = 'subtasks-dialog__title';
        input.rows = 1;
        input.value = task?.title ?? '';
        input.setAttribute('aria-label', i18n('taskTitle'));
        input.setAttribute('enterkeyhint', 'enter');
        input.placeholder = i18n(task ? 'unnamedNote' : 'taskTitle');
        input.spellcheck = false;

        const id = task?.id ?? `reminder_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const editor: InlineSubtaskTitle = { id, input, row, parentId, task, afterTaskId, wasDraggable: row.draggable };
        for (const event of ['click', 'dblclick', 'dragstart']) {
            input.addEventListener(event, event => event.stopPropagation());
        }
        input.addEventListener('focus', () => {
            this.inlineTitle = editor;
            row.draggable = false;
        });
        input.addEventListener('input', () => {
            if (document.activeElement === input) this.inlineTitle = editor;
            this.dirtyInlineTitles.add(editor);
        });
        input.addEventListener('blur', () => {
            if (this.movingInlineDraft) return;
            row.draggable = editor.wasDraggable;
            if (this.inlineTitle === editor || this.dirtyInlineTitles.has(editor)) void this.finishInlineTitle(editor);
        });
        input.addEventListener('keydown', event => {
            if (event.isComposing || event.keyCode === 229) {
                event.stopPropagation();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (editor.committed) return;
                this.closeInlineTitle(editor);
                if (this.subtaskRenderPending) this.renderSubtasks();
                if (!input.isConnected) {
                    const field = editor.task && this.getRootElement().querySelector<HTMLElement>(`[data-task-id="${CSS.escape(editor.id)}"] .subtasks-dialog__title`);
                    (field || this.getRootElement().querySelector<HTMLElement>('#addSubtaskBtn'))?.focus();
                }
            } else if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
                event.preventDefault();
                event.stopPropagation();
                if (input.value.trim()) void this.finishInlineTitle(editor, true);
            } else if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                void this.handleInlineTitleTab(editor, event.shiftKey);
            }
        });
        return input;
    }

    private findPreviousSiblingTask(task: any): any | undefined {
        const parentId = this.getRenderedParentId(task);
        const siblings = this.subtasks
            .filter(item => this.getRenderedParentId(item) === parentId)
            .sort((a, b) => this.compareSubtasks(a, b));
        const index = siblings.findIndex(item => item.id === task.id);
        return index > 0 ? siblings[index - 1] : undefined;
    }

    private findPreviousSiblingForDraft(editor: InlineSubtaskTitle): any | undefined {
        const siblings = this.subtasks
            .filter(item => this.getRenderedParentId(item) === editor.parentId)
            .sort((a, b) => this.compareSubtasks(a, b));
        if (!siblings.length) return undefined;
        if (editor.afterTaskId) {
            const afterIndex = siblings.findIndex(item => item.id === editor.afterTaskId);
            if (afterIndex >= 0) return siblings[afterIndex];
        }
        return siblings[siblings.length - 1];
    }

    private getOutdentTarget(task: any): { currentParent: any; targetParentId: string } | undefined {
        if (this.readOnly || !task?.id || task.isSubscribed || (task.isRepeatInstance && task.originalId)) return undefined;
        const rootParentId = this.getRenderedParentId(null);
        const currentParentId = this.getRenderedParentId(task);
        if (currentParentId === rootParentId) return undefined;
        const currentParent = this.subtasks.find(item => item.id === currentParentId);
        if (!currentParent) return undefined;
        const targetParentId = this.getRenderedParentId(currentParent);
        if (targetParentId !== rootParentId) {
            const targetParent = this.subtasks.find(item => item.id === targetParentId);
            if (!targetParent || targetParent.isSubscribed) return undefined;
            if (this.wouldCreateSubtaskCycle(task.id, targetParentId, id => this.subtasks.find(item => item.id === id)?.parentId)) {
                return undefined;
            }
        }
        return { currentParent, targetParentId };
    }

    private focusSubtaskTitle(taskId: string, selectionStart?: number | null, selectionEnd?: number | null) {
        const input = this.getRootElement().querySelector<HTMLTextAreaElement>(
            `[data-task-id="${CSS.escape(taskId)}"] .subtasks-dialog__title`
        );
        if (!input) return;
        input.focus();
        if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
            const max = input.value.length;
            input.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max));
        }
    }

    private async handleInlineTitleTab(editor: InlineSubtaskTitle, outdent: boolean) {
        if (this.readOnly || this.closed || editor.committed || this.pendingSubtaskDrop || this.pendingSubtaskDeletion) return;

        const selectionStart = editor.input.selectionStart;
        const selectionEnd = editor.input.selectionEnd;

        if (!editor.task) {
            if (outdent) {
                const rootParentId = this.getRenderedParentId(null);
                if (editor.parentId === rootParentId) return;
                const currentParent = this.subtasks.find(item => item.id === editor.parentId);
                if (!currentParent) return;
                const newParentId = this.getRenderedParentId(currentParent);
                editor.parentId = newParentId;
                this.movingInlineDraft = true;
                try {
                    editor.afterTaskId = this.positionSubtaskDraft(editor.row, newParentId, currentParent.id);
                    editor.input.focus();
                    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
                        editor.input.setSelectionRange(selectionStart, selectionEnd);
                    }
                } finally {
                    this.movingInlineDraft = false;
                }
                return;
            }

            const targetParent = this.findPreviousSiblingForDraft(editor);
            if (!targetParent || targetParent.isSubscribed) return;

            if (this.collapsedSubtaskIds.has(targetParent.id)) {
                const value = editor.input.value;
                const wasDirty = this.dirtyInlineTitles.has(editor);
                this.collapsedSubtaskIds.delete(targetParent.id);
                this.movingInlineDraft = true;
                try {
                    this.closeInlineTitle(editor);
                    this.renderSubtasks();
                    this.openSubtaskDraft(targetParent.id);
                    if (this.inlineTitle) {
                        this.inlineTitle.input.value = value;
                        if (wasDirty) this.dirtyInlineTitles.add(this.inlineTitle);
                        if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
                            this.inlineTitle.input.setSelectionRange(selectionStart, selectionEnd);
                        }
                    }
                } finally {
                    this.movingInlineDraft = false;
                }
                return;
            }

            editor.parentId = targetParent.id;
            editor.afterTaskId = undefined;
            this.movingInlineDraft = true;
            try {
                this.positionSubtaskDraft(editor.row, targetParent.id);
                editor.input.focus();
                if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
                    editor.input.setSelectionRange(selectionStart, selectionEnd);
                }
            } finally {
                this.movingInlineDraft = false;
            }
            return;
        }

        const task = this.subtasks.find(item => item.id === editor.task.id) || editor.task;
        const previousSibling = outdent ? undefined : this.findPreviousSiblingTask(task);
        if (outdent) {
            if (!this.getOutdentTarget(task)) return;
        } else if (!this.canNestSubtaskDrop(task, previousSibling)) {
            return;
        }

        const taskId = task.id;
        const run = async (): Promise<boolean> => {
            try {
                if (await this.finishInlineTitles() === false || this.closed) return false;
                if (outdent) {
                    await this.outdentSubtask(taskId);
                } else {
                    await this.nestSubtask(taskId, previousSibling.id);
                }
                if (!this.closed) {
                    this.focusSubtaskTitle(taskId, selectionStart, selectionEnd);
                }
                return true;
            } catch (error) {
                console.error('Failed to change subtask level:', error);
                showMessage(i18n('operationFailed'), 3000, 'error');
                return false;
            }
        };

        this.pendingSubtaskDrop = run();
        try {
            await this.pendingSubtaskDrop;
        } finally {
            this.pendingSubtaskDrop = undefined;
        }
    }

    public finishPendingChanges(): Promise<boolean> | undefined {
        return this.pendingSubtaskDeletion ?? this.pendingSubtaskDrop ?? this.finishInlineTitles();
    }

    private finishInlineTitles(): Promise<boolean> | undefined {
        const editors = new Set(this.dirtyInlineTitles);
        if (this.inlineTitle) editors.add(this.inlineTitle);
        const promises: Array<Promise<boolean>> = [];
        if (this.pendingTitleSave) promises.push(this.pendingTitleSave);
        for (const editor of editors) {
            promises.push(this.finishInlineTitle(editor));
        }
        if (!promises.length) return undefined;
        return Promise.all(promises).then(results => results.every(Boolean));
    }

    private enqueueTitlePersistence(task: () => Promise<boolean>): Promise<boolean> {
        const previous = this.pendingTitleSave;
        const pending = previous ? previous.then(task, task) : task();
        this.pendingTitleSave = pending;
        const clearPending = () => {
            if (this.pendingTitleSave === pending) this.pendingTitleSave = undefined;
        };
        void pending.then(clearPending, clearPending);
        return pending;
    }

    private getOptimisticParentTask(parentId: string): any | null {
        if (this.isTempMode) {
            return parentId === '__TEMP_PARENT__'
                ? this.getResolvedTempParentTask()
                : (this.subtasks.find(item => item.id === parentId) ?? null);
        }
        if (parentId === this.parentId) return this.parentTaskCache ?? null;
        return this.subtasks.find(item => item.id === parentId) ?? this.parentTaskCache ?? null;
    }

    private finishInlineTitle(editor: InlineSubtaskTitle, createNext = false): Promise<boolean> {
        if (editor.committed) return this.pendingTitleSave ?? Promise.resolve(true);

        const title = editor.input.value.trim();
        const previousTitle = String(editor.task?.title ?? '').trim();
        const changed = !!title && title !== previousTitle;
        const continueEditing = createNext && document.activeElement === editor.input;

        if (!editor.task) {
            editor.committed = true;
        }

        let optimisticTask: any;
        const rawPreviousTitle = editor.task?.title;
        if (changed) {
            if (editor.task) {
                editor.task.title = title;
                const visibleTask = this.subtasks.find(item => item.id === editor.task.id);
                if (visibleTask) visibleTask.title = title;
            } else {
                const parent = this.getOptimisticParentTask(editor.parentId);
                if (this.isTempMode && editor.parentId !== '__TEMP_PARENT__' && !parent) {
                    showMessage(i18n('createFailed'), 3000, 'error');
                    editor.committed = false;
                    return Promise.resolve(false);
                }
                const built = this.buildInlineSubtask(editor.id, title, editor.parentId, parent);
                optimisticTask = this.isTempMode ? { ...built, isTempSubtask: true } : built;
                const sortChanges = this.placeInlineSubtask(optimisticTask, editor.afterTaskId);
                this.applyInlineSortChanges(sortChanges);
                this.subtasks.push(optimisticTask);
            }
        }

        const pendingRender = this.subtaskRenderPending;
        this.closeInlineTitle(editor);
        const titleSort = changed && editor.task && this.getActiveSortCriteria().some(criterion => criterion.method === 'title');
        if (pendingRender || (changed && !editor.task) || titleSort) {
            this.renderSubtasks(!pendingRender, editor.task ? undefined : editor.parentId);
        }
        if (continueEditing) {
            const afterTaskId = this.getActiveSortCriteria().length === 0 ? editor.id : undefined;
            this.openSubtaskDraft(editor.parentId, afterTaskId);
        }

        if (!changed) return Promise.resolve(true);

        if (this.isTempMode) {
            this.onTempSubtasksUpdate?.([...this.subtasks]);
            this.onUpdate?.();
            return Promise.resolve(true);
        }

        const payload = {
            id: editor.id,
            task: editor.task,
            parentId: editor.parentId,
            afterTaskId: editor.afterTaskId,
            title,
            optimisticTask,
            previousTitle: rawPreviousTitle,
        };
        return this.enqueueTitlePersistence(() => this.persistInlineTitle(payload));
    }

    private closeInlineTitle(editor: InlineSubtaskTitle) {
        if (this.inlineTitle === editor) this.inlineTitle = undefined;
        this.dirtyInlineTitles.delete(editor);
        if (editor.task) editor.input.value = editor.task.title ?? '';
        else editor.row.remove();
    }

    private buildInlineSubtask(id: string, title: string, parentId: string, parent: any, savedTasks?: any[]) {
        const { instanceDate } = this.parseInstanceParentId(parentId);
        const sourceTasks = savedTasks ?? this.subtasks;
        const sort = sourceTasks
            .reduce((max, task) => task?.id !== id && task?.parentId === parentId ? Math.max(max, this.getReminderSortValue(task)) : max, 0) + 1000;
        const parentStatus = parent?.kanbanStatus;
        const kanbanStatus = parentStatus && parentStatus !== 'completed' && parentStatus !== 'abandoned' ? parentStatus : 'doing';
        return {
            id,
            parentId,
            title,
            date: instanceDate,
            projectId: parent?.projectId || this.plugin.settings?.unassignedTasksProjectId,
            customGroupId: parent?.customGroupId,
            milestoneId: parent?.milestoneId,
            categoryId: parent?.categoryId,
            priority: parent?.priority || 'none',
            kanbanStatus,
            completed: false,
            createdAt: new Date().toISOString(),
            sort,
        };
    }

    private placeInlineSubtask(newTask: any, afterTaskId?: string, data?: Record<string, any>): Map<string, number> {
        const sortChanges = new Map<string, number>();
        if (!afterTaskId || this.getActiveSortCriteria().length !== 0) return sortChanges;

        const parentId = newTask.parentId;
        const siblings = data
            ? Object.values(data).filter(task => task?.id && task.parentId === parentId)
            : this.subtasks.filter(task => this.getRenderedParentId(task) === parentId);
        if (data) {
            const { targetParentId, instanceDate } = this.parseInstanceParentId(parentId);
            for (const task of this.subtasks) {
                if (!instanceDate || task.parentId !== parentId || data[task.id] || !task.isRepeatInstance) continue;
                const template = data[task.originalId];
                const state = template && getRepeatInstanceState(template, instanceDate);
                if (template?.parentId === targetParentId && !template.repeat?.excludeDates?.includes(instanceDate) && !state?.deleted) {
                    siblings.push({ ...template, ...state, id: task.id });
                }
            }
        }
        siblings.sort((a, b) => this.compareSubtasks(a, b));
        const index = siblings.findIndex(task => task.id === afterTaskId);
        if (index < 0) return sortChanges;

        const lower = this.getReminderSortValue(siblings[index]);
        const next = siblings[index + 1];
        const upper = next ? this.getReminderSortValue(next) : lower + 2000;
        const midpoint = lower / 2 + upper / 2;
        if (midpoint > lower && midpoint < upper) {
            newTask.sort = midpoint;
        } else {
            // 旧任务可能没有独立的 sort 值，按当前同级顺序留出插入位置。
            siblings.splice(index + 1, 0, newTask);
            siblings.forEach((task, position) => {
                const sort = (position + 1) * 10;
                if (task === newTask) newTask.sort = sort;
                else if (this.getReminderSortValue(task) !== sort) sortChanges.set(task.id, sort);
            });
        }
        return sortChanges;
    }

    private applyInlineSortChanges(sortChanges: Map<string, number>) {
        for (const task of this.subtasks) {
            const sort = sortChanges.get(task.id);
            if (sort !== undefined) task.sort = sort;
        }
    }

    private async persistInlineTitle(payload: {
        id: string;
        task?: any;
        parentId: string;
        afterTaskId?: string;
        title: string;
        optimisticTask?: any;
        previousTitle?: string;
    }): Promise<boolean> {
        const { id, task, parentId, afterTaskId, title, optimisticTask, previousTitle } = payload;
        try {
            const data = await this.plugin.loadReminderData(true) || {};
            let savedTask: any;
            let original: any;
            let sortChanges = new Map<string, number>();

            if (task) {
                const direct = data[task.id];
                original = direct || data[this.getSubtaskStorageId(task)!];
                if (!original) throw new Error('The subtask no longer exists');
                savedTask = structuredClone(original);
                const { instanceDate } = this.parseInstanceParentId(task.id);
                if (!direct && instanceDate) {
                    if (original.repeat?.excludeDates?.includes(instanceDate) || getRepeatInstanceState(original, instanceDate)?.deleted) {
                        throw new Error('The subtask instance is no longer visible');
                    }
                    patchRepeatInstanceState(savedTask, instanceDate, { title });
                } else {
                    savedTask.title = title;
                    savedTask.updatedAt = new Date().toISOString();
                }
            } else {
                const { targetParentId, instanceDate } = this.parseInstanceParentId(parentId);
                const template = data[parentId] || data[targetParentId];
                if (!template) throw new Error('The parent task no longer exists');
                const parent = instanceDate ? { ...template, ...getRepeatInstanceState(template, instanceDate) } : template;
                if (data[id]) {
                    savedTask = { ...data[id], title };
                } else {
                    savedTask = this.buildInlineSubtask(id, title, parentId, parent, Object.values(data));
                    if (optimisticTask?.createdAt) savedTask.createdAt = optimisticTask.createdAt;
                    sortChanges = this.placeInlineSubtask(savedTask, afterTaskId, data);
                }
            }

            const nextData = { ...data, [savedTask.id]: savedTask };
            for (const [siblingId, sort] of sortChanges) {
                if (nextData[siblingId]) {
                    nextData[siblingId] = { ...nextData[siblingId], sort };
                } else {
                    const { targetParentId, instanceDate } = this.parseInstanceParentId(siblingId);
                    const template = nextData[targetParentId] ? structuredClone(nextData[targetParentId]) : undefined;
                    if (template && instanceDate) {
                        patchRepeatInstanceState(template, instanceDate, { sort });
                        nextData[targetParentId] = template;
                    }
                }
            }
            await this.plugin.saveReminderData(nextData);
            if (sortChanges.size) this.applyInlineSortChanges(sortChanges);
            if (!task) {
                const visibleTask = this.subtasks.find(item => item.id === savedTask.id);
                if (visibleTask) {
                    const currentTitle = visibleTask.title;
                    Object.assign(visibleTask, savedTask, { title: currentTitle });
                } else {
                    this.subtasks.push(savedTask);
                }
            }
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: { projectId: task?.projectId || savedTask.projectId } }));
            void this.plugin.updateMobileNotification?.(savedTask, original)?.catch((error: unknown) => {
                console.warn('Failed to update subtask notifications:', error);
            });
            if (!this.closed) {
                this.onUpdate?.();
            }
            return true;
        } catch (error) {
            console.error('Failed to save inline subtask title:', error);
            showMessage(i18n(task ? 'updateReminderFailed' : 'createFailed'), 3000, 'error');
            if (!this.closed) {
                if (task) {
                    if (task.title === title) task.title = previousTitle ?? '';
                    const visibleTask = this.subtasks.find(item => item.id === task.id);
                    if (visibleTask && visibleTask.title === title) visibleTask.title = previousTitle ?? '';
                    const input = this.getRootElement().querySelector<HTMLTextAreaElement>(
                        `[data-task-id="${CSS.escape(task.id)}"] .subtasks-dialog__title`
                    );
                    if (input && document.activeElement !== input && input.value.trim() === title) {
                        input.value = previousTitle ?? '';
                    }
                } else {
                    this.subtasks = this.subtasks.filter(item => item.id !== id);
                    this.renderSubtasks();
                }
            }
            return false;
        }
    }

    private async editSubtask(task: any) {
        if (await this.finishPendingChanges() === false) return;
        const dialog = new QuickReminderDialog(undefined, undefined, async (modifiedReminder) => {
            if (!modifiedReminder) return;

            // 乐观更新：直接更新本地数组中的任务
            const index = this.subtasks.findIndex(t => t.id === modifiedReminder.id);
            if (index !== -1) {
                this.subtasks[index] = { ...this.subtasks[index], ...modifiedReminder };
                this.renderSubtasks();

                // 临时模式：通知外部更新
                if (this.isTempMode && this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
                if (this.onUpdate) {
                    this.onUpdate();
                }
            }

            if (!this.isTempMode) {
                // 正常模式：延迟重新加载以确保数据已保存到存储
                setTimeout(async () => {
                    await this.loadSubtasks();
                    this.renderSubtasks();
                    if (this.onUpdate) {
                        this.onUpdate();
                    }
                }, 100);
            }
        }, undefined, {
            mode: 'edit',
            reminder: task,
            plugin: this.plugin,
            skipSave: this.isTempMode, // 临时模式下跳过保存，通过回调更新
            tempParentName: this.isTempMode && task.parentId === '__TEMP_PARENT__'
                ? (typeof this.tempParentName === 'function' ? this.tempParentName() : this.tempParentName)
                : undefined,
            readOnly: this.readOnly
        });
        dialog.show();
    }

    private async toggleSubtask(id: string, completed: boolean) {
        // 临时模式：只更新本地状态
        if (this.isTempMode) {
            const index = this.subtasks.findIndex(t => t.id === id);
            if (index !== -1) {
                this.subtasks[index].completed = completed;
                if (completed) {
                    this.subtasks[index].completedTime = new Date().toISOString();
                } else {
                    delete this.subtasks[index].completedTime;
                }
                this.renderSubtasks();
                if (this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
            }
            return;
        }

        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析 ID，判断是否为实例
        let targetId = id;
        let date: string | undefined;
        const lastUnderscoreIndex = id.lastIndexOf('_');
        if (lastUnderscoreIndex !== -1) {
            const potentialDate = id.substring(lastUnderscoreIndex + 1);
            if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                targetId = id.substring(0, lastUnderscoreIndex);
                date = potentialDate;
            }
        }

        const task = reminderData[targetId];
        if (!task) return;

        // 保存任务信息用于后续事件触发
        const taskProjectId = task.projectId;

        if (date) {
            // 重复实例逻辑：将完成状态记录在 repeat 对象中
            setRepeatInstanceCompletion(task, date, completed);
        } else {
            // 普通任务逻辑
            task.completed = completed;
            if (completed) {
                task.completedTime = new Date().toISOString();
            } else {
                delete task.completedTime;
            }
        }

        await this.plugin.saveReminderData(reminderData);
        await this.loadSubtasks();
        this.renderSubtasks();
        
        // 触发更新事件通知其他组件
        if (taskProjectId) {
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: {
                    projectId: taskProjectId
                }
            }));
        }
        
        // 通知父组件更新
        if (this.onUpdate) {
            this.onUpdate();
        }
    }

    private async confirmSubtaskDeletion(ids: string[]) {
        if (this.readOnly || this.closed || this.pendingSubtaskDeletion) return;
        const isBatch = ids.length > 1;
        const failureMessage = i18n(isBatch ? 'batchDeleteFailed' : 'deleteFailed');
        try {
            const confirmTitle = i18n(isBatch ? 'confirmBatchDelete' : 'confirmDeleteTitle');
            const message = isBatch
                ? i18n('confirmBatchDeleteSubtasksMessage', { count: String(ids.length) })
                : await this.getSingleSubtaskDeletionMessage(ids[0]);
            if (!message || this.closed || this.pendingSubtaskDeletion) return;

            confirm(confirmTitle, message, () => {
                if (this.closed || this.pendingSubtaskDeletion) return;
                this.pendingSubtaskDeletion = this.deleteSubtasks(ids).catch(error => {
                    console.error('Failed to delete subtasks:', error);
                    showMessage(failureMessage, 3000, 'error');
                    return false;
                }).finally(() => {
                    this.pendingSubtaskDeletion = undefined;
                });
                return this.pendingSubtaskDeletion;
            });
        } catch (error) {
            console.error('Failed to prepare subtask deletion:', error);
            showMessage(failureMessage, 3000, 'error');
        }
    }

    private async getSingleSubtaskDeletionMessage(id: string): Promise<string | undefined> {
        const data = this.isTempMode
            ? Object.fromEntries(this.subtasks.map(task => [task.id, task]))
            : await this.plugin.loadReminderData() || {};
        const instance = data[id] ? null : parseReminderInstanceId(id);
        const task = data[instance?.originalId ?? id];
        if (!task) return;

        const title = String(task.title || i18n('untitledTask'));
        if (instance) {
            return i18n(this.isInstanceEdit && !this.isModifyAllInstances
                ? 'hideSubtaskInstanceConfirm' : 'deleteSubtaskTemplateConfirm', { title });
        }

        const message = i18n(this.isTempMode ? 'deleteTemporarySubtaskConfirm' : 'confirmDeleteTask', { title });
        const childrenCount = collectTaskDeletionIds(data, id).size - 1;
        return childrenCount > 0 ? `${message}\n${i18n('includesNSubtasks', { count: String(childrenCount) })}` : message;
    }

    private async deleteSubtasks(ids: string[]): Promise<boolean> {
        if (await this.pendingSubtaskDrop === false || await this.finishInlineTitles() === false || this.closed) return false;

        if (this.isTempMode) {
            const data = Object.fromEntries(this.subtasks.map(task => [task.id, task]));
            const removed = collectTaskDeletionIds(data, ids);
            this.subtasks = this.subtasks.filter(task => !removed.has(task.id));
            this.clearSubtaskSelection();
            this.renderSubtasks();
            this.onTempSubtasksUpdate?.([...this.subtasks]);
            return true;
        }

        // 确认后读取最新数据，先写盘，再更新视图及通知。
        const current = await this.plugin.loadReminderData() || {};
        const next = { ...current };
        const permanentIds = new Set<string>();
        const notificationIds = new Set<string>();
        for (const id of ids) {
            const instance = parseReminderInstanceId(id);
            const stored = current[id];
            const template = instance && current[instance.originalId];
            if (stored) permanentIds.add(id);
            if (!instance || !template) continue;

            // 已落盘的同日期记录可能覆盖模板生成的子任务，一起排除才能防止旧行重新出现。
            const inheritsFromTemplate = !stored || (template.parentId
                && stored.parentId === `${template.parentId}_${instance.instanceDate}`);
            if (inheritsFromTemplate && this.isInstanceEdit && !this.isModifyAllInstances) {
                const templateId = instance.originalId;
                if (next[templateId] === template) next[templateId] = cloneTaskData(template);
                excludeRepeatInstance(next[templateId], instance.instanceDate);
                notificationIds.add(id);
            } else if (!stored) {
                permanentIds.add(instance.originalId);
            }
        }

        const blockIds = new Set<string>();
        const removed = collectTaskDeletionIds(current, permanentIds);
        for (const id of removed) {
            const task = current[id];
            for (const record of [task, ...Object.values(task.repeat?.instances || {})] as any[]) {
                const blockId = record?.blockId || record?.docId;
                if (blockId) blockIds.add(blockId);
            }
            delete next[id];
            notificationIds.add(id);
        }
        if (notificationIds.size === 0) return true;

        const undo = new TaskActionUndo(this.plugin, current);
        await undo.save(next);
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
        const effects = [
            ...Array.from(notificationIds, id => () => this.plugin.cancelMobileNotification?.(id)),
            ...Array.from(blockIds, id => () => updateBindBlockAtrrs(id, this.plugin)),
        ];
        void Promise.allSettled(effects.map(effect => Promise.resolve().then(effect))).then(results => {
            for (const result of results) {
                if (result.status === 'rejected') console.warn('Failed to refresh deleted subtask:', result.reason);
            }
        });
        if (!this.closed) {
            try {
                await this.loadSubtasks();
                if (!this.closed) {
                    this.clearSubtaskSelection();
                    this.renderSubtasks();
                    this.onUpdate?.();
                }
            } catch (error) {
                console.warn('Failed to refresh subtask list after deletion:', error);
            }
        }
        undo.show(i18n(removed.size > 0 ? 'deleteSuccess' : 'hideSuccess'));
        return true;
    }

    private setupSubtaskDragAndDrop(element: HTMLElement, task: any) {
        if (this.readOnly || this.plugin?.isInMobileApp) {
            element.draggable = false;
            element.style.cursor = 'default';
            return;
        }

        element.draggable = true;
        element.style.cursor = 'grab';

        element.addEventListener('dragstart', (e) => {
            if (this.pendingSubtaskDrop) {
                e.preventDefault();
                return;
            }
            this.draggingId = task.id;
            element.classList.add('dragging');
            element.style.opacity = '0.5';
            element.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', task.id);
                e.dataTransfer.setData('application/x-reminder', JSON.stringify({
                    id: task.id,
                    title: task.title || '',
                    parentId: task.parentId || null
                }));
            }
        });

        element.addEventListener('dragend', () => {
            this.draggingId = null;
            element.classList.remove('dragging');
            element.style.opacity = '';
            element.style.cursor = 'grab';
            this.hideSubtaskDropIndicator();
        });

        element.addEventListener('dragover', (e) => {
            const draggedTask = this.subtasks.find(t => t.id === this.draggingId);
            const position = this.getSubtaskDropPosition(element, e, draggedTask, task);
            if (!position) {
                this.hideSubtaskDropIndicator();
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            this.showSubtaskDropIndicator(element, position);
        });

        element.addEventListener('drop', async (e) => {
            const draggedTask = this.subtasks.find(t => t.id === this.draggingId);
            const position = this.getSubtaskDropPosition(element, e, draggedTask, task);
            this.hideSubtaskDropIndicator();
            if (!position) return;

            e.preventDefault();
            e.stopPropagation();
            this.draggingId = null;
            this.pendingSubtaskDrop = this.applySubtaskDrop(draggedTask.id, task.id, position);
            try {
                await this.pendingSubtaskDrop;
            } finally {
                this.pendingSubtaskDrop = undefined;
            }
        });

        element.addEventListener('dragleave', (e) => {
            if (this.subtaskDropTarget !== element) return;
            const rect = element.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                this.hideSubtaskDropIndicator();
            }
        });
    }

    private isDragDisabledBySortMode(): boolean {
        const primaryMethod = this.getActiveSortCriteria()[0]?.method;
        return primaryMethod === 'created' || primaryMethod === 'title';
    }

    private getRenderedParentId(task: any): string {
        return task?.parentId || (this.isTempMode ? '__TEMP_PARENT__' : this.parentId);
    }

    private getSubtaskStorageId(task: any): string | undefined {
        if (!task?.id) return undefined;
        if (task.originalId) return task.originalId;

        const parsed = this.parseInstanceParentId(task.id);
        return parsed.instanceDate ? parsed.targetParentId : task.id;
    }

    private getTimeSortGroupKey(task: any): string {
        const baseDate = task?.date || task?.endDate;
        if (!baseDate) return '__NO_DATE__';
        return this.getSubtaskLogicalDate(baseDate, task?.time || task?.endTime);
    }

    private getSubtaskLogicalDate(dateStr?: string, timeStr?: string): string {
        if (!dateStr) return '';
        if (!timeStr) return dateStr;

        try {
            return getLogicalDateString(new Date(`${dateStr}T${timeStr}`));
        } catch (error) {
            return dateStr;
        }
    }

    private canSortSubtaskDrop(draggedTask: any, targetTask: any): boolean {
        if (this.isDragDisabledBySortMode()) return false;
        if (!draggedTask?.id || !targetTask?.id || draggedTask.id === targetTask.id) return false;
        if (this.getRenderedParentId(draggedTask) !== this.getRenderedParentId(targetTask)) return false;

        const primaryMethod = this.getActiveSortCriteria()[0]?.method;
        if (primaryMethod === 'time') {
            return this.getTimeSortGroupKey(draggedTask) === this.getTimeSortGroupKey(targetTask);
        }
        if (primaryMethod === 'category') {
            return this.getHighestPriorityCategoryId(draggedTask) === this.getHighestPriorityCategoryId(targetTask);
        }

        return true;
    }

    private canNestSubtaskDrop(draggedTask: any, targetTask: any): boolean {
        if (this.readOnly || !draggedTask?.id || !targetTask?.id || draggedTask.parentId === targetTask.id) return false;
        // 实例中从模板生成的行没有可独立修改的父任务字段。
        if (draggedTask.isSubscribed || targetTask.isSubscribed || (draggedTask.isRepeatInstance && draggedTask.originalId)) return false;
        return !this.wouldCreateSubtaskCycle(draggedTask.id, targetTask.id, id => this.subtasks.find(task => task.id === id)?.parentId);
    }

    private wouldCreateSubtaskCycle(childId: string, parentId: string, getParentId: (id: string) => string | undefined): boolean {
        const visited = new Set([childId]);
        let currentId: string | undefined = parentId;
        while (currentId) {
            if (visited.has(currentId)) return true;
            visited.add(currentId);
            currentId = getParentId(currentId);
        }
        return false;
    }

    private getSubtaskDropPosition(element: HTMLElement, event: DragEvent, draggedTask: any, targetTask: any): SubtaskDropPosition | undefined {
        if (this.pendingSubtaskDrop || !draggedTask || draggedTask.id === targetTask.id) return;
        const rect = element.getBoundingClientRect();
        const offset = event.clientY - rect.top;
        if (offset >= rect.height * 0.25 && offset <= rect.height * 0.75) {
            return this.canNestSubtaskDrop(draggedTask, targetTask) ? 'inside' : undefined;
        }
        if (this.canSortSubtaskDrop(draggedTask, targetTask)) return offset < rect.height / 2 ? 'before' : 'after';
    }

    private showSubtaskDropIndicator(element: HTMLElement, position: SubtaskDropPosition) {
        if (this.subtaskDropTarget !== element) {
            this.hideSubtaskDropIndicator();
            this.subtaskDropTarget = element;
        }
        element.dataset.subtaskDrop = position;
    }

    private hideSubtaskDropIndicator() {
        this.subtaskDropTarget?.removeAttribute('data-subtask-drop');
        this.subtaskDropTarget = undefined;
    }

    private async applySubtaskDrop(draggingId: string, targetId: string, position: SubtaskDropPosition): Promise<boolean> {
        try {
            if (await this.finishInlineTitles() === false) return false;
            if (position === 'inside') await this.nestSubtask(draggingId, targetId);
            else await this.reorderSubtasks(draggingId, targetId, position === 'before');
            return true;
        } catch (error) {
            console.error('Failed to move subtask:', error);
            showMessage(i18n('operationFailed'), 3000, 'error');
            return false;
        }
    }

    private async nestSubtask(draggingId: string, targetId: string) {
        const draggedTask = this.subtasks.find(task => task.id === draggingId);
        const targetTask = this.subtasks.find(task => task.id === targetId);
        if (!this.canNestSubtaskDrop(draggedTask, targetTask)) return;

        const lastChildSort = (tasks: any[]) => tasks.reduce((max, task) =>
            task?.parentId === targetId ? Math.max(max, this.getReminderSortValue(task)) : max, 0);
        const localSort = lastChildSort(this.subtasks);
        if (this.isTempMode) {
            draggedTask.parentId = targetId;
            draggedTask.sort = localSort + 10;
            this.onTempSubtasksUpdate?.([...this.subtasks]);
        } else {
            const data = await this.plugin.loadReminderData(true) || {};
            const source = data[draggingId];
            const ghostTarget = !data[targetId] && targetTask.isRepeatInstance && targetTask.originalId;
            const target = ghostTarget ? data[targetTask.originalId] : data[targetId];
            if (!source || !target || source.isSubscribed || target.isSubscribed) throw new Error('Subtask or target is no longer available');
            if (ghostTarget) {
                const { instanceDate } = this.parseInstanceParentId(targetId);
                if (!instanceDate || target.repeat?.excludeDates?.includes(instanceDate) || getRepeatInstanceState(target, instanceDate)?.deleted) {
                    throw new Error('The target instance is no longer available');
                }
            }
            const getSavedParentId = (id: string): string | undefined => {
                if (data[id]) return data[id].parentId;
                const templateId = this.parseInstanceParentId(id).targetParentId;
                return templateId === draggingId ? draggingId : data[templateId]?.parentId;
            };
            if (this.wouldCreateSubtaskCycle(draggingId, targetId, getSavedParentId)) throw new Error('Circular subtask relationship');
            if (source.parentId !== targetId) {
                const sort = Math.max(localSort, lastChildSort(Object.values(data))) + 10;
                await this.plugin.saveReminderData({ ...data, [draggingId]: { ...source, parentId: targetId, sort } });
            }
            await this.loadSubtasks();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: {} }));
        }
        this.collapsedSubtaskIds.delete(targetId);
        this.renderSubtasks();
        this.onUpdate?.();
    }

    private async outdentSubtask(taskId: string) {
        const task = this.subtasks.find(item => item.id === taskId);
        const target = this.getOutdentTarget(task);
        if (!task || !target) return;

        const { currentParent, targetParentId } = target;
        const rootParentId = this.getRenderedParentId(null);
        const lastChildSort = (tasks: any[]) => tasks.reduce((max, item) =>
            item?.id !== taskId && item?.parentId === targetParentId ? Math.max(max, this.getReminderSortValue(item)) : max, 0);

        if (this.isTempMode) {
            const moved = { ...task, parentId: targetParentId, sort: lastChildSort(this.subtasks) + 10 };
            const sortChanges = this.placeInlineSubtask(moved, currentParent.id);
            this.applyInlineSortChanges(sortChanges);
            task.parentId = targetParentId;
            task.sort = moved.sort;
            this.onTempSubtasksUpdate?.([...this.subtasks]);
        } else {
            const data = await this.plugin.loadReminderData(true) || {};
            const source = data[taskId];
            if (!source || source.isSubscribed) throw new Error('Subtask is no longer available');

            if (targetParentId === rootParentId) {
                const { targetParentId: baseRootId } = this.parseInstanceParentId(rootParentId);
                if (!data[rootParentId] && !data[baseRootId]) throw new Error('The parent task no longer exists');
            } else {
                const targetTask = this.subtasks.find(item => item.id === targetParentId);
                const ghostTarget = !data[targetParentId] && targetTask?.isRepeatInstance && targetTask.originalId;
                const targetRecord = ghostTarget ? data[targetTask.originalId] : data[targetParentId];
                if (!targetRecord || targetRecord.isSubscribed) throw new Error('The target parent is no longer available');
                if (ghostTarget) {
                    const { instanceDate } = this.parseInstanceParentId(targetParentId);
                    if (!instanceDate || targetRecord.repeat?.excludeDates?.includes(instanceDate) || getRepeatInstanceState(targetRecord, instanceDate)?.deleted) {
                        throw new Error('The target instance is no longer available');
                    }
                }
                const getSavedParentId = (id: string): string | undefined => {
                    if (data[id]) return data[id].parentId;
                    const templateId = this.parseInstanceParentId(id).targetParentId;
                    return templateId === taskId ? taskId : data[templateId]?.parentId;
                };
                if (this.wouldCreateSubtaskCycle(taskId, targetParentId, getSavedParentId)) throw new Error('Circular subtask relationship');
            }

            const moved = {
                ...source,
                parentId: targetParentId,
                sort: Math.max(lastChildSort(this.subtasks), lastChildSort(Object.values(data))) + 10,
            };
            const sortChanges = this.placeInlineSubtask(moved, currentParent.id, data);
            const nextData: Record<string, any> = { ...data, [taskId]: moved };
            for (const [siblingId, sort] of sortChanges) {
                if (siblingId === taskId) continue;
                if (nextData[siblingId]) {
                    nextData[siblingId] = { ...nextData[siblingId], sort };
                } else {
                    const { targetParentId: templateId, instanceDate } = this.parseInstanceParentId(siblingId);
                    const template = nextData[templateId] ? structuredClone(nextData[templateId]) : undefined;
                    if (template && instanceDate) {
                        patchRepeatInstanceState(template, instanceDate, { sort });
                        nextData[templateId] = template;
                    }
                }
            }
            await this.plugin.saveReminderData(nextData);
            await this.loadSubtasks();
            window.dispatchEvent(new CustomEvent('reminderUpdated', { detail: {} }));
        }

        this.renderSubtasks();
        this.onUpdate?.();
    }

    private async reorderSubtasks(draggingId: string, targetId: string, insertBefore: boolean) {
        const movedTask = this.subtasks.find(t => t.id === draggingId);
        const targetTask = this.subtasks.find(t => t.id === targetId);
        if (!movedTask || !targetTask || !this.canSortSubtaskDrop(movedTask, targetTask)) return;

        const hasPriorityCriterion = this.getActiveSortCriteria().some(criterion => criterion.method === 'priority');
        if (hasPriorityCriterion && movedTask.priority !== targetTask.priority) {
            movedTask.priority = targetTask.priority || 'none';
        }

        const targetParentId = this.getRenderedParentId(targetTask);
        const siblingTasks = this.subtasks
            .filter(task => this.getRenderedParentId(task) === targetParentId)
            .sort((a, b) => this.compareSubtasks(a, b));

        const draggingIndex = siblingTasks.findIndex(t => t.id === draggingId);
        const targetIndex = siblingTasks.findIndex(t => t.id === targetId);
        if (draggingIndex === -1 || targetIndex === -1) return;

        let insertIndex = insertBefore ? targetIndex : targetIndex + 1;
        const [reorderedTask] = siblingTasks.splice(draggingIndex, 1);

        if (draggingIndex < insertIndex) {
            insertIndex--;
        }

        const validInsertIndex = Math.max(0, Math.min(insertIndex, siblingTasks.length));
        siblingTasks.splice(validInsertIndex, 0, reorderedTask);

        siblingTasks.forEach((task: any, index: number) => {
            task.sort = (index + 1) * 10;
        });

        if (this.isTempMode) {
            // 临时模式：只更新本地状态
            if (this.onTempSubtasksUpdate) {
                this.onTempSubtasksUpdate([...this.subtasks]);
            }
            if (this.onUpdate) {
                this.onUpdate();
            }
            this.renderSubtasks();
            return;
        }

        // 正常模式：保存到数据库
        const reminderData = await this.plugin.loadReminderData() || {};
        siblingTasks.forEach((task: any, index: number) => {
            const storageId = this.getSubtaskStorageId(task);
            if (storageId && reminderData[storageId]) {
                reminderData[storageId].sort = (index + 1) * 10;
            }
        });

        // 同步优先级修改到存储
        const movedStorageId = this.getSubtaskStorageId(movedTask);
        if (movedStorageId && reminderData[movedStorageId]) {
            reminderData[movedStorageId].priority = movedTask.priority;
        }

        await this.plugin.saveReminderData(reminderData);
        await this.loadSubtasks();
        this.renderSubtasks();

        // 触发更新事件通知其他组件
        if (movedTask?.projectId) {
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: {
                    projectId: movedTask.projectId
                }
            }));
        }
    }

    // 显示粘贴新建子任务对话框
    private async showPasteSubtaskDialog() {
        if (await this.finishPendingChanges() === false) return;
        let parentTask: any = null;
        let instanceDate: string | undefined = undefined;
        
        if (!this.isTempMode) {
            const reminderData = await this.plugin.loadReminderData() || {};
            
            // 解析可能存在的实例信息 (id_YYYY-MM-DD)
            let targetParentId = this.parentId;
            const lastUnderscoreIndex = this.parentId.lastIndexOf('_');
            if (lastUnderscoreIndex !== -1) {
                const potentialDate = this.parentId.substring(lastUnderscoreIndex + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                    targetParentId = this.parentId.substring(0, lastUnderscoreIndex);
                    instanceDate = potentialDate;
                }
            }
            
            // 获取原始父任务（支持重复实例）
            const originalTask = reminderData[targetParentId];
            
            // 判断是否为编辑单个实例模式（非编辑所有实例）
            const isEditingSingleInstance = this.isInstanceEdit && !this.isModifyAllInstances;
            
            if (isEditingSingleInstance) {
                // 编辑单个实例：创建一个虚拟父任务对象，使用实例ID作为parentId
                // 这样创建的子任务会是普通子任务，只属于当前实例
                parentTask = {
                    ...originalTask,
                    id: this.parentId, // 使用实例ID
                    originalId: targetParentId, // 保留原始任务ID
                    isRepeatInstance: true
                };
            } else {
                // 编辑所有实例或普通任务：使用原始任务
                // 这样创建的子任务会成为ghost子任务模板
                parentTask = originalTask;
            }
        }

        const pasteDialog = new PasteTaskDialog({
            plugin: this.plugin,
            parentTask: parentTask,
            projectId: parentTask?.projectId,
            customGroupId: parentTask?.customGroupId,
            defaultStatus: parentTask?.kanbanStatus || 'todo',
            defaultSetDate: parentTask?.isRepeatInstance ? true : undefined,
            defaultDateStr: parentTask?.isRepeatInstance ? instanceDate : undefined,
            isTempMode: this.isTempMode,
            onTasksCreated: (createdTasks) => {
                // 临时模式：将创建的任务添加到本地数组
                for (const task of createdTasks) {
                    const exists = this.subtasks.some(t => t.id === task.id);
                    if (!exists) {
                        this.subtasks.push(task);
                    }
                }
                this.subtasks.sort((a, b) => (a.sort || 0) - (b.sort || 0));
                this.renderSubtasks();
                if (this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
                if (this.onUpdate) {
                    this.onUpdate();
                }
            },
            onSuccess: async (totalCount) => {
                if (!this.isTempMode) {
                    showMessage(`${totalCount} ${i18n("subtasksCreated") || "个子任务已创建"}`);
                    // 重新加载子任务列表
                    await this.loadSubtasks();
                    this.renderSubtasks();
                    // 触发更新事件通知其他组件
                    const projectId = parentTask?.projectId;
                    window.dispatchEvent(new CustomEvent('reminderUpdated', {
                        detail: { projectId }
                    }));
                }
                if (this.onUpdate) {
                    this.onUpdate();
                }
            },
            onError: (error) => {
                console.error("Failed to create subtasks in batch:", error);
                showMessage(i18n("batchCreateFailed") || "批量创建任务失败");
            }
        });

        await pasteDialog.show();
    }
}
