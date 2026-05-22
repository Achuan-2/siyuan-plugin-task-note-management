export interface FolderKanbanSettings {
    sortCriteria?: { method: string; order: 'asc' | 'desc' }[];
    kanbanMode?: 'status' | 'custom' | 'list';
    doneSort?: string;
    doneSortOrder?: 'asc' | 'desc';
    showCompletedSubtasks?: boolean;
    showTaskCategories?: boolean;
    clipTitleToOneLine?: boolean;
    hideEmptyStatusBars?: boolean;
    hideNoDoingGroups?: boolean;
    hideNoTodayGroups?: boolean;
    customGroupTabsMode?: boolean;
}

export interface ProjectFolder {
    id: string;
    name: string;
    sort: number;
    collapsed?: boolean;
    icon?: string;
    parentId?: string;
    kanbanSettings?: FolderKanbanSettings;
}

export class ProjectFolderManager {
    private static instance: ProjectFolderManager;
    private folders: ProjectFolder[] = [];
    private plugin: any;

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    private getFolderParentId(folder: ProjectFolder | undefined): string {
        return folder?.parentId || '';
    }

    private getNextSort(parentId: string, ignoreId?: string): number {
        const siblingSorts = this.folders
            .filter(folder => folder.id !== ignoreId && this.getFolderParentId(folder) === parentId)
            .map(folder => typeof folder.sort === 'number' ? folder.sort : 0);
        return siblingSorts.length > 0 ? Math.max(...siblingSorts) + 10 : 0;
    }

    private sortFoldersForTree(folders: ProjectFolder[]): ProjectFolder[] {
        const byParent = new Map<string, ProjectFolder[]>();
        folders.forEach(folder => {
            const parentId = this.getFolderParentId(folder);
            if (!byParent.has(parentId)) {
                byParent.set(parentId, []);
            }
            byParent.get(parentId).push(folder);
        });

        byParent.forEach(children => {
            children.sort((a, b) => {
                const sortDiff = (a.sort || 0) - (b.sort || 0);
                if (sortDiff !== 0) return sortDiff;
                return (a.name || '').localeCompare(b.name || '', 'zh-CN');
            });
        });

        const sorted: ProjectFolder[] = [];
        const visited = new Set<string>();
        const visit = (parentId: string) => {
            const children = byParent.get(parentId) || [];
            children.forEach(folder => {
                if (visited.has(folder.id)) return;
                visited.add(folder.id);
                sorted.push(folder);
                visit(folder.id);
            });
        };

        visit('');

        folders.forEach(folder => {
            if (!visited.has(folder.id)) {
                sorted.push(folder);
            }
        });

        return sorted;
    }

    private normalizeFolders(): void {
        const folderIds = new Set(this.folders.filter(folder => folder && folder.id).map(folder => folder.id));

        this.folders = this.folders
            .filter(folder => folder && folder.id)
            .map((folder, index) => ({
                ...folder,
                parentId: folder.parentId && folder.parentId !== folder.id && folderIds.has(folder.parentId) ? folder.parentId : '',
                sort: typeof folder.sort === 'number' ? folder.sort : index * 10,
                collapsed: !!folder.collapsed,
                icon: folder.icon || '📂'
            }));

        const folderMap = new Map(this.folders.map(folder => [folder.id, folder]));
        this.folders.forEach(folder => {
            const visited = new Set<string>([folder.id]);
            let parentId = folder.parentId || '';
            while (parentId) {
                if (visited.has(parentId)) {
                    folder.parentId = '';
                    break;
                }
                visited.add(parentId);
                parentId = folderMap.get(parentId)?.parentId || '';
            }
        });

        this.folders = this.sortFoldersForTree(this.folders);
    }

    public static getInstance(plugin?: any): ProjectFolderManager {
        if (!ProjectFolderManager.instance) {
            ProjectFolderManager.instance = new ProjectFolderManager(plugin);
        }
        return ProjectFolderManager.instance;
    }

