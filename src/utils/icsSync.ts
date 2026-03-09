import { getFileStat } from "../api";
import { uploadIcsToCloud } from "./icsUtils";

type IcsSyncInterval = "manual" | "15min" | "hourly" | "4hour" | "12hour" | "daily" | "dailyAt";

interface IcsSyncPlugin {
    loadSettings(update?: boolean): Promise<any>;
    saveSettings(settings: any): Promise<void>;
    isPrimaryInstance(): boolean;
}

interface IcsSyncState {
    timer: number | null;
    subscriptionTimer: number | null;
    isPerforming: boolean;
}

const ICS_SYNC_STATE = new WeakMap<object, IcsSyncState>();

function getState(plugin: IcsSyncPlugin): IcsSyncState {
    let state = ICS_SYNC_STATE.get(plugin as unknown as object);
    if (!state) {
        state = { timer: null, subscriptionTimer: null, isPerforming: false };
        ICS_SYNC_STATE.set(plugin as unknown as object, state);
    }
    return state;
}

export async function initIcsSync(plugin: IcsSyncPlugin): Promise<void> {
    const settings = await plugin.loadSettings();
    if (settings.icsSyncEnabled && settings.icsSyncInterval && settings.icsSyncInterval !== "manual") {
        // 启用时执行：如果是 dailyAt 模式，不立即执行，等待到指定时间点
        const executeImmediately = settings.icsSyncInterval !== "dailyAt";
        await scheduleIcsSync(plugin, settings.icsSyncInterval as IcsSyncInterval, executeImmediately);
    }
}

export async function handleIcsSyncSettingsChange(plugin: IcsSyncPlugin, settings: any): Promise<void> {
    if (settings.icsSyncEnabled && settings.icsSyncInterval && settings.icsSyncInterval !== "manual") {
        // 启用时立即安排并尽快执行一次同步
        await scheduleIcsSync(plugin, settings.icsSyncInterval as IcsSyncInterval, true);
    } else {
        cleanupIcsSync(plugin);
    }
}

export function cleanupIcsSync(plugin: IcsSyncPlugin): void {
    const state = getState(plugin);
    if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
    }
    if (state.subscriptionTimer) {
        clearInterval(state.subscriptionTimer);
        state.subscriptionTimer = null;
    }
}

export function cleanupIcsSubscriptionSync(plugin: IcsSyncPlugin): void {
    const state = getState(plugin);
    if (state.subscriptionTimer) {
        clearInterval(state.subscriptionTimer);
        state.subscriptionTimer = null;
    }
}

export async function initIcsSubscriptionSync(plugin: IcsSyncPlugin): Promise<void> {
    try {
        // 启动定时检查 (参考 ICS 云端同步的短轮询机制)
        await scheduleIcsSubscriptionSync(plugin);
    } catch (error) {
        console.error("初始化ICS订阅同步失败:", error);
    }
}

async function scheduleIcsSubscriptionSync(plugin: IcsSyncPlugin): Promise<void> {
    cleanupIcsSubscriptionSync(plugin);
    const state = getState(plugin);

    const shortPollMs = 60 * 1000; // 每分钟检查一次是否需要同步
    state.subscriptionTimer = window.setInterval(async () => {
        if (!plugin.isPrimaryInstance()) return;
        try {
            await performIcsSubscriptionSync(plugin);
        } catch (error) {
            console.error("ICS订阅轮询同步检查失败:", error);
        }
    }, shortPollMs);
}

async function performIcsSubscriptionSync(plugin: IcsSyncPlugin): Promise<void> {
    const { loadSubscriptions, syncSubscription, getSyncIntervalMs, saveSubscriptions } = await import("./icsSubscription");

    let data;
    try {
        data = await loadSubscriptions(plugin as any);
    } catch (_e) {
        return;
    }

    const subscriptions = Object.values(data.subscriptions).filter((sub: any) => sub.enabled);
    if (subscriptions.length === 0) return;

    let changed = false;
    const now = Date.now();

    for (const sub of subscriptions as any[]) {
        // 跳过手动模式的订阅
        if (sub.syncInterval === "manual") {
            continue;
        }

        let shouldSync = false;

        if (sub.syncInterval === "dailyAt") {
            // dailyAt 模式：按指定时间点同步
            const syncTime = sub.dailySyncTime || "08:00";
            const [hours, minutes] = syncTime.split(":").map(Number);
            const nowTime = new Date();
            const todaySyncTime = new Date(nowTime.getFullYear(), nowTime.getMonth(), nowTime.getDate(), hours, minutes, 0, 0).getTime();
            const lastSyncMs = sub.lastSync ? Date.parse(sub.lastSync) : 0;

            // 如果已经过了今天的同步时间点，且上次同步是在这个时间点之前
            if (now >= todaySyncTime && lastSyncMs < todaySyncTime) {
                shouldSync = true;
            }
        } else {
            // 其他模式：基于间隔时间
            const intervalMs = getSyncIntervalMs(sub.syncInterval);
            const lastSyncMs = sub.lastSync ? Date.parse(sub.lastSync) : 0;
            shouldSync = now >= lastSyncMs + intervalMs;
        }

        // 如果到了同步时间
        if (shouldSync) {
            console.log(`[Timer] Syncing ICS subscription: ${sub.name}`);
            const result = await syncSubscription(plugin as any, sub);

            // 更新订阅状态信息
            sub.lastSync = new Date().toISOString();
            sub.lastSyncStatus = result.success ? "success" : "error";
            if (!result.success) {
                sub.lastSyncError = result.error;
            } else {
                sub.lastSyncError = undefined;
            }

            data.subscriptions[sub.id] = sub;
            changed = true;
        }
    }

    if (changed) {
        await saveSubscriptions(plugin as any, data);
    }
}

