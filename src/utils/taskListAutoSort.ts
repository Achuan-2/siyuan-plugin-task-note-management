import { createTaskSortPlan, type CompletedTaskPosition, type TaskListSortTarget } from './taskListSort';

export const TASK_LIST_AUTO_SORT_ATTR = 'custom-task-note-auto-sort';
const TASK_LIST = '[data-type="NodeList"][data-subtype="t"]';
const TASK_ITEM = '[data-type="NodeListItem"][data-subtype="t"]';

interface AutoSortState {
    id: string;
    position: CompletedTaskPosition | null;
}

interface AutoSortOptions {
    request: (url: string, data: Record<string, unknown>) => Promise<any>;
    enqueue: (work: () => Promise<void>) => Promise<void>;
    context: { app: string; session: string };
    canSort: () => boolean;
    onError: (error: unknown) => void;
}

function parseDOM(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
}

function positionOf(list: Element): CompletedTaskPosition | null {
    const value = list.getAttribute(TASK_LIST_AUTO_SORT_ATTR);
    return value === 'bottom' || value === 'top' ? value : null;
}

function taskStates(html: string): Map<string, boolean> {
    return new Map(Array.from(parseDOM(html).querySelectorAll(TASK_ITEM)).map(item => [
        item.getAttribute('data-node-id') || '',
        (item.getAttribute('data-task') ?? item.querySelector(':scope > .protyle-action--task[data-task]')?.getAttribute('data-task') ?? ' ').toUpperCase() === 'X',
    ]));
}

/** 只识别已提交事务中从其他状态变为完成的任务；移动、正文编辑和撤销不触发。 */
export function getNewlyCompletedTaskIds(event: any): string[] {
    if (event?.cmd !== 'transactions' || event.context?.isUndoReplay || !Array.isArray(event.data)) return [];
    const changed = new Set<string>();
    for (const transaction of event.data) {
        const before = new Map<string, boolean>();
        for (const operation of transaction.undoOperations || []) {
            if (operation.action !== 'update' || typeof operation.data !== 'string') continue;
            for (const [id, completed] of taskStates(operation.data)) before.set(id, completed);
        }
        for (const operation of transaction.doOperations || []) {
            if (operation.action !== 'update' || typeof operation.data !== 'string') continue;
            for (const [id, completed] of taskStates(operation.data)) {
                if (id && completed && before.get(id) === false) changed.add(id);
            }
        }
    }
    return [...changed];
}

/** 开关保存在列表自身；每次使用最新完整快照，不继承父级或其他列表的设置。 */
export class TaskListAutoSorter {
    constructor(private readonly options: AutoSortOptions) {}

    private async readList(id: string): Promise<HTMLElement | undefined> {
        const response = await this.options.request('/api/block/getBlockDOM', { id });
        return Array.from(parseDOM(response?.dom || '').querySelectorAll<HTMLElement>(TASK_LIST))
            .find(list => list.dataset.nodeId === id);
    }

    async getStates(targets: TaskListSortTarget[]): Promise<AutoSortState[]> {
        const ids = new Set<string>();
        for (const target of targets) {
            const id = target.kind === 'list' ? target.id :
                (await this.options.request('/api/block/getBlockSiblingID', { id: target.id }))?.parent;
            if (id) ids.add(id);
        }
        const states: AutoSortState[] = [];
        for (const id of ids) {
            const list = await this.readList(id);
            if (list) states.push({ id, position: positionOf(list) });
        }
        return states;
    }

    async toggle(targets: TaskListSortTarget[], position: CompletedTaskPosition, canEdit: () => boolean): Promise<void> {
        await this.options.enqueue(async () => {
            if (!this.options.canSort() || !canEdit()) return;
            const states = await this.getStates(targets);
            const enabled = !states.every(state => state.position !== null);
            for (const state of states) {
                if (!this.options.canSort() || !canEdit()) return;
                await this.options.request('/api/attr/setBlockAttrs', {
                    id: state.id, attrs: { [TASK_LIST_AUTO_SORT_ATTR]: enabled ? position : '' },
                });
            }
        });
    }

    handleTransactions(event: any): void {
        // 由编辑操作的发起端负责排序，避免多个客户端处理同一条广播。
        if (!this.options.canSort() || (event?.app && event.app !== this.options.context.app)) return;
        const changedIds = getNewlyCompletedTaskIds(event);
        if (!changedIds.length) return;
        void this.options.enqueue(async () => {
            const byList = new Map<string, Set<string>>();
            for (const id of changedIds) {
                if (!this.options.canSort()) return;
                const parent = (await this.options.request('/api/block/getBlockSiblingID', { id }))?.parent;
                if (!parent) continue;
                if (!byList.has(parent)) byList.set(parent, new Set());
                byList.get(parent)!.add(id);
            }
            for (const [id, completed] of byList) {
                if (!this.options.canSort()) return;
                const list = await this.readList(id);
                const position = list && positionOf(list);
                if (!list || !position || !this.options.canSort()) continue;
                const plan = createTaskSortPlan(list, position, completed);
                if (!plan) continue;
                await this.options.request('/api/transactions', {
                    ...this.options.context, reqId: Date.now(), transactions: [plan],
                });
            }
        }).catch(this.options.onError);
    }
}
