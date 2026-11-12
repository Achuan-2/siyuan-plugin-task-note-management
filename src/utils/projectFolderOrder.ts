import type { ProjectFolder } from '../components/dataManager/projectFolderManager';

/** 文件夹视图先展示子文件夹，再展示直属项目；无文件夹项目由调用方排在最后。 */
export function buildProjectFolderOrderMap(folders: ProjectFolder[], locale: string): Map<string, number> {
    const childrenByParent = new Map<string, ProjectFolder[]>();
    const folderIds = new Set(folders.map(folder => folder.id));
    folders.forEach(folder => {
        const parentId = folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : '';
        if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
        childrenByParent.get(parentId)!.push(folder);
    });
    childrenByParent.forEach(children => children.sort((a, b) =>
        (a.sort || 0) - (b.sort || 0) || (a.name || '').localeCompare(b.name || '', locale)));

    const order = new Map<string, number>();
    const visited = new Set<string>();
    const visitFolder = (folder: ProjectFolder) => {
        if (visited.has(folder.id)) return;
        visited.add(folder.id);
        (childrenByParent.get(folder.id) || []).forEach(visitFolder);
        order.set(folder.id, order.size);
    };
    (childrenByParent.get('') || []).forEach(visitFolder);
    // 损坏的父子循环也只访问一次，避免丢失项目或阻塞排序。
    folders.forEach(visitFolder);
    return order;
}
