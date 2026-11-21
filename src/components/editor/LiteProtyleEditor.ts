import { Constants, Lute, Protyle, ProtyleMethod, type IProtyleOptions } from "siyuan";
import { convertLegacyHtmlImgToMarkdown, normalizeGlobalAssetPath } from "../../utils/assetCleanupIgnore";

const PROTYLE_LITE_FRAGMENT_CLASS = "protyle-lite-fragment";
const PROTYLE_LITE_HINT_OVERLAY_CLASS = "protyle-hint--lite-overlay";

export interface LiteProtyleEditorOptions {
    app?: any;
    plugin?: any;
    container: HTMLElement;
    initialMarkdown?: string;
    placeholder?: string;
    readOnly?: boolean;
    enableAssets?: boolean;
    onChange?: (markdown: string) => void;
    onAssetUploaded?: (assetPaths: string[]) => void;
    onImageDoubleClick?: (src: string, allSrcs: string[]) => void;
}

function createEmptyParagraphBlock(placeholder?: string): HTMLDivElement {
    const block = document.createElement("div");
    const nodeId = typeof Lute !== "undefined" && typeof Lute.NewNodeID === "function"
        ? Lute.NewNodeID()
        : `${Date.now()}-0000000`;
    block.setAttribute("data-node-id", nodeId);
    block.setAttribute("data-type", "NodeParagraph");
    block.className = "p";
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.setAttribute("spellcheck", "false");
    editable.className = "protyle-wysiwyg--empty";
    if (placeholder) {
        editable.setAttribute("placeholder", placeholder);
    }
    const attr = document.createElement("div");
    attr.className = "protyle-attr";
    attr.setAttribute("contenteditable", "false");
    attr.textContent = Constants?.ZWSP || "\u200b";
    block.appendChild(editable);
    block.appendChild(attr);
    return block;
}

function isWysiwygEmpty(wysiwyg: HTMLElement): boolean {
    const zwsp = Constants?.ZWSP || "\u200b";
    const text = (wysiwyg.textContent || "").split(zwsp).join("").trim();
    if (text.length > 0) return false;
    // 仅有图片、附件链接、音视频、分割线、表格、代码块或渲染块时不视为空
    if (wysiwyg.querySelector('img, audio, video, iframe, hr, table, .code-block, .render-node, [data-type~="a"], [data-href]')) {
        return false;
    }
    return true;
}

function renderSpecialBlocks(element: HTMLElement): void {
    if (typeof ProtyleMethod === "undefined") return;
    try { ProtyleMethod.highlightRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.mathRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.mermaidRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.flowchartRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.chartRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.abcRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.plantumlRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.graphvizRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.mindmapRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.htmlRender?.(element); } catch { /* ignore */ }
    try { ProtyleMethod.tabsRender?.(element); } catch { /* ignore */ }
}

function extractUploadedAssetPaths(result: any): string[] {
    const paths = new Set<string>();
    const add = (raw: unknown) => {
        if (typeof raw !== "string") return;
        const normalized = normalizeGlobalAssetPath(raw);
        if (normalized) paths.add(normalized);
    };
    if (Array.isArray(result?.succFiles)) {
        for (const item of result.succFiles) {
            add(item?.path);
        }
    }
    if (result?.succMap && typeof result.succMap === "object") {
        for (const value of Object.values(result.succMap)) {
            add(value);
        }
    }
    return Array.from(paths);
}

/**
 * 精简版 Protyle 编辑器封装（参考思源官方 fragmentEditor.ts / AgentComposer.ts 实现）。
 * 支持本地 LocalUndo、块级 Markdown 编辑、原生粘贴/拖拽上传图片与文件到思源 assets。
 */
export class LiteProtyleEditor {
    private container: HTMLElement;
    private options: LiteProtyleEditorOptions;
    private instance?: Protyle;
    private wysiwyg?: HTMLElement;
    private hintElement?: HTMLElement;
    private contentObserver?: MutationObserver;
    private hintObserver?: MutationObserver;
    private fallbackTextarea?: HTMLTextAreaElement;
    private cleanupFns: Array<() => void> = [];
    private destroyed = false;
    private suppressChange = false;

    constructor(options: LiteProtyleEditorOptions) {
        this.options = options;
        this.container = options.container;
        this.mount();
    }

