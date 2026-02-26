
import { i18n } from '../pluginInstance';

export interface Status {
    id: string;
    name: string;
    icon?: string;
    isArchived: boolean; // 标识是否是归档状态
}

const DEFAULT_STATUSES: Status[] = [
    { id: 'active', name: '正在进行', icon: '⏳', isArchived: false },
    { id: 'someday', name: '未来也许', icon: '💭', isArchived: false },
    { id: 'archived', name: '已归档', icon: '📥', isArchived: true }
];

/**
 * 获取本地化默认状态
 */
function getLocalizedDefaultStatuses(): Status[] {
    return [
        { id: 'active', name: i18n('active'), icon: '⏳', isArchived: false },
        { id: 'someday', name: i18n('someday'), icon: '💭', isArchived: false },
        { id: 'archived', name: i18n('archived'), icon: '📥', isArchived: true }
    ];
}

/**
 * 检查状态名称是否为默认名称
 */
function isDefaultStatusName(id: string, name: string): boolean {
    const defaultNames: { [key: string]: string[] } = {
        'active': ['正在进行', 'Doing'],
        'someday': ['未来也许', 'Someday'],
        'archived': ['已归档', 'Archived']
    };
    return defaultNames[id]?.includes(name) || false;
}

export class StatusManager {
    private static instance: StatusManager;
    private statuses: Status[] = [];
    private plugin: any;

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    public static getInstance(plugin?: any): StatusManager {
        if (!StatusManager.instance) {
            StatusManager.instance = new StatusManager(plugin);
        }
        return StatusManager.instance;
    }

    public async initialize(): Promise<void> {
        try {
            await this.loadStatuses();
        } catch (error) {
            console.error('初始化状态失败:', error);
            this.statuses = getLocalizedDefaultStatuses();
            await this.saveStatuses();
        }
    }

    public async loadStatuses(): Promise<Status[]> {
        try {
            const content = await this.plugin.loadProjectStatus();
            if (!content) {
                console.log('状态文件不存在，创建默认状态');
                this.statuses = [...DEFAULT_STATUSES];
                await this.saveStatuses();
                return this.statuses;
            }

            const statusesData = content;

            if (Array.isArray(statusesData) && statusesData.length > 0) {
                const localizedDefaults = getLocalizedDefaultStatuses();
                this.statuses = statusesData.map(status => {
                    // 如果名称是默认名称，自动更换为 i18n 文本
                    if (isDefaultStatusName(status.id, status.name)) {
                        const defaultStatus = localizedDefaults.find(d => d.id === status.id);
                        if (defaultStatus) {
                            return { ...status, name: defaultStatus.name };
                        }
                    }
                    return status;
                });
            } else {
                console.log('状态数据无效，使用默认状态');
                this.statuses = getLocalizedDefaultStatuses();
                await this.saveStatuses();
            }
        } catch (error) {
            console.warn('加载状态文件失败，使用默认状态:', error);
            this.statuses = [...DEFAULT_STATUSES];
            await this.saveStatuses();
        }

        return this.statuses;
    }

    public async saveStatuses(): Promise<void> {
        try {
            await this.plugin.saveProjectStatus(this.statuses);
        } catch (error) {
            console.error('保存状态失败:', error);
            throw error;
        }
    }

    public getStatuses(): Status[] {
        return [...this.statuses];
    }

    public getStatusById(id: string): Status | undefined {
        return this.statuses.find(s => s.id === id);
    }

    public async addStatus(status: Omit<Status, 'id' | 'isArchived'>): Promise<Status> {
        const newStatus: Status = {
            ...status,
            id: `status_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            isArchived: false
        };

        this.statuses.push(newStatus);
        await this.saveStatuses();
        return newStatus;
    }

    public async updateStatus(id: string, updates: Partial<Omit<Status, 'id' | 'isArchived'>>): Promise<boolean> {
        const index = this.statuses.findIndex(s => s.id === id);
        if (index === -1) {
            return false;
        }

        this.statuses[index] = { ...this.statuses[index], ...updates };
        await this.saveStatuses();
        return true;
    }

    public async deleteStatus(id: string): Promise<boolean> {
        const index = this.statuses.findIndex(s => s.id === id);
        if (index === -1) {
            return false;
        }

        // 不允许删除归档状态
        if (this.statuses[index].isArchived) {
            return false;
        }

        this.statuses.splice(index, 1);
        await this.saveStatuses();
        return true;
    }

    public async resetToDefault(): Promise<void> {
        this.statuses = getLocalizedDefaultStatuses();
        await this.saveStatuses();
    }

    public async reorderStatuses(reorderedStatuses: Status[]): Promise<void> {
        if (!Array.isArray(reorderedStatuses)) {
            throw new Error('Reordered statuses must be an array');
        }

        if (reorderedStatuses.length !== this.statuses.length) {
            throw new Error('Reordered statuses count does not match');
        }

        const currentIds = new Set(this.statuses.map(s => s.id));
        const reorderedIds = new Set(reorderedStatuses.map(s => s.id));

        if (currentIds.size !== reorderedIds.size ||
            ![...currentIds].every(id => reorderedIds.has(id))) {
            throw new Error('Reordered status IDs do not match');
        }

        this.statuses = [...reorderedStatuses];
        await this.saveStatuses();
    }
}