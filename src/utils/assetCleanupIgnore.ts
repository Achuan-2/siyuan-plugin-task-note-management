export const LEGACY_PLUGIN_ASSET_PREFIX = "/data/storage/petal/siyuan-plugin-task-note-management/assets/";

export interface AssetCleanupIgnoreData {
    content: string;
    revision: string;
}

export type AssetCleanupApiPost = (url: string, data: any) => Promise<{ code?: number; msg?: string; data?: any } | null>;

const DEFAULT_MAX_RETRIES = 3;

async function defaultApiPost(url: string, data: any): Promise<{ code?: number; msg?: string; data?: any } | null> {
    const kernelClient = (globalThis as any).siyuan?.client;
    if (kernelClient && typeof kernelClient.fetch === "function") {
        try {
            const resp = await kernelClient.fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data ?? {}),
            });
            if (!resp?.ok) return null;
            return await resp.json();
        } catch {
            return null;
        }
    }
    if (typeof globalThis.fetch === "function") {
        try {
            const resp = await globalThis.fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data ?? {}),
            });
            if (!resp?.ok) return null;
            return await resp.json();
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * 与思源内核 kernel/model/assets_cleanup_ignore.go 中的 assetCleanupIgnoreLiteral 保持一致。
 */
export function formatAssetCleanupIgnoreLiteral(assetPath: string): string {
    const escaped = assetPath.replace(/[*\[\]()+^${}|]/g, (ch) => `\\${ch}`);
    return `/${escaped}`;
}

/**
 * 将各种形式的思源全局资源路径归一化为 `assets/...` 相对路径；
 * 仅接受合法的全局工作空间 assets/ 文件路径，其他（外链、data URI、加密笔记本、目录、越界路径）返回 null。
 */
