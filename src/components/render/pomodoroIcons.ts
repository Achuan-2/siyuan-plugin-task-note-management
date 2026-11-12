import randomRest from './icons/randomRest.svg?raw';
import { getTomatoIconLayers, renderTomatoIconContent } from './tomatoIcon';
import { MEDITATION_ICON_PATH, SHORT_BREAK_ICON_PATHS } from './restIcons';

/** 内联彩色 SVG 可同时用于思源面板和没有宿主图标库的独立窗口。 */
function svg(content: string, viewBox = '0 0 24 24'): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="pomodoro-icon" viewBox="${viewBox}" width="24" height="24" aria-hidden="true" focusable="false" style="display:inline-block;width:1em;height:1em;vertical-align:-0.125em;flex-shrink:0;pointer-events:none;fill:none;stroke:none">${content}</svg>`;
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
const tomato = svg(renderTomatoIconContent());
const shortBreak = svg(`<path d="${SHORT_BREAK_ICON_PATHS.body}" fill="#77c8a7"/><ellipse cx="12" cy="8" rx="9" ry="2.2" fill="#d8f0df"/><ellipse cx="12" cy="8" rx="7" ry="1.3" fill="#78a95f"/>` + line(`<path d="${SHORT_BREAK_ICON_PATHS.steam}"/><path d="${SHORT_BREAK_ICON_PATHS.saucer}"/>`, '#59a98a'));
const longBreak = svg(`<path d="${MEDITATION_ICON_PATH}" fill="#9678c5"/>`, '0 0 1024 1024');
const timer = svg('<circle cx="12" cy="14" r="8" fill="#e3effc" stroke="#6498cc" stroke-width="1.8"/>' + line('<path d="M10 2h4m-2 8v4l3 2M5 5l2 2"/>', '#527eb1'));

function arrow(rotation: number): string {
    return svg(`<g transform="rotate(${rotation} 12 12)"><rect x="2" y="2" width="20" height="20" rx="4" fill="#78b6e6"/>${line('<path d="M6 12h12m-5-5 5 5-5 5"/>', '#fff')}</g>`);
}

/** 操作与阶段图标统一使用内联 SVG，独立窗口注入同一份图标映射。 */
export const POMODORO_ICON_SVGS: Record<string, string> = {
    '🍅': tomato, '🎲': randomRest, '🍵': shortBreak, '☕': shortBreak,
    '🧘': longBreak, '🧘‍♀️': longBreak, '🧘‍♂️': longBreak,
    '⏱': timer, '⏱️': timer,
    '🔊': sound, '🔇': mute,
    '📌': pin, '⭕': mini, '🔄': switchPhase, '▶️': play,
    '⏸': pause, '⏸️': pause, '⏹': stop, '⏹️': stop, '⋯': more,
    '⛶': fullscreen, '×': close, '─': minimize, '✏️': edit, '⚙️': settings,
    '📈': chartUp, '📉': chartDown,
    '➡️': arrow(0), '⬇️': arrow(90), '⬅️': arrow(180), '⬆️': arrow(270),
    '↗': arrow(315), '↗️': arrow(315),
};

// 钉住按钮使用用户指定的 Lucide pin 路径。
const toolbarPin = svg(line('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>', 'currentColor'));

/** 顶部工具栏采用 Lucide 风格的单色线性图标，颜色由主题决定。 */
export const POMODORO_TOOLBAR_ICON_SVGS: Record<string, string> = {
    '⭕': svg(line('<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>', 'currentColor')),
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

/** 状态与更多菜单的共享路径；工作阶段的填充和透明度由番茄图层定义。 */
export const POMODORO_MENU_ICON_PATHS = {
    work: getTomatoIconLayers('monochrome').map(layer => layer.d),
    shortBreak: Object.values(SHORT_BREAK_ICON_PATHS),
    longBreak: [MEDITATION_ICON_PATH],
    timer: ['M9 2h6m-3 0v4m6 1 2-2M12 10v4l3 2', 'M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
    hourglass: ['M5 2h14M5 22h14M6 2v5l6 5-6 5v5M18 2v5l-6 5 6 5v5'],
    pencil: ['m16 3 5 5M3 21l6-1L21 8a2 2 0 0 0 0-3l-2-2a2 2 0 0 0-3 0L4 15Z', 'm4 15 5 5'],
    settings: ['M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6'],
    fullscreen: ['M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5'],
    exitFullscreen: ['M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5'],
    volume: ['m11 5-6 4H2v6h3l6 4Z', 'M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13'],
} as const;

export type PomodoroMenuIconName = keyof typeof POMODORO_MENU_ICON_PATHS;

export function renderPomodoroMenuIcon(name: PomodoroMenuIconName): string {
    if (name === 'work') return svg(renderTomatoIconContent('monochrome'));
    if (name === 'longBreak') return svg(`<path d="${MEDITATION_ICON_PATH}" fill="currentColor"/>`, '0 0 1024 1024');
    return svg(line(POMODORO_MENU_ICON_PATHS[name].map(path => `<path d="${path}"/>`).join(''), 'currentColor'));
}

const nativeMenuIconCache = new WeakMap<object, Map<string, any>>();

/**
 * Electron 原生菜单不直接显示 SVG，使用同一组路径生成透明 PNG 的多倍率表示。
 * Path2D 同步绘制，菜单无需等待图片加载；按图标、主题颜色和 Electron 模块缓存。
 */
export function getNativePomodoroMenuIcon(name: PomodoroMenuIconName, nativeImage: any, color: string): any {
    if (!nativeImage?.createEmpty) return undefined;
    let cache = nativeMenuIconCache.get(nativeImage);
    if (!cache) {
        cache = new Map();
        nativeMenuIconCache.set(nativeImage, cache);
    }
    const key = `${name}:${color}`;
    if (cache.has(key)) return cache.get(key);

    const image = nativeImage.createEmpty();
    for (const scaleFactor of [1, 1.25, 1.5, 2, 3]) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16 * scaleFactor;
        const context = canvas.getContext('2d');
        if (!context) return undefined;
        context.scale(canvas.width / 24, canvas.height / 24);
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        if (name === 'work') {
            for (const layer of getTomatoIconLayers('monochrome')) {
                context.save();
                context.globalAlpha = layer.opacity;
                const path = new Path2D(layer.d);
                if (layer.fill) {
                    context.fillStyle = color;
                    context.fill(path);
                } else {
                    context.lineWidth = layer.width;
                    context.stroke(path);
                }
                context.restore();
            }
        } else if (name === 'longBreak') {
            context.scale(24 / 1024, 24 / 1024);
            context.fillStyle = color;
            context.fill(new Path2D(MEDITATION_ICON_PATH));
        } else {
            for (const path of POMODORO_MENU_ICON_PATHS[name]) context.stroke(new Path2D(path));
        }
        image.addRepresentation({ scaleFactor, dataURL: canvas.toDataURL('image/png') });
    }
    image.setTemplateImage(true);
    cache.set(key, image);
    return image;
}

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
