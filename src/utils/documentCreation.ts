import { i18n } from "../pluginInstance";

interface KernelResponse<T> {
    code: number;
    msg?: string;
    data: T;
}

interface ResolvedPath {
    status: 'resolved' | 'missing' | 'ambiguous';
    start: { id: string | null; revision: string };
    resolved: { id: string; revision: string } | null;
    nextIndex: number;
    nameConditions: Array<{ parentID: string | null; title: string; expectedID: string | null }>;
}

async function post(url: string, data: unknown): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

async function readResult<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result: KernelResponse<T> = await response.json();
    if (result.code !== 0) {
        if ((result.data as { reason?: string })?.reason === 'indexUnavailable' ||
            result.msg?.includes('document metadata is not ready')) {
            throw new Error(i18n('documentMetadataNotReady'));
        }
        throw new Error(result.msg || i18n('documentCreationFailed'));
    }
    return result.data;
}

/**
 * 3.8.9 起使用结构化路径和父身份创建，避开旧接口新建父级时的元数据校验问题。
 * 只有只读的路径接口返回 404 才回退；写入失败或结果未知时不得换接口重建。
 */
export async function createDocumentWithMarkdown(notebook: string, path: string, markdown: string): Promise<string> {
    const segments = path.split('/').filter(Boolean);
    const title = segments.pop();
    if (!title) throw new Error(i18n('pleaseInputDocumentTitle'));

    const resolve = () => post('/api/filetree/resolveDocPath', {
        notebook, start: { kind: 'root' }, segments
    });
    let response = await resolve();
    if (response.status === 404) {
        const id = await readResult<string>(await post('/api/filetree/createDocWithMd', { notebook, path, markdown }));
        if (!id || typeof id !== 'string') throw new Error(i18n('documentCreationFailed'));
        return id;
    }

    // 每次补齐一个父级后重新解析，使用内核的名称条件防止并发出现同名父级。
    for (let step = 0; step <= segments.length; step++) {
        const location = await readResult<ResolvedPath>(response);
        if (location.status === 'ambiguous') throw new Error(i18n('documentPathAmbiguous'));
        if (location.status !== 'resolved' && location.status !== 'missing') {
            throw new Error(i18n('documentCreationFailed'));
        }
        const isDocument = location.status === 'resolved';
        const nextTitle = isDocument ? title : segments[location.nextIndex];
        if (!nextTitle) throw new Error(i18n('documentCreationFailed'));
        const parent = location.resolved || location.start;
        const id = window.Lute.NewNodeID();
        let created: { id: string };
        try {
            created = await readResult<{ id: string }>(await post('/api/filetree/createDocByParent', {
                notebook,
                parentID: parent.id,
                id,
                title: { format: 'plain', text: nextTitle },
                markdown: isDocument ? markdown : '',
                expectedParentRevision: parent.revision,
                nameConditions: location.nameConditions
            }));
            if (created?.id !== id) throw new Error(i18n('documentCreationFailed'));
        } catch (error) {
            // 内核可能已落盘但后续步骤或响应失败，保留尝试的 ID 供检查，禁止自动重试。
            throw new Error(`${error instanceof Error ? error.message : String(error)}\n${i18n('documentCreationCheckId', { id })}`);
        }
        if (isDocument) return created.id;
        response = await resolve();
    }
    throw new Error(i18n('documentCreationFailed'));
}
