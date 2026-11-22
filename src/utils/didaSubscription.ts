import ICAL from 'ical.js';
import { forwardProxy } from '../api';
import { i18n } from '../pluginInstance';
import { formatDate, formatTime, parseIcalRRule } from './icsImport';
import type { IcsSubscription } from './icsSubscription';
import { getTaskNotePreviewText, loadTaskNote } from './taskNoteStorage';
import { getTaskBoundBlockId, parseSiyuanTaskTitle } from './taskTitleLinks';
import type { RepeatConfig } from '../components/dialog/RepeatSettingsDialog';

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
    blockId?: string;
    description?: string;
    date?: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    completed: boolean;
    completedAt?: string;
    priority?: 'high' | 'medium' | 'low' | 'none';
    repeat?: RepeatConfig;
    createdAt?: string;
    sort?: number;
    customGroupId: string;
    didaTaskId: string;
    didaProjectId: string;
    didaListId: string;
    didaParentTaskId?: string;
    didaEtag?: string;
    didaKind?: string;
    didaItems?: DidaChecklistItem[];
    didaTags?: string[];
    didaNoteFields?: { content: string; desc: string };
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
    options: { method?: string; body?: any; shouldRetryViaProxy?: () => Promise<boolean> } = {}
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
            if (options.shouldRetryViaProxy && !await options.shouldRetryViaProxy()) {
                return null as T;
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

function getLocalDidaTaskSort(sortOrder?: number): number | undefined {
    // Dida puts smaller values first. The kanban's default manual descending order needs larger values first.
    return Number.isFinite(sortOrder) ? 0 - sortOrder : undefined;
}

function parseDidaTimestamp(value?: string): Date | null {
    if (!value) return null;
    const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const dt = new Date(normalized);
    if (!Number.isNaN(dt.getTime())) return dt;
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function parseDidaRepeatFlag(repeatFlag?: string): RepeatConfig | undefined {
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

function splitDidaBlockLink(value?: string | null): { text: string; blockId?: string } {
    const body = (value || '').trim();
    const lineEnd = body.indexOf('\n');
    const firstLine = lineEnd === -1 ? body : body.slice(0, lineEnd);
    const link = parseSiyuanTaskTitle(firstLine);
    if (link && ['打开思源块', '打开绑定块', 'Open SiYuan Block', 'Open Linked Block'].includes(link.title)) {
        return { blockId: link.blockId, text: lineEnd === -1 ? '' : body.slice(lineEnd + 1).trimStart() };
    }
    return { text: body };
}

function buildTaskDescription(task: DidaApiTask, content: string, desc: string): string | undefined {
    const parts: string[] = [];
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
    const title = (task.title || '').trim();
    const titleLink = parseSiyuanTaskTitle(title);
    const content = splitDidaBlockLink(task.content);
    const desc = splitDidaBlockLink(task.desc);
    const description = buildTaskDescription(task, content.text, desc.text);

    return {
        uid: `dida:${task.id}`,
        title: (titleLink?.title || title) || i18n('unnamedCalendarEvent') || 'Untitled',
        blockId: content.blockId || desc.blockId || titleLink?.blockId,
        description,
        date,
        time,
        endDate,
        endTime,
        completed,
        completedAt: completed ? (completedDt?.toISOString() || task.completedTime) : undefined,
        priority,
        repeat: completed ? undefined : parseDidaRepeatFlag(task.repeatFlag),
        createdAt: createdDt?.toISOString(),
        sort: getLocalDidaTaskSort(task.sortOrder),
        customGroupId: getDidaGroupId(listId),
        didaTaskId: task.id,
        didaProjectId: task.projectId,
        didaListId: listId,
        didaParentTaskId: task.parentId || undefined,
        didaEtag: task.etag,
        didaKind: task.kind,
        didaItems: Array.isArray(task.items) ? task.items : undefined,
        didaTags: Array.isArray(task.tags) ? task.tags : undefined,
        didaNoteFields: content.text !== (description || '') || desc.blockId
            ? { content: task.content || '', desc: task.desc || '' }
            : undefined,
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

async function ensureInboxRealProjectId(subscription: IcsSubscription): Promise<string | null> {
    if (subscription.didaInboxProjectId) {
        return subscription.didaInboxProjectId;
    }
    const token = (subscription.didaToken || '').trim();
    if (!token) return null;
    try {
        const data = await didaRequest<DidaProjectDataResponse>(
            token,
            `/project/${DIDA_INBOX_LIST_ID}/data`,
            { method: 'GET' }
        );
        const fromTask = Array.isArray(data?.tasks) ? data.tasks.find(t => t?.projectId)?.projectId : undefined;
        const fromCol = Array.isArray(data?.columns) ? data.columns.find(c => c?.projectId)?.projectId : undefined;
        const resolved = fromTask || fromCol || null;
        if (resolved) {
            subscription.didaInboxProjectId = resolved;
        }
        return resolved;
    } catch (error) {
        console.warn('Failed to resolve Dida365 inbox projectId:', error);
        return null;
    }
}

function formatDidaTaskContent(note: string, blockId?: string): string {
    if (!blockId) return note;
    const label = i18n('openBoundBlock') || 'Open Linked Block';
    const link = `[${label}](siyuan://blocks/${blockId})`;
    return note ? `${link}\n\n${note}` : link;
}

function getDidaNoteText(task: any): string {
    return typeof task.note === 'string' ? task.note : getTaskNotePreviewText(task);
}

async function buildDidaTaskPayloadFields(task: any, plugin: any, currentTask?: any): Promise<Record<string, any>> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    const payload: Record<string, any> = {
        title: task.title || i18n('unnamedCalendarEvent') || 'Untitled',
        priority: mapLocalPriorityToDida(task.priority),
        timeZone,
    };

    const blockId = getTaskBoundBlockId(task);
    const oldNoteFields = currentTask?.didaNoteFields;
    const noteChanged = currentTask && getDidaNoteText(currentTask) !== getDidaNoteText(task);
    const noteText = oldNoteFields && !noteChanged
        ? splitDidaBlockLink(oldNoteFields.content).text
        : task.notes === true ? await loadTaskNote(plugin, task) : getDidaNoteText(task);
    payload.content = formatDidaTaskContent(noteText, blockId);
    if (oldNoteFields) {
        const desc = splitDidaBlockLink(oldNoteFields.desc);
        if (desc.blockId) payload.desc = desc.text;
    }

    if (task.date) {
        if (!task.time) {
            const startIso = formatLocalDateTimeToDidaIso(task.date, '00:00');
            const endIso = formatLocalDateTimeToDidaIso(task.endDate || task.date, '00:00');
            payload.isAllDay = true;
            if (startIso) payload.startDate = startIso;
            if (endIso) payload.dueDate = endIso;
        } else {
            const startIso = formatLocalDateTimeToDidaIso(task.date, task.time);
            const endIso = formatLocalDateTimeToDidaIso(
                task.endDate || task.date,
                task.endTime || task.time
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

    return payload;
}

export function hasDidaRemoteTaskChanged(currentTask: any, nextTask: any): boolean {
    if (!currentTask || !nextTask) return true;
    const normStr = (v: any) => String(v ?? '');
    const currentNote = normStr(getDidaNoteText(currentTask));
    const nextNote = normStr(getDidaNoteText(nextTask));
    if (normStr(currentTask.title) !== normStr(nextTask.title)) return true;
    if (currentNote !== nextNote) return true;
    if (getTaskBoundBlockId(currentTask) !== getTaskBoundBlockId(nextTask)) return true;
    if (normStr(currentTask.date) !== normStr(nextTask.date)) return true;
    if (normStr(currentTask.time) !== normStr(nextTask.time)) return true;
    if (normStr(currentTask.endDate) !== normStr(nextTask.endDate)) return true;
    if (normStr(currentTask.endTime) !== normStr(nextTask.endTime)) return true;
    if (normStr(currentTask.priority || 'none') !== normStr(nextTask.priority || 'none')) return true;
    if (Boolean(currentTask.completed) !== Boolean(nextTask.completed)) return true;

    const currentListId = extractDidaListIdFromGroupId(currentTask.customGroupId) || currentTask.didaListId || '';
    const nextListId = extractDidaListIdFromGroupId(nextTask.customGroupId) || nextTask.didaListId || '';
    if (currentListId !== nextListId) return true;

    return false;
}

export async function completeDidaRepeatOccurrence(
    subscription: IcsSubscription,
    task: { didaProjectId: string; didaTaskId: string; didaListId: string },
    date: string
): Promise<void> {
    const token = subscription.didaToken || '';
    const endpoint = `/project/${encodeURIComponent(task.didaProjectId)}/task/${encodeURIComponent(task.didaTaskId)}`;
    const readCurrent = async () => convertDidaTaskToEvent(
        await didaRequest<DidaApiTask>(token, endpoint), task.didaListId
    );
    const current = await readCurrent();
    if (!current?.repeat?.enabled || current.date !== date) {
        throw new Error(i18n('didaRepeatCompleteCurrentOnly'));
    }
    await didaRequest(token, `${endpoint}/complete`, {
        method: 'POST',
        // A failed browser request may have reached Dida365. Never retry a completion against the next occurrence.
        shouldRetryViaProxy: async () => {
            const latest = await readCurrent();
            if (latest?.completed || (latest?.date && latest.date !== date)) return false;
            if (!latest?.repeat?.enabled || latest.didaEtag !== current.didaEtag) {
                throw new Error(i18n('didaRepeatCompleteCurrentOnly'));
            }
            return true;
        },
    });
}

export async function createDidaTask(
    subscription: IcsSubscription,
    task: any,
    parentTask: any,
    plugin: any
): Promise<{
    uid: string;
    didaTaskId: string;
    didaProjectId: string;
    didaListId: string;
    didaEtag?: string;
    sort?: number;
    customGroupId: string;
    url: string;
}> {
    const token = (subscription.didaToken || '').trim();
    if (!token) {
        throw new Error(i18n('didaTokenRequired') || 'Please enter Dida365 API token');
    }

    const listId =
        extractDidaListIdFromGroupId(task?.customGroupId) ||
        parentTask?.didaListId ||
        subscription.didaSelectedProjects?.[0]?.id ||
        DIDA_INBOX_LIST_ID;

    let targetProjectId: string | null = null;
    if (listId === DIDA_INBOX_LIST_ID) {
        targetProjectId = await ensureInboxRealProjectId(subscription);
    } else {
        targetProjectId = listId;
    }

    const payload = await buildDidaTaskPayloadFields(task, plugin);
    if (targetProjectId) {
        payload.projectId = targetProjectId;
    }
    // Dida365 POST /open/v1/task rejects null date values on create; omit unset dates.
    if (!task.date) {
        delete payload.startDate;
        delete payload.dueDate;
    }

    const created = await didaRequest<DidaApiTask>(token, '/task', {
        method: 'POST',
        body: payload,
    });

    if (!created?.id) {
        throw new Error('Dida365 create task returned empty task id');
    }

    const resolvedProjectId = created.projectId || targetProjectId || listId;
    if (listId === DIDA_INBOX_LIST_ID && created.projectId) {
        subscription.didaInboxProjectId = created.projectId;
    }

    if (task.completed) {
        try {
            await didaRequest(
                token,
                `/project/${encodeURIComponent(resolvedProjectId)}/task/${encodeURIComponent(created.id)}/complete`,
                { method: 'POST' }
            );
        } catch (error) {
            console.warn('Failed to mark newly created Dida365 task as completed:', created.id, error);
        }
    }

    return {
        uid: `dida:${created.id}`,
        didaTaskId: created.id,
        didaProjectId: resolvedProjectId,
        didaListId: listId,
        didaEtag: created.etag,
        sort: getLocalDidaTaskSort(created.sortOrder),
        customGroupId: getDidaGroupId(listId),
        url: `https://dida365.com/webapp/#p/${resolvedProjectId}/tasks/${created.id}`,
    };
}

export async function updateDidaTask(
    subscription: IcsSubscription,
    currentTask: any,
    nextTask: any,
    plugin: any
): Promise<{
    didaProjectId: string;
    didaListId: string;
    didaEtag?: string;
    didaNoteFields?: DidaRemoteTaskEvent['didaNoteFields'];
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
        const targetProjectId = nextGroupListId === DIDA_INBOX_LIST_ID
            ? await ensureInboxRealProjectId(subscription)
            : resolveTargetDidaProjectId(subscription, nextGroupListId);
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
    const payload: Record<string, any> = {
        id: taskId,
        projectId,
        ...await buildDidaTaskPayloadFields(nextTask, plugin, currentTask),
    };

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
        didaNoteFields: currentTask?.didaNoteFields ? {
            content: payload.content,
            desc: payload.desc ?? currentTask.didaNoteFields.desc,
        } : undefined,
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
