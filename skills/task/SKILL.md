---
name: task
description: 用于在思源任务笔记管理插件中管理任务、任务提醒和分类的 MCP 工具。
---

# 任务管理技能 (task)

## 并发写入说明

- MCP 创建、更新、删除任务与插件界面保存共用同一条内核写入队列；写入时会基于最新任务数据执行，避免双方互相覆盖整个任务文件。
- 界面与 MCP 修改不同任务或同一任务的不同字段时会自动合并；如果双方同时修改同一字段，界面保存会中止并提示冲突，不会静默覆盖 MCP 的新值。
- 修改或删除既有任务前，建议先用 `get_task` 读取任务，并把返回的 `updatedAt` 作为 `expectedUpdatedAt` 一并提交；旧任务没有 `updatedAt` 时使用 `createdAt`。如果用户已在界面修改过该任务，操作会被拒绝，从而避免 AI 用旧数据覆盖用户的新修改。
- 若工具返回“父任务已不存在或已被修改”等并发变化错误，应先用 `get_task` 或 `search_task` 重新读取最新数据，再决定是否重试，不能直接重复提交旧参数。

### 1. `search_task`
根据关键字、ID、项目、日期等条件搜索任务。
> 注意：为了节省 token 消耗，如果在搜索中指定了日期过滤（如传入了 `date`），`repeat.instances` 字段在搜索结果中将仅保留该日期范围的实例数据；如果不指定日期过滤，则会完全隐藏 `repeat.instances` 字段。要获取非查询日期的完整实例详情，请使用 `get_task` 接口。

- **keyword** (字符串, 可选): 搜索关键字，匹配任务标题或备注内容。
- **id** (字符串, 可选): 任务 ID，精确匹配。
- **projectId** (字符串, 可选): 所属项目 ID。
- **date** (字符串, 可选): 过滤日期 `YYYY-MM-DD`。可以传入 `"today"` 字符串，这将自动计算今日日期，并拉取今日任务、过期未完成任务、每日可做任务（效果和前端 Reminder 面板一致）。
- **priority** (字符串, 可选): 优先级 (`"high"`, `"medium"`, `"low"`, `"none"`)。
- **status** (字符串, 可选): 看板状态。
- **completed** (布尔值, 可选): 是否已完成。
- **limit** (数字, 可选): 返回数量上限，默认为 50。

### 2. `get_task`
根据任务 ID（或重复实例 ID）获取单个任务的详情。
- 对于重复任务，支持传入 **date** 参数（或直接传入 `taskID_YYYY-MM-DD` 格式的实例 ID）来获取该特定日期实例的具体数据（如该日期的已完成状态、完成时间等）。
- 如果不传 **date**（且 ID 无日期后缀），则返回包含完整 `repeat.instances` 重复实例详情的原始任务数据。
- **id** (字符串, 必填): 任务 ID 或实例 ID。
- **date** (字符串, 可选): 指定重复任务实例的具体日期 `YYYY-MM-DD`。

### 3. `create_task`
创建单个新任务。传入已有任务的 `parentId` 时，新任务会作为该任务的子任务创建。
- **title** (字符串, 必填): 任务标题。
- **date** (字符串, 可选): 任务日期 `YYYY-MM-DD`。省略或传入 `""`（空字符串）可创建无日期任务。
- **note** (字符串, 可选): 备注信息。
- **time** (字符串, 可选): 开始时间 `HH:MM`；设置后会在任务开始时刻提醒。
- **reminderTimes** (对象数组, 可选): 一个或多个额外提醒时间。每项包含：
  - **time** (字符串, 必填): 提醒时刻。使用 `HH:MM` 表示任务日期范围内的该时刻；使用 `YYYY-MM-DDTHH:MM` 表示绝对提醒日期和时刻，可用于提前一天等场景。
  - **endTime** (字符串, 可选): 提醒结束时刻，格式同 `time`。
  - **note** (字符串, 可选): 仅用于本次提醒的附加备注。
  - 在 `update_task` 中传入空数组 `[]` 可清除全部额外提醒。
