export type CompletedTaskPosition = 'top' | 'bottom';

const TASK_ITEM = '[data-type="NodeListItem"][data-subtype="t"]';
const TASK_LIST = '[data-type="NodeList"][data-subtype="t"]';

export interface TaskListSortTarget {
    id: string;
    kind: 'list' | 'item';
}

export interface TaskMoveOperation {
    action: 'move';
    id: string;
    parentID: string;
    previousID: string;
}

function taskMarker(item: Element): string {
    return item.getAttribute('data-task') ??
        item.querySelector(':scope > .protyle-action--task[data-task]')?.getAttribute('data-task') ?? ' ';
}

/** 列表项整理其同级任务列表；聚焦视图缺少父列表时，通过接口解析。 */
export function getTaskListSortTargets(blocks: HTMLElement[]): TaskListSortTarget[] {
    const targets = new Map<string, TaskListSortTarget>();
    for (const block of blocks) {
        if (!block.matches(TASK_LIST) && !block.matches(TASK_ITEM)) continue;
        const parent = block.parentElement;
        const list = block.matches(TASK_LIST) ? block : parent?.matches(TASK_LIST) ? parent : null;
        const id = (list || block).getAttribute('data-node-id');
        if (!id) continue;
        const kind = list ? 'list' : 'item';
        targets.set(`${kind}:${id}`, { id, kind });
    }
    return [...targets.values()];
}

/** 仅移动完成项；置底时追加到已有完成区末尾，不重写正文或拆开任务子树。 */
export function createTaskSortPlan(list: HTMLElement, position: CompletedTaskPosition, changedIds?: ReadonlySet<string>) {
    const parentID = list.dataset.nodeId;
    const items = Array.from(list.children).filter(child => child.getAttribute('data-type') === 'NodeListItem');
    if (!parentID || !list.matches(TASK_LIST) || items.some(item => !item.matches(TASK_ITEM))) return null;
    const ids = items.map(item => item.getAttribute('data-node-id') || '');
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
    const completed = items.filter(item => taskMarker(item).toUpperCase() === 'X').map(item => item.getAttribute('data-node-id')!);
    const done = new Set(completed);
    const remaining = ids.filter(id => !done.has(id));
    const desired = position === 'top' ? [...completed, ...remaining] : [...remaining, ...completed];
    if (!changedIds && ids.every((id, index) => id === desired[index])) return null;

    const current = [...ids];
    const doOperations: TaskMoveOperation[] = [];
    const undoOperations: TaskMoveOperation[] = [];
    // 最后一个未完成任务之后是已有完成区，保持原位，只追加上方的完成项。
    const moving = changedIds
        ? completed.filter(id => changedIds.has(id))
        : position === 'bottom'
            ? ids.slice(0, ids.indexOf(remaining.at(-1)!)).filter(id => done.has(id))
            : [...completed];
    if (position === 'top') moving.reverse();
    for (const id of moving) {
        const index = current.indexOf(id);
        if (position === 'bottom' && index === current.length - 1) continue;
        const oldPreviousID = current[index - 1] || '';
        const previousID = position === 'bottom' ? current.at(-1)! : '';
        if (oldPreviousID !== previousID) {
            doOperations.push({ action: 'move', id, parentID, previousID });
            undoOperations.unshift({ action: 'move', id, parentID, previousID: oldPreviousID });
            current.splice(index, 1);
            current.splice(previousID ? current.indexOf(previousID) + 1 : 0, 0, id);
        }
    }
    return doOperations.length ? { doOperations, undoOperations } : null;
}

export async function sortTaskLists(targets: TaskListSortTarget[], position: CompletedTaskPosition,
    request: (url: string, data: Record<string, unknown>) => Promise<any>,
    context: { app: string; session: string }, canSort: () => boolean): Promise<void> {
    const ids = new Set<string>();
    for (const target of targets) {
        if (!canSort()) return;
        const id = target.kind === 'list' ? target.id :
            (await request('/api/block/getBlockSiblingID', { id: target.id }))?.parent;
        if (id) ids.add(id);
    }
    for (const id of ids) {
        if (!canSort()) return;
        // 编辑区可能折叠或分页，使用完整的最新快照计算排序位置。
        const response = await request('/api/block/getBlockDOM', { id });
        if (!canSort()) return;
        const parsed = new DOMParser().parseFromString(response?.dom || '', 'text/html');
        const list = Array.from(parsed.querySelectorAll<HTMLElement>(TASK_LIST)).find(node => node.dataset.nodeId === id);
        if (!list) continue;
        const plan = createTaskSortPlan(list, position);
        if (!plan) continue;
        await request('/api/transactions', { ...context, reqId: Date.now(), transactions: [plan] });
    }
}
