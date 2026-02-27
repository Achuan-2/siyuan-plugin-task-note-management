/**
 * Copyright (c) 2023 frostime. All rights reserved.
 * https://github.com/frostime/sy-plugin-template-vite
 * 
 * See API Document in [API.md](https://github.com/siyuan-note/siyuan/blob/master/API.md)
 * API 文档见 [API_zh_CN.md](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)
 */

import { fetchPost, fetchSyncPost, IWebSocketData, openTab, Constants } from "siyuan";

import { getFrontend, openMobileFileById } from 'siyuan';
import { getPluginInstance } from "./pluginInstance";
export async function request(url: string, data: any) {
    let response: IWebSocketData = await fetchSyncPost(url, data);
    let res = response.code === 0 ? response.data : null;
    return res;
}

// **************************************** Noteboook ****************************************
export async function refreshSql() {
    return fetchSyncPost('/api/sqlite/flushTransaction');
}

export async function lsNotebooks(): Promise<IReslsNotebooks> {
    let url = '/api/notebook/lsNotebooks';
    return request(url, '');
}


export async function openNotebook(notebook: NotebookId) {
    let url = '/api/notebook/openNotebook';
    return request(url, { notebook: notebook });
}


export async function closeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/closeNotebook';
    return request(url, { notebook: notebook });
}


export async function renameNotebook(notebook: NotebookId, name: string) {
    let url = '/api/notebook/renameNotebook';
    return request(url, { notebook: notebook, name: name });
}


export async function createNotebook(name: string): Promise<Notebook> {
    let url = '/api/notebook/createNotebook';
    return request(url, { name: name });
}


export async function removeNotebook(notebook: NotebookId) {
    let url = '/api/notebook/removeNotebook';
    return request(url, { notebook: notebook });
}


export async function getNotebookConf(notebook: NotebookId): Promise<IResGetNotebookConf> {
    let data = { notebook: notebook };
    let url = '/api/notebook/getNotebookConf';
    return request(url, data);
}


export async function setNotebookConf(notebook: NotebookId, conf: NotebookConf): Promise<NotebookConf> {
    let data = { notebook: notebook, conf: conf };
    let url = '/api/notebook/setNotebookConf';
    return request(url, data);
}


// **************************************** File Tree ****************************************

export async function getDoc(id: BlockId) {
    let data = {
        id: id
    };
    let url = '/api/filetree/getDoc';
    return request(url, data);
}


export async function createDocWithMd(notebook: NotebookId, path: string, markdown: string): Promise<DocumentId> {
    let data = {
        notebook: notebook,
        path: path,
        markdown: markdown,
    };
    let url = '/api/filetree/createDocWithMd';
    return request(url, data);
}

export async function searchDocs(k: string, flashcard: boolean = false): Promise<IResSearchDocs[]> {
    let data = {
        k: k,
        flashcard: flashcard
    };
    let url = '/api/filetree/searchDocs';
    return request(url, data);
}

export async function renameDoc(notebook: NotebookId, path: string, title: string): Promise<DocumentId> {
    let data = {
        doc: notebook,
        path: path,
        title: title
    };
    let url = '/api/filetree/renameDoc';
    return request(url, data);
}

export async function renameDocByID(id: string, title: string): Promise<DocumentId> {
    let data = {
        id: id,
        title: title
    };
    let url = '/api/filetree/renameDocByID';
    return request(url, data);
}


export async function removeDoc(notebook: NotebookId, path: string) {
    let data = {
        notebook: notebook,
        path: path,
    };
    let url = '/api/filetree/removeDoc';
    return request(url, data);
}


export async function moveDocs(fromPaths: string[], toNotebook: NotebookId, toPath: string) {
    let data = {
        fromPaths: fromPaths,
        toNotebook: toNotebook,
        toPath: toPath
    };
    let url = '/api/filetree/moveDocs';
    return request(url, data);
}

export async function moveDocsByID(fromIDs: string[], toID: string) {
    let data = {
        fromIDs: fromIDs,
        toID: toID
    };
    let url = '/api/filetree/moveDocsByID';
    return request(url, data);
}


