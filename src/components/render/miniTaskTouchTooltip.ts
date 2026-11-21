import { i18n } from '../../pluginInstance';

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
