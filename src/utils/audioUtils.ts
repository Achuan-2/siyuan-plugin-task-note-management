import { getFileBlob } from "../api";

// 缓存路径到 Blob URL 的映射
const audioCache: Record<string, string> = {};

/**
 * 获取思源服务端的基础 URL
 */
function getSiYuanBaseUrl(): string {
    // 优先使用当前窗口的 location
    if (typeof window !== 'undefined' && window.location) {
        const { protocol, host } = window.location;
        return `${protocol}//${host}`;
    }
    return '';
}

/**
 * 将 SiYuan 里面的文件路径转换为可播放的 URL
 * 如果是 /data/storage/ 路径，转换成 Blob URL
 * 如果是 /plugins/ 路径，转换为完整 URL
 */
export async function resolveAudioPath(path: string): Promise<string> {
    if (!path) return "";

    // 检查缓存
    if (audioCache[path]) {
        return audioCache[path];
    }

    // 只有在是 storage 路径时才需要 getFileBlob
    // 兼容 /data/storage/ 和 storage/ 前缀
    if (path.startsWith("/data/storage/petal/") || path.startsWith("data/storage/petal/")) {
        const apiPath = path.startsWith("/") ? path.substring(1) : path;
        try {
            const blob = await getFileBlob(apiPath);
            if (blob) {
                const url = URL.createObjectURL(blob);
                audioCache[path] = url;
                return url;
            }
        } catch (e) {
            console.warn("[AudioUtils] Failed to resolve storage audio path:", path, e);
        }
    }

    // 插件路径需要转换为完整 URL，以便在 BrowserWindow (data:text/html) 中使用
    if (path.startsWith("/plugins/")) {
        const baseUrl = getSiYuanBaseUrl();
        if (baseUrl) {
            const fullUrl = baseUrl + path;
            audioCache[path] = fullUrl;
            return fullUrl;
        }
    }

    // 其他路径保持不变
    return path;
}

/**
 * 创建一个用于播放的 HTMLAudioElement
 */
export async function createAudio(path: string): Promise<HTMLAudioElement | null> {
    const resolvedUrl = await resolveAudioPath(path);
    if (!resolvedUrl) return null;
    return new Audio(resolvedUrl);
}
