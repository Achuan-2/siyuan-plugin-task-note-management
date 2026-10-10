import type { IClient, ILogger, ISiyuan } from 'siyuan/kernel';
import type { KernelStorage } from './storageAdapter';
import { SETTINGS_FILE, REMINDER_DATA_FILE, HABIT_DATA_FILE, HABIT_CHECKIN_DIR, HOLIDAY_DATA_FILE } from './constants';
import { ReminderTimeScanner } from '../services/ReminderTimeScanner';
import { ReminderCronService } from '../services/ReminderCronService';
import { buildReminderSchedule, type ReminderSchedule } from '../services/ReminderSchedule';
import { KernelReminderWatcher } from './reminderWatcher';
import { KernelFrontendReminderDelivery } from './frontendReminderDelivery';
import { REMINDER_DUE_METHOD, REMINDER_DAY_METHOD, type ReminderDueEvent, type ReminderEventSnapshot } from '../services/reminderEvents';
import { buildWebhookPayload, buildWebhookReminderInfo, assertWebhookResponse, inferReminderWebhookJsonType } from '../services/webhookPayload';
import { sendKernelEmail, normalizeEmailSettings, SMTP_EMAIL_DUE_METHOD, type EmailSettings } from '../services/emailNotification';
import { generateRepeatInstances, getRepeatInstanceOriginalKey, getRepeatInstanceState } from '../components/dataManager/repeatUtils';
import { getLocalDateString, getLogicalDateString, getLocalTimeString, setDayStartTime, setSingleDateDefaultRole } from '../utils/dateUtils';
import { shouldSkipReminderOnDate, type HolidayData } from '../utils/reminderSkipDate';
import { shouldTreatStartDateOnlyAsOverdue } from '../utils/startDateOverdue';
import { getHabitReminderTimesForDate, hasHabitPomodoroGoal, shouldCheckInOnDate, isHabitCompletedOnDate } from '../utils/habitUtils';
import { buildLinkedHabitPomodoroData, getLinkedTaskPomodoroStatsByDate } from '../utils/linkedHabitPomodoro';
import zhCN from '../../i18n/zh_CN.json';
import en from '../../i18n/en.json';

export const WEBHOOK_STATE_FILE = 'kernel-webhook-notify.json';
export const EMAIL_STATE_FILE = 'kernel-email-notify.json';
const RETRY_INTERVAL_MS = 30_000;
const RETRY_WINDOW_MS = 5 * 60_000;

interface ExternalNotification {
    title: string;
    message: string;
    event: string;
    reminderInfo?: any;
    reminders?: any[];
    createdAt: number;
    nextAttemptAt?: number;
    desktopWakeAt?: number;
    desktopClaim?: { owner: string; until: number };
}
interface NotificationDeliveryState {
    sent: Record<string, number>;
    pending: Record<string, ExternalNotification>;
    expired?: Record<string, number>;
}
interface ExternalNotificationChannel {
    name: 'Webhook' | 'Email';
    stateFile: string;
    desktop?: boolean;
    send?(notification: ExternalNotification, key: string, now: Date): Promise<void>;
}

/** 通过内核代理发送，Docker 不依赖页面 fetch，也不会受浏览器跨域限制影响。 */
export async function sendKernelWebhook(client: IClient, url: string, payload: any): Promise<void> {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Webhook URL must use HTTP or HTTPS');
    const response = await client.fetch('/api/network/forwardProxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url, method: 'POST', payload: JSON.stringify(payload),
            headers: [{ 'Content-Type': 'application/json' }], timeout: 8000, contentType: 'application/json'
        })
    });
    if (!response.ok) throw new Error(`Webhook proxy HTTP ${response.status}`);
    const result = await response.json();
    if (result?.code !== 0 || typeof result.data?.status !== 'number') throw new Error('Webhook proxy request failed');
    if (result.data.status < 200 || result.data.status >= 300) throw new Error(`Webhook HTTP ${result.data.status}`);
    assertWebhookResponse(result.data.body || '');
}

