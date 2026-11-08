# 任务撤回的维护边界

所有任务面板共用同一套撤回实现：

| 位置 | 职责 |
| --- | --- |
| `src/utils/taskUndoPatch.ts` | 计算字段差异、检查冲突、生成恢复数据；不依赖 DOM 或思源 API |
| `src/utils/taskActionUndo.ts` | 单次操作的快照与保存、本地和订阅数据路由、撤回后的全局通知与后台同步 |
| `src/utils/taskUndoToast.ts` | 底部提示、6 秒计时、悬停和焦点处理、失败重试、替换和关闭提示 |
| `src/utils/taskInstanceActions.ts` | 重复实例排除的校验、变更和可撤回保存 |
| `src/components/dataManager/repeatUtils.ts` 的 `excludeRepeatInstance` | 幂等地排除一次发生，可按需清理该实例的编辑历史 |

面板只决定确认方式、操作范围以及自身的刷新方式。完整系列、单次实例、级联子任务和保留已完成实例具有不同语义，调用共享撤回逻辑前按各自规则修改数据。

## 接入一个新操作

```ts
const data = await getAllReminders(plugin);
const undo = new TaskActionUndo(plugin, data);
// 在这里修改任务、子任务或实例数据。
await undo.save(data);
// 更新当前视图、广播本次操作后，再提供撤回入口。
undo.show(i18n('reminderDeleted'));
```

- 输入必须是插件最新的完整数据，使用 `getAllReminders(plugin)` 或完整本地数据 `plugin.loadReminderData()`；不能传入项目、分页或可见卡片的快照。
- 在任何数据修改前创建记录；一条记录只能成功提交一次，保存失败后允许重试。
- 实例排除使用 `saveExcludedTaskInstance`；仅需修改内存数据时使用 `excludeRepeatInstance`。文档任务删除实例时传入 `{ clearState: true }`。
- 撤回成功会广播 `reminderUpdated`，其中 `detail.taskUndo` 为 `true`。需要刷新的弹窗监听此事件，并在关闭时移除监听。
- 写盘成功后即可完成撤回反馈，块属性、徽章和移动端通知在后台更新。读取或写入失败不能显示成功提示。
- 插件卸载仍从 `taskActionUndo.ts` 导入并调用 `dismissTaskUndo(plugin)`；该导出转发到提示模块，保持入口兼容。

## 验证

主要行为回归：`node --test scripts/test-task-action-undo.cjs`。它执行真实共享实现和面板操作，只替换宿主 API、存储和浏览器环境。`scripts/lib/task-action-undo.cjs` 负责测试模块加载，调整共享文件的依赖时同步更新。

按影响范围补充日历、面板刷新和生命周期测试，并执行 `pnpm check:i18n`、`pnpm run build`。这些检查不代表思源实际界面或远端订阅服务验收。
