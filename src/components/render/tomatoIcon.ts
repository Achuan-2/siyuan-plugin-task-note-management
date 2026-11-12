/** 彩色界面、宿主菜单和原生菜单共用的番茄几何路径。 */
export const TOMATO_ICON_PATHS = {
    body: 'M8 7C4 6 2 9 2 13c0 5 4 9 10 9s10-4 10-9c0-4-3-7-7-6Z',
    leaves: 'm12 7-6-3 2 5-3 2 5-1 2 3 2-3 5 1-3-3 2-4Z',
    stem: 'M12 7V4c0-1 1-2 2-2',
    highlight: 'M5 13a6 6 0 0 0 3 5',
} as const;

/** 保留彩色版的填充、描边和层次，单色菜单仅用透明度区分部件。 */
export function getTomatoIconLayers(mode: 'color' | 'monochrome' = 'color') {
    const monochrome = mode === 'monochrome';
    return [
        { d: TOMATO_ICON_PATHS.body, color: monochrome ? 'currentColor' : '#ef5b54', fill: true, opacity: monochrome ? 0.65 : 1, width: 0 },
        { d: TOMATO_ICON_PATHS.leaves, color: monochrome ? 'currentColor' : '#4d9e57', fill: true, opacity: 1, width: 0 },
        { d: TOMATO_ICON_PATHS.stem, color: monochrome ? 'currentColor' : '#397e44', fill: false, opacity: 1, width: 2 },
        { d: TOMATO_ICON_PATHS.highlight, color: monochrome ? 'currentColor' : '#ffaaa1', fill: false, opacity: monochrome ? 0.35 : 1, width: 1.5 },
    ];
}

export function renderTomatoIconContent(mode: 'color' | 'monochrome' = 'color'): string {
    return getTomatoIconLayers(mode).map(layer => layer.fill
        ? `<path d="${layer.d}" fill="${layer.color}" fill-opacity="${layer.opacity}" stroke="none"/>`
        : `<path d="${layer.d}" fill="none" stroke="${layer.color}" stroke-opacity="${layer.opacity}" stroke-width="${layer.width}" stroke-linecap="round"/>`
    ).join('');
}
