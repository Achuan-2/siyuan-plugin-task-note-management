import { getFile, putFile, removeFile } from '../api';
import { StatusManager } from './statusManager';
import { i18n } from '../pluginInstance';

export interface Milestone {
    id: string;
    name: string;
    icon?: string;
    archived: boolean;
    blockId?: string;
    startTime?: string;
    endTime?: string;
    sort: number;
    note?: string;
}

export interface MilestoneDateDisplayInfo {
    milestoneId: string;
    displayText: string;
}

export interface ProjectGroup {
    id: string;
    name: string;
    color: string;
    icon?: string;
    sort: number;
    blockId?: string;
    milestones?: Milestone[];
    archived?: boolean;
    visibleStatusIds?: string[]; // 分组可见状态ID，空或未设置表示显示全部状态
}

export interface Project {
    id: string;
    name: string;
    status: string;
    color?: string;
    kanbanMode?: 'status' | 'custom' | 'list';
    customGroups?: ProjectGroup[];
    blockId?: string;
    sortRule?: string;
    sortOrder?: 'asc' | 'desc';
    milestones?: Milestone[];
    priority?: 'high' | 'medium' | 'low' | 'none';
    sort?: number;
    startDate?: string;
    createdTime?: string;
    categoryId?: string;
}

/**
 * 看板状态配置
 */
