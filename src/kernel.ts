/// <reference types="siyuan/kernel" />

import type { IMcp, ILogger, IStorage, IRpc } from "siyuan/kernel";
import { createKernelStorage, type KernelStorage } from "./kernel/storageAdapter";
import { ReminderManager } from "./components/dataManager/reminderManager";
import { ProjectManager } from "./components/dataManager/projectManager";
import { ProjectColumnsManager } from "./components/dataManager/projectColumnsManager";
import { ProjectFolderManager } from "./components/dataManager/projectFolderManager";
import { CategoryManager } from "./components/dataManager/categoryManager";
import { HabitManager } from "./components/dataManager/habitManager";
import { PomodoroManager } from "./components/dataManager/pomodoroRecord";
import { SummaryManager } from "./components/dataManager/summaryManager";
import { createMcpRegistry, type ToolDefinition } from "./kernel/tools/index";
import { STATUSES_DATA_FILE } from "./kernel/constants";

class KernelPluginBridge {
    private storage: KernelStorage;
    public settings: any = null;

    constructor(storage: KernelStorage) {
        this.storage = storage;
    }

    async loadData(path: string): Promise<any> {
        return this.storage.loadData(path);
    }

    async saveData(path: string, data: any): Promise<void> {
        await this.storage.saveData(path, data);
        await this.notifyDataUpdated(path);
    }

    async removeData(path: string): Promise<void> {
        await this.storage.removeData(path);
        await this.notifyDataUpdated(path);
    }

    async loadCategories(): Promise<any> {
        return this.loadData("categories.json");
    }

    async saveCategories(data: any): Promise<void> {
        await this.saveData("categories.json", data);
    }

    async loadProjectData(): Promise<any> {
        return this.loadData("project.json");
    }

    async saveProjectData(data: any): Promise<void> {
        await this.saveData("project.json", data);
    }

    async loadProjectStatus(): Promise<any> {
        return this.loadData(STATUSES_DATA_FILE);
    }

    async saveProjectStatus(data: any): Promise<void> {
        await this.saveData(STATUSES_DATA_FILE, data);
    }

    async loadHabitGroupData(): Promise<any> {
        return this.loadData("habitGroup.json");
    }

    async saveHabitGroupData(data: any): Promise<void> {
        await this.saveData("habitGroup.json", data);
    }

    async loadSettings(): Promise<any> {
        if (!this.settings) {
            this.settings = await this.loadData("settings.json") || {};
        }
        return this.settings;
    }

    async saveSettings(settings: any): Promise<void> {
        this.settings = settings;
        await this.saveData("settings.json", settings);
    }

    async loadReminderData(): Promise<any> {
        return this.loadData("reminder.json");
    }

    async loadHolidayData(): Promise<any> {
        return this.loadData("holiday.json");
    }

    async loadSubscriptionData(): Promise<any> {
        return this.loadData("ics_subscriptions.json");
    }

    async loadSubscriptionTasks(subscriptionId: string): Promise<any> {
        return this.loadData(`subscribe/${subscriptionId}.json`);
    }

    async loadPomodoroRecords(force: boolean = false): Promise<any> {
        try {
            const files = await this.storage.readDir("pomodoroRecords");
            const records: Record<string, any> = {};
            await Promise.all(
                files
                    .filter((f) => !f.isDir && f.name.endsWith(".json"))
                    .map(async (f) => {
                        const name = f.name;
                        const record = await this.storage.loadData(`pomodoroRecords/${name}`);
                        if (record && typeof record === "object") {
                            const dateMatch = name.match(/^(.+)\.json$/i);
                            const date = dateMatch ? dateMatch[1] : name;
                            records[date] = record;
                        }
                    })
            );
            return records;
        } catch (e) {
            console.error("[kernel] failed to load pomodoro records:", e);
            return {};
        }
    }

    private async notifyDataUpdated(path: string) {
        try {
            await (globalThis as any).siyuan.rpc.broadcast("data-updated", { path });
        } catch (e) {
            console.error("[kernel] failed to broadcast data-updated event:", e);
        }
    }
}

