export type JsonShape = 'object' | 'array';

interface FileState {
    loaded: boolean;
    existed: boolean;
    blocked: boolean;
    tail: Promise<unknown>;
    reading?: Promise<any>;
}

interface StorageOptions {
    pluginName: () => string;
    appId: () => string;
    canWrite: () => boolean;
    fetch?: typeof fetch;
    timeoutMs?: number;
}

/**
 * 只管理读写可信状态，不另存一份业务缓存。
 * 失败必须向上传播；即使调用方捕获后构造了空数据，也不能绕过保存保护。
 */
export class ProtectedJsonStorage {
    private readonly files = new Map<string, FileState>();

    constructor(private readonly options: StorageOptions) {}

    block(file: string): void {
        this.state(file).blocked = true;
    }

    assertWritable(file: string): void {
        if (this.state(file).blocked) {
            throw new Error(`${file}: 上次读写失败，请重新加载数据后再保存`);
        }
    }

    private state(file: string): FileState {
        let state = this.files.get(file);
        if (!state) {
            state = { loaded: false, existed: false, blocked: false, tail: Promise.resolve() };
            this.files.set(file, state);
        }
        return state;
    }

    private enqueue<T>(state: FileState, operation: () => Promise<T>): Promise<T> {
        const pending = state.tail.then(operation);
        state.tail = pending.then(() => undefined, () => undefined);
        return pending;
    }

    private path(file: string): string {
        return `/data/storage/petal/${this.options.pluginName()}/${file}`;
    }

    private validate(file: string, data: any, shape: JsonShape): void {
        const valid = shape === 'array'
            ? Array.isArray(data)
            : data !== null && typeof data === 'object' && !Array.isArray(data);
        if (!valid) throw new Error(`${file}: JSON 数据格式无效，已取消读写`);
    }

    private async request<T>(url: string, init: RequestInit, consume: (response: Response) => Promise<T>): Promise<T> {
        const controller = new AbortController();
        // 超时包括读取响应体，不能让某次挂起的请求永远占住文件队列。
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new Error('插件数据请求超时'));
            }, this.options.timeoutMs ?? 15000);
        });
        try {
            return await Promise.race([
                (this.options.fetch ?? fetch)(url, { ...init, signal: controller.signal }).then(consume),
                timeout,
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    private async readFile(file: string, shape: JsonShape): Promise<any | null> {
        return this.request('/api/file/getFile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: this.path(file) }),
        }, async response => {
            const text = await response.text();
            // 兼容旧内核的 HTTP 202 和新内核的 HTTP 404；代理的普通 404 不算文件缺失。
            if (response.status === 202 || response.status === 404) {
                const error = JSON.parse(text);
                if (error?.code === 404) return null;
            }
            if (response.status !== 200) throw new Error(`${file}: 读取失败 (HTTP ${response.status})`);
            if (!text.trim()) throw new Error(`${file}: 文件内容为空，已取消读写`);
            const data = JSON.parse(text);
            // API 错误封装不是文件内容，不能拿它替代业务数据。
            if (data && typeof data.code === 'number' && typeof data.msg === 'string' && 'data' in data) {
                throw new Error(`${file}: 内核读取失败 (${data.code})`);
            }
            this.validate(file, data, shape);
            return data;
        });
    }

    load(file: string, shape: JsonShape): Promise<any> {
        const state = this.state(file);
        if (state.reading) return state.reading;
        const pending = this.enqueue(state, async () => {
            try {
                const data = await this.readFile(file, shape);
                if (data === null && state.existed) {
                    throw new Error(`${file}: 已有文件意外缺失，已阻止用空数据覆盖`);
                }
                state.loaded = true;
                state.existed = data !== null;
                state.blocked = false;
                return data;
            } catch (error) {
                state.blocked = true;
                throw error;
            }
        });
        state.reading = pending;
        const clear = () => { if (state.reading === pending) state.reading = undefined; };
        void pending.then(clear, clear);
        return pending;
    }

    async save(file: string, data: any, shape: JsonShape): Promise<any> {
        this.validate(file, data, shape);
        // 入队时固定快照，后续对业务对象的修改不会改变本次写入内容。
        // 序列化只在保存时执行，缓存读取不做深拷贝或全量比较。
        const json = JSON.stringify(data);
        const state = this.state(file);
        state.reading = undefined; // 后来的读取必须排在本次写入之后。
        return this.enqueue(state, async () => {
            if (!this.options.canWrite()) throw new Error(`${file}: 当前插件不可写`);
            this.assertWritable(file);
            if (!state.loaded) {
                // 允许新文件首次创建，但不能在没有读取已有内容时盲写整个文件。
                try {
                    const existing = await this.readFile(file, shape);
                    if (existing !== null) throw new Error(`${file}: 尚未加载已有数据，已取消覆盖`);
                    state.loaded = true;
                } catch (error) {
                    state.blocked = true;
                    throw error;
                }
            }
            try {
                const body = new FormData();
                body.append('path', this.path(file));
                body.append('isDir', 'false');
                body.append('app', this.options.appId());
                body.append('file', new Blob([json], { type: 'application/json' }), file.split('/').pop());
                const result = await this.request('/api/file/putFile', { method: 'POST', body }, async response => {
                    if (!response.ok) throw new Error(`${file}: 保存失败 (HTTP ${response.status})`);
                    const result = await response.json();
                    if (result?.code !== 0) throw new Error(`${file}: 内核未确认保存成功 (${result?.code})`);
                    return result;
                });
                state.existed = true;
                return result;
            } catch (error) {
                // 网络失败时不能确定是否落盘；先重新读取，再决定后续编辑。
                state.blocked = true;
                throw error;
            }
        });
    }
}