- **endDate** (字符串, 可选): 结束日期 `YYYY-MM-DD`。
- **endTime** (字符串, 可选): 结束时间 `HH:MM`。
- **priority** (字符串, 可选): 优先级 (`"high"`, `"medium"`, `"low"`, `"none"`)。
- **projectId** (字符串, 可选): 项目 ID。
- **categoryId** (字符串, 可选): 分类 ID。
- **parentId** (字符串, 可选): 已有父任务的 ID。传入后会创建单个子任务；支持普通任务 ID 和 `任务ID_YYYY-MM-DD` 格式的重复任务实例 ID。父任务不存在或属于订阅任务时不会创建。
- **completed** (布尔值, 可选): 是否完成，默认为 `false`。
- **blockId** (字符串, 可选): 绑定的思源块 ID。设置后会自动获取并关联文档 ID，并在思源中同步块属性与书签。
- **url** (字符串, 可选): 网页链接。
- **kanbanStatus** (字符串, 可选): 看板状态。如果任务绑定了项目，所设看板状态必须是该项目已配置的看板状态（可以通过 `get_project` 或 `list_columns` 查询该项目的看板配置）。如果未绑定项目，必须是系统默认的看板状态之一。如果设置为 `"completed"` 且 `completed` 未显式传入，会自动将任务标记为已完成。
- **customProgress** (数字, 可选): 自定义进度条百分比，取值范围为 `0` 到 `100` 的整数。
- **linkedHabitId** (字符串, 可选): 绑定的习惯 ID。可以通过 `habit` 相关的工具查询习惯列表来获取此 ID。
- **linkedHabitSyncPomodoroToday** (布尔值, 可选): 是否同步今日的番茄钟数据到绑定的习惯（必须在 `linkedHabitId` 设置时才生效）。
- **linkedHabitAutoCheckInOnComplete** (布尔值, 可选): 任务完成时是否自动为关联的习惯打卡（必须在 `linkedHabitId` 设置时才生效）。
- **linkedHabitAutoCheckInOptionKey** (字符串, 可选): 自动打卡习惯时的选项 Key。
- **linkedHabitAutoCheckInEmoji** (字符串, 可选): 自动打卡习惯时的 Emoji。
- **repeat** (对象, 可选): 重复周期性任务配置。**注意：如果启用了重复配置（enabled 为 true），但是开始日期 date 传入了 ""（空字符串），系统会自动将其默认设置为今日本地日期。** 属性如下：
  - **enabled** (布尔值, 必填): 是否启用。
  - **type** (字符串, 必填): 重复类型，支持 `"daily"` (每日), `"weekly"` (每周), `"monthly"` (每月), `"yearly"` (每年), `"custom"` (自定义), `"ebbinghaus"` (艾宾浩斯), `"lunar-monthly"` (农历每月), `"lunar-yearly"` (农历每年)。
  - **interval** (数字, 可选): 重复周期间隔。
  - **weekDays** (数字数组, 可选): 每周的哪几天 (0-6, 0为周日)。
  - **monthDays** (数字数组, 可选): 每月的哪几天 (1-31)。
  - **monthlyRepeatMode** (字符串, 可选): 每月重复类型 (`"date"` 按日期 / `"week"` 按星期)。
  - **endDate** (字符串, 可选): 重复截止日期 `YYYY-MM-DD`。
  - **endType** (字符串, 必填): 结束条件，支持 `"never"` (从不结束), `"date"` (截止到特定日期), `"count"` (限次数)。
  - **endCount** (数字, 可选): 限制重复的总次数。
  - **reminderSkipWeekendMode** (字符串, 可选): 跳过周末选项 (`"none"`, `"skip"`, `"only_weekend"`)。
  - **reminderSkipHolidays** (布尔值, 可选): 是否跳过法定节假日。