async function scheduleIcsSync(plugin: IcsSyncPlugin, interval: IcsSyncInterval, executeImmediately: boolean = true): Promise<void> {
    // 如果是手动模式，不启动定时同步
    if (interval === "manual") {
        cleanupIcsSync(plugin);
        return;
    }
    // 使用短轮询（例如每30s）比较时间是否达到预定的下次同步时间，避免长期 setInterval 被后台杀死的问题
    const state = getState(plugin);
    if (state.timer) {
        clearInterval(state.timer);
    }

    const intervalMsMap: Record<string, number> = {
        "15min": 15 * 60 * 1000,
        hourly: 60 * 60 * 1000,
        "4hour": 4 * 60 * 60 * 1000,
        "12hour": 12 * 60 * 60 * 1000,
        daily: 24 * 60 * 60 * 1000,
        dailyAt: 24 * 60 * 60 * 1000,
    };
    const intervalMs = intervalMsMap[interval] || 24 * 60 * 60 * 1000;
    const shortPollMs = 30 * 1000;

    // 计算下次同步时间的函数
    const calculateNextDueMs = async (): Promise<number> => {
        const settings = await plugin.loadSettings();

        // dailyAt 模式：按每天指定时间点
        if (interval === "dailyAt") {
            const syncTime = settings.icsDailySyncTime || "08:00";
            const [hours, minutes] = syncTime.split(":").map(Number);
            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

            // 如果今天的时间已过，设置为明天
            if (target.getTime() <= now.getTime()) {
                target.setDate(target.getDate() + 1);
            }
            return target.getTime();
        }

        // 其他模式：基于上次同步时间 + 间隔
        if (settings && settings.icsLastSyncAt) {
            const last = Date.parse(settings.icsLastSyncAt);
            if (!isNaN(last)) {
                return last + intervalMs;
            }
        }
        return Date.now() + intervalMs;
    };

    // 计算首次的 nextDue 时间
    let nextDueMs: number;
    try {
        if (interval === "dailyAt") {
            // dailyAt 模式单独处理首次同步时间
            const settings = await plugin.loadSettings();
            const syncTime = settings.icsDailySyncTime || "08:00";
            const [hours, minutes] = syncTime.split(":").map(Number);
            const now = new Date();
            const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

            if (executeImmediately) {
                // 如果开启了立即执行，且今天的时间还没到，则等到指定时间
                nextDueMs = target.getTime();
            } else {
                // 不立即执行：如果今天时间已过，设置为明天
                if (target.getTime() <= now.getTime()) {
                    target.setDate(target.getDate() + 1);
                }
                nextDueMs = target.getTime();
            }
        } else if (interval === "hourly" || interval === "4hour" || interval === "12hour") {
            // 对齐到下一个整点或多个小时边界（例如每4小时、每12小时）
            const d = new Date();
            const h = d.getHours();
            let step = 1;
            if (interval === "4hour") step = 4;
            else if (interval === "12hour") step = 12;
            // 计算下一个 step 的边界小时（例如当前小时为 5，step=4 则下一个为 8）
            const nextHour = Math.ceil((h + 1) / step) * step;
            d.setHours(nextHour, 0, 0, 0);
            nextDueMs = d.getTime();
        } else {
            // 其他间隔模式
            const settings = await plugin.loadSettings();
            if (settings && settings.icsLastSyncAt) {
                const last = Date.parse(settings.icsLastSyncAt);
                if (!isNaN(last)) {
                    nextDueMs = last + intervalMs;
                } else {
                    nextDueMs = Date.now() + intervalMs;
                }
            } else {
                nextDueMs = executeImmediately ? Date.now() : Date.now() + intervalMs;
            }
        }
    } catch (e) {
        console.warn("计算 ICS 下次同步时间失败，使用默认策略:", e);
        nextDueMs = Date.now() + intervalMs;
    }

    // 立即触发（当需要时）
    if (executeImmediately && Date.now() >= nextDueMs) {
        await performIcsSync(plugin);
        nextDueMs = await calculateNextDueMs();
    }

    // 启动短轮询，比较当前时间与 nextDue
    state.timer = window.setInterval(async () => {
        if (!plugin.isPrimaryInstance()) return;
        try {
            const now = Date.now();
            if (now < nextDueMs) return;

            if (state.isPerforming) return;
            await performIcsSync(plugin);

            // 同步成功后，重新计算下一次触发时间
            nextDueMs = await calculateNextDueMs();
        } catch (e) {
            console.warn("短轮询触发 ICS 同步失败:", e);
        }
    }, shortPollMs);
}

async function performIcsSync(plugin: IcsSyncPlugin): Promise<void> {
    const state = getState(plugin);
    if (state.isPerforming) return;
    state.isPerforming = true;
    try {
        const settings = await plugin.loadSettings();
        if (!settings.icsSyncEnabled) return;

        // 检查reminder.json是否有新事件
        const reminderPath = "/data/storage/petal/siyuan-plugin-task-note-management/reminder.json";
        const stat = await getFileStat(reminderPath);
        const lastSync = settings.icsLastSyncAt ? new Date(settings.icsLastSyncAt).getTime() : 0;
        if (stat && stat.mtime <= lastSync) {
            // 没有新事件，只更新同步时间
            settings.icsLastSyncAt = new Date().toISOString();
            await plugin.saveSettings(settings);
            return;
        }

        await uploadIcsToCloud(plugin as any, settings, settings.icsSilentUpload);
    } catch (error) {
        console.error("ICS自动同步失败:", error);
    } finally {
        state.isPerforming = false;
    }
}
