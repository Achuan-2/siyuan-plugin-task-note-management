import { ProjectManager, Project } from "../utils/projectManager";
import { ProjectFolderManager } from "../utils/projectFolderManager";
import { i18n } from "../pluginInstance";

export interface ProjectSelectorPopupOptions {
    plugin: any;
    container: HTMLElement;
    
    // Inputs (only for dropdown mode)
    searchInput?: HTMLInputElement;
    valueInput?: HTMLInputElement;
    
    // Select options
    isMultiSelect?: boolean;
    selectedId?: string; // single select
    selectedIds?: Set<string>; // multi select
    excludeArchived?: boolean; // defaults to true
    allowedProjectIds?: string[];
    includeNoProject?: boolean; // render "No Project" item
    
    // Callbacks
    onSelect?: (projectId: string, projectName: string) => void | Promise<void>;
    onChange?: (selectedIds: Set<string>) => void | Promise<void>;
}

interface FolderNode {
    id: string;
    name: string;
    icon: string;
    parentId: string;
    depth: number;
    projects: Project[];
    children: FolderNode[];
    totalProjectCount: number;
}

export class ProjectSelectorPopup {
    private plugin: any;
    private container: HTMLElement;
    private searchInput?: HTMLInputElement;
    private valueInput?: HTMLInputElement;
    
    private isMultiSelect: boolean;
    private selectedId: string;
    private selectedIds: Set<string>;
    private excludeArchived: boolean;
    private allowedProjectIds?: string[];
    private includeNoProject: boolean;
    
    private onSelect?: (projectId: string, projectName: string) => void | Promise<void>;
    private onChange?: (selectedIds: Set<string>) => void | Promise<void>;
    
    private projectManager: ProjectManager;
    private folderManager: ProjectFolderManager;
    
    private currentTab: 'status' | 'folder';
    private searchQuery: string = '';
    private collapsedFolders: Set<string> = new Set();
    
    private tabsContainer!: HTMLElement;
    private listContainer!: HTMLElement;
    private innerSearchInput?: HTMLInputElement;
    
    constructor(options: ProjectSelectorPopupOptions) {
        this.plugin = options.plugin;
        this.container = options.container;
        this.searchInput = options.searchInput;
        this.valueInput = options.valueInput;
        
        this.isMultiSelect = !!options.isMultiSelect;
        this.selectedId = options.selectedId || '';
        this.selectedIds = options.selectedIds ? new Set(options.selectedIds) : new Set();
        this.excludeArchived = options.excludeArchived !== false;
        this.allowedProjectIds = options.allowedProjectIds;
        this.includeNoProject = options.includeNoProject !== false;
        
        this.onSelect = options.onSelect;
        this.onChange = options.onChange;
        
        this.projectManager = ProjectManager.getInstance(this.plugin);
        this.folderManager = ProjectFolderManager.getInstance(this.plugin);
        
        const defaultView = this.plugin.settings?.defaultProjectSelectorViewMode || 'status';
        this.currentTab = defaultView;
    }
    
    public async initialize() {
        await this.projectManager.initialize();
        await this.folderManager.initialize();
        
        // Start with everything fully expanded by default, do not load initial collapsed states.
        this.collapsedFolders.clear();
        
        this.renderBaseStructure();
        this.renderList();
        this.bindEvents();
    }
    
