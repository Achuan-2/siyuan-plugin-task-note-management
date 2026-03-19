import { setBlockAttrs } from "../api";

interface AudioFileItemLike {
    path: string;
    removed?: boolean;
    replaces?: string;
}

interface MigrationPlugin {
    loadSettings(update?: boolean): Promise<any>;
    saveSettings(settings: any): Promise<void>;
    loadData(file: string): Promise<any>;
    saveData(file: string, data: any): Promise<any>;
    removeData(file: string): Promise<any>;
    loadReminderData(update?: boolean): Promise<any>;
    saveReminderData(data: any): Promise<void>;
}

const HABIT_DATA_FILE = "habit.json";
const HABIT_CHECKIN_DIR = "habit";

/**
 * 执行数据迁移
 */
export async function performDataMigration(plugin: MigrationPlugin): Promise<void> {
    try {
        const settings = await plugin.loadSettings();

        // 检查是否需要迁移绑定块属性
        if (!settings.datatransfer?.bindblockAddAttr) {
            console.log("开始迁移绑定块属性...");
            await migrateBindBlockAttributes(plugin);
            console.log("绑定块属性迁移完成");

            // 标记迁移完成
            settings.datatransfer = settings.datatransfer || {};
            settings.datatransfer.bindblockAddAttr = true;
            await plugin.saveSettings(settings);
        }

        // 检查是否需要迁移 termType -> kanbanStatus 并删除 termType 键
        if (!settings.datatransfer?.termTypeTransfer) {
            try {
                console.log("开始迁移 termType 到 kanbanStatus 并删除 termType 键...");
                const reminderData = await plugin.loadReminderData(true);
                if (reminderData && typeof reminderData === "object") {
                    let mappedCount = 0;
                    let removedCount = 0;
                    for (const [id, item] of Object.entries(reminderData) as [string, any][]) {
                        try {
                            if (!item || typeof item !== "object") continue;

                            // 如果当前状态是 todo 且 termType 为 short_term/long_term，则将 kanbanStatus 设置为 termType
                            if (item.kanbanStatus === "todo" && (item.termType === "short_term" || item.termType === "long_term")) {
                                item.kanbanStatus = item.termType;
                                mappedCount++;
                            }

                            // 无论是否做了映射，都删除 termType 键（按要求移除该键）
                            if ("termType" in item) {
                                try {
                                    delete item.termType;
                                    removedCount++;
                                } catch (e) {
                                    // 某些情况下 item 可能是不可写对象，尝试设置为 undefined 再删除
                                    try {
                                        (item as any).termType = undefined;
                                        delete (item as any).termType;
                                        removedCount++;
                                    } catch (ee) {
                                        console.warn(`无法删除提醒 ${id} 的 termType 键:`, ee);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn(`迁移提醒 ${id} 时出错:`, err);
                        }
                    }

                    if (mappedCount > 0 || removedCount > 0) {
                        await plugin.saveReminderData(reminderData);
                        console.log(`termType 迁移完成，映射 ${mappedCount} 条，删除 ${removedCount} 条 termType 键`);
                    } else {
                        console.log("termType 迁移完成，未发现需要映射或删除的项");
                    }
                } else {
                    console.log("没有找到提醒数据，跳过 termType 迁移");
                }

                settings.datatransfer = settings.datatransfer || {};
                settings.datatransfer.termTypeTransfer = true;
                await plugin.saveSettings(settings);
            } catch (err) {
                console.error("termType 到 kanbanStatus 的迁移失败:", err);
            }
        }

        // 检查是否需要迁移随机休息相关的设置项名称 (randomNotification -> randomRest)
        if (!settings.datatransfer?.randomRestTransfer) {
            console.log("开始迁移随机休息设置项...");
            let migratedCount = 0;
            const mapping = {
                randomNotificationEnabled: "randomRestEnabled",
                randomNotificationMinInterval: "randomRestMinInterval",
                randomNotificationMaxInterval: "randomRestMaxInterval",
                randomNotificationBreakDuration: "randomRestBreakDuration",
                randomNotificationSystemNotification: "randomRestSystemNotification",
                randomNotificationPopupWindow: "randomRestPopupWindow",
                randomNotificationSounds: "randomRestSounds",
                randomNotificationEndSound: "randomRestEndSound",
            };

            for (const [oldKey, newKey] of Object.entries(mapping)) {
                if (oldKey in settings) {
                    (settings as any)[newKey] = (settings as any)[oldKey];
                    delete (settings as any)[oldKey];
                    migratedCount++;
                }
            }

            // 迁移 audioFileLists 和 audioSelected 中的键名
            const audioMapping = {
                randomNotificationSounds: "randomRestSounds",
                randomNotificationEndSound: "randomRestEndSound",
            };

            if (settings.audioFileLists) {
                for (const [oldKey, newKey] of Object.entries(audioMapping)) {
                    if (settings.audioFileLists[oldKey]) {
                        settings.audioFileLists[newKey] = settings.audioFileLists[oldKey];
                        delete settings.audioFileLists[oldKey];
                        migratedCount++;
                    }
                }
            }

            if (settings.audioSelected) {
                for (const [oldKey, newKey] of Object.entries(audioMapping)) {
                    if (settings.audioSelected[oldKey]) {
                        settings.audioSelected[newKey] = settings.audioSelected[oldKey];
                        delete settings.audioSelected[oldKey];
                        migratedCount++;
                    }
                }
            }

            if (migratedCount > 0) {
                settings.datatransfer = settings.datatransfer || {};
                settings.datatransfer.randomRestTransfer = true;
                await plugin.saveSettings(settings);
                console.log(`随机休息设置项迁移完成，共迁移 ${migratedCount} 项`);
            }
        }

        // 检查是否需要迁移 removeDateAfterDetection 从 bool 到 string
        if (typeof settings.removeDateAfterDetection === "boolean") {
            console.log("开始迁移 removeDateAfterDetection...");
            const oldVal = (settings as any).removeDateAfterDetection;
            settings.removeDateAfterDetection = oldVal ? "all" : "none";
            await plugin.saveSettings(settings);
            console.log("removeDateAfterDetection 迁移完成");
        }

        // 检查是否需要迁移音频文件列表
        if (!settings.datatransfer?.audioFileTransfer) {
            console.log("开始迁移音频文件列表...");
            const audioKeys = [
                "notificationSound",
                "pomodoroWorkSound",
                "pomodoroBreakSound",
                "pomodoroLongBreakSound",
                "pomodoroWorkEndSound",
                "pomodoroBreakEndSound",
                "randomRestSounds",
                "randomRestEndSound",
            ];
            if (!settings.audioFileLists) settings.audioFileLists = {};
            if (!settings.audioSelected) settings.audioSelected = {};

            let audioMigratedCount = 0;
            for (const key of audioKeys) {
                const existing = (settings as any)[key] as string | undefined;
                if (existing) {
                    const list: any[] = settings.audioFileLists[key] ?? [];
                    // 确保 list 是 AudioFileItem[]
                    const itemList: AudioFileItemLike[] = list.map((item) =>
                        typeof item === "string" ? { path: item } : item
                    );

                    if (!itemList.some((i) => i.path === existing)) {
                        itemList.push({ path: existing }); // 保持原有顺序，加到后面
                        audioMigratedCount++;
                    }
                    settings.audioFileLists[key] = itemList;
                    // 记录当前选中
                    settings.audioSelected[key] = existing;
                    // 迁移后从根部删除旧键
                    delete (settings as any)[key];
                } else if (settings.audioFileLists[key]) {
                    // 如果没有旧键，但存在旧的 string[] 列表，也需要转换
                    const list = settings.audioFileLists[key];
                    if (list.length > 0 && typeof list[0] === "string") {
                        settings.audioFileLists[key] = (list as any).map((p: string) => ({ path: p }));
                    }
                }
            }

            settings.datatransfer = settings.datatransfer || {};
            settings.datatransfer.audioFileTransfer = true;
            await plugin.saveSettings(settings);
            console.log(`音频文件列表迁移完成，更新了 ${audioMigratedCount} 个项`);
        }
        if (!settings.datatransfer?.habitCheckinTransfer) {
            await migrateHabitCheckinData(plugin, settings);
        }
    } catch (error) {
        console.error("数据迁移失败:", error);
    }
}

/**
 * 迁移绑定块属性：为绑定了提醒的块添加 custom-bind-reminders 属性
 */
async function migrateBindBlockAttributes(plugin: MigrationPlugin): Promise<void> {
    try {
        const reminderData = await plugin.loadReminderData();

        if (!reminderData || typeof reminderData !== "object") {
            console.log("没有找到提醒数据，跳过迁移");
            return;
        }

        let migratedCount = 0;

        // 遍历所有提醒，找到绑定到块的提醒
        for (const [reminderId, reminder] of Object.entries(reminderData) as [string, any][]) {
            if (!reminder || !reminder.blockId) continue;

            try {
                // 检查块是否已经有 custom-bind-reminders 属性
                const blockElement = document.querySelector(`[data-node-id="${reminder.blockId}"]`);
                if (!blockElement) continue;

                const existingAttr = blockElement.getAttribute("custom-bind-reminders");
                if (existingAttr) {
                    // 如果已经存在，检查是否包含当前提醒ID
                    const existingIds = existingAttr.split(",").map((s) => s.trim());
                    if (existingIds.includes(reminderId)) {
                        continue; // 已经包含，跳过
                    }
                    // 添加新的提醒ID
                    existingIds.push(reminderId);
                    await setBlockAttrs(reminder.blockId, {
                        "custom-bind-reminders": existingIds.join(","),
                    });
                } else {
                    // 不存在，设置新的属性
                    await setBlockAttrs(reminder.blockId, {
                        "custom-bind-reminders": reminderId,
                    });
                }

                migratedCount++;
            } catch (error) {
                console.warn(`迁移块 ${reminder.blockId} 的属性失败:`, error);
            }
        }

        console.log(`成功迁移了 ${migratedCount} 个绑定块的属性`);
    } catch (error) {
        console.error("迁移绑定块属性时出错:", error);
        throw error;
    }
}

function getHabitCheckinFileName(habitId: string): string {
    return `${HABIT_CHECKIN_DIR}/${habitId}.json`;
}

async function migrateHabitCheckinData(plugin: MigrationPlugin, settings: any): Promise<void> {
    try {
        const rawHabitData = await plugin.loadData(HABIT_DATA_FILE);
        const habitData = (rawHabitData && typeof rawHabitData === "object") ? rawHabitData : {};
        const nextHabitData: Record<string, any> = {};
        const activeHabitIds = new Set<string>();

        for (const [habitId, habit] of Object.entries(habitData) as [string, any][]) {
            if (!habit || typeof habit !== "object") {
                nextHabitData[habitId] = habit;
                continue;
            }

            activeHabitIds.add(habitId);
            await plugin.saveData(getHabitCheckinFileName(habitId), {
                checkIns: habit.checkIns || {},
                hasNotify: habit.hasNotify || {},
                totalCheckIns: habit.totalCheckIns ?? 0,
            });

            const baseHabit = { ...habit };
            delete baseHabit.checkIns;
            delete baseHabit.hasNotify;
            delete baseHabit.totalCheckIns;
            nextHabitData[habitId] = baseHabit;
        }

        await plugin.saveData(HABIT_DATA_FILE, nextHabitData);

        const existingCheckinDir = await plugin.loadData(HABIT_CHECKIN_DIR);
        if (existingCheckinDir && typeof existingCheckinDir === "object" && !Array.isArray(existingCheckinDir)) {
            for (const fileName of Object.keys(existingCheckinDir)) {
                const habitId = fileName.replace(/\.json$/i, "");
                if (!activeHabitIds.has(habitId)) {
                    await plugin.removeData(getHabitCheckinFileName(habitId));
                }
            }
        }

        settings.datatransfer = settings.datatransfer || {};
        settings.datatransfer.habitCheckinTransfer = true;
        await plugin.saveSettings(settings);
    } catch (error) {
        console.error("Failed to migrate habit checkin data:", error);
    }
}
