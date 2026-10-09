import nodemailer from 'nodemailer';
import net from 'node:net';
import tls from 'node:tls';
import { buildEmailMessage, buildSmtpOptions, normalizeEmailSettings, type EmailSettings } from '../services/emailNotification';

/** 单独打包并仅在 Electron 桌面端加载，浏览器和内核不加载 Node 网络模块。 */
export class DesktopSmtpSender {
    private transports = new Map<ReturnType<typeof nodemailer.createTransport>, () => void>();

    public async send(rawSettings: Partial<EmailSettings>, title: string, message: string): Promise<void> {
        const settings = normalizeEmailSettings(rawSettings);
        const mail = buildEmailMessage(settings, title, message);
        const options = buildSmtpOptions(settings);
        let socket: net.Socket;
        let connectionTimer: ReturnType<typeof setTimeout>;
        let aborted = false;
        const transport = nodemailer.createTransport({ ...options,
            getSocket: (_, callback) => {
                if (aborted) { callback(new Error('emailSmtpCancelled'), null); return; }
                let connected = false;
                const ready = (error?: Error) => {
                    if (connected) return;
                    connected = true;
                    clearTimeout(connectionTimer);
                    callback(error || null, error ? null : { connection: socket, secured: options.secure });
                };
                // 保留底层连接，取消/卸载时能立即关闭正在进行的 SMTP 会话。
                const address = { host: options.host, port: options.port };
                socket = options.secure ? tls.connect({ ...address, servername: net.isIP(options.host) ? undefined : options.host })
                    : net.connect(address);
                socket.once(options.secure ? 'secureConnect' : 'connect', () => ready());
                socket.on('error', error => ready(error));
                connectionTimer = setTimeout(() => {
                    const error = Object.assign(new Error('emailSmtpTimeout'), { code: 'ETIMEDOUT' });
                    socket.destroy(error);
                }, options.connectionTimeout);
            }
        });
        const closeConnection = () => {
            aborted = true;
            clearTimeout(connectionTimer);
            socket?.destroy();
            transport.close();
        };
        let timer: ReturnType<typeof setTimeout>;
        const cancelled = new Promise<never>((_, reject) => {
            this.transports.set(transport, () => { closeConnection(); reject(new Error('emailSmtpCancelled')); });
        });
        try {
            const info = await Promise.race([
                transport.sendMail(mail),
                cancelled,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => { closeConnection(); reject(new Error('emailSmtpTimeout')); }, 45_000);
                })
            ]);
            if (!info.accepted?.includes(settings.reminderEmailTo) || info.rejected?.length) throw new Error('emailDeliveryFailed');
        } catch (error: any) {
            // SMTP 响应可能包含账户信息，界面只展示稳定的错误代码。
            if (error?.message?.startsWith('email')) throw error;
            const code = error?.code;
            throw new Error(code === 'EAUTH' ? 'emailSmtpAuthFailed' : code === 'ETIMEDOUT'
                ? 'emailSmtpTimeout' : 'emailSmtpSendFailed');
        } finally {
            clearTimeout(timer);
            closeConnection();
            this.transports.delete(transport);
        }
    }

    public close(): void {
        for (const cancel of this.transports.values()) cancel();
        this.transports.clear();
    }
}
