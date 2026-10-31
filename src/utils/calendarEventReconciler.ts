import type { Calendar, EventApi, EventInput } from '@fullcalendar/core';

interface EventSnapshot {
    input: string;
    runtime: string;
}

/** 对象字段顺序不影响比较；保存字符串，避免原对象后续被编辑时改变快照。 */
function signature(value: unknown): string {
    return JSON.stringify(value, (_key, item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
        }
        return item;
    });
}

function runtimeSignature(event: EventApi): string {
    return signature({
        data: event.toPlainObject(),
        // FullCalendar 的 toPlainObject 不包含可编辑性，单独记录以检测运行时变化。
        startEditable: event.startEditable,
        durationEditable: event.durationEditable,
    });
}

/** 每个日历实例独立持有；仅普通数据通知使用增量更新，设置等变化仍完整重建。 */
export class CalendarEventReconciler {
    private snapshots = new Map<string, EventSnapshot>();

    constructor(private readonly sourceId: string) {}

    clear(): void {
        this.snapshots.clear();
    }

    sync(calendar: Calendar, inputs: EventInput[], incremental: boolean, renderKeys: ReadonlyMap<string, unknown> = new Map()): boolean {
        const desired = new Map<string, { input: EventInput; signature: string }>();
        let uniqueIds = true;
        for (const input of inputs) {
            const id = String(input.id ?? '');
            if (!id || desired.has(id)) uniqueIds = false;
            desired.set(id, { input, signature: signature({ event: input, render: renderKeys.get(id) }) });
        }
        const current = calendar.getEvents();
        const currentIds = new Set(current.map(event => event.id));
        const source = calendar.getEventSourceById(this.sourceId);
        const canReuse = incremental && source && uniqueIds && currentIds.size === current.length;
        let changed = !canReuse;

        calendar.batchRendering(() => {
            if (!canReuse) {
                // 无 ID、重复 ID 或视图配置变化时保留原有完整渲染语义。
                calendar.removeAllEvents();
                calendar.removeAllEventSources();
                calendar.addEventSource({ id: this.sourceId, events: inputs });
                return;
            }
            const retained = new Set<string>();
            for (const event of current) {
                const next = desired.get(event.id);
                const previous = this.snapshots.get(event.id);
                if (next && previous?.input === next.signature && previous.runtime === runtimeSignature(event)) {
                    retained.add(event.id);
                } else {
                    event.remove();
                    changed = true;
                }
            }
            for (const [id, next] of desired) {
                if (!retained.has(id)) {
                    // 变化事件重新挂载，让 eventDidMount 的样式和交互也取得最新数据。
                    calendar.addEvent(next.input, source);
                    changed = true;
                }
            }
        });

        if (!changed) return false;
        const snapshots = new Map<string, EventSnapshot>();
        for (const event of calendar.getEvents()) {
            const next = desired.get(event.id);
            if (next) snapshots.set(event.id, { input: next.signature, runtime: runtimeSignature(event) });
        }
        this.snapshots = snapshots;
        return changed;
    }
}
