import { SMTP_EMAIL_DUE_METHOD, type EmailSettings } from './emailNotification';

interface DesktopEmailHost {
    owner: string;
    canSend(): boolean;
    isReady(): boolean;
    isEnabled(): boolean;
    bind(method: string, handler: () => void): void;
    unbind(method: string, handler: () => void): void;
    call(method: string, params?: any): Promise<any>;
    send(settings: EmailSettings, title: string, message: string): Promise<void>;
    close(): void;
    onError(stage: 'send' | 'recover'): void;
}

/** 只负责执行内核领取的 SMTP 邮件，重试时间及去重记录由内核管理。 */
export class DesktopEmailService {
    private running = false;
    private recovery: Promise<void> | null = null;
    private sent = new Map<string, number>();
    private readonly onPending = () => { void this.recover(); };

    constructor(private readonly host: DesktopEmailHost) {}

    public start(): void {
        if (this.running || !this.host.canSend()) return;
        this.running = true;
        this.host.bind(SMTP_EMAIL_DUE_METHOD, this.onPending);
        this.host.bind('reminder-schedule-updated', this.onPending);
        void this.recover();
    }

    public stop(): void {
        this.running = false;
        this.host.unbind(SMTP_EMAIL_DUE_METHOD, this.onPending);
        this.host.unbind('reminder-schedule-updated', this.onPending);
        this.host.close();
    }

    public recover(): Promise<void> {
        if (!this.canDeliver()) return Promise.resolve();
        if (this.recovery) return this.recovery;
        this.recovery = this.deliver().catch(() => { if (this.running) this.host.onError('recover'); })
            .finally(() => { this.recovery = null; });
        return this.recovery;
    }

    private canDeliver(): boolean {
        return this.running && this.host.canSend() && this.host.isReady() && this.host.isEnabled();
    }

    private async deliver(): Promise<void> {
        for (const [key, sentAt] of this.sent) {
            if (Date.now() - sentAt > 2 * 24 * 60 * 60_000) this.sent.delete(key);
        }
        const keys: string[] = await this.host.call('get-smtp-email-events');
        // 内核启动或重连时可能返回空结果，后续由就绪/计划更新事件补取。
        if (!Array.isArray(keys)) return;
        for (const key of keys) {
            if (!this.canDeliver()) return;
            const params = { key, owner: this.host.owner };
            const mail = await this.host.call('claim-smtp-email', params);
            if (!mail) continue;
            let success = this.sent.has(key);
            try {
                if (!success && this.canDeliver()) {
                    await this.host.send(mail.settings, mail.title, mail.message);
                    this.sent.set(key, Date.now()); // 确认 RPC 失败时当前窗口只补确认，不再发信。
                    success = true;
                }
            } catch { if (this.running) this.host.onError('send'); }
            await this.host.call('finish-smtp-email', { ...params, sent: success });
        }
    }
}
