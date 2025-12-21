import { showMessage, Dialog } from "siyuan";
import { readReminderData, writeReminderData, getBlockByID, getBlockDOM, updateBlockReminderBookmark } from "../api";
import { getLocalTimeString, compareDateStrings, getLogicalDateString } from "../utils/dateUtils";
import { CategoryManager, Category } from "../utils/categoryManager";
import { ProjectManager } from "../utils/projectManager";
import { t } from "../utils/i18n";
import { RepeatSettingsDialog, RepeatConfig } from "./RepeatSettingsDialog";
import { getRepeatDescription } from "../utils/repeatUtils";
import { CategoryManageDialog } from "./CategoryManageDialog";
import * as chrono from 'chrono-node';
import { parseLunarDateText, getCurrentYearLunarToSolar, solarToLunar } from "../utils/lunarUtils";

export class QuickReminderDialog {
    private dialog: Dialog;
    private blockId?: string;
    private reminder?: any;
    private onSaved?: (modifiedReminder?: any) => void;
    private mode: 'quick' | 'block' | 'edit' | 'batch_edit' = 'quick'; // 模式：快速创建、块绑定创建、编辑、批量编辑
    private blockContent: string = '';
    private documentId: string = '';
    private reminderUpdatedHandler: () => void;
    private sortConfigUpdatedHandler: (event: CustomEvent) => void;
    private currentSort: string = 'time';
    private repeatConfig: RepeatConfig;
    private categoryManager: CategoryManager;
    private projectManager: ProjectManager;
    private chronoParser: any; // chrono解析器实例
    private autoDetectDateTime: boolean; // 是否自动识别日期时间
    private defaultProjectId?: string;
    private showKanbanStatus?: 'todo' | 'term' | 'none' = 'term'; // 看板状态显示模式，默认为 'term'
    private defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo' = 'doing'; // 默认任务类型
    private defaultCustomGroupId?: string | null;
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