export interface KanbanStatus {
    id: string;           // 状态ID: 'doing', 'short_term', 'long_term', 'completed', 'abandoned' 或自定义ID
    name: string;         // 显示名称
    color: string;        // 状态颜色
    icon?: string;        // 状态图标（emoji）
    isFixed: boolean;     // 是否固定不可删除（doing、completed、abandoned 为固定）
    sort: number;         // 排序权重
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
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].color = color;
                await this.plugin.saveProjectData(projectData);
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

    /**
     * 检查状态名称是否为默认名称
     */
    private isDefaultStatusName(id: string, name: string): boolean {
        const defaultNames: { [key: string]: string[] } = {
            'doing': ['进行中', 'Doing'],
            'short_term': ['短期', 'Short Term', 'shortTerm'],
            'long_term': ['长期', 'Long Term', 'longTerm'],
            'completed': ['已完成', 'Completed'],
            'abandoned': ['放弃', 'Abandoned']
        };
        return defaultNames[id]?.includes(name) || false;
    }

    public async loadProjects() {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData && typeof projectData === 'object') {

                const projectEntries = Object.entries(projectData).filter(([key]) => !key.startsWith('_'));
                this.projects = projectEntries
                    .map(([id, project]: [string, any]) => ({
                        id: id,
                        name: project.title || i18n('unnamedProject'),
                        status: project.status || 'active',
                        color: project.color,
                        blockId: project.blockId,
                        priority: project.priority || 'none',
                        sort: project.sort || 0,
                        startDate: project.startDate,
                        createdTime: project.createdTime,
                        categoryId: project.categoryId
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
    public async getProjectKanbanMode(projectId: string): Promise<'status' | 'custom' | 'list'> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
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
    public async setProjectKanbanMode(projectId: string, mode: 'status' | 'custom' | 'list'): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].kanbanMode = mode;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目看板模式失败:', error);
            throw error;
        }
    }

    /**
     * 获取项目的自定义分组
     */
    public async getProjectCustomGroups(projectId: string): Promise<ProjectGroup[]> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
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
    public async setProjectCustomGroups(projectId: string, groups: ProjectGroup[]): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].customGroups = groups;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目自定义分组失败:', error);
            throw error;
        }
    }

    /**
     * 获取项目的默认里程碑（未分组任务使用）
     */
    public async getProjectMilestones(projectId: string): Promise<Milestone[]> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            return project?.milestones || [];
        } catch (error) {
            console.error('获取项目里程碑失败:', error);
            return [];
        }
    }

    /**
     * 设置项目的默认里程碑
     */
    public async setProjectMilestones(projectId: string, milestones: Milestone[]): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].milestones = milestones;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目里程碑失败:', error);
            throw error;
        }
    }

    /**
     * 获取分组的里程碑
     */
    public async getGroupMilestones(projectId: string, groupId: string): Promise<Milestone[]> {
        try {
            const groups = await this.getProjectCustomGroups(projectId);
            const group = groups.find(g => g.id === groupId);
            return group?.milestones || [];
        } catch (error) {
            console.error('获取分组里程碑失败:', error);
            return [];
        }
    }

    /**
     * 根据ID获取里程碑（包括项目级和分组级）
     */
    public async getMilestoneById(projectId: string, milestoneId: string): Promise<Milestone | undefined> {
        try {
            // 1. 查找项目级里程碑
            const projectMilestones = await this.getProjectMilestones(projectId);
            const projectMilestone = projectMilestones.find(m => m.id === milestoneId);
            if (projectMilestone) return projectMilestone;

            // 2. 查找分组级里程碑
            const groups = await this.getProjectCustomGroups(projectId);
            for (const group of groups) {
                if (group.milestones) {
                    const groupMilestone = group.milestones.find(m => m.id === milestoneId);
                    if (groupMilestone) return groupMilestone;
                }
            }

            return undefined;
        } catch (error) {
            console.error('根据ID获取里程碑失败:', error);
            return undefined;
        }
    }

    private findMilestoneByIdFromProjectData(projectData: any, projectId: string, milestoneId: string): Milestone | undefined {
        if (!projectData || typeof projectData !== 'object' || !projectId || !milestoneId) return undefined;
        const project = projectData[projectId];
        if (!project || typeof project !== 'object') return undefined;

        const projectMilestone = Array.isArray(project.milestones)
            ? project.milestones.find((m: Milestone) => m?.id === milestoneId)
            : undefined;
        if (projectMilestone) return projectMilestone;

        const groups = Array.isArray(project.customGroups) ? project.customGroups : [];
        for (const group of groups) {
            const groupMilestone = Array.isArray(group?.milestones)
                ? group.milestones.find((m: Milestone) => m?.id === milestoneId)
                : undefined;
            if (groupMilestone) return groupMilestone;
        }

        return undefined;
    }

    private formatMilestoneDateForDisplay(value?: string): string {
        const safeValue = typeof value === 'string' ? value.trim() : '';
        if (!safeValue) return '';
        const compact = safeValue.replace(/[^\d]/g, '');
        return compact.length === 8 ? compact : safeValue;
    }

    private buildMilestoneDateDisplayInfo(
        projectId: string,
        milestoneIds: string[],
        projectData: any
    ): MilestoneDateDisplayInfo | null {
        const normalizedMilestoneIds = Array.from(new Set((milestoneIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
        if (!projectId || normalizedMilestoneIds.length === 0) return null;

        for (const milestoneId of normalizedMilestoneIds) {
            const milestone = this.findMilestoneByIdFromProjectData(projectData, projectId, milestoneId);
            if (!milestone) continue;

            const startDate = this.formatMilestoneDateForDisplay(milestone.startTime);
            const endDate = this.formatMilestoneDateForDisplay(milestone.endTime);
            const displayText = startDate && endDate
                ? (startDate === endDate ? startDate : `${startDate}-${endDate}`)
                : (startDate || endDate);

            if (!displayText) continue;

            return {
                milestoneId,
                displayText
            };
        }

        return null;
    }

    public getMilestoneDateDisplayInfoSync(projectId: string, milestoneIds: string[]): MilestoneDateDisplayInfo | null {
        try {
            return this.buildMilestoneDateDisplayInfo(projectId, milestoneIds, this.plugin?.projectDataCache);
        } catch (error) {
            console.warn('同步获取里程碑日期展示信息失败:', error);
            return null;
        }
    }

    public async getMilestoneDateDisplayInfo(projectId: string, milestoneIds: string[]): Promise<MilestoneDateDisplayInfo | null> {
        try {
            const projectData = await this.plugin.loadProjectData();
            return this.buildMilestoneDateDisplayInfo(projectId, milestoneIds, projectData);
        } catch (error) {
            console.error('获取里程碑日期展示信息失败:', error);
            return null;
        }
    }

    /**
     * 设置分组的里程碑
     */
    public async setGroupMilestones(projectId: string, groupId: string, milestones: Milestone[]): Promise<void> {
        try {
            const groups = await this.getProjectCustomGroups(projectId);
            const groupIndex = groups.findIndex(g => g.id === groupId);
            if (groupIndex !== -1) {
                groups[groupIndex].milestones = milestones;
                await this.setProjectCustomGroups(projectId, groups);
            }
        } catch (error) {
            console.error('设置分组里程碑失败:', error);
            throw error;
        }
    }

    /**
     * 生成里程碑ID
     */
    public generateMilestoneId(): string {
        return `ms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 获取项目的排序规则
     */
    public async getProjectSortRule(projectId: string): Promise<string> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            return project?.sortRule || 'priority';
        } catch (error) {
            console.error('获取项目排序规则失败:', error);
            return 'priority';
        }
    }

    /**
     * 设置项目的排序规则
     */
    public async setProjectSortRule(projectId: string, sortRule: string): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].sortRule = sortRule;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目排序规则失败:', error);
            throw error;
        }
    }

    /**
     * 获取项目的排序方向
     */
    public async getProjectSortOrder(projectId: string): Promise<'asc' | 'desc'> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            return project?.sortOrder || 'desc';
        } catch (error) {
            console.error('获取项目排序方向失败:', error);
            return 'desc';
        }
    }

    /**
     * 设置项目的排序方向
     */
    public async setProjectSortOrder(projectId: string, sortOrder: 'asc' | 'desc'): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].sortOrder = sortOrder;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目排序方向失败:', error);
            throw error;
        }
    }





    /**
     * 获取项目的标签列表
     */
    public async getProjectTags(projectId: string): Promise<Array<{ id: string, name: string, color: string }>> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
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
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                projectData[projectId].tags = tags;
                await this.plugin.saveProjectData(projectData);
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

    /**
     * 获取项目的默认看板状态配置
     * 固定状态：doing(进行中), completed(已完成), abandoned(放弃)
     * 默认可自定义状态：short_term(短期), long_term(长期)
     */
    private getBuiltInDefaultKanbanStatuses(): KanbanStatus[] {
        return [
            {
                id: 'doing',
                name: i18n('doing'),
                color: '#e74c3c',
                icon: '⏳',
                isFixed: true,
                sort: 0
            },
            {
                id: 'short_term',
                name: i18n('shortTerm'),
                color: '#3498db',
                icon: '📋',
                isFixed: false,
                sort: 10
            },
            {
                id: 'long_term',
                name: i18n('longTerm'),
                color: '#9b59b6',
                icon: '🤔',
                isFixed: false,
                sort: 20
            },
            {
                id: 'completed',
                name: i18n('completed'),
                color: '#27ae60',
                icon: '✅',
                isFixed: true,
                sort: 100
            },
            {
                id: 'abandoned',
                name: i18n('abandoned') || '放弃',
                color: '#7f8c8d',
                icon: '🚫',
                isFixed: true,
                sort: 110
            }
        ];
    }

    /**
     * 规范化全局看板状态配置：
     * - 过滤非法项
     * - 强制保留 doing / completed / abandoned 三个固定状态
     * - 重新排序
     */
    private normalizeGlobalKanbanStatuses(config: any): KanbanStatus[] | null {
        if (!Array.isArray(config) || config.length === 0) return null;

        const builtInDefaults = this.getBuiltInDefaultKanbanStatuses();
        const builtInMap = new Map<string, KanbanStatus>(
            builtInDefaults.map(status => [status.id, status])
        );

        const normalized: KanbanStatus[] = [];
        const seenIds = new Set<string>();

        config.forEach((item: any, index: number) => {
            if (!item || typeof item !== 'object') return;

            const id = typeof item.id === 'string' ? item.id.trim() : '';
            const name = typeof item.name === 'string' ? item.name.trim() : '';
            if (!id || !name || seenIds.has(id)) return;

            const fallback = builtInMap.get(id);
            const rawColor = typeof item.color === 'string' ? item.color.trim() : '';
            const color = rawColor || fallback?.color || '#3498db';
            const rawIcon = typeof item.icon === 'string' ? item.icon.trim() : '';
            const icon = rawIcon || fallback?.icon;
            const sort = typeof item.sort === 'number' && Number.isFinite(item.sort)
                ? item.sort
                : index * 10;

            normalized.push({
                id,
                name,
                color,
                icon,
                isFixed: id === 'doing' || id === 'completed' || id === 'abandoned' ? true : item.isFixed === true,
                sort
            });
            seenIds.add(id);
        });

        // doing/completed/abandoned 是系统关键状态，必须存在
        ['doing', 'completed', 'abandoned'].forEach(requiredId => {
            if (seenIds.has(requiredId)) return;
            const fallback = builtInMap.get(requiredId);
            if (fallback) {
                normalized.push({ ...fallback });
                seenIds.add(requiredId);
            }
        });

        if (normalized.length === 0) return null;

        normalized.sort((a, b) => (a.sort || 0) - (b.sort || 0));
        normalized.forEach((status, index) => {
            status.sort = index * 10;
            if (status.id === 'doing' || status.id === 'completed' || status.id === 'abandoned') {
                status.isFixed = true;
            }
        });

        return normalized;
    }

    public getDefaultKanbanStatuses(): KanbanStatus[] {
        try {
            const globalStatuses = this.normalizeGlobalKanbanStatuses(
                this.plugin?.settings?.globalKanbanStatuses
            );
            if (globalStatuses && globalStatuses.length > 0) {
                return globalStatuses;
            }
        } catch (error) {
            console.warn('读取全局看板状态配置失败，使用内置默认状态:', error);
        }

        return this.getBuiltInDefaultKanbanStatuses();
    }

    /**
     * 获取项目的看板状态配置
     * 如果没有自定义配置，返回默认配置
     */
    public async getProjectKanbanStatuses(projectId: string): Promise<KanbanStatus[]> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            const project = projectData[projectId];
            const customStatuses = project?.kanbanStatuses;

            // 如果有自定义配置，合并默认固定状态和自定义状态
            if (customStatuses && Array.isArray(customStatuses) && customStatuses.length > 0) {
                const defaults = this.getDefaultKanbanStatuses();

                // 分离已保存的固定状态配置和非固定状态
                const savedFixedConfigs = customStatuses.filter(s => s.isFixed === true);
                const customNonFixed = customStatuses.filter(s => s.isFixed === false).map(status => {
                    // 如果名称是默认名称，自动更换为 i18n 文本
                    if (this.isDefaultStatusName(status.id, status.name)) {
                        const defaultStatus = defaults.find(d => d.id === status.id);
                        if (defaultStatus) {
                            return { ...status, name: defaultStatus.name };
                        }
                    }
                    return status;
                });

                // 合并固定状态：使用默认配置，但应用保存的自定义配置
                const fixedStatuses = defaults.filter(s => s.isFixed).map(defaultStatus => {
                    const savedConfig = savedFixedConfigs.find(s => s.id === defaultStatus.id);
                    if (savedConfig) {
                        // 如果保存的名称是默认名称，则使用当前语言的 i18n 文本
                        const name = this.isDefaultStatusName(defaultStatus.id, savedConfig.name)
                            ? defaultStatus.name
                            : savedConfig.name;

                        // 使用保存的图标、颜色和排序
                        return {
                            ...defaultStatus,
                            name: name,
                            icon: savedConfig.icon,
                            color: savedConfig.color,
                            sort: savedConfig.sort
                        };
                    }
                    return defaultStatus;
                });

                return [...fixedStatuses, ...customNonFixed].sort((a, b) => a.sort - b.sort);
            }

            // 返回默认配置
            return this.getDefaultKanbanStatuses();
        } catch (error) {
            console.error('获取项目看板状态失败:', error);
            return this.getDefaultKanbanStatuses();
        }
    }

    /**
     * 设置项目的看板状态配置
     * 保存所有状态的图标和颜色修改，但固定状态不能删除
     */
    public async setProjectKanbanStatuses(projectId: string, statuses: KanbanStatus[]): Promise<void> {
        try {
            const projectData = await this.plugin.loadProjectData() || {};
            if (projectData[projectId]) {
                // 获取默认配置用于对比
                const defaults = this.getDefaultKanbanStatuses();

                // 构建要保存的状态列表 - 只保存非固定状态
                // 固定状态的修改会在保存时特殊处理，但只保存非固定状态到数据库
                const statusesToSave: KanbanStatus[] = [];

                for (const status of statuses) {
                    if (status.isFixed) {
                        // 固定状态：只保存修改的配置（图标、颜色、排序），不保存完整默认配置
                        // 这样加载时可以从数据库读取固定状态的自定义配置
                        statusesToSave.push({
                            id: status.id,
                            name: status.name,
                            color: status.color,
                            icon: status.icon,
                            isFixed: true,
                            sort: status.sort
                        });
                    } else {
                        // 非固定状态完整保存
                        statusesToSave.push({
                            ...status,
                            isFixed: false
                        });
                    }
                }

                projectData[projectId].kanbanStatuses = statusesToSave;
                await this.plugin.saveProjectData(projectData);
            }
        } catch (error) {
            console.error('设置项目看板状态失败:', error);
            throw error;
        }
    }

    /**
     * 生成自定义看板状态ID
     */
    public generateKanbanStatusId(): string {
        return `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}
