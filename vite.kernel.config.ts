import { dirname, resolve } from "path";
import { defineConfig } from "vite";

const env = process.env;
const isDev = env.NODE_ENV === "development";
const outputDir = isDev ? "dev" : "dist";

export default defineConfig({
    plugins: [{
        name: 'kernel-api-boundary',
        enforce: 'pre',
        resolveId(source, importer) {
            // 共享管理器可以在两端使用，内核构建必须选择原生 client API。
            if (importer && source.startsWith('.') &&
                [resolve(__dirname, 'src/api'), resolve(__dirname, 'src/api.ts')].includes(resolve(dirname(importer), source))) {
                return resolve(__dirname, 'src/kernel/utils/siyuanApi.ts');
            }
        },
        generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
                if (output.type === 'chunk' && output.imports.length) {
                    this.error(`内核产物不能依赖外部模块：${output.imports.join(', ')}`);
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
        target: 'es2020',
        outDir: outputDir,
        // 不清理输出目录，避免覆盖前端构建产物
        emptyOutDir: false,
        minify: !isDev,
        sourcemap: false,

        lib: {
            entry: resolve(__dirname, "src/kernel.ts"),
            fileName: "kernel",
            name: 'TaskNoteKernel',
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
