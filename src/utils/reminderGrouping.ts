export type ReminderGroupMode = 'none' | 'project' | 'category' | 'date' | 'priority';

export interface ReminderGroup {
    key: string;
    title: string;
    order: number;
    parent?: { key: 'today' | 'daily'; order: number };
}

export function normalizeReminderGroupMode(value: unknown): ReminderGroupMode {
    return value === 'project' || value === 'category' || value === 'date' || value === 'priority'
        ? value : 'none';
}

/** 只按可见根任务分组，子任务保持原有顺序并跟随根任务。 */
export function orderRemindersByGroup<T extends { id: string; parentId?: string }>(
    reminders: T[], getGroup: (root: T) => ReminderGroup,
): T[] {
    const byId = new Map(reminders.map(task => [task.id, task]));
    const groupById = new Map<string, ReminderGroup>();
    const resolveGroup = (task: T): ReminderGroup => {
        const path: T[] = [];
        const visited = new Set<string>();
        let root = task;
        while (!groupById.has(root.id) && root.parentId && byId.has(root.parentId) && !visited.has(root.id)) {
            visited.add(root.id);
            path.push(root);
            root = byId.get(root.parentId)!;
        }
        const group = groupById.get(root.id) || getGroup(root);
        groupById.set(root.id, group);
        path.forEach(item => groupById.set(item.id, group));
        return group;
    };
    // Map 保留组首次出现的顺序；order 相同时不打乱原有排序。
    const groups = new Map<string, { group: ReminderGroup; tasks: T[] }>();
    reminders.forEach(task => {
        const group = resolveGroup(task);
        if (!groups.has(group.key)) groups.set(group.key, { group, tasks: [] });
        groups.get(group.key)!.tasks.push(task);
    });
    return [...groups.values()]
        .sort((a, b) => (a.group.parent?.order ?? 0) - (b.group.parent?.order ?? 0) || a.group.order - b.group.order)
        .flatMap(group => group.tasks);
}
