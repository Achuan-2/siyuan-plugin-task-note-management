import { Plugin } from "siyuan";
import { renderTomatoIconContent } from "./tomatoIcon";

export function registerCustomIcons(plugin: Plugin) {
    // 任务菜单图标：复用宿主 SVG 尺寸与主题色，优先级保留颜色区分。
    plugin.addIcons(`
        <symbol id="iconTNMerge" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 4h3a5 5 0 0 1 5 5v6a5 5 0 0 0 5 5h3M4 20h3a5 5 0 0 0 5-5m5 2 3 3-3 3"/>
            </g>
        </symbol>
        <symbol id="iconTNPaste" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>
                <rect x="8" y="2" width="8" height="4" rx="1"/>
                <path d="M12 10v8m-3-3 3 3 3-3"/>
            </g>
        </symbol>
        <symbol id="iconTNStopwatch" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="14" r="8"/>
                <path d="M9 2h6m-3 0v4m6 2 2-2m-8 5v4l2 2"/>
            </g>
        </symbol>
        <symbol id="iconTNSkip" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"/>
                <path d="m6 6 12 12"/>
            </g>
        </symbol>
        <symbol id="iconTNStatus" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="5" cy="5" r="2"/>
                <circle cx="5" cy="12" r="2"/>
                <circle cx="5" cy="19" r="2"/>
                <path d="M11 5h10m-10 7h10m-10 7h10"/>
            </g>
        </symbol>
        <symbol id="iconTNMilestoneOutline" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 22V3c5-4 11 4 16 0v12c-5 4-11-4-16 0"/>
            </g>
        </symbol>
        <symbol id="iconTNMilestone" viewBox="0 0 24 24">
            <g fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 22V3"/>
                <path fill="#e74c3c" d="M4 3c5-4 11 4 16 0v12c-5 4-11-4-16 0Z"/>
            </g>
        </symbol>
        <symbol id="iconTNPriority" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 21V3h16l-4 5 4 5H4"/>
            </g>
        </symbol>
        <symbol id="iconTNPriorityHigh" viewBox="0 0 24 24">
            <g fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 21V3h16l-4 5 4 5H4"/>
            </g>
        </symbol>
        <symbol id="iconTNPriorityMedium" viewBox="0 0 24 24">
            <g fill="none" stroke="#f39c12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 21V3h16l-4 5 4 5H4"/>
            </g>
        </symbol>
        <symbol id="iconTNPriorityLow" viewBox="0 0 24 24">
            <g fill="none" stroke="#3498db" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 21V3h16l-4 5 4 5H4"/>
            </g>
        </symbol>
        <symbol id="iconTNPriorityNone" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 21V3m0 0h16l-4 5 4 5H4" stroke-dasharray="3 3"/>
            </g>
        </symbol>
    `);

    plugin.addIcons(`
            <symbol id="iconTNProject" viewBox="0 0 24 24">
                <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
                    <path d="M8 10v4"/>
                    <path d="M12 10v2"/>
                    <path d="M16 10v6"/>
                </g>
            </symbol>
        `);

    plugin.addIcons(`
            <symbol id="iconTNGrid" viewBox="0 0 1024 1024">
            <path d="M513.088 64c10.56 0 19.456 7.04 21.76 16.448l0.64 4.864-0.064 405.312h403.2c11.84 0 21.376 10.048 21.376 22.4 0 10.624-7.04 19.52-16.448 21.824l-4.864 0.64-403.264-0.064v403.2a21.888 21.888 0 0 1-22.4 21.376 22.208 22.208 0 0 1-21.76-16.448l-0.64-4.864V535.424H85.312A21.888 21.888 0 0 1 64 513.088c0-10.56 7.04-19.456 16.448-21.76l4.864-0.64h405.312V85.312c0-11.776 10.048-21.312 22.4-21.312z m317.952 522.688c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712v-179.2c0-32.96 24.32-59.712 54.272-59.712h190.08z m-448 0c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712v-179.2c0-32.96 24.32-59.712 54.272-59.712h190.08z m448 59.712h-190.08v179.2h190.08v-179.2z m-448 0h-190.08v179.2h190.08v-179.2z m448-507.712c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712V198.4c0-32.96 24.32-59.712 54.272-59.712h190.08z m-448 0c29.952 0 54.272 26.752 54.272 59.712v179.2c0 32.96-24.32 59.712-54.272 59.712h-190.08c-29.952 0-54.272-26.752-54.272-59.712V198.4c0-32.96 24.32-59.712 54.272-59.712h190.08z m448 59.712h-190.08v179.2h190.08V198.4z m-448 0h-190.08v179.2h190.08V198.4z" p-id="6019"></path>
            </symbol>
        `);

    plugin.addIcons(`
            <symbol id="iconTNStatistic" viewBox="0 0 24 24">
                <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 3v16a2 2 0 0 0 2 2h16"/>
                    <path d="M18 17V9"/>
                    <path d="M13 17V5"/>
                    <path d="M8 17v-3"/>
                </g>
            </symbol>
        `);

    plugin.addIcons(`
            <symbol id="iconTNHabit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 9.536V7a4 4 0 0 1 4-4h1.5a.5.5 0 0 1 .5.5V5a4 4 0 0 1-4 4 4 4 0 0 0-4 4c0 2 1 3 1 5a5 5 0 0 1-1 3"/>
                <path d="M4 9a5 5 0 0 1 8 4 5 5 0 0 1-8-4"/>
                <path d="M5 21h14"/>
            </symbol>
        `);

    plugin.addIcons(`
            <symbol id="iconTNTodoList" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 5h8"/>
                <path d="M13 12h8"/>
                <path d="M13 19h8"/>
                <path d="m3 17 2 2 4-4"/>
                <rect x="3" y="4" width="6" height="6" rx="1"/>
            </symbol>
        `);

    plugin.addIcons(`
            <symbol id="iconTNCalendar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 2v4"/>
                <path d="M16 2v4"/>
                <rect width="18" height="18" x="3" y="4" rx="2"/>
                <path d="M3 10h18"/>
                <path d="m9 16 2 2 4-4"/>
            </symbol>
        `);
    // 设置面板页签图标：统一使用 24px 线性图形，颜色跟随当前主题。
    plugin.addIcons(`
        <symbol id="iconTNVip" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m2 5 5 4 5-6 5 6 5-4-3 13H5Z"/>
                <path d="M5 21h14"/>
            </g>
        </symbol>
        <symbol id="iconTNComponents" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/>
                <rect x="14" y="14" width="7" height="7" rx="1"/>
                <path d="M14 6h7m-3.5-3.5v7"/>
            </g>
        </symbol>
        <symbol id="iconTNMobile" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="6" y="2" width="12" height="20" rx="2"/>
                <path d="M10 5h4m-2 14h.01"/>
            </g>
        </symbol>
        <symbol id="iconTNNotification" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/>
                <path d="M10 21h4M12 2V1"/>
            </g>
        </symbol>
        <symbol id="iconTNTaskSummary" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>
                <path d="M14 2v6h6M8 12h8m-8 4h8m-8 4h4"/>
            </g>
        </symbol>
        <symbol id="iconTNTaskNote" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/>
                <path d="M14 2v6h6m-12 7 3 3 5-6"/>
            </g>
        </symbol>
        <symbol id="iconTNPomodoro" viewBox="0 0 24 24">
            ${renderTomatoIconContent('monochrome')}
        </symbol>
        <symbol id="iconTNRandomRest" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01"/>
            </g>
        </symbol>
        <symbol id="iconTNCalendarSubscription" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/>
                <path d="M8 2v4m8-4v4M3 10h18m-12 6h6m-3-3v6"/>
            </g>
        </symbol>
        <symbol id="iconTNCalendarUpload" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 18H6a4 4 0 0 1-.8-7.9 7 7 0 0 1 13.6 0A4 4 0 0 1 18 18h-1"/>
                <path d="M12 22V12m-4 4 4-4 4 4"/>
            </g>
        </symbol>
        <symbol id="iconTNDataStorage" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>
            </g>
        </symbol>
        <symbol id="iconTNExport" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 15V3m-5 5 5-5 5 5"/>
            </g>
        </symbol>
        <symbol id="iconTNImport" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v12m-5-5 5 5 5-5"/>
            </g>
        </symbol>
        <symbol id="iconTNHelp" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4m.1 3h.01"/>
            </g>
        </symbol>
        <symbol id="iconTNDonate" viewBox="0 0 24 24">
            <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>
            </g>
        </symbol>
    `);
}