    /**
     * 初始化文件夹数据
     */
    public async initialize(): Promise<void> {
        try {
            await this.loadFolders();
        } catch (error) {
            console.error('初始化文件夹失败:', error);
            this.folders = [];
        }
    }

    /**
     * 加载文件夹数据
     */
    public async loadFolders(): Promise<ProjectFolder[]> {
        try {
            const content = await this.plugin.loadData("project_folders.json");
            if (!content) {
                this.folders = [];
                return this.folders;
            }

            if (Array.isArray(content)) {
                this.folders = content;
            } else {
                console.log('文件夹数据无效，重置为空');
                this.folders = [];
            }
        } catch (error) {
            console.warn('加载文件夹文件失败:', error);
            this.folders = [];
        }

        // 确保旧数据具备排序和父级字段，并按树形顺序返回
        this.normalizeFolders();

        return this.folders;
    }

    /**
     * 保存文件夹数据
     */
    public async saveFolders(): Promise<void> {
        try {
            await this.plugin.saveData("project_folders.json", this.folders);
        } catch (error) {
            console.error('保存文件夹失败:', error);
            throw error;
        }
    }

    /**
     * 获取所有文件夹
     */
    public getFolders(): ProjectFolder[] {
        return [...this.folders];
    }

    /**
     * 根据ID获取文件夹
     */
    public getFolderById(id: string): ProjectFolder | undefined {
        return this.folders.find(folder => folder.id === id);
    }

    public getSiblingFolders(parentId: string = ''): ProjectFolder[] {
        return this.folders
            .filter(folder => this.getFolderParentId(folder) === parentId)
            .sort((a, b) => {
                const sortDiff = (a.sort || 0) - (b.sort || 0);
                if (sortDiff !== 0) return sortDiff;
                return (a.name || '').localeCompare(b.name || '', 'zh-CN');
            });
    }

    public isFolderDescendant(folderId: string, ancestorId: string): boolean {
        let current = this.getFolderById(folderId);
        const visited = new Set<string>();

        while (current?.parentId) {
            if (current.parentId === ancestorId) {
                return true;
            }
            if (visited.has(current.parentId)) {
                return false;
            }
            visited.add(current.parentId);
            current = this.getFolderById(current.parentId);
        }

        return false;
    }

    /**
     * 添加新文件夹
     */
    public async addFolder(name: string, icon?: string, parentId: string = ''): Promise<ProjectFolder> {
        const normalizedParentId = parentId && this.getFolderById(parentId) ? parentId : '';
        const nextSort = this.getNextSort(normalizedParentId);
            
        const newFolder: ProjectFolder = {
            id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            name,
            sort: nextSort,
            collapsed: false,
            icon: icon || '📂',
            parentId: normalizedParentId
        };

        this.folders.push(newFolder);
        this.folders = this.sortFoldersForTree(this.folders);
        await this.saveFolders();
        return newFolder;
    }

    /**
     * 更新文件夹
     */
    public async updateFolder(id: string, updates: Partial<Omit<ProjectFolder, 'id'>>): Promise<boolean> {
        const index = this.folders.findIndex(folder => folder.id === id);
        if (index === -1) {
            return false;
        }

        const normalizedUpdates: Partial<Omit<ProjectFolder, 'id'>> = { ...updates };
        if (Object.prototype.hasOwnProperty.call(normalizedUpdates, 'parentId')) {
            const nextParentId = normalizedUpdates.parentId && this.getFolderById(normalizedUpdates.parentId)
                ? normalizedUpdates.parentId
                : '';

            if (nextParentId === id || (nextParentId && this.isFolderDescendant(nextParentId, id))) {
                throw new Error('不能将文件夹移动到自身或其子文件夹下');
            }

            if (nextParentId !== this.getFolderParentId(this.folders[index]) && normalizedUpdates.sort === undefined) {
                normalizedUpdates.sort = this.getNextSort(nextParentId, id);
            }
            normalizedUpdates.parentId = nextParentId;
        }

        this.folders[index] = { ...this.folders[index], ...normalizedUpdates };
        this.folders = this.sortFoldersForTree(this.folders);
        await this.saveFolders();
        return true;
    }