export async function getHPathByPath(notebook: NotebookId, path: string): Promise<string> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getHPathByPath';
    return request(url, data);
}


export async function getHPathByID(id: BlockId): Promise<string> {
    let data = {
        id: id
    };
    let url = '/api/filetree/getHPathByID';
    return request(url, data);
}


export async function getIDsByHPath(notebook: NotebookId, path: string): Promise<BlockId[]> {
    let data = {
        notebook: notebook,
        path: path
    };
    let url = '/api/filetree/getIDsByHPath';
    return request(url, data);
}

// **************************************** Asset Files ****************************************

export async function upload(assetsDirPath: string, files: any[]): Promise<IResUpload> {
    let form = new FormData();
    form.append('assetsDirPath', assetsDirPath);
    for (let file of files) {
        form.append('file[]', file);
    }
    let url = '/api/asset/upload';
    return request(url, form);
}

// **************************************** Block ****************************************
type DataType = "markdown" | "dom";
export async function insertBlock(
    dataType: DataType, data: string,
    nextID?: BlockId, previousID?: BlockId, parentID?: BlockId
): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        nextID: nextID,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/insertBlock';
    return request(url, payload);
}


export async function prependBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/prependBlock';
    return request(url, payload);
}


export async function appendBlock(dataType: DataType, data: string, parentID: BlockId | DocumentId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        parentID: parentID
    }
    let url = '/api/block/appendBlock';
    return request(url, payload);
}


export async function updateBlock(dataType: DataType, data: string, id: BlockId): Promise<IResdoOperations[]> {
    let payload = {
        dataType: dataType,
        data: data,
        id: id
    }
    let url = '/api/block/updateBlock';
    return request(url, payload);
}


export async function deleteBlock(id: BlockId): Promise<IResdoOperations[]> {
    let data = {
        id: id
    }
    let url = '/api/block/deleteBlock';
    return request(url, data);
}


export async function moveBlock(id: BlockId, previousID?: PreviousID, parentID?: ParentID): Promise<IResdoOperations[]> {
    let data = {
        id: id,
        previousID: previousID,
        parentID: parentID
    }
    let url = '/api/block/moveBlock';
    return request(url, data);
}


export async function foldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/foldBlock';
    return request(url, data);
}


export async function unfoldBlock(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/unfoldBlock';
    return request(url, data);
}


export async function getBlockKramdown(id: BlockId, mode: string = 'md'): Promise<IResGetBlockKramdown> {
    let data = {
        id: id,
        mode: mode
    }
    let url = '/api/block/getBlockKramdown';
    return request(url, data);
}
export async function getBlockDOM(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/getBlockDOM';
    return request(url, data);
}

export async function getHeadingChildrenDOM(id: BlockId) {
    let data = {
        id: id
    }
    let url = '/api/block/getHeadingChildrenDOM';
    return request(url, data);
}

export async function getChildBlocks(id: BlockId): Promise<IResGetChildBlock[]> {
    let data = {
        id: id
    }
    let url = '/api/block/getChildBlocks';
    return request(url, data);
}

export async function transferBlockRef(fromID: BlockId, toID: BlockId, refIDs: BlockId[]) {
    let data = {
        fromID: fromID,
        toID: toID,
        refIDs: refIDs
    }
    let url = '/api/block/transferBlockRef';
    return request(url, data);
}

// **************************************** Attributes ****************************************
export async function setBlockAttrs(id: BlockId, attrs: { [key: string]: string }) {
    let data = {
        id: id,
        attrs: attrs
    }
    let url = '/api/attr/setBlockAttrs';
    return request(url, data);
}


export async function getBlockAttrs(id: BlockId): Promise<{ [key: string]: string }> {
    let data = {
        id: id
    }
    let url = '/api/attr/getBlockAttrs';
    return request(url, data);
}

// **************************************** Block Project IDs Helpers ****************************************
/**
 * 解析块属性 custom-task-projectId 为数组（去重 & 去空格）
 * @param id block id
 */
