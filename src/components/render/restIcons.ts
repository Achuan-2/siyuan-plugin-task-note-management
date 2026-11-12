/** 无柄茶杯：彩色界面与单色菜单共用杯身、杯口、蒸汽和杯碟轮廓。 */
export const SHORT_BREAK_ICON_PATHS = {
    body: 'M3 8v7a6 6 0 0 0 6 6h6a6 6 0 0 0 6-6V8',
    rim: 'M21 8a9 2.2 0 1 1-18 0 9 2.2 0 1 1 18 0',
    steam: 'M8 2c-1 1 1 1 0 2m8-2c-1 1 1 1 0 2',
    saucer: 'M3 23h18',
} as const;

/** 冥想休息：24 坐标系的圆角描边，与茶杯菜单图标共用线宽。 */
export const MEDITATION_ICON_PATHS = {
    head: 'M14 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    arms: 'M3 14h2a3 3 0 0 0 3-3 4 4 0 0 1 8 0 3 3 0 0 0 3 3h2',
    legs: 'm8 15-4 2a2 2 0 0 0 1 4h3c3 0 5-1.5 8-4m0-2 4 2a2 2 0 0 1-1 4h-3c-2 0-4-1-6-2.5',
} as const;
