import { ViewLifecycle } from './viewLifecycle';

export interface TaskDragPoint {
    clientX: number;
    clientY: number;
}

interface TaskDragSource<T> {
    element: HTMLElement;
    task: T;
    title: string;
    /** 默认 true；为 false 时仅允许长按触发上下文菜单，不进入拖拽。 */
    draggable?: boolean;
}

interface LongPressTaskDragOptions<T> {
    getSource(target: HTMLElement): TaskDragSource<T> | null;
    onStart(source: TaskDragSource<T>): void;
    onMove(task: T, point: TaskDragPoint): void;
    onDrop(task: T, point: TaskDragPoint): void;
    onEnd(): void;
    /** 移动端长按未发生明显位移时弹出上下文菜单。 */
    onContextMenu?(source: TaskDragSource<T>, point: TaskDragPoint): void;
    /** 按住后允许通过移动进入拖拽的门槛（毫秒）；配置 onContextMenu 时默认 250ms，否则沿用 460ms 直接开始拖拽。 */
    dragDelayMs?: number;
    /** 按住且未发生明显位移时触发上下文菜单的门槛（毫秒，默认 500ms）。 */
    contextMenuDelayMs?: number;
    /** 判定明显位移的像素阈值（默认 6px）。 */
    moveThresholdPx?: number;
    /** 多列视图可自行滚动实际命中的容器，返回是否发生滚动。 */
    autoScroll?(point: TaskDragPoint, elapsed: number): boolean;
}

interface TouchDragSession<T> {
    source: TaskDragSource<T>;
    touchId: number;
    start: TaskDragPoint;
    point: TaskDragPoint;
    dragArmed: boolean;
    dragging: boolean;
    dirty: boolean;
    ghost?: HTMLElement;
    lastFrameTime?: number;
}

/** 移动端任务长按手势：按住 200-300ms 后移动进入拖拽，按住 500ms 以上未明显移动弹出上下文菜单；开始前不拦截列表滚动。 */
export class LongPressTaskDrag<T> {
    private readonly lifecycle = new ViewLifecycle();
    private session: TouchDragSession<T> | null = null;
    private dragArmTimer = 0;
    private contextMenuTimer = 0;
    private frame = 0;
    private suppressClickUntil = 0;

    constructor(private root: HTMLElement, private options: LongPressTaskDragOptions<T>) {
        root.classList.add('reminder-list--touch-draggable');
        this.lifecycle.listen(root, 'touchstart', (event: TouchEvent) => this.start(event), { passive: true });
        this.lifecycle.listen(document, 'touchstart', (event: TouchEvent) => {
            if (this.session && event.touches.length !== 1) this.cancel();
        }, { capture: true, passive: true });
        this.lifecycle.listen(document, 'touchmove', (event: TouchEvent) => this.move(event), { capture: true, passive: false });
        this.lifecycle.listen(document, 'touchend', (event: TouchEvent) => this.end(event), { capture: true, passive: false });
        this.lifecycle.listen(document, 'touchcancel', () => this.cancel(), true);
        this.lifecycle.listen(root, 'pointercancel', () => this.cancel());
        this.lifecycle.listen(root, 'scroll', () => {
            if (this.session && !this.session.dragging) this.cancel();
        }, { capture: true, passive: true });
        this.lifecycle.listen(window, 'blur', () => this.cancel());
        this.lifecycle.listen(document, 'visibilitychange', () => {
            if (document.hidden) this.cancel();
        });
        this.lifecycle.listen(document, 'contextmenu', (event: Event) => {
            if (!this.root.contains(event.target as Node)) return;
            if (this.session || Date.now() < this.suppressClickUntil) this.consume(event);
        }, true);
        this.lifecycle.listen(document, 'click', (event: Event) => {
            if (!this.root.contains(event.target as Node)) return;
            if (Date.now() < this.suppressClickUntil) this.consume(event);
        }, true);
    }

    private consume(event: Event): void {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
    }

    private clearTimers(): void {
        if (this.dragArmTimer) this.lifecycle.clearTimeout(this.dragArmTimer);
        if (this.contextMenuTimer) this.lifecycle.clearTimeout(this.contextMenuTimer);
        this.dragArmTimer = 0;
        this.contextMenuTimer = 0;
    }

    private getMoveThreshold(): number {
        return this.options.moveThresholdPx ?? 6;
    }

    private start(event: TouchEvent): void {
        this.cancel();
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        const source = this.options.getSource(event.target as HTMLElement);
        if (!source) return;
        const draggable = source.draggable !== false;
        const hasContextMenu = typeof this.options.onContextMenu === 'function';
        if (!draggable && !hasContextMenu) return;

        const point = { clientX: touch.clientX, clientY: touch.clientY };
        const session: TouchDragSession<T> = {
            source, touchId: touch.identifier, start: point, point, dragArmed: false, dragging: false, dirty: true,
        };
        this.session = session;

        if (hasContextMenu) {
            const dragDelayMs = this.options.dragDelayMs ?? 220;
            const contextMenuDelayMs = this.options.contextMenuDelayMs ?? 850;
            if (draggable) {
                this.dragArmTimer = this.lifecycle.timeout(() => {
                    this.dragArmTimer = 0;
                    if (this.session !== session || session.dragging) return;
                    if (!source.element.isConnected || !this.root.contains(source.element)) { this.cancel(); return; }
                    const latest = this.options.getSource(source.element);
                    if (!latest || latest.draggable === false) return;
                    session.source = latest;
                    session.dragArmed = true;
                    latest.element.classList.add('reminder-item--touch-drag-ready');
                    try {
                        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                            navigator.vibrate(10);
                        }
                    } catch {
                        // ignore vibration errors
                    }
                }, dragDelayMs);
            }
            this.contextMenuTimer = this.lifecycle.timeout(() => {
                this.contextMenuTimer = 0;
                if (this.session !== session || session.dragging) return;
                if (!source.element.isConnected || !this.root.contains(source.element)) { this.cancel(); return; }
                const latest = this.options.getSource(source.element);
                if (!latest) { this.cancel(); return; }
                const menuPoint = { ...session.point };
                this.suppressClickUntil = Date.now() + 600;
                this.cancel();
                this.options.onContextMenu?.(latest, menuPoint);
            }, contextMenuDelayMs);
            return;
        }

