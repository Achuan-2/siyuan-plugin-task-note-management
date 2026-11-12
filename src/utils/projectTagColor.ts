const DEFAULT_TAG_BACKGROUND = 'var(--b3-theme-surface-lighter)';
const TAG_LIGHTNESS_THRESHOLD = 0.453;

function getProjectTagColors(color?: string): { background: string; foreground: string } {
    const background = color?.trim() || DEFAULT_TAG_BACKGROUND;
    const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(background)?.[1];
    if (!hex) return { background, foreground: '#000000' };

    const fullHex = hex.length === 3 ? Array.from(hex, digit => digit + digit).join('') : hex;
    const red = parseInt(fullHex.slice(0, 2), 16);
    const green = parseInt(fullHex.slice(2, 4), 16);
    const blue = parseInt(fullHex.slice(4, 6), 16);
    // 使用 RGB 加权感知亮度，在浅色背景显示黑字，深色背景显示白字。
    const perceivedLightness = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
    return { background, foreground: perceivedLightness >= TAG_LIGHTNESS_THRESHOLD ? '#000000' : '#ffffff' };
}

/** 供标签及其颜色预览共用，不覆盖元素的其他布局样式。 */
export function applyProjectTagColor(element: HTMLElement, color?: string): void {
    const { background, foreground } = getProjectTagColors(color);
    element.style.setProperty('--tn-project-tag-color', background);
    element.style.setProperty('--tn-project-tag-text-color', foreground);
}

/** 用于模板中的标签，和 DOM 创建的标签采用同一套颜色规则。 */
export function getProjectTagColorStyle(color?: string): string {
    const { background, foreground } = getProjectTagColors(color);
    return `--tn-project-tag-color: ${background}; --tn-project-tag-text-color: ${foreground};`;
}
