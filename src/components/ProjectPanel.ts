import { showMessage, confirm, Menu, Dialog, getAllModels, platformUtils } from "siyuan";
import { PomodoroStatsView, getLastStatsMode } from "./PomodoroStatsView";
import { TaskStatsView } from "./TaskStatsView";

// 添加四象限面板常量
import { getBlockByID, openBlock } from "../api";
import { PROJECT_KANBAN_TAB_TYPE } from "../index";
import { ProjectManager } from "../utils/projectManager";
import { compareDateStrings, getLogicalDateString, getLocaleTag } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { StatusManager } from "../utils/statusManager";
import { ProjectDialog } from "./ProjectDialog";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { StatusManageDialog } from "./StatusManageDialog";
import { ProjectKanbanView } from "./ProjectKanbanView";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { i18n } from "../pluginInstance";
import { getAllReminders } from "../utils/icsSubscription";


export class ProjectPanel {
    private container: HTMLElement;
    private projectsContainer: HTMLElement;
    private filterSelect: HTMLSelectElement;
    private categoryFilterButton: HTMLButtonElement;
    private sortButton: HTMLButtonElement;
    private searchInput: HTMLInputElement;
    private showOnlyWithDoingCheckbox: HTMLInputElement;
    private plugin: any;
    private currentTab: string = 'all';
    private selectedCategories: string[] = [];
    private currentSort: string = 'priority';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private currentSearchQuery: string = '';
    private showOnlyWithDoingTasks: boolean = false;
    private categoryManager: CategoryManager;
    private statusManager: StatusManager;
    private projectUpdatedHandler: () => void;
    private reminderUpdatedHandler: (e: any) => void;
    // 添加拖拽相关属性
    private isDragging: boolean = false;
    private draggedElement: HTMLElement | null = null;
    private draggedProject: any = null;
    private currentProjectsCache: any[] = [];
    // 保存每个状态分组的折叠状态（key = statusId, value = boolean; true=collapsed）
    private groupCollapsedState: Record<string, boolean> = {};
    // 缓存提醒数据，避免为每个项目重复读取
    private reminderDataCache: any = null;

    constructor(container: HTMLElement, plugin?: any) {
        this.container = container;
        this.plugin = plugin;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.statusManager = StatusManager.getInstance(this.plugin);

        this.projectUpdatedHandler = () => {
            this.loadProjects();
        };

        this.reminderUpdatedHandler = async (e: any) => {
            // 清空提醒缓存并重新加载计数
            this.reminderDataCache = null;

            const detail = e.detail;
            // 如果提供了 projectId，只更新该项目的统计数据
            // 这样可以避免每次任务变动都重绘整个项目列表，防止滚动位置丢失和闪烁
            if (detail && detail.projectId) {
                const projectEl = this.projectsContainer.querySelector(`.project-item[data-project-id="${detail.projectId}"]`) as HTMLElement;
                if (projectEl) {
                    const dynamicWrapper = projectEl.querySelector('.project-counts-dynamic') as HTMLElement;
                    const pomodoroEl = projectEl.querySelector('.project-count--pomodoro') as HTMLElement;
                    const progressBarInner = projectEl.querySelector('.project-progress-inner') as HTMLElement;
                    const progressText = projectEl.querySelector('.project-progress-text') as HTMLElement;

                    if (dynamicWrapper) {
                        // 重新计算并更新该项目的统计信息（会根据项目的 kanban statuses 渲染）
                        await this.fillProjectTopLevelCounts(detail.projectId, dynamicWrapper, pomodoroEl, progressBarInner, progressText);
                        return;
                    }
                }
            }

            // 重新渲染当前已加载的项目计数
            // 如果项目已渲染，则触发一次重新加载以刷新计数显示
            this.loadProjects();
        };

        this.initializeAsync();
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.statusManager.initialize();
        await this.restorePanelSettings();
        this.initUI();
        this.loadProjects();

        // 监听项目更新事件
        window.addEventListener('projectUpdated', this.projectUpdatedHandler);
        // 监听提醒更新事件，更新计数缓存
        window.addEventListener('reminderUpdated', this.reminderUpdatedHandler);
    }

    public destroy() {
        if (this.projectUpdatedHandler) {
            window.removeEventListener('projectUpdated', this.projectUpdatedHandler);
        }
        if (this.reminderUpdatedHandler) {
            window.removeEventListener('reminderUpdated', this.reminderUpdatedHandler);
        }
    }

    private initUI() {
        this.container.classList.add('project-panel');
        this.container.innerHTML = '';

        // 标题部分
        const header = document.createElement('div');
        header.className = 'project-header';

        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-title';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'project-icon';
        iconSpan.textContent = '📁';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = i18n("projectManagement") || "项目管理";

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);

        // 添加右侧按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'project-panel__actions';
        actionContainer.style.marginLeft = 'auto';