    constructor(
        date?: string,
        time?: string,
        callback?: (reminder: any) => void,
        timeRangeOptions?: { isTimeRange: boolean; endDate?: string; endTime?: string },
        options?: {
            blockId?: string;
            reminder?: any;
            onSaved?: (modifiedReminder?: any) => void;
            mode?: 'quick' | 'block' | 'edit' | 'batch_edit';
            autoDetectDateTime?: boolean;
            defaultProjectId?: string;
            showKanbanStatus?: 'todo' | 'term' | 'none';
            defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo';
            defaultCustomGroupId?: string | null;
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
        }
    ) {
        this.initialDate = date;
        this.initialTime = time;
        this.isTimeRange = timeRangeOptions?.isTimeRange || false;
        this.initialEndDate = timeRangeOptions?.endDate;
        this.initialEndTime = timeRangeOptions?.endTime;

        // 处理额外选项
        if (options) {
            this.blockId = options.blockId;
            this.reminder = options.reminder;
            this.onSaved = options.onSaved;
            this.mode = options.mode || 'quick';
            this.autoDetectDateTime = options.autoDetectDateTime || false;
            this.defaultProjectId = options.defaultProjectId;
            this.showKanbanStatus = options.showKanbanStatus || 'term';
            this.defaultTermType = options.defaultTermType || 'doing';
            this.defaultCustomGroupId = options.defaultCustomGroupId;
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
        this.repeatConfig = this.reminder?.repeat || {
            enabled: false,
            type: 'daily',
            interval: 1,
            endType: 'never'
        };

        // 初始化chrono解析器，配置中文支持
        this.chronoParser = chrono.zh.casual.clone();
        this.setupChronoParser();

        // 创建事件处理器
        this.reminderUpdatedHandler = () => {
            // 重新加载现有提醒列表（仅块绑定模式）
            if (this.mode === 'block') {
                this.loadExistingReminder();
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

        // 加载排序配置
        this.loadSortConfig();
    }

    // 加载排序配置
    private loadSortConfig() {
        // 从本地存储加载排序配置
        const sortConfig = localStorage.getItem('reminder-sort-config');
        if (sortConfig) {
            try {
                const config = JSON.parse(sortConfig);
                this.currentSort = config.method || 'time';
            } catch (error) {
                console.warn('加载排序配置失败:', error);
                this.currentSort = 'time';
            }
        }
    }

    // 加载现有提醒列表（块绑定模式）
    private async loadExistingReminder() {
        if (this.mode !== 'block' || !this.blockId) return;

        try {
            const reminderData = await readReminderData();
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
            case 'low': return '🟢';
            default: return '⚪';
        }
    }

    // 填充编辑表单数据
    private populateEditForm() {
        if (!this.reminder) return;

        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        const urlInput = this.dialog.element.querySelector('#quickUrlInput') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#quickReminderNote') as HTMLTextAreaElement;
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
        const customReminderTimeInput = this.dialog.element.querySelector('#quickCustomReminderTime') as HTMLInputElement;

        // 填充标题
        if (titleInput && this.reminder.title) {
            titleInput.value = this.reminder.title;
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
        if (noteInput && this.reminder.note) {
            noteInput.value = this.reminder.note;
        }

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

        // 填充日期和时间
        if (this.reminder.date) {
            if (this.reminder.time) {
                // 有时间：设置datetime-local格式
                noTimeCheckbox.checked = false;
                this.toggleDateTimeInputs(false);
                dateInput.value = `${this.reminder.date}T${this.reminder.time}`;
            } else {
                // 无时间：设置date格式
                noTimeCheckbox.checked = true;
                this.toggleDateTimeInputs(true);
                dateInput.value = this.reminder.date;
            }

            // 填充结束日期
            if (this.reminder.endDate) {
                if (this.reminder.endTime) {
                    endDateInput.value = `${this.reminder.endDate}T${this.reminder.endTime}`;
                } else {
                    endDateInput.value = this.reminder.endDate;
                }
            } else if (this.reminder.endTime) {
                // 如果有 endTime 但没有 endDate，默认 endDate 为任务的开始日期或今天
                const defaultEndDate = this.reminder.date || getLogicalDateString();
                if (this.reminder.time) {
                    // 如果开始时间存在，使用 datetime-local 格式
                    endDateInput.value = `${defaultEndDate}T${this.reminder.endTime}`;
                } else {
                    // 如果开始时间不存在，只设置日期
                    endDateInput.value = defaultEndDate;
                }
            }
        } else {
            // 无日期
            noTimeCheckbox.checked = true;
            this.toggleDateTimeInputs(true);
        }

        // 填充项目
        if (projectSelector && this.reminder.projectId) {
            projectSelector.value = this.reminder.projectId;
            // 触发项目选择事件以加载自定义分组
            this.onProjectChange(this.reminder.projectId);
        }

        // 填充自定义分组
        if (this.reminder.customGroupId) {
            setTimeout(() => {
                const customGroupSelector = this.dialog.element.querySelector('#quickCustomGroupSelector') as HTMLSelectElement;
                if (customGroupSelector) {
                    customGroupSelector.value = this.reminder.customGroupId;
                }
            }, 100);
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

        // 等待渲染完成后设置分类、优先级和任务类型
        setTimeout(() => {
            // 填充分类
            if (this.reminder.categoryId) {
                const categoryOptions = this.dialog.element.querySelectorAll('.category-option');
                categoryOptions.forEach(option => {
                    if (option.getAttribute('data-category') === this.reminder.categoryId) {
                        option.classList.add('selected');
                    } else {
                        option.classList.remove('selected');
                    }
                });
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

            // 填充任务类型
            if (this.reminder.termType || this.reminder.kanbanStatus) {
                const termTypeOptions = this.dialog.element.querySelectorAll('.term-type-option');
                let targetTermType = this.reminder.termType;

                // 根据kanbanStatus推断termType
                if (!targetTermType) {
                    if (this.reminder.kanbanStatus === 'doing') {
                        targetTermType = 'doing';
                    } else if (this.reminder.kanbanStatus === 'todo') {
                        targetTermType = this.reminder.termType || 'short_term';
                    }
                }

                termTypeOptions.forEach(option => {
                    if (option.getAttribute('data-term-type') === targetTermType) {
                        option.classList.add('selected');
                    } else {
                        option.classList.remove('selected');
                    }
                });
            }
        }, 100);

        // 填充父任务信息
        this.updateParentTaskDisplay();

        // 填充完成时间
        this.updateCompletedTimeDisplay();
    }

    // 设置chrono解析器
    private setupChronoParser() {
        // 配置chrono选项
        this.chronoParser.option = {
            ...this.chronoParser.option,
            forwardDate: false // 优先解析未来日期
        };

        // 添加自定义解析器来处理紧凑日期格式和其他特殊格式
        this.chronoParser.refiners.push({
            refine: (context, results) => {
                results.forEach(result => {
                    const text = result.text;

                    // 处理YYYYMMDD格式
                    const compactMatch = text.match(/^(\d{8})$/);
                    if (compactMatch) {
                        const dateStr = compactMatch[1];
                        const year = parseInt(dateStr.substring(0, 4));
                        const month = parseInt(dateStr.substring(4, 6));
                        const day = parseInt(dateStr.substring(6, 8));

                        // 验证日期有效性
                        if (this.isValidDate(year, month, day)) {
                            result.start.assign('year', year);
                            result.start.assign('month', month);
                            result.start.assign('day', day);
                        }
                    }

                    // 处理其他数字格式
                    const dashMatch = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
                    if (dashMatch) {
                        const year = parseInt(dashMatch[1]);
                        const month = parseInt(dashMatch[2]);
                        const day = parseInt(dashMatch[3]);

                        if (this.isValidDate(year, month, day)) {
                            result.start.assign('year', year);
                            result.start.assign('month', month);
                            result.start.assign('day', day);
                        }
                    }
                });

                return results;
            }
        });
    }

    // 添加日期有效性验证方法
    private isValidDate(year: number, month: number, day: number): boolean {
        // 基本范围检查
        if (year < 1900 || year > 2100) return false;
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;

        // 创建Date对象进行更精确的验证
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day;
    }

    // 解析自然语言日期时间
    private parseNaturalDateTime(text: string): { date?: string; time?: string; hasTime?: boolean } {
        try {
            // 预处理文本，处理一些特殊格式
            let processedText = text.trim();

            // 处理包含8位数字日期的情况
            const compactDateInTextMatch = processedText.match(/(?:^|.*?)(\d{8})(?:\s|$|.*)/);
            if (compactDateInTextMatch) {
                const dateStr = compactDateInTextMatch[1];
                const year = dateStr.substring(0, 4);
                const month = dateStr.substring(4, 6);
                const day = dateStr.substring(6, 8);

                // 验证日期有效性
                if (this.isValidDate(parseInt(year), parseInt(month), parseInt(day))) {
                    // 检查是否还有时间信息
                    const textWithoutDate = processedText.replace(dateStr, '').trim();
                    let timeResult = null;

                    if (textWithoutDate) {
                        // 尝试从剩余文本中解析时间
                        const timeMatch = textWithoutDate.match(/(\d{1,2})[点时:](\d{1,2})?[分]?/);
                        if (timeMatch) {
                            const hour = parseInt(timeMatch[1]);
                            const minute = timeMatch[2] ? parseInt(timeMatch[2]) : 0;

                            if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
                                const hourStr = hour.toString().padStart(2, '0');
                                const minuteStr = minute.toString().padStart(2, '0');
                                timeResult = `${hourStr}:${minuteStr}`;
                            }
                        }
                    }

                    return {
                        date: `${year}-${month}-${day}`,
                        time: timeResult || undefined,
                        hasTime: !!timeResult
                    };
                }
            }

            // 处理YYYY-MM-DD或YYYY/MM/DD格式
            const standardDateMatch = processedText.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
            if (standardDateMatch) {
                const year = parseInt(standardDateMatch[1]);
                const month = parseInt(standardDateMatch[2]);
                const day = parseInt(standardDateMatch[3]);

                if (this.isValidDate(year, month, day)) {
                    const monthStr = month.toString().padStart(2, '0');
                    const dayStr = day.toString().padStart(2, '0');
                    return {
                        date: `${year}-${monthStr}-${dayStr}`,
                        hasTime: false
                    };
                }
            }

            // 处理农历日期格式（例如：八月廿一、正月初一、农历七月十三）
            // 如果文本包含“农历”关键字，则强制以农历解析（例如“农历7月13”、“农历七月二十”等）
            if (/农历/.test(text) || /农历/.test(processedText)) {
                const lunarDate = parseLunarDateText(processedText);
                if (lunarDate) {
                    // 如果只识别到日期（month === 0），使用当前月作为默认月
                    if (lunarDate.month === 0) {
                        try {
                            const cur = solarToLunar(getLogicalDateString());
                            lunarDate.month = cur.month;
                        } catch (e) {
                            // ignore and fall back
                        }
                    }

                    if (lunarDate.month > 0) {
                        const solarDate = getCurrentYearLunarToSolar(lunarDate.month, lunarDate.day);
                        if (solarDate) {
                            console.log(`农历日期识别成功: 农历${lunarDate.month}月${lunarDate.day}日 -> 公历${solarDate}`);
                            return {
                                date: solarDate,
                                hasTime: false
                            };
                        }
                    }
                }
            }

            // 使用chrono解析其他格式
            const results = this.chronoParser.parse(processedText, new Date(), { forwardDate: false });

            if (results.length === 0) {
                return {};
            }

            const result = results[0];
            const parsedDate = result.start.date();

            // 格式化日期
            const date = parsedDate.toISOString().split('T')[0];

            // 检查是否包含时间信息
            const hasTime = result.start.isCertain('hour') && result.start.isCertain('minute');
            let time = undefined;

            if (hasTime) {
                const hours = parsedDate.getHours().toString().padStart(2, '0');
                const minutes = parsedDate.getMinutes().toString().padStart(2, '0');
                time = `${hours}:${minutes}`;
            }

            return { date, time, hasTime };
        } catch (error) {
            console.error('解析自然语言日期时间失败:', error);
            return {};
        }
    }

    // 从标题自动识别日期时间
    private autoDetectDateTimeFromTitle(title: string): { date?: string; time?: string; hasTime?: boolean; cleanTitle?: string } {
        const parseResult = this.parseNaturalDateTime(title);

        if (!parseResult.date) {
            return { cleanTitle: title };
        }

        // 尝试从标题中移除已识别的时间表达式
        let cleanTitle = title;
        const timeExpressions = [
            /今天|今日/gi,
            /明天|明日/gi,
            /后天/gi,
            /大后天/gi,
            /下?周[一二三四五六日天]/gi,
            /下?星期[一二三四五六日天]/gi,
            /\d{1,2}月\d{1,2}[日号]/gi,
            /\d{1,2}[点时]\d{0,2}[分]?/gi,
            /\d+天[后以]后/gi,
            /\d+小时[后以]后/gi,
            /\d{8}/gi, // 8位数字日期
        ];

        timeExpressions.forEach(pattern => {
            cleanTitle = cleanTitle.replace(pattern, '').trim();
        });

        // 清理多余的空格和标点
        cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、\s]+|[，。、\s]+$/g, '');

        return {
            ...parseResult,
            cleanTitle: cleanTitle || title // 如果清理后为空，则保持原标题
        };
    }

    // 显示自然语言输入对话框
    private showNaturalLanguageDialog() {
        // 获取标题输入框的内容作为默认值
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
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

        let currentParseResult: { date?: string; time?: string; hasTime?: boolean } = {};

        // 实时解析输入
        const updatePreview = () => {
            const text = nlInput.value.trim();
            if (!text) {
                nlPreview.textContent = '请输入日期时间描述';
                nlPreview.className = 'nl-preview';
                nlConfirmBtn.disabled = true;
                return;
            }

            currentParseResult = this.parseNaturalDateTime(text);

            if (currentParseResult.date) {
                const dateStr = new Date(currentParseResult.date + 'T00:00:00').toLocaleDateString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'long'
                });

                let previewText = `📅 ${dateStr}`;
                if (currentParseResult.time) {
                    previewText += ` ⏰ ${currentParseResult.time}`;
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
    private applyNaturalLanguageResult(result: { date?: string; time?: string; hasTime?: boolean }) {
        if (!result.date) return;

        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;

        // 设置日期和时间
        if (result.hasTime && result.time) {
            // 有时间信息：先设置复选框状态，再切换输入框类型，最后设置值
            noTimeCheckbox.checked = false;
            this.toggleDateTimeInputs(false);
            // 确保在切换类型后设置正确格式的值
            dateInput.value = `${result.date}T${result.time}`;
        } else {
            // 只有日期信息：先设置复选框状态，再切换输入框类型，最后设置值
            noTimeCheckbox.checked = true;
            this.toggleDateTimeInputs(true);
            // 确保在切换类型后设置正确格式的值
            dateInput.value = result.date;
        }

        // 触发日期变化事件以更新结束日期限制
        dateInput.dispatchEvent(new Event('change'));

        showMessage(`✨ 已识别并设置：${new Date(result.date + 'T00:00:00').toLocaleDateString('zh-CN')}${result.time ? ` ${result.time}` : ''}`);
    }

    public async show() {
        // 初始化分类管理器
        await this.categoryManager.initialize();

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
                    showMessage(t("blockNotExist"));
                    return;
                }
                try {
                    // 如果是文档块，直接使用文档/块的标题内容
                    if (block.type === 'd') {
                        this.blockContent = block.content || t("unnamedNote");
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
                        this.blockContent = element ? (element.textContent || '').trim() : (block?.fcontent || block?.content || t("unnamedNote"));
                    }
                } catch (e) {
                    this.blockContent = block?.fcontent || block?.content || t("unnamedNote");
                }
            } catch (error) {
                console.warn('获取块信息失败:', error);
            }
        }

        this.dialog = new Dialog({
            title: this.mode === 'edit' ? t("editReminder") : t("createQuickReminder"),
            content: `
                <div class="quick-reminder-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("eventTitle")}</label>
                            <div class="title-input-container" style="display: flex; gap: 8px;">
                                <input type="text" id="quickReminderTitle" class="b3-text-field" placeholder="${t("enterReminderTitle")}" style="flex: 1;" required autofocus>
                                <button type="button" id="quickNlBtn" class="b3-button b3-button--outline" title="✨ 智能日期识别">
                                    ✨
                                </button>
                            </div>
                        </div>
                        <!-- 绑定块/文档输入，允许手动输入块 ID 或文档 ID -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("bindToBlock") || '块或文档 ID'}</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="quickBlockInput" class="b3-text-field" value="${this.defaultBlockId || ''}" placeholder="${t("enterBlockId") || '请输入块或文档 ID'}" style="flex: 1;">
                                <button type="button" id="quickPasteBlockRefBtn" class="b3-button b3-button--outline" title="${t("pasteBlockRef")}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>
                                </button>
                                <button type="button" id="quickCreateDocBtn" class="b3-button b3-button--outline" title="${t("createNewDocument") || '新建文档'}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                </button>
                            </div>
                        </div>
                        <!-- 网页链接输入 -->
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("bindUrl")}</label>
                            <input type="url" id="quickUrlInput" class="b3-text-field" placeholder="${t("enterUrl")}" style="width: 100%;">
                        </div>
                        <!-- 父任务显示 -->
                        <div class="b3-form__group" id="quickParentTaskGroup" style="display: none;">
                            <label class="b3-form__label">${t("parentTask") || "父任务"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="text" id="quickParentTaskDisplay" class="b3-text-field" readonly style="flex: 1; background: var(--b3-theme-background-light); cursor: default;" placeholder="无父任务">
                                <button type="button" id="quickViewParentBtn" class="b3-button b3-button--outline" title="${t("viewParentTask") || "查看父任务"}" style="display: none;">
                                    <svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg>
                                </button>
                            </div>
                            <div class="b3-form__desc" style="font-size: 11px; color: var(--b3-theme-on-surface-light);">
                                父任务 ID: <span id="quickParentTaskId" style="font-family: monospace;">-</span>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("eventCategory")}
                                <button type="button" id="quickManageCategoriesBtn" class="b3-button b3-button--outline" title="管理分类">
                                    <svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg>
                                </button>
                            </label>
                            <div class="category-selector" id="quickCategorySelector" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px;">
                                <!-- 分类选择器将在这里渲染 -->
                            </div>
                        </div>
                        <div class="b3-form__group" id="quickProjectGroup" style="${this.hideProjectSelector ? 'display: none;' : ''}">
                            <label class="b3-form__label">${t("projectManagement")}</label>
                            <select id="quickProjectSelector" class="b3-select" style="width: 100%;">
                                <option value="">${t("noProject")}</option>
                                <!-- 项目选择器将在这里渲染 -->
                            </select>
                        </div>
                        <div class="b3-form__group" id="quickCustomGroup" style="display: none;">
                            <label class="b3-form__label">${t("customGroup") || '自定义分组'}</label>
                            <select id="quickCustomGroupSelector" class="b3-select" style="width: 100%;">
                                <option value="">${t("noGroup") || '无分组'}</option>
                                <!-- 自定义分组选择器将在这里渲染 -->
                            </select>
                        </div>
                        <div class="b3-form__group" id="quickTagsGroup" style="display: none;">
                            <label class="b3-form__label">${t('tags')}</label>
                            <div id="quickTagsSelector" class="tags-selector" style="display: flex; flex-wrap: wrap; gap: 6px;">
                                <!-- 标签选择器将在这里渲染 -->
                            </div>
                        </div>
                        ${this.renderTermTypeSelector()}
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("priority")}</label>
                            <div class="priority-selector" id="quickPrioritySelector">
                                <div class="priority-option" data-priority="high">
                                    <div class="priority-dot high"></div>
                                    <span>${t("highPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="medium">
                                    <div class="priority-dot medium"></div>
                                    <span>${t("mediumPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="low">
                                    <div class="priority-dot low"></div>
                                    <span>${t("lowPriority")}</span>
                                </div>
                                <div class="priority-option" data-priority="none">
                                    <div class="priority-dot none"></div>
                                    <span>${t("noPriority")}</span>
                                </div>
                            </div>
                        </div>
                        <!-- 完成时间显示和编辑 -->
                        <div class="b3-form__group" id="quickCompletedTimeGroup" style="display: none;">
                            <label class="b3-form__label">${t("completedAt") || "完成时间"}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="datetime-local" id="quickCompletedTime" class="b3-text-field" style="flex: 1;">
                                <button type="button" id="quickSetCompletedNowBtn" class="b3-button b3-button--outline" title="${t("setToNow") || "设为当前时间"}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconClock"></use></svg>
                                </button>
                                <button type="button" id="quickClearCompletedBtn" class="b3-button b3-button--outline" title="${t("clearCompletedTime") || "清除完成时间"}">
                                    <svg class="b3-button__icon"><use xlink:href="#iconTrashcan"></use></svg>
                                </button>
                            </div>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-checkbox">
                                <input type="checkbox" id="quickNoSpecificTime" ${this.initialTime ? '' : 'checked'}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${t("noSpecificTime")}</span>
                            </label>
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderDate")} (可选)</label>
                            <div class="reminder-date-container">
                                <input type="date" id="quickReminderDate" class="b3-text-field" value="${this.initialDate || ''}" max="9999-12-31">
                                <span class="reminder-arrow">→</span>
                                <input type="date" id="quickReminderEndDate" class="b3-text-field reminder-end-date" placeholder="${t("endDateOptional")}" title="${t("spanningEventDesc")}" max="9999-12-31">
                            </div>
                            <div class="b3-form__desc" id="quickDateTimeDesc">${this.initialTime ? t("dateTimeDesc") : '可以不设置日期'}</div>
                        </div>

                        <div class="b3-form__group">
                            <label class="b3-form__label">自定义提醒时间 (可选，支持多个)</label>
                            <div id="quickCustomTimeList" style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
                                <!-- Added times will be shown here -->
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                                <input type="datetime-local" id="quickCustomReminderTime" class="b3-text-field" style="flex: 1;">
                                <input type="text" id="quickCustomReminderNote" class="b3-text-field" placeholder="备注" style="width: 120px;">
                                <button type="button" id="quickAddCustomTimeBtn" class="b3-button b3-button--outline" title="添加时间">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                                </button>
                            </div>

                            <div style="width: 100%;">
                                <label class="b3-form__label" style="font-size: 12px;">快速设置</label>
                                <select id="quickCustomReminderPreset" class="b3-select" style="width: 100%;">
                                    <option value="">选择预设...</option>
                                    <option value="5m">提前 5 分钟</option>
                                    <option value="10m">提前 10 分钟</option>
                                    <option value="30m">提前 30 分钟</option>
                                    <option value="1h">提前 1 小时</option>
                                    <option value="2h">提前 2 小时</option>
                                    <option value="1d">提前 1 天</option>
                                </select>
                            </div>
                        </div>
                        
                        <!-- 添加重复设置 -->
                        <div class="b3-form__group" id="repeatSettingsGroup" style="${this.isInstanceEdit ? 'display: none;' : ''}">
                            <label class="b3-form__label">${t("repeatSettings")}</label>
                            <div class="repeat-setting-container">
                                <button type="button" id="quickRepeatSettingsBtn" class="b3-button b3-button--outline" style="width: 100%;">
                                    <span id="quickRepeatDescription">${t("noRepeat")}</span>
                                    <svg class="b3-button__icon" style="margin-left: auto;"><use xlink:href="#iconRight"></use></svg>
                                </button>
                            </div>
                        </div>
                        
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t("reminderNoteOptional")}</label>
                            <textarea id="quickReminderNote" class="b3-text-field" placeholder="${t("enterReminderNote")}" rows="2" style="width: 100%;resize: vertical; min-height: 60px;"></textarea>
                        </div>
                        
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="quickConfirmBtn">${this.mode === 'edit' ? t("save") : t("save")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "81vh"
        });

        this.bindEvents();
        await this.renderCategorySelector();
        await this.renderProjectSelector();
        await this.renderPrioritySelector();
        await this.renderTagsSelector();

        // 确保日期和时间输入框正确设置初始值
        setTimeout(() => {
            const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
            const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
            const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
            const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;

            // 根据是否有初始时间设置输入框类型和值
            if (this.initialTime) {
                // 有时间：先设置复选框状态，再切换输入框类型，最后设置值
                noTimeCheckbox.checked = false;
                this.toggleDateTimeInputs(false);
                // 确保在切换类型后设置正确格式的值
                dateInput.value = `${this.initialDate}T${this.initialTime}`;

                // 如果是时间段选择且有结束时间，设置结束日期时间
                if (this.isTimeRange && this.initialEndDate) {
                    const endDateTime = this.initialEndTime ?
                        `${this.initialEndDate}T${this.initialEndTime}` :
                        `${this.initialEndDate}T${this.initialTime}`;
                    endDateInput.value = endDateTime;
                }
            } else {
                // 无时间：先设置复选框状态，再切换输入框类型，最后设置值
                noTimeCheckbox.checked = true;
                this.toggleDateTimeInputs(true);
                // 确保在切换类型后设置正确格式的值
                // 如果没有初始日期（空字符串），则保持输入框为空
                if (this.initialDate) {
                    dateInput.value = this.initialDate;
                }

                // 如果是时间段选择，设置结束日期
                if (this.isTimeRange && this.initialEndDate) {
                    // 确保结束日期输入框也是正确的类型
                    endDateInput.value = this.initialEndDate;
                }
            }

            // 设置默认值：优先使用 this.blockContent，其次使用 this.defaultTitle
            if (this.blockContent && titleInput) {
                titleInput.value = this.blockContent;
            } else if (this.defaultTitle && titleInput) {
                titleInput.value = this.defaultTitle;
            }

            if (this.defaultNote) {
                const noteInput = this.dialog.element.querySelector('#quickReminderNote') as HTMLTextAreaElement;
                if (noteInput) {
                    noteInput.value = this.defaultNote;
                }
            }

            // 如果是编辑模式，填充现有提醒数据
            if (this.mode === 'edit' && this.reminder) {
                this.populateEditForm();
            }

            // 自动聚焦标题输入框
            titleInput?.focus();
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

    // 渲染任务类型选择器
    private renderTermTypeSelector(): string {
        // 如果 showKanbanStatus 为 'none'，不显示任务类型选择器
        if (this.showKanbanStatus === 'none') {
            return '';
        }

        let options = '';

        if (this.showKanbanStatus === 'todo') {
            // 显示 todo 和 doing
            options = `
                <div class="term-type-option ${this.defaultTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'todo' ? 'selected' : ''}" data-term-type="todo">
                    <span>📝 待办</span>
                </div>
            `;
        } else if (this.showKanbanStatus === 'term') {
            // 显示 doing、short_term、long_term
            options = `
                <div class="term-type-option ${this.defaultTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'short_term' || (!this.defaultTermType && this.showKanbanStatus === 'term') ? 'selected' : ''}" data-term-type="short_term">
                    <span>📋 短期待办</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'long_term' ? 'selected' : ''}" data-term-type="long_term">
                    <span>📅 长期待办</span>
                </div>
            `;
        } else {
            // 默认情况（showKanbanStatus === 'todo'），显示 todo 和 doing
            options = `
                <div class="term-type-option ${this.defaultTermType === 'todo' ? 'selected' : ''}" data-term-type="todo">
                    <span>📝 待办</span>
                </div>
                <div class="term-type-option ${this.defaultTermType === 'doing' ? 'selected' : ''}" data-term-type="doing">
                    <span>🔥 进行中</span>
                </div>
            `;
        }

        return `
            <div class="b3-form__group">
                <label class="b3-form__label">任务类型</label>
                <div class="term-type-selector" id="quickTermTypeSelector" style="display: flex; gap: 12px;">
                    ${options}
                </div>
            </div>
        `;
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
            noCategoryEl.innerHTML = `<span>${t("noCategory")}</span>`;
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
            if (this.defaultCategoryId) {
                const categoryButtons = this.dialog.element.querySelectorAll('.category-option');
                categoryButtons.forEach(button => {
                    const categoryId = button.getAttribute('data-category');
                    if (categoryId === this.defaultCategoryId) {
                        button.classList.add('selected');
                    }
                });
            } else {
                // 如果没有默认分类，选中无分类选项
                noCategoryEl.classList.add('selected');
            }

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
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
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

    // 切换日期时间输入框类型
    private toggleDateTimeInputs(noSpecificTime: boolean) {
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const dateTimeDesc = this.dialog.element.querySelector('#quickDateTimeDesc') as HTMLElement;

        if (noSpecificTime) {
            // 不设置具体时间：使用date类型
            // 先保存当前值
            const startValue = startDateInput.value;
            const endValue = endDateInput.value;

            // 切换类型和max属性
            startDateInput.type = 'date';
            endDateInput.type = 'date';
            startDateInput.max = '9999-12-31';
            endDateInput.max = '9999-12-31';

            // 如果当前值包含时间，只保留日期部分，不清空日期
            if (startValue && startValue.includes('T')) {
                startDateInput.value = startValue.split('T')[0];
            } else if (startValue) {
                startDateInput.value = startValue;
            } else if (this.initialDate) {
                // 如果没有当前值但有初始日期，设置初始日期
                startDateInput.value = this.initialDate;
            }

            if (endValue && endValue.includes('T')) {
                endDateInput.value = endValue.split('T')[0];
            } else if (endValue) {
                endDateInput.value = endValue;
            } else if (this.isTimeRange && this.initialEndDate) {
                // 如果没有当前值但是时间段选择且有初始结束日期，设置初始结束日期
                endDateInput.value = this.initialEndDate;
            }

            if (dateTimeDesc) {
                dateTimeDesc.textContent = t("dateOnlyDesc");
            }

            // 隐藏/禁用快速预设下拉（仅在有具体时间时可用）
            try {
                const preset = this.dialog.element.querySelector('#quickCustomReminderPreset') as HTMLSelectElement;
                if (preset) {
                    preset.disabled = true;
                    preset.style.opacity = '0.6';
                }
            } catch (e) {
                // ignore
            }
        } else {
            // 设置具体时间：使用datetime-local类型
            // 先保存当前值
            const startValue = startDateInput.value;
            const endValue = endDateInput.value;

            // 切换类型和max属性
            startDateInput.type = 'datetime-local';
            endDateInput.type = 'datetime-local';
            startDateInput.max = '9999-12-31T23:59';
            endDateInput.max = '9999-12-31T23:59';

            // 如果当前值只有日期，添加默认时间，保留原有日期
            if (startValue && !startValue.includes('T')) {
                const currentTime = this.initialTime;
                if (currentTime) {
                    startDateInput.value = `${startValue}T${currentTime}`;
                } else {
                    // 如果没有初始时间，使用当前时间
                    const now = new Date();
                    const currentTimeStr = now.toTimeString().slice(0, 5); // HH:MM
                    startDateInput.value = `${startValue}T${currentTimeStr}`;
                }
            } else if (!startValue) {
                // 如果没有日期值，设置默认日期和时间
                const currentTime = this.initialTime;
                if (currentTime) {
                    startDateInput.value = `${this.initialDate}T${currentTime}`;
                }
            } else {
                // 如果已经有完整的datetime-local格式，直接设置
                startDateInput.value = startValue;
            }            // 处理结束日期输入框
            if (endValue && !endValue.includes('T')) {
                // 如果结束日期有值但没有时间，添加默认时间
                const endTime = this.initialEndTime || this.initialTime;
                if (endTime) {
                    endDateInput.value = `${endValue}T${endTime}`;
                } else {
                    // 如果没有初始时间，使用当前时间
                    const now = new Date();
                    const currentTimeStr = now.toTimeString().slice(0, 5); // HH:MM
                    endDateInput.value = `${endValue}T${currentTimeStr}`;
                }
            } else if (endValue) {
                // 如果已经有完整的datetime-local格式，直接设置
                endDateInput.value = endValue;
            } else if (this.isTimeRange && this.initialEndDate) {
                // 如果没有当前值但是时间段选择且有初始结束日期和时间，设置初始值
                const endTime = this.initialEndTime || this.initialTime;
                if (endTime) {
                    endDateInput.value = `${this.initialEndDate}T${endTime}`;
                }
            }

            if (dateTimeDesc) {
                dateTimeDesc.textContent = t("dateTimeDesc");
            }

            // 启用快速预设下拉
            try {
                const preset = this.dialog.element.querySelector('#quickCustomReminderPreset') as HTMLSelectElement;
                if (preset) {
                    preset.disabled = false;
                    preset.style.opacity = '';
                }
            } catch (e) {
                // ignore
            }
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

    private bindEvents() {
        const cancelBtn = this.dialog.element.querySelector('#quickCancelBtn') as HTMLButtonElement;
        const confirmBtn = this.dialog.element.querySelector('#quickConfirmBtn') as HTMLButtonElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const startDateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const prioritySelector = this.dialog.element.querySelector('#quickPrioritySelector') as HTMLElement;
        const categorySelector = this.dialog.element.querySelector('#quickCategorySelector') as HTMLElement;
        const repeatSettingsBtn = this.dialog.element.querySelector('#quickRepeatSettingsBtn') as HTMLButtonElement;
        const manageCategoriesBtn = this.dialog.element.querySelector('#quickManageCategoriesBtn') as HTMLButtonElement;
        const nlBtn = this.dialog.element.querySelector('#quickNlBtn') as HTMLButtonElement;
        const createDocBtn = this.dialog.element.querySelector('#quickCreateDocBtn') as HTMLButtonElement;
        const pasteBlockRefBtn = this.dialog.element.querySelector('#quickPasteBlockRefBtn') as HTMLButtonElement;
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const dateTimeDesc = this.dialog.element.querySelector('#quickDateTimeDesc') as HTMLElement;

        // 添加自定义时间按钮
        const addCustomTimeBtn = this.dialog.element.querySelector('#quickAddCustomTimeBtn') as HTMLButtonElement;
        const customReminderInput = this.dialog.element.querySelector('#quickCustomReminderTime') as HTMLInputElement;
        const customReminderNoteInput = this.dialog.element.querySelector('#quickCustomReminderNote') as HTMLInputElement;

        addCustomTimeBtn?.addEventListener('click', () => {
            const time = customReminderInput.value;
            const note = customReminderNoteInput?.value?.trim();
            if (time) {
                this.addCustomTime(time, note);
                customReminderInput.value = ''; // 清空输入框
                if (customReminderNoteInput) customReminderNoteInput.value = '';
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
                // 移除所有选中状态
                categorySelector.querySelectorAll('.category-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                // 添加选中状态
                option.classList.add('selected');

                // 添加点击反馈动画
                option.style.transform = 'scale(0.9)';
                setTimeout(() => {
                    option.style.transform = '';
                }, 150);
            }
        });

        // 任务类型选择事件
        const termTypeSelector = this.dialog.element.querySelector('#quickTermTypeSelector') as HTMLElement;
        termTypeSelector?.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.term-type-option') as HTMLElement;
            if (option) {
                termTypeSelector.querySelectorAll('.term-type-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            this.dialog.destroy();
        });

        // 确定按钮
        confirmBtn?.addEventListener('click', () => {
            this.saveReminder();
        });

        // 时间复选框 - 切换日期输入框类型
        noTimeCheckbox?.addEventListener('change', () => {
            this.toggleDateTimeInputs(noTimeCheckbox.checked);
        });

        // 日期验证
        startDateInput?.addEventListener('change', () => {
            const startDate = startDateInput.value;
            // 设置结束日期的最小值
            endDateInput.min = startDate;
        });

        // 结束日期验证
        endDateInput?.addEventListener('change', () => {
            // 移除立即验证逻辑，只在保存时验证
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
                    const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;

                    if (blockInput) {
                        blockInput.value = blockId;
                    }
                    if (titleInput && title && (!titleInput.value || titleInput.value.trim().length === 0)) {
                        titleInput.value = title;
                    }
                    showMessage(t('pasteBlockRefSuccess'));
                } else {
                    showMessage(t('pasteBlockRefFailed'), 3000, 'error');
                }
            } catch (error) {
                console.error('读取剪贴板失败:', error);
                showMessage(t('readClipboardFailed'), 3000, 'error');
            }
        });

        // 规范化 quickBlockInput：当用户直接粘贴 ((id 'title')) 或链接时，自动替换为纯 id
        const quickBlockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        if (quickBlockInput) {
            let isAutoSetting = false;
            quickBlockInput.addEventListener('input', async () => {
                if (isAutoSetting) return;
                const raw = quickBlockInput.value?.trim();
                if (!raw) return;
                const id = this.extractBlockId(raw);
                if (id && id !== raw && (raw.includes('((') || raw.includes('siyuan://blocks/') || raw.includes(']('))) {
                    try {
                        isAutoSetting = true;
                        quickBlockInput.value = id;
                    } finally {
                        setTimeout(() => { isAutoSetting = false; }, 0);
                    }
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
                const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;

                // 仅在任务已设置具体时间时可用
                if (!dateInput || !dateInput.value || noTimeCheckbox.checked || !dateInput.value.includes('T')) {
                    showMessage('请先为任务设置具体时间，然后使用快速设置。');
                    presetSelect.value = '';
                    return;
                }

                const base = new Date(dateInput.value);
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
                if (customReminderInput) {
                    customReminderInput.value = dtLocal;
                }

                // 保留所选选项，以便用户/编辑时可见是哪个预设
                presetSelect.value = val;
            } catch (e) {
                console.error('应用快速预设失败:', e);
            }
        });

        // 当用户手动修改自定义提醒时间时，将预设标记为 custom（自定义）以便保存和显示
        customReminderInput?.addEventListener('input', () => {
            try {
                if (!presetSelect) return;
                // 将预设切换为自定义
                presetSelect.value = 'custom';
            } catch (e) {
                // ignore
            }
        });

        // 如果 custom input 聚焦且为空，尝试从任务日期初始化（保持现有行为）
        try {
            customReminderInput?.addEventListener('focus', () => {
                try {
                    if (customReminderInput.value) return;
                    const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                    const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
                    if (dateInput && !noTimeCheckbox.checked && dateInput.value && dateInput.value.includes('T')) {
                        customReminderInput.value = dateInput.value;
                    }
                } catch (e) {
                    console.warn('初始化自定义提醒时间失败:', e);
                }
            });
            customReminderInput?.addEventListener('click', () => {
                try {
                    if (customReminderInput.value) return;
                    const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                    const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
                    if (dateInput && !noTimeCheckbox.checked && dateInput.value && dateInput.value.includes('T')) {
                        customReminderInput.value = dateInput.value;
                    }
                } catch (e) {
                    console.warn('初始化自定义提醒时间失败:', e);
                }
            });
        } catch (e) {
            // ignore
        }

        // 自定义提醒时间：如果为空且任务已设置日期+时间，聚焦/点击时用任务的日期时间初始化
        try {
            const customReminderInput = this.dialog.element.querySelector('#quickCustomReminderTime') as HTMLInputElement;
            customReminderInput?.addEventListener('focus', () => {
                try {
                    if (customReminderInput.value) return;
                    const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                    const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
                    // 仅在任务设置了具体时间（datetime-local）时初始化
                    if (dateInput && !noTimeCheckbox.checked && dateInput.value && dateInput.value.includes('T')) {
                        customReminderInput.value = dateInput.value;
                    }
                } catch (e) {
                    console.warn('初始化自定义提醒时间失败:', e);
                }
            });
            customReminderInput?.addEventListener('click', () => {
                try {
                    if (customReminderInput.value) return;
                    const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
                    const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
                    if (dateInput && !noTimeCheckbox.checked && dateInput.value && dateInput.value.includes('T')) {
                        customReminderInput.value = dateInput.value;
                    }
                } catch (e) {
                    console.warn('初始化自定义提醒时间失败:', e);
                }
            });
        } catch (e) {
            // 忽略错误，防止在没有该元素时抛异常
        }

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
            const description = this.repeatConfig.enabled ? getRepeatDescription(this.repeatConfig) : t("noRepeat");
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
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
        if (!projectSelector) return;

        try {
            await this.projectManager.initialize();
            const groupedProjects = this.projectManager.getProjectsGroupedByStatus();

            // 清空并重新构建项目选择器
            projectSelector.innerHTML = '';

            // 添加无项目选项
            const noProjectOption = document.createElement('option');
            noProjectOption.value = '';
            noProjectOption.textContent = t('noProject');
            projectSelector.appendChild(noProjectOption);

            // 按状态分组添加项目
            Object.keys(groupedProjects).forEach(statusKey => {
                const projects = groupedProjects[statusKey] || [];
                const nonArchivedProjects = projects.filter(project => {
                    const projectStatus = this.projectManager.getProjectById(project.id)?.status || 'doing';
                    return projectStatus !== 'archived';
                });

                if (nonArchivedProjects.length > 0) {
                    // 添加状态分组
                    const statusName = this.getStatusDisplayName(statusKey);
                    const optgroup = document.createElement('optgroup');
                    optgroup.label = statusName;

                    nonArchivedProjects.forEach(project => {
                        const option = document.createElement('option');
                        option.value = project.id;
                        option.textContent = project.name;

                        // 如果设置了默认项目，选中它
                        if (this.defaultProjectId === project.id) {
                            option.selected = true;
                        }

                        optgroup.appendChild(option);
                    });

                    projectSelector.appendChild(optgroup);
                }
            });

            // 添加项目选择器改变事件监听器
            projectSelector.addEventListener('change', async () => {
                await this.onProjectChange(projectSelector.value);
            });

            // 初始化时检查默认项目
            if (this.defaultProjectId) {
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

                if (projectGroups.length > 0) {
                    // 显示分组选择器并渲染分组选项
                    customGroupContainer.style.display = 'block';
                    await this.renderCustomGroupSelector(projectId);
                } else {
                    // 隐藏分组选择器
                    customGroupContainer.style.display = 'none';
                }
            } catch (error) {
                console.error('检查项目分组失败:', error);
                customGroupContainer.style.display = 'none';
            }
        } else {
            // 没有选择项目，隐藏分组选择器
            customGroupContainer.style.display = 'none';
        }

        // 更新标签选择器
        await this.renderTagsSelector();
    }

    /**
     * 渲染自定义分组选择器
     */
    private async renderCustomGroupSelector(projectId: string) {
        const groupSelector = this.dialog.element.querySelector('#quickCustomGroupSelector') as HTMLSelectElement;
        if (!groupSelector) return;

        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(projectId);

            // 清空并重新构建分组选择器
            groupSelector.innerHTML = '';

            // 添加无分组选项
            const noGroupOption = document.createElement('option');
            noGroupOption.value = '';
            noGroupOption.textContent = t('noGroup') || '无分组';
            groupSelector.appendChild(noGroupOption);

            // 添加所有分组选项
            projectGroups.forEach((group: any) => {
                const option = document.createElement('option');
                option.value = group.id;
                option.textContent = `${group.icon || '📋'} ${group.name}`.trim();
                groupSelector.appendChild(option);
            });

            // 如果传入了默认 custom group id，则预选（注意：null 表示明确不分组）
            if (this['defaultCustomGroupId'] !== undefined) {
                if (this['defaultCustomGroupId'] === null) {
                    groupSelector.value = '';
                } else {
                    groupSelector.value = this['defaultCustomGroupId'];
                }
            }
        } catch (error) {
            console.error('渲染自定义分组选择器失败:', error);
        }
    }

    /**
     * 显示创建文档对话框
     */
    private showCreateDocumentDialog() {
        // 检查plugin是否已初始化
        if (!this.plugin) {
            showMessage('⚠️ 无法创建文档：插件实例未初始化。请确保在创建QuickReminderDialog时传入plugin参数。');
            console.error('QuickReminderDialog: plugin未初始化。请在构造函数的options参数中传入plugin实例。');
            return;
        }

        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const defaultTitle = titleInput?.value?.trim() || '';

        const createDocDialog = new Dialog({
            title: t("createNewDocument") || '新建文档',
            content: `
                <div class="create-doc-dialog">
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">文档标题</label>
                            <input type="text" id="quickDocTitleInput" class="b3-text-field" value="${defaultTitle}" placeholder="请输入文档标题" style="width: 100%; margin-top: 8px;">
                        </div>
                        <div class="b3-form__group">
                            <label class="b3-form__label">文档内容（可选）</label>
                            <textarea id="quickDocContentInput" class="b3-text-field" placeholder="请输入文档内容" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="quickCreateDocCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="quickCreateDocConfirmBtn">${t("confirm") || '确定'}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "300px"
        });

        const docTitleInput = createDocDialog.element.querySelector('#quickDocTitleInput') as HTMLInputElement;
        const docContentInput = createDocDialog.element.querySelector('#quickDocContentInput') as HTMLTextAreaElement;
        const cancelBtn = createDocDialog.element.querySelector('#quickCreateDocCancelBtn') as HTMLButtonElement;
        const confirmBtn = createDocDialog.element.querySelector('#quickCreateDocConfirmBtn') as HTMLButtonElement;

        // 取消按钮
        cancelBtn?.addEventListener('click', () => {
            createDocDialog.destroy();
        });

        // 确认按钮
        confirmBtn?.addEventListener('click', async () => {
            const title = docTitleInput.value.trim();
            const content = docContentInput.value.trim();

            if (!title) {
                showMessage(t("pleaseEnterTitle"));
                return;
            }

            try {
                const docId = await this.createDocument(title, content);
                if (docId) {
                    // 自动填入文档ID到绑定块输入框
                    const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
                    if (blockInput) {
                        blockInput.value = docId;
                    }
                    showMessage('✓ 文档创建成功，已自动填入ID');
                    createDocDialog.destroy();
                }
            } catch (error) {
                console.error('创建文档失败:', error);
                showMessage(t("createDocumentFailed") || '创建文档失败');
            }
        });

        // 自动聚焦标题输入框
        setTimeout(() => {
            docTitleInput?.focus();
        }, 100);
    }

    /**
     * 创建文档
     */
    private async createDocument(title: string, content: string): Promise<string> {
        try {
            if (!this.plugin) {
                const errorMsg = 'QuickReminderDialog: plugin未初始化。请在构造函数的options中传入plugin实例，例如：new QuickReminderDialog(date, time, callback, timeRangeOptions, { plugin: this.plugin })';
                console.error(errorMsg);
                throw new Error('插件实例未初始化');
            }

            // 获取插件设置
            const settings = await this.plugin.loadSettings();
            const notebook = settings.newDocNotebook;
            const pathTemplate = settings.newDocPath || '/{{now | date "2006/200601"}}/';

            if (!notebook) {
                throw new Error(t("pleaseConfigureNotebook") || '请在设置中配置新建文档的笔记本');
            }

            // 导入API函数
            const { renderSprig, createDocWithMd } = await import("../api");

            // 渲染路径模板
            let renderedPath: string;
            try {
                // 检测pathTemplate是否以/结尾，如果不是，则添加/
                if (!pathTemplate.endsWith('/')) {
                    renderedPath = pathTemplate + '/';
                } else {
                    renderedPath = pathTemplate;
                }
                renderedPath = await renderSprig(renderedPath + title);
            } catch (error) {
                console.error('渲染路径模板失败:', error);
                throw new Error(t("renderPathFailed") || '渲染路径模板失败');
            }

            // 准备文档内容
            const docContent = content;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);

            return docId;
        } catch (error) {
            console.error('创建文档失败:', error);
            throw error;
        }
    }

