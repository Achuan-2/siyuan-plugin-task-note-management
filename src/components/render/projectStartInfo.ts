import { i18n } from '../../pluginInstance';
import { getLocaleTag, getLogicalDateString } from '../../utils/dateUtils';
import { renderTaskMetadataIcon, renderTaskMetadataText } from './taskMetadataIcons';

/** 统计卡片和详情弹窗共用，与侧栏使用相同的逻辑日期及开始时间文案。 */
export function getProjectStartInfo(startDate?: string, today = getLogicalDateString()) {
    if (!startDate) return null;
    const start = new Date(`${startDate}T00:00:00`);
    const current = new Date(`${today}T00:00:00`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(current.getTime())) return null;

    // 按日历日计算，避免夏令时切换造成一天不足或超过 24 小时。
    const toCalendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((toCalendarDay(current) - toCalendarDay(start)) / 86400000);
    const relativeText = days < 0
        ? i18n('startInDays', { days: String(-days) })
        : days === 0 ? i18n('startToday') : i18n('startedDays', { days: String(days) });

    return {
        dateText: start.toLocaleDateString(getLocaleTag(), { year: 'numeric', month: 'short', day: 'numeric' }),
        relativeText,
        color: days < 0 ? 'var(--b3-font-color2)' : days === 0 ? 'var(--b3-font-color4)' : 'var(--b3-card-success-color)',
        background: days < 0 ? 'var(--b3-font-background2)' : days === 0 ? 'var(--b3-font-background4)' : 'var(--b3-card-success-background)',
    };
}

export function renderProjectStartInfo(startDate?: string, today = getLogicalDateString()): string {
    const info = getProjectStartInfo(startDate, today);
    if (!info) return '';

    return `<div class="project-start-info" style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;">
        <span style="color:${info.color};background:${info.background};border:1px solid currentColor;border-radius:4px;padding:2px 6px;font-weight:500;">${renderTaskMetadataText(info.relativeText)}</span>
        <span style="display:inline-flex;align-items:center;gap:4px;opacity:0.8;">${renderTaskMetadataIcon('calendar')}${renderTaskMetadataText(info.dateText)}</span>
    </div>`;
}