export async function getBlockProjectIds(id: BlockId): Promise<string[]> {
    try {
        const attrs = await getBlockAttrs(id);
        if (!attrs || typeof attrs !== 'object') return [];
        const raw = attrs['custom-task-projectId'] || '';
        if (!raw) return [];
        return Array.from(new Set(raw.split(',').map(s => s.trim()).filter(s => s)));
    } catch (error) {
        console.warn('getBlockProjectIds failed:', error);
        return [];
    }
}

/**
 * 将数组写入块属性 custom-task-projectId（以逗号分隔），如果为空数组则清空属性
 */
export async function setBlockProjectIds(id: BlockId, projectIds: string[]): Promise<any> {
    try {
        const csv = projectIds && projectIds.length > 0 ? projectIds.join(',') : '';
        return await setBlockAttrs(id, { 'custom-task-projectId': csv });
    } catch (error) {
        console.warn('setBlockProjectIds failed:', error);
        throw error;
    }
}

/**
 * 将单个 projectId 添加到块的 custom-task-projectId 属性中（去重）
 */
export async function addBlockProjectId(id: BlockId, projectId: string): Promise<any> {
    if (!projectId) return;
    try {
        const ids = await getBlockProjectIds(id);
        if (!ids.includes(projectId)) {
            ids.push(projectId);
            return await setBlockProjectIds(id, ids);
        }
    } catch (error) {
        console.warn('addBlockProjectId failed:', error);
        throw error;
    }
}

/**
 * 从块的 custom-task-projectId 中移除一个 projectId，如果最后为空数组则清空属性
 */
export async function removeBlockProjectId(id: BlockId, projectId: string): Promise<any> {
    try {
        const ids = await getBlockProjectIds(id);
        const filtered = ids.filter(p => p !== projectId);
        return await setBlockProjectIds(id, filtered);
    } catch (error) {
        console.warn('removeBlockProjectId failed:', error);
        throw error;
    }
}

// **************************************** Block Reminder IDs Helpers ****************************************
/**
 * 解析块属性 custom-bind-reminders 为数组（去重 & 去空格）
 * @param id block id
 */
export async function getBlockReminderIds(id: BlockId): Promise<string[]> {
    try {
        const attrs = await getBlockAttrs(id);
        if (!attrs || typeof attrs !== 'object') return [];
        const raw = attrs['custom-bind-reminders'] || '';
        if (!raw) return [];
        return Array.from(new Set(raw.split(',').map(s => s.trim()).filter(s => s)));
    } catch (error) {
        console.warn('getBlockReminderIds failed:', error);
        return [];
    }
}

/**
 * 将数组写入块属性 custom-bind-reminders（以逗号分隔），如果为空数组则清空属性
 */
export async function setBlockReminderIds(id: BlockId, reminderIds: string[]): Promise<any> {
    try {
        const csv = reminderIds && reminderIds.length > 0 ? reminderIds.join(',') : '';
        return await setBlockAttrs(id, { 'custom-bind-reminders': csv });
    } catch (error) {
        console.warn('setBlockReminderIds failed:', error);
        throw error;
    }
}

/**
 * 将单个 reminderId 添加到块的 custom-bind-reminders 属性中（去重）
 */
export async function addBlockReminderId(id: BlockId, reminderId: string): Promise<any> {
    if (!reminderId) return;
    try {
        const ids = await getBlockReminderIds(id);
        if (!ids.includes(reminderId)) {
            ids.push(reminderId);
            return await setBlockReminderIds(id, ids);
        }
    } catch (error) {
        console.warn('addBlockReminderId failed:', error);
        throw error;
    }
}

/**
 * 从块的 custom-bind-reminders 中移除一个 reminderId，如果最后为空数组则清空属性
 */
export async function removeBlockReminderId(id: BlockId, reminderId: string): Promise<any> {
    try {
        const ids = await getBlockReminderIds(id);
        const filtered = ids.filter(r => r !== reminderId);
        return await setBlockReminderIds(id, filtered);
    } catch (error) {
        console.warn('removeBlockReminderId failed:', error);
        throw error;
    }
}

// **************************************** SQL ****************************************

export async function sql(sql: string): Promise<any[]> {
    let sqldata = {
        stmt: sql,
    };
    let url = '/api/query/sql';
    return request(url, sqldata);
}

