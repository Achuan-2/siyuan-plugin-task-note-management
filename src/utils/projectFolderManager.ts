import { i18n } from '../pluginInstance';

export interface ProjectFolder {
    id: string;
    name: string;
    sort: number;
    collapsed?: boolean;
    icon?: string;
}

export class ProjectFolderManager {
    private static instance: ProjectFolderManager;
    private folders: ProjectFolder[] = [];
    private plugin: any;

    private constructor(plugin: any) {
        this.plugin = plugin;
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

        // 确保排序字段存在
        this.folders.forEach((folder, index) => {
            if (folder.sort === undefined) {
                folder.sort = index * 10;
            }
        });
        this.folders.sort((a, b) => a.sort - b.sort);

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

    /**
     * 添加新文件夹
     */
    public async addFolder(name: string, icon?: string): Promise<ProjectFolder> {
        const nextSort = this.folders.length > 0 
            ? Math.max(...this.folders.map(f => f.sort)) + 10 
            : 0;
            
        const newFolder: ProjectFolder = {
            id: `folder_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            name,
            sort: nextSort,
            collapsed: false,
            icon: icon || '📂'
        };

        this.folders.push(newFolder);
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

        this.folders[index] = { ...this.folders[index], ...updates };
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

        this.folders.splice(index, 1);
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

        this.folders = [...reorderedFolders].map((folder, index) => ({
            ...folder,
            sort: index * 10
        }));
        await this.saveFolders();
    }
}
