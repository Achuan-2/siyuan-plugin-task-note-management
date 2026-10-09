import type { ReminderManager } from "../../components/dataManager/reminderManager";
import type { ProjectManager } from "../../components/dataManager/projectManager";
import type { ProjectColumnsManager } from "../../components/dataManager/projectColumnsManager";
import type { ProjectFolderManager } from "../../components/dataManager/projectFolderManager";
import type { ToolDefinition } from "./common";
import {
    wrapHandler,
    successResponse,
    errorResponse,
} from "./common";
import {
    assertString,
    assertOptionalString,
    assertOptionalEnum,
    assertOptionalDateString,
} from "../utils/validation";
import { addBlockProjectId, getBlockProjectIds, setBlockProjectIds } from "../utils/siyuanApi";

const PROJECT_ACTIONS = [
    "search_project",
    "create_project",
    "update_project",
    "get_project",
    "list_columns",
    "create_column",
    "update_column",
    "list_folders",
    "create_folder",
    "update_folder",
    "delete_folder",
] as const;
type ProjectAction = typeof PROJECT_ACTIONS[number];

export function createProjectTool(
    reminderManager: ReminderManager,
    projectManager: ProjectManager,
    projectColumnsManager: ProjectColumnsManager,
    projectFolderManager: ProjectFolderManager
): ToolDefinition {
    return {
        name: "project",
        config: {
            title: "项目管理",
            description: "项目管理操作。Actions: search_project(搜索/列出项目), create_project(创建项目), update_project(更新项目), get_project(项目详情), list_columns(列出分组), create_column(创建分组), update_column(修改分组), list_folders(列出文件夹), create_folder(创建文件夹), update_folder(修改文件夹), delete_folder(删除文件夹并解除项目归属)。",
            inputSchema: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        description: "操作类型",
                        enum: PROJECT_ACTIONS,
                    },
                    // search
                    keyword: { type: "string", description: "关键词，同时匹配项目名称和文件夹名称；文件夹名称命中时返回该文件夹下所有项目" },
                    folderId: { type: "string", description: "按文件夹 ID 过滤；update_folder/delete_folder 中为目标文件夹 ID" },
                    // get / list_columns / create_column / update_column
                    projectId: { type: "string", description: "项目 ID" },
                    // create / update / create_column / update_column / create_folder / update_folder
                    name: { type: "string", description: "名称" },
                    // create / update
                    status: { type: "string", description: "项目状态" },
                    color: { type: "string", description: "颜色" },
                    priority: { type: "string", enum: ["high", "medium", "low", "none"], description: "优先级" },
                    categoryId: { type: "string", description: "分类 ID" },
                    startDate: { type: "string", description: "开始日期 YYYY-MM-DD" },
                    blockId: { type: "string", description: "创建/更新项目时绑定的思源块或文档 ID，自动同步块的项目属性；更新时传空字符串可解除绑定" },
                    // column
                    columnId: { type: "string", description: "分组 ID" },
                    icon: { type: "string", description: "图标" },
                    sort: { type: "number", description: "排序权重" },
                    // folder
                    parentId: { type: "string", description: "父文件夹 ID" },
                },
                required: ["action"],
            },
        },
        handler: wrapHandler(async (input) => {
            const action = assertEnum(input.action, "action", PROJECT_ACTIONS);

            switch (action) {
                case "search_project": {
                    await projectManager.loadProjects(true);
                    const [projects, folders] = await Promise.all([
                        projectManager.getProjects(),
                        projectFolderManager.listProjectGroups(),
                    ]);

                    const folderMap = new Map(folders.map((f) => [f.id, f.name]));
                    let result = projects.map((p) => ({
                        id: p.id,
                        name: p.name,
                        status: p.status,
                        folderId: p.folderId,
                        folderName: p.folderId ? folderMap.get(p.folderId) : undefined,
                        color: p.color,
                        priority: p.priority,
                        blockId: p.blockId,
                    }));

                    // 按文件夹 ID 过滤
                    if (input.folderId) {
                        const folderId = assertString(input.folderId, "folderId");
                        result = result.filter((p) => p.folderId === folderId);
                    }

                    // 关键词搜索：匹配项目名称 OR 文件夹名称
                    if (input.keyword) {
                        const kw = assertString(input.keyword, "keyword").toLowerCase();
                        // 找出名称命中的文件夹 ID
                        const matchedFolderIds = new Set(
                            folders
                                .filter((f) => f.name.toLowerCase().includes(kw))
                                .map((f) => f.id)
                        );
                        result = result.filter(
                            (p) =>
                                p.name.toLowerCase().includes(kw) ||
                                (p.folderId != null && matchedFolderIds.has(p.folderId))
                        );
                    }

                    return successResponse(result);
                }

                case "create_project": {
                    if (input.folderId) {
                        const exists = await projectFolderManager.folderExists(assertString(input.folderId, "folderId"));
                        if (!exists) return errorResponse(`文件夹不存在: ${input.folderId}`);
                    }
                    const project = await projectManager.createProject({
                        name: assertString(input.name, "name"),
                        status: assertOptionalString(input.status, "status"),
                        color: assertOptionalString(input.color, "color"),
                        priority: assertOptionalEnum(input.priority, "priority", ["high", "medium", "low", "none"]),
                        folderId: assertOptionalString(input.folderId, "folderId"),
                        categoryId: assertOptionalString(input.categoryId, "categoryId"),
                        startDate: assertOptionalDateString(input.startDate, "startDate"),
                        blockId: assertOptionalString(input.blockId, "blockId")?.trim(),
                    });
                    await syncProjectBlockBinding(project.id, undefined, project.blockId);
                    return successResponse(project);
                }

                case "update_project": {
                    const id = assertString(input.projectId, "projectId");
                    await projectManager.loadProjects(true);
                    const existing = projectManager.getProjectById(id);
                    if (!existing) return errorResponse(`项目不存在: ${id}`);
                    if (input.folderId !== undefined && input.folderId !== "") {
                        const exists = await projectFolderManager.folderExists(assertString(input.folderId, "folderId"));
                        if (!exists) return errorResponse(`文件夹不存在: ${input.folderId}`);
                    }
                    const updated = await projectManager.updateProject(id, {
                        name: assertOptionalString(input.name, "name"),
                        status: assertOptionalString(input.status, "status"),
                        color: assertOptionalString(input.color, "color"),
                        priority: assertOptionalEnum(input.priority, "priority", ["high", "medium", "low", "none"]),
                        folderId: assertOptionalString(input.folderId, "folderId"),
                        categoryId: assertOptionalString(input.categoryId, "categoryId"),
                        startDate: assertOptionalDateString(input.startDate, "startDate"),
                        blockId: assertOptionalString(input.blockId, "blockId")?.trim(),
                    });
                    if (!updated) return errorResponse(`项目不存在: ${id}`);
                    await syncProjectBlockBinding(id, existing.blockId, updated.blockId);
                    if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("projectUpdated", {
                            detail: { projectId: id }
                        }));
                    }
                    return successResponse(updated);
                }

                case "get_project": {
                    await projectManager.loadProjects(true);
                    const id = assertString(input.projectId, "projectId");
                    const project = await projectManager.getProjectById(id);
                    if (!project) return errorResponse(`项目不存在: ${id}`);
                    const stats = await reminderManager.countByProject(id);
                    return successResponse({ ...project, stats });
                }

                case "list_columns": {
                    const projectId = assertString(input.projectId, "projectId");
                    const columns = await projectColumnsManager.listColumns(projectId);
                    return successResponse(columns);
                }

                case "create_column": {
                    const column = await projectColumnsManager.createColumn({
                        projectId: assertString(input.projectId, "projectId"),
                        name: assertString(input.name, "name"),
                        color: assertOptionalString(input.color, "color"),
                        icon: assertOptionalString(input.icon, "icon"),
                        sort: input.sort !== undefined ? Number(input.sort) : undefined,
                    });
                    return successResponse(column);
                }

                case "update_column": {
                    const column = await projectColumnsManager.updateColumn({
                        projectId: assertString(input.projectId, "projectId"),
                        columnId: assertString(input.columnId, "columnId"),
                        name: assertOptionalString(input.name, "name"),
                        color: assertOptionalString(input.color, "color"),
                        icon: assertOptionalString(input.icon, "icon"),
                        sort: input.sort !== undefined ? Number(input.sort) : undefined,
                    });
                    return successResponse(column);
                }

                case "list_folders": {
                    const folders = await projectFolderManager.listProjectGroups();
                    return successResponse(folders);
                }

                case "create_folder": {
                    const folder = await projectFolderManager.createProjectGroup({
                        name: assertString(input.name, "name"),
                        icon: assertOptionalString(input.icon, "icon"),
                        parentId: assertOptionalString(input.parentId, "parentId"),
                    });
                    return successResponse(folder);
                }

                case "update_folder": {
                    const folder = await projectFolderManager.updateProjectGroup(assertString(input.folderId, "folderId"), {
                        name: assertOptionalString(input.name, "name"),
                        icon: assertOptionalString(input.icon, "icon"),
                        parentId: assertOptionalString(input.parentId, "parentId"),
                    });
                    return successResponse(folder);
                }

                case "delete_folder": {
                    const folderId = assertString(input.folderId, "folderId");
                    await projectManager.updateProjectsFolder(folderId, "");
                    const success = await projectFolderManager.deleteProjectGroup(folderId);
                    return successResponse({ success });
                }

                default:
                    return errorResponse(`未知的项目操作: ${action}`);
            }
        }),
    };
}

async function syncProjectBlockBinding(projectId: string, oldBlockId?: string, newBlockId?: string): Promise<void> {
    if (oldBlockId && oldBlockId !== newBlockId) {
        try {
            const projectIds = await getBlockProjectIds(oldBlockId);
            await setBlockProjectIds(oldBlockId, projectIds.filter(id => id !== projectId));
        } catch (error) {
            console.warn(`移除旧块 ${oldBlockId} 的项目 ${projectId} 绑定失败:`, error);
        }
    }
    if (newBlockId) {
        try {
            await addBlockProjectId(newBlockId, projectId);
        } catch (error) {
            console.warn(`同步块 ${newBlockId} 的项目 ${projectId} 绑定失败:`, error);
        }
    }
}

function assertEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
    if (value === undefined || value === null) {
        throw new Error(`缺少必填字段: ${field}`);
    }
    const str = assertString(value, field);
    if (!allowed.includes(str as T)) {
        throw new Error(`字段 ${field} 必须是 ${allowed.join(" / ")} 之一`);
    }
    return str as T;
}
