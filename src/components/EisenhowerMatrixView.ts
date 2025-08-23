import { readReminderData, writeReminderData } from "../api";
import { ProjectManager } from "../utils/projectManager";
import { CategoryManager } from "../utils/categoryManager";
import { QuickReminderDialog } from "./QuickReminderDialog";
import { ReminderEditDialog } from "./ReminderEditDialog";
import { showMessage, confirm, openTab, Menu, Dialog } from "siyuan";
import { t } from "../utils/i18n";
import { getLocalDateString } from "../utils/dateUtils";
import { openBlock } from '../api';
interface QuadrantTask {
    id: string;
    title: string;
    priority: 'high' | 'medium' | 'low' | 'none';
    isUrgent: boolean;
    projectId?: string;
    projectName?: string;
    completed: boolean;
    date: string;
    time?: string;
    note?: string;
    blockId?: string;
    extendedProps: any;
    quadrant?: 'important-urgent' | 'important-not-urgent' | 'not-important-urgent' | 'not-important-not-urgent';
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
    private projectFilter: Set<string> = new Set();

    constructor(container: HTMLElement, plugin: any) {
        this.container = container;
        this.plugin = plugin;
        this.projectManager = ProjectManager.getInstance();
        this.categoryManager = CategoryManager.getInstance();
        this.initQuadrants();
    }

    private initQuadrants() {
        this.quadrants = [
            {
                key: 'important-urgent',
                title: '🔥重要且紧急',
                description: '立即处理的任务',
                color: '#e74c3c',
                tasks: []
            },
            {
                key: 'important-not-urgent',
                title: '📅重要不紧急',
                description: '计划处理的任务',
                color: '#3498db',
                tasks: []
            },
            {
                key: 'not-important-urgent',
                title: '⏰不重要但紧急',
                description: '可以委托的任务',
                color: '#f39c12',
                tasks: []
            },
            {
                key: 'not-important-not-urgent',
                title: '🌱不重要不紧急',
                description: '可以删除的任务',
                color: '#95a5a6',
                tasks: []
            }
        ];
    }

