import { Dialog, showMessage, confirm } from "siyuan";
import { openBlock } from "../api";
import { i18n } from "../pluginInstance";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { PasteTaskDialog } from "./PasteTaskDialog";
import { SortMenuDialog } from "./SortMenuDialog";
import { TaskRenderer, type TaskRenderCallbacks, type TaskRenderContext } from "./render/TaskRenderer";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { getLogicalDateString } from "../utils/dateUtils";
import { getSortCriterionName, loadSortConfig, saveSortConfig, type SortCriterion } from "../utils/sortConfig";

export class SubtasksDialog {
    private dialog: Dialog;
    private embeddedContainer?: HTMLElement;
    private parentId: string;
    private plugin: any;
    private subtasks: any[] = [];
    private onUpdate?: () => void;
    private draggingId: string | null = null;
    private currentSortCriteria: SortCriterion[] = [{ method: 'time', order: 'asc' }];
    private isTempMode: boolean = false; // 是否为临时模式（新建任务的子任务）
    private tempSubtasks: any[] = []; // 临时子任务列表
    private onTempSubtasksUpdate?: (subtasks: any[]) => void; // 临时子任务更新回调
    private isInstanceEdit: boolean = false; // 是否为编辑单个重复实例模式
    private isModifyAllInstances: boolean = false; // 是否为编辑所有重复实例模式
    private collapsedSubtaskIds: Set<string> = new Set();
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private milestoneMap: Map<string, any> = new Map();
    private lute: any;

