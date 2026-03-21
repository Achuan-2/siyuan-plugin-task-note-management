# 组件说明

## 核心视图组件
- **CalendarView.ts**：日历视图组件，提供月历、周历等多种日历显示模式，支持任务的可视化管理
- **ProjectPanel.ts**：项目面板组件，提供项目列表展示、筛选、排序和管理功能
- **ProjectKanbanView.ts**：项目看板视图组件，以看板形式展示项目中的任务状态（待办、进行中、已完成）
- **ReminderPanel.ts**：提醒面板组件，展示和管理各种提醒任务，支持多种过滤和排序方式
- **EisenhowerMatrixView.ts**：艾森豪威尔四象限矩阵视图，按重要性和紧急性对任务进行分类管理

## 对话框组件
- **AddToProjectDialog.ts**：添加任务到项目的对话框，用于将现有任务关联到指定项目
- **BatchReminderDialog.ts**：批量提醒设置对话框，支持批量创建和编辑多个提醒任务
- **CategoryManageDialog.ts**：分类管理对话框，用于创建、编辑和删除任务分类
- **DocumentReminderDialog.ts**：文档提醒对话框，为特定文档设置提醒功能
- **NotificationDialog.ts**：通知对话框组件，显示系统提醒通知，支持单个和批量通知
- **ProjectColorDialog.ts**：项目颜色设置对话框，为不同项目配置标识颜色
- **ProjectDialog.ts**：项目创建/编辑对话框，用于项目的基本信息设置
- **QuickReminderDialog.ts**：快速提醒创建对话框，支持自然语言输入和快速任务创建
- **ReminderDialog.ts**：提醒任务创建/编辑对话框，提供完整的任务设置功能
- **ReminderEditDialog.ts**：提醒任务编辑对话框，专门用于修改现有提醒任务
- **RepeatSettingsDialog.ts**：重复设置对话框，配置任务的重复规则（日、周、月、年等）
- **StatusManageDialog.ts**：状态管理对话框，管理任务的自定义状态类型
- **TaskSummaryTab.svelte**：任务摘要统计标签页组件（Svelte），生成和显示任务统计摘要信息，支持按日期范围筛选、番茄钟统计和习惯打卡统计

## 专用功能组件
- **LoadingDialog.svelte**：加载中对话框组件（Svelte），显示操作进度和加载状态
- **PomodoroStatsView.ts**：番茄工作法统计视图，展示专注时间统计、趋势分析和工作记录
- **PomodoroTimer.ts**：番茄工作法计时器，提供专注时间管理和工作/休息提醒功能