### 4. `create_tasks`
批量创建任务或批量给已有任务创建同级子任务。
- **tasks** (对象数组, 必填): 要创建的任务列表，不能为空。每项都必须包含 `title`，并支持 `create_task` 的任务数据属性，例如日期、时间、额外提醒、优先级、项目、分类、重复设置、绑定块、网页链接、看板状态、自定义进度和习惯联动等；不在列表项中嵌套 `parentId` 或其他任务列表。
- **parentId** (字符串, 可选): 不传时批量创建普通任务；传入已有任务 ID 时，`tasks` 中的所有任务都会成为该任务的同级子任务。支持重复任务实例 ID；子任务省略日期时会继承该实例日期。
- **projectId** (字符串, 可选): 所有列表项的公共默认项目。任务项自己的 `projectId` 优先；两处都省略且传入了 `parentId` 时，继承父任务项目。

### 5. `update_task`
批量修改更新任务。
- **updates** (对象数组, 必填): 更新项列表。每个对象必须包含：
  - **id** (字符串, 必填): 要修改的任务 ID。
  - **expectedUpdatedAt** (字符串, 可选但推荐): 最近一次 `get_task`/`search_task` 返回的 `updatedAt`；旧任务没有该字段时使用 `createdAt`。任务已被其他操作修改时，本次更新会被拒绝。
  - 其他在 `create_task` 中支持的可更新参数 (包含 `reminderTimes`, `blockId`, `url`, `kanbanStatus`, `customProgress`, `linkedHabitId` 及打卡设置, `repeat` 对象等；不包含仅用于创建的 `parentId` 和 `tasks`)。

### 6. `delete_task`
删除任务.
- **id** (字符串, 必填): 任务 ID。
- **expectedUpdatedAt** (字符串, 可选但推荐): 最近读取到的 `updatedAt`；旧任务没有该字段时使用 `createdAt`。任务已被其他操作修改时拒绝删除。

### 7. `list_categories`
列出所有任务分类。
- （无参数）

## 调用示例

### 获取今日及过期任务列表
```json
{
  "action": "search_task",
  "date": "today"
}
```

### 创建一个高优先级的任务
```json
{
  "action": "create_task",
  "title": "整理 MCP 工具技能说明文档",
  "date": "2026-07-11",
  "priority": "high",
  "note": "将 task、project、habit、stats 技能翻译为中文版"
}
```

### 创建任务并设置多个提醒
```json
{
  "action": "create_task",
  "title": "提交周报",
  "date": "2026-07-11",
  "time": "17:00",
  "reminderTimes": [
    {
      "time": "2026-07-10T17:00",
      "note": "提前一天准备材料"
    },
    {
      "time": "16:30",
      "note": "提交前再次检查"
    }
  ]
}
```

### 给已有任务创建子任务
```json
{
  "action": "create_task",
  "title": "补充接口测试",
  "parentId": "reminder_已有主任务ID"
}
```

### 批量创建普通任务
```json
{
  "action": "create_tasks",
  "tasks": [
    {
      "title": "梳理接口输入",
      "priority": "high"
    },
    {
      "title": "补充接口测试",
      "date": "2026-07-12"
    },
    {
      "title": "更新使用文档"
    }
  ]
}
```

### 给已有任务批量创建同级子任务
```json
{
  "action": "create_tasks",
  "parentId": "reminder_已有主任务ID",
  "tasks": [
    {
      "title": "梳理接口输入",
      "priority": "high"
    },
    {
      "title": "补充接口测试",
      "date": "2026-07-12"
    },
    {
      "title": "更新使用文档"
    }
  ]
}
```

### 创建一个每周一、三、五重复的周期性任务
```json
{
  "action": "create_task",
  "title": "部门例会汇报准备",
  "date": "2026-07-11",
  "priority": "medium",
  "repeat": {
    "enabled": true,
    "type": "weekly",
    "weekDays": [1, 3, 5],
    "endType": "never"
  }
}
```