    constructor(
        parentId: string,
        plugin: any,
        onUpdate?: () => void,
        tempSubtasks: any[] = [],
        onTempSubtasksUpdate?: (subtasks: any[]) => void,
        isInstanceEdit?: boolean,
        isModifyAllInstances?: boolean
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
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);
        try {
            this.lute = (window as any).Lute?.New?.();
        } catch (error) {
            console.warn('初始化 Markdown 渲染器失败:', error);
        }
    }

    private getRootElement(): HTMLElement {
        return this.embeddedContainer || this.dialog.element;
    }

    private async ensureRenderDependencies() {
        try {
            const sortConfig = await loadSortConfig(this.plugin);
            this.currentSortCriteria = this.normalizeSubtaskSortCriteria(sortConfig.criteria);
        } catch (error) {
            console.warn('加载子任务排序配置失败:', error);
        }

        try {
            await this.categoryManager.initialize();
        } catch (error) {
            console.warn('初始化分类管理器失败:', error);
        }

        try {
            await this.projectManager.initialize();
            this.buildMilestoneMap();
        } catch (error) {
            console.warn('初始化项目管理器失败:', error);
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
                    <div class="subtasks-header" style="display: flex; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--b3-border-color); flex-wrap: wrap;">
                        <button id="sortBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>
                            ${i18n("sort") || "排序"}
                        </button>
                        <button id="pasteSubtaskBtn" class="b3-button b3-button--outline">
                            <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                            ${i18n("pasteSubtasks") || "粘贴新建"}
                        </button>
                        <button id="addSubtaskBtn" class="b3-button b3-button--primary">
                            <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                            ${i18n("createSubtask") || "创建子任务"}
                        </button>
                    </div>
                    <div id="subtasksList" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column;min-height: 100px;max-height: 500px;">
                        <!-- 子任务列表 -->
                    </div>
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

        container.innerHTML = this.renderContent(false);
        this.renderSubtasks();
        this.bindEvents();
        this.updateSortDisplay();
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
                if (this.onUpdate) this.onUpdate();
            }
        });

        this.renderSubtasks();
        this.bindEvents();
        this.updateSortDisplay();
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
        const combined: any[] = [];
        const seen = new Set<string>();

        const addTask = (task: any, templateParentId?: string) => {
            if (!task?.id || seen.has(task.id)) return;
            seen.add(task.id);
            combined.push(task);
            collectChildren(task.id, templateParentId);
        };

        const createGhostTask = (templateTask: any, renderedParentId: string) => {
            const ghostId = `${templateTask.id}_${instanceDate}`;
            const instanceMod = templateTask.repeat?.instanceModifications?.[instanceDate!] || {};
            return {
                ...templateTask,
                ...instanceMod,
                id: ghostId,
                parentId: renderedParentId,
                isRepeatInstance: true,
                originalId: templateTask.id,
                completed: templateTask.repeat?.completedInstances?.includes(instanceDate!) || false,
                title: instanceMod.title || templateTask.title || '(无标题)',
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
        const availableMethods = new Set(['category', 'project', 'priority', 'time', 'completed', 'created', 'title']);
        const normalized = Array.isArray(criteria)
            ? criteria
                .filter((criterion: any) => criterion && availableMethods.has(criterion.method))
                .map((criterion: any) => ({
                    method: criterion.method,
                    order: criterion.order === 'desc' ? 'desc' : 'asc'
                }))
            : [];

        return normalized.length > 0 ? normalized : [{ method: 'time', order: 'asc' }];
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
            case 'time': {
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
        return reminder?.sort || 0;
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
            return task.repeat?.completedTimes?.[instanceDate] || null;
        }
        return null;
    }

    private compareByCompletedTime(a: any, b: any, order: 'asc' | 'desc' = 'desc'): number {
        const completedTimeA = this.getCompletedTime(a);
        const completedTimeB = this.getCompletedTime(b);

        if (completedTimeA && completedTimeB) {
            const timeA = new Date(completedTimeA).getTime();
            const timeB = new Date(completedTimeB).getTime();
            return order === 'desc' ? timeB - timeA : timeA - timeB;
        }
        if (completedTimeA && !completedTimeB) return -1;
        if (!completedTimeA && completedTimeB) return 1;

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

        const visit = (parentId: string, level: number) => {
            const children = childrenByParent.get(parentId) || [];
            for (const child of children) {
                if (!child?.id || visited.has(child.id)) continue;
                visited.add(child.id);
                entries.push({ task: child, level });
                if (!this.collapsedSubtaskIds.has(child.id)) {
                    visit(child.id, level + 1);
                }
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

    private buildProjectCache(tasks: any[]): Map<string, any> {
        const projectCache = new Map<string, any>();
        tasks.forEach(task => {
            if (!task?.projectId) return;
            const project = this.projectManager.getProjectById(task.projectId);
            if (!project) return;
            const customGroup = (project.customGroups || []).find((group: any) => group.id === task.customGroupId);
            projectCache.set(task.id, {
                project,
                customGroup,
                customGroupName: customGroup?.name
            });
        });
        return projectCache;
    }

    private renderSubtasks() {
        const listEl = this.getRootElement().querySelector("#subtasksList") as HTMLElement;
        if (!listEl) return;

        if (this.subtasks.length === 0) {
            listEl.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface-light); padding: 20px;">${i18n("noSubtasks") || "暂无子任务"}</div>`;
            return;
        }

        const entries = this.getVisibleSubtaskEntries();
        const projectCache = this.buildProjectCache(this.subtasks);
        const fragment = document.createDocumentFragment();
        const context: TaskRenderContext = {
            plugin: this.plugin,
            today: getLogicalDateString(),
            collapsedTasks: this.collapsedSubtaskIds,
            showProjectBadge: true,
            showCategoryBadge: true,
            showDocumentTitle: true,
            allTasks: this.subtasks,
            categoryManager: this.categoryManager,
            milestoneMap: this.milestoneMap,
            lute: this.lute,
            projectCache,
            isMobileClient: this.plugin?.isInMobileApp,
            isTaskCollapsed: (task: any) => this.collapsedSubtaskIds.has(task.id)
        };
        const callbacks: TaskRenderCallbacks = {
            onCheckboxClick: (task: any, checked: boolean) => {
                void this.toggleSubtask(task.id, checked);
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
            onCardDoubleClick: (task: any) => {
                this.editSubtask(task);
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

        entries.forEach(({ task, level }) => {
            const taskEl = TaskRenderer.render(task, context, callbacks, level, this.subtasks);
            fragment.appendChild(taskEl);
        });

        listEl.innerHTML = '';
        listEl.appendChild(fragment);
    }

    private showSubtaskActionMenu(task: any, element: HTMLElement, event: MouseEvent) {
        document.querySelector('.subtasks-task-menu')?.remove();

        const menuEl = document.createElement('div');
        menuEl.className = 'subtasks-task-menu';
        menuEl.style.cssText = `
            position: fixed;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 6px;
            padding: 6px;
            z-index: 1000;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            display: flex;
            flex-direction: column;
            gap: 4px;
            min-width: 120px;
        `;

        const createButton = (label: string, icon: string, action: () => void) => {
            const button = document.createElement('button');
            button.className = 'b3-button b3-button--text';
            button.style.cssText = 'justify-content: flex-start; gap: 6px; width: 100%;';
            button.innerHTML = `<svg class="b3-button__icon"><use xlink:href="${icon}"></use></svg><span>${label}</span>`;
            button.addEventListener('click', () => {
                menuEl.remove();
                action();
            });
            menuEl.appendChild(button);
        };

        createButton(i18n("createSubtask") || "创建子任务", '#iconAdd', () => {
            void this.addSubtask(task);
        });
        createButton(i18n("edit") || "编辑", '#iconEdit', () => this.editSubtask(task));
        createButton(i18n("delete") || "删除", '#iconTrashcan', () => this.deleteSubtask(task.id));

        document.body.appendChild(menuEl);
        const rect = element.getBoundingClientRect();
        const left = event.type === 'contextmenu' ? event.clientX : rect.right;
        const top = event.type === 'contextmenu' ? event.clientY : rect.bottom + 4;
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;

        const closeMenu = () => {
            menuEl.remove();
            document.removeEventListener('click', handleClickOutside);
        };
        const handleClickOutside = (e: MouseEvent) => {
            if (!menuEl.contains(e.target as Node)) {
                closeMenu();
            }
        };
        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }

    private bindEvents() {
        const rootElement = this.getRootElement();

        rootElement.querySelector("#addSubtaskBtn")?.addEventListener("click", () => {
            this.addSubtask();
        });

        rootElement.querySelector("#pasteSubtaskBtn")?.addEventListener("click", () => {
            this.showPasteSubtaskDialog();
        });

        rootElement.querySelector("#closeSubtasksBtn")?.addEventListener("click", () => {
            this.dialog.destroy();
        });

        rootElement.querySelector("#sortBtn")?.addEventListener("click", (e) => {
            this.showSortMenu(e as MouseEvent);
        });
    }

    private async showSortMenu(_event: MouseEvent) {
        const dialog = new SortMenuDialog({
            plugin: this.plugin,
            currentCriteria: this.getActiveSortCriteria(),
            onSave: async (criteria) => {
                await this.applySortCriteria(criteria, false);
            },
            onChange: async (criteria) => {
                await this.applySortCriteria(criteria, false);
            }
        });
        dialog.show();
    }

    private async applySortCriteria(criteria: SortCriterion[], saveGlobalConfig: boolean = false) {
        this.currentSortCriteria = this.normalizeSubtaskSortCriteria(criteria);
        this.renderSubtasks();
        this.updateSortDisplay();

        if (saveGlobalConfig) {
            await saveSortConfig(this.plugin, this.currentSortCriteria);
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
            sortBtn.setAttribute('aria-label', `${i18n("sortBy") || "排序"}:<br>${this.getActiveSortCriteria().map(c => getSortCriterionName(c)).join('<br>')}`);
        }
    }

    private async addSubtask(parentTaskOverride?: any) {
        const parentIdForNew = parentTaskOverride?.id || (this.isTempMode ? '__TEMP_PARENT__' : this.parentId);
        let parentTask: any = parentTaskOverride || null;

        if (!this.isTempMode && !parentTask) {
            const reminderData = await this.plugin.loadReminderData() || {};
            const { targetParentId } = this.parseInstanceParentId(parentIdForNew);

            // 获取原始父任务（支持重复实例）
            parentTask = reminderData[targetParentId];
        }

        // 只按同一父任务下的兄弟节点计算 sort，避免多层子任务互相影响排序。
        const siblingSubtasks = this.subtasks.filter(t => t.parentId === parentIdForNew);
        const maxSort = siblingSubtasks.reduce((max, t) => Math.max(max, t.sort || 0), 0);
        const newSort = maxSort + 1000;

        const dialog = new QuickReminderDialog(undefined, undefined, async (newReminder) => {
            if (!newReminder) return;

            // 设置 sort 值为最大值+1000，确保放在最后
            newReminder.sort = newSort;

            if (this.isTempMode) {
                // 临时模式：将新子任务添加到临时列表
                newReminder.parentId = parentIdForNew;
                newReminder.isTempSubtask = true;

                // 检查是否已存在（避免重复添加）
                const exists = this.subtasks.some(t => t.id === newReminder.id);
                if (!exists) {
                    this.subtasks.push(newReminder);
                    this.renderSubtasks();
                }
                if (this.onTempSubtasksUpdate) {
                    this.onTempSubtasksUpdate([...this.subtasks]);
                }
                if (this.onUpdate) {
                    this.onUpdate();
                }
            } else {
                const exists = this.subtasks.some(t => t.id === newReminder.id);
                if (!exists) {
                    this.subtasks.push(newReminder);
                    this.renderSubtasks();
                }
                // 延迟重新加载以确保数据已保存到存储
                setTimeout(async () => {
                    await this.loadSubtasks();
                    this.renderSubtasks();
                    if (this.onUpdate) {
                        this.onUpdate();
                    }
                }, 100);
            }
        }, undefined, {
            mode: 'quick',
            defaultParentId: parentIdForNew,
            // 继承父任务的项目、分组、状态等属性
            defaultProjectId: parentTask?.projectId,
            defaultCustomGroupId: parentTask?.customGroupId,
            defaultStatus: parentTask?.kanbanStatus,
            defaultMilestoneId: parentTask?.milestoneId,
            defaultCategoryId: parentTask?.categoryId,
            defaultPriority: parentTask?.priority,
            defaultSort: newSort, // 传入预计算的 sort 值，确保保存时一致
            plugin: this.plugin,
            skipSave: this.isTempMode // 临时模式下跳过保存，通过回调返回数据
        });
        dialog.show();
    }

    private async editSubtask(task: any) {
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
            skipSave: this.isTempMode // 临时模式下跳过保存，通过回调更新
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
            if (!task.repeat) task.repeat = {};
            if (!task.repeat.completedInstances) task.repeat.completedInstances = [];
            if (!task.repeat.completedTimes) task.repeat.completedTimes = {};

            if (completed) {
                if (!task.repeat.completedInstances.includes(date)) {
                    task.repeat.completedInstances.push(date);
                }
                task.repeat.completedTimes[date] = new Date().toISOString();
            } else {
                const idx = task.repeat.completedInstances.indexOf(date);
                if (idx > -1) {
                    task.repeat.completedInstances.splice(idx, 1);
                }
                delete task.repeat.completedTimes[date];
            }
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

    private async deleteSubtask(id: string) {
        // 临时模式：仅从本地列表删除
        if (this.isTempMode) {
            const index = this.subtasks.findIndex(t => t.id === id);
            if (index !== -1) {
                const taskTitle = this.subtasks[index].title || '无标题';
                confirm(
                    i18n("confirmDelete") || "确认删除",
                    `确定要删除临时子任务 "${taskTitle}" 吗？`,
                    async () => {
                        this.subtasks.splice(index, 1);
                        this.renderSubtasks();
                        if (this.onTempSubtasksUpdate) {
                            this.onTempSubtasksUpdate([...this.subtasks]);
                        }
                    }
                );
            }
            return;
        }

        const reminderData = await this.plugin.loadReminderData() || {};

        // 解析 ID
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

        // 定义执行删除的函数
        const doDelete = async () => {
            // Recursive delete
            const deleteRecursive = async (idToDelete: string) => {
                const children = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === idToDelete);
                for (const child of children) {
                    await deleteRecursive(child.id);
                }
                // 取消移动端通知
                await this.plugin.cancelMobileNotification(idToDelete);
                delete reminderData[idToDelete];
            };

            await deleteRecursive(targetId);
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
            
            showMessage(i18n("deleteSuccess"));
        };

        if (date) {
            // 判断是否为编辑单个实例模式（非编辑所有实例）
            const isEditingSingleInstance = this.isInstanceEdit && !this.isModifyAllInstances;
            
            if (isEditingSingleInstance) {
                // 编辑单个实例：将此 ghost 子任务在当前日期标记为隐藏
                // 而不是删除整个模板
                confirm(
                    i18n("confirmDelete") || "确认删除",
                    `确定要在此日期隐藏子任务 "${task.title}" 吗？\n此操作仅影响当前日期的实例，不会影响其他日期的该子任务。`,
                    async () => {
                        // 将 ghost 子任务标记为在当前日期隐藏
                        if (!task.repeat) task.repeat = {};
                        if (!task.repeat.excludeDates) task.repeat.excludeDates = [];
                        if (!task.repeat.excludeDates.includes(date)) {
                            task.repeat.excludeDates.push(date);
                        }
                        await this.plugin.saveReminderData(reminderData);
                        await this.loadSubtasks();
                        this.renderSubtasks();
                        
                        // 触发更新事件
                        if (taskProjectId) {
                            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                                detail: { projectId: taskProjectId }
                            }));
                        }
                        if (this.onUpdate) {
                            this.onUpdate();
                        }
                        
                        showMessage(i18n("hideSuccess") || "已隐藏");
                    }
                );
            } else {
                // 编辑所有实例：删除整个模板任务
                const ghostConfirmMsg = `确定要删除此子任务的原始模板吗？\n删除后所有日期的该子任务都将消失。\n\n任务标题: ${task.title}`;
                confirm(
                    i18n("confirmDelete") || "确认删除",
                    ghostConfirmMsg,
                    async () => {
                        await doDelete();
                    }
                );
            }
            return;
        }

        // Count subtasks of this task
        const childrenCount = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === targetId).length;
        let confirmMsg = i18n("confirmDeleteTask", { title: task.title }) || `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`;
        if (childrenCount > 0) {
            confirmMsg += `\n${i18n("includesNSubtasks", { count: childrenCount.toString() }) || `此任务包含 ${childrenCount} 个子任务，它们也将被一并删除。`}`;
        }

        // Use siyuan confirm
        confirm(
            i18n("confirmDelete") || "确认删除",
            confirmMsg,
            async () => {
                await doDelete();
            }
        );
    }

    private setupSubtaskDragAndDrop(element: HTMLElement, task: any) {
        if (this.plugin?.isInMobileApp || this.isDragDisabledBySortMode()) {
            element.draggable = false;
            element.style.cursor = 'default';
            return;
        }

        element.draggable = true;
        element.style.cursor = 'grab';

        element.addEventListener('dragstart', (e) => {
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
            if (!draggedTask || !this.canSortSubtaskDrop(draggedTask, task)) {
                this.hideSubtaskDropIndicator();
                return;
            }

            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
            }
            this.showSubtaskDropIndicator(element, this.getSubtaskDropPosition(element, e));
        });

        element.addEventListener('drop', async (e) => {
            const draggedTask = this.subtasks.find(t => t.id === this.draggingId);
            if (!draggedTask || !this.canSortSubtaskDrop(draggedTask, task)) {
                this.hideSubtaskDropIndicator();
                return;
            }

            e.preventDefault();
            const insertBefore = this.getSubtaskDropPosition(element, e) === 'before';
            await this.reorderSubtasks(draggedTask.id, task.id, insertBefore);
            this.hideSubtaskDropIndicator();
        });

        element.addEventListener('dragleave', (e) => {
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

    private getSubtaskDropPosition(element: HTMLElement, event: DragEvent): 'before' | 'after' {
        const rect = element.getBoundingClientRect();
        return event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    }

    private showSubtaskDropIndicator(element: HTMLElement, position: 'before' | 'after') {
        this.hideSubtaskDropIndicator();

        const indicator = document.createElement('div');
        indicator.className = 'subtasks-drop-indicator';
        indicator.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            ${position === 'before' ? 'top: 0;' : 'bottom: 0;'}
            height: 2px;
            background-color: var(--b3-theme-primary);
            z-index: 1000;
            pointer-events: none;
        `;
        element.style.position = 'relative';
        if (position === 'before') {
            element.insertBefore(indicator, element.firstChild);
        } else {
            element.appendChild(indicator);
        }
    }

    private hideSubtaskDropIndicator() {
        document.querySelectorAll('.subtasks-drop-indicator').forEach(indicator => indicator.remove());
    }

    private async reorderSubtasks(draggingId: string, targetId: string, insertBefore: boolean = true) {
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
            showMessage(i18n("sortUpdated") || "排序已更新");
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

        showMessage(i18n("sortUpdated") || "排序已更新");
    }

    // 显示粘贴新建子任务对话框
    private async showPasteSubtaskDialog() {
        let parentTask: any = null;
        
        if (!this.isTempMode) {
            const reminderData = await this.plugin.loadReminderData() || {};
            
            // 解析可能存在的实例信息 (id_YYYY-MM-DD)
            let targetParentId = this.parentId;
            const lastUnderscoreIndex = this.parentId.lastIndexOf('_');
            if (lastUnderscoreIndex !== -1) {
                const potentialDate = this.parentId.substring(lastUnderscoreIndex + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                    targetParentId = this.parentId.substring(0, lastUnderscoreIndex);
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
                console.error('批量创建子任务失败:', error);
                showMessage(i18n("batchCreateFailed") || "批量创建任务失败");
            }
        });

        await pasteDialog.show();
    }
}
