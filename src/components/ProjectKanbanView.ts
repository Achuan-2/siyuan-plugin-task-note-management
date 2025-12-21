import { showMessage, confirm, Menu, Dialog } from "siyuan";

import { refreshSql, readReminderData, writeReminderData, readProjectData, getBlockByID, updateBlockReminderBookmark, openBlock } from "../api";
import { t } from "../utils/i18n";
import { getLocalDateString, getLocalDateTimeString, compareDateStrings, getLogicalDateString, getRelativeDateString } from "../utils/dateUtils";
import { CategoryManager } from "../utils/categoryManager";
import { PomodoroTimer } from "./PomodoroTimer";
import { PomodoroManager } from "../utils/pomodoroManager";
import { CategoryManageDialog } from "./CategoryManageDialog";
import { generateRepeatInstances, getRepeatDescription } from "../utils/repeatUtils";
import { getSolarDateLunarString } from "../utils/lunarUtils";
import { QuickReminderDialog } from "./QuickReminderDialog";

// 层级化任务接口
interface HierarchicalTask {
    title: string;
    priority?: string;
    startDate?: string;
    endDate?: string;
    blockId?: string;
    level: number;
    children: HierarchicalTask[];
}

export class ProjectKanbanView {
    private container: HTMLElement;
    private plugin: any;
    private projectId: string;
    private project: any;
    private categoryManager: CategoryManager;
    private currentSort: string = 'priority';
    private kanbanMode: 'status' | 'custom' = 'status';
    private currentSortOrder: 'asc' | 'desc' = 'desc';
    private doneSort: string = 'completedTime';
    private doneSortOrder: 'asc' | 'desc' = 'desc';
    private showDone: boolean = true; // 改为默认显示已完成任务
    private tasks: any[] = [];
    private isDragging: boolean = false;
    private draggedTask: any = null;
    private draggedElement: HTMLElement | null = null;
    // 当前正在拖拽的分组ID（用于分组管理对话框的拖拽排序）
    private draggedGroupId: string | null = null;
    // 当前显示的分组拖拽指示器（绝对定位在 container 内）
    private _groupDropIndicator: HTMLElement | null = null;
    // 拖拽时用于 setDragImage 的克隆元素（用于预览整个 group-item）
    private _groupDragImageEl: HTMLElement | null = null;
    // 自定义分组列拖拽时的指示器（列间插入指示）
    private _columnDropIndicator: HTMLElement | null = null;
    private sortButton: HTMLButtonElement;
    private doneSortButton: HTMLButtonElement;
    private isLoading: boolean = false;
    private collapsedTasks: Set<string> = new Set();

    // 分页：每页最多显示的顶层任务数量
    private pageSize: number = 30;
    // 存储每列当前页，key 为 status ('long_term'|'short_term'|'doing'|'done')
    private pageIndexMap: { [status: string]: number } = { long_term: 1, short_term: 1, doing: 1, done: 1 };

    // 自定义分组子分组折叠状态跟踪，key 为 "groupId-status" 格式
    private collapsedStatusGroups: Set<string> = new Set();

    // 指示器状态跟踪
    private currentIndicatorType: 'none' | 'sort' | 'parentChild' = 'none';
    private currentIndicatorTarget: HTMLElement | null = null;
    private currentIndicatorPosition: 'top' | 'bottom' | 'middle' | null = null;

    // 全局番茄钟管理器
    private pomodoroManager = PomodoroManager.getInstance();

    // 上一次选择的任务状态（用于记住新建任务时的默认选择）
    private lastSelectedTermType: 'short_term' | 'long_term' | 'doing' | 'todo' = 'short_term';
    // 防抖加载与滚动状态保存
    private _debounceTimer: any = null;
    private _debounceDelay: number = 250; // ms
    private _pendingLoadPromise: Promise<void> | null = null;
    private _pendingLoadResolve: (() => void) | null = null;

    // 用于临时保存滚动状态，避免界面刷新重置滚动条
    private _savedScrollState: {
        containerScrollLeft: number;
        columnScrollTopMap: { [key: string]: number };
    } | null = null;

    constructor(container: HTMLElement, plugin: any, projectId: string) {
        this.container = container;
        this.plugin = plugin;
        this.projectId = projectId;
        this.categoryManager = CategoryManager.getInstance(this.plugin);
        this.initializeAsync();
    }

