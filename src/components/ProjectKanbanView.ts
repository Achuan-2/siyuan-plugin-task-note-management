import { showMessage, confirm, Menu, Dialog } from "siyuan";

import { readReminderData, writeReminderData, readProjectData, getBlockByID, updateBlockReminderBookmark, openBlock } from "../api";
import { t } from "../utils/i18n";
import { getLocalDateString, getLocalDateTimeString, compareDateStrings } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";
import { getSolarDateLunarString } from "../utils/lunarUtils";
import { QuickReminderDialog } from "./QuickReminderDialog";

// 层级化任务接口
interface HierarchicalTask {
    title: string;
    priority?: string;
    startDate?: string;
    endDate?: string;
    blockId?: string;
    level: number;
    children: HierarchicalTask[];
}

export class ProjectKanbanView {
    private container: HTMLElement;
    private plugin: any;
    private projectId: string;
    private project: any;
    private categoryManager: CategoryManager;
    private currentSort: string = 'priority';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private doneSort: string = 'completedTime';
    private doneSortOrder: 'asc' | 'desc' = 'desc';
    private showDone: boolean = true; // 改为默认显示已完成任务
    private tasks: any[] = [];
    private isDragging: boolean = false;
    private draggedTask: any = null;
    private draggedElement: HTMLElement | null = null;
    private sortButton: HTMLButtonElement;
    private doneSortButton: HTMLButtonElement;
    private isLoading: boolean = false;
    private collapsedTasks: Set<string> = new Set();

    // 分页：每页最多显示的顶层任务数量
    private pageSize: number = 30;
    // 存储每列当前页，key 为 status ('long_term'|'short_term'|'doing'|'done')
    private pageIndexMap: { [status: string]: number } = { long_term: 1, short_term: 1, doing: 1, done: 1 };

    // 指示器状态跟踪
    private currentIndicatorType: 'none' | 'sort' | 'parentChild' = 'none';
    private currentIndicatorTarget: HTMLElement | null = null;
    private currentIndicatorPosition: 'top' | 'bottom' | 'middle' | null = null;

    // 全局番茄钟管理器
    private pomodoroManager = PomodoroManager.getInstance();

    constructor(container: HTMLElement, plugin: any, projectId: string) {
        this.container = container;
        this.plugin = plugin;
        this.projectId = projectId;
        this.categoryManager = CategoryManager.getInstance();
        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.loadProject();
        this.initUI();
        await this.loadTasks();

        // 监听提醒更新事件
        window.addEventListener('reminderUpdated', () => this.loadTasks());
    }