class KernelPlugin {
    private readonly siyuan: typeof globalThis.siyuan;
    private readonly logger: ILogger;

    private storage = createKernelStorage();
    private bridge = new KernelPluginBridge(this.storage);

    private reminderManager = ReminderManager.getInstance(this.bridge);
    private projectManager = ProjectManager.getInstance(this.bridge);
    private projectColumnsManager = new ProjectColumnsManager(this.projectManager);
    private projectFolderManager = ProjectFolderManager.getInstance(this.bridge);
    private categoryManager = CategoryManager.getInstance(this.bridge);
    private habitManager = HabitManager.getInstance(this.bridge);
    private pomodoroManager = PomodoroManager.getInstance(this.bridge);
    private summaryManager = new SummaryManager(
        this.bridge,
        this.reminderManager,
        this.projectManager,
        this.habitManager,
        this.pomodoroManager
    );

    private registry: ToolDefinition[] = [];
    private registeredToolNames: string[] = [];

    constructor() {
        this.siyuan = siyuan;
        this.logger = this.siyuan.logger;

        this.siyuan.plugin.lifecycle.onload = this.onload.bind(this);
        this.siyuan.plugin.lifecycle.onunload = this.onunload.bind(this);
    }

    private async registerCapability(name: string, config: any, handler: any): Promise<any> {
        const siyuanAny = this.siyuan as any;
        if (siyuanAny.agent && typeof siyuanAny.agent.registerCapability === "function") {
            return await siyuanAny.agent.registerCapability(name, config, handler);
        }
        if (siyuanAny.mcp && typeof siyuanAny.mcp.registerTool === "function") {
            return await siyuanAny.mcp.registerTool(name, config, handler);
        }
        throw new Error("Neither siyuan.agent.registerCapability nor siyuan.mcp.registerTool is available");
    }

    private async unregisterCapability(name: string): Promise<void> {
        const siyuanAny = this.siyuan as any;
        if (siyuanAny.agent && typeof siyuanAny.agent.unregisterCapability === "function") {
            await siyuanAny.agent.unregisterCapability(name);
            return;
        }
        if (siyuanAny.mcp && typeof siyuanAny.mcp.unregisterTool === "function") {
            await siyuanAny.mcp.unregisterTool(name);
            return;
        }
    }

    private async onload(): Promise<void> {
        await this.logger.info("[kernel] Agent capability plugin loading");

        try {
            // Initialize managers to load data cache
            await Promise.all([
                this.reminderManager.initialize(),
                this.projectManager.initialize(),
                this.projectFolderManager.initialize(),
                this.categoryManager.initialize(),
                this.habitManager.initialize(),
                this.pomodoroManager.initialize(),
            ]);

            this.registry = createMcpRegistry({
                reminderManager: this.reminderManager,
                projectManager: this.projectManager,
                projectColumnsManager: this.projectColumnsManager,
                projectFolderManager: this.projectFolderManager,
                categoryManager: this.categoryManager,
                habitManager: this.habitManager,
                pomodoroManager: this.pomodoroManager,
                summaryManager: this.summaryManager,
            });

            for (const tool of this.registry) {
                const registered = await this.registerCapability(tool.name, tool.config, tool.handler);
                this.registeredToolNames.push(tool.name);
                await this.logger.debug("[kernel] registered capability:", registered?.name || tool.name);
            }

            await this.logger.info(`[kernel] registered ${this.registeredToolNames.length} capabilities`);
        } catch (error: any) {
            await this.logger.error("[kernel] failed to register capabilities:", error);
            throw error;
        }
    }

    private async onunload(): Promise<void> {
        await this.logger.info("[kernel] Agent capability plugin unloading");

        for (const name of this.registeredToolNames) {
            try {
                await this.unregisterCapability(name);
                await this.logger.debug("[kernel] unregistered capability:", name);
            } catch (error: any) {
                await this.logger.error(`[kernel] failed to unregister capability ${name}:`, error);
            }
        }

        this.registeredToolNames = [];
    }
}

new KernelPlugin();
