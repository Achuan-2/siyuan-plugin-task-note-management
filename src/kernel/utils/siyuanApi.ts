export interface Block {
    id: string;
    parent_id: string;
    root_id: string;
    hash: string;
    box: string;
    path: string;
    hpath: string;
    content: string;
    fcontent: string;
    markdown: string;
    length: number;
    type: string;
    subtype: string;
    ial: string;
    sort: number;
    created: string;
    updated: string;
}

export type TaskListItemMarker = " " | "x" | "-" | "/";

async function request(url: string, data: any): Promise<any> {
    try {
        const response = await siyuan.client.fetch(url as any, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: typeof data === "string" ? data : JSON.stringify(data),
        });
        if (!response.ok) {
            console.error(`[siyuanApi] Request to ${url} failed with status ${response.status}`);
            return null;
        }
        const json = await response.json();
        return json.code === 0 ? json.data : null;
    } catch (e) {
        console.error(`[siyuanApi] Request to ${url} error:`, e);
        return null;
    }
}

export async function sql(sqlStmt: string): Promise<any[]> {
    let sqldata = {
        stmt: sqlStmt,
    };
    let url = '/api/query/sql';
    return (await request(url, sqldata)) || [];
}

export async function getBlockByID(blockId: string): Promise<Block | null> {
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql(sqlScript);
    return data && data.length > 0 ? data[0] : null;
}

export async function getBlockKramdown(id: string): Promise<{ id: string; kramdown: string }> {
    let data = { id };
    let url = '/api/block/getBlockKramdown';
    return (await request(url, data)) || { id, kramdown: "" };
}

export async function getChildBlocks(id: string): Promise<any[]> {
    let data = { id };
    let url = '/api/block/getChildBlocks';
    return (await request(url, data)) || [];
}

export async function batchUpdateTaskListItemMarker(items: Array<{ id: string; marker: TaskListItemMarker }>) {
    let url = '/api/block/batchUpdateTaskListItemMarker';
    return request(url, { items });
}

export async function getBlockAttrs(id: string): Promise<{ [key: string]: string }> {
    let data = { id };
    let url = '/api/attr/getBlockAttrs';
    return (await request(url, data)) || {};
}

export async function setBlockAttrs(id: string, attrs: { [key: string]: string }) {
    let data = {
        id: id,
        attrs: attrs
    };
    let url = '/api/attr/setBlockAttrs';
    return request(url, data);
}

export async function getBlockProjectIds(id: string): Promise<string[]> {
    try {
        const attrs = await getBlockAttrs(id);
        if (!attrs || typeof attrs !== 'object') return [];
        const raw = attrs['custom-task-projectId'] || '';
        if (!raw) return [];
        return Array.from(new Set(raw.split(',').map(s => s.trim()).filter(s => s)));
    } catch (error) {
        console.warn('getBlockProjectIds failed:', error);
        return [];
    }
}

export async function setBlockProjectIds(id: string, projectIds: string[]): Promise<any> {
    try {
        const csv = projectIds && projectIds.length > 0 ? projectIds.join(',') : '';
        return await setBlockAttrs(id, { 'custom-task-projectId': csv });
    } catch (error) {
        console.warn('setBlockProjectIds failed:', error);
        throw error;
    }
}

export async function addBlockProjectId(id: string, projectId: string): Promise<any> {
    if (!projectId) return;
    try {
        const ids = await getBlockProjectIds(id);
        if (!ids.includes(projectId)) {
            ids.push(projectId);
            return await setBlockProjectIds(id, ids);
        }
    } catch (error) {
        console.warn('addBlockProjectId failed:', error);
        throw error;
    }
}

export async function isTaskListLikeBlock(blockId: string): Promise<boolean> {
    try {
        const result = await sql(`SELECT type, subtype FROM blocks WHERE id = '${blockId}'`);
        if (result && result.length > 0) {
            const block = result[0];
            if (block.type === 'i') {
                return block.subtype === 't';
            }
            return false;
        }

        const kramdown = (await getBlockKramdown(blockId)).kramdown || '';
        if (!kramdown) return false;
        return /^\s*[-*+]\s*(?:\{:[^}]*\}\s*)?\[(?: |x|X)\]/m.test(kramdown)
            || /^\s*[-*+]\s*\[(?: |x|X)\](?:\s*\{:[^}]*\})?/m.test(kramdown);
    } catch (error) {
        console.warn('检测任务列表块失败:', error);
        return false;
    }
}

function normalizeReminderKanbanStatus(status: any): string {
    if (typeof status !== "string") return "";
    return status.trim().toLowerCase();
}

