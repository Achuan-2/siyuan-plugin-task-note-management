import { showMessage } from 'siyuan';
import { i18n } from '../pluginInstance';

const activeToasts = new WeakMap<object, () => void>();
const UNDO_DURATION = 6000;

export function dismissTaskUndo(plugin: object): void {
    activeToasts.get(plugin)?.();
}

export function showTaskUndoToast(plugin: object, message: string, undo: () => Promise<boolean>): void {
    dismissTaskUndo(plugin);
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
        if (activeToasts.get(plugin) === close) activeToasts.delete(plugin);
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
            const undone = await undo();
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
    activeToasts.set(plugin, close);
    timer = setTimeout(close, UNDO_DURATION);
}
