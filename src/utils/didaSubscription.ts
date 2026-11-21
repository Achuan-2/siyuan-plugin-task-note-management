import ICAL from 'ical.js';
import { forwardProxy } from '../api';
import { i18n } from '../pluginInstance';
import { formatDate, formatTime, parseIcalRRule } from './icsImport';
import type { IcsSubscription } from './icsSubscription';
import { getTaskNotePreviewText } from './taskNoteStorage';

const DIDA_API_BASE_URL = 'https://api.dida365.com/open/v1';
const DIDA_REQUEST_TIMEOUT_MS = 30000;
const DIDA_COMPLETED_RETENTION_DAYS = 15;

export const DIDA_INBOX_LIST_ID = 'inbox';
export const DIDA_GROUP_ID_PREFIX = 'dida_group_';

const GROUP_PRESET_COLORS = [
    '#4f46e5',
    '#3498db',
    '#2ecc71',
    '#f39c12',
    '#e74c3c',
    '#9b59b6',
    '#1abc9c',
    '#e67e22',
    '#16a085',
    '#2980b9',
];

export interface DidaProjectItem {
    id: string;
    name: string;
    color?: string;
    sortOrder?: number;
    closed?: boolean;
    groupId?: string;
    viewMode?: string;
    permission?: string;
    kind?: string;
    isInbox?: boolean;
}

export interface DidaSelectedProject {
    id: string;
    name: string;
    color?: string;
    kind?: string;
}

interface DidaChecklistItem {
    id?: string;
    title: string;
    status?: number;
    sortOrder?: number;
    startDate?: string;
    isAllDay?: boolean;
    timeZone?: string;
    completedTime?: string;
}

interface DidaApiTask {
    id: string;
    projectId: string;
    title?: string;
    content?: string;
    desc?: string;
    isAllDay?: boolean;
    startDate?: string;
    dueDate?: string;
    timeZone?: string;
    reminders?: string[];
    repeatFlag?: string;
    priority?: number;
    status?: number;
    completedTime?: string;
    sortOrder?: number;
    items?: DidaChecklistItem[];
    tags?: string[];
    etag?: string;
    kind?: string;
    parentId?: string;
    childIds?: string[];
    createdTime?: string;
    modifiedTime?: string;
}

interface DidaProjectDataResponse {
    project?: DidaProjectItem;
    tasks?: DidaApiTask[];
    columns?: Array<{ id?: string; projectId?: string; name?: string }>;
}

export interface DidaRemoteTaskEvent {
    uid: string;
    title: string;
    description?: string;
    date?: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    completed: boolean;
    completedAt?: string;
    priority?: 'high' | 'medium' | 'low' | 'none';
    repeat?: any;
    createdAt?: string;
    customGroupId: string;
    didaTaskId: string;
    didaProjectId: string;
    didaListId: string;
    didaParentTaskId?: string;
    didaEtag?: string;
    didaKind?: string;
    didaItems?: DidaChecklistItem[];
    didaTags?: string[];
    url?: string;
}

export function getDidaGroupId(listId: string): string {
    return `${DIDA_GROUP_ID_PREFIX}${listId}`;
}

export function extractDidaListIdFromGroupId(groupId?: string): string | null {
    if (!groupId || !groupId.startsWith(DIDA_GROUP_ID_PREFIX)) return null;
    const listId = groupId.slice(DIDA_GROUP_ID_PREFIX.length).trim();
    return listId || null;
}

function isLikelyCorsOrNetworkError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    const name = String(err?.name || '').toLowerCase();
    return (
        name === 'typeerror' ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('cors') ||
        msg.includes('preflight') ||
        msg.includes('access-control-allow-origin') ||
        msg.includes('err_failed') ||
        msg.includes('load failed')
    );
}