        const legacyDelayMs = this.options.dragDelayMs ?? 460;
        this.dragArmTimer = this.lifecycle.timeout(() => {
            this.dragArmTimer = 0;
            this.beginDragging(session);
        }, legacyDelayMs);
    }

    private beginDragging(session: TouchDragSession<T>): void {
        if (this.session !== session || session.dragging) return;
        this.clearTimers();
        if (!session.source.element.isConnected || !this.root.contains(session.source.element)) {
            this.cancel();
            return;
        }
        // 排序配置、任务或视图可能在按住期间改变，开始前再确认一次。
        const latest = this.options.getSource(session.source.element);
        if (!latest || latest.draggable === false) {
            this.cancel();
            return;
        }
        session.source = latest;
        session.dragging = true;
        session.dirty = true;
        latest.element.classList.remove('reminder-item--touch-drag-ready');
        latest.element.classList.add('reminder-item--touch-dragging');
        const ghost = document.createElement('div');
        ghost.className = 'reminder-touch-drag-preview';
        ghost.textContent = latest.title;
        ghost.style.width = `${Math.min(latest.element.getBoundingClientRect().width, 360)}px`;
        document.body.appendChild(ghost);
        session.ghost = ghost;
        this.options.onStart(latest);
        this.draw(session, performance.now());
    }

    private move(event: TouchEvent): void {
        const session = this.session;
        if (!session) return;
        const touch = Array.from(event.touches).find(point => point.identifier === session.touchId);
        if (event.touches.length !== 1 || !touch) { this.cancel(); return; }
        session.point = { clientX: touch.clientX, clientY: touch.clientY };
        if (session.dragging) {
            this.consume(event);
            session.dirty = true;
            return;
        }
        const distance = Math.hypot(touch.clientX - session.start.clientX, touch.clientY - session.start.clientY);
        const moved = distance > this.getMoveThreshold();
        if (session.dragArmed) {
            if (event.cancelable) event.preventDefault();
            if (moved) {
                this.consume(event);
                this.beginDragging(session);
            }
            return;
        }
        if (moved) {
            this.cancel();
        }
    }

    private draw(session: TouchDragSession<T>, time: number): void {
        if (this.session !== session) return;
        if (!session.source.element.isConnected || !this.root.contains(session.source.element)) { this.cancel(); return; }
        const { clientX, clientY } = session.point;
        session.ghost.style.left = `${clientX}px`;
        session.ghost.style.top = `${clientY}px`;
        const rect = this.root.getBoundingClientRect();
        const edge = Math.min(50, rect.height / 3);
        let speed = 0;
        if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom && edge > 0) {
            if (clientY < rect.top + edge) speed = -12 * (1 - (clientY - rect.top) / edge);
            else if (clientY > rect.bottom - edge) speed = 12 * (1 - (rect.bottom - clientY) / edge);
        }
        const previousScroll = this.root.scrollTop;
        const elapsed = Math.min(32, time - (session.lastFrameTime ?? time - 16));
        let scrolled: boolean;
        if (this.options.autoScroll) {
            scrolled = this.options.autoScroll(session.point, elapsed);
        } else {
            this.root.scrollTop += speed * elapsed / 16;
            scrolled = previousScroll !== this.root.scrollTop;
        }
        session.lastFrameTime = time;
        // 手指停留在边缘时也持续滚动，并按滚动后的实际位置更新落点。
        if (session.dirty || scrolled) {
            session.dirty = false;
            this.options.onMove(session.source.task, session.point);
        }
        this.frame = requestAnimationFrame(next => this.draw(session, next));
    }

    private end(event: TouchEvent): void {
        const session = this.session;
        if (!session) return;
        const touch = Array.from(event.changedTouches).find(point => point.identifier === session.touchId);
        if (!touch) {
            if (!Array.from(event.touches).some(point => point.identifier === session.touchId)) this.cancel();
            return;
        }
        const shouldDrop = session.dragging && event.touches.length === 0
            && session.source.element.isConnected && this.root.contains(session.source.element);
        if (session.dragging) this.consume(event);
        const point = { clientX: touch.clientX, clientY: touch.clientY };
        this.cancel();
        if (shouldDrop) this.options.onDrop(session.source.task, point);
    }

    cancel(): void {
        this.clearTimers();
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        const session = this.session;
        this.session = null;
        session?.ghost?.remove();
        session?.source.element.classList.remove('reminder-item--touch-drag-ready');
        session?.source.element.classList.remove('reminder-item--touch-dragging');
        if (session?.dragging) {
            this.suppressClickUntil = Date.now() + 400;
            this.options.onEnd();
        }
    }

    dispose(): void {
        this.cancel();
        this.lifecycle.dispose();
        this.root.classList.remove('reminder-list--touch-draggable');
    }
}