export async function getHeadingDeleteTransaction(blockId: string): Promise<any> {
    let data = { id: blockId };
    let url = '/api/block/getHeadingDeleteTransaction';
    return request(url, data);
}

export async function getBlockByID(blockId: string): Promise<Block> {
    // 先flush
    let sqlScript = `select * from blocks where id ='${blockId}'`;
    let data = await sql(sqlScript);
    return data[0];
}

export async function openBlock(blockId: string) {
    // 检测块是否存在
    const block = await getBlockByID(blockId);
    if (!block) {
        throw new Error('块不存在');
    }
    // 判断是否是移动端
    const isMobile = getFrontend().endsWith('mobile');
    if (isMobile) {
        // 如果是mobile，直接打开块
        openMobileFileById(window.siyuan.ws.app, blockId);
        return;
    }
    // 判断块的类型
    const isDoc = block.type === 'd';
    if (isDoc) {
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-scroll"]
            },
            keepCursor: false,
            removeCurrentTab: false,
            openNewTab: true
        });
    } else {
        openTab({
            app: window.siyuan.ws.app,
            doc: {
                id: blockId,
                action: ["cb-get-focus", "cb-get-context", "cb-get-hl"]
            },
            keepCursor: false,
            removeCurrentTab: false,
            openNewTab: true
        });

    }
}

// **************************************** Template ****************************************

export async function render(id: DocumentId, path: string): Promise<IResGetTemplates> {
    let data = {
        id: id,
        path: path
    }
    let url = '/api/template/render';
    return request(url, data);
}


export async function renderSprig(template: string): Promise<string> {
    let url = '/api/template/renderSprig';
    return request(url, { template: template });
}


// **************************************** File ****************************************



export async function getFile(path: string): Promise<any> {
    let data = {
        path: path
    }
    let url = '/api/file/getFile';
    return new Promise((resolve, _) => {
        fetchPost(url, data, (content: any) => {
            resolve(content)
        });
    });
}


/**
 * fetchPost will secretly convert data into json, this func merely return Blob
 * @param endpoint 
 * @returns 
 */
export const getFileBlob = async (path: string): Promise<Blob | null> => {
    const endpoint = '/api/file/getFile'
    let response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({
            path: path
        })
    });
    if (!response.ok) {
        return null;
    }
    let data = await response.blob();
    return data;
}

export const getFileStat = async (path: string): Promise<{ mtime: number } | null> => {
    // Extract directory and filename from path
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex === -1) {
        return null; // Invalid path
    }
    const dir = path.substring(0, lastSlashIndex);
    const filename = path.substring(lastSlashIndex + 1);

    try {
        const dirData = await readDir(dir);
        if (!dirData || !Array.isArray(dirData)) {
            return null;
        }
        const fileEntry = dirData.find(entry => entry.name === filename);
        if (!fileEntry || fileEntry.isDir) {
            return null;
        }
        // updated is in seconds, convert to milliseconds
        return { mtime: fileEntry.updated * 1000 };
    } catch (error) {
        console.warn('getFileStat failed:', error);
        return null;
    }
}


export async function putFile(path: string, isDir: boolean, file: any) {
    let form = new FormData();
    form.append('path', path);
    form.append('isDir', isDir.toString());
    form.append('modTime', Date.now().toString());
    form.append('file', file);
    let url = '/api/file/putFile';
    return request(url, form);
}

export async function removeFile(path: string) {
    let data = {
        path: path // "/data/20210808180117-6v0mkxr/20200923234011-ieuun1p.sy"
    }
    let url = '/api/file/removeFile';
    return request(url, data);
}



export async function readDir(path: string): Promise<IResReadDir> {
    let data = {
        path: path
    }
    let url = '/api/file/readDir';
    return request(url, data);
}


// **************************************** Export ****************************************

export async function exportMdContent(id: DocumentId, yfm: boolean = false, fillCSSVar: boolean = false, refMode: number = 2, embedMode: number = 0, adjustHeadingLevel: boolean = true, imgTag: boolean = false): Promise<IResExportMdContent> {
    let data = {
        id: id,
        yfm: yfm,
        fillCSSVar: fillCSSVar, // true： 导出具体的css值，false：导出变量
        refMode: refMode, // 2：锚文本块链, 3：仅锚文本, 4：块引转脚注+锚点哈希
        embedMode: embedMode, //0：使用原始文本，1：使用 Blockquote
        adjustHeadingLevel: adjustHeadingLevel,
        imgTag: imgTag
    }
    let url = '/api/export/exportMdContent';
    return request(url, data);
}