function parseDidaErrorMessage(status: number, bodyText: string, fallback: string): string {
    if (bodyText) {
        try {
            const parsed = JSON.parse(bodyText);
            const message = parsed?.errorMessage || parsed?.message || parsed?.errorCode;
            if (message) return `HTTP ${status}: ${message}`;
        } catch {
            // Non-JSON error body
        }
        return `HTTP ${status}: ${bodyText.slice(0, 200)}`;
    }
    return `HTTP ${status}${fallback ? `: ${fallback}` : ''}`;
}

async function didaRequest<T>(
    token: string,
    endpoint: string,
    options: { method?: string; body?: any } = {}
): Promise<T> {
    const cleanToken = String(token || '').trim();
    if (!cleanToken) {
        throw new Error(i18n('didaTokenRequired') || 'Please enter Dida365 API token');
    }

    const method = options.method || 'GET';
    const url = `${DIDA_API_BASE_URL}${endpoint}`;
    const bodyText = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
    };

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, DIDA_REQUEST_TIMEOUT_MS);

    try {
        let status: number;
        let statusText = '';
        let responseText = '';

        try {
            const response = await fetch(url, {
                method,
                headers,
                body: bodyText,
                signal: controller.signal,
            });
            status = response.status;
            statusText = response.statusText || '';
            responseText = await response.text();
        } catch (directError: any) {
            if (controller.signal.aborted) {
                throw new Error(
                    timedOut
                        ? `Dida365 API request timed out (${DIDA_REQUEST_TIMEOUT_MS}ms): ${endpoint}`
                        : `Dida365 API request aborted: ${endpoint}`
                );
            }
            if (!isLikelyCorsOrNetworkError(directError)) {
                throw directError;
            }

            console.warn('Direct Dida365 fetch failed, falling back to forwardProxy:', endpoint, directError);
            const proxied = await forwardProxy(
                url,
                method,
                bodyText ?? '',
                Object.entries(headers).map(([key, value]) => ({ [key]: value })),
                DIDA_REQUEST_TIMEOUT_MS,
                'application/json'
            );
            if (!proxied || typeof proxied.status !== 'number') {
                throw new Error(`Dida365 proxy ${method} failed: invalid response`);
            }
            status = proxied.status;
            responseText = typeof proxied.body === 'string' ? proxied.body : String(proxied.body ?? '');
        }

        if (status < 200 || status >= 300) {
            const err = new Error(parseDidaErrorMessage(status, responseText, statusText));
            (err as any).status = status;
            throw err;
        }

        if (!responseText.trim()) {
            return null as T;
        }
        return JSON.parse(responseText) as T;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchDidaProjects(token: string): Promise<DidaProjectItem[]> {
    const remoteProjects = await didaRequest<DidaProjectItem[]>(token, '/project', { method: 'GET' });
    const activeProjects = (Array.isArray(remoteProjects) ? remoteProjects : [])
        .filter(project => project && project.id && !project.closed)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const inboxItem: DidaProjectItem = {
        id: DIDA_INBOX_LIST_ID,
        name: i18n('didaInbox') || '收集箱',
        color: '#4f46e5',
        kind: 'TASK',
        isInbox: true,
    };

    return [inboxItem, ...activeProjects];
}

function mapDidaPriorityToLocal(priority?: number): 'high' | 'medium' | 'low' | 'none' {
    if (priority === 5) return 'high';
    if (priority === 3) return 'medium';
    if (priority === 1) return 'low';
    return 'none';
}

function mapLocalPriorityToDida(priority?: string): 0 | 1 | 3 | 5 {
    if (priority === 'high') return 5;
    if (priority === 'medium') return 3;
    if (priority === 'low') return 1;
    return 0;
}

function parseDidaTimestamp(value?: string): Date | null {
    if (!value) return null;
    const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const dt = new Date(normalized);
    if (!Number.isNaN(dt.getTime())) return dt;
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseDidaRepeatFlag(repeatFlag?: string): any {
    if (!repeatFlag || typeof repeatFlag !== 'string') return undefined;
    const cleaned = repeatFlag.trim().replace(/^RRULE:/i, '');
    if (!cleaned) return undefined;
    try {
        const recur = ICAL.Recur.fromString(cleaned);
        return parseIcalRRule(recur) || undefined;
    } catch (error) {
        console.warn('Failed to parse Dida365 repeatFlag:', repeatFlag, error);
        return undefined;
    }
}

function buildTaskDescription(task: DidaApiTask): string | undefined {
    const parts: string[] = [];
    const content = (task.content || '').trim();
    const desc = (task.desc || '').trim();
    if (content) parts.push(content);
    if (desc && desc !== content) parts.push(desc);

    if (Array.isArray(task.items) && task.items.length > 0) {
        const checklist = task.items
            .slice()
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
            .map(item => `- [${item.status === 1 || item.status === 2 ? 'x' : ' '}] ${item.title || ''}`.trimEnd())
            .join('\n');
        if (checklist) parts.push(checklist);
    }

    const joined = parts.join('\n\n').trim();
    return joined || undefined;
}

function convertDidaTaskToEvent(
    task: DidaApiTask,
    listId: string,
    defaultPriority?: 'high' | 'medium' | 'low' | 'none'
): DidaRemoteTaskEvent | null {
    if (!task || !task.id) return null;

    const startDt = parseDidaTimestamp(task.startDate);
    const dueDt = parseDidaTimestamp(task.dueDate);
    const isAllDay = task.isAllDay === true;

    let date: string | undefined;
    let time: string | undefined;
    let endDate: string | undefined;
    let endTime: string | undefined;

    if (startDt && dueDt) {
        date = formatDate(startDt);
        const dueDateStr = formatDate(dueDt);
        if (isAllDay) {
            if (dueDateStr > date) {
                endDate = dueDateStr;
            }
        } else {
            time = formatTime(startDt);
            const dueTimeStr = formatTime(dueDt);
            if (dueDt.getTime() > startDt.getTime()) {
                endDate = dueDateStr;
                endTime = dueTimeStr;
            }
        }
    } else if (startDt) {
        date = formatDate(startDt);
        if (!isAllDay) {
            time = formatTime(startDt);
        }
    } else if (dueDt) {
        date = formatDate(dueDt);
        if (!isAllDay) {
            time = formatTime(dueDt);
        }
    }

    const mappedPriority = mapDidaPriorityToLocal(task.priority);
    const priority = mappedPriority !== 'none' ? mappedPriority : (defaultPriority || 'none');
    const createdDt = parseDidaTimestamp(task.createdTime);
    const completedDt = parseDidaTimestamp(task.completedTime);
    const completed = task.status === 2;

    return {
        uid: `dida:${task.id}`,
        title: (task.title || '').trim() || i18n('unnamedCalendarEvent') || 'Untitled',
        description: buildTaskDescription(task),
        date,
        time,
        endDate,
        endTime,
        completed,
        completedAt: completed ? (completedDt?.toISOString() || task.completedTime) : undefined,
        priority,
        repeat: parseDidaRepeatFlag(task.repeatFlag),
        createdAt: createdDt?.toISOString(),
        customGroupId: getDidaGroupId(listId),
        didaTaskId: task.id,
        didaProjectId: task.projectId,
        didaListId: listId,
        didaParentTaskId: task.parentId || undefined,
        didaEtag: task.etag,
        didaKind: task.kind,
        didaItems: Array.isArray(task.items) ? task.items : undefined,
        didaTags: Array.isArray(task.tags) ? task.tags : undefined,
        url: `https://dida365.com/webapp/#p/${task.projectId}/tasks/${task.id}`,
    };
}

function formatDidaQueryTimestamp(date: Date): string {
    return date.toISOString().replace('Z', '+0000');
}

function formatLocalDateTimeToDidaIso(dateStr: string, timeStr?: string): string | undefined {
    const [yearStr, monthStr, dayStr] = String(dateStr || '').split('-');
    const [hourStr, minuteStr] = String(timeStr || '00:00').split(':');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr || 0);
    const minute = Number(minuteStr || 0);
    if (
        !Number.isFinite(year) ||
        !Number.isFinite(month) ||
        !Number.isFinite(day) ||
        !Number.isFinite(hour) ||
        !Number.isFinite(minute)
    ) {
        return undefined;
    }
    const dt = new Date(year, month - 1, day, hour, minute, 0, 0);
    if (Number.isNaN(dt.getTime())) return undefined;
    return dt.toISOString().replace('Z', '+0000');
}

export function isValidHexColor(color?: string): boolean {
    return typeof color === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color.trim());
}