        // 添加创建项目按钮
        const createProjectBtn = document.createElement('button');
        createProjectBtn.className = 'b3-button b3-button--outline';
        createProjectBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        createProjectBtn.title = i18n("createProject") || "创建项目";
        createProjectBtn.addEventListener('click', () => {
            this.createQuickProject();
        });
        actionContainer.appendChild(createProjectBtn);

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.title = i18n("sortBy") || "排序";
        this.sortButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showSortMenu(e);
        });
        actionContainer.appendChild(this.sortButton);

        // 添加日历视图按钮
        if (this.plugin) {
            const calendarBtn = document.createElement('button');
            calendarBtn.className = 'b3-button b3-button--outline';
            calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
            calendarBtn.title = i18n("calendarView") || "日历视图";
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);

            // 添加四象限面板按钮（放在日历按钮旁边）
            const eisenhowerBtn = document.createElement('button');
            eisenhowerBtn.className = 'b3-button b3-button--outline';
            eisenhowerBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconGrid"></use></svg>';
            eisenhowerBtn.title = i18n("eisenhowerMatrix") || "四象限面板";
            eisenhowerBtn.addEventListener('click', () => {
                this.openEisenhowerMatrix();
            });
            actionContainer.appendChild(eisenhowerBtn);

            // 添加番茄钟看板按钮
            const pomodoroStatsBtn = document.createElement('button');
            pomodoroStatsBtn.className = 'b3-button b3-button--outline';
            pomodoroStatsBtn.innerHTML = '📊';
            pomodoroStatsBtn.title = i18n("pomodoroStats") || "番茄钟统计";
            pomodoroStatsBtn.addEventListener('click', () => {
                this.showPomodoroStatsView();
            });
            actionContainer.appendChild(pomodoroStatsBtn);

            // 添加刷新按钮
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'b3-button b3-button--outline';
            refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
            refreshBtn.title = i18n("refresh") || "刷新";
            refreshBtn.addEventListener('click', () => {
                this.loadProjects();
            });
            actionContainer.appendChild(refreshBtn);
        }

        // 添加更多按钮（放在最右边）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.title = i18n("more") || "更多";
        moreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showMoreMenu(e);
        });
        actionContainer.appendChild(moreBtn);

        titleContainer.appendChild(actionContainer);
        header.appendChild(titleContainer);

        // 把按钮容器移到标题下方，确保标题独占一行，按钮右对齐
        const actionRow = document.createElement('div');
        actionRow.className = 'project-header__actions-row';
        // 使用 flex 布局使按钮靠右
        actionRow.style.cssText = `display:flex; justify-content:flex-start; margin-bottom:8px; gap:8px;flex-wrap: wrap;`;
        // 将 actionContainer 中的按钮移动到 actionRow
        while (actionContainer.firstChild) {
            // 由于 actionContainer 可能包含样式 marginLeft:auto，我们直接把子节点移动
            actionRow.appendChild(actionContainer.firstChild);
        }

        header.appendChild(actionRow);

        // 筛选控件
        const controls = document.createElement('div');
        controls.className = 'project-controls';
        controls.style.cssText = `
            display: flex;
            gap: 8px;
            width: 100%;
            align-items: center;
        `;

        // 状态筛选
        this.filterSelect = document.createElement('select');
        this.filterSelect.className = 'b3-select';
        this.filterSelect.style.cssText = `
            flex: 1;
            min-width: 0;
        `;
        this.renderStatusFilter();
        this.filterSelect.addEventListener('change', () => {
            this.currentTab = this.filterSelect.value;
            this.loadProjects();
        });
        controls.appendChild(this.filterSelect);

        // 分类筛选
        this.categoryFilterButton = document.createElement('button');
        this.categoryFilterButton.className = 'b3-button b3-button--outline';
        this.categoryFilterButton.style.cssText = `
            display: inline-block;
            max-width: 30%;
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

        // 添加"只显示进行中>0"复选框
        const doingFilterContainer = document.createElement('label');
        doingFilterContainer.className = 'b3-label';
        doingFilterContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            margin: 0;
            white-space: nowrap;
            cursor: pointer;
            padding: 0;
        `;

        this.showOnlyWithDoingCheckbox = document.createElement('input');
        this.showOnlyWithDoingCheckbox.type = 'checkbox';
        this.showOnlyWithDoingCheckbox.className = 'b3-switch';
        this.showOnlyWithDoingCheckbox.checked = this.showOnlyWithDoingTasks;
        this.showOnlyWithDoingCheckbox.addEventListener('change', () => {
            this.showOnlyWithDoingTasks = this.showOnlyWithDoingCheckbox.checked;
            this.savePanelSettings();
            this.loadProjects();
        });

        const doingFilterText = document.createElement('span');
        doingFilterText.textContent = i18n("showOnlyWithDoingTasks") || '进行中>0';
        doingFilterText.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
        `;

        doingFilterContainer.appendChild(this.showOnlyWithDoingCheckbox);
        doingFilterContainer.appendChild(doingFilterText);
        controls.appendChild(doingFilterContainer);

        header.appendChild(controls);

        // 搜索框
        const searchContainer = document.createElement('div');
        searchContainer.className = 'project-search';
        searchContainer.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 8px;
        `;

        this.searchInput = document.createElement('input');
        this.searchInput.className = 'b3-text-field';
        this.searchInput.type = 'text';
        this.searchInput.placeholder = i18n("searchProjects") || "搜索项目...";
        this.searchInput.style.cssText = `
            flex: 1;
        `;
        this.searchInput.addEventListener('input', () => {
            this.currentSearchQuery = this.searchInput.value.trim().toLowerCase();
            this.loadProjects();
        });

        searchContainer.appendChild(this.searchInput);
        header.appendChild(searchContainer);

        this.container.appendChild(header);

        // 项目列表容器
        this.projectsContainer = document.createElement('div');
        this.projectsContainer.className = 'project-list';
        this.container.appendChild(this.projectsContainer);

        // 渲染分类过滤器
        this.updateCategoryFilterButtonText();
        this.updateSortButtonTitle();
    }

    private async renderStatusFilter() {
        if (!this.filterSelect) return;

        try {
            const statuses = this.statusManager.getStatuses();

            this.filterSelect.innerHTML = `<option value="all">${i18n("allProjects") || "全部项目"}</option>`;

            statuses.forEach(status => {
                const optionEl = document.createElement('option');
                optionEl.value = status.id;
                const displayText = status.icon ? `${status.icon} ${status.name}` : status.name;
                optionEl.textContent = displayText;
                optionEl.selected = this.currentTab === status.id;
                this.filterSelect.appendChild(optionEl);
            });

        } catch (error) {
            console.error('渲染状态过滤器失败:', error);
            this.filterSelect.innerHTML = `<option value="all">${i18n("allProjects") || "全部项目"}</option>`;
        }
    }

    private updateCategoryFilterButtonText() {
        if (!this.categoryFilterButton) return;

        if (this.selectedCategories.length === 0 || this.selectedCategories.includes('all')) {
            this.categoryFilterButton.textContent = i18n("categoryFilter") || "分类筛选";
        } else {
            // 显示选中的分类名称
            const names = this.selectedCategories.map(id => {
                if (id === 'none') return i18n("noCategory") || "无分类";
                const cat = this.categoryManager.getCategoryById(id);
                return cat ? cat.name : id;
            });
            this.categoryFilterButton.textContent = names.join(', ');
        }
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': i18n("sortByTime") || '时间',
                'priority': i18n("sortByPriority") || '优先级',
                'title': i18n("sortByTitle") || '标题'
            };
            const orderNames = {
                'asc': i18n("ascending") || '升序',
                'desc': i18n("descending") || '降序'
            };
            this.sortButton.title = `${i18n("sortBy") || "排序"}: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private showSortMenu(event: MouseEvent) {
        try {
            const menu = new Menu("projectSortMenu");

            const sortOptions = [
                { key: 'time', label: i18n("sortByTime") || '时间', icon: '🕐' },
                { key: 'priority', label: i18n("sortByPriority") || '优先级', icon: '🎯' },
                { key: 'title', label: i18n("sortByTitle") || '标题', icon: '📝' }
            ];

            sortOptions.forEach(option => {
                // 升序
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${i18n("ascending") || "升序"}↑)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'asc',
                    click: () => {
                        this.currentSort = option.key;
                        this.currentSortOrder = 'asc';
                        this.updateSortButtonTitle();
                        this.savePanelSettings();
                        this.loadProjects();
                    }
                });

                // 降序
                menu.addItem({
                    iconHTML: option.icon,
                    label: `${option.label} (${i18n("descending") || "降序"}↓)`,
                    current: this.currentSort === option.key && this.currentSortOrder === 'desc',
                    click: () => {
                        this.currentSort = option.key;
                        this.currentSortOrder = 'desc';
                        this.updateSortButtonTitle();
                        this.savePanelSettings();
                        this.loadProjects();
                    }
                });
            });

            if (this.sortButton) {
                const rect = this.sortButton.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

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
        }
    }

    private async loadProjects() {
        try {
            const projectData = await this.plugin.loadProjectData();

            if (!projectData || typeof projectData !== 'object') {
                this.renderProjects([]);
                return;
            }

            // 迁移旧数据：将 archived 字段转换为 status 字段
            let dataChanged = false;
            const projects = Object.values(projectData).filter((project: any) => {
                if (project && typeof project === 'object' && project.id) {
                    // 数据迁移：将旧的 archived 字段转换为新的 status 字段
                    if (!project.status && project.hasOwnProperty('archived')) {
                        project.status = project.archived ? 'archived' : 'active';
                        dataChanged = true;
                    } else if (!project.status) {
                        project.status = 'active';
                        dataChanged = true;
                    }
                    return true;
                }
                return false;
            });

            // 如果有数据迁移，保存更新
            if (dataChanged) {
                await this.plugin.saveProjectData(projectData);
            }

            // 应用分类过滤
            let filteredProjects = this.applyCategoryFilter(projects);

            // 应用搜索过滤
            if (this.currentSearchQuery) {
                filteredProjects = this.applySearchFilter(filteredProjects);
            }

            // 分类项目
            let displayProjects = [];
            if (this.currentTab === 'all') {
                displayProjects = filteredProjects;
            } else {
                displayProjects = filteredProjects.filter((project: any) => project.status === this.currentTab);
            }

            // 应用排序
            this.sortProjects(displayProjects);

            // 预先读取提醒数据缓存，用于计算每个项目的任务计数
            try {
                this.reminderDataCache = await getAllReminders(this.plugin, undefined, false);
            } catch (err) {
                console.warn('读取提醒数据失败，计数将异步回退：', err);
                this.reminderDataCache = null;
            }

            // 如果勾选了"只显示进行中>0"，则过滤项目
            if (this.showOnlyWithDoingTasks && this.reminderDataCache) {
                const filtered: any[] = [];
                for (const project of displayProjects) {
                    try {
                        const counts = await this.countTopLevelKanbanStatus(project.id, this.reminderDataCache);
                        if (counts.doing > 0) filtered.push(project);
                    } catch (err) {
                        // on error, conservatively include the project
                        filtered.push(project);
                    }
                }
                displayProjects = filtered;
            }

            // 渲染项目
            this.renderProjects(displayProjects);

        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
    }

    private applyCategoryFilter(projects: any[]): any[] {
        if (this.selectedCategories.length === 0 || this.selectedCategories.includes('all')) {
            return projects;
        }

        return projects.filter(project => {
            const categoryIds = project.categoryId ? project.categoryId.split(',').filter((id: string) => id.trim()) : ['none'];
            if (categoryIds.length === 0) categoryIds.push('none');
            // Check if any of the project's categories are in the selected categories list
            return categoryIds.some((id: string) => this.selectedCategories.includes(id));
        });
    }

    private applySearchFilter(projects: any[]): any[] {
        if (!this.currentSearchQuery) {
            return projects;
        }

        // 将搜索查询按空格分割成多个词
        const searchTerms = this.currentSearchQuery.trim().split(/\s+/).filter(term => term.length > 0);

        return projects.filter(project => {
            // 构建搜索文本：标题 + 分类名称 + 自定义分组名称
            const title = (project.title || '').toLowerCase();
            let categoryNames = '';
            if (project.categoryId) {
                const ids = project.categoryId.split(',').filter((id: string) => id.trim());
                categoryNames = ids.map((id: string) => {
                    const category = this.categoryManager.getCategoryById(id);
                    return category ? (category.name || '').toLowerCase() : '';
                }).join(' ');
            }
            let customGroupNames = '';
            if (project.customGroups && Array.isArray(project.customGroups)) {
                customGroupNames = project.customGroups.map((group: any) => (group.name || '').toLowerCase()).join(' ');
            }
            const searchText = title + ' ' + categoryNames + ' ' + customGroupNames;

            // 检查所有搜索词是否都包含在搜索文本中
            return searchTerms.every(term => searchText.includes(term.toLowerCase()));
        });
    }


    private sortProjects(projects: any[]) {
        const sortType = this.currentSort;
        const sortOrder = this.currentSortOrder;

        projects.sort((a: any, b: any) => {
            let result = 0;

            switch (sortType) {
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriorityWithManualSort(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                default:
                    result = this.compareByTime(a, b);
            }

            // 优先级排序的结果相反
            if (sortType === 'priority') {
                result = -result;
            }

            return sortOrder === 'desc' ? -result : result;
        });
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

    private compareByTime(a: any, b: any): number {
        const dateA = a.startDate || a.createdTime || '';
        const dateB = b.startDate || b.createdTime || '';
        return dateA.localeCompare(dateB);
    }

    // ...existing code...

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        return titleA.localeCompare(titleB, getLocaleTag());
    }

    private renderProjects(projects: any[]) {
        // 如果没有项目则显示空提示
        if (!projects || projects.length === 0) {
            // 当在 "all" 标签下，排除归档后可能为空
            if (this.currentTab === 'all') {
                this.projectsContainer.innerHTML = `<div class="project-empty">${i18n("noProjects") || '暂无项目'}</div>`;
            } else {
                const status = this.statusManager.getStatusById(this.currentTab);
                const statusName = status ? status.name : i18n("allProjects");
                const emptyText = i18n("noProjectsInStatus")?.replace("${status}", statusName) || `暂无“${statusName}”状态的项目`;
                this.projectsContainer.innerHTML = `<div class="project-empty">${emptyText}</div>`;
            }
            // 清空缓存
            this.currentProjectsCache = [];
            return;
        }

        // 缓存当前项目列表
        this.currentProjectsCache = [...projects];

        // 如果 currentTab 为 'all'，则按状态分组并排除 archived
        if (this.currentTab === 'all') {
            // 按状态分组
            const groups: Record<string, any[]> = {};
            projects.forEach(p => {
                const st = p.status || 'active';
                // 跳过归档状态
                if (st === 'archived') return;
                if (!groups[st]) groups[st] = [];
                groups[st].push(p);
            });

            // 清空容器
            this.projectsContainer.innerHTML = '';

            // 获取按状态显示顺序（先使用 statusManager 中的顺序）
            const statuses = this.statusManager.getStatuses();

            // 先渲染非 statusManager 中定义的状态
            const rendered = new Set<string>();

            statuses.forEach(status => {
                const sid = status.id;
                if (groups[sid] && groups[sid].length > 0) {
                    rendered.add(sid);
                    const groupEl = this.createStatusGroupElement(status, groups[sid]);
                    this.projectsContainer.appendChild(groupEl);
                }
            });

            // 剩余自定义状态
            Object.keys(groups).forEach(sid => {
                if (rendered.has(sid)) return;
                const statusInfo = this.statusManager.getStatusById(sid) || { id: sid, name: sid, icon: '' };
                const groupEl = this.createStatusGroupElement(statusInfo, groups[sid]);
                this.projectsContainer.appendChild(groupEl);
            });

            return;
        }

        // 非 'all' 标签，直接渲染列表（同之前逻辑）
        this.projectsContainer.innerHTML = '';
        projects.forEach((project: any) => {
            const projectEl = this.createProjectElement(project);
            this.projectsContainer.appendChild(projectEl);
        });
    }

    private createProjectElement(project: any): HTMLElement {
        const today = getLogicalDateString();
        const isOverdue = project.endDate && compareDateStrings(project.endDate, today) < 0;
        const priority = project.priority || 'none';
        const status = project.status || 'active';

        const projectEl = document.createElement('div');
        projectEl.className = `project-item ${isOverdue ? 'project-item--overdue' : ''} project-item--${status} project-priority-${priority}`;

        // 存储项目数据到元素
        projectEl.dataset.projectId = project.id;
        projectEl.dataset.priority = priority;

        // 创建拖拽手柄
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = '⋮⋮';
        dragHandle.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            cursor: grab;
            padding: 4px 8px;
            color: var(--b3-theme-on-surface);
            opacity: 0;
            font-size: 12px;
            user-select: none;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--b3-theme-surface);
            border-radius: 4px;
            border: 1px solid var(--b3-border-color);
            transition: opacity 0.2s ease;
            z-index: 10;
        `;
        dragHandle.title = "拖拽排序";

        // 添加hover效果
        projectEl.addEventListener('mouseenter', () => {
            dragHandle.style.opacity = '1';
        });
        projectEl.addEventListener('mouseleave', () => {
            dragHandle.style.opacity = '0';
        });

        // 将拖拽手柄添加到project-item
        projectEl.appendChild(dragHandle);

        // 在优先级排序模式下添加拖拽功能
        if (this.currentSort === 'priority') {
            this.addDragFunctionality(projectEl, dragHandle, project);
        }

        // 添加右键菜单支持
        projectEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showProjectContextMenu(e, project);
        });

        // 添加单击打开项目看板支持
        projectEl.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.drag-handle')) return;
            e.preventDefault();
            e.stopPropagation();
            this.openProjectKanban(project);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'project-item__content';

        // 信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'project-item__info';

        // 标题
        const titleEl = document.createElement('span');
        titleEl.className = 'project-item__title';
        titleEl.textContent = project.title || i18n("unnamedNote") || '未命名项目';

        if (project.blockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${project.blockId}`);
            titleEl.style.cssText = `
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline;
                font-weight: 500;
            `;
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openProject(project.blockId);
            });
        } else {
            titleEl.style.cssText = `
                font-weight: 500;
            `;
        }

        // 时间信息容器
        const timeContainer = document.createElement('div');
        timeContainer.className = 'project-item__time-container';
        timeContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 4px;
            flex-wrap: wrap;
        `;

        // 添加倒计时或已开始天数显示 - 只为非已归档的项目显示
        if (status !== 'archived') {
            if (project.endDate) {
                // 有结束日期，显示倒计时
                const countdownEl = this.createCountdownElement(project.endDate, today);
                timeContainer.appendChild(countdownEl);
            } else if (project.startDate) {
                // 只有开始日期，显示已开始天数
                const startedEl = this.createStartedElement(project.startDate, today);
                timeContainer.appendChild(startedEl);
            }
        }

        // 时间信息
        const timeEl = document.createElement('div');
        timeEl.className = 'project-item__time';
        timeEl.textContent = this.formatProjectTime(project.startDate, project.endDate, today);
        timeContainer.appendChild(timeEl);




        // 添加优先级标签
        if (priority !== 'none') {
            const priorityLabel = document.createElement('span');
            priorityLabel.className = `project-priority-label ${priority}`;
            const priorityNames = {
                'high': i18n("highPriority") || '高优先级',
                'medium': i18n("mediumPriority") || '中优先级',
                'low': i18n("lowPriority") || '低优先级'
            };
            priorityLabel.innerHTML = `<div class="priority-dot ${priority}"></div>${priorityNames[priority]}`;
            timeContainer.appendChild(priorityLabel);
        }

        infoEl.appendChild(titleEl);
        infoEl.appendChild(timeContainer);

        // 添加状态标签
        const statusLabel = document.createElement('div');
        statusLabel.className = `project-status-label project-status-${status}`;
        const statusInfo = this.statusManager.getStatusById(status);
        statusLabel.textContent = statusInfo ? `${statusInfo.icon || ''} ${statusInfo.name}` : (i18n("unknownStatus") || '未知状态');
        infoEl.appendChild(statusLabel);

        // 添加项目下顶级任务计数（todo/doing/done）
        const countsContainer = document.createElement('div');
        countsContainer.className = 'project-item__counts';
        countsContainer.style.cssText = `display:flex; gap:8px; margin-top:6px; align-items:center; flex-wrap: wrap;`;


        const dynamicCountsWrapper = document.createElement('div');
        dynamicCountsWrapper.className = 'project-counts-dynamic';
        dynamicCountsWrapper.style.cssText = `display:flex; gap:8px; align-items:center; flex-wrap:wrap;`;
        // initial legacy placeholders to avoid layout shift
        dynamicCountsWrapper.innerHTML = `
            <span class="project-count project-count--doing">${i18n("doing") || '进行中'}: ...</span>
            <span class="project-count project-count--short-term">${i18n("shortTerm") || '短期'}: ...</span>
            <span class="project-count project-count--long-term">${i18n("longTerm") || '长期'}: ...</span>
            <span class="project-count project-count--done">${i18n("done") || '已完成'}: ...</span>
        `;
        countsContainer.appendChild(dynamicCountsWrapper);

        // 添加番茄钟总数显示
        const pomodoroCountEl = document.createElement('span');
        pomodoroCountEl.className = 'project-count project-count--pomodoro';
        pomodoroCountEl.textContent = '🍅 总计: ...';
        pomodoroCountEl.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            opacity: 0.8;
            display: flex;
            align-items: center;
            gap: 2px;
            background: rgba(231, 76, 60, 0.1);
            padding: 2px 6px;
            border-radius: 10px;
            border: 1px solid rgba(231, 76, 60, 0.2);
            white-space: nowrap;
        `;
        countsContainer.appendChild(pomodoroCountEl);

        infoEl.appendChild(countsContainer);

        // 添加项目进度条（参考 ProjectKanbanView 样式）
        const progressWrapper = document.createElement('div');
        progressWrapper.className = 'project-progress-wrapper';
        progressWrapper.style.cssText = `
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        `;

        const progressBarOuter = document.createElement('div');
        progressBarOuter.className = 'project-progress-outer';
        progressBarOuter.style.cssText = `
            flex: 1;
            height: 8px;
            background: rgba(0,0,0,0.06);
            border-radius: 6px;
            overflow: hidden;
        `;

        const progressBarInner = document.createElement('div');
        progressBarInner.className = 'project-progress-inner';
        progressBarInner.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, #28a745, #7bd389);
            border-radius: 6px;
            transition: width 0.3s ease;
        `;

        progressBarOuter.appendChild(progressBarInner);

        const progressText = document.createElement('div');
        progressText.className = 'project-progress-text';
        progressText.style.cssText = `
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            text-align: right;
        `;

        progressWrapper.appendChild(progressBarOuter);
        progressWrapper.appendChild(progressText);

        infoEl.appendChild(progressWrapper);

        // 异步填充计数（使用缓存或实时读取），并同时更新进度条
        this.fillProjectTopLevelCounts(project.id, dynamicCountsWrapper, pomodoroCountEl, progressBarInner, progressText).catch(err => {
            console.warn('填充项目任务计数失败:', err);
        });
        // 分类显示
        if (project.categoryId) {
            const categoryIds = project.categoryId.split(',').filter((id: string) => id.trim());

            if (categoryIds.length > 0) {
                const categoryContainer = document.createElement('div');
                categoryContainer.className = 'project-item__category-container';
                categoryContainer.style.cssText = `
                    margin-top: 4px;
                    display: flex;
                    flex-wrap: wrap;
                    gap: 4px;
                `;

                categoryIds.forEach((id: string) => {
                    const category = this.categoryManager.getCategoryById(id);
                    if (category) {
                        const categoryEl = document.createElement('div');
                        categoryEl.className = 'project-category-tag';
                        categoryEl.style.cssText = `
                            display: inline-flex;
                            align-items: center;
                            gap: 4px;
                            padding: 2px 6px;
                            background-color: ${category.color};
                            border: 1px solid ${category.color}40;
                            border-radius: 5px;
                            font-size: 11px;
                            color: #fff;
                        `;

                        if (category.icon) {
                            const iconSpan = document.createElement('span');
                            iconSpan.textContent = category.icon;
                            iconSpan.style.cssText = `
                                font-size: 12px;
                                line-height: 1;
                            `;
                            categoryEl.appendChild(iconSpan);
                        }

                        const nameSpan = document.createElement('span');
                        nameSpan.textContent = category.name;
                        nameSpan.style.cssText = `
                            font-size: 11px;
                            font-weight: 500;
                        `;
                        categoryEl.appendChild(nameSpan);
                        categoryContainer.appendChild(categoryEl);
                    }
                });

                if (categoryContainer.hasChildNodes()) {
                    infoEl.appendChild(categoryContainer);
                }
            }
        }

        // 描述
        if (project.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'project-item__note';
            noteEl.textContent = project.note;
            infoEl.appendChild(noteEl);
        }

        contentEl.appendChild(infoEl);
        projectEl.appendChild(contentEl);

        return projectEl;
    }

    /**
     * 填充某个项目的顶级任务计数到元素
     */
    private async fillProjectTopLevelCounts(projectId: string, dynamicWrapper: HTMLElement, pomodoroEl?: HTMLElement | null, progressBarInner?: HTMLElement | null, progressText?: HTMLElement | null) {
        try {
            let reminderData = this.reminderDataCache;
            if (!reminderData) {
                reminderData = await getAllReminders(this.plugin);
                this.reminderDataCache = reminderData;
            }

            const { ProjectManager } = await import("../utils/projectManager");
            const projectManager = ProjectManager.getInstance(this.plugin);
            const statuses = await projectManager.getProjectKanbanStatuses(projectId);

            const result = ProjectKanbanView.countTopLevelTasksByStatus(projectId, reminderData, statuses);
            const countsMap = result.counts || {};
            const completedCount = result.completed || (countsMap['completed'] || 0);

            // Render dynamic status badges in order
            dynamicWrapper.innerHTML = '';
            if (statuses && Array.isArray(statuses) && statuses.length > 0) {
                for (const s of statuses) {
                    const id = s.id;
                    const name = s.name || id;
                    const icon = s.icon || '';
                    const count = id === 'completed' ? completedCount : (countsMap[id] || 0);
                    const span = document.createElement('span');
                    span.className = `project-count project-count--${id}`;
                    span.textContent = `${icon} ${name}: ${count}`;
                    dynamicWrapper.appendChild(span);
                }
            } else {
                // Fallback to legacy labels
                const doing = countsMap['doing'] || 0;
                const shortTerm = countsMap['short_term'] || 0;
                const longTerm = countsMap['long_term'] || 0;
                const done = completedCount;
                dynamicWrapper.innerHTML = `
                    <span class="project-count project-count--doing">${i18n("doing") || '进行中'}: ${doing}</span>
                    <span class="project-count project-count--short-term">${i18n("shortTerm") || '短期'}: ${shortTerm}</span>
                    <span class="project-count project-count--long-term">${i18n("longTerm") || '长期'}: ${longTerm}</span>
                    <span class="project-count project-count--done">${i18n("done") || '已完成'}: ${done}</span>
                `;
            }

            // 更新番茄钟总数显示
            if (pomodoroEl) {
                const totalPomodoro = await this.countProjectTotalPomodoro(projectId, reminderData);
                const totalFocus = await this.countProjectTotalFocusTime(projectId, reminderData);
                const formatMinutesToString = (minutes: number) => {
                    const hours = Math.floor(minutes / 60);
                    const mins = Math.floor(minutes % 60);
                    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                };
                const focusText = totalFocus > 0 ? ` ⏱ ${formatMinutesToString(totalFocus)}` : '';
                pomodoroEl.textContent = `🍅 总计: ${totalPomodoro}${focusText}`;
            }

            // 计算进度： done / (sum of non-completed statuses + done)
            if (progressBarInner && progressText) {
                const nonCompletedSum = Object.keys(countsMap).reduce((s, k) => k === 'completed' ? s : s + (countsMap[k] || 0), 0);
                const total = nonCompletedSum + completedCount;
                const percent = total === 0 ? 0 : Math.round((completedCount / total) * 100);
                progressBarInner.style.width = `${percent}%`;
                progressText.textContent = `${percent}%`;
            }
        } catch (error) {
            console.error('获取项目顶级任务计数失败:', error);
            // on error, show placeholders
            if (dynamicWrapper) dynamicWrapper.innerHTML = `
                <span class="project-count project-count--doing">${i18n("doing") || '进行中'}: ?</span>
                <span class="project-count project-count--short-term">${i18n("shortTerm") || '短期'}: ?</span>
                <span class="project-count project-count--long-term">${i18n("longTerm") || '长期'}: ?</span>
                <span class="project-count project-count--done">${i18n("done") || '已完成'}: ?</span>
            `;
            if (pomodoroEl) pomodoroEl.textContent = `🍅 总计: ?`;
            if (progressBarInner && progressText) {
                progressBarInner.style.width = `0%`;
                progressText.textContent = `0%`;
            }
        }
    }

    /**
     * 计算给定项目的顶级任务在 kanbanStatus 上的数量（只计顶级，即没有 parentId）
     * 使用 ProjectKanbanView 的静态方法，确保统计逻辑一致（包括日期自动归档到进行中的逻辑）
     */
    private async countTopLevelKanbanStatus(projectId: string, reminderData: any): Promise<{ doing: number; short_term: number; long_term: number; done: number }> {
        try {
            const projectManager = ProjectManager.getInstance(this.plugin);
            const statuses = await projectManager.getProjectKanbanStatuses(projectId);
            const result = ProjectKanbanView.countTopLevelTasksByStatus(projectId, reminderData, statuses);

            // Map dynamic status counts to the legacy four labels for display
            const countsMap = result.counts || {};
            const nonCompletedIds = Object.keys(countsMap).filter(k => k !== 'completed');

            // Preferred mapping keys
            const prefer = ['doing', 'short_term', 'long_term'];
            const mapped: any = { doing: 0, short_term: 0, long_term: 0, done: result.completed || 0 };

            const used: Set<string> = new Set();
            // First try to pick by key names if exist
            prefer.forEach((key) => {
                if (countsMap.hasOwnProperty(key)) {
                    mapped[key] = countsMap[key];
                    used.add(key);
                }
            });

            // Fill remaining prefer slots from available non-completed statuses
            for (const key of prefer) {
                if (mapped[key] === 0) {
                    const next = nonCompletedIds.find(id => !used.has(id));
                    if (next) {
                        mapped[key] = countsMap[next] || 0;
                        used.add(next);
                    }
                }
            }

            return { doing: mapped.doing || 0, short_term: mapped.short_term || 0, long_term: mapped.long_term || 0, done: mapped.done || 0 };
        } catch (error) {
            console.error('countTopLevelKanbanStatus error:', error);
            // Fallback to legacy call if something fails
            const legacy = ProjectKanbanView.countTopLevelTasksByStatus(projectId, reminderData);
            // legacy may return { counts, completed } or old shape; handle both
            if ((legacy as any).counts) {
                const c = (legacy as any).counts;
                return { doing: c.doing || 0, short_term: c.short_term || 0, long_term: c.long_term || 0, done: (legacy as any).completed || 0 };
            }
            return { doing: (legacy as any).doing || 0, short_term: (legacy as any).short_term || 0, long_term: (legacy as any).long_term || 0, done: (legacy as any).completed || 0 };
        }
    }

    /**
     * 计算给定项目中所有任务的番茄钟总数（包括子任务）
     */
    private async countProjectTotalPomodoro(projectId: string, reminderData: any): Promise<number> {
        const allReminders = reminderData && typeof reminderData === 'object' ? Object.values(reminderData) : [];
        let totalPomodoro = 0;
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance(this.plugin);
            const reminderMap = new Map(allReminders.map((r: any) => [r.id, r]));
            // Only sum aggregated count for top-level reminders in the project to avoid double counting
            const topLevelReminders = allReminders.filter((r: any) => {
                if (!r || typeof r !== 'object') return false;
                if (r.projectId !== projectId) return false;
                // top-level if parentId is falsy or parent is not within reminderMap
                if (!r.parentId) return true;
                return !reminderMap.has(r.parentId);
            });

            for (const r of topLevelReminders) {
                if (!r || typeof r !== 'object') continue;
                if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                    totalPomodoro += await pomodoroManager.getAggregatedReminderPomodoroCount((r as any).id);
                } else if (typeof pomodoroManager.getReminderPomodoroCount === 'function') {
                    totalPomodoro += await pomodoroManager.getReminderPomodoroCount((r as any).id);
                }
            }
        } catch (e) {
            console.warn('计算项目总番茄数失败，回退到直接累加:', e);
            // Fallback: sum per-event pomodoroCount provided in reminder data (if any)
            allReminders.forEach((r: any) => {
                if (!r || typeof r !== 'object') return;
                if (r.projectId === projectId && r.pomodoroCount && typeof r.pomodoroCount === 'number') {
                    totalPomodoro += r.pomodoroCount;
                }
            });
        }
        return totalPomodoro;
    }

    private async countProjectTotalFocusTime(projectId: string, reminderData: any): Promise<number> {
        let totalMinutes = 0;
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance(this.plugin);
            if (!pomodoroManager) return 0;
            if ((pomodoroManager as any).initialize && typeof (pomodoroManager as any).initialize === 'function') {
                await (pomodoroManager as any).initialize();
            }
            // Build set of ids to include
            const ids = new Set<string>();
            Object.values(reminderData).forEach((r: any) => {
                if (r && r.projectId === projectId) {
                    ids.add(r.id);
                    if (r.repeat && r.repeat.instancePomodoroCount) {
                        Object.keys(r.repeat.instancePomodoroCount).forEach(k => ids.add(k));
                    }
                }
            });

            // Sum durations across all sessions in records
            for (const date in pomodoroManager['records']) {
                const record = pomodoroManager['records'][date];
                if (!record || !record.sessions) continue;
                for (const session of record.sessions) {
                    if (session && session.type === 'work' && session.completed && ids.has(session.eventId)) {
                        totalMinutes += session.duration || 0;
                    }
                }
            }
        } catch (e) {
            console.warn('计算项目总专注时长失败:', e);
        }
        return totalMinutes;
    }
    // 新增：添加拖拽功能
    private addDragFunctionality(projectEl: HTMLElement, handle: HTMLElement, project: any) {
        handle.draggable = true;
        handle.style.cursor = 'grab';

        handle.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedElement = projectEl;
            this.draggedProject = project;
            projectEl.style.opacity = '0.5';
            handle.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', projectEl.outerHTML);
            }
        });

        handle.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedElement = null;
            this.draggedProject = null;
            projectEl.style.opacity = '';
            handle.style.cursor = 'grab';
        });

        projectEl.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement !== projectEl) {
                e.preventDefault();

                const targetProject = this.getProjectFromElement(projectEl);
                // 只允许同优先级内的拖拽
                if (targetProject && this.canDropHere(this.draggedProject, targetProject)) {
                    e.dataTransfer.dropEffect = 'move';
                    this.showDropIndicator(projectEl, e);
                }
            }
        });

        projectEl.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement !== projectEl) {
                e.preventDefault();

                const targetProject = this.getProjectFromElement(projectEl);
                if (targetProject && this.canDropHere(this.draggedProject, targetProject)) {
                    this.handleDrop(this.draggedProject, targetProject, e);
                }
            }
            this.hideDropIndicator();
        });

        projectEl.addEventListener('dragleave', () => {
            this.hideDropIndicator();
        });
    }

    // 新增：从元素获取项目数据
    private getProjectFromElement(element: HTMLElement): any {
        const projectId = element.dataset.projectId;
        if (!projectId) return null;

        // 从当前显示的项目列表中查找
        return this.currentProjectsCache.find(p => p.id === projectId);
    }

    // 新增：检查是否可以放置
    private canDropHere(_draggedProject: any, _targetProject: any): boolean {
        // 允许跨优先级拖拽，后续在 reorderProjects 中会自动更新优先级
        return true;
    }

    // 新增：显示拖放指示器
    private showDropIndicator(element: HTMLElement, event: DragEvent) {
        this.hideDropIndicator(); // 先清除之前的指示器

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
        `;

        if (event.clientY < midpoint) {
            // 插入到目标元素之前
            indicator.style.top = '0';
            element.style.position = 'relative';
            element.insertBefore(indicator, element.firstChild);
        } else {
            // 插入到目标元素之后
            indicator.style.bottom = '0';
            element.style.position = 'relative';
            element.appendChild(indicator);
        }
    }

    // 新增：隐藏拖放指示器
    private hideDropIndicator() {
        const indicators = document.querySelectorAll('.drop-indicator');
        indicators.forEach(indicator => indicator.remove());
    }

    // 新增：处理拖放
    private async handleDrop(draggedProject: any, targetProject: any, event: DragEvent) {
        try {
            const rect = (event.target as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            await this.reorderProjects(draggedProject, targetProject, insertBefore);

            showMessage("排序已更新");
            this.loadProjects(); // 重新加载以应用新排序

        } catch (error) {
            console.error('处理拖放失败:', error);
            showMessage("排序更新失败");
        }
    }

    // 新增：重新排序项目
    private async reorderProjects(draggedProject: any, targetProject: any, insertBefore: boolean) {
        try {
            const projectData = await this.plugin.loadProjectData();

            const draggedId = draggedProject.id;
            const targetId = targetProject.id;

            if (!projectData[draggedId] || !projectData[targetId]) {
                throw new Error("Project not found in data");
            }

            const draggedItem = projectData[draggedId];
            const targetItem = projectData[targetId];

            const oldPriority = draggedItem.priority || 'none';
            const targetPriority = targetItem.priority || 'none';
            let newPriority = oldPriority;

            // 检查优先级变更 - 如果拖拽到不同优先级项目的上方或下方，自动变更优先级
            if (oldPriority !== targetPriority) {
                newPriority = targetPriority;
                draggedItem.priority = newPriority;
            }

            // 如果优先级改变了，需要整理旧优先级列表（确保排序连续）
            if (oldPriority !== newPriority) {
                const sourceList = Object.values(projectData)
                    .filter((p: any) => (p.priority || 'none') === oldPriority && p.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                sourceList.forEach((p: any, index: number) => {
                    if (projectData[p.id]) {
                        projectData[p.id].sort = index * 10;
                    }
                });
            }

            // 获取目标优先级的所有项目（不包含被拖拽的项目）
            const targetList = Object.values(projectData)
                .filter((p: any) => (p.priority || 'none') === newPriority && p.id !== draggedId)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // 找到目标位置
            const targetIndex = targetList.findIndex((p: any) => p.id === targetId);
            const insertIndex = insertBefore ? targetIndex : (targetIndex === -1 ? targetList.length : targetIndex + 1);

            // 插入被拖拽的项目
            targetList.splice(insertIndex, 0, draggedItem);

            // 重新分配排序值
            targetList.forEach((project: any, index: number) => {
                if (projectData[project.id]) {
                    projectData[project.id].sort = index * 10; // 使用10的倍数便于后续插入
                    projectData[project.id].updatedTime = new Date().toISOString();
                }
            });

            await this.plugin.saveProjectData(projectData);
            window.dispatchEvent(new CustomEvent('projectUpdated'));

        } catch (error) {
            console.error('重新排序项目失败:', error);
            throw error;
        }
    }

    // 新增：创建倒计时元素
    private createCountdownElement(endDate: string, today: string): HTMLElement {
        const countdownEl = document.createElement('div');
        countdownEl.className = 'project-countdown';

        // 检查是否有结束日期
        if (endDate) {
            // 有结束日期，显示倒计时
            const daysDiff = this.calculateDaysDifference(endDate, today);
            const isOverdue = daysDiff < 0;

            if (isOverdue) {
                const overdueDays = Math.abs(daysDiff);
                countdownEl.style.cssText = `
                    color: var(--b3-font-color1);
                    font-size: 12px;
                    font-weight: 500;
                    background: var(--b3-font-background1);
                    border: 1px solid var(--b3-font-color1);
                    border-radius: 4px;
                    padding: 2px 6px;
                `;
                countdownEl.textContent = i18n("overdueDays").replace("${days}", overdueDays.toString()) || `已过期${overdueDays}天`;
            } else if (daysDiff === 0) {
                countdownEl.style.cssText = `
                    color: var(--b3-font-color2);
                    font-size: 12px;
                    font-weight: 500;
                    background: var(--b3-font-background2);
                    border: 1px solid var(--b3-font-color2);
                    border-radius: 4px;
                    padding: 2px 6px;
                `;
                countdownEl.textContent = i18n("dueToday") || '今天截止';
            } else {
                countdownEl.style.cssText = `
                    color: var(--b3-font-color4);
                    font-size: 12px;
                    font-weight: 500;
                    background: var(--b3-font-background4);
                    border: 1px solid var(--b3-font-color4);
                    border-radius: 4px;
                    padding: 2px 6px;
                `;
                countdownEl.textContent = i18n("daysRemaining").replace("${days}", daysDiff.toString()) || `还剩${daysDiff}天`;
            }
        } else {
            // 没有结束日期，但有开始日期时，显示已开始天数
            // 注意：这里需要从调用处传入 startDate
            countdownEl.style.cssText = `
                color: var(--b3-card-success-color);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-card-success-background);
                border: 1px solid var(--b3-card-success-color);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            countdownEl.textContent = i18n("projectStarted") || '项目已开始';
        }

        return countdownEl;
    }

    // 新增：计算日期差值
    private calculateDaysDifference(endDate: string, today: string): number {
        const end = new Date(endDate + 'T00:00:00');
        const todayDate = new Date(today + 'T00:00:00');
        const diffTime = end.getTime() - todayDate.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    private formatProjectTime(startDate: string, endDate?: string, today?: string): string {
        if (!today) {
            today = getLogicalDateString();
        }

        let timeStr = '';

        if (startDate) {
            const start = new Date(startDate + 'T00:00:00');
            const startStr = start.toLocaleDateString(getLocaleTag(), {
                month: 'short',
                day: 'numeric'
            });
            timeStr = `📅 ${startStr}`;
        }

        if (endDate) {
            const end = new Date(endDate + 'T00:00:00');
            const endStr = end.toLocaleDateString(getLocaleTag(), {
                month: 'short',
                day: 'numeric'
            });
            timeStr += ` → ${endStr}`;
        }

        return timeStr || '📅 无日期';
    }

    // 新增：创建已开始天数元素
    private createStartedElement(startDate: string, today: string): HTMLElement {
        const startedEl = document.createElement('div');
        startedEl.className = 'project-started';

        const daysDiff = this.calculateDaysDifference(today, startDate);

        if (daysDiff < 0) {
            // 开始日期在未来
            const futureDays = Math.abs(daysDiff);
            startedEl.style.cssText = `
                color:var(--b3-font-color2);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background2);
                border: 1px solid var(--b3-font-color2);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            startedEl.textContent = i18n("startInDays").replace("${days}", futureDays.toString()) || `${futureDays}天后开始`;
        } else if (daysDiff === 0) {
            // 今天开始
            startedEl.style.cssText = `
                color:  var(--b3-font-color4);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-font-background4);
                border: 1px solid var(--b3-font-color4);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            startedEl.textContent = i18n("startToday") || '今天开始';
        } else {
            // 已经开始
            startedEl.style.cssText = `
                color: var(--b3-card-success-color);
                font-size: 12px;
                font-weight: 500;
                background: var(--b3-card-success-background);
                border: 1px solid var(--b3-card-success-color);
                border-radius: 4px;
                padding: 2px 6px;
            `;
            startedEl.textContent = i18n("startedDays").replace("${days}", daysDiff.toString()) || `已开始${daysDiff}天`;
        }

        return startedEl;
    }

    private showProjectContextMenu(event: MouseEvent, project: any) {
        const menu = new Menu("projectContextMenu");

        if (project.blockId) {
            // 打开项目看板
            menu.addItem({
                icon: "iconProject",
                label: i18n("openProjectKanban") || "打开项目看板",
                click: () => this.openProjectKanban(project)
            });

            menu.addSeparator();

            // 复制块引用
            menu.addItem({
                iconHTML: "📋",
                label: i18n("copyBlockRef") || "复制块引用",
                click: () => this.copyProjectRef(project)
            });
        } else {
            // 绑定到块
            menu.addItem({
                iconHTML: "🔗",
                label: i18n("bindToBlock") || "绑定到块",
                submenu: [
                    {
                        iconHTML: "🔗",
                        label: i18n("bindToBlock") || "绑定到块",
                        click: () => this.showBindToBlockDialog(project, 'bind')
                    },
                    {
                        iconHTML: "📑",
                        label: i18n("newHeading") || "新建标题",
                        click: () => this.showBindToBlockDialog(project, 'heading')
                    },
                    {
                        iconHTML: "📄",
                        label: i18n("newDocument") || "新建文档",
                        click: () => this.showBindToBlockDialog(project, 'document')
                    }
                ]
            });
            menu.addSeparator();
            // 打开项目看板
            menu.addItem({
                iconHTML: "📋",
                label: "打开项目看板",
                click: () => this.openProjectKanban(project)
            });

        }

        // 编辑项目
        menu.addItem({
            iconHTML: "📝",
            label: i18n("edit") || "编辑项目",
            click: () => this.editProject(project)
        });

        // 合并到其他项目
        menu.addItem({
            iconHTML: "🔀",
            label: i18n("mergeProject") || "合并到其他项目",
            click: () => this.showMergeDialog(project)
        });

        // 设置优先级子菜单
        const createPriorityMenuItems = () => {
            const priorities = [
                { key: 'high', label: i18n("highPriority") || '高', icon: '🔴' },
                { key: 'medium', label: i18n("mediumPriority") || '中', icon: '🟡' },
                { key: 'low', label: i18n("lowPriority") || '低', icon: '🔵' },
                { key: 'none', label: i18n("noPriority") || '无', icon: '⚫' }
            ];

            const currentPriority = project.priority || 'none';

            return priorities.map(priority => ({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => {
                    this.setPriority(project.id, priority.key);
                }
            }));
        };

        menu.addItem({
            iconHTML: "🎯",
            label: i18n("setPriority") || "设置优先级",
            submenu: createPriorityMenuItems()
        });

        // 设置分类子菜单
        const createCategoryMenuItems = () => {
            const categories = this.categoryManager.getCategories();
            const currentCategoryId = project.categoryId;

            const menuItems = [];

            menuItems.push({
                iconHTML: "❌",
                label: i18n("noCategory") || "无分类",
                current: !currentCategoryId,
                click: () => {
                    this.setCategory(project.id, null);
                }
            });

            categories.forEach(category => {
                menuItems.push({
                    iconHTML: category.icon || "📁",
                    label: category.name,
                    current: currentCategoryId === category.id,
                    click: () => {
                        this.setCategory(project.id, category.id);
                    }
                });
            });

            return menuItems;
        };

        menu.addItem({
            iconHTML: "🏷️",
            label: i18n("setCategory") || "设置分类",
            submenu: createCategoryMenuItems()
        });

        // 设置状态子菜单
        const createStatusMenuItems = () => {
            const statuses = this.statusManager.getStatuses();
            const currentStatus = project.status || 'active';

            return statuses.map(status => ({
                iconHTML: status.icon || '📝',
                label: status.name,
                current: currentStatus === status.id,
                click: () => {
                    this.setStatus(project.id, status.id);
                }
            }));
        };

        menu.addItem({
            iconHTML: "📊",
            label: i18n("setStatus") || "设置状态",
            submenu: createStatusMenuItems()
        });

        menu.addSeparator();

        // 删除项目
        menu.addItem({
            iconHTML: "🗑️",
            label: i18n("deleteProject") || "删除项目",
            click: () => this.deleteProject(project)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async copyProjectRef(project: any) {
        try {
            const blockId = project.blockId || project.id;
            const title = project.title || i18n("unnamedNote") || '未命名项目';
            const blockRef = `((${blockId} "${title}"))`;
            await platformUtils.writeText(blockRef);
            showMessage(i18n("copyBlockRef") + i18n("success") || "块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引失败:', error);
            showMessage(i18n("copyBlockRef") + i18n("operationFailed") || "复制块引失败");
        }
    }

    private editProject(project: any) {
        const dialog = new ProjectDialog(project.id, this.plugin);
        dialog.show();
    }

    /**
     * 显示合并对话框：选择目标项目与分组（已有或新建），并可选择删除源项目
     */
    private async showMergeDialog(project: any) {
        try {
            const projectManager = ProjectManager.getInstance(this.plugin);
            await projectManager.initialize();

            let html = `
                <div class="merge-project-dialog">
                    <div class="b3-dialog__content" style="display:flex; flex-direction:column; gap:8px;">
                        <label>目标项目</label>
                        <select id="mergeTargetSelect" style="width:100%; padding:6px;"></select>

                        <label>目标分组（可选，选择“新建分组”可输入新名称）</label>
                        <select id="mergeGroupSelect" style="width:100%; padding:6px;"></select>
                        <input id="mergeNewGroupInput" type="text" placeholder="新分组名称" style="display:none; padding:6px;" />

                        <label style="display:flex; align-items:center; gap:8px;"><input id="mergeDeleteSource" type="checkbox" /> ${i18n("deleteSourceProjectAfterMerge") || '合并后删除源项目'}</label>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="mergeCancel">${i18n("cancel") || '取消'}</button>
                        <button class="b3-button b3-button--primary" id="mergeConfirm">${i18n("confirm") || '确认'}</button>
                    </div>
                </div>
            `;

            const dialog = new Dialog({
                title: i18n("mergeProject") || `合并项目: ${project.title}`,
                content: html,
                width: "520px",
                height: "320px"
            });

            const targetSelect = dialog.element.querySelector('#mergeTargetSelect') as HTMLSelectElement;
            const groupSelect = dialog.element.querySelector('#mergeGroupSelect') as HTMLSelectElement;
            const newGroupInput = dialog.element.querySelector('#mergeNewGroupInput') as HTMLInputElement;
            const cancelBtn = dialog.element.querySelector('#mergeCancel') as HTMLButtonElement;
            const confirmBtn = dialog.element.querySelector('#mergeConfirm') as HTMLButtonElement;
            const deleteCheckbox = dialog.element.querySelector('#mergeDeleteSource') as HTMLInputElement;

            // 填充目标项目（使用 ProjectManager 的分组样式，完全照搬 QuickReminderDialog 的实现）
            try {
                const groupedProjects = projectManager.getProjectsGroupedByStatus();

                // 添加空选项（与 QuickReminderDialog 一致）
                const noProjectOption = document.createElement('option');
                noProjectOption.value = '';
                noProjectOption.textContent = i18n('noProject') || '无项目';
                targetSelect.appendChild(noProjectOption);

                Object.keys(groupedProjects).forEach(async statusKey => {
                    const projects = groupedProjects[statusKey] || [];
                    let nonArchivedProjects = projects.filter(p => {
                        const projectStatus = projectManager.getProjectById(p.id)?.status || 'doing';
                        return projectStatus !== 'archived';
                    });

                    if (nonArchivedProjects.length > 0) {
                        // 按手动排序值（若存在）再按名称排序，保持展示顺序稳定
                        try {
                            const projectData = await this.plugin.loadProjectData();
                            nonArchivedProjects.sort((a: any, b: any) => {
                                const sa = (projectData[a.id] && typeof projectData[a.id].sort === 'number') ? projectData[a.id].sort : 0;
                                const sb = (projectData[b.id] && typeof projectData[b.id].sort === 'number') ? projectData[b.id].sort : 0;
                                if (sa !== sb) return sa - sb;
                                return (a.name || '').localeCompare(b.name || '', getLocaleTag());
                            });
                        } catch (e) {
                            // fallback to name sort
                            nonArchivedProjects.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', getLocaleTag()));
                        }

                        const statusInfo = this.statusManager.getStatusById(statusKey);
                        const statusName = statusInfo ? statusInfo.name : statusKey;
                        const optgroup = document.createElement('optgroup');
                        optgroup.label = statusName;

                        nonArchivedProjects.forEach(p => {
                            const option = document.createElement('option');
                            option.value = p.id;
                            option.textContent = p.name || (i18n('unnamedNote') || '未命名项目');
                            optgroup.appendChild(option);
                        });

                        targetSelect.appendChild(optgroup);
                    }
                });

            } catch (err) {
                console.error('填充目标项目失败:', err);
            }

            const populateGroupOptions = async (targetId: string) => {
                groupSelect.innerHTML = '';
                const keepOpt = document.createElement('option');
                keepOpt.value = '';
                keepOpt.textContent = i18n("keepGroup") || '保持原分组';
                groupSelect.appendChild(keepOpt);

                const newOpt = document.createElement('option');
                newOpt.value = '__new__';
                newOpt.textContent = i18n("createNewGroup") || '新建分组...';
                groupSelect.appendChild(newOpt);

                if (targetId) {
                    try {
                        const groups = await projectManager.getProjectCustomGroups(targetId);
                        groups.forEach((g: any) => {
                            const o = document.createElement('option');
                            o.value = g.id || g.name;
                            o.textContent = g.name || g.id;
                            groupSelect.appendChild(o);
                        });
                    } catch (e) {
                        console.error('加载目标自定义分组失败:', e);
                    }
                }
            };

            // 初始填充
            if (targetSelect.options.length > 0) {
                // 如果第一个实际项目存在，则初始化 groups
                const firstProjectVal = (targetSelect.querySelector('option[value]:not([value=""])') as HTMLOptionElement)?.value;
                if (firstProjectVal) await populateGroupOptions(firstProjectVal);
            }

            targetSelect.addEventListener('change', async () => {
                await populateGroupOptions(targetSelect.value);
            });

            groupSelect.addEventListener('change', () => {
                if (groupSelect.value === '__new__') {
                    newGroupInput.style.display = '';
                } else {
                    newGroupInput.style.display = 'none';
                }
            });

            cancelBtn.addEventListener('click', () => dialog.destroy());

            confirmBtn.addEventListener('click', async () => {
                const targetId = targetSelect.value;
                if (!targetId) {
                    showMessage(i18n("selectTargetProject") || '请选择目标项目');
                    return;
                }

                let groupId: string | null = null;
                let newGroupName: string | null = null;
                if (groupSelect.value === '__new__') {
                    const name = (newGroupInput.value || '').trim();
                    if (!name) {
                        showMessage(i18n("enterNewGroupName") || '请输入新分组名称');
                        return;
                    }
                    newGroupName = name;
                } else if (groupSelect.value) {
                    groupId = groupSelect.value;
                }

                const deleteSource = !!deleteCheckbox.checked;

                dialog.destroy();

                await this.mergeProject(project.id, targetId, { groupId, newGroupName, deleteSource });
            });

        } catch (error) {
            console.error('显示合并对话框失败:', error);
            showMessage(i18n("showMergeDialogFailed") || '显示合并对话框失败');
        }
    }

    /**
     * 合并项目实现：将 source 项目的所有提醒移动到 target，并可在 target 新建分组或选择已有分组；可删除源项目
     */
    private async mergeProject(sourceId: string, targetId: string, opts: { groupId?: string | null; newGroupName?: string | null; deleteSource?: boolean }) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (!projectData[sourceId] || !projectData[targetId]) {
                showMessage(i18n("projectNotFound") || '项目未找到');
                return;
            }

            // 如果需要新建分组，在目标项目中创建并返回新 id
            let appliedGroupId: string | null = opts.groupId || null;
            if (opts.newGroupName) {
                const newId = `cg_${Date.now()}`;
                const target = projectData[targetId];
                if (!target.customGroups) target.customGroups = [];
                target.customGroups.push({ id: newId, name: opts.newGroupName });
                appliedGroupId = newId;
            }

            // 读取提醒数据并更新
            const reminderData = await this.plugin.loadReminderData();
            let movedCount = 0;
            Object.values(reminderData).forEach((r: any) => {
                if (r && r.projectId === sourceId) {
                    r.projectId = targetId;
                    if (appliedGroupId) {
                        r.customGroupId = appliedGroupId;
                    } else {
                        // 如果选择保持原分组，则不改 customGroupId
                    }
                    movedCount++;
                }
            });

            // 保存提醒与项目数据
            await this.plugin.saveReminderData(reminderData);
            await this.plugin.saveProjectData(projectData);

            // 可选删除源项目
            if (opts.deleteSource) {
                if (projectData[sourceId]) {
                    delete projectData[sourceId];
                    await this.plugin.saveProjectData(projectData);
                }
            }

            // 触发更新
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            window.dispatchEvent(new CustomEvent('projectUpdated'));

            showMessage((i18n("mergeSuccess") || '合并成功') + ` (${movedCount})`);
            this.loadProjects();

        } catch (error) {
            console.error('合并项目失败:', error);
            showMessage(i18n("mergeFailed") || '合并失败');
        }
    }

    private async setPriority(projectId: string, priority: string) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[projectId]) {
                projectData[projectId].priority = priority;
                projectData[projectId].updatedTime = new Date().toISOString();
                await this.plugin.saveProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();
                showMessage(i18n("priorityUpdated") || "优先级更新成功");
            } else {
                showMessage(i18n("projectNotExist") || "项目不存在");
            }
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage(i18n("setPriorityFailed") || "操作失败");
        }
    }

    private async setCategory(projectId: string, categoryId: string | null) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[projectId]) {
                projectData[projectId].categoryId = categoryId;
                projectData[projectId].updatedTime = new Date().toISOString();
                await this.plugin.saveProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();

                const categoryName = categoryId ?
                    this.categoryManager.getCategoryById(categoryId)?.name || i18n("unknownCategory") || "未知分类" :
                    i18n("noCategory") || "无分类";
                showMessage(`${i18n("setCategory") || "已设置分类为"}：${categoryName}`);
            } else {
                showMessage(i18n("projectNotExist") || "项目不存在");
            }
        } catch (error) {
            console.error('设置分类失败:', error);
            showMessage(i18n("setCategoryFailed") || "操作失败");
        }
    }

    private async setStatus(projectId: string, status: string) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[projectId]) {
                projectData[projectId].status = status;
                // 保持向后兼容
                projectData[projectId].archived = status === 'archived';
                projectData[projectId].updatedTime = new Date().toISOString();
                await this.plugin.saveProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();

                const statusInfo = this.statusManager.getStatusById(status);
                const statusName = statusInfo ? statusInfo.name : i18n("unknown");
                showMessage(`${i18n("setStatus") || "已设置状态为"}：${statusName}`);
            } else {
                showMessage(i18n("projectNotExist") || "项目不存在");
            }
        } catch (error) {
            console.error('设置状态失败:', error);
            showMessage(i18n("setStatusFailed") || "操作失败");
        }
    }

    private async deleteProject(project: any) {
        // 首先检查是否有关联的任务
        try {
            const reminderData = await this.plugin.loadReminderData();
            const projectTasks = Object.values(reminderData).filter((reminder: any) =>
                reminder && reminder.projectId === project.id
            );

            const taskCount = projectTasks.length;

            // 构建确认消息
            let confirmMessage = i18n("confirmDeleteProject")?.replace("${title}", project.title) || `确定要删除项目"${project.title}"吗？`;

            if (taskCount > 0) {
                const taskCountMessage = i18n("projectHasNTasks")?.replace("${count}", taskCount.toString()) || `该项目包含 ${taskCount} 个任务。`;
                confirmMessage = `${confirmMessage}\n\n${taskCountMessage}`;
            }

            await confirm(
                i18n("deleteProject") || "删除项目",
                confirmMessage,
                async () => {
                    // 如果有任务，询问是否一并删除
                    if (taskCount > 0) {
                        await confirm(
                            i18n("deleteProjectTasks") || "删除项目任务",
                            i18n("confirmDeleteProjectTasks")?.replace("${count}", taskCount.toString()) || `是否同时删除项目的所有 ${taskCount} 个任务？\n\n选择"确定"将删除所有任务，选择"取消"将仅删除项目。`,
                            async () => {
                                // 用户选择删除任务
                                await this.deleteProjectAndTasks(project.id, true);
                            },
                            async () => {
                                // 用户选择不删除任务
                                await this.deleteProjectAndTasks(project.id, false);
                            }
                        );
                    } else {
                        // 没有任务，直接删除项目
                        await this.deleteProjectAndTasks(project.id, false);
                    }
                }
            );
        } catch (error) {
            console.error('检查项目任务失败:', error);
            showMessage(i18n("deleteProjectFailed") || "删除项目失败");
        }
    }

    private async deleteProjectAndTasks(projectId: string, deleteTasks: boolean) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (!projectData[projectId]) {
                showMessage(i18n("projectNotExist") || "项目不存在");
                return;
            }

            // 删除项目
            delete projectData[projectId];
            await this.plugin.saveProjectData(projectData);

            // 如果需要删除任务
            if (deleteTasks) {
                const reminderData = await this.plugin.loadReminderData();
                let deletedCount = 0;

                // 删除所有关联的任务
                for (const reminderId of Object.keys(reminderData)) {
                    const reminder = reminderData[reminderId];
                    if (reminder && reminder.projectId === projectId) {
                        // 取消移动端通知
                        await this.plugin.cancelMobileNotification(reminderId);
                        delete reminderData[reminderId];
                        deletedCount++;
                    }
                };

                if (deletedCount > 0) {
                    await this.plugin.saveReminderData(reminderData);
                    showMessage(i18n("projectAndTasksDeleted")?.replace("${count}", deletedCount.toString()) || `项目及 ${deletedCount} 个任务已删除`);
                } else {
                    showMessage(i18n("projectDeleted") || "项目删除成功");
                }
            } else {
                showMessage(i18n("projectDeleted") || "项目删除成功");
            }

            // 关闭该项目的看板标签页
            this.closeProjectKanbanTab(projectId);

            // 重新加载项目列表
            this.loadProjects();
        } catch (error) {
            console.error('删除项目失败:', error);
            showMessage(i18n("deleteProjectFailed") || "删除项目失败");
        }
    }

    private async openProject(blockId: string) {
        try {

            openBlock(blockId);
        } catch (error) {
            console.error('打开项目失败:', error);
            confirm(
                i18n("openNoteFailed") || "打开项目失败",
                i18n("noteBlockDeleted") || "项目文档可能已被删除，是否删除相关的项目记录？",
                async () => {
                    await this.deleteProjectByBlockId(blockId);
                },
                () => {
                    showMessage(i18n("openNoteFailedDelete") || "打开项目失败");
                }
            );
        }
    }

    private async deleteProjectByBlockId(blockId: string) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[blockId]) {
                delete projectData[blockId];
                await this.plugin.saveProjectData(projectData);
                // 关闭该项目的看板标签页
                this.closeProjectKanbanTab(blockId);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                showMessage(i18n("deletedRelatedReminders") || "相关项目记录已删除");
                this.loadProjects();
            } else {
                showMessage(i18n("projectNotExist") || "项目记录不存在");
            }
        } catch (error) {
            console.error('删除项目记录失败:', error);
            showMessage(i18n("deleteProjectFailed") || "删除项目记录失败");
        }
    }

    /**
     * 关闭指定项目的看板标签页
     * @param projectId 项目ID
     */
    private closeProjectKanbanTab(projectId: string) {
        try {
            getAllModels().custom.forEach((custom: any) => {
                // 检查标签页类型是否为项目看板类型，并且data.projectId匹配
                if (custom.type === this.plugin.name + PROJECT_KANBAN_TAB_TYPE && custom.data?.projectId === projectId) {
                    custom.tab?.close();
                }
            });
        } catch (error) {
            console.error('关闭项目看板标签页失败:', error);
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(this.plugin, () => {
            // 分类更新后重新渲染过滤器和项目列表
            this.updateCategoryFilterButtonText();
            this.loadProjects();
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        });
        categoryDialog.show();
    }

    private showStatusManageDialog() {
        const statusDialog = new StatusManageDialog(this.plugin, () => {
            // 状态更新后重新渲染过滤器和项目列表
            this.renderStatusFilter();
            this.loadProjects();
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        });
        statusDialog.show();
    }

    private openProjectKanban(project: any) {
        try {
            // 打开项目看板Tab
            this.plugin.openProjectKanbanTab(project.id, project.title);
        } catch (error) {
            console.error('打开项目看板失败:', error);
            showMessage("打开项目看板失败");
        }
    }

    private createQuickProject() {
        const dialog = new ProjectDialog(undefined, this.plugin);
        dialog.show();
    }

    private showBindToBlockDialog(project: any, mode: string = 'bind') {
        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            try {
                await this.bindProjectToBlock(project, blockId);
                showMessage(i18n("bindSuccess") || "绑定成功");
            } catch (error) {
                showMessage(i18n("bindFailed") || "绑定失败");
                console.error(error);
            }
        }, {
            defaultTab: mode
        });
        blockBindingDialog.show();
    }

    private async bindProjectToBlock(project: any, blockId: string) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[project.id]) {
                projectData[project.id].blockId = blockId;
                await this.plugin.saveProjectData(projectData);
                window.dispatchEvent(new CustomEvent('projectUpdated'));
                this.loadProjects();
            }
        } catch (error) {
            console.error('绑定项目到块失败:', error);
            throw error;
        }
    }

    // 新增：打开四象限面板
    private openEisenhowerMatrix() {
        try {
            if (this.plugin) {
                this.plugin.openEisenhowerMatrixTab();
            } else {
                showMessage("插件实例不可用");
            }
        } catch (error) {
            console.error('打开四象限面板失败:', error);
            showMessage("打开四象限面板失败");
        }
    }

    // 新增：显示更多菜单
    private showMoreMenu(event: MouseEvent) {
        try {
            const menu = new Menu("projectMoreMenu");

            // 添加分类管理
            menu.addItem({
                icon: 'iconTags',
                label: i18n("manageCategories") || "管理分类",
                click: () => {
                    this.showCategoryManageDialog();
                }
            });

            // 添加状态管理
            menu.addItem({
                icon: 'iconSettings',
                label: i18n("manageStatuses") || "管理状态",
                click: () => {
                    this.showStatusManageDialog();
                }
            });

            // 添加插件设置（在更多菜单中）
            menu.addItem({
                icon: 'iconSettings',
                label: i18n("pluginSettings") || "插件设置",
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

            // 获取按钮位置并显示菜单
            const target = event.target as HTMLElement;
            const button = target.closest('button');
            if (button) {
                const rect = button.getBoundingClientRect();
                const menuX = rect.left;
                const menuY = rect.bottom + 4;

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
            console.error('显示更多菜单失败:', error);
        }
    }

    /**
     * 显示番茄钟统计视图
     */
    private showPomodoroStatsView() {
        try {
            const lastMode = getLastStatsMode();
            if (lastMode === 'task') {
                const statsView = new TaskStatsView(this.plugin);
                statsView.show();
            } else {
                const statsView = new PomodoroStatsView(this.plugin);
                statsView.show();
            }
        } catch (error) {
            console.error('打开番茄钟统计视图失败:', error);
            showMessage("打开番茄钟统计视图失败");
        }
    }

    /**
     * 创建按状态分组的 DOM 元素，包含标题行（支持折叠/展开）和项目列表容器
     */
    private createStatusGroupElement(status: any, projects: any[]): HTMLElement {
        const statusId = status.id || 'unknown';
        const statusName = status.name || statusId;
        const statusIcon = status.icon || '';

        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'project-group';
        groupWrapper.dataset.statusId = statusId;

        const header = document.createElement('div');
        header.className = 'project-group__header';
        // make header sticky so it stays at top while scrolling within the panel
        // compute top offset based on the main header height to avoid overlapping

        header.style.cssText = `display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 6px;   z-index:3; background: var(--b3-theme-surface); border-bottom: 1px solid rgba(0,0,0,0.04);`;

        const left = document.createElement('div');
        left.style.cssText = 'display:flex; align-items:center; gap:8px;';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'project-group__icon';
        iconSpan.textContent = statusIcon;
        left.appendChild(iconSpan);

        const titleSpan = document.createElement('span');
        titleSpan.className = 'project-group__title';
        titleSpan.textContent = `${statusName} (${projects.length})`;
        left.appendChild(titleSpan);

        header.appendChild(left);

        const right = document.createElement('div');
        right.style.cssText = 'display:flex; align-items:center; gap:8px;';

        // toggle button as chevron icon on the right
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'b3-button b3-button--tiny b3-button--outline project-group__toggle';
        toggleBtn.title = this.groupCollapsedState[statusId] ? '展开该分组' : '折叠该分组';
        toggleBtn.style.display = 'inline-flex';
        toggleBtn.style.alignItems = 'center';
        toggleBtn.style.justifyContent = 'center';
        toggleBtn.style.width = '28px';
        toggleBtn.style.height = '28px';
        toggleBtn.style.padding = '0';

        toggleBtn.innerHTML = `<svg class="project-group__toggle-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

        // initial rotation based on collapsed state
        const collapsed = !!this.groupCollapsedState[statusId];
        const iconEl = toggleBtn.querySelector('.project-group__toggle-icon') as HTMLElement;
        if (iconEl) iconEl.style.transform = collapsed ? 'rotate(-180deg)' : 'rotate(0deg)';

        right.appendChild(toggleBtn);

        header.appendChild(right);

        groupWrapper.appendChild(header);

        const listContainer = document.createElement('div');
        listContainer.className = 'project-group__list';
        listContainer.style.cssText = 'display:flex; flex-direction:column; gap:6px; padding:6px;';

        // 根据折叠状态决定是否隐藏
        if (collapsed) {
            listContainer.style.display = 'none';
        }

        projects.forEach((project: any) => {
            const projectEl = this.createProjectElement(project);
            listContainer.appendChild(projectEl);
        });

        toggleBtn.addEventListener('click', () => {
            const isCollapsedNow = !!this.groupCollapsedState[statusId];
            this.groupCollapsedState[statusId] = !isCollapsedNow;

            if (this.groupCollapsedState[statusId]) {
                listContainer.style.display = 'none';
                if (iconEl) iconEl.style.transform = 'rotate(-180deg)';
                toggleBtn.title = '展开该分组';
            } else {
                listContainer.style.display = 'flex';
                if (iconEl) iconEl.style.transform = 'rotate(0deg)';
                toggleBtn.title = '折叠该分组';
            }
        });

        groupWrapper.appendChild(listContainer);

        return groupWrapper;
    }

    private async showCategorySelectDialog() {
        const categories = await this.categoryManager.loadCategories();

        const dialog = new Dialog({
            title: i18n("selectCategories") || "选择分类",
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
            this.savePanelSettings();
            this.loadProjects();
            dialog.destroy();
        });

        cancelBtn.addEventListener('click', () => dialog.destroy());
    }

    private async restorePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            this.currentSort = settings.projectPanelSort || 'priority';
            this.currentSortOrder = settings.projectPanelSortOrder || 'desc';
            this.showOnlyWithDoingTasks = settings.projectPanelShowOnlyDoing || false;
            this.selectedCategories = settings.projectPanelSelectedCategories || [];
        } catch (error) {
            console.error('恢复项目面板设置失败:', error);
        }
    }

    private async savePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            settings.projectPanelSort = this.currentSort;
            settings.projectPanelSortOrder = this.currentSortOrder;
            settings.projectPanelShowOnlyDoing = this.showOnlyWithDoingTasks;
            settings.projectPanelSelectedCategories = this.selectedCategories;
            await this.plugin.saveSettings(settings);
        } catch (error) {
            console.error('保存项目面板设置失败:', error);
        }
    }

    private createCategorySelectContent(categories: any[]): string {
        let html = `
            <div class="category-select-dialog">
                <div class="b3-dialog__content">
                    <div class="category-option">
                        <label>
                            <input type="checkbox" id="categoryAll" value="all" ${this.selectedCategories.includes('all') || this.selectedCategories.length === 0 ? 'checked' : ''}>
                            ${i18n("allCategories") || "全部"}
                        </label>
                    </div>
                    <div class="category-option">
                        <label>
                            <input type="checkbox" class="category-checkbox" value="none" ${this.selectedCategories.includes('none') ? 'checked' : ''}>
                            ${i18n("noCategory") || "无分类"}
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
                    <button class="b3-button b3-button--cancel" id="categorySelectCancel">${i18n("cancel")}</button>
                    <button class="b3-button b3-button--primary" id="categorySelectConfirm">${i18n("confirm")}</button>
                </div>
            </div>
        `;

        return html;
    }
}
