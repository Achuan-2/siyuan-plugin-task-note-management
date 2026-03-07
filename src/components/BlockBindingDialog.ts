import { Dialog } from "siyuan";
import { i18n } from "../pluginInstance";
/**
 * 块绑定对话框组件
 * 支持三种模式：绑定现有块、新建文档、新建标题
 */
export class BlockBindingDialog {
    private dialog: Dialog;
    private plugin: any;
    private callback: (blockId: string) => void;
    private defaultBlockId?: string;
    private defaultTab: 'bind' | 'document' | 'heading' = 'bind';
    private defaultParentId?: string;
    private defaultProjectId?: string;
    private defaultCustomGroupId?: string | null;
    private reminder?: any;
    private selectedPathNotebookId?: string;
    private notebooks: any;
    private defaultTitle?: string;
    private forMilestone: boolean = false;
    private forGroup: boolean = false;
    constructor(
        plugin: any,
        callback: (blockId: string) => void,
        options?: {
            defaultBlockId?: string;
            title?: string;
            defaultTab?: 'bind' | 'document' | 'heading';
            defaultParentId?: string;
            defaultProjectId?: string;
            defaultCustomGroupId?: string | null;
            reminder?: any;
            defaultTitle?: string;
            forMilestone?: boolean;
            forGroup?: boolean;
        }
    ) {
        this.plugin = plugin;
        this.callback = callback;
        this.defaultBlockId = options?.defaultBlockId;
        this.defaultTab = options?.defaultTab || 'bind';
        this.defaultParentId = options?.defaultParentId;
        this.defaultProjectId = options?.defaultProjectId;
        this.defaultCustomGroupId = options?.defaultCustomGroupId;
        this.reminder = options?.reminder;
        this.defaultTitle = options?.defaultTitle;
        this.forMilestone = options?.forMilestone || false;
        this.forGroup = options?.forGroup || false;

        this.dialog = new Dialog({
            title: options?.title || i18n("bindBlock") || "绑定块",
            content: this.createDialogContent(),
            width: "600px",
            height: "500px"
        });
    }

    /**
     * 显示对话框
     */
    public show() {
        this.dialog.element.style.zIndex = "999";
        this.initializeEventListeners();
        // 切换到默认标签页
        this.switchTab(this.defaultTab);
    }

    /**
     * 创建对话框内容
     */
    private createDialogContent(): string {
        return `
            <div class="create-doc-heading-dialog" style="display: flex; flex-direction: column; height: 100%;">
                <!-- 按钮切换 -->
                <div style="margin-bottom: 16px; flex-shrink: 0; display: flex; gap: 8px; justify-content: center;">
                    <button class="b3-button b3-button--outline tab-switch-btn" data-tab="bind">${i18n("bindBlock") || "绑定块"}</button>
                    <button class="b3-button b3-button--outline tab-switch-btn" data-tab="heading">${i18n("newHeading") || "新建标题"}</button>
                    <button class="b3-button tab-switch-btn" data-tab="document">${i18n("newDocument") || "新建文档"}</button>
                </div>

                <!-- 内容区域 -->
                <div style="flex: 1; overflow-y: auto; min-height: 0;">
                    <!-- 绑定块标签页 -->
                    <div class="tab-content" data-content="bind" style="display: none;">
                        <div class="b3-dialog__content">
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n("blockId") || "块ID"}</label>
                                <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                                    <input type="text" id="bindBlockInput" class="b3-text-field" placeholder="${i18n("inputBlockIdOrSearch") || "输入块ID或搜索"}" style="flex: 1;">
                                    <label style="margin: 0;">
                                        <input type="checkbox" id="bindIncludeHeadingsCheckbox" class="b3-switch">
                                        <span class="b3-switch__slider"></span>
                                    </label>
                                    <span style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n("searchIncludesHeadings") || "搜索包含标题"}</span>
                                </div>
                                <div id="bindSearchResults" style="max-height: 150px; overflow-y: auto; margin-top: 8px; border: 1px solid var(--b3-border-color); border-radius: 4px; display: none;"></div>
                                <!-- 块预览区域 -->
                                <div id="bindBlockPreview" style="margin-top: 8px; padding: 8px; background: var(--b3-theme-background-light); border: 1px solid var(--b3-border-color); border-radius: 4px; display: none;">
                                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;">${i18n("currentSelection") || "当前选择："}</div>
                                    <div id="bindBlockPreviewContent" style="font-size: 13px; color: var(--b3-theme-on-surface);"></div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 文档创建标签页 -->
                    <div class="tab-content" data-content="document" style="display: none;">
                        <div class="b3-dialog__content">
                                    <div class="b3-form__group">
                                        <label class="b3-form__label">${i18n("documentTitle") || "文档标题"}</label>
                                        <input type="text" id="docTitleInput" class="b3-text-field" value="" placeholder="${i18n("inputDocumentTitle") || "请输入文档标题"}" style="width: 100%; margin-top: 8px;">
                                    </div>

                                    <div class="b3-form__group">
                                        <label class="b3-form__label">${i18n("savePathRelativeToNotebook") || "保存路径（相对于所选笔记本）"}</label>
                                        <div style="display:flex; gap:8px; align-items:center; margin-top:8px;">
                                            <input type="text" id="docParentPathInput" class="b3-text-field" placeholder="${i18n("inputOrSearchPathDesc") || "输入或搜索路径，例如 /项目/子页"}" style="flex:1;">
                                            <button class="b3-button b3-button--outline" id="useParentDocPathBtn" style="display:none; white-space:nowrap;">${i18n("useParentBlockDocPath") || "使用父块文档路径"}</button>
                                        </div>
                                        <div id="docPathSearchResults" style="max-height:150px; overflow-y:auto; margin-top:8px; border:1px solid var(--b3-border-color); border-radius:4px; display:none;"></div>
                                    </div>

                                    <div class="b3-form__group">
                                        <label class="b3-form__label">${i18n("documentContentOptional") || "文档内容（可选）"}</label>
                                        <textarea id="docContentInput" class="b3-text-field" placeholder="${i18n("inputDocumentContent") || "请输入文档内容"}" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                                    </div>
                        </div>
                    </div>

                    <!-- 标题创建标签页 -->
                    <div class="tab-content" data-content="heading">
                        <div class="b3-dialog__content">
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n("headingContent") || "标题内容"}</label>
                                <input type="text" id="headingContentInput" class="b3-text-field" value="" placeholder="${i18n("inputHeadingContent") || "请输入标题内容"}" style="width: 100%; margin-top: 8px;">
                            </div>
                            
                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n("parentBlock") || "父块"}</label>
                                <div style="display: flex; gap: 8px; align-items: center; margin-top: 8px;">
                                    <input type="text" id="headingParentInput" class="b3-text-field" placeholder="${i18n("inputBlockIdOrSearch") || "输入块ID或搜索"}" style="flex: 1;">
                                    <label style="margin: 0;">
                                        <input type="checkbox" id="headingIncludeHeadingsCheckbox" class="b3-switch">
                                        <span class="b3-switch__slider"></span>
                                    </label>
                                    <span style="font-size: 12px; color: var(--b3-theme-on-surface); white-space: nowrap;">${i18n("searchIncludesHeadings") || "搜索包含标题"}</span>
                                </div>
                                <div id="headingSearchResults" style="max-height: 150px; overflow-y: auto; margin-top: 8px; border: 1px solid var(--b3-border-color); border-radius: 4px; display: none;"></div>
                                <!-- 块预览区域 -->
                                <div id="headingBlockPreview" style="margin-top: 8px; padding: 8px; background: var(--b3-theme-background-light); border: 1px solid var(--b3-border-color); border-radius: 4px; display: none;">
                                    <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); margin-bottom: 4px;">${i18n("currentSelection") || "当前选择："}</div>
                                    <div id="headingBlockPreviewContent" style="font-size: 13px; color: var(--b3-theme-on-surface);"></div>
                                </div>
                            </div>

                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n("insertedHeadingLevel") || "插入的标题层级"}</label>
                                <select id="headingLevelSelect" class="b3-select" style="width: 100%; margin-top: 8px;">
                                    <option value="1">H1</option>
                                    <option value="2">H2</option>
                                    <option value="3" selected>H3</option>
                                    <option value="4">H4</option>
                                    <option value="5">H5</option>
                                    <option value="6">H6</option>
                                </select>
                            </div>

                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n("insertPosition") || "插入位置"}</label>
                                <select id="headingPositionSelect" class="b3-select" style="width: 100%; margin-top: 8px;">
                                    <option value="prepend">${i18n("insertAtBeginning") || "插入到最前"}</option>
                                    <option value="append" selected>${i18n("insertAtEnd") || "插入到最后"}</option>
                                </select>
                            </div>

                            <div class="b3-form__group">
                                <label class="b3-form__label">${i18n("headingContentOptional") || "标题下内容（可选）"}</label>
                                <textarea id="headingSubContentInput" class="b3-text-field" placeholder="${i18n("inputHeadingSubContent") || "请输入标题下内容"}" style="width: 100%; margin-top: 8px; min-height: 80px; resize: vertical;"></textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 按钮区域 -->
                <div class="b3-dialog__action" style="flex-shrink: 0; margin-top: 16px;">
                    <button class="b3-button b3-button--cancel" id="quickCreateCancelBtn">${i18n("cancel") || "取消"}</button>
                    <button class="b3-button b3-button--primary" id="quickCreateConfirmBtn">${i18n("confirm") || "确定"}</button>
                </div>
            </div>
        `;
    }

