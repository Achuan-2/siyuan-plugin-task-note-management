import type { IClient } from 'siyuan/kernel';

export const EMAIL_PROVIDERS = ['smtp2go', 'resend', 'custom'] as const;
export type EmailProvider = typeof EMAIL_PROVIDERS[number];
export const EMAIL_TRANSPORTS = ['smtp', 'api'] as const;
export const SMTP_SECURITY_MODES = ['tls', 'starttls'] as const;
export const SMTP_EMAIL_DUE_METHOD = 'smtp-email-pending';

export const DEFAULT_EMAIL_SETTINGS = {
    reminderEmailEnabled: false,
    reminderEmailTransport: 'smtp' as typeof EMAIL_TRANSPORTS[number],
    reminderEmailSmtpHost: '',
    reminderEmailSmtpPort: 465,
    reminderEmailSmtpSecurity: 'tls' as typeof SMTP_SECURITY_MODES[number],
    reminderEmailSmtpUser: '',
    reminderEmailSmtpPassword: '',
    reminderEmailProvider: 'custom' as EmailProvider,
    reminderEmailApiUrl: '',
    reminderEmailApiKey: '',
    reminderEmailFrom: '',
    reminderEmailTo: '',
};
export type EmailSettings = typeof DEFAULT_EMAIL_SETTINGS;

export function normalizeEmailSettings(settings: Partial<EmailSettings>): EmailSettings {
    const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
    const port = Number(settings.reminderEmailSmtpPort ?? DEFAULT_EMAIL_SETTINGS.reminderEmailSmtpPort);
    return {
        reminderEmailEnabled: settings.reminderEmailEnabled === true,
        reminderEmailTransport: EMAIL_TRANSPORTS.includes(settings.reminderEmailTransport)
            ? settings.reminderEmailTransport
            : settings.reminderEmailApiKey && EMAIL_PROVIDERS.includes(settings.reminderEmailProvider) ? 'api' : 'smtp',
        reminderEmailSmtpHost: text(settings.reminderEmailSmtpHost),
        reminderEmailSmtpPort: port,
        reminderEmailSmtpSecurity: SMTP_SECURITY_MODES.includes(settings.reminderEmailSmtpSecurity)
            ? settings.reminderEmailSmtpSecurity : DEFAULT_EMAIL_SETTINGS.reminderEmailSmtpSecurity,
        reminderEmailSmtpUser: text(settings.reminderEmailSmtpUser),
        reminderEmailSmtpPassword: typeof settings.reminderEmailSmtpPassword === 'string' ? settings.reminderEmailSmtpPassword : '',
        reminderEmailProvider: EMAIL_PROVIDERS.includes(settings.reminderEmailProvider)
            ? settings.reminderEmailProvider : DEFAULT_EMAIL_SETTINGS.reminderEmailProvider,
        reminderEmailApiUrl: text(settings.reminderEmailApiUrl),
        reminderEmailApiKey: text(settings.reminderEmailApiKey),
        reminderEmailFrom: text(settings.reminderEmailFrom),
        reminderEmailTo: text(settings.reminderEmailTo),
    };
}

/** 只接受邮箱地址，避免把换行或显示名称作为邮件头传入。 */
function isEmailAddress(value: string): boolean {
    return /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}

export function buildEmailMessage(settings: EmailSettings, title: string, message: string) {
    if (!isEmailAddress(settings.reminderEmailFrom)) throw new Error('emailFromRequired');
    if (!isEmailAddress(settings.reminderEmailTo)) throw new Error('emailToRequired');
    return { from: settings.reminderEmailFrom, to: [settings.reminderEmailTo],
        subject: title.replace(/[\r\n]+/g, ' '), text: message };
}

