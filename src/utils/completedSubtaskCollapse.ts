interface CollapsibleTask {
    id: string;
    parentId?: string;
    completed?: boolean;
}

/** 已完成子任务默认收起下级；手动展开仅在当前视图实例中保留。 */
export class CompletedSubtaskCollapseState {
    private expandedTaskIds = new Set<string>();

    sync(tasks: Iterable<CollapsibleTask>): void {
        const retained = new Set<string>();
        for (const task of tasks) {
            if (task.completed && task.parentId && this.expandedTaskIds.has(task.id)) {
                retained.add(task.id);
            }
        }
        this.expandedTaskIds = retained;
    }

    /** undefined 表示沿用视图原有的折叠规则。 */
    getCollapsed(task: CollapsibleTask | undefined, hasChildren: boolean): boolean | undefined {
        if (!task) return undefined;
        if (!task.completed || !task.parentId) {
            this.expandedTaskIds.delete(task.id);
            return undefined;
        }
        return hasChildren ? !this.expandedTaskIds.has(task.id) : undefined;
    }

    setExpanded(task: CollapsibleTask, expanded: boolean): void {
        if (expanded && task.completed && task.parentId) {
            this.expandedTaskIds.add(task.id);
        } else {
            this.expandedTaskIds.delete(task.id);
        }
    }
}
