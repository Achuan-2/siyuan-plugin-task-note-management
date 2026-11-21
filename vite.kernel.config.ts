import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { defineConfig } from "vite";

const env = process.env;
const isDev = env.NODE_ENV === "development";
const outputDir = isDev ? "dev" : "dist";

const toPosixPath = (filePath: string) => filePath.replace(/\\/g, "/");

const KERNEL_I18N_FILES = new Set([
    toPosixPath(resolve(__dirname, "i18n/zh_CN.json")),
    toPosixPath(resolve(__dirname, "i18n/en.json")),
]);

// 仅打包内核与共享数据管理器实际使用的翻译键，避免将完整前端语言包打入 kernel.js。
const KERNEL_I18N_KEYS = [
    // statusManager
    "active",
    "someday",
    "archived",
    // projectManager
    "defaultInboxProjectName",
    "unnamedProject",
    "doing",
    "shortTerm",
    "longTerm",
    "completed",
    "abandoned",
    "projectCopyTitle",
    // categoryManager
    "work",
    "study",
    "life",
    // ReminderTimeScanner & reminderService
    "unnamedNote",
    "testWebhookTitle",
    "testWebhookMessage",
    "testEmailTitle",
    "testEmailMessage",
    "timeReminderNotification",
    "dailyRemindersNotification",
    "habitReminder",
] as const;

export default defineConfig({
    plugins: [{
        name: "kernel-api-boundary",
        enforce: "pre",
        resolveId(source, importer) {
            if (!importer || !source.startsWith(".")) return;
            const resolved = toPosixPath(resolve(dirname(importer), source));
            // 共享管理器可以在两端使用，内核构建必须选择原生 client API。
            if ([
                toPosixPath(resolve(__dirname, "src/api")),
                toPosixPath(resolve(__dirname, "src/api.ts")),
            ].includes(resolved)) {
                return toPosixPath(resolve(__dirname, "src/kernel/utils/siyuanApi.ts"));
            }
            // 内核仅需公历转农历计算重复任务，替换为轻量查表实现以避免打入完整 lunar-typescript。
            if ([
                toPosixPath(resolve(__dirname, "src/utils/lunarUtils")),
                toPosixPath(resolve(__dirname, "src/utils/lunarUtils.ts")),
            ].includes(resolved)) {
                return toPosixPath(resolve(__dirname, "src/kernel/utils/lunarUtils.ts"));
            }
        },
        load(id) {
            const normalizedId = toPosixPath(id.split("?", 1)[0]);
            if (!KERNEL_I18N_FILES.has(normalizedId)) return;
            const fullDict = JSON.parse(readFileSync(normalizedId, "utf8")) as Record<string, string>;
            const subset: Record<string, string> = {};
            const missing: string[] = [];
            for (const key of KERNEL_I18N_KEYS) {
                if (typeof fullDict[key] === "string") {
                    subset[key] = fullDict[key];
                } else {
                    missing.push(key);
                }
            }
            if (missing.length) {
                this.error(`内核 i18n 裁剪失败，${normalizedId} 缺少键：${missing.join(", ")}`);
            }
            this.addWatchFile(normalizedId);
            return JSON.stringify(subset);
        },
        generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
                if (output.type === "chunk" && output.imports.length) {
                    this.error(`内核产物不能依赖外部模块：${output.imports.join(", ")}`);
                }
            }
        },
    }],
    resolve: {
        alias: {
            "@": resolve(__dirname, "src"),
        },
    },

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
    },

    build: {
        target: "es2020",
        outDir: outputDir,
        // 不清理输出目录，避免覆盖前端构建产物
        emptyOutDir: false,
        minify: !isDev,
        sourcemap: false,

        lib: {
            entry: resolve(__dirname, "src/kernel.ts"),
            fileName: "kernel",
            name: "TaskNoteKernel",
            formats: ["iife"],
        },
        rollupOptions: {
            external: ["siyuan", "process"],
            output: {
                entryFileNames: "kernel.js",
                // 禁用代码分割，内核插件打包为单文件
                manualChunks: undefined,
                inlineDynamicImports: true,
            },
        },
    },
});
