/** 任务详情图标：普通信息跟随主题颜色，番茄使用红色果实与绿色叶片。 */
const paths = {
    project: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v1M3 7h18l-3 12H2Z"/>',
    tag: '<path d="m20 13-7 7a2 2 0 0 1-3 0l-8-8V2h10l8 8a2 2 0 0 1 0 3Z"/><circle cx="7" cy="7" r="1"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
    repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    alarm: '<circle cx="12" cy="13" r="8"/><path d="m3 5 3-3m12 0 3 3M12 9v4l3 2M6 20l-2 2m14-2 2 2"/>',
    timer: '<circle cx="12" cy="14" r="8"/><path d="M9 2h6m-3 0v4m6 1 2-2M12 10v4l3 2"/>',
    document: '<path d="M14 2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9ZM14 2v7h7M7 13h10m-10 4h7"/>',
    parent: '<path d="M4 3v9a4 4 0 0 0 4 4h12m-5-5 5 5-5 5"/>',
    check: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
    unchecked: '<rect x="3" y="3" width="18" height="18" rx="3"/>',
    hourglass: '<path d="M5 2h14M5 22h14M6 2v5l6 5-6 5v5M18 2v5l-6 5 6 5v5"/>',
    flag: '<path d="M4 22V3c5-4 11 4 16 0v12c-5 4-11-4-16 0"/>',
    pin: '<path d="M12 17v5M8 3h8l-1 7 4 4v3H5v-3l4-4Z"/>',
    tomato: '<path fill="#ef5b54" d="M8 7C4 6 2 9 2 13c0 5 4 9 10 9s10-4 10-9c0-4-3-7-7-6Z"/><path fill="#4d9e57" d="m12 7-6-3 2 5-3 2 5-1 2 3 2-3 5 1-3-3 2-4Z"/><path d="M12 7V4c0-1 1-2 2-2" fill="none" stroke="#397e44" stroke-width="2" stroke-linecap="round"/><path d="M5 13a6 6 0 0 0 3 5" fill="none" stroke="#ffaaa1" stroke-width="1.5" stroke-linecap="round"/>',
} as const;

export type TaskMetadataIcon = keyof typeof paths;

export function renderTaskMetadataIcon(name: TaskMetadataIcon): string {
    const paint = name === 'tomato' ? '' : ' fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="task-metadata-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" style="display:inline-block;width:1em;height:1em;vertical-align:-0.125em;flex-shrink:0;pointer-events:none"${paint}>${paths[name]}</svg>`;
}

const emojiIcons: Record<string, TaskMetadataIcon> = {
    '📂': 'project', '🏷️': 'tag', '🗓️': 'calendar', '📅': 'calendar',
    '🔄': 'repeat', '🔁': 'repeat', '🍅': 'tomato', '⏱️': 'timer', '⏱': 'timer',
    '🕒': 'clock', '🕐': 'clock', '⏰': 'alarm',
};

/** 保留动态文本为文本节点，只将固定图标替换为可信 SVG。 */
export function setTaskMetadataText(element: HTMLElement, text: string): void {
    element.replaceChildren();
    for (const part of text.split(/(📂|🏷️|🗓️|📅|🔄|🔁|🍅|⏱️?|🕒|🕐|⏰)/u)) {
        const name = emojiIcons[part];
        if (name) element.insertAdjacentHTML('beforeend', renderTaskMetadataIcon(name));
        else element.appendChild(document.createTextNode(part));
    }
}
