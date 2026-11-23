import { fetchSyncPost, getAllEditor, showMessage } from 'siyuan';
import type TaskNoteManagement from '../../index';
import { sql } from '../../api';
import { i18n } from '../../pluginInstance';
import type { ReminderItem } from '../../types/reminder';
import type { Project } from '../dataManager/projectManager';
import { QuickReminderDialog } from '../dialog/QuickReminderDialog';
import {
    DEFAULT_TASK_VIEW_FILTERS, getTaskViewRows, getTaskViewTitle, parseTaskViewFilters, serializeTaskView,
    TASK_VIEW_CONTENT_PREFIX, TASK_VIEW_TYPE, type TaskViewFilters,
} from '../../utils/taskView';
import '../../styles/task-view.scss';

const BLOCK_ID = /^\d{14}-[a-z0-9]{7}$/;
const PAGE_SIZE = 100;

type TaskViewRenderer = TaskNoteManagement['customBlockRenders'][string]['render'];
type TaskViewSnapshot = { tasks: ReminderItem[]; projects: Project[] };

export class TaskViewBlock {
    private readonly info: string;
    private readonly mounts = new Set<(snapshot: Promise<TaskViewSnapshot>) => void>();
    private readonly searches = new WeakMap<Element, Map<string, string>>();
    private snapshot?: Promise<TaskViewSnapshot>;
    private latestTasks: ReminderItem[] = [];
    private timer?: ReturnType<typeof setTimeout>;
    private writes = Promise.resolve();
    private disposed = false;

    constructor(private readonly plugin: TaskNoteManagement) {
        this.info = `${encodeURIComponent(plugin.name)}/${TASK_VIEW_TYPE}`;
        plugin.customBlockRenders[TASK_VIEW_TYPE] = { render: this.render };
        const name = i18n('taskViewBlock');
        plugin.protyleSlash.push({
            id: TASK_VIEW_TYPE,
            filter: [name, '任务视图', 'task view', 'task-view'],
            html: `<svg class="b3-list-item__graphic"><use href="#iconList"></use></svg><span class="b3-list-item__text">${name}</span>`,
            callback: (editor) => {
                if (editor.protyle.disabled) return;
                const content = serializeTaskView(DEFAULT_TASK_VIEW_FILTERS, this.latestTasks);
                editor.insert(editor.protyle.lute.Md2BlockDOM(this.markdown(content)), true);
                this.scheduleIndex();
            },
        });
        window.addEventListener('reminderUpdated', this.refresh);
        window.addEventListener('projectUpdated', this.refresh);
        this.scheduleIndex();
    }

    dispose = () => {
        this.disposed = true;
        clearTimeout(this.timer);
        this.mounts.clear();
        window.removeEventListener('reminderUpdated', this.refresh);
        window.removeEventListener('projectUpdated', this.refresh);
    };

    private markdown(content: string): string {
        return `;;;${this.info}\n${content}\n;;;`;
    }

    private loadSnapshot(): Promise<TaskViewSnapshot> {
        if (!this.snapshot) {
            const snapshot = Promise.all([this.plugin.loadReminderData(), this.plugin.loadProjectData()])
                .then(([reminders, projects]) => {
                    const tasks = Object.values(reminders || {}).filter((task): task is ReminderItem =>
                        Boolean(task && typeof (task as ReminderItem).id === 'string'));
                    if (this.snapshot === snapshot) this.latestTasks = tasks;
                    return {
                        tasks,
                        projects: Object.values(projects || {}).filter((project): project is Project =>
                            Boolean(project && typeof (project as Project).id === 'string' && typeof (project as Project).name === 'string')),
                    };
                }).catch(error => {
                    if (this.snapshot === snapshot) this.snapshot = undefined;
                    throw error;
                });
            this.snapshot = snapshot;
        }
        return this.snapshot;
    }

    private refresh = () => {
        this.snapshot = undefined;
        if (this.mounts.size) {
            const snapshot = this.loadSnapshot();
            this.mounts.forEach(render => render(snapshot));
        }
        this.scheduleIndex();
    };