    private async loadProject() {
        try {
            const projectData = await readProjectData();
            this.project = projectData[this.projectId];
            if (!this.project) {
                throw new Error('项目不存在');
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
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
        titleEl.textContent = this.project?.title || t('projectKanban');
        titleEl.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        `;

        // 如果项目有关联的笔记ID，添加点击跳转功能
        if (this.project?.blockId) {
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline';
            titleEl.style.textDecorationStyle = 'dotted';
            titleEl.title = t('clickToJumpToProjectNote');
            titleEl.setAttribute('data-has-note', 'true');

            titleEl.addEventListener('click', () => {
                this.openProjectNote(this.project.blockId);
            });

            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });

            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-on-background)';
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
        controlsGroup.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
        `;

        // 新建任务按钮
        const addTaskBtn = document.createElement('button');
        addTaskBtn.className = 'b3-button b3-button--primary';
        addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${t('newTask')}`;
        addTaskBtn.addEventListener('click', () => this.showCreateTaskDialog());
        controlsGroup.appendChild(addTaskBtn);

        const pasteTaskBtn = document.createElement('button');
        pasteTaskBtn.className = 'b3-button';
        pasteTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg> ${t('pasteNew')}`;
        pasteTaskBtn.addEventListener('click', () => this.showPasteTaskDialog());
        controlsGroup.appendChild(pasteTaskBtn);

        // 显示/隐藏已完成任务
        const toggleDoneBtn = document.createElement('button');
        toggleDoneBtn.className = 'b3-button b3-button--outline';
        toggleDoneBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg> ${this.showDone ? t('hideCompleted') : t('showCompleted')}`;
        toggleDoneBtn.addEventListener('click', () => {
            this.showDone = !this.showDone;
            toggleDoneBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg> ${this.showDone ? t('hideCompleted') : t('showCompleted')}`;
            this.renderKanban();
        });
        controlsGroup.appendChild(toggleDoneBtn);

        // 排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.addEventListener('click', (e) => this.showSortMenu(e));
        controlsGroup.appendChild(this.sortButton);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = t('refresh');
        refreshBtn.addEventListener('click', () => this.loadTasks());
        controlsGroup.appendChild(refreshBtn);

        toolbar.appendChild(controlsGroup);

        // 创建看板容器
        const kanbanContainer = document.createElement('div');
        kanbanContainer.className = 'project-kanban-container';
        this.container.appendChild(kanbanContainer);

        // 创建四个列：进行中、短期、长期、已完成
        this.createKanbanColumn(kanbanContainer, 'doing', t('doing'), '#f39c12');
        this.createKanbanColumn(kanbanContainer, 'short_term', t('shortTerm'), '#3498db');
        this.createKanbanColumn(kanbanContainer, 'long_term', t('longTerm'), '#9b59b6');
        this.createKanbanColumn(kanbanContainer, 'done', t('done'), '#27ae60');

        // 添加自定义样式
        this.addCustomStyles();

        // 更新排序按钮标题
        this.updateSortButtonTitle();
        this.updateDoneSortButtonTitle();
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
        titleEl.textContent = title;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${color};
        `;
        titleContainer.appendChild(titleEl);

        if (status === 'done') {
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
        header.appendChild(countEl);

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 8px;
            overflow-y: auto;
            min-height: 200px;
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
    }

    private addDropZoneEvents(element: HTMLElement, status: string) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 检查是否可以改变状态或解除父子关系
                const canChangeStatus = this.draggedTask.status !== status;
                const canUnsetParent = !!this.draggedTask.parentId;

                if (canChangeStatus || canUnsetParent) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');

                    // 不显示解除父任务关系的提示，让用户通过拖拽区域自然判断
                    // 移除了原来的 unsetParent 指示器显示逻辑
                }
            }
        });

        element.addEventListener('dragleave', (_e) => {
            // 使用 contains 检查离开目标区域时清除样式
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);

                // 如果状态改变，执行状态切换
                if (this.draggedTask.status !== status) {
                    this.changeTaskStatus(this.draggedTask, status);
                }
                // 否则，如果有父任务，解除父子关系
                else if (this.draggedTask.parentId) {
                    this.unsetParentChildRelation(this.draggedTask);
                }
            }
        });
    }

    private async loadTasks() {
        if (this.isLoading) {
            console.log('任务正在加载中，跳过本次加载请求');
            return;
        }

        this.isLoading = true;
        try {
            const reminderData = await readReminderData();
            const projectTasks = Object.values(reminderData).filter((reminder: any) => reminder && reminder.projectId === this.projectId);
            const taskMap = new Map(projectTasks.map((t: any) => [t.id, { ...t }]));

            const getRootStatus = (task: any): string => {
                let current = task;
                while (current.parentId && taskMap.has(current.parentId)) {
                    current = taskMap.get(current.parentId);
                }
                return this.getTaskStatus(current);
            };

            // 处理周期事件：生成实例并筛选
            const today = getLocalDateString();
            const allTasksWithInstances: any[] = [];

            projectTasks.forEach((reminder: any) => {
                // 对于农历重复任务，只添加符合农历日期的实例，不添加原始日期
                const isLunarRepeat = reminder.repeat?.enabled &&
                    (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

                // 修改后的逻辑：对于所有重复事件，只显示实例，不显示原始任务
                if (!reminder.repeat?.enabled) {
                    // 非周期任务，正常添加
                    allTasksWithInstances.push(reminder);
                }
                // 对于所有重复事件（农历和非农历），都不添加原始任务，只添加实例

                // 如果是周期事件，生成实例
                if (reminder.repeat?.enabled) {
                    // 智能确定时间范围，确保至少能找到下一个未来实例
                    const repeatInstances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);

                    // 过滤实例：保留过去未完成、今天的、未来第一个未完成，以及所有已完成的实例
                    const completedInstances = reminder.repeat?.completedInstances || [];
                    const instanceModifications = reminder.repeat?.instanceModifications || {};

                    // 将实例分类为：过去未完成、今天未完成、未来未完成、未来已完成、过去已完成
                    let pastIncompleteList: any[] = [];
                    let todayIncompleteList: any[] = [];
                    let futureIncompleteList: any[] = [];
                    let futureCompletedList: any[] = [];
                    let pastCompletedList: any[] = [];

                    repeatInstances.forEach(instance => {
                        // 对于所有重复事件，只添加实例，不添加原始任务
                        const isInstanceCompleted = completedInstances.includes(instance.date);
                        const instanceMod = instanceModifications[instance.date];

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
                            note: instanceMod?.note || reminder.note,
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
                    allTasksWithInstances.push(...pastIncompleteList);

                    // 添加今天的未完成实例
                    allTasksWithInstances.push(...todayIncompleteList);

                    // 添加未来的第一个未完成实例（如果存在）
                    // 这样即使有多个已完成的未来实例，也能显示下一个未完成的实例
                    if (futureIncompleteList.length > 0) {
                        // 对于所有重复事件，如果今天没有未完成实例，就添加未来第一个未完成的
                        const hasTodayIncomplete = todayIncompleteList.length > 0;
                        if (!hasTodayIncomplete) {
                            allTasksWithInstances.push(futureIncompleteList[0]);
                        }
                    }

                    // 添加所有已完成的实例（包括过去和未来的）- ProjectKanbanView需要显示已完成的实例
                    allTasksWithInstances.push(...pastCompletedList);
                    allTasksWithInstances.push(...futureCompletedList);
                }
            });

            this.tasks = allTasksWithInstances.map((reminder: any) => {
                let status;
                if (reminder.parentId && taskMap.has(reminder.parentId)) {
                    // For ALL subtasks, their column is determined by their root parent's status
                    status = getRootStatus(reminder);
                } else {
                    // For top-level tasks, use their own status
                    status = this.getTaskStatus(reminder);
                }
                return {
                    ...reminder,
                    status: status
                };
            });

            this.sortTasks();

            // 默认折叠逻辑：
            // - 首次加载（或用户无任何折叠偏好）时，按照旧逻辑为非 doing 的父任务设置为折叠状态；
            // - 之后的加载尽量保留用户通过界面展开/折叠的偏好（即不再盲目 clear 并重新折叠已展开的父任务）；
            // - 同时移除那些已经不存在的任务 id，防止内存泄漏或过期状态。
            try {
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
                });

                // 仅在用户没有任何折叠偏好（collapsedTasks 为空）时，应用默认折叠策略
                if (this.collapsedTasks.size === 0) {
                    parentMap.forEach((_children, parentId) => {
                        const parent = this.tasks.find(p => p.id === parentId);
                        if (!parent) return;
                        if (parent.status !== 'doing') {
                            this.collapsedTasks.add(parentId);
                        }
                    });
                }
            } catch (err) {
                console.warn('设置默认折叠任务失败:', err);
            }

            console.log('任务加载完成');
            console.log('任务排序方式:', this.currentSort, this.currentSortOrder);

            // 重置分页索引，防止页码超出范围
            try {
                const counts = {
                    doing: this.tasks.filter(t => t.status === 'doing').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    short_term: this.tasks.filter(t => t.status === 'short_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    long_term: this.tasks.filter(t => t.status === 'long_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    done: this.tasks.filter(t => t.status === 'done').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                };
                for (const status of ['doing', 'short_term', 'long_term', 'done']) {
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

    private getTaskStatus(task: any): string {
        if (task.completed) return 'done';
        if (task.kanbanStatus === 'doing') return 'doing';
        // 根据termType确定是长期还是短期
        if (task.termType === 'long_term') return 'long_term';
        if (task.termType === 'doing') return 'doing';
        return 'short_term'; // 默认为短期
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': t('sortingTime'),
                'priority': t('sortingPriority'),
                'title': t('sortingTitle')
            };
            const orderNames = {
                'asc': t('ascendingOrder'),
                'desc': t('descendingOrder')
            };
            this.sortButton.title = `${t('sortBy')}: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private updateDoneSortButtonTitle() {
        if (this.doneSortButton) {
            const sortNames = {
                'completedTime': t('sortByCompletedTime'),
                'title': t('sortingTitle'),
                'priority': t('sortingPriority'),
                'time': t('sortBySetTime')
            };
            const orderNames = {
                'asc': t('ascendingOrder'),
                'desc': t('descendingOrder')
            };
            this.doneSortButton.title = `${t('sortBy')}: ${sortNames[this.doneSort] || t('sortByCompletedTime')} (${orderNames[this.doneSortOrder] || t('descendingOrder')})`;
        }
    }

    private sortTasks() {
        this.tasks.sort((a, b) => {
            let result = 0;

            switch (this.currentSort) {
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
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

        // 2. 同优先级内按手动排序
        const sortA = a.sort || 0;
        const sortB = b.sort || 0;

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 3. 如果手动排序值也相同，按创建时间排序
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.date || '9999-12-31';
        const dateB = b.date || '9999-12-31';
        const timeA = a.time || '00:00';
        const timeB = b.time || '00:00';

        const datetimeA = `${dateA}T${timeA}`;
        const datetimeB = `${dateB}T${timeB}`;

        const timeCompare = datetimeA.localeCompare(datetimeB);
        if (timeCompare !== 0) {
            return timeCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const titleCompare = titleA.localeCompare(titleB, 'zh-CN');
        if (titleCompare !== 0) {
            return titleCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByCompletedTime(a: any, b: any): number {
        const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
        const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
        if (timeA === timeB) {
            return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
        }
        return timeA - timeB;
    }

    private sortDoneTasks(tasks: any[]): any[] {
        const sortedTasks = [...tasks];
        sortedTasks.sort((a, b) => {
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

    private renderKanban() {
        const doingTasks = this.tasks.filter(task => task.status === 'doing');
        const shortTermTasks = this.tasks.filter(task => task.status === 'short_term');
        const longTermTasks = this.tasks.filter(task => task.status === 'long_term');
        const doneTasks = this.tasks.filter(task => task.status === 'done');

        this.renderColumn('doing', doingTasks);
        this.renderColumn('short_term', shortTermTasks);
        this.renderColumn('long_term', longTermTasks);

        if (this.showDone) {
            const sortedDoneTasks = this.sortDoneTasks(doneTasks);
            this.renderColumn('done', sortedDoneTasks);
            this.showColumn('done');
        } else {
            this.hideColumn('done');
        }
    }

    private renderColumn(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        content.innerHTML = '';

        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = tasks.filter(t => t.parentId && taskMap.has(t.parentId));

        // 分页计算
        const totalTop = topLevelTasks.length;
        const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
        const currentPage = Math.min(Math.max(1, this.pageIndexMap[status] || 1), totalPages);

        const startIdx = (currentPage - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const pagedTopLevel = topLevelTasks.slice(startIdx, endIdx);

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
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
                    this.renderKanban();
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
                    this.renderKanban();
                });
                pagination.appendChild(nextBtn);
            }
        }
    }

    private showColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'flex';
        }
    }

    private hideColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'none';
        }
    }

    private createTaskElement(task: any, level: number = 0): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = 'kanban-task';
        if (level > 0) {
            taskEl.classList.add('is-subtask');
        }
        taskEl.draggable = true;
        taskEl.dataset.taskId = task.id;

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
                borderColor = 'var(--b3-theme-border)';
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

        const taskMainContainer = document.createElement('div');
        taskMainContainer.className = 'kanban-task-main';
        taskMainContainer.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: flex-start;
        `;

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
            collapseBtn.title = isCollapsed ? t('expandSubtasks') : t('collapseSubtasks');
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedTasks.delete(task.id);
                } else {
                    this.collapsedTasks.add(task.id);
                }
                this.renderKanban();
            });
            taskIndentContainer.appendChild(collapseBtn);
        }

        taskMainContainer.appendChild(taskIndentContainer);

        // 复选框
        const checkboxEl = document.createElement('input');
        checkboxEl.type = 'checkbox';
        checkboxEl.className = 'kanban-task-checkbox';
        checkboxEl.checked = task.completed;
        checkboxEl.title = '点击完成/取消完成任务';
        checkboxEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const completed = checkboxEl.checked;
            this.toggleTaskCompletion(task, completed);
        });
        taskMainContainer.appendChild(checkboxEl);

        const taskContentContainer = document.createElement('div');
        taskContentContainer.className = 'kanban-task-content';
        taskContentContainer.style.flex = '1';

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
                margin-bottom: 8px;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                cursor: pointer;
                text-decoration: underline;
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

            // 鼠标悬停效果
            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary-light)';
            });
            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });
        } else {
            // 没有绑定块，普通标题样式
            titleEl.style.cssText = `
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
                width: fit-content;
            `;
        }

        titleEl.textContent = task.title || t('noContentHint');
        titleEl.title = (task.blockId || task.docId) ? t('clickToOpenBoundBlock', { title: task.title || t('noContentHint') }) : (task.title || t('noContentHint'));

        // 如果有子任务，添加数量指示器
        if (childTasks.length > 0) {
            const subtaskIndicator = document.createElement('span');
            subtaskIndicator.className = 'subtask-indicator';
            subtaskIndicator.textContent = ` (${childTasks.length})`;
            subtaskIndicator.title = t('containsNSubtasks', { count: childTasks.length });
            subtaskIndicator.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            `;
            titleEl.appendChild(subtaskIndicator);
        }

        taskContentContainer.appendChild(titleEl);

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

                    const prefix = countdownInfo.type === 'start' ? '剩' : '';
                    dateHtml += `<span class="countdown-badge ${urgencyClass}">${prefix}${countdownInfo.text}</span>`;
                }
            }

