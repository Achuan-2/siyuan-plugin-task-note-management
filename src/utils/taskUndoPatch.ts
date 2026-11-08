export interface TaskUndoPatch {
    path: string[];
    before: any;
    after: any;
}

export function cloneTaskData<T>(value: T): T {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function isObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(a: any, b: any): boolean {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((value, index) => equal(value, b[index]));
    }
    if (!isObject(a) || !isObject(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key =>
        Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
}

/** 任务的创建/删除作为整体记录；已有任务仅记录改变的字段和实例。 */
export function createTaskUndoPatches(before: any, after: any): TaskUndoPatch[] {
    const patches: TaskUndoPatch[] = [];
    const visit = (oldValue: any, newValue: any, path: string[]) => {
        if (equal(oldValue, newValue)) return;
        if (isObject(oldValue) && isObject(newValue)) {
            for (const key of new Set([...Object.keys(oldValue), ...Object.keys(newValue)])) {
                visit(oldValue[key], newValue[key], [...path, key]);
            }
        } else {
            patches.push({ path, before: cloneTaskData(oldValue), after: cloneTaskData(newValue) });
        }
    };
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        visit(before[id], after[id], [id]);
    }
    return patches;
}

/** 出现后续冲突时整体拒绝撤回，避免恢复一半的父子任务状态。 */
export function applyTaskUndoPatches(current: any, patches: TaskUndoPatch[]): any | null {
    for (const patch of patches) {
        const value = patch.path.reduce((item, key) => item?.[key], current);
        if (!equal(value, patch.after)) return null;
        // 已删除的父级不能因撤回某个字段而被重新建成残缺任务。
        let parent = current;
        for (const key of patch.path.slice(0, -1)) {
            if (!isObject(parent?.[key])) return null;
            parent = parent[key];
        }
    }
    const restored = cloneTaskData(current);
    for (const patch of patches) {
        const parent = patch.path.slice(0, -1).reduce((item, key) => item[key], restored);
        const key = patch.path[patch.path.length - 1];
        if (patch.before === undefined) delete parent[key];
        else parent[key] = cloneTaskData(patch.before);
    }
    return restored;
}
