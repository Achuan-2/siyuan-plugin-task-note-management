import type { IClient, ILogger } from 'siyuan/kernel';
import type { KernelStorage } from './storageAdapter';
import { SETTINGS_FILE, REMINDER_DATA_FILE, HABIT_DATA_FILE, HABIT_CHECKIN_DIR, HOLIDAY_DATA_FILE } from './constants';
import { ReminderTimeScanner } from '../services/ReminderTimeScanner';
import { buildWebhookPayload, buildWebhookReminderInfo, assertWebhookResponse, inferReminderWebhookJsonType } from '../services/webhookPayload';
import { generateRepeatInstances, getRepeatInstanceOriginalKey, getRepeatInstanceState } from '../components/dataManager/repeatUtils';
import { getLocalDateString, getLogicalDateString, getLocalTimeString, setDayStartTime, setSingleDateDefaultRole } from '../utils/dateUtils';
import { shouldSkipReminderOnDate, type HolidayData } from '../utils/reminderSkipDate';
import { shouldTreatStartDateOnlyAsOverdue } from '../utils/startDateOverdue';
import { getHabitReminderTimesForDate, getHabitGoalType, shouldCheckInOnDate, isHabitCompletedOnDate } from '../utils/habitUtils';
import { buildLinkedHabitPomodoroData, getLinkedTaskPomodoroStatsByDate } from '../utils/linkedHabitPomodoro';
import zhCN from '../../i18n/zh_CN.json';
import en from '../../i18n/en.json';

export const WEBHOOK_STATE_FILE = 'kernel-webhook-notify.json';
const CHECK_INTERVAL_MS = 30_000;
const RETRY_WINDOW_MS = 5 * 60_000;

interface WebhookNotification {
    title: string;
    message: string;
    event: string;
    reminderInfo?: any;
    reminders?: any[];
    createdAt: number;
}
interface WebhookState {
    sent: Record<string, number>;
    pending: Record<string, WebhookNotification>;
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

/** 内核独立调度 Webhook，发送记录与前端系统通知记录分开保存。 */
export class KernelWebhookScheduler {
    private timer: ReturnType<typeof setInterval> | null = null;
    private initialTimer: ReturnType<typeof setTimeout> | null = null;
    private activeCheck: Promise<void> | null = null;
    private state: WebhookState | null = null;
    private language = 'zh_CN';
    private activeHabitIds = new Set<string>();

    constructor(private readonly storage: KernelStorage, private readonly client: IClient, private readonly logger: ILogger) { }

    public async start(): Promise<void> {
        if (this.timer !== null) return;
        try {
            const response = await this.client.fetch('/api/system/getConf', { method: 'POST', body: '{}' });
            const conf = await response.json();
            this.language = conf.data?.conf?.lang || 'zh_CN';
        } catch {
            // 语言读取失败不阻止提醒服务启动。
        }
        const check = () => { void this.check().catch(() => this.logger.error('[kernel] Webhook reminder check failed')); };
        this.timer = setInterval(check, CHECK_INTERVAL_MS);
        this.initialTimer = setTimeout(check, 5000);
        await this.logger.info('[kernel] Webhook reminder scheduler started');
    }

    public async stop(): Promise<void> {
        if (this.timer !== null) clearInterval(this.timer);
        if (this.initialTimer !== null) clearTimeout(this.initialTimer);
        this.timer = null;
        this.initialTimer = null;
        await this.activeCheck?.catch(() => {});
    }

    public check(now: Date = new Date()): Promise<void> {
        if (this.activeCheck) return this.activeCheck;
        this.activeCheck = this.runCheck(now).finally(() => { this.activeCheck = null; });
        return this.activeCheck;
    }

