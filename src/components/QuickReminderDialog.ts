import { showMessage, Dialog } from "siyuan";
import { getBlockByID, getBlockDOM, refreshSql, updateBindBlockAtrrs, updateBlock } from "../api";
import { compareDateStrings, getLogicalDateString, parseNaturalDateTime, autoDetectDateTimeFromTitle } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { i18n } from "../pluginInstance";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { BlockBindingDialog } from "./BlockBindingDialog";
import { SubtasksDialog } from "./SubtasksDialog";
import { PomodoroRecordManager } from "../utils/pomodoroRecord";
import { PomodoroSessionsDialog } from "./PomodoroSessionsDialog";
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, prosePluginsCtx, parserCtx } from "@milkdown/kit/core";
import { Plugin } from "@milkdown/prose/state";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { replaceAll, $view } from "@milkdown/utils";
import { listItemSchema } from "@milkdown/kit/preset/commonmark";

export class QuickReminderDialog {
    private dialog: Dialog;
    private editor?: Editor;
    private currentNote: string = '';
    private blockId?: string;
    private reminder?: any;
    private onSaved?: (modifiedReminder?: any) => void;
    private mode: 'quick' | 'block' | 'edit' | 'batch_edit' | 'note' = 'quick'; // 模式：快速创建、块绑定创建、编辑、批量编辑、仅备注

    private findMarkRange(doc: any, pos: number, type: any) {
        let $pos = doc.resolve(pos);
        let from = pos;
        let to = pos;

        // 向前找
        while (from > $pos.start() && type.isInSet(doc.nodeAt(from - 1)?.marks || [])) {
            from--;
        }
        // 向后找
        while (to < $pos.end() && type.isInSet(doc.nodeAt(to)?.marks || [])) {
            to++;
        }
        return { from, to };
    }

    private showLinkOptions(view: any, pos: number, mark: any) {
        const dialog = new Dialog({
            title: i18n('linkOptions') || '链接选项',
            content: `
                <div class="b3-dialog__content" style="display: flex; flex-direction: column; gap: 12px; padding: 16px;">
                    <div style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; color: var(--b3-theme-primary);">
                        ${mark.attrs.href}
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="b3-button b3-button--outline" id="jumpBtn" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            <svg style="width: 14px; height: 14px;"><use xlink:href="#iconLink"></use></svg>
                            ${i18n('jump') || '打开链接'}
                        </button>
                        <button class="b3-button b3-button--outline" id="editLinkBtn" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            <svg style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>
                            ${i18n('edit') || '编辑'}
                        </button>
                        <button class="b3-button b3-button--cancel" id="removeLinkBtn" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 4px;">
                            <svg style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                            ${i18n('remove') || '取消链接'}
                        </button>
                    </div>
                </div>
            `,
            width: "400px"
        });

        const jumpBtn = dialog.element.querySelector('#jumpBtn') as HTMLButtonElement;
        const editLinkBtn = dialog.element.querySelector('#editLinkBtn') as HTMLButtonElement;
        const removeLinkBtn = dialog.element.querySelector('#removeLinkBtn') as HTMLButtonElement;

        jumpBtn.onclick = () => {
            window.open(mark.attrs.href, '_blank');
            dialog.destroy();
        };

        editLinkBtn.onclick = () => {
            dialog.destroy();
            this.showLinkEditor(view, pos, mark);
        };

        removeLinkBtn.onclick = () => {
            const { tr } = view.state;
            const range = this.findMarkRange(view.state.doc, pos, view.state.schema.marks.link);
            if (range) {
                view.dispatch(tr.removeMark(range.from, range.to, view.state.schema.marks.link));
            }
            dialog.destroy();
        };
    }

    private showLinkEditor(view: any, pos: number, mark: any) {
        const range = this.findMarkRange(view.state.doc, pos, view.state.schema.marks.link);
        const currentText = range ? view.state.doc.textBetween(range.from, range.to) : '';

        const dialog = new Dialog({
            title: i18n('editLink') || '编辑链接',
            content: `
                <div class="b3-dialog__content" style="padding: 16px;">
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8;">${i18n('linkUrl') || '链接地址'}:</label>
                        <textarea id="linkUrl" class="b3-text-field" style="width: 100%; resize: vertical;" rows="2" placeholder="https://...">${mark.attrs.href}</textarea>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8;">${i18n('linkTitle') || '显示文本'}:</label>
                        <textarea id="linkTitle" class="b3-text-field" style="width: 100%; resize: vertical;" rows="2" placeholder="${i18n('linkTitlePlaceholder') || '输入链接文本'}">${currentText}</textarea>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelLinkBtn">${i18n('cancel') || '取消'}</button>
                    <button class="b3-button b3-button--primary" id="saveLinkBtn">${i18n('save') || '确定'}</button>
                </div>
            `,
            width: "400px"
        });

        const urlInput = dialog.element.querySelector('#linkUrl') as HTMLInputElement;
        const titleInput = dialog.element.querySelector('#linkTitle') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#cancelLinkBtn') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#saveLinkBtn') as HTMLButtonElement;

        urlInput.focus();

        cancelBtn.onclick = () => dialog.destroy();
        saveBtn.onclick = () => {
            const newHref = urlInput.value.trim();
            const newTitle = titleInput.value.trim();
            if (newHref && range) {
                const { tr, schema } = view.state;
                const linkMark = schema.marks.link.create({ href: newHref });

                // Replace text and apply mark
                view.dispatch(
                    tr.replaceWith(range.from, range.to, schema.text(newTitle || newHref))
                        .addMark(range.from, range.from + (newTitle || newHref).length, linkMark)
                );
            }
            dialog.destroy();
        };
    }
    private blockContent: string = '';
    private reminderUpdatedHandler: () => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private currentSort: string = 'time';
    private repeatConfig: RepeatConfig;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private pomodoroRecordManager: PomodoroRecordManager;
    private autoDetectDateTime?: boolean; // 是否自动识别日期时间（undefined 表示未指定，使用插件设置）
    private defaultProjectId?: string;
    private showKanbanStatus?: 'todo' | 'term' | 'none' = 'term'; // 看板状态显示模式，默认为 'term'
    private defaultStatus?: 'short_term' | 'long_term' | 'doing' | 'todo'; // 默认任务状态
    private defaultCustomGroupId?: string | null;
    private defaultMilestoneId?: string;
    private defaultCustomReminderTime?: string;
    private isTimeRange: boolean = false;
    private initialDate: string;
    private initialTime?: string;
    private initialEndDate?: string;
    private initialEndTime?: string;
    private defaultQuadrant?: string;
    private defaultTitle?: string;
    private defaultNote?: string;
    private defaultCategoryId?: string;
    private defaultPriority?: string;
    private defaultBlockId?: string;
    private defaultParentId?: string;
    private plugin?: any; // 插件实例
    private customTimes: Array<{ time: string, note?: string }> = []; // 自定义提醒时间列表
    private selectedTagIds: string[] = []; // 当前选中的标签ID列表
    private isInstanceEdit: boolean = false;
    private instanceDate?: string;
    private defaultSort?: number;
    private hideProjectSelector: boolean = false;
    private existingReminders: any[] = [];
    private selectedCategoryIds: string[] = [];
    private currentKanbanStatuses: import('../utils/projectManager').KanbanStatus[] = []; // 当前项目的kanbanStatuses
    private durationManuallyChanged: boolean = false; // 标记用户是否手动修改了持续天数
    private tempSubtasks: any[] = []; // 新建模式下的临时子任务列表
    private skipSave: boolean = false; // 是否跳过保存到数据库（用于临时子任务创建）


