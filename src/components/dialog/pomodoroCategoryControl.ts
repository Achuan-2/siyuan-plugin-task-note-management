import { Dialog, confirm, showMessage } from 'siyuan';
import { i18n } from '../../pluginInstance';
import { changePomodoroCategories, loadPomodoroCategories, type PomodoroCategory } from '../../utils/pomodoroCategories';

export function escapePomodoroCategoryText(value: string): string {
    return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export function renderPomodoroCategoryBadge(id: string | undefined, categories: PomodoroCategory[]): string {
    const category = categories.find(item => item.id === id);
    const color = category?.color || '#888888';
    return `<span class="pomodoro-category-badge" style="display:inline-flex;align-items:center;gap:4px;border:1px solid ${color};background:${color}18;color:var(--b3-theme-on-surface);border-radius:4px;padding:1px 5px;margin-top:4px;font-size:12px;"><span aria-hidden="true" style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;"></span>${escapePomodoroCategoryText(category?.name || i18n('uncategorized'))}</span>`;
}

/** Keep text in the theme foreground; use the category as an accent and a subtle surface tint. */
export function getPomodoroCategoryRecordStyle(id: string | undefined, categories: PomodoroCategory[]): string {
    const color = categories.find(category => category.id === id)?.color;
    return color ? `--pomodoro-record-category-color:${color};--pomodoro-record-category-border:4px solid ${color};--pomodoro-record-background:color-mix(in srgb, ${color} 10%, var(--b3-theme-surface));` : '';
}

export function showPomodoroCategoryManager(plugin: any): Promise<void> {
    return new Promise(resolve => {
        const dialog = new Dialog({
            title: i18n('pomodoroManageCategories'), width: '480px',
            content: '<div class="b3-dialog__content"><div class="pomodoro-category-list"></div><div class="pomodoro-category-add" style="display:flex;gap:8px;margin-top:12px"></div></div>',
            destroyCallback: () => resolve(),
        });
        const list = dialog.element.querySelector('.pomodoro-category-list') as HTMLElement;
        const addRow = dialog.element.querySelector('.pomodoro-category-add') as HTMLElement;
        let busy = false;
        const perform = async (operation: () => Promise<unknown>) => {
            if (busy) return;
            busy = true;
            try { await operation(); await render(); }
            catch (error) { console.error('Failed to save pomodoro category:', error); showMessage(i18n('operationFailed'), 3000, 'error'); }
            finally { busy = false; }
        };
        const input = (value: string, color = false) => {
            const element = document.createElement('input');
            element.type = color ? 'color' : 'text'; element.value = value;
            element.className = 'b3-text-field'; element.style.cssText = color ? 'width:48px;padding:2px' : 'min-width:0;flex:1';
            element.setAttribute('aria-label', i18n(color ? 'pomodoroCategoryColor' : 'pomodoroCategoryName'));
            return element;
        };
        const button = (text: string, click: () => void) => {
            const element = document.createElement('button'); element.className = 'b3-button b3-button--outline';
            element.textContent = text; element.addEventListener('click', click); return element;
        };
        const render = async () => {
            const categories = await loadPomodoroCategories(plugin);
            list.replaceChildren();
            for (const category of categories) {
                const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
                const name = input(category.name), color = input(category.color, true);
                row.append(name, color, button(i18n('save'), () => {
                    if (!name.value.trim()) { name.focus(); return; }
                    void perform(() => changePomodoroCategories(plugin, items => items.map(item => item.id === category.id
                        ? { ...item, name: name.value.trim(), color: color.value } : item)));
                }), button(i18n('delete'), () => confirm(i18n('delete'), i18n('pomodoroDeleteCategoryConfirm'),
                    () => { void perform(() => changePomodoroCategories(plugin, items => items.filter(item => item.id !== category.id))); })));
                list.appendChild(row);
            }
        };
        const name = input(''), color = input('#3498db', true);
        name.placeholder = i18n('pomodoroCategoryName');
        addRow.append(name, color, button(i18n('pomodoroAddCategory'), () => {
            if (!name.value.trim()) { name.focus(); return; }
            void perform(async () => {
                await changePomodoroCategories(plugin, items => [...items, {
                    id: `pc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
                    name: name.value.trim(), color: color.value,
                }]);
                name.value = '';
            });
        }));
        void render().catch(error => { console.error(error); showMessage(i18n('loadFailed'), 3000, 'error'); });
    });
}

/** Shared single-select editor for manual entry, record editing, and the timer. */
export function mountPomodoroCategoryControl(anchor: HTMLElement, plugin: any, initialId?: string) {
    const host = document.createElement('div'); host.className = 'b3-form__group';
    const label = document.createElement('label'); label.className = 'b3-form__label'; label.textContent = i18n('pomodoroCategory');
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px';
    const select = document.createElement('select'); select.className = 'b3-select'; select.style.cssText = 'flex:1;min-width:0';
    select.setAttribute('aria-label', i18n('pomodoroCategory'));
    const manage = document.createElement('button'); manage.className = 'b3-button b3-button--outline';
    manage.textContent = i18n('pomodoroManageCategories');
    host.append(label, row); row.append(select, manage); anchor.after(host);
    const reload = async (id: string | undefined) => {
        const categories = await loadPomodoroCategories(plugin);
        select.replaceChildren();
        for (const category of [{ id: '', name: i18n('uncategorized') }, ...categories]) {
            const option = document.createElement('option'); option.value = category.id; option.textContent = category.name;
            select.appendChild(option);
        }
        select.value = categories.some(category => category.id === id) ? id : '';
    };
    const ready = reload(initialId);
    void ready.catch(error => { console.error(error); showMessage(i18n('loadFailed'), 3000, 'error'); });
    manage.addEventListener('click', () => {
        void showPomodoroCategoryManager(plugin).then(() => reload(select.value)).catch(error => { console.error(error); showMessage(i18n('loadFailed'), 3000, 'error'); });
    });
    return { ready, async value() { await ready; return select.value || undefined; } };
}
