import { Dialog, showMessage } from "siyuan";
import { i18n } from "../pluginInstance";
import { autoDetectDateTimeFromTitle, getLocalDateTimeString } from "../utils/dateUtils";
import { getBlockByID, updateBindBlockAtrrs, addBlockProjectId } from "../api";
import { getAllReminders, saveReminders } from "../utils/icsSubscription";
import LoadingDialog from './LoadingDialog.svelte';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { cursor } from "@milkdown/kit/plugin/cursor";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { $view } from "@milkdown/utils";
import { listItemSchema } from "@milkdown/kit/preset/commonmark";
import { Plugin } from "@milkdown/prose/state";
import { prosePluginsCtx, parserCtx } from "@milkdown/kit/core";

export interface HierarchicalTask {
    title: string;
    priority?: string;
    startDate?: string;
    time?: string;
    endDate?: string;
    endTime?: string;
    reminderTimes?: any[];
    blockId?: string;
    level: number;
    children: HierarchicalTask[];
    completed?: boolean;
}

export interface PasteTaskDialogConfig {
    plugin: any;
    parentTask?: any;
    projectId?: string;
    customGroupId?: string;
    defaultStatus?: string;
    onSuccess?: (totalCount: number) => void;
    onError?: (error: any) => void;
    // 是否显示状态选择器（默认false）
    showStatusSelector?: boolean;
    // 是否显示分组选择器（默认false，仅当项目有自定义分组时显示）
    showGroupSelector?: boolean;
    // 项目自定义分组列表
    projectGroups?: any[];
    // 项目里程碑列表（未分组时的里程碑）
    projectMilestones?: any[];
    // 看板状态配置
    kanbanStatuses?: any[];
    // 临时模式：不保存到数据库，通过 onTasksCreated 回调返回任务数组
    isTempMode?: boolean;
    // 临时模式回调，参数为创建的任务数组
    onTasksCreated?: (tasks: any[]) => void;
    // 默认统一设置日期（默认不勾选，除非提供为true）
    defaultSetDate?: boolean;
    // 统一设置日期的默认值（例如当前筛选的日期）
    defaultDateStr?: string;
}

export class PasteTaskDialog {
    private config: PasteTaskDialogConfig;
    private loadingDialog: Dialog | null = null;
    private editor?: Editor;
    private taskListContent: string = '';

    constructor(config: PasteTaskDialogConfig) {
        this.config = config;
    }

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
                        <textarea id="linkUrl" class="b3-text-field" style="width: 100%; resize: vertical;" rows="2" placeholder="https://..." spellcheck="false">${mark.attrs.href}</textarea>
                    </div>
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 4px; font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8;">${i18n('linkTitle') || '显示文本'}:</label>
                        <textarea id="linkTitle" class="b3-text-field" style="width: 100%; resize: vertical;" rows="2" placeholder="${i18n('linkTitlePlaceholder') || '输入链接文本'}" spellcheck="false">${currentText}</textarea>
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

