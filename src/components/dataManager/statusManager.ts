
import { i18n } from '../../pluginInstance';

export interface Status {
    id: string;
    name: string;
    icon?: string;
    isArchived: boolean; // 标识是否是归档状态（默认在全部项目等视图中隐藏）
    includeInBadge?: boolean; // 是否计入侧栏项目徽章
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
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;

    private constructor(plugin: any) {
        this.plugin = plugin;
    }

    public static getInstance(plugin?: any): StatusManager {
        if (!StatusManager.instance) {
            StatusManager.instance = new StatusManager(plugin);
        } else if (plugin && StatusManager.instance.plugin !== plugin) {
            StatusManager.instance.plugin = plugin;
            StatusManager.instance.initialized = false;
            StatusManager.instance.initPromise = null;
        }
        return StatusManager.instance;
    }

    public async initialize(force: boolean = false): Promise<void> {
        if (this.initialized && !force) return;
        if (!force && this.initPromise) return this.initPromise;
        const pending = (async () => {
            try {
                await this.loadStatuses();
                this.initialized = true;
            } catch (error) {
                console.error("Failed to initialize statuses:", error);
                this.statuses = getLocalizedDefaultStatuses();
                await this.saveStatuses();
                this.initialized = true;
            }
        })();
        this.initPromise = pending;
        try {
            await pending;
        } finally {
            if (this.initPromise === pending) this.initPromise = null;
        }
    }

    public async loadStatuses(): Promise<Status[]> {
        try {
            const content = await this.plugin.loadProjectStatus();
            if (!content) {
                console.log("Status file is missing; creating default statuses");
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
                console.log("Invalid status data; using default statuses");
                this.statuses = getLocalizedDefaultStatuses();
                await this.saveStatuses();
            }
        } catch (error) {
            console.warn("Failed to load status file; using default statuses:", error);
            this.statuses = [...DEFAULT_STATUSES];
            await this.saveStatuses();
        }

        return this.statuses;
    }

    public async saveStatuses(): Promise<void> {
        try {
            await this.plugin.saveProjectStatus(this.statuses);
        } catch (error) {
            console.error("Failed to save statuses:", error);
            throw error;
        }
    }

    public getStatuses(): Status[] {
        return [...this.statuses];
    }

    public getStatusById(id: string): Status | undefined {
        return this.statuses.find(s => s.id === id);
    }

    public isBuiltInArchivedStatus(id?: string): boolean {
        return id === 'archived';
    }

    public isArchivedStatus(id?: string): boolean {
        if (!id) return false;
        const status = this.getStatusById(id);
        if (status) {
            return Boolean(status.isArchived);
        }
        return id === 'archived';
    }

    public async addStatus(status: Omit<Status, 'id' | 'isArchived'> & { isArchived?: boolean }): Promise<Status> {
        const newStatus: Status = {
            ...status,
            id: `status_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            isArchived: Boolean(status.isArchived)
        };

        this.statuses.push(newStatus);
        await this.saveStatuses();
        return newStatus;
    }

    public async updateStatus(id: string, updates: Partial<Omit<Status, 'id'>>): Promise<boolean> {
        const index = this.statuses.findIndex(s => s.id === id);
        if (index === -1) {
            return false;
        }

        const nextStatus: Status = { ...this.statuses[index], ...updates };
        if (this.isBuiltInArchivedStatus(nextStatus.id)) {
            nextStatus.isArchived = true;
        }
        this.statuses[index] = nextStatus;
        await this.saveStatuses();
        return true;
    }

    public async deleteStatus(id: string): Promise<boolean> {
        const index = this.statuses.findIndex(s => s.id === id);
        if (index === -1) {
            return false;
        }

        // 不允许删除内置归档状态
        if (this.isBuiltInArchivedStatus(this.statuses[index].id)) {
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
