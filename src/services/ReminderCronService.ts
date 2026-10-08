import { Cron } from 'croner';
import type { ReminderSchedule } from './ReminderSchedule';

interface ReminderCronHost {
    readSchedule(now: Date): Promise<ReminderSchedule>;
    check(now: Date): Promise<void>;
    onError(error: unknown): void;
}

/** Croner 负责定点唤醒，业务只在到点或收到数据变更时运行，不轮询存储。 */
export class ReminderCronService {
    private jobs = new Map<string, Cron>();
    private running = false;
    private refreshRequested = false;
    private activeRefresh: Promise<void> | null = null;
    private activeRun: Promise<void> | null = null;
    private pendingRuns: Date[] = [];
    private activeMinute: number | null = null;
    private changeTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly host: ReminderCronHost) {}

    public async start(): Promise<void> {
        if (this.running) return;
        this.running = true;
        await this.refresh();
        await this.run(); // 保留当前分钟提醒和当天汇总的启动检查。
    }

    public async stop(): Promise<void> {
        this.running = false;
        this.pendingRuns = [];
        if (this.changeTimer !== null) clearTimeout(this.changeTimer);
        this.changeTimer = null;
        for (const job of this.jobs.values()) job.stop();
        this.jobs.clear();
        await Promise.all([this.activeRefresh, this.activeRun]);
    }

    /** 文件写入常产生多个事件，合并后再读取，避免读取尚未写完的 JSON。 */
    public notifyChanged(): void {
        if (!this.running) return;
        if (this.changeTimer !== null) clearTimeout(this.changeTimer);
        this.changeTimer = setTimeout(() => {
            this.changeTimer = null;
            void this.refresh().then(() => this.run(true)).catch(this.host.onError);
        }, 250);
    }

    public refresh(): Promise<void> {
        if (!this.running) return Promise.resolve();
        this.refreshRequested = true;
        if (this.activeRefresh) return this.activeRefresh;
        this.activeRefresh = (async () => {
            while (this.running && this.refreshRequested) {
                this.refreshRequested = false;
                try {
                    const plan = await this.host.readSchedule(new Date());
                    if (this.running) this.replaceJobs(plan);
                } catch (error) {
                    this.host.onError(error);
                    // 临时读取失败只安排一次恢复检查，成功后移除，不扫描健康服务。
                    if (this.running) this.setJob('recovery', new Date(Date.now() + 30_000), false);
                    break;
                }
            }
        })().finally(() => { this.activeRefresh = null; });
        return this.activeRefresh;
    }

    private replaceJobs(plan: ReminderSchedule): void {
        for (const job of this.jobs.values()) job.stop();
        this.jobs.clear();
        const boundaries = new Set(['00:00', plan.dayStart]);
        for (const time of new Set([...plan.times, ...boundaries])) {
            const [hour, minute] = time.split(':').map(Number);
            this.setJob(`clock:${time}`, `0 ${minute} ${hour} * * *`, boundaries.has(time));
        }
        if (plan.retryAt) this.setJob('retry', plan.retryAt, false);
    }

    private setJob(key: string, pattern: string | Date, boundary: boolean): void {
        this.jobs.get(key)?.stop();
        this.jobs.set(key, new Cron(pattern, {
            protect: true,
            catch: (error: unknown) => this.host.onError(error)
        }, async () => {
            if (!this.running) return;
            if (boundary || key === 'recovery') await this.refresh();
            await this.run();
        }));
    }

    private run(force: boolean = false): Promise<void> {
        if (!this.running) return Promise.resolve();
        const now = new Date();
        const minute = Math.floor(now.getTime() / 60_000);
        if (this.activeRun) {
            // 慢请求不能吞掉下一分钟的任务；同一分钟的多个任务合并执行。
            if ((force || minute !== this.activeMinute) && !this.pendingRuns.some(date => Math.floor(date.getTime() / 60_000) === minute)) {
                this.pendingRuns.push(now);
            }
            return this.activeRun;
        }
        this.pendingRuns.push(now);
        this.activeRun = (async () => {
            do {
                while (this.running && this.pendingRuns.length) {
                    const dueAt = this.pendingRuns.shift()!;
                    this.activeMinute = Math.floor(dueAt.getTime() / 60_000);
                    try { await this.host.check(dueAt); }
                    catch (error) { this.host.onError(error); }
                }
                // 更新失败重试任务；只在实际唤醒后刷新，无固定间隔业务扫描。
                if (this.running) await this.refresh();
            } while (this.running && this.pendingRuns.length);
        })().finally(() => { this.activeRun = null; this.activeMinute = null; });
        return this.activeRun;
    }
}
