import { showMessage, confirm, Menu, Dialog, getAllModels, platformUtils, openEmoji } from "siyuan";
import { getLastStatsMode } from "./stats/statsMode";
import { showStatsDialog } from "./stats/ShowStatsDialog";

// 添加四象限面板常量
import { getBlockByID, openBlock } from "../api";
import { PROJECT_KANBAN_TAB_TYPE } from "../index";
import { ProjectManager } from "../utils/projectManager";
import { compareDateStrings, getLogicalDateString, getLocaleTag } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { StatusManager } from "../utils/statusManager";
import { ProjectDialog } from "./ProjectDialog";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { StatusManageDialog } from "./ProjectStatusManageDialog";
import { GlobalProjectStatusDialog } from "./GlobalProjectStatusDialog";
import { ProjectKanbanView } from "./ProjectKanbanView";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { i18n } from "../pluginInstance";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import { SortMenuDialog } from "./SortMenuDialog";
import { SortCriterion, getSortCriterionName } from "../utils/sortConfig";
import { generateRandomColor } from "../utils/uiUtils";
import { ProjectFolderManager, ProjectFolder } from "../utils/projectFolderManager";
import { ProjectFolderManageDialog } from "./ProjectFolderManageDialog";
import { ProjectSelectorPopup } from "./ProjectSelectorPopup";
import { showProjectStatsDialog, showFolderStatsDialog } from "./dialog/ProjectStatsDialog";


const PROJECT_PANEL_SORT_METHODS = new Set(['category', 'priority', 'time', 'created', 'title']);

interface ProjectFolderTreeNode {
    folder: ProjectFolder;
    projects: any[];
    children: ProjectFolderTreeNode[];
    totalProjectCount: number;
}

type FolderDropMode = 'before' | 'inside' | 'after';

export function normalizeProjectPanelSortCriteria(
    criteriaRaw: any,
    legacySortType?: any,
    legacySortOrder?: any
): SortCriterion[] {
    const normalized = Array.isArray(criteriaRaw)
        ? criteriaRaw
            .map((criterion: any) => ({
                method: String(criterion?.method || ''),
                order: criterion?.order === 'desc' ? 'desc' : 'asc'
            }))
            .filter((criterion: SortCriterion) => PROJECT_PANEL_SORT_METHODS.has(criterion.method))
        : [];

    if (normalized.length > 0) {
        return normalized;
    }

    const fallbackMethod = PROJECT_PANEL_SORT_METHODS.has(String(legacySortType || ''))
        ? String(legacySortType)
        : 'priority';
    const fallbackOrder = legacySortOrder === 'asc' ? 'asc' : 'desc';
    return [{ method: fallbackMethod, order: fallbackOrder }];
}

export function buildProjectCategoryOrderMap(categories: any[]): Map<string, number> {
    const categoryOrderMap = new Map<string, number>();
    (categories || []).forEach((cat: any, index: number) => {
        if (cat?.id) {
            categoryOrderMap.set(String(cat.id), index);
        }
    });
    return categoryOrderMap;
}

export function buildProjectStatusOrderMap(statuses: any[]): Map<string, number> {
    const source = Array.isArray(statuses) && statuses.length > 0
        ? statuses
        : [{ id: 'active' }, { id: 'someday' }, { id: 'archived' }];
    const statusOrderMap = new Map<string, number>();
    source.forEach((status: any, index: number) => {
        if (status?.id) {
            statusOrderMap.set(String(status.id), index);
        }
    });
    return statusOrderMap;
}

function getProjectPrimaryCategoryOrder(project: any, categoryOrderMap: Map<string, number>): { hasCategory: boolean; order: number } {
    const ids = String(project?.categoryId || '')
        .split(',')
        .map((id: string) => id.trim())
        .filter((id: string) => id);

    if (ids.length === 0) {
        return { hasCategory: false, order: Number.MAX_SAFE_INTEGER };
    }

    let bestOrder = Number.MAX_SAFE_INTEGER;
    ids.forEach((id: string) => {
        const order = categoryOrderMap.get(id) ?? Number.MAX_SAFE_INTEGER;
        if (order < bestOrder) {
            bestOrder = order;
        }
    });

    return { hasCategory: true, order: bestOrder };
}

function compareProjectBySetTime(a: any, b: any): number {
    const hasStartDateA = !!a?.startDate;
    const hasStartDateB = !!b?.startDate;

    if (!hasStartDateA && !hasStartDateB) return 0;
    if (!hasStartDateA) return 1;
    if (!hasStartDateB) return -1;
    return String(a.startDate).localeCompare(String(b.startDate));
}

function compareProjectByCreatedAt(a: any, b: any): number {
    const timeA = a?.createdTime ? new Date(a.createdTime).getTime() : (a?.createdAt ? new Date(a.createdAt).getTime() : 0);
    const timeB = b?.createdTime ? new Date(b.createdTime).getTime() : (b?.createdAt ? new Date(b.createdAt).getTime() : 0);
    return timeA - timeB;
}

function compareProjectByPriorityWithManualSort(a: any, b: any, order: 'asc' | 'desc'): number {
    const priorityOrder = { high: 3, medium: 2, low: 1, none: 0 };
    const priorityA = priorityOrder[a?.priority || 'none'] || 0;
    const priorityB = priorityOrder[b?.priority || 'none'] || 0;
    const priorityDiff = priorityA - priorityB;

    if (priorityDiff !== 0) {
        return order === 'desc' ? -priorityDiff : priorityDiff;
    }

    const sortDiff = (a?.sort || 0) - (b?.sort || 0);
    if (sortDiff !== 0) return sortDiff;

    const timeDiff = compareProjectBySetTime(a, b);
    if (timeDiff !== 0) return timeDiff;

    return compareProjectByCreatedAt(a, b);
}

function compareProjectByCriterion(
    a: any,
    b: any,
    criterion: SortCriterion,
    categoryOrderMap: Map<string, number>
): number {
    let result = 0;

    switch (criterion.method) {
        case 'priority':
            return compareProjectByPriorityWithManualSort(a, b, criterion.order);
        case 'category': {
            const catA = getProjectPrimaryCategoryOrder(a, categoryOrderMap);
            const catB = getProjectPrimaryCategoryOrder(b, categoryOrderMap);
            if (!catA.hasCategory && !catB.hasCategory) result = 0;
            else if (!catA.hasCategory) result = 1;
            else if (!catB.hasCategory) result = -1;
            else result = catA.order - catB.order;
            break;
        }
        case 'time':
            result = compareProjectBySetTime(a, b);
            break;
        case 'created':
            result = compareProjectByCreatedAt(a, b);
            break;
        case 'title': {
            const titleA = String(a?.title || '').toLowerCase();
            const titleB = String(b?.title || '').toLowerCase();
            result = titleA.localeCompare(titleB, getLocaleTag());
            break;
        }
        default:
            result = 0;
            break;
    }

    return criterion.order === 'desc' ? -result : result;
}

