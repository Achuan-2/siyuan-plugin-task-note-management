type ElementSelector = string | (() => Element | null);

/** 同一目标共用等待任务；超时或插件关闭后释放观察器，不逐帧扫描文档。 */
export class ElementWaiter {
    private disposed = false;
    private pending = new Map<ElementSelector, { promise: Promise<Element | null>; cancel: () => void }>();

    constructor(private readonly root: Document = document, private readonly timeoutMs = 5000) {}

    wait(selector: ElementSelector): Promise<Element | null> {
        if (this.disposed) return Promise.resolve(null);
        const existing = this.pending.get(selector);
        if (existing) return existing.promise;
        const find = () => typeof selector === 'string' ? this.root.querySelector(selector) : selector();
        const element = find();
        if (element) return Promise.resolve(element);

        let finish: (element: Element | null) => void;
        const promise = new Promise<Element | null>(resolve => { finish = resolve; });
        const observer = new MutationObserver(() => {
            const element = find();
            if (element) complete(element);
        });
        const complete = (element: Element | null) => {
            observer.disconnect();
            clearTimeout(timer);
            this.pending.delete(selector);
            finish(element);
        };
        const timer = setTimeout(() => complete(null), this.timeoutMs);
        this.pending.set(selector, { promise, cancel: () => complete(null) });
        observer.observe(this.root.documentElement, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['data-type'],
        });
        return promise;
    }

    dispose(): void {
        this.disposed = true;
        for (const task of this.pending.values()) task.cancel();
    }
}
