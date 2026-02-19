import { getFileBlob } from "../api";

// 缓存路径到 Blob URL 的映射
const audioCache: Record<string, string> = {};

/**
 * 将 SiYuan 里面的文件路径转换为可播放的 URL
 * 如果是 /data/storage/ 路径，转换成 Blob URL
 * 如果是 /plugins/ 路径，保持不变
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

    // 其他路径（如插件自带音频 /plugins/...）SiYuan Web Server 通常能直接处理
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
