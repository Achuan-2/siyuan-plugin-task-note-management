/** 彩色界面、宿主菜单和原生菜单共用的番茄几何路径。 */
export const TOMATO_ICON_PATHS = {
    body: 'M8 7C4 6 2 9 2 13c0 5 4 9 10 9s10-4 10-9c0-4-3-7-7-6Z',
    leaves: 'm12 7-6-3 2 5-3 2 5-1 2 3 2-3 5 1-3-3 2-4Z',
    stem: 'M12 7V4c0-1 1-2 2-2',
    highlight: 'M5 13a6 6 0 0 0 3 5',
} as const;

/** 菜单版保留果实描边和实心叶片，省略彩色版的装饰高光。 */
export function getTomatoIconLayers(mode: 'color' | 'monochrome' = 'color') {
    if (mode === 'monochrome') {
        return [
            { d: TOMATO_ICON_PATHS.body, color: 'currentColor', fill: false, opacity: 1, width: 1.8 },
            { d: TOMATO_ICON_PATHS.leaves, color: 'currentColor', fill: true, opacity: 1, width: 0 },
            { d: TOMATO_ICON_PATHS.stem, color: 'currentColor', fill: false, opacity: 1, width: 1.8 },
        ];
    }
    return [
        { d: TOMATO_ICON_PATHS.body, color: '#ef5b54', fill: true, opacity: 1, width: 0 },
        { d: TOMATO_ICON_PATHS.leaves, color: '#4d9e57', fill: true, opacity: 1, width: 0 },
        { d: TOMATO_ICON_PATHS.stem, color: '#397e44', fill: false, opacity: 1, width: 2 },
        { d: TOMATO_ICON_PATHS.highlight, color: '#ffaaa1', fill: false, opacity: 1, width: 1.5 },
    ];
}

export function renderTomatoIconContent(mode: 'color' | 'monochrome' = 'color'): string {
    return getTomatoIconLayers(mode).map(layer => layer.fill
        ? `<path d="${layer.d}" fill="${layer.color}" fill-opacity="${layer.opacity}" stroke="none"/>`
        : `<path d="${layer.d}" fill="none" stroke="${layer.color}" stroke-opacity="${layer.opacity}" stroke-width="${layer.width}" stroke-linecap="round" stroke-linejoin="round"/>`
    ).join('');
}