    public async testWebhook(options: { url: string; template?: string; jsonType?: string; title?: string; message?: string }): Promise<boolean> {
        const payload = buildWebhookPayload(options.title || this.translate('testWebhookTitle'),
            options.message || this.translate('testWebhookMessage'), 'test', new Date().toISOString(),
            options.template || '', options.jsonType || 'custom');
        if (!payload) throw new Error('Payload generation failed (invalid template)');
        await sendKernelWebhook(this.client, options.url, payload);
        return true;
    }

    private translate(key: string, count?: number): string {
        const messages = this.language.startsWith('zh') ? zhCN : en;
        return (messages[key] || key).replace('${count}', String(count ?? ''));
    }

    private async runCheck(now: Date): Promise<void> {
        // 每轮读取最新设置和任务，浏览器关闭后修改/同步的数据仍会生效。
        const settings = await this.storage.loadData(SETTINGS_FILE, true) || {};
        if (settings.reminderWebhookEnabled !== true || !settings.reminderWebhookUrl?.trim()) return;
        setDayStartTime(settings.todayStartTime ?? '03:00');
        setSingleDateDefaultRole(settings.singleDateDefaultRole);
        const today = getLocalDateString(now);
        const logicalDate = getLogicalDateString(now);
        const currentTime = getLocalTimeString(now);
        const timestamp = now.getTime();

        if (!this.state) {
            const stored = await this.storage.loadData(WEBHOOK_STATE_FILE, true);
            if (stored && (!stored.sent || !stored.pending)) throw new Error('Invalid kernel Webhook notification state');
            this.state = stored || { sent: {}, pending: {} };
        }
        const state = this.state;
        for (const [key, sentAt] of Object.entries(state.sent)) {
            if (timestamp - sentAt > 2 * 24 * 60 * 60_000) delete state.sent[key];
        }
        for (const [key, item] of Object.entries(state.pending)) {
            if (timestamp - item.createdAt > RETRY_WINDOW_MS) delete state.pending[key];
        }
        const holidayData: HolidayData = await this.storage.loadData(HOLIDAY_DATA_FILE, true) || {};
        const tasks = await this.storage.loadData(REMINDER_DATA_FILE, true) || {};
        const subscriptions = await this.storage.loadData('ics_subscriptions.json', true);
        for (const sub of Object.values(subscriptions?.subscriptions || {}) as any[]) {
            if (sub?.enabled) Object.assign(tasks, await this.storage.loadData(`subscribe/${sub.id}.json`, true) || {});
        }
        const alreadyQueued = (key: string) => !!(state.sent[key] || state.pending[key]);
        let draft: WebhookNotification | undefined;
        const scanner = new ReminderTimeScanner({
            settings, notifiedReminders: new Map(),
            hasReminderNotified: async key => alreadyQueued(key),
            markReminderNotified: async key => {
                if (draft) state.pending[key] = draft;
                draft = undefined;
            },
            showTimeReminder: async (reminder, field = 'time', triggeredTime) => {
                const rawTime = field === 'reminderTimes' ? triggeredTime : reminder.time;
                const displayTime = rawTime?.split(/[T ]/).pop()?.slice(0, 5) || '';
                const timeNote = reminder.reminderTimes?.find((item: any) => typeof item === 'object' && item.time === rawTime)?.note;
                draft = {
                    title: `⏰ ${this.translate('timeReminderNotification')}`,
                    message: `${displayTime ? displayTime + ' ' : ''}${reminder.title || this.translate('unnamedNote')}${timeNote ? `（${timeNote}）` : ''}`,
                    event: 'time-reminder', reminderInfo: { ...buildWebhookReminderInfo(reminder), time: displayTime, notificationKind: 'task' }, createdAt: timestamp
                };
            }
        }, key => this.translate(key));
        await scanner.check(tasks, today, currentTime, holidayData);

        const habits = await this.collectHabitReminders(tasks, logicalDate, currentTime, timestamp, alreadyQueued);
        Object.assign(state.pending, habits);
        const dailyKey = `daily_${logicalDate}`;
        const dailyTime = typeof settings.dailyNotificationTime === 'number'
            ? `${String(Math.max(0, Math.min(23, Math.floor(settings.dailyNotificationTime)))).padStart(2, '0')}:00`
            : (settings.dailyNotificationTime || '08:00').padStart(5, '0');
        if (settings.dailyNotificationEnabled === true && currentTime >= dailyTime && !alreadyQueued(dailyKey)) {
            const reminders = this.collectDailyReminders(tasks, logicalDate, settings, holidayData);
            if (reminders.length) {
                const lines = reminders.slice(0, 2).map(item => `${item.isOverdue ? '⚠️ ' : ''}• ${item.title}${item.time ? ` ⏰${item.time}` : ''}`);
                if (reminders.length > 2) lines.push(`... ${this.translate('moreItems', reminders.length - 2)}`);
                state.pending[dailyKey] = {
                    title: `📅 ${this.translate('dailyRemindersNotification')} (${reminders.length})`,
                    message: lines.join('\n'), event: 'daily-reminders', reminders, createdAt: timestamp
                };
            }
        }

        // 发送前持久化待发送记录，重载内核后可继续重试；发送成功才记为已通知。
        await this.storage.saveData(WEBHOOK_STATE_FILE, state);
        for (const [key, notification] of Object.entries(state.pending)) {
            if (!this.isTaskStillActive(notification, tasks)) {
                delete state.pending[key];
                continue;
            }
            const jsonType = settings.reminderWebhookJsonType || inferReminderWebhookJsonType(settings.reminderWebhookJsonTemplate || '');
            const payload = buildWebhookPayload(notification.title, notification.message, notification.event, now.toISOString(),
                settings.reminderWebhookJsonTemplate || '', jsonType, notification);
            if (!payload) {
                await this.logger.error('[kernel] Invalid Webhook JSON template');
                continue;
            }
            try {
                await sendKernelWebhook(this.client, settings.reminderWebhookUrl.trim(), payload);
                state.sent[key] = timestamp;
                delete state.pending[key];
                await this.storage.saveData(WEBHOOK_STATE_FILE, state);
            } catch {
                // 不记录 URL 或响应正文，避免日志泄露机器人密钥。
                await this.logger.warn(`[kernel] Webhook notification failed; will retry: ${notification.event}`);
            }
        }
        await this.storage.saveData(WEBHOOK_STATE_FILE, state);
    }

