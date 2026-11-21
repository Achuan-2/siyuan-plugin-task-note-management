import { i18n } from '../../pluginInstance';

export interface MiniTooltipRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export function computeMiniTaskHoverPosition(
    rowRect: MiniTooltipRect,
    panelRect: MiniTooltipRect | null,
    tooltipSize: { width: number; height: number },
    viewport: { width: number; height: number },
    pointer?: { x: number; y: number }
): { left: number; top: number } {
    const margin = 8;
    const gap = 8;
    const maxLeft = Math.max(margin, viewport.width - tooltipSize.width - margin);
    const maxTop = Math.max(margin, viewport.height - tooltipSize.height - margin);
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

    const anchorRight = panelRect ? Math.max(rowRect.right, panelRect.right) : rowRect.right;
    const anchorLeft = panelRect ? Math.min(rowRect.left, panelRect.left) : rowRect.left;
    const panelTooWideForRightEdge = Boolean(
        panelRect && panelRect.width > 460 && pointer && anchorRight - pointer.x > 360
    );

    // 1. 优先显示在侧栏/任务行右侧，并与当前行顶部对齐，避免遮挡下方任务
    if (!panelTooWideForRightEdge && anchorRight + gap + tooltipSize.width <= viewport.width - margin) {
        return {
            left: anchorRight + gap,
            top: clamp(rowRect.top, margin, maxTop),
        };
    }

    // 2. 右侧空间不足（如右侧停靠栏）时，翻转到左侧并与当前行顶部对齐
    if (!panelTooWideForRightEdge && anchorLeft - gap - tooltipSize.width >= margin) {
        return {
            left: anchorLeft - tooltipSize.width - gap,
            top: clamp(rowRect.top, margin, maxTop),
        };
    }

    // 3. 宽栏或窄视口兜底：显示在鼠标偏右侧，尽量与当前行对齐或避开当前行
    const preferredLeft = pointer ? pointer.x + 16 : rowRect.left + Math.min(rowRect.width * 0.4, 120);
    const left = clamp(preferredLeft, margin, maxLeft);
    if (pointer && left >= pointer.x + 8) {
        return {
            left,
            top: clamp(rowRect.top, margin, maxTop),
        };
    }
    const below = rowRect.bottom + 4;
    const above = rowRect.top - tooltipSize.height - 4;
    const top = below + tooltipSize.height <= viewport.height - margin
        ? below
        : above >= margin
            ? above
            : clamp(rowRect.top, margin, maxTop);
    return { left, top };
}

const MINI_HOVER_EXCLUDE_SELECTOR = 'button, input, textarea, select, [contenteditable="true"], .reminder-repeat-icon, .reminder-item__url-icon, .reminder-item__pin-badge, .reminder-item__more-button, .collapse-btn';

export class MiniTaskHoverTooltipController {
    private tooltipEl: HTMLElement | null = null;
    private activeRow: HTMLElement | null = null;
    private pendingRow: HTMLElement | null = null;
    private lastPointer?: { x: number; y: number };
    private showTimer: number | null = null;
    private events = new AbortController();
    private disposed = false;

