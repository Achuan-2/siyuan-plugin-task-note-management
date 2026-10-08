import { REMINDER_DUE_METHOD, REMINDER_DAY_METHOD, type ReminderDueEvent, type ReminderEventSnapshot } from './reminderEvents';

interface FrontendReminderHost {
    owner: string;
    bind(method: string, handler: (...args: any[]) => any): void;
    unbind(method: string, handler: (...args: any[]) => any): void;
    call(method: string, params?: any): Promise<any>;
    canReceive(): boolean;
    hasNotified(event: ReminderDueEvent): Promise<boolean>;
    markNotified(event: ReminderDueEvent): Promise<void>;
    show(event: ReminderDueEvent): Promise<void>;
    onLogicalDate(date: string): void;
    onError(error: unknown): void;
}

/** 前端只接收、领取和展示提醒，不计算到期时间、不创建 Croner 任务。 */
export class FrontendReminderService {
    private running = false;
    private queue: Promise<void> = Promise.resolve();
    private recovery: Promise<void> | null = null;
    private shown = new Set<string>();
    private logicalDate = '';
    private readonly onDue = (params: { events: ReminderDueEvent[] }) => this.receive(params?.events);
    private readonly onDay = (event: { logicalDate: string }) => this.updateLogicalDate(event.logicalDate);
    private readonly onData = () => { void this.recover(); };

    constructor(private readonly host: FrontendReminderHost) {}

    private updateLogicalDate(date: string): void {
        if (!this.running || !date) return;
        if (this.logicalDate !== date) this.shown.clear();
        this.logicalDate = date;
        this.host.onLogicalDate(date);
    }

    public start(): void {
        if (this.running) return;
        this.running = true;
        this.host.bind(REMINDER_DUE_METHOD, this.onDue);
        this.host.bind(REMINDER_DAY_METHOD, this.onDay);
        this.host.bind('reminder-schedule-updated', this.onData);
        void this.recover();
    }

    public stop(): void {
        this.running = false;
        this.host.unbind(REMINDER_DUE_METHOD, this.onDue);
        this.host.unbind(REMINDER_DAY_METHOD, this.onDay);
        this.host.unbind('reminder-schedule-updated', this.onData);
        this.shown.clear();
    }

    /** 启动、内核就绪和连接恢复时补取；普通时间提醒仅补当前分钟。 */
    public recover(): Promise<void> {
        if (!this.running) return Promise.resolve();
        if (this.recovery) return this.recovery;
        this.recovery = (async () => {
            try {
                const snapshot: ReminderEventSnapshot = await this.host.call('get-reminder-events');
                if (!this.running) return;
                this.updateLogicalDate(snapshot.logicalDate);
                await this.receive(snapshot.events);
            } catch (error) { if (this.running) this.host.onError(error); }
        })().finally(() => { this.recovery = null; });
        return this.recovery;
    }

    public receive(events: ReminderDueEvent[]): Promise<void> {
        if (!Array.isArray(events)) return Promise.resolve();
        this.queue = this.queue.then(async () => {
            for (const event of events) {
                if (!this.running || !this.host.canReceive()) return;
                if (!event?.key || this.shown.has(event.key)) continue;
                const params = { key: event.key, owner: this.host.owner };
                try {
                    if (!await this.host.call('claim-reminder-event', params)) continue;
                    if (!this.running) {
                        await this.host.call('release-reminder-event', params);
                        return;
                    }
                    const alreadyNotified = await this.host.hasNotified(event);
                    if (!this.running) {
                        await this.host.call('release-reminder-event', params);
                        return;
                    }
                    if (!alreadyNotified) {
                        await this.host.show(event);
                        this.shown.add(event.key); // 确认/存储失败也不能在当前窗口重复显示。
                        await this.host.markNotified(event);
                    }
                    await this.host.call('ack-reminder-event', params);
                    this.shown.add(event.key);
                } catch (error) {
                    await this.host.call('release-reminder-event', params).catch(() => {});
                    this.host.onError(error);
                }
            }
        }).catch(error => this.host.onError(error));
        return this.queue;
    }
}
