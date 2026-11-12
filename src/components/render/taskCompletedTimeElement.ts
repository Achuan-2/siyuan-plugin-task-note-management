import { i18n } from '../../pluginInstance';
import { formatTaskCompletedTime } from '../../utils/taskCompletedTime';
import { setTaskMetadataText } from './taskMetadataIcons';

/** 初次渲染和局部更新共用完成文案、相对日期及 SVG 图标。 */
export function updateTaskCompletedTimeElement(
    element: HTMLElement,
    completedTime: string,
    formatTime: (time: string) => string = formatTaskCompletedTime,
): void {
    setTaskMetadataText(element, `✅ ${i18n('taskCompletedAtTime', { time: formatTime(completedTime) })}`);
}

export function createTaskCompletedTimeElement(
    completedTime?: string,
    formatTime?: (time: string) => string,
): HTMLElement {
    const element = document.createElement('div');
    element.className = 'reminder-item__completed-time';
    element.style.cssText = 'font-size:12px; margin-top:6px; opacity:0.95;';
    if (completedTime) updateTaskCompletedTimeElement(element, completedTime, formatTime);
    else element.textContent = i18n('todayCompleted');
    return element;
}