    constructor(
        date?: string,
        time?: string,
        callback?: (reminder: any) => void,
        timeRangeOptions?: { isTimeRange: boolean; endDate?: string; endTime?: string },
        options?: {
            blockId?: string;
            reminder?: any;
            onSaved?: (modifiedReminder?: any) => void;
            mode?: 'quick' | 'block' | 'edit' | 'batch_edit' | 'note';
            autoDetectDateTime?: boolean;
            defaultProjectId?: string;
            showKanbanStatus?: 'todo' | 'term' | 'none';
            defaultStatus?: 'short_term' | 'long_term' | 'doing' | 'todo';
            defaultCustomGroupId?: string | null;
            defaultMilestoneId?: string;
            defaultCustomReminderTime?: string;
            plugin?: any;
            hideProjectSelector?: boolean;
            defaultQuadrant?: string;
            defaultTitle?: string;
            defaultNote?: string;
            defaultCategoryId?: string;
            defaultPriority?: string;
            defaultBlockId?: string;
            defaultParentId?: string;
            isInstanceEdit?: boolean;
            instanceDate?: string;
            defaultSort?: number;
            skipSave?: boolean; // 是否跳过保存到数据库
        }
    ) {
        this.initialDate = date;
        this.initialTime = time;
        this.isTimeRange = timeRangeOptions?.isTimeRange || false;
        this.initialEndDate = timeRangeOptions?.endDate;
        this.initialEndTime = timeRangeOptions?.endTime;
        this.onSaved = callback;

        // 处理额外选项
        if (options) {
            this.blockId = options.blockId;
            this.reminder = options.reminder;
            if (options.onSaved) this.onSaved = options.onSaved;
            this.mode = options.mode || 'quick';
            this.autoDetectDateTime = options.autoDetectDateTime;
            this.defaultProjectId = options.defaultProjectId ?? options.reminder?.projectId;
            this.showKanbanStatus = options.showKanbanStatus || 'term';
            this.defaultStatus = options.defaultStatus || 'doing';
            this.defaultCustomGroupId = options.defaultCustomGroupId !== undefined ? options.defaultCustomGroupId : options.reminder?.customGroupId;
            this.defaultMilestoneId = options.defaultMilestoneId !== undefined ? options.defaultMilestoneId : options.reminder?.milestoneId;
            this.defaultCustomReminderTime = options.defaultCustomReminderTime;
            this.plugin = options.plugin;
            this.hideProjectSelector = options.hideProjectSelector;
            this.defaultQuadrant = options.defaultQuadrant;
            this.defaultTitle = options.defaultTitle;
            this.defaultNote = options.defaultNote;
            this.defaultCategoryId = options.defaultCategoryId;
            this.defaultPriority = options.defaultPriority;
            this.defaultBlockId = options.defaultBlockId || options.blockId; // 如果传入了blockId，也设置为默认块ID
            this.defaultParentId = options.defaultParentId;
            this.isInstanceEdit = options.isInstanceEdit || false;
            this.instanceDate = options.instanceDate;
            this.defaultSort = options.defaultSort;
            this.skipSave = options.skipSave || false;
        }

        // 如果是编辑模式，确保有reminder
        if (this.mode === 'edit' && !this.reminder) {
            throw new Error('编辑模式需要提供reminder参数');
        }

        // 如果是块绑定模式，确保有blockId
        if (this.mode === 'block' && !this.blockId) {
            throw new Error('块绑定模式需要提供blockId参数');
        }

        // 如果是批量编辑模式，设置块内容
        if (this.mode === 'batch_edit' && this.reminder) {
            this.blockContent = this.reminder.content || '';
        }

        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.projectManager = ProjectManager.getInstance(this.plugin);
        this.pomodoroRecordManager = PomodoroRecordManager.getInstance(this.plugin);
        this.repeatConfig = this.reminder?.repeat || {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

        // 创建事件处理器
        this.reminderUpdatedHandler = () => {
            // 重新加载现有提醒列表（仅块绑定模式）
            if (this.mode === 'block') {
                this.loadExistingReminder();
            }
            // 更新番茄钟显示（所有模式）
            if (this.reminder) {
                this.updatePomodorosDisplay();
            }
        };

        this.sortConfigUpdatedHandler = (event: CustomEvent) => {
            const { sortMethod } = event.detail;
            if (sortMethod !== this.currentSort) {
                this.currentSort = sortMethod;
                if (this.mode === 'block') {
                    this.loadExistingReminder(); // 重新排序现有提醒
                }
            }
        };


    }


    // 加载现有提醒列表（块绑定模式）
    private async loadExistingReminder() {
        if (this.mode !== 'block' || !this.blockId) return;

        try {
            const reminderData = await this.plugin.loadReminderData();
            const blockReminders = Object.values(reminderData).filter((reminder: any) =>
                reminder.blockId === this.blockId
            ) as any[];

            // 排序提醒
            this.existingReminders = this.sortReminders(blockReminders, this.currentSort);

            // 渲染现有提醒列表
            this.renderExistingReminders();
        } catch (error) {
            console.error('加载现有提醒失败:', error);
        }
    }

    // 排序提醒
    private sortReminders(reminders: any[], sortMethod: string): any[] {
        return reminders.sort((a, b) => {
            switch (sortMethod) {
                case 'time':
                    // 按时间排序（有时间的优先，然后按时间先后）
                    const aHasTime = a.date && (a.time || a.customReminderTime);
                    const bHasTime = b.date && (b.time || b.customReminderTime);
                    if (aHasTime && !bHasTime) return -1;
                    if (!aHasTime && bHasTime) return 1;

                    if (aHasTime && bHasTime) {
                        const aTime = a.customReminderTime || a.time || '23:59';
                        const bTime = b.customReminderTime || b.time || '23:59';
                        const aDateTime = `${a.date}T${aTime}`;
                        const bDateTime = `${b.date}T${bTime}`;
                        return new Date(aDateTime).getTime() - new Date(bDateTime).getTime();
                    }

                    // 都没有时间，按创建时间排序
                    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

                case 'priority':
                    // 按优先级排序
                    const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                    const aPriority = priorityOrder[a.priority] || 0;
                    const bPriority = priorityOrder[b.priority] || 0;
                    if (aPriority !== bPriority) {
                        return bPriority - aPriority; // 高优先级在前
                    }
                    // 优先级相同时按时间排序
                    return this.sortReminders([a, b], 'time')[0] === a ? -1 : 1;

                case 'category':
                    // 按分类排序
                    const aCategory = a.categoryId || '';
                    const bCategory = b.categoryId || '';
                    if (aCategory !== bCategory) {
                        return aCategory.localeCompare(bCategory);
                    }
                    // 分类相同时按时间排序
                    return this.sortReminders([a, b], 'time')[0] === a ? -1 : 1;

                default:
                    return 0;
            }
        });
    }

    // 渲染现有提醒列表
    private renderExistingReminders() {
        // 在块绑定模式下，在对话框顶部添加现有提醒列表
        if (this.mode !== 'block') return;

        const contentElement = this.dialog.element.querySelector('.b3-dialog__content');
        if (!contentElement) return;

        // 检查是否已有现有提醒容器
        let existingContainer = contentElement.querySelector('.existing-reminders-container') as HTMLElement;
        if (!existingContainer) {
            existingContainer = document.createElement('div');
            existingContainer.className = 'existing-reminders-container';
            existingContainer.style.cssText = `
                margin-bottom: 16px;
                padding: 12px;
                background: var(--b3-theme-background-light);
                border-radius: 6px;
                border: 1px solid var(--b3-theme-surface-lighter);
            `;

            // 在标题输入框之前插入
            const titleGroup = contentElement.querySelector('.b3-form__group');
            if (titleGroup) {
                contentElement.insertBefore(existingContainer, titleGroup);
            }
        }

        if (this.existingReminders.length === 0) {
            existingContainer.innerHTML = `
                <div style="color: var(--b3-theme-on-surface-light); font-size: 14px;">
                    📝 此块暂无绑定提醒
                </div>
            `;
            return;
        }

        existingContainer.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div style="font-weight: 500; color: var(--b3-theme-on-surface);">📋 已绑定提醒 (${this.existingReminders.length})</div>
                <div class="sort-controls" style="display: flex; gap: 4px;">
                    <button class="b3-button b3-button--outline" data-sort="time" style="padding: 2px 8px; font-size: 12px;">时间</button>
                    <button class="b3-button b3-button--outline" data-sort="priority" style="padding: 2px 8px; font-size: 12px;">优先级</button>
                    <button class="b3-button b3-button--outline" data-sort="category" style="padding: 2px 8px; font-size: 12px;">分类</button>
                </div>
            </div>
            <div class="existing-reminders-list" style="max-height: 200px; overflow-y: auto;">
                ${this.existingReminders.map(reminder => this.renderReminderItem(reminder)).join('')}
            </div>
        `;

        // 绑定排序按钮事件
        const sortButtons = existingContainer.querySelectorAll('.sort-controls button');
        sortButtons.forEach(button => {
            button.addEventListener('click', () => {
                const sortMethod = button.getAttribute('data-sort');
                if (sortMethod) {
                    this.currentSort = sortMethod;
                    this.existingReminders = this.sortReminders(this.existingReminders, sortMethod);
                    this.renderExistingReminders();

                    // 更新按钮状态
                    sortButtons.forEach(btn => btn.classList.remove('b3-button--primary'));
                    button.classList.add('b3-button--primary');
                }
            });
        });

        // 设置当前排序按钮为激活状态
        const currentSortButton = existingContainer.querySelector(`[data-sort="${this.currentSort}"]`) as HTMLElement;
        if (currentSortButton) {
            currentSortButton.classList.add('b3-button--primary');
        }
    }

    // 渲染单个提醒项
    private renderReminderItem(reminder: any): string {
        const dateTimeStr = this.formatReminderDateTime(reminder);
        const priorityIcon = this.getPriorityIcon(reminder.priority);
        const categoryInfo = reminder.categoryId ? this.categoryManager.getCategoryById(reminder.categoryId) : null;
        const categoryStr = categoryInfo ? `<span style="background: ${categoryInfo.color}; color: white; padding: 1px 4px; border-radius: 3px; font-size: 11px;">${categoryInfo.icon || ''} ${categoryInfo.name}</span>` : '';

        return `
            <div class="reminder-item" data-id="${reminder.id}" style="
                display: flex;
                align-items: center;
                padding: 6px 8px;
                margin-bottom: 4px;
                background: var(--b3-theme-surface);
                border-radius: 4px;
                border: 1px solid var(--b3-theme-surface-lighter);
                cursor: pointer;
                transition: all 0.2s;
            ">
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 500; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${priorityIcon} ${reminder.title}
                    </div>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); display: flex; align-items: center; gap: 8px;">
                        ${dateTimeStr ? `<span>🕐 ${dateTimeStr}</span>` : ''}
                        ${categoryStr}
                        ${reminder.repeat ? `<span>🔄 ${getRepeatDescription(reminder.repeat)}</span>` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="b3-button b3-button--outline" data-action="edit" style="padding: 2px 6px; font-size: 11px;">编辑</button>
                    <button class="b3-button b3-button--outline" data-action="delete" style="padding: 2px 6px; font-size: 11px;">删除</button>
                </div>
            </div>
        `;
    }

    // 格式化提醒日期时间显示
    private formatReminderDateTime(reminder: any): string {
        // 优先使用 customReminderTime（可能为时间或完整的 datetime-local），其次使用 reminder.time 或 reminder.date
        const custom = reminder.customReminderTime;
        const baseDate = reminder.date;

        if (!custom && !baseDate) return '';

        if (custom) {
            // 支持两种格式：
            // - 仅时间，例如 "14:30"（历史兼容）
            // - datetime-local，例如 "2025-11-27T14:30"
            if (typeof custom === 'string' && custom.includes('T')) {
                const [d, t] = custom.split('T');
                return `${d} ${t}`;
            } else if (baseDate) {
                return `${baseDate} ${custom}`;
            } else {
                return custom;
            }
        }

        return baseDate || '';
    }

    // 获取优先级图标
    private getPriorityIcon(priority: string): string {
        switch (priority) {
            case 'high': return '🔴';
            case 'medium': return '🟡';
            case 'low': return '🔵';
            default: return '⚪';
        }
    }

    // 辅助：在 YYYY-MM-DD 字符串上加天数（返回 YYYY-MM-DD）
    private addDaysToDate(dateStr: string, days: number): string {
        if (!dateStr) return dateStr;
        const parts = dateStr.split('-').map(n => parseInt(n, 10));
        if (parts.length !== 3 || isNaN(parts[0])) return dateStr;
        const base = new Date(parts[0], parts[1] - 1, parts[2]);
        base.setDate(base.getDate() + days);
        const year = base.getFullYear();
        const month = String(base.getMonth() + 1).padStart(2, '0');
        const day = String(base.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // 自动调整textarea高度以适应内容
    private autoResizeTextarea(textarea: HTMLTextAreaElement) {
        // 先重置高度以获取准确的scrollHeight
        textarea.style.height = 'auto';
        // 计算新高度：取内容高度和最大高度之间的较小值
        const maxHeight = 200; // 与CSS中的max-height保持一致
        const newHeight = Math.min(textarea.scrollHeight, maxHeight);
        textarea.style.height = newHeight + 'px';
    }

    // 辅助：计算包含首尾的持续天数（如果 end < start 返回 0）
    private getDurationInclusive(start: string, end: string): number {
        if (!start || !end) return 0;
        const sp = start.split('-').map(n => parseInt(n, 10));
        const ep = end.split('-').map(n => parseInt(n, 10));
        if (sp.length !== 3 || ep.length !== 3) return 0;
        const s = new Date(sp[0], sp[1] - 1, sp[2]);
        const e = new Date(ep[0], ep[1] - 1, ep[2]);
        const diffDays = Math.round((e.getTime() - s.getTime()) / (24 * 3600 * 1000));
        if (diffDays < 0) return 0;
        return diffDays + 1;
    }

    // 填充编辑表单数据
    private async populateEditForm() {
        if (!this.reminder) return;

        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;
        const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        const urlInput = this.dialog.element.querySelector('#quickUrlInput') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLInputElement;

        // 填充每日可做
        const isAvailableTodayCheckbox = this.dialog.element.querySelector('#quickIsAvailableToday') as HTMLInputElement;
        const availableStartDateInput = this.dialog.element.querySelector('#quickAvailableStartDate') as HTMLInputElement;
        const availableDateGroup = this.dialog.element.querySelector('#quickAvailableDateGroup') as HTMLElement;

        if (isAvailableTodayCheckbox && this.reminder.isAvailableToday) {
            isAvailableTodayCheckbox.checked = true;
            if (availableDateGroup) availableDateGroup.style.display = 'block';
        }
        if (availableStartDateInput && this.reminder.availableStartDate) {
            availableStartDateInput.value = this.reminder.availableStartDate;
        } else if (availableStartDateInput) {
            availableStartDateInput.value = getLogicalDateString();
        }

        // 填充不在日历视图显示
        const hideInCalendarCheckbox = this.dialog.element.querySelector('#quickHideInCalendar') as HTMLInputElement;
        if (hideInCalendarCheckbox && this.reminder.hideInCalendar) {
            hideInCalendarCheckbox.checked = true;
        }

        // 填充标题
        if (titleInput && this.reminder.title) {
            titleInput.value = this.reminder.title;
            // 将光标移到开头，显示开头的字
            titleInput.setSelectionRange(0, 0);
            // 自动调整高度
            this.autoResizeTextarea(titleInput);
        }

        // 填充块ID
        if (blockInput && this.reminder.blockId) {
            blockInput.value = this.reminder.blockId;
        }

        // 填充URL
        if (urlInput && this.reminder.url) {
            urlInput.value = this.reminder.url;
        }

        // 填充备注
        // noteInput is now a div for Vditor, handled in Vditor initialization
        // if (noteInput && this.reminder.note) {
        //     noteInput.value = this.reminder.note;
        // }

        // 填充自定义提醒时间（兼容旧格式：仅时间 和 新格式：datetime-local）
        // 优先使用 reminderTimes
        if (this.reminder.reminderTimes && Array.isArray(this.reminder.reminderTimes)) {
            this.customTimes = this.reminder.reminderTimes.map((item: any) => {
                if (typeof item === 'string') {
                    return { time: item, note: '' };
                }
                return item;
            }).filter((item: any) => item && item.time); // 过滤掉无效项
        } else if (this.reminder.customReminderTime) {
            // 兼容旧字段
            let val = this.reminder.customReminderTime;
            if (typeof val === 'string' && val.includes('T')) {
                this.customTimes.push({ time: val, note: '' });
            } else if (typeof val === 'string' && this.reminder.date) {
                this.customTimes.push({ time: `${this.reminder.date}T${val}`, note: '' });
            } else if (typeof val === 'string') {
                const today = getLogicalDateString();
                this.customTimes.push({ time: `${today}T${val}`, note: '' });
            }
        }
        this.renderCustomTimeList();

        // 设置预设下拉的当前值（编辑时显示之前选择的预设）
        try {
            const presetSelect = this.dialog.element.querySelector('#quickCustomReminderPreset') as HTMLSelectElement;
            if (presetSelect && this.reminder.customReminderPreset) {
                presetSelect.value = this.reminder.customReminderPreset;
            }
        } catch (e) {
            // ignore
        }

        // 填充预计番茄时长
        const estimatedPomodoroDurationInput = this.dialog.element.querySelector('#quickEstimatedPomodoroDuration') as HTMLInputElement;
        if (estimatedPomodoroDurationInput && this.reminder.estimatedPomodoroDuration) {
            estimatedPomodoroDurationInput.value = this.reminder.estimatedPomodoroDuration;
        }

        // 填充日期和时间（使用独立的日期和时间输入框）
        // 始终填充 time（支持只有 time 而无 date 的子任务/模板）
        if (this.reminder.date) {
            dateInput.value = this.reminder.date;
        }

        // 如果 reminder 中包含 time，则无论是否有 date 都应显示（修复 ghost 子任务在编辑系列时不显示时间的问题）
        if (this.reminder.time && timeInput) {
            timeInput.value = this.reminder.time;
        }

        // 结束时间/日期也按存在与否分别填充
        if (this.reminder.endDate && endDateInput) {
            endDateInput.value = this.reminder.endDate;
        }
        if (this.reminder.endTime && endTimeInput) {
            endTimeInput.value = this.reminder.endTime;
        }

        // 填充持续天数（如果有起止日期则计算）
        const durationInput = this.dialog.element.querySelector('#quickDurationDays') as HTMLInputElement;
        if (durationInput) {
            if (dateInput.value && endDateInput.value) {
                const dur = this.getDurationInclusive(dateInput.value, endDateInput.value);
                durationInput.value = String(dur > 0 ? dur : 1);
            } else {
                durationInput.value = '1';
            }
        }

        // 填充项目 
        if (projectSelector && this.reminder.projectId) {
            projectSelector.value = this.reminder.projectId;

            // 更新搜索框显示文本
            const searchInput = this.dialog.element.querySelector('#quickProjectSearchInput') as HTMLInputElement;
            const dropdown = this.dialog.element.querySelector('#quickProjectDropdown');
            if (searchInput && dropdown) {
                const item = dropdown.querySelector(`.b3-menu__item[data-value="${this.reminder.projectId}"]`);
                if (item) {
                    searchInput.value = item.getAttribute('data-label') || '';
                }
            }

            // 触发项目选择事件以加载自定义分组
            await this.onProjectChange(this.reminder.projectId);
        }

        // 填充自定义分组 (已经在 onProjectChange -> renderCustomGroupSelector 中通过 defaultCustomGroupId 处理)

        // 填充里程碑
        if (this.reminder.projectId) {
            await this.renderMilestoneSelector(this.reminder.projectId, this.reminder.customGroupId);
        }


        // 填充重复设置
        if (this.reminder.repeat) {
            this.repeatConfig = this.reminder.repeat;
            this.updateRepeatDescription();
        }

        // 初始化选中的标签ID列表
        if (this.reminder.tagIds && Array.isArray(this.reminder.tagIds)) {
            this.selectedTagIds = [...this.reminder.tagIds];
        }

        // 等待渲染完成后设置分类、优先级和任务状态
        setTimeout(() => {
            // 填充分类
            // 填充分类
            if (this.reminder.categoryId) {
                // 初始化 selectedCategoryIds
                this.selectedCategoryIds = typeof this.reminder.categoryId === 'string'
                    ? this.reminder.categoryId.split(',').filter((id: string) => id.trim())
                    : [this.reminder.categoryId];

                const categoryOptions = this.dialog.element.querySelectorAll('.category-option');
                categoryOptions.forEach(option => {
                    const id = option.getAttribute('data-category');
                    if (id && this.selectedCategoryIds.includes(id)) {
                        option.classList.add('selected');
                    } else {
                        option.classList.remove('selected');
                    }
                });
                // 如果有选中项，确保无分类未选中
                if (this.selectedCategoryIds.length > 0) {
                    const noCat = this.dialog.element.querySelector('.category-option[data-category=""]');
                    if (noCat) noCat.classList.remove('selected');
                }
            }

            // 填充优先级
            if (this.reminder.priority) {
                const priorityOptions = this.dialog.element.querySelectorAll('.priority-option');
                priorityOptions.forEach(option => {
                    if (option.getAttribute('data-priority') === this.reminder.priority) {
                        option.classList.add('selected');
                    } else {
                        option.classList.remove('selected');
                    }
                });
            }

            // 填充任务状态（使用kanbanStatus）
            if (this.reminder.kanbanStatus) {
                // 延迟一下确保选择器已渲染
                setTimeout(() => {
                    this.updateKanbanStatusSelector();
                    const statusOptions = this.dialog.element.querySelectorAll('.task-status-option');
                    const targetStatus = this.reminder.kanbanStatus;

                    statusOptions.forEach(option => {
                        if (option.getAttribute('data-status-type') === targetStatus) {
                            option.classList.add('selected');
                            const status = this.currentKanbanStatuses.find(s => s.id === targetStatus);
                            if (status) {
                                (option as HTMLElement).style.background = status.color + '20';
                            }
                        } else {
                            option.classList.remove('selected');
                            (option as HTMLElement).style.background = 'transparent';
                        }
                    });
                }, 150);
            }
        }, 100);

        // 填充父任务信息
        this.updateParentTaskDisplay();

        // 填充完成时间
        this.updateCompletedTimeDisplay();

        // 如果有块ID，显示预览
        if (this.reminder.blockId) {
            this.updateBlockPreview(this.reminder.blockId);
        }

        // 如果是编辑模式，更新子任务入口显示
        if (this.mode === 'edit' && this.reminder) {
            this.updateSubtasksDisplay();
            this.updatePomodorosDisplay();
            this.updateEditAllInstancesDisplay();
        }
    }

    /**
     * 更新子任务入口显示
     */
    private async updateSubtasksDisplay() {
        const subtasksGroup = this.dialog.element.querySelector('#quickSubtasksGroup') as HTMLElement;
        const subtasksCountText = this.dialog.element.querySelector('#quickSubtasksCountText') as HTMLElement;

        if (!subtasksGroup) return;

        // 如果当前任务是子任务（有 parentId），则不显示子任务按钮
        if (this.defaultParentId) {
            subtasksGroup.style.display = 'none';
            return;
        }

        // 编辑模式：需要有 reminder.id
        // 新建模式：使用临时子任务列表
        if (this.mode === 'edit' && !this.reminder) {
            subtasksGroup.style.display = 'none';
            return;
        }

        subtasksGroup.style.display = 'block';

        let count = 0;
        let completedCount = 0;
        if (this.mode === 'edit' && this.reminder) {
            // 编辑模式：从数据库获取子任务（包括 ghost 子任务）
            const reminderData = await this.plugin.loadReminderData();

            // 解析可能存在的实例信息 (id_YYYY-MM-DD)
            let targetParentId = this.reminder.id;
            let instanceDate: string | undefined;

            const lastUnderscoreIndex = this.reminder.id.lastIndexOf('_');
            if (lastUnderscoreIndex !== -1) {
                const potentialDate = this.reminder.id.substring(lastUnderscoreIndex + 1);
                if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                    targetParentId = this.reminder.id.substring(0, lastUnderscoreIndex);
                    instanceDate = potentialDate;
                }
            }

            // 1. 获取直接以当前 reminder.id 为父任务的任务（可能是真正的实例子任务或普通子任务）
            const directChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === this.reminder.id);

            // 2. 如果是实例视图，则尝试从模板中获取 ghost 子任务
            let ghostChildren: any[] = [];
            if (instanceDate && targetParentId !== this.reminder.id) {
                const templateChildren = (Object.values(reminderData) as any[]).filter((r: any) => r.parentId === targetParentId);
                ghostChildren = templateChildren
                    .filter(child => {
                        // 过滤掉在当前日期隐藏的 ghost 子任务
                        const isHidden = child.repeat?.excludeDates?.includes(instanceDate);
                        return !isHidden;
                    })
                    .map(child => {
                        const ghostId = `${child.id}_${instanceDate}`;
                        // 检查此 ghost 子任务在当前日期是否已完成
                        const isCompleted = child.repeat?.completedInstances?.includes(instanceDate) || false;

                        // 将实例级的修改合并（如果存在 instanceModifications）
                        const instanceMod = child.repeat?.instanceModifications?.[instanceDate] || {};

                        return {
                            ...child,
                            ...instanceMod,
                            id: ghostId,
                            parentId: this.reminder.id,
                            isRepeatInstance: true,
                            originalId: child.id,
                            completed: isCompleted,
                            // 确保标题优先使用实例级修改的 title
                            title: instanceMod.title || child.title || '(无标题)',
                        };
                    });
            }

            // 合并数据，避免重复（如果已存在真实的实例子任务，则以真实子任务优先）
            const combined = [...directChildren];
            ghostChildren.forEach(ghost => {
                if (!combined.some(r => r.id === ghost.id)) {
                    combined.push(ghost);
                }
            });

            count = combined.length;
            completedCount = combined.filter(r => r.completed).length;
        } else {
            // 新建模式：使用临时子任务列表
            count = this.tempSubtasks.length;
            completedCount = this.tempSubtasks.filter(r => r.completed).length;
        }

        if (subtasksCountText) {
            const label = this.mode === 'edit'
                ? (i18n("viewSubtasks") || "查看子任务")
                : (i18n("newSubtasks") || "新建子任务");
            // 显示格式：查看子任务 (已完成数/总数) 或 查看子任务 (总数)
            if (count > 0) {
                if (completedCount > 0) {
                    subtasksCountText.textContent = `${label} (${completedCount}/${count})`;
                } else {
                    subtasksCountText.textContent = `${label} (${count})`;
                }
            } else {
                subtasksCountText.textContent = label;
            }
        }
    }

    /**
     * 更新番茄钟入口显示
     */
    private async updatePomodorosDisplay() {
        const pomodorosGroup = this.dialog.element.querySelector('#quickPomodorosGroup') as HTMLElement;
        const pomodorosCountText = this.dialog.element.querySelector('#quickPomodorosCountText') as HTMLElement;

        if (!pomodorosGroup || !this.reminder) return;

        pomodorosGroup.style.display = 'block';

        await this.pomodoroRecordManager.initialize();

        // 确定目标ID：如果是实例，获取原始ID；否则使用当前ID
        const originalId = this.reminder.originalId || this.reminder.id;

        // 判断是否为"修改全部实例"模式
        const isModifyAllInstances = !this.isInstanceEdit && this.reminder.repeat?.enabled;

        // 判断是否为实例编辑模式（有 originalId 且是实例）
        const isInstanceEditMode = this.isInstanceEdit && this.reminder.originalId;

        if (pomodorosCountText) {
            // 如果是实例编辑模式，显示当前实例和系列总数量
            if (isInstanceEditMode) {
                // 获取当前实例的番茄钟数量
                const instanceCount = this.pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(this.reminder.id);
                const instanceMinutes = this.pomodoroRecordManager.getRepeatingEventTotalFocusTime(this.reminder.id);

                // 获取系列总番茄钟数量（原始任务+所有实例）
                const seriesCount = this.pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(originalId);
                const seriesMinutes = this.pomodoroRecordManager.getRepeatingEventTotalFocusTime(originalId);

                const instanceTimeStr = instanceMinutes > 0 ? `(${Math.floor(instanceMinutes / 60)}h${instanceMinutes % 60}m)` : '';
                const seriesTimeStr = seriesMinutes > 0 ? `(${Math.floor(seriesMinutes / 60)}h${seriesMinutes % 60}m)` : '';

                if (instanceCount > 0 || seriesCount > 0) {
                    pomodorosCountText.textContent = `${i18n("viewPomodoros") || "查看番茄钟"} ${instanceCount}🍅${instanceTimeStr} / 系列: ${seriesCount}🍅${seriesTimeStr}`;
                } else {
                    pomodorosCountText.textContent = `${i18n("viewPomodoros") || "查看番茄钟"}`;
                }
            } else if (isModifyAllInstances) {
                // 修改全部实例模式，显示系列总数
                const seriesCount = this.pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(originalId);
                const seriesMinutes = this.pomodoroRecordManager.getRepeatingEventTotalFocusTime(originalId);
                const seriesTimeStr = seriesMinutes > 0 ? ` (${Math.floor(seriesMinutes / 60)}h${seriesMinutes % 60}m)` : '';

                if (seriesCount > 0 || seriesMinutes > 0) {
                    pomodorosCountText.textContent = `${i18n("viewPomodoros") || "查看番茄钟"} ${seriesCount}🍅${seriesTimeStr}`;
                } else {
                    pomodorosCountText.textContent = `${i18n("viewPomodoros") || "查看番茄钟"}`;
                }
            } else {
                // 普通任务，只显示当前任务的番茄钟
                const count = this.pomodoroRecordManager.getRepeatingEventTotalPomodoroCount(this.reminder.id);
                const totalMinutes = this.pomodoroRecordManager.getRepeatingEventTotalFocusTime(this.reminder.id);
                const timeStr = totalMinutes > 0 ? ` (${Math.floor(totalMinutes / 60)}h${totalMinutes % 60}m)` : '';

                if (count > 0 || totalMinutes > 0) {
                    pomodorosCountText.textContent = `${i18n("viewPomodoros") || "查看番茄钟"} ${count}🍅${timeStr}`;
                } else {
                    pomodorosCountText.textContent = `${i18n("viewPomodoros") || "查看番茄钟"}`;
                }
            }
        }
    }

    /**
     * 更新块预览显示
     */
    private async updateBlockPreview(blockId: string) {
        const preview = this.dialog.element.querySelector('#quickBlockPreview') as HTMLElement;
        const content = this.dialog.element.querySelector('#quickBlockPreviewContent') as HTMLElement;

        if (!blockId) {
            preview.style.display = 'none';
            const syncTitleContainer = this.dialog.element.querySelector('#quickSyncBlockTitleContainer') as HTMLElement;
            if (syncTitleContainer) syncTitleContainer.style.display = 'none';
            return;
        }

        try {
            const block = await getBlockByID(blockId);
            const syncTitleContainer = this.dialog.element.querySelector('#quickSyncBlockTitleContainer') as HTMLElement;

            if (block) {
                this.blockContent = block.content || '';
                if (syncTitleContainer) {
                    syncTitleContainer.style.display = this.blockContent ? 'block' : 'none';
                }
                content.innerHTML = `
                    <span style="font-weight: 500; margin-bottom: 4px; cursor: pointer; color: var(--b3-protyle-inline-blockref-color); border-bottom: 1px dashed var(--b3-protyle-inline-blockref-color); padding-bottom: 2px; max-width: 100%; word-wrap: break-word; overflow-wrap: break-word;" id="quickBlockPreviewHover">${(block.content || '无内容').length > 50 ? (block.content || '无内容').substring(0, 50) + '...' : (block.content || '无内容')}</span>
                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light);">
                        类型: ${block.type} | ID: ${block.id}
                    </div>
                `;
                preview.style.display = 'block';

                // 绑定悬浮预览事件
                const hoverDiv = content.querySelector('#quickBlockPreviewHover') as HTMLElement;
                if (hoverDiv && this.plugin && this.plugin.addFloatLayer) {
                    let hoverTimeout: number | null = null;

                    hoverDiv.addEventListener('mouseenter', (event) => {
                        // 清除之前的定时器
                        if (hoverTimeout) {
                            clearTimeout(hoverTimeout);
                        }

                        // 设置500ms延迟后显示预览
                        hoverTimeout = window.setTimeout(() => {
                            const rect = hoverDiv.getBoundingClientRect();
                            this.plugin.addFloatLayer({
                                refDefs: [{ refID: blockId, defIDs: [] }],
                                x: rect.left,
                                y: rect.top - 70,
                                isBacklink: false
                            });
                            hoverTimeout = null;
                        }, 500);
                    });

                    hoverDiv.addEventListener('mouseleave', () => {
                        // 清除定时器，取消预览显示
                        if (hoverTimeout) {
                            clearTimeout(hoverTimeout);
                            hoverTimeout = null;
                        }
                    });
                }
            } else {
                content.innerHTML = `<div style="color: var(--b3-theme-error);">${i18n("blockNotExist") || '块不存在'}</div>`;
                preview.style.display = 'block';
                if (syncTitleContainer) syncTitleContainer.style.display = 'none';
            }
        } catch (error) {
            console.error('获取块信息失败:', error);
            preview.style.display = 'none';
            const syncTitleContainer = this.dialog.element.querySelector('#quickSyncBlockTitleContainer') as HTMLElement;
            if (syncTitleContainer) syncTitleContainer.style.display = 'none';
        }
    }

    // 显示自然语言输入对话框
    private showNaturalLanguageDialog() {
        // 获取标题输入框的内容作为默认值
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;
        const defaultValue = titleInput?.value?.trim() || '';

        const nlDialog = new Dialog({
            title: "✨ 智能日期识别",
            content: `
                <div class="nl-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">输入自然语言描述</label>
                            <input type="text" id="quickNlInput" class="b3-text-field" value="${defaultValue}" placeholder="例如：明天下午3点、下周五、3天后等" style="width: 100%;" autofocus>
                            <div class="b3-form__desc">支持中文自然语言，如：今天、明天、下周一、3月15日、下午2点、农历八月廿一等</div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">识别结果预览</label>
                            <div id="quickNlPreview" class="nl-preview">请输入日期时间描述</div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickNlCancelBtn">取消</button>
                        <button class="b3-button b3-button--primary" id="quickNlConfirmBtn" disabled>应用</button>
                    </div>
                </div>
            `,
            width: "400px",
            height: "30%"
        });

        const nlInput = nlDialog.element.querySelector('#quickNlInput') as HTMLInputElement;
        const nlPreview = nlDialog.element.querySelector('#quickNlPreview') as HTMLElement;
        const nlCancelBtn = nlDialog.element.querySelector('#quickNlCancelBtn') as HTMLButtonElement;
        const nlConfirmBtn = nlDialog.element.querySelector('#quickNlConfirmBtn') as HTMLButtonElement;

        let currentParseResult: any = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = '请输入日期时间描述';
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            currentParseResult = parseNaturalDateTime(text);

            if (currentParseResult.date || currentParseResult.endDate) {
                let previewText = `📅 ${currentParseResult.date || currentParseResult.endDate || ''}`;
                if (currentParseResult.time || currentParseResult.endTime) {
                    previewText += ` ⏰ ${currentParseResult.time || currentParseResult.endTime || ''}`;
                }

                if (currentParseResult.date && currentParseResult.endDate) {
                    previewText = `📅 ${currentParseResult.date}${currentParseResult.time ? ' ' + currentParseResult.time : ''} ➡️ ${currentParseResult.endDate}${currentParseResult.endTime ? ' ' + currentParseResult.endTime : ''}`;
                } else if (currentParseResult.endDate && !currentParseResult.date) {
                    previewText = `🏁 截止：${currentParseResult.endDate}${currentParseResult.endTime ? ' ' + currentParseResult.endTime : ''}`;
                }

                nlPreview.textContent = previewText;
                nlPreview.className = 'nl-preview nl-preview--success';
                nlConfirmBtn.disabled = false;
            } else {
                nlPreview.textContent = '❌ 无法识别日期时间，请尝试其他表达方式';
                nlPreview.className = 'nl-preview nl-preview--error';
                nlConfirmBtn.disabled = true;
            }
        };

        // 绑定事件
        nlInput.addEventListener('input', updatePreview);
        nlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !nlConfirmBtn.disabled) {
                this.applyNaturalLanguageResult(currentParseResult);
                nlDialog.destroy();
            }
        });

        nlCancelBtn.addEventListener('click', () => {
            nlDialog.destroy();
        });

        nlConfirmBtn.addEventListener('click', () => {
            this.applyNaturalLanguageResult(currentParseResult);
            nlDialog.destroy();
        });

        // 自动聚焦输入框并触发预览更新
        setTimeout(() => {
            nlInput.focus();
            // 如果有默认值，立即触发预览更新
            if (defaultValue) {
                updatePreview();
            }
        }, 100);
    }

    // 应用自然语言识别结果
    private applyNaturalLanguageResult(result: {
        date?: string;
        time?: string;
        hasTime?: boolean;
        endDate?: string;
        endTime?: string;
        hasEndTime?: boolean;
    }) {
        if (!result.date && !result.endDate) return;

        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;

        // 设置日期
        if (result.date) {
            dateInput.value = result.date;
        } else if (result.endDate) {
            // 如果只有结束日期，通常是"截止"形式，将其作为起始日期以触发提醒
            dateInput.value = result.endDate;
        }

        // 设置时间（独立输入框）
        if (result.time && timeInput) {
            timeInput.value = result.time;
        }

        // 设置结束日期和时间
        if (result.endDate) {
            endDateInput.value = result.endDate;
        }
        if (result.endTime && endTimeInput) {
            endTimeInput.value = result.endTime;
        }

        // 触发日期变化事件以更新结束日期限制
        dateInput.dispatchEvent(new Event('change'));

        let msg = '✨ 已识别设置';
        if (result.date) msg += `：${result.date}${result.time ? ' ' + result.time : ''}`;
        if (result.endDate && result.endDate !== result.date) msg += ` 至 ${result.endDate}${result.endTime ? ' ' + result.endTime : ''}`;
        if (result.endDate && !result.date) msg += ` 截止于 ${result.endDate}${result.endTime ? ' ' + result.endTime : ''}`;

        showMessage(msg);
    }

    public async show() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

        // 如果未通过构造器显式指定 autoDetectDateTime，则从插件设置中读取（如果有传入 plugin）
        if (this.autoDetectDateTime === undefined) {
            if (this.plugin && typeof this.plugin.getAutoDetectDateTimeEnabled === 'function') {
                try {
                    this.autoDetectDateTime = await this.plugin.getAutoDetectDateTimeEnabled();
                } catch (err) {
                    console.warn('获取自动识别设置失败，使用默认值 false:', err);
                    this.autoDetectDateTime = false;
                }
            } else {
                // 如果未提供 plugin，默认关闭自动识别以保守处理
                this.autoDetectDateTime = false;
            }
        }

        // 初始化自定义提醒时间
        if (this.reminder && this.reminder.reminderTimes) {
            this.customTimes = this.reminder.reminderTimes.map((t: any) => {
                if (typeof t === 'string') return { time: t, note: '' };
                return t;
            });
        } else {
            this.customTimes = [];
        }

        const currentTime = this.initialTime;

        // 如果传入了blockId，尝试获取块内容作为默认标题（优先 DOM 内容；文档根直接使用块/文档标题）
        // 对于batch_edit模式，块内容已从reminder中设置
        if (this.mode !== 'batch_edit' && this.blockId) {
            try {
                const block = await getBlockByID(this.blockId);
                if (!block) {
                    showMessage(i18n("blockNotExist"));
                    return;
                }
                try {
                    // 如果是文档块，直接使用文档/块的标题内容
                    if (block.type === 'd') {
                        this.blockContent = block.content || i18n("unnamedNote");
                    } else {
                        // 对于其他块类型，尝试获取 DOM 并提取正文段落
                        const domString = await getBlockDOM(this.blockId);
                        const parser = new DOMParser();
                        const dom = parser.parseFromString(domString.dom, 'text/html');
                        const element = dom.querySelector('div[data-type="NodeParagraph"]');
                        if (element) {
                            const attrElement = element.querySelector('div.protyle-attr');
                            if (attrElement) {
                                attrElement.remove();
                            }
                        }
                        this.blockContent = element ? (element.textContent || '').trim() : (block?.fcontent || block?.content || i18n("unnamedNote"));
                    }
                } catch (e) {
                    this.blockContent = block?.fcontent || block?.content || i18n("unnamedNote");
                }
            } catch (error) {
                console.warn('获取块信息失败:', error);
            }
        }

        this.dialog = new Dialog({
            title: this.mode === 'edit' ? i18n("editReminder") : (this.mode === 'note' ? (i18n("editNote") || "编辑备注") : i18n("createQuickReminder")),
            content: this.mode === 'note' ? `
                <div class="quick-reminder-dialog">
                    <div class="b3-dialog__content">
                        <!-- 备注 (Vditor) -->
                        <div class="b3-form__group" style="margin-top: 0;">
                            <div id="quickReminderNote" style="width: 100%;"></div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickCancelBtn">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="quickConfirmBtn">${i18n("save")}</button>
                    </div>
                </div>
            ` : `
                <div class="quick-reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("eventTitle")}</label>
                            <div class="title-input-container" style="display: flex; gap: 8px; align-items: flex-start;">
                                <textarea id="quickReminderTitle" class="b3-text-field" rows="1" placeholder="${i18n("enterReminderTitle")}" spellcheck="false" style="flex: 1; max-height: 200px; resize: vertical; overflow-y: auto; padding: 4px 8px; line-height: 1.5;" required autofocus></textarea>
                                <button type="button" id="quickNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                    ✨
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group" style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
                            <label class="b3-checkbox" style="display: flex; align-items: center;">
                                <input type="checkbox" class="b3-switch" id="quickPasteAutoDetect" ${this.autoDetectDateTime ? 'checked' : ''}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${i18n("pasteAutoDetectDate") || "粘贴自动识别日期"}</span>
                            </label>
                            <div id="quickSyncBlockTitleContainer" style="display: none;">
                                <button type="button" id="quickSyncBlockTitleBtn" class="b3-button b3-button--outline b3-button--small" style="display: flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px;">
                                    <svg style="width: 12px; height: 12px;"><use xlink:href="#iconRefresh"></use></svg>
                                    <span>${i18n("syncBlockTitle") || '更新标题为绑定块内容'}</span>
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("reminderDate") || "日期时间"}</label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <!-- 开始行: responsive, keep date flexible but ensure time + clear button never wrap -->
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-size: 13px; color: var(--b3-theme-on-surface); white-space: nowrap; flex: 0 0 auto;">开始：</span>
                                    <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 140px; min-width: 120px;">
                                        <input type="date" id="quickReminderDate" class="b3-text-field" value="${this.initialDate || ''}" max="9999-12-31" style="flex: 1; min-width: 0;">
                                        <button type="button" id="quickClearStartDateBtn" class="b3-button b3-button--outline" title="${i18n("clearDate") || "清除日期"}" style="padding: 4px 8px; font-size: 12px; flex: 0 0 auto;">
                                            <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                        </button>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px; flex: 0 0 auto; white-space: nowrap; min-width: 110px;margin-left: auto;">
                                        <input type="time" id="quickReminderTime" class="b3-text-field" value="${this.initialTime || ''}" style="flex: 0 0 auto; min-width: 100px;">
                                        <button type="button" id="quickClearStartTimeBtn" class="b3-button b3-button--outline" title="${i18n("clearTime") || "清除时间"}" style="padding: 4px 8px; font-size: 12px;">
                                            <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                        </button>
                                    </div>
                                </div>
                                <!-- 持续天数行: allow wrap when narrow -->
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-size: 13px; color: var(--b3-theme-on-surface); white-space: nowrap; flex: 0 0 auto;">持续：</span>
                                    <input type="number" id="quickDurationDays" min="1" step="1" class="b3-text-field" value="1" style="width: 100px; min-width: 80px;">
                                    <span style="font-size: 13px; color: var(--b3-theme-on-surface-light);">天</span>
                                </div>
                                <!-- 结束行: responsive, keep end time + clear button together -->
                                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-size: 13px; color: var(--b3-theme-on-surface); white-space: nowrap; flex: 0 0 auto;">结束：</span>
                                    <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 140px; min-width: 120px;">
                                        <input type="date" id="quickReminderEndDate" class="b3-text-field" placeholder="${i18n("endDateOptional")}" title="${i18n("spanningEventDesc")}" max="9999-12-31" style="flex: 1; min-width: 0;">
                                        <button type="button" id="quickClearEndDateBtn" class="b3-button b3-button--outline" title="${i18n("clearDate") || "清除日期"}" style="padding: 4px 8px; font-size: 12px; flex: 0 0 auto;">
                                            <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                        </button>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px; flex: 0 0 auto; white-space: nowrap; min-width: 110px;margin-left: auto;">
                                        <input type="time" id="quickReminderEndTime" class="b3-text-field" placeholder="${i18n("endTimeOptional") || "结束时间"}" style="flex: 0 0 auto; min-width: 100px;">
                                        <button type="button" id="quickClearEndTimeBtn" class="b3-button b3-button--outline" title="${i18n("clearTime") || "清除时间"}" style="padding: 4px 8px; font-size: 12px;">
                                            <svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconTrashcan"></use></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div class="b3-form__desc">${i18n("dateTimeOptionalDesc") || "不设置时间则创建为全天任务"}</div>
                        </div>
                        <!-- 完成时间显示和编辑 -->
                        <div class="b3-form__group" id="quickCompletedTimeGroup" style="display: none;">
                            <label class="b3-form__label">${i18n("completedAt") || "完成时间"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="datetime-local" id="quickCompletedTime" class="b3-text-field" style="flex: 1;">
                                <button type="button" id="quickSetCompletedNowBtn" class="b3-button b3-button--outline" title="${i18n("setToNow") || "设为当前时间"}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconClock"></use></svg>
                                </button>
                                <button type="button" id="quickClearCompletedBtn" class="b3-button b3-button--outline" title="${i18n("clearCompletedTime") || "清除完成时间"}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("customReminderTimes") || "自定义提醒时间"}</label>
                            <div id="quickCustomTimeList" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
                                <!-- Added times will be shown here -->
                            </div>
                            <button type="button" id="quickShowCustomTimeBtn" class="b3-button b3-button--outline" style="width: 100%; margin-bottom: 8px;">
                                <svg class="b3-button__icon" style="margin-right: 4px;"><use xlink:href="#iconAdd"></use></svg>
                                <span>${i18n("addReminderTime") || "添加提醒时间"}</span>
                            </button>
                            <div id="quickCustomTimeInputArea" style="display: none; padding: 12px; background: var(--b3-theme-background-light); border-radius: 6px; border: 1px solid var(--b3-theme-surface-lighter);">
                                <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                                    <input type="datetime-local" id="quickCustomReminderTime" class="b3-text-field" style="flex: 1;">
                                    <input type="text" id="quickCustomReminderNote" class="b3-text-field" placeholder="${i18n("note") || "备注"}" style="width: 120px;">
                                    <button type="button" id="quickConfirmCustomTimeBtn" class="b3-button b3-button--primary" title="${i18n("confirm") || "确认"}">
                                        <svg class="b3-button__icon"><use xlink:href="#iconCheck"></use></svg>
                                    </button>
                                    <button type="button" id="quickCancelCustomTimeBtn" class="b3-button b3-button--outline" title="${i18n("cancel") || "取消"}">
                                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                                    </button>
                                </div>
                                <div id="quickPresetContainer" style="width: 100%; display: ${this.initialTime ? 'block' : 'none'};">
                                    <label class="b3-form__label" style="font-size: 12px;">${i18n("reminderPreset") || "提醒时间预设"}</label>
                                    <select id="quickCustomReminderPreset" class="b3-select" style="width: 100%;">
                                        <option value="">${i18n("selectPreset") || "选择预设..."}</option>
                                        <option value="5m">${i18n("before5m") || "提前 5 分钟"}</option>
                                        <option value="10m">${i18n("before10m") || "提前 10 分钟"}</option>
                                        <option value="30m">${i18n("before30m") || "提前 30 分钟"}</option>
                                        <option value="1h">${i18n("before1h") || "提前 1 小时"}</option>
                                        <option value="2h">${i18n("before2h") || "提前 2 小时"}</option>
                                        <option value="1d">${i18n("before1d") || "提前 1 天"}</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 添加重复设置 -->
                        <div class="b3-form__group" id="repeatSettingsGroup" style="${this.isInstanceEdit ? 'display: none;' : ''}">
                            <label class="b3-form__label">${i18n("repeatSettings")}</label>
                            <div class="repeat-setting-container">
                                <button type="button" id="quickRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                    <span id="quickRepeatDescription">${i18n("noRepeat")}</span>
                                    <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                                </button>
                            </div>
                        </div>
                        <!-- 绑定块/文档输入，允许手动输入块 ID 或文档 ID -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("bindToBlock") || '块或文档 ID'}</label>
                            <div style="display: flex; gap: 8px; flex-wrap: wrap; ">
                                <input type="text" id="quickBlockInput" class="b3-text-field" value="${this.defaultBlockId || ''}" placeholder="${i18n("enterBlockId") || '请输入块或文档 ID'}" style="flex: 1;">
                                <button type="button" id="quickPasteBlockRefBtn" class="b3-button b3-button--outline" title="${i18n("pasteBlockRef")}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                                </button>
                                <button type="button" id="quickCreateDocBtn" class="b3-button b3-button--outline" title="${i18n("createNewDocument") || '新建文档'}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                </button>
                            </div>
                        </div>
                        <!-- 块预览区域 -->
                        <div id="quickBlockPreview" style="margin-top: 8px; padding: 8px; background: var(--b3-theme-background-light); border: 1px solid var(--b3-border-color); border-radius: 4px; display: none;">
                            <div id="quickBlockPreviewContent" style="font-size: 13px; color: var(--b3-theme-on-surface);"></div>
                            <div id="quickSyncTitleToBlockContainer" style="margin-top: 8px;">
                                <button type="button" id="quickSyncTitleToBlockBtn" class="b3-button b3-button--outline b3-button--small" style="display: flex; align-items: center; gap: 4px; font-size: 12px; padding: 2px 8px;">
                                    <svg style="width: 12px; height: 12px;"><use xlink:href="#iconRefresh"></use></svg>
                                    <span>${i18n("syncTitleToBlock") || '更新绑定块内容为当前标题'}</span>
                                </button>
                            </div>
                        </div>
                        <!-- 网页链接输入 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("bindUrl")}</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="url" id="quickUrlInput" class="b3-text-field" placeholder="${i18n("enterUrl")}" style="flex: 1;">
                                <button type="button" id="quickOpenUrlBtn" class="b3-button b3-button--outline" title="${i18n("openUrl") || '在浏览器中打开'}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconLink"></use></svg>
                                </button>
                            </div>
                        </div>
                        <!-- 备注 (Vditor) -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("reminderNoteOptional")}</label>
                            <div id="quickReminderNote" style="width: 100%; min-height: 50px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 4px; position: relative;"></div>
                        </div>

                        <div class="b3-form__group" id="quickParentTaskGroup" style="display: none;">
                            <label class="b3-form__label">${i18n("parentTask") || "父任务"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="text" id="quickParentTaskDisplay" class="b3-text-field" readonly style="flex: 1; background: var(--b3-theme-background-light); cursor: default;" placeholder="无父任务">
                                <button type="button" id="quickViewParentBtn" class="b3-button b3-button--outline" title="${i18n("viewParentTask") || "查看父任务"}" style="display: none;">
                                    <svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg>
                                </button>
                            </div>
                            <div class="b3-form__desc" style="font-size: 11px; color: var(--b3-theme-on-surface-light);">
                                父任务 ID: <span id="quickParentTaskId" style="font-family: monospace;">-</span>
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickEditAllInstancesGroup" style="display: none;">
                            <label class="b3-form__label">${i18n("recurringTask") || "重复任务"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <button type="button" id="quickEditAllInstancesBtn" class="b3-button b3-button--outline" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                    <svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>
                                    <span>${i18n("editAllInstances") || "编辑所有实例"}</span>
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickSubtasksGroup" style="display: none; margin-top: 8px;">
                            <label class="b3-form__label">${i18n("subtasks") || "子任务"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <button type="button" id="quickViewSubtasksBtn" class="b3-button b3-button--outline" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                    <svg class="b3-button__icon"><use xlink:href="#iconBulletedList"></use></svg>
                                    <span id="quickSubtasksCountText">${i18n("viewSubtasks") || "查看子任务"}</span>
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("estimatedPomodoroDuration")}</label>
                            <input type="text" id="quickEstimatedPomodoroDuration" class="b3-text-field" placeholder="${i18n("estimatedPomodoroDurationPlaceholder")}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group" id="quickPomodorosGroup" style="display: none;">
                            <label class="b3-form__label">${i18n("pomodoros") || "番茄钟"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <button type="button" id="quickViewPomodorosBtn" class="b3-button b3-button--outline" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;">
                                    <span id="quickPomodorosCountText">${i18n("viewPomodoros") || "查看番茄钟"}</span>
                                </button>
                            </div>
                        </div>

                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("eventCategory")}
                                <button type="button" id="quickManageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                                </button>
                            </label>
                            <div class="category-selector" id="quickCategorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                                <!-- 分类选择器将在这里渲染 -->
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickProjectGroup" style="${this.hideProjectSelector ? 'display: none;' : ''}">
                            <label class="b3-form__label">设置所属项目</label>
                            <div class="custom-select" id="quickProjectSelectCustom" style="position: relative;">
                                <div style="position: relative;">
                                    <input type="text" id="quickProjectSearchInput" class="b3-text-field" placeholder="${i18n("searchProject") || "搜索项目"}" autocomplete="off" style="width: 100%; padding-right: 30px;  background: var(--b3-select-background);">
                                    <input type="hidden" id="quickProjectSelector">
                                </div>
                                <div id="quickProjectDropdown" class="b3-menu" style="display: none; position: absolute; width: 100%; max-height: 200px; overflow-y: auto; z-index: 10; margin-top: 4px; box-shadow: var(--b3-menu-shadow); background: var(--b3-menu-background); border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius);">
                                    <!-- 项目选项将在这里渲染 -->
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickCustomGroup" style="display: none;">
                            <label class="b3-form__label">设置任务分组</label>
                            <div class="custom-select" id="quickCustomGroupSelectCustom" style="position: relative;">
                                <div style="position: relative;">
                                    <input type="text" id="quickCustomGroupSearchInput" class="b3-text-field" placeholder="${i18n("searchGroup") || "搜索分组"}" autocomplete="off" style="width: 100%; padding-right: 30px; background: var(--b3-select-background);">
                                    <input type="hidden" id="quickCustomGroupSelector">
                                </div>
                                <div id="quickCustomGroupDropdown" class="b3-menu" style="display: none; position: absolute; width: 100%; max-height: 200px; overflow-y: auto; z-index: 10; margin-top: 4px; box-shadow: var(--b3-menu-shadow); background: var(--b3-menu-background); border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius);">
                                    <!-- 自定义分组选择器将在这里渲染 -->
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickMilestoneGroup" style="display: none;">
                            <label class="b3-form__label">${i18n("milestone") || "里程碑"}</label>
                            <div class="custom-select" id="quickMilestoneSelectCustom" style="position: relative;">
                                <div style="position: relative;">
                                    <input type="text" id="quickMilestoneSearchInput" class="b3-text-field" placeholder="${i18n("searchMilestone") || "搜索里程碑"}" autocomplete="off" style="width: 100%; padding-right: 30px; background: var(--b3-select-background);">
                                    <input type="hidden" id="quickMilestoneSelector">
                                </div>
                                <div id="quickMilestoneDropdown" class="b3-menu" style="display: none; position: absolute; width: 100%; max-height: 200px; overflow-y: auto; z-index: 10; margin-top: 4px; box-shadow: var(--b3-menu-shadow); background: var(--b3-menu-background); border: 1px solid var(--b3-border-color); border-radius: var(--b3-border-radius);">
                                    <!-- 里程碑选择器将在这里渲染 -->
                                </div>
                            </div>
                        </div>
                        <!-- 任务状态渲染 -->
                        ${this.renderStatusSelector()}
                        <div class="b3-form__group" id="quickTagsGroup" style="display: none;">
                            <label class="b3-form__label">设置标签</label>
                            <div id="quickTagsSelector" class="tags-selector" style="display: flex; flex-wrap: wrap; gap: 6px;">
                                <!-- 标签选择器将在这里渲染 -->
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${i18n("priority")}</label>
                            <div class="priority-selector" id="quickPrioritySelector">
                                <div class="priority-option" data-priority="high">
                                    <div class="priority-dot high"></div>
                                    <span>${i18n("highPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="medium">
                                    <div class="priority-dot medium"></div>
                                    <span>${i18n("mediumPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="low">
                                    <div class="priority-dot low"></div>
                                    <span>${i18n("lowPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>${i18n("noPriority")}</span>
                                </div>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">显示设置</label>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <label class="b3-checkbox">
                                    <input type="checkbox" class="b3-switch" id="quickIsAvailableToday">
                                    <span class="b3-checkbox__graphic"></span>
                                    <span class="b3-checkbox__label">🍰 每日可做（在任务管理侧栏的「今日任务」每天显示，适合用于推进长期任务）</span>
                                </label>
                                <div id="quickAvailableDateGroup" style="display: none; margin-left: 28px;">
                                    <label class="b3-form__label" style="font-size: 12px;">起始日期</label>
                                    <input type="date" id="quickAvailableStartDate" class="b3-text-field" style="width: 100%;">
                                </div>
                                <label class="b3-checkbox">
                                    <input type="checkbox" class="b3-switch" id="quickHideInCalendar">
                                    <span class="b3-checkbox__graphic"></span>
                                    <span class="b3-checkbox__label">📅 不在日历视图显示</span>
                                </label>
                            </div>
                        </div>

                        
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickCancelBtn">${i18n("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="quickConfirmBtn">${this.mode === 'edit' ? i18n("save") : i18n("save")}</button>
                    </div>
                </div>
            `,
            width: "min(500px, 90%)",
            height: this.mode === 'note' ? "auto" : "81vh"
        });

        // Initialize Vditor
        setTimeout(() => {
            let initialNote = '';
            if ((this.mode === 'edit' || this.mode === 'batch_edit' || this.mode === 'note') && this.reminder && this.reminder.note) {
                initialNote = this.reminder.note;
            } else if (this.defaultNote) {
                initialNote = this.defaultNote;
            }

            const noteContainer = this.dialog.element.querySelector('#quickReminderNote') as HTMLElement;
            if (!noteContainer) return;

            this.currentNote = initialNote;



            Editor.make()
                .config((ctx) => {
                    ctx.set(rootCtx, noteContainer);
                    ctx.set(defaultValueCtx, initialNote);
                    ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                        this.currentNote = markdown;
                    });

                    // 优先获取纯文本 (Markdown)，并优化粘贴逻辑
                    ctx.update(prosePluginsCtx, (prev) => [
                        ...prev,
                        new Plugin({
                            props: {
                                handlePaste: (view, event) => {
                                    let text = event.clipboardData?.getData('text/plain');
                                    if (text) {
                                        // 移除首尾多余的换行符（兼容 Windows/Unix），保留空格以维持缩进层级
                                        text = text.replace(/^[\r\n]+|[\r\n]+$/g, '');
                                        if (!text) return false;

                                        const parser = ctx.get(parserCtx);
                                        const node = parser(text);
                                        if (node) {
                                            const { tr, doc } = view.state;
                                            // 如果文档当前几乎为空（只有一个空的段落），则替换整个文档内容
                                            const isEmpty = doc.childCount === 1 &&
                                                doc.firstChild?.type.name === 'paragraph' &&
                                                doc.firstChild.content.size === 0;

                                            // 获取节点内容 fragment
                                            const content = node.type.name === 'doc' ? node.content : node;

                                            if (isEmpty) {
                                                // 彻底替换初始的空段落
                                                view.dispatch(tr.replaceWith(0, doc.content.size, content).scrollIntoView());
                                            } else {
                                                view.dispatch(tr.replaceSelectionWith(node).scrollIntoView());
                                            }
                                            return true;
                                        }
                                    }
                                    return false;
                                },
                                handleTextInput: (view, from, to, text) => {
                                    const { state } = view;
                                    const linkMark = state.schema.marks.link;
                                    if (!linkMark) return false;

                                    const $pos = state.doc.resolve(from);
                                    if (linkMark.isInSet($pos.marks())) {
                                        const range = this.findMarkRange(state.doc, from, linkMark);
                                        // 如果在链接末尾打字，不应继续表现为链接文本
                                        if (range && range.to === from) {
                                            const marks = $pos.marks().filter(m => m.type !== linkMark);
                                            const tr = state.tr.replaceWith(from, to, state.schema.text(text, marks));
                                            tr.removeStoredMark(linkMark);
                                            view.dispatch(tr);
                                            return true;
                                        }
                                    }
                                    return false;
                                },
                                handleClick: (view, pos) => {
                                    const { state } = view;
                                    const linkMark = state.schema.marks.link;
                                    if (!linkMark) return false;

                                    const node = state.doc.nodeAt(pos);
                                    const mark = node ? linkMark.isInSet(node.marks) : null;

                                    if (mark) {
                                        this.showLinkOptions(view, pos, mark);
                                        return true;
                                    }
                                    return false;
                                }
                            }
                        })
                    ]);
                })
                .use(commonmark)
                .use(gfm)
                .use(history)
                .use(clipboard)
                .use(cursor)
                .use(listener)
                .use($view(listItemSchema.node, () => (node, view, getPos) => {
                    const dom = document.createElement("li");
                    const contentDOM = document.createElement("div");

                    if (node.attrs.checked != null) {
                        dom.classList.add("task-list-item");

                        // Use absolute positioning for the checkbox to align with native list markers
                        dom.classList.add("task-list-item");
                        dom.style.listStyleType = "none";
                        dom.style.position = "relative";

                        const checkbox = document.createElement("input");
                        checkbox.type = "checkbox";
                        checkbox.checked = node.attrs.checked;

                        // Position checkbox to the left, similar to a list marker
                        checkbox.style.position = "absolute";
                        checkbox.style.left = "-1.4em";
                        checkbox.style.top = "0.3em";
                        checkbox.style.margin = "0";

                        // Handle click
                        checkbox.onclick = (e) => {
                            if (typeof getPos === "function") {
                                const { tr } = view.state;
                                tr.setNodeMarkup(getPos(), undefined, {
                                    ...node.attrs,
                                    checked: checkbox.checked
                                });
                                view.dispatch(tr);
                            }
                            e.stopPropagation();
                        };

                        dom.appendChild(checkbox);

                        contentDOM.style.minWidth = "0"; // Flex fix for overflow
                        dom.appendChild(contentDOM);

                        return {
                            dom,
                            contentDOM,
                            ignoreMutation: (mutation) => {
                                // Ignore checkbox mutations done by user (we handle validation via onclick)
                                return mutation.type === 'attributes' && mutation.target === checkbox;
                            },
                            update: (updatedNode) => {
                                if (updatedNode.type.name !== "list_item") return false;
                                // Force re-render if switching between task and normal list
                                const isTask = node.attrs.checked != null;
                                const newIsTask = updatedNode.attrs.checked != null;
                                if (isTask !== newIsTask) return false;

                                if (newIsTask) {
                                    checkbox.checked = updatedNode.attrs.checked;
                                }
                                return true;
                            }
                        };
                    } else {
                        // Regular list item: just 'li'
                        return {
                            dom,
                            contentDOM: dom
                        };
                    }
                }))
                .create()
                .then((editor) => {
                    this.editor = editor;

                    // Only auto-focus the editor when in 'note' mode (editing note only).
                    if (this.mode === 'note') {
                        editor.action((ctx) => {
                            const view = ctx.get(editorViewCtx);
                            if (view) {
                                view.focus();
                            }
                        });
                    }

                    const editorEl = this.dialog.element.querySelector('.milkdown') as HTMLElement;
                    if (editorEl) {
                        editorEl.style.height = '100%';
                        editorEl.style.minHeight = '50px';
                        editorEl.style.margin = '0px';
                        const prosemirror = editorEl.querySelector('.ProseMirror') as HTMLElement;
                        if (prosemirror) {
                            prosemirror.style.minHeight = '50px';
                            // Basic styling to mimic previous look roughly
                            prosemirror.style.padding = '8px';
                            prosemirror.style.outline = 'none';
                        }
                    }
                });
        }, 100);

        this.bindEvents();
        await this.renderCategorySelector();
        await this.renderProjectSelector();
        await this.renderPrioritySelector();
        await this.renderTagsSelector();

        // 确保日期和时间输入框正确设置初始值
        setTimeout(async () => {
            const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
            const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
            const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
            const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;

            // 设置日期（独立的日期输入框）
            if (this.initialDate) {
                dateInput.value = this.initialDate;
            }

            // 设置时间（独立的时间输入框）
            if (this.initialTime && timeInput) {
                timeInput.value = this.initialTime;
            }

            // 设置结束日期
            if (this.initialEndDate && endDateInput) {
                endDateInput.value = this.initialEndDate;
            }

            // 设置结束时间
            if (this.initialEndTime && endTimeInput) {
                endTimeInput.value = this.initialEndTime;
            }

            // 如果传入了初始起止日期，计算并填充持续天数
            const durationInputInit = this.dialog.element.querySelector('#quickDurationDays') as HTMLInputElement;
            if (durationInputInit) {
                if (dateInput.value && endDateInput && endDateInput.value) {
                    durationInputInit.value = String(this.getDurationInclusive(dateInput.value, endDateInput.value) || 1);
                } else {
                    durationInputInit.value = '1';
                }
            }

            // 设置默认值：优先使用 this.blockContent，其次使用 this.defaultTitle
            if (this.blockContent && titleInput) {
                titleInput.value = this.blockContent;
                // 将光标移到开头，显示开头的字
                titleInput.setSelectionRange(0, 0);
                // 自动调整高度
                this.autoResizeTextarea(titleInput);

                // 如果启用了自动识别，从标题中提取日期/时间并填充到输入框
                if (this.autoDetectDateTime) {
                    try {
                        const detected = autoDetectDateTimeFromTitle(this.blockContent);
                        if (detected && detected.date) {
                            const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                            const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;

                            // 设置日期
                            if (dateInput) {
                                dateInput.value = detected.date;
                            }

                            // 设置时间（如果有）
                            if (detected.hasTime && detected.time && timeInput) {
                                timeInput.value = detected.time;
                            }

                            // 如果启用了识别后移除日期设置，更新标题
                            this.plugin.getRemoveDateAfterDetectionEnabled().then((removeEnabled: boolean) => {
                                if (removeEnabled && detected.cleanTitle !== undefined) {
                                    titleInput.value = detected.cleanTitle || titleInput.value;
                                    // 将光标移到开头，显示开头的字
                                    titleInput.setSelectionRange(0, 0);
                                    // 自动调整高度
                                    this.autoResizeTextarea(titleInput);
                                }
                            });
                        }
                    } catch (err) {
                        console.warn('自动识别标题日期失败:', err);
                    }
                }
            }

            else if (this.defaultTitle && titleInput) {
                titleInput.value = this.defaultTitle;
                // 将光标移到开头，显示开头的字
                titleInput.setSelectionRange(0, 0);
                // 自动调整高度
                this.autoResizeTextarea(titleInput);
            }

            if (this.defaultNote) {
                // Vditor checks this.defaultNote
            }

            // 如果是编辑模式或批量编辑模式，填充现有提醒数据
            if ((this.mode === 'edit' || this.mode === 'batch_edit') && this.reminder) {
                await this.populateEditForm();
            }

            // 初始化子任务按钮显示（新建模式也显示）
            await this.updateSubtasksDisplay();

            // 自动聚焦标题输入框
            titleInput?.focus();

            // 如果有初始块 ID，触发预览
            const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
            if (blockInput && blockInput.value && this.mode !== 'edit') {
                await refreshSql();
                this.updateBlockPreview(blockInput.value);
            }

            // 初始化预设下拉状态
            this.updatePresetSelectState();
        }, 50);
    }

    private async renderPrioritySelector() {
        const prioritySelector = this.dialog.element.querySelector('#quickPrioritySelector') as HTMLElement;
        if (!prioritySelector) return;

        const priorityOptions = prioritySelector.querySelectorAll('.priority-option');

        // 移除所有选中状态
        priorityOptions.forEach(option => {
            option.classList.remove('selected');
        });

        // 设置默认优先级选择
        if (this.defaultPriority) {
            priorityOptions.forEach(option => {
                const priority = option.getAttribute('data-priority');
                if (priority === this.defaultPriority) {
                    option.classList.add('selected');
                }
            });
        } else {
            // 如果没有默认优先级，选中无优先级选项
            const noPriorityOption = prioritySelector.querySelector('[data-priority="none"]') as HTMLElement;
            if (noPriorityOption) {
                noPriorityOption.classList.add('selected');
            }
        }
    }

    // 渲染任务状态选择器
    private renderStatusSelector(): string {
        // 如果 showKanbanStatus 为 'none'，不显示任务状态选择器
        if (this.showKanbanStatus === 'none') {
            return '';
        }

        // 如果没有加载kanbanStatuses，使用默认配置
        if (this.currentKanbanStatuses.length === 0) {
            // 延迟初始化默认配置
            setTimeout(() => {
                if (this.currentKanbanStatuses.length === 0) {
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    this.currentKanbanStatuses = projectManager.getDefaultKanbanStatuses();
                    this.updateKanbanStatusSelector();
                }
            }, 0);
        }

        // 返回一个占位符，稍后通过updateKanbanStatusSelector填充
        return `
            <div class="b3-form__group">
                <label class="b3-form__label">任务状态</label>
                <div class="task-status-selector" id="quickStatusSelector" style="display: flex; gap: 3px; flex-wrap: wrap;">
                    <!-- 动态内容将通过updateKanbanStatusSelector填充 -->
                </div>
            </div>
        `;
    }

    /**
     * 更新看板状态选择器
     * 根据当前项目的kanbanStatuses动态生成选项
     */
    private updateKanbanStatusSelector() {
        const selector = this.dialog?.element?.querySelector('#quickStatusSelector') as HTMLElement;
        if (!selector) return;

        // 过滤掉已完成状态，获取可用的状态列表
        const availableStatuses = this.currentKanbanStatuses.filter(status => status.id !== 'completed');

        // 如果没有可用状态，使用默认状态
        if (availableStatuses.length === 0) {
            const projectManager = ProjectManager.getInstance(this.plugin);
            this.currentKanbanStatuses = projectManager.getDefaultKanbanStatuses();
            availableStatuses.push(...this.currentKanbanStatuses.filter(status => status.id !== 'completed'));
        }

        // 获取当前选中的状态
        const currentSelected = selector.querySelector('.task-status-option.selected') as HTMLElement;
        let currentStatusId = currentSelected?.getAttribute('data-status-type') || this.defaultStatus || 'doing';

        // 确保 currentStatusId 在可用状态列表中，如果不在则默认选中第一个
        const statusExists = availableStatuses.some(s => s.id === currentStatusId);
        if (!statusExists && availableStatuses.length > 0) {
            currentStatusId = availableStatuses[0].id;
        }

        // 确保容器支持换行显示（以防上层样式被覆盖）
        selector.style.display = 'flex';
        selector.style.flexWrap = 'wrap';
        selector.style.alignItems = 'flex-start';

        // 生成选项HTML — 使用 inline-flex 使每项按内容宽度展示并可换行
        const options = availableStatuses
            .map(status => {
                const isSelected = status.id === currentStatusId ? 'selected' : '';
                const bg = isSelected ? (status.color ? status.color + '20' : 'transparent') : 'transparent';
                return `
                    <div class="task-status-option ${isSelected}" data-status-type="${status.id}" style="
                        display: inline-flex;
                        align-items: center;
                        gap: 8px;
                        padding: 6px 10px;
                        margin: 6px 8px 0 0;
                        border-radius: 8px;
                        border: 1px solid var(--b3-theme-surface-lighter);
                        cursor: pointer;
                        background: ${bg};
                        white-space: nowrap;
                        transition: all 0.16s ease;
                        font-size: 13px;
                    ">
                        <span style="width: 10px; height: 10px; border-radius: 50%; background: ${status.color || 'transparent'}; display: inline-block;"></span>
                        <span style="line-height:1;">${status.name}</span>
                    </div>
                `;
            })
            .join('');

        selector.innerHTML = options;

        // 重新绑定点击事件 — 单选并更新样式
        selector.querySelectorAll('.task-status-option').forEach(option => {
            option.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                // 移除其他选中状态样式
                selector.querySelectorAll('.task-status-option').forEach(opt => {
                    opt.classList.remove('selected');
                    (opt as HTMLElement).style.background = 'var(--b3-theme-background)';
                });
                // 添加选中状态样式
                target.classList.add('selected');
                const statusId = target.getAttribute('data-status-type');
                const status = this.currentKanbanStatuses.find(s => s.id === statusId);
                if (status) {
                    target.style.background = (status.color ? status.color + '20' : 'var(--b3-theme-background)');
                }
            });
        });
    }

    private async renderCategorySelector() {
        const categorySelector = this.dialog.element.querySelector('#quickCategorySelector') as HTMLElement;
        if (!categorySelector) return;

        try {
            const categories = this.categoryManager.getCategories();

            // 清空并重新构建，使用横向布局
            categorySelector.innerHTML = '';

            // 添加无分类选项
            const noCategoryEl = document.createElement('div');
            noCategoryEl.className = 'category-option';
            noCategoryEl.setAttribute('data-category', '');
            noCategoryEl.innerHTML = `<span>${i18n("noCategory")}</span>`;
            categorySelector.appendChild(noCategoryEl);

            // 添加所有分类选项
            categories.forEach(category => {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'category-option';
                categoryEl.setAttribute('data-category', category.id);
                categoryEl.style.backgroundColor = category.color;
                categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
                categorySelector.appendChild(categoryEl);
            });

            // 设置默认分类选择
            // 设置默认分类选择（支持多选）
            if (this.defaultCategoryId && this.selectedCategoryIds.length === 0) {
                const ids = this.defaultCategoryId.split(',').map(id => id.trim()).filter(id => id);
                this.selectedCategoryIds.push(...ids);
            }

            const categoryButtons = this.dialog.element.querySelectorAll('.category-option');

            categoryButtons.forEach(button => {
                const categoryId = button.getAttribute('data-category');
                if (categoryId && this.selectedCategoryIds.includes(categoryId)) {
                    button.classList.add('selected');
                } else if (categoryId === '' && this.selectedCategoryIds.length === 0) {
                    // 如果没有选中任何分类，选中“无分类”
                    button.classList.add('selected');
                } else {
                    button.classList.remove('selected');
                }
            });

        } catch (error) {
            console.error('渲染分类选择器失败:', error);
            categorySelector.innerHTML = '<div class="category-error">加载分类失败</div>';
        }
    }

    private async renderTagsSelector() {
        const tagsGroup = this.dialog.element.querySelector('#quickTagsGroup') as HTMLElement;
        const tagsSelector = this.dialog.element.querySelector('#quickTagsSelector') as HTMLElement;

        if (!tagsSelector) return;

        // 获取当前选中的项目ID
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLInputElement;
        const projectId = projectSelector?.value;

        if (!projectId) {
            // 没有选中项目，隐藏标签选择器
            if (tagsGroup) tagsGroup.style.display = 'none';
            return;
        }

        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectTags = await projectManager.getProjectTags(projectId);

            if (projectTags.length === 0) {
                // 项目没有标签，隐藏选择器
                if (tagsGroup) tagsGroup.style.display = 'none';
                return;
            }

            // 显示标签选择器
            if (tagsGroup) tagsGroup.style.display = '';

            // 清空并重新渲染
            tagsSelector.innerHTML = '';

            // 获取当前任务的标签ID列表
            // 优先使用 selectedTagIds（用户当前选择），其次使用 reminder.tagIds（编辑模式的初始值）
            const currentTagIds = this.selectedTagIds.length > 0 ? this.selectedTagIds : (this.reminder?.tagIds || []);

            // 渲染每个标签
            projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                const tagEl = document.createElement('div');
                tagEl.className = 'tag-option';
                tagEl.setAttribute('data-tag-id', tag.id);

                const isSelected = currentTagIds.includes(tag.id);
                if (isSelected) {
                    tagEl.classList.add('selected');
                }

                tagEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 10px;
                    font-size: 12px;
                    border-radius: 12px;
                    background: ${isSelected ? tag.color : tag.color + '20'};
                    border: 1px solid ${tag.color};
                    color: ${isSelected ? '#fff' : 'var(--b3-theme-on-surface)'};
                    cursor: pointer;
                    transition: all 0.2s ease;
                    user-select: none;
                    font-weight: ${isSelected ? '600' : '500'};
                `;

                tagEl.textContent = `#${tag.name}`;
                tagEl.title = tag.name;

                // 点击切换选中状态
                tagEl.addEventListener('click', () => {
                    tagEl.classList.toggle('selected');
                    const isNowSelected = tagEl.classList.contains('selected');

                    // 更新 selectedTagIds
                    if (isNowSelected) {
                        if (!this.selectedTagIds.includes(tag.id)) {
                            this.selectedTagIds.push(tag.id);
                        }
                    } else {
                        const index = this.selectedTagIds.indexOf(tag.id);
                        if (index > -1) {
                            this.selectedTagIds.splice(index, 1);
                        }
                    }

                    // 更新样式
                    tagEl.style.background = isNowSelected ? tag.color : tag.color + '20';
                    tagEl.style.color = isNowSelected ? '#fff' : 'var(--b3-theme-on-surface)';
                    tagEl.style.fontWeight = isNowSelected ? '600' : '500';
                });

                // 悬停效果
                tagEl.addEventListener('mouseenter', () => {
                    tagEl.style.opacity = '0.8';
                    tagEl.style.transform = 'translateY(-1px)';
                });

                tagEl.addEventListener('mouseleave', () => {
                    tagEl.style.opacity = '1';
                    tagEl.style.transform = 'translateY(0)';
                });

                tagsSelector.appendChild(tagEl);
            });

        } catch (error) {
            console.error('加载项目标签失败:', error);
            if (tagsGroup) tagsGroup.style.display = 'none';
        }
    }

    // 渲染自定义时间列表
    // 渲染自定义时间列表
    private renderCustomTimeList() {
        const container = this.dialog.element.querySelector('#quickCustomTimeList') as HTMLElement;
        if (!container) return;
        // 渲染为多行可编辑输入：每行包含 datetime-local 输入、备注输入、移除按钮
        container.innerHTML = '';
        this.customTimes.forEach((item, index) => {
            if (!item) return;

            const row = document.createElement('div');
            row.className = 'custom-time-row';
            row.style.cssText = `
                display: flex;
                gap: 8px;
                align-items: center;
                width: 100%;
            `;

            const timeInput = document.createElement('input');
            timeInput.type = 'datetime-local';
            timeInput.className = 'b3-text-field';
            timeInput.style.cssText = 'flex: 1; min-width: 180px;';
            timeInput.value = item.time || '';

            const noteInput = document.createElement('input');
            noteInput.type = 'text';
            noteInput.className = 'b3-text-field';
            noteInput.placeholder = '备注';
            noteInput.style.cssText = 'width: 160px;';
            noteInput.value = item.note || '';

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'b3-button b3-button--outline';
            removeBtn.textContent = '移除';

            // 绑定事件：更新模型并避免空时间项
            timeInput.addEventListener('change', () => {
                const v = timeInput.value?.trim();
                if (!v) {
                    // 如果时间被清空，则移除该项
                    this.customTimes.splice(index, 1);
                    this.renderCustomTimeList();
                    return;
                }
                this.customTimes[index] = { time: v, note: this.customTimes[index]?.note || '' };
            });

            noteInput.addEventListener('input', () => {
                const v = noteInput.value?.trim();
                if (!this.customTimes[index]) {
                    this.customTimes[index] = { time: timeInput.value || '', note: v };
                } else {
                    this.customTimes[index].note = v;
                }
            });

            removeBtn.addEventListener('click', () => {
                this.customTimes.splice(index, 1);
                this.renderCustomTimeList();
            });

            row.appendChild(timeInput);
            row.appendChild(noteInput);
            row.appendChild(removeBtn);

            container.appendChild(row);
        });

        // 如果列表为空，则显示占位说明
        if (this.customTimes.length === 0) {
            const hint = document.createElement('div');
            hint.style.cssText = 'color: var(--b3-theme-on-surface-light); font-size: 12px; width:100%;';
            hint.textContent = '尚未添加自定义提醒时间；使用上方输入框或快速设置添加。';
            container.appendChild(hint);
        }
    }

    // 添加自定义时间
    private addCustomTime(time: string, note?: string) {
        if (!time) return;
        // 检查是否已存在相同时间
        const existingIndex = this.customTimes.findIndex(t => t && t.time === time);
        if (existingIndex >= 0) {
            // 更新备注
            this.customTimes[existingIndex].note = note;
        } else {
            this.customTimes.push({ time, note });
            this.customTimes.sort((a, b) => {
                if (!a || !a.time) return 1;
                if (!b || !b.time) return -1;
                return a.time.localeCompare(b.time);
            });
        }
        this.renderCustomTimeList();
    }

    /**
     * 更新提醒时间预设区域的显示状态
     * 当任务设置了具体时间时显示预设，否则隐藏
     */
    private updatePresetSelectState() {
        const presetContainer = this.dialog.element.querySelector('#quickPresetContainer') as HTMLElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;

        if (!presetContainer) return;

        const hasDateTime = dateInput?.value && timeInput?.value;

        // 根据是否有任务时间显示或隐藏预设区域
        presetContainer.style.display = hasDateTime ? 'block' : 'none';
    }

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#quickCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#quickConfirmBtn') as HTMLButtonElement;
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#quickPrioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#quickCategorySelector') as HTMLElement;
        const repeatSettingsBtn = this.dialog.element.querySelector('#quickRepeatSettingsBtn') as HTMLButtonElement;
        const manageCategoriesBtn = this.dialog.element.querySelector('#quickManageCategoriesBtn') as HTMLButtonElement;
        const nlBtn = this.dialog.element.querySelector('#quickNlBtn') as HTMLButtonElement;
        const createDocBtn = this.dialog.element.querySelector('#quickCreateDocBtn') as HTMLButtonElement;
        const pasteBlockRefBtn = this.dialog.element.querySelector('#quickPasteBlockRefBtn') as HTMLButtonElement;
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;
        const viewSubtasksBtn = this.dialog.element.querySelector('#quickViewSubtasksBtn') as HTMLButtonElement;
        const editAllInstancesBtn = this.dialog.element.querySelector('#quickEditAllInstancesBtn') as HTMLButtonElement;
        const viewPomodorosBtn = this.dialog.element.querySelector('#quickViewPomodorosBtn') as HTMLButtonElement;
        const durationInput = this.dialog.element.querySelector('#quickDurationDays') as HTMLInputElement;
        const syncBlockTitleBtn = this.dialog.element.querySelector('#quickSyncBlockTitleBtn') as HTMLButtonElement;
        const syncTitleToBlockBtn = this.dialog.element.querySelector('#quickSyncTitleToBlockBtn') as HTMLButtonElement;

        // 更新标题为绑定块内容
        syncBlockTitleBtn?.addEventListener('click', () => {
            if (this.blockContent && titleInput) {
                titleInput.value = this.blockContent.trim();
                this.autoResizeTextarea(titleInput);
                // 触发 input 事件以触发可能的联动（如自动日期识别）
                titleInput.dispatchEvent(new Event('input'));
                showMessage(i18n('reminderUpdated'));
            }
        });

        // 更新绑定块内容为当前标题
        syncTitleToBlockBtn?.addEventListener('click', async () => {
            const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
            const blockId = blockInput?.value?.trim();
            const title = titleInput?.value?.trim();
            if (blockId && title) {
                try {
                    // 获取当前块的 Markdown 以保留前缀（如 >, -, - [ ], 1. 等）
                    const block = await getBlockByID(blockId);
                    const originalMd = block?.markdown || '';

                    // 匹配前缀正则：包含空格、嵌套列表、引用、任务列表、标题等
                    // 注意：SiYuan 的任务列表在 SQL 的 markdown 字段中通常包含前缀
                    const prefixMatch = originalMd.match(/^(\s*(?:#+\s+|>|[-*+]\s+\[(?: |x|X)\]|[-*+]|\d+\.)\s*)/);
                    const prefix = prefixMatch ? prefixMatch[1] : '';

                    const newMarkdown = prefix + title;

                    await updateBlock("markdown", newMarkdown, blockId);
                    await refreshSql(); // 强制刷新 SQL 索引以确保后续 getBlockByID 获取最新内容
                    this.blockContent = title;
                    await this.updateBlockPreview(blockId);
                    showMessage(i18n('reminderUpdated'));
                } catch (error) {
                    console.error('更新块内容失败:', error);
                    showMessage(i18n('updateFailed') || '更新失败', 3000, 'error');
                }
            } else {
                showMessage(i18n('selectBlockFirst'), 3000, 'error');
            }
        });

        // 持续天数与日期的联动逻辑
        // 初始约束：结束日期不能早于开始日期
        if (startDateInput && startDateInput.value && endDateInput) {
            endDateInput.min = startDateInput.value;
        }

        // 只在编辑模式下，如果设置了开始但未设置结束，才使用持续天数来自动填充结束日期
        // 新建任务时不自动填充，除非用户手动修改了持续天数
        if (this.mode === 'edit' && startDateInput && startDateInput.value && endDateInput && !endDateInput.value && durationInput) {
            const days = parseInt(durationInput.value || '1') || 1;
            endDateInput.value = this.addDaysToDate(startDateInput.value, days - 1);
        }

        // 当开始日期变化，更新结束日期的最小值与自动计算
        startDateInput?.addEventListener('change', () => {
            if (!startDateInput || !startDateInput.value) return;
            if (endDateInput) endDateInput.min = startDateInput.value;

            // 只有在用户手动修改了持续天数，或者编辑模式下结束日期已存在时，才自动填充/更新结束日期
            if (endDateInput && !endDateInput.value && durationInput && this.durationManuallyChanged) {
                const days = parseInt(durationInput.value || '1') || 1;
                endDateInput.value = this.addDaysToDate(startDateInput.value, days - 1);
                endDateInput.dispatchEvent(new Event('change'));
            } else if (endDateInput && endDateInput.value && durationInput) {
                // 如果结束日期已存在，重新计算持续天数
                const dur = this.getDurationInclusive(startDateInput.value, endDateInput.value);
                durationInput.value = String(dur > 0 ? dur : 1);
            }
        });

        // 当持续天数变化，基于开始日期计算结束日期
        const normalizeDuration = () => {
            if (!durationInput) return;
            let val = parseInt(durationInput.value || '1', 10) || 1;
            if (val < 1) val = 1;
            durationInput.value = String(val);
            // 标记用户已手动修改持续天数
            this.durationManuallyChanged = true;
            if (startDateInput && startDateInput.value && endDateInput) {
                // 始终覆盖结束日期以保证与持续天数一致（当改为1时会设置为开始日期）
                endDateInput.value = this.addDaysToDate(startDateInput.value, val - 1);
                endDateInput.dispatchEvent(new Event('change'));
            }
        };

        durationInput?.addEventListener('input', normalizeDuration);
        durationInput?.addEventListener('change', normalizeDuration);
        durationInput?.addEventListener('blur', normalizeDuration);
        // 鼠标点击步进按钮 / 触摸 / 滚轮等可能不会触发 input 事件或值更新延迟，增加相关监听并在微任务中执行 normalize
        durationInput?.addEventListener('click', () => setTimeout(normalizeDuration, 0));
        durationInput?.addEventListener('pointerup', () => setTimeout(normalizeDuration, 0));
        durationInput?.addEventListener('mouseup', () => setTimeout(normalizeDuration, 0));
        // 有些浏览器的步进按钮触发 keydown(ArrowUp/Down)，延迟执行以读取最新值
        durationInput?.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setTimeout(normalizeDuration, 0);
        });

        // 当结束日期变化，基于开始日期计算持续天数
        endDateInput?.addEventListener('change', () => {
            if (!endDateInput) return;
            if (!startDateInput || !startDateInput.value) return;
            if (!endDateInput.value) {
                if (durationInput) durationInput.value = '1';
                return;
            }
            // 如果结束日期早于开始日期，修正为开始日期
            if (compareDateStrings(endDateInput.value, startDateInput.value) < 0) {
                endDateInput.value = startDateInput.value;
                if (durationInput) durationInput.value = '1';
            } else {
                if (durationInput) {
                    const dur = this.getDurationInclusive(startDateInput.value, endDateInput.value);
                    durationInput.value = String(dur > 0 ? dur : 1);
                }
            }
        });

        // 查看/新建子任务
        viewSubtasksBtn?.addEventListener('click', () => {
            if (this.mode === 'edit' && this.reminder && this.reminder.id) {
                // 编辑模式：使用正常的子任务对话框
                // 判断是否编辑所有实例：非实例编辑模式且是重复任务
                const isModifyAllInstances = !this.isInstanceEdit && this.reminder.repeat?.enabled;
                const subtasksDialog = new SubtasksDialog(
                    this.reminder.id,
                    this.plugin,
                    () => {
                        this.updateSubtasksDisplay();
                    },
                    [],
                    undefined,
                    this.isInstanceEdit,
                    isModifyAllInstances
                );
                subtasksDialog.show();
            } else if (this.mode !== 'edit') {
                // 新建模式：使用临时子任务模式
                const subtasksDialog = new SubtasksDialog('', this.plugin, () => {
                    this.updateSubtasksDisplay();
                }, this.tempSubtasks, (updatedSubtasks) => {
                    this.tempSubtasks = updatedSubtasks;
                    this.updateSubtasksDisplay();
                });
                subtasksDialog.show();
            }
        });

        // 编辑所有实例
        editAllInstancesBtn?.addEventListener('click', () => {
            this.editAllInstances();
        });

        // 查看番茄钟
        viewPomodorosBtn?.addEventListener('click', () => {
            if (this.reminder && this.reminder.id) {
                // 判断是否为"修改全部实例"模式
                // 如果是修改全部实例（非实例编辑模式且是重复任务），显示原始任务及所有实例的番茄钟
                // 如果是实例编辑模式，只显示本实例的番茄钟
                const isModifyAllInstances = !this.isInstanceEdit && this.reminder.repeat?.enabled;



                // 确定目标ID：
                // - 实例编辑模式：使用实例ID（补录番茄钟关联到实例）
                // - 修改全部实例模式：使用原始ID（补录番茄钟关联到原始任务）
                // - 普通任务：使用当前ID
                let targetId = this.reminder.id;
                if (isModifyAllInstances && this.reminder.originalId) {
                    targetId = this.reminder.originalId;
                }
                // 注意：实例编辑模式保持使用 this.reminder.id（实例ID）

                const pomodorosDialog = new PomodoroSessionsDialog(targetId, this.plugin, () => {
                    this.updatePomodorosDisplay();
                }, isModifyAllInstances); // 传递 includeInstances 参数
                pomodorosDialog.show();
            }
        });

        // 标题输入框粘贴事件处理
        titleInput?.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = e.clipboardData?.getData('text') || '';
            const lines = pastedText.split('\n').map(line => line.trim()).filter(line => line);

            if (lines.length > 0) {
                // 插入第一行到光标处
                const start = titleInput.selectionStart || 0;
                const end = titleInput.selectionEnd || 0;
                const before = titleInput.value.substring(0, start);
                const after = titleInput.value.substring(end);
                titleInput.value = before + lines[0] + after;
                titleInput.selectionStart = titleInput.selectionEnd = start + lines[0].length;

                // 如果有多行，后面的行放到备注
                if (lines.length > 1) {
                    if (this.editor) {
                        const existingNote = this.currentNote;
                        const newNote = lines.slice(1).join('\n');
                        this.editor.action(replaceAll(existingNote ? existingNote + '\n' + newNote : newNote));
                    }
                }

                // 如果启用了自动识别，检测日期时间
                const pasteAutoDetect = this.dialog.element.querySelector('#quickPasteAutoDetect') as HTMLInputElement;
                if (pasteAutoDetect && pasteAutoDetect.checked) {
                    // 使用粘贴的所有非空行进行识别，以便第二行或后续行中的自然语言也能被识别
                    const joined = lines.join(' ');
                    const detected = autoDetectDateTimeFromTitle(joined);
                    if (detected && (detected.date || detected.endDate)) {
                        this.applyNaturalLanguageResult(detected);

                        // 识别后移除日期
                        this.plugin.getRemoveDateAfterDetectionEnabled().then((removeEnabled: boolean) => {
                            if (removeEnabled && detected.cleanTitle !== undefined) {
                                // 重新计算 titleInput 的值，将粘贴的那部分替换为清理后的文本
                                const cleanPart = detected.cleanTitle || '';
                                titleInput.value = before + cleanPart + after;
                                titleInput.selectionStart = titleInput.selectionEnd = start + cleanPart.length;
                            }
                        });
                    }
                }
            }
        });

        // 标题输入时自动调整高度
        titleInput?.addEventListener('input', () => {
            if (titleInput) {
                this.autoResizeTextarea(titleInput);
            }
        });

        // 自定义提醒时间相关元素
        const showCustomTimeBtn = this.dialog.element.querySelector('#quickShowCustomTimeBtn') as HTMLButtonElement;
        const confirmCustomTimeBtn = this.dialog.element.querySelector('#quickConfirmCustomTimeBtn') as HTMLButtonElement;
        const cancelCustomTimeBtn = this.dialog.element.querySelector('#quickCancelCustomTimeBtn') as HTMLButtonElement;
        const customTimeInputArea = this.dialog.element.querySelector('#quickCustomTimeInputArea') as HTMLElement;
        const customReminderInput = this.dialog.element.querySelector('#quickCustomReminderTime') as HTMLInputElement;
        const customReminderNoteInput = this.dialog.element.querySelector('#quickCustomReminderNote') as HTMLInputElement;

        // 显示/隐藏自定义时间输入区域
        showCustomTimeBtn?.addEventListener('click', () => {
            if (customTimeInputArea) {
                customTimeInputArea.style.display = 'block';
                showCustomTimeBtn.style.display = 'none';
                // 自动聚焦到日期输入框
                setTimeout(() => customReminderInput?.focus(), 100);
            }
        });

        // 确认添加自定义时间
        confirmCustomTimeBtn?.addEventListener('click', () => {
            const timeVal = customReminderInput?.value?.trim();
            const noteVal = customReminderNoteInput?.value?.trim() || '';
            if (timeVal) {
                this.addCustomTime(timeVal, noteVal);
                customReminderInput.value = '';
                if (customReminderNoteInput) customReminderNoteInput.value = '';
                // 隐藏输入区域，显示添加按钮
                if (customTimeInputArea) {
                    customTimeInputArea.style.display = 'none';
                    showCustomTimeBtn.style.display = 'flex';
                }
            } else {
                showMessage(i18n("pleaseEnterReminderTime") || "请输入提醒时间", 3000, "error");
            }
        });

        // 取消添加自定义时间
        cancelCustomTimeBtn?.addEventListener('click', () => {
            if (customTimeInputArea) {
                customTimeInputArea.style.display = 'none';
                showCustomTimeBtn.style.display = 'flex';
                // 清空输入
                customReminderInput.value = '';
                if (customReminderNoteInput) customReminderNoteInput.value = '';
            }
        });

        // 回车键快速确认添加
        customReminderInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                confirmCustomTimeBtn?.click();
            }
        });


        // 优先级选择事件
        prioritySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.priority-option') as HTMLElement;
            if (option) {
                prioritySelector.querySelectorAll('.priority-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 分类选择事件
        categorySelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                const categoryId = option.getAttribute('data-category');

                if (!categoryId) {
                    // 如果选择了“无分类”，清空选中的分类
                    this.selectedCategoryIds = [];
                } else {
                    // 如果选择了具体分类
                    if (this.selectedCategoryIds.includes(categoryId)) {
                        // 如果已选中，则取消选中
                        this.selectedCategoryIds = this.selectedCategoryIds.filter(id => id !== categoryId);
                    } else {
                        // 如果未选中，则添加
                        this.selectedCategoryIds.push(categoryId);
                    }
                }

                // 更新UI显示
                const buttons = categorySelector.querySelectorAll('.category-option');
                buttons.forEach(btn => {
                    const id = btn.getAttribute('data-category');
                    if (this.selectedCategoryIds.length === 0) {
                        // 如果没有选中的，高亮“无分类”
                        if (!id) btn.classList.add('selected');
                        else btn.classList.remove('selected');
                    } else {
                        // 如果有选中的，根据ID高亮
                        if (id && this.selectedCategoryIds.includes(id)) {
                            btn.classList.add('selected');
                        } else {
                            btn.classList.remove('selected');
                        }
                    }
                });

                // 添加点击反馈动画
                option.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    option.style.transform = '';
                }, 150);
            }
        });

        // 任务状态选择事件
        const statusSelector = this.dialog.element.querySelector('#quickStatusSelector') as HTMLElement;
        statusSelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.task-status-option') as HTMLElement;
            if (option) {
                statusSelector.querySelectorAll('.task-status-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            this.destroyDialog();
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveReminder();
        });

        // Ctrl+Enter 自动保存关闭弹窗
        this.dialog.element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.saveReminder();
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // 日期验证
        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            // 设置结束日期的最小值
            endDateInput.min = startDate;
            // 更新预设下拉状态
            this.updatePresetSelectState();
        });

        // 结束日期验证
        endDateInput?.addEventListener('change', () => {
            // 移除立即验证逻辑，只在保存时验证
        });

        // 时间输入框变化时更新预设下拉状态
        timeInput?.addEventListener('change', () => {
            this.updatePresetSelectState();
        });

        // 结束时间输入框变化时更新预设下拉状态
        endTimeInput?.addEventListener('change', () => {
            // 结束时间不影响预设计算，只基于开始时间
        });

        // 清除开始日期按钮
        const clearStartDateBtn = this.dialog.element.querySelector('#quickClearStartDateBtn') as HTMLButtonElement;
        clearStartDateBtn?.addEventListener('click', () => {
            const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
            if (dateInput) {
                dateInput.value = '';
                // 更新预设下拉状态
                this.updatePresetSelectState();
            }
        });

        // 清除开始时间按钮
        const clearStartTimeBtn = this.dialog.element.querySelector('#quickClearStartTimeBtn') as HTMLButtonElement;
        clearStartTimeBtn?.addEventListener('click', () => {
            const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
            if (timeInput) {
                timeInput.value = '';
                // 更新预设下拉状态
                this.updatePresetSelectState();
            }
        });

        // 清除结束日期按钮
        const clearEndDateBtn = this.dialog.element.querySelector('#quickClearEndDateBtn') as HTMLButtonElement;
        clearEndDateBtn?.addEventListener('click', () => {
            const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
            if (endDateInput) {
                endDateInput.value = '';
            }
        });

        // 清除结束时间按钮
        const clearEndTimeBtn = this.dialog.element.querySelector('#quickClearEndTimeBtn') as HTMLButtonElement;
        clearEndTimeBtn?.addEventListener('click', () => {
            const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
            if (endTimeInput) {
                endTimeInput.value = '';
            }
        });

        // 重复设置按钮
        repeatSettingsBtn?.addEventListener('click', () => {
            this.showRepeatSettingsDialog();
        });

        // 管理分类按钮事件
        manageCategoriesBtn?.addEventListener('click', () => {
            this.showCategoryManageDialog();
        });

        // 自然语言识别按钮
        nlBtn?.addEventListener('click', () => {
            this.showNaturalLanguageDialog();
        });

        // 新建文档按钮
        createDocBtn?.addEventListener('click', () => {
            this.showCreateDocumentDialog();
        });

        // 粘贴块引用/链接按钮
        pasteBlockRefBtn?.addEventListener('click', async () => {
            try {
                const clipboardText = await navigator.clipboard.readText();
                if (!clipboardText) return;

                const blockRefRegex = /\(\(([\w\-]+)\s+'(.*)'\)\)/;
                const blockLinkRegex = /\[(.*)\]\(siyuan:\/\/blocks\/([\w\-]+)\)/;

                let blockId: string | undefined;
                let title: string | undefined;

                const refMatch = clipboardText.match(blockRefRegex);
                if (refMatch) {
                    blockId = refMatch[1];
                    title = refMatch[2];
                } else {
                    const linkMatch = clipboardText.match(blockLinkRegex);
                    if (linkMatch) {
                        title = linkMatch[1];
                        blockId = linkMatch[2];
                    }
                }

                if (blockId) {
                    const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
                    const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;

                    if (blockInput) {
                        blockInput.value = blockId;
                        this.updateBlockPreview(blockId);
                    }
                    if (titleInput && title && (!titleInput.value || titleInput.value.trim().length === 0)) {
                        titleInput.value = title;
                    }
                    showMessage(i18n('pasteBlockRefSuccess'));
                } else {
                    showMessage(i18n('pasteBlockRefFailed'), 3000, 'error');
                }
            } catch (error) {
                console.error('读取剪贴板失败:', error);
                showMessage(i18n('readClipboardFailed'), 3000, 'error');
            }
        });

        // 规范化 quickBlockInput：当用户直接粘贴 ((id 'title')) 或链接时，自动替换为纯 id 并设置标题
        const quickBlockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        if (quickBlockInput) {
            let isAutoSetting = false;
            quickBlockInput.addEventListener('input', async () => {
                if (isAutoSetting) return;
                const raw = quickBlockInput.value?.trim();
                if (!raw) {
                    this.updateBlockPreview('');
                    return;
                }

                const blockRefRegex = /\(\(([\w\-]+)\s+'(.*)'\)\)/;
                const blockLinkRegex = /\[(.*)\]\(siyuan:\/\/blocks\/([\w\-]+)\)/;
                const urlRegex = /siyuan:\/\/blocks\/([\w\-]+)/;

                let blockId: string | null = null;
                let extractedTitle: string | null = null;

                let match = raw.match(blockRefRegex);
                if (match) {
                    blockId = match[1];
                    extractedTitle = match[2];
                } else {
                    match = raw.match(blockLinkRegex);
                    if (match) {
                        extractedTitle = match[1];
                        blockId = match[2];
                    } else {
                        match = raw.match(urlRegex);
                        if (match) {
                            blockId = match[1];
                        }
                    }
                }

                if (blockId && (raw.includes('((') || raw.includes('siyuan://blocks/') || raw.includes(']('))) {
                    try {
                        isAutoSetting = true;
                        quickBlockInput.value = blockId;

                        // 如果标题输入框为空，自动设置标题
                        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;
                        if (titleInput && extractedTitle && (!titleInput.value || titleInput.value.trim().length === 0)) {
                            titleInput.value = extractedTitle;
                        }

                        this.updateBlockPreview(blockId);
                    } finally {
                        setTimeout(() => { isAutoSetting = false; }, 0);
                    }
                } else {
                    this.updateBlockPreview(raw);
                }
            });
        }

        // 预设下拉：根据选项快速设置自定义提醒时间（基于任务的起始 datetime）
        const presetSelect = this.dialog.element.querySelector('#quickCustomReminderPreset') as HTMLSelectElement;
        // const customReminderInput = this.dialog.element.querySelector('#quickCustomReminderTime') as HTMLInputElement; // Already declared above
        presetSelect?.addEventListener('change', () => {
            try {
                const val = presetSelect.value;
                if (!val) return;

                const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;

                // 仅在任务已设置日期和时间时可用
                if (!dateInput || !dateInput.value || !timeInput || !timeInput.value) {
                    showMessage('请先为任务设置日期和时间，然后使用快速设置。');
                    presetSelect.value = '';
                    return;
                }

                const base = new Date(`${dateInput.value}T${timeInput.value}`);
                if (isNaN(base.getTime())) {
                    presetSelect.value = '';
                    return;
                }

                let offsetMinutes = 0;
                switch (val) {
                    case '5m': offsetMinutes = 5; break;
                    case '10m': offsetMinutes = 10; break;
                    case '30m': offsetMinutes = 30; break;
                    case '1h': offsetMinutes = 60; break;
                    case '2h': offsetMinutes = 120; break;
                    case '1d': offsetMinutes = 24 * 60; break;
                    default: offsetMinutes = 0;
                }

                const target = new Date(base.getTime() - offsetMinutes * 60 * 1000);

                const yyyy = target.getFullYear().toString().padStart(4, '0');
                const mm = (target.getMonth() + 1).toString().padStart(2, '0');
                const dd = target.getDate().toString().padStart(2, '0');
                const hh = target.getHours().toString().padStart(2, '0');
                const min = target.getMinutes().toString().padStart(2, '0');

                const dtLocal = `${yyyy}-${mm}-${dd}T${hh}:${min}`;

                // 自动添加到提醒时间列表
                const note = customReminderNoteInput?.value?.trim();
                this.addCustomTime(dtLocal, note);

                // 清空输入框，方便继续添加
                if (customReminderNoteInput) customReminderNoteInput.value = '';

                // 重置预设选择
                presetSelect.value = '';
            } catch (e) {
                console.error('应用快速预设失败:', e);
            }
        });

        // 如果 custom input 聚焦且为空，尝试从任务日期和时间初始化
        customReminderInput?.addEventListener('focus', () => {
            try {
                if (customReminderInput.value) return;
                const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
                // 仅在任务设置了日期和时间时初始化
                if (dateInput && timeInput && dateInput.value && timeInput.value) {
                    customReminderInput.value = `${dateInput.value}T${timeInput.value}`;
                }
            } catch (e) {
                console.warn('初始化自定义提醒时间失败:', e);
            }
        });

        // Available Today checkbox event
        const isAvailableTodayCheckbox = this.dialog.element.querySelector('#quickIsAvailableToday') as HTMLInputElement;
        const availableDateGroup = this.dialog.element.querySelector('#quickAvailableDateGroup') as HTMLElement;
        const availableStartDateInput = this.dialog.element.querySelector('#quickAvailableStartDate') as HTMLInputElement;

        isAvailableTodayCheckbox?.addEventListener('change', () => {
            if (availableDateGroup) {
                availableDateGroup.style.display = isAvailableTodayCheckbox.checked ? 'block' : 'none';
                if (isAvailableTodayCheckbox.checked && availableStartDateInput && !availableStartDateInput.value) {
                    // Set default start date to today if empty
                    availableStartDateInput.value = getLogicalDateString();
                }
            }
        });

        // 查看父任务按钮事件
        const viewParentBtn = this.dialog.element.querySelector('#quickViewParentBtn') as HTMLButtonElement;
        viewParentBtn?.addEventListener('click', async () => {
            await this.viewParentTask();
        });

        // 完成时间相关按钮事件
        const setCompletedNowBtn = this.dialog.element.querySelector('#quickSetCompletedNowBtn') as HTMLButtonElement;
        const clearCompletedBtn = this.dialog.element.querySelector('#quickClearCompletedBtn') as HTMLButtonElement;
        const completedTimeInput = this.dialog.element.querySelector('#quickCompletedTime') as HTMLInputElement;

        setCompletedNowBtn?.addEventListener('click', () => {
            if (completedTimeInput) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                completedTimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
            }
        });

        clearCompletedBtn?.addEventListener('click', () => {
            if (completedTimeInput) {
                completedTimeInput.value = '';
            }
        });

        // 网页链接打开按钮
        const openUrlBtn = this.dialog.element.querySelector('#quickOpenUrlBtn') as HTMLButtonElement;
        const urlInput = this.dialog.element.querySelector('#quickUrlInput') as HTMLInputElement;
        openUrlBtn?.addEventListener('click', () => {
            const url = urlInput?.value?.trim();
            if (url) {
                if (!/^https?:\/\//i.test(url)) {
                    window.open('http://' + url, '_blank');
                } else {
                    window.open(url, '_blank');
                }
            } else {
                showMessage(i18n("pleaseEnterUrl") || "请输入链接地址");
            }
        });
    }

    private showRepeatSettingsDialog() {
        // 获取当前设置的开始日期
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        let startDate = startDateInput?.value;

        // 如果没有设置开始日期，使用初始日期或今天的日期
        if (!startDate) {
            startDate = this.initialDate;
        }

        // 如果是农历重复类型，需要重新计算农历日期
        if (this.repeatConfig.enabled &&
            (this.repeatConfig.type === 'lunar-monthly' || this.repeatConfig.type === 'lunar-yearly')) {
            // 清除现有的农历日期，让 RepeatSettingsDialog 重新计算
            this.repeatConfig.lunarDay = undefined;
            this.repeatConfig.lunarMonth = undefined;
        }

        const repeatDialog = new RepeatSettingsDialog(this.repeatConfig, (config: RepeatConfig) => {
            this.repeatConfig = config;
            this.updateRepeatDescription();
        }, startDate);
        repeatDialog.show();
    }

    private updateRepeatDescription() {
        const repeatDescription = this.dialog.element.querySelector('#quickRepeatDescription') as HTMLElement;
        if (repeatDescription) {
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : i18n("noRepeat");
            repeatDescription.textContent = description;
        }
    }

    private showCategoryManageDialog() {
        const categoryDialog = new CategoryManageDialog(this.plugin, () => {
            // 分类更新后重新渲染分类选择器
            this.renderCategorySelector();
        });
        categoryDialog.show();
    }

    private async renderProjectSelector() {
        const searchInput = this.dialog.element.querySelector('#quickProjectSearchInput') as HTMLInputElement;
        const hiddenInput = this.dialog.element.querySelector('#quickProjectSelector') as HTMLInputElement;
        const dropdown = this.dialog.element.querySelector('#quickProjectDropdown') as HTMLElement;

        if (!searchInput || !hiddenInput || !dropdown) return;

        try {
            await this.projectManager.initialize();
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 生成内容
            let html = '';

            // 无项目选项
            html += `<div class="b3-menu__item" data-value="" data-label="${i18n('noProject')}"><span class="b3-menu__label">${i18n('noProject')}</span></div>`;

            // 按状态分组添加项目
            Object.keys(groupedProjects).forEach(statusKey => {
                const projects = groupedProjects[statusKey] || [];
                const nonArchivedProjects = projects.filter(project => {
                    const projectStatus = this.projectManager.getProjectById(project.id)?.status || 'doing';
                    return projectStatus !== 'archived';
                });

                if (nonArchivedProjects.length > 0) {
                    // 排序逻辑 (Reuse existing sort logic)
                    nonArchivedProjects.sort((a, b) => {
                        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
                        const priorityA = priorityOrder[(a as any).priority || 'none'] || 0;
                        const priorityB = priorityOrder[(b as any).priority || 'none'] || 0;
                        if (priorityA !== priorityB) {
                            return priorityB - priorityA;
                        }
                        const sortA = (a as any).sort || 0;
                        const sortB = (b as any).sort || 0;
                        if (sortA !== sortB) {
                            return sortA - sortB;
                        }
                        const dateA = (a as any).startDate || (a as any).createdTime || '';
                        const dateB = (b as any).startDate || (b as any).createdTime || '';
                        return dateA.localeCompare(dateB);
                    });

                    const statusName = this.getStatusDisplayName(statusKey);

                    // 使用分组包裹以便于搜索过滤时处理标题显示
                    html += `<div class="project-group">
                        <div class="b3-menu__separator"></div>
                        <div class="b3-menu__item b3-menu__item--readonly" style="font-size: 12px; opacity: 0.6; cursor: default;">${statusName}</div>
                        ${nonArchivedProjects.map(p =>
                        `<div class="b3-menu__item" data-value="${p.id}" data-label="${p.name}"><span class="b3-menu__label">${p.name}</span></div>`
                    ).join('')}
                    </div>`;
                }
            });

            dropdown.innerHTML = html;

            // 事件绑定
            // 事件绑定
            const showAllOptions = () => {
                dropdown.style.display = 'block';
                // 显示所有选项，忽略当前输入框的值
                const items = dropdown.querySelectorAll('.b3-menu__item[data-value]');
                items.forEach((item: HTMLElement) => {
                    item.style.display = 'block';
                });
                // 显示所有分组
                const groups = dropdown.querySelectorAll('.project-group');
                groups.forEach((group: HTMLElement) => {
                    group.style.display = 'block';
                });
            };

            const hideDropdown = () => {
                // 延迟隐藏，允许点击事件发生
                setTimeout(() => {
                    dropdown.style.display = 'none';
                    // 如果输入框内容不是有效的选项，重置为当前选中项的标签
                    const currentId = hiddenInput.value;
                    const item = dropdown.querySelector(`.b3-menu__item[data-value="${currentId}"]`);
                    if (item) {
                        searchInput.value = item.getAttribute('data-label') || '';
                    } else if (!currentId) {
                        searchInput.value = '';
                    }
                }, 200);
            };

            const filterOptions = (term: string) => {
                // Support multiple search terms separated by space
                const terms = term.toLowerCase().split(/\s+/).filter(t => t);
                const items = dropdown.querySelectorAll('.b3-menu__item[data-value]');
                items.forEach((item: HTMLElement) => {
                    const label = item.getAttribute('data-label')?.toLowerCase() || '';
                    // Check if all terms are present in the label
                    const match = terms.length === 0 || terms.every(t => label.includes(t));
                    item.style.display = match ? 'block' : 'none';
                });

                // 处理分组标题显示：如果分组内有可见项，则显示分组
                const groups = dropdown.querySelectorAll('.project-group');
                groups.forEach((group: HTMLElement) => {
                    const visibleItems = group.querySelectorAll('.b3-menu__item[data-value]:not([style*="display: none"])');
                    group.style.display = visibleItems.length > 0 ? 'block' : 'none';
                });
            };

            searchInput.addEventListener('focus', showAllOptions);
            searchInput.addEventListener('click', showAllOptions);
            searchInput.addEventListener('blur', hideDropdown);
            searchInput.addEventListener('input', () => {
                dropdown.style.display = 'block';
                filterOptions(searchInput.value);
            });

            dropdown.addEventListener('click', async (e) => {
                const target = (e.target as HTMLElement).closest('.b3-menu__item');
                if (target && !target.classList.contains('b3-menu__item--readonly')) {
                    const val = target.getAttribute('data-value');
                    const label = target.getAttribute('data-label');

                    hiddenInput.value = val || '';
                    searchInput.value = val ? (label || '') : '';

                    // 触发变更
                    await this.onProjectChange(val || '');
                }
            });

            // 初始化默认值
            if (this.defaultProjectId) {
                hiddenInput.value = this.defaultProjectId;
                const item = dropdown.querySelector(`.b3-menu__item[data-value="${this.defaultProjectId}"]`);
                if (item) {
                    searchInput.value = item.getAttribute('data-label') || '';
                }
                await this.onProjectChange(this.defaultProjectId);
            }

        } catch (error) {
            console.error('渲染项目选择器失败:', error);
        }
    }

    private getStatusDisplayName(statusKey: string): string {
        const status = this.projectManager.getStatusManager().getStatusById(statusKey);
        return status?.name || statusKey;
    }

    /**
     * 项目选择器改变时的处理方法
     */
    private async onProjectChange(projectId: string) {
        const customGroupContainer = this.dialog.element.querySelector('#quickCustomGroup') as HTMLElement;
        if (!customGroupContainer) return;

        if (projectId) {
            // 检查项目是否有自定义分组
            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const projectGroups = await projectManager.getProjectCustomGroups(projectId);
                // 过滤掉已归档的分组
                const activeGroups = projectGroups.filter((g: any) => !g.archived);

                if (activeGroups.length > 0) {
                    // 显示分组选择器并渲染分组选项
                    customGroupContainer.style.display = 'block';
                    await this.renderCustomGroupSelector(projectId);

                    // 渲染里程碑（根据当前选中的分组）
                    const groupSelector = this.dialog.element.querySelector('#quickCustomGroupSelector') as HTMLInputElement;
                    await this.renderMilestoneSelector(projectId, groupSelector?.value);
                } else {
                    // 隐藏分组选择器
                    customGroupContainer.style.display = 'none';
                    // 渲染项目级里程碑
                    await this.renderMilestoneSelector(projectId);
                }

                // 加载项目的kanbanStatuses并更新任务状态选择器
                this.currentKanbanStatuses = await projectManager.getProjectKanbanStatuses(projectId);
                this.updateKanbanStatusSelector();
            } catch (error) {
                console.error('检查项目分组失败:', error);
                customGroupContainer.style.display = 'none';
            }
        } else {
            // 没有选择项目，隐藏分组选择器
            customGroupContainer.style.display = 'none';
            // 使用默认kanbanStatuses
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            this.currentKanbanStatuses = projectManager.getDefaultKanbanStatuses();
            this.updateKanbanStatusSelector();
        }

        // 更新标签选择器
        await this.renderTagsSelector();
    }

    /**
     * 渲染自定义分组选择器
     */
    private async renderCustomGroupSelector(projectId: string) {
        const searchInput = this.dialog.element.querySelector('#quickCustomGroupSearchInput') as HTMLInputElement;
        const hiddenInput = this.dialog.element.querySelector('#quickCustomGroupSelector') as HTMLInputElement;
        const dropdown = this.dialog.element.querySelector('#quickCustomGroupDropdown') as HTMLElement;

        if (!searchInput || !hiddenInput || !dropdown) return;

        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(projectId);
            // 过滤掉已归档的分组
            const activeGroups = projectGroups.filter((g: any) => !g.archived);

            // 清空并重新构建分组选择器
            let html = '';

            // 添加无分组选项
            html += `<div class="b3-menu__item" data-value="" data-label="${i18n('noGroup') || '无分组'}"><span class="b3-menu__label">${i18n('noGroup') || '无分组'}</span></div>`;

            // 添加所有未归档分组选项
            activeGroups.forEach((group: any) => {
                const label = `${group.icon || '📋'} ${group.name}`.trim();
                html += `<div class="b3-menu__item" data-value="${group.id}" data-label="${label}"><span class="b3-menu__label">${label}</span></div>`;
            });

            dropdown.innerHTML = html;

            // 事件绑定
            // 事件绑定
            const showAllOptions = () => {
                dropdown.style.display = 'block';
                // 显示所有选项
                const items = dropdown.querySelectorAll('.b3-menu__item[data-value]');
                items.forEach((item: HTMLElement) => {
                    item.style.display = 'block';
                });
            };

            const hideDropdown = () => {
                setTimeout(() => {
                    dropdown.style.display = 'none';
                    // 如果输入框内容不是有效的选项，重置
                    const currentId = hiddenInput.value;
                    const item = dropdown.querySelector(`.b3-menu__item[data-value="${currentId}"]`);
                    if (item) {
                        searchInput.value = item.getAttribute('data-label') || '';
                    } else if (!currentId) {
                        searchInput.value = '';
                    }
                }, 200);
            };

            const filterOptions = (term: string) => {
                const terms = term.toLowerCase().split(/\s+/).filter(t => t);
                const items = dropdown.querySelectorAll('.b3-menu__item[data-value]');
                items.forEach((item: HTMLElement) => {
                    const label = item.getAttribute('data-label')?.toLowerCase() || '';
                    const match = terms.length === 0 || terms.every(t => label.includes(t));
                    item.style.display = match ? 'block' : 'none';
                });
            };

            searchInput.addEventListener('focus', showAllOptions);
            searchInput.addEventListener('click', showAllOptions);
            searchInput.addEventListener('blur', hideDropdown);
            searchInput.addEventListener('input', () => {
                dropdown.style.display = 'block';
                filterOptions(searchInput.value);
            });

            dropdown.addEventListener('click', async (e) => {
                const target = (e.target as HTMLElement).closest('.b3-menu__item');
                if (target) {
                    const val = target.getAttribute('data-value');
                    const label = target.getAttribute('data-label');

                    hiddenInput.value = val || '';
                    searchInput.value = val ? (label || '') : '';

                    // 触发变更：更新里程碑
                    await this.renderMilestoneSelector(projectId, val || '');
                }
            });

            // Set default value
            if (this['defaultCustomGroupId'] !== undefined) {
                const val = this['defaultCustomGroupId'] === null ? '' : this['defaultCustomGroupId'];
                hiddenInput.value = val;
                const item = dropdown.querySelector(`.b3-menu__item[data-value="${val}"]`);
                if (item) {
                    searchInput.value = item.getAttribute('data-label') || '';
                }
            }

        } catch (error) {
            console.error('渲染自定义分组选择器失败:', error);
        }
    }

    private async renderMilestoneSelector(projectId: string, groupId?: string) {
        const milestoneGroup = this.dialog.element.querySelector('#quickMilestoneGroup') as HTMLElement;
        const searchInputText = this.dialog.element.querySelector('#quickMilestoneSearchInput') as HTMLInputElement;
        const hiddenInput = this.dialog.element.querySelector('#quickMilestoneSelector') as HTMLInputElement;
        const dropdownEl = this.dialog.element.querySelector('#quickMilestoneDropdown') as HTMLElement;

        if (!milestoneGroup || !searchInputText || !hiddenInput || !dropdownEl) return;

        // 默认隐藏
        milestoneGroup.style.display = 'none';

        if (!projectId) return;

        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            let milestones: any[] = [];

            // 获取里程碑列表
            if (groupId && groupId !== 'none' && groupId !== '') {
                milestones = await projectManager.getGroupMilestones(projectId, groupId);
            } else {
                milestones = await projectManager.getProjectMilestones(projectId);
            }

            // 过滤掉已归档的里程碑
            milestones = milestones.filter(m => !m.archived);

            // 只有当有里程碑时才显示选择器
            if (milestones.length > 0) {
                let html = '';
                // 添加无里程碑选项
                html += `<div class="b3-menu__item" data-value="" data-label="${i18n("noMilestone") || "无里程碑"}"><span class="b3-menu__label">${i18n("noMilestone") || "无里程碑"}</span></div>`;

                milestones.forEach(m => {
                    const label = `${m.icon ? m.icon + ' ' : ''}${m.name}`.trim();
                    html += `<div class="b3-menu__item" data-value="${m.id}" data-label="${label}"><span class="b3-menu__label">${label}</span></div>`;
                });

                // 为了防止重复绑定事件，克隆节点
                const searchInput = searchInputText.cloneNode(true) as HTMLInputElement;
                searchInputText.parentNode?.replaceChild(searchInput, searchInputText);

                const dropdown = dropdownEl.cloneNode(true) as HTMLElement;
                dropdownEl.parentNode?.replaceChild(dropdown, dropdownEl);

                dropdown.innerHTML = html;
                milestoneGroup.style.display = 'block';

                // 事件绑定
                const showAllOptions = () => {
                    dropdown.style.display = 'block';
                    const items = dropdown.querySelectorAll('.b3-menu__item[data-value]');
                    items.forEach((item: HTMLElement) => {
                        item.style.display = 'block';
                    });
                };

                const hideDropdown = () => {
                    setTimeout(() => {
                        dropdown.style.display = 'none';
                        const currentId = hiddenInput.value;
                        const item = dropdown.querySelector(`.b3-menu__item[data-value="${currentId}"]`);
                        if (item) {
                            searchInput.value = item.getAttribute('data-label') || '';
                        } else if (!currentId) {
                            searchInput.value = '';
                        }
                    }, 200);
                };

                const filterOptions = (term: string) => {
                    const terms = term.toLowerCase().split(/\s+/).filter(t => t);
                    const items = dropdown.querySelectorAll('.b3-menu__item[data-value]');
                    items.forEach((item: HTMLElement) => {
                        const label = item.getAttribute('data-label')?.toLowerCase() || '';
                        const match = terms.length === 0 || terms.every(t => label.includes(t));
                        item.style.display = match ? 'block' : 'none';
                    });
                };

                searchInput.addEventListener('focus', showAllOptions);
                searchInput.addEventListener('click', showAllOptions);
                searchInput.addEventListener('blur', hideDropdown);
                searchInput.addEventListener('input', () => {
                    dropdown.style.display = 'block';
                    filterOptions(searchInput.value);
                });

                dropdown.addEventListener('click', (e) => {
                    const target = (e.target as HTMLElement).closest('.b3-menu__item');
                    if (target) {
                        const val = target.getAttribute('data-value');
                        const label = target.getAttribute('data-label');

                        hiddenInput.value = val || '';
                        searchInput.value = val ? (label || '') : '';
                    }
                });

                // 设置默认值
                const targetMilestoneId = this.defaultMilestoneId !== undefined ? this.defaultMilestoneId : (this.reminder?.milestoneId || undefined);
                if (targetMilestoneId) {
                    hiddenInput.value = targetMilestoneId;
                    const item = dropdown.querySelector(`.b3-menu__item[data-value="${targetMilestoneId}"]`);
                    if (item) {
                        searchInput.value = item.getAttribute('data-label') || '';
                    }
                } else {
                    hiddenInput.value = '';
                    searchInput.value = '';
                }

            } else {
                milestoneGroup.style.display = 'none';
                hiddenInput.value = '';
                searchInputText.value = '';
            }
        } catch (e) {
            console.error('渲染里程碑选择器失败:', e);
            milestoneGroup.style.display = 'none';
        }
    }

    private showCreateDocumentDialog() {
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;
        const currentTitle = titleInput?.value?.trim() || '';

        const blockBindingDialog = new BlockBindingDialog(this.plugin, async (blockId: string) => {
            const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
            if (blockInput) {
                blockInput.value = blockId;
                await refreshSql();
                // 触发块预览
                this.updateBlockPreview(blockId);
            }
            showMessage('✓ 已选择块');
        }, {
            defaultTab: 'heading',
            defaultParentId: this.defaultParentId || this.reminder?.parentId,
            defaultProjectId: this.defaultProjectId || this.reminder?.projectId,
            defaultCustomGroupId: this.defaultCustomGroupId || this.reminder?.customGroupId,
            reminder: this.reminder,
            defaultTitle: currentTitle
        });
        blockBindingDialog.show();
    }

    private destroyDialog() {
        if (this.editor) {
            this.editor.destroy();
            this.editor = undefined;
        }
        if (this.dialog) {
            this.dialog.destroy();
        }
    }

    // 仅保存备注
    private async saveNoteOnly() {
        if (!this.reminder) return;

        const note = this.editor ? this.currentNote : this.reminder.note;

        // 乐观更新
        const optimisticReminder = { ...this.reminder };
        optimisticReminder.note = note;

        // 立即回调
        if (this.onSaved) {
            this.onSaved(optimisticReminder);
        }

        this.destroyDialog();

        // 后台持久化
        try {
            if (this.isInstanceEdit && this.reminder.isInstance) {
                // 实例备注修改
                await this.saveInstanceModification({
                    originalId: this.reminder.originalId,
                    instanceDate: this.reminder.instanceDate,
                    note: note
                });
                console.debug('实例备注已更新 (后台)');
            } else {
                const reminderData = await this.plugin.loadReminderData();
                if (reminderData[this.reminder.id]) {
                    reminderData[this.reminder.id].note = note;
                    await this.plugin.saveReminderData(reminderData);
                    console.debug('备注已更新 (后台)');
                }
            }
        } catch (error) {
            console.error('保存备注失败:', error);
            showMessage(i18n("saveFailed") || "保存失败", 3000, 'error');
        }
    }

    private async saveReminder() {
        if (this.mode === 'note') {
            await this.saveNoteOnly();
            return;
        }

        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLTextAreaElement;
        const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        const urlInput = this.dialog.element.querySelector('#quickUrlInput') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const timeInput = this.dialog.element.querySelector('#quickReminderTime') as HTMLInputElement;
        const endTimeInput = this.dialog.element.querySelector('#quickReminderEndTime') as HTMLInputElement;
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
        const selectedPriority = this.dialog.element.querySelector('#quickPrioritySelector .priority-option.selected') as HTMLElement;
        // const selectedCategory = this.dialog.element.querySelector('#quickCategorySelector .category-option.selected') as HTMLElement;
        const selectedStatus = this.dialog.element.querySelector('#quickStatusSelector .task-status-option.selected') as HTMLElement;
        const customGroupSelector = this.dialog.element.querySelector('#quickCustomGroupSelector') as HTMLSelectElement;

        let title = titleInput.value.trim();
        const rawBlockVal = blockInput?.value?.trim() || undefined;
        const inputId = rawBlockVal ? (this.extractBlockId(rawBlockVal) || rawBlockVal) : undefined;
        const url = urlInput?.value?.trim() || undefined;
        // const note = noteInput.value.trim() || undefined;
        const note = this.editor ? this.currentNote : undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';

        // 获取多分类ID
        const categoryId = this.selectedCategoryIds.length > 0 ? this.selectedCategoryIds.join(',') : undefined;

        const projectId = projectSelector.value || undefined;
        // 获取选中的kanbanStatus，如果没有选中则使用第一个可用状态
        let kanbanStatus = selectedStatus?.getAttribute('data-status-type');
        if (!kanbanStatus) {
            // 如果没有选中状态，使用第一个可用状态（排除已完成）
            const availableStatuses = this.currentKanbanStatuses.filter(s => s.id !== 'completed');
            kanbanStatus = availableStatuses.length > 0 ? availableStatuses[0].id : 'short_term';
        }
        const customGroupId = customGroupSelector?.value || undefined;
        const milestoneSelector = this.dialog.element.querySelector('#quickMilestoneSelector') as HTMLSelectElement;
        const milestoneId = milestoneSelector?.value || undefined;

        const customReminderPreset = (this.dialog.element.querySelector('#quickCustomReminderPreset') as HTMLSelectElement)?.value || undefined;
        const estimatedPomodoroDuration = (this.dialog.element.querySelector('#quickEstimatedPomodoroDuration') as HTMLInputElement)?.value.trim() || undefined;

        // 每日可做
        const isAvailableToday = (this.dialog.element.querySelector('#quickIsAvailableToday') as HTMLInputElement)?.checked || false;
        const availableStartDate = (this.dialog.element.querySelector('#quickAvailableStartDate') as HTMLInputElement)?.value || undefined;

        // 不在日历视图显示
        const hideInCalendar = (this.dialog.element.querySelector('#quickHideInCalendar') as HTMLInputElement)?.checked || false;


        // 获取选中的标签ID（使用 selectedTagIds 属性）
        const tagIds = this.selectedTagIds;

        // 解析日期和时间（使用独立的日期和时间输入框）
        let date: string = dateInput.value;
        let endDate: string = endDateInput.value;
        let time: string | undefined = timeInput?.value || undefined;
        let endTime: string | undefined = endTimeInput?.value || undefined;

        // 自动根据日期更新状态：如果是今天或过去的任务，且未完成，自动设为进行中
        if (date && kanbanStatus !== 'completed') {
            const today = getLogicalDateString();
            if (compareDateStrings(date, today) <= 0) {
                const hasDoingStatus = this.currentKanbanStatuses.some(s => s.id === 'doing');
                if (hasDoingStatus) {
                    kanbanStatus = 'doing';
                }
            }
        }

        if (!title) {
            // 无论新建或编辑，均允许空标题并替换为未命名标题
            title = '未命名任务';
        }

        // 允许不设置日期

        // 验证结束日期时间不能早于开始日期时间
        if (endDate && date) {
            const startDateTime = time ? `${date}T${time}` : `${date}T00:00:00`;
            const endDateTime = endTime ? `${endDate}T${endTime}` : `${endDate}T00:00:00`;

            if (new Date(endDateTime) < new Date(startDateTime)) {
                showMessage(i18n("endDateCannotBeEarlier"));
                return;
            }
        }

        // 如果启用了重复设置，则必须提供起始日期（重复任务需要基准日期）
        if (this.repeatConfig && this.repeatConfig.enabled && !date) {
            showMessage(i18n('pleaseSetStartDateForRepeat') || '请为重复任务设置起始日期');
            return;
        }

        // 批量编辑模式：不保存，只传递数据给回调
        if (this.mode === 'batch_edit') {
            const reminderData = {
                title: title,
                blockId: inputId || this.defaultBlockId || null,
                docId: undefined,
                url: url || undefined,
                date: date || undefined,
                time: time,
                endDate: endDate || undefined,
                endTime: endTime,
                note: note,
                priority: priority,
                categoryId: categoryId,
                projectId: projectId,
                customGroupId: customGroupId,
                milestoneId: milestoneId,
                kanbanStatus: kanbanStatus,
                tagIds: tagIds.length > 0 ? tagIds : undefined,
                reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined,
                customReminderPreset: customReminderPreset,
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                quadrant: this.defaultQuadrant,
                estimatedPomodoroDuration: estimatedPomodoroDuration,
                isAvailableToday: isAvailableToday,
                availableStartDate: availableStartDate,
                hideInCalendar: hideInCalendar
            };

            // 如果有绑定块，尝试获取并设置 docId
            if (reminderData.blockId) {
                try {
                    const blk = await getBlockByID(reminderData.blockId);
                    reminderData.docId = blk?.root_id || (blk?.type === 'd' ? blk?.id : null);
                } catch (err) {
                    console.warn('获取块信息失败 (batch_edit):', err);
                }
            }

            if (this.onSaved) {
                this.onSaved(reminderData);
            }

            this.destroyDialog();
            return;
        }

        // ---------------------------------------------------------
        // 乐观更新：立即构造预览对象并关闭弹窗 (Optimistic Update)
        // ---------------------------------------------------------
        const tempId = (this.mode === 'edit' && this.reminder) ? this.reminder.id : `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const nowStr = new Date().toISOString();

        // 预先解析并获取绑定块的 docId（用于乐观 UI）
        let optimisticReminder: any = null;
        let optimisticDocId: string | null = null;
        if (inputId) {
            try {
                const blk = await getBlockByID(inputId);
                optimisticDocId = blk?.root_id || (blk?.type === 'd' ? blk?.id : null);
            } catch (err) {
                console.warn('获取绑定块 root_id 失败（乐观）:', err);
            }
        }

        if (this.mode === 'edit' && this.reminder) {
            // 编辑模式：克隆旧对象并覆盖新值
            optimisticReminder = { ...this.reminder };

            // 应用基础字段修改
            optimisticReminder.title = title;
            optimisticReminder.blockId = inputId || null;
            optimisticReminder.url = url;
            optimisticReminder.date = date;
            optimisticReminder.time = time;
            optimisticReminder.endDate = endDate;
            optimisticReminder.endTime = endTime;
            optimisticReminder.note = note;
            optimisticReminder.priority = priority;
            optimisticReminder.categoryId = categoryId;
            optimisticReminder.projectId = projectId;
            optimisticReminder.customGroupId = customGroupId;
            optimisticReminder.milestoneId = milestoneId;
            optimisticReminder.tagIds = tagIds.length > 0 ? tagIds : undefined;
            optimisticReminder.customReminderPreset = customReminderPreset;
            optimisticReminder.reminderTimes = this.customTimes.length > 0 ? [...this.customTimes] : undefined;
            // 保存 repeat 信息：如果用户开启了重复（repeatConfig.enabled），使用新的配置；
            // 否则保留原对象中用于记录历史/实例状态的元数据（completedInstances/completedTimes/instanceModifications/excludeDates），
            // 以避免编辑操作误删 ghost 子任务的已完成记录。
            {
                const existingRepeat = this.reminder?.repeat || {};
                const preservedKeys = ['completedInstances', 'completedTimes', 'instanceModifications', 'excludeDates'];
                const preserved: any = {};
                if (this.repeatConfig && this.repeatConfig.enabled) {
                    optimisticReminder.repeat = { ...existingRepeat, ...this.repeatConfig };
                } else {
                    for (const k of preservedKeys) {
                        if (existingRepeat && existingRepeat[k] !== undefined) preserved[k] = existingRepeat[k];
                    }
                    optimisticReminder.repeat = Object.keys(preserved).length > 0 ? preserved : undefined;
                }
            }
            optimisticReminder.estimatedPomodoroDuration = estimatedPomodoroDuration;
            // 看板状态直接使用kanbanStatus
            optimisticReminder.kanbanStatus = kanbanStatus;
            optimisticReminder.isAvailableToday = isAvailableToday;
            optimisticReminder.availableStartDate = availableStartDate;
            optimisticReminder.hideInCalendar = hideInCalendar;

            // 同步 docId 用于 UI 显示
            optimisticReminder.docId = optimisticDocId !== null ? optimisticDocId : (this.reminder?.docId || undefined);

            // 实例编辑特殊处理
            if (this.isInstanceEdit && this.reminder.isInstance) {
                // 实例编辑时，optimisticReminder 应该看起来像个独立的 task，以便 Kanban 渲染
                // 保持 id 不变即可 (ProjectKanbanView 中的 tasks 包含实例)
            }
        } else {
            // 新建模式
            optimisticReminder = {
                id: tempId,
                parentId: this.defaultParentId,
                blockId: inputId || this.defaultBlockId || null,
                docId: optimisticDocId || null,
                title: title,
                url: url,
                date: date,
                time: time,
                endDate: endDate,
                endTime: endTime,
                completed: false,
                priority: priority,
                categoryId: categoryId,
                projectId: projectId,
                customGroupId: customGroupId,
                tagIds: tagIds.length > 0 ? tagIds : undefined,
                createdAt: nowStr,
                createdTime: nowStr, // 补齐 sorting 字段
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                quadrant: this.defaultQuadrant,
                kanbanStatus: kanbanStatus,
                reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined,
                estimatedPomodoroDuration: estimatedPomodoroDuration
            };

            if (customReminderPreset) optimisticReminder.customReminderPreset = customReminderPreset;
            if (typeof this.defaultSort === 'number') optimisticReminder.sort = this.defaultSort;
        }

        // 立即回调并关闭
        if (this.onSaved && optimisticReminder) {
            this.onSaved(optimisticReminder);
        }

        // 如果需要跳过保存（临时子任务模式），直接返回，不执行后续保存逻辑
        if (this.skipSave) {
            this.destroyDialog();
            return;
        }

        // 显示“已保存”反馈（乐观），不再等待

        this.destroyDialog();

        // ---------------------------------------------------------
        // 后台持久化数据 (Background Persistence)
        // ---------------------------------------------------------
        (async () => {
            try {
                // 注意：这里使用 synchronized id (如果是新建，覆盖 tempId)
                // 但为了简单，create 逻辑中我们让它重新生成也没关系，只要 file update 正确
                // 不过 edit 逻辑必须用真实 ID

                let reminderData: any = await this.plugin.loadReminderData();

                let reminder: any;
                let reminderId: string;

                if (this.mode === 'edit' && this.reminder) {
                    // 检查是否是实例编辑
                    if (this.isInstanceEdit && this.reminder.isInstance) {
                        // 实例编辑：保存实例级别的修改
                        const instanceModification = {
                            title: title,
                            date: date,
                            endDate: endDate,
                            time: time,
                            endTime: endTime,
                            note: note,
                            priority: priority,
                            notified: false, // 重置通知状态
                            projectId: projectId,
                            customGroupId: customGroupId,
                            milestoneId: milestoneId,
                            kanbanStatus: kanbanStatus,
                            // 提醒时间相关字段
                            reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined,
                            customReminderPreset: customReminderPreset,
                            estimatedPomodoroDuration: estimatedPomodoroDuration
                        };

                        // 调用实例修改保存方法
                        await this.saveInstanceModification({
                            originalId: this.reminder.originalId,
                            instanceDate: this.reminder.instanceDate,
                            ...instanceModification
                        });

                        showMessage("实例编辑成功");

                        // 触发更新事件
                        window.dispatchEvent(new CustomEvent('reminderUpdated', {
                            detail: {
                                projectId: this.reminder.projectId
                            }
                        }));


                        // 已经在前台乐观回调过了，后台不再重复回调以避免双重刷新
                        // if (this.onSaved) this.onSaved(this.reminder);
                        // this.dialog.destroy();
                        return;
                    } else {
                        // 普通编辑：更新现有提醒
                        reminderId = this.reminder.id;
                        reminder = { ...this.reminder };

                        // 更新字段
                        reminder.title = title;
                        reminder.blockId = inputId || null;
                        reminder.url = url || undefined;
                        reminder.date = date || undefined;
                        reminder.time = time;
                        reminder.endDate = endDate || undefined;
                        reminder.endTime = endTime;
                        reminder.note = note;
                        reminder.priority = priority;
                        reminder.categoryId = categoryId;
                        reminder.projectId = projectId;
                        reminder.customGroupId = customGroupId;
                        reminder.milestoneId = milestoneId;
                        reminder.tagIds = tagIds.length > 0 ? tagIds : undefined;
                        // 不再使用旧的 `customReminderTime` 存储；所有自定义提醒统一保存到 `reminderTimes`
                        reminder.customReminderPreset = customReminderPreset;
                        reminder.reminderTimes = this.customTimes.length > 0 ? [...this.customTimes] : undefined;
                        // 在保存时，合并/保留可能存在的实例元数据（例如 ghost 子任务使用的 completedInstances/completedTimes 等），
                        // 防止“编辑全部实例”误清空这些历史数据。
                        {
                            const existingRepeat = this.reminder?.repeat || {};
                            const preservedKeys = ['completedInstances', 'completedTimes', 'instanceModifications', 'excludeDates'];
                            const preserved: any = {};

                            if (this.repeatConfig && this.repeatConfig.enabled) {
                                // 用户启用了/修改了重复设置：以用户配置为主，但保留已有的元数据（不覆盖）
                                reminder.repeat = { ...existingRepeat, ...this.repeatConfig };
                            } else {
                                // 用户未启用重复：仅在已有元数据时保留这些字段（否则不创建 repeat 对象）
                                for (const k of preservedKeys) {
                                    if (existingRepeat && existingRepeat[k] !== undefined) preserved[k] = existingRepeat[k];
                                }
                                reminder.repeat = Object.keys(preserved).length > 0 ? preserved : undefined;
                            }
                        }
                        reminder.estimatedPomodoroDuration = estimatedPomodoroDuration;
                        reminder.isAvailableToday = isAvailableToday;
                        reminder.availableStartDate = availableStartDate;
                        reminder.hideInCalendar = hideInCalendar;

                        // 设置或删除 documentId
                        if (inputId) {
                            try {
                                const block = await getBlockByID(inputId);
                                reminder.docId = block.root_id;
                            } catch (error) {
                                console.error('获取块信息失败:', error);
                                reminder.docId = undefined;
                            }
                        } else {
                            delete reminder.docId;
                        }

                        // 设置看板状态
                        reminder.kanbanStatus = kanbanStatus;
                        reminder.updatedAt = new Date().toISOString();

                        // 保存完成时间（如果任务已完成）
                        if (reminder.completed) {
                            const completedTimeInput = this.dialog.element.querySelector('#quickCompletedTime') as HTMLInputElement;
                            if (completedTimeInput && completedTimeInput.value) {
                                // 将 datetime-local 格式转换为本地时间格式 YYYY-MM-DD HH:mm
                                try {
                                    const completedDate = new Date(completedTimeInput.value);
                                    const year = completedDate.getFullYear();
                                    const month = String(completedDate.getMonth() + 1).padStart(2, '0');
                                    const day = String(completedDate.getDate()).padStart(2, '0');
                                    const hours = String(completedDate.getHours()).padStart(2, '0');
                                    const minutes = String(completedDate.getMinutes()).padStart(2, '0');
                                    reminder.completedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
                                } catch (error) {
                                    console.error('解析完成时间失败:', error);
                                    // 如果解析失败，使用当前时间
                                    const now = new Date();
                                    const year = now.getFullYear();
                                    const month = String(now.getMonth() + 1).padStart(2, '0');
                                    const day = String(now.getDate()).padStart(2, '0');
                                    const hours = String(now.getHours()).padStart(2, '0');
                                    const minutes = String(now.getMinutes()).padStart(2, '0');
                                    reminder.completedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
                                }
                            } else if (!reminder.completedTime) {
                                // 如果没有设置完成时间，使用当前时间
                                const now = new Date();
                                const year = now.getFullYear();
                                const month = String(now.getMonth() + 1).padStart(2, '0');
                                const day = String(now.getDate()).padStart(2, '0');
                                const hours = String(now.getHours()).padStart(2, '0');
                                const minutes = String(now.getMinutes()).padStart(2, '0');
                                reminder.completedTime = `${year}-${month}-${day} ${hours}:${minutes}`;
                            }
                        }

                        // 不在编辑时修改已提醒标志（notifiedTime / notifiedCustomTime）。
                        // 过去的提醒无需在编辑时处理，未来的提醒将在未来正常触发，
                        // 所以这里保留原有的 notified 字段值，不做重置或计算。

                        reminderData[reminderId] = reminder;
                        await this.plugin.saveReminderData(reminderData);

                        // 如果看板状态或自定义分组发生变化，将该字段递归应用到所有子任务（包含多层子孙）
                        try {
                            const oldStatus = this.reminder.kanbanStatus;
                            const newStatus = reminder.kanbanStatus;
                            const oldGroup = this.reminder.customGroupId;
                            const newGroup = reminder.customGroupId;

                            let anyChildChanged = false;

                            const oldProject = this.reminder.projectId;
                            const newProject = reminder.projectId;

                            // 收集需要同步到块属性的变更（{blockId, projectId}）
                            const changedBlockProjects: Array<{ blockId: string; projectId?: string | null }> = [];

                            const updateChildren = (parentId: string) => {
                                for (const key of Object.keys(reminderData)) {
                                    const r = reminderData[key];
                                    if (r && r.parentId === parentId) {
                                        let changed = false;
                                        // 更新状态（仅在值确实改变时）
                                        if (oldStatus !== newStatus) {
                                            r.kanbanStatus = newStatus;
                                            changed = true;
                                        }
                                        // 更新自定义分组
                                        if (oldGroup !== newGroup) {
                                            r.customGroupId = newGroup;
                                            changed = true;
                                        }


                                        if (changed) {
                                            r.updatedAt = new Date().toISOString();
                                            anyChildChanged = true;
                                        }

                                        // 更新项目ID（支持从有到无或无到有）
                                        if (oldProject !== newProject) {
                                            r.projectId = newProject;
                                            // 如果该子任务绑定了块，记录以便后续同步块属性
                                            if (r.blockId) {
                                                changedBlockProjects.push({ blockId: r.blockId, projectId: newProject });
                                            }
                                            changed = true;
                                        }

                                        // 递归更新其子任务
                                        updateChildren(r.id);
                                    }
                                }
                            };

                            updateChildren(reminderId);

                            // 持久化子任务变更（如果有）
                            if (anyChildChanged) {
                                await this.plugin.saveReminderData(reminderData);

                                // 如果有绑定块需要同步 projectId，异步调用 API 处理
                                if (changedBlockProjects.length > 0) {
                                    try {
                                        const { addBlockProjectId, setBlockProjectIds } = await import('../api');
                                        for (const item of changedBlockProjects) {
                                            try {
                                                if (item.projectId) {
                                                    await addBlockProjectId(item.blockId, item.projectId as string);
                                                } else {
                                                    await setBlockProjectIds(item.blockId, []);
                                                }
                                            } catch (e) {
                                                console.warn('同步子任务绑定块的 projectId 失败:', item.blockId, e);
                                            }
                                        }
                                    } catch (e) {
                                        console.warn('导入 API 以同步块 projectId 失败:', e);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('更新子任务状态/分组失败:', err);
                        }

                        // 处理块绑定变更
                        const oldBlockId = this.reminder.blockId;
                        const newBlockId = reminder.blockId;

                        // 如果原来有绑定块，但编辑后删除了绑定，需要更新原块的书签状态
                        if (oldBlockId && !newBlockId) {
                            try {
                                await updateBindBlockAtrrs(oldBlockId, this.plugin);
                                console.debug('QuickReminderDialog: 已移除原块的书签绑定', oldBlockId);
                            } catch (error) {
                                console.warn('更新原块书签状态失败:', error);
                            }
                        }

                        // 如果原来绑定了块A，现在改绑块B，需要同时更新两个块
                        if (oldBlockId && newBlockId && oldBlockId !== newBlockId) {
                            try {
                                await updateBindBlockAtrrs(oldBlockId, this.plugin);
                                console.debug('QuickReminderDialog: 已更新原块的书签状态', oldBlockId);
                            } catch (error) {
                                console.warn('更新原块书签状态失败:', error);
                            }
                        }

                        // 将绑定的块添加项目ID属性 custom-task-projectId（支持多项目）
                        if (newBlockId) {
                            try {
                                const { addBlockProjectId, setBlockProjectIds } = await import('../api');
                                if (reminder.projectId) {
                                    await addBlockProjectId(newBlockId, reminder.projectId);
                                    console.debug('QuickReminderDialog: addBlockProjectId for block', newBlockId, 'projectId', reminder.projectId);
                                } else {
                                    // 清理属性（设置为空列表）
                                    await setBlockProjectIds(newBlockId, []);
                                    console.debug('QuickReminderDialog: cleared custom-task-projectId for block', newBlockId);
                                }
                                // 为绑定块添加⏰书签
                                await updateBindBlockAtrrs(newBlockId, this.plugin);
                            } catch (error) {
                                console.warn('设置块自定义属性 custom-task-projectId 失败:', error);
                            }
                        }


                    }
                } else {
                    // 创建模式：创建新提醒
                    // 使用之前生成的 tempId，确保乐观更新的 ID 与实际保存的 ID 一致
                    reminderId = tempId;
                    reminder = {
                        id: reminderId,
                        parentId: this.defaultParentId,
                        blockId: inputId || this.defaultBlockId || null,
                        docId: null, // 没有绑定文档
                        title: title,
                        url: url || undefined,
                        date: date || undefined, // 允许日期为空
                        completed: false,
                        priority: priority,
                        categoryId: categoryId,
                        projectId: projectId,
                        customGroupId: customGroupId,
                        milestoneId: milestoneId,
                        tagIds: tagIds.length > 0 ? tagIds : undefined,
                        createdAt: new Date().toISOString(),
                        repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                        quadrant: this.defaultQuadrant, // 添加象限信息
                        kanbanStatus: kanbanStatus, // 添加任务状态（短期/长期）
                        isAvailableToday: isAvailableToday,
                        availableStartDate: availableStartDate,
                        hideInCalendar: hideInCalendar,
                        // 旧字段 `customReminderTime` 不再写入，新提醒统一保存到 `reminderTimes`
                        reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined,
                        estimatedPomodoroDuration: estimatedPomodoroDuration
                    };

                    // 保存 preset 信息
                    if (customReminderPreset) {
                        reminder.customReminderPreset = customReminderPreset;
                    }

                    // 添加默认排序值
                    if (typeof this.defaultSort === 'number') {
                        reminder.sort = this.defaultSort;
                    }

                    // 自动计算全天事件的 sort 值 (同日同优先级最后)
                    // 仅当新建事件、有日期、无时间（全天）、有优先级且未指定 sort 时生效
                    if (date && !time && priority && typeof reminder.sort !== 'number') {
                        let maxSort = 0;
                        // 遍历现有提醒寻找最大 sort 值
                        Object.values(reminderData).forEach((r: any) => {
                            // 比较日期、全天状态和优先级
                            if (r.date === date && !r.time && (r.priority || 'none') === priority) {
                                const s = typeof r.sort === 'number' ? r.sort : 0;
                                if (s > maxSort) maxSort = s;
                            }
                        });
                        reminder.sort = maxSort + 1;
                    }

                    // 设置看板状态
                    reminder.kanbanStatus = kanbanStatus;

                    // 初始化字段级已提醒标志
                    reminder.notifiedTime = false;
                    reminder.notifiedCustomTime = false;
                    // 如果任务时间早于当前时间，则标记 time 已提醒（仅当有日期时）
                    if (date) {
                        const reminderDateTime = new Date(time ? `${date}T${time}` : date);
                        if (!time) {
                            // 对于全天任务，我们比较当天的结束时间
                            reminderDateTime.setHours(23, 59, 59, 999);
                        }
                        if (reminderDateTime < new Date()) {
                            reminder.notifiedTime = true;
                        }
                    }

                    if (endDate && endDate !== date) {
                        reminder.endDate = endDate;
                    }

                    if (time) {
                        reminder.time = time;
                    }

                    if (endTime) {
                        reminder.endTime = endTime;
                    }

                    if (note) {
                        reminder.note = note;
                    }

                    // 如果是周期任务，自动完成所有过去的实例
                    if (this.repeatConfig.enabled && date) {
                        const { generateRepeatInstances } = await import("../utils/repeatUtils");
                        const today = getLogicalDateString();

                        // 计算从开始日期到今天的天数，用于设置 maxInstances
                        const startDateObj = new Date(date);
                        const todayObj = new Date(today);
                        const daysDiff = Math.ceil((todayObj.getTime() - startDateObj.getTime()) / (1000 * 60 * 60 * 24));

                        // 根据重复类型估算可能的最大实例数
                        let maxInstances = 1000; // 默认值
                        if (this.repeatConfig.type === 'daily') {
                            maxInstances = Math.max(daysDiff + 10, 1000); // 每日重复，最多是天数
                        } else if (this.repeatConfig.type === 'weekly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 7) + 10, 500);
                        } else if (this.repeatConfig.type === 'monthly' || this.repeatConfig.type === 'lunar-monthly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 30) + 10, 200);
                        } else if (this.repeatConfig.type === 'yearly' || this.repeatConfig.type === 'lunar-yearly') {
                            maxInstances = Math.max(Math.ceil(daysDiff / 365) + 10, 50);
                        }

                        // 生成从任务开始日期到今天的所有实例
                        const instances = generateRepeatInstances(reminder, date, today, maxInstances);

                        // 将所有早于今天的实例标记为已完成
                        const pastInstances: string[] = [];
                        instances.forEach(instance => {
                            if (instance.date < today) {
                                pastInstances.push(instance.date);
                            }
                        });

                        // 如果有过去的实例，添加到completedInstances
                        if (pastInstances.length > 0) {
                            if (!reminder.repeat.completedInstances) {
                                reminder.repeat.completedInstances = [];
                            }
                            reminder.repeat.completedInstances.push(...pastInstances);
                        }
                    }
                }

                reminderData[reminderId] = reminder;
                await this.plugin.saveReminderData(reminderData);

                // 在保存后，如果绑定了块，确保 reminder 包含 docId（root_id）
                if (reminder.blockId && !reminder.docId) {
                    try {
                        const block = await getBlockByID(reminder.blockId);
                        reminder.docId = block?.root_id || (block?.type === 'd' ? block?.id : reminder.blockId);
                        // 更新持久化数据以包含 docId
                        reminderData[reminderId] = reminder;
                        await this.plugin.saveReminderData(reminderData);
                    } catch (err) {
                        console.warn('获取块信息失败（保存 docId）:', err);
                    }
                }

                // 将绑定的块添加项目ID属性 custom-task-projectId（支持多项目）
                if (reminder.blockId) {
                    try {
                        const { addBlockProjectId, setBlockProjectIds } = await import('../api');
                        if (reminder.projectId) {
                            await addBlockProjectId(reminder.blockId, reminder.projectId);
                            console.debug('QuickReminderDialog: addBlockProjectId for block', reminder.blockId, 'projectId', reminder.projectId);
                        } else {
                            // 清理属性（设置为空列表）
                            await setBlockProjectIds(reminder.blockId, []);
                            console.debug('QuickReminderDialog: cleared custom-task-projectId for block', reminder.blockId);
                        }
                        // 为绑定块添加⏰书签
                        await updateBindBlockAtrrs(reminder.blockId, this.plugin);
                    } catch (error) {
                        console.warn('设置块自定义属性 custom-task-projectId 失败:', error);
                    }
                }




                // 如果项目发生了变更，不传递 projectId 以触发全量刷新；否则传递 projectId 进行增量刷新
                const isProjectChanged = this.mode === 'edit' && this.reminder && this.reminder.projectId !== projectId;
                const eventDetail = isProjectChanged ? {} : { projectId: projectId };

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated', {
                    detail: eventDetail
                }));

                // 如果是新建模式且有临时子任务，保存子任务
                if (this.mode !== 'edit' && this.tempSubtasks.length > 0) {
                    await this.saveTempSubtasks(reminderId);
                }

                // if (this.onSaved) this.onSaved(reminder);
                // this.dialog.destroy();
            } catch (error) {
                console.error('保存快速提醒失败:', error);
                // 此时 UI 已销毁，如果保存失败，使用通用 notification
                showMessage(this.mode === 'edit' ? i18n("updateReminderFailed") : i18n("saveReminderFailed"));
            }
        })();
    }

    /**
     * 保存重复事件实例的修改
     */
    private async saveInstanceModification(instanceData: any) {
        try {
            const originalId = instanceData.originalId;
            const instanceDate = instanceData.instanceDate;

            const reminderData = await this.plugin.loadReminderData();

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            const modifications = reminderData[originalId].repeat.instanceModifications;

            // 如果修改了日期，需要清理可能存在的中间修改记录
            if (instanceData.date !== instanceDate) {
                const keysToDelete: string[] = [];
                for (const key in modifications) {
                    if (key !== instanceDate && modifications[key]?.date === instanceData.date) {
                        keysToDelete.push(key);
                    }
                }
                keysToDelete.forEach(key => delete modifications[key]);
            }

            // 获取旧值以检测变更
            const oldMod = modifications[instanceDate] || {};
            const originalTask = reminderData[originalId];

            // 确定是否需要级联更新
            const oldStatus = oldMod.kanbanStatus !== undefined ? oldMod.kanbanStatus : originalTask.kanbanStatus;
            const newStatus = instanceData.kanbanStatus;

            const oldGroup = oldMod.customGroupId !== undefined ? oldMod.customGroupId : originalTask.customGroupId;
            const newGroup = instanceData.customGroupId;

            const oldProject = oldMod.projectId !== undefined ? oldMod.projectId : originalTask.projectId;
            const newProject = instanceData.projectId;

            // 保存此实例的修改数据
            modifications[instanceDate] = {
                title: instanceData.title,
                date: instanceData.date,
                endDate: instanceData.endDate,
                time: instanceData.time,
                endTime: instanceData.endTime,
                note: instanceData.note,
                priority: instanceData.priority,
                notified: instanceData.notified,
                projectId: instanceData.projectId,
                customGroupId: instanceData.customGroupId,
                milestoneId: instanceData.milestoneId,
                kanbanStatus: instanceData.kanbanStatus,
                reminderTimes: instanceData.reminderTimes,
                customReminderPreset: instanceData.customReminderPreset,
                estimatedPomodoroDuration: instanceData.estimatedPomodoroDuration,
                modifiedAt: new Date().toISOString().split('T')[0]
            };

            // 如果状态、分组或项目发生了变更，递归更新所有子任务（ghost tasks）
            if (oldStatus !== newStatus || oldGroup !== newGroup || oldProject !== newProject) {
                const descendants = this.getAllDescendants(reminderData, originalId);

                descendants.forEach(desc => {
                    // 确保 repeat 结构存在
                    if (!desc.repeat) {
                        desc.repeat = { enabled: false };
                    }
                    if (!desc.repeat.instanceModifications) {
                        desc.repeat.instanceModifications = {};
                    }

                    const descMod = desc.repeat.instanceModifications[instanceDate] || {};

                    // 强制子任务跟随父任务的变更
                    if (newStatus !== undefined) {
                        descMod.kanbanStatus = newStatus;
                    }

                    if (newGroup !== undefined) {
                        descMod.customGroupId = newGroup;
                    }

                    if (newProject !== undefined) {
                        descMod.projectId = newProject;
                    }

                    descMod.modifiedAt = new Date().toISOString().split('T')[0];
                    desc.repeat.instanceModifications[instanceDate] = descMod;
                });
            }

            await this.plugin.saveReminderData(reminderData);

        } catch (error) {
            console.error('保存实例修改失败:', error);
            throw error;
        }
    }

    private getAllDescendants(reminderData: any, parentId: string): any[] {
        const result: any[] = [];
        const findChildren = (pid: string) => {
            for (const key in reminderData) {
                if (reminderData[key].parentId === pid) {
                    result.push(reminderData[key]);
                    findChildren(reminderData[key].id);
                }
            }
        }
        findChildren(parentId);
        return result;
    }

    /**
     * 保存临时子任务
     * 在新建父任务时一起保存子任务
     */
    private async saveTempSubtasks(parentId: string) {
        if (this.tempSubtasks.length === 0) return;

        try {
            const reminderData = await this.plugin.loadReminderData();
            const nowStr = new Date().toISOString();

            for (const tempSubtask of this.tempSubtasks) {
                // 生成新的子任务 ID
                const subtaskId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                // 创建子任务对象
                const subtask: any = {
                    id: subtaskId,
                    parentId: parentId,
                    blockId: tempSubtask.blockId || null,
                    docId: tempSubtask.docId || null,
                    title: tempSubtask.title || '未命名任务',
                    url: tempSubtask.url || undefined,
                    date: tempSubtask.date || undefined,
                    time: tempSubtask.time || undefined,
                    endDate: tempSubtask.endDate || undefined,
                    endTime: tempSubtask.endTime || undefined,
                    completed: tempSubtask.completed || false,
                    priority: tempSubtask.priority || 'none',
                    categoryId: tempSubtask.categoryId || undefined,
                    projectId: tempSubtask.projectId || undefined,
                    customGroupId: tempSubtask.customGroupId || undefined,
                    milestoneId: tempSubtask.milestoneId || undefined,
                    tagIds: tempSubtask.tagIds || undefined,
                    createdAt: nowStr,
                    createdTime: nowStr,
                    kanbanStatus: tempSubtask.kanbanStatus || 'todo',
                    sort: tempSubtask.sort || 0,
                    note: tempSubtask.note || undefined,
                    reminderTimes: tempSubtask.reminderTimes || undefined,
                    estimatedPomodoroDuration: tempSubtask.estimatedPomodoroDuration || undefined,
                    notifiedTime: false,
                    notifiedCustomTime: false
                };

                // 如果子任务有完成时间，保留它
                if (tempSubtask.completed && tempSubtask.completedTime) {
                    subtask.completedTime = tempSubtask.completedTime;
                }

                // 复制重复设置（如果有）
                if (tempSubtask.repeat?.enabled) {
                    subtask.repeat = { ...tempSubtask.repeat };
                }

                // 如果有绑定块，获取 docId
                if (subtask.blockId && !subtask.docId) {
                    try {
                        const block = await getBlockByID(subtask.blockId);
                        subtask.docId = block?.root_id || (block?.type === 'd' ? block?.id : null);
                    } catch (err) {
                        console.warn('获取子任务绑定块信息失败:', err);
                    }
                }

                reminderData[subtaskId] = subtask;

                // 如果绑定了块，添加项目 ID 属性
                if (subtask.blockId && subtask.projectId) {
                    try {
                        const { addBlockProjectId } = await import('../api');
                        await addBlockProjectId(subtask.blockId, subtask.projectId);
                    } catch (error) {
                        console.warn('设置子任务块属性失败:', error);
                    }
                }
            }

            await this.plugin.saveReminderData(reminderData);
            console.log(`已保存 ${this.tempSubtasks.length} 个子任务`);
            showMessage(i18n("subtasksSaved") || `已保存 ${this.tempSubtasks.length} 个子任务`);

            // 保存成功后清空临时子任务数组
            this.tempSubtasks = [];
        } catch (error) {
            console.error('保存临时子任务失败:', error);
        }
    }

    private extractBlockId(raw: string): string | null {
        if (!raw) return null;
        const blockRefRegex = /\(\(([\w\-]+)\s+'(.*)'\)\)/;
        const blockLinkRegex = /\[(.*)\]\(siyuan:\/\/blocks\/([\w\-]+)\)/;
        const match1 = raw.match(blockRefRegex);
        if (match1) return match1[1];
        const match2 = raw.match(blockLinkRegex);
        if (match2) return match2[2];
        const urlRegex = /siyuan:\/\/blocks\/([\w\-]+)/;
        const match3 = raw.match(urlRegex);
        if (match3) return match3[1];
        const idRegex = /^([a-zA-Z0-9\-]{5,})$/;
        if (idRegex.test(raw)) return raw;
        return null;
    }

    /**
     * 更新父任务显示
     */
    private async updateParentTaskDisplay() {
        const parentTaskGroup = this.dialog.element.querySelector('#quickParentTaskGroup') as HTMLElement;
        const parentTaskDisplay = this.dialog.element.querySelector('#quickParentTaskDisplay') as HTMLInputElement;
        const parentTaskIdSpan = this.dialog.element.querySelector('#quickParentTaskId') as HTMLSpanElement;
        const viewParentBtn = this.dialog.element.querySelector('#quickViewParentBtn') as HTMLButtonElement;

        if (!parentTaskGroup || !parentTaskDisplay || !parentTaskIdSpan || !viewParentBtn) {
            return;
        }

        // 获取父任务ID（优先使用reminder中的，其次使用defaultParentId）
        const parentId = this.reminder?.parentId || this.defaultParentId;

        if (!parentId) {
            // 没有父任务，隐藏整个区域
            parentTaskGroup.style.display = 'none';
            return;
        }

        // 显示父任务区域
        parentTaskGroup.style.display = '';
        parentTaskIdSpan.textContent = parentId;

        try {
            // 读取父任务数据
            const reminderData = await this.plugin.loadReminderData();
            let parentTask = reminderData[parentId];
            let instanceDate: string | undefined;

            // 特殊处理：如果父任务ID是重复实例（形式为 reminder_originalId_date）
            if (!parentTask && parentId.startsWith('reminder_')) {
                const lastUnderscoreIndex = parentId.lastIndexOf('_');
                if (lastUnderscoreIndex !== -1) {
                    const potentialDate = parentId.substring(lastUnderscoreIndex + 1);
                    // 检查最后一部分是否为 YYYY-MM-DD 格式
                    if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                        const originalId = parentId.substring(0, lastUnderscoreIndex);
                        const originalTask = reminderData[originalId];
                        if (originalTask) {
                            instanceDate = potentialDate;
                            // 构造虚拟的实例对象用于显示
                            const instanceMod = originalTask.repeat?.instanceModifications?.[instanceDate] || {};
                            parentTask = {
                                ...originalTask,
                                ...instanceMod,
                                title: instanceMod.title || originalTask.title || '(无标题)',
                                isInstance: true,
                                instanceDate: instanceDate,
                                originalId: originalId
                            };
                        }
                    }
                }
            }

            if (parentTask) {
                // 显示父任务标题
                const displayTitle = instanceDate ? `${parentTask.title} (${instanceDate})` : (parentTask.title || '(无标题)');
                parentTaskDisplay.value = displayTitle;
                parentTaskDisplay.title = instanceDate ? `父任务实例: ${displayTitle}` : `父任务: ${displayTitle}`;

                // 显示查看按钮
                viewParentBtn.style.display = '';
            } else {
                // 父任务不存在
                parentTaskDisplay.value = '(父任务不存在)';
                parentTaskDisplay.title = '父任务已被删除或不存在';
                viewParentBtn.style.display = 'none';
            }
        } catch (error) {
            console.error('加载父任务信息失败:', error);
            parentTaskDisplay.value = '(加载失败)';
            viewParentBtn.style.display = 'none';
        }
    }

    /**
     * 编辑所有实例
     */
    private async editAllInstances() {
        if (!this.reminder || !this.reminder.originalId) {
            return;
        }

        try {
            // 读取原始任务数据
            const reminderData = await this.plugin.loadReminderData();
            const originalTask = reminderData[this.reminder.originalId];

            if (!originalTask) {
                showMessage(i18n("originalTaskNotExist") || "原始任务不存在");
                return;
            }

            // 创建新的QuickReminderDialog来编辑原始任务（非实例编辑模式）
            const allInstancesDialog = new QuickReminderDialog(
                originalTask.date,
                originalTask.time,
                undefined,
                originalTask.endDate ? {
                    isTimeRange: true,
                    endDate: originalTask.endDate,
                    endTime: originalTask.endTime
                } : undefined,
                {
                    reminder: originalTask,
                    mode: 'edit',
                    plugin: this.plugin,
                    isInstanceEdit: false, // 明确设置为非实例编辑模式，即修改所有实例
                    onSaved: async () => {
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    }
                }
            );

            // 关掉当前实例弹窗
            this.destroyDialog();

            allInstancesDialog.show();
        } catch (error) {
            console.error('编辑所有实例失败:', error);
            showMessage(i18n("operationFailed") || "操作失败");
        }
    }

    /**
     * 更新“编辑所有实例”按钮显示
     */
    private updateEditAllInstancesDisplay() {
        const group = this.dialog.element.querySelector('#quickEditAllInstancesGroup') as HTMLElement;
        if (!group) return;

        // 仅在实例编辑模式且有原始ID时显示
        if (this.isInstanceEdit && this.reminder && this.reminder.originalId) {
            group.style.display = 'block';
        } else {
            group.style.display = 'none';
        }
    }
    private async viewParentTask() {
        const parentId = this.reminder?.parentId || this.defaultParentId;

        if (!parentId) {
            showMessage(i18n("parentTaskNotExist") || "父任务不存在");
            return;
        }

        try {
            // 读取父任务数据
            const reminderData = await this.plugin.loadReminderData();
            let parentTask = reminderData[parentId];
            let isInstanceEdit = false;
            let instanceDate = "";

            // 特殊处理：如果父任务ID是重复实例（形式为 reminder_originalId_date）
            if (!parentTask && parentId.startsWith('reminder_')) {
                const lastUnderscoreIndex = parentId.lastIndexOf('_');
                if (lastUnderscoreIndex !== -1) {
                    const potentialDate = parentId.substring(lastUnderscoreIndex + 1);
                    // 检查最后一部分是否为 YYYY-MM-DD 格式
                    if (/^\d{4}-\d{2}-\d{2}$/.test(potentialDate)) {
                        const originalId = parentId.substring(0, lastUnderscoreIndex);
                        const originalTask = reminderData[originalId];
                        if (originalTask) {
                            isInstanceEdit = true;
                            instanceDate = potentialDate;
                            // 构造虚拟的实例对象
                            const instanceMod = originalTask.repeat?.instanceModifications?.[instanceDate] || {};
                            parentTask = {
                                ...originalTask,
                                ...instanceMod,
                                id: parentId,
                                isInstance: true,
                                instanceDate: instanceDate,
                                originalId: originalId
                            };
                        }
                    }
                }
            }

            if (!parentTask) {
                showMessage(i18n("parentTaskNotExist") || "父任务不存在");
                return;
            }

            // 创建新的QuickReminderDialog来编辑父任务
            const parentDialog = new QuickReminderDialog(
                isInstanceEdit ? instanceDate : parentTask.date,
                parentTask.time,
                undefined,
                parentTask.endDate ? {
                    isTimeRange: true,
                    endDate: parentTask.endDate,
                    endTime: parentTask.endTime
                } : undefined,
                {
                    reminder: parentTask,
                    mode: 'edit',
                    plugin: this.plugin,
                    isInstanceEdit: isInstanceEdit,
                    instanceDate: isInstanceEdit ? instanceDate : undefined,
                    onSaved: async () => {
                        // 父任务保存后，刷新当前对话框的父任务显示
                        await this.updateParentTaskDisplay();

                        // 触发全局刷新事件
                        window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    }
                }
            );

            parentDialog.show();
        } catch (error) {
            console.error('查看父任务失败:', error);
            showMessage(i18n("operationFailed") || "操作失败");
        }
    }

    /**
     * 更新完成时间显示
     */
    private updateCompletedTimeDisplay() {
        const completedTimeGroup = this.dialog.element.querySelector('#quickCompletedTimeGroup') as HTMLElement;
        const completedTimeInput = this.dialog.element.querySelector('#quickCompletedTime') as HTMLInputElement;

        if (!completedTimeGroup || !completedTimeInput) {
            return;
        }

        // 检查任务是否已完成
        const isCompleted = this.reminder?.completed === true;

        if (!isCompleted) {
            // 任务未完成，隐藏完成时间区域
            completedTimeGroup.style.display = 'none';
            return;
        }

        // 任务已完成，显示完成时间区域
        completedTimeGroup.style.display = '';

        // 填充完成时间
        if (this.reminder?.completedTime) {
            try {
                // 解析本地时间格式 YYYY-MM-DD HH:mm 或 ISO 格式
                let completedDate: Date;

                // 检查是否为本地时间格式 YYYY-MM-DD HH:mm
                if (this.reminder.completedTime.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)) {
                    // 本地时间格式，直接转换为 datetime-local 格式
                    const [datePart, timePart] = this.reminder.completedTime.split(' ');
                    completedTimeInput.value = `${datePart}T${timePart}`;
                } else {
                    // 尝试作为 Date 可解析的格式（如 ISO 格式）
                    completedDate = new Date(this.reminder.completedTime);
                    const year = completedDate.getFullYear();
                    const month = String(completedDate.getMonth() + 1).padStart(2, '0');
                    const day = String(completedDate.getDate()).padStart(2, '0');
                    const hours = String(completedDate.getHours()).padStart(2, '0');
                    const minutes = String(completedDate.getMinutes()).padStart(2, '0');
                    completedTimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
                }
            } catch (error) {
                console.error('解析完成时间失败:', error);
                // 如果解析失败，设置为当前时间
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                completedTimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
            }
        } else {
            // 如果没有完成时间，设置为当前时间
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            completedTimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
        }
    }
}
