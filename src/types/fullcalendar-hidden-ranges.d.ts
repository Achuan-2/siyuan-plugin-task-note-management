// 类型增补：vendor/fullcalendar fork（timegrid-hidden-ranges 分支）为 timegrid 新增的选项。
// 运行时由 vite alias 指向 vendor/fullcalendar 源码，类型仍来自 node_modules 的 @fullcalendar 6.1.21。
// FullCalendar 的 CalendarOptions 由 BaseOptionRefiners 映射生成（type alias，无法直接增补接口），
// 因此通过增补 BaseOptionRefiners 让 hiddenTimeRanges 进入 CalendarOptions 与 setOption 的键类型。
import type { Duration, DurationInput } from '@fullcalendar/core';

declare module '@fullcalendar/core/internal' {
    interface BaseOptionRefiners {
        /**
         * timegrid 视图中被折叠（隐藏）的时段列表。
         * 时间以 timegrid 持续时间轴计量，可超过 24h（如 { hours: 25 }）。
         */
        hiddenTimeRanges: (raw: Array<{ start: DurationInput; end: DurationInput }>) => Array<{ start: Duration; end: Duration }>;
    }
}
