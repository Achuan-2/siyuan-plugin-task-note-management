import { showMessage } from 'siyuan';
import { ReminderPanel } from '../panel/ReminderPanel';
import { i18n } from '../../pluginInstance';
import { getLogicalDateString } from '../../utils/dateUtils';
import { getEnvironmentSafeAllReminders } from '../../utils/reminderLoadUtils';
import { ReminderTaskLogic } from '../../utils/reminderTaskLogic';

/** 直接使用任务管理侧栏，复用内置/自定义过滤器、分类、搜索、排序及任务卡片。 */
export async function mountPomodoroTaskPicker(container: HTMLElement, plugin: any,
    onSelected: (task: any) => Promise<void>): Promise<{ destroy(): void }> {
    container.replaceChildren();
    return new ReminderPanel(container, plugin, undefined, {
        onSelectTask: async task => {
            const [data, settings, holidays] = await Promise.all([
                getEnvironmentSafeAllReminders(plugin), plugin.loadSettings?.(), plugin.loadHolidayData?.()
            ]);
            if (!container.isConnected) return;
            const current = data[task.id] || ReminderTaskLogic.generateAllRemindersWithInstances(
                data, getLogicalDateString(), settings, holidays).find(item => item.id === task.id);
            if (!current) {
                showMessage(i18n('pomodoroTaskUnavailable'), 3000, 'error');
                return;
            }
            await onSelected(current);
        }
    });
}