    private renderBaseStructure() {
        this.container.innerHTML = '';
        
        if (!this.searchInput) {
            const searchWrap = document.createElement('div');
            searchWrap.style.padding = '4px 8px';
            searchWrap.style.boxSizing = 'border-box';
            
            const searchField = document.createElement('input');
            searchField.type = 'text';
            searchField.className = 'b3-text-field';
            searchField.placeholder = i18n('searchProject') || '搜索项目';
            searchField.style.width = '100%';
            searchField.style.boxSizing = 'border-box';
            searchField.autocomplete = 'off';
            searchField.spellcheck = false;
            
            searchWrap.appendChild(searchField);
            this.container.appendChild(searchWrap);
            this.innerSearchInput = searchField;
        }
        
        const tabsWrap = document.createElement('div');
        tabsWrap.className = 'project-selector-tabs';
        tabsWrap.style.cssText = 'display: flex; border-bottom: 1px solid var(--b3-border-color);';
        
        const statusTabBtn = document.createElement('button');
        statusTabBtn.className = `b3-button b3-button--text tab-btn ${this.currentTab === 'status' ? 'active' : ''}`;
        statusTabBtn.style.cssText = 'flex: 1; padding: 4px; font-size: 12px;';
        statusTabBtn.textContent = i18n('projectSelectorViewModeStatus') || '状态';
        statusTabBtn.dataset.tab = 'status';
        
        const folderTabBtn = document.createElement('button');
        folderTabBtn.className = `b3-button b3-button--text tab-btn ${this.currentTab === 'folder' ? 'active' : ''}`;
        folderTabBtn.style.cssText = 'flex: 1; padding: 4px; font-size: 12px;';
        folderTabBtn.textContent = i18n('projectSelectorViewModeFolder') || '文件夹';
        folderTabBtn.dataset.tab = 'folder';
        
        tabsWrap.appendChild(statusTabBtn);
        tabsWrap.appendChild(folderTabBtn);
        this.container.appendChild(tabsWrap);
        this.tabsContainer = tabsWrap;
        
        this.updateTabStyles();
        
        if (this.isMultiSelect) {
            const bulkWrap = document.createElement('div');
            bulkWrap.className = 'project-selector-bulk-actions';
            bulkWrap.style.cssText = 'padding: 4px 8px; border-bottom: 1px solid var(--b3-border-color); display: flex; gap: 8px;';
            
            const selectAllBtn = document.createElement('button');
            selectAllBtn.className = 'b3-button b3-button--text select-all-btn';
            selectAllBtn.style.cssText = 'flex: 1; padding: 4px; font-size: 12px; text-align: center;';
            selectAllBtn.textContent = i18n('selectAll') || '全选';
            
            const deselectAllBtn = document.createElement('button');
            deselectAllBtn.className = 'b3-button b3-button--text deselect-all-btn';
            deselectAllBtn.style.cssText = 'flex: 1; padding: 4px; font-size: 12px; text-align: center;';
            deselectAllBtn.textContent = i18n('deselectAll') || '取消全选';
            
            bulkWrap.appendChild(selectAllBtn);
            bulkWrap.appendChild(deselectAllBtn);
            this.container.appendChild(bulkWrap);
        }
        
        const listWrap = document.createElement('div');
        listWrap.className = 'project-selector-list';
        listWrap.style.cssText = 'max-height: 250px; overflow-y: auto; padding: 4px 0;';
        this.container.appendChild(listWrap);
        this.listContainer = listWrap;
    }
    
    private updateTabStyles() {
        const btns = this.tabsContainer.querySelectorAll('button');
        btns.forEach((btn: HTMLButtonElement) => {
            const isTabActive = btn.dataset.tab === this.currentTab;
            if (isTabActive) {
                btn.style.setProperty('color', 'var(--b3-theme-primary)', 'important');
                btn.style.setProperty('font-weight', 'bold', 'important');
                btn.style.setProperty('border-bottom', '2px solid var(--b3-theme-primary)', 'important');
                btn.style.setProperty('border-radius', '0', 'important');
            } else {
                btn.style.removeProperty('color');
                btn.style.removeProperty('font-weight');
                btn.style.removeProperty('border-bottom');
                btn.style.removeProperty('border-radius');
            }
        });
    }
    
    public renderList() {
        this.listContainer.innerHTML = '';
        
        const projects = this.projectManager.getProjects();
        const statuses = this.projectManager.getStatusManager().getStatuses();
        const allowedProjectIdSet = this.allowedProjectIds?.length ? new Set(this.allowedProjectIds) : null;
        
        const filteredProjects = projects.filter(project => {
            if (allowedProjectIdSet && !allowedProjectIdSet.has(project.id)) return false;
            if (this.excludeArchived) {
                const projectStatus = project.status || 'doing';
                const statusInfo = statuses.find(s => s.id === projectStatus);
                if (statusInfo?.isArchived) return false;
            }
            return true;
        });
        
        const terms = this.searchQuery.toLowerCase().split(/\s+/).filter(t => t);
        
        // Both status and folder view are tree lists now!
        this.listContainer.classList.add('project-document-tree');
        
        if (this.currentTab === 'status') {
            this.renderStatusView(filteredProjects, terms);
        } else {
            this.renderFolderView(filteredProjects, terms);
        }
    }
    
