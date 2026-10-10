import type { KernelStorage } from './storageAdapter';
import type { ReminderDueEvent } from '../services/reminderEvents';

export const FRONTEND_REMINDER_STATE_FILE = 'kernel-frontend-reminders.json';
const RETENTION_MS = 2 * 24 * 60 * 60_000;
const CLAIM_LEASE_MS = 30_000;
interface DeliveryState {
    events: Record<string, ReminderDueEvent>;
    delivered: Record<string, number>;
}

/** 内核保存事件、串行领取及确认；广播无订阅者时，前端连接后仍可补取。 */
export class KernelFrontendReminderDelivery {
    private state: DeliveryState | null = null;
    private savedState = '';
    private queue: Promise<unknown> = Promise.resolve();
    private claims = new Map<string, { owner: string; until: number }>();

    constructor(private readonly storage: KernelStorage) {}

    private serial<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => {});
        return next;
    }

    public initialize(): Promise<void> {
        return this.serial(async () => {
            if (this.state) return;
            const stored = await this.storage.loadData(FRONTEND_REMINDER_STATE_FILE, true);
            if (stored && (!stored.events || !stored.delivered)) throw new Error('Invalid frontend reminder state');
            this.state = stored || { events: {}, delivered: {} };
            this.savedState = JSON.stringify(this.state);
        });
    }

    /** 只持久化实际变化；写入失败时保留旧快照，后续检查仍可重试。 */
    private async saveState(): Promise<void> {
        const snapshot = JSON.stringify(this.state);
        if (snapshot === this.savedState) return;
        await this.storage.saveData(FRONTEND_REMINDER_STATE_FILE, this.state);
        this.savedState = snapshot;
    }

    public hasEvent(key: string): boolean { return !!this.state?.events[key]; }

    public async record(events: ReminderDueEvent[], now: number): Promise<ReminderDueEvent[]> {
        await this.initialize();
        return this.serial(async () => {
            const state = this.state!;
            const fresh = events.filter(event => !state.events[event.key]);
            for (const event of fresh) state.events[event.key] = event;
            for (const [key, event] of Object.entries(state.events)) {
                if (now - event.createdAt > RETENTION_MS) {
                    delete state.events[key]; delete state.delivered[key]; this.claims.delete(key);
                }
            }
            await this.saveState();
            return fresh;
        });
    }

    public getEvents(now: Date, logicalDate: string): ReminderDueEvent[] {
        return this.getEventsForWebhook(now, logicalDate).filter(event => !this.state!.delivered[event.key]);
    }

    public getEventsForWebhook(now: Date, logicalDate: string): ReminderDueEvent[] {
        return Object.values(this.state?.events || {}).filter(event => event.event === 'daily-reminders'
            ? event.logicalDate === logicalDate
            : Math.floor(event.createdAt / 60_000) === Math.floor(now.getTime() / 60_000));
    }

    public async claim(key: string, owner: string): Promise<boolean> {
        await this.initialize();
        return this.serial(async () => {
            if (!owner || !this.state!.events[key] || this.state!.delivered[key]) return false;
            const claim = this.claims.get(key);
            if (claim && claim.until > Date.now()) return false;
            this.claims.set(key, { owner, until: Date.now() + CLAIM_LEASE_MS });
            return true;
        });
    }

    public async acknowledge(key: string, owner: string): Promise<void> {
        await this.initialize();
        return this.serial(async () => {
            if (this.claims.get(key)?.owner !== owner) return;
            this.state!.delivered[key] = Date.now();
            try { await this.saveState(); }
            catch (error) { delete this.state!.delivered[key]; throw error; }
            this.claims.delete(key);
        });
    }

    public release(key: string, owner: string): void {
        if (this.claims.get(key)?.owner === owner) this.claims.delete(key);
    }
}
