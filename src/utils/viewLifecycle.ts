/** 一个视图拥有的监听器、观察器和延迟绘制；不用于取消已经提交的业务写入。 */
export class ViewLifecycle {
    private disposed = false;
    private readonly cleanups = new Set<() => void>();
    private readonly timers = new Set<number>();
    private readonly frames = new Set<number>();

    addCleanup(cleanup: () => void): () => void {
        if (this.disposed) {
            cleanup();
            return () => {};
        }
        const remove = () => {
            if (this.cleanups.delete(remove)) cleanup();
        };
        this.cleanups.add(remove);
        return remove;
    }

    listen(target: EventTarget, type: string, listener: (event: any) => void, options?: boolean | AddEventListenerOptions): () => void {
        if (this.disposed) return () => {};
        target.addEventListener(type, listener, options);
        return this.addCleanup(() => target.removeEventListener(type, listener, options));
    }

    timeout(callback: () => void, delay: number = 0): number {
        if (this.disposed) return 0;
        const id = window.setTimeout(() => {
            this.timers.delete(id);
            if (!this.disposed) return callback();
        }, delay);
        this.timers.add(id);
        return id;
    }

    clearTimeout(id: number): void {
        window.clearTimeout(id);
        this.timers.delete(id);
    }

    frame(callback: FrameRequestCallback): number {
        if (this.disposed) return 0;
        const id = requestAnimationFrame(time => {
            this.frames.delete(id);
            if (!this.disposed) callback(time);
        });
        this.frames.add(id);
        return id;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.timers.forEach(id => window.clearTimeout(id));
        this.frames.forEach(id => cancelAnimationFrame(id));
        this.timers.clear();
        this.frames.clear();
        for (const cleanup of [...this.cleanups].reverse()) {
            try { cleanup(); } catch (error) { console.warn('Failed to release view resource:', error); }
        }
    }
}
