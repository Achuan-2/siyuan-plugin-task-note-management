import { getPluginInstance } from '../../pluginInstance';
export interface HabitGroup {
    id: string;
    name: string;
    color?: string;
    icon?: string;
    order: number;
    createdAt: string;
    updatedAt: string;
}

export class HabitGroupManager {
    private static instance: HabitGroupManager;
    private groups: Map<string, HabitGroup> = new Map();
    private initialized: boolean = false;

    private constructor() { }

    static getInstance(): HabitGroupManager {
        if (!HabitGroupManager.instance) {
            HabitGroupManager.instance = new HabitGroupManager();
        }
        return HabitGroupManager.instance;
    }

    async initialize(force: boolean = false) {
        if (this.initialized && !force) return;

        try {
            // 使用插件实例加载数据
            const plugin = getPluginInstance();
            if (!plugin) {
                console.warn('HabitGroupManager: plugin instance not found during initialize');
                return;
            }
            const groupsArray: HabitGroup[] = await plugin.loadHabitGroupData();

            this.groups.clear();
            if (Array.isArray(groupsArray)) {
                groupsArray.forEach(group => {
                    // 兼容旧数据，如果没有order则默认为0
                    if (group.order === undefined) {
                        group.order = 0;
                    }
                    this.groups.set(group.id, group);
                });
            }
            this.initialized = true;
        } catch (error) {
            console.error("Failed to initialize habit group manager:", error);
            this.groups.clear();
            this.initialized = true;
        }
    }

    async saveGroups() {
        try {
            // 使用插件实例保存数据
            const plugin = getPluginInstance();
            if (!plugin) {
                console.warn('HabitGroupManager: plugin instance not found during saveGroups');
                return;
            }
            const groupsArray = Array.from(this.groups.values());
            await plugin.saveHabitGroupData(groupsArray);
        } catch (error) {
            console.error("Failed to save habit group:", error);
            throw error;
        }
    }

    getAllGroups(): HabitGroup[] {
        return Array.from(this.groups.values()).sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }
            return a.createdAt.localeCompare(b.createdAt);
        });
    }

    getGroupById(id: string): HabitGroup | undefined {
        return this.groups.get(id);
    }

    async addGroup(group: Omit<HabitGroup, 'id' | 'createdAt' | 'updatedAt' | 'order'>): Promise<HabitGroup> {
        const now = new Date().toISOString();

        // 计算最大order
        let maxOrder = -1;
        this.groups.forEach(g => {
            if (g.order > maxOrder) maxOrder = g.order;
        });

        const newGroup: HabitGroup = {
            ...group,
            id: `habit-group-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            order: maxOrder + 1,
            createdAt: now,
            updatedAt: now
        };

        this.groups.set(newGroup.id, newGroup);
        await this.saveGroups();
        return newGroup;
    }

    async updateGroup(id: string, updates: Partial<Omit<HabitGroup, 'id' | 'createdAt'>>): Promise<void> {
        const group = this.groups.get(id);
        if (!group) {
            throw new Error(`分组不存在: ${id}`);
        }

        const updatedGroup: HabitGroup = {
            ...group,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        this.groups.set(id, updatedGroup);
        await this.saveGroups();
    }

    async updateGroupOrder(groupIds: string[]): Promise<void> {
        let changed = false;
        groupIds.forEach((id, index) => {
            const group = this.groups.get(id);
            if (group && group.order !== index) {
                group.order = index;
                group.updatedAt = new Date().toISOString();
                changed = true;
            }
        });

        if (changed) {
            await this.saveGroups();
        }
    }

    async deleteGroup(id: string): Promise<void> {
        if (!this.groups.has(id)) {
            throw new Error(`分组不存在: ${id}`);
        }

        this.groups.delete(id);
        await this.saveGroups();
    }

    groupExists(name: string, excludeId?: string): boolean {
        return Array.from(this.groups.values()).some(
            group => group.name === name && group.id !== excludeId
        );
    }
}