    /**
     * 初始化事件监听器
     */
    private initializeEventListeners() {
        const dialogElement = this.dialog.element;

        // 标签页切换
        const tabs = dialogElement.querySelectorAll('.tab-switch-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.getAttribute('data-tab');
                this.switchTab(tabName);
            });
        });

        // 取消按钮
        const cancelBtn = dialogElement.querySelector('#quickCreateCancelBtn');
        cancelBtn?.addEventListener('click', () => {
            this.dialog.destroy();
        });

        // 确定按钮
        const confirmBtn = dialogElement.querySelector('#quickCreateConfirmBtn');
        confirmBtn?.addEventListener('click', () => {
            this.handleConfirm();
        });

        // 初始化绑定块标签页
        this.initBindTab();
        // 初始化新建文档标签页
        this.initDocumentTab();
        // 初始化新建标题标签页
        this.initHeadingTab();
    }

    /**
     * 切换标签页
     */
    private switchTab(tabName: string) {
        const dialogElement = this.dialog.element;

        // 更新按钮样式
        dialogElement.querySelectorAll('.tab-switch-btn').forEach(btn => {
            if (btn.getAttribute('data-tab') === tabName) {
                // 激活的按钮：移除 outline
                btn.classList.remove('b3-button--outline');
            } else {
                // 未激活的按钮：添加 outline
                btn.classList.add('b3-button--outline');
            }
        });

        // 更新内容显示
        dialogElement.querySelectorAll('.tab-content').forEach(content => {
            const contentTab = content.getAttribute('data-content');
            if (contentTab === tabName) {
                (content as HTMLElement).style.display = 'block';
            } else {
                (content as HTMLElement).style.display = 'none';
            }
        });
    }

    /**
     * 初始化绑定块标签页
     */
    private initBindTab() {
        const bindBlockInput = this.dialog.element.querySelector('#bindBlockInput') as HTMLInputElement;
        const bindIncludeHeadingsCheckbox = this.dialog.element.querySelector('#bindIncludeHeadingsCheckbox') as HTMLInputElement;
        const bindSearchResults = this.dialog.element.querySelector('#bindSearchResults') as HTMLElement;
        const bindBlockPreview = this.dialog.element.querySelector('#bindBlockPreview') as HTMLElement;
        const bindBlockPreviewContent = this.dialog.element.querySelector('#bindBlockPreviewContent') as HTMLElement;

        if (!bindBlockInput) return;

        // 更新绑定块预览
        const updateBindBlockPreview = async (blockId: string) => {
            if (!blockId) {
                bindBlockPreview.style.display = 'none';
                return;
            }

            try {
                const { getBlockByID } = await import("../api");
                const block = await getBlockByID(blockId);

                if (block) {
                    const isHeading = block.type === 'h';
                    const icon = isHeading ? block.subtype.toUpperCase() : '📄';
                    const levelText = ''; // 不再在内容后添加标题层级

                    bindBlockPreviewContent.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: bold; color: var(--b3-theme-primary); min-width: 24px;">${icon}</span>
                            <div style="flex: 1; overflow: hidden;">
                                <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${block.content}${levelText}
                                </div>
                                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${block.hpath || block.box}
                                </div>
                            </div>
                        </div>
                    `;
                    bindBlockPreview.style.display = 'block';
                } else {
                    bindBlockPreview.style.display = 'none';
                }
            } catch (error) {
                console.error('获取块信息失败:', error);
                bindBlockPreview.style.display = 'none';
            }
        };

        // 搜索功能
        let bindSearchTimeout: number;
        let bindBlurTimeout: number;

        bindBlockInput.addEventListener('input', () => {
            clearTimeout(bindSearchTimeout);
            const query = bindBlockInput.value.trim();

            if (!query) {
                bindSearchResults.style.display = 'none';
                bindBlockPreview.style.display = 'none';
                return;
            }

            // 尝试从输入中提取块ID (支持直接输入ID, ((id 'alias')), [text](siyuan://blocks/id))
            const extractedId = this.extractBlockId(query);
            if (extractedId) {
                if (extractedId !== query) {
                    bindBlockInput.value = extractedId;
                }
                bindSearchResults.style.display = 'none';
                updateBindBlockPreview(extractedId);
                return;
            }

            // 否则进行搜索
            bindSearchTimeout = window.setTimeout(async () => {
                await this.searchBlocksForHeading(query, bindIncludeHeadingsCheckbox.checked, bindSearchResults, async (block) => {
                    bindBlockInput.value = block.id;
                    bindSearchResults.style.display = 'none';
                    await updateBindBlockPreview(block.id);
                });
            }, 300);
        });

        // 输入框失去焦点时，延迟隐藏搜索结果
        bindBlockInput.addEventListener('blur', () => {
            bindBlurTimeout = window.setTimeout(() => {
                bindSearchResults.style.display = 'none';
            }, 200);
        });

        // 输入框获得焦点时，如果有搜索结果则显示
        bindBlockInput.addEventListener('focus', () => {
            clearTimeout(bindBlurTimeout);
            if (bindSearchResults.children.length > 0 && bindBlockInput.value.trim()) {
                bindSearchResults.style.display = 'block';
            }
        });

        // 搜索包含标题复选框变化时重新搜索
        bindIncludeHeadingsCheckbox.addEventListener('change', () => {
            const query = bindBlockInput.value.trim();
            if (query) {
                bindBlockInput.dispatchEvent(new Event('input'));
            }
        });

        // 如果有默认块ID，显示预览
        if (this.defaultBlockId) {
            updateBindBlockPreview(this.defaultBlockId);
        }
    }

    /**
     * 初始化新建文档标签页
     */
    private async initDocumentTab() {
        const docTitleInput = this.dialog.element.querySelector('#docTitleInput') as HTMLInputElement;
        const docContentInput = this.dialog.element.querySelector('#docContentInput') as HTMLTextAreaElement;
        const parentPathInput = this.dialog.element.querySelector('#docParentPathInput') as HTMLInputElement;
        const pathSearchResults = this.dialog.element.querySelector('#docPathSearchResults') as HTMLElement;
        const useParentDocPathBtn = this.dialog.element.querySelector('#useParentDocPathBtn') as HTMLButtonElement;

        // 如果有reminder，设置默认标题，否则使用默认标题
        if (docTitleInput) {
            docTitleInput.value = (this.reminder?.title || this.defaultTitle) || '';
        }

        // 自动填充备注到内容域
        if (docContentInput && this.reminder?.note) {
            docContentInput.value = this.reminder.note;
        }

        // 加载笔记本列表
        try {
            const { lsNotebooks, searchDocs, getBlockByID } = await import("../api");
            this.notebooks = await lsNotebooks();

            // 从设置中读取默认笔记本和路径
            try {
                const settings = await this.plugin.loadSettings();
                const defaultNotebook = settings.newDocNotebook;
                const pathTemplate = settings.newDocPath || '/';
                // 构造初始化的保存路径：笔记本名 + 模板路径（保留模板原样，渲染留到保存时）
                let initialFullPath = pathTemplate || '/';
                if (defaultNotebook) {
                    const nb = this.notebooks.notebooks.find((n: any) => n.id === defaultNotebook);
                    if (nb) {
                        // 确保 initialFullPath 以 '/' 开头
                        if (!initialFullPath.startsWith('/')) initialFullPath = '/' + initialFullPath;
                        // 组合为 /NotebookName/... 的形式
                        const nbName = nb.name || nb.id;
                        parentPathInput.value = '/' + nbName + (initialFullPath === '/' ? '' : initialFullPath);
                    } else {
                        parentPathInput.value = pathTemplate || '/';
                    }
                } else {
                    parentPathInput.value = pathTemplate || '/';
                }
            } catch (err) {
                console.warn('读取插件设置失败:', err);
            }

            // 如果传入了默认父块或项目绑定，尝试解析出绑定的文档块ID并提供“使用父块文档路径”按钮
            if (useParentDocPathBtn && parentPathInput) {
                try {
                    let boundDocBlockId: string | null = null;

                    // 0. 优先检查里程碑绑定
                    const milestoneId = this.reminder?.milestoneId || this.reminder?.milestone;
                    if (milestoneId && this.defaultProjectId) {
                        try {
                            const { ProjectManager } = await import('../utils/projectManager');
                            const projectManager = ProjectManager.getInstance(this.plugin);
                            const milestone = await projectManager.getMilestoneById(this.defaultProjectId, milestoneId);
                            if (milestone?.blockId) {
                                boundDocBlockId = milestone.blockId;
                            }
                        } catch (err) {
                            console.warn('解析里程碑绑定失败:', err);
                        }
                    }

                    // 1. 父任务/父块绑定（可能存的是 reminder 里的 blockId）
                    if (!boundDocBlockId && this.defaultParentId) {
                        const parentReminder = await this.getParentReminder(this.defaultParentId);
                        if (parentReminder?.blockId) {
                            boundDocBlockId = parentReminder.blockId;
                        } else {
                            // 如果 parentId 本身就是文档块ID
                            try {
                                const maybeBlock = await getBlockByID(this.defaultParentId);
                                if (maybeBlock && maybeBlock.type === 'd') boundDocBlockId = maybeBlock.id;
                            } catch (err) {
                                // ignore
                            }
                        }
                    }

                    // 2. 项目自定义分组或项目绑定（参考 initHeadingTabDefaults 的逻辑）
                    if (!boundDocBlockId && this.defaultProjectId) {
                        try {
                            const { ProjectManager } = await import('../utils/projectManager');
                            const projectManager = ProjectManager.getInstance(this.plugin);
                            await projectManager.initialize();

                            if (this.defaultCustomGroupId) {
                                const groups = await projectManager.getProjectCustomGroups(this.defaultProjectId);
                                const group = groups.find((g: any) => g.id === this.defaultCustomGroupId);
                                if (group?.blockId) boundDocBlockId = group.blockId;
                            }

                            if (!boundDocBlockId) {
                                const project = projectManager.getProjectById(this.defaultProjectId);
                                if (project?.blockId) boundDocBlockId = project.blockId;
                            }
                        } catch (err) {
                            console.warn('解析项目绑定失败:', err);
                        }
                    }

                    if (boundDocBlockId) {
                        const boundBlock = await getBlockByID(boundDocBlockId);
                        if (boundBlock) {
                            // 对于非文档块，通过 root_id 获取所在文档的 hpath
                            let rawHPath = '';
                            let pathBox = boundBlock.box || undefined;
                            if (boundBlock.type === 'd') {
                                rawHPath = boundBlock.hpath || (boundBlock as any).hPath || '';
                            } else if (boundBlock.root_id) {
                                // 非文档块：获取其所在文档的路径
                                const rootBlock = await getBlockByID(boundBlock.root_id);
                                if (rootBlock) {
                                    rawHPath = rootBlock.hpath || (rootBlock as any).hPath || '';
                                    pathBox = rootBlock.box || pathBox;
                                }
                            }
                            if (rawHPath) {
                                const defaultPath = parentPathInput.value;
                                const defaultNotebookId: string | undefined = undefined;

                                // 拼接笔记本名称到路径前面
                                let fullHPath = rawHPath;
                                if (pathBox && this.notebooks?.notebooks) {
                                    const nb = this.notebooks.notebooks.find((n: any) => n.id === pathBox);
                                    if (nb?.name) {
                                        fullHPath = '/' + nb.name + (rawHPath.startsWith('/') ? rawHPath : '/' + rawHPath);
                                    }
                                }

                                // 自动填充父块文档路径
                                parentPathInput.value = fullHPath;
                                this.selectedPathNotebookId = pathBox;

                                // 按钮改为"使用默认路径"，支持在父块路径与默认路径之间切换
                                useParentDocPathBtn.textContent = i18n('useDefaultPath') || '使用默认路径';
                                useParentDocPathBtn.style.display = 'inline-block';
                                let usingParentPath = true;
                                useParentDocPathBtn.addEventListener('click', () => {
                                    if (usingParentPath) {
                                        parentPathInput.value = defaultPath;
                                        this.selectedPathNotebookId = defaultNotebookId;
                                        useParentDocPathBtn.textContent = i18n('useParentBlockDocPath') || '使用父块文档路径';
                                        usingParentPath = false;
                                    } else {
                                        parentPathInput.value = fullHPath;
                                        this.selectedPathNotebookId = pathBox;
                                        useParentDocPathBtn.textContent = i18n('useDefaultPath') || '使用默认路径';
                                        usingParentPath = true;
                                    }
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.warn('尝试解析绑定文档块失败:', err);
                }
            }

            // 路径搜索（按输入检索文档并显示相对于笔记本的路径）
            if (parentPathInput && pathSearchResults) {
                let searchTimeout: number;
                parentPathInput.addEventListener('input', () => {
                    clearTimeout(searchTimeout);
                    const q = parentPathInput.value.trim();
                    if (!q) {
                        pathSearchResults.style.display = 'none';
                        return;
                    }
                    searchTimeout = window.setTimeout(async () => {
                        try {
                            const results = await searchDocs(q, false);
                            // 不再根据选中笔记本过滤，直接对所有文档搜索
                            const toRelativePath = (hPath: string) => {
                                if (!hPath) return '';
                                const parts = hPath.split('/').filter(Boolean);
                                if (parts.length <= 1) return '/';
                                return '/' + parts.slice(1).join('/');
                            };

                            const mapped = (results || []).map((doc: any) => ({ ...doc, hPathRel: toRelativePath(doc.hPath || doc.hpath || ''), hPathFull: doc.hPath || doc.hpath || '' }));
                            if (!mapped || mapped.length === 0) {
                                pathSearchResults.innerHTML = `<div style="padding:8px;text-align:center;color:var(--b3-theme-on-surface-light);">${i18n("noMatchResult") || "未找到匹配结果"}</div>`;
                                pathSearchResults.style.display = 'block';
                                return;
                            }

                            pathSearchResults.innerHTML = mapped.map((doc: any) => `
                                <div class="search-result-item" style="padding:8px;cursor:pointer;border-bottom:1px solid var(--b3-border-color);">
                                    <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${doc.title || doc.hPathFull || ''}</div>
                                    <div style="font-size:12px;color:var(--b3-theme-on-surface-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${doc.hPathFull}</div>
                                </div>
                            `).join('');
                            pathSearchResults.style.display = 'block';

                            pathSearchResults.querySelectorAll('.search-result-item').forEach((item, idx) => {
                                item.addEventListener('click', () => {
                                    const sel = mapped[idx];
                                    // 填充完整 hPath（包含笔记本名），并记录所选笔记本 id
                                    parentPathInput.value = sel.hPathFull || '/';
                                    this.selectedPathNotebookId = sel.box || undefined;
                                    pathSearchResults.style.display = 'none';
                                });
                            });
                        } catch (err) {
                            console.error('路径搜索失败:', err);
                            pathSearchResults.innerHTML = `<div style="padding:8px;text-align:center;color:var(--b3-theme-error);">${i18n("searchFailed") || "搜索失败"}</div>`;
                            pathSearchResults.style.display = 'block';
                        }
                    }, 300);
                });
            }
        } catch (error) {
            console.error('加载笔记本列表或初始化文档面板失败:', error);
        }
    }

    /**
     * 初始化新建标题标签页
     */
    private async initHeadingTab() {
        const headingContentInput = this.dialog.element.querySelector('#headingContentInput') as HTMLInputElement;
        const headingSubContentInput = this.dialog.element.querySelector('#headingSubContentInput') as HTMLTextAreaElement;
        const headingParentInput = this.dialog.element.querySelector('#headingParentInput') as HTMLInputElement;
        const headingIncludeHeadingsCheckbox = this.dialog.element.querySelector('#headingIncludeHeadingsCheckbox') as HTMLInputElement;
        const headingSearchResults = this.dialog.element.querySelector('#headingSearchResults') as HTMLElement;
        const headingBlockPreview = this.dialog.element.querySelector('#headingBlockPreview') as HTMLElement;
        const headingBlockPreviewContent = this.dialog.element.querySelector('#headingBlockPreviewContent') as HTMLElement;
        const headingLevelSelect = this.dialog.element.querySelector('#headingLevelSelect') as HTMLSelectElement;

        // 如果有reminder，设置默认标题内容，否则使用默认标题
        if (headingContentInput) {
            headingContentInput.value = (this.reminder?.title || this.defaultTitle) || '';
        }

        // 自动填充备注到标题下内容域
        if (headingSubContentInput && this.reminder?.note) {
            headingSubContentInput.value = this.reminder.note;
        }

        // 加载默认设置
        try {
            const settings = await this.plugin.loadSettings();
            // 根据场景选择默认层级：分组 > 里程碑 > 普通
            let defaultLevel: number;
            if (this.forGroup) {
                defaultLevel = settings.groupDefaultHeadingLevel || 2;
            } else if (this.forMilestone) {
                defaultLevel = settings.milestoneDefaultHeadingLevel || 2;
            } else {
                defaultLevel = settings.defaultHeadingLevel || 3;
            }
            const defaultPosition = settings.defaultHeadingPosition || 'append';

            const levelSelect = this.dialog.element.querySelector('#headingLevelSelect') as HTMLSelectElement;
            const positionSelect = this.dialog.element.querySelector('#headingPositionSelect') as HTMLSelectElement;

            if (levelSelect) levelSelect.value = defaultLevel.toString();
            if (positionSelect) positionSelect.value = defaultPosition;
        } catch (error) {
            console.error('加载默认设置失败:', error);
        }

        // 初始化默认值
        const autoFillBlockId = await this.initHeadingTabDefaults(headingParentInput, headingLevelSelect);

        if (!headingParentInput) return;

        // 更新父块预览的函数
        const updatePreview = async (blockId: string) => {
            await this.updateBlockPreview(blockId, headingBlockPreview, headingBlockPreviewContent, headingLevelSelect);
        };

        // 如果自动填充了父块ID，显示预览
        if (autoFillBlockId) {
            await updatePreview(autoFillBlockId);
        }

        // 搜索功能
        let searchTimeout: number;
        let blurTimeout: number;

        headingParentInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            const query = headingParentInput.value.trim();

            if (!query) {
                headingSearchResults.style.display = 'none';
                headingBlockPreview.style.display = 'none';
                return;
            }

            // 尝试从输入中提取块ID (支持直接输入ID, ((id 'alias')), [text](siyuan://blocks/id))
            const extractedId = this.extractBlockId(query);
            if (extractedId) {
                if (extractedId !== query) {
                    headingParentInput.value = extractedId;
                }
                headingSearchResults.style.display = 'none';
                updatePreview(extractedId);
                return;
            }

            // 否则进行搜索
            searchTimeout = window.setTimeout(async () => {
                await this.searchBlocksForHeading(query, headingIncludeHeadingsCheckbox.checked, headingSearchResults, async (block) => {
                    headingParentInput.value = block.id;
                    headingSearchResults.style.display = 'none';
                    await updatePreview(block.id);
                });
            }, 300);
        });

        // 输入框失去焦点时，延迟隐藏搜索结果
        headingParentInput.addEventListener('blur', () => {
            blurTimeout = window.setTimeout(() => {
                headingSearchResults.style.display = 'none';
            }, 200);
        });

        // 输入框获得焦点时，如果当前值是块ID则显示预览，否则显示搜索结果
        headingParentInput.addEventListener('focus', () => {
            clearTimeout(blurTimeout);
            const currentValue = headingParentInput.value.trim();

            // 如果当前值是块ID格式，直接显示预览
            if (/^\d{14}-[a-z0-9]{7}$/.test(currentValue)) {
                headingSearchResults.style.display = 'none';
                updatePreview(currentValue);
            } else if (headingSearchResults.children.length > 0 && currentValue) {
                // 否则如果有搜索结果则显示搜索结果
                headingSearchResults.style.display = 'block';
            }
        });

        // 搜索包含标题复选框变化时重新搜索
        headingIncludeHeadingsCheckbox.addEventListener('change', () => {
            const query = headingParentInput.value.trim();
            if (query) {
                headingParentInput.dispatchEvent(new Event('input'));
            }
        });
    }

    /**
     * 初始化标题标签页的默认值
     */
    private async initHeadingTabDefaults(
        parentInput: HTMLInputElement,
        levelSelect: HTMLSelectElement
    ): Promise<string | null> {
        try {
            // 尝试自动填充父块ID
            let autoFillBlockId: string | null = null;

            // 0. 优先检查里程碑绑定
            const milestoneId = this.reminder?.milestoneId || this.reminder?.milestone;
            if (milestoneId && this.defaultProjectId) {
                try {
                    const { ProjectManager } = await import('../utils/projectManager');
                    const projectManager = ProjectManager.getInstance(this.plugin);
                    const milestone = await projectManager.getMilestoneById(this.defaultProjectId, milestoneId);
                    if (milestone?.blockId) {
                        autoFillBlockId = milestone.blockId;
                        const { getBlockByID } = await import("../api");
                        const block = await getBlockByID(autoFillBlockId);
                        if (block) {
                            this.adjustHeadingLevel(block, levelSelect);
                        }
                    }
                } catch (err) {
                    console.warn('解析里程碑绑定失败:', err);
                }
            }

            // 1. 检查父任务绑定
            if (!autoFillBlockId && this.defaultParentId) {
                const { getBlockByID } = await import("../api");
                const parentReminder = await this.getParentReminder(this.defaultParentId);
                if (parentReminder?.blockId) {
                    autoFillBlockId = parentReminder.blockId;
                    const parentBlock = await getBlockByID(parentReminder.blockId);
                    if (parentBlock) {
                        this.adjustHeadingLevel(parentBlock, levelSelect);
                    }
                }
            }

            // 2. 检查项目自定义分组绑定
            if (!autoFillBlockId && this.defaultProjectId) {
                const { ProjectManager } = await import('../utils/projectManager');
                const projectManager = ProjectManager.getInstance(this.plugin);
                await projectManager.initialize();

                // 检查是否有自定义分组
                if (this.defaultCustomGroupId) {
                    const groups = await projectManager.getProjectCustomGroups(this.defaultProjectId);
                    const group = groups.find((g: any) => g.id === this.defaultCustomGroupId);
                    if (group?.blockId) {
                        autoFillBlockId = group.blockId;
                    }
                }

                // 3. 如果没有分组绑定，检查项目绑定
                if (!autoFillBlockId) {
                    const project = projectManager.getProjectById(this.defaultProjectId);
                    if (project?.blockId) {
                        autoFillBlockId = project.blockId;
                    }
                }

                // 如果找到了绑定块，调整层级
                if (autoFillBlockId) {
                    const { getBlockByID } = await import("../api");
                    const block = await getBlockByID(autoFillBlockId);
                    if (block) {
                        this.adjustHeadingLevel(block, levelSelect);
                    }
                }
            }

            // 自动填充父块ID
            if (autoFillBlockId) {
                parentInput.value = autoFillBlockId;
            }

            return autoFillBlockId;
        } catch (error) {
            console.error('初始化标题标签页默认值失败:', error);
            return null;
        }
    }

    /**
     * 从输入中提取块ID
     */
    private extractBlockId(input: string): string | null {
        if (!input) return null;
        const query = input.trim();

        // 1. 如果直接是块ID
        if (/^\d{14}-[a-z0-9]{7}$/.test(query)) {
            return query;
        }

        // 2. 处理思源块引用 ((id 'alias')) 或 ((id))
        const refMatch = query.match(/\(\((\d{14}-[a-z0-9]{7})/);
        if (refMatch) {
            return refMatch[1];
        }

        // 3. 处理思源块链接 [text](siyuan://blocks/id) 或 siyuan://blocks/id
        const linkMatch = query.match(/siyuan:\/\/blocks\/(\d{14}-[a-z0-9]{7})/);
        if (linkMatch) {
            return linkMatch[1];
        }

        return null;
    }
    private async getParentReminder(parentId: string): Promise<any> {
        try {
            const reminderData = await this.plugin.loadReminderData();
            return reminderData[parentId];
        } catch (error) {
            console.error('获取父任务失败:', error);
            return null;
        }
    }
    /**
     * 更新块预览显示
     */
    private async updateBlockPreview(blockId: string, headingBlockPreview: HTMLElement, headingBlockPreviewContent: HTMLElement, headingLevelSelect?: HTMLSelectElement) {
        if (!blockId) {
            headingBlockPreview.style.display = 'none';
            return;
        }

        try {
            const { getBlockByID } = await import("../api");
            const block = await getBlockByID(blockId);

            if (block) {
                const isHeading = block.type === 'h';
                const icon = isHeading ? block.subtype.toUpperCase() : '📄';
                const levelText = ''; // 不再在内容后添加标题层级

                headingBlockPreviewContent.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-weight: bold; color: var(--b3-theme-primary); min-width: 24px;">${icon}</span>
                        <div style="flex: 1; overflow: hidden;">
                            <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${block.content}${levelText}
                            </div>
                            <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                ${block.hpath || block.box}
                            </div>
                        </div>
                    </div>
                `;
                headingBlockPreview.style.display = 'block';

                // 自动调整标题层级
                if (headingLevelSelect) {
                    await this.adjustHeadingLevel(block, headingLevelSelect);
                }
            } else {
                headingBlockPreview.style.display = 'none';
            }
        } catch (error) {
            console.error('获取块信息失败:', error);
            headingBlockPreview.style.display = 'none';
        }
    }

    /**
     * 搜索文档和标题块
     */
    private async searchBlocksForHeading(
        query: string,
        includeHeadings: boolean,
        resultsContainer: HTMLElement,
        onSelect: (block: any) => void
    ) {
        try {
            const { sql } = await import("../api");

            // 构建SQL查询 - 支持空格分隔的AND搜索
            const keywords = query.trim().split(/\s+/).filter(k => k.length > 0);
            if (keywords.length === 0) {
                resultsContainer.style.display = 'none';
                return;
            }

            // 构建多个LIKE条件（AND关系）
            const likeConditions = keywords.map(keyword => `content LIKE '%${keyword.replace(/'/g, "''")}%'`).join(' AND ');

            let sqlQuery: string;
            if (includeHeadings) {
                sqlQuery = `SELECT * FROM blocks WHERE (type = 'd' OR type = 'h') AND ${likeConditions} LIMIT 100`;
            } else {
                sqlQuery = `SELECT * FROM blocks WHERE type = 'd' AND ${likeConditions} LIMIT 100`;
            }

            const results = await sql(sqlQuery);

            if (!results || results.length === 0) {
                resultsContainer.innerHTML = `<div style="padding: 8px; text-align: center; color: var(--b3-theme-on-surface-light);">${i18n("noMatchResult") || "未找到匹配结果"}</div>`;
                resultsContainer.style.display = 'block';
                return;
            }

            // 渲染搜索结果
            resultsContainer.innerHTML = results.map((block: any) => {
                const isHeading = block.type === 'h';
                const headingLevel = isHeading ? block.subtype : '';
                const icon = isHeading ? headingLevel.toUpperCase() : '📄';
                const levelText = ''; // 不再在内容后添加标题层级

                return `
                    <div class="search-result-item" data-block-id="${block.id}" style="padding: 8px; cursor: pointer; border-bottom: 1px solid var(--b3-border-color);">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-weight: bold; color: var(--b3-theme-primary); min-width: 24px;">${icon}</span>
                            <div style="flex: 1; overflow: hidden;">
                                <div style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${block.content}${levelText}
                                </div>
                                <div style="font-size: 12px; color: var(--b3-theme-on-surface-light); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                    ${block.hpath || block.box}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');

            resultsContainer.style.display = 'block';

            // 添加点击事件
            resultsContainer.querySelectorAll('.search-result-item').forEach((item, index) => {
                item.addEventListener('click', () => {
                    onSelect(results[index]);
                });
            });
        } catch (error) {
            console.error('搜索块失败:', error);
            resultsContainer.innerHTML = `<div style="padding: 8px; text-align: center; color: var(--b3-theme-error);">${i18n("searchFailed") || "搜索失败"}</div>`;
            resultsContainer.style.display = 'block';
        }
    }

    /**
     * 根据父块自动调整标题层级
     */
    private async adjustHeadingLevel(parentBlock: any, levelSelect: HTMLSelectElement) {
        try {
            const settings = await this.plugin.loadSettings();
            // 根据场景选择默认层级：分组 > 里程碑 > 普通
            let defaultLevel: number;
            if (this.forGroup) {
                defaultLevel = settings.groupDefaultHeadingLevel || 2;
            } else if (this.forMilestone) {
                defaultLevel = settings.milestoneDefaultHeadingLevel || 2;
            } else {
                defaultLevel = settings.defaultHeadingLevel || 3;
            }

            if (parentBlock.type === 'h') {
                const parentLevel = parseInt(parentBlock.subtype.replace('h', ''));
                // 父块是标题块时，自动降一级
                const newLevel = Math.min(parentLevel + 1, 6);
                levelSelect.value = newLevel.toString();
            } else {
                // 父块是文档，使用默认层级
                levelSelect.value = defaultLevel.toString();
            }
        } catch (error) {
            console.error('调整标题层级失败:', error);
        }
    }

    /**
     * 处理确定按钮点击
     */
    private async handleConfirm() {
        // 查找当前显示的标签页内容
        const activeContent = this.dialog.element.querySelector('.tab-content[style*="display: block"]') as HTMLElement;
        const tabName = activeContent?.getAttribute('data-content');

        try {
            let blockId: string;

            switch (tabName) {
                case 'bind':
                    blockId = await this.handleBindConfirm();
                    break;
                case 'document':
                    blockId = await this.handleDocumentConfirm();
                    break;
                case 'heading':
                    blockId = await this.handleHeadingConfirm();
                    break;
                default:
                    throw new Error(i18n("unknownTabType") || '未知的标签页类型');
            }

            if (blockId) {
                this.callback(blockId);
                this.dialog.destroy();
            }
        } catch (error) {
            console.error('操作失败:', error);
            // 这里可以显示错误提示
        }
    }

    /**
     * 处理绑定块确认
     */
    private async handleBindConfirm(): Promise<string> {
        const input = this.dialog.element.querySelector('#bindBlockInput') as HTMLInputElement;
        const blockId = input?.value?.trim();

        if (!blockId) {
            throw new Error(i18n("pleaseInputBlockId") || '请输入块ID');
        }

        // 验证块是否存在
        const { getBlockByID } = await import("../api");
        const block = await getBlockByID(blockId);
        if (!block) {
            throw new Error(i18n("blockNotExistError") || '块不存在');
        }

        return blockId;
    }

    /**
     * 处理新建文档确认
     */
    private async handleDocumentConfirm(): Promise<string> {
        const titleInput = this.dialog.element.querySelector('#docTitleInput') as HTMLInputElement;
        const contentInput = this.dialog.element.querySelector('#docContentInput') as HTMLTextAreaElement;
        const parentPathInput = this.dialog.element.querySelector('#docParentPathInput') as HTMLInputElement;

        let title = titleInput?.value?.trim();
        let notebookId: string | undefined;
        let parentPath = parentPathInput?.value?.trim();

        if (!title) {
            throw new Error(i18n("pleaseInputDocumentTitle") || '请输入文档标题');
        }

        let content = contentInput?.value || '';

        // 处理/data/storage/petal/siyuan-plugin-task-note-management/assets到/data/assets的转换
        if (content.includes('/data/storage/petal/siyuan-plugin-task-note-management/assets/')) {
            try {
                const { putFile } = await import('../api');
                const assetRegex = /\/data\/storage\/petal\/siyuan-plugin-task-note-management\/assets\/([^)"\s]+)/g;
                let match;
                while ((match = assetRegex.exec(content)) !== null) {
                    const fileName = match[1];
                    const sourcePath = match[0];
                    const targetPath = `/data/assets/${fileName}`;

                    try {
                        let response = await fetch('/api/file/getFile', {
                            method: 'POST',
                            body: JSON.stringify({ path: sourcePath })
                        });

                        if (response.ok) {
                            const blob = await response.blob();
                            await putFile(targetPath, false, blob);
                            // 替换内容中的路径为思源标准资源路径 assets/xxxx
                            content = content.replace(sourcePath, `assets/${fileName}`);
                            // 可选：删除原文件或者不保留
                        }
                    } catch (e) {
                        console.error('转移图片资源失败', sourcePath, e);
                    }
                }
            } catch (error) {
                console.error('处理资源图片失败', error);
            }
        }

        // 如果没有选择笔记本，尝试使用插件设置中的默认值
        if (!notebookId) {
            try {
                const settings = await this.plugin.loadSettings();
                if (settings && settings.newDocNotebook) {
                    notebookId = settings.newDocNotebook;
                }
            } catch (err) {
                console.warn('读取插件设置失败:', err);
            }
        }

        // notebookId 可能稍后由渲染后的路径或搜索选择确定，继续往下处理

        // 如果没有填写路径，使用设置中的模板（保留原样，稍后用 renderSprig 渲染）
        if (!parentPath) {
            try {
                const settings = await this.plugin.loadSettings();
                parentPath = (settings && settings.newDocPath) || '/';
            } catch (err) {
                parentPath = '/';
            }
        }

        // 确保以 / 开头
        if (!parentPath.startsWith('/')) parentPath = '/' + parentPath;

        const { createDocWithMd, renderSprig, lsNotebooks } = await import("../api");

        // 使用 renderSprig 渲染最终路径（模板 + 标题），renderSprig 接受一个模板字符串
        const toRenderFull = parentPath.endsWith('/') ? parentPath + title : parentPath + '/' + title;
        let finalRendered = toRenderFull;
        try {
            const rendered = await renderSprig(toRenderFull);
            if (typeof rendered === 'string' && rendered.trim()) {
                finalRendered = rendered;
            }
        } catch (err) {
            console.warn('renderSprig 渲染路径失败，使用未渲染路径:', err);
        }

        // 确定目标笔记本ID：优先使用搜索选择的 notebookId 或下拉/设置中的 notebookId
        let targetNotebookId: string | undefined = this.selectedPathNotebookId || notebookId;
        let relativePath = finalRendered;

        // 如果渲染结果看起来是完整 hPath（以 / 开头），尝试用首段匹配笔记本名并拆分为笔记本 + 相对路径
        if (finalRendered.startsWith('/')) {
            const parts = finalRendered.split('/').filter(Boolean);
            if (parts.length > 0) {
                try {
                    const nbRes = await lsNotebooks();
                    const nb = (nbRes && nbRes.notebooks || []).find((n: any) => n.name === parts[0] || n.id === parts[0]);
                    if (nb) {
                        // 如果匹配到笔记本名，则以此为目标笔记本
                        targetNotebookId = targetNotebookId || nb.id;
                        relativePath = parts.length > 1 ? '/' + parts.slice(1).join('/') : '/';
                    } else {
                        // 如果没有匹配到笔记本名，且没有预设的目标笔记本，抛出错误
                        if (!targetNotebookId) {
                            throw new Error(i18n("notebookNameInPathNotExist") || '路径中的笔记本名不存在，请检查笔记本名或选择有效的笔记本');
                        }
                        // 否则，保留完整渲染结果作为相对路径
                        relativePath = finalRendered;
                    }
                } catch (err) {
                    console.warn('加载笔记本列表失败，无法根据首段解析笔记本名:', err);
                    relativePath = finalRendered;
                }
            }
        }

        if (!targetNotebookId) {
            throw new Error(i18n("cannotDetermineTargetNotebookSearch") || '无法确定目标笔记本，请在路径中包含笔记本名或在设置中指定默认笔记本，或通过路径搜索选择目标文档');
        }

        // 如果仍然没有目标笔记本，自动选择第一个可用的笔记本
        if (!targetNotebookId && this.notebooks.notebooks && this.notebooks.notebooks.length > 0) {
            targetNotebookId = this.notebooks.notebooks[0].id;
        }

        if (!targetNotebookId) {
            throw new Error(i18n("cannotDetermineTargetNotebook") || '无法确定目标笔记本，请在路径中包含笔记本名或设置默认笔记本');
        }

        // 最终调用 createDocWithMd，路径应为相对于笔记本的路径
        const result = await createDocWithMd(targetNotebookId, relativePath, content);

        return result;
    }

    /**
     * 处理新建标题确认
     */
    private async handleHeadingConfirm(): Promise<string> {
        const contentInput = this.dialog.element.querySelector('#headingContentInput') as HTMLInputElement;
        const subContentInput = this.dialog.element.querySelector('#headingSubContentInput') as HTMLTextAreaElement;
        const parentInput = this.dialog.element.querySelector('#headingParentInput') as HTMLInputElement;
        const levelSelect = this.dialog.element.querySelector('#headingLevelSelect') as HTMLSelectElement;
        const positionSelect = this.dialog.element.querySelector('#headingPositionSelect') as HTMLSelectElement;

        const content = contentInput?.value?.trim();
        const subContent = subContentInput?.value;
        const parentId = parentInput?.value?.trim();
        const level = parseInt(levelSelect?.value || '3');
        const position = positionSelect?.value as 'prepend' | 'append';

        if (!content) {
            throw new Error(i18n("pleaseInputHeadingContent") || '请输入标题内容');
        }

        if (!parentId) {
            throw new Error(i18n("pleaseInputParentBlockId") || '请输入父块ID');
        }

        // 验证父块是否存在
        const { getBlockByID } = await import("../api");
        const parentBlock = await getBlockByID(parentId);
        if (!parentBlock) {
            throw new Error(i18n("parentBlockNotExist") || '父块不存在');
        }

        // 创建标题
        const blockId = await this.createHeading(content, parentId, level, position, parentBlock, subContent);
        return blockId;
    }

    /**
     * 创建标题
     */
    private async createHeading(
        content: string,
        parentId: string,
        level: number,
        position: 'prepend' | 'append',
        parentBlock: any,
        subContent?: string
    ): Promise<string> {
        const { prependBlock, appendBlock, insertBlock, getHeadingChildrenDOM } = await import("../api");

        const hashes = '#'.repeat(level);

        // 处理/data/storage/petal/siyuan-plugin-task-note-management/assets到/data/assets的转换
        let processedSubContent = subContent || '';
        if (processedSubContent.includes('/data/storage/petal/siyuan-plugin-task-note-management/assets/')) {
            try {
                const { putFile } = await import('../api');
                const assetRegex = /\/data\/storage\/petal\/siyuan-plugin-task-note-management\/assets\/([^)"\s]+)/g;
                let match;
                while ((match = assetRegex.exec(processedSubContent)) !== null) {
                    const fileName = match[1];
                    const sourcePath = match[0];
                    const targetPath = `/data/assets/${fileName}`;

                    try {
                        let response = await fetch('/api/file/getFile', {
                            method: 'POST',
                            body: JSON.stringify({ path: sourcePath })
                        });

                        if (response.ok) {
                            const blob = await response.blob();
                            await putFile(targetPath, false, blob);
                            processedSubContent = processedSubContent.replace(sourcePath, `assets/${fileName}`);
                        }
                    } catch (e) {
                        console.error('转移图片资源失败', sourcePath, e);
                    }
                }
            } catch (error) {
                console.error('处理资源图片失败', error);
            }
        }

        let markdownContent = `${hashes} ${content}`;
        if (processedSubContent) {
            markdownContent += `\n${processedSubContent}`;
        }

        let response: any;

        if (parentBlock.type === 'h') {
            if (position === 'prepend') {
                try {
                    const domHtml = await getHeadingChildrenDOM(parentId);

                    if (domHtml && typeof domHtml === 'string') {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(domHtml, 'text/html');
                        const childBlocks = doc.querySelectorAll('[data-node-id]');

                        let insertPreviousID = parentId;
                        let lastConsecutiveNonHeadingId = parentId;
                        let hasFoundHeading = false;

                        childBlocks.forEach((block: Element) => {
                            const blockId = block.getAttribute('data-node-id');
                            const blockType = block.getAttribute('data-type');

                            if (blockId === parentId) return;

                            if (!hasFoundHeading) {
                                if (blockType === 'NodeHeading') {
                                    hasFoundHeading = true;
                                    insertPreviousID = lastConsecutiveNonHeadingId;
                                } else {
                                    lastConsecutiveNonHeadingId = blockId;
                                }
                            }
                        });

                        if (!hasFoundHeading) {
                            insertPreviousID = lastConsecutiveNonHeadingId;
                        }

                        response = await insertBlock('markdown', markdownContent, undefined, insertPreviousID);
                    } else {
                        response = await insertBlock('markdown', markdownContent, undefined, parentId);
                    }
                } catch (e) {
                    console.warn('获取标题子块失败:', e);
                    response = await insertBlock('markdown', markdownContent, undefined, parentId);
                }
            } else {
                response = await appendBlock('markdown', markdownContent, parentId);
            }
        } else {
            if (position === 'prepend') {
                response = await prependBlock('markdown', markdownContent, parentId);
            } else {
                response = await appendBlock('markdown', markdownContent, parentId);
            }
        }
        if (response && response[0]?.doOperations?.[0]?.id) {

            return response[0].doOperations[0].id;
        }

        throw new Error(i18n("createHeadingFailed") || '创建标题失败：无法获取新建块ID');
    }
}
