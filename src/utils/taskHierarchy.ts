export interface HierarchyTask {
    id: string;
    parentId?: string;
}

/** 一次计算或渲染使用的快照索引；任务变更后重新建立，不跨刷新缓存。 */
export class TaskHierarchyIndex<T extends HierarchyTask = any> {
    readonly byId = new Map<string, T>();
    readonly childrenByParentId = new Map<string, T[]>();
    readonly tasks: T[];
    private readonly descendantDepths = new Map<string, number>();

    constructor(tasks: Iterable<T>) {
        this.tasks = Array.from(tasks).filter(task => task != null);
        for (const task of this.tasks) {
            this.byId.set(task.id, task);
            if (task.parentId) {
                const children = this.childrenByParentId.get(task.parentId);
                if (children) children.push(task);
                else this.childrenByParentId.set(task.parentId, [task]);
            }
        }
    }

    children(id: string): T[] {
        return this.childrenByParentId.get(id) || [];
    }

    /** 本轮索引内按后序一次计算；避免每张卡片重新遍历子树，也不依赖递归调用栈。 */
    maxDescendantDepth(id: string): number {
        const cached = this.descendantDepths.get(id);
        if (cached !== undefined) return cached;
        const stack = [{ id, expanded: false }];
        const visiting = new Set<string>();
        while (stack.length > 0) {
            const current = stack.pop()!;
            if (this.descendantDepths.has(current.id)) continue;
            const children = this.children(current.id);
            if (current.expanded) {
                let depth = 0;
                for (const child of children) {
                    depth = Math.max(depth, 1 + (this.descendantDepths.get(child.id) || 0));
                }
                this.descendantDepths.set(current.id, depth);
                visiting.delete(current.id);
            } else {
                visiting.add(current.id);
                stack.push({ id: current.id, expanded: true });
                for (const child of children) {
                    if (!visiting.has(child.id) && !this.descendantDepths.has(child.id)) {
                        stack.push({ id: child.id, expanded: false });
                    }
                }
            }
        }
        return this.descendantDepths.get(id) || 0;
    }

    /** 保持原有栈遍历的发现顺序，损坏的循环关系也不会重复返回根任务。 */
    descendantIds(id: string): string[] {
        const result: string[] = [];
        const visited = new Set([id]);
        const stack = [id];
        while (stack.length > 0) {
            for (const child of this.children(stack.pop()!)) {
                if (visited.has(child.id)) continue;
                visited.add(child.id);
                result.push(child.id);
                stack.push(child.id);
            }
        }
        return result;
    }
}
