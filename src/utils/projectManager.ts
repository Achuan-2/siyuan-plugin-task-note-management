import { getFile, putFile, removeFile } from '../api';
import { PROJECT_DATA_FILE } from '../index';
import { StatusManager } from './statusManager';

export interface Project {
    id: string;
    name: string;
    status: string;
    color?: string;
    kanbanMode?: 'status' | 'custom';
    customGroups?: any[];
    blockId?: string;
}

export class ProjectManager {
    private static instance: ProjectManager;
    private plugin: any;
    private projects: Project[] = [];
    private projectColors: { [key: string]: string } = {};
    private statusManager: StatusManager;

    private constructor(plugin: any) {
        this.plugin = plugin;
        this.statusManager = StatusManager.getInstance(this.plugin);
    }

    public static getInstance(plugin?: any): ProjectManager {
        if (!ProjectManager.instance) {
            if (!plugin) {
                throw new Error('ProjectManager需要plugin实例进行初始化');
            }
            ProjectManager.instance = new ProjectManager(plugin);
        }
        return ProjectManager.instance;
    }

    async initialize() {
        await this.statusManager.initialize();
        await this.loadProjects();
    }

    public async setProjectColor(projectId: string, color: string) {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            if (projectData[projectId]) {
                projectData[projectId].color = color;
                await this.plugin.saveData(PROJECT_DATA_FILE, projectData);
            }
            this.projectColors[projectId] = color;
            // 触发项目颜色更新事件，通知日历视图等组件更新颜色缓存
            window.dispatchEvent(new CustomEvent('projectColorUpdated'));
        } catch (error) {
            console.error('Failed to set project color:', error);
            throw error;
        }
    }

    public getProjectColor(projectId: string): string {
        if (!projectId) {
            return '#cccccc'; // 默认颜色
        }
        return this.projectColors[projectId] || this.generateColorFromId(projectId);
    }

    private generateColorFromId(id: string): string {
        if (!id || typeof id !== 'string') {
            return '#cccccc'; // 默认颜色
        }
        let hash = 0;
        for (let i = 0; i < id.length; i++) {
            hash = id.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF)
            .toString(16)
            .toUpperCase();
        return "#" + "00000".substring(0, 6 - c.length) + c;
    }

    public async loadProjects() {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            if (projectData && typeof projectData === 'object') {
                // 迁移旧的 _colors 到项目中
                if (projectData._colors) {
                    Object.entries(projectData._colors).forEach(([id, color]) => {
                        if (projectData[id] && typeof color === 'string') {
                            projectData[id].color = color;
                        }
                    });
                    delete projectData._colors;
                    await this.plugin.saveData(PROJECT_DATA_FILE, projectData);
                    console.log('成功迁移 _colors 到项目对象中');
                }

                // 检查是否存在旧的 project_colors.json 文件，如果存在则导入并删除
                try {
                    const oldColorsContent = await getFile('data/storage/petal/siyuan-plugin-task-note-management/project_colors.json');
                    if (oldColorsContent && oldColorsContent.code !== 404) {
                        const oldColors = typeof oldColorsContent === 'string' ? JSON.parse(oldColorsContent) : oldColorsContent;
                        if (oldColors && typeof oldColors === 'object') {
                            // 合并旧颜色数据到项目中
                            Object.entries(oldColors).forEach(([id, color]) => {
                                if (projectData[id] && typeof color === 'string') {
                                    projectData[id].color = color;
                                }
                            });
                            await this.plugin.saveData(PROJECT_DATA_FILE, projectData);
                            // 删除旧文件
                            await removeFile('data/storage/petal/siyuan-plugin-task-note-management/project_colors.json');
                            console.log('成功导入并删除旧的 project_colors.json 文件');
                        }
                    }
                } catch (error) {
                    // 如果文件不存在或其他错误，忽略
                    console.log('旧的 project_colors.json 文件不存在或已处理');
                }

                // 排除内部属性，只处理项目数据
                const projectEntries = Object.entries(projectData).filter(([key]) => !key.startsWith('_'));
                this.projects = projectEntries
                    .map(([id, project]: [string, any]) => ({
                        id: id,
                        name: project.title || '未命名项目',
                        status: project.status || 'doing',
                        color: project.color,
                        blockId: project.blockId
                    }));

                // 从项目中提取颜色到 projectColors
                this.projectColors = {};
                projectEntries.forEach(([id, project]: [string, any]) => {
                    if (project.color) {
                        this.projectColors[id] = project.color;
                    }
                });
            } else {
                this.projects = [];
                this.projectColors = {};
            }
        } catch (error) {
            console.error('Failed to load projects:', error);
            this.projects = [];
            this.projectColors = {};
        }
    }

    public getProjectsGroupedByStatus(): { [key: string]: Project[] } {
        const statuses = this.statusManager.getStatuses();
        const grouped: { [key: string]: Project[] } = {};

        statuses.forEach(status => {
            grouped[status.id] = [];
        });

        this.projects.forEach(project => {
            const status = project.status || 'active';
            if (grouped[status]) {
                grouped[status].push(project);
            } else {
                // Handle projects with statuses that may no longer exist
                if (!grouped.hasOwnProperty('uncategorized')) {
                    grouped['uncategorized'] = [];
                }
                grouped['uncategorized'].push(project);
            }
        });

        // Sort statuses to ensure archived is last
        const sortedGrouped: { [key: string]: Project[] } = {};
        const activeStatuses = statuses.filter(s => !s.isArchived);
        const archivedStatuses = statuses.filter(s => s.isArchived);

        activeStatuses.forEach(status => {
            if (grouped[status.id]?.length > 0) {
                sortedGrouped[status.id] = grouped[status.id];
            }
        });

        archivedStatuses.forEach(status => {
            if (grouped[status.id]?.length > 0) {
                sortedGrouped[status.id] = grouped[status.id];
            }
        });

        if (grouped['uncategorized']?.length > 0) {
            sortedGrouped['uncategorized'] = grouped['uncategorized'];
        }

        return sortedGrouped;
    }

    public getProjectById(id: string): Project | undefined {
        return this.projects.find(p => p.id === id);
    }

    public getProjectName(id: string): string | undefined {
        const project = this.getProjectById(id);
        return project?.name;
    }

    public getStatusManager(): StatusManager {
        return this.statusManager;
    }

    /**
     * 获取项目的看板模式
     */
    public async getProjectKanbanMode(projectId: string): Promise<'status' | 'custom'> {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            const project = projectData[projectId];
            return project?.kanbanMode || 'status';
        } catch (error) {
            console.error('获取项目看板模式失败:', error);
            return 'status';
        }
    }

    /**
     * 设置项目的看板模式
     */
    public async setProjectKanbanMode(projectId: string, mode: 'status' | 'custom'): Promise<void> {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            if (projectData[projectId]) {
                projectData[projectId].kanbanMode = mode;
                await this.plugin.saveData(PROJECT_DATA_FILE, projectData);
            }
        } catch (error) {
            console.error('设置项目看板模式失败:', error);
            throw error;
        }
    }

    /**
     * 获取项目的自定义分组
     */
    public async getProjectCustomGroups(projectId: string): Promise<any[]> {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            const project = projectData[projectId];
            return project?.customGroups || [];
        } catch (error) {
            console.error('获取项目自定义分组失败:', error);
            return [];
        }
    }

    /**
     * 设置项目的自定义分组
     */
    public async setProjectCustomGroups(projectId: string, groups: any[]): Promise<void> {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            if (projectData[projectId]) {
                projectData[projectId].customGroups = groups;
                await this.plugin.saveData(PROJECT_DATA_FILE, projectData);
            }
        } catch (error) {
            console.error('设置项目自定义分组失败:', error);
            throw error;
        }
    }



    /**
     * 获取项目的标签列表
     */
    public async getProjectTags(projectId: string): Promise<Array<{ id: string, name: string, color: string }>> {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            const project = projectData[projectId];
            const tags = project?.tags || [];

            // 兼容旧数据格式
            if (tags.length > 0) {
                // 情况1: 字符串数组 -> 转换为带ID的对象数组
                if (typeof tags[0] === 'string') {
                    const convertedTags = tags.map((tag: string) => ({
                        id: this.generateTagId(),
                        name: tag,
                        color: '#3498db'
                    }));
                    // 自动保存转换后的数据
                    await this.setProjectTags(projectId, convertedTags);
                    return convertedTags;
                }

                // 情况2: 对象数组但没有ID -> 添加ID
                if (!tags[0].id) {
                    const tagsWithId = tags.map((tag: any) => ({
                        id: this.generateTagId(),
                        name: tag.name,
                        color: tag.color || '#3498db'
                    }));
                    // 自动保存添加ID后的数据
                    await this.setProjectTags(projectId, tagsWithId);
                    return tagsWithId;
                }
            }

            return tags;
        } catch (error) {
            console.error('获取项目标签失败:', error);
            return [];
        }
    }

    /**
     * 设置项目的标签列表
     */
    public async setProjectTags(projectId: string, tags: Array<{ id: string, name: string, color: string }>): Promise<void> {
        try {
            const projectData = await this.plugin.loadData(PROJECT_DATA_FILE) || {};
            if (projectData[projectId]) {
                projectData[projectId].tags = tags;
                await this.plugin.saveData(PROJECT_DATA_FILE, projectData);
            }
        } catch (error) {
            console.error('设置项目标签失败:', error);
            throw error;
        }
    }

    /**
     * 生成唯一的标签ID
     */
    private generateTagId(): string {
        return `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}