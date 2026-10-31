import type { PomodoroStats } from '../components/dataManager/pomodoroRecord';
import { TaskHierarchyIndex } from './taskHierarchy';

export interface EventPomodoroTotals {
    count: number;
    duration: number;
}

interface SubtreeStats {
    count: number;
    duration: number;
    todayCount: number;
    todayDuration: number;
    expandedTodayCount: number;
    expandedTodayDuration: number;
    legacyNodes: number;
    todayConflicts: number;
}

/** 迭代后序汇总，每个节点只处理一次。缺失父节点作为虚拟根，循环或重复 ID 则退出快速路径。 */
class SubtreeStatsIndex {
    readonly isForest: boolean;
    private readonly stats = new Map<string, SubtreeStats>();
    private readonly ranges = new Map<string, { start: number; end: number }>();

    constructor(
        private readonly hierarchy: TaskHierarchyIndex,
        private readonly totals: Record<string, EventPomodoroTotals>,
        private readonly todayTotals: Map<string, EventPomodoroTotals>,
        private readonly today: string,
    ) {
        this.isForest = this.build();
    }

    private ownStats(id: string): SubtreeStats {
        const task = this.hierarchy.byId.get(id);
        const total = this.totals[id];
        const today = this.todayTotals.get(id);
        const instanceId = `${id}_${this.today}`;
        const instance = task?.repeat?.enabled ? this.todayTotals.get(instanceId) : undefined;
        const hasInstanceValue = !!(instance?.count || instance?.duration);
        return {
            count: total?.count || 0, duration: total?.duration || 0,
            todayCount: today?.count || 0, todayDuration: today?.duration || 0,
            expandedTodayCount: (today?.count || 0) + (instance?.count || 0),
            expandedTodayDuration: (today?.duration || 0) + (instance?.duration || 0),
            legacyNodes: task?.repeat?.instancePomodoroCount && Object.keys(task.repeat.instancePomodoroCount).length ? 1 : 0,
            // 真实实例也在树中时，可能与上面的构造实例重叠，必须保留原来的 Set 去重语义。
            todayConflicts: hasInstanceValue && (this.hierarchy.byId.has(instanceId) || this.hierarchy.children(instanceId).length > 0) ? 1 : 0,
        };
    }

    private build(): boolean {
        if (this.hierarchy.tasks.length !== this.hierarchy.byId.size) return false;
        const ids = new Set(this.hierarchy.byId.keys());
        for (const task of this.hierarchy.tasks) {
            if (task.parentId) ids.add(task.parentId);
        }
        const roots = [...ids].filter(id => !this.hierarchy.byId.get(id)?.parentId);
        const stack = roots.map(id => ({ id, expanded: false })).reverse();
        let position = 0;
        while (stack.length > 0) {
            const { id, expanded } = stack.pop()!;
            const children = this.hierarchy.children(id);
            if (expanded) {
                const value = this.ownStats(id);
                for (const child of children) {
                    const childStats = this.stats.get(child.id)!;
                    value.count += childStats.count;
                    value.duration += childStats.duration;
                    value.todayCount += childStats.todayCount;
                    value.todayDuration += childStats.todayDuration;
                    value.expandedTodayCount += childStats.expandedTodayCount;
                    value.expandedTodayDuration += childStats.expandedTodayDuration;
                    value.legacyNodes += childStats.legacyNodes;
                    value.todayConflicts += childStats.todayConflicts;
                }
                this.stats.set(id, value);
                this.ranges.get(id)!.end = position;
            } else {
                if (this.ranges.has(id)) return false;
                this.ranges.set(id, { start: position++, end: 0 });
                stack.push({ id, expanded: true });
                for (let i = children.length - 1; i >= 0; i--) {
                    stack.push({ id: children[i].id, expanded: false });
                }
            }
        }
        return this.ranges.size === ids.size;
    }

    get(id: string): SubtreeStats | undefined {
        if (!this.isForest) return undefined;
        // 投影出的实例可能不在原始任务快照中，仍按其自身事件 ID 计数。
        return this.stats.get(id) || this.ownStats(id);
    }

    contains(rootId: string, id: string): boolean {
        const root = this.ranges.get(rootId), child = this.ranges.get(id);
        return rootId === id || !!(root && child && root.start <= child.start && child.start < root.end);
    }
}