    private async createGroupDialog(container: HTMLElement) {
        const dialog = new Dialog({
            title: t('newGroup'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('groupName')}</label>
                        <input type="text" id="newGroupName" class="b3-text-field" placeholder="${t('pleaseEnterGroupName')}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('bindBlockId')} (${t('optional')})</label>
                        <input type="text" id="newGroupBlockId" class="b3-text-field" placeholder="${t('pleaseEnterBlockId')}" style="width: 100%;">
                        <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${t('bindBlockIdHint')}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('groupColor')}</label>
                        <input type="color" id="newGroupColor" class="b3-text-field" value="#3498db" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('iconOptional')}</label>
                        <input type="text" id="newGroupIcon" class="b3-text-field" placeholder="${t('emojiIconExample')}" style="width: 100%;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="newGroupCancel">${t('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="newGroupSave">${t('createGroup')}</button>
                </div>
            `,
            width: '420px'
        });

        const nameInput = dialog.element.querySelector('#newGroupName') as HTMLInputElement;
        const colorInput = dialog.element.querySelector('#newGroupColor') as HTMLInputElement;
        const iconInput = dialog.element.querySelector('#newGroupIcon') as HTMLInputElement;
        const blockIdInput = dialog.element.querySelector('#newGroupBlockId') as HTMLInputElement;
        const cancelBtn = dialog.element.querySelector('#newGroupCancel') as HTMLButtonElement;
        const saveBtn = dialog.element.querySelector('#newGroupSave') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        saveBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            const color = colorInput.value;
            const icon = iconInput.value.trim();
            const blockId = blockIdInput.value.trim();

            if (!name) {
                showMessage(t('pleaseEnterGroupName') || '请输入分组名称');
                return;
            }

            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                const newGroup = {
                    id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    name,
                    color,
                    icon,
                    blockId: blockId || undefined,
                    sort: maxSort + 10
                }; currentGroups.push(newGroup);
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                await this.loadAndDisplayGroups(container);
                this.queueLoadTasks();

                showMessage(t('groupCreated'));
                dialog.destroy();
            } catch (error) {
                console.error('创建分组失败:', error);
                showMessage(t('createGroupFailed') || '创建分组失败');
            }
        });
    }

    private async initializeAsync() {
        await this.categoryManager.initialize();
        await this.loadProject();
        await this.loadKanbanMode();
        this.initUI();
        await this.loadTasks();

        // 监听提醒更新事件（使用防抖加载以避免频繁重绘导致滚动重置）
        window.addEventListener('reminderUpdated', () => this.queueLoadTasks());
    }

    private async loadProject() {
        try {
            const projectData = await readProjectData();
            this.project = projectData[this.projectId];
            if (!this.project) {
                throw new Error('项目不存在');
            }
        } catch (error) {
            console.error('加载项目失败:', error);
            showMessage("加载项目失败");
        }
    }

    private async loadKanbanMode() {
        try {
            // 使用项目管理器的方法来获取看板模式
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            this.kanbanMode = await projectManager.getProjectKanbanMode(this.projectId);
        } catch (error) {
            console.error('加载看板模式失败:', error);
            this.kanbanMode = 'status';
        }
    }

    private async toggleKanbanMode() {
        try {
            const newMode = this.kanbanMode === 'status' ? 'custom' : 'status';
            this.kanbanMode = newMode;

            // 使用项目管理器保存看板模式
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            await projectManager.setProjectKanbanMode(this.projectId, newMode);

            // 更新下拉选择框选中状态
            this.updateModeSelect();

            // 触发自定义事件来更新管理按钮显示状态
            this.container.dispatchEvent(new CustomEvent('kanbanModeChanged'));

            // 使用防抖加载并保存/恢复滚动位置
            this.captureScrollState();
            await this.queueLoadTasks();

            showMessage(`已切换到${newMode === 'status' ? '任务状态' : '自定义分组'}看板`);
        } catch (error) {
            console.error('切换看板模式失败:', error);
            showMessage('切换看板模式失败');
        }
    }

    private updateModeSelect() {
        const modeSelect = this.container.querySelector('.kanban-mode-select') as HTMLSelectElement;
        if (modeSelect) {
            // 更新选中状态
            const statusOption = modeSelect.querySelector('option[value="status"]') as HTMLOptionElement;
            const customOption = modeSelect.querySelector('option[value="custom"]') as HTMLOptionElement;

            if (statusOption && customOption) {
                statusOption.selected = this.kanbanMode === 'status';
                customOption.selected = this.kanbanMode === 'custom';
            }
        }
    }

    private async showManageGroupsDialog() {
        const dialog = new Dialog({
            title: t('manageCustomGroups'),
            content: `
                <div class="manage-groups-dialog">
                    <div class="b3-dialog__content">
                        <div class="groups-list" style="margin-bottom: 16px;">
                            <div class="groups-header" style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="margin: 0;">${t('existingGroups')}</h4>
                                <button id="addGroupBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${t('newGroup')}
                                </button>
                            </div>
                            <div id="groupsContainer" class="groups-container" style="max-height: 300px; overflow-y: auto;">
                                <!-- 分组列表将在这里动态生成 -->
                            </div>
                        </div>

                        <div id="groupForm" class="group-form" style="display: none; padding: 16px; background: var(--b3-theme-surface-lighter); border-radius: 8px; border: 1px solid var(--b3-theme-border);">
                            <h4 id="formTitle" style="margin-top: 0;">${t('newGroup')}</h4>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${t('groupName')}</label>
                                <input type="text" id="groupNameInput" class="b3-text-field" placeholder="${t('pleaseEnterGroupName')}" style="width: 100%;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${t('groupColor')}</label>
                                <div class="color-picker" style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                    <!-- 预设颜色选项 -->
                                </div>
                                <input type="color" id="groupColorInput" class="b3-text-field" value="#3498db" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">${t('iconOptional')}</label>
                                <input type="text" id="groupIconInput" class="b3-text-field" placeholder="${t('emojiIconExample')}" style="width: 100%;">
                            </div>
                            <div class="form-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
                                <button id="cancelFormBtn" class="b3-button b3-button--outline">${t('cancel')}</button>
                                <button id="saveGroupBtn" class="b3-button b3-button--primary">${t('save')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `,
            width: "500px",
            height: "auto"
        });

        // 获取DOM元素
        const groupsContainer = dialog.element.querySelector('#groupsContainer') as HTMLElement;
        const addGroupBtn = dialog.element.querySelector('#addGroupBtn') as HTMLButtonElement;
        const groupForm = dialog.element.querySelector('#groupForm') as HTMLElement;
        const formTitle = dialog.element.querySelector('#formTitle') as HTMLElement;
        const groupNameInput = dialog.element.querySelector('#groupNameInput') as HTMLInputElement;
        const groupColorInput = dialog.element.querySelector('#groupColorInput') as HTMLInputElement;
        const groupIconInput = dialog.element.querySelector('#groupIconInput') as HTMLInputElement;
        const cancelFormBtn = dialog.element.querySelector('#cancelFormBtn') as HTMLButtonElement;
        const saveGroupBtn = dialog.element.querySelector('#saveGroupBtn') as HTMLButtonElement;
        const colorPicker = dialog.element.querySelector('.color-picker') as HTMLElement;

        let editingGroupId: string | null = null;

        // 预设颜色选项
        const presetColors = [
            '#3498db', '#e74c3c', '#2ecc71', '#f39c12',
            '#9b59b6', '#1abc9c', '#e67e22', '#34495e',
            '#16a085', '#27ae60', '#2980b9', '#8e44ad'
        ];

        presetColors.forEach(color => {
            const colorOption = document.createElement('div');
            colorOption.className = 'color-option';
            colorOption.style.cssText = `
                width: 30px;
                height: 30px;
                border-radius: 50%;
                background-color: ${color};
                cursor: pointer;
                border: 2px solid transparent;
                transition: border-color 0.2s ease;
            `;
            colorOption.addEventListener('click', () => {
                colorPicker.querySelectorAll('.color-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                colorOption.classList.add('selected');
                groupColorInput.value = color;
            });
            colorPicker.appendChild(colorOption);
        });

        // 加载并显示现有分组
        await this.loadAndDisplayGroups(groupsContainer);

        // 新建分组按钮：改为弹出独立的创建分组对话框（而不是页面内联表单）
        addGroupBtn.addEventListener('click', async () => {
            try {
                await this.createGroupDialog(groupsContainer);
            } catch (err) {
                console.error('打开创建分组对话框失败:', err);
                showMessage(t('openCreateGroupFailed') || '打开创建分组对话框失败');
            }
        });

        // 取消表单
        cancelFormBtn.addEventListener('click', () => {
            groupForm.style.display = 'none';
        });

        // 保存分组
        saveGroupBtn.addEventListener('click', async () => {
            const name = groupNameInput.value.trim();
            const color = groupColorInput.value;
            const icon = groupIconInput.value.trim();

            if (!name) {
                showMessage('请输入分组名称');
                return;
            }

            try {
                // 获取当前项目的分组列表
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                let newGroup;
                if (editingGroupId) {
                    // 编辑现有分组
                    const groupIndex = currentGroups.findIndex((g: any) => g.id === editingGroupId);
                    if (groupIndex !== -1) {
                        currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon };
                        newGroup = currentGroups[groupIndex];
                    }
                    showMessage(t('groupUpdated'));
                } else {
                    // 创建新分组
                    const maxSort = currentGroups.reduce((max: number, g: any) => Math.max(max, g.sort || 0), 0);
                    newGroup = {
                        id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                        name,
                        color,
                        icon,
                        sort: maxSort + 10
                    };
                    currentGroups.push(newGroup);
                    showMessage(t('groupCreated'));
                }

                // 保存到项目数据
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                // 刷新分组列表
                await this.loadAndDisplayGroups(groupsContainer);
                groupForm.style.display = 'none';

                // 刷新看板（使用防抖队列）
                this.queueLoadTasks();
            } catch (error) {
                console.error('保存分组失败:', error);
                showMessage(t('saveGroupFailed'));
            }
        });
    }

    private async showManageTagsDialog() {
        const dialog = new Dialog({
            title: t('manageProjectTags'),
            content: `
                <div class="manage-tags-dialog">
                    <div class="b3-dialog__content">
                        <div class="tags-list" style="margin-bottom: 16px;">
                            <div class="tags-header" style="display: flex; justify-content: space-between; align-items: center;">
                                <h4 style="margin: 0;">${t('existingTags')}</h4>
                                <button id="addTagBtn" class="b3-button b3-button--small b3-button--primary">
                                    <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${t('newTag')}
                                </button>
                            </div>
                            <div id="tagsContainer" class="tags-container" style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px;">
                                <!-- 标签列表将在这里动态生成 -->
                            </div>
                        </div>
                    </div>
                </div>
            `,
            width: "600px",
            height: "auto"
        });

        const tagsContainer = dialog.element.querySelector('#tagsContainer') as HTMLElement;
        const addTagBtn = dialog.element.querySelector('#addTagBtn') as HTMLButtonElement;

        // 加载并显示现有标签
        const loadAndDisplayTags = async () => {
            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const projectTags = await projectManager.getProjectTags(this.projectId);

                tagsContainer.innerHTML = '';

                if (projectTags.length === 0) {
                    tagsContainer.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px; width: 100%;">${t('noTags')}</div>`;
                    return;
                }

                projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                    const tagItem = document.createElement('div');
                    tagItem.className = 'tag-item';
                    tagItem.style.cssText = `
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 6px 12px;
                        background: ${tag.color}20;
                        border: 1px solid ${tag.color};
                        border-radius: 16px;
                        font-size: 14px;
                        color: var(--b3-theme-on-surface);
                        cursor: pointer;
                    `;

                    const tagText = document.createElement('span');
                    tagText.textContent = `#${tag.name}`;
                    tagItem.appendChild(tagText);

                    // 编辑按钮
                    const editBtn = document.createElement('button');
                    editBtn.className = 'b3-button b3-button--text';
                    editBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconEdit"></use></svg>';
                    editBtn.title = t('edit');
                    editBtn.style.cssText = `
                        padding: 2px;
                        min-width: unset;
                        opacity: 0.6;
                    `;
                    editBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        showEditTagDialog(tag);
                    });
                    tagItem.appendChild(editBtn);

                    // 删除按钮
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'b3-button b3-button--text';
                    deleteBtn.innerHTML = '<svg class="b3-button__icon" style="width: 14px; height: 14px;"><use xlink:href="#iconClose"></use></svg>';
                    deleteBtn.title = t('delete');
                    deleteBtn.style.cssText = `
                        padding: 2px;
                        min-width: unset;
                        opacity: 0.6;
                    `;
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await deleteTag(tag.name);
                    });
                    tagItem.appendChild(deleteBtn);

                    tagsContainer.appendChild(tagItem);
                });
            } catch (error) {
                console.error('加载标签列表失败:', error);
                tagsContainer.innerHTML = '<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">加载标签失败</div>';
            }
        };

        // 删除标签
        const deleteTag = async (tagNameToDelete: string) => {
            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const projectTags = await projectManager.getProjectTags(this.projectId);

                const updatedTags = projectTags.filter(tag => tag.name !== tagNameToDelete);
                await projectManager.setProjectTags(this.projectId, updatedTags);

                await loadAndDisplayTags();
                showMessage(t('tagDeleted'));
            } catch (error) {
                console.error('删除标签失败:', error);
                showMessage(t('deleteTagFailed'));
            }
        };

        // 编辑标签对话框
        const showEditTagDialog = (existingTag: { id: string, name: string, color: string }) => {
            showTagEditDialog(existingTag, async (updatedTag) => {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    const index = projectTags.findIndex(t => t.id === existingTag.id);
                    if (index !== -1) {
                        projectTags[index] = updatedTag;
                        await projectManager.setProjectTags(this.projectId, projectTags);
                        await loadAndDisplayTags();
                        showMessage(t('tagUpdated'));
                    }
                } catch (error) {
                    console.error('更新标签失败:', error);
                    showMessage(t('updateTagFailed'));
                }
            });
        };

        // 新建/编辑标签对话框
        const showTagEditDialog = (existingTag: { id: string, name: string, color: string } | null, onSave: (tag: { id: string, name: string, color: string }) => void) => {
            const isEdit = existingTag !== null;
            const defaultColor = existingTag?.color || '#3498db';
            const defaultName = existingTag?.name || '';

            const tagDialog = new Dialog({
                title: isEdit ? t('editTag') : t('newTag'),
                content: `
                    <div class="b3-dialog__content">
                        <div class="b3-form__group">
                            <label class="b3-form__label">${t('tagName')}</label>
                            <input type="text" id="tagNameInput" class="b3-text-field" placeholder="${t('pleaseEnterTagName')}" value="${defaultName}" style="width: 100%;">
                        </div>
                        <div class="b3-form__group" style="margin-top: 12px;">
                            <label class="b3-form__label">${t('tagColor')}</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="color" id="tagColorInput" value="${defaultColor}" style="width: 60px; height: 32px; border: 1px solid var(--b3-border-color); border-radius: 4px; cursor: pointer;">
                                <input type="text" id="tagColorText" class="b3-text-field" value="${defaultColor}" style="flex: 1;" readonly>
                                <div id="tagColorPreview" style="width: 80px; height: 32px; border-radius: 16px; border: 1px solid ${defaultColor}; background: ${defaultColor}20; display: flex; align-items: center; justify-content: center; font-size: 12px;">预览</div>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="tagDialogCancel">${t('cancel')}</button>
                        <button class="b3-button b3-button--primary" id="tagDialogSave">${t('save')}</button>
                    </div>
                `,
                width: '400px'
            });

            const nameInput = tagDialog.element.querySelector('#tagNameInput') as HTMLInputElement;
            const colorInput = tagDialog.element.querySelector('#tagColorInput') as HTMLInputElement;
            const colorText = tagDialog.element.querySelector('#tagColorText') as HTMLInputElement;
            const colorPreview = tagDialog.element.querySelector('#tagColorPreview') as HTMLElement;
            const cancelBtn = tagDialog.element.querySelector('#tagDialogCancel') as HTMLButtonElement;
            const saveBtn = tagDialog.element.querySelector('#tagDialogSave') as HTMLButtonElement;

            // 颜色选择器变化
            colorInput.addEventListener('input', () => {
                const color = colorInput.value;
                colorText.value = color;
                colorPreview.style.borderColor = color;
                colorPreview.style.background = `${color}20`;
            });

            cancelBtn.addEventListener('click', () => tagDialog.destroy());

            saveBtn.addEventListener('click', async () => {
                const tagName = nameInput.value.trim();
                const tagColor = colorInput.value;

                if (!tagName) {
                    showMessage(t('pleaseEnterTagName'));
                    return;
                }

                // 检查标签名是否已存在（编辑时排除自己）
                if (!isEdit || tagName !== existingTag.name) {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    if (projectTags.some(t => t.name === tagName)) {
                        showMessage(t('tagAlreadyExists'));
                        return;
                    }
                }

                // 生成ID（编辑时保留原ID，新建时生成新ID）
                const tagId = isEdit ? existingTag.id : `tag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                onSave({ id: tagId, name: tagName, color: tagColor });
                tagDialog.destroy();
            });
        };

        // 新建标签
        addTagBtn.addEventListener('click', () => {
            showTagEditDialog(null, async (newTag) => {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    projectTags.push(newTag);
                    await projectManager.setProjectTags(this.projectId, projectTags);

                    await loadAndDisplayTags();
                    showMessage(t('tagCreated'));
                } catch (error) {
                    console.error('创建标签失败:', error);
                    showMessage(t('createTagFailed'));
                }
            });
        });

        // 初始加载标签
        await loadAndDisplayTags();
    }

    private async loadAndDisplayGroups(container: HTMLElement) {
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

            container.innerHTML = '';

            if (projectGroups.length === 0) {
                container.innerHTML = `<div style="text-align: center; color: var(--b3-theme-on-surface); opacity: 0.6; padding: 20px;">${t('noCustomGroups')}</div>`;
                return;
            }

            // 按sort字段排序分组
            const sortedGroups = projectGroups.sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // 添加拖拽排序样式
            container.style.cssText += `
                position: relative;
            `;

            sortedGroups.forEach((group: any) => {
                const groupItem = document.createElement('div');
                groupItem.className = 'group-item';
                // 标记 DOM 节点以便拖拽时可以识别并忽略自身
                groupItem.dataset.groupId = group.id;
                groupItem.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 12px 16px;
                    margin-bottom: 8px;
                    background: var(--b3-theme-surface-lighter);
                    border: 1px solid var(--b3-theme-border);
                    border-radius: 8px;
                    transition: background-color 0.2s ease;
                    cursor: move;
                    min-height: 48px;
                `;

                const groupInfo = document.createElement('div');
                groupInfo.style.cssText = `
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex: 1;
                    min-width: 0;
                `;

                // 拖拽手柄
                const dragHandle = document.createElement('span');
                dragHandle.className = 'group-drag-handle';
                dragHandle.innerHTML = '⋮⋮';
                dragHandle.style.cssText = `
                    font-size: 14px;
                    color: var(--b3-theme-on-surface);
                    opacity: 0.6;
                    cursor: move;
                    padding: 4px 6px;
                    margin-right: 8px;
                    border-radius: 4px;
                    transition: all 0.2s ease;
                    user-select: none;
                `;
                dragHandle.title = '拖拽排序';

                // 添加悬停效果
                dragHandle.draggable = true;
                dragHandle.addEventListener('mouseenter', () => {
                    dragHandle.style.backgroundColor = 'var(--b3-theme-surface)';
                    dragHandle.style.opacity = '0.8';
                });

                dragHandle.addEventListener('mouseleave', () => {
                    dragHandle.style.backgroundColor = 'transparent';
                    dragHandle.style.opacity = '0.6';
                });

                // 在手柄上也绑定 dragstart/dragend，保证拖拽手柄触发拖拽行为
                dragHandle.addEventListener('dragstart', (e) => {
                    // 设置全局 draggedGroupId 并修改父项样式以反映拖拽
                    this.draggedGroupId = group.id;
                    groupItem.style.opacity = '0.5';
                    groupItem.style.cursor = 'grabbing';
                    if (e.dataTransfer) {
                        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id); } catch (err) { }
                    }
                });

                dragHandle.addEventListener('dragend', () => {
                    this.draggedGroupId = null;
                    groupItem.style.opacity = '';
                    groupItem.style.cursor = 'move';
                    container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());
                });

                const groupIcon = document.createElement('span');
                groupIcon.textContent = group.icon || '📋';
                groupIcon.style.cssText = `
                    font-size: 18px;
                    flex-shrink: 0;
                `;

                const groupName = document.createElement('span');
                groupName.textContent = group.name;
                groupName.style.cssText = `
                    font-weight: 500;
                    color: var(--b3-theme-on-surface);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                `;
                groupName.title = group.name;

                const groupColor = document.createElement('div');
                groupColor.style.cssText = `
                    width: 12px;
                    height: 12px;
                    border-radius: 50%;
                    background-color: ${group.color};
                    border: 2px solid var(--b3-theme-surface);
                    box-shadow: 0 0 0 1px var(--b3-theme-border);
                    flex-shrink: 0;
                `;

                groupInfo.appendChild(dragHandle);
                groupInfo.appendChild(groupIcon);
                groupInfo.appendChild(groupColor);
                groupInfo.appendChild(groupName);

                const groupActions = document.createElement('div');
                groupActions.style.cssText = `
                    display: flex;
                    gap: 8px;
                    align-items: center;
                `;

                const editBtn = document.createElement('button');
                editBtn.className = 'b3-button b3-button--small b3-button--outline';
                editBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconEdit"></use></svg>';
                editBtn.title = t('editGroup');
                editBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                editBtn.addEventListener('click', () => {
                    this.editGroup(group, groupItem, container);
                });

                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'b3-button b3-button--outline';
                deleteBtn.innerHTML = '<svg class="b3-button__icon" style="color: var(--b3-theme-error);"><use xlink:href="#iconTrashcan"></use></svg>';
                deleteBtn.title = t('deleteGroup');
                deleteBtn.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    padding: 4px 8px;
                    font-size: 12px;
                `;
                deleteBtn.addEventListener('click', () => {
                    this.deleteGroup(group.id, groupItem, container);
                });

                groupActions.appendChild(editBtn);
                groupActions.appendChild(deleteBtn);

                groupItem.appendChild(groupInfo);
                groupItem.appendChild(groupActions);

                container.appendChild(groupItem);

                // 添加悬停效果
                groupItem.addEventListener('mouseenter', () => {
                    groupItem.style.backgroundColor = 'var(--b3-theme-surface)';
                    groupItem.style.borderColor = 'var(--b3-theme-primary)';
                });

                groupItem.addEventListener('mouseleave', () => {
                    groupItem.style.backgroundColor = 'var(--b3-theme-surface-lighter)';
                    groupItem.style.borderColor = 'var(--b3-theme-border)';
                });

                // 添加拖拽排序功能
                this.addGroupDragAndDrop(groupItem, group, container);
            });

            // 容器级别的拖放支持：允许将分组拖到列表任意位置（包括末尾）
            // 只注册一次，避免重复绑定事件
            if (!container.dataset.hasDropHandlers) {
                container.dataset.hasDropHandlers = '1';

                container.addEventListener('dragover', (e) => {
                    try {
                        // 支持从 dataTransfer 或类字段回退获取被拖拽的分组 id
                        const dt = (e as DragEvent).dataTransfer;
                        if (!dt && !this.draggedGroupId) return;
                        let draggedId = '';
                        try {
                            if (dt) draggedId = dt.getData('text/plain') || '';
                        } catch (err) {
                            // dataTransfer 在某些环境可能受限，忽略错误并使用回退值
                            draggedId = '';
                        }
                        if (!draggedId) draggedId = this.draggedGroupId || '';
                        if (!draggedId) return;

                        e.preventDefault();
                        dt.dropEffect = 'move';

                        // 清除旧的临时指示器（但保留对 _groupDropIndicator 的管理，下面会重建）
                        container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());

                        // 获取子项并忽略当前被拖拽的项，防止自己影响插入位置计算
                        let children = Array.from(container.querySelectorAll('.group-item')) as HTMLElement[];
                        children = children.filter(c => (c.dataset.groupId || '') !== draggedId);

                        // 创建静态位置指示器并插入到合适位置
                        const createIndicator = (beforeEl: HTMLElement | null) => {
                            // 移除已有引用的指示器
                            if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                                this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                                this._groupDropIndicator = null;
                            }

                            const indicator = document.createElement('div');
                            indicator.className = 'group-drop-indicator';
                            indicator.style.cssText = `
                                height: 2px;
                                background-color: var(--b3-theme-primary);
                                margin: 4px 0;
                                border-radius: 2px;
                                box-shadow: 0 0 4px var(--b3-theme-primary);
                            `;
                            if (beforeEl) container.insertBefore(indicator, beforeEl);
                            else container.appendChild(indicator);

                            // 保存引用，方便 dragleave/drop 等处清理或重用
                            this._groupDropIndicator = indicator;
                        };

                        if (children.length === 0) {
                            createIndicator(null);
                            return;
                        }

                        // 根据 mouse Y 判断插入点（忽略被拖拽项）
                        const clientY = (e as DragEvent).clientY;
                        let inserted = false;
                        for (const child of children) {
                            const rect = child.getBoundingClientRect();
                            const midpoint = rect.top + rect.height / 2;
                            if (clientY < midpoint) {
                                createIndicator(child);
                                inserted = true;
                                break;
                            }
                        }

                        if (!inserted) {
                            // 放到末尾
                            createIndicator(null);
                        }
                    } catch (err) {
                        // ignore
                    }
                });

                container.addEventListener('dragleave', (e) => {
                    // 当真正离开容器时清除指示器
                    const related = (e as any).relatedTarget as Node;
                    if (!related || !container.contains(related)) {
                        container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());
                        if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                            this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                        }
                        this._groupDropIndicator = null;
                    }
                });

                container.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    container.querySelectorAll('.group-drop-indicator').forEach(el => el.remove());

                    let draggedGroupId = (e as DragEvent).dataTransfer?.getData('text/plain');
                    // 某些环境（如受限的 webview/iframe）可能无法通过 dataTransfer 传递数据，使用类字段作为回退
                    if (!draggedGroupId) draggedGroupId = this.draggedGroupId || '';
                    if (!draggedGroupId) return;

                    try {
                        const { ProjectManager } = await import('../utils/projectManager');
                        const projectManager = ProjectManager.getInstance(this.plugin);
                        const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                        const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedGroupId);
                        if (draggedIndex === -1) return;

                        // 计算插入索引（基于鼠标位置与当前子项中点比较）
                        const children = Array.from(container.querySelectorAll('.group-item')) as HTMLElement[];
                        const clientY = (e as DragEvent).clientY;
                        let insertIndex = children.length; // 默认末尾
                        for (let i = 0; i < children.length; i++) {
                            const rect = children[i].getBoundingClientRect();
                            const midpoint = rect.top + rect.height / 2;
                            if (clientY < midpoint) { insertIndex = i; break; }
                        }

                        // 从原数组移除并插入到目标位置
                        const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                        const actualIndex = insertIndex;
                        currentGroups.splice(actualIndex, 0, draggedGroup);

                        // 重新分配排序值并保存
                        currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                        await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                        // 刷新界面（使用防抖队列以合并频繁变更）
                        await this.loadAndDisplayGroups(container);
                        this.queueLoadTasks();
                        showMessage('分组顺序已更新');
                    } catch (error) {
                        console.error('更新分组顺序失败:', error);
                        showMessage('更新分组顺序失败');
                    }
                });
            }
        } catch (error) {
            console.error('加载分组列表失败:', error);
            container.innerHTML = '<div style="text-align: center; color: var(--b3-theme-error); padding: 20px;">加载分组失败</div>';
        }
    }

    private async editGroup(group: any, _groupItem: HTMLElement, container: HTMLElement) {
        const dialog = new Dialog({
            title: t('editGroup'),
            content: `
                <div class="b3-dialog__content">
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('groupName')}</label>
                        <input type="text" id="editGroupName" class="b3-text-field" value="${group.name}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('bindBlockId')} (${t('optional')})</label>
                        <input type="text" id="editGroupBlockId" class="b3-text-field" value="${group.blockId || ''}" placeholder="${t('pleaseEnterBlockId')}" style="width: 100%;">
                        <div class="b3-label__text" style="margin-top: 4px; color: var(--b3-theme-on-surface-light);">${t('bindBlockIdHint')}</div>
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('groupColor')}</label>
                        <input type="color" id="editGroupColor" class="b3-text-field" value="${group.color}" style="width: 100%;">
                    </div>
                    <div class="b3-form__group">
                        <label class="b3-form__label">${t('iconOptional')}</label>
                        <input type="text" id="editGroupIcon" class="b3-text-field" value="${group.icon || ''}" placeholder="${t('emojiIconExample')}" style="width: 100%;">
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="editCancelBtn">${t('cancel')}</button>
                    <button class="b3-button b3-button--primary" id="editSaveBtn">${t('save')}</button>
                </div>
            `,
            width: "400px"
        });

        const editGroupName = dialog.element.querySelector('#editGroupName') as HTMLInputElement;
        const editGroupBlockId = dialog.element.querySelector('#editGroupBlockId') as HTMLInputElement;
        const editGroupColor = dialog.element.querySelector('#editGroupColor') as HTMLInputElement;
        const editGroupIcon = dialog.element.querySelector('#editGroupIcon') as HTMLInputElement;
        const editCancelBtn = dialog.element.querySelector('#editCancelBtn') as HTMLButtonElement;
        const editSaveBtn = dialog.element.querySelector('#editSaveBtn') as HTMLButtonElement;

        editCancelBtn.addEventListener('click', () => dialog.destroy());

        editSaveBtn.addEventListener('click', async () => {
            const name = editGroupName.value.trim();
            const blockId = editGroupBlockId.value.trim();
            const color = editGroupColor.value;
            const icon = editGroupIcon.value.trim();

            if (!name) {
                showMessage('请输入分组名称');
                return;
            }

            try {
                // 获取当前项目的分组列表
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                // 更新分组信息
                const groupIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                if (groupIndex !== -1) {
                    currentGroups[groupIndex] = { ...currentGroups[groupIndex], name, color, icon, blockId: blockId || undefined };
                    await projectManager.setProjectCustomGroups(this.projectId, currentGroups);
                }

                // 刷新分组列表
                await this.loadAndDisplayGroups(container);

                // 刷新看板（使用防抖队列）
                this.queueLoadTasks();

                showMessage(t('groupUpdated'));
                dialog.destroy();
            } catch (error) {
                console.error('更新分组失败:', error);
                showMessage(t('updateGroupFailed'));
            }
        });
    }

    private async deleteGroup(groupId: string, _groupItem: HTMLElement, container: HTMLElement) {
        // 获取分组信息用于显示名称
        const { ProjectManager } = await import('../utils/projectManager');
        const projectManager = ProjectManager.getInstance(this.plugin);
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
        const groupToDelete = projectGroups.find((g: any) => g.id === groupId);

        if (!groupToDelete) {
            showMessage(t('groupNotExist'));
            return;
        }

        // 检查该分组下是否有任务
        const reminderData = await readReminderData();
        const tasksInGroup = Object.values(reminderData).filter((task: any) =>
            task && task.projectId === this.projectId && task.customGroupId === groupId
        );

        const hasTasks = tasksInGroup.length > 0;

        let confirmMessage = t('confirmDeleteGroup', { name: groupToDelete.name });

        if (hasTasks) {
            confirmMessage += `\n\n${t('groupHasTasks', { count: String(tasksInGroup.length) })}`;
        }

        const dialog = new Dialog({
            title: t('deleteGroup'),
            content: `
                <div class="delete-group-dialog">
                    <div class="b3-dialog__content">
                        <p>${confirmMessage}</p>
                        ${hasTasks ? `
                            <div class="b3-form__group">
                                <label class="b3-form__label">${t('taskAction')}</label>
                                <div class="b3-radio">
                                    <label class="b3-radio">
                                        <input type="radio" name="taskAction" value="ungroup" checked>
                                        <span class="b3-radio__mark"></span>
                                        <span class="b3-radio__text">${t('setTasksUngrouped')}</span>
                                    </label>
                                    <label class="b3-radio">
                                        <input type="radio" name="taskAction" value="delete">
                                        <span class="b3-radio__mark"></span>
                                        <span class="b3-radio__text">${t('deleteAllTasks')}</span>
                                    </label>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="deleteCancelBtn">${t('cancel')}</button>
                        <button class="b3-button b3-button--error" id="deleteConfirmBtn">${t('deleteGroup')}</button>
                    </div>
                </div>
            `,
            width: "400px"
        });

        const deleteCancelBtn = dialog.element.querySelector('#deleteCancelBtn') as HTMLButtonElement;
        const deleteConfirmBtn = dialog.element.querySelector('#deleteConfirmBtn') as HTMLButtonElement;

        deleteCancelBtn.addEventListener('click', () => dialog.destroy());

        deleteConfirmBtn.addEventListener('click', async () => {
            try {
                let taskAction: 'ungroup' | 'delete' = 'ungroup';
                if (hasTasks) {
                    const selectedAction = dialog.element.querySelector('input[name="taskAction"]:checked') as HTMLInputElement;
                    taskAction = selectedAction.value as 'ungroup' | 'delete';
                }

                // 从项目数据中移除分组
                const updatedGroups = projectGroups.filter((g: any) => g.id !== groupId);
                await projectManager.setProjectCustomGroups(this.projectId, updatedGroups);

                // 处理分组下的任务
                if (hasTasks && taskAction === 'delete') {
                    // 删除所有任务
                    for (const task of tasksInGroup) {
                        const taskData = task as any;
                        delete reminderData[taskData.id];
                    }
                    showMessage(t('groupDeletedWithTasks', { count: String(tasksInGroup.length) }));
                } else if (hasTasks && taskAction === 'ungroup') {
                    // 将任务设为未分组
                    for (const task of tasksInGroup) {
                        const taskData = task as any;
                        delete taskData.customGroupId;
                    }
                    showMessage(t('groupDeletedTasksUngrouped', { count: String(tasksInGroup.length) }));
                } else {
                    showMessage(t('groupDeleted'));
                }

                // 保存任务数据（如果有任务被修改或删除）
                if (hasTasks) {
                    await writeReminderData(reminderData);
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                }

                // 刷新分组列表
                await this.loadAndDisplayGroups(container);

                // 刷新看板（使用防抖队列）
                this.queueLoadTasks();

                dialog.destroy();
            } catch (error) {
                console.error('删除分组失败:', error);
                showMessage(t('deleteGroupFailed'));
                dialog.destroy();
            }
        });
    }

    private initUI() {
        this.container.classList.add('project-kanban-view');
        this.container.innerHTML = '';

        // 创建工具栏
        const toolbar = document.createElement('div');
        toolbar.className = 'project-kanban-toolbar';
        this.container.appendChild(toolbar);

        // 项目标题
        const titleContainer = document.createElement('div');
        titleContainer.className = 'project-kanban-title';

        const titleEl = document.createElement('h2');
        titleEl.textContent = this.project?.title || t('projectKanban');
        titleEl.style.cssText = `
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        `;

        // 如果项目有关联的笔记ID，添加点击跳转功能
        if (this.project?.blockId) {
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline';
            titleEl.style.textDecorationStyle = 'dotted';
            titleEl.title = t('clickToJumpToProjectNote');
            titleEl.setAttribute('data-has-note', 'true');

            titleEl.addEventListener('click', () => {
                this.openProjectNote(this.project.blockId);
            });

            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });

            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-on-background)';
            });
        }

        titleContainer.appendChild(titleEl);

        // 项目描述
        if (this.project?.note) {
            const descEl = document.createElement('div');
            descEl.className = 'project-kanban-description';
            descEl.textContent = this.project.note;
            descEl.style.cssText = `
                margin-top: 4px;
                font-size: 14px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
            `;
            titleContainer.appendChild(descEl);
        }

        toolbar.appendChild(titleContainer);

        // 控制按钮组
        const controlsGroup = document.createElement('div');
        controlsGroup.className = 'project-kanban-controls';
        controlsGroup.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: auto;
        `;

        // 新建任务按钮
        const addTaskBtn = document.createElement('button');
        addTaskBtn.className = 'b3-button b3-button--primary';
        addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg> ${t('newTask')}`;
        addTaskBtn.addEventListener('click', () => this.showCreateTaskDialog());
        controlsGroup.appendChild(addTaskBtn);

        const pasteTaskBtn = document.createElement('button');
        pasteTaskBtn.className = 'b3-button';
        pasteTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg> ${t('pasteNew')}`;
        pasteTaskBtn.addEventListener('click', () => this.showPasteTaskDialog());
        controlsGroup.appendChild(pasteTaskBtn);

        // 显示/隐藏已完成任务
        const toggleDoneBtn = document.createElement('button');
        toggleDoneBtn.className = 'b3-button b3-button--outline';
        toggleDoneBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg> ${this.showDone ? t('hideCompleted') : t('showCompleted')}`;
        toggleDoneBtn.addEventListener('click', () => {
            this.showDone = !this.showDone;
            toggleDoneBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconEye"></use></svg> ${this.showDone ? t('hideCompleted') : t('showCompleted')}`;
            this.queueLoadTasks();
        });
        // 如果当前为自定义分组看板模式，则不显示“隐藏已完成”按钮
        toggleDoneBtn.style.display = this.kanbanMode === 'custom' ? 'none' : 'inline-flex';
        controlsGroup.appendChild(toggleDoneBtn);

        // 排序按钮
        this.sortButton = document.createElement('button');
        this.sortButton.className = 'b3-button b3-button--outline';
        this.sortButton.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconSort"></use></svg>';
        this.sortButton.addEventListener('click', (e) => this.showSortMenu(e));
        controlsGroup.appendChild(this.sortButton);

        // 刷新按钮
        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'b3-button b3-button--outline';
        refreshBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconRefresh"></use></svg>';
        refreshBtn.title = t('refresh');
        refreshBtn.addEventListener('click', () => this.queueLoadTasks());
        controlsGroup.appendChild(refreshBtn);

        const calendarBtn = document.createElement('button');
        calendarBtn.className = 'b3-button b3-button--outline';
        calendarBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconCalendar"></use></svg>';
        calendarBtn.title = '打开日历视图';
        calendarBtn.addEventListener('click', () => this.openCalendarForProject());
        controlsGroup.appendChild(calendarBtn);

        // 看板模式选择下拉框
        const modeSelectContainer = document.createElement('div');
        modeSelectContainer.className = 'kanban-mode-select-container';
        modeSelectContainer.style.cssText = `
            position: relative;
            display: inline-block;
        `;

        const modeSelect = document.createElement('select');
        modeSelect.className = 'b3-select kanban-mode-select';
        modeSelect.style.cssText = `
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 14px;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
            min-width: 120px;
        `;

        // 添加选项
        const statusOption = document.createElement('option');
        statusOption.value = 'status';
        statusOption.textContent = t('statusKanban');
        if (this.kanbanMode === 'status') {
            statusOption.selected = true;
        }
        modeSelect.appendChild(statusOption);

        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = t('customGroupKanban');
        if (this.kanbanMode === 'custom') {
            customOption.selected = true;
        }
        modeSelect.appendChild(customOption);

        // 切换事件
        modeSelect.addEventListener('change', async () => {
            const newMode = modeSelect.value as 'status' | 'custom';
            if (newMode !== this.kanbanMode) {
                await this.toggleKanbanMode();
            }
        });

        modeSelectContainer.appendChild(modeSelect);
        controlsGroup.appendChild(modeSelectContainer);

        // 管理分组按钮（仅在自定义分组模式下显示）
        const manageGroupsBtn = document.createElement('button');
        manageGroupsBtn.className = 'b3-button b3-button--outline';
        manageGroupsBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconSettings"></use></svg> ${t('manageGroups')}`;
        manageGroupsBtn.title = t('manageCustomGroups');
        manageGroupsBtn.style.display = this.kanbanMode === 'custom' ? 'inline-flex' : 'none';
        manageGroupsBtn.addEventListener('click', () => this.showManageGroupsDialog());
        controlsGroup.appendChild(manageGroupsBtn);

        // 管理标签按钮
        const manageTagsBtn = document.createElement('button');
        manageTagsBtn.className = 'b3-button b3-button--outline';
        manageTagsBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconTags"></use></svg> ${t('manageTags')}`;
        manageTagsBtn.title = t('manageProjectTags');
        manageTagsBtn.addEventListener('click', () => this.showManageTagsDialog());
        controlsGroup.appendChild(manageTagsBtn);

        // 监听看板模式变化，更新管理按钮和“显示/隐藏已完成”按钮显示状态
        this.container.addEventListener('kanbanModeChanged', () => {
            try {
                manageGroupsBtn.style.display = this.kanbanMode === 'custom' ? 'inline-flex' : 'none';
                if (toggleDoneBtn) {
                    // 自定义分组模式下不显示该按钮
                    toggleDoneBtn.style.display = this.kanbanMode === 'custom' ? 'none' : 'inline-flex';
                }
            } catch (e) {
                console.error('Error updating toolbar buttons on kanbanModeChanged:', e);
            }
        });

        toolbar.appendChild(controlsGroup);

        // 创建看板容器
        const kanbanContainer = document.createElement('div');
        kanbanContainer.className = 'project-kanban-container';
        this.container.appendChild(kanbanContainer);

        // 创建四个列：进行中、短期、长期、已完成
        this.createKanbanColumn(kanbanContainer, 'doing', t('doing'), '#f39c12');
        this.createKanbanColumn(kanbanContainer, 'short_term', t('shortTerm'), '#3498db');
        this.createKanbanColumn(kanbanContainer, 'long_term', t('longTerm'), '#9b59b6');
        this.createKanbanColumn(kanbanContainer, 'done', t('done'), '#27ae60');

        // 添加自定义样式
        this.addCustomStyles();

        // 更新排序按钮标题
        this.updateSortButtonTitle();
        this.updateDoneSortButtonTitle();

        // 更新模式选择下拉框
        this.updateModeSelect();
    }

    private createKanbanColumn(container: HTMLElement, status: string, title: string, color: string) {
        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${status}`;
        column.dataset.status = status;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        // 为状态列添加 emoji 前缀（默认 title 参数 为翻译文本）
        const statusEmojiMap: { [key: string]: string } = {
            doing: '⏳',
            short_term: '📋',
            long_term: '🤔',
            done: '✅'
        };
        const emoji = statusEmojiMap[status] || '';
        titleEl.textContent = emoji ? `${emoji}${title}` : title;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${color};
        `;
        titleContainer.appendChild(titleEl);

        if (status === 'done') {
            this.doneSortButton = document.createElement('button');
            this.doneSortButton.className = 'b3-button b3-button--text';
            this.doneSortButton.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconSort"></use></svg>';
            this.doneSortButton.title = '排序';
            this.doneSortButton.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showDoneSortMenu(e);
            });
            titleContainer.appendChild(this.doneSortButton);
        }

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);

        // 新建任务按钮（针对该状态列），已完成列不显示新建按钮
        const rightContainer = document.createElement('div');
        rightContainer.style.cssText = 'display:flex; align-items:center; gap:8px;';
        rightContainer.appendChild(countEl);

        if (status !== 'done') {
            const addTaskBtn = document.createElement('button');
            addTaskBtn.className = 'b3-button b3-button--outline';
            addTaskBtn.style.cssText = 'margin-left:8px;';
            addTaskBtn.title = t('newTask');
            addTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
            addTaskBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 根据列的 status 传递默认任务类型给对话框
                let term: 'short_term' | 'long_term' | 'doing' | 'todo' = 'short_term';
                if (status === 'doing') term = 'doing';
                else if (status === 'short_term') term = 'short_term';
                else if (status === 'long_term') term = 'long_term';

                this.showCreateTaskDialog(undefined, undefined, term);
            });

            rightContainer.appendChild(addTaskBtn);
        }

        header.appendChild(rightContainer);

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 8px;
            overflow-y: auto;
            min-height: 200px;
        `;

        // 添加拖拽事件
        this.addDropZoneEvents(content, status);

        column.appendChild(header);
        column.appendChild(content);

        // 分页容器（插入在列内容之后）
        const pagination = document.createElement('div');
        pagination.className = 'kanban-column-pagination';
        pagination.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 8px;
        `;

        column.appendChild(pagination);
        container.appendChild(column);

        return column;
    }

    private addDropZoneEvents(element: HTMLElement, status: string) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 检查是否可以改变状态或解除父子关系
                const canChangeStatus = this.draggedTask.status !== status;
                const canUnsetParent = !!this.draggedTask.parentId;

                if (canChangeStatus || canUnsetParent) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');

                    // 不显示解除父任务关系的提示，让用户通过拖拽区域自然判断
                    // 移除了原来的 unsetParent 指示器显示逻辑
                }
            }
        });

        element.addEventListener('dragleave', (_e) => {
            // 使用 contains 检查离开目标区域时清除样式
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');
                this.updateIndicator('none', null, null);

                // 如果状态改变，执行状态切换
                if (this.draggedTask.status !== status) {
                    this.changeTaskStatus(this.draggedTask, status);
                }
                // 否则，如果有父任务，解除父子关系
                else if (this.draggedTask.parentId) {
                    this.unsetParentChildRelation(this.draggedTask);
                }
            }
        });
    }

    /**
     * 为自定义分组列添加拖拽事件（设置分组）
     */
    private addCustomGroupDropZoneEvents(element: HTMLElement, groupId: string | null) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 将 undefined 或字符串 'ungrouped' 视为 null，对比当前分组是否与目标一致
                const currentGroupRaw = (this.draggedTask.customGroupId as any);
                const currentGroup = (currentGroupRaw === undefined || currentGroupRaw === 'ungrouped') ? null : currentGroupRaw;
                const canSetGroup = currentGroup !== groupId;

                if (canSetGroup) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            }
        });

        element.addEventListener('dragleave', (_e) => {
            // 使用 contains 检查离开目标区域时清除样式
            if (!element.contains((_e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                element.classList.remove('kanban-drop-zone-active');

                // 设置任务分组（如果 groupId 为 null，则移除分组）
                this.setTaskCustomGroup(this.draggedTask, groupId);
            }
        });
    }

    /**
     * **[新增]** 为自定义分组下的状态子分组添加拖拽事件（设置任务状态）
     * @param element 目标DOM元素
     * @param targetStatus 目标状态 ('doing', 'short_term', 'long_term')
     */
    private addStatusSubGroupDropEvents(element: HTMLElement, targetStatus: string) {
        element.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedTask) {
                // 获取当前任务的状态
                const currentStatus = this.getTaskStatus(this.draggedTask);
                // 如果当前状态与目标状态不同，则允许放置
                if (currentStatus !== targetStatus) {
                    e.preventDefault();
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                    element.classList.add('kanban-drop-zone-active');
                }
            }
        });

        element.addEventListener('dragleave', (e) => {
            // 使用 contains 检查是否真正离开目标区域
            if (!element.contains((e as any).relatedTarget as Node)) {
                element.classList.remove('kanban-drop-zone-active');
            }
        });

        element.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedTask) {
                e.preventDefault();
                // 关键：阻止事件冒泡，防止触发父级（整个自定义分组）的drop事件
                e.stopPropagation();
                element.classList.remove('kanban-drop-zone-active');

                // 改变任务状态
                this.changeTaskStatus(this.draggedTask, targetStatus);
            }
        });
    }


    /**
     * 设置任务的自定义分组
     */
    private async setTaskCustomGroup(task: any, groupId: string | null) {
        try {
            // 归一化：确保 'ungrouped' 字符串也会被当作 null 处理
            if (groupId === 'ungrouped') groupId = null;
            const reminderData = await readReminderData();

            if (!reminderData[task.id]) {
                showMessage("任务不存在");
                return;
            }

            // 计算要更新的任务列表：包含当前任务及其所有后代
            const toUpdateIds = [task.id, ...this.getAllDescendantIds(task.id, reminderData)];

            let updatedCount = 0;
            toUpdateIds.forEach(id => {
                const item = reminderData[id];
                if (!item) return;
                if (groupId === null) {
                    // 明确移除分组
                    if (item.customGroupId !== undefined) {
                        delete item.customGroupId;
                        updatedCount++;
                    }
                } else {
                    if (item.customGroupId !== groupId) {
                        item.customGroupId = groupId;
                        updatedCount++;
                    }
                }
            });

            if (updatedCount === 0) {
                showMessage('没有需要更新的任务分组');
                return;
            }

            await writeReminderData(reminderData);

            // 广播更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 提示更新的任务数
            if (groupId === null) {
                showMessage(`已将 ${updatedCount} 个任务移出分组`);
            } else {
                showMessage(`已将 ${updatedCount} 个任务添加到分组`);
            }

            // 重新加载任务以更新显示（使用防抖队列）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('设置任务分组失败:', error);
            showMessage("设置任务分组失败");
        }
    }

    /**
     * 切换任务的标签（添加或移除）
     * @param task 任务对象
     * @param tagId 标签ID
     */
    private async toggleTaskTag(task: any, tagId: string) {
        try {
            const reminderData = await readReminderData();

            if (!reminderData[task.id]) {
                showMessage("任务不存在");
                return;
            }

            // 获取标签名称用于显示
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectTags = await projectManager.getProjectTags(this.projectId);
            const tag = projectTags.find(t => t.id === tagId);
            const tagName = tag?.name || tagId;

            // 计算要更新的任务列表：包含当前任务及其所有后代
            const toUpdateIds = [task.id, ...this.getAllDescendantIds(task.id, reminderData)];

            // 更新所有相关任务的标签
            let updatedCount = 0;
            const currentTags = reminderData[task.id].tagIds || [];
            const tagIndex = currentTags.indexOf(tagId);
            const isAdding = tagIndex === -1;

            for (const taskId of toUpdateIds) {
                if (reminderData[taskId]) {
                    if (!reminderData[taskId].tagIds) {
                        reminderData[taskId].tagIds = [];
                    }

                    const tags = reminderData[taskId].tagIds;
                    const idx = tags.indexOf(tagId);

                    if (isAdding) {
                        // 添加标签
                        if (idx === -1) {
                            tags.push(tagId);
                            updatedCount++;
                        }
                    } else {
                        // 移除标签
                        if (idx > -1) {
                            tags.splice(idx, 1);
                            updatedCount++;
                        }
                    }
                }
            }

            await writeReminderData(reminderData);

            // 广播更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 提示更新的任务数
            if (isAdding) {
                showMessage(`已为 ${updatedCount} 个任务添加标签"${tagName}"`);
            } else {
                showMessage(`已从 ${updatedCount} 个任务移除标签"${tagName}"`);
            }

            // 重新加载任务以更新显示（使用防抖队列）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('切换任务标签失败:', error);
            showMessage("设置任务标签失败");
        }
    }

    private async loadTasks() {
        if (this.isLoading) {
            console.log('任务正在加载中，跳过本次加载请求');
            return;
        }

        this.isLoading = true;
        try {
            // 保存当前滚动状态，避免界面刷新时丢失滚动位置
            this.captureScrollState();

            const reminderData = await readReminderData();
            const projectTasks = Object.values(reminderData).filter((reminder: any) => reminder && reminder.projectId === this.projectId);
            // 修复遗留：如果任务中存在 customGroupId === 'ungrouped'，视为未分组（删除该字段）
            projectTasks.forEach((t: any) => {
                if (t && t.customGroupId === 'ungrouped') {
                    delete t.customGroupId;
                }
            });
            const taskMap = new Map(projectTasks.map((t: any) => [t.id, { ...t }]));

            const getRootStatus = (task: any): string => {
                let current = task;
                while (current.parentId && taskMap.has(current.parentId)) {
                    current = taskMap.get(current.parentId);
                }
                return this.getTaskStatus(current);
            };

            // 处理周期事件：生成实例并筛选
            const today = getLogicalDateString();
            const allTasksWithInstances: any[] = [];

            projectTasks.forEach((reminder: any) => {
                // 对于农历重复任务，只添加符合农历日期的实例，不添加原始日期
                const isLunarRepeat = reminder.repeat?.enabled &&
                    (reminder.repeat.type === 'lunar-monthly' || reminder.repeat.type === 'lunar-yearly');

                // 修改后的逻辑：对于所有重复事件，只显示实例，不显示原始任务
                if (!reminder.repeat?.enabled) {
                    // 非周期任务，正常添加
                    allTasksWithInstances.push(reminder);
                }
                // 对于所有重复事件（农历和非农历），都不添加原始任务，只添加实例

                // 如果是周期事件，生成实例
                if (reminder.repeat?.enabled) {
                    // 智能确定时间范围，确保至少能找到下一个未来实例
                    const repeatInstances = this.generateInstancesWithFutureGuarantee(reminder, today, isLunarRepeat);

                    // 过滤实例：保留过去未完成、今天的、未来第一个未完成，以及所有已完成的实例
                    const completedInstances = reminder.repeat?.completedInstances || [];
                    const instanceModifications = reminder.repeat?.instanceModifications || {};

                    // 将实例分类为：过去未完成、今天未完成、未来未完成、未来已完成、过去已完成
                    let pastIncompleteList: any[] = [];
                    let todayIncompleteList: any[] = [];
                    let futureIncompleteList: any[] = [];
                    let futureCompletedList: any[] = [];
                    let pastCompletedList: any[] = [];

                    repeatInstances.forEach(instance => {
                        const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                        const originalKey = instanceIdStr.split('_').pop() || instance.date;
                        // 对于所有重复事件，只添加实例，不添加原始任务
                        const isInstanceCompleted = completedInstances.includes(originalKey);
                        const instanceMod = instanceModifications[originalKey];

                        const instanceTask = {
                            ...reminder,
                            id: instance.instanceId,
                            date: instance.date,
                            endDate: instance.endDate,
                            time: instance.time,
                            endTime: instance.endTime,
                            isRepeatInstance: true,
                            originalId: instance.originalId,
                            completed: isInstanceCompleted,
                            // 如果实例有修改，使用实例的值；否则使用原始值
                            note: instanceMod?.note !== undefined ? instanceMod.note : reminder.note,
                            priority: instanceMod?.priority !== undefined ? instanceMod.priority : reminder.priority,
                            categoryId: instanceMod?.categoryId !== undefined ? instanceMod.categoryId : reminder.categoryId,
                            projectId: instanceMod?.projectId !== undefined ? instanceMod.projectId : reminder.projectId,
                            customGroupId: instanceMod?.customGroupId !== undefined ? instanceMod.customGroupId : reminder.customGroupId,
                            termType: instanceMod?.termType !== undefined ? instanceMod.termType : reminder.termType,
                            kanbanStatus: instanceMod?.kanbanStatus !== undefined ? instanceMod.kanbanStatus : reminder.kanbanStatus,
                            // 为已完成的实例添加完成时间（用于排序）
                            completedTime: isInstanceCompleted ? getLocalDateTimeString(new Date(instance.date)) : undefined
                        };

                        // 按日期和完成状态分类
                        const dateComparison = compareDateStrings(instance.date, today);

                        if (dateComparison < 0) {
                            // 过去的日期
                            if (isInstanceCompleted) {
                                pastCompletedList.push(instanceTask);
                            } else {
                                pastIncompleteList.push(instanceTask);
                            }
                        } else if (dateComparison === 0) {
                            // 今天的日期（只收集未完成的）
                            if (!isInstanceCompleted) {
                                todayIncompleteList.push(instanceTask);
                            } else {
                                pastCompletedList.push(instanceTask); // 今天已完成算作过去
                            }
                        } else {
                            // 未来的日期
                            if (isInstanceCompleted) {
                                futureCompletedList.push(instanceTask);
                            } else {
                                futureIncompleteList.push(instanceTask);
                            }
                        }
                    });

                    // 添加过去的未完成实例
                    allTasksWithInstances.push(...pastIncompleteList);

                    // 添加今天的未完成实例
                    allTasksWithInstances.push(...todayIncompleteList);

                    // 添加未来的第一个未完成实例（如果存在）
                    // 这样即使有多个已完成的未来实例，也能显示下一个未完成的实例
                    if (futureIncompleteList.length > 0) {
                        // 对于所有重复事件，如果今天没有未完成实例，就添加未来第一个未完成的
                        const hasTodayIncomplete = todayIncompleteList.length > 0;
                        if (!hasTodayIncomplete) {
                            allTasksWithInstances.push(futureIncompleteList[0]);
                        }
                    }

                    // 添加所有已完成的实例（包括过去和未来的）- ProjectKanbanView需要显示已完成的实例
                    allTasksWithInstances.push(...pastCompletedList);
                    allTasksWithInstances.push(...futureCompletedList);
                }
            });

            this.tasks = await Promise.all(allTasksWithInstances.map(async (reminder: any) => {
                let status;
                if (reminder.parentId && taskMap.has(reminder.parentId)) {
                    // For ALL subtasks, their column is determined by their root parent's status
                    status = getRootStatus(reminder);
                } else {
                    // For top-level tasks, use their own status
                    status = this.getTaskStatus(reminder);
                }
                // 获取番茄钟计数（支持重复实例的单独计数）
                const pomodoroCount = await this.getReminderPomodoroCount(reminder.id, reminder, reminderData);
                const focusTime = await this.getReminderFocusTime(reminder.id, reminder, reminderData);
                return {
                    ...reminder,
                    status: status,
                    pomodoroCount: pomodoroCount,
                    focusTime: focusTime || 0
                };
            }));

            this.sortTasks();

            // 默认折叠逻辑：
            // - 首次加载（或用户无任何折叠偏好）时，按照旧逻辑为非 doing 的父任务设置为折叠状态；
            // - 之后的加载尽量保留用户通过界面展开/折叠的偏好（即不再盲目 clear 并重新折叠已展开的父任务）；
            // - 同时移除那些已经不存在的任务 id，防止内存泄漏或过期状态。
            try {
                const taskIds = new Set(this.tasks.map(t => t.id));

                // 清理 collapsedTasks 中已不存在的任务 id
                for (const id of Array.from(this.collapsedTasks)) {
                    if (!taskIds.has(id)) {
                        this.collapsedTasks.delete(id);
                    }
                }

                // 收集父任务及其子任务
                const parentMap = new Map<string, any[]>();
                this.tasks.forEach(t => {
                    if (t.parentId && taskIds.has(t.parentId)) {
                        if (!parentMap.has(t.parentId)) parentMap.set(t.parentId, []);
                        parentMap.get(t.parentId)!.push(t);
                    }
                });

                // 仅在用户没有任何折叠偏好（collapsedTasks 为空）时，应用默认折叠策略
                if (this.collapsedTasks.size === 0) {
                    parentMap.forEach((_children, parentId) => {
                        const parent = this.tasks.find(p => p.id === parentId);
                        if (!parent) return;
                        // 默认折叠所有父任务
                        this.collapsedTasks.add(parentId);
                    });
                }
            } catch (err) {
                console.warn('设置默认折叠任务失败:', err);
            }


            // 重置分页索引，防止页码超出范围
            try {
                const counts = {
                    doing: this.tasks.filter(t => t.status === 'doing').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    short_term: this.tasks.filter(t => t.status === 'short_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    long_term: this.tasks.filter(t => t.status === 'long_term').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                    done: this.tasks.filter(t => t.status === 'done').filter(t => !t.parentId || !this.tasks.find(tt => tt.id === t.parentId)).length,
                };
                for (const status of ['doing', 'short_term', 'long_term', 'done']) {
                    const totalTop = counts[status as keyof typeof counts] || 0;
                    const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
                    const current = this.pageIndexMap[status] || 1;
                    this.pageIndexMap[status] = Math.min(Math.max(1, current), totalPages);
                }
            } catch (err) {
                // ignore
            }

            this.renderKanban();
        } catch (error) {
            console.error('加载任务失败:', error);
            showMessage("加载任务失败");
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * 防抖加载任务队列：避免短时间多次触发导致界面频繁重绘和滚动位置丢失
     */
    private queueLoadTasks(): Promise<void> {
        // 如果已有挂起的 promise，则复用
        if (!this._pendingLoadPromise) {
            this._pendingLoadPromise = new Promise<void>((resolve) => { this._pendingLoadResolve = resolve; });
        }

        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }

        this._debounceTimer = setTimeout(async () => {
            try {
                await this.loadTasks();
            } catch (e) {
                console.error('queueLoadTasks 执行 loadTasks 时出错', e);
            } finally {
                if (this._pendingLoadResolve) {
                    this._pendingLoadResolve();
                }
                this._pendingLoadPromise = null;
                this._pendingLoadResolve = null;
                this._debounceTimer = null;
            }
        }, this._debounceDelay);

        return this._pendingLoadPromise as Promise<void>;
    }

    /**
     * 保存当前水平滚动（看板容器）和每列纵向滚动位置
     */
    private captureScrollState() {
        try {
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement | null;
            const containerScrollLeft = kanbanContainer ? kanbanContainer.scrollLeft : this.container.scrollLeft;
            const columnScrollTopMap: { [key: string]: number } = {};

            const columns = this.container.querySelectorAll('.kanban-column');
            columns.forEach((col) => {
                const content = col.querySelector('.kanban-column-content') as HTMLElement | null;
                if (content) {
                    const status = (col.getAttribute('data-status') || col.dataset.status) || (col.getAttribute('data-group-id') || col.dataset.groupId) || '';
                    const key = status ? status : `col-${Array.prototype.indexOf.call(columns, col)}`;
                    columnScrollTopMap[key] = content.scrollTop || 0;
                }
            });

            this._savedScrollState = {
                containerScrollLeft: containerScrollLeft || 0,
                columnScrollTopMap
            };
        } catch (err) {
            console.warn('保存滚动状态失败', err);
            this._savedScrollState = null;
        }
    }

    /**
     * 恢复之前保存的滚动位置
     */
    private restoreScrollState() {
        if (!this._savedScrollState) return;
        try {
            const { containerScrollLeft, columnScrollTopMap } = this._savedScrollState;
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement | null;
            if (kanbanContainer) {
                // setTimeout to ensure layout updated
                setTimeout(() => {
                    try {
                        kanbanContainer.scrollLeft = Math.max(0, Math.min(kanbanContainer.scrollWidth - kanbanContainer.clientWidth, containerScrollLeft));
                    } catch (e) { /* ignore */ }
                }, 0);
            } else {
                // fallback
                try { this.container.scrollLeft = containerScrollLeft; } catch (e) { /* ignore */ }
            }

            // Restore columns' vertical scroll
            Object.keys(columnScrollTopMap).forEach(key => {
                // try find by status first
                let content: HTMLElement | null = null;
                if (key.startsWith('col-')) {
                    // index-based key
                    const idx = parseInt(key.replace('col-', ''), 10);
                    const columns = this.container.querySelectorAll('.kanban-column');
                    const col = columns && columns[idx] as HTMLElement | undefined;
                    content = col ? col.querySelector('.kanban-column-content') as HTMLElement : null;
                } else {
                    // try match by data-status or data-group-id
                    content = this.container.querySelector(`.kanban-column[data-status="${key}"] .kanban-column-content`) as HTMLElement;
                    if (!content) {
                        content = this.container.querySelector(`.kanban-column[data-group-id="${key}"] .kanban-column-content`) as HTMLElement;
                    }
                }
                if (content) {
                    const top = columnScrollTopMap[key] || 0;
                    // setTimeout to ensure DOM content height calculated
                    setTimeout(() => { content.scrollTop = Math.max(0, Math.min(content.scrollHeight - content.clientHeight, top)); }, 0);
                }
            });
        } catch (err) {
            console.warn('恢复滚动状态失败', err);
        } finally {
            this._savedScrollState = null;
        }
    }

    /**
     * 获取提醒的番茄钟计数（支持重复实例的单独计数）
     * @param reminderId 提醒ID
     * @returns 番茄钟计数
     */
    private async getReminderPomodoroCount(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();
            // Repeat instances should be shown as per-instance totals
            if (reminder && reminder.isRepeatInstance) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        const { readReminderData } = await import("../api");
                        rawData = await readReminderData();
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

            if (hasDescendants) {
                if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                    return await pomodoroManager.getAggregatedReminderPomodoroCount(reminderId);
                }
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }

            const isSubtask = reminder && reminder.parentId;
            if (isSubtask) {
                return await pomodoroManager.getReminderPomodoroCount(reminderId);
            }
            // For parent: return aggregated count
            if (typeof pomodoroManager.getAggregatedReminderPomodoroCount === 'function') {
                return await pomodoroManager.getAggregatedReminderPomodoroCount(reminderId);
            }
            return await pomodoroManager.getReminderPomodoroCount(reminderId);
        } catch (error) {
            console.error('获取番茄钟计数失败:', error);
            return 0;
        }
    }

    private async getReminderFocusTime(reminderId: string, reminder?: any, reminderData?: any): Promise<number> {
        try {
            const { PomodoroRecordManager } = await import("../utils/pomodoroRecord");
            const pomodoroManager = PomodoroRecordManager.getInstance();
            // If repeat instance, use per-event total
            if (reminder && reminder.isRepeatInstance) {
                if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
                if (typeof pomodoroManager.getEventFocusTime === 'function') {
                    return pomodoroManager.getEventFocusTime(reminderId);
                }
                return 0;
            }

            let hasDescendants = false;
            if (reminder && this.getAllDescendantIds) {
                try {
                    let rawData = reminderData;
                    if (!rawData) {
                        const { readReminderData } = await import('../api');
                        rawData = await readReminderData();
                    }
                    const reminderMap = rawData instanceof Map ? rawData : new Map(Object.values(rawData || {}).map((r: any) => [r.id, r]));
                    hasDescendants = this.getAllDescendantIds(reminder.id, reminderMap).length > 0;
                } catch (e) {
                    hasDescendants = false;
                }
            }

            if (hasDescendants) {
                if (typeof pomodoroManager.getAggregatedReminderFocusTime === 'function') {
                    return await pomodoroManager.getAggregatedReminderFocusTime(reminderId);
                }
                if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                    return pomodoroManager.getEventTotalFocusTime(reminderId);
                }
            }

            // default to per-event total
            if (typeof pomodoroManager.getEventTotalFocusTime === 'function') {
                return pomodoroManager.getEventTotalFocusTime(reminderId);
            }
            return 0;
        } catch (error) {
            console.error('获取番茄钟总专注时长失败:', error);
            return 0;
        }
    }

    /**
     * 静态方法：计算给定项目的顶级任务在 kanbanStatus 上的数量（只计顶级，即没有 parentId）
     * 使用与 getTaskStatus 相同的逻辑，包括日期自动归档到进行中的逻辑
     */
    public static countTopLevelTasksByStatus(projectId: string, reminderData: any): { doing: number; short_term: number; long_term: number; done: number } {
        const allReminders = reminderData && typeof reminderData === 'object' ? Object.values(reminderData) : [];
        let doing = 0, short_term = 0, long_term = 0, done = 0;
        const today = getLogicalDateString();

        allReminders.forEach((r: any) => {
            if (!r || typeof r !== 'object') return;
            // 仅统计属于该 project 且为顶级任务（parentId 严格为 undefined/null/空字符串认为是顶级）
            const hasParent = r.hasOwnProperty('parentId') && r.parentId !== undefined && r.parentId !== null && String(r.parentId).trim() !== '';

            if (r.projectId === projectId && !hasParent) {
                // 判断是否为周期任务
                if (r.repeat && r.repeat.enabled) {
                    // 周期任务：逻辑需与 loadTasks 保持一致，统计"实例"而非原始任务
                    const completedInstances = r.repeat.completedInstances || [];
                    const instanceModifications = r.repeat.instanceModifications || {};

                    // 1. 生成实例
                    // 为了性能，我们近似生成范围：从任务开始时间（或较早前）到未来一年
                    // 这能覆盖所有"过去未完成"（视为进行中）和"未来"（视为待办/短期/长期）的情况
                    const rangeStart = r.startDate || r.date || r.createdTime?.split('T')[0] || '2020-01-01';
                    const futureDate = new Date();
                    futureDate.setDate(futureDate.getDate() + 365); // 往后一年，确保能覆盖到下一个周期
                    const rangeEnd = getLocalDateString(futureDate);

                    let repeatInstances: any[] = [];
                    try {
                        repeatInstances = generateRepeatInstances(r, rangeStart, rangeEnd);
                    } catch (e) {
                        console.error('生成重复实例失败', e);
                        repeatInstances = [];
                    }

                    // 2. 模拟 loadTasks 的筛选逻辑
                    let hasTodayIncomplete = false;
                    const futureIncompleteList: any[] = [];

                    repeatInstances.forEach((instance: any) => {
                        const instanceIdStr = (instance as any).instanceId || `${r.id}_${instance.date}`;
                        const originalKey = instanceIdStr.split('_').pop() || instance.date;
                        const isInstanceCompleted = completedInstances.includes(originalKey);
                        const instanceMod = instanceModifications[originalKey] || {};

                        const dateComparison = compareDateStrings(instance.date, today);

                        if (isInstanceCompleted) {
                            // 所有已完成的实例都会显示在看板上，计入 done
                            done++;
                        } else {
                            // 未完成实例处理
                            if (dateComparison <= 0) {
                                // 过去或今天的未完成实例 -> 计入 doing (自动归档逻辑)
                                doing++;
                                if (dateComparison === 0) hasTodayIncomplete = true;
                            } else {
                                // 未来的未完成实例，先收集
                                futureIncompleteList.push({
                                    ...instance,
                                    // 合并修改属性以便后续判断状态
                                    kanbanStatus: instanceMod.kanbanStatus || r.kanbanStatus,
                                    termType: instanceMod.termType || r.termType
                                });
                            }
                        }
                    });

                    // 3. 处理未来实例显示规则：
                    // 如果今天没有未完成实例，则显示未来第一个未完成实例
                    if (!hasTodayIncomplete && futureIncompleteList.length > 0) {
                        const firstFuture = futureIncompleteList[0];
                        // 判断这个未来实例的状态
                        if (firstFuture.kanbanStatus === 'doing') {
                            doing++;
                        } else {
                            const tType = firstFuture.termType;
                            if (tType === 'long_term') long_term++;
                            else if (tType === 'doing') doing++;
                            else short_term++; // 默认为短期
                        }
                    }

                } else {
                    // 非周期任务：原有逻辑
                    const isCompleted = !!r.completed || (r.completedTime !== undefined && r.completedTime !== null && String(r.completedTime).trim() !== '');
                    if (isCompleted) {
                        done += 1;
                        return;
                    }

                    if (r.kanbanStatus === 'doing') {
                        doing += 1;
                        return;
                    }

                    if (r.date) {
                        const dateComparison = compareDateStrings(r.date, today);
                        if (dateComparison <= 0) { // 今天或过去
                            doing += 1;
                            return;
                        }
                    }

                    // 根据termType确定是长期还是短期
                    if (r.termType === 'long_term') {
                        long_term += 1;
                    } else if (r.termType === 'doing') {
                        doing += 1;
                    } else {
                        short_term += 1; // 默认为短期
                    }
                }
            }
        });

        return { doing, short_term, long_term, done };
    }

    private getTaskStatus(task: any): string {
        if (task.completed) return 'done';
        if (task.kanbanStatus === 'doing') return 'doing';

        // 如果未完成的任务设置了日期，且日期为今天或过期，放入进行中列
        if (task.date) {
            const today = getLogicalDateString();
            const dateComparison = compareDateStrings(task.date, today);
            if (dateComparison <= 0) { // 今天或过去
                return 'doing';
            }
        }

        // 根据termType确定是长期还是短期
        if (task.termType === 'long_term') return 'long_term';
        if (task.termType === 'doing') return 'doing';
        return 'short_term'; // 默认为短期
    }

    private updateSortButtonTitle() {
        if (this.sortButton) {
            const sortNames = {
                'time': t('sortingTime'),
                'priority': t('sortingPriority'),
                'title': t('sortingTitle')
            };
            const orderNames = {
                'asc': t('ascendingOrder'),
                'desc': t('descendingOrder')
            };
            this.sortButton.title = `${t('sortBy')}: ${sortNames[this.currentSort]} (${orderNames[this.currentSortOrder]})`;
        }
    }

    private updateDoneSortButtonTitle() {
        if (this.doneSortButton) {
            const sortNames = {
                'completedTime': t('sortByCompletedTime'),
                'title': t('sortingTitle'),
                'priority': t('sortingPriority'),
                'time': t('sortBySetTime')
            };
            const orderNames = {
                'asc': t('ascendingOrder'),
                'desc': t('descendingOrder')
            };
            this.doneSortButton.title = `${t('sortBy')}: ${sortNames[this.doneSort] || t('sortByCompletedTime')} (${orderNames[this.doneSortOrder] || t('descendingOrder')})`;
        }
    }

    private sortTasks() {
        this.tasks.sort((a, b) => {
            let result = 0;

            switch (this.currentSort) {
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                default:
                    result = this.compareByPriority(a, b);
            }

            // 优先级排序的结果相反
            if (this.currentSort === 'priority') {
                result = -result;
            }

            return this.currentSortOrder === 'desc' ? -result : result;
        });
    }

    private compareByPriority(a: any, b: any): number {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1, 'none': 0 };
        const priorityA = priorityOrder[a.priority || 'none'] || 0;
        const priorityB = priorityOrder[b.priority || 'none'] || 0;

        // 1. 按优先级排序
        const priorityDiff = priorityB - priorityA; // 高优先级在前
        if (priorityDiff !== 0) {
            return priorityDiff;
        }

        // 2. 同优先级内按手动排序
        const sortA = a.sort || 0;
        const sortB = b.sort || 0;

        if (sortA !== sortB) {
            return sortA - sortB; // 手动排序值小的在前
        }

        // 3. 如果手动排序值也相同，按创建时间排序
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTime(a: any, b: any): number {
        const dateA = a.date || '9999-12-31';
        const dateB = b.date || '9999-12-31';
        const timeA = a.time || '00:00';
        const timeB = b.time || '00:00';

        const datetimeA = `${dateA}T${timeA}`;
        const datetimeB = `${dateB}T${timeB}`;

        const timeCompare = datetimeA.localeCompare(datetimeB);
        if (timeCompare !== 0) {
            return timeCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByTitle(a: any, b: any): number {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const titleCompare = titleA.localeCompare(titleB, 'zh-CN');
        if (titleCompare !== 0) {
            return titleCompare;
        }
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
    }

    private compareByCompletedTime(a: any, b: any): number {
        const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
        const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
        if (timeA === timeB) {
            return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
        }
        return timeA - timeB;
    }

    private openCalendarForProject() {
        this.plugin.openCalendarTab({ projectFilter: this.projectId });
    }

    private sortDoneTasks(tasks: any[]): any[] {
        const sortedTasks = [...tasks];
        sortedTasks.sort((a, b) => {
            let result = 0;
            switch (this.doneSort) {
                case 'completedTime':
                    result = this.compareByCompletedTime(a, b);
                    break;
                case 'title':
                    result = this.compareByTitle(a, b);
                    break;
                case 'priority':
                    result = this.compareByPriority(a, b);
                    break;
                case 'time':
                    result = this.compareByTime(a, b);
                    break;
                default:
                    result = this.compareByCompletedTime(a, b);
            }

            if (this.doneSort === 'priority') {
                result = -result;
            }

            return this.doneSortOrder === 'desc' ? -result : result;
        });
        return sortedTasks;
    }

    private async renderKanban() {
        // 保存滚动位置（如果还没有被上层保存）
        if (!this._savedScrollState) this.captureScrollState();
        // 在切换模式时完全清空容器，避免不同模式的组件残留
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (kanbanContainer) {
            kanbanContainer.innerHTML = '';
        }

        if (this.kanbanMode === 'status') {
            await this.renderStatusKanban();
        } else {
            await this.renderCustomGroupKanban();
        }
        // 恢复滚动位置（如果有的话）
        this.restoreScrollState();
    }

    private async renderCustomGroupKanban() {
        // 使用项目管理器获取自定义分组
        const { ProjectManager } = await import('../utils/projectManager');
        const projectManager = ProjectManager.getInstance(this.plugin);
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

        if (projectGroups.length === 0) {
            // 如果没有自定义分组，显示提示
            this.renderEmptyCustomGroupKanban();
            return;
        }

        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // 将任务分为已完成和其他状态
        const completedTasks = this.tasks.filter(task => task.completed);
        const incompleteTasks = this.tasks.filter(task => !task.completed);

        // 将未完成任务进一步分为：进行中、短期、长期
        const doingTasks = incompleteTasks.filter(task => this.getTaskStatus(task) === 'doing');
        const shortTermTasks = incompleteTasks.filter(task => this.getTaskStatus(task) === 'short_term');
        const longTermTasks = incompleteTasks.filter(task => this.getTaskStatus(task) === 'long_term');

        // 对已完成任务按完成时间倒序排序
        completedTasks.sort((a, b) => {
            const timeA = a.completedTime ? new Date(a.completedTime).getTime() : 0;
            const timeB = b.completedTime ? new Date(b.completedTime).getTime() : 0;
            return timeB - timeA; // 倒序排列，最新的在前
        });

        // 为每个自定义分组创建四个子列：进行中、短期、长期、已完成（即使没有任务也要显示）
        projectGroups.forEach((group: any) => {
            const groupDoingTasks = doingTasks.filter(task => task.customGroupId === group.id);
            const groupShortTermTasks = shortTermTasks.filter(task => task.customGroupId === group.id);
            const groupLongTermTasks = longTermTasks.filter(task => task.customGroupId === group.id);
            const groupCompletedTasks = completedTasks.filter(task => task.customGroupId === group.id);

            // 即使没有任务也要显示分组列
            this.renderCustomGroupColumnWithFourStatus(group, groupDoingTasks, groupShortTermTasks, groupLongTermTasks, groupCompletedTasks);
        });

        // 处理未分组任务（即使没有任务也要显示）
        const ungroupedDoingTasks = doingTasks.filter(task => !task.customGroupId);
        const ungroupedShortTermTasks = shortTermTasks.filter(task => !task.customGroupId);
        const ungroupedLongTermTasks = longTermTasks.filter(task => !task.customGroupId);
        const ungroupedCompletedTasks = completedTasks.filter(task => !task.customGroupId);

        const ungroupedGroup = {
            id: 'ungrouped',
            name: '未分组',
            color: '#95a5a6',
            icon: '📋'
        };
        this.renderCustomGroupColumnWithFourStatus(ungroupedGroup, ungroupedDoingTasks, ungroupedShortTermTasks, ungroupedLongTermTasks, ungroupedCompletedTasks);

        // 为自定义分组列添加列级拖拽支持（可以直接拖动列头调整分组顺序）
        try {
            const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
            if (kanbanContainer && !kanbanContainer.dataset.hasColumnDropHandlers) {
                kanbanContainer.dataset.hasColumnDropHandlers = '1';

                kanbanContainer.addEventListener('dragover', (e) => {
                    try {
                        const dt = (e as DragEvent).dataTransfer;
                        if (!dt && !this.draggedGroupId) return;

                        let draggedId = '';
                        try { if (dt) draggedId = dt.getData('text/plain') || ''; } catch (err) { draggedId = ''; }
                        if (!draggedId) draggedId = this.draggedGroupId || '';
                        if (!draggedId) return;

                        e.preventDefault();
                        if (dt) dt.dropEffect = 'move';

                        // 清除已有指示器（DOM 中的）
                        if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                            this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                            this._columnDropIndicator = null;
                        }

                        // 获取所有自定义分组列（含未分组），并过滤掉被拖拽的列
                        let columns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
                        columns = columns.filter(c => !!c.dataset.groupId);
                        columns = columns.filter(c => (c.dataset.groupId || '') !== draggedId);

                        const createIndicator = (beforeEl: HTMLElement | null) => {
                            const indicator = document.createElement('div');
                            indicator.className = 'column-drop-indicator';
                            indicator.style.cssText = `
                                width: 6px;
                                background-color: var(--b3-theme-primary);
                                border-radius: 3px;
                                margin: 0 6px;
                                align-self: stretch;
                            `;
                            if (beforeEl) kanbanContainer.insertBefore(indicator, beforeEl);
                            else kanbanContainer.appendChild(indicator);
                            this._columnDropIndicator = indicator;
                        };

                        if (columns.length === 0) {
                            createIndicator(null);
                            return;
                        }

                        const clientX = (e as DragEvent).clientX;
                        let inserted = false;
                        for (const col of columns) {
                            const rect = col.getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (clientX < midpoint) {
                                createIndicator(col);
                                inserted = true;
                                break;
                            }
                        }

                        if (!inserted) createIndicator(null);
                    } catch (err) {
                        // ignore
                    }
                });

                kanbanContainer.addEventListener('dragleave', (e) => {
                    const related = (e as any).relatedTarget as Node;
                    if (!related || !kanbanContainer.contains(related)) {
                        if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                            this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                        }
                        this._columnDropIndicator = null;
                    }
                });

                kanbanContainer.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                        this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
                    }
                    this._columnDropIndicator = null;

                    let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || '';
                    if (!draggedId) draggedId = this.draggedGroupId || '';
                    if (!draggedId) return;

                    try {
                        const { ProjectManager } = await import('../utils/projectManager');
                        const projectManager = ProjectManager.getInstance(this.plugin);
                        const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                        const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
                        if (draggedIndex === -1) return;

                        // 基于鼠标位置计算插入索引（忽略被拖拽列）
                        let columns = Array.from(kanbanContainer.querySelectorAll('.kanban-column')) as HTMLElement[];
                        columns = columns.filter(c => !!c.dataset.groupId);
                        // 排除被拖拽的列 DOM
                        const columnsFiltered = columns.filter(c => (c.dataset.groupId || '') !== draggedId);

                        const clientX = (e as DragEvent).clientX;
                        let insertIndex = columnsFiltered.length; // 默认末尾
                        for (let i = 0; i < columnsFiltered.length; i++) {
                            const rect = columnsFiltered[i].getBoundingClientRect();
                            const midpoint = rect.left + rect.width / 2;
                            if (clientX < midpoint) { insertIndex = i; break; }
                        }

                        // 从原数组移除并插入到目标位置
                        const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                        currentGroups.splice(insertIndex, 0, draggedGroup);

                        // 重新分配排序值并保存
                        currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                        await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                        // 刷新看板（使用防抖队列以避免滚动位置被重置）
                        this.queueLoadTasks();
                        showMessage('分组顺序已更新');
                    } catch (error) {
                        console.error('更新自定义分组顺序失败:', error);
                        showMessage('更新分组顺序失败');
                    }
                });
            }
        } catch (err) {
            // ignore
        }
    }

    private async renderStatusKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        // 确保状态列存在，如果不存在才创建
        this.ensureStatusColumnsExist(kanbanContainer);

        // 按任务状态分组
        const doingTasks = this.tasks.filter(task => task.status === 'doing');
        const shortTermTasks = this.tasks.filter(task => task.status === 'short_term');
        const longTermTasks = this.tasks.filter(task => task.status === 'long_term');
        const doneTasks = this.tasks.filter(task => task.status === 'done');

        // 渲染带分组的任务（在稳定的子分组容器内）
        await this.renderStatusColumnWithStableGroups('doing', doingTasks);
        await this.renderStatusColumnWithStableGroups('short_term', shortTermTasks);
        await this.renderStatusColumnWithStableGroups('long_term', longTermTasks);

        if (this.showDone) {
            const sortedDoneTasks = this.sortDoneTasks(doneTasks);
            await this.renderStatusColumnWithStableGroups('done', sortedDoneTasks);
            this.showColumn('done');
        } else {
            this.hideColumn('done');
        }
    }

    private ensureStatusColumnsExist(kanbanContainer: HTMLElement) {
        // 检查并创建必要的状态列
        const columns = [
            { id: 'doing', title: t('doing'), color: '#f39c12' },
            { id: 'short_term', title: t('shortTerm'), color: '#3498db' },
            { id: 'long_term', title: t('longTerm'), color: '#9b59b6' },
            { id: 'done', title: t('done'), color: '#27ae60' }
        ];

        columns.forEach(({ id, title, color }) => {
            let column = kanbanContainer.querySelector(`.kanban-column-${id}`) as HTMLElement;
            if (!column) {
                column = this.createKanbanColumn(kanbanContainer, id, title, color);
            }
            // 确保列有稳定的子分组容器结构
            this.ensureColumnHasStableGroups(column, id);
        });
    }

    private ensureColumnHasStableGroups(column: HTMLElement, status: string) {
        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        if (!content) return;

        // 检查是否已有稳定的分组容器
        let groupsContainer = content.querySelector('.status-column-stable-groups') as HTMLElement;
        if (!groupsContainer) {
            // 创建稳定的分组容器
            groupsContainer = document.createElement('div');
            groupsContainer.className = 'status-column-stable-groups';
            groupsContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 16px;
            `;

            // 根据状态列类型创建相应的子分组
            const groupConfigs = this.getGroupConfigsForStatus(status);

            groupConfigs.forEach(config => {
                const groupContainer = this.createStableStatusGroup(config);
                groupsContainer.appendChild(groupContainer);
            });

            // 清空内容并添加分组容器
            content.innerHTML = '';
            content.appendChild(groupsContainer);
        }
    }

    private getGroupConfigsForStatus(status: string): Array<{ status: string, label: string, icon: string }> {
        // 为不同的状态列定义子分组配置
        const configs = {
            'doing': [
                { status: 'doing', label: '进行中', icon: '⏳' }
            ],
            'short_term': [
                { status: 'short_term', label: '短期', icon: '📋' }
            ],
            'long_term': [
                { status: 'long_term', label: '长期', icon: '🤔' }
            ],
            'done': [
                { status: 'done', label: '已完成', icon: '✅' }
            ]
        };

        return configs[status] || [];
    }

    private createStableStatusGroup(config: { status: string, label: string, icon: string }): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = `status-stable-group status-stable-${config.status}`;
        groupContainer.dataset.status = config.status;

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'status-stable-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px;
            padding-top: 8px;
            min-height: 20px;
        `;

        // 为非已完成分组添加拖放事件
        if (config.status !== 'done') {
            this.addStatusSubGroupDropEvents(groupTasksContainer, config.status);
        }

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private async renderStatusColumnWithStableGroups(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 获取稳定的分组容器
        const groupsContainer = content.querySelector('.status-column-stable-groups') as HTMLElement;
        if (!groupsContainer) return;

        // 获取项目自定义分组
        // 注意：这里我们简化处理，如果有自定义分组，则按分组渲染；否则直接在状态子分组中渲染任务
        // 为了保持向后兼容，我们仍然支持自定义分组的显示逻辑

        // 检查是否有自定义分组
        const hasCustomGroups = await this.hasProjectCustomGroups();

        if (hasCustomGroups) {
            // 如果有自定义分组，使用原有的分组渲染逻辑
            this.renderTasksGroupedByCustomGroupInStableContainer(groupsContainer, tasks, status);
        } else {
            // 如果没有自定义分组，直接在状态子分组中渲染任务
            this.renderTasksInStableStatusGroups(groupsContainer, tasks, status);
        }

        // 更新列顶部计数
        if (count) {
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            count.textContent = topLevelTasks.length.toString();
        }
    }

    private async hasProjectCustomGroups(): Promise<boolean> {
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);
            return projectGroups.length > 0;
        } catch (error) {
            console.error('检查项目分组失败:', error);
            return false;
        }
    }

    private renderTasksInStableStatusGroups(groupsContainer: HTMLElement, tasks: any[], status: string) {
        // 获取对应的状态分组容器
        const groupContainer = groupsContainer.querySelector(`.status-stable-group[data-status="${status}"]`) as HTMLElement;
        if (!groupContainer) return;

        const groupTasksContainer = groupContainer.querySelector('.status-stable-group-tasks') as HTMLElement;
        const taskCount = groupContainer.querySelector('.status-stable-group-count') as HTMLElement;

        // 清空任务容器并重新渲染任务
        groupTasksContainer.innerHTML = '';
        this.renderTasksInColumn(groupTasksContainer, tasks);

        // 更新分组任务计数
        if (taskCount) {
            const taskMap = new Map(tasks.map(t => [t.id, t]));
            const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
            taskCount.textContent = topLevelTasks.length.toString();
        }
    }

    private async renderTasksGroupedByCustomGroupInStableContainer(groupsContainer: HTMLElement, tasks: any[], status: string) {
        // 获取项目自定义分组
        const { ProjectManager } = await import('../utils/projectManager');
        const projectManager = ProjectManager.getInstance(this.plugin);
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

        // 获取对应的状态分组容器
        const groupContainer = groupsContainer.querySelector(`.status-stable-group[data-status="${status}"]`) as HTMLElement;
        if (!groupContainer) return;

        const groupTasksContainer = groupContainer.querySelector('.status-stable-group-tasks') as HTMLElement;
        const taskCount = groupContainer.querySelector('.status-stable-group-count') as HTMLElement;

        // 在状态分组容器内渲染自定义分组
        groupTasksContainer.innerHTML = '';

        if (projectGroups.length === 0) {
            // 如果没有自定义分组，直接渲染任务
            this.renderTasksInColumn(groupTasksContainer, tasks);
        } else {
            // 按自定义分组渲染任务组
            const groupsSubContainer = document.createElement('div');
            groupsSubContainer.className = 'status-column-groups-in-stable';
            groupsSubContainer.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 12px;
            `;

            // 为每个自定义分组创建子容器
            projectGroups.forEach((group: any) => {
                const groupTasks = tasks.filter(task => task.customGroupId === group.id);
                if (groupTasks.length > 0) {
                    const groupSubContainer = this.createCustomGroupInStatusColumn(group, groupTasks);
                    groupsSubContainer.appendChild(groupSubContainer);
                }
            });

            // 添加未分组任务
            const ungroupedTasks = tasks.filter(task => !task.customGroupId);
            if (ungroupedTasks.length > 0) {
                const ungroupedGroup = {
                    id: 'ungrouped',
                    name: '未分组',
                    color: '#95a5a6',
                    icon: '📋'
                };
                const ungroupedContainer = this.createCustomGroupInStatusColumn(ungroupedGroup, ungroupedTasks);
                groupsSubContainer.appendChild(ungroupedContainer);
            }

            groupTasksContainer.appendChild(groupsSubContainer);
        }

        // 更新分组任务计数
        if (taskCount) {
            taskCount.textContent = tasks.length.toString();
        }
    }


    private renderEmptyCustomGroupKanban() {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return;

        kanbanContainer.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 300px;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
            ">
                <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
                <div style="font-size: 16px; margin-bottom: 8px;">暂无自定义分组</div>
                <div style="font-size: 14px;">请在项目设置中添加自定义分组</div>
            </div>
        `;
    }

    private renderColumn(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        let count = column.querySelector('.kanban-column-count') as HTMLElement;

        // 确保 header 上存在右侧容器（计数 + 新建按钮），如果列是旧的没有该按钮，则创建它
        const header = column.querySelector('.kanban-column-header') as HTMLElement;
        if (header) {
            let headerRight = header.querySelector('.custom-header-right') as HTMLElement | null;
            if (!headerRight) {
                // 如果 count 元素不存在（可能是旧列），尝试创建新的 count
                if (!count) {
                    count = document.createElement('span');
                    count.className = 'kanban-column-count';

                    // 尝试从标题获取颜色作为计数背景色
                    const titleEl = header.querySelector('h3') as HTMLElement | null;
                    const titleColor = titleEl?.style?.color || 'var(--b3-theme-primary)';

                    count.style.cssText = `
                        background: ${titleColor};
                        color: white;
                        border-radius: 12px;
                        padding: 2px 8px;
                        font-size: 12px;
                        font-weight: 500;
                        min-width: 20px;
                        text-align: center;
                    `;
                }

                headerRight = document.createElement('div');
                headerRight.className = 'custom-header-right';
                headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
                headerRight.appendChild(count);

                // 不在已完成列显示新建按钮
                if (status !== 'done') {
                    const addGroupTaskBtn = document.createElement('button');
                    addGroupTaskBtn.className = 'b3-button b3-button--small b3-button--primary';
                    addGroupTaskBtn.style.cssText = 'margin-left:8px;';
                    addGroupTaskBtn.title = t('newTask');
                    addGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
                    addGroupTaskBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // 将列的 status 映射为默认 termType 并传入创建对话框
                        let term: 'short_term' | 'long_term' | 'doing' | 'todo' = 'short_term';
                        if (status === 'doing') term = 'doing';
                        else if (status === 'short_term') term = 'short_term';
                        else if (status === 'long_term') term = 'long_term';
                        this.showCreateTaskDialog(undefined, undefined, term);
                    });

                    headerRight.appendChild(addGroupTaskBtn);
                }
                header.appendChild(headerRight);
            }
        }

        content.innerHTML = '';

        // 为了确保父任务下显示所有后代（包括已完成的子任务），扩展传入的任务列表
        const expandedTasks = this.augmentTasksWithDescendants(tasks);
        const taskMap = new Map(expandedTasks.map(t => [t.id, t]));
        const topLevelTasks = expandedTasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = expandedTasks.filter(t => t.parentId && taskMap.has(t.parentId));

        // 分页计算
        const totalTop = topLevelTasks.length;
        const totalPages = Math.max(1, Math.ceil(totalTop / this.pageSize));
        const currentPage = Math.min(Math.max(1, this.pageIndexMap[status] || 1), totalPages);

        const startIdx = (currentPage - 1) * this.pageSize;
        const endIdx = startIdx + this.pageSize;
        const pagedTopLevel = topLevelTasks.slice(startIdx, endIdx);

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        pagedTopLevel.forEach(task => renderTaskWithChildren(task, 0));

        // 更新列顶部计数为仅统计顶层任务数量
        if (count) {
            count.textContent = totalTop.toString();
        }

        // 渲染分页控件：仅在顶层任务数量超过 pageSize 时显示分页
        const pagination = column.querySelector('.kanban-column-pagination') as HTMLElement;
        if (pagination) {
            // 如果不需要分页，则隐藏分页容器
            if (totalTop <= this.pageSize) {
                pagination.innerHTML = '';
                pagination.style.display = 'none';
            } else {
                pagination.style.display = 'flex';
                pagination.innerHTML = '';

                // 上一页按钮
                const prevBtn = document.createElement('button');
                prevBtn.className = 'b3-button b3-button--text';
                prevBtn.textContent = '上一页';
                prevBtn.disabled = currentPage <= 1;
                prevBtn.addEventListener('click', () => {
                    this.pageIndexMap[status] = Math.max(1, currentPage - 1);
                    this.queueLoadTasks();
                });
                pagination.appendChild(prevBtn);

                // 页码信息
                const pageInfo = document.createElement('div');
                pageInfo.style.cssText = 'min-width: 120px; text-align: center; font-size: 13px; color: var(--b3-theme-on-surface);';
                pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页（共 ${totalTop} 项）`;
                pagination.appendChild(pageInfo);

                // 下一页按钮
                const nextBtn = document.createElement('button');
                nextBtn.className = 'b3-button b3-button--text';
                nextBtn.textContent = '下一页';
                nextBtn.disabled = currentPage >= totalPages;
                nextBtn.addEventListener('click', () => {
                    this.pageIndexMap[status] = Math.min(totalPages, currentPage + 1);
                    this.queueLoadTasks();
                });
                pagination.appendChild(nextBtn);
            }
        }
    }

    private renderCustomGroupColumn(group: any, tasks: any[]) {
        const columnId = `custom-group-${group.id}`;
        let column = this.container.querySelector(`.kanban-column-${columnId}`) as HTMLElement;

        if (!column) {
            // 如果列不存在，创建新列
            column = this.createCustomGroupColumn(columnId, group);
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        content.innerHTML = '';

        // 扩展当前分组任务列表，包含所有后代任务（包括已完成子任务）
        const expandedTasks = this.augmentTasksWithDescendants(tasks, group.id);
        const taskMap = new Map(expandedTasks.map(t => [t.id, t]));
        const topLevelTasks = expandedTasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = expandedTasks.filter(t => t.parentId && taskMap.has(t.parentId));

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        topLevelTasks.forEach(task => renderTaskWithChildren(task, 0));

        // 更新列顶部计数 — 只统计顶层（父）任务，不包括子任务
        if (count) {
            const taskMapAll = new Map(expandedTasks.map((t: any) => [t.id, t]));
            const topLevelAll = expandedTasks.filter((t: any) => !t.parentId || !taskMapAll.has(t.parentId));
            count.textContent = topLevelAll.length.toString();
        }
    }

    private createCustomGroupColumn(columnId: string, group: any): HTMLElement {
        const kanbanContainer = this.container.querySelector('.project-kanban-container') as HTMLElement;
        if (!kanbanContainer) return document.createElement('div');

        const column = document.createElement('div');
        column.className = `kanban-column kanban-column-${columnId}`;
        column.dataset.groupId = group.id;

        // 列标题
        const header = document.createElement('div');
        header.className = 'kanban-column-header';
        header.style.cssText = `
            padding: 12px 16px;
            border-bottom: 1px solid var(--b3-theme-border);
            background: ${group.color}15;
            border-radius: 8px 8px 0 0;
            display: flex;
            align-items: center;
            justify-content: space-between;
        `;

        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
        `;

        const titleEl = document.createElement('h3');
        // 显示分组的 emoji（如果有），然后显示名称
        const groupIconEl = document.createElement('span');
        groupIconEl.className = 'custom-group-header-icon';
        groupIconEl.style.cssText = `margin-right:6px;`;
        groupIconEl.textContent = group.icon || '📋';
        titleContainer.appendChild(groupIconEl);

        titleEl.textContent = group.name;
        titleEl.style.cssText = `
            margin: 0;
            font-size: 16px;
            font-weight: 600;
            color: ${group.color};
        `;

        // 如果分组绑定了块ID，添加预览和跳转功能
        if (group.blockId) {
            titleEl.dataset.type = 'a';
            titleEl.dataset.href = `siyuan://blocks/${group.blockId}`;
            titleEl.style.cursor = 'pointer';
            titleEl.style.textDecoration = 'underline';
            titleEl.style.paddingBottom = '2px';
            titleEl.title = t('clickToJumpToBlock');
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openBlock(group.blockId);
            });
        }

        titleContainer.appendChild(titleEl);

        const countEl = document.createElement('span');
        countEl.className = 'kanban-column-count';
        countEl.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 12px;
            font-weight: 500;
            min-width: 20px;
            text-align: center;
        `;

        header.appendChild(titleContainer);

        // 新建任务按钮（对应该自定义分组）
        const addGroupTaskBtn = document.createElement('button');
        addGroupTaskBtn.className = 'b3-button b3-button--outline';
        addGroupTaskBtn.style.cssText = 'margin-left:8px;';
        addGroupTaskBtn.title = t('newTask');
        addGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>`;
        addGroupTaskBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gid = group.id === 'ungrouped' ? null : group.id;
            this.showCreateTaskDialog(undefined, gid);
        });

        // 粘贴新建任务按钮（对应该自定义分组）
        const pasteGroupTaskBtn = document.createElement('button');
        pasteGroupTaskBtn.className = 'b3-button b3-button--outline';
        pasteGroupTaskBtn.title = t('pasteNew');
        pasteGroupTaskBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#iconPaste"></use></svg>`;
        pasteGroupTaskBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gid = group.id === 'ungrouped' ? null : group.id;
            this.showPasteTaskDialog(undefined, gid);
        });

        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex; align-items:center; gap:8px;';
        headerRight.appendChild(countEl);
        headerRight.appendChild(addGroupTaskBtn);
        headerRight.appendChild(pasteGroupTaskBtn);

        header.appendChild(headerRight);

        // 使列头可以拖拽以调整分组顺序（直接在看板中拖动 header 调整顺序）
        header.draggable = true;
        header.dataset.groupId = group.id;

        header.addEventListener('dragstart', (e) => {
            this.draggedGroupId = group.id;
            column.style.opacity = '0.5';
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', group.id);
                }
            } catch (err) {
                // ignore
            }
        });

        header.addEventListener('dragend', () => {
            this.draggedGroupId = null;
            column.style.opacity = '';
            // 清除列插入指示器
            if (this._columnDropIndicator && this._columnDropIndicator.parentNode) {
                this._columnDropIndicator.parentNode.removeChild(this._columnDropIndicator);
            }
            this._columnDropIndicator = null;
        });

        // 列内容
        const content = document.createElement('div');
        content.className = 'kanban-column-content';
        content.style.cssText = `
            flex: 1;
            padding: 8px;
            overflow-y: auto;
            min-height: 200px;
        `;

        column.appendChild(header);
        column.appendChild(content);

        // 为自定义分组列添加拖拽事件（设置分组）
        // 如果是未分组列，传入 null 以表示移除分组目标
        const targetGroupId = group.id === 'ungrouped' ? null : group.id;
        this.addCustomGroupDropZoneEvents(content, targetGroupId);

        kanbanContainer.appendChild(column);
        return column;
    }

    private renderUngroupedColumn(tasks: any[]) {
        const ungroupedGroup = {
            id: 'ungrouped',
            name: '未分组',
            color: '#95a5a6',
            icon: '📋'
        };
        this.renderCustomGroupColumn(ungroupedGroup, tasks);
    }

    private renderCustomGroupColumnWithFourStatus(group: any, doingTasks: any[], shortTermTasks: any[], longTermTasks: any[], completedTasks: any[]) {
        const columnId = `custom-group-${group.id}`;
        let column = this.container.querySelector(`.kanban-column-${columnId}`) as HTMLElement;

        if (!column) {
            // 如果列不存在，创建新列
            column = this.createCustomGroupColumn(columnId, group);
        }

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        content.innerHTML = '';

        // 创建分组容器（参考状态分组样式）
        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'custom-group-status-container';
        groupsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 16px;
        `;

        // 进行中任务分组（总是显示，即使没有任务）
        const expandedDoingTasks = this.augmentTasksWithDescendants(doingTasks, group.id);
        const doingGroupContainer = this.createStatusGroupInCustomColumn(
            group,
            expandedDoingTasks,
            'doing',
            '进行中'
        );
        groupsContainer.appendChild(doingGroupContainer);

        // 短期任务分组（总是显示，即使没有任务）
        const expandedShortTermTasks = this.augmentTasksWithDescendants(shortTermTasks, group.id);
        const shortTermGroupContainer = this.createStatusGroupInCustomColumn(
            group,
            expandedShortTermTasks,
            'short_term',
            '短期'
        );
        groupsContainer.appendChild(shortTermGroupContainer);

        // 长期任务分组（总是显示，即使没有任务）
        const expandedLongTermTasks = this.augmentTasksWithDescendants(longTermTasks, group.id);
        const longTermGroupContainer = this.createStatusGroupInCustomColumn(
            group,
            expandedLongTermTasks,
            'long_term',
            '长期'
        );
        groupsContainer.appendChild(longTermGroupContainer);

        // 已完成任务分组（总是显示，即使没有任务）
        // 已完成分组中默认显示该分组下独立的已完成任务，
        // 但如果某个已完成任务已经作为子任务显示在其他分组（非已完成的父任务下），则不重复显示
        const nonCompletedIncludedIds = new Set<string>();
        [...expandedDoingTasks, ...expandedShortTermTasks, ...expandedLongTermTasks].forEach(t => nonCompletedIncludedIds.add(t.id));
        const filteredCompletedTasks = completedTasks.filter(t => !nonCompletedIncludedIds.has(t.id));

        const completedGroupContainer = this.createStatusGroupInCustomColumn(
            group,
            filteredCompletedTasks,
            'completed',
            '已完成'
        );
        groupsContainer.appendChild(completedGroupContainer);

        content.appendChild(groupsContainer);

        // 更新列顶部计数 — 只统计顶层（父）任务，不包括子任务
        if (count) {
            const combined = [...expandedDoingTasks, ...expandedShortTermTasks, ...expandedLongTermTasks, ...filteredCompletedTasks];
            const mapCombined = new Map(combined.map((t: any) => [t.id, t]));
            const topLevelCombined = combined.filter((t: any) => !t.parentId || !mapCombined.has(t.parentId));
            count.textContent = topLevelCombined.length.toString();
        }
    }

    private createStatusGroupInCustomColumn(group: any, tasks: any[], status: 'completed' | 'incomplete' | 'doing' | 'short_term' | 'long_term', statusLabel: string): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = `custom-status-group custom-status-${status}`;
        groupContainer.dataset.groupId = group.id;
        groupContainer.dataset.status = status;

        // 分组标题（参考状态分组下的自定义分组样式）
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-status-group-header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: ${group.color}15;
            border: 1px solid ${group.color}30;
            border-radius: 6px;
            cursor: pointer;
        `;

        const groupTitle = document.createElement('div');
        groupTitle.className = 'custom-status-group-title';
        groupTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: ${group.color};
            font-size: 13px;
        `;

        const groupIcon = document.createElement('span');
        // 对于自定义分组下的四个子分组，使用不同的固定图标
        const statusIcons = {
            'doing': '⏳',
            'short_term': '📋',
            'long_term': '🤔',
            'completed': '✅',
            'incomplete': '🗓'
        };
        groupIcon.textContent = statusIcons[status] || '📋';
        groupTitle.appendChild(groupIcon);

        const groupName = document.createElement('span');
        groupName.textContent = statusLabel;
        groupTitle.appendChild(groupName);

        const taskCount = document.createElement('span');
        taskCount.className = 'custom-status-group-count';
        // 进行中、短期、长期、已完成分组都只显示顶层任务数量
        const taskMapLocal = new Map(tasks.map((t: any) => [t.id, t]));
        const topLevel = tasks.filter((t: any) => !t.parentId || !taskMapLocal.has(t.parentId));
        taskCount.textContent = topLevel.length.toString();
        taskCount.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: 500;
            min-width: 18px;
            text-align: center;
        `;

        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(taskCount);

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'custom-status-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px;
            padding-top: 8px; /* 添加一点顶部间距 */
            min-height: 20px; /* 确保即使没有任务也有拖放区域 */
        `;

        // **[核心修改]** 为非“已完成”的子分组添加拖放事件处理器
        if (status !== 'completed') {
            this.addStatusSubGroupDropEvents(groupTasksContainer, status);
        }


        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'b3-button b3-button--text custom-status-group-collapse-btn';
        collapseBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>';
        collapseBtn.title = '折叠分组';
        collapseBtn.style.cssText = `
            padding: 2px;
            min-width: auto;
            margin-right: 4px;
        `;

        const groupKey = `${group.id}-${status}`;
        // 检查是否已有保存的折叠状态，如果没有则默认为已完成状态折叠
        let isCollapsed = this.collapsedStatusGroups.has(groupKey);
        if (!this.collapsedStatusGroups.has(groupKey)) {
            // 只有在第一次创建时才设置默认状态
            isCollapsed = status === 'completed';
            if (isCollapsed) {
                this.collapsedStatusGroups.add(groupKey);
            }
        }

        // 设置初始显示状态
        groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
        collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
        collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';

            // 更新持久化状态
            if (isCollapsed) {
                this.collapsedStatusGroups.add(groupKey);
            } else {
                this.collapsedStatusGroups.delete(groupKey);
            }
        });

        groupTitle.insertBefore(collapseBtn, groupIcon);

        groupContainer.appendChild(groupHeader);

        // 渲染任务
        this.renderTasksInColumn(groupTasksContainer, tasks);

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private async renderStatusColumnWithGroups(status: string, tasks: any[]) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (!column) return;

        const content = column.querySelector('.kanban-column-content') as HTMLElement;
        const count = column.querySelector('.kanban-column-count') as HTMLElement;

        content.innerHTML = '';

        // 获取项目自定义分组
        const { ProjectManager } = await import('../utils/projectManager');
        const projectManager = ProjectManager.getInstance(this.plugin);
        const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

        if (projectGroups.length === 0) {
            // 如果没有自定义分组，直接渲染任务
            this.renderTasksInColumn(content, tasks);
        } else {
            // 按自定义分组渲染任务组
            this.renderTasksGroupedByCustomGroup(content, tasks, projectGroups);
        }

        // 更新列顶部计数
        if (count) {
            count.textContent = tasks.length.toString();
        }
    }

    private renderTasksInColumn(content: HTMLElement, tasks: any[]) {
        const taskMap = new Map(tasks.map(t => [t.id, t]));
        const topLevelTasks = tasks.filter(t => !t.parentId || !taskMap.has(t.parentId));
        const childTasks = tasks.filter(t => t.parentId && taskMap.has(t.parentId));

        const renderTaskWithChildren = (task: any, level: number) => {
            const taskEl = this.createTaskElement(task, level);
            content.appendChild(taskEl);

            const children = childTasks.filter(t => t.parentId === task.id);
            const isCollapsed = this.collapsedTasks.has(task.id);

            if (children.length > 0 && !isCollapsed) {
                children.forEach(child => renderTaskWithChildren(child, level + 1));
            }
        };

        topLevelTasks.forEach(task => renderTaskWithChildren(task, 0));
    }

    private async renderTasksGroupedByCustomGroup(content: HTMLElement, tasks: any[], projectGroups: any[]) {
        // 创建分组容器
        const groupsContainer = document.createElement('div');
        groupsContainer.className = 'status-column-groups';
        groupsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 12px;
        `;

        // 为每个自定义分组创建子容器
        projectGroups.forEach((group: any) => {
            const groupTasks = tasks.filter(task => task.customGroupId === group.id);
            if (groupTasks.length > 0) {
                const groupContainer = this.createCustomGroupInStatusColumn(group, groupTasks);
                groupsContainer.appendChild(groupContainer);
            }
        });

        // 添加未分组任务
        const ungroupedTasks = tasks.filter(task => !task.customGroupId);
        if (ungroupedTasks.length > 0) {
            const ungroupedGroup = {
                id: 'ungrouped',
                name: '未分组',
                color: '#95a5a6',
                icon: '📋'
            };
            const ungroupedContainer = this.createCustomGroupInStatusColumn(ungroupedGroup, ungroupedTasks);
            groupsContainer.appendChild(ungroupedContainer);
        }

        content.appendChild(groupsContainer);
    }

    private createCustomGroupInStatusColumn(group: any, tasks: any[]): HTMLElement {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'custom-group-in-status';
        groupContainer.dataset.groupId = group.id;

        // 分组标题
        const groupHeader = document.createElement('div');
        groupHeader.className = 'custom-group-header';
        groupHeader.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            background: ${group.color}15;
            border: 1px solid ${group.color}30;
            border-radius: 6px;
            cursor: pointer;
        `;

        const groupTitle = document.createElement('div');
        groupTitle.className = 'custom-group-title';
        groupTitle.style.cssText = `
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            color: ${group.color};
            font-size: 13px;
        `;

        const groupIcon = document.createElement('span');
        groupIcon.textContent = group.icon || '📋';
        groupTitle.appendChild(groupIcon);

        const groupName = document.createElement('span');
        groupName.textContent = group.name;
        groupTitle.appendChild(groupName);

        const taskCount = document.createElement('span');
        taskCount.className = 'custom-group-count';
        // 在状态列中，分组徽章：只统计顶层任务数量（子任务不计入）
        // 扩展 tasks 以包含后代任务，确保已完成子任务也能显示
        const expandedTasks = this.augmentTasksWithDescendants(tasks, group.id);
        const taskMapLocal = new Map(expandedTasks.map((t: any) => [t.id, t]));
        const topLevel = expandedTasks.filter((t: any) => !t.parentId || !taskMapLocal.has(t.parentId));
        taskCount.textContent = topLevel.length.toString();
        taskCount.style.cssText = `
            background: ${group.color};
            color: white;
            border-radius: 10px;
            padding: 2px 6px;
            font-size: 11px;
            font-weight: 500;
            min-width: 18px;
            text-align: center;
        `;

        groupHeader.appendChild(groupTitle);
        groupHeader.appendChild(taskCount);

        // 分组任务容器
        const groupTasksContainer = document.createElement('div');
        groupTasksContainer.className = 'custom-group-tasks';
        groupTasksContainer.style.cssText = `
            padding-left: 8px;
        `;

        // 折叠按钮
        const collapseBtn = document.createElement('button');
        collapseBtn.className = 'b3-button b3-button--text custom-group-collapse-btn';
        collapseBtn.innerHTML = '<svg class="b3-button__icon"><use xlink:href="#iconDown"></use></svg>';
        collapseBtn.title = '折叠分组';
        collapseBtn.style.cssText = `
            padding: 2px;
            min-width: auto;
            margin-right: 4px;
        `;

        let isCollapsed = false;
        collapseBtn.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            groupTasksContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? '展开分组' : '折叠分组';
        });

        groupTitle.insertBefore(collapseBtn, groupIcon);

        groupContainer.appendChild(groupHeader);

        // 渲染任务（使用扩展后的任务列表）
        this.renderTasksInColumn(groupTasksContainer, expandedTasks);

        groupContainer.appendChild(groupTasksContainer);

        return groupContainer;
    }

    private showColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'flex';
        }
    }

    private hideColumn(status: string) {
        const column = this.container.querySelector(`.kanban-column-${status}`) as HTMLElement;
        if (column) {
            column.style.display = 'none';
        }
    }

    private createTaskElement(task: any, level: number = 0): HTMLElement {
        const taskEl = document.createElement('div');
        taskEl.className = 'kanban-task';
        if (level > 0) {
            taskEl.classList.add('is-subtask');
        }
        taskEl.draggable = true;
        taskEl.dataset.taskId = task.id;

        const priority = task.priority || 'none';

        // 存储任务数据到元素
        taskEl.dataset.priority = priority;

        // 添加优先级样式类
        if (priority !== 'none') {
            taskEl.classList.add(`kanban-task-priority-${priority}`);
        }

        // 设置任务颜色（根据优先级）
        let backgroundColor = '';
        let borderColor = '';
        switch (task.priority) {
            case 'high':
                backgroundColor = 'var(--b3-card-error-background)';
                borderColor = 'var(--b3-card-error-color)';
                break;
            case 'medium':
                backgroundColor = 'var(--b3-card-warning-background)';
                borderColor = 'var(--b3-card-warning-color)';
                break;
            case 'low':
                backgroundColor = 'var(--b3-card-info-background)';
                borderColor = 'var(--b3-card-info-color)';
                break;
            default:
                backgroundColor = 'var(--b3-theme-surface-lighter)';
                borderColor = 'var(--b3-theme-background-light)';
        }

        // 设置任务元素的背景色和边框
        taskEl.style.cssText = `
            cursor: grab;
            transition: all 0.2s ease;
            position: relative;
            background-color: ${backgroundColor};
            border: 1.5px solid ${borderColor};
        `;

        if (task.completed) {
            taskEl.style.opacity = '0.5';
        }

        if (level > 0) {
            taskEl.style.marginLeft = `${level * 20}px`;
        }

        const taskMainContainer = document.createElement('div');
        taskMainContainer.className = 'kanban-task-main';
        taskMainContainer.style.cssText = `
            display: flex;
            gap: 8px;
            align-items: flex-start;
        `;

        const taskIndentContainer = document.createElement('div');
        taskIndentContainer.className = 'kanban-task-indent';
        taskIndentContainer.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            width: 0px; /* 固定宽度以便对齐 */
            flex-shrink: 0;
        `;

        // 折叠按钮
        const childTasks = this.tasks.filter(t => t.parentId === task.id);
        if (childTasks.length > 0) {
            const isCollapsed = this.collapsedTasks.has(task.id);
            const collapseBtn = document.createElement('button');
            collapseBtn.className = 'b3-button b3-button--text kanban-task-collapse-btn';
            collapseBtn.innerHTML = `<svg class="b3-button__icon"><use xlink:href="#icon${isCollapsed ? 'Right' : 'Down'}"></use></svg>`;
            collapseBtn.title = isCollapsed ? t('expandSubtasks') : t('collapseSubtasks');
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isCollapsed) {
                    this.collapsedTasks.delete(task.id);
                } else {
                    this.collapsedTasks.add(task.id);
                }
                this.renderKanban();
            });
            taskIndentContainer.appendChild(collapseBtn);
        }

        taskMainContainer.appendChild(taskIndentContainer);

        // 复选框
        const checkboxEl = document.createElement('input');
        checkboxEl.type = 'checkbox';
        checkboxEl.className = 'kanban-task-checkbox';
        checkboxEl.checked = task.completed;
        checkboxEl.title = '点击完成/取消完成任务';
        checkboxEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const completed = checkboxEl.checked;
            this.toggleTaskCompletion(task, completed);
        });
        taskMainContainer.appendChild(checkboxEl);

        const taskContentContainer = document.createElement('div');
        taskContentContainer.className = 'kanban-task-content';
        taskContentContainer.style.flex = '1';

        // 任务标题
        const titleEl = document.createElement('div');
        titleEl.className = 'kanban-task-title';

        if (task.blockId || task.docId) {
            // 如果有绑定块，标题显示为可点击的超链接
            const targetId = task.blockId || task.docId;
            titleEl.setAttribute('data-type', 'a');
            titleEl.setAttribute('data-href', `siyuan://blocks/${targetId}`);
            titleEl.style.cssText = `
                font-weight: 500;
                color: var(--b3-theme-primary);
                line-height: 1.4;
                cursor: pointer;
                text-decoration: underline;
                text-decoration-style: dotted;
                transition: color 0.2s ease;
                width: fit-content;
            `;

            // 点击事件：打开块
            titleEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.openBlockTab(targetId);
            });

            // 鼠标悬停效果
            titleEl.addEventListener('mouseenter', () => {
                titleEl.style.color = 'var(--b3-theme-primary-light)';
            });
            titleEl.addEventListener('mouseleave', () => {
                titleEl.style.color = 'var(--b3-theme-primary)';
            });
        } else {
            // 没有绑定块，普通标题样式
            titleEl.style.cssText = `
                font-weight: 500;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
                width: fit-content;
            `;
        }

        titleEl.textContent = task.title || t('noContentHint');
        titleEl.title = (task.blockId || task.docId) ? t('clickToOpenBoundBlock', { title: task.title || t('noContentHint') }) : (task.title || t('noContentHint'));

        // 如果有子任务，添加数量指示器
        if (childTasks.length > 0) {
            const subtaskIndicator = document.createElement('span');
            subtaskIndicator.className = 'subtask-indicator';
            subtaskIndicator.textContent = ` (${childTasks.length})`;
            subtaskIndicator.title = t('containsNSubtasks', { count: String(childTasks.length) });
            subtaskIndicator.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            `;
            titleEl.appendChild(subtaskIndicator);
        }

        // 创建标题和链接的容器
        const titleContainer = document.createElement('div');
        titleContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-bottom: 8px;';
        titleContainer.appendChild(titleEl);

        // 添加URL链接图标作为兄弟节点
        if (task.url) {
            const urlIcon = document.createElement('a');
            urlIcon.className = 'kanban-task-url-icon';
            urlIcon.href = task.url;
            urlIcon.target = '_blank';
            urlIcon.title = t("openUrl") + ': ' + task.url;
            urlIcon.innerHTML = '<svg style="width: 14px; height: 14px;"><use xlink:href="#iconLink"></use></svg>';
            urlIcon.style.cssText = 'color: var(--b3-theme-primary); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; flex-shrink: 0;';
            urlIcon.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            titleContainer.appendChild(urlIcon);
        }

        taskContentContainer.appendChild(titleContainer);

        // 任务信息容器
        const infoEl = document.createElement('div');
        infoEl.className = 'kanban-task-info';
        infoEl.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 4px;
        `;

        if (task.completed && task.completedTime) {
            const completedTimeEl = document.createElement('div');
            completedTimeEl.className = 'kanban-task-completed-time';
            completedTimeEl.innerHTML = `<span>✅</span><span>完成于: ${getLocalDateTimeString(new Date(task.completedTime))}</span>`;
            completedTimeEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            `;
            infoEl.appendChild(completedTimeEl);
        }

        // 日期时间
        const hasDate = task.date || task.endDate;
        if (hasDate && !task.completed) {
            const dateEl = document.createElement('div');
            dateEl.className = 'kanban-task-date';
            dateEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
                flex-wrap: wrap;
            `;

            // 添加周期图标（如果是周期事件或周期实例）
            if (task.repeat?.enabled || task.isRepeatInstance) {
                const repeatIcon = document.createElement('span');
                repeatIcon.textContent = '🔄';
                repeatIcon.title = task.repeat?.enabled ? getRepeatDescription(task.repeat) : '周期事件实例';
                repeatIcon.style.cssText = 'cursor: help;';
                dateEl.appendChild(repeatIcon);
            }

            const dateText = this.formatTaskDate(task);
            let dateHtml = `<span>📅${dateText}</span>`;

            // 添加倒计时显示
            if (!task.completed) {
                const countdownInfo = this.getTaskCountdownInfo(task);
                if (countdownInfo.type !== 'none' && countdownInfo.days >= 0) {
                    let urgencyClass = 'countdown-normal';
                    if (countdownInfo.days <= 1) {
                        urgencyClass = 'countdown-urgent';
                    } else if (countdownInfo.days <= 3) {
                        urgencyClass = 'countdown-warning';
                    }

                    dateHtml += `<span class="countdown-badge ${urgencyClass}">${countdownInfo.text}</span>`;
                }
            }

            // 如果存在自定义提醒时间，按规则显示：
            // - 如果 custom 包含日期部分，则以该日期为准；否则以 task.date（或今天）为准
            // - 如果目标日期 < 今天（过去），则不显示 customReminderTime
            // - 如果目标日期 > 今天（未来），则显示日期+时间
            // - 如果目标日期 == 今天，则仅显示时间
            try {
                const customRaw = task.customReminderTime;
                if (customRaw) {
                    let s = String(customRaw).trim();
                    let datePart: string | null = null;
                    let timePart: string | null = null;

                    if (s.includes('T')) {
                        const parts = s.split('T');
                        datePart = parts[0];
                        timePart = parts[1] || null;
                    } else if (s.includes(' ')) {
                        const parts = s.split(' ');
                        // 支持两种： "YYYY-MM-DD HH:MM" 或 "HH:MM extra"
                        if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
                            datePart = parts[0];
                            timePart = parts.slice(1).join(' ') || null;
                        } else {
                            timePart = parts.slice(-1)[0] || null;
                        }
                    } else if (/^\d{2}:\d{2}$/.test(s)) {
                        timePart = s;
                    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                        datePart = s;
                    } else {
                        // 兜底把整个字符串当时间处理
                        timePart = s;
                    }

                    const today = getLogicalDateString();
                    const effectiveDate = datePart || task.date || today;

                    // 比较日期（格式 YYYY-MM-DD 可直接字符串比较）
                    if (effectiveDate) {
                        if (effectiveDate < today) {
                            // 过去：不显示 custom 时间
                        } else if (effectiveDate === today) {
                            if (timePart) {
                                const showTime = timePart.substring(0, 5);
                                dateHtml += `<span> ⏰${showTime}</span>`;
                            }
                        } else {
                            // 未来：显示日期 + 时间（如果有）
                            const showDate = effectiveDate;
                            const showTime = timePart ? ` ${timePart.substring(0, 5)}` : '';
                            dateHtml += `<span> ⏰${showDate}${showTime}</span>`;
                        }
                    }
                }
            } catch (e) {
                console.warn('格式化 customReminderTime 失败', e);
            }

            dateEl.innerHTML += dateHtml;
            infoEl.appendChild(dateEl);
        }

        // 优先级
        if (priority !== 'none') {
            const priorityEl = document.createElement('div');
            priorityEl.className = `kanban-task-priority priority-label-${priority}`;

            const priorityNames = {
                'high': '高优先级',
                'medium': '中优先级',
                'low': '低优先级'
            };

            priorityEl.innerHTML = `<span class="priority-dot ${priority}"></span><span>${priorityNames[priority]}</span>`;
            infoEl.appendChild(priorityEl);
        }

        // 分类
        if (task.categoryId) {
            const category = this.categoryManager.getCategoryById(task.categoryId);
            if (category) {
                const categoryEl = document.createElement('div');
                categoryEl.className = 'kanban-task-category';
                categoryEl.style.cssText = `
                    display: inline-flex;
                    align-items: center;
                    gap: 4px;
                    padding: 2px 6px;
                    background-color: ${category.color};
                    border-radius: 4px;
                    font-size: 11px;
                    color: white;
                    font-weight: 500;
                    align-self: flex-start;
                `;

                if (category.icon) {
                    categoryEl.innerHTML = `<span>${category.icon}</span><span>${category.name}</span>`;
                } else {
                    categoryEl.textContent = category.name;
                }
                infoEl.appendChild(categoryEl);
            }
        }

        // 备注
        if (task.note) {
            const noteEl = document.createElement('div');
            noteEl.className = 'kanban-task-note';
            noteEl.textContent = task.note;
            noteEl.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
            `;
            infoEl.appendChild(noteEl);
        }

        // 标签显示（使用标签ID）
        if (task.tagIds && task.tagIds.length > 0) {
            const tagsContainer = document.createElement('div');
            tagsContainer.className = 'kanban-task-tags';
            tagsContainer.style.cssText = `
                display: flex;
                flex-wrap: wrap;
                gap: 4px;
                margin-top: 4px;
            `;

            // 获取项目标签配置以获取颜色和名称
            (async () => {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const projectTags = await projectManager.getProjectTags(this.projectId);

                    // 创建标签ID到标签对象的映射
                    const tagMap = new Map(projectTags.map(t => [t.id, t]));

                    // 过滤出有效的标签ID
                    const validTagIds = task.tagIds.filter((tagId: string) => tagMap.has(tagId));

                    // 如果有无效标签，自动清理
                    if (validTagIds.length !== task.tagIds.length) {
                        const invalidCount = task.tagIds.length - validTagIds.length;
                        console.log(`任务 ${task.id} 有 ${invalidCount} 个无效标签，已自动清理`);

                        // 异步清理无效标签
                        (async () => {
                            try {
                                const reminderData = await readReminderData();
                                if (reminderData[task.id]) {
                                    reminderData[task.id].tagIds = validTagIds;
                                    await writeReminderData(reminderData);
                                }
                            } catch (error) {
                                console.error('清理无效标签失败:', error);
                            }
                        })();
                    }

                    // 显示有效标签
                    validTagIds.forEach((tagId: string) => {
                        const tag = tagMap.get(tagId);
                        if (tag) {
                            const tagEl = document.createElement('span');
                            tagEl.className = 'kanban-task-tag';
                            tagEl.style.cssText = `
                                display: inline-flex;
                                align-items: center;
                                padding: 2px 8px;
                                font-size: 11px;
                                border-radius: 12px;
                                background: ${tag.color}20;
                                border: 1px solid ${tag.color};
                                color: var(--b3-theme-on-surface);
                                font-weight: 500;
                            `;
                            tagEl.textContent = `#${tag.name}`;
                            tagEl.title = tag.name;
                            tagsContainer.appendChild(tagEl);
                        }
                    });
                } catch (error) {
                    console.error('加载标签失败:', error);
                }
            })();

            infoEl.appendChild(tagsContainer);
        }

        // 番茄钟数量 + 总专注时长
        if ((task.pomodoroCount && task.pomodoroCount > 0) || (typeof task.focusTime === 'number' && task.focusTime > 0)) {
            const pomodoroDisplay = document.createElement('div');
            pomodoroDisplay.className = 'kanban-task-pomodoro-count';
            pomodoroDisplay.style.cssText = `
                font-size: 12px;
                display: block;
                background: rgba(255, 99, 71, 0.1);
                color: rgb(255, 99, 71);
                padding: 4px 8px;
                border-radius: 4px;
                margin-top: 4px;
                width: fit-content;
            `;
            const tomatoEmojis = `🍅 ${task.pomodoroCount || 0}`;
            const focusMinutes = task.focusTime || 0;
            const formatMinutesToString = (minutes: number) => {
                const hours = Math.floor(minutes / 60);
                const mins = Math.floor(minutes % 60);
                return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
            };
            const focusText = focusMinutes > 0 ? ` ⏱ ${formatMinutesToString(focusMinutes)}` : '';
            const extraCount = '';

            pomodoroDisplay.innerHTML = `
                <span title="完成的番茄钟数量: ${task.pomodoroCount}">${tomatoEmojis}${extraCount}</span>
                <span title="总专注时长: ${focusMinutes} 分钟" style="margin-left:8px; opacity:0.9;">${focusText}</span>
            `;

            infoEl.appendChild(pomodoroDisplay);
        }

        taskContentContainer.appendChild(infoEl);
        taskMainContainer.appendChild(taskContentContainer);

        // 不再单独显示绑定块信息，因为已经集成到标题中

        taskEl.appendChild(taskMainContainer);

        // 如果为父任务，计算子任务完成进度并在底部显示进度条
        const directChildren = this.tasks.filter(t => t.parentId === task.id);
        if (directChildren.length > 0) {
            const completedCount = directChildren.filter(c => c.completed).length;
            const percent = Math.round((completedCount / directChildren.length) * 100);

            const progressContainer = document.createElement('div');
            progressContainer.className = 'kanban-task-progress-container';
            progressContainer.style.cssText = `
                margin-top: 8px;
                padding: 6px 0 0 0;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const progressBarWrap = document.createElement('div');
            progressBarWrap.className = 'kanban-task-progress-wrap';
            progressBarWrap.style.cssText = `
                flex: 1;
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            `;

            const progressBar = document.createElement('div');
            progressBar.className = 'kanban-task-progress-bar';
            progressBar.style.cssText = `
                width: ${percent}%;
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
            `;

            progressBarWrap.appendChild(progressBar);

            const percentLabel = document.createElement('div');
            percentLabel.className = 'kanban-task-progress-text';
            percentLabel.textContent = `${percent}%`;
            percentLabel.style.cssText = `
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.85;
                min-width: 34px;
                text-align: right;
            `;

            progressContainer.appendChild(progressBarWrap);
            progressContainer.appendChild(percentLabel);
            taskEl.appendChild(progressContainer);
        }

        // 添加拖拽事件（状态切换）
        this.addTaskDragEvents(taskEl, task);

        // 添加任务拖拽事件处理（排序和父子任务设置）
        taskEl.addEventListener('dragover', (e) => {
            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) return;

                const rect = taskEl.getBoundingClientRect();
                const mouseY = e.clientY;
                const taskTop = rect.top;
                const taskBottom = rect.bottom;
                const taskHeight = rect.height;

                // 定义区域：上边缘20%和下边缘20%用于排序，中间60%用于父子关系
                const sortZoneHeight = taskHeight * 0.2;
                const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;
                const isInParentChildZone = !isInTopSortZone && !isInBottomSortZone;

                // 排序检查 (支持现有同级排序和新的成为同级排序)
                const canSort = this.canDropForSort(this.draggedTask, targetTask);
                const canBecomeSibling = this.canBecomeSiblingOf(this.draggedTask, targetTask);
                const canSetParentChild = this.canSetAsParentChild(this.draggedTask, targetTask);

                // --- [新逻辑] ---
                // 检查是否允许改变状态
                let canChangeStatus = false;
                if (this.kanbanMode === 'custom') {
                    const targetSubGroup = taskEl.closest('.custom-status-group') as HTMLElement;
                    const targetStatus = targetSubGroup?.dataset.status;

                    if (targetStatus && targetStatus !== 'completed') {
                        const draggedStatus = this.getTaskStatus(this.draggedTask);
                        if (draggedStatus !== targetStatus) {
                            canChangeStatus = true;
                        }
                    }
                }
                // --- [新逻辑结束] ---

                if ((isInTopSortZone || isInBottomSortZone)) {
                    // 排序操作
                    // [修改]：如果可以排序、成为同级 或 改变状态，则允许放置
                    if (canSort || canBecomeSibling || canChangeStatus) {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        const position = isInTopSortZone ? 'top' : 'bottom';
                        this.updateIndicator('sort', taskEl, position, e);
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else if (isInParentChildZone) {
                    // 父子任务操作
                    // [修改]：如果可以设置父子 或 改变状态，则允许放置
                    if (canSetParentChild || canChangeStatus) {
                        e.preventDefault();
                        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                        this.updateIndicator('parentChild', taskEl, 'middle');
                    } else {
                        this.updateIndicator('none', null, null);
                    }
                } else {
                    // 清除所有指示器
                    this.updateIndicator('none', null, null);
                }
            }
        });

        taskEl.addEventListener('dragleave', (_e) => {
            // 检查是否真的离开了目标区域
            if (!taskEl.contains((_e as any).relatedTarget as Node)) {
                this.updateIndicator('none', null, null);
            }
        });

        taskEl.addEventListener('drop', (e) => {
            if (this.isDragging && this.draggedElement && this.draggedElement !== taskEl) {
                e.preventDefault();
                e.stopPropagation(); // 阻止事件冒泡到列的 drop 区域

                const targetTask = this.getTaskFromElement(taskEl);
                if (!targetTask) {
                    this.updateIndicator('none', null, null);
                    return;
                }

                // --- [新逻辑：优先检查状态变更和分组变更] ---
                let statusChanged = false;
                if (this.kanbanMode === 'custom') {
                    const targetSubGroup = taskEl.closest('.custom-status-group') as HTMLElement;
                    const targetStatus = targetSubGroup?.dataset.status;
                    // dataset.groupId 可能为 "ungrouped"（字符串），需要归一化为 null
                    const targetGroupRaw = targetSubGroup?.dataset.groupId;
                    const targetGroup = (targetGroupRaw === 'ungrouped') ? null : targetGroupRaw;

                    if (targetStatus && targetStatus !== 'completed') {
                        const draggedStatus = this.getTaskStatus(this.draggedTask);
                        // 归一化 draggedTask.customGroupId，针对字符串 'ungrouped' 视为 null
                        const draggedGroupRaw = this.draggedTask.customGroupId as any;
                        const draggedGroup = (draggedGroupRaw === undefined || draggedGroupRaw === 'ungrouped') ? null : draggedGroupRaw;

                        // 检查是否需要改变状态或分组
                        const statusDifferent = draggedStatus !== targetStatus;
                        const groupDifferent = draggedGroup !== targetGroup;

                        if (statusDifferent || groupDifferent) {
                            // 如果分组不同，先改变分组
                            if (groupDifferent) {
                                this.setTaskCustomGroup(this.draggedTask, targetGroup);
                            }

                            // 如果状态不同，改变状态
                            if (statusDifferent) {
                                this.changeTaskStatus(this.draggedTask, targetStatus);
                            }

                            statusChanged = true;
                        }
                    }
                }
                // --- [新逻辑结束] ---

                // [修改]：仅在状态 *未* 发生改变时，才执行排序或父子逻辑
                // （因为状态改变后看板会刷新，排序/父子逻辑已无意义）
                if (!statusChanged) {
                    const rect = taskEl.getBoundingClientRect();
                    const mouseY = e.clientY;
                    const taskTop = rect.top;
                    const taskBottom = rect.bottom;
                    const taskHeight = rect.height;

                    // 定义区域
                    const sortZoneHeight = taskHeight * 0.2;
                    const isInTopSortZone = mouseY <= taskTop + sortZoneHeight;
                    const isInBottomSortZone = mouseY >= taskBottom - sortZoneHeight;
                    const isInParentChildZone = !isInTopSortZone && !isInBottomSortZone;

                    const canSort = this.canDropForSort(this.draggedTask, targetTask);
                    const canBecomeSibling = this.canBecomeSiblingOf(this.draggedTask, targetTask);
                    const canSetParentChild = this.canSetAsParentChild(this.draggedTask, targetTask);

                    if ((isInTopSortZone || isInBottomSortZone)) {
                        if (canSort) {
                            // 执行排序
                            this.handleSortDrop(targetTask, e);
                        } else if (canBecomeSibling) {
                            // 执行成为兄弟任务并排序的操作
                            this.handleBecomeSiblingDrop(this.draggedTask, targetTask, e);
                        }
                    } else if (isInParentChildZone && canSetParentChild) {
                        // 执行父子任务设置
                        this.handleParentChildDrop(targetTask);
                    }
                }
            }
            this.updateIndicator('none', null, null);
        });

        // 添加右键菜单
        taskEl.addEventListener('contextmenu', async (e) => {
            e.preventDefault();
            await this.showTaskContextMenu(e, task);
        });

        // 添加悬停效果
        taskEl.addEventListener('mouseenter', () => {
            taskEl.style.transform = 'translateY(-2px)';
            taskEl.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
        });

        taskEl.addEventListener('mouseleave', () => {
            if (!this.isDragging) {
                taskEl.style.transform = 'translateY(0)';
                taskEl.style.boxShadow = 'none';
            }
        });

        return taskEl;
    }

    private formatTaskDate(task: any): string {
        const today = getLogicalDateString();
        const tomorrowStr = getRelativeDateString(1);

        // 获取当前年份
        const currentYear = new Date().getFullYear();

        // 辅助函数：格式化日期显示
        const formatDateWithYear = (dateStr: string, date: Date): string => {
            const year = date.getFullYear();
            return year !== currentYear
                ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
                : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        };

        // 辅助函数：计算过期天数
        const getExpiredDays = (targetDate: string): number => {
            return Math.ceil((new Date(today).getTime() - new Date(targetDate).getTime()) / (1000 * 60 * 60 * 24));
        };

        // 辅助函数：创建过期徽章（completed 为 true 时使用“X天前”的词语）
        const createExpiredBadge = (days: number, completed: boolean = false): string => {
            const text = completed ? t('daysAgo', { days: String(days) }) : t('overdueDays', { days: String(days) });
            return `<span class="countdown-badge countdown-normal" style="background-color: rgba(231, 76, 60, 0.15); color: #e74c3c; border: 1px solid rgba(231, 76, 60, 0.3);">${text}</span>`;
        };

        // 如果只有截止时间，显示截止时间
        if (!task.date && task.endDate) {
            const endDate = new Date(task.endDate);
            const endYear = endDate.getFullYear();

            // 检查是否过期
            if (task.endDate < today) {
                const daysDiff = getExpiredDays(task.endDate);
                const dateStr = formatDateWithYear(task.endDate, endDate);
                return `${dateStr} ${createExpiredBadge(daysDiff, !!task.completed)}`;
            }

            if (task.endDate === today) {
                return t('todayDeadline');
            } else if (task.endDate === tomorrowStr) {
                return t('tomorrowDeadline');
            } else {
                const dateStr = formatDateWithYear(task.endDate, endDate);
                return `${dateStr} ${t('countdownEnd')}`;
            }
        }

        // 如果有开始时间，按原逻辑显示
        let dateStr = '';
        if (task.date === today) {
            dateStr = t('today');
        } else if (task.date === tomorrowStr) {
            dateStr = t('tomorrow');
        } else {
            const taskDate = new Date(task.date);
            const taskYear = taskDate.getFullYear();

            // 检查是否过期
            if (task.date < today) {
                const formattedDate = formatDateWithYear(task.date, taskDate);
                // 如果任务有结束日期且和开始日期不同，避免在开始日期处显示过期徽章（只在结束日期处显示一次）
                if (task.endDate && task.endDate !== task.date) {
                    dateStr = formattedDate;
                } else {
                    const daysDiff = getExpiredDays(task.date);
                    dateStr = `${formattedDate} ${createExpiredBadge(daysDiff, !!task.completed)} `;
                }
            } else {
                // 如果不在今年，显示年份
                dateStr = formatDateWithYear(task.date, taskDate);
            }
        }

        // 如果是农历循环事件，添加农历日期显示
        if (task.repeat?.enabled && (task.repeat.type === 'lunar-monthly' || task.repeat.type === 'lunar-yearly')) {
            try {
                const lunarStr = getSolarDateLunarString(task.date);
                if (lunarStr) {
                    dateStr = `${dateStr} (${lunarStr})`;
                }
            } catch (error) {
                console.error('Failed to format lunar date:', error);
            }
        }

        let endDateStr = '';
        if (task.endDate && task.endDate !== task.date) {
            const taskEndDate = new Date(task.endDate);
            const endYear = taskEndDate.getFullYear();

            // 检查结束日期是否过期
            if (task.endDate < today) {
                const daysDiff = getExpiredDays(task.endDate);
                const formattedEndDate = formatDateWithYear(task.endDate, taskEndDate);
                endDateStr = `${formattedEndDate} ${createExpiredBadge(daysDiff, !!task.completed)} `;
            } else {
                // 如果结束日期不在今年，显示年份
                endDateStr = formatDateWithYear(task.endDate, taskEndDate);
            }
        }

        if (endDateStr) {
            return `${dateStr} → ${endDateStr} `;
        }

        if (task.time) {
            return `${dateStr} ${task.time} `;
        }

        return dateStr || "未设置日期";
    }

    private getTaskCountdownInfo(task: any): { text: string; days: number; type: 'start' | 'end' | 'none' } {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 如果同时有开始日期和结束日期，则仅基于结束日期显示倒计时（避免同时显示开始和结束倒计时）
        if (task.date && task.endDate) {
            const endDate = new Date(task.endDate);
            endDate.setHours(0, 0, 0, 0);
            const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? t('todayEnd') : t('endsInNDays', { days: String(endDays) }),
                    days: endDays,
                    type: 'end'
                };
            }
            return { text: '', days: endDays, type: 'none' };
        }

        // 如果只有开始日期
        if (task.date) {
            const startDate = new Date(task.date);
            startDate.setHours(0, 0, 0, 0);
            const startDays = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            // 如果还没开始
            if (startDays > 0) {
                return {
                    text: t('startsInNDays', { days: String(startDays) }),
                    days: startDays,
                    type: 'start'
                };
            }

            // 否则没有有效的开始倒计时，继续检查结束日期（如果存在）
            if (task.endDate) {
                const endDate = new Date(task.endDate);
                endDate.setHours(0, 0, 0, 0);
                const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

                if (endDays >= 0) {
                    return {
                        text: endDays === 0 ? t('todayEnd') : t('endsInNDays', { days: String(endDays) }),
                        days: endDays,
                        type: 'end'
                    };
                }
            }
        }

        // 只有结束日期的情况
        if (task.endDate) {
            const endDate = new Date(task.endDate);
            endDate.setHours(0, 0, 0, 0);
            const endDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

            if (endDays >= 0) {
                return {
                    text: endDays === 0 ? t('todayEnd') : t('endsInNDays', { days: String(endDays) }),
                    days: endDays,
                    type: 'end'
                };
            }
        }

        return { text: '', days: 0, type: 'none' };
    }

    private addTaskDragEvents(element: HTMLElement, task: any) {
        // 支持子任务拖拽到父任务上边缘解除父子关系
        element.addEventListener('dragover', (e) => {
            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
            // 仅允许子任务拖拽到父任务上边缘
            if (task.id === this.draggedTask.parentId) {
                const rect = element.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                if (offsetY < 16) { // 上边缘区域
                    e.preventDefault();
                    this.updateIndicator('parentChild', element, 'top', e);
                } else {
                    this.updateIndicator('none', null, null);
                }
            }
        });

        element.addEventListener('dragleave', () => {
            this.updateIndicator('none', null, null);
        });

        element.addEventListener('drop', async (e) => {
            if (!this.isDragging || !this.draggedTask || this.draggedTask.id === task.id) return;
            if (task.id === this.draggedTask.parentId) {
                const rect = element.getBoundingClientRect();
                const offsetY = e.clientY - rect.top;
                if (offsetY < 16) {
                    // 解除父子关系
                    await this.unsetParentChildRelation(this.draggedTask);
                    this.clearAllIndicators();
                }
            }
        });
        element.addEventListener('dragstart', (e) => {
            this.isDragging = true;
            this.draggedTask = task;
            this.draggedElement = element;
            element.style.opacity = '0.5';
            element.style.cursor = 'grabbing';

            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', element.outerHTML);
            }
        });

        element.addEventListener('dragend', () => {
            this.isDragging = false;
            this.draggedTask = null;
            this.draggedElement = null;
            element.style.opacity = '';
            element.style.cursor = 'grab';
            element.style.transform = 'translateY(0)';
            element.style.boxShadow = 'none';

            // 清理所有拖拽状态
            this.container.querySelectorAll('.kanban-drop-zone-active').forEach(el => {
                el.classList.remove('kanban-drop-zone-active');
            });
            // 清除所有指示器和状态
            this.updateIndicator('none', null, null);
        });
    }

    private async showTaskContextMenu(event: MouseEvent, task: any) {
        const menu = new Menu("kanbanTaskContextMenu");

        const childTasks = this.tasks.filter(t => t.parentId === task.id);

        // 编辑任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示修改此实例和修改所有实例
            menu.addItem({
                iconHTML: "📝",
                label: t('modifyThisInstance'),
                click: () => this.editInstanceReminder(task)
            });
            menu.addItem({
                iconHTML: "🔄",
                label: t('modifyAllInstances'),
                click: () => this.editTask(task)
            });
        } else if (task.repeat?.enabled) {
            // 原始周期事件 - 只显示编辑选项
            menu.addItem({
                iconHTML: "📝",
                label: t('editTask'),
                click: () => this.editTask(task)
            });
        } else {
            // 普通任务
            menu.addItem({
                iconHTML: "📝",
                label: t('editTask'),
                click: () => this.editTask(task)
            });
            // 绑定块功能
            if (task.blockId || task.docId) {
                menu.addItem({
                    iconHTML: "📋",
                    label: t('copyBlockRef'),
                    click: () => this.copyBlockRef(task)
                });
            } else {
                menu.addItem({
                    iconHTML: "🔗",
                    label: t('bindToBlock'),
                    click: () => this.showBindToBlockDialog(task)
                });
            }
        }

        menu.addItem({
            iconHTML: "➕",
            label: t('createSubtask'),
            click: () => this.showCreateTaskDialog(task)
        });

        // 粘贴新建子任务
        menu.addItem({
            iconHTML: "📋",
            label: t('pasteCreateSubtask'),
            click: () => this.showPasteTaskDialog(task)
        });

        // 父子任务管理
        if (task.parentId) {
            menu.addItem({
                iconHTML: "🔗",
                label: t('unsetParentRelation'),
                click: () => this.unsetParentChildRelation(task)
            });
        }





        menu.addSeparator();

        // 设置优先级子菜单
        const priorityMenuItems = [];
        const priorities = [
            { key: 'high', label: t('priorityHigh'), icon: '🔴' },
            { key: 'medium', label: t('priorityMedium'), icon: '🟡' },
            { key: 'low', label: t('priorityLow'), icon: '🔵' },
            { key: 'none', label: t('none'), icon: '⚫' }
        ];

        const currentPriority = task.priority || 'none';
        priorities.forEach(priority => {
            priorityMenuItems.push({
                iconHTML: priority.icon,
                label: priority.label,
                current: currentPriority === priority.key,
                click: () => this.setPriority(task, priority.key)
            });
        });

        menu.addItem({
            iconHTML: "🎯",
            label: t('setPriority'),
            submenu: priorityMenuItems
        });

        // 设置分组子菜单（仅在项目有自定义分组时显示）
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectGroups = await projectManager.getProjectCustomGroups(this.projectId);

            if (projectGroups.length > 0) {
                const groupMenuItems = [];
                const currentGroupId = task.customGroupId;

                // 添加"移除分组"选项
                groupMenuItems.push({
                    iconHTML: "❌",
                    label: t('removeGroup'),
                    current: !currentGroupId,
                    // 传入 task 对象（setTaskCustomGroup 期望第一个参数为 task 对象）
                    click: () => this.setTaskCustomGroup(task, null)
                });

                // 添加所有分组选项
                projectGroups.forEach((group: any) => {
                    groupMenuItems.push({
                        iconHTML: group.icon || "📋",
                        label: group.name,
                        current: currentGroupId === group.id,
                        // 传入 task 对象（setTaskCustomGroup 期望第一个参数为 task 对象）
                        click: () => this.setTaskCustomGroup(task, group.id)
                    });
                });

                menu.addItem({
                    iconHTML: "📂",
                    label: t('setCategory'),
                    submenu: groupMenuItems
                });
            }
        } catch (error) {
            console.error('加载分组信息失败:', error);
        }

        // 设置标签子菜单（仅在项目有标签时显示）
        try {
            const { ProjectManager } = await import('../utils/projectManager');
            const projectManager = ProjectManager.getInstance(this.plugin);
            const projectTags = await projectManager.getProjectTags(this.projectId);

            if (projectTags.length > 0) {
                const tagMenuItems = [];
                const currentTagIds = task.tagIds || [];

                projectTags.forEach((tag: { id: string, name: string, color: string }) => {
                    const isSelected = currentTagIds.includes(tag.id);

                    // 创建带颜色的标签HTML，固定宽度并支持省略号
                    const tagBadgeHTML = `
                        <div style="
                            display: flex;
                            align-items: center;
                            width: 100%;
                        ">
                            <span style="
                                display: inline-flex;
                                align-items: center;
                                padding: 2px 8px;
                                font-size: 11px;
                                border-radius: 12px;
                                background: ${tag.color}20;
                                border: 1px solid ${tag.color};
                                color: var(--b3-theme-on-surface);
                                font-weight: 500;
                                max-width: 150px;
                                min-width: 80px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                            " title="${tag.name}">#${tag.name}</span>
                        </div>
                    `;

                    tagMenuItems.push({
                        iconHTML: isSelected ? "✓" : "",
                        label: tagBadgeHTML,
                        click: () => this.toggleTaskTag(task, tag.id)
                    });
                });

                menu.addItem({
                    iconHTML: "🏷️",
                    label: t('setTags'),
                    submenu: tagMenuItems
                });
            }
        } catch (error) {
            console.error('加载项目标签失败:', error);
        }



        menu.addSeparator();

        // 任务类型切换
        const currentTermType = task.termType; // 不设默认值，允许为 undefined

        if (currentTermType !== 'short_term') {
            menu.addItem({
                iconHTML: "📝",
                label: t('setAsShortTerm'),
                click: () => this.changeTaskStatus(task, 'short_term')
            });
        }

        if (currentTermType !== 'long_term') {
            menu.addItem({
                iconHTML: "🎯",
                label: t('setAsLongTerm'),
                click: () => this.changeTaskStatus(task, 'long_term')
            });
        }


        // 状态切换
        const currentStatus = this.getTaskStatus(task);

        if (currentStatus !== 'doing') {
            menu.addItem({
                iconHTML: "⚡",
                label: t('moveToDoing'),
                click: () => this.changeTaskStatus(task, 'doing')
            });
        }

        if (currentStatus !== 'done') {
            menu.addItem({
                iconHTML: "✅",
                label: t('markCompleted'),
                click: () => this.changeTaskStatus(task, 'done')
            });
        }

        menu.addSeparator();

        // 番茄钟
        menu.addItem({
            iconHTML: "🍅",
            label: t('startPomodoro'),
            click: () => this.startPomodoro(task)
        });

        menu.addItem({
            iconHTML: "⏱️",
            label: t('startStopwatch'),
            click: () => this.startPomodoroCountUp(task)
        });

        menu.addSeparator();

        // 删除任务 - 针对周期任务显示不同选项
        if (task.isRepeatInstance) {
            // 周期事件实例 - 显示删除此实例和删除所有实例
            menu.addItem({
                iconHTML: "🗑️",
                label: t('deleteThisInstance'),
                click: () => this.deleteInstanceOnly(task)
            });
            menu.addItem({
                iconHTML: "🗑️",
                label: t('deleteAllInstances'),
                click: () => this.deleteTask(task)
            });
        } else {
            // 普通任务或原始周期事件
            menu.addItem({
                iconHTML: "🗑️",
                label: t('deleteTask'),
                click: () => this.deleteTask(task)
            });
        }

        // 复制子任务为多级 Markdown 列表
        if (childTasks.length > 0) {
            menu.addItem({
                iconHTML: "📋",
                label: t('copySubtasksAsList'),
                click: () => {
                    const childLines = this.buildMarkdownListFromChildren(task.id);
                    if (childLines && childLines.length > 0) {
                        const text = childLines.join('\n');
                        // 复制到剪贴板
                        try {
                            navigator.clipboard.writeText(text);
                            showMessage(t('copiedSubtasksList'));
                        } catch (err) {
                            // 备用：使用临时 textarea
                            const ta = document.createElement('textarea');
                            ta.value = text;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand('copy');
                            document.body.removeChild(ta);
                            showMessage(t('copiedSubtasksList'));
                        }
                    } else {
                        showMessage(t('noSubtasksToCopy'));
                    }
                }
            });
        }

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    private async toggleTaskCompletion(task: any, completed: boolean) {
        try {
            if (task.isRepeatInstance && task.originalId) {
                // 对于重复实例，使用不同的完成逻辑
                await this.toggleRepeatInstanceCompletion(task, completed);
            } else {
                // 对于普通任务，使用原有逻辑
                const newStatus = completed ? 'done' : 'todo';
                await this.changeTaskStatus(task, newStatus);
            }
        } catch (error) {
            console.error('切换任务完成状态失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    /**
     * 切换重复实例的完成状态
     * @param task 重复实例任务
     * @param completed 是否完成
     */
    private async toggleRepeatInstanceCompletion(task: any, completed: boolean) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始重复事件不存在");
                return;
            }

            // 初始化完成实例列表
            if (!originalReminder.repeat.completedInstances) {
                originalReminder.repeat.completedInstances = [];
            }

            const instanceDate = task.date;
            const completedInstances = originalReminder.repeat.completedInstances;

            if (completed) {
                // 添加到完成列表（如果还没有的话）
                if (!completedInstances.includes(instanceDate)) {
                    completedInstances.push(instanceDate);
                }

                // 记录完成时间
                if (!originalReminder.repeat.instanceCompletedTimes) {
                    originalReminder.repeat.instanceCompletedTimes = {};
                }
                originalReminder.repeat.instanceCompletedTimes[instanceDate] = getLocalDateTimeString(new Date());
            } else {
                // 从完成列表中移除
                const index = completedInstances.indexOf(instanceDate);
                if (index > -1) {
                    completedInstances.splice(index, 1);
                }

                // 移除完成时间记录
                if (originalReminder.repeat.instanceCompletedTimes) {
                    delete originalReminder.repeat.instanceCompletedTimes[instanceDate];
                }
            }

            await writeReminderData(reminderData);

            // 更新本地缓存
            const localTask = this.tasks.find(t => t.id === task.id);
            if (localTask) {
                localTask.completed = completed;
                if (completed) {
                    localTask.completedTime = originalReminder.repeat.instanceCompletedTimes?.[instanceDate];
                } else {
                    delete localTask.completedTime;
                }
            }

            // 广播更新事件
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        } catch (error) {
            console.error('切换重复实例完成状态失败:', error);
            showMessage('操作失败，请重试');
        }
    }

    private async changeTaskStatus(task: any, newStatus: string) {
        try {
            // 如果当前是通过拖拽触发的状态变更，并且任务有设置日期且该日期为今天或已过
            // 则阻止直接把它移出 "进行中"，提示用户需要修改任务时间才能移出。
            try {
                const today = getLogicalDateString();
                if (this.isDragging && task && task.date && compareDateStrings(task.date, today) <= 0 && newStatus !== 'doing') {
                    const dialog = new Dialog({
                        title: '提示',
                        content: `
                            <div class="b3-dialog__content">
                                <p>该任务的日期为今天或已过，系统会将其自动显示在“进行中”列。</p>
                                <p>要将任务移出“进行中”，需要修改任务的日期或时间。</p>
                            </div>
                            <div class="b3-dialog__action">
                                <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                                <button class="b3-button b3-button--primary" id="editBtn">编辑任务时间</button>
                            </div>
                        `,
                        width: "420px"
                    });

                    const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
                    const editBtn = dialog.element.querySelector('#editBtn') as HTMLButtonElement;

                    cancelBtn.addEventListener('click', () => dialog.destroy());
                    editBtn.addEventListener('click', async () => {
                        dialog.destroy();
                        // 打开编辑对话框以便用户修改时间
                        await this.editTask(task);
                    });

                    return; // 中断后续状态切换
                }
            } catch (err) {
                // ignore parsing errors and continue
            }
            const reminderData = await readReminderData();

            // 对于周期实例，使用 originalId；否则使用 task.id
            const actualTaskId = task.isRepeatInstance ? task.originalId : task.id;

            if (reminderData[actualTaskId]) {
                // 如果是周期实例，需要更新实例的完成状态
                if (task.isRepeatInstance) {
                    // 处理周期实例的完成状态
                    if (newStatus === 'done') {
                        // 标记这个特定日期的实例为已完成
                        if (!reminderData[actualTaskId].repeat) {
                            reminderData[actualTaskId].repeat = {};
                        }
                        if (!reminderData[actualTaskId].repeat.completedInstances) {
                            reminderData[actualTaskId].repeat.completedInstances = [];
                        }
                        // 添加到已完成实例列表（如果还没有）
                        if (!reminderData[actualTaskId].repeat.completedInstances.includes(task.date)) {
                            reminderData[actualTaskId].repeat.completedInstances.push(task.date);
                        }

                        // 周期实例完成时，不自动完成子任务（因为每个实例都是独立的）
                        // 如果需要完成子任务，用户应该在右键菜单中选择"完成任务及所有子任务"
                    } else {
                        // 取消完成周期实例或修改其他状态（long_term, short_term, doing）
                        if (reminderData[actualTaskId].repeat?.completedInstances) {
                            const index = reminderData[actualTaskId].repeat.completedInstances.indexOf(task.date);
                            if (index > -1) {
                                reminderData[actualTaskId].repeat.completedInstances.splice(index, 1);
                            }
                        }

                        // 对于周期事件，也需要支持修改 termType 和 kanbanStatus
                        // 修改的是原始周期事件的属性，会影响所有未来实例
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            reminderData[actualTaskId].termType = newStatus;
                            reminderData[actualTaskId].kanbanStatus = 'todo';
                        } else if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                            // 设置为进行中时，清空termType
                            delete reminderData[actualTaskId].termType;
                        }
                    }
                } else {
                    // 非周期实例的正常处理
                    if (newStatus === 'done') {
                        reminderData[actualTaskId].completed = true;
                        reminderData[actualTaskId].completedTime = getLocalDateTimeString(new Date());

                        // 父任务完成时，自动完成所有子任务
                        await this.completeAllChildTasks(actualTaskId, reminderData);
                    } else {
                        reminderData[actualTaskId].completed = false;
                        delete reminderData[actualTaskId].completedTime;

                        // 根据新状态设置kanbanStatus和termType
                        if (newStatus === 'long_term' || newStatus === 'short_term') {
                            reminderData[actualTaskId].termType = newStatus;
                            reminderData[actualTaskId].kanbanStatus = 'todo';
                        } else if (newStatus === 'doing') {
                            reminderData[actualTaskId].kanbanStatus = 'doing';
                            // 设置为进行中时，清空termType
                            delete reminderData[actualTaskId].termType;
                        }
                    }
                }

                await writeReminderData(reminderData);

                // 更新块的书签状态（仅针对绑定块的任务）
                if (task.blockId || task.docId) {
                    await updateBlockReminderBookmark(task.blockId || task.docId);
                }

                // 触发更新事件（debounced 由 listener 自动处理）
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                // 重新加载任务
                await this.queueLoadTasks();
            }
        } catch (error) {
            console.error('切换任务状态失败:', error);
            showMessage("状态切换失败");
        }
    }

    /**
     * 当父任务完成时，自动完成所有子任务
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     */
    private async completeAllChildTasks(parentId: string, reminderData: any): Promise<void> {
        try {
            // 获取所有子任务ID（递归获取所有后代）
            const descendantIds = this.getAllDescendantIds(parentId, reminderData);

            if (descendantIds.length === 0) {
                return; // 没有子任务，直接返回
            }

            const currentTime = getLocalDateTimeString(new Date());
            let completedCount = 0;

            // 自动完成所有子任务
            for (const childId of descendantIds) {
                const childTask = reminderData[childId];
                if (childTask && !childTask.completed) {
                    childTask.completed = true;
                    childTask.completedTime = currentTime;
                    completedCount++;

                    // 如果子任务有绑定块，也需要处理书签更新
                    if (childTask.blockId || childTask.docId) {
                        try {
                            await updateBlockReminderBookmark(childTask.blockId || childTask.docId);
                        } catch (error) {
                            console.warn(`更新子任务 ${childId} 的块书签失败: `, error);
                        }
                    }
                }
            }

            if (completedCount > 0) {
                console.log(`${t('parentTaskCompleted')} ${parentId}, ${t('autoCompleteSubtasks', { count: String(completedCount) })} `);
                showMessage(t('autoCompleteSubtasks', { count: String(completedCount) }), 2000);
            }
        } catch (error) {
            console.error('自动完成子任务失败:', error);
            // 不要阻止父任务的完成，只是记录错误
        }
    }

    /**
     * 递归获取所有后代任务ID
     * @param parentId 父任务ID
     * @param reminderData 任务数据
     * @returns 所有后代任务ID数组
     */
    private getAllDescendantIds(parentId: string, reminderData: any): string[] {
        const result: string[] = [];
        const visited = new Set<string>(); // 防止循环引用

        const getChildren = (currentParentId: string) => {
            if (visited.has(currentParentId)) {
                return; // avoid cycles
            }
            visited.add(currentParentId);

            // Normalize reminderData into iterable list
            let values: any[] = [];
            try {
                if (!reminderData) values = [];
                else if (reminderData instanceof Map) values = Array.from(reminderData.values());
                else if (Array.isArray(reminderData)) values = reminderData;
                else values = Object.values(reminderData);
            } catch (e) {
                values = [];
            }

            for (const task of values) {
                if (task && task.parentId === currentParentId) {
                    result.push(task.id);
                    getChildren(task.id);
                }
            }
        };

        getChildren(parentId);
        return result;
    }

    /**
     * 收集给定任务ID集合的所有后代任务ID（基于 this.tasks）
     * @param taskIds 初始任务ID集合
     */
    private collectDescendantIds(taskIds: Set<string>): Set<string> {
        const idToTask = new Map(this.tasks.map(t => [t.id, t]));
        const visited = new Set<string>();
        const result = new Set<string>();
        const stack = Array.from(taskIds);

        while (stack.length > 0) {
            const id = stack.pop();
            if (!id || visited.has(id)) continue;
            visited.add(id);
            // 查找直接子任务
            for (const t of this.tasks) {
                if (t.parentId === id && !result.has(t.id)) {
                    result.add(t.id);
                    stack.push(t.id);
                }
            }
        }
        return result;
    }

    /**
     * 扩展一组任务，使其包含所有后代任务（可能包括已完成的子任务），以便在父任务下显示
     * @param tasksParam 需要扩展的任务数组（顶层任务列表）
     */
    private augmentTasksWithDescendants(tasksParam: any[], groupId?: string | null): any[] {
        if (!tasksParam || tasksParam.length === 0) return [];
        const idToTask = new Map(this.tasks.map(t => [t.id, t]));
        const resultMap = new Map<string, any>();

        // 初始添加（包含传入的任务）
        for (const t of tasksParam) {
            resultMap.set(t.id, t);
        }

        // 收集所有顶层任务 id
        const rootIds = new Set<string>(tasksParam.map(t => t.id));
        const descIds = this.collectDescendantIds(rootIds);
        for (const dId of descIds) {
            const dt = idToTask.get(dId);
            // 仅当子任务没有被分配到另一个自定义分组或其 customGroupId 与当前 groupId 匹配时，才作为后代添加
            if (dt) {
                if (!groupId || !dt.customGroupId || dt.customGroupId === groupId) {
                    resultMap.set(dId, dt);
                }
            }
        }

        // 返回数组形式，保持原来 tasksParam 的顺序尽可能不变：先原数组，然后添加后代（按 this.tasks 的顺序）
        const result: any[] = [];
        for (const t of tasksParam) result.push(t);
        for (const t of this.tasks) {
            if (resultMap.has(t.id) && !tasksParam.find(pt => pt.id === t.id)) {
                result.push(t);
            }
        }
        return result;
    }

    private showSortMenu(event: MouseEvent) {
        if (document.querySelector('.kanban-sort-menu')) {
            return;
        }

        const menuEl = document.createElement('div');
        menuEl.className = 'kanban-sort-menu';
        menuEl.style.cssText = `
                position: absolute;
            background: var(--b3-theme-surface);
            border: 1px solid var(--b3-theme-border);
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                padding: 8px;
            z-index: 100;
                display: flex;
            flex-direction: column;
                gap: 4px;
                `;

        const sortOptions = [
            { key: 'priority', label: '优先级', icon: '🎯' },
            { key: 'time', label: '时间', icon: '🕐' },
            { key: 'title', label: '标题', icon: '📝' }
        ];

        const createOption = (option: any, order: 'asc' | 'desc') => {
            const button = document.createElement('button');
            button.className = 'b3-button b3-button--outline';
            const isActive = this.currentSort === option.key && this.currentSortOrder === order;
            button.style.cssText = `
                width: 100%;
                display: flex;
                align-items: center;
                gap: 8px;
                justify-content: flex-start;
                text-align: left;
                background-color: ${isActive ? 'var(--b3-theme-primary-lightest)' : 'transparent'};
                color: ${isActive ? 'var(--b3-theme-primary)' : 'var(--b3-theme-on-surface)'};
                `;
            // Use valid <span> tags (no stray spaces in tag names), and keep layout compact
            button.innerHTML = `
                    <span style="font-size: 16px; margin-right: 8px;">${option.icon}</span>
                    <span>${option.label} (${order === 'asc' ? t('ascendingOrder') : t('descendingOrder')})</span>
                `;
            button.addEventListener('click', () => {
                this.currentSort = option.key;
                this.currentSortOrder = order;
                this.updateSortButtonTitle();
                this.sortTasks();
                this.renderKanban();
                closeMenu();
            });
            return button;
        };

        sortOptions.forEach(option => {
            menuEl.appendChild(createOption(option, 'desc'));
            menuEl.appendChild(createOption(option, 'asc'));
        });

        document.body.appendChild(menuEl);

        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        // Remove stray whitespace before 'px' (invalid CSS) and ensure the menu stays aligned to trigger element
        menuEl.style.top = `${rect.bottom + 4}px`;
        menuEl.style.left = `${rect.right - menuEl.offsetWidth}px`;
        // Ensure a minimum width so the content doesn't wrap awkwardly
        menuEl.style.minWidth = '180px';
        // preferable box-sizing for predictable width calculations
        menuEl.style.boxSizing = 'border-box';

        // Prevent the menu from going outside the viewport
        let left = rect.right - menuEl.offsetWidth;
        let top = rect.bottom + 4;
        if (left < 4) left = 4;
        if (left + menuEl.offsetWidth > window.innerWidth - 4) left = Math.max(4, window.innerWidth - menuEl.offsetWidth - 4);
        if (top + menuEl.offsetHeight > window.innerHeight - 4) top = Math.max(4, rect.top - menuEl.offsetHeight - 4);
        menuEl.style.left = `${left}px`;
        menuEl.style.top = `${top}px`;

        const closeMenu = () => {
            menuEl.remove();
            document.removeEventListener('click', handleClickOutside);
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (!menuEl.contains(e.target as Node) && e.target !== event.currentTarget) {
                closeMenu();
            }
        };

        setTimeout(() => document.addEventListener('click', handleClickOutside), 0);
    }

    private showDoneSortMenu(event: MouseEvent) {
        const menu = new Menu("kanbanDoneSortMenu");

        const addMenuItem = (label: string, sortKey: string, sortOrder: 'asc' | 'desc') => {
            menu.addItem({
                label: label,
                current: this.doneSort === sortKey && this.doneSortOrder === sortOrder,
                click: () => {
                    this.doneSort = sortKey;
                    this.doneSortOrder = sortOrder;
                    this.updateDoneSortButtonTitle();
                    this.renderKanban();
                }
            });
        };

        addMenuItem(`${t('sortByCompletedTime')} (${t('descendingOrder')})`, 'completedTime', 'desc');
        addMenuItem(`${t('sortByCompletedTime')} (${t('ascendingOrder')})`, 'completedTime', 'asc');
        menu.addSeparator();
        addMenuItem(`${t('sortingPriority')} (${t('descendingOrder')})`, 'priority', 'desc');
        addMenuItem(`${t('sortingPriority')} (${t('ascendingOrder')})`, 'priority', 'asc');
        menu.addSeparator();
        addMenuItem(`${t('sortBySetTime')} (${t('descendingOrder')})`, 'time', 'desc');
        addMenuItem(`${t('sortBySetTime')} (${t('ascendingOrder')})`, 'time', 'asc');
        menu.addSeparator();
        addMenuItem(`${t('sortingTitle')} (${t('ascendingOrder')})`, 'title', 'asc');
        addMenuItem(`${t('sortingTitle')} (${t('descendingOrder')})`, 'title', 'desc');

        menu.open({
            x: event.clientX,
            y: event.clientY
        });
    }

    // 使用 QuickReminderDialog 创建任务
    private showCreateTaskDialog(parentTask?: any, defaultCustomGroupId?: string | null, defaultTermType?: 'short_term' | 'long_term' | 'doing' | 'todo') {
        // Calculate max sort value to place new task at the end
        const maxSort = this.tasks.reduce((max, task) => Math.max(max, task.sort || 0), 0);
        const defaultSort = maxSort + 10000;

        const quickDialog = new QuickReminderDialog(
            undefined, // 项目看板创建任务默认不设置日期
            undefined, // 无初始时间
            () => {
                // 保存成功后刷新看板（防抖）
                this.queueLoadTasks();
            },
            undefined, // 无时间段选项
            {
                defaultProjectId: this.projectId, // 默认项目ID
                defaultParentId: parentTask?.id, // 传递父任务ID
                defaultCategoryId: parentTask?.categoryId || this.project.categoryId, // 如果是子任务，继承父任务分类；否则使用项目分类
                defaultPriority: parentTask?.priority, // 如果是子任务，继承父任务优先级
                defaultTitle: parentTask ? '' : undefined, // 子任务不预填标题
                // 传入默认 custom group id（可能为 undefined 或 null）
                defaultCustomGroupId: parentTask?.customGroupId ?? defaultCustomGroupId,
                hideProjectSelector: true, // 隐藏项目选择器
                showKanbanStatus: 'term', // 显示任务类型选择
                // 使用上一次选择的 termType 作为默认值
                defaultTermType: defaultTermType || this.lastSelectedTermType,
                plugin: this.plugin, // 传入plugin实例
                defaultSort: defaultSort
            }
        );

        quickDialog.show();

        // 重写保存回调，保存用户选择的 termType
        const originalOnSaved = quickDialog['onSaved'];
        quickDialog['onSaved'] = async () => {
            if (originalOnSaved) {
                originalOnSaved(); // This will call this.loadTasks()
            }

            // 保存用户选择的 termType 到内存中
            try {
                const selectedTermType = quickDialog['dialog']?.element?.querySelector('#quickTermTypeSelector .term-type-option.selected') as HTMLElement;
                const termType = selectedTermType?.getAttribute('data-term-type') as 'short_term' | 'long_term' | 'doing' | 'todo' | undefined;
                if (termType && termType !== this.lastSelectedTermType) {
                    this.lastSelectedTermType = termType;
                }
            } catch (error) {
                console.error('保存上一次选择的 termType 失败:', error);
            }
        };
    }

    private async editTask(task: any) {
        try {
            // 对于周期实例，需要编辑原始周期事件
            // 注意：不能直接使用实例对象，需要从数据中读取原始事件
            let taskToEdit = task;

            if (task.isRepeatInstance && task.originalId) {
                const reminderData = await readReminderData();
                const originalReminder = reminderData[task.originalId];
                if (!originalReminder) {
                    showMessage("原始周期事件不存在");
                    return;
                }
                // 使用原始事件对象而不是实例对象
                taskToEdit = originalReminder;
            }

            // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
            // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
            const callback = () => {
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            };

            const editDialog = new QuickReminderDialog(undefined, undefined, callback, undefined, { mode: 'edit', reminder: taskToEdit, plugin: this.plugin });
            editDialog.show();
        } catch (error) {
            console.error('打开编辑对话框失败:', error);
            showMessage("打开编辑对话框失败");
        }
    }

    private showPasteTaskDialog(parentTask?: any, customGroupId?: string) {
        const dialog = new Dialog({
            title: "粘贴列表新建任务",
            content: `
                <div class="b3-dialog__content">
                        <p>粘贴Markdown列表或多行文本，每行将创建一个任务。支持多层级列表自动创建父子任务。</p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        支持语法：<code>@priority=high&startDate=2025-08-12&endDate=2025-08-30</code>
                                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                                        支持块链接：<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>
                                            </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 8px;">
                        支持多层级：使用缩进或多个<code>-</code>符号创建父子任务关系
                                            </p>
                    <textarea id="taskList" class="b3-text-field"
                        placeholder="示例：
- 完成项目文档 @priority=high&startDate=2025-08-12&endDate=2025-08-15
- 准备会议材料 @priority=medium&startDate=2025-08-13
- [思源笔记插件开发丨任务笔记管理插件](siyuan://blocks/20250610000808-3vqwuh3)
- 学习新技术 @priority=low"
                        style="width: 100%; height: 250px; resize: vertical;"></textarea>
                                            </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">取消</button>
                    <button class="b3-button b3-button--primary" id="createBtn">创建任务</button>
                                            </div>
                                                `,
            width: "500px",
        });

        const textArea = dialog.element.querySelector('#taskList') as HTMLTextAreaElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;

        cancelBtn.addEventListener('click', () => dialog.destroy());

        createBtn.addEventListener('click', async () => {
            const text = textArea.value.trim();
            if (!text) {
                showMessage("列表内容不能为空");
                return;
            }

            // 使用新的层级解析方法
            const hierarchicalTasks = this.parseHierarchicalTaskList(text);

            if (hierarchicalTasks.length > 0) {
                // 如果传入 parentTask，则把所有顶级解析项作为 parentTask 的子任务
                if (parentTask) {
                    await this.batchCreateTasksWithHierarchy(hierarchicalTasks, parentTask.id, customGroupId);
                } else {
                    await this.batchCreateTasksWithHierarchy(hierarchicalTasks, undefined, customGroupId);
                }
                dialog.destroy();
                const totalTasks = this.countTotalTasks(hierarchicalTasks);
                showMessage(`${totalTasks} 个任务已创建`);
            }
        });
    }

    /**
     * 解析层级化任务列表
     * @param text 输入的文本
     * @returns 层级化的任务结构
     */
    private parseHierarchicalTaskList(text: string): HierarchicalTask[] {
        const lines = text.split('\n');
        const tasks: HierarchicalTask[] = [];
        const stack: Array<{ task: HierarchicalTask; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            // 计算缩进级别
            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            // 跳过空行和非列表项
            if (!cleanLine || (!cleanLine.startsWith('-') && level === 0 && !cleanLine.match(/^\s*-/))) {
                // 如果不是列表项但有内容，作为顶级任务处理
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine);
                    const task: HierarchicalTask = {
                        ...taskData,
                        level: 0,
                        children: []
                    };
                    tasks.push(task);
                    stack.length = 0;
                    stack.push({ task, level: 0 });
                }
                continue;
            }

            // 支持多个连续的列表标记（-- 表示更深层级）以及复选框语法 "- [ ]" 或 "- [x]"
            // 先计算基于连续 '-' 的额外层级（例如 "-- item" 看作更深一层）
            let levelFromDashes = 0;
            const dashPrefixMatch = cleanLine.match(/^(-{2,})\s*/);
            if (dashPrefixMatch) {
                // 连续的 '-' 比第一个额外增加层级数
                levelFromDashes = dashPrefixMatch[1].length - 1;
            }

            // 合并缩进级别和 '-' 表示的额外级别
            const combinedLevel = level + levelFromDashes;

            // 移除所有开头的列表标记（- * +）以及前导空格
            const taskContent = cleanLine.replace(/^[-*+]+\s*/, '');
            if (!taskContent) continue;

            const taskData = this.parseTaskLine(taskContent);
            const task: HierarchicalTask = {
                ...taskData,
                level: combinedLevel,
                children: []
            };

            // 清理栈，移除级别更高或相等的项
            while (stack.length > 0 && stack[stack.length - 1].level >= combinedLevel) {
                stack.pop();
            }

            if (stack.length === 0) {
                // 顶级任务
                tasks.push(task);
            } else {
                // 子任务
                const parent = stack[stack.length - 1].task;
                parent.children.push(task);
            }

            stack.push({ task, level: combinedLevel });
        }

        return tasks;
    }

    /**
     * 计算行的缩进级别
     * @param line 文本行
     * @returns 缩进级别
     */
    private calculateIndentLevel(line: string): number {
        // 匹配开头的空格或制表符
        const match = line.match(/^(\s*)/);
        if (!match) return 0;

        const indent = match[1];
        // 每2个空格或1个制表符算一级
        const spaces = indent.replace(/\t/g, '  ').length;
        return Math.floor(spaces / 2);
    }

    /**
     * 批量创建层级化任务
     * @param tasks 层级化任务列表
     * @param parentIdForAllTopLevel 所有顶级任务的父任务ID
     * @param customGroupId 自定义分组ID
     */
    private async batchCreateTasksWithHierarchy(tasks: HierarchicalTask[], parentIdForAllTopLevel?: string, customGroupId?: string) {
        const reminderData = await readReminderData();
        const categoryId = this.project.categoryId; // 继承项目分类

        // 获取当前项目中所有任务的最大排序值
        const maxSort = Object.values(reminderData)
            .filter((r: any) => r && r.projectId === this.projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;

        // 递归创建任务
        const createTaskRecursively = async (
            task: HierarchicalTask,
            parentId?: string,
            parentPriority?: string,
            inheritedGroupId?: string
        ): Promise<string> => {
            const taskId = `quick_${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
            sortCounter += 10;

            // 如果子任务没有指定优先级，继承父任务的优先级
            const inheritedPriority = task.priority || parentPriority || 'none';

            const newTask: any = {
                id: taskId,
                title: task.title,
                note: '',
                priority: inheritedPriority,
                categoryId: categoryId,
                projectId: this.projectId,
                completed: false,
                kanbanStatus: 'todo',
                termType: 'short_term', // 默认为短期任务
                createdTime: new Date().toISOString(),
                date: task.startDate,
                endDate: task.endDate,
                sort: sortCounter,
            };

            // 如果有父任务ID，设置parentId
            if (parentId) {
                newTask.parentId = parentId;
            }

            // 设置自定义分组ID（优先使用传入的inheritedGroupId，其次继承父任务的customGroupId）
            if (inheritedGroupId) {
                newTask.customGroupId = inheritedGroupId;
            } else if (parentId) {
                const parent = reminderData[parentId];
                if (parent && parent.customGroupId) {
                    newTask.customGroupId = parent.customGroupId;
                }
            }

            // 如果解析出了块ID，尝试绑定块
            if (task.blockId) {
                try {
                    const block = await getBlockByID(task.blockId);
                    if (block) {
                        newTask.blockId = task.blockId;
                        newTask.docId = block.root_id || task.blockId;

                        // 如果任务标题为空或者是默认标题，使用块内容作为标题
                        if (!task.title || task.title === t('noContentHint')) {
                            newTask.title = block.content || block.fcontent || t('noContentHint');
                        }

                        // 将绑定的块添加项目ID属性 custom-task-projectId
                        if (this.projectId) {
                            const { addBlockProjectId } = await import('../api');
                            await addBlockProjectId(task.blockId, this.projectId);
                            console.debug('ProjectKanbanView: 粘贴新建任务 - 已为块设置项目ID', task.blockId, this.projectId);
                        }

                        // 更新块的书签状态（添加⏰书签）
                        await updateBlockReminderBookmark(task.blockId);
                    }
                } catch (error) {
                    console.error('绑定块失败:', error);
                    // 绑定失败不影响任务创建，继续创建任务
                }
            }

            reminderData[taskId] = newTask;

            // 递归创建子任务
            if (task.children && task.children.length > 0) {
                for (let i = 0; i < task.children.length; i++) {
                    await createTaskRecursively(task.children[i], taskId, inheritedPriority, inheritedGroupId);
                }
            }

            return taskId;
        };

        // 创建所有顶级任务及其子任务
        for (let i = 0; i < tasks.length; i++) {
            // 如果提供了 parentIdForAllTopLevel，则把解析出的顶级任务作为该父任务的子任务
            const topParent = parentIdForAllTopLevel ? parentIdForAllTopLevel : undefined;

            // 如果有父任务ID，获取父任务的优先级用于继承
            let parentPriority: string | undefined;
            if (topParent) {
                const reminderData = await readReminderData();
                const parentTask = reminderData[topParent];
                parentPriority = parentTask?.priority;
            }

            await createTaskRecursively(tasks[i], topParent, parentPriority, customGroupId);
        }

        await writeReminderData(reminderData);
        await this.queueLoadTasks();
        window.dispatchEvent(new CustomEvent('reminderUpdated'));
    }

    /**
     * 计算总任务数量（包括子任务）
     * @param tasks 层级化任务列表
     * @returns 总任务数量
     */
    private countTotalTasks(tasks: HierarchicalTask[]): number {
        let count = 0;

        const countRecursively = (taskList: HierarchicalTask[]) => {
            for (const task of taskList) {
                count++;
                if (task.children && task.children.length > 0) {
                    countRecursively(task.children);
                }
            }
        };

        countRecursively(tasks);
        return count;
    }

    private parseTaskLine(line: string): { title: string; priority?: string; startDate?: string; endDate?: string; blockId?: string; completed?: boolean } {
        // 查找参数部分 @priority=high&startDate=2025-08-12&endDate=2025-08-30
        const paramMatch = line.match(/@(.+)$/);
        let title = line;
        let priority: string | undefined;
        let startDate: string | undefined;
        let endDate: string | undefined;
        let blockId: string | undefined;
        let completed: boolean | undefined;

        // 检查是否包含思源块链接或块引用
        blockId = this.extractBlockIdFromText(line);

        // 如果找到了块链接，从标题中移除链接部分
        if (blockId) {
            // 移除 Markdown 链接格式 [标题](siyuan://blocks/blockId)
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            // 移除块引用格式 ((blockId '标题'))
            title = title.replace(/\(\([^\s)]+\s+'([^']+)'\)\)/g, '$1');
            // 移除块引用格式 ((blockId "标题"))
            title = title.replace(/\(\([^\s)]+\s+"([^"]+)"\)\)/g, '$1');
            // 移除简单块引用格式 ((blockId))
            title = title.replace(/\(\([^\)]+\)\)/g, '');
        }

        // 解析复选框语法 (- [ ] 或 - [x])，并从标题中移除复选框标记
        const checkboxMatch = title.match(/^\s*\[\s*([ xX])\s*\]\s*/);
        if (checkboxMatch) {
            const mark = checkboxMatch[1];
            completed = (mark.toLowerCase() === 'x');
            title = title.replace(/^\s*\[\s*([ xX])\s*\]\s*/, '').trim();
        }

        // 有些 Markdown 列表中复选框放在 - [ ] 后面，处理示例："- [ ] 任务标题"
        // 如果 title 起始包含 '- [ ]' 或 '- [x]'，也要处理
        const leadingCheckboxMatch = line.match(/^\s*[-*+]\s*\[\s*([ xX])\s*\]\s*(.+)$/);
        if (leadingCheckboxMatch) {
            completed = (leadingCheckboxMatch[1].toLowerCase() === 'x');
            title = leadingCheckboxMatch[2];
        }

        if (paramMatch) {
            // 移除参数部分，获取纯标题
            title = title.replace(/@(.+)$/, '').trim();

            // 解析参数
            const paramString = paramMatch[1];
            const params = new URLSearchParams(paramString);

            priority = params.get('priority') || undefined;
            startDate = params.get('startDate') || undefined;
            endDate = params.get('endDate') || undefined;

            // 验证优先级值
            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) {
                priority = 'none';
            }

            // 验证日期格式 (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) {
                startDate = undefined;
            }
            if (endDate && !dateRegex.test(endDate)) {
                endDate = undefined;
            }
        }

        return {
            title: title.trim() || t('noContentHint'),
            priority,
            startDate,
            endDate,
            blockId
            , completed
        };
    }

    /**
     * 从文本中提取思源块ID
     * 支持以下格式：
     * 1. Markdown链接：[标题](siyuan://blocks/blockId)
     * 2. 块引用：((blockId '标题')) 或 ((blockId "标题"))
     * 3. 简单块引用：((blockId))
     */
    private extractBlockIdFromText(text: string): string | undefined {
        // 匹配 Markdown 链接格式：[标题](siyuan://blocks/blockId)
        const markdownLinkMatch = text.match(/\[([^\]]+)\]\(siyuan:\/\/blocks\/([^)]+)\)/);
        if (markdownLinkMatch) {
            const blockId = markdownLinkMatch[2];
            // 验证块ID格式（通常是20位字符）
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        // 匹配块引用格式：((blockId '标题')) 或 ((blockId "标题"))
        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'"]+)['"]\)\)/);
        if (blockRefWithTitleMatch) {
            const blockId = blockRefWithTitleMatch[1];
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        // 匹配简单块引用格式：((blockId))
        const simpleBlockRefMatch = text.match(/\(\(([^)]+)\)\)/);
        if (simpleBlockRefMatch) {
            const blockId = simpleBlockRefMatch[1].trim();
            if (blockId && blockId.length >= 20) {
                return blockId;
            }
        }

        return undefined;
    }

    private async deleteTask(task: any) {
        // 对于周期实例，删除原始周期事件（所有实例）
        const taskToDelete = task.isRepeatInstance ?
            { ...task, id: task.originalId, isRepeatInstance: false } : task;

        // 先尝试读取数据以计算所有后代任务数量，用于更准确的确认提示
        let confirmMessage = task.isRepeatInstance ?
            t('confirmDeleteRepeat', { title: task.title }) :
            t('confirmDeleteTask', { title: task.title });
        try {
            const reminderDataForPreview = await readReminderData();
            const descendantIdsPreview = this.getAllDescendantIds(taskToDelete.id, reminderDataForPreview);
            if (descendantIdsPreview.length > 0) {
                confirmMessage += `\n\n${t('includesNSubtasks', { count: String(descendantIdsPreview.length) })}`;
            }
        } catch (err) {
            // 无法读取数据时，仍然显示通用提示
        }

        confirm(
            t('deleteTask'),
            confirmMessage,
            async () => {
                try {
                    // 重读数据以确保删除时数据为最新
                    const reminderData = await readReminderData();

                    // 获取所有后代任务ID（递归）
                    const descendantIds = this.getAllDescendantIds(taskToDelete.id, reminderData);

                    const tasksToDelete = [taskToDelete.id, ...descendantIds];

                    // 删除并为绑定块更新书签状态
                    for (const taskId of tasksToDelete) {
                        const t = reminderData[taskId];
                        if (t) {
                            // 先删除数据项
                            delete reminderData[taskId];

                            // 如果绑定了块，更新块的书签（忽略错误）
                            if (t.blockId || t.docId) {
                                try {
                                    await updateBlockReminderBookmark(t.blockId || t.docId);
                                } catch (err) {
                                    console.warn(`更新已删除任务 ${taskId} 的块书签失败: `, err);
                                }
                            }
                        }
                    }

                    await writeReminderData(reminderData);

                    // 触发更新事件
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));

                    // 重新加载任务（使用防抖队列）
                    await this.queueLoadTasks();

                    // showMessage("任务已删除");
                } catch (error) {
                    console.error('删除任务失败:', error);
                    showMessage("删除任务失败");
                }
            }
        );
    }

    private startPomodoro(task: any) {
        if (!this.plugin) {
            showMessage(t('pomodoroUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || t('currentPomodoroTask');
            const newTitle = task.title || t('newPomodoroTask');

            let confirmMessage = `${t('currentPomodoroTask')}："${currentTitle}"，${t('switchPomodoroTask')}："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n${t('switchAndInherit')}`;
            }

            confirm(
                t('switchPomodoroTask'),
                confirmMessage,
                () => {
                    this.performStartPomodoro(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            this.pomodoroManager.resumeCurrentTimer();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            this.performStartPomodoro(task);
        }
    }

    private startPomodoroCountUp(task: any) {
        if (!this.plugin) {
            showMessage(t('pomodoroUnavailable'));
            return;
        }

        // 检查是否已经有活动的番茄钟
        const currentTimer = this.pomodoroManager.getCurrentPomodoroTimer();
        if (currentTimer && currentTimer.isWindowActive()) {
            const currentState = currentTimer.getCurrentState();
            const currentTitle = currentState.reminderTitle || t('currentPomodoroTask');
            const newTitle = task.title || t('newPomodoroTask');

            let confirmMessage = `${t('currentPomodoroTask')}："${currentTitle}"，${t('switchToStopwatch')}："${newTitle}"？`;

            if (currentState.isRunning && !currentState.isPaused) {
                try {
                    this.pomodoroManager.pauseCurrentTimer();
                } catch (error) {
                    console.error('暂停当前番茄钟失败:', error);
                }

                confirmMessage += `\n\n${t('switchAndInherit')}`;
            }

            confirm(
                t('switchToStopwatch'),
                confirmMessage,
                () => {
                    this.performStartPomodoroCountUp(task, currentState);
                },
                () => {
                    if (currentState.isRunning && !currentState.isPaused) {
                        try {
                            this.pomodoroManager.resumeCurrentTimer();
                        } catch (error) {
                            console.error('恢复番茄钟运行失败:', error);
                        }
                    }
                }
            );
        } else {
            this.performStartPomodoroCountUp(task);
        }
    }

    private async performStartPomodoro(task: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟');

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, false, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                    showMessage(`已切换任务并继承${phaseText}进度`, 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            const pomodoroTimer = new PomodoroTimer(reminder, settings, false, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);
            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换任务并继承${phaseText}进度`, 2000);
            }
        }
    }

    private async performStartPomodoroCountUp(task: any, inheritState?: any) {
        const settings = await this.plugin.getPomodoroSettings();

        // 检查是否已有独立窗口存在
        const hasStandaloneWindow = this.plugin && this.plugin.pomodoroWindowId;

        if (hasStandaloneWindow) {
            // 如果存在独立窗口，更新独立窗口中的番茄钟
            console.log('检测到独立窗口，更新独立窗口中的番茄钟（正计时模式）');

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            if (typeof this.plugin.openPomodoroWindow === 'function') {
                await this.plugin.openPomodoroWindow(reminder, settings, true, inheritState);

                // 如果继承了状态且原来正在运行，显示继承信息
                if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                    const phaseText = inheritState.isWorkPhase ? t('workTime') : t('breakTime');
                    showMessage(t('switchToStopwatchWithInherit', { phase: phaseText }), 2000);
                } else {
                    showMessage(t('startStopwatchSuccess'), 2000);
                }
            }
        } else {
            // 没有独立窗口，在当前窗口显示番茄钟 Dialog（默认行为）

            // 如果已经有活动的番茄钟，先关闭它
            this.pomodoroManager.closeCurrentTimer();

            const reminder = {
                id: task.id,
                title: task.title,
                blockId: task.blockId,
                isRepeatInstance: false,
                originalId: task.id
            };

            const pomodoroTimer = new PomodoroTimer(reminder, settings, true, inheritState, this.plugin);
            this.pomodoroManager.setCurrentPomodoroTimer(pomodoroTimer);
            pomodoroTimer.show();

            // 如果继承了状态且原来正在运行，显示继承信息
            if (inheritState && inheritState.isRunning && !inheritState.isPaused) {
                const phaseText = inheritState.isWorkPhase ? '工作时间' : '休息时间';
                showMessage(`已切换到正计时模式并继承${phaseText}进度`, 2000);
            } else {
                showMessage("已启动正计时番茄钟", 2000);
            }
        }
    }

    private addCustomStyles() {
        // 检查是否已经添加过样式
        if (document.querySelector('#project-kanban-custom-styles')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'project-kanban-custom-styles';
        style.textContent = `
            .project-kanban-view {
                height: 100%;
                                                display: flex;
                                                flex-direction: column;
                background: var(--b3-theme-background);
            }

            .project-kanban-toolbar {
                display: flex;
                align-items: center;
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                background: var(--b3-theme-surface);
                gap: 16px;
                flex-wrap: wrap;
            }

            .project-kanban-title {
                flex: 1;
            }

            .project-kanban-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
            }

            /* 响应式布局 - 窄屏优化 */
            @media (max-width: 600px) {
                .project-kanban-toolbar {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 12px;
                }

                .project-kanban-title {
                    width: 100%;
                    min-width: auto;
                }

                .project-kanban-controls {
                    width: 100%;
                    justify-content: flex-start;
                    margin-left: 0;
                    gap: 6px;
                }

                .project-kanban-controls .b3-button {
                    flex: 1;
                    min-width: 0;
                    font-size: 12px;
                    padding: 4px 8px;
                }
            }

            @media (max-width: 400px) {
                .project-kanban-toolbar {
                    padding: 8px 12px;
                }

                .project-kanban-title h2 {
                    font-size: 16px;
                }

                .project-kanban-description {
                    font-size: 12px;
                }

                .project-kanban-controls {
                    flex-direction: column;
                    gap: 4px;
                }

                .project-kanban-controls .b3-button {
                    width: 100%;
                    justify-content: center;
                }
            }

            .project-kanban-container {
                flex: 1;
                display: flex;
                gap: 16px;
                padding: 16px;
                overflow-x: auto;
                overflow-y: auto;
                min-height: 0;
                /* 水平滚动布局：每列固定宽度 */
            }

            /* 确保在极窄屏幕上也能正常显示 */
            @media (max-width: 320px) {
                .project-kanban-container {
                    padding: 8px;
                    gap: 8px;
                }
            }

            .kanban-column {
                background: var(--b3-theme-surface);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-border);
                display: flex;
                flex-direction: column;
                min-width: 280px; /* 固定最小宽度 */
                flex: 1; /* 均匀分布宽度 */
                max-height: 100%;
            }

            .kanban-column-header {
                padding: 12px 16px;
                border-bottom: 1px solid var(--b3-theme-border);
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .kanban-column-content {
                flex: 1;
                padding: 8px;
                overflow-y: auto;
                min-height: 200px;
            }

            .kanban-column-count {
                border-radius: 12px;
                padding: 2px 8px;
                font-size: 12px;
                font-weight: 500;
                min-width: 20px;
                text-align: center;
            }

            /* 基础任务卡片样式 */
            .kanban-task {
                background: var(--b3-theme-surface-lighter);
                border: 1px solid var(--b3-theme-border);
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
                cursor: grab;
                transition: all 0.2s ease;
                position: relative;
            }

            .kanban-task:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }

            .kanban-task.dragging {
                opacity: 0.5;
                cursor: grabbing;
            }

            /* 优先级样式美化 - 使用思源主题颜色 */

            .kanban-task-priority-high:hover {
                box-shadow: 0 0 0 1px var(--b3-card-error-color), 0 4px 12px rgba(231, 76, 60, 0.25) !important;
            }


            .kanban-task-priority-medium:hover {
                box-shadow: 0 0 0 1px var(--b3-card-warning-color), 0 4px 12px rgba(243, 156, 18, 0.25) !important;
            }



            .kanban-task-priority-low:hover {
                box-shadow: 0 0 0 1px var(--b3-card-info-color), 0 4px 12px rgba(52, 152, 219, 0.25) !important;
            }

            .kanban-task-title {
                font-weight: 500;
                margin-bottom: 8px;
                color: var(--b3-theme-on-surface);
                line-height: 1.4;
            }

            .kanban-task-info {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .kanban-task-date {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            /* 优先级标签样式 - 参考 project-priority-label */
            .kanban-task-priority {
                display: inline-flex;
                align-items: center;
                gap: 2px;
                padding: 1px 4px;
                border-radius: 3px;
                font-size: 10px;
                font-weight: 500;
                margin-top: 2px;
                width: fit-content;
                align-self: flex-start;
            }

            .priority-label-high {
                background-color: rgba(231, 76, 60, 0.1);
                color: #e74c3c;
            }

            .priority-label-medium {
                background-color: rgba(243, 156, 18, 0.1);
                color: #f39c12;
            }

            .priority-label-low {
                background-color: rgba(52, 152, 219, 0.1);
                color: #3498db;
            }

            .priority-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
            }

            .priority-dot.high {
                background: #e74c3c;
            }

            .priority-dot.medium {
                background: #f39c12;
            }

            .priority-dot.low {
                background: #3498db;
            }

            .priority-dot.none {
                background: #95a5a6;
            }

            .kanban-task-category {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                border-radius: 4px;
                font-size: 11px;
                color: white;
                font-weight: 500;
                align-self: flex-start;
            }

            .kanban-task-note {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.8;
                margin-top: 4px;
                line-height: 1.3;
                max-height: 40px;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 4px 8px;
                background: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-border-color);
                transition: all 0.2s ease;
            }

            /* 优先级任务的备注样式 */
            .kanban-task-priority-high .kanban-task-note {
                background-color: rgba(231, 76, 60, 0.08) !important;
                border-color: rgba(231, 76, 60, 0.2) !important;
                color: var(--b3-card-error-color) !important;
            }

            .kanban-task-priority-medium .kanban-task-note {
                background-color: rgba(243, 156, 18, 0.08) !important;
                border-color: rgba(243, 156, 18, 0.2) !important;
                color: var(--b3-card-warning-color) !important;
            }

            .kanban-task-priority-low .kanban-task-note {
                background-color: rgba(52, 152, 219, 0.08) !important;
                border-color: rgba(52, 152, 219, 0.2) !important;
                color: var(--b3-card-info-color) !important;
            }

            .kanban-drop-zone-active {
                background: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            /* 父子任务拖拽样式 */
            .parent-child-drop-target {
                border: 2px dashed var(--b3-theme-primary) !important;
                background: var(--b3-theme-primary-lightest) !important;
                transform: scale(1.02) !important;
                box-shadow: 0 4px 20px rgba(0, 123, 255, 0.3) !important;
                position: relative;
            }

            .parent-child-indicator {
                animation: fadeInUp 0.2s ease-out;
            }

            @keyframes fadeInUp {
                from {
                    opacity: 0;
                    transform: translateX(-50%) translateY(5px);
                }
                to {
                    opacity: 1;
                    transform: translateX(-50%) translateY(0);
                }
            }

            .parent-child-hint {
                display: flex;
                align-items: center;
                justify-content: center;
            }

            /* 排序拖拽提示样式 */
            .sort-hint {
                animation: fadeInRight 0.2s ease-out;
            }

            @keyframes fadeInRight {
                from {
                    opacity: 0;
                    transform: translateX(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateX(0);
                }
            }

            .reminder-dialog .b3-form__group {
                margin-bottom: 16px;
            }
            .reminder-dialog .b3-form__label {
                display: block;
                margin-bottom: 8px;
                font-weight: 500;
            }
            .priority-selector {
                display: flex;
                gap: 8px;
            }
            .priority-option {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                border-radius: 16px;
                cursor: pointer;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }
            .priority-option:hover {
                background-color: var(--b3-theme-surface-lighter);
            }
            .priority-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }
            .priority-option .priority-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
            }
            .priority-option .priority-dot.high { background-color: #e74c3c; }
            .priority-option .priority-dot.medium { background-color: #f39c12; }
            .priority-option .priority-dot.low { background-color: #3498db; }
            .priority-option .priority-dot.none { background-color: #95a5a6; }
            
            .term-type-selector {
                display: flex;
                gap: 12px;
            }
            .term-type-option {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 16px;
                border-radius: 20px;
                cursor: pointer;
                border: 2px solid var(--b3-theme-border);
                transition: all 0.2s ease;
                background-color: var(--b3-theme-surface);
            }
            .term-type-option:hover {
                background-color: var(--b3-theme-surface-lighter);
                border-color: var(--b3-theme-primary-lighter);
            }
            .term-type-option.selected {
                font-weight: 600;
                border-color: var(--b3-theme-primary);
                background-color: var(--b3-theme-primary-lightest);
                color: var(--b3-theme-primary);
            }

            
            .category-selector .category-option {
                padding: 4px 10px;
                border-radius: 14px;
                cursor: pointer;
                transition: transform 0.15s ease;
                border: 1px solid transparent;
                color: white;
            }
            .category-selector .category-option.selected {
                transform: scale(1.05);
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
                font-weight: bold;
            }
            .category-selector .category-option[data-category=""] {
                background-color: var(--b3-theme-surface-lighter);
                color: var(--b3-theme-on-surface);
            }
            .reminder-date-container {
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .reminder-date-container .b3-text-field {
                flex: 1;
            }
            .reminder-arrow {
                color: var(--b3-theme-on-surface);
                opacity: 0.7;
            }

            .kanban-task-block-info {
                font-size: 11px;
                color: var(--b3-theme-on-background);
                margin-top: 4px;
                opacity: 0.9;
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                background-color: var(--b3-theme-surface-lighter);
                border-radius: 4px;
                border: 1px solid var(--b3-theme-border);
                transition: all 0.2s ease;
            }

            .kanban-task-block-info:hover {
                background-color: var(--b3-theme-primary-lightest);
                border-color: var(--b3-theme-primary);
            }

            .kanban-task-block-info span[data-type="a"] {
                cursor: pointer;
                color: var(--b3-theme-primary);
                text-decoration: underline;
                text-decoration-style: dotted;
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                transition: color 0.2s ease;
            }

            .kanban-task-block-info span[data-type="a"]:hover {
                color: var(--b3-theme-primary-light);
            }

            .kanban-task-pomodoro-count {
                /* Styles for pomodoro count */
            }

            /* 倒计时样式 */
            .countdown-badge {
                font-size: 11px;
                padding: 2px 6px;
                border-radius: 10px;
                font-weight: 500;
                margin-left: 4px;
                display: inline-block;
            }

            .countdown-urgent {
                background-color: rgba(231, 76, 60, 0.15);
                color: #e74c3c;
                border: 1px solid rgba(231, 76, 60, 0.3);
            }

            .countdown-warning {
                background-color: rgba(243, 156, 18, 0.15);
                color: #f39c12;
                border: 1px solid rgba(243, 156, 18, 0.3);
            }

            .countdown-normal {
                background-color: rgba(46, 204, 113, 0.15);
                color: #2ecc71;
                border: 1px solid rgba(46, 204, 113, 0.3);
            }

            /* 过期任务样式 - 复用倒计时样式 */
            .countdown-badge.countdown-normal[style*="rgba(231, 76, 60"] {
                background-color: rgba(231, 76, 60, 0.15) !important;
                color: #e74c3c !important;
                border: 1px solid rgba(231, 76, 60, 0.3) !important;
            }

           .kanban-task-checkbox {
                -webkit-appearance: none;
                appearance: none;
                background-color: var(--b3-theme-surface);
                margin: 0;
                margin-top: 5px; /* 微调对齐 */
                font: inherit;
                color: var(--b3-theme-on-surface);
                width: 1.15em;
                height: 1.15em;
                border: 0.1em solid var(--b3-theme-on-surface);
                border-radius: 0.25em;
                transform: translateY(-0.075em);
                display: grid;
                place-content: center;
                cursor: pointer;
                transition: all 0.2s ease;
                flex-shrink: 0;
            }

           .kanban-task-checkbox:hover {
                border-color: var(--b3-theme-primary);
            }

           .kanban-task-checkbox::before {
                content: "";
                width: 0.65em;
                height: 0.65em;
                transform: scale(0);
                transition: 120ms transform ease-in-out;
                box-shadow: inset 1em 1em var(--b3-theme-primary);
                transform-origin: bottom left;
                clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
            }

           .kanban-task-checkbox:checked {
                background: var(--b3-theme-primary);
                border-color: var(--b3-theme-primary);
            }

           .kanban-task-checkbox:checked::before {
                transform: scale(1);
                box-shadow: inset 1em 1em var(--b3-theme-surface);
            }

           .kanban-task-collapse-btn {
                width: 10px;
                min-width: auto;
                color: var(--b3-theme-on-surface);
                opacity: 0.6;
                display: flex;
                align-items: center;
                justify-content: center;
            }
           .kanban-task-collapse-btn .b3-button__icon {
                margin: 0;
            }
            .kanban-task-collapse-btn svg{
                height: 10px;
                width: 10px;
            }
           .kanban-task-collapse-btn:hover {
                opacity: 1;
                color: var(--b3-theme-primary);
                background: var(--b3-theme-surface-lighter);
            }

           /* 项目标题点击样式 */
           .project-kanban-title h2 {
                cursor: pointer;
                transition: color 0.2s ease;
            }
           
           .project-kanban-title h2:hover {
                color: var(--b3-theme-primary);
            }
           
           .project-kanban-title h2[data-has-note="true"] {
                text-decoration: underline;
                text-decoration-style: dotted;
            }
           
           .project-kanban-title h2[data-has-note="true"]:hover {
                color: var(--b3-theme-primary);
            }
            /* 父任务子任务进度条 */
            .kanban-task-progress-container {
                margin-top: 8px;
            }

            .kanban-task-progress-wrap {
                background: rgba(0,0,0,0.06);
                height: 8px;
                border-radius: 6px;
                overflow: hidden;
            }

            .kanban-task-progress-bar {
                height: 100%;
                background: linear-gradient(90deg, #2ecc71, #27ae60);
                transition: width 0.3s ease;
                border-radius: 6px 0 0 6px;
            }

            .kanban-task-progress-text {
                font-size: 12px;
                color: var(--b3-theme-on-surface);
                opacity: 0.9;
                min-width: 34px;
                text-align: right;
            }

            /* 自定义分组样式 */
            .custom-group-in-status {
                background: var(--b3-theme-surface-lighter);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-border);
            }

            .custom-group-header {
                user-select: none;
            }

            .custom-group-header:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .custom-group-title {
                font-weight: 600 !important;
            }

            .custom-group-collapse-btn {
                width: 16px;
                height: 16px;
                min-width: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .custom-group-collapse-btn:hover {
                opacity: 1;
            }

            .custom-group-collapse-btn svg {
                width: 12px;
                height: 12px;
            }

            .custom-group-tasks {
                transition: all 0.3s ease;
            }

            .status-column-groups {
                padding: 4px;
            }

            /* 自定义分组状态容器样式 */
            .custom-group-status-container {
                padding: 4px;
            }

            .custom-status-group {
                background: var(--b3-theme-surface-lighter);
                border-radius: 8px;
                border: 1px solid var(--b3-theme-border);
            }

            .custom-status-group-header {
                user-select: none;
            }

            .custom-status-group-header:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .custom-status-group-title {
                font-weight: 600 !important;
            }

            .custom-status-group-collapse-btn {
                width: 16px;
                height: 16px;
                min-width: auto;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.7;
                transition: opacity 0.2s ease;
            }

            .custom-status-group-collapse-btn:hover {
                opacity: 1;
            }

            .custom-status-group-collapse-btn svg {
                width: 12px;
                height: 12px;
            }

            .custom-status-group-tasks {
                transition: all 0.3s ease;
            }

            /* 进行中状态组样式区分 */
            .custom-status-doing .custom-status-group-header {
                background: rgba(243, 156, 18, 0.1) !important;
                border-color: rgba(243, 156, 18, 0.3) !important;
            }

            .custom-status-doing .custom-status-group-title {
                color: #f39c12 !important;
            }

            .custom-status-doing .custom-status-group-count {
                background: #f39c12 !important;
            }

            /* 短期状态组样式区分 */
            .custom-status-short_term .custom-status-group-header {
                background: rgba(52, 152, 219, 0.1) !important;
                border-color: rgba(52, 152, 219, 0.3) !important;
            }

            .custom-status-short_term .custom-status-group-title {
                color: #3498db !important;
            }

            .custom-status-short_term .custom-status-group-count {
                background: #3498db !important;
            }

            /* 长期状态组样式区分 */
            .custom-status-long_term .custom-status-group-header {
                background: rgba(155, 89, 182, 0.1) !important;
                border-color: rgba(155, 89, 182, 0.3) !important;
            }

            .custom-status-long_term .custom-status-group-title {
                color: #9b59b6 !important;
            }

            .custom-status-long_term .custom-status-group-count {
                background: #9b59b6 !important;
            }

            /* 已完成状态组样式区分 */
            .custom-status-completed .custom-status-group-header {
                background: rgba(46, 204, 113, 0.1) !important;
                border-color: rgba(46, 204, 113, 0.3) !important;
            }

            .custom-status-completed .custom-status-group-title {
                color: #2ecc71 !important;
            }

            .custom-status-completed .custom-status-group-count {
                background: #2ecc71 !important;
            }

            /* 分组管理对话框样式 */
            .manage-groups-dialog .groups-container {
                border: 1px solid var(--b3-theme-border);
                border-radius: 4px;
                background: var(--b3-theme-surface);
            }

            .group-item:hover {
                background: var(--b3-theme-primary-lightest) !important;
            }

            .color-option {
                position: relative;
            }

            .color-option.selected {
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest);
            }

            .color-option:hover {
                transform: scale(1.1);
            }

            .group-form {
                animation: slideIn 0.3s ease-out;
            }

            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }

            /* 删除分组对话框样式 */
            .delete-group-dialog .b3-radio {
                margin-top: 8px;
            }

            .delete-group-dialog .b3-radio label {
                display: flex;
                align-items: center;
                margin-bottom: 8px;
                cursor: pointer;
            }

            .delete-group-dialog .b3-radio__mark {
                margin-right: 8px;
            }

            /* 看板模式选择下拉框样式 */
            .kanban-mode-select {
                background: var(--b3-theme-surface) !important;
                border: 1px solid var(--b3-theme-border) !important;
                border-radius: 4px !important;
                padding: 6px 8px !important;
                font-size: 14px !important;
                color: var(--b3-theme-on-surface) !important;
                cursor: pointer !important;
                min-width: 140px !important;
                transition: all 0.2s ease !important;
            }

            .kanban-mode-select:hover {
                border-color: var(--b3-theme-primary) !important;
                background: var(--b3-theme-primary-lightest) !important;
            }

            .kanban-mode-select:focus {
                outline: none !important;
                border-color: var(--b3-theme-primary) !important;
                box-shadow: 0 0 0 2px var(--b3-theme-primary-lightest) !important;
            }

            .kanban-mode-select option {
                background: var(--b3-theme-surface) !important;
                color: var(--b3-theme-on-surface) !important;
                padding: 4px 8px !important;
            }
            `;
        document.head.appendChild(style);
    }
    private renderCategorySelector(container: HTMLElement, defaultCategoryId?: string) {
        container.innerHTML = '';
        const categories = this.categoryManager.getCategories();

        const noCategoryEl = document.createElement('div');
        noCategoryEl.className = 'category-option';
        noCategoryEl.setAttribute('data-category', '');
        noCategoryEl.innerHTML = `<span>无分类</span>`;
        if (!defaultCategoryId) {
            noCategoryEl.classList.add('selected');
        }
        container.appendChild(noCategoryEl);

        categories.forEach(category => {
            const categoryEl = document.createElement('div');
            categoryEl.className = 'category-option';
            categoryEl.setAttribute('data-category', category.id);
            categoryEl.style.backgroundColor = category.color;
            categoryEl.innerHTML = `<span>${category.icon ? category.icon + ' ' : ''}${category.name}</span>`;
            if (category.id === defaultCategoryId) {
                categoryEl.classList.add('selected');
            }
            container.appendChild(categoryEl);
        });

        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const option = target.closest('.category-option') as HTMLElement;
            if (option) {
                container.querySelectorAll('.category-option').forEach(opt => opt.classList.remove('selected'));
                option.classList.add('selected');
            }
        });
    }

    // 设置任务优先级
    private async setPriority(task: any, priority: string) {
        try {
            const reminderData = await readReminderData();

            // 如果是重复实例，修改实例的优先级
            if (task.isRepeatInstance && task.originalId) {
                const originalReminder = reminderData[task.originalId];
                if (!originalReminder) {
                    showMessage("原始任务不存在");
                    return;
                }

                // 初始化实例修改结构
                if (!originalReminder.repeat) {
                    originalReminder.repeat = {};
                }
                if (!originalReminder.repeat.instanceModifications) {
                    originalReminder.repeat.instanceModifications = {};
                }
                if (!originalReminder.repeat.instanceModifications[task.date]) {
                    originalReminder.repeat.instanceModifications[task.date] = {};
                }

                // 设置实例的优先级
                originalReminder.repeat.instanceModifications[task.date].priority = priority;

                await writeReminderData(reminderData);
                showMessage("实例优先级已更新");
            } else {
                // 普通任务或原始重复事件，直接修改
                if (reminderData[task.id]) {
                    reminderData[task.id].priority = priority;

                    // 如果是重复事件，清除所有实例的优先级覆盖
                    if (reminderData[task.id].repeat?.enabled && reminderData[task.id].repeat?.instanceModifications) {
                        const modifications = reminderData[task.id].repeat.instanceModifications;
                        Object.keys(modifications).forEach(date => {
                            if (modifications[date].priority !== undefined) {
                                delete modifications[date].priority;
                            }
                        });
                    }

                    await writeReminderData(reminderData);
                    showMessage("优先级已更新");
                } else {
                    showMessage("任务不存在");
                    return;
                }
            }

            await this.queueLoadTasks();
            window.dispatchEvent(new CustomEvent('reminderUpdated'));
        } catch (error) {
            console.error('设置优先级失败:', error);
            showMessage("设置优先级失败");
        }
    }

    // 复制块引用
    private async copyBlockRef(task: any) {
        try {
            const blockId = task.blockId;
            if (!blockId) {
                showMessage("无法获取块ID");
                return;
            }

            const title = task.title || "未命名任务";
            const blockRef = `((${blockId} "${title}"))`;

            await navigator.clipboard.writeText(blockRef);
            showMessage("块引用已复制到剪贴板");
        } catch (error) {
            console.error('复制块引用失败:', error);
            showMessage("复制块引用失败");
        }
    }

    // 显示绑定到块的对话框（支持绑定现有块或创建新文档并绑定）
    private showBindToBlockDialog(reminder: any) {
        const dialog = new Dialog({
            title: t("bindReminderToBlock"),
            content: `
                <div class="bind-to-block-dialog">
                    <div class="b3-dialog__content">
                        <div class="mode-toggle" style="margin-bottom: 16px;">
                            <button id="bindExistingBtn" class="b3-button b3-button--outline mode-btn active" style="margin-right: 8px;">
                                绑定现有块
                            </button>
                            <button id="createNewBtn" class="b3-button b3-button--outline mode-btn">
                                ${t("createNewDocument")}
                            </button>
                        </div>

                        <div id="bindExistingPanel" class="mode-panel">
                            <div class="b3-form__group">
                                <label class="b3-form__label">输入块ID</label>
                                <div class="b3-form__desc">支持块ID或块引用格式，如：((blockId '标题'))</div>
                                <input type="text" id="blockIdInput" class="b3-text-field" placeholder="请输入块ID或粘贴块引用" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group" id="selectedBlockInfo" style="display: none;">
                                <label class="b3-form__label">块信息预览</label>
                                <div id="blockContent" class="block-content-preview" style="
                                    padding: 8px;
                                    background-color: var(--b3-theme-surface-lighter);
                                    border-radius: 4px;
                                    border: 1px solid var(--b3-theme-border);
                                    max-height: 100px;
                                    overflow-y: auto;
                                    font-size: 12px;
                                    color: var(--b3-theme-on-surface);
                                "></div>
                            </div>
                        </div>

                        <div id="createNewPanel" class="mode-panel" style="display: none;">
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档标题</label>
                                <input type="text" id="docTitleInput" class="b3-text-field" placeholder="请输入文档标题" style="width: 100%; margin-top: 8px;">
                            </div>
                            <div class="b3-form__group">
                                <label class="b3-form__label">文档内容（可选）</label>
                                <textarea id="docContentInput" class="b3-text-field" placeholder="请输入文档内容" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                            </div>
                        </div>
                    </div>
                    <div class="b3-dialog__action">
                        <button class="b3-button b3-button--cancel" id="bindCancelBtn">${t("cancel")}</button>
                        <button class="b3-button b3-button--primary" id="bindConfirmBtn">${t("bindToBlock")}</button>
                    </div>
                </div>
            `,
            width: "500px",
            height: "400px"
        });

        // 获取DOM元素
        const bindExistingBtn = dialog.element.querySelector('#bindExistingBtn') as HTMLButtonElement;
        const createNewBtn = dialog.element.querySelector('#createNewBtn') as HTMLButtonElement;
        const bindExistingPanel = dialog.element.querySelector('#bindExistingPanel') as HTMLElement;
        const createNewPanel = dialog.element.querySelector('#createNewPanel') as HTMLElement;

        const blockIdInput = dialog.element.querySelector('#blockIdInput') as HTMLInputElement;
        const selectedBlockInfo = dialog.element.querySelector('#selectedBlockInfo') as HTMLElement;
        const blockContentEl = dialog.element.querySelector('#blockContent') as HTMLElement;

        const docTitleInput = dialog.element.querySelector('#docTitleInput') as HTMLInputElement;
        const docContentInput = dialog.element.querySelector('#docContentInput') as HTMLTextAreaElement;

        const cancelBtn = dialog.element.querySelector('#bindCancelBtn') as HTMLButtonElement;
        const confirmBtn = dialog.element.querySelector('#bindConfirmBtn') as HTMLButtonElement;

        let currentMode = 'existing';

        // 模式切换事件
        bindExistingBtn.addEventListener('click', () => {
            currentMode = 'existing';
            bindExistingBtn.classList.add('active');
            createNewBtn.classList.remove('active');
            bindExistingPanel.style.display = 'block';
            createNewPanel.style.display = 'none';
            confirmBtn.textContent = t("bindToBlock");
        });

        createNewBtn.addEventListener('click', () => {
            currentMode = 'create';
            createNewBtn.classList.add('active');
            bindExistingBtn.classList.remove('active');
            createNewPanel.style.display = 'block';
            bindExistingPanel.style.display = 'none';
            confirmBtn.textContent = t("createDocumentAndBind");

            // 自动填充标题
            if (!docTitleInput.value && reminder.title) {
                docTitleInput.value = reminder.title;
            }
        });

        // 监听块ID输入变化
        blockIdInput.addEventListener('input', async () => {
            const inputValue = blockIdInput.value.trim();

            // 尝试从输入内容中提取块ID（支持块引用格式）
            let blockId = this.extractBlockIdFromText(inputValue);

            // 如果没有匹配到块引用格式，则将输入作为纯块ID使用
            if (!blockId) {
                blockId = inputValue;
            }

            if (blockId && blockId.length >= 20) { // 块ID通常是20位字符
                try {
                    const block = await getBlockByID(blockId);
                    if (block) {
                        const blockContent = block.content || block.fcontent || '未命名块';
                        blockContentEl.textContent = blockContent;
                        selectedBlockInfo.style.display = 'block';
                    } else {
                        selectedBlockInfo.style.display = 'none';
                    }
                } catch (error) {
                    selectedBlockInfo.style.display = 'none';
                }
            } else {
                selectedBlockInfo.style.display = 'none';
            }
        });

        // 取消按钮
        cancelBtn.addEventListener('click', () => {
            dialog.destroy();
        });

        // 确认按钮
        confirmBtn.addEventListener('click', async () => {
            if (currentMode === 'existing') {
                // 绑定现有块模式
                const inputValue = blockIdInput.value.trim();
                if (!inputValue) {
                    showMessage('请输入块ID');
                    return;
                }

                // 尝试从输入内容中提取块ID（支持块引用格式）
                let blockId = this.extractBlockIdFromText(inputValue);

                // 如果没有匹配到块引用格式，则将输入作为纯块ID使用
                if (!blockId) {
                    blockId = inputValue;
                }

                if (!blockId || blockId.length < 20) {
                    showMessage('请输入有效的块ID或块引用');
                    return;
                }

                try {
                    await this.bindReminderToBlock(reminder, blockId);
                    showMessage(t("reminderBoundToBlock"));
                    dialog.destroy();
                    this.queueLoadTasks();
                } catch (error) {
                    console.error('绑定提醒到块失败:', error);
                    showMessage(t("bindToBlockFailed"));
                }
            } else {
                // 创建新文档模式
                const title = docTitleInput.value.trim();
                const content = docContentInput.value.trim();

                if (!title) {
                    showMessage(t("pleaseEnterTitle"));
                    return;
                }

                try {
                    await this.createDocumentAndBind(reminder, title, content);
                    showMessage(t("documentCreatedAndBound"));
                    dialog.destroy();
                    this.queueLoadTasks();
                } catch (error) {
                    console.error('创建文档并绑定失败:', error);
                    showMessage(t("createDocumentFailed"));
                }
            }
        });

        // 自动聚焦输入框
        setTimeout(() => {
            if (currentMode === 'existing') {
                blockIdInput.focus();
            } else {
                docTitleInput.focus();
            }
        }, 100);
    }


    /**
     * 创建文档并绑定提醒（复用 ReminderPanel 中实现）
     */
    private async createDocumentAndBind(reminder: any, title: string, content: string): Promise<string> {
        try {
            // 获取插件设置
            const settings = await this.plugin.loadSettings();
            const notebook = settings.newDocNotebook;
            const pathTemplate = settings.newDocPath || '/{{now | date "2006/200601"}}/';

            if (!notebook) {
                throw new Error(t("pleaseConfigureNotebook"));
            }

            // 导入API函数
            const { renderSprig, createDocWithMd } = await import("../api");

            // 渲染路径模板
            let renderedPath: string;
            try {
                // 需要检测pathTemplate是否以/结尾，如果不是，则添加/
                if (!pathTemplate.endsWith('/')) {
                    renderedPath = pathTemplate + '/';
                } else {
                    renderedPath = pathTemplate;
                }
                renderedPath = await renderSprig(renderedPath + title);
            } catch (error) {
                console.error('渲染路径模板失败:', error);
                throw new Error(t("renderPathFailed"));
            }

            // 准备文档内容
            const docContent = content;

            // 创建文档
            const docId = await createDocWithMd(notebook, renderedPath, docContent);
            await refreshSql();
            // 绑定提醒到新创建的文档
            await this.bindReminderToBlock(reminder, docId);

            return docId;
        } catch (error) {
            console.error('创建文档并绑定失败:', error);
            throw error;
        }
    }

    /**
     * 将提醒绑定到指定的块（adapted from ReminderPanel）
     */
    private async bindReminderToBlock(reminder: any, blockId: string) {
        try {
            const reminderData = await readReminderData();
            const reminderId = reminder.isRepeatInstance ? reminder.originalId : reminder.id;

            if (reminderData[reminderId]) {
                // 获取块信息
                const block = await getBlockByID(blockId);
                if (!block) {
                    throw new Error('目标块不存在');
                }

                // 更新提醒数据
                reminderData[reminderId].blockId = blockId;
                reminderData[reminderId].docId = block.root_id || blockId;
                reminderData[reminderId].isQuickReminder = false; // 移除快速提醒标记

                await writeReminderData(reminderData);

                // 将绑定的块添加项目ID属性 custom-task-projectId
                const projectId = reminderData[reminderId].projectId;
                if (projectId) {
                    const { addBlockProjectId } = await import('../api');
                    await addBlockProjectId(blockId, projectId);
                    console.debug('ProjectKanbanView: bindReminderToBlock - 已为块设置项目ID', blockId, projectId);
                }

                // 更新块的书签状态（添加⏰书签）
                await updateBlockReminderBookmark(blockId);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            } else {
                throw new Error('提醒不存在');
            }
        } catch (error) {
            console.error('绑定提醒到块失败:', error);
            throw error;
        }
    }


    /**
     * 打开块标签页
     * @param blockId 块ID
     */
    private async openBlockTab(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开块失败:', error);

            // 询问用户是否删除无效的绑定
            await confirm(
                "打开块失败",
                "绑定的块可能已被删除，是否解除绑定？",
                async () => {
                    // 解除任务的块绑定
                    await this.unbindTaskFromBlock(blockId);
                },
                () => {
                    showMessage("打开块失败");
                }
            );
        }
    }

    /**
     * 打开项目笔记
     * @param blockId 项目笔记的块ID
     */
    private async openProjectNote(blockId: string) {
        try {
            openBlock(blockId);
        } catch (error) {
            console.error('打开项目笔记失败:', error);
            showMessage("打开项目笔记失败");
        }
    }

    /**
     * 解除任务与块的绑定
     * @param blockId 块ID
     */
    private async unbindTaskFromBlock(blockId: string) {
        try {
            const reminderData = await readReminderData();
            let unboundCount = 0;

            // 找到所有绑定到该块的任务并解除绑定
            Object.keys(reminderData).forEach(taskId => {
                const task = reminderData[taskId];
                if (task && task.blockId === blockId) {
                    delete task.blockId;
                    delete task.docId;
                    unboundCount++;
                }
            });

            if (unboundCount > 0) {
                await writeReminderData(reminderData);

                // 触发更新事件
                window.dispatchEvent(new CustomEvent('reminderUpdated'));

                showMessage(`已解除 ${unboundCount} 个任务的块绑定`);
                await this.queueLoadTasks();
            } else {
                showMessage("未找到相关的任务绑定");
            }
        } catch (error) {
            console.error('解除块绑定失败:', error);
            showMessage("解除块绑定失败");
        }
    }

    private getTaskFromElement(element: HTMLElement): any {
        const taskId = element.dataset.taskId;
        if (!taskId) return null;
        return this.tasks.find(t => t.id === taskId);
    }

    private canDropForSort(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 情况1：同级顶层任务之间排序
        if (!draggedTask.parentId && !targetTask.parentId) {
            // 允许跨优先级拖拽，后续在 reorderTasks 中会自动更新优先级
            return true;
        }

        // 情况2：子任务之间排序（同一个父任务下）
        if (draggedTask.parentId && targetTask.parentId) {
            return draggedTask.parentId === targetTask.parentId;
        }

        // 情况3：不允许顶层任务与子任务之间排序
        return false;
    }

    /**
     * Checks if a dragged task can become a sibling of a target task.
     * This is true if the target is a subtask and the dragged task is not an ancestor of the target.
     * @param draggedTask The task being dragged
     * @param targetTask The drop target task
     * @returns boolean
     */
    private canBecomeSiblingOf(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // Target task must be a subtask to define a sibling context.
        if (!targetTask.parentId) return false;

        // Dragged task cannot be the same as the target task.
        if (draggedTask.id === targetTask.id) return false;

        // Dragged task cannot be the parent of the target task.
        if (draggedTask.id === targetTask.parentId) return false;

        // If dragged task is already a sibling, this case is handled by canDropForSort.
        if (draggedTask.parentId === targetTask.parentId) return false;

        // To prevent circular dependencies, the dragged task cannot be an ancestor of the target task.
        if (this.isDescendant(targetTask, draggedTask)) return false;

        return true;
    }

    /**
     * 检查是否可以设置父子任务关系
     * @param draggedTask 被拖拽的任务
     * @param targetTask 目标任务（潜在的父任务）
     * @returns 是否可以设置为父子关系
     */
    private canSetAsParentChild(draggedTask: any, targetTask: any): boolean {
        if (!draggedTask || !targetTask) return false;

        // 不能将任务拖拽到自己身上
        if (draggedTask.id === targetTask.id) return false;

        // 如果两个任务都是子任务且属于同一个父任务，不显示父子关系提示
        // （应该显示排序提示）
        if (draggedTask.parentId && targetTask.parentId &&
            draggedTask.parentId === targetTask.parentId) {
            return false;
        }

        // 不能将父任务拖拽到自己的子任务上（防止循环依赖）
        if (this.isDescendant(targetTask, draggedTask)) return false;

        // 不能将任务拖拽到已经是其父任务的任务上
        if (draggedTask.parentId === targetTask.id) return false;

        return true;
    }

    /**
     * 检查 potential_child 是否是 potential_parent 的后代
     * @param potentialChild 潜在的子任务
     * @param potentialParent 潜在的父任务
     * @returns 是否是后代关系
     */
    private isDescendant(potentialChild: any, potentialParent: any): boolean {
        if (!potentialChild || !potentialParent) return false;

        let currentTask = potentialChild;
        const visited = new Set(); // 防止无限循环

        while (currentTask && currentTask.parentId && !visited.has(currentTask.id)) {
            visited.add(currentTask.id);

            if (currentTask.parentId === potentialParent.id) {
                return true;
            }

            // 查找父任务
            currentTask = this.tasks.find(t => t.id === currentTask.parentId);
        }

        return false;
    }

    /**
     * 统一的指示器更新方法，避免频繁的DOM操作导致闪烁
     * @param type 指示器类型
     * @param target 目标元素
     * @param position 位置
     * @param event 可选的拖拽事件
     */
    private updateIndicator(
        type: 'none' | 'sort' | 'parentChild',
        target: HTMLElement | null,
        position: 'top' | 'bottom' | 'middle' | null,
        event?: DragEvent
    ) {
        // 检查是否需要更新
        const needsUpdate = this.currentIndicatorType !== type ||
            this.currentIndicatorTarget !== target ||
            this.currentIndicatorPosition !== position;

        if (!needsUpdate) {
            return; // 状态没有改变，不需要更新
        }

        // 清除现有的所有指示器
        this.clearAllIndicators();

        // 更新状态
        this.currentIndicatorType = type;
        this.currentIndicatorTarget = target;
        this.currentIndicatorPosition = position;

        // 显示新的指示器
        switch (type) {
            case 'sort':
                if (target && event) {
                    this.createSortIndicator(target, event);
                }
                break;
            case 'parentChild':
                if (target && position === 'top') {
                    this.createParentChildIndicator(target, 'top');
                } else if (target) {
                    this.createParentChildIndicator(target);
                }
                break;
            case 'none':
            default:
                // 已经清除了所有指示器，无需额外操作
                break;
        }
    }

    /**
     * 清除所有指示器
     */
    private clearAllIndicators() {
        // 移除排序指示器
        this.container.querySelectorAll('.drop-indicator').forEach(indicator => indicator.remove());

        // 移除父子关系指示器
        this.container.querySelectorAll('.parent-child-indicator').forEach(indicator => indicator.remove());
        this.container.querySelectorAll('.parent-child-drop-target').forEach(el => {
            el.classList.remove('parent-child-drop-target');
        });

        // 重置position样式
        this.container.querySelectorAll('.kanban-task').forEach((el: HTMLElement) => {
            if (el.style.position === 'relative') {
                el.style.position = '';
            }
        });
    }

    /**
     * 创建排序指示器
     * @param element 目标元素
     * @param event 拖拽事件
     */
    private createSortIndicator(element: HTMLElement, event: DragEvent) {
        const rect = element.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;

        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.style.cssText = `
            position: absolute;
            left: 0;
            right: 0;
            height: 2px;
            background-color: var(--b3-theme-primary);
            z-index: 1000;
            pointer-events: none;
            box-shadow: 0 0 4px var(--b3-theme-primary);
        `;

        element.style.position = 'relative';

        if (event.clientY < midpoint) {
            indicator.style.top = '-1px';
        } else {
            indicator.style.bottom = '-1px';
        }

        // 不再添加排序提示文字，只显示蓝色指示线
        element.appendChild(indicator);
    }

    /**
     * 创建父子任务指示器
     * @param element 目标元素
     */
    /**
     * 创建父子任务指示器，支持指定位置
     */
    private createParentChildIndicator(element: HTMLElement, _position: 'top' | 'middle' = 'middle') {
        element.classList.add('parent-child-drop-target');

    }

    /**
     * 处理父子任务拖拽放置
     * @param targetTask 目标任务（将成为父任务）
     */
    private async handleParentChildDrop(targetTask: any) {
        if (!this.draggedTask) return;

        try {
            await this.setParentChildRelation(this.draggedTask, targetTask);
            showMessage(`"${this.draggedTask.title}" 已设置为 "${targetTask.title}" 的子任务`);
        } catch (error) {
            // showMessage("设置父子任务关系失败");
        }
    }

    /**
     * 设置任务的父子关系
     * @param childTask 子任务
     * @param parentTask 父任务
     */
    private async setParentChildRelation(childTask: any, parentTask: any) {
        try {
            const reminderData = await readReminderData();

            if (!reminderData[childTask.id]) {
                throw new Error("子任务不存在");
            }

            if (!reminderData[parentTask.id]) {
                throw new Error("父任务不存在");
            }

            // 设置子任务的父任务ID
            reminderData[childTask.id].parentId = parentTask.id;

            // 子任务继承父任务的状态（如果父任务是进行中状态）
            const parentStatus = this.getTaskStatus(reminderData[parentTask.id]);
            if (parentStatus === 'doing' && !reminderData[childTask.id].completed) {
                reminderData[childTask.id].kanbanStatus = 'doing';
            }

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            // 重新加载任务以更新显示（防抖）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('设置父子关系失败:', error);
            throw error;
        }
    }

    /**
     * 解除任务的父子关系
     * @param childTask 子任务
     */
    private async unsetParentChildRelation(childTask: any) {
        try {
            const reminderData = await readReminderData();

            if (!reminderData[childTask.id]) {
                throw new Error("任务不存在");
            }

            if (!childTask.parentId) {
                return; // 没有父任务，不需要解除关系
            }

            // 查找父任务的标题用于提示
            const parentTask = reminderData[childTask.parentId];
            const parentTitle = parentTask ? parentTask.title : '未知任务';

            // 移除父任务ID
            delete reminderData[childTask.id].parentId;

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

            showMessage(`"${childTask.title}" 已从 "${parentTitle}" 中独立出来`);

            // 重新加载任务以更新显示（防抖）
            await this.queueLoadTasks();
        } catch (error) {
            console.error('解除父子关系失败:', error);
            showMessage("解除父子关系失败");
        }
    }

    private async handleSortDrop(targetTask: any, event: DragEvent) {
        if (!this.draggedTask) return;

        try {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            await this.reorderTasks(this.draggedTask, targetTask, insertBefore);

            showMessage("排序已更新");
            // 重新加载由 reorderTasks 中派发的 'reminderUpdated' 事件触发，此处无需重复调用
        } catch (error) {
            console.error('处理拖放排序失败:', error);
            showMessage("排序更新失败");
        }
    }

    /**
     * Handles the drop event for making a task a sibling of another and sorting it.
     * @param draggedTask The task that was dragged
     * @param targetTask The task that was the drop target
     * @param event The drop event
     */
    private async handleBecomeSiblingDrop(draggedTask: any, targetTask: any, event: DragEvent) {
        if (!draggedTask || !targetTask || !targetTask.parentId) return;

        try {
            const reminderData = await readReminderData();
            const draggedTaskInDb = reminderData[draggedTask.id];
            if (!draggedTaskInDb) {
                throw new Error("Dragged task not found in data");
            }

            const newParentId = targetTask.parentId;
            const parentTaskInDb = reminderData[newParentId];
            if (!parentTaskInDb) {
                throw new Error("Parent task not found in data");
            }

            // 1. Set parentId for the dragged task
            draggedTaskInDb.parentId = newParentId;

            // 如果父任务属于某个自定义分组，则将被拖拽任务的 customGroupId 同步为父任务的分组
            try {
                const parentGroup = parentTaskInDb.customGroupId === undefined ? null : parentTaskInDb.customGroupId;
                if (parentGroup === null) {
                    delete draggedTaskInDb.customGroupId;
                } else {
                    draggedTaskInDb.customGroupId = parentGroup;
                }
            } catch (err) {
                // 忽略分组同步错误，继续执行父子关系设置
            }

            // 2. A sub-task inherits the status of its parent (or more accurately, its root parent)
            const parentStatus = this.getTaskStatus(parentTaskInDb);
            if (parentStatus === 'doing' && !draggedTaskInDb.completed) {
                draggedTaskInDb.kanbanStatus = 'doing';
            } else if (!draggedTaskInDb.completed) {
                // If parent is not 'doing', child becomes 'todo'
                draggedTaskInDb.kanbanStatus = 'todo';
            }

            // 3. Reorder siblings
            // Get all new siblings, EXCEPT the dragged task itself
            const siblingTasks = Object.values(reminderData)
                .filter((r: any) => r && r.parentId === newParentId && r.id !== draggedTask.id)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            // Determine insertion point
            // Use event.target instead of event.currentTarget to avoid null reference
            const targetElement = event.target as HTMLElement;
            if (!targetElement) {
                throw new Error("Event target is null");
            }

            // Find the task element that contains the target
            let taskElement = targetElement.closest('.kanban-task') as HTMLElement;
            if (!taskElement) {
                throw new Error("Could not find task element");
            }

            const rect = taskElement.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const insertBefore = event.clientY < midpoint;

            const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetTask.id);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            // Insert the dragged task into the siblings list
            siblingTasks.splice(insertIndex, 0, draggedTaskInDb);

            // Re-assign sort values
            siblingTasks.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('Failed to set task as sibling and sort:', error);
            showMessage("移动任务失败");
        }
    }

    private async reorderTasks(draggedTask: any, targetTask: any, insertBefore: boolean) {
        try {
            const reminderData = await readReminderData();

            const draggedId = draggedTask.id;
            const targetId = targetTask.id;

            const draggedTaskInDb = reminderData[draggedId];
            const targetTaskInDb = reminderData[targetId];

            if (!draggedTaskInDb || !targetTaskInDb) {
                throw new Error("Task not found in data");
            }

            const oldStatus = this.getTaskStatus(draggedTaskInDb);
            const newStatus = this.getTaskStatus(targetTaskInDb);

            // 如果当前为自定义分组看板模式，且目标任务所在分组与被拖拽任务不同，
            // 则将被拖拽任务移动到目标任务的分组（上下放置时也应修改分组）并在该分组内重新排序
            if (this.kanbanMode === 'custom') {
                const draggedGroup = draggedTaskInDb.customGroupId === undefined ? null : draggedTaskInDb.customGroupId;
                const targetGroup = targetTaskInDb.customGroupId === undefined ? null : targetTaskInDb.customGroupId;

                // 如果分组不同，先更新分组字段
                if (draggedGroup !== targetGroup) {
                    if (targetGroup === null) {
                        delete reminderData[draggedId].customGroupId;
                    } else {
                        reminderData[draggedId].customGroupId = targetGroup;
                    }
                }

                // --- [新增逻辑] 检查优先级变更 ---
                const oldPriority = draggedTaskInDb.priority || 'none';
                const targetPriority = targetTaskInDb.priority || 'none';
                let newPriority = oldPriority;

                // 即使在自定义分组视图中，如果拖拽到了不同优先级的任务旁边，也更新优先级
                if (oldPriority !== targetPriority) {
                    newPriority = targetPriority;
                    draggedTaskInDb.priority = newPriority;
                }

                // 根据完成状态选择子容器（incomplete/completed）来排序
                const isCompleted = !!reminderData[draggedId].completed;

                // 重新计算源分组的排序（如果分组发生变化 或 优先级发生变化）
                // 解释：如果优先级变了，虽然它还在同一个"自定义分组"里，但可能影响了原逻辑上的排序稳定性，
                // 不过在自定义分组视图里，通常是按所有任务混排或按状态排。
                // 这里的 sourceList 逻辑主要是为了填补移走后的空缺重新排序，保证 continuous。
                // 既然移走了，不管是换分组了还是仅仅在同组内通过 reorder，下面的 targetList 处理负责新位置。
                // sourceList 负责清理旧位置（如果是跨组移动）。
                // 如果只是同组内移动，sourceList 其实就是 targetList（除了被剔除的自己）。
                // 但为了简单，如果分组变了才处理 sourceList 清理。
                // 如果仅优先级变了但组没变，sourceList 和 targetList 指向同一个集合，
                // 下面的 targetList 逻辑中 .filter(... id !== draggedId) 已经把旧的排除了，所以没问题。
                if (draggedGroup !== targetGroup) {
                    const sourceList = Object.values(reminderData)
                        .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && ((r.customGroupId === undefined) ? null : r.customGroupId) === draggedGroup)
                        .filter((r: any) => !!r.completed === isCompleted) // 保持完成/未完成子分组一致
                        .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                    sourceList.forEach((t: any, index: number) => {
                        reminderData[t.id].sort = index * 10;
                    });
                }

                // 目标分组列表（同一完成/未完成子组）
                // 注意：在自定义分组视图中，通常是按 sort 排序显示的。
                // 优先级变更已经直接修改了 draggedTaskInDb 对象。
                const targetList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && ((r.customGroupId === undefined) ? null : r.customGroupId) === targetGroup)
                    .filter((r: any) => !!r.completed === isCompleted)
                    .filter((r: any) => r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : (targetIndex === -1 ? targetList.length : targetIndex + 1);

                targetList.splice(insertIndex, 0, reminderData[draggedId]);

                targetList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                return;
            }

            // 检查是否为子任务排序
            const isSubtaskReorder = draggedTaskInDb.parentId && targetTaskInDb.parentId &&
                draggedTaskInDb.parentId === targetTaskInDb.parentId;

            if (isSubtaskReorder) {
                // 子任务排序逻辑
                const parentId = draggedTaskInDb.parentId;

                // 获取同一父任务下的所有子任务
                const siblingTasks = Object.values(reminderData)
                    .filter((r: any) => r && r.parentId === parentId && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                const targetIndex = siblingTasks.findIndex((t: any) => t.id === targetId);
                const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

                // 插入被拖拽的任务
                siblingTasks.splice(insertIndex, 0, draggedTaskInDb);

                // 重新分配排序值
                siblingTasks.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });

                await writeReminderData(reminderData);
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
                return; // 子任务排序完成，直接返回
            }

            // 顶层任务排序逻辑
            const oldPriority = draggedTaskInDb.priority || 'none';
            const targetPriority = targetTaskInDb.priority || 'none';
            let newPriority = oldPriority;

            // 检查优先级变更 - 如果拖拽到不同优先级任务的上方或下方，自动变更优先级
            if (oldPriority !== targetPriority) {
                newPriority = targetPriority;
                draggedTaskInDb.priority = newPriority;
            }

            // --- Update status of dragged task ---
            if (oldStatus !== newStatus) {
                if (newStatus === 'done') {
                    draggedTaskInDb.completed = true;
                    draggedTaskInDb.completedTime = getLocalDateTimeString(new Date());
                } else {
                    draggedTaskInDb.completed = false;
                    delete draggedTaskInDb.completedTime;
                    draggedTaskInDb.kanbanStatus = newStatus;
                }
            }

            // --- Reorder source list (if status or priority changed) ---
            if (oldStatus !== newStatus || oldPriority !== newPriority) {
                const sourceList = Object.values(reminderData)
                    .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === oldStatus && (r.priority || 'none') === oldPriority && r.id !== draggedId)
                    .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

                sourceList.forEach((task: any, index: number) => {
                    reminderData[task.id].sort = index * 10;
                });
            }

            // --- Reorder target list ---
            // Target list defined by NEW status and NEW priority (which matches targetPriority)
            const targetList = Object.values(reminderData)
                .filter((r: any) => r && r.projectId === this.projectId && !r.parentId && this.getTaskStatus(r) === newStatus && (r.priority || 'none') === newPriority && r.id !== draggedId)
                .sort((a: any, b: any) => (a.sort || 0) - (b.sort || 0));

            const targetIndex = targetList.findIndex((t: any) => t.id === targetId);
            const insertIndex = insertBefore ? targetIndex : targetIndex + 1;

            targetList.splice(insertIndex, 0, draggedTaskInDb);

            targetList.forEach((task: any, index: number) => {
                reminderData[task.id].sort = index * 10;
            });

            await writeReminderData(reminderData);
            window.dispatchEvent(new CustomEvent('reminderUpdated'));

        } catch (error) {
            console.error('重新排序任务失败:', error);
            throw error;
        }
    }

    /**
     * 递归收集指定父任务的所有直接子任务和后代，保持原有的任务顺序。
     * 返回一个按层级组织的节点数组，节点包含 task 对象和 level。
     */
    private collectChildrenRecursively(parentId: string): Array<{ task: any; level: number }> {
        const result: Array<{ task: any; level: number }> = [];

        const children = this.tasks.filter(t => t.parentId === parentId);

        const walk = (items: any[], level: number) => {
            for (const it of items) {
                result.push({ task: it, level });
                const sub = this.tasks.filter(t => t.parentId === it.id);
                if (sub && sub.length > 0) {
                    walk(sub, level + 1);
                }
            }
        };

        walk(children, 0);
        return result;
    }

    /**
     * 编辑周期任务的单个实例
     */
    private async editInstanceReminder(task: any) {
        try {
            const reminderData = await readReminderData();
            const originalReminder = reminderData[task.originalId];

            if (!originalReminder) {
                showMessage("原始周期事件不存在");
                return;
            }

            // 从 instanceId (格式: originalId_YYYY-MM-DD) 中提取原始生成日期
            const originalInstanceDate = task.id ? task.id.split('_').pop() : task.date;

            // 检查实例级别的修改（包括备注）
            const instanceModifications = originalReminder.repeat?.instanceModifications || {};
            const instanceMod = instanceModifications[originalInstanceDate];

            // 创建实例数据，包含当前实例的特定信息
            const instanceData = {
                ...originalReminder,
                id: task.id,
                date: task.date,
                endDate: task.endDate,
                time: task.time,
                endTime: task.endTime,
                note: instanceMod?.note || originalReminder.note || '',  // 复用原始事件备注，实例修改优先
                isInstance: true,
                originalId: task.originalId,
                instanceDate: originalInstanceDate  // 使用原始生成日期而非当前显示日期
            };

            // 优化：只通过 reminderUpdated 事件触发刷新，避免重复更新
            // 事件监听器会调用 queueLoadTasks() 进行防抖刷新
            const callback = () => {
                window.dispatchEvent(new CustomEvent('reminderUpdated'));
            };

            const editDialog = new QuickReminderDialog(
                undefined,
                undefined,
                callback,
                undefined,
                {
                    mode: 'edit',
                    reminder: instanceData,
                    plugin: this.plugin,
                    isInstanceEdit: true
                }
            );
            editDialog.show();
        } catch (error) {
            console.error('打开实例编辑对话框失败:', error);
            showMessage("打开编辑对话框失败");
        }
    }

    /**
     * 删除周期任务的单个实例
     */
    private async deleteInstanceOnly(task: any) {
        await confirm(
            t('deleteThisInstance'),
            t('confirmDeleteInstanceOf', { title: task.title, date: task.date }),
            async () => {
                try {
                    const originalId = task.originalId;
                    const instanceDate = task.date;

                    await this.addExcludedDate(originalId, instanceDate);

                    showMessage("实例已删除");
                    await this.queueLoadTasks();
                    window.dispatchEvent(new CustomEvent('reminderUpdated'));
                } catch (error) {
                    console.error('删除周期实例失败:', error);
                    showMessage("删除实例失败");
                }
            }
        );
    }

    /**
     * 为原始周期事件添加排除日期
     */
    private async addExcludedDate(originalId: string, excludeDate: string) {
        try {
            const reminderData = await readReminderData();

            if (reminderData[originalId]) {
                if (!reminderData[originalId].repeat) {
                    throw new Error('不是重复事件');
                }

                // 初始化排除日期列表
                if (!reminderData[originalId].repeat.excludeDates) {
                    reminderData[originalId].repeat.excludeDates = [];
                }

                // 添加排除日期（如果还没有的话）
                if (!reminderData[originalId].repeat.excludeDates.includes(excludeDate)) {
                    reminderData[originalId].repeat.excludeDates.push(excludeDate);
                }

                await writeReminderData(reminderData);
            } else {
                throw new Error('原始事件不存在');
            }
        } catch (error) {
            console.error('添加排除日期失败:', error);
            throw error;
        }
    }

    /**
     * 智能生成重复任务实例，确保至少能找到下一个未来实例
     * @param reminder 提醒任务对象
     * @param today 今天的日期字符串
     * @param isLunarRepeat 是否是农历重复
     * @returns 生成的实例数组
     */
    private generateInstancesWithFutureGuarantee(reminder: any, today: string, isLunarRepeat: boolean): any[] {
        // 根据重复类型确定初始范围
        let monthsToAdd = 2; // 默认范围

        if (isLunarRepeat) {
            monthsToAdd = 14; // 农历重复需要更长范围
        } else if (reminder.repeat.type === 'yearly') {
            monthsToAdd = 14; // 年度重复初始范围为14个月
        } else if (reminder.repeat.type === 'monthly') {
            monthsToAdd = 3; // 月度重复使用3个月
        }

        let repeatInstances: any[] = [];
        let hasUncompletedFutureInstance = false;
        const maxAttempts = 5; // 最多尝试5次扩展
        let attempts = 0;

        // 获取已完成实例列表
        const completedInstances = reminder.repeat?.completedInstances || [];

        while (!hasUncompletedFutureInstance && attempts < maxAttempts) {
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setMonth(monthStart.getMonth() - 1);

            const monthEnd = new Date();
            monthEnd.setMonth(monthEnd.getMonth() + monthsToAdd);
            monthEnd.setDate(0);

            const startDate = getLocalDateString(monthStart);
            const endDate = getLocalDateString(monthEnd);

            // 生成实例，使用足够大的 maxInstances 以确保生成所有实例
            const maxInstances = monthsToAdd * 50; // 根据范围动态调整
            repeatInstances = generateRepeatInstances(reminder, startDate, endDate, maxInstances);

            // 检查是否有未完成的未来实例（关键修复：不仅要是未来的，还要是未完成的）
            hasUncompletedFutureInstance = repeatInstances.some(instance => {
                const instanceIdStr = (instance as any).instanceId || `${reminder.id}_${instance.date}`;
                const originalKey = instanceIdStr.split('_').pop() || instance.date;
                return compareDateStrings(instance.date, today) > 0 && !completedInstances.includes(originalKey);
            });

            if (!hasUncompletedFutureInstance) {
                // 如果没有找到未完成的未来实例，扩展范围
                if (reminder.repeat.type === 'yearly') {
                    monthsToAdd += 12; // 年度重复每次增加12个月
                } else if (isLunarRepeat) {
                    monthsToAdd += 12; // 农历重复每次增加12个月
                } else {
                    monthsToAdd += 6; // 其他类型每次增加6个月
                }
                attempts++;
            }
        }

        return repeatInstances;
    }

    /**
     * 根据父任务ID生成多级 Markdown 列表文本数组，每行为一行 Markdown。
     * 对于绑定块的任务，使用 siyuan://blocks/<id> 格式的链接。
     */
    private buildMarkdownListFromChildren(parentId: string): string[] {
        const nodes = this.collectChildrenRecursively(parentId);
        if (!nodes || nodes.length === 0) return [];

        const lines: string[] = [];
        for (const node of nodes) {
            const indent = '  '.repeat(node.level);
            const t = node.task;
            let title = t.title || '未命名任务';
            if (t.blockId || t.docId) {
                // 使用思源块链接
                const targetId = t.blockId || t.docId;
                title = `[${title}](siyuan://blocks/${targetId})`;
            }
            lines.push(`${indent}- ${title}`);
        }
        return lines;
    }

    /**
     * 为分组项添加拖拽排序功能
     */
    private addGroupDragAndDrop(groupItem: HTMLElement, group: any, container: HTMLElement) {
        // 使用和 CategoryManageDialog 一致的拖拽处理模式：通过类名指示上/下插入位置
        groupItem.draggable = true;

        groupItem.addEventListener('dragstart', (e) => {
            this.draggedGroupId = group.id;
            groupItem.classList.add('dragging');

            // 创建可作为拖拽预览的克隆元素并放置到 body，用作 setDragImage
            try {
                const clone = groupItem.cloneNode(true) as HTMLElement;
                clone.style.position = 'absolute';
                clone.style.top = '-9999px';
                clone.style.left = '-9999px';
                clone.style.width = `${groupItem.getBoundingClientRect().width}px`;
                clone.style.boxShadow = '0 6px 20px rgba(0,0,0,0.2)';
                document.body.appendChild(clone);
                this._groupDragImageEl = clone;

                if (e.dataTransfer) {
                    try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', group.id); e.dataTransfer.setDragImage(clone, 10, 10); } catch (err) { }
                }
            } catch (err) {
                // ignore
            }
        });

        groupItem.addEventListener('dragend', () => {
            groupItem.classList.remove('dragging');
            this.draggedGroupId = null;

            // 清除所有项的拖拽相关样式
            container.querySelectorAll('.group-item').forEach((el) => {
                el.classList.remove('drag-over-top', 'drag-over-bottom');
            });

            // 清理 drag image clone
            if (this._groupDragImageEl && this._groupDragImageEl.parentNode) {
                this._groupDragImageEl.parentNode.removeChild(this._groupDragImageEl);
            }
            this._groupDragImageEl = null;

            // 清理容器级指示器
            if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
            }
            this._groupDropIndicator = null;
        });

        groupItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (err) { }

            // 使用容器级绝对定位的指示器来显示插入位置（跨项一致）
            if (this.draggedGroupId && this.draggedGroupId !== group.id) {
                const rect = groupItem.getBoundingClientRect();
                const mouseY = (e as DragEvent).clientY;
                const insertTop = mouseY < rect.top + rect.height / 2;

                // 创建或更新指示器
                if (!this._groupDropIndicator) {
                    const ind = document.createElement('div');
                    ind.className = 'group-drop-indicator';
                    ind.style.position = 'absolute';
                    ind.style.height = '3px';
                    ind.style.backgroundColor = 'var(--b3-theme-primary)';
                    ind.style.boxShadow = '0 0 8px var(--b3-theme-primary)';
                    ind.style.zIndex = '2000';
                    ind.style.pointerEvents = 'none';
                    container.appendChild(ind);
                    this._groupDropIndicator = ind;
                }

                const indicator = this._groupDropIndicator!;
                // 计算指示器相对于 container 的位置
                const containerRect = container.getBoundingClientRect();
                if (insertTop) {
                    indicator.style.width = `${rect.width}px`;
                    indicator.style.left = `${rect.left - containerRect.left}px`;
                    indicator.style.top = `${rect.top - containerRect.top - 2}px`;
                } else {
                    indicator.style.width = `${rect.width}px`;
                    indicator.style.left = `${rect.left - containerRect.left}px`;
                    indicator.style.top = `${rect.bottom - containerRect.top}px`;
                }
            }
        });

        groupItem.addEventListener('dragleave', (e) => {
            // 仅当鼠标真正离开元素时才清除样式
            const rect = groupItem.getBoundingClientRect();
            const x = (e as DragEvent).clientX;
            const y = (e as DragEvent).clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                groupItem.classList.remove('drag-over-top', 'drag-over-bottom');
            }
        });

        groupItem.addEventListener('drop', async (e) => {
            e.preventDefault();
            groupItem.classList.remove('drag-over-top', 'drag-over-bottom');

            // 支持 dataTransfer 或 class 字段回退
            let draggedId = (e as DragEvent).dataTransfer?.getData('text/plain') || this.draggedGroupId;
            if (!draggedId || draggedId === group.id) return;

            try {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                const currentGroups = await projectManager.getProjectCustomGroups(this.projectId);

                const draggedIndex = currentGroups.findIndex((g: any) => g.id === draggedId);
                const targetIndex = currentGroups.findIndex((g: any) => g.id === group.id);
                if (draggedIndex === -1 || targetIndex === -1) return;

                const rect = groupItem.getBoundingClientRect();
                const midPoint = rect.top + rect.height / 2;
                const insertBefore = (e as DragEvent).clientY < midPoint;

                const draggedGroup = currentGroups.splice(draggedIndex, 1)[0];
                const actualTargetIndex = insertBefore ? targetIndex : targetIndex + 1;
                currentGroups.splice(actualTargetIndex, 0, draggedGroup);

                // 重新分配 sort 并保存
                currentGroups.forEach((g: any, index: number) => { g.sort = index * 10; });
                await projectManager.setProjectCustomGroups(this.projectId, currentGroups);

                // 清理绝对定位的插入指示器（如存在）
                if (this._groupDropIndicator && this._groupDropIndicator.parentNode) {
                    this._groupDropIndicator.parentNode.removeChild(this._groupDropIndicator);
                }
                this._groupDropIndicator = null;

                // 刷新 UI（使用防抖队列）
                await this.loadAndDisplayGroups(container);
                this.queueLoadTasks();
                showMessage('分组顺序已更新');
            } catch (error) {
                console.error('更新分组顺序失败:', error);
                showMessage('更新分组顺序失败');
            }
        });
    }
}
