import { showMessage } from 'siyuan';
import { updateBindBlockAtrrs } from '../api';
import { i18n } from '../pluginInstance';
import { getAllReminders, saveReminders } from './icsSubscription';
import { cleanReminderItem } from './reminderLoadUtils';
import { applyTaskUndoPatches, cloneTaskData, createTaskUndoPatches, type TaskUndoPatch } from './taskUndoPatch';

const activeToasts = new WeakMap<object, () => void>();
const UNDO_DURATION = 6000;

export function dismissTaskUndo(plugin: object): void {
    activeToasts.get(plugin)?.();
}

export function getTaskStatusUndoMessage(status: string): string {
    if (status === 'completed') return i18n('taskCompleted');
    if (status === 'abandoned') return i18n('taskAbandoned');
    return i18n('statusUpdated');
}

function snapshot(data: any): any {
    const copy = cloneTaskData(data);
    Object.values(copy).forEach(cleanReminderItem);
    return copy;
}

/** 在更改数据之前创建，在写盘及当前视图更新成功后调用 show。 */
export class TaskActionUndo {
    private before: any;
    private patches: TaskUndoPatch[] = [];
    private touchesSubscription = false;

    constructor(private plugin: any, data: any) {
        this.before = snapshot(data);
    }

    async save(data: any): Promise<void> {
        const after = snapshot(data);
        const patches = createTaskUndoPatches(this.before, after);
        this.touchesSubscription = patches.some(({ path }) =>
            [this.before[path[0]], after[path[0]]].some(task => task?.isSubscribed && task.subscriptionId));
        await this.saveChanges(data);
        this.patches = patches;
        this.before = null;
    }

    private async saveChanges(data: any): Promise<void> {
        if (this.touchesSubscription) {
            await saveReminders(this.plugin, data);
            return;
        }
        // 本地操作只写完整的本地任务，避免为撤回一个任务重读、同步所有订阅。
        const localTasks = Object.fromEntries(Object.entries(data).filter(
            ([, task]: [string, any]) => !(task?.isSubscribed && task.subscriptionId)));
        await this.plugin.saveReminderData(localTasks);
    }

    async undo(): Promise<boolean> {
        if (this.patches.length === 0 || this.plugin.storageDisposed) return false;
        // 插件缓存是最新的完整本地数据，不使用可能过期的视图快照。
        // 涉及订阅时仍走严格的全量读取和订阅持久化流程。
        const current = snapshot(this.touchesSubscription
            ? await getAllReminders(this.plugin, undefined, true, undefined, { strict: true })
            : await this.plugin.loadReminderData());
        if (this.plugin.storageDisposed) return false;
        const restored = applyTaskUndoPatches(current, this.patches);
        if (!restored) {
            showMessage(i18n('taskUndoConflict'), 3000, 'error');
            return false;
        }
        await this.saveChanges(restored);
        const taskIds = new Set(this.patches.map(patch => patch.path[0]));
        this.patches = [];
        const blockIds = new Set<string>();
        for (const id of taskIds) {
            for (const task of [current[id], restored[id]]) {
                if (task?.blockId || task?.docId) blockIds.add(task.blockId || task.docId);
                Object.values(task?.repeat?.instances || {}).forEach((state: any) => {
                    if (state?.blockId || state?.docId) blockIds.add(state.blockId || state.docId);
                });
            }
        }
        window.dispatchEvent(new CustomEvent('reminderUpdated', {
            detail: { taskUndo: true, refreshDelayMs: 0 }
        }));
        const effects = [
            () => this.plugin.updateBadges?.(),
            ...Array.from(blockIds, id => () => updateBindBlockAtrrs(id, this.plugin)),
            ...Array.from(taskIds, id => () => restored[id]
                ? this.plugin.updateMobileNotification?.(restored[id])
                : this.plugin.cancelMobileNotification?.(id)),
        ];
        // 数据已落盘，界面和成功提示不必等待这些附带更新。
        void Promise.allSettled(effects.map(effect => Promise.resolve().then(effect))).then(results => {
            results.forEach(result => {
                if (result.status === 'rejected') console.warn('Failed to refresh task after undo:', result.reason);
            });
        });
        return true;
    }

    show(message: string): void {
        if (this.patches.length === 0 || this.plugin.storageDisposed) return;
        dismissTaskUndo(this.plugin);
        const toast = document.createElement('div');
        toast.className = 'task-action-undo';
        const label = document.createElement('span');
        label.setAttribute('role', 'status');
        label.textContent = message;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-action-undo__button';
        button.setAttribute('aria-label', i18n('undoTaskAction'));
        button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 4 9l5 5M4 9h10a6 6 0 0 1 0 12h-4"/></svg>';
        const buttonText = document.createElement('span');
        buttonText.textContent = i18n('undoTaskAction');
        button.append(buttonText);
        toast.append(label, button);
        document.body.append(toast);

        let timer: ReturnType<typeof setTimeout>;
        let busy = false;
        let closed = false;
        const close = () => {
            closed = true;
            clearTimeout(timer);
            toast.remove();
            if (activeToasts.get(this.plugin) === close) activeToasts.delete(this.plugin);
        };
        const pause = () => clearTimeout(timer);
        const resume = () => {
            pause();
            if (!busy && !closed && !toast.matches(':hover') && !toast.contains(document.activeElement)) {
                timer = setTimeout(close, UNDO_DURATION);
            }
        };
        toast.addEventListener('mouseenter', pause);
        toast.addEventListener('mouseleave', resume);
        toast.addEventListener('focusin', pause);
        toast.addEventListener('focusout', resume);
        button.addEventListener('click', async () => {
            if (busy || closed) return;
            busy = true;
            button.disabled = true;
            pause();
            try {
                const undone = await this.undo();
                close();
                if (undone) showMessage(i18n('taskActionUndone'));
            } catch (error) {
                console.error('Failed to undo task action:', error);
                showMessage(i18n('taskUndoFailed'), 3000, 'error');
                busy = false;
                button.disabled = false;
                resume();
            }
        });
        activeToasts.set(this.plugin, close);
        timer = setTimeout(close, UNDO_DURATION);
    }
}