export async function exportResources(paths: string[], name: string): Promise<IResExportResources> {
    let data = {
        paths: paths,
        name: name
    }
    let url = '/api/export/exportResources';
    return request(url, data);
}

// **************************************** Convert ****************************************

export type PandocArgs = string;
export async function pandoc(args: PandocArgs[]) {
    let data = {
        args: args
    }
    let url = '/api/convert/pandoc';
    return request(url, data);
}

// **************************************** Notification ****************************************

// /api/notification/pushMsg
// {
//     "msg": "test",
//     "timeout": 7000
//   }
export async function pushMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushMsg";
    return request(url, payload);
}

export async function pushErrMsg(msg: string, timeout: number = 7000) {
    let payload = {
        msg: msg,
        timeout: timeout
    };
    let url = "/api/notification/pushErrMsg";
    return request(url, payload);
}

// **************************************** Network ****************************************
export async function forwardProxy(
    url: string, method: string = 'GET', payload: any = {},
    headers: any[] = [], timeout: number = 7000, contentType: string = "text/html"
): Promise<IResForwardProxy> {
    let data = {
        url: url,
        method: method,
        timeout: timeout,
        contentType: contentType,
        headers: headers,
        payload: payload
    }
    let url1 = '/api/network/forwardProxy';
    return request(url1, data);
}


// **************************************** System ****************************************

export async function bootProgress(): Promise<IResBootProgress> {
    return request('/api/system/bootProgress', {});
}

export async function version(): Promise<string> {
    return request('/api/system/version', {});
}

export async function currentTime(): Promise<number> {
    return request('/api/system/currentTime', {});
}

// **************************************** Reminder API ****************************************



// **************************************** Notification Record API ****************************************

const NOTIFY_FILE_PATH = "/data/storage/petal/siyuan-plugin-task-note-management/notify.json";

// 读取通知记录数据 (仅存储最后一次已提醒的日期)
export async function readNotifyData(): Promise<{ lastNotified?: string }> {
    try {
        const content = await getFile(NOTIFY_FILE_PATH);
        if (!content || content?.code === 404) {
            return {};
        }
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        // Migration: if file contains old schema (date->bool mapping), convert to new schema
        if (parsed && typeof parsed === 'object') {
            // If it already has lastNotified, just return
            if (typeof parsed.lastNotified === 'string') {
                return { lastNotified: parsed.lastNotified };
            }

            // If parsed is a mapping of date -> boolean, find the (latest) date that was true
            const dateKeys = Object.keys(parsed).filter(k => /\d{4}-\d{2}-\d{2}/.test(k));
            if (dateKeys.length > 0) {
                // Find the latest date key with truthy value
                const validDates = dateKeys.filter(k => !!parsed[k]);
                if (validDates.length > 0) {
                    // Choose the latest date string (lexicographical sort works for YYYY-MM-DD)
                    const latest = validDates.sort().pop();
                    const result = { lastNotified: latest };
                    // Rewrite the file to the new schema to clean up old entries
                    try {
                        await writeNotifyData(result);
                    } catch (err) {
                        console.warn('迁移通知记录文件到新结构失败:', err);
                    }
                    return result;
                }
            }
        }
        return {};
    } catch (error) {
        console.warn('读取通知记录文件失败:', error);
        return {};
    }
}

// 写入通知记录数据
export async function writeNotifyData(data: { lastNotified?: string }): Promise<void> {
    try {
        const content = JSON.stringify(data, null, 2);
        const blob = new Blob([content], { type: 'application/json' });
        await putFile(NOTIFY_FILE_PATH, false, blob);
    } catch (error) {
        console.error('写入通知记录文件失败:', error);
        throw error;
    }
}