    private async saveReminder() {
        const titleInput = this.dialog.element.querySelector('#quickReminderTitle') as HTMLInputElement;
        const blockInput = this.dialog.element.querySelector('#quickBlockInput') as HTMLInputElement;
        const urlInput = this.dialog.element.querySelector('#quickUrlInput') as HTMLInputElement;
        const dateInput = this.dialog.element.querySelector('#quickReminderDate') as HTMLInputElement;
        const endDateInput = this.dialog.element.querySelector('#quickReminderEndDate') as HTMLInputElement;
        const noTimeCheckbox = this.dialog.element.querySelector('#quickNoSpecificTime') as HTMLInputElement;
        const noteInput = this.dialog.element.querySelector('#quickReminderNote') as HTMLTextAreaElement;
        const projectSelector = this.dialog.element.querySelector('#quickProjectSelector') as HTMLSelectElement;
        const selectedPriority = this.dialog.element.querySelector('#quickPrioritySelector .priority-option.selected') as HTMLElement;
        const selectedCategory = this.dialog.element.querySelector('#quickCategorySelector .category-option.selected') as HTMLElement;
        const selectedTermType = this.dialog.element.querySelector('#quickTermTypeSelector .term-type-option.selected') as HTMLElement;
        const customGroupSelector = this.dialog.element.querySelector('#quickCustomGroupSelector') as HTMLSelectElement;

        const title = titleInput.value.trim();
        const rawBlockVal = blockInput?.value?.trim() || undefined;
        const inputId = rawBlockVal ? (this.extractBlockId(rawBlockVal) || rawBlockVal) : undefined;
        const url = urlInput?.value?.trim() || undefined;
        const note = noteInput.value.trim() || undefined;
        const priority = selectedPriority?.getAttribute('data-priority') || 'none';
        const categoryId = selectedCategory?.getAttribute('data-category') || undefined;
        const projectId = projectSelector.value || undefined;
        const termType = selectedTermType?.getAttribute('data-term-type') as 'short_term' | 'long_term' | 'doing' | 'todo' | undefined;
        const customGroupId = customGroupSelector?.value || undefined;
        const customReminderTime = (this.dialog.element.querySelector('#quickCustomReminderTime') as HTMLInputElement).value.trim() || undefined;
        const customReminderPreset = (this.dialog.element.querySelector('#quickCustomReminderPreset') as HTMLSelectElement)?.value || undefined;

        // 获取选中的标签ID（使用 selectedTagIds 属性）
        const tagIds = this.selectedTagIds;

        // 解析日期和时间
        let date: string;
        let endDate: string;
        let time: string | undefined;
        let endTime: string | undefined;

        if (noTimeCheckbox.checked) {
            // 不设置具体时间：直接使用date值
            date = dateInput.value;
            endDate = endDateInput.value;
            time = undefined;
            endTime = undefined;
        } else {
            // 设置具体时间：从datetime-local值中解析
            if (dateInput.value.includes('T')) {
                const [dateStr, timeStr] = dateInput.value.split('T');
                date = dateStr;
                time = timeStr;
            } else {
                date = dateInput.value;
                time = undefined;
            }

            if (endDateInput.value) {
                if (endDateInput.value.includes('T')) {
                    const [endDateStr, endTimeStr] = endDateInput.value.split('T');
                    endDate = endDateStr;
                    endTime = endTimeStr;
                } else {
                    endDate = endDateInput.value;
                    endTime = undefined;
                }
            }
        }

        if (!title) {
            showMessage(t("pleaseEnterTitle"));
            return;
        }

        // 允许不设置日期

        // 验证结束日期时间不能早于开始日期时间
        if (endDate && date) {
            const startDateTime = time ? `${date}T${time}` : `${date}T00:00:00`;
            const endDateTime = endTime ? `${endDate}T${endTime}` : `${endDate}T00:00:00`;

            if (new Date(endDateTime) < new Date(startDateTime)) {
                showMessage(t("endDateCannotBeEarlier"));
                return;
            }
        }

        // 如果启用了重复设置，则必须提供起始日期（重复任务需要基准日期）
        if (this.repeatConfig && this.repeatConfig.enabled && !date) {
            showMessage(t('pleaseSetStartDateForRepeat') || '请为重复任务设置起始日期');
            return;
        }

        // 批量编辑模式：不保存，只传递数据给回调
        if (this.mode === 'batch_edit') {
            const reminderData = {
                title: title,
                blockId: inputId || this.defaultBlockId || null,
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
                termType: termType,
                tagIds: tagIds.length > 0 ? tagIds : undefined,
                reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined,
                customReminderPreset: customReminderPreset,
                repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                quadrant: this.defaultQuadrant
            };

            if (this.onSaved) {
                this.onSaved(reminderData);
            }

            this.dialog.destroy();
            return;
        }

        try {
            const reminderData = await readReminderData();

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
                        // 提醒时间相关字段
                        reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined,
                        customReminderPreset: customReminderPreset
                    };

                    // 调用实例修改保存方法
                    await this.saveInstanceModification({
                        originalId: this.reminder.originalId,
                        instanceDate: this.reminder.instanceDate,
                        ...instanceModification
                    });

                    showMessage("实例编辑成功");

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                    // 触发项目更新事件（包含块属性变更）
                    window.dispatchEvent(new CustomEvent('projectUpdated'));

                    // 调用保存回调（传递原始提醒数据）
                    if (this.onSaved) {
                        this.onSaved(this.reminder);
                    }

                    this.dialog.destroy();
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
                    reminder.tagIds = tagIds.length > 0 ? tagIds : undefined;
                    // 不再使用旧的 `customReminderTime` 存储；所有自定义提醒统一保存到 `reminderTimes`
                    reminder.customReminderPreset = customReminderPreset;
                    reminder.reminderTimes = this.customTimes.length > 0 ? [...this.customTimes] : undefined;
                    reminder.repeat = this.repeatConfig.enabled ? this.repeatConfig : undefined;

                    // 根据任务类型设置看板状态
                    if (termType === 'doing') {
                        reminder.kanbanStatus = 'doing';
                    } else if (termType === 'long_term') {
                        reminder.kanbanStatus = 'todo';
                        reminder.termType = 'long_term';
                    } else if (termType === 'short_term') {
                        reminder.kanbanStatus = 'todo';
                        reminder.termType = 'short_term';
                    } else if (termType === 'todo') {
                        reminder.kanbanStatus = 'todo';
                        reminder.termType = 'short_term'; // 默认todo为短期待办
                    }

                    reminder.termType = termType;
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
                    await writeReminderData(reminderData);

                    // 处理块绑定变更
                    const oldBlockId = this.reminder.blockId;
                    const newBlockId = reminder.blockId;

                    // 如果原来有绑定块，但编辑后删除了绑定，需要更新原块的书签状态
                    if (oldBlockId && !newBlockId) {
                        try {
                            await updateBlockReminderBookmark(oldBlockId);
                            console.debug('QuickReminderDialog: 已移除原块的书签绑定', oldBlockId);
                        } catch (error) {
                            console.warn('更新原块书签状态失败:', error);
                        }
                    }

                    // 如果原来绑定了块A，现在改绑块B，需要同时更新两个块
                    if (oldBlockId && newBlockId && oldBlockId !== newBlockId) {
                        try {
                            await updateBlockReminderBookmark(oldBlockId);
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
                            await updateBlockReminderBookmark(newBlockId);
                        } catch (error) {
                            console.warn('设置块自定义属性 custom-task-projectId 失败:', error);
                        }
                    }

                    // 显示保存成功消息
                    let successMessage = t("reminderUpdated");
                    if (date) {
                        // 只有在有日期时才显示日期信息
                        if (endDate && endDate !== date) {
                            // 跨天事件
                            const startTimeStr = time ? ` ${time}` : '';
                            const endTimeStr = endTime ? ` ${endTime}` : '';
                            successMessage += `：${date}${startTimeStr} → ${endDate}${endTimeStr}`;
                        } else if (endTime && time) {
                            // 同一天的时间段事件
                            successMessage += `：${date} ${time} - ${endTime}`;
                        } else {
                            // 普通事件
                            successMessage += `：${date}${time ? ` ${time}` : ''}`;
                        }
                    }

                    if (this.repeatConfig.enabled) {
                        successMessage += `，${getRepeatDescription(this.repeatConfig)}`;
                    }

                    // 添加分类信息到成功消息
                    if (categoryId) {
                        const category = this.categoryManager.getCategoryById(categoryId);
                        if (category) {
                            successMessage += `，${t("category")}: ${category.name}`;
                        }
                    }

                    // 添加项目信息到成功消息
                    if (projectId) {
                        const project = this.projectManager.getProjectById(projectId);
                        if (project) {
                            successMessage += `，${t("project")}: ${project.name}`;
                        }
                    }

                    showMessage(successMessage);
                }
            } else {
                // 创建模式：创建新提醒
                reminderId = `quick_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
                    tagIds: tagIds.length > 0 ? tagIds : undefined,
                    createdAt: new Date().toISOString(),
                    repeat: this.repeatConfig.enabled ? this.repeatConfig : undefined,
                    isQuickReminder: true, // 标记为快速创建的提醒
                    quadrant: this.defaultQuadrant, // 添加象限信息
                    termType: termType, // 添加任务类型（短期/长期）
                    // 旧字段 `customReminderTime` 不再写入，新提醒统一保存到 `reminderTimes`
                    reminderTimes: this.customTimes.length > 0 ? [...this.customTimes] : undefined
                };

                // 保存 preset 信息
                if (customReminderPreset) {
                    reminder.customReminderPreset = customReminderPreset;
                }

                // 添加默认排序值
                if (typeof this.defaultSort === 'number') {
                    reminder.sort = this.defaultSort;
                }

                // 根据任务类型设置看板状态
                if (termType === 'doing') {
                    reminder.kanbanStatus = 'doing';
                } else if (termType === 'long_term') {
                    reminder.kanbanStatus = 'todo';
                    reminder.termType = 'long_term';
                } else if (termType === 'short_term') {
                    reminder.kanbanStatus = 'todo';
                    reminder.termType = 'short_term';
                } else if (termType === 'todo') {
                    reminder.kanbanStatus = 'todo';
                    reminder.termType = 'short_term'; // 默认todo为短期待办
                }

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
                        console.log(`自动完成了 ${pastInstances.length} 个过去的周期实例（共生成 ${instances.length} 个实例）`);
                    }
                }
            }

            reminderData[reminderId] = reminder;
            await writeReminderData(reminderData);

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
                    await updateBlockReminderBookmark(reminder.blockId);
                } catch (error) {
                    console.warn('设置块自定义属性 custom-task-projectId 失败:', error);
                }
            }


            // 如果是新建任务且有日期，且日期为今天或过去，但用户没有显式设置为进行中，提示自动显示为进行中
            try {
                const today = getLogicalDateString();
                if (!this.mode || this.mode !== 'edit') {
                    if (reminder.date && typeof compareDateStrings === 'function') {
                        const cmp = compareDateStrings(reminder.date, today);
                        if (cmp <= 0 && reminder.kanbanStatus !== 'doing') {
                            showMessage('注意：任务日期为今天或过去，系统会将其自动显示在“进行中”列。若需移出，请修改任务的日期/时间。', 5000);
                        }
                    }
                }
            } catch (err) {
                // ignore
            }

            // 触发更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
            // 触发项目更新事件（包含块属性变更）
            window.dispatchEvent(new CustomEvent('projectUpdated'));

            // 调用保存回调
            if (this.onSaved) {
                this.onSaved(reminder);
            }

            this.dialog.destroy();
        } catch (error) {
            console.error('保存快速提醒失败:', error);
            showMessage(this.mode === 'edit' ? t("updateReminderFailed") : t("saveReminderFailed"));
        }
    }

    /**
     * 保存重复事件实例的修改
     */
    private async saveInstanceModification(instanceData: any) {
        try {
            const { readReminderData, writeReminderData } = await import("../api");
            const originalId = instanceData.originalId;
            const instanceDate = instanceData.instanceDate;

            const reminderData = await readReminderData();

            if (!reminderData[originalId]) {
                throw new Error('原始事件不存在');
            }

            // 初始化实例修改列表
            if (!reminderData[originalId].repeat.instanceModifications) {
                reminderData[originalId].repeat.instanceModifications = {};
            }

            const modifications = reminderData[originalId].repeat.instanceModifications;

            // 如果修改了日期，需要清理可能存在的中间修改记录
            // 例如：原始日期 12-01 改为 12-03，再改为 12-06
            // 应该只保留 12-01 的修改记录，删除 12-03 的记录
            if (instanceData.date !== instanceDate) {
                // 查找所有可能的中间修改记录
                const keysToDelete: string[] = [];
                for (const key in modifications) {
                    // 如果某个修改记录的日期指向当前实例的新日期，且该键不是原始实例日期
                    // 说明这是之前修改产生的中间记录，需要删除
                    if (key !== instanceDate && modifications[key]?.date === instanceData.date) {
                        keysToDelete.push(key);
                    }
                }
                // 删除中间修改记录
                keysToDelete.forEach(key => delete modifications[key]);
            }

            // 保存此实例的修改数据（始终使用原始实例日期作为键）
            modifications[instanceDate] = {
                title: instanceData.title,
                date: instanceData.date,
                endDate: instanceData.endDate,
                time: instanceData.time,
                endTime: instanceData.endTime,
                note: instanceData.note,
                priority: instanceData.priority,
                notified: instanceData.notified,
                // 提醒时间相关字段
                reminderTimes: instanceData.reminderTimes,
                customReminderPreset: instanceData.customReminderPreset,
                modifiedAt: new Date().toISOString().split('T')[0]
            };

            await writeReminderData(reminderData);

        } catch (error) {
            console.error('保存实例修改失败:', error);
            throw error;
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
            const reminderData = await readReminderData();
            const parentTask = reminderData[parentId];

            if (parentTask) {
                // 显示父任务标题
                parentTaskDisplay.value = parentTask.title || '(无标题)';
                parentTaskDisplay.title = `父任务: ${parentTask.title || '(无标题)'}`;

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
     * 查看父任务
     */
    private async viewParentTask() {
        const parentId = this.reminder?.parentId || this.defaultParentId;

        if (!parentId) {
            showMessage(t("parentTaskNotExist") || "父任务不存在");
            return;
        }

        try {
            // 读取父任务数据
            const reminderData = await readReminderData();
            const parentTask = reminderData[parentId];

            if (!parentTask) {
                showMessage(t("parentTaskNotExist") || "父任务不存在");
                return;
            }

            // 创建新的QuickReminderDialog来编辑父任务
            const parentDialog = new QuickReminderDialog(
                parentTask.date,
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
            showMessage(t("operationFailed") || "操作失败");
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
