---
name: project
description: 用于在思源任务笔记管理插件中管理项目看板及文件夹分组的 MCP 工具。
---

# 项目与看板管理技能 (project)

本技能提供思源任务笔记管理插件的项目管理接口，支持搜索/列出项目、创建/更新项目、获取项目详情，以及管理项目看板列分组和分类文件夹。

## 支持操作与参数

### 1. `search_project`
搜索或列出项目。不传任何参数时返回所有项目。
- **keyword** (字符串, 可选): 关键词，同时匹配项目名称和文件夹名称。文件夹名称命中时，返回该文件夹下的所有项目。
- **folderId** (字符串, 可选): 仅获取指定项目文件夹下的项目。

### 2. `create_project`
创建新项目。
- **name** (字符串, 必填): 项目名称。
- **status** (字符串, 可选): 项目状态 (例如 `"active"` 激活, `"someday"` 也许, `"archived"` 归档)。
- **color** (字符串, 可选): 十六进制项目颜色 (如 `"#4f46e5"`)。
- **priority** (字符串, 可选): 优先级 (`"high"`, `"medium"`, `"low"`, `"none"`)。
- **folderId** (字符串, 可选): 归属项目文件夹 ID。
- **categoryId** (字符串, 可选): 分类 ID。
- **startDate** (字符串, 可选): 开始日期 `YYYY-MM-DD`。
- **blockId** (字符串, 可选): 绑定的思源块或文档 ID，自动保存项目绑定并同步块属性 `custom-task-projectId`。

### 3. `update_project`
更新已有项目的信息，只传需要修改的字段。
- **projectId** (字符串, 必填): 项目 ID。
- **name** (字符串, 可选): 项目名称。
- **status** (字符串, 可选): 项目状态。
- **color** (字符串, 可选): 十六进制项目颜色。
- **priority** (字符串, 可选): 优先级 (`"high"`, `"medium"`, `"low"`, `"none"`)。
- **folderId** (字符串, 可选): 归属项目文件夹 ID，传空字符串 `""` 可解除归属。
- **categoryId** (字符串, 可选): 分类 ID。
- **startDate** (字符串, 可选): 开始日期 `YYYY-MM-DD`。
- **blockId** (字符串, 可选): 绑定的思源块或文档 ID。不传保留原绑定，传新 ID 自动换绑，传空字符串 `""` 解除绑定；换绑和解绑仅移除此项目的块属性关联，保留同块的其他项目。

### 4. `get_project`
获取项目详情及统计信息（如任务总数及未完成数）。
- **projectId** (字符串, 必填): 项目 ID。

### 5. `list_columns`
列出项目看板自定义的列分组。
- **projectId** (字符串, 必填): 项目 ID。

### 6. `create_column`
为项目看板创建一列分组。
- **projectId** (字符串, 必填): 项目 ID。
- **name** (字符串, 必填): 分组名称。
- **color** (字符串, 可选): 分组标识颜色。
- **icon** (字符串, 可选): 分组图标。
- **sort** (数字, 可选): 排序权重。

### 7. `update_column`
修改自定义列分组。
- **projectId** (字符串, 必填): 项目 ID。
- **columnId** (字符串, 必填): 看板分组 ID。
- **name** (字符串, 可选): 看板列名。
- **color** (字符串, 可选): 列颜色。
- **icon** (字符串, 可选): 图标。
- **sort** (数字, 可选): 排序权重。

### 8. `list_folders`
列出所有分类文件夹。
- （无参数）

### 9. `create_folder`
创建项目分类文件夹。
- **name** (字符串, 必填): 文件夹名称。
- **icon** (字符串, 可选): 文件夹图标。
- **parentId** (字符串, 可选): 父文件夹 ID。

### 10. `update_folder`
更新项目分类文件夹信息。
- **folderId** (字符串, 必填): 文件夹 ID。
- **name** (字符串, 可选): 文件夹名称。
- **icon** (字符串, 可选): 图标。
- **parentId** (字符串, 可选): 父文件夹 ID。

### 11. `delete_folder`
删除分类文件夹并解除其下所有项目的关联。
- **folderId** (字符串, 必填): 文件夹 ID。

## 调用示例

### 列出所有项目
```json
{
  "action": "search_project"
}
```

### 按关键词搜索项目（命中文件夹名时返回该文件夹下所有项目）
```json
{
  "action": "search_project",
  "keyword": "工作"
}
```

### 创建一个项目归类文件夹
```json
{
  "action": "create_folder",
  "name": "工作相关",
  "icon": "💼"
}
```

### 创建项目并绑定文档
```json
{
  "action": "create_project",
  "name": "论文修改",
  "blockId": "20261009120000-abcdefg"
}
```

### 解除项目的块绑定
```json
{
  "action": "update_project",
  "projectId": "project_...",
  "blockId": ""
}
```