export function compareProjectsByPanelSort(
    a: any,
    b: any,
    criteriaInput: SortCriterion[],
    categoryOrderMap: Map<string, number>,
    statusOrderMap?: Map<string, number>
): number {
    const statusA = String(a?.status || 'active');
    const statusB = String(b?.status || 'active');
    const orderA = statusOrderMap?.get(statusA) ?? Number.MAX_SAFE_INTEGER;
    const orderB = statusOrderMap?.get(statusB) ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) {
        return orderA - orderB;
    }

    const criteria = normalizeProjectPanelSortCriteria(criteriaInput);

    for (const criterion of criteria) {
        const result = compareProjectByCriterion(a, b, criterion, categoryOrderMap);
        if (result !== 0) {
            return result;
        }
    }

    if (!criteria.some(c => c.method === 'priority')) {
        const sortDiff = (a?.sort || 0) - (b?.sort || 0);
        if (sortDiff !== 0) {
            return sortDiff;
        }
    }

    return compareProjectByCreatedAt(a, b);
}

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
    private currentSortCriteria: SortCriterion[] = [{ method: 'priority', order: 'desc' }];
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
    private isDraggingFolder: boolean = false;
    private draggedFolderElement: HTMLElement | null = null;
    private draggedFolder: any = null;
    private currentProjectsCache: any[] = [];
    // 保存每个状态分组的折叠状态（key = statusId, value = boolean; true=collapsed）
    private groupCollapsedState: Record<string, boolean> = {};
    // 缓存提醒数据，避免为每个项目重复读取
    private reminderDataCache: any = null;
    private currentViewMode: 'card' | 'list' = 'card';

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
        const folderManager = ProjectFolderManager.getInstance(this.plugin);
        await folderManager.initialize();
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

        // 添加切换视图下拉框
        const viewModeSelect = document.createElement('select');
        viewModeSelect.className = 'b3-select project-view-mode-select';
        viewModeSelect.style.marginLeft = '8px';
        viewModeSelect.style.padding = '2px 4px';
        viewModeSelect.style.height = '22px';
        viewModeSelect.style.fontSize = '12px';
        viewModeSelect.style.width = 'auto';

        const cardOption = document.createElement('option');
        cardOption.value = 'card';
        cardOption.textContent = i18n("statusViewMode") || "状态视图";
        cardOption.selected = this.currentViewMode === 'card';

        const listOption = document.createElement('option');
        listOption.value = 'list';
        listOption.textContent = i18n("folderViewMode") || "文件夹视图";
        listOption.selected = this.currentViewMode === 'list';

        viewModeSelect.appendChild(cardOption);
        viewModeSelect.appendChild(listOption);

        viewModeSelect.addEventListener('change', async () => {
            this.currentViewMode = viewModeSelect.value as 'card' | 'list';
            await this.savePanelSettings();
            await this.loadProjects();
        });

        titleContainer.appendChild(iconSpan);
        titleContainer.appendChild(titleSpan);
        titleContainer.appendChild(viewModeSelect);

        // 添加右侧按钮容器
        const actionContainer = document.createElement('div');
        actionContainer.className = 'project-panel__actions';
        actionContainer.style.marginLeft = 'auto';

        // 添加创建项目按钮
        const createProjectBtn = document.createElement('button');
        createProjectBtn.className = 'b3-button b3-button--outline';
        createProjectBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>';
        createProjectBtn.classList.add('ariaLabel'); createProjectBtn.setAttribute('aria-label', i18n("createProject") || "创建项目");
        createProjectBtn.addEventListener('click', () => {
            this.createQuickProject();
        });
        actionContainer.appendChild(createProjectBtn);

        // 添加排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.classList.add('ariaLabel'); this.sortButton.setAttribute('aria-label', i18n("sortBy") || "排序");
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
            calendarBtn.classList.add('ariaLabel'); calendarBtn.setAttribute('aria-label', i18n("calendarView") || "日历视图");
            calendarBtn.addEventListener('click', () => {
                this.plugin.openCalendarTab();
            });
            actionContainer.appendChild(calendarBtn);

            // 添加四象限面板按钮（放在日历按钮旁边）
            const eisenhowerBtn = document.createElement('button');
            eisenhowerBtn.className = 'b3-button b3-button--outline';
            eisenhowerBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconGrid"></use></svg>';
            eisenhowerBtn.classList.add('ariaLabel'); eisenhowerBtn.setAttribute('aria-label', i18n("eisenhowerMatrix") || "四象限面板");
            eisenhowerBtn.addEventListener('click', () => {
                this.openEisenhowerMatrix();
            });
            actionContainer.appendChild(eisenhowerBtn);

            // 添加番茄钟看板按钮
            const pomodoroStatsBtn = document.createElement('button');
            pomodoroStatsBtn.className = 'b3-button b3-button--outline';
            pomodoroStatsBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconStatistic"></use></svg>';
            pomodoroStatsBtn.classList.add('ariaLabel'); pomodoroStatsBtn.setAttribute('aria-label', i18n("statsView") || "统计视图");
            pomodoroStatsBtn.addEventListener('click', () => {
                this.showPomodoroStatsView();
            });
            actionContainer.appendChild(pomodoroStatsBtn);

            // 添加刷新按钮
            const refreshBtn = document.createElement('button');
            refreshBtn.className = 'b3-button b3-button--outline';
            refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
            refreshBtn.classList.add('ariaLabel'); refreshBtn.setAttribute('aria-label', i18n("refresh") || "刷新");
            refreshBtn.addEventListener('click', () => {
                this.loadProjects();
            });
            actionContainer.appendChild(refreshBtn);
        }

        // 添加更多按钮（放在最右边）
        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--outline';
        moreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.classList.add('ariaLabel'); moreBtn.setAttribute('aria-label', i18n("more") || "更多");
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
            this.savePanelSettings();
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

        this.projectsContainer.addEventListener('dragover', (e) => {
            if (this.currentViewMode === 'list' && this.isDragging) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });

        this.projectsContainer.addEventListener('drop', async (e) => {
            if (this.currentViewMode === 'list' && this.isDragging && this.draggedProject) {
                const target = e.target as HTMLElement;
                if (!target.closest('.project-folder-group') && !target.closest('.project-item')) {
                    e.preventDefault();
                    await this.moveProjectToFolder(this.draggedProject.id, '');
                }
            }
        });

        // 渲染分类过滤器
        this.updateCategoryFilterButtonText();
        this.updateSortButtonTitle();
    }

    private async renderStatusFilter() {
        if (!this.filterSelect) return;

        try {
            const statuses = this.statusManager.getStatuses();
            const hasCurrentTab = this.currentTab === 'all' || statuses.some(status => status.id === this.currentTab);
            if (!hasCurrentTab) {
                this.currentTab = 'all';
            }

            this.filterSelect.innerHTML = `<option value="all" ${this.currentTab === 'all' ? 'selected' : ''}>${i18n("allProjects") || "全部项目"}</option>`;

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

    private getProjectSortAvailableMethods() {
        return [
            { key: 'category', label: () => i18n("sortByCategory") || '分类', icon: '🏷️' },
            { key: 'priority', label: () => i18n("sortByPriority") || '优先级', icon: '🎯' },
            { key: 'time', label: () => i18n("sortBySetTime") || i18n("sortByTime") || '设定时间', icon: '🕐' },
            { key: 'created', label: () => i18n("sortByCreated") || '创建时间', icon: '📅' },
            { key: 'title', label: () => i18n("sortByTitle") || '标题', icon: '📝' }
        ];
    }

    private normalizeSortCriteria(criteria: any): SortCriterion[] {
        return normalizeProjectPanelSortCriteria(criteria);
    }

    private getActiveSortCriteria(): SortCriterion[] {
        return this.normalizeSortCriteria(this.currentSortCriteria);
    }

    private syncLegacySortStateFromCriteria() {
        const primary = this.getActiveSortCriteria()[0] || { method: 'priority', order: 'desc' as const };
        this.currentSort = primary.method;
        this.currentSortOrder = primary.order;
    }

    private isDragDisabledBySortMode(): boolean {
        const primary = this.getActiveSortCriteria()?.[0]?.method;
        return primary === 'created' || primary === 'title';
    }

    private getProjectNonPrioritySortGroupKey(project: any): string {
        const activeCriteria = this.getActiveSortCriteria();
        const keyParts: string[] = [];
        const categoryOrderMap = buildProjectCategoryOrderMap(this.categoryManager.getCategories());

        for (const criterion of activeCriteria) {
            if (criterion.method === 'priority') {
                break;
            }

            if (criterion.method === 'category') {
                const categoryInfo = getProjectPrimaryCategoryOrder(project, categoryOrderMap);
                keyParts.push(categoryInfo.hasCategory ? `category:${categoryInfo.order}` : 'category:none');
                continue;
            }

            if (criterion.method === 'time') {
                keyParts.push(`time:${project?.startDate || '__NO_DATE__'}`);
                continue;
            }
        }

        return keyParts.length > 0 ? keyParts.join('|') : '__ALLOW_ALL__';
    }

    private isSameNonPrioritySortGroup(a: any, b: any): boolean {
        return this.getProjectNonPrioritySortGroupKey(a) === this.getProjectNonPrioritySortGroupKey(b);
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const activeCriteria = this.getActiveSortCriteria();
            let fullSortDescription: string;

            if (!activeCriteria || activeCriteria.length === 0) {
                fullSortDescription = i18n("sortBy") || "排序";
            } else if (activeCriteria.length === 1) {
                fullSortDescription = getSortCriterionName(activeCriteria[0]);
            } else {
                fullSortDescription = activeCriteria.map((criterion, index) => `${index + 1}. ${getSortCriterionName(criterion)}`).join('<br>');
            }

            this.sortButton.classList.add('ariaLabel');
            this.sortButton.setAttribute('aria-label', `${i18n("sortBy") || "排序"}:<br>${fullSortDescription}`);
        }
    }

    private showSortMenu(_event: MouseEvent) {
        try {
            const dialog = new SortMenuDialog({
                plugin: this.plugin,
                currentCriteria: this.getActiveSortCriteria(),
                availableMethods: this.getProjectSortAvailableMethods(),
                onSave: async (criteria) => {
                    try {
                        this.currentSortCriteria = this.normalizeSortCriteria(criteria);
                        this.syncLegacySortStateFromCriteria();
                        this.updateSortButtonTitle();
                        await this.savePanelSettings();
                        this.loadProjects();
                    } catch (error) {
                        console.error('保存项目排序配置失败:', error);
                    }
                },
                onChange: async (criteria) => {
                    try {
                        this.currentSortCriteria = this.normalizeSortCriteria(criteria);
                        this.syncLegacySortStateFromCriteria();
                        this.updateSortButtonTitle();
                        await this.savePanelSettings();
                        this.loadProjects();
                    } catch (error) {
                        console.error('实时更新项目排序配置失败:', error);
                    }
                }
            });
            dialog.show();
        } catch (error) {
            console.error('显示排序菜单失败:', error);
        }
    }

    private async loadProjects() {
        try {
            await ProjectManager.getInstance(this.plugin).loadProjects();
            const projectData = await this.plugin.loadProjectData();

            if (!projectData || typeof projectData !== 'object') {
                this.renderProjects([]);
                return;
            }

            // 获取当前有效状态列表，若未初始化则进行初始化
            let statuses = StatusManager.getInstance(this.plugin).getStatuses();
            if (!statuses || statuses.length === 0) {
                await StatusManager.getInstance(this.plugin).initialize();
                statuses = StatusManager.getInstance(this.plugin).getStatuses();
            }
            const statusIds = new Set(statuses.map((s: any) => s.id));
            const defaultStatusId = statuses.length > 0 ? statuses[0].id : 'active';

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

                    // 检查状态是否有效，如果无效（被删除了），自动设置为第一个状态
                    if (project.status && !statusIds.has(project.status)) {
                        project.status = defaultStatusId;
                        dataChanged = true;
                    }

                    if (!project.color) {
                        project.color = generateRandomColor();
                        dataChanged = true;
                    }
                    return true;
                }
                return false;
            });

            // 如果有数据迁移或新生成颜色，保存更新并同步缓存与事件
            if (dataChanged) {
                await this.plugin.saveProjectData(projectData);
                try {
                    await ProjectManager.getInstance(this.plugin).loadProjects();
                    window.dispatchEvent(new CustomEvent('projectColorUpdated'));
                } catch (syncErr) {
                    console.error('Failed to sync project manager or dispatch color update event:', syncErr);
                }
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
                // 默认全部项目不显示已归档项目
                const archivedStatusIds = new Set(statuses.filter((s: any) => s.isArchived).map((s: any) => s.id));
                displayProjects = filteredProjects.filter((project: any) => !archivedStatusIds.has(project.status));
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
        const criteria = this.getActiveSortCriteria();
        const categoryOrderMap = buildProjectCategoryOrderMap(this.categoryManager.getCategories());
        const statusOrderMap = buildProjectStatusOrderMap(this.statusManager.getStatuses());
        projects.sort((a: any, b: any) => compareProjectsByPanelSort(a, b, criteria, categoryOrderMap, statusOrderMap));
    }

    private renderProjects(projects: any[]) {
        this.projectsContainer.classList.toggle('project-document-tree', this.currentViewMode === 'list');

        // 文件夹视图下，即使没有项目也要渲染文件夹
        if (this.currentViewMode === 'list') {
            this.projectsContainer.classList.add('project-document-tree');
            this.renderProjectsAsChecklist(projects || []);
            this.currentProjectsCache = [...(projects || [])];
            return;
        }

        // 如果没有项目则显示空提示
        if (!projects || projects.length === 0) {
            // 当在 "all" 标签下，排除归档后可能为空
            if (this.currentTab === 'all') {
                this.projectsContainer.innerHTML = `<div class="project-empty">${i18n("noProjects") || '暂无项目'}</div>`;
            } else {
                const status = this.statusManager.getStatusById(this.currentTab);
                const statusName = status ? status.name : i18n("allProjects");
                const emptyText = i18n("noProjectsInStatus")?.replace("${status}", statusName) || `暂无"${statusName}"状态的项目`;
                this.projectsContainer.innerHTML = `<div class="project-empty">${emptyText}</div>`;
            }
            // 清空缓存
            this.currentProjectsCache = [];
            return;
        }

        // 缓存当前项目列表
        this.currentProjectsCache = [...projects];

        this.projectsContainer.classList.remove('project-document-tree');

        // 如果 currentTab 为 'all'，则按状态分组并排除 archived
        if (this.currentTab === 'all') {
            // 按状态分组
            const groups: Record<string, any[]> = {};
            projects.forEach(p => {
                const st = p.status || 'active';
                // 跳过归档状态
                const statusInfo = this.statusManager.getStatusById(st);
                if (statusInfo?.isArchived) return;
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
        if (this.currentViewMode === 'list') {
            return this.createProjectListElement(project);
        }

        const today = getLogicalDateString();
        const isOverdue = project.endDate && compareDateStrings(project.endDate, today) < 0;
        const priority = project.priority || 'none';
        const status = project.status || 'active';

        const projectEl = document.createElement('div');
        projectEl.className = `project-item ${isOverdue ? 'project-item--overdue' : ''} project-item--${status} project-priority-${priority}`;

        // 存储项目数据到元素
        projectEl.dataset.projectId = project.id;
        projectEl.dataset.priority = priority;

        const itemMoreBtn = document.createElement('button');
        itemMoreBtn.type = 'button';
        itemMoreBtn.className = 'b3-button b3-button--text project-item__more-button';
        itemMoreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        const shouldAlwaysShowMoreButton = !!this.plugin?.isInMobileApp;
        itemMoreBtn.style.cssText = `
            position: absolute;
            top: 8px;
            right: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            padding: 0;
            border-radius: 6px;
            opacity: ${shouldAlwaysShowMoreButton ? '1' : '0'};
            pointer-events: ${shouldAlwaysShowMoreButton ? 'auto' : 'none'};
            transition: opacity 0.2s ease;
            z-index: 10;
        `;
        itemMoreBtn.classList.add('ariaLabel');
        itemMoreBtn.setAttribute('aria-label', i18n("more") || "更多");
        itemMoreBtn.draggable = false;

        const setMoreButtonVisible = (visible: boolean) => {
            if (shouldAlwaysShowMoreButton) return;
            itemMoreBtn.style.opacity = visible ? '1' : '0';
            itemMoreBtn.style.pointerEvents = visible ? 'auto' : 'none';
        };

        if (!shouldAlwaysShowMoreButton) {
            projectEl.addEventListener('mouseenter', () => setMoreButtonVisible(true));
            projectEl.addEventListener('mouseleave', () => setMoreButtonVisible(false));
            itemMoreBtn.addEventListener('focus', () => setMoreButtonVisible(true));
            itemMoreBtn.addEventListener('blur', () => setMoreButtonVisible(false));
        }

        itemMoreBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        itemMoreBtn.addEventListener('dragstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        itemMoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const rect = itemMoreBtn.getBoundingClientRect();
            this.showProjectContextMenu({
                clientX: rect.right,
                clientY: rect.bottom + 4
            }, project);
        });
        projectEl.appendChild(itemMoreBtn);

        // 桌面端允许直接拖拽排序；创建时间/标题排序下禁用
        if (!this.isDragDisabledBySortMode()) {
            this.addDragFunctionality(projectEl, project);
        }
        // 支持接收来自项目看板的任务拖入（修改任务所属项目）
        this.addTaskDropTarget(projectEl, project);

        // 添加右键菜单支持
        projectEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showProjectContextMenu(e, project);
        });

        // 添加单击打开项目看板支持
        projectEl.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.project-item__more-button')) return;
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

        const parsed = this.parseTitle(project.title);
        const displayTitle = parsed.text || i18n("unnamedNote") || '未命名项目';

        const dotEl = document.createElement('span');
        dotEl.className = 'project-item__color-dot';
        dotEl.style.cssText = `
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: ${project.color || '#cccccc'};
            flex-shrink: 0;
            display: inline-block;
            text-decoration: none !important;
        `;
        titleEl.appendChild(dotEl);

        if (parsed.emoji) {
            const emojiEl = document.createElement('span');
            emojiEl.className = 'project-item__emoji-icon';
            emojiEl.textContent = parsed.emoji;
            emojiEl.style.cssText = `
                font-size: 14px;
                flex-shrink: 0;
                display: inline-block;
                text-decoration: none !important;
            `;
            titleEl.appendChild(emojiEl);
        }

        const textEl = document.createElement('span');
        textEl.textContent = displayTitle;
        titleEl.appendChild(textEl);

        if (project.blockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${project.blockId}`);
            titleEl.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                color: var(--b3-protyle-inline-blockref-color);
                font-weight: 500;
                text-decoration: none;
            `;
            textEl.style.textDecoration = 'underline';
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openProject(project.blockId);
            });
        } else {
            titleEl.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
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
            const settings = await this.plugin?.loadSettings?.() || this.plugin?.settings || {};
            const holidayData = await this.plugin?.loadHolidayData?.() || {};

            const result = ProjectKanbanView.countTopLevelTasksByStatus(projectId, reminderData, statuses, settings, holidayData);
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
            const settings = await this.plugin?.loadSettings?.() || this.plugin?.settings || {};
            const holidayData = await this.plugin?.loadHolidayData?.() || {};
            const result = ProjectKanbanView.countTopLevelTasksByStatus(projectId, reminderData, statuses, settings, holidayData);

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
            const settings = await this.plugin?.loadSettings?.() || this.plugin?.settings || {};
            const holidayData = await this.plugin?.loadHolidayData?.() || {};
            const legacy = ProjectKanbanView.countTopLevelTasksByStatus(projectId, reminderData, undefined, settings, holidayData);
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
    private addDragFunctionality(projectEl: HTMLElement, project: any) {
        if (this.plugin?.isInMobileApp) return;

        projectEl.draggable = true;
        projectEl.style.cursor = 'grab';

        projectEl.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            const target = e.target as HTMLElement | null;
            if (target?.closest('.project-item__more-button')) {
                e.preventDefault();
                return;
            }

            this.isDragging = true;
            this.draggedElement = projectEl;
            this.draggedProject = project;
            projectEl.style.opacity = '0.5';
            projectEl.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', projectEl.outerHTML);
            }
        });

        projectEl.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedElement = null;
            this.draggedProject = null;
            projectEl.style.opacity = '';
            projectEl.style.cursor = 'grab';
        });

        projectEl.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement !== projectEl) {
                e.preventDefault();
                e.stopPropagation();

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
                e.stopPropagation();

                const targetProject = this.getProjectFromElement(projectEl);
                if (targetProject && this.canDropHere(this.draggedProject, targetProject)) {
                    this.handleDrop(this.draggedProject, targetProject, e);
                }
            }
            this.hideDropIndicator();
        });

        projectEl.addEventListener('dragleave', (e) => {
            e.stopPropagation();
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
    private canDropHere(draggedProject: any, targetProject: any): boolean {
        if (!draggedProject || !targetProject) return false;
        if (draggedProject.id === targetProject.id) return false;

        const draggedStatus = draggedProject.status || 'active';
        const targetStatus = targetProject.status || 'active';

        if (draggedStatus !== targetStatus) {
            return false;
        }

        if (this.isDragDisabledBySortMode()) {
            return false;
        }

        return this.isSameNonPrioritySortGroup(draggedProject, targetProject);
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
            const dropTarget = (event.currentTarget as HTMLElement) || (event.target as HTMLElement);
            const rect = dropTarget.getBoundingClientRect();
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
            if (this.isDragDisabledBySortMode()) {
                return;
            }

            if (!this.isSameNonPrioritySortGroup(draggedProject, targetProject)) {
                return;
            }

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
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            timeStr = `📅 ${startStr}`;
        }

        if (endDate) {
            const end = new Date(endDate + 'T00:00:00');
            const endStr = end.toLocaleDateString(getLocaleTag(), {
                year: 'numeric',
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

    private showProjectContextMenu(event: { clientX: number; clientY: number }, project: any) {
        const menu = new Menu("projectContextMenu");

        // 打开项目看板（统一放在第一个）
        menu.addItem({
            icon: "iconProject",
            label: i18n("openProjectKanban") || "打开项目看板",
            click: () => this.openProjectKanban(project)
        });

        menu.addItem({
            iconHTML: "📊",
            label: i18n("viewStatsMenuItem") || "查看统计",
            click: () => showProjectStatsDialog(this.plugin, project, this.reminderDataCache)
        });

        menu.addSeparator();

        if (project.blockId) {
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

        // 设置项目文件夹子菜单
        const createFolderMenuItems = () => {
            const folderManager = ProjectFolderManager.getInstance(this.plugin);
            const folders = folderManager.getFolders();
            const currentFolderId = project.folderId || '';

            const menuItems = [];

            menuItems.push({
                iconHTML: "❌",
                label: i18n("noFolder") || "无文件夹",
                current: currentFolderId === '',
                click: () => {
                    this.moveProjectToFolder(project.id, '');
                }
            });

            const childrenByParent = new Map<string, any[]>();
            folders.forEach(folder => {
                const parentId = folder.parentId || '';
                if (!childrenByParent.has(parentId)) {
                    childrenByParent.set(parentId, []);
                }
                childrenByParent.get(parentId).push(folder);
            });

            childrenByParent.forEach(children => {
                children.sort((a: any, b: any) => {
                    const sortDiff = (a.sort || 0) - (b.sort || 0);
                    if (sortDiff !== 0) return sortDiff;
                    return (a.name || '').localeCompare(b.name || '', getLocaleTag());
                });
            });

            const createNestedFolderItems = (parentId: string): any[] => {
                return (childrenByParent.get(parentId) || []).map((folder: any) => {
                    const childItems = createNestedFolderItems(folder.id);
                    const item: any = {
                        iconHTML: folder.icon || "📁",
                        label: folder.name,
                        current: currentFolderId === folder.id
                    };

                    if (childItems.length > 0) {
                        item.submenu = [
                            {
                                iconHTML: folder.icon || "📁",
                                label: "选择此文件夹",
                                current: currentFolderId === folder.id,
                                click: () => {
                                    this.moveProjectToFolder(project.id, folder.id);
                                }
                            },
                            { type: "separator" },
                            ...childItems
                        ];
                    } else {
                        item.click = () => {
                            this.moveProjectToFolder(project.id, folder.id);
                        };
                    }

                    return item;
                });
            };

            menuItems.push(...createNestedFolderItems(''));

            return menuItems;
        };

        menu.addItem({
            iconHTML: "📁",
            label: i18n("setFolder") || "设置文件夹",
            submenu: createFolderMenuItems()
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
                <div class="b3-dialog__content" style="display:flex; flex-direction:column; gap:8px; overflow:visible;">
                    <label>目标项目</label>
                    <div class="custom-select" id="mergeProjectSelectCustom" style="position: relative;">
                        <div style="position: relative;">
                            <input type="text" id="mergeProjectSearchInput" class="b3-text-field" placeholder="${i18n("searchProject") || '搜索项目'}" autocomplete="off" style="width: 100%; padding-right: 30px; background: var(--b3-select-background);" spellcheck="false">
                            <input type="hidden" id="mergeTargetSelect">
                        </div>
                        <div id="mergeProjectDropdown" class="b3-menu" style="display: none; position: absolute; width: 100%; max-height: 400px; overflow-y: auto; z-index: 10; margin-top: 4px; box-shadow: var(--b3-menu-shadow); background: var(--b3-menu-background); border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius);">
                            <!-- 项目选项将在这里渲染 -->
                        </div>
                    </div>

                    <label>目标分组（可选，选择"新建分组"可输入新名称）</label>
                    <select id="mergeGroupSelect" style="width:100%; padding:6px;" class="b3-select"></select>
                    <input id="mergeNewGroupInput" class="b3-text-field" type="text" placeholder="新分组名称" style="display:none; padding:6px;" />

                    <label style="display:flex; align-items:center; gap:8px;"><input id="mergeDeleteSource" type="checkbox" class="b3-switch"/> ${i18n("deleteSourceProjectAfterMerge") || '合并后删除源项目'}</label>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="mergeCancel">${i18n("cancel") || '取消'}</button>
                    <button class="b3-button b3-button--primary" id="mergeConfirm">${i18n("confirm") || '确认'}</button>
                </div>
            `;

            const dialog = new Dialog({
                title: i18n("mergeProject") || `合并项目: ${project.title}`,
                content: html,
                width: "520px",
                height: "320px"
            });

            const searchInput = dialog.element.querySelector('#mergeProjectSearchInput') as HTMLInputElement;
            const targetSelect = dialog.element.querySelector('#mergeTargetSelect') as HTMLInputElement;
            const dropdown = dialog.element.querySelector('#mergeProjectDropdown') as HTMLElement;
            const groupSelect = dialog.element.querySelector('#mergeGroupSelect') as HTMLSelectElement;
            const newGroupInput = dialog.element.querySelector('#mergeNewGroupInput') as HTMLInputElement;
            const cancelBtn = dialog.element.querySelector('#mergeCancel') as HTMLButtonElement;
            const confirmBtn = dialog.element.querySelector('#mergeConfirm') as HTMLButtonElement;
            const deleteCheckbox = dialog.element.querySelector('#mergeDeleteSource') as HTMLInputElement;

            // Make sure parents are overflow visible so that the dropdown can show outside the dialog
            let parent = dropdown.parentElement;
            while (parent && parent !== dialog.element) {
                parent.style.setProperty('overflow', 'visible', 'important');
                parent = parent.parentElement;
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

                const newByProjectOpt = document.createElement('option');
                newByProjectOpt.value = '__new_by_project_name__';
                newByProjectOpt.textContent = i18n("createNewGroupByProjectName") || '以项目名新建分组';
                groupSelect.appendChild(newByProjectOpt);

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

            const allowedProjectIds = projectManager.getProjects()
                .filter(p => p.id !== project.id)
                .map(p => p.id);

            const popup = new ProjectSelectorPopup({
                plugin: this.plugin,
                container: dropdown,
                searchInput,
                valueInput: targetSelect,
                isMultiSelect: false,
                excludeArchived: true,
                allowedProjectIds,
                includeNoProject: false,
                onSelect: async (projectId) => {
                    await populateGroupOptions(projectId);
                }
            });
            await popup.initialize();

            await populateGroupOptions('');

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
                } else if (groupSelect.value === '__new_by_project_name__') {
                    newGroupName = (project.title || project.name || '').trim();
                    if (!newGroupName) {
                        showMessage(i18n("projectNameEmpty") || '项目名称为空');
                        return;
                    }
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
                const maxSort = target.customGroups.reduce((max: number, g: any) => {
                    const s = typeof g.sort === 'number' ? g.sort : parseInt(g.sort, 10) || 0;
                    return Math.max(max, s);
                }, 0);
                target.customGroups.push({ id: newId, name: opts.newGroupName, sort: maxSort + 10 });
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
                    if (this.plugin.settings?.unassignedTasksProjectId === sourceId) {
                        this.plugin.settings.unassignedTasksProjectId = '';
                        await this.plugin.saveSettings(this.plugin.settings);
                        window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
                    }
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

            if (this.plugin.settings?.unassignedTasksProjectId === projectId) {
                this.plugin.settings.unassignedTasksProjectId = '';
                await this.plugin.saveSettings(this.plugin.settings);
                window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
            }

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
                if (this.plugin.settings?.unassignedTasksProjectId === blockId) {
                    this.plugin.settings.unassignedTasksProjectId = '';
                    await this.plugin.saveSettings(this.plugin.settings);
                    window.dispatchEvent(new CustomEvent('reminderSettingsUpdated'));
                }
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

    private showGlobalProjectStatusDialog() {
        const globalStatusDialog = new GlobalProjectStatusDialog(this.plugin, () => {
            // 全局项目状态更新后，刷新项目面板并通知相关视图
            this.loadProjects();
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        });
        globalStatusDialog.show().catch((error) => {
            console.error('打开全局项目状态设置失败:', error);
            showMessage(i18n('openModifyDialogFailed') || '打开配置对话框失败');
        });
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

    private collectFolderNodeProjects(node: ProjectFolderTreeNode): any[] {
        const projects = [...node.projects];
        node.children.forEach(child => {
            projects.push(...this.collectFolderNodeProjects(child));
        });
        return projects;
    }

    private openFolderKanban(node: ProjectFolderTreeNode) {
        const projects = this.collectFolderNodeProjects(node)
            .filter(project => project?.id);
        if (projects.length === 0) {
            showMessage(i18n("noProject") || "暂无项目");
            return;
        }

        const folder = node.folder;
        const title = `${folder.icon || '📂'} ${folder.name}`;
        try {
            this.plugin.openProjectKanbanTab(`folder:${folder.id}`, title, {
                folderId: folder.id,
                aggregateProjectIds: projects.map(project => project.id),
                aggregateTitle: title,
                hideMoreButton: true
            });
        } catch (error) {
            console.error('打开项目文件夹看板失败:', error);
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

            // 添加项目文件夹管理
            menu.addItem({
                icon: 'iconFolder',
                label: i18n("manageFolders") || "管理项目文件夹",
                click: () => {
                    this.showFolderManageDialog();
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

            // 添加项目状态全局设置
            menu.addItem({
                icon: 'iconSettings',
                label: i18n("globalKanbanStatuses"),
                click: () => {
                    this.showGlobalProjectStatusDialog();
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
            const initialTab = lastMode === 'habit' ? 'pomodoro' : lastMode;
            showStatsDialog(this.plugin, initialTab);
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
        toggleBtn.classList.add('ariaLabel'); toggleBtn.setAttribute('aria-label', this.groupCollapsedState[statusId] ? '展开该分组' : '折叠该分组');
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
                toggleBtn.classList.add('ariaLabel'); toggleBtn.setAttribute('aria-label', '展开该分组');
            } else {
                listContainer.style.display = 'flex';
                if (iconEl) iconEl.style.transform = 'rotate(0deg)';
                toggleBtn.classList.add('ariaLabel'); toggleBtn.setAttribute('aria-label', '折叠该分组');
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
            const savedStatusFilter = typeof settings.projectPanelStatusFilter === 'string' ? settings.projectPanelStatusFilter : 'all';
            const statusIds = new Set(this.statusManager.getStatuses().map((status: any) => status.id));
            this.currentTab = savedStatusFilter === 'all' || statusIds.has(savedStatusFilter) ? savedStatusFilter : 'all';
            const savedCriteria = this.normalizeSortCriteria(
                settings.projectPanelSortCriteria && Array.isArray(settings.projectPanelSortCriteria) && settings.projectPanelSortCriteria.length > 0
                    ? settings.projectPanelSortCriteria
                    : [{ method: settings.projectPanelSort || 'priority', order: settings.projectPanelSortOrder || 'desc' }]
            );
            this.currentSortCriteria = savedCriteria;
            this.syncLegacySortStateFromCriteria();
            this.showOnlyWithDoingTasks = settings.projectPanelShowOnlyDoing || false;
            this.selectedCategories = settings.projectPanelSelectedCategories || [];
            this.currentViewMode = settings.projectPanelViewMode || 'card';
        } catch (error) {
            console.error('恢复项目面板设置失败:', error);
        }
    }

    private async savePanelSettings() {
        try {
            const settings = await this.plugin.loadSettings();
            const activeCriteria = this.getActiveSortCriteria();
            const primary = activeCriteria[0] || { method: 'priority', order: 'desc' };
            settings.projectPanelSortCriteria = activeCriteria;
            settings.projectPanelSort = primary.method;
            settings.projectPanelSortOrder = primary.order;
            settings.projectPanelShowOnlyDoing = this.showOnlyWithDoingTasks;
            settings.projectPanelSelectedCategories = this.selectedCategories;
            settings.projectPanelStatusFilter = this.currentTab;
            settings.projectPanelViewMode = this.currentViewMode;
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

    private renderProjectsAsChecklist(projects: any[]) {
        this.projectsContainer.innerHTML = '';
        const folderManager = ProjectFolderManager.getInstance(this.plugin);
        const folders = folderManager.getFolders();
        const validFolderIds = new Set(folders.map(folder => folder.id));

        const folderProjectsMap: Record<string, any[]> = {};
        const rootProjects: any[] = [];

        projects.forEach(p => {
            const folderId = p.folderId || '';
            if (folderId && validFolderIds.has(folderId)) {
                if (!folderProjectsMap[folderId]) folderProjectsMap[folderId] = [];
                folderProjectsMap[folderId].push(p);
            } else {
                rootProjects.push(p);
            }
        });

        const folderTree = this.buildProjectFolderTree(folders, folderProjectsMap);

        folderTree.forEach(node => {
            if (this.currentSearchQuery && node.totalProjectCount === 0) {
                return;
            }
            const folderGroupEl = this.createFolderGroupElement(node, 0);
            this.projectsContainer.appendChild(folderGroupEl);
        });

        rootProjects.forEach(project => {
            const projectEl = this.createProjectElement(project);
            this.projectsContainer.appendChild(projectEl);
        });

        // 如果没有任何文件夹且没有任何项目，显示空提示
        if (folderTree.length === 0 && rootProjects.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'project-empty';
            emptyEl.textContent = i18n("noProjects") || '暂无项目';
            this.projectsContainer.appendChild(emptyEl);
        }
    }

    private buildProjectFolderTree(folders: ProjectFolder[], folderProjectsMap: Record<string, any[]>, parentId: string = ''): ProjectFolderTreeNode[] {
        return folders
            .filter(folder => (folder.parentId || '') === parentId)
            .sort((a, b) => {
                const sortDiff = (a.sort || 0) - (b.sort || 0);
                if (sortDiff !== 0) return sortDiff;
                return (a.name || '').localeCompare(b.name || '', getLocaleTag());
            })
            .map(folder => {
                const children = this.buildProjectFolderTree(folders, folderProjectsMap, folder.id);
                const folderProjects = folderProjectsMap[folder.id] || [];
                return {
                    folder,
                    projects: folderProjects,
                    children,
                    totalProjectCount: folderProjects.length + children.reduce((sum, child) => sum + child.totalProjectCount, 0)
                };
            });
    }

    private getProjectFolderDepth(folder: ProjectFolder, folders: ProjectFolder[]): number {
        let depth = 0;
        let parentId = folder.parentId || '';
        const folderMap = new Map(folders.map(item => [item.id, item]));
        const visited = new Set<string>();

        while (parentId && !visited.has(parentId)) {
            visited.add(parentId);
            const parent = folderMap.get(parentId);
            if (!parent) break;
            depth += 1;
            parentId = parent.parentId || '';
        }

        return depth;
    }

    private getDocumentTreeIndent(level: number): number {
        return 8 + Math.max(0, level) * 18;
    }

    private applyDocumentTreeGuides(element: HTMLElement, level: number) {
        if (level <= 0) {
            element.style.removeProperty('--project-tree-guides');
            element.style.removeProperty('--project-tree-guide-positions');
            element.style.removeProperty('--project-tree-guide-sizes');
            return;
        }

        const guideColor = 'color-mix(in srgb, var(--b3-theme-on-surface), transparent 84%)';
        const images = Array(level).fill(`linear-gradient(${guideColor}, ${guideColor})`).join(', ');
        const positions = Array.from({ length: level }, (_, index) => `${16 + index * 18}px 0`).join(', ');
        const sizes = Array(level).fill('1px 100%').join(', ');

        element.style.setProperty('--project-tree-guides', images);
        element.style.setProperty('--project-tree-guide-positions', positions);
        element.style.setProperty('--project-tree-guide-sizes', sizes);
    }

    private applyDocumentTreeRowIndent(element: HTMLElement, level: number) {
        this.applyDocumentTreeGuides(element, level);
        element.style.setProperty('padding-left', `${this.getDocumentTreeIndent(level)}px`, 'important');
    }

    private createFolderGroupElement(node: ProjectFolderTreeNode, depth: number): HTMLElement {
        const folder = node.folder;
        const folderProjects = node.projects;
        const hasChildren = node.children.length > 0 || folderProjects.length > 0;
        const groupEl = document.createElement('div');
        groupEl.className = 'project-folder-group project-folder-group--tree';
        if (folder.collapsed) {
            groupEl.classList.add('collapsed');
        }
        groupEl.dataset.folderId = folder.id;
        groupEl.style.setProperty('--folder-depth', String(depth));

        const headerEl = document.createElement('div');
        headerEl.className = 'project-folder-header';
        headerEl.style.cssText = `
            display: flex;
            align-items: center;
            padding: 4px 8px 4px ${this.getDocumentTreeIndent(depth)}px;
            cursor: default;
            border-radius: 4px;
            user-select: none;
            transition: background-color 0.2s ease;
            min-height: 30px;
        `;
        this.applyDocumentTreeGuides(headerEl, depth);
        headerEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showFolderContextMenu(e, folder, node);
        });

        const chevronEl = document.createElement('span');
        chevronEl.className = 'project-folder-chevron';
        chevronEl.style.cursor = 'pointer';
        if (!hasChildren) {
            chevronEl.classList.add('project-folder-chevron--empty');
        }
        chevronEl.innerHTML = folder.collapsed
            ? '<svg style="width:12px;height:12px;margin-right:6px;transform:rotate(-90deg);transition:transform 0.2s;"><use xlink:href="#iconDown"></use></svg>'
            : '<svg style="width:12px;height:12px;margin-right:6px;transition:transform 0.2s;"><use xlink:href="#iconDown"></use></svg>';

        const iconEl = document.createElement('span');
        iconEl.className = 'project-folder-icon';
        iconEl.textContent = folder.icon || '📂';
        iconEl.style.marginRight = '6px';

        const nameEl = document.createElement('span');
        nameEl.className = 'project-folder-name';
        nameEl.textContent = folder.name;
        nameEl.style.flex = '1';

        const countEl = document.createElement('span');
        countEl.className = 'project-folder-count';
        countEl.textContent = `(${node.totalProjectCount})`;
        countEl.style.cssText = 'font-size:12px;opacity:0.6;margin-right:8px;';

        const openKanbanBtn = document.createElement('button');
        openKanbanBtn.className = 'b3-button b3-button--text project-folder-open-kanban-btn';
        openKanbanBtn.innerHTML = '<svg style="width:14px;height:14px;"><use xlink:href="#iconOpenWindow"></use></svg>';
        openKanbanBtn.style.padding = '2px 4px';
        openKanbanBtn.classList.add('ariaLabel');
        openKanbanBtn.setAttribute('aria-label', i18n("openFolderKanban") || "打开看板");
        openKanbanBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openFolderKanban(node);
        });

        const moreBtn = document.createElement('button');
        moreBtn.className = 'b3-button b3-button--text project-folder-more-btn';
        moreBtn.innerHTML = '<svg style="width:14px;height:14px;"><use xlink:href="#iconMore"></use></svg>';
        moreBtn.style.padding = '2px 4px';
        moreBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showFolderContextMenu(e, folder, node);
        });

        headerEl.appendChild(chevronEl);
        headerEl.appendChild(iconEl);
        headerEl.appendChild(nameEl);
        headerEl.appendChild(countEl);
        headerEl.appendChild(openKanbanBtn);
        headerEl.appendChild(moreBtn);

        const childrenEl = document.createElement('div');
        childrenEl.className = 'project-folder-children';
        childrenEl.style.cssText = `
            display: ${folder.collapsed ? 'none' : 'flex'};
            flex-direction: column;
            gap: 0;
        `;

        node.children.forEach(childNode => {
            const childEl = this.createFolderGroupElement(childNode, depth + 1);
            childrenEl.appendChild(childEl);
        });

        folderProjects.forEach(project => {
            const projectEl = this.createProjectElement(project);
            this.applyDocumentTreeRowIndent(projectEl, depth + 1);
            childrenEl.appendChild(projectEl);
        });

        const toggleFolderCollapsed = async () => {
            if (!hasChildren) return;
            const isCollapsed = !folder.collapsed;
            folder.collapsed = isCollapsed;
            const folderManager = ProjectFolderManager.getInstance(this.plugin);
            await folderManager.updateFolder(folder.id, { collapsed: isCollapsed });

            if (isCollapsed) {
                groupEl.classList.add('collapsed');
                chevronEl.querySelector('svg').style.transform = 'rotate(-90deg)';
                childrenEl.style.display = 'none';
            } else {
                groupEl.classList.remove('collapsed');
                chevronEl.querySelector('svg').style.transform = 'rotate(0deg)';
                childrenEl.style.display = 'flex';
            }
        };

        chevronEl.addEventListener('click', async (e) => {
            e.stopPropagation();
            await toggleFolderCollapsed();
        });

        headerEl.addEventListener('click', async (e) => {
            if ((e.target as HTMLElement).closest('.project-folder-more-btn')) return;
            e.preventDefault();
            e.stopPropagation();
            await toggleFolderCollapsed();
        });

        groupEl.appendChild(headerEl);
        groupEl.appendChild(childrenEl);

        this.bindFolderDragEvents(groupEl, headerEl, folder);

        return groupEl;
    }

    private bindFolderDragEvents(groupEl: HTMLElement, headerEl: HTMLElement, folder: any) {
        if (!this.plugin?.isInMobileApp) {
            headerEl.draggable = true;
            headerEl.style.cursor = 'grab';

            headerEl.addEventListener('dragstart', (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.project-folder-more-btn') || target.closest('.project-folder-chevron')) {
                    e.preventDefault();
                    return;
                }

                this.isDraggingFolder = true;
                this.draggedFolderElement = headerEl;
                this.draggedFolder = folder;
                headerEl.style.opacity = '0.5';
                headerEl.style.cursor = 'grabbing';

                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', folder.id);
                }
            });

            headerEl.addEventListener('dragend', () => {
                this.isDraggingFolder = false;
                this.draggedFolderElement = null;
                this.draggedFolder = null;
                headerEl.style.opacity = '';
                headerEl.style.cursor = 'grab';
                this.hideDropIndicator();
                this.clearFolderDropState();
            });

            headerEl.addEventListener('dragover', (e) => {
                if (this.isDraggingFolder && this.draggedFolderElement !== headerEl && this.draggedFolder) {
                    const mode = this.getFolderDropMode(headerEl, e);
                    const targetParentId = mode === 'inside' ? folder.id : (folder.parentId || '');
                    if (targetParentId === this.draggedFolder.id || (targetParentId && ProjectFolderManager.getInstance(this.plugin).isFolderDescendant(targetParentId, this.draggedFolder.id))) {
                        return;
                    }

                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    this.showFolderDropState(headerEl, mode);
                }
            });

            headerEl.addEventListener('dragleave', (e) => {
                if (this.isDraggingFolder) {
                    const rect = headerEl.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                        this.clearFolderDropState();
                    }
                }
            });

            headerEl.addEventListener('drop', async (e) => {
                if (this.isDraggingFolder && this.draggedFolderElement !== headerEl && this.draggedFolder) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.hideDropIndicator();
                    const mode = this.getFolderDropMode(headerEl, e);
                    this.clearFolderDropState();
                    await this.handleFolderDrop(this.draggedFolder, folder, mode);
                }
            });
        }

        const handleDragOver = (e: DragEvent) => {
            if (this.isDragging && this.draggedProject) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                headerEl.classList.add('drag-over');
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            e.stopPropagation();
            headerEl.classList.remove('drag-over');
        };

        const handleDrop = async (e: DragEvent) => {
            if (this.isDragging && this.draggedProject) {
                e.preventDefault();
                e.stopPropagation();
                headerEl.classList.remove('drag-over');
                await this.moveProjectToFolder(this.draggedProject.id, folder.id);
            }
        };

        headerEl.addEventListener('dragover', handleDragOver);
        headerEl.addEventListener('dragleave', handleDragLeave);
        headerEl.addEventListener('drop', handleDrop);

        const childrenEl = groupEl.querySelector('.project-folder-children') as HTMLElement;
        if (childrenEl) {
            childrenEl.addEventListener('dragover', handleDragOver);
            childrenEl.addEventListener('dragleave', handleDragLeave);
            childrenEl.addEventListener('drop', handleDrop);
        }
    }

    private getFolderDropMode(element: HTMLElement, event: DragEvent): FolderDropMode {
        const rect = element.getBoundingClientRect();
        const y = event.clientY - rect.top;
        if (y < rect.height * 0.25) return 'before';
        if (y > rect.height * 0.75) return 'after';
        return 'inside';
    }

    private showFolderDropState(element: HTMLElement, mode: FolderDropMode) {
        this.clearFolderDropState();
        element.classList.add(mode === 'before' ? 'drag-over-top' : mode === 'after' ? 'drag-over-bottom' : 'drag-over-inside');
    }

    private clearFolderDropState() {
        this.projectsContainer?.querySelectorAll('.project-folder-header.drag-over-top, .project-folder-header.drag-over-bottom, .project-folder-header.drag-over-inside').forEach(item => {
            item.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
        });
    }

    private async moveProjectToFolder(projectId: string, folderId: string) {
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData[projectId]) {
                if (projectData[projectId].folderId === folderId) return;

                projectData[projectId].folderId = folderId;
                projectData[projectId].updatedTime = new Date().toISOString();
                await this.plugin.saveProjectData(projectData);

                window.dispatchEvent(new CustomEvent('projectUpdated', {
                    detail: { projectId, project: projectData[projectId] }
                }));
                showMessage(i18n("reminderSaved") || "项目保存成功");
            }
        } catch (error) {
            console.error('移动项目到文件夹失败:', error);
            showMessage(i18n("saveReminderFailed") || "保存项目失败");
        }
    }

    private async handleFolderDrop(draggedFolder: any, targetFolder: any, mode: FolderDropMode) {
        try {
            if (mode === 'inside') {
                const folderManager = ProjectFolderManager.getInstance(this.plugin);
                await folderManager.moveFolder(draggedFolder.id, targetFolder.id);
            } else {
                await this.reorderFolders(draggedFolder, targetFolder, mode === 'before');
            }

            showMessage(i18n("reminderSaved") || "排序已更新");
            this.loadProjects(); // 重新加载以应用新排序并渲染
        } catch (error) {
            console.error('处理文件夹拖放失败:', error);
            showMessage(i18n("saveReminderFailed") || "排序更新失败");
        }
    }

    private async reorderFolders(draggedFolder: any, targetFolder: any, insertBefore: boolean) {
        try {
            const folderManager = ProjectFolderManager.getInstance(this.plugin);
            await folderManager.moveFolder(draggedFolder.id, targetFolder.parentId || '', targetFolder.id, insertBefore);
        } catch (error) {
            console.error('重新排序文件夹失败:', error);
            throw error;
        }
    }

    private createProjectListElement(project: any): HTMLElement {
        const today = getLogicalDateString();
        const isOverdue = project.endDate && compareDateStrings(project.endDate, today) < 0;
        const priority = project.priority || 'none';
        const status = project.status || 'active';

        const projectEl = document.createElement('div');
        projectEl.className = `project-item project-item--list ${isOverdue ? 'project-item--overdue' : ''} project-item--${status}`;

        projectEl.dataset.projectId = project.id;
        projectEl.dataset.priority = priority;

        const itemMoreBtn = document.createElement('button');
        itemMoreBtn.type = 'button';
        itemMoreBtn.className = 'b3-button b3-button--text project-item__more-button';
        itemMoreBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconMore"></use></svg>';
        const shouldAlwaysShowMoreButton = !!this.plugin?.isInMobileApp;
        itemMoreBtn.style.cssText = `
            position: absolute;
            top: 4px;
            right: 4px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 24px;
            height: 24px;
            padding: 0;
            border-radius: 4px;
            opacity: ${shouldAlwaysShowMoreButton ? '1' : '0'};
            pointer-events: ${shouldAlwaysShowMoreButton ? 'auto' : 'none'};
            transition: opacity 0.2s ease;
            z-index: 10;
        `;
        itemMoreBtn.classList.add('ariaLabel');
        itemMoreBtn.setAttribute('aria-label', i18n("more") || "更多");
        itemMoreBtn.draggable = false;

        const setMoreButtonVisible = (visible: boolean) => {
            if (shouldAlwaysShowMoreButton) return;
            itemMoreBtn.style.opacity = visible ? '1' : '0';
            itemMoreBtn.style.pointerEvents = visible ? 'auto' : 'none';
        };

        if (!shouldAlwaysShowMoreButton) {
            projectEl.addEventListener('mouseenter', () => setMoreButtonVisible(true));
            projectEl.addEventListener('mouseleave', () => setMoreButtonVisible(false));
            itemMoreBtn.addEventListener('focus', () => setMoreButtonVisible(true));
            itemMoreBtn.addEventListener('blur', () => setMoreButtonVisible(false));
        }

        itemMoreBtn.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
        });
        itemMoreBtn.addEventListener('dragstart', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        itemMoreBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const rect = itemMoreBtn.getBoundingClientRect();
            this.showProjectContextMenu({
                clientX: rect.right,
                clientY: rect.bottom + 4
            }, project);
        });
        projectEl.appendChild(itemMoreBtn);

        if (!this.isDragDisabledBySortMode()) {
            this.addDragFunctionality(projectEl, project);
        }
        // 支持接收来自项目看板的任务拖入（修改任务所属项目）
        this.addTaskDropTarget(projectEl, project);

        projectEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showProjectContextMenu(e, project);
        });

        projectEl.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.project-item__more-button')) return;
            e.preventDefault();
            e.stopPropagation();
            this.openProjectKanban(project);
        });

        const contentEl = document.createElement('div');
        contentEl.className = 'project-item__content';

        const infoEl = document.createElement('div');
        infoEl.className = 'project-item__info';
        infoEl.style.cssText = `
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 4px !important;
            width: 100%;
        `;

        const parsed = this.parseTitle(project.title);
        const displayTitle = parsed.text || i18n("unnamedNote") || '未命名项目';

        const dotEl = document.createElement('span');
        dotEl.className = 'project-item__color-dot';
        dotEl.style.cssText = `
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: ${project.color || '#cccccc'};
            flex-shrink: 0;
            display: inline-block;
        `;

        const textEl = document.createElement('span');
        textEl.textContent = displayTitle;

        const titleEl = document.createElement('span');
        titleEl.className = 'project-item__title';
        titleEl.appendChild(dotEl);

        if (parsed.emoji) {
            const emojiEl = document.createElement('span');
            emojiEl.className = 'project-item__emoji-icon';
            emojiEl.textContent = parsed.emoji;
            emojiEl.style.cssText = `
                font-size: 14px;
                flex-shrink: 0;
                display: inline-block;
            `;
            titleEl.appendChild(emojiEl);
        }

        titleEl.appendChild(textEl);

        if (project.blockId) {
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${project.blockId}`);
            titleEl.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                cursor: pointer;
                color: var(--b3-protyle-inline-blockref-color);
                font-weight: 500;
                text-decoration: none;
            `;
            textEl.style.textDecoration = 'underline';
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openProject(project.blockId);
            });
        } else {
            titleEl.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 6px;
                font-weight: 500;
            `;
        }

        infoEl.appendChild(titleEl);

        // 创建元数据容器，展示日期、优先级、分类和状态
        const metaEl = document.createElement('div');
        metaEl.className = 'project-item__meta';
        metaEl.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 2px;
            width: 100%;
        `;

        // 1. 起始和截止日期
        let dateText = '';
        if (project.startDate && project.endDate) {
            dateText = `🗓${project.startDate}-${project.endDate}`;
        } else if (project.startDate) {
            dateText = `🗓${project.startDate}`;
        } else if (project.endDate) {
            dateText = `🗓截止:${project.endDate}`;
        }

        if (dateText) {
            const dateEl = document.createElement('span');
            dateEl.className = 'project-list-meta-date';
            dateEl.textContent = dateText;
            dateEl.style.cssText = `
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                white-space: nowrap;
                font-size: 11px;
                display: inline-flex;
                align-items: center;
            `;
            metaEl.appendChild(dateEl);
        }

        // 2. 优先级 (卡片一样的徽章)
        if (priority !== 'none') {
            const priorityNames = {
                'high': i18n("highPriority") || '高',
                'medium': i18n("mediumPriority") || '中',
                'low': i18n("lowPriority") || '低'
            };
            const priorityBadge = document.createElement('span');
            priorityBadge.className = `project-priority-label ${priority}`;
            priorityBadge.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                margin-left: 0;
            `;
            priorityBadge.innerHTML = `<div class="priority-dot ${priority}"></div>${priorityNames[priority]}`;
            metaEl.appendChild(priorityBadge);
        }

        // 3. 分类
        if (project.categoryId) {
            const categoryIds = project.categoryId.split(',').filter((id: string) => id.trim());
            categoryIds.forEach((id: string) => {
                const category = this.categoryManager.getCategoryById(id);
                if (category) {
                    const categoryEl = document.createElement('span');
                    categoryEl.className = 'project-category-tag';
                    categoryEl.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 2px;
                        padding: 1px 4px;
                        background-color: ${category.color};
                        border: 1px solid ${category.color}40;
                        border-radius: 3px;
                        font-size: 10px;
                        color: #fff;
                        white-space: nowrap;
                    `;
                    if (category.icon) {
                        const iconSpan = document.createElement('span');
                        iconSpan.textContent = category.icon;
                        iconSpan.style.cssText = `font-size: 10px; line-height: 1;`;
                        categoryEl.appendChild(iconSpan);
                    }
                    const nameSpan = document.createElement('span');
                    nameSpan.textContent = category.name;
                    nameSpan.style.cssText = `font-size: 10px; font-weight: 500;`;
                    categoryEl.appendChild(nameSpan);
                    metaEl.appendChild(categoryEl);
                }
            });
        }

        // 4. 项目状态
        const statusInfo = this.statusManager.getStatusById(status);
        if (statusInfo) {
            const statusEl = document.createElement('span');
            statusEl.className = `project-status-tag project-status-${status}`;

            let bg = 'rgba(128, 128, 128, 0.1)';
            let border = 'rgba(128, 128, 128, 0.2)';
            let color = 'var(--b3-theme-on-surface)';
            if (status === 'active') {
                bg = 'color-mix(in srgb, var(--b3-theme-primary), transparent 90%)';
                border = 'color-mix(in srgb, var(--b3-theme-primary), transparent 70%)';
                color = 'var(--b3-theme-primary)';
            } else if (status === 'someday') {
                bg = 'color-mix(in srgb, var(--b3-theme-warning), transparent 90%)';
                border = 'color-mix(in srgb, var(--b3-theme-warning), transparent 70%)';
                color = 'var(--b3-theme-warning)';
            } else if (status === 'archived') {
                bg = 'var(--b3-theme-surface-lighter)';
                border = 'var(--b3-border-color)';
                color = 'var(--b3-theme-on-surface)';
            } else {
                bg = 'color-mix(in srgb, var(--b3-theme-info), transparent 90%)';
                border = 'color-mix(in srgb, var(--b3-theme-info), transparent 70%)';
                color = 'var(--b3-theme-info)';
            }

            statusEl.style.cssText = `
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                background-color: ${bg};
                border: 1px solid ${border};
                border-radius: 3px;
                font-size: 10px;
                color: ${color};
                white-space: nowrap;
            `;
            if (statusInfo.icon) {
                const iconSpan = document.createElement('span');
                iconSpan.textContent = statusInfo.icon;
                iconSpan.style.cssText = `font-size: 10px; line-height: 1;`;
                statusEl.appendChild(iconSpan);
            }
            const nameSpan = document.createElement('span');
            nameSpan.textContent = statusInfo.name;
            nameSpan.style.cssText = `font-size: 10px; font-weight: 500;`;
            statusEl.appendChild(nameSpan);
            metaEl.appendChild(statusEl);
        }

        infoEl.appendChild(metaEl);
        contentEl.appendChild(infoEl);
        projectEl.appendChild(contentEl);

        return projectEl;
    }

    private showFolderContextMenu(event: MouseEvent | { clientX: number, clientY: number }, folder: any, node?: ProjectFolderTreeNode) {
        const menu = new Menu("folderContextMenu");

        if (node && node.totalProjectCount > 0) {
            menu.addItem({
                icon: "iconProject",
                label: i18n("openFolderKanban") || "打开看板",
                click: () => this.openFolderKanban(node)
            });
            menu.addItem({
                iconHTML: "📊",
                label: i18n("viewStatsMenuItem") || "查看统计",
                click: () => showFolderStatsDialog(this.plugin, folder, node, this.reminderDataCache)
            });
            menu.addSeparator();
        }

        menu.addItem({
            icon: "iconAdd",
            label: i18n("createProject") || "新建项目",
            click: () => this.createProjectInFolder(folder)
        });

        menu.addItem({
            icon: "iconFolder",
            label: "新建子文件夹",
            click: () => this.showQuickAddFolderDialog(folder.id)
        });

        menu.addItem({
            icon: "iconEdit",
            label: i18n("editFolder") || "修改文件夹",
            click: () => this.showEditFolderDialog(folder)
        });

        menu.addSeparator();

        menu.addItem({
            icon: "iconTrashcan",
            label: i18n("deleteFolder") || "删除文件夹",
            click: () => this.showDeleteFolderDialog(folder)
        });

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private createProjectInFolder(folder: any) {
        const dialog = new ProjectDialog(undefined, this.plugin, folder.id);
        dialog.show();
    }

    private showEditFolderDialog(folder: any) {
        const editDialog = new Dialog({
            title: i18n("editFolder") || "修改文件夹",
            content: `
                <div class="folder-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderName") || "文件夹名称"}</label>
                            <input type="text" id="folderNameInput" class="b3-text-field" value="${this.escapeHTML(folder.name || '')}" placeholder="${i18n("pleaseEnterFolderName") || "请输入文件夹名称"}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">上级文件夹</label>
                            <select id="folderParentSelect" class="b3-select" style="width: 100%;">
                                ${this.createFolderParentOptions(folder, folder.parentId || '')}
                            </select>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderIcon") || "文件夹图标"}</label>
                            <div id="folderIconDisplay" class="folder-icon-display">${folder.icon || '📂'}</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n("cancel") || "取消"}</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">${i18n("save") || "保存"}</button>
                    </div>
                    <style>
                        .folder-edit-dialog {
                            display: flex;
                            flex-direction: column;
                        }
                        .folder-icon-display {
                            width: 40px;
                            height: 40px;
                            border-radius: 50%;
                            background: var(--b3-theme-surface-lighter);
                            border: 2px solid var(--b3-theme-primary-lighter);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 20px;
                            cursor: pointer;
                            transition: all 0.2s;
                            user-select: none;
                        }
                        .folder-icon-display:hover {
                            transform: scale(1.1);
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                        }
                    </style>
                </div>
            `,
            width: "400px"
        });

        const nameInput = editDialog.element.querySelector('#folderNameInput') as HTMLInputElement;
        nameInput.focus();

        const parentSelect = editDialog.element.querySelector('#folderParentSelect') as HTMLSelectElement;
        const iconDisplay = editDialog.element.querySelector('#folderIconDisplay') as HTMLElement;
        const cancelBtn = editDialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = editDialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;

        iconDisplay?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openBuiltInEmojiPicker(iconDisplay);
        });

        cancelBtn?.addEventListener('click', () => editDialog.destroy());

        confirmBtn?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const icon = iconDisplay.textContent || '📂';
            const parentId = parentSelect?.value || '';
            if (!name) {
                showMessage(i18n("folderNameEmpty") || "文件夹名称不能为空");
                return;
            }

            try {
                const folderManager = ProjectFolderManager.getInstance(this.plugin);
                await folderManager.updateFolder(folder.id, { name, icon, parentId });
                showMessage(i18n("folderUpdated") || "文件夹已更新");
                editDialog.destroy();
                window.dispatchEvent(new CustomEvent('projectUpdated'));
            } catch (error) {
                console.error('保存文件夹失败:', error);
                showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
            }
        });
    }

    private createFolderParentOptions(currentFolder?: ProjectFolder, selectedParentId: string = ''): string {
        const folderManager = ProjectFolderManager.getInstance(this.plugin);
        const folders = folderManager.getFolders();
        const disabledIds = new Set<string>();

        if (currentFolder) {
            disabledIds.add(currentFolder.id);
            folders.forEach(folder => {
                if (folderManager.isFolderDescendant(folder.id, currentFolder.id)) {
                    disabledIds.add(folder.id);
                }
            });
        }

        const options = [
            `<option value="" ${selectedParentId === '' ? 'selected' : ''}>无上级文件夹</option>`
        ];

        folders
            .filter(folder => !disabledIds.has(folder.id))
            .forEach(folder => {
                const depth = this.getProjectFolderDepth(folder, folders);
                const prefix = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '└ ' : '');
                options.push(`<option value="${folder.id}" ${selectedParentId === folder.id ? 'selected' : ''}>${prefix}${folder.icon || '📂'} ${this.escapeHTML(folder.name)}</option>`);
            });

        return options.join('');
    }

    private async showDeleteFolderDialog(folder: any) {
        await confirm(
            i18n("deleteFolder") || "删除文件夹",
            (i18n("confirmDeleteFolder") || `确认删除文件夹 "${folder.name}" 吗？直接归属该文件夹的项目将被移出文件夹，子文件夹会提升到上一级。`).replace('${name}', folder.name),
            async () => {
                try {
                    const folderManager = ProjectFolderManager.getInstance(this.plugin);
                    await folderManager.deleteFolder(folder.id);
                    showMessage(i18n("folderDeleted") || "文件夹已删除");
                    window.dispatchEvent(new CustomEvent('projectUpdated'));
                } catch (error) {
                    console.error('删除文件夹失败', error);
                    showMessage(i18n("deleteFolderFailed") || "删除文件夹失败");
                }
            }
        );
    }

    private showQuickAddFolderDialog(parentId: string = '') {
        const editDialog = new Dialog({
            title: parentId ? "新建子文件夹" : (i18n("addFolder") || "新建文件夹"),
            content: `
                <div class="folder-edit-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderName") || "文件夹名称"}</label>
                            <input type="text" id="folderNameInput" class="b3-text-field" placeholder="${i18n("pleaseEnterFolderName") || "请输入文件夹名称"}">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">上级文件夹</label>
                            <select id="folderParentSelect" class="b3-select" style="width: 100%;">
                                ${this.createFolderParentOptions(undefined, parentId)}
                            </select>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("folderIcon") || "文件夹图标"}</label>
                            <div id="folderIconDisplay" class="folder-icon-display">📂</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="editCancelBtn">${i18n("cancel") || "取消"}</button>
                        <button class="b3-button b3-button--primary" id="editConfirmBtn">${i18n("save") || "保存"}</button>
                    </div>
                    <style>
                        .folder-edit-dialog {
                            display: flex;
                            flex-direction: column;
                        }
                        .folder-icon-display {
                            width: 40px;
                            height: 40px;
                            border-radius: 50%;
                            background: var(--b3-theme-surface-lighter);
                            border: 2px solid var(--b3-theme-primary-lighter);
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            font-size: 20px;
                            cursor: pointer;
                            transition: all 0.2s;
                            user-select: none;
                        }
                        .folder-icon-display:hover {
                            transform: scale(1.1);
                            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                        }
                    </style>
                </div>
            `,
            width: "400px"
        });

        const nameInput = editDialog.element.querySelector('#folderNameInput') as HTMLInputElement;
        nameInput.focus();

        const parentSelect = editDialog.element.querySelector('#folderParentSelect') as HTMLSelectElement;
        const iconDisplay = editDialog.element.querySelector('#folderIconDisplay') as HTMLElement;
        const cancelBtn = editDialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const confirmBtn = editDialog.element.querySelector('#editConfirmBtn') as HTMLButtonElement;

        iconDisplay?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openBuiltInEmojiPicker(iconDisplay);
        });

        cancelBtn?.addEventListener('click', () => editDialog.destroy());

        confirmBtn?.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const icon = iconDisplay.textContent || '📂';
            const selectedParentId = parentSelect?.value || '';
            if (!name) {
                showMessage(i18n("folderNameEmpty") || "文件夹名称不能为空");
                return;
            }

            try {
                const folderManager = ProjectFolderManager.getInstance(this.plugin);
                await folderManager.addFolder(name, icon, selectedParentId);
                showMessage(i18n("folderAdded") || "文件夹已创建");
                editDialog.destroy();
                window.dispatchEvent(new CustomEvent('projectUpdated'));
            } catch (error) {
                console.error('保存文件夹失败:', error);
                showMessage(i18n("saveFolderFailed") || "保存文件夹失败");
            }
        });
    }

    private showFolderManageDialog() {
        const dialog = new ProjectFolderManageDialog(this.plugin, () => {
            window.dispatchEvent(new CustomEvent('projectUpdated'));
        });
        dialog.show();
    }

    private openBuiltInEmojiPicker(target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        openEmoji({
            hideDynamicIcon: true,
            hideCustomIcon: true,
            position: {
                x: rect.left,
                y: rect.bottom
            },
            selectedCB: (emojiCode: string) => {
                if (!emojiCode) {
                    target.textContent = "";
                    return;
                }
                const codePoints = emojiCode.split(/[-\s]+/).map(cp => parseInt(cp, 16));
                target.textContent = String.fromCodePoint(...codePoints);
            }
        });
    }

    private escapeHTML(value: string): string {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private parseTitle(title: string): { emoji: string; text: string } {
        if (!title) return { emoji: '', text: '' };
        const emojiRegex = /^([\u{1F1E6}-\u{1F1FF}]{2}|(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}]|\u200D\p{Extended_Pictographic})*)/u;
        const match = title.match(emojiRegex);
        if (match) {
            const emoji = match[0];
            let text = title.slice(emoji.length);
            if (text.startsWith(' ')) {
                text = text.slice(1);
            }
            return { emoji, text };
        }
        return { emoji: '', text: title };
    }

    /**
     * 为项目卡片/列表项添加「接收任务拖入」功能。
     * 当用户从项目看板把任务拖到此项目元素上时，将任务的 projectId 改为该项目。
     */
    private addTaskDropTarget(projectEl: HTMLElement, project: any) {
        const TASK_MOVE_TYPE = 'application/vnd.siyuan.kanban-task-move';

        const isTaskDrag = (e: DragEvent) =>
            e.dataTransfer?.types.includes(TASK_MOVE_TYPE) ?? false;

        projectEl.addEventListener('dragover', (e: DragEvent) => {
            // 仅当拖入的是来自看板的任务时才处理（排除项目自身拖拽）
            if (!isTaskDrag(e) || this.isDragging) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            projectEl.classList.add('project-item--task-drop-active');
        });

        projectEl.addEventListener('dragleave', (e: DragEvent) => {
            if (!isTaskDrag(e)) return;
            // 只有真正离开元素时才移除高亮（子元素触发的 dragleave 忽略）
            if (!projectEl.contains(e.relatedTarget as Node)) {
                projectEl.classList.remove('project-item--task-drop-active');
            }
        });

        projectEl.addEventListener('drop', async (e: DragEvent) => {
            if (!isTaskDrag(e) || this.isDragging) return;
            e.preventDefault();
            e.stopPropagation();
            projectEl.classList.remove('project-item--task-drop-active');

            const raw = e.dataTransfer?.getData(TASK_MOVE_TYPE);
            if (!raw) return;

            let taskIds: string[] = [];
            try {
                taskIds = JSON.parse(raw);
            } catch {
                return;
            }
            if (!taskIds.length) return;

            await this.dropTasksOnProject(taskIds, project);
        });
    }

    /**
     * 将给定的任务 ID 列表的所属项目改为 targetProject，并保存。
     */
    private async dropTasksOnProject(taskIds: string[], targetProject: any) {
        if (!taskIds.length || !targetProject?.id) return;

        try {
            const reminderData = await getAllReminders(this.plugin, undefined, false);
            if (!reminderData) {
                showMessage(i18n('operationFailed') || '操作失败');
                return;
            }

            let updatedCount = 0;
            for (const taskId of taskIds) {
                const task = reminderData[taskId];
                if (!task) continue;
                if (task.projectId === targetProject.id) continue;
                task.projectId = targetProject.id;
                // 跨项目时清除分组（分组 ID 在新项目中无意义）
                if (task.customGroupId !== undefined) {
                    delete task.customGroupId;
                }
                updatedCount++;
            }

            if (updatedCount === 0) {
                showMessage(i18n('taskAlreadyInProject') || '任务已在该项目中');
                return;
            }

            await saveReminders(this.plugin, reminderData);

            // 通知看板和面板刷新
            window.dispatchEvent(new CustomEvent('reminderUpdated', {
                detail: { source: 'projectPanel' }
            }));

            const projectTitle = targetProject.title || targetProject.name || targetProject.id;
            showMessage(
                (i18n('taskMovedToProject') || '已将 ${count} 个任务移至「${project}」')
                    .replace('${count}', String(updatedCount))
                    .replace('${project}', projectTitle)
            );
        } catch (error) {
            console.error('拖拽任务改项目失败:', error);
            showMessage(i18n('operationFailed') || '操作失败');
        }
    }
}