    private isTaskStillActive(notification: WebhookNotification, tasks: Record<string, any>): boolean {
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
        alreadyQueued: (key: string) => boolean): Promise<Record<string, WebhookNotification>> {
        const result: Record<string, WebhookNotification> = {};
        this.activeHabitIds.clear();
        const habits = await this.storage.loadData(HABIT_DATA_FILE, true) || {};
        const hasPomodoroHabit = Object.values(habits).some((habit: any) => getHabitGoalType(habit) === 'pomodoro');
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
                    event: 'habit-reminder', reminderInfo: { ...buildWebhookReminderInfo(habit), date, time: clock, categoryId: habit.groupId, notificationKind: 'habit' }, createdAt: timestamp
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
                const reminder = { ...task, ...item };
                const start = reminder.date || reminder.endDate;
                if (!start || start > today || reminder.completed || reminder.dailyCompletions?.[today]
                    || shouldSkipReminderOnDate(reminder, today, settings, holidayData)) continue;
                const isOverdue = reminder.endDate ? reminder.endDate < today
                    : shouldTreatStartDateOnlyAsOverdue(reminder, settings) && reminder.date < today;
                result.push({ ...reminder, isAllDay: !reminder.time, isOverdue });
            }
        }
        return result.sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue)
            || (a.isOverdue ? a.date.localeCompare(b.date) : Number(a.isAllDay) - Number(b.isAllDay))
            || (a.time || '').localeCompare(b.time || '') || (a.title || '').localeCompare(b.title || ''));
    }
}
