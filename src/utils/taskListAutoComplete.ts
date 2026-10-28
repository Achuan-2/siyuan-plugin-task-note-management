import { getNewlyCompletedTaskIds } from './taskListAutoSort';

const TASK_ITEM = '[data-type="NodeListItem"][data-subtype="t"]';

interface AutoCompleteOptions {
    request: (url: string, data: Record<string, unknown>) => Promise<any>;
    enqueue: (work: () => Promise<void>) => Promise<void>;
    app: string;
    canComplete: () => boolean;
    onError: (error: unknown) => void;
}

function isCompleted(item: Element): boolean {
    const marker = item.getAttribute('data-task') ??
        item.querySelector(':scope > .protyle-action--task[data-task]')?.getAttribute('data-task') ?? ' ';
    return marker.toUpperCase() === 'X';
}

/** 完成文档中的父任务列表项后，使用块标记接口勾选全部后代，不改动插件任务数据。 */
export class TaskListAutoCompleter {
    private disposed = false;

    constructor(private readonly options: AutoCompleteOptions) {}

    destroy(): void {
        this.disposed = true;
    }

    private canComplete(): boolean {
        return !this.disposed && this.options.canComplete();
    }

    handleTransactions(event: any): void {
        // 只由操作发起端处理；不响应移动、正文编辑、撤销或取消勾选。
        if (!this.canComplete() || (event?.app && event.app !== this.options.app)) return;
        const parentIds = getNewlyCompletedTaskIds(event);
        if (!parentIds.length) return;
        void this.options.enqueue(async () => {
            for (const id of parentIds) {
                if (!this.canComplete()) return;
                // 读取完整快照，包含折叠、分页和聚焦视图中尚未渲染的子项。
                const response = await this.options.request('/api/block/getBlockDOM', { id });
                if (!this.canComplete()) return;
                const document = new DOMParser().parseFromString(response?.dom || '', 'text/html');
                const parent = Array.from(document.querySelectorAll(TASK_ITEM))
                    .find(item => item.getAttribute('data-node-id') === id);
                // 排队期间父项可能已取消勾选或被删除。
                if (!parent || !isCompleted(parent)) continue;
                const childIds = new Set(Array.from(parent.querySelectorAll(TASK_ITEM))
                    .filter(item => !isCompleted(item))
                    .map(item => item.getAttribute('data-node-id'))
                    .filter((childId): childId is string => !!childId));
                if (!childIds.size) continue;
                await this.options.request('/api/block/batchUpdateTaskListItemMarker', {
                    items: Array.from(childIds, childId => ({ id: childId, marker: 'x' })),
                });
            }
        }).catch(this.options.onError);
    }
}