// 确保通知记录文件存在（仅创建空对象）
export async function ensureNotifyDataFile(): Promise<void> {
    try {
        // 尝试读取文件
        await readNotifyData();
    } catch (error) {
        console.log('通知记录文件不存在，创建新文件');
        try {
            await writeNotifyData({});
        } catch (writeError) {
            console.error('创建通知记录文件失败:', writeError);
        }
    }
}

// 检查某日期是否已提醒过全天事件
export async function hasNotifiedToday(date: string): Promise<boolean> {
    try {
        const notifyData = await readNotifyData();
        // 仅检查最后一次已提醒日期是否等于传入日期
        return notifyData.lastNotified === date;
    } catch (error) {
        console.warn('检查通知记录失败:', error);
        return false;
    }
}

// 标记某日期已提醒全天事件
export async function markNotifiedToday(date: string): Promise<void> {
    try {
        // 仅存储最后一次已提醒日期，覆盖此前的数据
        await writeNotifyData({ lastNotified: date });
    } catch (error) {
        console.error('标记通知记录失败:', error);
    }
}

// 检查某个习惯在特定日期是否已提醒
export async function hasHabitNotified(habitId: string, date: string, time?: string): Promise<boolean> {
    try {
        const plugin = getPluginInstance();
        if (!plugin) return false;
        const habitData = await plugin.loadHabitData();
        if (!habitData || typeof habitData !== 'object') return false;

        const habit = habitData[habitId];
        if (!habit || typeof habit !== 'object') return false;

        const hasNotify = habit.hasNotify || {};
        const entry = hasNotify[date];
        // Backward compatible: entry may be boolean
        if (!entry) return false;
        if (typeof entry === 'boolean') {
            // If time omitted, fallback to boolean; if time provided, return the boolean (we don't know per-time)
            return entry === true;
        }
        // entry is an object mapping time -> boolean
        if (time) {
            return !!entry[time];
        }
        // If time not provided, return true if any time was notified
        return Object.values(entry).some(v => !!v);
    } catch (error) {
        console.warn('检查习惯通知记录失败:', error);
        return false;
    }
}

// 标记某个习惯在特定日期已提醒
export async function markHabitNotified(habitId: string, date: string, time?: string): Promise<void> {
    try {
        const plugin = getPluginInstance();
        if (!plugin) return;
        const habitData = await plugin.loadHabitData();
        if (!habitData || typeof habitData !== 'object') {
            console.warn('习惯数据不存在，无法标记通知');
            return;
        }

        const habit = habitData[habitId];
        if (!habit || typeof habit !== 'object') {
            console.warn('习惯不存在，无法标记通知:', habitId);
            return;
        }

        // 确保 hasNotify 对象存在
        if (!habit.hasNotify) {
            habit.hasNotify = {};
        }

        if (time) {
            // Ensure nested object for date
            if (typeof habit.hasNotify[date] !== 'object') {
                // handle legacy boolean -> convert to object mapping
                const prev = habit.hasNotify[date];
                habit.hasNotify[date] = {} as any;
                if (prev === true) {
                    // mark default key '' as true to preserve information
                    (habit.hasNotify[date] as any)['__all__'] = true;
                }
            }
            (habit.hasNotify[date] as any)[time] = true;
        } else {
            // Backward compatible: mark date as true
            habit.hasNotify[date] = true;
        }

        // 写回习惯数据
        await plugin.saveHabitData(habitData);
    } catch (error) {
        console.error('标记习惯通知记录失败:', error);
    }
}

function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // 月份从0开始，需+1
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}
/**
 * 检查并更新块的提醒书签状态
 * @param blockId 块ID
 * @param plugin 插件实例
 */
