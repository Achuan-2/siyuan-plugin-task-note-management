/** 共用六点拖拽抓手；紧凑控件可调整尺寸，颜色由容器继承。 */
export function getDragHandleIcon(size: number = 16): string {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true" focusable="false" style="display: block; flex-shrink: 0; pointer-events: none;">
        <circle cx="9" cy="5" r="1.8"/><circle cx="15" cy="5" r="1.8"/>
        <circle cx="9" cy="12" r="1.8"/><circle cx="15" cy="12" r="1.8"/>
        <circle cx="9" cy="19" r="1.8"/><circle cx="15" cy="19" r="1.8"/>
    </svg>`;
}