    private renderStatusView(projects: Project[], terms: string[]) {
        const statuses = this.projectManager.getStatusManager().getStatuses();
        const projectsByStatus: Record<string, Project[]> = {};
        
        statuses.forEach(s => {
            projectsByStatus[s.id] = [];
        });
        projectsByStatus['uncategorized'] = [];
        
        projects.forEach(p => {
            const statusId = p.status || 'doing';
            if (projectsByStatus[statusId]) {
                projectsByStatus[statusId].push(p);
            } else {
                projectsByStatus['uncategorized'].push(p);
            }
        });
        
        const matchesSearch = (p: Project) => {
            if (terms.length === 0) return true;
            const name = p.name.toLowerCase();
            return terms.every(t => name.includes(t));
        };
        
        if (this.includeNoProject && (terms.length === 0 || (i18n('noProject') || '无项目').toLowerCase().includes(terms[0]))) {
            const noProjId = this.isMultiSelect ? 'none' : '';
            const checked = this.isMultiSelect ? (this.selectedIds.has('all') || this.selectedIds.has(noProjId)) : (this.selectedId === noProjId);
            
            const noProjectEl = document.createElement('div');
            noProjectEl.className = 'project-item project-item--list';
            noProjectEl.dataset.value = noProjId;
            noProjectEl.dataset.label = i18n('noProject') || '无项目';
            noProjectEl.style.paddingLeft = `${this.getDocumentTreeIndent(0)}px`;
            noProjectEl.innerHTML = `
                <div class="project-item__content" style="padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; width: 100%; cursor: pointer;">
                    ${this.isMultiSelect ? `<input type="checkbox" class="project-selector-checkbox" style="margin-right: 8px;" ${checked ? 'checked' : ''}>` : ''}
                    <span class="project-item__title" style="flex: 1;">🚫 ${i18n('noProject') || '无项目'}</span>
                </div>
            `;
            this.listContainer.appendChild(noProjectEl);
        }
        
        statuses.forEach(status => {
            const groupProjects = projectsByStatus[status.id] || [];
            const matchingProjects = groupProjects.filter(matchesSearch);
            
            if (matchingProjects.length > 0) {
                this.sortProjects(matchingProjects);
                
                const collapseKey = `status-${status.id}`;
                if (terms.length > 0) {
                    this.collapsedFolders.delete(collapseKey);
                }
                
                const groupEl = this.createStatusGroupElement(status.id, status.name, status.icon || '📂', matchingProjects, 0);
                this.listContainer.appendChild(groupEl);
            }
        });
        
        const uncategorizedProjects = projectsByStatus['uncategorized'] || [];
        const matchingUncategorized = uncategorizedProjects.filter(matchesSearch);
        if (matchingUncategorized.length > 0) {
            this.sortProjects(matchingUncategorized);
            
            const collapseKey = `status-uncategorized`;
            if (terms.length > 0) {
                this.collapsedFolders.delete(collapseKey);
            }
            
            const groupEl = this.createStatusGroupElement('uncategorized', i18n('uncategorized') || '未分类', '📂', matchingUncategorized, 0);
            this.listContainer.appendChild(groupEl);
        }
    }
    
