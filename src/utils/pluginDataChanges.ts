type DirectoryEntry = { name: string; isDir: boolean; updated: number };
type ReadDirectory = (path: string, strict: boolean) => Promise<DirectoryEntry[]>;

export type PluginDataGroup = 'settings' | 'reminders' | 'projects' | 'statuses' | 'categories'
    | 'habits' | 'habitGroups' | 'subscriptions' | 'pomodoros' | 'mobileNotifications' | 'holidays';

const FILE_GROUPS: Record<string, PluginDataGroup> = {
    'reminder-settings.json': 'settings',
    'reminder.json': 'reminders',
    'project.json': 'projects',
    'statuses.json': 'statuses',
    'categories.json': 'categories',
    'habit.json': 'habits',
    'habitGroup.json': 'habitGroups',
    'ics-subscriptions.json': 'subscriptions',
    'pomodoro_record.json': 'pomodoros',
    'notify.json': 'mobileNotifications',
    'holiday.json': 'holidays',
};
const DIRECTORY_GROUPS: Record<string, PluginDataGroup> = {
    habitCheckin: 'habits', habit: 'habits', Subscribe: 'subscriptions',
    pomodoroRecords: 'pomodoros', mobileNotify: 'mobileNotifications',
};
const ALL_GROUPS = new Set<PluginDataGroup>(Object.values(FILE_GROUPS));

interface DataSnapshot {
    startedAt: number;
    files: Map<string, { updated: number; group: PluginDataGroup }>;
}

/** 宿主回调不含文件路径，使用目录元数据避免读取无关的业务数据。 */
export class PluginDataChanges {
    private baseline?: DataSnapshot;

    constructor(private readonly readDirectory: ReadDirectory, private readonly root: () => string) {}

    async scan(): Promise<DataSnapshot> {
        const startedAt = Math.floor(Date.now() / 1000);
        const files: DataSnapshot['files'] = new Map();
        const root = this.root();
        await Promise.all(['', ...Object.keys(DIRECTORY_GROUPS)].map(async directory => {
            const entries = await this.readDirectory(directory ? `${root}/${directory}` : root, true);
            for (const entry of entries) {
                if (entry.isDir || !entry.name.endsWith('.json')) continue;
                const group = directory ? DIRECTORY_GROUPS[directory] : FILE_GROUPS[entry.name];
                if (!group) continue;
                if (!Number.isFinite(entry.updated)) throw new Error('插件数据目录缺少文件修改时间');
                files.set(directory ? `${directory}/${entry.name}` : entry.name, { updated: entry.updated, group });
            }
        }));
        return { startedAt, files };
    }

    changed(snapshot: DataSnapshot, force = false): Set<PluginDataGroup> {
        // 跨设备同步可能保留原始 mtime，不能仅凭修改时间跳过刷新。
        if (force || !this.baseline) return new Set(ALL_GROUPS);
        const changed = new Set<PluginDataGroup>();
        for (const [path, file] of snapshot.files) {
            const previous = this.baseline.files.get(path);
            // readDir 只有秒级精度，同一秒内的覆盖也必须保守刷新。
            if (!previous || file.updated !== previous.updated || file.updated >= this.baseline.startedAt) {
                changed.add(file.group);
            }
        }
        for (const [path, file] of this.baseline.files) {
            if (!snapshot.files.has(path)) changed.add(file.group);
        }
        return changed;
    }

    commit(snapshot: DataSnapshot): void {
        // 仅提交刷新前的快照，刷新期间发生的写入留给下一次回调处理。
        this.baseline = snapshot;
    }
}
