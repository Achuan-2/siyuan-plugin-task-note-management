export interface HierarchyTask {
    id: string;
    parentId?: string;
}

/** 一次计算或渲染使用的快照索引；任务变更后重新建立，不跨刷新缓存。 */
export class TaskHierarchyIndex<T extends HierarchyTask = any> {
    readonly byId = new Map<string, T>();
    readonly childrenByParentId = new Map<string, T[]>();
    readonly tasks: T[];

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
