const blockIdPattern = /^\d{14}-[a-z0-9]{7}$/i;
const siyuanBlockPrefix = 'siyuan://blocks/';
const wholeMarkdownLink = /^\[((?:\\[^\r\n]|\[[^\[\]\r\n]*\]|[^\[\]\\\r\n])+)\]\((siyuan:\/\/blocks\/[^)\s<>]+|<siyuan:\/\/blocks\/[^)\s<>]+>)\)$/i;

export function getSiyuanBlockIdFromUrl(url: string): string | undefined {
    if (!url.toLowerCase().startsWith(siyuanBlockPrefix)) return undefined;
    const blockId = url.slice(siyuanBlockPrefix.length);
    return blockIdPattern.test(blockId) ? blockId : undefined;
}

export function getTaskBoundBlockId(task: { blockId?: string | null; docId?: string | null }): string | undefined {
    const id = task.blockId || task.docId;
    return typeof id === 'string' && blockIdPattern.test(id) ? id : undefined;
}

export function parseSiyuanTaskTitle(title: string): { title: string; blockId: string } | undefined {
    const match = wholeMarkdownLink.exec(title.trim());
    if (!match) return undefined;
    const url = match[2].startsWith('<') ? match[2].slice(1, -1) : match[2];
    const blockId = getSiyuanBlockIdFromUrl(url);
    if (blockId) return { title: match[1].replace(/\\([\\[\]()])/g, '$1'), blockId };
}
