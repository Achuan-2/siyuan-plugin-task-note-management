// /temp 不参与思源数据同步；前端/内核分文件，缓存不广播业务更新。
interface CacheResponse { ok: boolean; status: number; json(): Promise<any>; }
type CacheFetch = (path: string, init: { method: string; headers?: Record<string, string>; body: string }) => Promise<CacheResponse>;

export function createPomodoroCache(pluginName: string, runtime: 'frontend' | 'kernel', request: CacheFetch) {
    const path = `/temp/petal/${encodeURIComponent(pluginName)}/pomodoro-stats/${runtime}.json`;
    const fetchCache = async (url: string, init: Parameters<CacheFetch>[1]) => {
        let timer: ReturnType<typeof setTimeout>;
        try {
            return await Promise.race([
                request(url, init).then(async response => ({
                    ok: response.ok, status: response.status,
                    data: response.status === 404 ? null : await response.json(),
                })),
                new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('番茄钟缓存请求超时')), 5000); }),
            ]);
        } finally { clearTimeout(timer); }
    };
    return {
        async readCache(): Promise<any> {
            const response = await fetchCache('/api/file/getFile', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
            });
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`读取番茄钟缓存失败: ${response.status}`);
            return response.data;
        },
        async writeCache(cache: any): Promise<void> {
            // 内核桥接只接受字符串/ArrayBuffer；字符串 multipart 可供两端共用。
            const boundary = `pomodoro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
            const body = field('path', path) + field('isDir', 'false')
                + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="summary.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(cache)}\r\n--${boundary}--\r\n`;
            const response = await fetchCache('/api/file/putFile', {
                method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body,
            });
            if (!response.ok || response.data?.code !== 0) throw new Error('写入番茄钟缓存失败');
        },
    };
}