    /**
     * 删除文件夹
     */
    public async deleteFolder(id: string): Promise<boolean> {
        const index = this.folders.findIndex(folder => folder.id === id);
        if (index === -1) {
            return false;
        }

        const deletedFolder = this.folders[index];
        const promotedParentId = this.getFolderParentId(deletedFolder);

        this.folders.splice(index, 1);
        this.folders.forEach(folder => {
            if (folder.parentId === id) {
                folder.parentId = promotedParentId;
                folder.sort = this.getNextSort(promotedParentId, folder.id);
            }
        });
        this.folders = this.sortFoldersForTree(this.folders);
        await this.saveFolders();

        // 移除属于该文件夹的项目归类
        try {
            const projectData = await this.plugin.loadProjectData();
            if (projectData && typeof projectData === 'object') {
                let changed = false;
                Object.values(projectData).forEach((project: any) => {
                    if (project && project.folderId === id) {
                        project.folderId = '';
                        project.updatedTime = new Date().toISOString();
                        changed = true;
                    }
                });
                if (changed) {
                    await this.plugin.saveProjectData(projectData);
                    // 触发项目更新事件
                    window.dispatchEvent(new CustomEvent('projectUpdated'));
                }
            }
        } catch (error) {
            console.error('解绑删除文件夹下项目归类失败:', error);
        }

        return true;
    }

    /**
     * 重新排序文件夹
     */
    public async reorderFolders(reorderedFolders: ProjectFolder[]): Promise<void> {
        if (!Array.isArray(reorderedFolders)) {
            throw new Error('重排序的文件夹必须是数组');
        }

        const existingMap = new Map(this.folders.map(folder => [folder.id, folder]));
        const mergedFolders: ProjectFolder[] = [];
        const seen = new Set<string>();

        reorderedFolders.forEach(folder => {
            if (!folder?.id || seen.has(folder.id)) return;
            const existing = existingMap.get(folder.id);
            mergedFolders.push({
                ...existing,
                ...folder,
                parentId: folder.parentId && folder.parentId !== folder.id && existingMap.has(folder.parentId) ? folder.parentId : ''
            });
            seen.add(folder.id);
        });

        this.folders.forEach(folder => {
            if (!seen.has(folder.id)) {
                mergedFolders.push(folder);
            }
        });

        const siblingIndexMap = new Map<string, number>();
        this.folders = mergedFolders.map(folder => {
            const parentId = this.getFolderParentId(folder);
            const index = siblingIndexMap.get(parentId) || 0;
            siblingIndexMap.set(parentId, index + 1);
            return {
                ...folder,
                parentId,
                sort: index * 10
            };
        });
        this.normalizeFolders();
        await this.saveFolders();
    }

    public async moveFolder(folderId: string, targetParentId: string, targetFolderId?: string, insertBefore: boolean = true): Promise<boolean> {
        const movingFolder = this.getFolderById(folderId);
        if (!movingFolder) {
            return false;
        }

        const normalizedParentId = targetParentId && this.getFolderById(targetParentId) ? targetParentId : '';
        if (normalizedParentId === folderId || (normalizedParentId && this.isFolderDescendant(normalizedParentId, folderId))) {
            throw new Error('不能将文件夹移动到自身或其子文件夹下');
        }

        movingFolder.parentId = normalizedParentId;
        const siblings = this.getSiblingFolders(normalizedParentId).filter(folder => folder.id !== folderId);
        const targetIndex = targetFolderId ? siblings.findIndex(folder => folder.id === targetFolderId) : -1;
        let insertIndex = targetIndex === -1 ? siblings.length : targetIndex;
        if (targetIndex !== -1 && !insertBefore) {
            insertIndex = targetIndex + 1;
        }

        siblings.splice(insertIndex, 0, movingFolder);
        siblings.forEach((folder, index) => {
            const source = this.getFolderById(folder.id);
            if (source) {
                source.parentId = normalizedParentId;
                source.sort = index * 10;
            }
        });

        this.folders = this.sortFoldersForTree(this.folders);
        await this.saveFolders();
        return true;
    }
}
