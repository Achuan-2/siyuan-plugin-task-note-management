import { ViewLifecycle } from './viewLifecycle';

export interface TaskDragPoint {
    clientX: number;
    clientY: number;
}

interface TaskDragSource<T> {
    element: HTMLElement;
    task: T;
    title: string;
}

interface LongPressTaskDragOptions<T> {
    getSource(target: HTMLElement): TaskDragSource<T> | null;
    onStart(source: TaskDragSource<T>): void;
    onMove(task: T, point: TaskDragPoint): void;
    onDrop(task: T, point: TaskDragPoint): void;
    onEnd(): void;
    /** 多列视图可自行滚动实际命中的容器，返回是否发生滚动。 */
    autoScroll?(point: TaskDragPoint, elapsed: number): boolean;
}

interface TouchDragSession<T> {
    source: TaskDragSource<T>;
    touchId: number;
    start: TaskDragPoint;
    point: TaskDragPoint;
    dragging: boolean;
    dirty: boolean;
    ghost?: HTMLElement;
    lastFrameTime?: number;
}

/** 沿用思源移动端文档树的长按门槛；开始拖动前不拦截列表滚动。 */
export class LongPressTaskDrag<T> {
    private readonly lifecycle = new ViewLifecycle();
    private session: TouchDragSession<T> | null = null;
    private longPressTimer = 0;
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
        this.lifecycle.listen(root, 'contextmenu', (event: Event) => {
            if (this.session || Date.now() < this.suppressClickUntil) this.consume(event);
        }, true);
        this.lifecycle.listen(root, 'click', (event: Event) => {
            if (Date.now() < this.suppressClickUntil) this.consume(event);
        }, true);
    }

    private consume(event: Event): void {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
    }

    private start(event: TouchEvent): void {
        this.cancel();
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        const source = this.options.getSource(event.target as HTMLElement);
        if (!source) return;
        const point = { clientX: touch.clientX, clientY: touch.clientY };
        const session: TouchDragSession<T> = {
            source, touchId: touch.identifier, start: point, point, dragging: false, dirty: true,
        };
        this.session = session;
        this.longPressTimer = this.lifecycle.timeout(() => {
            this.longPressTimer = 0;
            if (this.session !== session) return;
            if (!source.element.isConnected || !this.root.contains(source.element)) { this.cancel(); return; }
            // 排序配置、任务或视图可能在按住期间改变，开始前再确认一次。
            if (!this.options.getSource(source.element)) { this.cancel(); return; }
            session.dragging = true;
            source.element.classList.add('reminder-item--touch-dragging');
            const ghost = document.createElement('div');
            ghost.className = 'reminder-touch-drag-preview';
            ghost.textContent = source.title;
            ghost.style.width = `${Math.min(source.element.getBoundingClientRect().width, 360)}px`;
            document.body.appendChild(ghost);
            session.ghost = ghost;
            this.options.onStart(source);
            this.draw(session, performance.now());
        }, 460);
    }

    private move(event: TouchEvent): void {
        const session = this.session;
        if (!session) return;
        const touch = Array.from(event.touches).find(point => point.identifier === session.touchId);
        if (event.touches.length !== 1 || !touch) { this.cancel(); return; }
        session.point = { clientX: touch.clientX, clientY: touch.clientY };
        if (!session.dragging) {
            if (Math.abs(touch.clientX - session.start.clientX) > 5 || Math.abs(touch.clientY - session.start.clientY) > 5) {
                this.cancel();
            }
            return;
        }
        this.consume(event);
        session.dirty = true;
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
        if (this.longPressTimer) this.lifecycle.clearTimeout(this.longPressTimer);
        if (this.frame) cancelAnimationFrame(this.frame);
        this.longPressTimer = 0;
        this.frame = 0;
        const session = this.session;
        this.session = null;
        session?.ghost?.remove();
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