export async function updateBindBlockAtrrs(blockId: string, plugin: any): Promise<void> {
    try {
        const reminderData = await plugin.loadReminderData();

        // 查找该块的所有提醒
        const blockReminders = Object.values(reminderData).filter((reminder: any) =>
            reminder && reminder.blockId === blockId
        );

        const attrs: { [key: string]: string } = {};

        // 如果没有提醒，清理所有相关属性
        if (blockReminders.length === 0) {
            try {
                await setBlockAttrs(blockId, {
                    "bookmark": "",
                    'custom-bind-reminders': '',
                    'custom-task-projectId': ''
                });

                return;
            } catch (err) {
                console.warn('clean up block attributes failed for', blockId, err);
                return;
            }
        }

        // ----- 1. 计算 bookmark 和 custom-task-done -----
        const hasIncompleteReminders = blockReminders.some((reminder: any) => !reminder.completed);
        const allCompleted = blockReminders.length > 0 && blockReminders.every((reminder: any) => reminder.completed);

        if (allCompleted) {
            attrs['bookmark'] = '✅';
            attrs['custom-task-done'] = formatDate(new Date());
        } else if (hasIncompleteReminders) {
            attrs['bookmark'] = '⏰';
            // 如果从完成变成未完成，是否清除 completion time? 保持现状或者根据需要清除
            // attrs['custom-task-done'] = ''; 
        } else {
            // 理论上不会走到这里，因为 blockReminders.length > 0
            attrs['bookmark'] = '';
        }

        // ----- 2. 计算 custom-bind-reminders -----
        const reminderIds = blockReminders.map((r: any) => r.id).filter(id => id);
        if (reminderIds.length > 0) {
            attrs['custom-bind-reminders'] = reminderIds.join(',');
        } else {
            attrs['custom-bind-reminders'] = '';
        }

        // ----- 3. 计算 custom-task-projectId -----
        const projectIds = Array.from(new Set(blockReminders.map((r: any) => r.projectId).filter(id => id)));
        attrs['custom-task-projectId'] = projectIds.length > 0 ? projectIds.join(',') : '';

        // 一次性更新所有属性
        await setBlockAttrs(blockId, attrs);

    } catch (error) {
        console.error('更新块提醒书签失败:', error);
    }
}

/**
 * 更新块的里程碑绑定属性
 * @param blockId 块ID
 * @param projectId 项目ID
 * @param milestoneIds 里程碑ID数组
 */
export async function updateMilestoneBindBlockAttrs(blockId: string, projectId: string, milestoneIds: string[]): Promise<void> {
    if (!blockId) return;
    try {
        // 获取现有属性，避免覆盖已存在的 custom-task-projectid（可能来自任务绑定）
        const existingAttrs = await getBlockAttrs(blockId);
        const existingProjectIds = existingAttrs['custom-task-projectid'] || '';

        const attrs: { [key: string]: string } = {};

        // 只设置 custom-bind-milestones 属性
        attrs['custom-bind-milestones'] = milestoneIds && milestoneIds.length > 0 ? milestoneIds.join(',') : '';

        // 如果块上还没有 custom-task-projectid，并且有里程碑绑定，则设置项目ID
        // 如果已经有 custom-task-projectid（来自任务），则保留不变
        if (!existingProjectIds && milestoneIds && milestoneIds.length > 0) {
            attrs['custom-task-projectid'] = projectId;
        }
        // 如果里程碑被清空，但块上有 custom-task-projectid，检查是否还有任务绑定
        else if ((!milestoneIds || milestoneIds.length === 0) && existingProjectIds) {
            // 检查是否还有任务绑定（custom-bind-reminders）
            const hasTaskBinding = existingAttrs['custom-bind-reminders'];
            if (!hasTaskBinding) {
                // 如果既没有里程碑也没有任务绑定，清空项目ID
                attrs['custom-task-projectid'] = '';
            }
            // 如果还有任务绑定，保留项目ID不变（不设置attrs，保持原值）
        }

        await setBlockAttrs(blockId, attrs);
    } catch (error) {
        console.error('更新里程碑块属性失败:', error);
    }
}










// **************************************** ICS Cloud Upload ****************************************

export async function uploadCloud(paths?: string[], silent: boolean = false): Promise<string | null> {
    try {
        // 支持两种调用方式：传入 blockId（旧用法）或传入 paths（资源路径数组）
        const payload: any = {};
        if (Array.isArray(paths) && paths.length > 0) {
            payload.paths = paths; // 需要assets前缀
        }
        if (silent) {
            payload.ignorePushMsg = true;
        }

        await fetchPost('/api/asset/uploadCloudByAssetsPaths', payload);
        return null;
    } catch (error) {
        console.error('上传ICS到云端失败:', error);
        return null;
    }
}

