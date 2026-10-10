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

// 防抖状态与播放锁
let lastTaskCompleteSoundTime = 0;
let isPlayingNotificationSound = false;

/**
 * 获取通知声音设置路径
 */
export function getNotificationSound(settings: any): string {
    return settings?.audioSelected?.notificationSound || '';
}

/**
 * 播放任务完成音效
 */
export async function playTaskCompleteSound(settings: any): Promise<void> {
    try {
        if (!settings || settings.taskCompleteSoundEnabled === false) {
            return;
        }

        const now = Date.now();
        if (now - lastTaskCompleteSoundTime < 300) {
            return; // 防抖，避免短时间内多次重复播放
        }
        lastTaskCompleteSoundTime = now;

        const soundPath = settings.audioSelected?.taskCompleteSound || '/plugins/siyuan-plugin-task-note-management/audios/task_complete.mp3';
        if (!soundPath) return;

        const resolvedUrl = await resolveAudioPath(soundPath);
        if (!resolvedUrl) return;

        const audio = new Audio(resolvedUrl);
        const volume = typeof settings.taskCompleteVolume === 'number' ? settings.taskCompleteVolume : 1;
        audio.volume = Math.max(0, Math.min(1, volume));
        await audio.play();
    } catch (error) {
        console.warn("[AudioUtils] Failed to play task completion sound:", error);
    }
}

/**
 * 播放通知声音
 */
export async function playNotificationSound(plugin: any, settings: any): Promise<void> {
    try {
        const soundPath = getNotificationSound(settings);
        if (!soundPath) return;

        if (plugin && !plugin.audioEnabled) return;

        if (isPlayingNotificationSound) {
            console.debug('[AudioUtils] playNotificationSound - already playing, skip');
            return;
        }

        if (plugin?.preloadedAudio && plugin.preloadedAudio.src.includes(soundPath)) {
            try {
                isPlayingNotificationSound = true;
                plugin.preloadedAudio.currentTime = 0;
                await plugin.preloadedAudio.play();
                plugin.preloadedAudio.onended = () => {
                    isPlayingNotificationSound = false;
                };
                setTimeout(() => { isPlayingNotificationSound = false; }, 10000);
                return;
            } catch (error) {
                console.warn("[AudioUtils] Preloaded audio playback failed; trying new audio:", error);
            }
        }

        const resolvedUrl = await resolveAudioPath(soundPath);
        const audio = new Audio(resolvedUrl || soundPath);
        audio.volume = 1;
        isPlayingNotificationSound = true;
        audio.addEventListener('ended', () => {
            isPlayingNotificationSound = false;
        });
        const clearTimer = setTimeout(() => {
            isPlayingNotificationSound = false;
        }, 10000);
        try {
            await audio.play();
        } finally {
            clearTimeout(clearTimer);
        }
    } catch (error: any) {
        console.warn("[AudioUtils] Failed to play notification sound:", error?.name || error);
    }
}