/**
 * Sync selected Dida365 lists into the subscription project's customGroups.
 */
export async function syncDidaProjectGroups(
    plugin: any,
    projectId: string,
    selectedProjects: DidaSelectedProject[],
    options: { preferCustomMode?: boolean } = {}
): Promise<void> {
    if (!plugin || !projectId) return;

    const projectData = await plugin.loadProjectData();
    const project = projectData?.[projectId];
    if (!project) return;

    const existingGroups: any[] = Array.isArray(project.customGroups) ? project.customGroups : [];
    const existingGroupById = new Map<string, any>();
    const manualGroups: any[] = [];

    for (const group of existingGroups) {
        if (!group?.id) continue;
        if (String(group.id).startsWith(DIDA_GROUP_ID_PREFIX)) {
            existingGroupById.set(group.id, group);
        } else {
            manualGroups.push(group);
        }
    }

    const syncedDidaGroups = (selectedProjects || []).map((list, index) => {
        const groupId = getDidaGroupId(list.id);
        const existing = existingGroupById.get(groupId);
        const fallbackColor = GROUP_PRESET_COLORS[index % GROUP_PRESET_COLORS.length];
        const color = isValidHexColor(list.color)
            ? list.color!.trim()
            : (isValidHexColor(existing?.color) ? existing.color : fallbackColor);

        return {
            ...(existing || {}),
            id: groupId,
            name: list.name || existing?.name || list.id,
            color,
            sort: index * 10,
        };
    });

    const nextGroups = [
        ...syncedDidaGroups,
        ...manualGroups.map((group, idx) => ({
            ...group,
            sort: (syncedDidaGroups.length + idx) * 10,
        })),
    ];

    const groupsChanged = JSON.stringify(existingGroups) !== JSON.stringify(nextGroups);
    const shouldSwitchMode =
        options.preferCustomMode === true &&
        syncedDidaGroups.length > 0 &&
        (!project.kanbanMode || project.kanbanMode === 'status');

    if (!groupsChanged && !shouldSwitchMode) {
        return;
    }

    project.customGroups = nextGroups;
    if (shouldSwitchMode) {
        project.kanbanMode = 'custom';
    }
    project.updatedTime = new Date().toISOString();
    projectData[projectId] = project;

    await plugin.saveProjectData(projectData);
    window.dispatchEvent(new CustomEvent('projectUpdated', {
        detail: { projectId, project },
    }));
}