    async initialize() {
        await this.projectManager.initialize();
        await this.categoryManager.initialize();
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
            <h2>${t("eisenhowerMatrix")}</h2>
            <div class="matrix-header-buttons">
                <button class="b3-button b3-button--outline filter-btn" title="筛选">
                    <svg class="b3-button__icon"><use xlink:href="#iconFilter"></use></svg>
                    筛选
                </button>
                <button class="b3-button b3-button--outline refresh-btn" title="${t("refresh")}">
                    <svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>
                    ${t("refresh")}
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
                ${t("newTask")}
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

    private async loadTasks() {
        try {
            const reminderData = await readReminderData();
            this.allTasks = [];

            for (const [id, reminder] of Object.entries(reminderData as any)) {
                if (!reminder || typeof reminder !== 'object') continue;

                // 跳过已完成的任务
                if (reminder.completed) continue;

                // 判断重要性
                const isImportant = reminder.priority === 'high' || reminder.priority === 'medium';
                
                // 判断紧急性
                const isUrgent = this.isTaskUrgent(reminder);

                // 确定象限
                let quadrant: QuadrantTask['quadrant'];
                if (isImportant && isUrgent) {
                    quadrant = 'important-urgent';
                } else if (isImportant && !isUrgent) {
                    quadrant = 'important-not-urgent';
                } else if (!isImportant && isUrgent) {
                    quadrant = 'not-important-urgent';
                } else {
                    quadrant = 'not-important-not-urgent';
                }

                // 如果有手动设置的象限属性，则使用手动设置
                if (reminder.quadrant && this.isValidQuadrant(reminder.quadrant)) {
                    quadrant = reminder.quadrant;
                }

                // 获取项目信息
                let projectName = '';
                if (reminder.projectId) {
                    const project = this.projectManager.getProjectById(reminder.projectId);
                    projectName = project ? project.name : '';
                }

                const task: QuadrantTask = {
                    id,
                    title: reminder.title || t('unnamedNote'),
                    priority: reminder.priority || 'none',
                    isUrgent,
                    projectId: reminder.projectId,
                    projectName,
                    completed: reminder.completed || false,
                    date: reminder.date,
                    time: reminder.time,
                    note: reminder.note,
                    blockId: reminder.blockId,
                    extendedProps: reminder,
                    quadrant
                };

                this.allTasks.push(task);
            }

            // 应用筛选并按象限分组任务
            this.applyFiltersAndGroup();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage(t('loadTasksFailed'));
        }
    }

    private isTaskUrgent(reminder: any): boolean {
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const taskDate = new Date(reminder.date);
        
        // 过期、今天、明天的任务认为是紧急的
        return taskDate <= tomorrow;
    }

    private isValidQuadrant(quadrant: string): quadrant is QuadrantTask['quadrant'] {
        return ['important-urgent', 'important-not-urgent', 'not-important-urgent', 'not-important-not-urgent'].includes(quadrant);
    }

    private applyFiltersAndGroup() {
        // 应用筛选
        this.filteredTasks = this.allTasks.filter(task => {
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

        // 转换为数组并保持顺序
        const result: QuadrantTask[] = [];
        
        // 先添加有项目的任务
        const sortedProjects = Array.from(grouped.entries())
            .filter(([key]) => key !== 'no-project')
            .sort((a, b) => (a[1][0].projectName || '').localeCompare(b[1][0].projectName || ''));

        sortedProjects.forEach(([projectId, tasks]) => {
            result.push(...tasks);
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
                emptyEl.textContent = t('noTasksInQuadrant');
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
                if (projectKey !== 'no-project') {
                    projectHeader.textContent = tasks[0].projectName || t('noProject');
                    projectHeader.setAttribute('data-project-id', projectKey);
                    projectHeader.style.cursor = 'pointer';
                    projectHeader.title = t('openProjectKanban');
                    
                    // 添加点击事件打开项目看板
                    projectHeader.addEventListener('click', () => {
                        this.openProjectKanban(projectKey);
                    });
                } else {
                    projectHeader.textContent = t('noProject');
                }
                projectGroup.appendChild(projectHeader);

                tasks.forEach(task => {
                    const taskEl = this.createTaskElement(task);
                    projectGroup.appendChild(taskEl);
                });

                contentEl.appendChild(projectGroup);
            });
        });
    }

    private createTaskElement(task: QuadrantTask): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = `task-item ${task.completed ? 'completed' : ''}`;
        taskEl.setAttribute('data-task-id', task.id);
        taskEl.setAttribute('draggable', 'true');

        // 设置任务颜色（根据优先级）
        let color = '';
        switch (task.priority) {
            case 'high':
                color = '#e74c3c';
                break;
            case 'medium':
                color = '#f39c12';
                break;
            case 'low':
                color = '#3498db';
                break;
            default:
                color = '#95a5a6';
        }

        // 创建任务内容容器
        const taskContent = document.createElement('div');
        taskContent.className = 'task-content';

        // 创建复选框容器
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'task-checkbox';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = task.completed;
        checkboxContainer.appendChild(checkbox);

        // 创建任务信息容器
        const taskInfo = document.createElement('div');
        taskInfo.className = 'task-info';

        // 创建任务标题
        const taskTitle = document.createElement('div');
        taskTitle.className = 'task-title';
        taskTitle.style.borderLeftColor = color;
        taskTitle.textContent = task.title;

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

        // 创建任务元数据
        const taskMeta = document.createElement('div');
        taskMeta.className = 'task-meta';

        if (task.date) {
            const dateSpan = document.createElement('span');
            dateSpan.className = 'task-date';
            dateSpan.textContent = `📅 ${task.date}`;
            taskMeta.appendChild(dateSpan);
        }

        if (task.time) {
            const timeSpan = document.createElement('span');
            timeSpan.className = 'task-time';
            timeSpan.textContent = `🕐 ${task.time}`;
            taskMeta.appendChild(timeSpan);
        }

        // 组装元素
        taskInfo.appendChild(taskTitle);
        taskInfo.appendChild(taskMeta);
        taskContent.appendChild(checkboxContainer);
        taskContent.appendChild(taskInfo);
        taskEl.appendChild(taskContent);

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

        // 拖拽事件
        taskEl.addEventListener('dragstart', (e) => {
            e.dataTransfer!.setData('text/plain', task.id);
            taskEl.classList.add('dragging');
        });

        taskEl.addEventListener('dragend', () => {
            taskEl.classList.remove('dragging');
        });

        return taskEl;
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

        // 新建任务按钮
        const newTaskButtons = this.container.querySelectorAll('.add-task-btn');
        newTaskButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const quadrant = btn.getAttribute('data-quadrant');
                this.createNewTask(quadrant as QuadrantTask['quadrant']);
            });
        });

        // 筛选按钮
        const filterBtn = this.container.querySelector('.filter-btn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => {
                this.showFilterDialog();
            });
        }

        // 监听任务更新事件
        window.addEventListener('reminderUpdated', () => {
            this.refresh();
        });
    }

    private async moveTaskToQuadrant(taskId: string, newQuadrant: QuadrantTask['quadrant']) {
        try {
            const reminderData = await readReminderData();
            
            if (reminderData[taskId]) {
                reminderData[taskId].quadrant = newQuadrant;
                await writeReminderData(reminderData);
                
                await this.refresh();
                showMessage(t('taskMovedToQuadrant'));
            }
        } catch (error) {
            console.error('移动任务失败:', error);
            showMessage(t('moveTaskFailed'));
        }
    }

    private async createNewTask(quadrant: QuadrantTask['quadrant']) {
        // 直接打开快速提醒对话框，项目选择将在对话框中进行
        this.showQuickReminderDialog(quadrant, null);
    }

    private showQuickReminderDialog(quadrant: QuadrantTask['quadrant'], projectId: string | null) {
        const today = getLocalDateString();
        const dialog = new QuickReminderDialog(today, null, async () => {
            await this.refresh();
        });
        
        // 设置默认象限和项目
        (dialog as any).defaultQuadrant = quadrant;
        if (projectId) {
            (dialog as any).defaultProjectId = projectId;
        }
        
        dialog.show();
    }

    private async createNewProjectAndNewTask(quadrant: QuadrantTask['quadrant']) {
        try {
            const projectName = prompt(t('pleaseEnterProjectName'));
            if (!projectName) return;

            // 注意：这里需要根据实际的 ProjectManager API 调整
            // const project = await this.projectManager.createProject(projectName);
            showMessage('创建项目功能需要实现');
            return;
        } catch (error) {
            console.error('创建项目并新建任务失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async toggleTaskCompletion(task: QuadrantTask, completed: boolean) {
        try {
            const reminderData = await readReminderData();
            
            if (reminderData[task.id]) {
                reminderData[task.id].completed = completed;
                await writeReminderData(reminderData);
                
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            }
        } catch (error) {
            console.error('更新任务状态失败:', error);
            showMessage(t('updateTaskStatusFailed'));
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
                    showMessage('打开笔记失败');
                }
            );
        }
    }

    private async deleteTaskByBlockId(blockId: string) {
        try {
            const reminderData = await readReminderData();
            let taskFound = false;
            
            for (const [taskId, reminder] of Object.entries(reminderData as any)) {
                if (reminder && typeof reminder === 'object' && (reminder as any).blockId === blockId) {
                    delete reminderData[taskId];
                    taskFound = true;
                }
            }
            
            if (taskFound) {
                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                showMessage('相关任务记录已删除');
                await this.refresh();
            } else {
                showMessage('任务记录不存在');
            }
        } catch (error) {
            console.error('删除任务记录失败:', error);
            showMessage('删除任务记录失败');
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
            label: t('edit'),
            icon: 'iconEdit',
            click: () => {
                this.showTaskEditDialog(task);
            }
        });

        menu.addSeparator();

        // 项目分配选项
        if (task.projectId) {
            menu.addItem({
                label: t('openProjectKanban'),
                icon: 'iconProject',
                click: () => {
                    this.openProjectKanban(task.projectId!);
                }
            });
        } else {
            menu.addItem({
                label: t('addToProject'),
                icon: 'iconProject',
                click: () => {
                    this.assignTaskToProject(task);
                }
            });
        }

        menu.open({x: 0, y: 0});
    }

    private showTaskEditDialog(task: QuadrantTask) {
        const editDialog = new ReminderEditDialog(task.extendedProps, async () => {
            await this.refresh();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        });
        
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
            showMessage(t('noActiveProjects'));
            return;
        }

        const menu = new Menu();
        
        // 当前项目显示
        if (task.projectId) {
            const currentProject = this.projectManager.getProjectById(task.projectId);
            menu.addItem({
                label: `当前: ${currentProject?.name || t('noProject')}`,
                disabled: true
            });
            menu.addSeparator();
        }

        // 无项目选项
        menu.addItem({
            label: t('noProject'),
            icon: task.projectId ? 'iconRemove' : 'iconCheck',
            click: async () => {
                await this.updateTaskProject(task.id, null);
                showMessage('项目已更新');
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
                        showMessage('项目已更新');
                    }
                }
            });
        });

        // 新建项目选项
        menu.addSeparator();
        menu.addItem({
            label: t('createNewDocument'),
            icon: 'iconAdd',
            click: async () => {
                const projectName = prompt(t('pleaseEnterProjectName'));
                if (projectName) {
                    // 注意：这里需要根据实际的 ProjectManager API 调整
                    // const project = await this.projectManager.createProject(projectName);
                    showMessage('创建项目功能需要实现');
                    return;
                }
            }
        });

        menu.open({x: 0, y: 0});
    }

    private openProjectKanban(projectId: string) {
        try {
            // 使用openTab打开项目看板
            const project = this.projectManager.getProjectById(projectId);
            if (!project) {
                showMessage("项目不存在");
                return;
            }

            openTab({
                app: this.plugin.app,
                custom: {
                    title: project.name,
                    icon: "iconProject",
                    id: this.plugin.name + "project_kanban_tab",
                    data: {
                        projectId: project.id,
                        projectTitle: project.name
                    }
                }
            });
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage("打开项目看板失败");
        }
    }

    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    private addStyles() {
        if (document.querySelector('#eisenhower-matrix-styles')) return;

        const style = document.createElement('style');
        style.id = 'eisenhower-matrix-styles';
        style.textContent = `
            .eisenhower-matrix-view {
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                display: flex;
                flex-direction: column;
                background: var(--b3-theme-background);
                color: var(--b3-theme-on-background);
                overflow: hidden;
            }

            .matrix-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-background);
                flex-shrink: 0;
            }

            .matrix-header h2 {
                margin: 0;
                font-size: 20px;
                font-weight: 600;
            }

            .matrix-header-buttons {
                display: flex;
                gap: 8px;
                align-items: center;
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
                grid-template-rows: 1fr 1fr;
                gap: 2px;
                flex: 1;
                padding: 8px;
                overflow: hidden;
                min-height: 0;
            }

            .quadrant {
                background: var(--b3-theme-surface);
                border: 3px solid;
                border-radius: 8px;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: relative;
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
                padding: 8px 12px;
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

            .project-header {
                font-weight: 600;
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                margin-bottom: 8px;
                padding: 4px 8px;
                background: var(--b3-theme-surface-lighter);
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
                border-left: 3px solid;
                padding-left: 8px;
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

            @media (max-width: 768px) {
                .matrix-grid {
                    grid-template-columns: 1fr;
                    grid-template-rows: repeat(4, 1fr);
                }

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
                max-height: 150px;
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
        `;
        document.head.appendChild(style);
    }

    private showTaskContextMenu(task: QuadrantTask, event: MouseEvent) {
        const menu = new Menu();
        
        // 添加项目分配菜单
        menu.addItem({
            label: t('addToProject'),
            icon: 'iconProject',
            click: async () => {
                await this.assignTaskToProject(task, event);
            }
        });

        // 如果任务已有项目，添加移除项目选项
        if (task.projectId) {
            menu.addItem({
                label: t('removeFromProject'),
                icon: 'iconRemove',
                click: async () => {
                    await this.removeTaskFromProject(task);
                }
            });
        }

        // 添加编辑任务选项
        menu.addItem({
            label: t('edit'),
            icon: 'iconEdit',
            click: () => {
                this.showTaskEditDialog(task);
            }
        });

        // 添加删除任务选项
        menu.addItem({
            label: t('delete'),
            icon: 'iconTrashcan',
            click: async () => {
                await this.deleteTask(task);
            }
        });

        menu.open({x: event.clientX, y: event.clientY});
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
                showMessage(t('noActiveProjects'));
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
                                showMessage(`${t('addedToProjectSuccess').replace('${count}', '1')}`);
                            }
                        });
                    });
                    
                    menu.addSeparator();
                }
            });

            // 添加新建项目选项
            menu.addSeparator();
            menu.addItem({
                label: t('createNewDocument'),
                icon: 'iconAdd',
                click: () => {
                    this.createNewProjectAndAssign(task);
                }
            });

            if (event) {
                menu.open({x: event.clientX, y: event.clientY});
            } else {
                menu.open({x: 0, y: 0});
            }
        } catch (error) {
            console.error('分配项目失败:', error);
            showMessage(t('addedToProjectFailed'));
        }
    }

    private async removeTaskFromProject(task: QuadrantTask) {
        try {
            await this.updateTaskProject(task.id, null);
            showMessage('已从项目中移除');
        } catch (error) {
            console.error('移除项目失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async updateTaskProject(taskId: string, projectId: string | null) {
        try {
            const reminderData = await readReminderData();
            
            if (reminderData[taskId]) {
                reminderData[taskId].projectId = projectId;
                await writeReminderData(reminderData);
                
                await this.refresh();
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            }
        } catch (error) {
            console.error('更新任务项目失败:', error);
            throw error;
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    private async createNewProjectAndAssign(task: QuadrantTask) {
        try {
            const projectName = prompt(t('pleaseEnterProjectName'));
            if (!projectName) return;

            // 注意：这里需要根据实际的 ProjectManager API 调整
            // const project = await this.projectManager.createProject(projectName);
            showMessage('创建项目功能需要实现');
            return;
        } catch (error) {
            console.error('创建项目并分配失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async deleteTask(task: QuadrantTask) {
        const title =  '删除提醒';
        const content = '确定要删除任务 "${title}" 吗？\n\n此操作不可撤销。'
            .replace(/\${title}/g, task.title);
        
        confirm(
            title,
            content,
            async () => {
                try {
                    const reminderData = await readReminderData();
                    if (reminderData && reminderData[task.id]) {
                        delete reminderData[task.id];
                        await writeReminderData(reminderData);
                        
                        await this.refresh();
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));
                        showMessage(t('reminderDeleted'));
                    } else {
                        console.warn('Task not found in reminder data:', task.id);
                        showMessage('任务不存在或已被删除');
                    }
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage(t('deleteReminderFailed'));
                }
            },
            () => {
                // 取消回调
                console.log('删除任务已取消');
            }
        );
    }

    async refresh() {
        await this.loadTasks();
        this.renderMatrix();
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
                        <button class="b3-button b3-button--cancel" id="filterCancelBtn">取消</button>
                        <button class="b3-button" id="filterResetBtn">重置</button>
                        <button class="b3-button b3-button--primary" id="filterApplyBtn">应用</button>
                    </div>
                </div>
            `,
            width: "450px",
            height: "500px"
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
            const noProjectCheckbox = this.createCheckbox('no-project', '无项目', this.statusFilter.has('no-project'));
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
            const noProjectCheckbox = this.createCheckbox('no-project', '无项目', this.projectFilter.has('no-project'));
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
            showMessage("筛选已应用");
        });
    }

    destroy() {
        // 清理事件监听器
        window.removeEventListener('reminderUpdated', this.refresh);
        
        // 清理样式
        const style = document.querySelector('#eisenhower-matrix-styles');
        if (style) {
            style.remove();
        }
    }
}