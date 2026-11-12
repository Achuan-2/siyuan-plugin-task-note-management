/** 任务详情图标：普通信息跟随主题颜色，番茄使用红色果实与绿色叶片。 */
const paths = {
    project: '<use href="#iconTNProject"/>',
    tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    calendar: '<path d="M8 2v4m8-4v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="m3 5 3-3m12 0 3 3M12 9v4l3 2M6 20l-2 2m14-2 2 2"/>',
    timer: '<path d="M10 2h4M12 14v-4m-8-7 3 3"/><circle cx="12" cy="14" r="8"/>',
    duration: '<path d="M512 512m-292.571429 0a292.571429 292.571429 0 1 0 585.142858 0 292.571429 292.571429 0 1 0-585.142858 0Z" fill="#001029" fill-opacity=".156"/><path d="M512 999.643429A487.643429 487.643429 0 1 1 512 24.429714a487.643429 487.643429 0 0 1 0 975.213715z m0-97.572572A390.070857 390.070857 0 1 0 512 121.929143a390.070857 390.070857 0 0 0 0 780.141714zM560.786286 512h194.998857v97.499429h-219.428572a73.142857 73.142857 0 0 1-73.142857-73.142858V268.214857h97.572572V512z" fill="#001029" fill-opacity=".65"/>',
    document: '<path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9ZM14 2v7h7M7 13h10m-10 4h7"/>',
    parent: '<path d="M4 3v9a4 4 0 0 0 4 4h12m-5-5 5 5-5 5"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="3" fill="#4caf50"/><path d="m7 12 3 3 7-7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    unchecked: '<rect x="3" y="3" width="18" height="18" rx="3"/>',
    hourglass: '<path d="M5 2h14M5 22h14M6 2v5l6 5-6 5v5M18 2v5l-6 5 6 5v5"/>',
    flag: '<path d="M4 22V3c5-4 11 4 16 0v12c-5 4-11-4-16 0"/>',
    pin: '<path d="M12 17v5M8 3h8l-1 7 4 4v3H5v-3l4-4Z"/>',
    tomato: '<path fill="#ef5b54" d="M8 7C4 6 2 9 2 13c0 5 4 9 10 9s10-4 10-9c0-4-3-7-7-6Z"/><path fill="#4d9e57" d="m12 7-6-3 2 5-3 2 5-1 2 3 2-3 5 1-3-3 2-4Z"/><path d="M12 7V4c0-1 1-2 2-2" fill="none" stroke="#397e44" stroke-width="2" stroke-linecap="round"/><path d="M5 13a6 6 0 0 0 3 5" fill="none" stroke="#ffaaa1" stroke-width="1.5" stroke-linecap="round"/>',
} as const;

export type TaskMetadataIcon = keyof typeof paths;

export function renderTaskMetadataIcon(name: TaskMetadataIcon, size = 14): string {
    // 将绘制样式放在内部组中，隔离宿主或主题对根 svg 的填充和描边设置。
    const content = name === 'tomato' || name === 'project' || name === 'duration' || name === 'check'
        ? paths[name]
        : `<g fill="none" stroke="currentColor" stroke-width="${name === 'tag' ? 2 : 1.8}" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</g>`;
    const viewBox = name === 'duration' ? '0 0 1024 1024' : '0 0 24 24';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="task-metadata-icon" viewBox="${viewBox}" width="${size}" height="${size}" aria-hidden="true" focusable="false" style="display:inline-block;width:${size}px;height:${size}px;vertical-align:-2px;flex-shrink:0;pointer-events:none;fill:none;stroke:none">${content}</svg>`;
}

const emojiIcons: Record<string, TaskMetadataIcon> = {
    '📂': 'project', '📁': 'project', '🏷': 'tag', '🗓': 'calendar', '📅': 'calendar',
    '🔄': 'repeat', '🔁': 'repeat', '🍅': 'tomato', '⏱': 'duration',
    '✅': 'check',
    '🕒': 'duration', '🕐': 'clock', '⏰': 'alarm',
};
const metadataIconPattern = /(📂|📁|🏷️?|🗓️*|📅|🔄|🔁|🍅|⏱️?|🕒|🕐|⏰|✅)/u;

/** 模板和 Svelte 共用：先转义动态文字，只插入固定的可信 SVG。 */
export function renderTaskMetadataText(text: string): string {
    return String(text).split(metadataIconPattern).map(part => {
        const name = emojiIcons[part.replace(/\uFE0F/g, '')];
        return name ? renderTaskMetadataIcon(name) : part
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }).join('');
}

/** 保留动态文本为文本节点，只将固定图标替换为可信 SVG。 */
export function setTaskMetadataText(element: HTMLElement, text: string): void {
    element.replaceChildren();
    for (const part of text.split(metadataIconPattern)) {
        const name = emojiIcons[part.replace(/\uFE0F/g, '')];
        if (name) element.insertAdjacentHTML('beforeend', renderTaskMetadataIcon(name));
        else element.appendChild(document.createTextNode(part));
    }
}