    async show() {
        const isSubtask = !!this.config.parentTask;
        const showStatusSelector = this.config.showStatusSelector && !isSubtask;
        const showGroupSelector = this.config.showGroupSelector && !isSubtask && this.config.projectGroups && this.config.projectGroups.length > 0;

        // 允许显示里程碑选择器，如果有分组或项目有里程碑
        const hasMilestones = (this.config.projectMilestones && this.config.projectMilestones.length > 0) ||
            (this.config.projectGroups && this.config.projectGroups.some(g => g.milestones && g.milestones.length > 0));
        const showMilestoneSelector = !isSubtask && hasMilestones;

        // 构建状态和分组选择器HTML
        let selectorsHtml = '';

        if (showStatusSelector || showGroupSelector || showMilestoneSelector) {
            selectorsHtml = `
                <div style="display: flex; gap: 12px; margin-bottom: 12px; padding: 12px; background: var(--b3-theme-surface); border-radius: 6px; flex-wrap: wrap;">
                    ${showStatusSelector ? this.buildStatusSelectorHtml() : ''}
                    ${showGroupSelector ? this.buildGroupSelectorHtml() : ''}
                    ${showMilestoneSelector ? this.buildMilestoneSelectorHtml() : ''}
                </div>
            `;
        }

        const dialog = new Dialog({
            title: isSubtask ? (i18n("pasteAsSubtasks") || "粘贴列表新建子任务") : (i18n("pasteAsTasks") || "粘贴列表新建任务"),
            content: `
                <div class="b3-dialog__content">
                    <p>${i18n("pasteInstructions") || "粘贴Markdown列表或多行文本，每行将创建一个任务。支持多层级列表自动创建父子任务。"}</p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px; word-break: break-all;">
                        ${i18n("supportPrioritySyntaxDemo") || "支持语法：<code>@priority=high&startDate=2025-08-12&endDate=2025-08-30&reminderTimes=[{\"time\":\"2026-02-24T12:33\",\"note\":\"备注1\"}]</code>"}
                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 4px;">
                        ${i18n("supportBlockLinkDemo") || "支持绑定块：<code>[任务标题](siyuan://blocks/块ID)</code> 或 <code>((块ID '任务标题'))</code>"}
                    </p>
                    <p style="font-size: 12px; color: var(--b3-theme-on-surface); opacity: 0.8; margin-bottom: 8px;">
                        ${i18n("supportHierarchy") || "支持多层级：使用缩进或多个<code>-</code>符号创建父子任务关系"}
                    </p>
                    ${selectorsHtml}
                    <div id="taskList" style="height: 300px; border: 1px solid var(--b3-theme-surface-lighter); border-radius: 4px;"></div>
                    <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 12px;">
                        <label class="b3-checkbox" style="display: flex; align-items: center;">
                            <input id="autoDetectDate" type="checkbox" class="b3-switch">
                            <span class="b3-checkbox__graphic"></span>
                            <span class="b3-checkbox__label">${i18n("autoDetectDateTime")}</span>
                        </label>
                        <div id="removeDateContainer" style="display: flex; align-items: center; gap: 8px; margin-left: 24px;">
                            <span style="font-size: 14px; color: var(--b3-theme-on-surface); cursor: default;">${i18n("removeDateAfterDetection")}</span>
                            <select id="removeDateMode" class="b3-select" style="padding: 2px 8px; height: 28px;">
                                <option value="none">${i18n('removeNone') || '不去除'}</option>
                                <option value="date">${i18n('removeDateOnly') || '仅去除日期'}</option>
                                <option value="all" selected>${i18n('removeDateAndTime') || '去除日期和时间'}</option>
                            </select>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <label class="b3-checkbox" style="display: flex; align-items: center;">
                                <input id="unifiedDateCheckbox" type="checkbox" class="b3-switch" ${this.config.defaultSetDate ? 'checked' : ''}>
                                <span class="b3-checkbox__graphic"></span>
                                <span class="b3-checkbox__label">${i18n("unifiedSetDate") || "统一设置日期"}</span>
                            </label>
                            <input id="unifiedDateInput" type="date" class="b3-text-field" value="${this.config.defaultDateStr || ''}" style="${this.config.defaultSetDate ? '' : 'display: none;'} margin-left: 8px;">
                        </div>
                    </div>
                </div>
                <div class="b3-dialog__action">
                    <button class="b3-button b3-button--cancel" id="cancelBtn">${i18n("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--primary" id="createBtn">${isSubtask ? (i18n("createSubtasks") || "创建子任务") : (i18n("createTasks") || "创建任务")}</button>
                </div>
            `,
            width: "520px",
            destroyCallback: () => {
                if (this.editor) {
                    this.editor.destroy();
                }
            }
        });

        const taskListContainer = dialog.element.querySelector('#taskList') as HTMLElement;
        const cancelBtn = dialog.element.querySelector('#cancelBtn') as HTMLButtonElement;
        const createBtn = dialog.element.querySelector('#createBtn') as HTMLButtonElement;
        const autoDetectCheckbox = dialog.element.querySelector('#autoDetectDate') as HTMLInputElement;
        const removeDateModeSelect = dialog.element.querySelector('#removeDateMode') as HTMLSelectElement;
        const removeDateContainer = dialog.element.querySelector('#removeDateContainer') as HTMLElement;
        const groupSelect = dialog.element.querySelector('#pasteTaskGroup') as HTMLSelectElement;
        const milestoneSelect = dialog.element.querySelector('#pasteTaskMilestone') as HTMLSelectElement;
        const milestoneContainer = dialog.element.querySelector('#pasteTaskMilestoneContainer') as HTMLElement;
        const unifiedDateCheckbox = dialog.element.querySelector('#unifiedDateCheckbox') as HTMLInputElement;
        const unifiedDateInput = dialog.element.querySelector('#unifiedDateInput') as HTMLInputElement;

        if (unifiedDateCheckbox && unifiedDateInput) {
            unifiedDateCheckbox.addEventListener('change', () => {
                unifiedDateInput.style.display = unifiedDateCheckbox.checked ? '' : 'none';
            });
        }

        // 监听分组变更，更新里程碑选项
        if (groupSelect && milestoneSelect) {
            groupSelect.addEventListener('change', () => {
                const selectedGroupId = groupSelect.value === 'none' ? undefined : groupSelect.value;
                const milestones = this.getMilestonesForGroup(selectedGroupId || 'none');

                if (milestoneContainer) {
                    if (milestones.length > 0) {
                        milestoneContainer.style.display = 'flex';
                        const optionsHtml = this.getMilestoneOptionsHtml(selectedGroupId || 'none');
                        milestoneSelect.innerHTML = optionsHtml;
                    } else {
                        milestoneContainer.style.display = 'none';
                        milestoneSelect.value = ''; // 清空选择
                    }
                } else {
                    // Fallback if container not found but elements exist (shouldn't happen with current logic)
                    const optionsHtml = this.getMilestoneOptionsHtml(selectedGroupId || 'none');
                    milestoneSelect.innerHTML = optionsHtml;
                }
            });
        }

        // 初始化选中状态
        this.config.plugin.getAutoDetectDateTimeEnabled().then((enabled: boolean) => {
            autoDetectCheckbox.checked = enabled;
            updateRemoveDateVisibility();
        });
        this.config.plugin.getRemoveDateAfterDetectionMode().then((mode: 'none' | 'date' | 'all') => {
            removeDateModeSelect.value = mode;
        });

        function updateRemoveDateVisibility() {
            if (autoDetectCheckbox.checked) {
                removeDateContainer.style.opacity = "1";
                removeDateContainer.style.pointerEvents = "auto";
                removeDateModeSelect.disabled = false;
            } else {
                removeDateContainer.style.opacity = "0.5";
                removeDateContainer.style.pointerEvents = "none";
                removeDateModeSelect.disabled = true;
            }
        }

        autoDetectCheckbox.addEventListener('change', () => {
            updateRemoveDateVisibility();
        });

        // Initialize Milkdown Editor
        setTimeout(() => {
            if (!taskListContainer) return;

            Editor.make()
                .config((ctx) => {
                    ctx.set(rootCtx, taskListContainer);
                    ctx.set(defaultValueCtx, "");
                    ctx.update(editorViewOptionsCtx, (prev) => ({
                        ...prev,
                        attributes: {
                            ...prev.attributes,
                            spellcheck: "false",
                        },
                    }));
                    ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
                        this.taskListContent = markdown;
                    });

                    // 优先获取纯文本 (Markdown)
                    ctx.update(prosePluginsCtx, (prev) => [
                        ...prev,
                        new Plugin({
                            props: {
                                handlePaste: (view, event) => {
                                    let text = event.clipboardData?.getData('text/plain');
                                    if (text) {
                                        // 统一换行符并将\r替换为\n，同时移除首尾多余的空行
                                        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                                        text = text.replace(/^\n+|\n+$/g, '');
                                        if (!text) return false;

                                        // 关键修复：确保单换行符被视为分段（即每个任务一行）
                                        // 在 Markdown 中，单个换行符会被解析为软换行，合并到同一段落
                                        // 我们将其转换为双换行符以强制分段，从而使 parseHierarchicalTaskList 能够正确按行切分
                                        if (text.includes('\n')) {
                                            text = text.replace(/(?<!\n)\n(?!\n)/g, '\n\n');
                                        }

                                        const { tr, doc } = view.state;
                                        const isEmpty = doc.childCount === 1 &&
                                            doc.firstChild?.type.name === 'paragraph' &&
                                            doc.firstChild.content.size === 0;

                                        const parser = ctx.get(parserCtx);
                                        const node = parser(text);
                                        if (!node) return false;

                                        if (isEmpty) {
                                            const content = node.type.name === 'doc' ? node.content : node;
                                            // 彻底替换初始的空段落
                                            view.dispatch(tr.replaceWith(0, doc.content.size, content).scrollIntoView());
                                            return true;
                                        } else {
                                            // 非空文档下，如果不含换行符，证明是行内粘贴，直接 insertText 以避免被切分为新段落
                                            if (!text.includes('\n')) {
                                                view.dispatch(tr.insertText(text).scrollIntoView());
                                                return true;
                                            }
                                            // 如果有多行，我们也手动处理以确保刚才的换行符转换生效
                                            // 使用 Node.slice(0) 将文档内容转为 Slice 以便 replaceSelection
                                            const slice = (node as any).slice(0);
                                            view.dispatch(tr.replaceSelection(slice).scrollIntoView());
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
                        dom.style.listStyleType = "none";
                        dom.style.position = "relative";

                        const checkbox = document.createElement("input");
                        checkbox.type = "checkbox";
                        checkbox.checked = node.attrs.checked;
                        checkbox.style.position = "absolute";
                        checkbox.style.left = "-1.4em";
                        checkbox.style.top = "0.3em";
                        checkbox.style.margin = "0";

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
                        contentDOM.style.minWidth = "0";
                        dom.appendChild(contentDOM);

                        return {
                            dom,
                            contentDOM,
                            ignoreMutation: (mutation) => {
                                return mutation.type === 'attributes' && mutation.target === checkbox;
                            },
                            update: (updatedNode) => {
                                if (updatedNode.type.name !== "list_item") return false;
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
                        return { dom, contentDOM: dom };
                    }
                }))
                .create()
                .then((editor) => {
                    this.editor = editor;

                    editor.action((ctx) => {
                        const view = ctx.get(editorViewCtx);
                        if (view) {
                            view.focus();
                        }
                    });

                    const editorEl = dialog.element.querySelector('.milkdown') as HTMLElement;
                    if (editorEl) {
                        editorEl.style.height = '100%';
                        editorEl.style.margin = '0px';
                        const prosemirror = editorEl.querySelector('.ProseMirror') as HTMLElement;
                        if (prosemirror) {
                            prosemirror.style.minHeight = '250px';
                            prosemirror.style.padding = '8px';
                            prosemirror.style.outline = 'none';
                        }
                    }
                });
        }, 100);

        cancelBtn.addEventListener('click', () => dialog.destroy());

        createBtn.addEventListener('click', async () => {
            // 防止重复点击
            if ((createBtn as HTMLButtonElement).disabled) return;

            const text = this.taskListContent.trim();
            if (!text) {
                showMessage(i18n("contentNotEmpty") || "列表内容不能为空");
                return;
            }

            // 禁用按钮并显示加载中文本
            (createBtn as HTMLButtonElement).disabled = true;
            const originalCreateHtml = createBtn.innerHTML;
            createBtn.innerHTML = i18n('creating') || '创建中...';

            // 显示加载对话框
            this.showLoadingDialog(i18n('creatingTask') || "创建任务中...");

            const autoDetect = autoDetectCheckbox.checked;
            const removeMode = removeDateModeSelect.value as 'none' | 'date' | 'all';
            const hierarchicalTasks = this.parseHierarchicalTaskList(text, autoDetect, removeMode);

            const useUnifiedDate = unifiedDateCheckbox?.checked;
            const unifiedDateVal = unifiedDateInput?.value;

            const applyUnifiedDate = (tasks: HierarchicalTask[]) => {
                for (const task of tasks) {
                    if (useUnifiedDate && unifiedDateVal) {
                        if (!task.startDate && !task.endDate) {
                            task.startDate = unifiedDateVal;
                        }
                    }
                    if (task.children) applyUnifiedDate(task.children);
                }
            };
            applyUnifiedDate(hierarchicalTasks);

            // 获取用户选择的状态和分组
            let selectedStatus = this.config.defaultStatus;
            let selectedGroupId = this.config.customGroupId;
            let selectedMilestoneId: string | undefined = undefined;

            if (showStatusSelector) {
                const statusSelect = dialog.element.querySelector('#pasteTaskStatus') as HTMLSelectElement;
                if (statusSelect) {
                    selectedStatus = statusSelect.value;
                }
            }

            if (showGroupSelector) {
                const groupSelect = dialog.element.querySelector('#pasteTaskGroup') as HTMLSelectElement;
                if (groupSelect) {
                    const gid = groupSelect.value;
                    selectedGroupId = gid === 'none' ? null : gid;
                }
            }

            if (showMilestoneSelector) {
                const milestoneSelect = dialog.element.querySelector('#pasteTaskMilestone') as HTMLSelectElement;
                if (milestoneSelect) {
                    selectedMilestoneId = milestoneSelect.value || undefined;
                }
            }

            if (hierarchicalTasks.length > 0) {
                try {
                    const createdTasks = await this.batchCreateTasksWithHierarchy(hierarchicalTasks, selectedStatus, selectedGroupId, selectedMilestoneId);
                    dialog.destroy();
                    const totalTasks = this.countTotalTasks(hierarchicalTasks);

                    // 临时模式：通过回调返回创建的任务
                    if (this.config.isTempMode && this.config.onTasksCreated) {
                        this.config.onTasksCreated(createdTasks);
                    }

                    if (this.config.onSuccess) {
                        this.config.onSuccess(totalTasks);
                    } else if (!this.config.isTempMode) {
                        showMessage(`${totalTasks} ${i18n("tasksCreated") || "个任务已创建"}`);
                    }
                } catch (error) {
                    console.error('批量创建任务失败:', error);
                    if (this.config.onError) {
                        this.config.onError(error);
                    } else {
                        showMessage(i18n("batchCreateFailed") || "批量创建任务失败");
                    }
                } finally {
                    // 关闭加载对话框
                    this.closeLoadingDialog();
                    // 如果对话框还存在，恢复按钮状态
                    try {
                        (createBtn as HTMLButtonElement).disabled = false;
                        createBtn.innerHTML = originalCreateHtml;
                    } catch (e) {
                        // ignore
                    }
                }
            } else {
                // 无任务时恢复按钮
                (createBtn as HTMLButtonElement).disabled = false;
                createBtn.innerHTML = originalCreateHtml;
                // 关闭加载对话框
                this.closeLoadingDialog();
            }
        });
    }

    private showLoadingDialog(message: string) {
        if (this.loadingDialog) {
            this.loadingDialog.destroy();
        }
        this.loadingDialog = new Dialog({
            title: i18n("processing") || "Processing",
            content: `<div id="loadingDialogContent"></div>`,
            width: "350px",
            height: "230px",
            disableClose: true,
            destroyCallback: null
        });

        new LoadingDialog({
            target: this.loadingDialog.element.querySelector('#loadingDialogContent'),
            props: {
                message: message
            }
        });
    }

    private closeLoadingDialog() {
        if (this.loadingDialog) {
            this.loadingDialog.destroy();
            this.loadingDialog = null;
        }
    }

    private parseHierarchicalTaskList(text: string, autoDetect: boolean = false, removeMode: 'none' | 'date' | 'all' = 'all'): HierarchicalTask[] {
        const lines = text.split('\n');
        const tasks: HierarchicalTask[] = [];
        const stack: Array<{ task: HierarchicalTask; level: number }> = [];

        for (const line of lines) {
            if (!line.trim()) continue;

            const level = this.calculateIndentLevel(line);
            const cleanLine = line.trim();

            const isListItem = /^([-*+]|\d+\.|\[[ xX]\])/.test(cleanLine);
            if (!cleanLine || (!isListItem && level === 0)) {
                if (cleanLine && level === 0) {
                    const taskData = this.parseTaskLine(cleanLine, autoDetect, removeMode);
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

            let levelFromDashes = 0;
            const dashPrefixMatch = cleanLine.match(/^(-{2,})\s*/);
            if (dashPrefixMatch) {
                levelFromDashes = dashPrefixMatch[1].length - 1;
            }

            const combinedLevel = level + levelFromDashes;
            const taskContent = cleanLine.replace(/^([-*+]|\d+\.)\s*/, '').replace(/^(-{2,})\s*/, '');
            if (!taskContent) continue;

            const taskData = this.parseTaskLine(taskContent, autoDetect, removeMode);
            const task: HierarchicalTask = {
                ...taskData,
                level: combinedLevel,
                children: []
            };

            while (stack.length > 0 && stack[stack.length - 1].level >= combinedLevel) {
                stack.pop();
            }

            if (stack.length === 0) {
                tasks.push(task);
            } else {
                const parent = stack[stack.length - 1].task;
                parent.children.push(task);
            }

            stack.push({ task, level: combinedLevel });
        }

        return tasks;
    }

    private calculateIndentLevel(line: string): number {
        const match = line.match(/^(\s*)/);
        if (!match) return 0;
        const indent = match[1];
        const spaces = indent.replace(/\t/g, '  ').length;
        return Math.floor(spaces / 2);
    }

    private parseTaskLine(line: string, autoDetect: boolean = false, removeMode: 'none' | 'date' | 'all' = 'all'): Omit<HierarchicalTask, 'level' | 'children'> {
        const paramMatch = line.match(/@(.*)$/);
        let title = line.trim();

        // 移除常见的 Markdown 列表标记
        title = title.replace(/^([-*+]\s+)|(\d+\.\s+)/, '');

        let priority: string | undefined;
        let startDate: string | undefined;
        let time: string | undefined;
        let endDate: string | undefined;
        let endTime: string | undefined;
        let reminderTimes: any[] | undefined;
        let blockId: string | undefined;
        let completed: boolean | undefined;

        blockId = this.extractBlockIdFromText(line);

        if (blockId) {
            title = title.replace(/\[([^\]]+)\]\(siyuan:\/\/blocks\/[^)]+\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+'([^']+)'\)\)/g, '$1');
            title = title.replace(/\(\([^\s)]+\s+"([^"]+)"\)\)/g, '$1');
            title = title.replace(/\(\([^\)]+\)\)/g, '');
        }

        const checkboxMatch = title.match(/^\s*\[\s*([ xX])\s*\]\s*/);
        if (checkboxMatch) {
            const mark = checkboxMatch[1];
            completed = (mark.toLowerCase() === 'x');
            title = title.replace(/^\s*\[\s*([ xX])\s*\]\s*/, '').trim();
        }

        const leadingCheckboxMatch = line.match(/^\s*[-*+]\s*\[\s*([ xX])\s*\]\s*(.+)$/);
        if (leadingCheckboxMatch) {
            completed = (leadingCheckboxMatch[1].toLowerCase() === 'x');
            title = leadingCheckboxMatch[2];
        }

        // 处理 Markdown 转义字符（因内容来自编辑器 Markdown，~, *, _ 等符号会被转义为 \~, \*, \_）
        title = title.replace(/\\([\\*_{}[\]()#+\-.!~])/g, '$1');

        if (autoDetect) {
            const detected = autoDetectDateTimeFromTitle(title, removeMode);
            if (detected.date || detected.endDate) {
                title = detected.cleanTitle || title;
                startDate = detected.date;
                time = detected.time;
                endDate = detected.endDate;
                endTime = detected.endTime;
            }
        }

        if (paramMatch) {
            title = title.replace(/@(.*)$/, '').trim();
            // Handle markdown/HTML escaped ampersands, non-breaking spaces, and spaces around operators
            const paramString = paramMatch[1]
                .replace(/\\/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/\s*&\s*/g, '&')
                .replace(/\s*=\s*/g, '=')
                .trim();

            const params = new URLSearchParams(paramString);

            const parsedPriority = params.get('priority')?.trim();
            if (parsedPriority) {
                priority = parsedPriority;
            }

            const parsedStartDate = params.get('startDate')?.trim();
            if (parsedStartDate) {
                startDate = parsedStartDate;
            }

            const parsedEndDate = params.get('endDate')?.trim();
            if (parsedEndDate) {
                endDate = parsedEndDate;
            }

            const parsedReminderTimes = params.get('reminderTimes')?.trim();
            if (parsedReminderTimes) {
                try {
                    reminderTimes = JSON.parse(parsedReminderTimes);
                } catch (e) {
                    console.error('Failed to parse reminderTimes:', e);
                }
            }

            if (priority && !['high', 'medium', 'low', 'none'].includes(priority)) priority = 'none';
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (startDate && !dateRegex.test(startDate)) startDate = undefined;
            if (endDate && !dateRegex.test(endDate)) endDate = undefined;
        }

        let result = { title: title.trim() || i18n('noContentHint') || '未命名任务', priority, startDate, time, endDate, endTime, reminderTimes, blockId, completed };
        console.log('Parsed task line:', { line, result });
        return result
    }

    private async batchCreateTasksWithHierarchy(tasks: HierarchicalTask[], selectedStatus?: string, selectedGroupId?: string | null, selectedMilestoneId?: string): Promise<any[]> {
        const parentTask = this.config.parentTask;
        const projectId = this.config.projectId || (parentTask ? parentTask.projectId : undefined);
        const categoryId = parentTask ? parentTask.categoryId : undefined;

        // 临时模式下不需要从数据库读取
        const reminderData = this.config.isTempMode ? {} : await getAllReminders(this.config.plugin, undefined, true);

        // 获取当前项目中所有任务的最大排序值
        const maxSort = this.config.isTempMode ? 0 : Object.values(reminderData)
            .filter((r: any) => r && r.projectId === projectId && typeof r.sort === 'number')
            .reduce((max: number, task: any) => Math.max(max, task.sort || 0), 0) as number;

        let sortCounter = maxSort;
        const createdTasks: any[] = [];
        const boundBlockIds = new Set<string>();

        const createTaskRecursively = async (
            task: HierarchicalTask,
            parentId?: string,
            parentPriority?: string,
            inheritedGroupId?: string
        ): Promise<string> => {
            const taskId = `reminder_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            sortCounter += 10;

            const inheritedPriority = (task.priority && task.priority !== 'none') ? task.priority : (parentPriority || 'none');

            // 优先使用用户选择的状态
            const statusToUse = selectedStatus !== undefined ? selectedStatus : this.config.defaultStatus;
            let kanbanStatus = 'todo';

            if (statusToUse) {
                // 自定义状态，直接使用作为 kanbanStatus
                kanbanStatus = statusToUse;
            } else {
                // 默认使用 doing
                kanbanStatus = 'doing';
            }

            const newTask: any = {
                id: taskId,
                title: task.title,
                note: '',
                priority: inheritedPriority,
                categoryId: categoryId,
                projectId: projectId,
                completed: !!task.completed,
                kanbanStatus: kanbanStatus,
                createdTime: new Date().toISOString(),
                created: getLocalDateTimeString(new Date()),
                date: task.startDate,
                time: task.time,
                endDate: task.endDate,
                endTime: task.endTime,
                reminderTimes: task.reminderTimes,
                sort: sortCounter,
            };

            if (selectedMilestoneId) {
                newTask.milestoneId = selectedMilestoneId;
            }

            if (parentId) {
                newTask.parentId = parentId;
            }

            if (inheritedGroupId) {
                newTask.customGroupId = inheritedGroupId;
            } else if (parentId && !this.config.isTempMode) {
                const parent = reminderData[parentId];
                if (parent && parent.customGroupId) {
                    newTask.customGroupId = parent.customGroupId;
                }
            }

            // 临时模式标记
            if (this.config.isTempMode) {
                newTask.isTempSubtask = true;
            }

            if (task.blockId) {
                try {
                    const block = await getBlockByID(task.blockId);
                    if (block) {
                        newTask.blockId = task.blockId;
                        newTask.docId = block.root_id || task.blockId;

                        if (!task.title || task.title === i18n('noContentHint') || task.title === '未命名任务') {
                            newTask.title = block.content || block.fcontent || i18n('noContentHint') || '未命名任务';
                        }

                        if (projectId && !this.config.isTempMode) {
                            await addBlockProjectId(task.blockId, projectId);
                        }

                        boundBlockIds.add(task.blockId);
                    }
                } catch (error) {
                    console.error('绑定块失败:', error);
                }
            }

            reminderData[taskId] = newTask;
            createdTasks.push(newTask);

            if (task.children && task.children.length > 0) {
                for (const child of task.children) {
                    await createTaskRecursively(child, taskId, inheritedPriority, inheritedGroupId);
                }
            }

            return taskId;
        };

        // 使用用户选择的分组，如果没有则使用配置的分组
        const groupToUse = selectedGroupId !== undefined ? selectedGroupId : this.config.customGroupId;

        for (const task of tasks) {
            const topParentId = parentTask ? parentTask.id : undefined;
            const parentPriority = parentTask?.priority;
            await createTaskRecursively(task, topParentId, parentPriority, groupToUse);
        }

        // 临时模式下不保存到数据库，通过回调返回
        if (!this.config.isTempMode) {
            await saveReminders(this.config.plugin, reminderData);

            // 更新块属性
            for (const blockId of boundBlockIds) {
                try {
                    await updateBindBlockAtrrs(blockId, this.config.plugin);
                } catch (error) {
                    console.error(`更新块 ${blockId} 属性失败:`, error);
                }
            }
        }

        return createdTasks;
    }

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

    private extractBlockIdFromText(text: string): string | undefined {
        const markdownLinkMatch = text.match(/\[([^\]]+)\]\(siyuan:\/\/blocks\/([^)]+)\)/);
        if (markdownLinkMatch) {
            const blockId = markdownLinkMatch[2];
            if (blockId && blockId.length >= 20) return blockId;
        }

        const blockRefWithTitleMatch = text.match(/\(\(([^)\s]+)\s+['"]([^'"]+)['"]\)\)/);
        if (blockRefWithTitleMatch) {
            const blockId = blockRefWithTitleMatch[1];
            if (blockId && blockId.length >= 20) return blockId;
        }

        const simpleBlockRefMatch = text.match(/\(\(([^)]+)\)\)/);
        if (simpleBlockRefMatch) {
            const blockId = simpleBlockRefMatch[1].trim();
            if (blockId && blockId.length >= 20) return blockId;
        }

        return undefined;
    }

    private buildStatusSelectorHtml(): string {
        const kanbanStatuses = this.config.kanbanStatuses || [];
        const defaultStatus = this.config.defaultStatus || 'short_term';

        // 状态名称映射
        const statusNameMap: { [key: string]: string } = {
            'doing': i18n('doingTasks') || '进行中',
            'long_term': i18n('longTerm') || '长期',
            'short_term': i18n('shortTerm') || '短期',
            'completed': i18n('completed') || '已完成'
        };

        // 构建状态选项（排除已完成状态）
        let statusOptionsHtml = '';
        kanbanStatuses
            .filter((status: any) => status.id !== 'completed')
            .forEach((status: any) => {
                const name = status.name || statusNameMap[status.id] || status.id;
                const selected = status.id === defaultStatus ? 'selected' : '';
                statusOptionsHtml += `<option value="${status.id}" ${selected}>${status.icon || ''} ${name}</option>`;
            });

        // 如果没有配置状态，使用默认选项
        if (kanbanStatuses.length === 0) {
            statusOptionsHtml = `
                <option value="short_term" ${defaultStatus === 'short_term' ? 'selected' : ''}>${i18n('shortTerm') || '短期'}</option>
                <option value="long_term" ${defaultStatus === 'long_term' ? 'selected' : ''}>${i18n('longTerm') || '长期'}</option>
                <option value="doing" ${defaultStatus === 'doing' ? 'selected' : ''}>${i18n('doingTasks') || '进行中'}</option>
            `;
        }

        return `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <label style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n('taskStatus')}:</label>
                <select id="pasteTaskStatus" class="b3-select" style="flex: 1; min-width: 100px;">
                    ${statusOptionsHtml}
                </select>
            </div>
        `;
    }

    private buildGroupSelectorHtml(): string {
        const projectGroups = this.config.projectGroups || [];
        const defaultGroupId = this.config.customGroupId || 'none';

        // 构建分组选项
        let groupOptionsHtml = `<option value="none" ${!this.config.customGroupId ? 'selected' : ''}>${i18n('noGroup') || '无分组'}</option>`;

        projectGroups.forEach((group: any) => {
            const selected = group.id === defaultGroupId ? 'selected' : '';
            groupOptionsHtml += `<option value="${group.id}" ${selected}>${group.icon || '📋'} ${group.name}</option>`;
        });

        return `
            <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
                <label style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n('taskGroup') || '任务分组'}:</label>
                <select id="pasteTaskGroup" class="b3-select" style="flex: 1; min-width: 100px;">
                    ${groupOptionsHtml}
                </select>
            </div>
        `;
    }

    private buildMilestoneSelectorHtml(): string {
        // 初始构建HTML，选项将由JS根据当前选中的分组动态填充
        // 这里可以预填充默认选项（基于 config.customGroupId）
        const initialGroupId = this.config.customGroupId || 'none';
        const milestones = this.getMilestonesForGroup(initialGroupId);
        const optionsHtml = this.getMilestoneOptionsHtml(initialGroupId);

        // 如果当前分组没有里程碑，则初始隐藏
        const displayStyle = milestones.length > 0 ? 'flex' : 'none';

        return `
            <div id="pasteTaskMilestoneContainer" style="display: ${displayStyle}; align-items: center; gap: 6px; flex: 1;">
                <label style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n('milestone') || '里程碑'}:</label>
                <select id="pasteTaskMilestone" class="b3-select" style="flex: 1; min-width: 100px;">
                    ${optionsHtml}
                </select>
            </div>
        `;
    }

    private getMilestonesForGroup(groupId: string): any[] {
        let milestones: any[] = [];
        if (groupId === 'none' || !groupId) {
            milestones = this.config.projectMilestones || [];
        } else {
            const group = this.config.projectGroups?.find(g => g.id === groupId);
            milestones = group?.milestones || [];
        }

        // 过滤掉已归档的里程碑
        return milestones.filter(m => !m.archived);
    }

    private getMilestoneOptionsHtml(groupId: string): string {
        const milestones = this.getMilestonesForGroup(groupId);
        let html = `<option value="">${i18n('noMilestone') || '无里程碑'}</option>`;
        milestones.forEach(m => {
            html += `<option value="${m.id}">${m.icon ? m.icon + ' ' : ''}${m.name}</option>`;
        });
        return html;
    }
}
