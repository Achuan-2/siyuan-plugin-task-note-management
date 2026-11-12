import { i18n } from '../pluginInstance';
import { getLocaleTag, getLogicalDateString, getRelativeDateString } from './dateUtils';

/** 侧栏和项目视图共用完成时间格式，按插件的一天起始时间判断今天和昨天。 */
export function formatTaskCompletedTime(completedTime: string): string {
    const date = new Date(completedTime.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return completedTime;

    const day = getLogicalDateString(date);
    const time = date.toLocaleTimeString(getLocaleTag(), { hour: '2-digit', minute: '2-digit' });
    if (day === getLogicalDateString()) return `${i18n('today')} ${time}`;
    if (day === getRelativeDateString(-1)) return `${i18n('yesterday')} ${time}`;

    const dateText = date.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' });
    return `${dateText} ${time}`;
}