function getTaskListMarkerByReminders(reminders: any[], syncDoingAndAbandoned: boolean = true): TaskListItemMarker {
    if (!Array.isArray(reminders) || reminders.length === 0) {
        return " ";
    }

    if (reminders.every((reminder: any) => reminder?.completed)) {
        return "x";
    }

    if (!syncDoingAndAbandoned) return " ";

    const incompleteReminders = reminders.filter((reminder: any) => reminder && !reminder.completed);
    if (incompleteReminders.some((reminder: any) => normalizeReminderKanbanStatus(reminder?.kanbanStatus) === "doing")) {
        return "/";
    }

    if (incompleteReminders.some((reminder: any) => {
        const status = normalizeReminderKanbanStatus(reminder?.kanbanStatus);
        return status === "abort" || status === "abandoned";
    })) {
        return "-";
    }

    return " ";
}

async function syncTaskListBlockCompletion(blockId: string, reminders: any[], syncDoingAndAbandoned: boolean = true): Promise<void> {
    const isTaskList = await isTaskListLikeBlock(blockId);
    if (isTaskList) {
        try {
            await batchUpdateTaskListItemMarker([{
                id: blockId,
                marker: getTaskListMarkerByReminders(reminders, syncDoingAndAbandoned)
            }]);
        } catch (err) {
            console.warn('同步任务列表块标记失败:', blockId, err);
        }
        return;
    }

    const block = await getBlockByID(blockId);
    if (block && block.type === 'l') {
        const children = await getChildBlocks(blockId);
        if (children && children.length === 1) {
            const child = children[0];
            if (child && child.id && await isTaskListLikeBlock(child.id)) {
                try {
                    await batchUpdateTaskListItemMarker([{
                        id: child.id,
                        marker: getTaskListMarkerByReminders(reminders, syncDoingAndAbandoned)
                    }]);
                } catch (err) {
                    console.warn('同步子任务列表块标记失败:', child.id, err);
                }
            }
        }
    }
}

function formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export async function updateBindBlockAtrrs(blockId: string, bridge: any): Promise<void> {
    try {
        const reminderData = await bridge.loadReminderData();

        const directBlockReminders = Object.values(reminderData).filter((reminder: any) =>
            reminder && reminder.blockId === blockId
        );
        const instanceBlockReminders = (Object.values(reminderData) as any[]).flatMap((reminder: any) => {
            const instances = reminder?.repeat?.instances;
            if (!reminder || !instances || typeof instances !== 'object') {
                return [];
            }

            const excludeDates = reminder.repeat?.excludeDates || [];
            return Object.entries(instances as Record<string, any>)
                .filter(([instanceDate, state]: [string, any]) => state?.blockId === blockId && !excludeDates.includes(instanceDate) && !state?.deleted)
                .map(([instanceDate, state]: [string, any]) => {
                    const isCompleted = !!state?.completed;
                    return {
                        ...reminder,
                        ...state,
                        id: `${reminder.id}_${instanceDate}`,
                        originalId: reminder.id,
                        isRepeatInstance: true,
                        completed: isCompleted,
                        completedTime: isCompleted ? state?.completedTime : undefined,
                        projectId: state.projectId !== undefined ? state.projectId : reminder.projectId
                    };
                });
        });
        const blockReminders = [...directBlockReminders, ...instanceBlockReminders];

        const attrs: { [key: string]: string } = {};

        if (blockReminders.length === 0) {
            try {
                const cleanupAttrs: { [key: string]: string } = {
                    "bookmark": "",
                    'custom-bind-reminders': '',
                    'custom-task-projectId': ''
                };

                try {
                    const { PomodoroRecordManager } = await import("../../components/dataManager/pomodoroRecord");
                    const pomodoroManager = PomodoroRecordManager.getInstance(bridge);
                    if (pomodoroManager) {
                        await pomodoroManager.initialize();
                        const ownCount = pomodoroManager.getRepeatingEventTotalPomodoroCount(blockId);
                        const ownMinutes = pomodoroManager.getRepeatingEventTotalFocusTime(blockId);
                        cleanupAttrs['custom-task-pomodoro-count'] = ownCount > 0 ? String(ownCount) : '';
                        cleanupAttrs['custom-task-pomodoro-minutes'] = ownMinutes > 0 ? String(ownMinutes) : '';
                    }
                } catch (pomoErr) {
                    console.warn('清理块属性计算块自有番茄失败:', blockId, pomoErr);
                }

                await setBlockAttrs(blockId, cleanupAttrs);
                return;
            } catch (err) {
                console.warn('clean up block attributes failed for', blockId, err);
                return;
            }
        }

        const hasIncompleteReminders = blockReminders.some((reminder: any) => !reminder.completed);
        const allCompleted = blockReminders.length > 0 && blockReminders.every((reminder: any) => reminder.completed);

        if (allCompleted) {
            attrs['bookmark'] = '✅';
            attrs['custom-task-done'] = formatDate(new Date());
        } else if (hasIncompleteReminders) {
            attrs['bookmark'] = '⏰';
        } else {
            attrs['bookmark'] = '';
        }

        const reminderIds = blockReminders.map((r: any) => r.id).filter(id => id);
        if (reminderIds.length > 0) {
            attrs['custom-bind-reminders'] = reminderIds.join(',');
        } else {
            attrs['custom-bind-reminders'] = '';
        }

        const projectIds = Array.from(new Set(blockReminders.map((r: any) => r.projectId).filter(id => id)));
        attrs['custom-task-projectId'] = projectIds.length > 0 ? projectIds.join(',') : '';

        try {
            const { PomodoroRecordManager } = await import("../../components/dataManager/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance(bridge);
            if (pomodoroManager) {
                await pomodoroManager.initialize();

                let totalPomoCount = pomodoroManager.getRepeatingEventTotalPomodoroCount(blockId);
                let totalPomoMinutes = pomodoroManager.getRepeatingEventTotalFocusTime(blockId);

                // 加上当前仍绑定在该块上的所有任务的番茄（含子任务，最多2层深度）
                const processedTaskSeries = new Set<string>();

                // 只有后缀是 YYYY-MM-DD 时才去掉（重复任务实例），其他情况保留完整 ID
                const getSeriesBaseId = (id: string): string => {
                    const m = id.match(/^(.+)_(\d{4}-\d{2}-\d{2})$/);
                    return m ? m[1] : id;
                };

                // 预建 parentId -> [childId] 索引（基于 reminder 的 parentId 字段）
                const childrenByParentId = new Map<string, string[]>();
                for (const rem of Object.values(reminderData) as any[]) {
                    if (!rem || !rem.parentId || !rem.id) continue;
                    const parentBase = getSeriesBaseId(String(rem.parentId));
                    if (!childrenByParentId.has(parentBase)) childrenByParentId.set(parentBase, []);
                    childrenByParentId.get(parentBase)!.push(rem.id);
                }

                // 辅助：收集一批任务 ID 的番茄，并递归收集其子任务（深度限制 maxDepth）
                const collectPomodoroForIds = (ids: string[], depth: number) => {
                    if (depth > 2) return;
                    for (const id of ids) {
                        if (!id) continue;
                        const baseId = getSeriesBaseId(id);
                        if (processedTaskSeries.has(baseId)) continue;
                        processedTaskSeries.add(baseId);
                        // 使用 getRepeatingEventTotalPomodoroCount 可同时覆盖非重复和重复任务的全部实例
                        totalPomoCount += pomodoroManager.getRepeatingEventTotalPomodoroCount(baseId);
                        totalPomoMinutes += pomodoroManager.getRepeatingEventTotalFocusTime(baseId);
                        // 通过 parentId 索引递归子任务
                        const childIds = childrenByParentId.get(baseId);
                        if (childIds?.length) {
                            collectPomodoroForIds(childIds, depth + 1);
                        }
                    }
                };

                for (const r of blockReminders) {
                    const seriesId = r.originalId || getSeriesBaseId(r.id || '');
                    if (!seriesId) continue;
                    collectPomodoroForIds([seriesId], 0);
                }

                attrs['custom-task-pomodoro-count'] = totalPomoCount > 0 ? String(totalPomoCount) : '';
                attrs['custom-task-pomodoro-minutes'] = totalPomoMinutes > 0 ? String(totalPomoMinutes) : '';
            }
        } catch (pomoErr) {
            console.warn('计算/更新块番茄属性失败:', blockId, pomoErr);
        }

        await setBlockAttrs(blockId, attrs);

        try {
            const settings = await bridge.loadSettings();
            const syncDoingAndAbandoned = settings?.enableTaskListStatusSync !== false;
            await syncTaskListBlockCompletion(blockId, blockReminders as any[], syncDoingAndAbandoned);
        } catch (syncErr) {
            console.warn('同步任务列表块勾选状态失败:', blockId, syncErr);
        }

    } catch (error) {
        console.error('更新块提醒书签失败:', error);
    }
}
