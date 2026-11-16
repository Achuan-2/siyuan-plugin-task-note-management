import { showMessage } from 'siyuan';
import { i18n } from '../../pluginInstance';
import { getLogicalDateString } from '../../utils/dateUtils';
import { getEnvironmentSafeAllReminders } from '../../utils/reminderLoadUtils';
import { ReminderTaskLogic } from '../../utils/reminderTaskLogic';

export function getUncompletedPomodoroTasks(data: any, today: string, settings?: any, holidays?: any): any[] {
    const tasks = ReminderTaskLogic.generateAllRemindersWithInstances(data, today, settings, holidays);
    return tasks.filter(task => task?.id && !task.completed &&
        task.kanbanStatus !== 'completed' && task.kanbanStatus !== 'abandoned')
        .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') ||
            String(a.title || '').localeCompare(String(b.title || '')));
}

export async function mountPomodoroTaskPicker(container: HTMLElement, plugin: any,
    onSelected: (task: any) => Promise<void>): Promise<void> {
    container.replaceChildren();
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'b3-text-field';
    search.placeholder = i18n('searchTasks');
    search.setAttribute('aria-label', i18n('searchTasks'));
    search.style.cssText = 'width:100%;margin-bottom:12px';
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    container.append(search, list);
    let tasks: any[] = [];
    let projects: any = {};
    let busy = false;
    const loadTasks = async () => {
        const [data, settings, holidays] = await Promise.all([
            getEnvironmentSafeAllReminders(plugin), plugin.loadSettings?.(), plugin.loadHolidayData?.()
        ]);
        return getUncompletedPomodoroTasks(data, getLogicalDateString(), settings, holidays);
    };
    const render = () => {
        list.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        const matches = tasks.filter(task => [task.title, projects[task.projectId]?.name, task.date]
            .some(value => String(value || '').toLocaleLowerCase().includes(query)));
        if (!matches.length) {
            list.textContent = i18n('noAllUncompletedReminders');
            return;
        }
        for (const task of matches) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'b3-button b3-button--outline';
            row.disabled = busy;
            row.style.cssText = 'display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:left;padding:10px;white-space:normal';
            const title = document.createElement('span');
            title.textContent = task.title || i18n('untitledTask');
            title.style.cssText = 'overflow-wrap:anywhere';
            const meta = document.createElement('span');
            meta.textContent = [projects[task.projectId]?.name, task.date, task.time].filter(Boolean).join(' · ');
            meta.style.cssText = 'font-size:11px;color:var(--b3-theme-on-surface-light)';
            row.append(title, meta);
            row.addEventListener('click', async () => {
                if (busy) return;
                busy = true;
                search.disabled = true;
                render();
                try {
                    const latest = await loadTasks();
                    if (!container.isConnected) return;
                    const selected = latest.find(item => item.id === task.id);
                    if (!selected) {
                        tasks = latest;
                        showMessage(i18n('pomodoroTaskUnavailable'), 3000);
                        return;
                    }
                    await onSelected(selected);
                } catch (error) {
                    console.error('Failed to bind pomodoro task:', error);
                    showMessage(i18n('operationFailed'), 3000, 'error');
                } finally {
                    busy = false;
                    search.disabled = false;
                    if (container.isConnected) render();
                }
            });
            list.appendChild(row);
        }
    };
    search.addEventListener('input', render);
    list.textContent = i18n('loading');
    try {
        [tasks, projects] = await Promise.all([loadTasks(), plugin.loadProjectData?.() || {}]);
        projects ||= {};
        if (container.isConnected) render();
    } catch (error) {
        console.error('Failed to load pomodoro task picker:', error);
        if (container.isConnected) list.textContent = i18n('loadingFailed');
        throw error;
    }
}