    private mount(): void {
        const app = this.options.app || (window as any).siyuan?.ws?.app;
        const canUseProtyle = typeof Protyle === "function" && !!app;

        if (!canUseProtyle) {
            this.mountFallbackTextarea();
            return;
        }

        this.container.classList.add(PROTYLE_LITE_FRAGMENT_CLASS, "tn-lite-protyle");

        const protyleOptions: IProtyleOptions = {
            lite: true,
            blockId: "",
            render: {
                gutter: false,
                breadcrumb: false,
                scroll: false,
                background: false,
                title: false,
            },
        };

        // 第四个参数 runtimeCapabilities 关闭不必要的 WebSocket，与思源官方 AgentComposer 一致
        const runtimeCapabilities: Record<string, any> = {
            websocket: false,
        };
        if (this.options.enableAssets === false) {
            runtimeCapabilities.upload = false;
        }

        const instance: Protyle = new (Protyle as any)(app, this.container, protyleOptions, runtimeCapabilities);
        this.instance = instance;
        const protyle = instance.protyle;
        const wysiwyg = protyle.wysiwyg?.element;
        const hintElement = protyle.hint?.element;

        this.wysiwyg = wysiwyg;
        this.hintElement = hintElement;

        if (hintElement) {
            hintElement.classList.add(PROTYLE_LITE_HINT_OVERLAY_CLASS, "tn-lite-protyle__hint");
            document.body.appendChild(hintElement);
            // 确保提示面板始终浮在 Dialog 之上
            const ensureHintZIndex = () => {
                if (!hintElement.classList.contains("fn__none")) {
                    const currentZ = (window as any).siyuan?.zIndex;
                    if (typeof currentZ === "number") {
                        hintElement.style.zIndex = String(++(window as any).siyuan.zIndex);
                    } else {
                        hintElement.style.zIndex = "9999";
                    }
                }
            };
            this.hintObserver = new MutationObserver(ensureHintZIndex);
            this.hintObserver.observe(hintElement, { attributes: true, attributeFilter: ["class"] });
        }

        protyle.toolbar?.subElement?.setAttribute("data-position-boundary", "viewport");

        if (wysiwyg) {
            wysiwyg.setAttribute("data-readonly", this.options.readOnly ? "true" : "false");
            if (this.options.readOnly) {
                instance.disable();
            }

            // 设置初始内容
            this.setMarkdown(this.options.initialMarkdown || "");

            // 监听内容变更
            this.contentObserver = new MutationObserver(() => {
                if (this.destroyed || this.suppressChange) return;
                this.updateEmptyClass();
                this.options.onChange?.(this.getMarkdown());
            });
            this.contentObserver.observe(wysiwyg, {
                childList: true,
                characterData: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["src", "data-src", "data-href", "data-task", "style"],
            });

            // 精简版无文档 ID，直接拦截双击图片预览（参考 AgentComposer.ts）
            const onDblClick = (event: MouseEvent) => {
                const target = event.target as HTMLElement | null;
                const img = target?.closest?.("img:not(.emoji)") as HTMLImageElement | null;
                if (!img || !wysiwyg.contains(img)) return;
                const src = img.dataset.src || img.getAttribute("src") || "";
                if (!src) return;
                const allSrcs = Array.from(wysiwyg.querySelectorAll<HTMLImageElement>("img:not(.emoji)"))
                    .map((item) => item.dataset.src || item.getAttribute("src") || "")
                    .filter(Boolean);
                if (this.options.onImageDoubleClick) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    this.options.onImageDoubleClick(src, allSrcs);
                }
            };
            wysiwyg.addEventListener("dblclick", onDblClick, true);
            this.cleanupFns.push(() => wysiwyg.removeEventListener("dblclick", onDblClick, true));

            // 提示菜单可见时，让方向键和回车优先由 Protyle Hint 处理，Esc 仅关闭提示菜单而不关闭弹窗
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.isComposing) return;
                const hintEl = protyle.hint?.element;
                if (hintEl && !hintEl.classList.contains("fn__none")) {
                    if (event.key === "Enter" || event.key.indexOf("Arrow") > -1) {
                        if (protyle.hint?.select(event, protyle)) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                    } else if (event.key === "Escape") {
                        hintEl.classList.add("fn__none");
                        event.preventDefault();
                        event.stopPropagation();
                    }
                }
            };
            wysiwyg.addEventListener("keydown", onKeyDown, true);
            this.cleanupFns.push(() => wysiwyg.removeEventListener("keydown", onKeyDown, true));
        }

        // 监听当前精简版 Protyle 上传完成的图片与文件，及时纳入 assets-cleanup-ignore
        const eventBus = this.options.plugin?.eventBus;
        if (this.options.enableAssets !== false && eventBus && typeof eventBus.on === "function") {
            const onBeforeUpload = (event: CustomEvent<any>) => {
                const detail = event?.detail;
                if (!detail || detail.protyle !== protyle) return;
                if (typeof detail.onComplete === "function") {
                    detail.onComplete((result: any) => {
                        if (this.destroyed) return;
                        const uploaded = extractUploadedAssetPaths(result);
                        if (uploaded.length > 0) {
                            this.options.onAssetUploaded?.(uploaded);
                        }
                    });
                }
            };
            eventBus.on("before-upload-assets", onBeforeUpload);
            this.cleanupFns.push(() => eventBus.off("before-upload-assets", onBeforeUpload));
        }
    }

    private mountFallbackTextarea(): void {
        const textarea = document.createElement("textarea");
        textarea.className = "b3-text-field tn-lite-protyle__fallback";
        textarea.style.cssText = "width: 100%; min-height: 160px; resize: vertical; box-sizing: border-box;";
        textarea.spellcheck = false;
        if (this.options.placeholder) textarea.placeholder = this.options.placeholder;
        textarea.value = this.options.initialMarkdown || "";
        if (this.options.readOnly) {
            textarea.readOnly = true;
            textarea.disabled = true;
        }
        textarea.addEventListener("input", () => {
            this.options.onChange?.(textarea.value);
        });
        this.container.innerHTML = "";
        this.container.appendChild(textarea);
        this.fallbackTextarea = textarea;
    }

    private updateEmptyClass(): void {
        if (!this.wysiwyg) return;
        const empty = isWysiwygEmpty(this.wysiwyg);
        this.wysiwyg.classList.toggle("tn-lite-protyle--empty", empty);
    }

    public setMarkdown(markdown: string): void {
        if (this.destroyed) return;
        if (this.fallbackTextarea) {
            this.fallbackTextarea.value = markdown || "";
            return;
        }
        const protyle = this.instance?.protyle;
        const wysiwyg = this.wysiwyg;
        if (!protyle || !wysiwyg) return;

        this.suppressChange = true;
        try {
            const normalized = convertLegacyHtmlImgToMarkdown(markdown || "").trim();
            wysiwyg.innerHTML = "";
            if (!normalized) {
                wysiwyg.appendChild(createEmptyParagraphBlock(this.options.placeholder));
            } else if (protyle.lute && typeof protyle.lute.Md2BlockDOM === "function") {
                const dom = protyle.lute.Md2BlockDOM(normalized);
                if (dom && dom.trim()) {
                    wysiwyg.innerHTML = dom;
                } else {
                    wysiwyg.appendChild(createEmptyParagraphBlock(this.options.placeholder));
                }
            } else {
                const block = createEmptyParagraphBlock(this.options.placeholder);
                const editable = block.querySelector<HTMLElement>('[contenteditable="true"]');
                if (editable) editable.textContent = normalized;
                wysiwyg.appendChild(block);
            }
            renderSpecialBlocks(wysiwyg);
            this.updateEmptyClass();
        } finally {
            this.suppressChange = false;
        }
    }

    public appendMarkdown(markdown: string): void {
        if (!markdown || this.destroyed) return;
        const existing = this.getMarkdown();
        const combined = existing ? `${existing}\n\n${markdown}` : markdown;
        this.setMarkdown(combined);
        this.options.onChange?.(this.getMarkdown());
    }

    public getMarkdown(): string {
        if (this.destroyed) return "";
        if (this.fallbackTextarea) {
            return this.fallbackTextarea.value.trim();
        }
        const protyle = this.instance?.protyle;
        const wysiwyg = this.wysiwyg;
        if (!protyle || !wysiwyg) return "";
        if (isWysiwygEmpty(wysiwyg)) return "";

        const clone = wysiwyg.cloneNode(true) as HTMLElement;
        if (protyle.lute && typeof protyle.lute.BlockDOM2StdMd === "function") {
            return protyle.lute.BlockDOM2StdMd(clone.innerHTML).trim();
        }
        return (clone.textContent || "").trim();
    }

    public isEmpty(): boolean {
        if (this.fallbackTextarea) {
            return this.fallbackTextarea.value.trim().length === 0;
        }
        if (!this.wysiwyg) return true;
        return isWysiwygEmpty(this.wysiwyg);
    }

    public isUploading(): boolean {
        return !!this.instance?.isUploading?.() || !!this.instance?.protyle?.upload?.isUploading;
    }

    public focus(): void {
        if (this.destroyed) return;
        if (this.fallbackTextarea) {
            this.fallbackTextarea.focus();
            return;
        }
        try {
            this.instance?.focus();
        } catch {
            // ignore
        }
    }

    public setReadOnly(readOnly: boolean): void {
        this.options.readOnly = readOnly;
        if (this.fallbackTextarea) {
            this.fallbackTextarea.readOnly = readOnly;
            this.fallbackTextarea.disabled = readOnly;
            return;
        }
        if (this.wysiwyg) {
            this.wysiwyg.setAttribute("data-readonly", readOnly ? "true" : "false");
        }
        if (readOnly) {
            this.instance?.disable();
        } else {
            this.instance?.enable();
        }
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const fn of this.cleanupFns) {
            try { fn(); } catch { /* ignore */ }
        }
        this.cleanupFns = [];
        try { this.contentObserver?.disconnect(); } catch { /* ignore */ }
        try { this.hintObserver?.disconnect(); } catch { /* ignore */ }
        this.contentObserver = undefined;
        this.hintObserver = undefined;
        try { this.instance?.destroy(); } catch { /* ignore */ }
        this.instance = undefined;
        try { this.hintElement?.remove(); } catch { /* ignore */ }
        this.hintElement = undefined;
        this.wysiwyg = undefined;
        this.fallbackTextarea = undefined;
        this.container.classList.remove(PROTYLE_LITE_FRAGMENT_CLASS, "tn-lite-protyle");
    }
}