            dateEl.innerHTML += dateHtml;
            infoEl.appendChild(dateEl);
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

        // 分类
        if (task.categoryId) {
            const category = this.categoryManager.getCategoryById(task.categoryId);
            if (category) {
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
                    align-self: flex-start;
                `;

                if (category.icon) {
                    categoryEl.innerHTML = `<span>${category.icon}</span><span>${category.name}</span>`;
                } else {
                    categoryEl.textContent = category.name;
                }
                infoEl.appendChild(categoryEl);
            }
        }

        // 备注
        if (task.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'kanban-task-note';
            noteEl.textContent = task.note;
            noteEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            infoEl.appendChild(noteEl);
        }

        // 番茄钟数量
        if (task.pomodoroCount && task.pomodoroCount > 0) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'kanban-task-pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: inline-flex;
                align-items: center;
                gap: 2px;
                margin-top: 4px;
            `;

            const tomatoEmojis = '🍅'.repeat(Math.min(task.pomodoroCount, 5));
            const extraCount = task.pomodoroCount > 5 ? `+${task.pomodoroCount - 5}` : '';

            pomodoroDisplay.innerHTML = `
                <span title="完成的番茄钟数量: ${task.pomodoroCount}">${tomatoEmojis}${extraCount}</span>
            `;

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

        // 添加拖拽事件（状态切换）
        this.addTaskDragEvents(taskEl, task);

        // 添加任务拖拽事件处理（排序和父子任务设置）
        taskEl.addEventListener('dragover', (e) => {
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

                if ((isInTopSortZone || isInBottomSortZone)) {
                    // 排序操作
                    if (canSort || canBecomeSibling) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const position = isInTopSortZone ? 'top' : 'bottom';
                        this.updateIndicator('sort', taskEl, position, e);
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else if (isInParentChildZone && canSetParentChild) {
                    // 父子任务操作
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    this.updateIndicator('parentChild', taskEl, 'middle');
                } else {
                    // 清除所有指示器
                    this.updateIndicator('none', null, null);
                }
            }
        });

        taskEl.addEventListener('dragleave', (_e) => {
            // 检查是否真的离开了目标区域
            if (!taskEl.contains((_e as any).relatedTarget as Node)) {
                this.updateIndicator('none', null, null);
            }
        });

        taskEl.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                e.preventDefault();
                e.stopPropagation(); // 阻止事件冒泡到列的 drop 区域

                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) return;

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

                if ((isInTopSortZone || isInBottomSortZone)) {
                    if (canSort) {
                        // 执行排序
                        this.handleSortDrop(targetTask, e);
                    } else if (canBecomeSibling) {
                        // 执行成为兄弟任务并排序的操作
                        this.handleBecomeSiblingDrop(this.draggedTask, targetTask, e);
                    }
                } else if (isInParentChildZone && canSetParentChild) {
                    // 执行父子任务设置
                    this.handleParentChildDrop(targetTask);
                }
            }
            this.updateIndicator('none', null, null);
        });

        // 添加右键菜单
        taskEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showTaskContextMenu(e, task);
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
        const today = getLocalDateString();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = getLocalDateString(tomorrow);

        // 获取当前年份
        const currentYear = new Date().getFullYear();

        // 辅助函数：格式化日期显示
        const formatDateWithYear = (dateStr: string, date: Date): string => {
            const year = date.getFullYear();
            return year !== currentYear
                ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
                : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        };

        // 辅助函数：计算过期天数
        const getExpiredDays = (targetDate: string): number => {
            return Math.ceil((new Date(today).getTime() - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24));
        };

        // 辅助函数：创建过期徽章
        const createExpiredBadge = (days: number): string => {
            return `<span class="countdown-badge countdown-normal" style="background-color: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3);">已过期${days}天</span>`;
        };

        // 如果只有截止时间，显示截止时间
        if (!task.date && task.endDate) {
            const endDate = new Date(task.endDate);
            const endYear = endDate.getFullYear();

            // 检查是否过期
            if (task.endDate < today) {
                const daysDiff = getExpiredDays(task.endDate);
                const dateStr = formatDateWithYear(task.endDate, endDate);
                return `${dateStr} ${createExpiredBadge(daysDiff)}`;
            }

            if (task.endDate === today) {
                return t('todayDeadline');
            } else if (task.endDate === tomorrowStr) {
                return t('tomorrowDeadline');
            } else {
                const dateStr = formatDateWithYear(task.endDate, endDate);
                return `${dateStr} ${t('countdownEnd')}`;
            }
        }

        // 如果有开始时间，按原逻辑显示
        let dateStr = '';
        if (task.date === today) {
            dateStr = t('today');
        } else if (task.date === tomorrowStr) {
            dateStr = t('tomorrow');
        } else {
            const taskDate = new Date(task.date);
            const taskYear = taskDate.getFullYear();

            // 检查是否过期
            if (task.date < today) {
                const daysDiff = getExpiredDays(task.date);
                const formattedDate = formatDateWithYear(task.date, taskDate);
                dateStr = `${formattedDate} ${createExpiredBadge(daysDiff)} `;
            } else {
                // 如果不在今年，显示年份
                dateStr = formatDateWithYear(task.date, taskDate);
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
            const endYear = taskEndDate.getFullYear();

            // 检查结束日期是否过期
            if (task.endDate < today) {
                const daysDiff = getExpiredDays(task.endDate);
                const formattedEndDate = formatDateWithYear(task.endDate, taskEndDate);
                endDateStr = `${formattedEndDate} ${createExpiredBadge(daysDiff)} `;
            } else {
                // 如果结束日期不在今年，显示年份
                endDateStr = formatDateWithYear(task.endDate, taskEndDate);
            }
        }

        if (endDateStr) {
            return `${dateStr} → ${endDateStr} `;
        }

        if (task.time) {
            return `${dateStr} ${task.time} `;
        }

        return dateStr || "未设置日期";
    }

    private getTaskCountdownInfo(task: any): { text: string; days: number; type: 'start' | 'end' | 'none' } {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 如果有开始日期
        if (task.date) {
            const startDate = new Date(task.date);
            startDate.setHours(0, 0, 0, 0);
            const startDays = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // 如果还没开始
            if (startDays > 0) {
                return {
                    text: startDays === 1 ? t('tomorrowStart') : t('startsInNDays', { days: startDays }),
                    days: startDays,
                    type: 'start'
                };
            }

            // 如果已经开始且有结束日期
            if (task.endDate) {
                const endDate = new Date(task.endDate);
                endDate.setHours(0, 0, 0, 0);
                const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                if (endDays >= 0) {
                    return {
                        text: endDays === 0 ? t('todayEnd') : t('endsInNDays', { days: endDays }),
                        days: endDays,
                        type: 'end'
                    };
                }
            }
        }
        // 只有结束日期的情况
        else if (task.endDate) {
            const endDate = new Date(task.endDate);
            endDate.setHours(0, 0, 0, 0);
            const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? t('todayEnd') : t('endsInNDays', { days: endDays }),
                    days: endDays,
                    type: 'end'
                };
            }
        }

        return { text: '', days: 0, type: 'none' };
    }

    private addTaskDragEvents(element: HTMLElement, task: any) {
        // 支持子任务拖拽到父任务上边缘解除父子关系
        element.addEventListener('dragover', (e) => {
            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
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
                e.dataTransfer.setData('text/html', element.outerHTML);
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

    private showTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("kanbanTaskContextMenu");

        const childTasks = this.tasks.filter(t => t.parentId === task.id);

        // 编辑任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示修改此实例和修改所有实例
            menu.addItem({
                iconHTML: "📝",
                label: "修改此实例",
                click: () => this.editInstanceReminder(task)
            });
            menu.addItem({
                iconHTML: "🔄",
                label: "修改所有实例",
                click: () => this.editTask(task)
            });
        } else if (task.repeat?.enabled) {
            // 原始周期事件 - 只显示编辑选项
            menu.addItem({
                iconHTML: "📝",
                label: "编辑任务",
                click: () => this.editTask(task)
            });
        } else {
            // 普通任务
            menu.addItem({
                iconHTML: "📝",
                label: "编辑任务",
                click: () => this.editTask(task)
            });
        }

        menu.addItem({
            iconHTML: "➕",
            label: "创建子任务",
            click: () => this.showCreateTaskDialog(task)
        });

        // 粘贴新建子任务
        menu.addItem({
            iconHTML: "📋",
            label: "粘贴新建子任务",
            click: () => this.showPasteTaskDialog(task)
        });

        // 父子任务管理
        if (task.parentId) {
            menu.addItem({
                iconHTML: "🔗",
                label: "解除父任务关系",
                click: () => this.unsetParentChildRelation(task)
            });
        }





        menu.addSeparator();

        // 设置优先级子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: t('priorityHigh'), icon: '🔴' },
            { key: 'medium', label: t('priorityMedium'), icon: '🟡' },
            { key: 'low', label: t('priorityLow'), icon: '🔵' },
            { key: 'none', label: t('none'), icon: '⚫' }
        ];

        const currentPriority = task.priority || 'none';
        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => this.setPriority(task.id, priority.key)
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: "设置优先级",
            submenu: priorityMenuItems
        });

        // 绑定块功能
        if (task.blockId || task.docId) {
            menu.addItem({
                iconHTML: "📋",
                label: "复制块引用",
                click: () => this.copyBlockRef(task)
            });
        } else {
            menu.addItem({
                iconHTML: "🔗",
                label: "绑定到块",
                click: () => this.showBindToBlockDialog(task)
            });
        }

        menu.addSeparator();

        // 任务类型切换
        const currentTermType = task.termType; // 不设默认值，允许为 undefined

        if (currentTermType !== 'short_term') {
            menu.addItem({
                iconHTML: "📝",
                label: t('setAsShortTerm'),
                click: () => this.changeTaskStatus(task, 'short_term')
            });
        }

        if (currentTermType !== 'long_term') {
            menu.addItem({
                iconHTML: "🎯",
                label: t('setAsLongTerm'),
                click: () => this.changeTaskStatus(task, 'long_term')
            });
        }


        // 状态切换
        const currentStatus = this.getTaskStatus(task);

        if (currentStatus !== 'doing') {
            menu.addItem({
                iconHTML: "⚡",
                label: t('moveToDoing'),
                click: () => this.changeTaskStatus(task, 'doing')
            });
        }

        if (currentStatus !== 'done') {
            menu.addItem({
                iconHTML: "✅",
                label: t('markCompleted'),
                click: () => this.changeTaskStatus(task, 'done')
            });
        }

        menu.addSeparator();

        // 番茄钟
        menu.addItem({
            iconHTML: "🍅",
            label: t('startPomodoro'),
            click: () => this.startPomodoro(task)
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: t('startStopwatch'),
            click: () => this.startPomodoroCountUp(task)
        });

        menu.addSeparator();

        // 删除任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示删除此实例和删除所有实例
            menu.addItem({
                iconHTML: "🗑️",
                label: "删除此实例",
                click: () => this.deleteInstanceOnly(task)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: "删除所有实例",
                click: () => this.deleteTask(task)
            });
        } else {
            // 普通任务或原始周期事件
            menu.addItem({
                iconHTML: "🗑️",
                label: t('deleteTask'),
                click: () => this.deleteTask(task)
            });
        }

        // 复制子任务为多级 Markdown 列表
        if (childTasks.length > 0) {
            menu.addItem({
                iconHTML: "📋",
                label: t('copySubtasksAsList'),
                click: () => {
                    const childLines = this.buildMarkdownListFromChildren(task.id);
                    if (childLines && childLines.length > 0) {
                        const text = childLines.join('\n');
                        // 复制到剪贴板
                        try {
                            navigator.clipboard.writeText(text);
                            showMessage('已复制子任务列表到剪贴板');
                        } catch (err) {
                            // 备用：使用临时 textarea
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            showMessage('已复制子任务列表到剪贴板');
                        }
                    } else {
                        showMessage(t('noSubtasksToCopy'));
                    }
                }
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async toggleTaskCompletion(task: any, completed: boolean) {
        try {
            if (task.isRepeatInstance && task.originalId) {
                // 对于重复实例，使用不同的完成逻辑
                await this.toggleRepeatInstanceCompletion(task, completed);
            } else {
                // 对于普通任务，使用原有逻辑
                const newStatus = completed ? 'done' : 'todo';
                await this.changeTaskStatus(task, newStatus);
            }
        } catch (error) {
            console.error('切换任务完成状态失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    /**
     * 切换重复实例的完成状态
     * @param task 重复实例任务
     * @param completed 是否完成
     */
    private async toggleRepeatInstanceCompletion(task: any, completed: boolean) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始重复事件不存在");
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

            await writeReminderData(reminderData);

            // 更新本地缓存
            const localTask = this.tasks.find(t => t.id === task.id);
            if (localTask) {
                localTask.completed = completed;
                if (completed) {
                    localTask.completedTime = originalReminder.repeat.instanceCompletedTimes?.[instanceDate];
                } else {
                    delete localTask.completedTime;
                }
            }

            // 广播更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        } catch (error) {
            console.error('切换重复实例完成状态失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async changeTaskStatus(task: any, newStatus: string) {
        try {
            const reminderData = await readReminderData();

            // 对于周期实例，使用 originalId；否则使用 task.id
            const actualTaskId = task.isRepeatInstance ? task.originalId : task.id;

            if (reminderData[actualTaskId]) {
                // 如果是周期实例，需要更新实例的完成状态
                if (task.isRepeatInstance) {
                    // 处理周期实例的完成状态
                    if (newStatus === 'done') {
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

                        // 周期实例完成时，不自动完成子任务（因为每个实例都是独立的）
                        // 如果需要完成子任务，用户应该在右键菜单中选择"完成任务及所有子任务"
                    } else {
                        // 取消完成周期实例或修改其他状态（long_term, short_term, doing）
                        if (reminderData[actualTaskId].repeat?.completedInstances) {
                            const index = reminderData[actualTaskId].repeat.completedInstances.indexOf(task.date);
                            if (index > -1) {
                                reminderData[actualTaskId].repeat.completedInstances.splice(index, 1);
                            }
                        }

                        // 对于周期事件，也需要支持修改 termType 和 kanbanStatus
                        // 修改的是原始周期事件的属性，会影响所有未来实例
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            reminderData[actualTaskId].termType = newStatus;
                            reminderData[actualTaskId].kanbanStatus = 'todo';
                        } else if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                            // 设置为进行中时，清空termType
                            delete reminderData[actualTaskId].termType;
                        }
                    }
                } else {
                    // 非周期实例的正常处理
                    if (newStatus === 'done') {
                        reminderData[actualTaskId].completed = true;
                        reminderData[actualTaskId].completedTime = getLocalDateTimeString(new Date());

                        // 父任务完成时，自动完成所有子任务
                        await this.completeAllChildTasks(actualTaskId, reminderData);
                    } else {
                        reminderData[actualTaskId].completed = false;
                        delete reminderData[actualTaskId].completedTime;

                        // 根据新状态设置kanbanStatus和termType
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            reminderData[actualTaskId].termType = newStatus;
                            reminderData[actualTaskId].kanbanStatus = 'todo';
                        } else if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                            // 设置为进行中时，清空termType
                            delete reminderData[actualTaskId].termType;
                        }
                    }
                }

                await writeReminderData(reminderData);

                // 更新块的书签状态（仅针对绑定块的任务）
                if (task.blockId || task.docId) {
                    await updateBlockReminderBookmark(task.blockId || task.docId);
                }

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                // 重新加载任务
                await this.loadTasks();
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

                    // 如果子任务有绑定块，也需要处理书签更新
                    if (childTask.blockId || childTask.docId) {
                        try {
                            await updateBlockReminderBookmark(childTask.blockId || childTask.docId);
                        } catch (error) {
                            console.warn(`更新子任务 ${childId} 的块书签失败: `, error);
                        }
                    }
                }
            }

            if (completedCount > 0) {
                console.log(`${t('parentTaskCompleted')} ${parentId}, ${t('autoCompleteSubtasks', { count: completedCount })} `);
                showMessage(t('autoCompleteSubtasks', { count: completedCount }), 2000);
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
                return; // 避免循环引用
            }
            visited.add(currentParentId);

            Object.values(reminderData).forEach((task: any) => {
                if (task && task.parentId === currentParentId) {
                    result.push(task.id);
                    getChildren(task.id); // 递归获取子任务的子任务
                }
            });
        };

        getChildren(parentId);
        return result;
    }

    private showSortMenu(event: MouseEvent) {
        if (document.querySelector('.kanban-sort-menu')) {
            return;
        }

        const menuEl = document.createElement('div');
        menuEl.className = 'kanban-sort-menu';
        menuEl.style.cssText = `
                position: absolute;
            background: var(--b3-theme-surface);
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
            { key: 'priority', label: '优先级', icon: '🎯' },
            { key: 'time', label: '时间', icon: '🕐' },
            { key: 'title', label: '标题', icon: '📝' }
        ];

        const createOption = (option: any, order: 'asc' | 'desc') => {
            const button = document.createElement('button');
            button.className = 'b3-button b3-button--outline';
            const isActive = this.currentSort === option.key && this.currentSortOrder === order;
            button.style.cssText = `
                width: 100%;
                justify-content: flex-start;
                text-align: left;
                background-color: ${isActive ? 'var(--b3-theme-primary-lightest)' : 'transparent'};
                color: ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)'};
                `;
            button.innerHTML = `
                    < span style="font-size: 16px; margin-right: 8px;" > ${option.icon} </span>
                        < span>${option.label} (${order === 'asc' ? t('ascendingOrder') : t('descendingOrder')})</span>
                            `;
            button.addEventListener('click', () => {
                this.currentSort = option.key;
                this.currentSortOrder = order;
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
        menuEl.style.top = `${rect.bottom + 4} px`;
        menuEl.style.left = `${rect.right - menuEl.offsetWidth} px`;

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

        addMenuItem(`${t('sortByCompletedTime')} (${t('descendingOrder')})`, 'completedTime', 'desc');
        addMenuItem(`${t('sortByCompletedTime')} (${t('ascendingOrder')})`, 'completedTime', 'asc');
        menu.addSeparator();
        addMenuItem(`${t('sortingPriority')} (${t('descendingOrder')})`, 'priority', 'desc');
        addMenuItem(`${t('sortingPriority')} (${t('ascendingOrder')})`, 'priority', 'asc');
        menu.addSeparator();
        addMenuItem(`${t('sortBySetTime')} (${t('descendingOrder')})`, 'time', 'desc');
        addMenuItem(`${t('sortBySetTime')} (${t('ascendingOrder')})`, 'time', 'asc');
        menu.addSeparator();
        addMenuItem(`${t('sortingTitle')} (${t('ascendingOrder')})`, 'title', 'asc');
        addMenuItem(`${t('sortingTitle')} (${t('descendingOrder')})`, 'title', 'desc');

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    // 使用 QuickReminderDialog 创建任务
    private showCreateTaskDialog(parentTask?: any) {
        const quickDialog = new QuickReminderDialog(
            undefined, // 项目看板创建任务默认不设置日期
            undefined, // 无初始时间
            () => {
                // 保存成功后刷新看板
                this.loadTasks();
            },
            undefined, // 无时间段选项
            {
                defaultProjectId: this.projectId, // 默认项目ID
                defaultCategoryId: parentTask?.categoryId, // 如果是子任务，继承父任务分类
                defaultPriority: parentTask?.priority, // 如果是子任务，继承父任务优先级
                defaultTitle: parentTask ? '' : undefined, // 子任务不预填标题
                hideProjectSelector: true, // 隐藏项目选择器
                showKanbanStatus: 'term', // 显示任务类型选择
                defaultTermType: 'short_term', // 默认短期任务
                plugin: this.plugin // 传入plugin实例
            }
        );

        quickDialog.show();

        // 如果需要设置父子关系，在保存后处理
        if (parentTask) {
            // 重写保存回调，添加父子关系设置
            const originalOnSaved = quickDialog['onSaved'];
            quickDialog['onSaved'] = async () => {
                if (originalOnSaved) {
                    originalOnSaved();
                }

                // 获取最新创建的任务并设置父任务关系
                try {
                    const reminderData = await readReminderData();
                    const allTasks = Object.values(reminderData).filter((r: any) =>
                        r.projectId === this.projectId && !r.completed
                    );

                    // 找到最新创建的任务（最大的 createdAt 时间戳）
                    const latestTask = allTasks.reduce((latest: any, current: any) => {
                        if (!latest) return current;
                        const latestTime = new Date(latest.createdAt || 0).getTime();
                        const currentTime = new Date(current.createdAt || 0).getTime();
                        return currentTime > latestTime ? current : latest;
                    }, null);

                    if (latestTask) {
                        // 设置父任务关系
                        (latestTask as any).parentId = parentTask.id;

                        // 如果最新创建的任务没有优先级，继承父任务的优先级
                        if (!(latestTask as any).priority || (latestTask as any).priority === 'none') {
                            (latestTask as any).priority = parentTask.priority || 'none';
                        }

                        reminderData[(latestTask as any).id] = latestTask;
                        await writeReminderData(reminderData);

                        showMessage(`子任务已创建并关联到 "${parentTask.title}"`);

                        // 再次刷新看板
                        this.loadTasks();
                    }
                } catch (error) {
                    console.error('设置父任务关系失败:', error);
                }
            };
        }
    }

    private async editTask(task: any) {
        try {
            // 对于周期实例，编辑原始周期事件
            if (task.isRepeatInstance) {
                const reminderData = await readReminderData();
                const originalReminder = reminderData[task.originalId];
                if (!originalReminder) {
                    showMessage("原始周期事件不存在");
                    return;
                }
                const editDialog = new ReminderEditDialog(originalReminder, async () => {
                    await this.loadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                });
                editDialog.show();
            } else {
                // 普通任务或原始周期事件
                const editDialog = new ReminderEditDialog(task, async () => {
                    await this.loadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                });
                editDialog.show();
            }
        } catch (error) {
            console.error('打开编辑对话框失败:', error);
            showMessage("打开编辑对话框失败");
        }
    }

    private showPasteTaskDialog(parentTask?: any) {
        const dialog = new Dialog({
            title: "粘贴列表新建任务",
            content: `
                <div class="b3-dialog__content">
                        <p>粘贴Markdown列表或多行文本，每行将创建一个任务。支持多层级列表自动创建父子任务。</p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        支持语法：<code>@priority=high&startDate=2025-08-12&endDate=2025-08-30</code>
                                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                                        支持块链接：<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>
                                            </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 8px;">
                        支持多层级：使用缩进或多个<code>-</code>符号创建父子任务关系
                                            </p>
                    <textarea id="taskList" class="b3-text-field"
                        placeholder="示例：
- 完成项目文档 @priority=high&startDate=2025-08-12&endDate=2025-08-15
                                            - 需求文档
                                            - 技术方案
                                            - 架构设计
                                            - 接口设计
- 准备会议材料 @priority=medium&startDate=2025-08-13
                                        - PPT制作
                                        - 数据整理
                                        - [思源笔记插件开发丨任务笔记管理插件](siyuan://blocks/20250610000808-3vqwuh3)
- 学习新技术 @priority=low"
                        style="width: 100%; height: 250px; resize: vertical;"></textarea>
                                            </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                    <button class="b3-button b3-button--primary" id="createBtn">创建任务</button>
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

            // 使用新的层级解析方法
            const hierarchicalTasks = this.parseHierarchicalTaskList(text);

            if (hierarchicalTasks.length > 0) {
                // 如果传入 parentTask，则把所有顶级解析项作为 parentTask 的子任务
                if (parentTask) {
                    await this.batchCreateTasksWithHierarchy(hierarchicalTasks, parentTask.id);
                } else {
                    await this.batchCreateTasksWithHierarchy(hierarchicalTasks);
                }
                dialog.destroy();
                const totalTasks = this.countTotalTasks(hierarchicalTasks);
                showMessage(`${totalTasks} 个任务已创建`);
            }
        });
    }

    /**
     * 解析层级化任务列表
     * @param text 输入的文本
     * @returns 层级化的任务结构
     */
    private parseHierarchicalTaskList(text: string): HierarchicalTask[] {
        const lines = text.split('\n');
        const tasks: HierarchicalTask[] = [];
        const stack: Array<{ task: HierarchicalTask; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            // 计算缩进级别
            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            // 跳过空行和非列表项
            if (!cleanLine || (!cleanLine.startsWith('-') && level === 0 && !cleanLine.match(/^\s*-/))) {
                // 如果不是列表项但有内容，作为顶级任务处理
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine);
                    const task: HierarchicalTask = {
                        ...taskData,
                        level: 0,
                        children: []
                    };
                    tasks.push(task);
                    stack.length = 0;
                    stack.push({ task, level: 0 });
                }
                continue;
            }

            // 支持多个连续的列表标记（-- 表示更深层级）以及复选框语法 "- [ ]" 或 "- [x]"
            // 先计算基于连续 '-' 的额外层级（例如 "-- item" 看作更深一层）
            let levelFromDashes = 0;
            const dashPrefixMatch = cleanLine.match(/^(-{2,})\s*/);
            if (dashPrefixMatch) {
                // 连续的 '-' 比第一个额外增加层级数
                levelFromDashes = dashPrefixMatch[1].length - 1;
            }

            // 合并缩进级别和 '-' 表示的额外级别
            const combinedLevel = level + levelFromDashes;

            // 移除所有开头的列表标记（- * +）以及前导空格
            const taskContent = cleanLine.replace(/^[-*+]+\s*/, '');
            if (!taskContent) continue;

            const taskData = this.parseTaskLine(taskContent);
            const task: HierarchicalTask = {
                ...taskData,
                level: combinedLevel,
                children: []
            };

            // 清理栈，移除级别更高或相等的项
            while (stack.length > 0 && stack[stack.length - 1].level >= combinedLevel) {
                stack.pop();
            }

            if (stack.length === 0) {
                // 顶级任务
                tasks.push(task);
            } else {
                // 子任务
                const parent = stack[stack.length - 1].task;
                parent.children.push(task);
            }

            stack.push({ task, level: combinedLevel });
        }

        return tasks;
    }

    /**
     * 计算行的缩进级别
     * @param line 文本行
     * @returns 缩进级别
     */
    private calculateIndentLevel(line: string): number {
        // 匹配开头的空格或制表符
        const match = line.match(/^(\s*)/);
        if (!match) return 0;

        const indent = match[1];
        // 每2个空格或1个制表符算一级
        const spaces = indent.replace(/\t/g, '  ').length;
        return Math.floor(spaces / 2);
    }

    /**
     * 批量创建层级化任务
     * @param tasks 层级化任务列表
     */
    private async batchCreateTasksWithHierarchy(tasks: HierarchicalTask[], parentIdForAllTopLevel?: string) {
        const reminderData = await readReminderData();
        const categoryId = this.project.categoryId; // 继承项目分类

        // 获取当前项目中所有任务的最大排序值
        const maxSort = Object.values(reminderData)
            .filter((r: any) => r && r.projectId === this.projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;

        // 递归创建任务
        const createTaskRecursively = async (
            task: HierarchicalTask,
            parentId?: string,
            parentPriority?: string
        ): Promise<string> => {
            const taskId = `quick_${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            sortCounter += 10;

            // 如果子任务没有指定优先级，继承父任务的优先级
            const inheritedPriority = task.priority || parentPriority || 'none';

            const newTask: any = {
                id: taskId,
                title: task.title,
                note: '',
                priority: inheritedPriority,
                categoryId: categoryId,
                projectId: this.projectId,
                completed: false,
                kanbanStatus: 'todo',
                termType: 'short_term', // 默认为短期任务
                createdTime: new Date().toISOString(),
                date: task.startDate,
                endDate: task.endDate,
                sort: sortCounter,
            };

            // 如果有父任务ID，设置parentId
            if (parentId) {
                newTask.parentId = parentId;
            }

            // 如果解析出了块ID，尝试绑定块
            if (task.blockId) {
                try {
                    const block = await getBlockByID(task.blockId);
                    if (block) {
                        newTask.blockId = task.blockId;
                        newTask.docId = block.root_id || task.blockId;

                        // 如果任务标题为空或者是默认标题，使用块内容作为标题
                        if (!task.title || task.title === t('noContentHint')) {
                            newTask.title = block.content || block.fcontent || t('noContentHint');
                        }

                        // 更新块的书签状态
                        await updateBlockReminderBookmark(task.blockId);
                    }
                } catch (error) {
                    console.error('绑定块失败:', error);
                    // 绑定失败不影响任务创建，继续创建任务
                }
            }

            reminderData[taskId] = newTask;

            // 递归创建子任务
            if (task.children && task.children.length > 0) {
                for (let i = 0; i < task.children.length; i++) {
                    await createTaskRecursively(task.children[i], taskId, inheritedPriority);
                }
            }

            return taskId;
        };

        // 创建所有顶级任务及其子任务
        for (let i = 0; i < tasks.length; i++) {
            // 如果提供了 parentIdForAllTopLevel，则把解析出的顶级任务作为该父任务的子任务
            const topParent = parentIdForAllTopLevel ? parentIdForAllTopLevel : undefined;

            // 如果有父任务ID，获取父任务的优先级用于继承
            let parentPriority: string | undefined;
            if (topParent) {
                const reminderData = await readReminderData();
                const parentTask = reminderData[topParent];
                parentPriority = parentTask?.priority;
            }

            await createTaskRecursively(tasks[i], topParent, parentPriority);
        }

        await writeReminderData(reminderData);
        await this.loadTasks();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    /**
     * 计算总任务数量（包括子任务）
     * @param tasks 层级化任务列表
     * @returns 总任务数量
     */
    private countTotalTasks(tasks: HierarchicalTask[]): number {
        let count = 0;

        const countRecursively = (taskList: HierarchicalTask[]) => {
            for (const task of taskList) {
                count++;
                if (task.children && task.children.length > 0) {
                    countRecursively(task.children);
                }
            }
        };

        countRecursively(tasks);
        return count;
    }

    private parseTaskLine(line: string): { title: string; priority?: string; startDate?: string; endDate?: string; blockId?: string; completed?: boolean } {
        // 查找参数部分 @priority=high&startDate=2025-08-12&endDate=2025-08-30
        const paramMatch = line.match(/@(.+)$/);
        let title = line;
        let priority: string | undefined;
        let startDate: string | undefined;
        let endDate: string | undefined;
        let blockId: string | undefined;
        let completed: boolean | undefined;

        // 检查是否包含思源块链接或块引用
        blockId = this.extractBlockIdFromText(line);

        // 如果找到了块链接，从标题中移除链接部分
        if (blockId) {
            // 移除 Markdown 链接格式 [标题](siyuan://blocks/blockId)
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            // 移除块引用格式 ((blockId '标题'))
            title = title.replace(/\(\([^\s)]+\s+'([^']+)'\)\)/g, '$1');
            // 移除块引用格式 ((blockId "标题"))
            title = title.replace(/\(\([^\s)]+\s+"([^"]+)"\)\)/g, '$1');
            // 移除简单块引用格式 ((blockId))
            title = title.replace(/\(\([^\)]+\)\)/g, '');
        }

        // 解析复选框语法 (- [ ] 或 - [x])，并从标题中移除复选框标记
        const checkboxMatch = title.match(/^\s*\[\s*([ xX])\s*\]\s*/);
        if (checkboxMatch) {
            const mark = checkboxMatch[1];
            completed = (mark.toLowerCase() === 'x');
            title = title.replace(/^\s*\[\s*([ xX])\s*\]\s*/, '').trim();
        }

        // 有些 Markdown 列表中复选框放在 - [ ] 后面，处理示例："- [ ] 任务标题"
        // 如果 title 起始包含 '- [ ]' 或 '- [x]'，也要处理
        const leadingCheckboxMatch = line.match(/^\s*[-*+]\s*\[\s*([ xX])\s*\]\s*(.+)$/);
        if (leadingCheckboxMatch) {
            completed = (leadingCheckboxMatch[1].toLowerCase() === 'x');
            title = leadingCheckboxMatch[2];
        }

        if (paramMatch) {
            // 移除参数部分，获取纯标题
            title = title.replace(/@(.+)$/, '').trim();

            // 解析参数
            const paramString = paramMatch[1];
            const params = new URLSearchParams(paramString);

            priority = params.get('priority') || undefined;
            startDate = params.get('startDate') || undefined;
            endDate = params.get('endDate') || undefined;

            // 验证优先级值
            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) {
                priority = 'none';
            }

            // 验证日期格式 (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) {
                startDate = undefined;
            }
            if (endDate && !dateRegex.test(endDate)) {
                endDate = undefined;
            }
        }

        return {
            title: title.trim() || t('noContentHint'),
            priority,
            startDate,
            endDate,
            blockId
            , completed
        };
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
            // 验证块ID格式（通常是20位字符）
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

    private async deleteTask(task: any) {
        // 对于周期实例，删除原始周期事件（所有实例）
        const taskToDelete = task.isRepeatInstance ?
            { ...task, id: task.originalId, isRepeatInstance: false } : task;

        // 先尝试读取数据以计算所有后代任务数量，用于更准确的确认提示
        let confirmMessage = task.isRepeatInstance ?
            `确定要删除周期任务 "${task.title}" 的所有实例吗？此操作不可撤销。` :
            `确定要删除任务 "${task.title}" 吗？此操作不可撤销。`;
        try {
            const reminderDataForPreview = await readReminderData();
            const descendantIdsPreview = this.getAllDescendantIds(taskToDelete.id, reminderDataForPreview);
            if (descendantIdsPreview.length > 0) {
                confirmMessage += `\n\n此任务包含 ${descendantIdsPreview.length} 个子任务（包括多级子任务），它们也将被一并删除。`;
            }
        } catch (err) {
            // 无法读取数据时，仍然显示通用提示
        }

        confirm(
            "删除任务",
            confirmMessage,
            async () => {
                try {
                    // 重读数据以确保删除时数据为最新
                    const reminderData = await readReminderData();

                    // 获取所有后代任务ID（递归）
                    const descendantIds = this.getAllDescendantIds(taskToDelete.id, reminderData);

                    const tasksToDelete = [taskToDelete.id, ...descendantIds];

                    // 删除并为绑定块更新书签状态
                    for (const taskId of tasksToDelete) {
                        const t = reminderData[taskId];
                        if (t) {
                            // 先删除数据项
                            delete reminderData[taskId];

                            // 如果绑定了块，更新块的书签（忽略错误）
                            if (t.blockId || t.docId) {
                                try {
                                    await updateBlockReminderBookmark(t.blockId || t.docId);
                                } catch (err) {
                                    console.warn(`更新已删除任务 ${taskId} 的块书签失败: `, err);
                                }
                            }
                        }
                    }

                    await writeReminderData(reminderData);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    // 重新加载任务
                    await this.loadTasks();

                    showMessage("任务已删除");
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage("删除任务失败");
                }
            }
        );
    }

    private startPomodoro(task: any) {
        if (!this.plugin) {
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = task.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新任务："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n选择"确定"将继承当前进度继续计时。`;
            }

            confirm(
                "切换番茄钟任务",
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
            showMessage("无法启动番茄钟：插件实例不可用");
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || '当前任务';
            const newTitle = task.title || '新任务';

            let confirmMessage = `当前正在进行番茄钟任务："${currentTitle}"，是否要切换到新的正计时任务："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n选择"确定"将继承当前进度继续计时。`;
            }

            confirm(
                "切换到正计时番茄钟",
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
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换任务并继承${phaseText}进度`, 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）
            console.log('没有独立窗口，在当前窗口显示番茄钟 Dialog');

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
            }

            .project-kanban-toolbar {
                display: flex;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-surface);
                gap: 16px;
                flex-wrap: wrap;
            }

            .project-kanban-title {
                flex: 1;
                min-width: 200px;
            }

            .project-kanban-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
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
                    flex: 1;
                    min-width: 0;
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
                    flex-direction: column;
                    gap: 4px;
                }

                .project-kanban-controls .b3-button {
                    width: 100%;
                    justify-content: center;
                }
            }

            .project-kanban-container {
                flex: 1;
                display: grid;
                gap: 16px;
                padding: 16px;
                overflow-y: auto;
                min-height: 0;
                /* 自适应列布局：每列最小280px，最大1fr，自动填充 */
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            }

            /* 确保在极窄屏幕上也能正常显示 */
            @media (max-width: 320px) {
                .project-kanban-container {
                    grid-template-columns: 1fr;
                    padding: 8px;
                    gap: 8px;
                }
            }

            .kanban-column {
                background: var(--b3-theme-surface);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-border);
                display: flex;
                flex-direction: column;
                min-width: 0; /* 允许网格收缩 */
                max-height: 100%;
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
                padding: 8px;
                overflow-y: auto;
                min-height: 200px;
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
                background: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-border-color);
                transition: all 0.2s ease;
            }

            /* 优先级任务的备注样式 */
            .kanban-task-priority-high .kanban-task-note {
                background-color: rgba(231, 76, 60, 0.08) !important;
                border-color: rgba(231, 76, 60, 0.2) !important;
                color: var(--b3-card-error-color) !important;
            }

            .kanban-task-priority-medium .kanban-task-note {
                background-color: rgba(243, 156, 18, 0.08) !important;
                border-color: rgba(243, 156, 18, 0.2) !important;
                color: var(--b3-card-warning-color) !important;
            }

            .kanban-task-priority-low .kanban-task-note {
                background-color: rgba(52, 152, 219, 0.08) !important;
                border-color: rgba(52, 152, 219, 0.2) !important;
                color: var(--b3-card-info-color) !important;
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
            
            .term-type-selector {
                display: flex;
                gap: 12px;
            }
            .term-type-option {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                border-radius: 20px;
                cursor: pointer;
                border: 2px solid var(--b3-theme-border);
                transition: all 0.2s ease;
                background-color: var(--b3-theme-surface);
            }
            .term-type-option:hover {
                background-color: var(--b3-theme-surface-lighter);
                border-color: var(--b3-theme-primary-lighter);
            }
            .term-type-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }

            
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
                text-decoration: underline;
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
                background-color: var(--b3-theme-surface);
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
                text-decoration: underline;
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
    private async setPriority(taskId: string, priority: string) {
        try {
            const reminderData = await readReminderData();
            if (reminderData[taskId]) {
                reminderData[taskId].priority = priority;
                await writeReminderData(reminderData);

                showMessage("优先级已更新");
                await this.loadTasks();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                showMessage("任务不存在");
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage("设置优先级失败");
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
        const dialog = new Dialog({
            title: t("bindReminderToBlock"),
            content: `
                <div class="bind-to-block-dialog">
                    <div class="b3-dialog__content">
                        <div class="mode-toggle" style="margin-bottom: 16px;">
                            <button id="bindExistingBtn" class="b3-button b3-button--outline mode-btn active" style="margin-right: 8px;">
                                绑定现有块
                            </button>
                            <button id="createNewBtn" class="b3-button b3-button--outline mode-btn">
                                ${t("createNewDocument")}
                            </button>
                        </div>

                        <div id="bindExistingPanel" class="mode-panel">
                            <div class="b3-form__group">
                                <label class="b3-form__label">输入块ID</label>
                                <div class="b3-form__desc">支持块ID或块引用格式，如：((blockId '标题'))</div>
                                <input type="text" id="blockIdInput" class="b3-text-field" placeholder="请输入块ID或粘贴块引用" style="width: 100%; margin-top: 8px;">
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

                        <div id="createNewPanel" class="mode-panel" style="display: none;">
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档标题</label>
                                <input type="text" id="docTitleInput" class="b3-text-field" placeholder="请输入文档标题" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档内容（可选）</label>
                                <textarea id="docContentInput" class="b3-text-field" placeholder="请输入文档内容" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="bindCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="bindConfirmBtn">${t("bindToBlock")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "400px"
        });

        // 获取DOM元素
        const bindExistingBtn = dialog.element.querySelector('#bindExistingBtn') as HTMLButtonElement;
        const createNewBtn = dialog.element.querySelector('#createNewBtn') as HTMLButtonElement;
        const bindExistingPanel = dialog.element.querySelector('#bindExistingPanel') as HTMLElement;
        const createNewPanel = dialog.element.querySelector('#createNewPanel') as HTMLElement;

        const blockIdInput = dialog.element.querySelector('#blockIdInput') as HTMLInputElement;
        const selectedBlockInfo = dialog.element.querySelector('#selectedBlockInfo') as HTMLElement;
        const blockContentEl = dialog.element.querySelector('#blockContent') as HTMLElement;

        const docTitleInput = dialog.element.querySelector('#docTitleInput') as HTMLInputElement;
        const docContentInput = dialog.element.querySelector('#docContentInput') as HTMLTextAreaElement;

        const cancelBtn = dialog.element.querySelector('#bindCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#bindConfirmBtn') as HTMLButtonElement;

        let currentMode = 'existing';

        // 模式切换事件
        bindExistingBtn.addEventListener('click', () => {
            currentMode = 'existing';
            bindExistingBtn.classList.add('active');
            createNewBtn.classList.remove('active');
            bindExistingPanel.style.display = 'block';
            createNewPanel.style.display = 'none';
            confirmBtn.textContent = t("bindToBlock");
        });

        createNewBtn.addEventListener('click', () => {
            currentMode = 'create';
            createNewBtn.classList.add('active');
            bindExistingBtn.classList.remove('active');
            createNewPanel.style.display = 'block';
            bindExistingPanel.style.display = 'none';
            confirmBtn.textContent = t("createDocumentAndBind");

            // 自动填充标题
            if (!docTitleInput.value && reminder.title) {
                docTitleInput.value = reminder.title;
            }
        });

        // 监听块ID输入变化
        blockIdInput.addEventListener('input', async () => {
            const inputValue = blockIdInput.value.trim();

            // 尝试从输入内容中提取块ID（支持块引用格式）
            let blockId = this.extractBlockIdFromText(inputValue);

            // 如果没有匹配到块引用格式，则将输入作为纯块ID使用
            if (!blockId) {
                blockId = inputValue;
            }

            if (blockId && blockId.length >= 20) { // 块ID通常是20位字符
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

        // 确认按钮
        confirmBtn.addEventListener('click', async () => {
            if (currentMode === 'existing') {
                // 绑定现有块模式
                const inputValue = blockIdInput.value.trim();
                if (!inputValue) {
                    showMessage('请输入块ID');
                    return;
                }

                // 尝试从输入内容中提取块ID（支持块引用格式）
                let blockId = this.extractBlockIdFromText(inputValue);

                // 如果没有匹配到块引用格式，则将输入作为纯块ID使用
                if (!blockId) {
                    blockId = inputValue;
                }

                if (!blockId || blockId.length < 20) {
                    showMessage('请输入有效的块ID或块引用');
                    return;
                }

                try {
                    await this.bindReminderToBlock(reminder, blockId);
                    showMessage(t("reminderBoundToBlock"));
                    dialog.destroy();
                    this.loadTasks();
                } catch (error) {
                    console.error('绑定提醒到块失败:', error);
                    showMessage(t("bindToBlockFailed"));
                }
            } else {
                // 创建新文档模式
                const title = docTitleInput.value.trim();
                const content = docContentInput.value.trim();

                if (!title) {
                    showMessage(t("pleaseEnterTitle"));
                    return;
                }

                try {
                    await this.createDocumentAndBind(reminder, title, content);
                    showMessage(t("documentCreatedAndBound"));
                    dialog.destroy();
                    this.loadTasks();
                } catch (error) {
                    console.error('创建文档并绑定失败:', error);
                    showMessage(t("createDocumentFailed"));
                }
            }
        });

        // 自动聚焦输入框
        setTimeout(() => {
            if (currentMode === 'existing') {
                blockIdInput.focus();
            } else {
                docTitleInput.focus();
            }
        }, 100);
    }


    /**
     * 创建文档并绑定提醒（复用 ReminderPanel 中实现）
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
                    renderedPath = pathTemplate + '/';
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

            // 绑定提醒到新创建的文档
            await this.bindReminderToBlock(reminder, docId);

            return docId;
        } catch (error) {
            console.error('创建文档并绑定失败:', error);
            throw error;
        }
    }

    /**
     * 将提醒绑定到指定的块（adapted from ReminderPanel）
     */
    private async bindReminderToBlock(reminder: any, blockId: string) {
        try {
            const reminderData = await readReminderData();
            const reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

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
            const reminderData = await readReminderData();
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
                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                showMessage(`已解除 ${unboundCount} 个任务的块绑定`);
                await this.loadTasks();
            } else {
                showMessage("未找到相关的任务绑定");
            }
        } catch (error) {
            console.error('解除块绑定失败:', error);
            showMessage("解除块绑定失败");
        }
    }

    private getTaskFromElement(element: HTMLElement): any {
        const taskId = element.dataset.taskId;
        if (!taskId) return null;
        return this.tasks.find(t => t.id === taskId);
    }

    private canDropForSort(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 情况1：同级顶层任务之间排序（相同优先级）
        if (!draggedTask.parentId && !targetTask.parentId) {
            // 只允许在相同优先级内拖动
            const draggedPriority = draggedTask.priority || 'none';
            const targetPriority = targetTask.priority || 'none';
            return draggedPriority === targetPriority;
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

        // Target task must be a subtask to define a sibling context.
        if (!targetTask.parentId) return false;

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
            const reminderData = await readReminderData();

            if (!reminderData[childTask.id]) {
                throw new Error("子任务不存在");
            }

            if (!reminderData[parentTask.id]) {
                throw new Error("父任务不存在");
            }

            // 设置子任务的父任务ID
            reminderData[childTask.id].parentId = parentTask.id;

            // 子任务继承父任务的状态（如果父任务是进行中状态）
            const parentStatus = this.getTaskStatus(reminderData[parentTask.id]);
            if (parentStatus === 'doing' && !reminderData[childTask.id].completed) {
                reminderData[childTask.id].kanbanStatus = 'doing';
            }

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 重新加载任务以更新显示
            await this.loadTasks();
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
            const reminderData = await readReminderData();

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

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            showMessage(`"${childTask.title}" 已从 "${parentTitle}" 中独立出来`);

            // 重新加载任务以更新显示
            await this.loadTasks();
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

            await this.reorderTasks(this.draggedTask, targetTask, insertBefore);

            showMessage("排序已更新");
            // 重新加载由 reorderTasks 中派发的 'reminderUpdated' 事件触发，此处无需重复调用
        } catch (error) {
            console.error('处理拖放排序失败:', error);
            showMessage("排序更新失败");
        }
    }

    /**
     * Handles the drop event for making a task a sibling of another and sorting it.
     * @param draggedTask The task that was dragged
     * @param targetTask The task that was the drop target
     * @param event The drop event
     */
    private async handleBecomeSiblingDrop(draggedTask: any, targetTask: any, event: DragEvent) {
        if (!draggedTask || !targetTask || !targetTask.parentId) return;

        try {
            const reminderData = await readReminderData();
            const draggedTaskInDb = reminderData[draggedTask.id];
            if (!draggedTaskInDb) {
                throw new Error("Dragged task not found in data");
            }

            const newParentId = targetTask.parentId;
            const parentTaskInDb = reminderData[newParentId];
            if (!parentTaskInDb) {
                throw new Error("Parent task not found in data");
            }

            // 1. Set parentId for the dragged task
            draggedTaskInDb.parentId = newParentId;

            // 2. A sub-task inherits the status of its parent (or more accurately, its root parent)
            const parentStatus = this.getTaskStatus(parentTaskInDb);
            if (parentStatus === 'doing' && !draggedTaskInDb.completed) {
                draggedTaskInDb.kanbanStatus = 'doing';
            } else if (!draggedTaskInDb.completed) {
                // If parent is not 'doing', child becomes 'todo'
                draggedTaskInDb.kanbanStatus = 'todo';
            }

            // 3. Reorder siblings
            // Get all new siblings, EXCEPT the dragged task itself
            const siblingTasks = Object.values(reminderData)
                .filter((r: any) => r && r.parentId === newParentId && r.id !== draggedTask.id)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // Determine insertion point
            // Use event.target instead of event.currentTarget to avoid null reference
            const targetElement = event.target as HTMLElement;
            if (!targetElement) {
                throw new Error("Event target is null");
            }

            // Find the task element that contains the target
            let taskElement = targetElement.closest('.kanban-task') as HTMLElement;
            if (!taskElement) {
                throw new Error("Could not find task element");
            }

            const rect = taskElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetTask.id);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            // Insert the dragged task into the siblings list
            siblingTasks.splice(insertIndex, 0, draggedTaskInDb);

            // Re-assign sort values
            siblingTasks.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('Failed to set task as sibling and sort:', error);
            showMessage("移动任务失败");
        }
    }

    private async reorderTasks(draggedTask: any, targetTask: any, insertBefore: boolean) {
        try {
            const reminderData = await readReminderData();

            const draggedId = draggedTask.id;
            const targetId = targetTask.id;

            const draggedTaskInDb = reminderData[draggedId];
            const targetTaskInDb = reminderData[targetId];

            if (!draggedTaskInDb || !targetTaskInDb) {
                throw new Error("Task not found in data");
            }

            const oldStatus = this.getTaskStatus(draggedTaskInDb);
            const newStatus = this.getTaskStatus(targetTaskInDb);

            // 检查是否为子任务排序
            const isSubtaskReorder = draggedTaskInDb.parentId && targetTaskInDb.parentId &&
                draggedTaskInDb.parentId === targetTaskInDb.parentId;

            if (isSubtaskReorder) {
                // 子任务排序逻辑
                const parentId = draggedTaskInDb.parentId;

                // 获取同一父任务下的所有子任务
                const siblingTasks = Object.values(reminderData)
                    .filter((r: any) => r && r.parentId === parentId && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

                // 插入被拖拽的任务
                siblingTasks.splice(insertIndex, 0, draggedTaskInDb);

                // 重新分配排序值
                siblingTasks.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                return; // 子任务排序完成，直接返回
            }

            // 顶层任务排序逻辑（原有逻辑）
            const priority = draggedTaskInDb.priority || 'none';

            // --- Update status of dragged task ---
            if (oldStatus !== newStatus) {
                if (newStatus === 'done') {
                    draggedTaskInDb.completed = true;
                    draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                } else {
                    draggedTaskInDb.completed = false;
                    delete draggedTaskInDb.completedTime;
                    draggedTaskInDb.kanbanStatus = newStatus;
                }
            }

            // --- Reorder source list (if status changed) ---
            if (oldStatus !== newStatus) {
                const sourceList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === oldStatus && (r.priority || 'none') === priority && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                sourceList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
            }

            // --- Reorder target list ---
            const targetList = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === newStatus && (r.priority || 'none') === priority && r.id !== draggedId)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            targetList.splice(insertIndex, 0, draggedTaskInDb);

            targetList.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

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
            const reminderData = await readReminderData();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始周期事件不存在");
                return;
            }

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[task.date];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: task.id,
                date: task.date,
                endDate: task.endDate,
                time: task.time,
                endTime: task.endTime,
                note: instanceMod?.note || '',  // 每个实例的备注都是独立的，默认为空
                isInstance: true,
                originalId: task.originalId,
                instanceDate: task.date
            };

            const editDialog = new ReminderEditDialog(instanceData, async () => {
                await this.loadTasks();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            });
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
            "删除此实例",
            `确定要删除周期任务 "${task.title}" 在 ${task.date} 的实例吗？`,
            async () => {
                try {
                    const originalId = task.originalId;
                    const instanceDate = task.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage("实例已删除");
                    await this.loadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('删除周期实例失败:', error);
                    showMessage("删除实例失败");
                }
            }
        );
    }

    /**
     * 为原始周期事件添加排除日期
     */
    private async addExcludedDate(originalId: string, excludeDate: string) {
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
            hasUncompletedFutureInstance = repeatInstances.some(instance =>
                compareDateStrings(instance.date, today) > 0 &&
                !completedInstances.includes(instance.date)
            );

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
}
