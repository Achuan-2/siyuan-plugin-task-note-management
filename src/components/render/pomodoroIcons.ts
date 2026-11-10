/** 内联彩色 SVG 可同时用于思源面板和没有宿主图标库的独立窗口。 */
function svg(content: string): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="pomodoro-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" style="display:inline-block;width:1em;height:1em;vertical-align:-0.125em;flex-shrink:0;pointer-events:none">${content}</svg>`;
}

function line(content: string, color = '#528bd4'): string {
    return `<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${content}</g>`;
}

const speaker = '<path fill="#5e9ed1" d="M3 9h4l5-5v16l-5-5H3Z"/>';
const sound = svg(speaker + line('<path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>', '#76b9d6'));
const mute = svg(speaker + line('<path d="m16 9 5 6m0-6-5 6"/>', '#e56c73'));
const pin = svg('<path fill="#e85276" d="m9 2 12 12-3 3-4-2-5 2-4-4 2-5-2-3Z"/>' + line('<path d="m8 16-6 6"/>', '#b84a69') + '<path d="m9 4 10 10" stroke="#ff9bb1" stroke-width="2"/>');
const mini = svg('<circle cx="12" cy="12" r="8" fill="#fce5e9" stroke="#ed7695" stroke-width="3"/>');
const switchPhase = svg('<rect x="2" y="2" width="20" height="20" rx="4" fill="#72b4e8"/>' + line('<path d="M7 8a6 6 0 0 1 10 1m0-4v4h-4M17 16a6 6 0 0 1-10-1m0 4v-4h4"/>', '#fff'));
const play = svg('<rect x="2" y="2" width="20" height="20" rx="5" fill="#67b898"/><path d="m9 6 9 6-9 6Z" fill="#fff"/>');
const pause = svg('<rect x="2" y="2" width="20" height="20" rx="5" fill="#e5ac52"/><path d="M8 7h3v10H8Zm5 0h3v10h-3Z" fill="#fff"/>');
const stop = svg('<rect x="2" y="2" width="20" height="20" rx="5" fill="#e5787c"/><rect x="7" y="7" width="10" height="10" rx="1" fill="#fff"/>');
const more = svg('<g fill="#879dc8"><circle cx="4" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="20" cy="12" r="2.3"/></g>');
const fullscreen = svg('<rect x="2" y="3" width="20" height="17" rx="3" fill="#e1eafa"/>' + line('<path d="M5 9V6h4m6 0h4v3M5 14v3h4m6 0h4v-3"/>', '#738dca'));
const close = svg(line('<path d="m6 6 12 12M18 6 6 18"/>', '#e47784'));
const minimize = svg(line('<path d="M5 12h14"/>', '#7d99bd'));
const edit = svg('<path fill="#f6c46c" d="m4 15 11-11 5 5L9 20l-6 1Z"/><path fill="#ed8d9b" d="m15 4 2-2a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3l-2 2Z"/><path fill="#65768b" d="m4 15-1 6 6-1Z"/>');
const settings = svg('<path fill="#90a4c9" d="m10 2-1 3-3-1-2 3 2 3-3 1v4l3 1-1 3 3 2 3-2 1 3h4l1-3 3 1 2-3-2-3 3-1v-4l-3-1 1-3-3-2-3 2-1-3Z" transform="translate(-1 -1)"/><circle cx="12" cy="12" r="4" fill="#e6effb"/>');
const chartUp = svg('<rect x="2" y="2" width="20" height="20" rx="3" fill="#e9f2fc"/>' + line('<path d="m5 17 5-6 4 3 5-8"/>', '#69b49a'));
const chartDown = svg('<rect x="2" y="2" width="20" height="20" rx="3" fill="#e9f2fc"/>' + line('<path d="m5 7 5 6 4-3 5 8"/>', '#e68f92'));

function arrow(rotation: number): string {
    return svg(`<g transform="rotate(${rotation} 12 12)"><rect x="2" y="2" width="20" height="20" rx="4" fill="#78b6e6"/>${line('<path d="M6 12h12m-5-5 5 5-5 5"/>', '#fff')}</g>`);
}

/** 操作控件使用 SVG；番茄、计时、休息阶段及随机微休息保持原生 emoji。 */
export const POMODORO_ICON_SVGS: Record<string, string> = {
    '🔊': sound, '🔇': mute,
    '📌': pin, '⭕': mini, '🔄': switchPhase, '▶️': play,
    '⏸': pause, '⏸️': pause, '⏹': stop, '⏹️': stop, '⋯': more,
    '⛶': fullscreen, '×': close, '─': minimize, '✏️': edit, '⚙️': settings,
    '📈': chartUp, '📉': chartDown,
    '➡️': arrow(0), '⬇️': arrow(90), '⬅️': arrow(180), '⬆️': arrow(270),
    '↗': arrow(315), '↗️': arrow(315),
};

// 钉住与 mini 按钮使用用户指定的 Lucide pin 路径。
const toolbarPin = svg(line('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>', 'currentColor'));

/** 顶部工具栏采用 Lucide 风格的单色线性图标，颜色由主题决定。 */
export const POMODORO_TOOLBAR_ICON_SVGS: Record<string, string> = {
    '⭕': toolbarPin,
    '🔄': svg(line('<path d="M3 11a9 9 0 0 1 15-6l3 3M21 3v5h-5M21 13a9 9 0 0 1-15 6l-3-3M3 21v-5h5"/>', 'currentColor')),
    '⋯': svg(line('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>', 'currentColor')),
    '🔊': svg(line('<path d="m11 5-6 4H2v6h3l6 4ZM15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13"/>', 'currentColor')),
    '🔇': svg(line('<path d="m11 5-6 4H2v6h3l6 4Zm6 4 5 6m0-6-5 6"/>', 'currentColor')),
    '📌': toolbarPin,
    '─': svg(line('<path d="M5 12h14"/>', 'currentColor')),
    '×': svg(line('<path d="m6 6 12 12M18 6 6 18"/>', 'currentColor')),
    '⛶': svg(line('<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>', 'currentColor')),
    '↗': svg(line('<path d="M7 7h10v10M7 17 17 7"/>', 'currentColor')),
    '➡️': svg(line('<path d="M4 12h16m-7-7 7 7-7 7"/>', 'currentColor')),
    '⬅️': svg(line('<path d="M20 12H4m7-7-7 7 7 7"/>', 'currentColor')),
    '⬆️': svg(line('<path d="M12 20V4m-7 7 7-7 7 7"/>', 'currentColor')),
    '⬇️': svg(line('<path d="M12 4v16m-7-7 7 7 7-7"/>', 'currentColor')),
};

/** 函数自包含，可将相同渲染逻辑注入独立窗口，无需读取宿主 DOM 或外部资源。 */
export function createPomodoroIconRenderer(icons: Record<string, string>) {
    const keys = Object.keys(icons).sort((a, b) => b.length - a.length);
    const pattern = new RegExp(keys.map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gu');
    const html = (text: string) => String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(pattern, key => icons[key]);
    const set = (element: Element | null, text: string) => {
        if (!element || element.getAttribute('data-pomodoro-icon') === text) return;
        element.innerHTML = html(text);
        element.setAttribute('data-pomodoro-icon', text);
    };
    return { html, set };
}

const renderer = createPomodoroIconRenderer(POMODORO_ICON_SVGS);
export const renderPomodoroIcons = renderer.html;
export const setPomodoroIcon = renderer.set;
const toolbarRenderer = createPomodoroIconRenderer(POMODORO_TOOLBAR_ICON_SVGS);
export const renderPomodoroToolbarIcon = toolbarRenderer.html;
export const setPomodoroToolbarIcon = toolbarRenderer.set;
