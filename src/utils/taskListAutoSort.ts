import { createTaskSortPlan, type CompletedTaskPosition, type TaskListSortTarget } from './taskListSort';

export const TASK_LIST_AUTO_SORT_ATTR = 'custom-task-note-auto-sort';
export const TASK_LIST_AUTO_SORT_DELAY = 400;
const TASK_LIST = '[data-type="NodeList"][data-subtype="t"]';
const TASK_ITEM = '[data-type="NodeListItem"][data-subtype="t"]';

interface AutoSortState {
    id: string;
    position: CompletedTaskPosition | null;
    override: CompletedTaskPosition | 'off' | null;
}

interface AutoSortOptions {
    request: (url: string, data: Record<string, unknown>) => Promise<any>;
    enqueue: (work: () => Promise<void>) => Promise<void>;
    context: { app: string; session: string };
    canSort: () => boolean;
    getGlobalPosition: () => CompletedTaskPosition | null;
    onError: (error: unknown) => void;
}

function parseDOM(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
}

function overrideOf(list: Element): AutoSortState['override'] {
    const value = list.getAttribute(TASK_LIST_AUTO_SORT_ATTR);
    return value === 'bottom' || value === 'top' || value === 'off' ? value : null;
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

/** 列表自身设置优先于全局默认值，不继承父级列表的单独设置。 */
export class TaskListAutoSorter {
    private readonly pendingIds = new Set<string>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;

    constructor(private readonly options: AutoSortOptions) {}

    private canSort(): boolean {
        return !this.disposed && this.options.canSort();
    }

    destroy(): void {
        this.disposed = true;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        this.pendingIds.clear();
    }

    private async readList(id: string): Promise<HTMLElement | undefined> {
        const response = await this.options.request('/api/block/getBlockDOM', { id });
        return Array.from(parseDOM(response?.dom || '').querySelectorAll<HTMLElement>(TASK_LIST))
            .find(list => list.dataset.nodeId === id);
    }

    private getState(list: HTMLElement): AutoSortState {
        const override = overrideOf(list);
        return {
            id: list.dataset.nodeId!, override,
            position: override === 'off' ? null : override ?? this.options.getGlobalPosition(),
        };
    }

    async getStates(targets: TaskListSortTarget[]): Promise<AutoSortState[]> {
        const ids = new Set<string>();
        for (const target of targets) {
            const id = target.kind === 'list' ? target.id :
                (await this.options.request('/api/block/getBlockRelevantIDs', { id: target.id }))?.parentID;
            if (id) ids.add(id);
        }
        const states: AutoSortState[] = [];
        for (const id of ids) {
            const list = await this.readList(id);
            if (list) states.push(this.getState(list));
        }
        return states;
    }

    async toggle(targets: TaskListSortTarget[], position: CompletedTaskPosition, canEdit: () => boolean): Promise<void> {
        await this.updateOverride(targets, states => states.every(state => state.position !== null) ? 'off' : position, canEdit);
    }

    private async updateOverride(targets: TaskListSortTarget[],
        getOverride: (states: AutoSortState[]) => AutoSortState['override'], canEdit: () => boolean): Promise<void> {
        await this.options.enqueue(async () => {
            if (!this.canSort() || !canEdit()) return;
            const states = await this.getStates(targets);
            const override = getOverride(states);
            for (const state of states) {
                if (!this.canSort() || !canEdit()) return;
                await this.options.request('/api/attr/setBlockAttrs', {
                    id: state.id, attrs: { [TASK_LIST_AUTO_SORT_ATTR]: override ?? '' },
                });
                const position = override === 'off' ? null : override ?? this.options.getGlobalPosition();
                if (position && position !== state.position) await this.reconcileList(state.id, canEdit);
            }
        });
    }

    /** 仅在开启全局排序或切换方向时分批整理已有列表，不在编辑过程中全库扫描。 */
    async reconcileGlobal(): Promise<void> {
        let cursor = '';
        while (this.canSort() && this.options.getGlobalPosition()) {
            const rows = await this.options.request('/api/query/sql', {
                stmt: `SELECT id FROM blocks WHERE type = 'l' AND subtype = 't' AND id > '${cursor.replace(/'/g, "''")}' ORDER BY id LIMIT 64`,
            });
            if (!Array.isArray(rows) || !rows.length) return;
            for (const row of rows) {
                if (!this.canSort() || !this.options.getGlobalPosition()) return;
                // 每个列表独立排队，允许勾选、关闭块开关等交互穿插执行。
                await this.options.enqueue(() => this.reconcileList(row.id));
            }
            const next = rows.at(-1)?.id;
            if (rows.length < 64 || typeof next !== 'string' || next <= cursor) return;
            cursor = next;
        }
    }

    private async reconcileList(id: string, canEdit = () => true): Promise<void> {
        if (!this.canSort() || !canEdit()) return;
        const list = await this.readList(id);
        const position = list && this.getState(list).position;
        if (!list || !position || !this.canSort() || !canEdit()) return;
        const plan = createTaskSortPlan(list, position);
        if (plan) await this.options.request('/api/transactions', {
            ...this.options.context, reqId: Date.now(), transactions: [plan],
        });
    }

    handleTransactions(event: any): void {
        // 由编辑操作的发起端负责排序，避免多个客户端处理同一条广播。
        if (!this.canSort() || (event?.app && event.app !== this.options.context.app)) return;
        const changedIds = getNewlyCompletedTaskIds(event);
        if (!changedIds.length) return;
        for (const id of changedIds) this.pendingIds.add(id);
        if (this.timer !== null) clearTimeout(this.timer);
        // 保留勾选反馈，连续勾选在最后一次操作后统一整理。
        this.timer = setTimeout(() => {
            this.timer = null;
            const completed = [...this.pendingIds];
            this.pendingIds.clear();
            this.sortCompleted(completed);
        }, TASK_LIST_AUTO_SORT_DELAY);
    }

    private sortCompleted(changedIds: string[]): void {
        void this.options.enqueue(async () => {
            const byList = new Map<string, Set<string>>();
            for (const id of changedIds) {
                if (!this.canSort()) return;
                // SiblingID 的 parent 会跳过列表层；RelevantIDs 才返回直接父列表。
                const parent = (await this.options.request('/api/block/getBlockRelevantIDs', { id }))?.parentID;
                if (!parent) continue;
                if (!byList.has(parent)) byList.set(parent, new Set());
                byList.get(parent)!.add(id);
            }
            for (const [id, completed] of byList) {
                if (!this.canSort()) return;
                const list = await this.readList(id);
                const position = list && this.getState(list).position;
                if (!list || !position || !this.canSort()) continue;
                const plan = createTaskSortPlan(list, position, completed);
                if (!plan) continue;
                await this.options.request('/api/transactions', {
                    ...this.options.context, reqId: Date.now(), transactions: [plan],
                });
            }
        }).catch(this.options.onError);
    }
}