export async function fetchDidaTasks(
    subscription: IcsSubscription
): Promise<{
    events: DidaRemoteTaskEvent[];
    updatedSelectedProjects: DidaSelectedProject[];
    inboxRealProjectId?: string;
}> {
    const token = (subscription.didaToken || '').trim();
    if (!token) {
        throw new Error(i18n('didaTokenRequired') || 'Please enter Dida365 API token');
    }

    const selected = Array.isArray(subscription.didaSelectedProjects)
        ? subscription.didaSelectedProjects.filter(item => item && item.id)
        : [];
    if (selected.length === 0) {
        throw new Error(i18n('didaSelectListsRequired') || 'Please select at least one Dida365 list');
    }

    // Refresh project metadata (names & colors) when possible.
    let remoteProjectMap = new Map<string, DidaProjectItem>();
    try {
        const allProjects = await fetchDidaProjects(token);
        allProjects.forEach(p => remoteProjectMap.set(p.id, p));
    } catch (error) {
        console.warn('Failed to refresh Dida365 project metadata, using saved selection:', error);
    }

    const updatedSelectedProjects: DidaSelectedProject[] = selected.map(item => {
        const fresh = remoteProjectMap.get(item.id);
        return {
            id: item.id,
            name: fresh?.name || item.name,
            color: fresh?.color || item.color,
            kind: fresh?.kind || item.kind,
        };
    });

    const eventsByTaskId = new Map<string, DidaRemoteTaskEvent>();
    let inboxRealProjectId = subscription.didaInboxProjectId;
    const realProjectIdToListId = new Map<string, string>();

    const projectDataResults = await Promise.all(
        updatedSelectedProjects.map(async list => {
            const data = await didaRequest<DidaProjectDataResponse>(
                token,
                `/project/${encodeURIComponent(list.id)}/data`,
                { method: 'GET' }
            );
            return { list, data };
        })
    );

    for (const { list, data } of projectDataResults) {
        if (list.id !== DIDA_INBOX_LIST_ID) {
            realProjectIdToListId.set(list.id, list.id);
        } else if (!inboxRealProjectId) {
            const columnProjectId = Array.isArray(data?.columns)
                ? data.columns.find(col => col?.projectId)?.projectId
                : undefined;
            if (columnProjectId) {
                inboxRealProjectId = columnProjectId;
                realProjectIdToListId.set(columnProjectId, list.id);
            }
        }
        const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
        for (const task of tasks) {
            if (list.id === DIDA_INBOX_LIST_ID && task.projectId && !inboxRealProjectId) {
                inboxRealProjectId = task.projectId;
            }
            if (task.projectId) {
                realProjectIdToListId.set(task.projectId, list.id);
            }
            const converted = convertDidaTaskToEvent(task, list.id, subscription.priority);
            if (converted) {
                eventsByTaskId.set(converted.didaTaskId, converted);
            }
        }
    }

    // Also fetch recently completed tasks for selected lists so completions in Dida365 reflect locally.
    const completedQueryProjectIds = updatedSelectedProjects
        .map(item => (item.id === DIDA_INBOX_LIST_ID ? inboxRealProjectId : item.id))
        .filter((id): id is string => Boolean(id));

    if (completedQueryProjectIds.length > 0) {
        try {
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - DIDA_COMPLETED_RETENTION_DAYS * 24 * 60 * 60 * 1000);
            const completedTasks = await didaRequest<DidaApiTask[]>(token, '/task/completed', {
                method: 'POST',
                body: {
                    projectIds: completedQueryProjectIds,
                    startDate: formatDidaQueryTimestamp(startDate),
                    endDate: formatDidaQueryTimestamp(endDate),
                },
            });

            if (Array.isArray(completedTasks)) {
                for (const task of completedTasks) {
                    if (!task?.id || eventsByTaskId.has(task.id)) continue;
                    const listId = realProjectIdToListId.get(task.projectId)
                        || (task.projectId === inboxRealProjectId ? DIDA_INBOX_LIST_ID : task.projectId);
                    const converted = convertDidaTaskToEvent(task, listId, subscription.priority);
                    if (converted) {
                        eventsByTaskId.set(converted.didaTaskId, converted);
                    }
                }
            }
        } catch (error) {
            console.warn('Failed to fetch recently completed Dida365 tasks (continuing with active tasks):', error);
        }
    }

    return {
        events: Array.from(eventsByTaskId.values()),
        updatedSelectedProjects,
        inboxRealProjectId,
    };
}

