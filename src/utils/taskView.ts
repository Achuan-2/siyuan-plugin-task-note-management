import type { ReminderItem } from '../types/reminder';
import { TaskHierarchyIndex } from './taskHierarchy';
import { parseSiyuanTaskTitle } from './taskTitleLinks';

export const TASK_VIEW_TYPE = 'task-view';
export const TASK_VIEW_CONTENT_PREFIX = 'Task view v1 ';

export interface TaskViewFilters {
    projectId: string;
    status: 'all' | 'open' | 'completed';
    start: string;
    end: string;
}

export const DEFAULT_TASK_VIEW_FILTERS: TaskViewFilters = {
    projectId: '',
    status: 'all',
    start: '',
    end: '',
};

export interface TaskViewRow {
    task: ReminderItem;
    depth: number;
    matches: boolean;
}

export function parseTaskViewFilters(content: string): TaskViewFilters | undefined {
    if (!content.startsWith(TASK_VIEW_CONTENT_PREFIX)) return;
    try {
        const config = JSON.parse(content.slice(TASK_VIEW_CONTENT_PREFIX.length).split('\n', 1)[0]);
        const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
        return {
            projectId: typeof config.projectId === 'string' ? config.projectId : '',
            status: config.status === 'open' || config.status === 'completed' ? config.status : 'all',
            start: date(config.start),
            end: date(config.end),
        };
    } catch {
        return;
    }
}

export function getTaskViewTitle(task: ReminderItem): string {
    const title = typeof task.title === 'string' ? task.title : '';
    return (parseSiyuanTaskTitle(title)?.title ?? title).replace(/[\s\u0000]/g, ' ').trim();
}

function matchesFilters(task: ReminderItem, filters: TaskViewFilters): boolean {
    if (filters.projectId && task.projectId !== filters.projectId) return false;
    if (filters.status !== 'all' && Boolean(task.completed) !== (filters.status === 'completed')) return false;
    if (!filters.start && !filters.end) return true;
    const start = task.date || task.endDate;
    const end = task.endDate || task.date;
    return Boolean(start && end && (!filters.start || end >= filters.start) && (!filters.end || start <= filters.end));
}

export function getTaskViewRows(tasks: ReminderItem[], filters: TaskViewFilters, query = ''): TaskViewRow[] {
    const hierarchy = new TaskHierarchyIndex(tasks);
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = new Set<string>();
    const visible = new Set<string>();

    for (const task of tasks) {
        if (!matchesFilters(task, filters)) continue;
        if (terms.length) {
            const searchable = [getTaskViewTitle(task), task.noteSummary || task.note].join(' ').toLowerCase();
            if (!terms.every(term => searchable.includes(term))) continue;
        }
        matches.add(task.id);
        let ancestor = task;
        while (ancestor && !visible.has(ancestor.id)) {
            visible.add(ancestor.id);
            ancestor = hierarchy.byId.get(ancestor.parentId);
        }
    }

    const rows: TaskViewRow[] = [];
    const visited = new Set<string>();
    const appendBranch = (root: ReminderItem) => {
        const stack = [{ task: root, depth: 0 }];
        while (stack.length) {
            const { task, depth } = stack.pop()!;
            if (!visible.has(task.id) || visited.has(task.id)) continue;
            visited.add(task.id);
            rows.push({ task, depth, matches: matches.has(task.id) });
            const children = hierarchy.children(task.id);
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ task: children[i], depth: depth + 1 });
            }
        }
    };
    for (const task of tasks) {
        if (!visible.has(task.parentId)) appendBranch(task);
    }
    // 导入或旧数据中存在循环时，每项仍最多显示一次。
    for (const task of tasks) {
        appendBranch(task);
    }
    return rows;
}

export function serializeTaskView(filters: TaskViewFilters, tasks: ReminderItem[]): string {
    const titles = new Set<string>();
    for (const { task } of getTaskViewRows(tasks, filters)) {
        const title = getTaskViewTitle(task);
        if (title) titles.add(title);
    }
    return [
        TASK_VIEW_CONTENT_PREFIX + JSON.stringify(filters),
        ...Array.from(titles).sort().map(title => '- ' + title),
    ].join('\n');
}