/** 唯一的到期调度服务：内核计算提醒，分别交给前端、Webhook 和邮箱通道。 */
export class KernelReminderService {
    private readonly cron: ReminderCronService;
    private watcher: KernelReminderWatcher | null = null;
    private started = false;
    private activeCheck: Promise<void> | null = null;
    private channelStates = new Map<string, NotificationDeliveryState>();
    private savedChannelStates = new Map<string, string>();
    private language = 'zh_CN';
    private activeHabitIds = new Set<string>();
    private readonly frontend: KernelFrontendReminderDelivery;
    private logicalDate = '';

    constructor(private readonly storage: KernelStorage, private readonly client: IClient, private readonly logger: ILogger,
        private readonly runtime?: ISiyuan) {
        this.frontend = new KernelFrontendReminderDelivery(storage);
        this.cron = new ReminderCronService({
            readSchedule: now => this.readSchedule(now),
            check: now => this.check(now),
            onError: () => { void this.logger.error('[kernel] Reminder schedule failed'); }
        });
    }

    public async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        try {
            const response = await this.client.fetch('/api/system/getConf', { method: 'POST', body: '{}' });
            const conf = await response.json();
            this.language = conf.data?.conf?.lang || 'zh_CN';
        } catch {
            // 语言读取失败不阻止提醒服务启动。
        }
        if (this.runtime?.event && this.runtime.storage?.watcher) {
            this.watcher = new KernelReminderWatcher(this.runtime, this.storage, path => {
                this.notifyChanged();
                // 前端只更新数据和补取提醒，不再自行生成调度计划。
                void this.runtime!.rpc.broadcast('reminder-schedule-updated', { path }).catch(() => {});
            });
            try { await this.watcher.start(); }
            catch {
                await this.watcher.stop();
                this.watcher = null;
                await this.logger.warn('[kernel] Storage watcher unavailable; reminder changes require refresh RPC');
            }
        }
        await this.cron.start();
        await this.logger.info('[kernel] Reminder scheduler started');
    }

    public async stop(): Promise<void> {
        this.started = false;
        await this.cron.stop();
        await this.watcher?.stop();
        this.watcher = null;
        await this.activeCheck?.catch(() => {});
    }

    public notifyChanged(): void { this.cron.notifyChanged(); }

    private async loadTasks(): Promise<Record<string, any>> {
        const tasks = await this.storage.loadData(REMINDER_DATA_FILE, true) || {};
        const subscriptions = await this.storage.loadData('ics-subscriptions.json', true)
            || await this.storage.loadData('ics_subscriptions.json', true);
        for (const sub of Object.values(subscriptions?.subscriptions || {}) as any[]) {
            if (sub?.enabled) Object.assign(tasks, await this.storage.loadData(`Subscribe/${sub.id}.json`, true)
                || await this.storage.loadData(`subscribe/${sub.id}.json`, true) || {});
        }
        return tasks;
    }

    private async readSchedule(now: Date): Promise<ReminderSchedule> {
        await this.watcher?.refreshDirectories();
        const settings = await this.storage.loadData(SETTINGS_FILE, true) || {};
        setDayStartTime(settings.todayStartTime ?? '03:00');
        setSingleDateDefaultRole(settings.singleDateDefaultRole);
        const plan = await buildReminderSchedule(await this.loadTasks(),
            await this.storage.loadData(HABIT_DATA_FILE, true) || {}, settings,
            await this.storage.loadData(HOLIDAY_DATA_FILE, true) || {}, now);
        for (const channel of this.getExternalChannels(settings)) {
            try {
                const state: NotificationDeliveryState | null = this.channelStates.get(channel.stateFile)
                    || await this.storage.loadData(channel.stateFile, true);
                if (state && (!state.sent || !state.pending)) throw new Error('Invalid notification state');
                const retryTimes = Object.values(state?.pending || {}).map(item =>
                    Math.min(Math.max(item.nextAttemptAt || item.desktopWakeAt || now.getTime(), item.desktopClaim?.until || 0),
                        Math.max(item.createdAt + RETRY_WINDOW_MS + 1, item.desktopClaim?.until || 0)));
                if (retryTimes.length) {
                    const retryAt = Math.max(now.getTime() + 1000, Math.min(...retryTimes));
                    plan.retryAt = new Date(Math.min(plan.retryAt?.getTime() ?? Infinity, retryAt));
                }
            } catch {
                // 通道记录故障不影响其他通知，单独安排恢复检查。
                plan.retryAt = new Date(Math.min(plan.retryAt?.getTime() ?? Infinity, now.getTime() + RETRY_INTERVAL_MS));
            }
        }
        return plan;
    }

    public check(now: Date = new Date()): Promise<void> {
        if (this.activeCheck) return this.activeCheck;
        this.activeCheck = this.runCheck(now).finally(() => { this.activeCheck = null; });
        return this.activeCheck;
    }

    public async getFrontendEvents(now: Date = new Date()): Promise<ReminderEventSnapshot> {
        await this.check(now);
        const tasks = await this.loadTasks();
        const settings = await this.storage.loadData(SETTINGS_FILE, true) || {};
        const holidayData: HolidayData = await this.storage.loadData(HOLIDAY_DATA_FILE, true) || {};
        const events = this.frontend.getEvents(now, getLogicalDateString(now))
            .filter(event => event.event !== 'daily-reminders' || settings.dailyNotificationEnabled === true)
            .filter(event => this.isTaskStillActive(event, tasks))
            .map(event => event.reminders ? { ...event, reminders: this.collectDailyReminders(tasks,
                event.logicalDate, settings, holidayData) } : event)
            .filter(event => !event.reminders || event.reminders.length > 0);
        return { logicalDate: getLogicalDateString(now), events };
    }

    public claimFrontendEvent(key: string, owner: string): Promise<boolean> { return this.frontend.claim(key, owner); }
    public acknowledgeFrontendEvent(key: string, owner: string): Promise<void> { return this.frontend.acknowledge(key, owner); }
    public releaseFrontendEvent(key: string, owner: string): void { this.frontend.release(key, owner); }

    public async testWebhook(options: { url: string; template?: string; jsonType?: string; title?: string; message?: string }): Promise<boolean> {
        const payload = buildWebhookPayload(options.title || this.translate('testWebhookTitle'),
            options.message || this.translate('testWebhookMessage'), 'test', new Date().toISOString(),
            options.template || '', options.jsonType || 'custom');
        if (!payload) throw new Error('Payload generation failed (invalid template)');
        await sendKernelWebhook(this.client, options.url, payload);
        return true;
    }

    public async testEmail(options: Partial<EmailSettings> & { title?: string; message?: string }): Promise<boolean> {
        await sendKernelEmail(this.client, options, options.title || this.translate('testEmailTitle'),
            options.message || this.translate('testEmailMessage'));
        return true;
    }

    /** SMTP 与桌面弹窗独立领取，已显示/关闭弹窗的事件仍可发邮件。 */
    public async getDesktopEmailEvents(now: Date = new Date()): Promise<string[]> {
        await this.check(now);
        const settings = normalizeEmailSettings(await this.storage.loadData(SETTINGS_FILE, true) || {});
        if (!settings.reminderEmailEnabled || settings.reminderEmailTransport !== 'smtp') return [];
        const timestamp = now.getTime();
        return Object.entries(this.channelStates.get(EMAIL_STATE_FILE)?.pending || {})
            .filter(([, item]) => (!item.nextAttemptAt || item.nextAttemptAt <= timestamp)
                && (!item.desktopClaim || item.desktopClaim.until <= timestamp)
                && timestamp - item.createdAt <= RETRY_WINDOW_MS)
            .map(([key]) => key);
    }

    public async claimDesktopEmail(key: string, owner: string, now: Date = new Date()) {
        if (!owner || !(await this.getDesktopEmailEvents(now)).includes(key)) return null;
        const settings = normalizeEmailSettings(await this.storage.loadData(SETTINGS_FILE, true) || {});
        if (!settings.reminderEmailEnabled || settings.reminderEmailTransport !== 'smtp') return null;
        const state = this.channelStates.get(EMAIL_STATE_FILE)!;
        const notification = state.pending[key];
        if (!notification || notification.desktopClaim?.until > now.getTime()) return null;
        notification.desktopClaim = { owner, until: now.getTime() + 90_000 };
        try { await this.saveChannelState(EMAIL_STATE_FILE, state); }
        catch (error) { delete notification.desktopClaim; throw error; }
        return { key, title: notification.title, message: notification.message, settings };
    }

    public async finishDesktopEmail(key: string, owner: string, sent: boolean, now: Date = new Date()): Promise<void> {
        await this.activeCheck;
        const state = this.channelStates.get(EMAIL_STATE_FILE);
        const notification = state?.pending[key];
        if (!notification || notification.desktopClaim?.owner !== owner) return;
        if (sent) {
            state.sent[key] = now.getTime();
            delete state.pending[key];
        } else {
            delete notification.desktopClaim;
            notification.nextAttemptAt = now.getTime() + RETRY_INTERVAL_MS;
        }
        await this.saveChannelState(EMAIL_STATE_FILE, state);
        this.notifyChanged();
    }

    private getExternalChannels(settings: any): ExternalNotificationChannel[] {
        const channels: ExternalNotificationChannel[] = [];
        if (settings.reminderWebhookEnabled === true && settings.reminderWebhookUrl?.trim()) {
            channels.push({ name: 'Webhook', stateFile: WEBHOOK_STATE_FILE, send: async (notification, _key, now) => {
                const jsonType = settings.reminderWebhookJsonType
                    || inferReminderWebhookJsonType(settings.reminderWebhookJsonTemplate || '');
                const payload = buildWebhookPayload(notification.title, notification.message, notification.event, now.toISOString(),
                    settings.reminderWebhookJsonTemplate || '', jsonType, notification);
                if (!payload) throw new Error('Invalid Webhook JSON template');
                await sendKernelWebhook(this.client, settings.reminderWebhookUrl.trim(), payload);
            } });
        }
        if (settings.reminderEmailEnabled === true) {
            const emailSettings = normalizeEmailSettings(settings);
            channels.push(emailSettings.reminderEmailTransport === 'smtp'
                ? { name: 'Email', stateFile: EMAIL_STATE_FILE, desktop: true }
                : { name: 'Email', stateFile: EMAIL_STATE_FILE,
                    send: (notification, key) => sendKernelEmail(this.client, emailSettings, notification.title, notification.message, key) });
        }
        return channels;
    }

    private translate(key: string, count?: number): string {
        const messages = this.language.startsWith('zh') ? zhCN : en;
        return (messages[key] || key).replace('${count}', String(count ?? ''));
    }

    private async runCheck(now: Date): Promise<void> {
        // 仅在到期、数据变更或失败重试时读取最新状态。
        const settings = await this.storage.loadData(SETTINGS_FILE, true) || {};
        setDayStartTime(settings.todayStartTime ?? '03:00');
        setSingleDateDefaultRole(settings.singleDateDefaultRole);
        const today = getLocalDateString(now);
        const logicalDate = getLogicalDateString(now);
        const currentTime = getLocalTimeString(now);
        const timestamp = now.getTime();

        await this.frontend.initialize();
        const holidayData: HolidayData = await this.storage.loadData(HOLIDAY_DATA_FILE, true) || {};
        const tasks = await this.loadTasks();
        const notifications: Record<string, ExternalNotification> = {};
        const alreadyQueued = (key: string) => this.frontend.hasEvent(key);
        let draft: ExternalNotification | undefined;
        const scanner = new ReminderTimeScanner({
            settings, notifiedReminders: new Map(),
            hasReminderNotified: async key => alreadyQueued(key),
            markReminderNotified: async key => {
                if (draft) notifications[key] = draft;
                draft = undefined;
            },
            showTimeReminder: async (reminder, field = 'time', triggeredTime) => {
                const rawTime = field === 'reminderTimes' ? triggeredTime : reminder.time;
                const displayTime = rawTime?.split(/[T ]/).pop()?.slice(0, 5) || '';
                const timeNote = reminder.reminderTimes?.find((item: any) => typeof item === 'object' && item.time === rawTime)?.note;
                draft = {
                    title: `⏰ ${this.translate('timeReminderNotification')}`,
                    message: `${displayTime ? displayTime + ' ' : ''}${reminder.title || this.translate('unnamedNote')}${timeNote ? `（${timeNote}）` : ''}`,
                    event: 'time-reminder', reminderInfo: { ...buildWebhookReminderInfo(reminder),
                        instanceId: reminder.instanceId, time: displayTime, isAllDay: false, isOverdue: false,
                        _triggerField: field, notificationKind: 'task' }, createdAt: timestamp
                };
            }
        }, key => this.translate(key));
        await scanner.check(tasks, today, currentTime, holidayData);

        const habits = await this.collectHabitReminders(tasks, logicalDate, currentTime, timestamp, alreadyQueued);
        Object.assign(notifications, habits);
        const dailyKey = `daily_${logicalDate}`;
        const dailyTime = typeof settings.dailyNotificationTime === 'number'
            ? `${String(Math.max(0, Math.min(23, Math.floor(settings.dailyNotificationTime)))).padStart(2, '0')}:00`
            : (settings.dailyNotificationTime || '08:00').padStart(5, '0');
        if (settings.dailyNotificationEnabled === true && currentTime >= dailyTime && !alreadyQueued(dailyKey)) {
            const reminders = this.collectDailyReminders(tasks, logicalDate, settings, holidayData);
            if (reminders.length) {
                const lines = reminders.map(item => `${item.isOverdue ? '⚠️ ' : ''}• ${item.title}${item.time ? ` ⏰${item.time}` : ''}`
                    + (item.categoryName ? ` [${item.categoryName}]` : ''));
                notifications[dailyKey] = {
                    title: `📅 ${this.translate('dailyRemindersNotification')} (${reminders.length})`,
                    message: lines.join('\n'), event: 'daily-reminders', reminders, createdAt: timestamp
                };
            }
        }

        const events: ReminderDueEvent[] = Object.entries(notifications).map(([key, notification]) => ({
            ...notification, key, logicalDate, event: notification.event as ReminderDueEvent['event'],
            frontendKey: notification.event === 'habit-reminder'
                ? `${notification.reminderInfo.id}_${logicalDate}_${notification.reminderInfo.time}` : key
        }));
        const fresh = await this.frontend.record(events, timestamp);
        if (this.logicalDate !== logicalDate) {
            this.logicalDate = logicalDate;
            await this.broadcast(REMINDER_DAY_METHOD, { logicalDate });
        }
        if (fresh.length) await this.broadcast(REMINDER_DUE_METHOD, { events: fresh });
        for (const channel of this.getExternalChannels(settings)) {
            // 桌面推送先完成；每个外部通道独立去重、重试，失败不影响其他通道。
            try { await this.sendExternalNotifications(channel, tasks, now, logicalDate); }
            catch { await this.logger.error(`[kernel] ${channel.name} delivery state failed`); }
        }
    }

    private async broadcast(method: string, params: any): Promise<void> {
        try { await this.runtime?.rpc.broadcast(method, params); }
        catch { await this.logger.warn('[kernel] Reminder broadcast failed; frontend can recover events'); }
    }

    private async sendExternalNotifications(channel: ExternalNotificationChannel, tasks: Record<string, any>, now: Date, logicalDate: string): Promise<void> {
        const timestamp = now.getTime();
        if (!this.channelStates.has(channel.stateFile)) {
            const stored = await this.storage.loadData(channel.stateFile, true);
            if (stored && (!stored.sent || !stored.pending)) throw new Error('Invalid notification state');
            const state: NotificationDeliveryState = stored || { sent: {}, pending: {} };
            state.expired ??= {};
            this.channelStates.set(channel.stateFile, state);
            this.savedChannelStates.set(channel.stateFile, JSON.stringify(state));
        }
        const state = this.channelStates.get(channel.stateFile)!;
        state.expired ??= {};
        for (const [key, sentAt] of Object.entries(state.sent)) {
            if (timestamp - sentAt > 2 * 24 * 60 * 60_000) delete state.sent[key];
        }
        for (const [key, item] of Object.entries(state.pending)) {
            if (timestamp - item.createdAt > RETRY_WINDOW_MS && !(item.desktopClaim?.until > timestamp)) {
                delete state.pending[key]; state.expired[key] = timestamp;
            }
        }
        for (const [key, expiredAt] of Object.entries(state.expired)) {
            if (timestamp - expiredAt > 2 * 24 * 60 * 60_000) delete state.expired[key];
        }
        // 通道独立去重：前端已确认的事件仍可发送外部通知，反之亦然。
        for (const event of this.frontend.getEventsForWebhook(now, logicalDate)) {
            if (!state.sent[event.key] && !state.pending[event.key] && !state.expired[event.key]
                && this.isTaskStillActive(event, tasks)) {
                state.pending[event.key] = { ...event, createdAt: timestamp };
            }
        }

        // 发送前持久化待发送记录，重载内核后可继续重试；发送成功才记为已通知。
        await this.saveChannelState(channel.stateFile, state);
        let wakeDesktop = false;
        for (const [key, notification] of Object.entries(state.pending)) {
            // 切换发送方式时也尊重正在执行的 SMTP，避免 API 与桌面端重复发同一封邮件。
            if (notification.desktopClaim?.until > timestamp) continue;
            if (!this.isTaskStillActive(notification, tasks)) {
                delete state.pending[key];
                continue;
            }
            if (notification.nextAttemptAt && notification.nextAttemptAt > timestamp) continue;
            if (channel.desktop) {
                if (!notification.desktopWakeAt || notification.desktopWakeAt <= timestamp) {
                    notification.desktopWakeAt = timestamp + RETRY_INTERVAL_MS;
                    wakeDesktop = true;
                }
                continue;
            }
            try {
                await channel.send!(notification, key, now);
                state.sent[key] = timestamp;
                delete state.pending[key];
                await this.saveChannelState(channel.stateFile, state);
            } catch {
                notification.nextAttemptAt = timestamp + RETRY_INTERVAL_MS;
                // 不记录配置或响应正文，避免泄露机器人和邮件服务密钥。
                await this.logger.warn(`[kernel] ${channel.name} notification failed; will retry: ${notification.event}`);
            }
        }
        await this.saveChannelState(channel.stateFile, state);
        if (wakeDesktop) await this.broadcast(SMTP_EMAIL_DUE_METHOD, {});
    }

    /** 空检查和已完成发送不应制造新的同步变更，失败写入则继续重试。 */
    private async saveChannelState(file: string, state: NotificationDeliveryState): Promise<void> {
        const snapshot = JSON.stringify(state);
        if (snapshot === this.savedChannelStates.get(file)) return;
        await this.storage.saveData(file, state);
        this.savedChannelStates.set(file, snapshot);
    }

    private isTaskStillActive(notification: ExternalNotification, tasks: Record<string, any>): boolean {
        const info = notification.reminderInfo;
        if (!info) return true;
        if (info.notificationKind === 'habit') return this.activeHabitIds.has(info.id);
        const task = tasks[info.originalId || info.id];
        if (!task || task.completed || task.kanbanStatus === 'abandoned') return false;
        const key = getRepeatInstanceOriginalKey(info);
        const instance = info.isRepeatInstance ? getRepeatInstanceState(task, key) : undefined;
        return !instance?.completed && !instance?.deleted && !task.dailyCompletions?.[key];
    }

    private async collectHabitReminders(tasks: Record<string, any>, date: string, time: string, timestamp: number,
        alreadyQueued: (key: string) => boolean): Promise<Record<string, ExternalNotification>> {
        const result: Record<string, ExternalNotification> = {};
        this.activeHabitIds.clear();
        const habits = await this.storage.loadData(HABIT_DATA_FILE, true) || {};
        const hasPomodoroHabit = Object.values(habits).some((habit: any) => hasHabitPomodoroGoal(habit));
        const record = hasPomodoroHabit ? await this.storage.loadData(`pomodoroRecords/${date}.json`, true) : null;
        const sessions = Array.isArray(record?.sessions) ? record.sessions.filter((session: any) => !session.inProgress) : [];
        const linkedStats = buildLinkedHabitPomodoroData(tasks, { [date]: { sessions } }).statsByHabit;
        for (const habit of Object.values(habits) as any[]) {
            if (!habit?.id || habit.abandoned || !shouldCheckInOnDate(habit, date)) continue;
            const checkIn = await this.storage.loadData(`${HABIT_CHECKIN_DIR}/${habit.id}.json`, true);
            const currentHabit = { ...habit, checkIns: checkIn?.checkIns || habit.checkIns || {} };
            if (isHabitCompletedOnDate(currentHabit, date, {
                getPomodoroFocusMinutes: id => sessions.filter((session: any) => session.type === 'work' && session.eventId === id)
                    .reduce((sum: number, session: any) => sum + session.duration, 0)
                    + getLinkedTaskPomodoroStatsByDate(linkedStats, id, date).focusMinutes
            })) continue;
            this.activeHabitIds.add(habit.id);
            for (const entry of getHabitReminderTimesForDate(currentHabit, date)) {
                const parts = entry.time.split(/[T ]/);
                const clock = parts.pop()?.slice(0, 5);
                if (clock !== time || (parts.length && parts[0] !== date)) continue;
                const key = `habit_${habit.id}_${date}_${entry.time}`;
                if (alreadyQueued(key)) continue;
                const note = entry.note || habit.note;
                result[key] = {
                    title: `🌱${this.translate('habitReminder')}`,
                    message: `${clock} ${habit.title || this.translate('unnamedNote')}${note ? `（${note}）` : ''}`,
                    event: 'habit-reminder', reminderInfo: { ...buildWebhookReminderInfo(habit), note,
                        date, time: clock, categoryId: habit.groupId, isAllDay: false, notificationKind: 'habit' }, createdAt: timestamp
                };
            }
        }
        return result;
    }

    private collectDailyReminders(tasks: Record<string, any>, today: string, settings: any, holidayData: HolidayData): any[] {
        const result: any[] = [];
        for (const task of Object.values(tasks)) {
            if (!task || task.completed || task.kanbanStatus === 'abandoned') continue;
            const instances = task.repeat?.enabled
                ? generateRepeatInstances(task, today, today, 100, { settings, holidayData })
                : [task];
            for (const item of instances) {
                const reminder = { ...task, ...item, ...(task.repeat?.enabled ? {
                    id: item.instanceId, instanceId: item.instanceId, originalId: task.id, isRepeatInstance: true
                } : {}) };
                const start = reminder.date || reminder.endDate;
                if (!start || start > today || reminder.completed || reminder.dailyCompletions?.[today]
                    || (reminder.isRepeatInstance && reminder.dailyCompletions?.[getRepeatInstanceOriginalKey(reminder)])
                    || shouldSkipReminderOnDate(reminder, today, settings, holidayData)) continue;
                const isOverdue = reminder.endDate ? reminder.endDate < today
                    : shouldTreatStartDateOnlyAsOverdue(reminder, settings) && reminder.date < today;
                result.push({ ...buildWebhookReminderInfo(reminder), instanceId: reminder.instanceId,
                    notificationKind: 'task', isAllDay: !reminder.time, isOverdue });
            }
        }
        return result.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue)
            || (a.isOverdue ? a.date.localeCompare(b.date) : Number(a.isAllDay) - Number(b.isAllDay))
            || (a.time || '').localeCompare(b.time || '') || (a.title || '').localeCompare(b.title || ''));
    }
}