    private createStatusGroupElement(statusId: string, name: string, icon: string, statusProjects: Project[], depth: number): HTMLElement {
        const collapseKey = `status-${statusId}`;
        const isCollapsed = this.collapsedFolders.has(collapseKey);
        const hasChildren = statusProjects.length > 0;
        
        const groupEl = document.createElement('div');
        groupEl.className = 'project-folder-group project-folder-group--tree';
        if (isCollapsed) {
            groupEl.classList.add('collapsed');
        }
        groupEl.dataset.folderId = statusId;
        
        const headerEl = document.createElement('div');
        headerEl.className = 'project-folder-header';
        headerEl.style.cssText = `
            display: flex;
            align-items: center;
            padding: 4px 8px 4px ${this.getDocumentTreeIndent(depth)}px;
            cursor: pointer;
            border-radius: 4px;
            user-select: none;
            transition: background-color 0.2s ease;
            min-height: 30px;
        `;
        this.applyDocumentTreeGuides(headerEl, depth);
        
        const chevronEl = document.createElement('span');
        chevronEl.className = 'project-folder-chevron';
        chevronEl.style.cursor = 'pointer';
        if (!hasChildren) {
            chevronEl.classList.add('project-folder-chevron--empty');
        }
        chevronEl.innerHTML = isCollapsed
            ? '<svg style="width:12px;height:12px;margin-right:6px;transform:rotate(-90deg);transition:transform 0.2s;"><use xlink:href="#iconDown"></use></svg>'
            : '<svg style="width:12px;height:12px;margin-right:6px;transition:transform 0.2s;"><use xlink:href="#iconDown"></use></svg>';
            
        const iconEl = document.createElement('span');
        iconEl.className = 'project-folder-icon';
        iconEl.textContent = icon;
        iconEl.style.marginRight = '6px';
        
        const nameEl = document.createElement('span');
        nameEl.className = 'project-folder-name';
        nameEl.textContent = name;
        nameEl.style.flex = '1';
        
        const countEl = document.createElement('span');
        countEl.className = 'project-folder-count';
        countEl.textContent = `(${statusProjects.length})`;
        countEl.style.cssText = 'font-size:12px;opacity:0.6;margin-right:8px;';
        
        headerEl.appendChild(chevronEl);
        
        if (this.isMultiSelect && hasChildren) {
            const isAllChecked = statusProjects.every(p => this.selectedIds.has('all') || this.selectedIds.has(p.id));
            const statusCheckbox = document.createElement('input');
            statusCheckbox.type = 'checkbox';
            statusCheckbox.className = 'status-selector-checkbox';
            statusCheckbox.style.marginRight = '6px';
            statusCheckbox.checked = isAllChecked;
            statusCheckbox.addEventListener('click', (e) => {
                e.stopPropagation();
                const checked = statusCheckbox.checked;
                this.handleGroupCheckboxChange(statusProjects.map(p => p.id), checked);
            });
            headerEl.appendChild(statusCheckbox);
        }
        
        headerEl.appendChild(iconEl);
        headerEl.appendChild(nameEl);
        headerEl.appendChild(countEl);
        
        const childrenEl = document.createElement('div');
        childrenEl.className = 'project-folder-children';
        childrenEl.style.cssText = `
            display: ${isCollapsed ? 'none' : 'flex'};
            flex-direction: column;
            gap: 0;
        `;
        
        statusProjects.forEach(p => {
            const childEl = this.createProjectListElement(p, depth + 1);
            childrenEl.appendChild(childEl);
        });
        
        const toggleCollapsed = (e: MouseEvent) => {
            e.stopPropagation();
            if (!hasChildren) return;
            if (this.collapsedFolders.has(collapseKey)) {
                this.collapsedFolders.delete(collapseKey);
                groupEl.classList.remove('collapsed');
                chevronEl.querySelector('svg').style.transform = 'rotate(0deg)';
                childrenEl.style.display = 'flex';
            } else {
                this.collapsedFolders.add(collapseKey);
                groupEl.classList.add('collapsed');
                chevronEl.querySelector('svg').style.transform = 'rotate(-90deg)';
                childrenEl.style.display = 'none';
            }
        };
        
        headerEl.addEventListener('click', toggleCollapsed);
        
        groupEl.appendChild(headerEl);
        groupEl.appendChild(childrenEl);
        return groupEl;
    }
    