    private scheduleIndex(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            void this.refreshIndex().catch(error => console.warn('Task view index refresh failed:', error));
        }, 1200);
    }

    private async refreshIndex(): Promise<void> {
        const snapshot = this.loadSnapshot();
        const { tasks } = await snapshot;
        let cursor = '';
        while (!this.disposed && this.snapshot === snapshot) {
            const blocks: Array<{ id: string; content: string }> = await sql(
                `SELECT id, content FROM blocks WHERE type = 'custom' AND content LIKE '${TASK_VIEW_CONTENT_PREFIX}%' AND id > '${cursor}' ORDER BY id LIMIT 64`
            );
            if (!blocks?.length) return;
            for (const { id, content } of blocks) {
                if (this.disposed || this.snapshot !== snapshot || !BLOCK_ID.test(id)) return;
                const filters = parseTaskViewFilters(content);
                if (!filters || serializeTaskView(filters, tasks) === content) continue;
                await this.write(id).catch(error => console.warn('Task view block update failed:', id, error));
            }
            cursor = blocks[blocks.length - 1].id;
        }
    }

    private write(id: string, patch?: Partial<TaskViewFilters>): Promise<string | undefined> {
        const operation = async () => {
            if (this.disposed || !BLOCK_ID.test(id)) return;
            const response = await fetchSyncPost('/api/block/getBlockDOM', { id }, undefined, false);
            if (response.code !== 0 || this.disposed) return;
            const template = document.createElement('template');
            template.innerHTML = response.data.dom;
            const block = template.content.firstElementChild;
            if (block?.getAttribute('data-type') !== 'NodeCustomBlock' || block.getAttribute('data-info') !== this.info) return;
            const oldContent = block.getAttribute('data-content') || '';
            const filters = parseTaskViewFilters(oldContent);
            if (!filters) return;
            const next = { ...filters, ...patch };
            if (next.start && next.end && next.start > next.end) throw new Error(i18n('startDateAfterEndDate'));
            const { tasks } = await this.loadSnapshot();
            if (this.disposed) return;
            const content = serializeTaskView(next, tasks);
            if (oldContent === content) return content;
            // 保留宿主返回的块 DOM 和属性，只替换持久化内容及纯文本回退。
            block.setAttribute('data-content', content);
            const fallback = block.querySelector('.custom-block__content');
            if (fallback) fallback.textContent = content;
            const result = await fetchSyncPost('/api/block/updateBlock', {
                id, data: block.outerHTML, dataType: 'dom', lockType: true,
            }, undefined, false);
            if (result.code !== 0) throw new Error(result.msg || i18n('saveFailed'));
            return content;
        };
        const write = this.writes.then(async () => {
            if (navigator.locks) return await navigator.locks.request(`siyuan-task-view:${id}`, operation);
            return operation();
        });
        this.writes = write.then(() => undefined, () => undefined);
        return write;
    }

    private render: TaskViewRenderer = ({ element, content }) => {
        let filters = parseTaskViewFilters(content);
        if (!filters) {
            element.textContent = content;
            return;
        }
        const block = element.closest('[data-type="NodeCustomBlock"][data-node-id]');
        const root = block?.closest('.protyle-wysiwyg');
        if (!root) return;
        const id = block.getAttribute('data-node-id');
        const canEdit = () => Boolean(!this.disposed && element.isConnected && BLOCK_ID.test(id) && getAllEditor().some(
            editor => editor?.protyle.wysiwyg.element === root && !editor.protyle.disabled
        ));
        let queries = this.searches.get(root);
        if (!queries) {
            queries = new Map();
            this.searches.set(root, queries);
        }

        const doc = element.ownerDocument;
        const toolbar = doc.createElement('div');
        toolbar.className = 'task-view-block__toolbar';
        const search = doc.createElement('input');
        search.type = 'search';
        search.className = 'b3-text-field task-view-block__search';
        search.placeholder = i18n('searchTasks');
        search.setAttribute('aria-label', search.placeholder);
        search.value = queries.get(id) || '';
        const project = this.select(doc, i18n('project'), [['', i18n('allProjects')]]);
        const status = this.select(doc, i18n('taskStatus'), [
            ['all', i18n('all')], ['open', i18n('unfinished')], ['completed', i18n('completed')],
        ]);
        const start = this.dateInput(doc, i18n('startDate'));
        const end = this.dateInput(doc, i18n('endDate'));
        const add = this.button(doc, 'iconAdd', i18n('newTask'));
        const list = doc.createElement('ul');
        list.className = 'task-view-block__list';
        const feedback = doc.createElement('div');
        feedback.className = 'task-view-block__feedback';
        feedback.setAttribute('role', 'status');
        const more = this.button(doc, 'iconDown', i18n('taskViewShowMore'));
        more.hidden = true;
        toolbar.append(search, project, status, start, end, add);
        element.classList.add('task-view-block');
        element.append(toolbar, list, feedback, more);

        let snapshot: TaskViewSnapshot;
        let limit = PAGE_SIZE;
        let active = true;
        let loading = true;
        let refreshVersion = 0;
        let saving = false;

        const renderRows = () => {
            const editable = canEdit();
            add.hidden = !editable;
            const rows = snapshot ? getTaskViewRows(snapshot.tasks, filters, search.value) : [];
            for (const control of [project, status, start, end]) {
                control.disabled = saving || !snapshot || !editable;
            }
            const fragment = doc.createDocumentFragment();
            for (const row of rows.slice(0, limit)) {
                const item = doc.createElement('li');
                item.className = 'task-view-block__row';
                item.style.setProperty('--task-view-depth', String(Math.min(row.depth, 8)));
                item.classList.toggle('task-view-block__row--context', !row.matches);
                const state = doc.createElement('span');
                state.className = 'task-view-block__state';
                state.title = i18n(row.task.completed ? 'completed' : 'unfinished');
                state.textContent = row.task.completed ? '✓' : '○';
                const title = doc.createElement('span');
                title.className = 'task-view-block__title';
                title.textContent = getTaskViewTitle(row.task) || i18n('unnamedTask');
                title.title = title.textContent;
                const date = doc.createElement('span');
                date.className = 'task-view-block__date';
                date.textContent = [row.task.date, row.task.endDate !== row.task.date && row.task.endDate].filter(Boolean).join(' – ');
                item.append(state, title);
                if (date.textContent) item.append(date);
                if (editable) {
                    const edit = this.button(doc, 'iconEdit', i18n('editTask'));
                    edit.onclick = () => {
                        if (!canEdit()) return;
                        void this.plugin.loadReminderData().then(data => {
                            if (!canEdit()) return;
                            const task = (data || {})[row.task.id] || Object.values(data || {}).find(
                                (entry): entry is ReminderItem => (entry as ReminderItem)?.id === row.task.id
                            );
                            if (!task) {
                                showMessage(i18n('reminderDataNotExist'));
                                return;
                            }
                            new QuickReminderDialog(undefined, undefined, undefined, undefined, {
                                plugin: this.plugin, mode: 'edit', reminder: task,
                            }).show();
                        }).catch(error => this.report(error));
                    };
                    item.append(edit);
                }
                fragment.append(item);
            }
            list.replaceChildren(fragment);
            more.hidden = rows.length <= limit;
            feedback.hidden = rows.length > 0;
            feedback.textContent = loading ? i18n('loadingReminders') : i18n(snapshot ? 'noTasks' : 'loadFailed');
        };

        const setControlValues = () => {
            const projects: Array<[string, string]> = [['', i18n('allProjects')]];
            for (const { id, name } of snapshot?.projects || []) projects.push([id, name]);
            if (filters.projectId && !projects.some(([key]) => key === filters.projectId)) {
                projects.push([filters.projectId, i18n('projectNotExist')]);
            }
            project.replaceChildren(...this.options(doc, projects));
            project.value = filters.projectId;
            status.value = filters.status;
            start.value = filters.start;
            end.value = filters.end;
        };
        const saveFilters = async (patch: Partial<TaskViewFilters>) => {
            if (!canEdit() || saving) return;
            saving = true;
            renderRows();
            try {
                const value = await this.write(id, patch);
                if (!value) throw new Error(i18n('saveFailed'));
                filters = parseTaskViewFilters(value);
                limit = PAGE_SIZE;
            } catch (error) {
                this.report(error);
            } finally {
                saving = false;
                if (active) {
                    setControlValues();
                    renderRows();
                }
            }
        };
        search.oninput = () => {
            if (search.value) queries.set(id, search.value);
            else queries.delete(id);
            limit = PAGE_SIZE;
            renderRows();
        };
        project.onchange = () => void saveFilters({ projectId: project.value });
        status.onchange = () => void saveFilters({ status: status.value as TaskViewFilters['status'] });
        start.onchange = () => void saveFilters({ start: start.value });
        end.onchange = () => void saveFilters({ end: end.value });
        more.onclick = () => {
            limit += PAGE_SIZE;
            renderRows();
        };
        add.onclick = () => {
            if (!canEdit()) return;
            const date = filters.start && filters.start === filters.end ? filters.start : undefined;
            new QuickReminderDialog(date, undefined, undefined, undefined, {
                plugin: this.plugin, defaultProjectId: filters.projectId || undefined,
            }).show();
        };

        const refresh = async (pending: Promise<TaskViewSnapshot>) => {
            const version = ++refreshVersion;
            try {
                const next = await pending;
                if (!active || version !== refreshVersion) return;
                snapshot = next;
            } catch (error) {
                console.warn('Task view data load failed:', error);
            }
            if (!active || version !== refreshVersion) return;
            loading = false;
            if (!saving) setControlValues();
            renderRows();
        };
        this.mounts.add(refresh);
        setControlValues();
        renderRows();
        void refresh(this.loadSnapshot());
        return () => {
            active = false;
            this.mounts.delete(refresh);
        };
    };

    private options(doc: Document, options: Array<[string, string]>): HTMLOptionElement[] {
        return options.map(([value, text]) => {
            const option = doc.createElement('option');
            option.value = value;
            option.textContent = text;
            return option;
        });
    }

    private select(doc: Document, label: string, options: Array<[string, string]>): HTMLSelectElement {
        const select = doc.createElement('select');
        select.className = 'b3-select';
        select.title = label;
        select.setAttribute('aria-label', label);
        select.replaceChildren(...this.options(doc, options));
        return select;
    }

    private dateInput(doc: Document, label: string): HTMLInputElement {
        const input = doc.createElement('input');
        input.type = 'date';
        input.className = 'b3-text-field';
        input.title = label;
        input.setAttribute('aria-label', label);
        return input;
    }

    private button(doc: Document, icon: string, label: string): HTMLButtonElement {
        const button = doc.createElement('button');
        button.type = 'button';
        button.className = 'b3-button b3-button--text';
        button.title = label;
        button.setAttribute('aria-label', label);
        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('aria-hidden', 'true');
        const use = doc.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#' + icon);
        svg.append(use);
        button.append(svg);
        return button;
    }

    private report(error: unknown): void {
        showMessage(error instanceof Error ? error.message : i18n('loadFailed'), 5000, 'error');
    }
}