/** 本轮刷新共享任务关系和当天会话索引，不保留可过期的业务缓存。 */
export class ReminderPomodoroStatsSnapshot {
    private readonly hierarchy: TaskHierarchyIndex;
    private readonly localHierarchy: TaskHierarchyIndex;
    private readonly todayInstancesByOriginal = new Map<string, string[]>();
    private readonly repeatingTotals = new Map<string, EventPomodoroTotals>();
    private readonly subtreeStats: SubtreeStatsIndex;
    private readonly localSubtreeStats: SubtreeStatsIndex;

    constructor(
        reminders: Iterable<any>,
        localReminders: Iterable<any>,
        private readonly totals: Record<string, EventPomodoroTotals>,
        private readonly todayTotals: Map<string, EventPomodoroTotals>,
        private readonly today: string,
    ) {
        this.hierarchy = new TaskHierarchyIndex(reminders);
        this.localHierarchy = new TaskHierarchyIndex(localReminders);
        this.subtreeStats = new SubtreeStatsIndex(this.hierarchy, totals, todayTotals, today);
        this.localSubtreeStats = new SubtreeStatsIndex(this.localHierarchy, totals, new Map(), today);
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
        if (!id) return this.resolveByTraversal(reminder);
        const subtree = this.subtreeStats.get(id);
        if (!subtree || (!reminder.isRepeatInstance && !this.localSubtreeStats.isForest)) {
            return this.resolveByTraversal(reminder);
        }
        if (reminder.isRepeatInstance) {
            return this.result(reminder, subtree.count, subtree.duration, {
                count: subtree.todayCount, duration: subtree.todayDuration,
            });
        }

        const hasDescendants = this.hierarchy.children(id).length > 0;
        const rootId = id.replace(/_\d{4}-\d{2}-\d{2}$/, '');
        const local = this.localSubtreeStats.get(rootId)!;
        const count = hasDescendants || !reminder.parentId ? local.count : this.totals[id]?.count || 0;
        const duration = hasDescendants
            ? (local.legacyNodes ? this.sum(this.localSubtree(rootId, true), this.totals).duration : local.duration)
            : this.totals[id]?.duration || 0;
        let today: EventPomodoroTotals;
        if (subtree.todayConflicts) {
            today = this.todayByTraversal(reminder);
        } else {
            today = { count: subtree.expandedTodayCount, duration: subtree.expandedTodayDuration };
            const instanceId = `${id}_${this.today}`;
            // 非重复根也可能有显式实例。树中已有的不能重复计入。
            if (this.hierarchy.byId.has(instanceId) && !this.subtreeStats.contains(id, instanceId)
                && !this.hierarchy.byId.get(id)?.repeat?.enabled) {
                const instance = this.todayTotals.get(instanceId);
                today.count += instance?.count || 0;
                today.duration += instance?.duration || 0;
            }
        }
        return this.result(reminder, count, duration, today);
    }

    private todayByTraversal(reminder: any): EventPomodoroTotals {
        const ids = new Set([reminder.id, ...this.hierarchy.descendantIds(reminder.id)]);
        if (!reminder.isRepeatInstance) {
            for (const id of [...ids]) {
                if (this.hierarchy.byId.get(id)?.repeat?.enabled) ids.add(`${id}_${this.today}`);
            }
            for (const id of this.todayInstancesByOriginal.get(reminder.id) || []) ids.add(id);
        }
        return this.sum(ids, this.todayTotals);
    }

    private resolveByTraversal(reminder: any): PomodoroStats {
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
        }
        return this.result(reminder, count, duration, this.todayByTraversal(reminder));
    }

    private result(reminder: any, count: number, duration: number, today: EventPomodoroTotals): PomodoroStats {
        const repeating = reminder.isRepeatInstance
            ? this.repeatingTotals.get(reminder.originalId || reminder.id.split('_')[0])
            : undefined;
        return {
            pomodoroCount: count, focusTime: duration,
            todayPomodoroCount: today.count, todayFocusTime: today.duration,
            totalRepeatingPomodoroCount: repeating?.count || 0,
            totalRepeatingFocusTime: repeating?.duration || 0,
        };
    }
}
