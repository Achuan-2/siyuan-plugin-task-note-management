import type { PomodoroStats } from '../components/dataManager/pomodoroRecord';
import { TaskHierarchyIndex } from './taskHierarchy';

export interface EventPomodoroTotals {
    count: number;
    duration: number;
}

/** 本轮刷新共享任务关系和当天会话索引，不保留可过期的业务缓存。 */
export class ReminderPomodoroStatsSnapshot {
    private readonly hierarchy: TaskHierarchyIndex;
    private readonly localHierarchy: TaskHierarchyIndex;
    private readonly todayInstancesByOriginal = new Map<string, string[]>();
    private readonly repeatingTotals = new Map<string, EventPomodoroTotals>();

    constructor(
        reminders: Iterable<any>,
        localReminders: Iterable<any>,
        private readonly totals: Record<string, EventPomodoroTotals>,
        private readonly todayTotals: Map<string, EventPomodoroTotals>,
        private readonly today: string,
    ) {
        this.hierarchy = new TaskHierarchyIndex(reminders);
        this.localHierarchy = new TaskHierarchyIndex(localReminders);
        const suffix = `_${today}`;
        for (const id of this.hierarchy.byId.keys()) {
            if (!id.endsWith(suffix)) continue;
            const originalId = id.slice(0, -suffix.length);
            const instances = this.todayInstancesByOriginal.get(originalId) || [];
            instances.push(id);
            this.todayInstancesByOriginal.set(originalId, instances);
        }
        for (const [id, stats] of Object.entries(totals)) {
            // 原逻辑同时统计系列自身和以日期结尾的实例；普通下划线 ID 不作实例处理。
            this.addRepeatingTotal(id, stats);
            const match = /^(.*)_\d{4}-\d{2}-\d{2}$/.exec(id);
            if (match) this.addRepeatingTotal(match[1], stats);
        }
    }

    private addRepeatingTotal(id: string, stats: EventPomodoroTotals): void {
        const total = this.repeatingTotals.get(id) || { count: 0, duration: 0 };
        total.count += stats.count;
        total.duration += stats.duration;
        this.repeatingTotals.set(id, total);
    }

    private sum(ids: Iterable<string>, source: Record<string, EventPomodoroTotals> | Map<string, EventPomodoroTotals>): EventPomodoroTotals {
        let count = 0, duration = 0;
        for (const id of ids) {
            const stats = source instanceof Map ? source.get(id) : source[id];
            count += stats?.count || 0;
            duration += stats?.duration || 0;
        }
        return { count, duration };
    }

    private localSubtree(rootId: string, includeLegacyInstances: boolean): Set<string> {
        const ids = new Set<string>();
        const queue = [rootId];
        for (let index = 0; index < queue.length; index++) {
            const id = queue[index];
            if (ids.has(id)) continue;
            ids.add(id);
            if (includeLegacyInstances) {
                const instances = this.localHierarchy.byId.get(id)?.repeat?.instancePomodoroCount;
                if (instances) Object.keys(instances).forEach(key => ids.add(key));
            }
            for (const child of this.localHierarchy.children(id)) queue.push(child.id);
        }
        return ids;
    }

    resolve(reminder: any): PomodoroStats {
        const id = reminder?.id;
        if (!id) return {
            pomodoroCount: 0, focusTime: 0, todayPomodoroCount: 0, todayFocusTime: 0,
            totalRepeatingPomodoroCount: 0, totalRepeatingFocusTime: 0,
        };
        const descendants = this.hierarchy.descendantIds(id);
        const ids = new Set([id, ...descendants]);
        let count: number, duration: number;
        if (reminder.isRepeatInstance) {
            ({ count, duration } = this.sum(ids, this.totals));
        } else {
            // 累计值沿用本地任务树；今日值包含输入快照中的订阅与重复实例。
            const rootId = id.replace(/_\d{4}-\d{2}-\d{2}$/, '');
            count = descendants.length > 0 || !reminder.parentId
                ? this.sum(this.localSubtree(rootId, false), this.totals).count
                : this.totals[id]?.count || 0;
            duration = descendants.length > 0
                ? this.sum(this.localSubtree(rootId, true), this.totals).duration
                : this.totals[id]?.duration || 0;
            for (const taskId of [...ids]) {
                if (this.hierarchy.byId.get(taskId)?.repeat?.enabled) ids.add(`${taskId}_${this.today}`);
            }
            for (const instanceId of this.todayInstancesByOriginal.get(id) || []) ids.add(instanceId);
        }
        const today = this.sum(ids, this.todayTotals);
        const repeating = reminder.isRepeatInstance
            ? this.repeatingTotals.get(reminder.originalId || id.split('_')[0])
            : undefined;
        return {
            pomodoroCount: count, focusTime: duration,
            todayPomodoroCount: today.count, todayFocusTime: today.duration,
            totalRepeatingPomodoroCount: repeating?.count || 0,
            totalRepeatingFocusTime: repeating?.duration || 0,
        };
    }
}
