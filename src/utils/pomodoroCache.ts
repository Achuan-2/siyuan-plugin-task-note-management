import { mapPomodoroFiles } from './pomodoroStore';

// /temp 不参与同步；前端/内核分别按月分片，不广播业务更新。
interface CacheResponse { ok: boolean; status: number; json(): Promise<any>; }
type CacheFetch = (path: string, init: { method: string; headers?: Record<string, string>; body: string }) => Promise<CacheResponse>;

export function createPomodoroCache(pluginName: string, runtime: 'frontend' | 'kernel', request: CacheFetch) {
    const directory = `/temp/petal/${encodeURIComponent(pluginName)}/pomodoro-stats/${runtime}`;
    let lastManifest = '';
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
    const readJson = async (path: string) => {
        const response = await fetchCache('/api/file/getFile', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
        });
        if (response.status === 404 || response.data?.code === 404) return null;
        if (!response.ok) throw new Error(`读取番茄钟缓存失败: ${response.status}`);
        return response.data;
    };
    const writeJson = async (path: string, value: any) => {
        // 内核桥接只接受字符串/ArrayBuffer；字符串 multipart 可供两端共用。
        const boundary = `pomodoro-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const field = (name: string, value: string) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
        const body = field('path', path) + field('isDir', 'false')
            + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="summary.json"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(value)}\r\n--${boundary}--\r\n`;
        const response = await fetchCache('/api/file/putFile', {
            method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body,
        });
        if (!response.ok || response.data?.code !== 0) throw new Error('写入番茄钟缓存失败');
    };
    return {
        async readCache(): Promise<any> {
            const manifest = await readJson(`${directory}/manifest.json`);
            if (!manifest || !Array.isArray(manifest.months) || !manifest.months.every((month: any) => /^\d{4}-\d{2}$/.test(month))) return null;
            const days: Record<string, any> = Object.create(null);
            await mapPomodoroFiles(manifest.months as string[], async month => {
                try {
                    const shard = await readJson(`${directory}/${month}.json`);
                    if (shard?.version !== manifest.version || shard.configuration !== manifest.configuration || !shard.days || typeof shard.days !== 'object') return;
                    for (const [date, day] of Object.entries(shard.days)) if (date.slice(0, 7) === month) days[date] = day;
                } catch { /* 某月损坏只重建该月。 */ }
            });
            lastManifest = JSON.stringify(manifest);
            return { version: manifest.version, configuration: manifest.configuration, days };
        },
        async writeCache(cache: any, changedMonths?: string[]): Promise<void> {
            const months: string[] = cache.months || [...new Set(Object.keys(cache.days).map(date => date.slice(0, 7)))].sort();
            await mapPomodoroFiles(changedMonths || months, async month => {
                if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('番茄钟缓存月份无效');
                const days = Object.fromEntries(Object.entries(cache.days).filter(([date]) => date.slice(0, 7) === month));
                await writeJson(`${directory}/${month}.json`, { version: cache.version, configuration: cache.configuration, days });
            });
            const manifest = { version: cache.version, configuration: cache.configuration, months };
            if (JSON.stringify(manifest) !== lastManifest) {
                await writeJson(`${directory}/manifest.json`, manifest);
                lastManifest = JSON.stringify(manifest);
            }
        },
    };
}