export function normalizeGlobalAssetPath(rawPath: string): string | null {
    if (!rawPath || typeof rawPath !== "string") return null;
    let p = rawPath.trim();
    if (!p) return null;
    if ((p.startsWith("<") && p.endsWith(">")) || (p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
        p = p.slice(1, -1).trim();
    }
    // 去掉 query 和 hash
    p = p.split(/[?#]/)[0].trim();
    if (!p) return null;
    // 排除协议 URL（http/https/data/file/siyuan 等）
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(p)) return null;

    // 尝试解码百分号编码（保留非法编码的原始字符串）
    try {
        p = decodeURIComponent(p);
    } catch {
        // ignore malformed percent encoding
    }

    p = p.replace(/^\/+/, "");
    if (p.startsWith("data/assets/")) {
        p = p.slice("data/".length);
    }
    if (!p.startsWith("assets/")) return null;
    if (p.endsWith("/")) return null;
    if (/[\\:?\r\n\0]/.test(p)) return null;

    // POSIX 路径规范化并检查路径穿越
    const rawParts = p.split("/");
    const parts: string[] = [];
    for (const part of rawParts) {
        if (!part || part === ".") continue;
        if (part === "..") return null;
        parts.push(part);
    }
    if (parts.length < 2 || parts[0] !== "assets") return null;
    const normalized = parts.join("/");
    if (normalized !== p && normalized.replace(/\/+/g, "/") !== p.replace(/\/+/g, "/")) {
        return null;
    }
    return normalized;
}

/**
 * 从 Markdown / HTML 备注内容中提取所有引用的思源全局 `assets/...` 资源路径（去重、排序）。
 */
export function extractNoteAssetPaths(markdown: string): string[] {
    if (!markdown || typeof markdown !== "string") return [];
    const found = new Set<string>();
    const addCandidate = (raw: string | undefined) => {
        if (!raw) return;
        const normalized = normalizeGlobalAssetPath(raw);
        if (normalized) found.add(normalized);
    };

    // 1. Markdown 图片与链接：![alt](target "title") 或 [text](target "title")
    // 支持文件名中包含空格或配对括号，如 [附件](assets/doc (1).pdf)
    for (let i = 0; i < markdown.length; i++) {
        if (markdown[i] !== "]" || markdown[i + 1] !== "(") continue;
        let j = i + 2;
        while (j < markdown.length && (markdown[j] === " " || markdown[j] === "\t")) j++;
        if (j >= markdown.length) break;

        if (markdown[j] === "<") {
            const closeAngle = markdown.indexOf(">", j + 1);
            if (closeAngle !== -1) {
                addCandidate(markdown.slice(j + 1, closeAngle));
                i = closeAngle;
                continue;
            }
        }

        let depth = 0;
        let end = j;
        let inQuote: string | null = null;
        while (end < markdown.length) {
            const ch = markdown[end];
            if (ch === "\r" || ch === "\n") break;
            if (inQuote) {
                if (ch === "\\" && end + 1 < markdown.length) {
                    end += 2;
                    continue;
                }
                if (ch === inQuote) {
                    inQuote = null;
                }
                end++;
                continue;
            }
            if ((ch === '"' || ch === "'") && end > j && /\s/.test(markdown[end - 1])) {
                inQuote = ch;
                end++;
                continue;
            }
            if (ch === "(") {
                depth++;
            } else if (ch === ")") {
                if (depth === 0) break;
                depth--;
            }
            end++;
        }

        if (end < markdown.length && markdown[end] === ")") {
            const rawInner = markdown.slice(j, end).trim();
            // 去掉末尾可选的 Markdown 标题（"title" 或 'title'）
            const target = rawInner.replace(/\s+(?:"[^"]*"|'[^']*')\s*$/, "").trim();
            addCandidate(target);
            i = end;
        }
    }

    // 2. HTML 属性：src="..." / href="..." / data-src="..." / data-href="..."
    let match: RegExpExecArray | null;
    const htmlAttrRegex = /\b(?:src|href|data-src|data-href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/gi;
    while ((match = htmlAttrRegex.exec(markdown)) !== null) {
        addCandidate(match[1] || match[2] || match[3]);
    }

    return Array.from(found).sort();
}

/**
 * 提取旧版插件私有资源路径 `/data/storage/petal/siyuan-plugin-task-note-management/assets/<fileName>`。
 */
export function extractLegacyPluginAssetPaths(markdown: string): string[] {
    if (!markdown || typeof markdown !== "string") return [];
    if (!markdown.includes(LEGACY_PLUGIN_ASSET_PREFIX)) return [];
    const found = new Set<string>();
    const regex = /\/data\/storage\/petal\/siyuan-plugin-task-note-management\/assets\/([^)"'\s<>?#]+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(markdown)) !== null) {
        const fileName = match[1]?.trim();
        if (fileName && !fileName.includes("..")) {
            found.add(`${LEGACY_PLUGIN_ASSET_PREFIX}${fileName}`);
        }
    }
    return Array.from(found).sort();
}

/**
 * 将旧版备注中可能存在的 `<img src="..." width="..." alt="..." title="..." />` 转为标准 Markdown，
 * 以便精简版 Protyle 原生渲染并支持拖拽调整图片宽度。
 */
export function convertLegacyHtmlImgToMarkdown(markdown: string): string {
    if (!markdown || typeof markdown !== "string") return markdown;
    return markdown.replace(/<img\s+([^>]*?)\s*\/?>/gi, (match, attrsStr: string) => {
        const srcMatch = attrsStr.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
        if (!srcMatch) return match;
        const src = srcMatch[1].trim();
        if (!src) return match;
        const altMatch = attrsStr.match(/\balt\s*=\s*["']([^"']*)["']/i);
        const titleMatch = attrsStr.match(/\btitle\s*=\s*["']([^"']*)["']/i);
        const widthMatch = attrsStr.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
        const alt = altMatch ? altMatch[1] : "";
        const title = titleMatch && titleMatch[1] ? ` "${titleMatch[1]}"` : "";
        const cleanSrc = src.split("#")[0];
        const widthVal = widthMatch ? widthMatch[1].trim() : "";
        const widthCss = widthVal ? (/^\d+$/.test(widthVal) ? `${widthVal}px` : widthVal) : "";
        const ial = widthCss ? `{: style="width: ${widthCss};"}` : "";
        return `![${alt}](${cleanSrc}${title})${ial}`;
    });
}

export async function getAssetCleanupIgnore(apiPost: AssetCleanupApiPost = defaultApiPost): Promise<AssetCleanupIgnoreData | null> {
    const resp = await apiPost("/api/asset/getAssetCleanupIgnore", {});
    if (!resp || resp.code !== 0 || !resp.data) return null;
    return {
        content: typeof resp.data.content === "string" ? resp.data.content : "",
        revision: typeof resp.data.revision === "string" ? resp.data.revision : "missing",
    };
}

export async function addAssetCleanupIgnore(
    paths: Iterable<string>,
    apiPost: AssetCleanupApiPost = defaultApiPost
): Promise<boolean> {
    const normalized = Array.from(
        new Set(
            Array.from(paths)
                .map((p) => normalizeGlobalAssetPath(p))
                .filter((p): p is string => !!p)
        )
    );
    if (normalized.length === 0) return true;
    const resp = await apiPost("/api/asset/addAssetCleanupIgnore", { paths: normalized });
    return !!resp && resp.code === 0;
}

/**
 * 从 `data/.siyuan/assets-cleanup-ignore` 中移除指定资源的精确条目，
 * 保留所有注释、空行、通配符规则及其他条目；遇到版本冲突（409）自动重试。
 */
export async function removeAssetCleanupIgnore(
    paths: Iterable<string>,
    apiPost: AssetCleanupApiPost = defaultApiPost
): Promise<boolean> {
    const normalized = Array.from(
        new Set(
            Array.from(paths)
                .map((p) => normalizeGlobalAssetPath(p))
                .filter((p): p is string => !!p)
        )
    );
    if (normalized.length === 0) return true;

    const exactMatchers = new Set<string>();
    for (const p of normalized) {
        exactMatchers.add(formatAssetCleanupIgnoreLiteral(p));
        exactMatchers.add(`/${p}`);
        exactMatchers.add(p);
    }

    for (let attempt = 0; attempt < DEFAULT_MAX_RETRIES; attempt++) {
        const current = await getAssetCleanupIgnore(apiPost);
        if (!current) return false;
        if (!current.content) return true;

        const hasTrailingNewline = current.content.endsWith("\n");
        const useCRLF = current.content.includes("\r\n");
        const newline = useCRLF ? "\r\n" : "\n";
        const normalizedContent = current.content.replace(/\r\n/g, "\n");
        const lines = normalizedContent.split("\n");
        // 若末尾有换行符，split 会多出一个尾空串，先拆出以便精准保留格式
        if (hasTrailingNewline && lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
        }

        let removedAny = false;
        const keptLines = lines.filter((line) => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#") && exactMatchers.has(trimmed)) {
                removedAny = true;
                return false;
            }
            return true;
        });

        if (!removedAny) return true;

        const nextContent = keptLines.length === 0
            ? ""
            : keptLines.join(newline) + (hasTrailingNewline ? newline : "");

        const resp = await apiPost("/api/asset/setAssetCleanupIgnore", {
            content: nextContent,
            expectedRevision: current.revision,
        });
        if (resp && resp.code === 0) return true;
        if (resp && resp.code === 409) {
            continue;
        }
        return false;
    }

    return false;
}

/**
 * 收集 reminderData 中所有任务（含重复任务实例）引用的全部 `assets/...` 路径。
 */
export function collectAllReferencedTaskNoteAssets(
    reminderData: Record<string, any> | null | undefined,
    excludeKeys?: Set<string>
): Set<string> {
    const referenced = new Set<string>();
    if (!reminderData || typeof reminderData !== "object") return referenced;

    const addFromList = (list: unknown) => {
        if (!Array.isArray(list)) return;
        for (const item of list) {
            if (typeof item !== "string") continue;
            const norm = normalizeGlobalAssetPath(item);
            if (norm) referenced.add(norm);
        }
    };
    const addFromMarkdown = (md: unknown) => {
        if (typeof md !== "string" || !md) return;
        for (const asset of extractNoteAssetPaths(md)) {
            referenced.add(asset);
        }
    };

    for (const [taskId, task] of Object.entries(reminderData)) {
        if (!task || typeof task !== "object") continue;
        if (!excludeKeys?.has(taskId)) {
            addFromList(task.noteAssets);
            addFromMarkdown(task.note);
        }
        const instances = task.repeat?.instances;
        if (instances && typeof instances === "object") {
            for (const [instanceDate, state] of Object.entries(instances as Record<string, any>)) {
                if (!state || typeof state !== "object" || state.deleted) continue;
                const instanceKey = `${taskId}_${instanceDate}`;
                if (excludeKeys?.has(instanceKey)) continue;
                addFromList(state.noteAssets);
                addFromMarkdown(state.note);
            }
        }
    }

    return referenced;
}

/**
 * 计算被移除的资产中已不再被其他任何任务引用的项，并从 `assets-cleanup-ignore` 移除。
 */
export async function reconcileRemovedTaskAssets(
    removedAssets: Iterable<string>,
    remainingReminderData: Record<string, any> | null | undefined,
    apiPost: AssetCleanupApiPost = defaultApiPost
): Promise<string[]> {
    const candidates = Array.from(
        new Set(
            Array.from(removedAssets)
                .map((p) => normalizeGlobalAssetPath(p))
                .filter((p): p is string => !!p)
        )
    );
    if (candidates.length === 0) return [];

    const stillReferenced = collectAllReferencedTaskNoteAssets(remainingReminderData);
    const toUnignore = candidates.filter((p) => !stillReferenced.has(p));
    if (toUnignore.length === 0) return [];

    await removeAssetCleanupIgnore(toUnignore, apiPost);
    return toUnignore;
}

export interface LegacyAssetMigrationDeps {
    readLegacyAssetBlob: (legacyPath: string) => Promise<Blob | null>;
    writeGlobalAssetBlob: (targetDataPath: string, blob: Blob) => Promise<boolean>;
    addIgnore?: (paths: string[]) => Promise<boolean>;
}

/**
 * 将 Markdown 中旧版插件私有目录图片迁移至思源 `/data/assets/`，
 * 重写路径为 `assets/<fileName>`，并加入 `assets-cleanup-ignore`。
 */
export async function migrateLegacyAssetsInMarkdown(
    markdown: string,
    deps?: Partial<LegacyAssetMigrationDeps>,
    options?: { skipAddIgnore?: boolean }
): Promise<{
    markdown: string;
    migratedAssets: string[];
    legacyPaths: string[];
    failedLegacyPaths: string[];
}> {
    if (!markdown || typeof markdown !== "string") {
        return { markdown: markdown || "", migratedAssets: [], legacyPaths: [], failedLegacyPaths: [] };
    }

    const legacyPaths = extractLegacyPluginAssetPaths(markdown);
    if (legacyPaths.length === 0) {
        return { markdown, migratedAssets: [], legacyPaths: [], failedLegacyPaths: [] };
    }

    const readLegacyAssetBlob = deps?.readLegacyAssetBlob ?? (async (legacyPath: string) => {
        if (typeof globalThis.fetch !== "function") return null;
        const resp = await globalThis.fetch("/api/file/getFile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: legacyPath }),
        });
        if (!resp.ok || resp.status === 202) return null;
        return await resp.blob();
    });
    const writeGlobalAssetBlob = deps?.writeGlobalAssetBlob ?? (async (targetDataPath: string, blob: Blob) => {
        if (typeof globalThis.fetch !== "function" || typeof FormData === "undefined") return false;
        const form = new FormData();
        form.append("path", targetDataPath);
        form.append("isDir", "false");
        form.append("modTime", Math.floor(Date.now() / 1000).toString());
        form.append("file", blob);
        const resp = await globalThis.fetch("/api/file/putFile", {
            method: "POST",
            body: form,
        });
        if (!resp.ok) return false;
        const json = await resp.json().catch(() => null);
        return !json || json.code === 0;
    });
    const addIgnore = deps?.addIgnore ?? ((paths: string[]) => addAssetCleanupIgnore(paths));

    let nextMarkdown = markdown;
    const migratedAssets: string[] = [];
    const succeededLegacyPaths: string[] = [];
    const failedLegacyPaths: string[] = [];

    for (const legacyPath of legacyPaths) {
        const fileName = legacyPath.slice(LEGACY_PLUGIN_ASSET_PREFIX.length);
        const globalRelPath = normalizeGlobalAssetPath(`assets/${fileName}`);
        if (!globalRelPath) {
            failedLegacyPaths.push(legacyPath);
            continue;
        }
        try {
            const blob = await readLegacyAssetBlob(legacyPath);
            if (!blob) {
                failedLegacyPaths.push(legacyPath);
                continue;
            }
            const ok = await writeGlobalAssetBlob(`/data/${globalRelPath}`, blob);
            if (!ok) {
                failedLegacyPaths.push(legacyPath);
                continue;
            }
            // 替换所有精确出现（同时保留可能紧随其后的 #width=... 或查询串）
            nextMarkdown = nextMarkdown.split(legacyPath).join(globalRelPath);
            migratedAssets.push(globalRelPath);
            succeededLegacyPaths.push(legacyPath);
        } catch (err) {
            console.warn("Failed to migrate legacy note asset:", legacyPath, err);
            failedLegacyPaths.push(legacyPath);
        }
    }

    if (migratedAssets.length > 0 && !options?.skipAddIgnore) {
        await addIgnore(migratedAssets);
    }

    return {
        markdown: nextMarkdown,
        migratedAssets,
        legacyPaths: succeededLegacyPaths,
        failedLegacyPaths,
    };
}
