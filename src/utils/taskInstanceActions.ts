import { i18n } from '../pluginInstance';
import { excludeRepeatInstance } from '../components/dataManager/repeatUtils';
import { TaskActionUndo } from './taskActionUndo';

/** 数据应由调用方从插件最新全量数据读取；只提交一次，界面刷新和提示由视图负责。 */
export async function saveExcludedTaskInstance(
    plugin: any,
    reminderData: Record<string, any>,
    originalId: string,
    instanceDate: string,
): Promise<TaskActionUndo> {
    const original = reminderData[originalId];
    if (!original) throw new Error(i18n('originalEventMissing'));
    if (!original.repeat) throw new Error(i18n('notRecurringEvent'));

    const undo = new TaskActionUndo(plugin, reminderData);
    excludeRepeatInstance(original, instanceDate);
    await undo.save(reminderData);
    return undo;
}