    private renderFolderView(projects: Project[], terms: string[]) {
        const folders = this.folderManager.getFolders();
        const validFolderIds = new Set(folders.map(f => f.id));
        
        const folderProjectsMap: Record<string, Project[]> = {};
        const rootProjects: Project[] = [];
        
        projects.forEach(p => {
            const folderId = p.folderId || '';
            if (folderId && validFolderIds.has(folderId)) {
                if (!folderProjectsMap[folderId]) folderProjectsMap[folderId] = [];
                folderProjectsMap[folderId].push(p);
            } else {
                rootProjects.push(p);
            }
        });
        
        const buildNodeTree = (parentId: string, depth: number): FolderNode[] => {
            return folders
                .filter(f => (f.parentId || '') === parentId)
                .sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name, 'zh-CN'))
                .map(f => {
                    const folderProjects = folderProjectsMap[f.id] || [];
                    this.sortProjects(folderProjects);
                    const children = buildNodeTree(f.id, depth + 1);
                    return {
                        id: f.id,
                        name: f.name,
                        icon: f.icon || '📂',
                        parentId: f.parentId || '',
                        depth,
                        projects: folderProjects,
                        children,
                        totalProjectCount: folderProjects.length + children.reduce((sum, child) => sum + child.totalProjectCount, 0)
                    };
                });
        };
        
        const folderTree = buildNodeTree('', 0);
        
        if (terms.length > 0) {
            const filterNode = (node: FolderNode): boolean => {
                const matchingProjects = node.projects.filter(p => {
                    const name = p.name.toLowerCase();
                    return terms.every(t => name.includes(t));
                });
                const matchingChildren = node.children.filter(child => filterNode(child));
                
                node.projects = matchingProjects;
                node.children = matchingChildren;
                node.totalProjectCount = matchingProjects.length + matchingChildren.reduce((sum, child) => sum + child.totalProjectCount, 0);
                
                const hasMatches = matchingProjects.length > 0 || matchingChildren.length > 0;
                if (hasMatches) {
                    this.collapsedFolders.delete(node.id);
                }
                return hasMatches;
            };
            
            const filteredTree = folderTree.filter(node => filterNode(node));
            
            const filteredRootProjects = rootProjects.filter(p => {
                const name = p.name.toLowerCase();
                return terms.every(t => name.includes(t));
            });
            
            filteredTree.forEach(node => {
                this.listContainer.appendChild(this.createFolderGroupElement(node, 0));
            });
            filteredRootProjects.forEach(p => {
                this.listContainer.appendChild(this.createProjectListElement(p, 0));
            });
        } else {
            if (this.includeNoProject) {
                const noProjId = this.isMultiSelect ? 'none' : '';
                const checked = this.isMultiSelect ? (this.selectedIds.has('all') || this.selectedIds.has(noProjId)) : (this.selectedId === noProjId);
                const noProjectEl = document.createElement('div');
                noProjectEl.className = 'project-item project-item--list';
                noProjectEl.dataset.value = noProjId;
                noProjectEl.dataset.label = i18n('noProject') || '无项目';
                noProjectEl.style.paddingLeft = `${this.getDocumentTreeIndent(0)}px`;
                noProjectEl.innerHTML = `
                    <div class="project-item__content" style="padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; width: 100%; cursor: pointer;">
                        ${this.isMultiSelect ? `<input type="checkbox" class="project-selector-checkbox" style="margin-right: 8px;" ${checked ? 'checked' : ''}>` : ''}
                        <span class="project-item__title" style="flex: 1;">🚫 ${i18n('noProject') || '无项目'}</span>
                    </div>
                `;
                this.listContainer.appendChild(noProjectEl);
            }
            
            folderTree.forEach(node => {
                this.listContainer.appendChild(this.createFolderGroupElement(node, 0));
            });
            rootProjects.forEach(p => {
                this.listContainer.appendChild(this.createProjectListElement(p, 0));
            });
        }
    }
    
    private createFolderGroupElement(node: FolderNode, depth: number): HTMLElement {
        const isCollapsed = this.collapsedFolders.has(node.id);
        const hasChildren = node.children.length > 0 || node.projects.length > 0;
        
        const groupEl = document.createElement('div');
        groupEl.className = 'project-folder-group project-folder-group--tree';
        if (isCollapsed) {
            groupEl.classList.add('collapsed');
        }
        groupEl.dataset.folderId = node.id;
        
        const headerEl = document.createElement('div');
        headerEl.className = 'project-folder-header';
        headerEl.style.cssText = `
            display: flex;
            align-items: center;
            padding: 4px 8px 4px ${this.getDocumentTreeIndent(depth)}px;
            cursor: pointer;
            border-radius: 4px;
            user-select: none;
            transition: background-color 0.2s ease;
            min-height: 30px;
        `;
        this.applyDocumentTreeGuides(headerEl, depth);
        
        const chevronEl = document.createElement('span');
        chevronEl.className = 'project-folder-chevron';
        chevronEl.style.cursor = 'pointer';
        if (!hasChildren) {
            chevronEl.classList.add('project-folder-chevron--empty');
        }
        chevronEl.innerHTML = isCollapsed
            ? '<svg style="width:12px;height:12px;margin-right:6px;transform:rotate(-90deg);transition:transform 0.2s;"><use xlink:href="#iconDown"></use></svg>'
            : '<svg style="width:12px;height:12px;margin-right:6px;transition:transform 0.2s;"><use xlink:href="#iconDown"></use></svg>';
            
        const iconEl = document.createElement('span');
        iconEl.className = 'project-folder-icon';
        iconEl.textContent = node.icon;
        iconEl.style.marginRight = '6px';
        
        const nameEl = document.createElement('span');
        nameEl.className = 'project-folder-name';
        nameEl.textContent = node.name;
        nameEl.style.flex = '1';
        
        const countEl = document.createElement('span');
        countEl.className = 'project-folder-count';
        countEl.textContent = `(${node.totalProjectCount})`;
        countEl.style.cssText = 'font-size:12px;opacity:0.6;margin-right:8px;';
        
        headerEl.appendChild(chevronEl);
        
        const allProjIds = this.getAllProjectIdsInFolder(node);
        if (this.isMultiSelect && allProjIds.length > 0) {
            const isAllChecked = allProjIds.every(id => this.selectedIds.has('all') || this.selectedIds.has(id));
            const folderCheckbox = document.createElement('input');
            folderCheckbox.type = 'checkbox';
            folderCheckbox.className = 'folder-selector-checkbox';
            folderCheckbox.style.marginRight = '6px';
            folderCheckbox.checked = isAllChecked;
            folderCheckbox.addEventListener('click', (e) => {
                e.stopPropagation();
                const checked = folderCheckbox.checked;
                this.handleGroupCheckboxChange(allProjIds, checked);
            });
            headerEl.appendChild(folderCheckbox);
        }
        
        headerEl.appendChild(iconEl);
        headerEl.appendChild(nameEl);
        headerEl.appendChild(countEl);
        
        const childrenEl = document.createElement('div');
        childrenEl.className = 'project-folder-children';
        childrenEl.style.cssText = `
            display: ${isCollapsed ? 'none' : 'flex'};
            flex-direction: column;
            gap: 0;
        `;
        
        node.children.forEach(childNode => {
            const childEl = this.createFolderGroupElement(childNode, depth + 1);
            childrenEl.appendChild(childEl);
        });
        
        node.projects.forEach(p => {
            const childEl = this.createProjectListElement(p, depth + 1);
            childrenEl.appendChild(childEl);
        });
        
        const toggleCollapsed = (e: MouseEvent) => {
            e.stopPropagation();
            if (!hasChildren) return;
            if (this.collapsedFolders.has(node.id)) {
                this.collapsedFolders.delete(node.id);
                groupEl.classList.remove('collapsed');
                chevronEl.querySelector('svg').style.transform = 'rotate(0deg)';
                childrenEl.style.display = 'flex';
            } else {
                this.collapsedFolders.add(node.id);
                groupEl.classList.add('collapsed');
                chevronEl.querySelector('svg').style.transform = 'rotate(-90deg)';
                childrenEl.style.display = 'none';
            }
        };
        
        headerEl.addEventListener('click', toggleCollapsed);
        
        groupEl.appendChild(headerEl);
        groupEl.appendChild(childrenEl);
        return groupEl;
    }
    
    private createProjectListElement(project: Project, depth: number): HTMLElement {
        const checked = this.isMultiSelect ? (this.selectedIds.has('all') || this.selectedIds.has(project.id)) : (this.selectedId === project.id);
        const itemEl = document.createElement('div');
        itemEl.className = 'project-item project-item--list';
        itemEl.dataset.value = project.id;
        itemEl.dataset.label = project.name;
        
        this.applyDocumentTreeRowIndent(itemEl, depth);
        
        itemEl.innerHTML = `
            <div class="project-item__content" style="padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; width: 100%; cursor: pointer;">
                ${this.isMultiSelect ? `<input type="checkbox" class="project-selector-checkbox" style="margin-right: 8px;" ${checked ? 'checked' : ''}>` : ''}
                <span class="project-item__title" style="flex: 1;">${project.name}</span>
            </div>
        `;
        
        return itemEl;
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
    
    private bindEvents() {
        this.tabsContainer.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.tab-btn') as HTMLButtonElement;
            if (btn) {
                e.stopPropagation();
                this.currentTab = btn.dataset.tab as 'status' | 'folder';
                this.updateTabStyles();
                this.renderList();
            }
        });
        
        if (this.isMultiSelect) {
            const bulkWrap = this.container.querySelector('.project-selector-bulk-actions');
            if (bulkWrap) {
                const selectAllBtn = bulkWrap.querySelector('.select-all-btn');
                const deselectAllBtn = bulkWrap.querySelector('.deselect-all-btn');
                
                selectAllBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectedIds = new Set(['all']);
                    this.renderList();
                    if (this.onChange) {
                        this.onChange(new Set(this.selectedIds));
                    }
                });
                
                deselectAllBtn?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectedIds = new Set();
                    this.renderList();
                    if (this.onChange) {
                        this.onChange(new Set(this.selectedIds));
                    }
                });
            }
        }
        
        if (this.searchInput) {
            this.searchInput.addEventListener('focus', () => this.show());
            this.searchInput.addEventListener('click', () => this.show());
            this.searchInput.addEventListener('blur', () => this.hide());
            this.searchInput.addEventListener('input', () => {
                this.showQuery(this.searchInput.value);
            });
        }
        
        if (this.innerSearchInput) {
            this.innerSearchInput.addEventListener('input', () => {
                this.showQuery(this.innerSearchInput.value);
            });
        }
        
        this.container.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                if (e.target === this.innerSearchInput) return;
                e.preventDefault();
            }
        });
        
        const handleItemClick = (e: MouseEvent) => {
            const itemEl = (e.target as HTMLElement).closest('[data-value]') as HTMLElement;
            if (!itemEl) return;
            
            if (itemEl.classList.contains('b3-menu__item--readonly')) return;
            
            const val = itemEl.getAttribute('data-value') || '';
            const label = itemEl.getAttribute('data-label') || '';
            
            if (this.isMultiSelect) {
                e.preventDefault();
                e.stopPropagation();
                const checkbox = itemEl.querySelector('.project-selector-checkbox') as HTMLInputElement;
                if (checkbox) {
                    const newChecked = !checkbox.checked;
                    checkbox.checked = newChecked;
                    this.handleCheckboxChange(val, newChecked);
                }
            } else {
                this.selectedId = val;
                if (this.valueInput) {
                    this.valueInput.value = val;
                }
                if (this.searchInput) {
                    this.searchInput.value = val ? label : '';
                }
                if (this.onSelect) {
                    this.onSelect(val, label);
                }
                this.hide();
            }
        };
        
        this.listContainer.addEventListener('click', handleItemClick);
    }
    
    private showQuery(query: string) {
        this.searchQuery = query;
        this.container.style.display = 'block';
        this.renderList();
    }
    
    public show() {
        this.container.style.display = 'block';
        this.renderList();
    }
    
    public hide() {
        setTimeout(() => {
            this.container.style.display = 'none';
            if (this.valueInput && this.searchInput) {
                const currentId = this.valueInput.value;
                const matchingProj = this.projectManager.getProjectById(currentId);
                if (matchingProj) {
                    this.searchInput.value = matchingProj.name;
                } else if (!currentId) {
                    this.searchInput.value = '';
                }
            }
        }, 200);
    }
    
    public updateSelection(selectedIdOrIds: string | Set<string>) {
        if (this.isMultiSelect) {
            this.selectedIds = new Set(selectedIdOrIds as Set<string>);
        } else {
            this.selectedId = selectedIdOrIds as string;
            if (this.searchInput) {
                const proj = this.projectManager.getProjectById(this.selectedId);
                this.searchInput.value = proj ? proj.name : '';
            }
        }
        this.renderList();
    }
    
    private handleCheckboxChange(id: string, checked: boolean) {
        const projects = this.projectManager.getProjects();
        const statuses = this.projectManager.getStatusManager().getStatuses();
        const projectIds = projects
            .filter(project => {
                if (this.allowedProjectIds?.length && !this.allowedProjectIds.includes(project.id)) return false;
                if (this.excludeArchived) {
                    const statusInfo = statuses.find(s => s.id === project.status);
                    if (statusInfo?.isArchived) return false;
                }
                return true;
            })
            .map(p => p.id);
        if (this.includeNoProject) {
            projectIds.push('none');
        }
        
        if (checked) {
            this.selectedIds.delete('all');
            this.selectedIds.add(id);
            
            let allChecked = true;
            for (const pid of projectIds) {
                if (!this.selectedIds.has(pid)) {
                    allChecked = false;
                    break;
                }
            }
            if (allChecked) {
                this.selectedIds = new Set(['all']);
                this.renderList();
            }
        } else {
            if (this.selectedIds.has('all')) {
                this.selectedIds = new Set(projectIds);
            }
            this.selectedIds.delete(id);
        }
        
        if (this.onChange) {
            this.onChange(new Set(this.selectedIds));
        }
    }
    
    private sortProjects(projectsList: Project[]) {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        projectsList.sort((a, b) => {
            const priorityA = priorityOrder[a.priority || 'none'] || 0;
            const priorityB = priorityOrder[b.priority || 'none'] || 0;
            if (priorityA !== priorityB) {
                return priorityB - priorityA;
            }
            const sortA = a.sort || 0;
            const sortB = b.sort || 0;
            if (sortA !== sortB) {
                return sortA - sortB;
            }
            const dateA = a.startDate || a.createdTime || '';
            const dateB = b.startDate || b.createdTime || '';
            return dateA.localeCompare(dateB);
        });
    }
    
    private getAllProjectIdsInFolder(node: FolderNode): string[] {
        let ids = node.projects.map(p => p.id);
        node.children.forEach(child => {
            ids = ids.concat(this.getAllProjectIdsInFolder(child));
        });
        return ids;
    }
    
    private handleGroupCheckboxChange(projectIds: string[], checked: boolean) {
        const projects = this.projectManager.getProjects();
        const statuses = this.projectManager.getStatusManager().getStatuses();
        const allValidIds = projects
            .filter(project => {
                if (this.allowedProjectIds?.length && !this.allowedProjectIds.includes(project.id)) return false;
                if (this.excludeArchived) {
                    const statusInfo = statuses.find(s => s.id === project.status);
                    if (statusInfo?.isArchived) return false;
                }
                return true;
            })
            .map(p => p.id);
        if (this.includeNoProject) {
            allValidIds.push('none');
        }

        if (checked) {
            this.selectedIds.delete('all');
            projectIds.forEach(id => this.selectedIds.add(id));
            
            let allChecked = true;
            for (const pid of allValidIds) {
                if (!this.selectedIds.has(pid)) {
                    allChecked = false;
                    break;
                }
            }
            if (allChecked) {
                this.selectedIds = new Set(['all']);
            }
        } else {
            if (this.selectedIds.has('all')) {
                this.selectedIds = new Set(allValidIds);
            }
            projectIds.forEach(id => this.selectedIds.delete(id));
        }
        
        this.renderList();
        if (this.onChange) {
            this.onChange(new Set(this.selectedIds));
        }
    }
}