export function buildSmtpOptions(settings: EmailSettings) {
    if (!settings.reminderEmailSmtpHost || /[\s/@?#]/.test(settings.reminderEmailSmtpHost)) throw new Error('emailSmtpHostRequired');
    if (!Number.isInteger(settings.reminderEmailSmtpPort) || settings.reminderEmailSmtpPort < 1
        || settings.reminderEmailSmtpPort > 65535) throw new Error('emailSmtpPortInvalid');
    const user = settings.reminderEmailSmtpUser || settings.reminderEmailFrom;
    if (!user || /[\r\n]/.test(user) || !settings.reminderEmailSmtpPassword) throw new Error('emailSmtpAuthRequired');
    return {
        host: settings.reminderEmailSmtpHost, port: settings.reminderEmailSmtpPort,
        secure: settings.reminderEmailSmtpSecurity === 'tls',
        requireTLS: settings.reminderEmailSmtpSecurity === 'starttls',
        auth: { user, pass: settings.reminderEmailSmtpPassword },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
        dnsTimeout: 10_000, disableFileAccess: true, disableUrlAccess: true,
    };
}

function emailRequest(rawSettings: Partial<EmailSettings>, title: string, message: string, key?: string) {
    const settings = normalizeEmailSettings(rawSettings);
    if (settings.reminderEmailTransport !== 'api') throw new Error('emailSmtpDesktopOnly');
    const provider = settings.reminderEmailProvider;
    const mail = buildEmailMessage(settings, title, message);
    const to = mail.to;
    if (!settings.reminderEmailApiKey || /[\r\n]/.test(settings.reminderEmailApiKey)) throw new Error('emailApiKeyRequired');
    const url = provider === 'smtp2go' ? 'https://api.smtp2go.com/v3/email/send'
        : provider === 'resend' ? 'https://api.resend.com/emails' : settings.reminderEmailApiUrl;
    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { throw new Error('emailApiUrlInvalid'); }
    if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
        throw new Error('emailApiUrlInvalid');
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const subject = mail.subject;
    if (provider === 'smtp2go') headers['X-Smtp2go-Api-Key'] = settings.reminderEmailApiKey;
    else headers.Authorization = `Bearer ${settings.reminderEmailApiKey}`;
    if (provider !== 'smtp2go' && key) headers['Idempotency-Key'] = `task-note-${encodeURIComponent(key)}`;
    const payload = provider === 'smtp2go'
        ? { sender: settings.reminderEmailFrom, to, subject, text_body: message }
        : { from: settings.reminderEmailFrom, to, subject, text: message };
    return { provider, url, headers, payload, recipientCount: to.length };
}

/** 内核通过 HTTP 代理发信，不依赖 Node SMTP 或打开的桌面页面。 */
export async function sendKernelEmail(client: IClient, settings: Partial<EmailSettings>, title: string,
    message: string, key?: string): Promise<void> {
    const request = emailRequest(settings, title, message, key);
    const response = await client.fetch('/api/network/forwardProxy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: request.url, method: 'POST', payload: JSON.stringify(request.payload),
            headers: [request.headers], timeout: 8000, contentType: 'application/json'
        })
    });
    if (!response.ok) throw new Error(`Email proxy HTTP ${response.status}`);
    const result = await response.json();
    if (result?.code !== 0 || typeof result.data?.status !== 'number') throw new Error('emailProxyFailed');
    if (result.data.status < 200 || result.data.status >= 300) throw new Error(`Email HTTP ${result.data.status}`);
    let body: any;
    try { body = JSON.parse(result.data.body); } catch { throw new Error('emailResponseInvalid'); }
    if (request.provider === 'smtp2go') {
        if (body?.data?.error || body?.data?.error_code || body?.data?.succeeded !== request.recipientCount
            || body?.data?.failed !== 0 || (body?.data?.failures?.length ?? 0) > 0) throw new Error('emailDeliveryFailed');
    } else if (typeof body?.id !== 'string' || !body.id || body.error || body.name) {
        throw new Error('emailResponseInvalid');
    }
}
