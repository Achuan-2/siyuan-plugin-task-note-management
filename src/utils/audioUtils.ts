import { getFileBlob } from "../api";
import { fetchSyncPost } from "siyuan";

// 缓存路径到 Blob URL 的映射
const audioCache: Record<string, string> = {};
const AUDIO_DIR = 'data/storage/petal/siyuan-plugin-task-note-management/audios';

function isStorageAudioPath(path: string): boolean {
    return /^\/?data\/storage\/petal\//.test(path);
}

async function readStorageAudio(path: string): Promise<Blob> {
    const blob = await getFileBlob(path.replace(/^\//, ''));
    // getFile 在文件不存在时可能返回 HTTP 202 + JSON，不能将错误信息用于播放。
    const contentType = blob?.type.split(';')[0].toLowerCase();
    if (!blob || blob.size === 0 || contentType === 'application/json' || contentType === 'text/html') {
        throw new Error(`Cannot read stored audio: ${path}`);
    }
    return blob;
}

/** 复制文件内容后上传，并确认存储文件可读取，再允许设置面板保存该路径。 */
export async function storeAudioFile(file: File): Promise<string> {
    // Electron 的 File 可能引用磁盘文件；先读取快照，避免上传时再依赖原文件。
    const contents = await file.arrayBuffer();
    if (contents.byteLength === 0) throw new Error('Audio file is empty');
    const path = `${AUDIO_DIR}/${file.name}`;
    const form = new FormData();
    form.append('path', path);
    form.append('isDir', 'false');
    form.append('file', new Blob([contents], { type: file.type }), file.name);
    // 通用 putFile 会把失败与成功的空 data 都返回为 null，这里必须检查原始 code。
    const result = await fetchSyncPost('/api/file/putFile', form);
    if (!result || result.code !== 0) {
        throw new Error(result?.msg || 'Audio upload failed');
    }

    // 同名覆盖后不能继续使用旧内容；校验失败时也不能留下旧缓存。
    delete audioCache[path];
    const blob = await readStorageAudio(path);
    if (blob.size !== contents.byteLength) {
        throw new Error(`Stored audio size mismatch: ${path}`);
    }
    audioCache[path] = URL.createObjectURL(blob);
    return `/${path}`;
}

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

    // storage 路径的两种写法共享缓存。
    const cacheKey = isStorageAudioPath(path) ? path.replace(/^\//, '') : path;
    if (audioCache[cacheKey]) {
        return audioCache[cacheKey];
    }

    // 只有在是 storage 路径时才需要 getFileBlob
    // 兼容 /data/storage/ 和 storage/ 前缀
    if (isStorageAudioPath(path)) {
        try {
            const blob = await readStorageAudio(path);
            const url = URL.createObjectURL(blob);
            audioCache[cacheKey] = url;
            return url;
        } catch (e) {
            console.warn("[AudioUtils] Failed to resolve storage audio path:", path, e);
            // 私有 storage 路径不是静态资源 URL，失败时交回调用方处理，不能直接播放。
            throw e;
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

