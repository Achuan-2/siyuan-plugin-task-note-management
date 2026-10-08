import type { ISiyuan, TEventMessage } from 'siyuan/kernel';
import type { KernelStorage } from './storageAdapter';
import { SETTINGS_FILE, REMINDER_DATA_FILE, HABIT_DATA_FILE, HOLIDAY_DATA_FILE } from './constants';

const DATA_FILES = new Set([SETTINGS_FILE, REMINDER_DATA_FILE, HABIT_DATA_FILE, HOLIDAY_DATA_FILE,
    'ics-subscriptions.json', 'ics_subscriptions.json']);
const DATA_DIRS = new Set(['habitCheckin', 'pomodoroRecords', 'Subscribe', 'subscribe']);

/** 根目录捕获新建目录，子目录单独注册：fsnotify 的目录监控不会递归。 */
export class KernelReminderWatcher {
    private paths = new Set<string>();
    private previousHandler: ISiyuan['event']['handler'] = null;
    private active = false;
    private readonly handler = async (event: TEventMessage) => {
        await this.previousHandler?.(event);
        if (!this.active || event.type !== 'fs-notify') return;
        const path = String(event.detail?.path || '').replace(/\\/g, '/').replace(/^\.\//, '');
        if (DATA_FILES.has(path) || DATA_DIRS.has(path.split('/')[0])) this.onChange(path);
    };

    constructor(private readonly runtime: ISiyuan, private readonly storage: KernelStorage,
        private readonly onChange: (path: string) => void) {}

    public async start(): Promise<void> {
        this.active = true;
        this.previousHandler = this.runtime.event.handler;
        this.runtime.event.handler = this.handler;
        await this.runtime.storage.watcher.add('.');
        this.paths.add('.');
        await this.refreshDirectories();
    }

    public async refreshDirectories(): Promise<void> {
        if (!this.active) return;
        const desired = new Set(['.']);
        const walk = async (dir: string) => {
            desired.add(dir);
            for (const entry of await this.storage.readDir(dir)) {
                if (entry.isDir && !entry.isSymlink) await walk(`${dir}/${entry.name}`);
            }
        };
        for (const entry of await this.storage.readDir('.')) {
            if (entry.isDir && !entry.isSymlink && DATA_DIRS.has(entry.name)) await walk(entry.name);
        }
        for (const path of this.paths) {
            if (desired.has(path)) continue;
            await this.runtime.storage.watcher.remove(path).catch(() => {});
            this.paths.delete(path);
        }
        for (const path of desired) {
            // 重复 add 也能恢复被删除后重新建立的目录监控。
            await this.runtime.storage.watcher.add(path);
            this.paths.add(path);
        }
    }

    public async stop(): Promise<void> {
        this.active = false;
        if (this.runtime.event.handler === this.handler) this.runtime.event.handler = this.previousHandler;
        for (const path of this.paths) await this.runtime.storage.watcher.remove(path).catch(() => {});
        this.paths.clear();
    }
}
