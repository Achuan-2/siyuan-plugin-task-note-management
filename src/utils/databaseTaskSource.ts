/** 数据库条目的身份与文档块身份分开保存，独立条目不能写入块属性。 */
export interface DatabaseTaskSource {
    id: string;
    itemId: string;
    avId: string;
    databaseBlockId: string;
    title: string;
    blockId?: string;
    url: string;
}

export interface DatabaseMenuContext {
    element: HTMLElement;
    selectRowElements?: ArrayLike<HTMLElement>;
    selectRowIds?: string[];
    selectRowPoints?: Array<{ itemID: string; groupID?: string }>;
}

export function getDatabaseSelectedIds(context: DatabaseMenuContext): string[] {
    const ids = context.selectRowIds?.length
        ? context.selectRowIds
        : Array.from(context.selectRowElements || []).map(row => row.getAttribute('data-id'));
    return Array.from(new Set(ids.filter(Boolean)));
}

type Request = (url: string, data: any) => Promise<any>;

export async function readDatabaseTaskSources(context: DatabaseMenuContext, request: Request): Promise<DatabaseTaskSource[]> {
    const avId = context.element.getAttribute('data-av-id');
    const databaseBlockId = context.element.getAttribute('data-node-id');
    if (!avId || !databaseBlockId) throw new Error('数据库缺少定位信息');

    const viewId = context.element.getAttribute('custom-sy-av-view')
        || context.element.querySelector('.layout-tab-bar .item--focus')?.getAttribute('data-id');
    const rows = Array.from(context.selectRowElements || []);
    const sources: DatabaseTaskSource[] = [];
    for (const itemId of getDatabaseSelectedIds(context)) {
        const row = rows.find(element => element.getAttribute('data-id') === itemId);
        const cell = row?.querySelector<HTMLElement>('.av__cell[data-dtype="block"]');
        const text = cell?.querySelector<HTMLElement>('.av__celltext');
        let value: { block?: { id?: string; content?: string }; isDetached?: boolean };
        if (cell && text) {
            // 沿用思源主键单元格的标记，兼容旧版数据库菜单。
            value = {
                block: { id: text.getAttribute('data-id') || undefined, content: text.textContent || '' },
                isDetached: cell.getAttribute('data-detached') === 'true',
            };
        } else {
            // 虚拟滚动及隐藏主键的卡片没有可读单元格，按条目身份读取主键。
            const tables = await request('/api/av/getAttributeViewKeys', { id: itemId, avID: avId, itemID: itemId });
            const primary = tables?.find(table => table.avID === avId)?.keyValues
                ?.find(field => field.key?.type === 'block');
            value = primary?.values?.find(item => item.blockID === itemId);
        }
        if (!value?.block) throw new Error(`无法读取数据库条目 ${itemId}`);
        const params = new URLSearchParams({ avItemID: itemId, avStandalone: '1' });
        if (viewId) params.set('avViewID', viewId);
        const groupId = context.selectRowPoints?.find(point => point.itemID === itemId)?.groupID;
        if (groupId) params.set('avGroupID', groupId);
        sources.push({
            id: `av:${avId}:${itemId}`,
            itemId,
            avId,
            databaseBlockId,
            title: value.block.content?.trim() || '',
            blockId: value.isDetached ? undefined : value.block.id || undefined,
            url: `siyuan://blocks/${databaseBlockId}?${params.toString()}`,
        });
    }
    return sources;
}

export function buildDatabasePomodoroReminder(source: DatabaseTaskSource, untitled: string) {
    const title = source.title || untitled;
    return {
        id: source.id,
        title: title.length > 80 ? `${title.slice(0, 80)}...` : title,
        url: source.url,
        isBlockPomodoro: true,
    };
}