function resolveTargetDidaProjectId(
    subscription: IcsSubscription,
    listId: string
): string | null {
    if (listId === DIDA_INBOX_LIST_ID) {
        return subscription.didaInboxProjectId || null;
    }
    return listId;
}

export async function updateDidaTask(
    subscription: IcsSubscription,
    currentTask: any,
    nextTask: any
): Promise<{
    didaProjectId: string;
    didaListId: string;
    didaEtag?: string;
}> {
    const token = (subscription.didaToken || '').trim();
    const taskId = nextTask?.didaTaskId || currentTask?.didaTaskId;
    let projectId = nextTask?.didaProjectId || currentTask?.didaProjectId;
    let listId = nextTask?.didaListId || currentTask?.didaListId || '';

    if (!token || !taskId || !projectId) {
        throw new Error('Missing Dida365 task metadata for update');
    }

    // 1. Handle cross-group move when user drags task into another Dida list group
    const nextGroupListId = extractDidaListIdFromGroupId(nextTask?.customGroupId);
    if (nextGroupListId && nextGroupListId !== listId) {
        const targetProjectId = resolveTargetDidaProjectId(subscription, nextGroupListId);
        if (targetProjectId && targetProjectId !== projectId) {
            await didaRequest(token, '/task/move', {
                method: 'POST',
                body: [{
                    fromProjectId: projectId,
                    toProjectId: targetProjectId,
                    taskId,
                }],
            });
            projectId = targetProjectId;
            listId = nextGroupListId;
        }
    }

    // 2. Build update payload
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    const payload: Record<string, any> = {
        id: taskId,
        projectId,
        title: nextTask.title || i18n('unnamedCalendarEvent') || 'Untitled',
        priority: mapLocalPriorityToDida(nextTask.priority),
        timeZone,
    };

    const noteText = nextTask.note ?? getTaskNotePreviewText(nextTask);
    if (typeof noteText === 'string') {
        payload.content = noteText;
    }

    if (nextTask.date) {
        if (!nextTask.time) {
            const startIso = formatLocalDateTimeToDidaIso(nextTask.date, '00:00');
            const endIso = formatLocalDateTimeToDidaIso(nextTask.endDate || nextTask.date, '00:00');
            payload.isAllDay = true;
            if (startIso) payload.startDate = startIso;
            if (endIso) payload.dueDate = endIso;
        } else {
            const startIso = formatLocalDateTimeToDidaIso(nextTask.date, nextTask.time);
            const endIso = formatLocalDateTimeToDidaIso(
                nextTask.endDate || nextTask.date,
                nextTask.endTime || nextTask.time
            );
            payload.isAllDay = false;
            if (startIso) payload.startDate = startIso;
            if (endIso) payload.dueDate = endIso;
        }
    } else {
        payload.startDate = null;
        payload.dueDate = null;
        payload.isAllDay = false;
    }

    const wasCompleted = Boolean(currentTask?.completed);
    const isCompleted = Boolean(nextTask?.completed);
    if (wasCompleted && !isCompleted) {
        payload.status = 0;
    }

    const updated = await didaRequest<DidaApiTask | null>(
        token,
        `/task/${encodeURIComponent(taskId)}`,
        {
            method: 'POST',
            body: payload,
        }
    );

    // 3. Complete task via dedicated endpoint when transitioned to completed
    if (!wasCompleted && isCompleted) {
        await didaRequest(
            token,
            `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}/complete`,
            { method: 'POST' }
        );
    }

    return {
        didaProjectId: projectId,
        didaListId: listId,
        didaEtag: updated?.etag || nextTask?.didaEtag,
    };
}

export async function deleteDidaTask(
    subscription: IcsSubscription,
    task: any
): Promise<void> {
    const token = (subscription.didaToken || '').trim();
    const taskId = task?.didaTaskId;
    const projectId = task?.didaProjectId;
    if (!token || !taskId || !projectId) return;

    await didaRequest(
        token,
        `/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
        { method: 'DELETE' }
    );
}