    constructor(
        private container: HTMLElement,
        private shouldEnable: () => boolean
    ) {
        const signal = this.events.signal;
        this.container.addEventListener('mouseover', event => this.handleMouseOver(event), { signal });
        this.container.addEventListener('mouseleave', () => this.hide(), { signal });
        this.container.addEventListener('pointerdown', () => this.hide(), { capture: true, signal });
        this.container.addEventListener('dragstart', () => this.hide(), { capture: true, signal });
        this.container.addEventListener('contextmenu', () => this.hide(), { capture: true, signal });
        this.container.addEventListener('scroll', () => this.hide(), { capture: true, signal });
        window.addEventListener('blur', () => this.hide(), { signal });
        window.addEventListener('resize', () => this.hide(), { signal });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') this.hide();
        }, { signal });
    }

    private handleMouseOver(event: MouseEvent): void {
        if (this.disposed || !this.shouldEnable()) {
            this.hide();
            return;
        }
        const target = event.target instanceof Element ? event.target : (event.target as Node | null)?.parentElement;
        if (!target || !this.container.contains(target)) {
            this.hide();
            return;
        }
        if (target.closest(MINI_HOVER_EXCLUDE_SELECTOR)) {
            this.hide();
            return;
        }
        const row = target.closest<HTMLElement>('.reminder-item--mini');
        if (!row || !row.dataset.miniTaskTooltip) {
            this.hide();
            return;
        }
        const pointer = { x: event.clientX, y: event.clientY };
        this.lastPointer = pointer;
        if (row === this.activeRow) {
            if (this.tooltipEl) this.refreshRow(row);
            return;
        }
        if (row === this.pendingRow) return;

        this.clearTimer();
        if (this.activeRow && this.tooltipEl) {
            this.showForRow(row, pointer);
            return;
        }
        this.pendingRow = row;
        this.showTimer = window.setTimeout(() => {
            this.showTimer = null;
            if (this.pendingRow === row) this.showForRow(row, this.lastPointer || pointer);
        }, 200);
    }

    private showForRow(row: HTMLElement, pointer?: { x: number; y: number }): void {
        if (this.disposed || !this.shouldEnable() || !row.isConnected || !row.dataset.miniTaskTooltip) {
            this.hide();
            return;
        }
        if (!this.tooltipEl) {
            this.tooltipEl = document.createElement('div');
            this.tooltipEl.className = 'task-mini-hover-tooltip';
            this.tooltipEl.setAttribute('role', 'tooltip');
            document.body.appendChild(this.tooltipEl);
        }
        this.tooltipEl.innerHTML = row.dataset.miniTaskTooltip;
        const bounds = this.tooltipEl.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const panelRect = this.container.getBoundingClientRect();
        const pos = computeMiniTaskHoverPosition(
            rowRect,
            panelRect,
            { width: bounds.width, height: bounds.height },
            { width: window.innerWidth, height: window.innerHeight },
            pointer
        );
        this.tooltipEl.style.left = `${Math.round(pos.left)}px`;
        this.tooltipEl.style.top = `${Math.round(pos.top)}px`;
        this.activeRow = row;
        this.pendingRow = null;
    }

    public refreshRow(row: HTMLElement): void {
        if (this.activeRow === row && this.tooltipEl) {
            this.showForRow(row, this.lastPointer);
        }
    }

    public sync(): void {
        if (!this.activeRow) return;
        if (this.disposed || !this.shouldEnable() || !this.activeRow.isConnected || !this.activeRow.dataset.miniTaskTooltip) {
            this.hide();
            return;
        }
        this.refreshRow(this.activeRow);
    }

    private clearTimer(): void {
        if (this.showTimer !== null) {
            clearTimeout(this.showTimer);
            this.showTimer = null;
        }
    }

    public hide(): void {
        this.clearTimer();
        this.pendingRow = null;
        this.activeRow = null;
        if (this.tooltipEl) {
            this.tooltipEl.remove();
            this.tooltipEl = null;
        }
    }

    public destroy(): void {
        this.disposed = true;
        this.hide();
        this.events.abort();
    }
}

let closeActiveTooltip: (() => void) | undefined;

/** Show TaskRenderer's escaped detail markup without relying on hover support. */
export function showMiniTaskTouchTooltip(anchor: HTMLElement, content: string, onClose?: () => void): () => void {
    closeActiveTooltip?.();
    const tooltip = document.createElement('div');
    tooltip.className = 'task-mini-touch-tooltip';
    tooltip.setAttribute('role', 'dialog');
    tooltip.setAttribute('aria-label', anchor.getAttribute('aria-label') || '');
    tooltip.tabIndex = -1;
    tooltip.innerHTML = content;
    const events = new AbortController();
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        events.abort();
        tooltip.remove();
        if (closeActiveTooltip === close) closeActiveTooltip = undefined;
        onClose?.();
    };
    closeActiveTooltip = close;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'b3-button b3-button--text task-mini-touch-tooltip__close';
    closeButton.setAttribute('aria-label', i18n('close'));
    closeButton.innerHTML = '<svg><use xlink:href="#iconClose"></use></svg>';
    closeButton.addEventListener('click', close);
    tooltip.prepend(closeButton);
    document.body.appendChild(tooltip);

    const rect = anchor.getBoundingClientRect();
    const bounds = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - bounds.width - 12))}px`;
    const below = rect.bottom + 6;
    const above = rect.top - bounds.height - 6;
    tooltip.style.top = `${Math.max(12, Math.min(below + bounds.height <= window.innerHeight - 12 ? below : above,
        window.innerHeight - bounds.height - 12))}px`;

    document.addEventListener('pointerdown', event => {
        if (!tooltip.contains(event.target as Node) && !anchor.contains(event.target as Node)) close();
    }, { capture: true, signal: events.signal });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    }, { signal: events.signal });
    document.addEventListener('scroll', event => {
        if (!tooltip.contains(event.target as Node)) close();
    }, { capture: true, signal: events.signal });
    window.addEventListener('resize', close, { signal: events.signal });
    tooltip.focus({ preventScroll: true });
    return close;
}
