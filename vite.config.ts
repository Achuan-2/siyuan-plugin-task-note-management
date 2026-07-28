import { resolve } from "path"
import { defineConfig, loadEnv } from "vite"
import { viteStaticCopy } from "vite-plugin-static-copy"
import livereload from "rollup-plugin-livereload"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import zipPack from "vite-plugin-zip-pack";
import fg from 'fast-glob';
import fs from 'fs';
import { execSync } from 'child_process';


const env = process.env;
const isSrcmap = env.VITE_SOURCEMAP === 'inline';
const isDev = env.NODE_ENV === 'development';

const outputDir = isDev ? "dev" : "dist";

// 使用 vendor/fullcalendar（fork 自 fullcalendar-workspace v6.1.21，新增 timegrid hiddenTimeRanges 原生折叠支持）的源码
const fcPkg = (p: string, f: string) => resolve(__dirname, `vendor/fullcalendar/standard/packages/${p}/src/${f}`);

console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);

export default defineConfig({
    resolve: {
        alias: [
            // fullcalendar 子路径需先于包名匹配
            { find: /^@fullcalendar\/core\/internal$/, replacement: fcPkg("core", "internal.ts") },
            { find: /^@fullcalendar\/core\/preact$/, replacement: fcPkg("core", "preact.ts") },
            { find: /^@fullcalendar\/daygrid\/internal$/, replacement: fcPkg("daygrid", "internal.ts") },
            { find: /^@fullcalendar\/core$/, replacement: fcPkg("core", "index.ts") },
            { find: /^@fullcalendar\/daygrid$/, replacement: fcPkg("daygrid", "index.ts") },
            { find: /^@fullcalendar\/timegrid$/, replacement: fcPkg("timegrid", "index.ts") },
            { find: /^@fullcalendar\/interaction$/, replacement: fcPkg("interaction", "index.ts") },
            { find: /^@fullcalendar\/list$/, replacement: fcPkg("list", "index.ts") },
            { find: /^@fullcalendar\/multimonth$/, replacement: fcPkg("multimonth", "index.ts") },
            { find: "@", replacement: resolve(__dirname, "src") },
        ]
    },

    // fullcalendar 源码为 classic JSX（显式 import createElement/Fragment）
    esbuild: {
        jsxFactory: "createElement",
        jsxFragment: "Fragment",
    },

    css: {
        preprocessorOptions: {
            scss: {
                // fullcalendar 源码使用 @import，忽略其弃用警告
                silenceDeprecations: ["import", "global-builtin", "color-functions", "mixed-decls"],
            }
        }
    },

    plugins: [
        svelte(),

        viteStaticCopy({
            targets: [
                { src: "./README*.md", dest: "./" },
                { src: "./CHANGELOG.md", dest: "./" },
                { src: "./plugin.json", dest: "./" },

                { src: "./preview.png", dest: "./" },
                { src: "./icon.png", dest: "./" },
                { src: "./audios/*", dest: "./audios/" },
                { src: "./assets/*", dest: "./assets/" },
                { src: "./i18n/*", dest: "./i18n/" },
                { src: "./skills/**/*", dest: "./skills/" },
            ],
        }),

        // Auto copy to SiYuan plugins directory
        {
            name: 'auto-copy-to-siyuan',
            writeBundle() {
                try {
                    // Run the copy script after build, passing the outputDir
                    execSync(`node --no-warnings ./scripts/make_dev_copy.js ${outputDir}`, {
                        stdio: 'inherit',
                        cwd: process.cwd()
                    });
                } catch (error) {
                    console.warn('Auto copy to SiYuan failed:', error.message);
                }
            }
        },

    ],

    define: {
        "process.env.DEV_MODE": JSON.stringify(isDev),
        "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV),
        // Vue feature flags to avoid runtime warnings from ESM build (e.g., Milkdown)
        // Set __VUE_OPTIONS_API__ to true for compatibility; production devtools & hydration details disabled
        __VUE_OPTIONS_API__: true,
        __VUE_PROD_DEVTOOLS__: false,
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
    },

    build: {
        outDir: outputDir,
        // Keep existing files in output directory for incremental builds
        emptyOutDir: false,
        minify: true,
        sourcemap: isSrcmap ? 'inline' : false,

        lib: {
            entry: resolve(__dirname, "src/index.ts"),
            fileName: "index",
            formats: ["cjs"],
        },
        rollupOptions: {
            plugins: [
                ...(isDev ? [
                    {
                        name: 'watch-external',
                        async buildStart() {
                            const files = await fg([
                                './i18n/**',
                                './README*.md',
                                './CHANGELOG.md',
                                './plugin.json'

                            ]);
                            for (let file of files) {
                                this.addWatchFile(file);
                            }
                        }
                    }
                ] : [
                    // Clean up unnecessary files under dist dir
                    cleanupDistFiles({
                        patterns: ['i18n/*.yaml', 'i18n/*.md'],
                        distDir: outputDir
                    }),
                    zipPack({
                        inDir: './dist',
                        outDir: './',
                        outFileName: 'package.zip'
                    })
                ])
            ],

            external: ["siyuan", "process"],

            output: {
                entryFileNames: "[name].js",
                assetFileNames: (assetInfo) => {
                    if (assetInfo.name === "style.css") {
                        return "index.css"
                    }
                    return assetInfo.name
                },
                // 禁用代码分割，将所有代码打包到单个文件中
                manualChunks: undefined,
                inlineDynamicImports: true,
            },
        },
    }
});


/**
 * Clean up some dist files after compiled
 * @author frostime
 * @param options:
 * @returns 
 */
function cleanupDistFiles(options: { patterns: string[], distDir: string }) {
    const {
        patterns,
        distDir
    } = options;

    return {
        name: 'rollup-plugin-cleanup',
        enforce: 'post',
        writeBundle: {
            sequential: true,
            order: 'post' as 'post',
            async handler() {
                const fg = await import('fast-glob');
                const fs = await import('fs');
                // const path = await import('path');

                // 使用 glob 语法，确保能匹配到文件
                const distPatterns = patterns.map(pat => `${distDir}/${pat}`);
                console.debug('Cleanup searching patterns:', distPatterns);

                const files = await fg.default(distPatterns, {
                    dot: true,
                    absolute: true,
                    onlyFiles: false
                });

                // console.info('Files to be cleaned up:', files);

                for (const file of files) {
                    try {
                        if (fs.default.existsSync(file)) {
                            const stat = fs.default.statSync(file);
                            if (stat.isDirectory()) {
                                fs.default.rmSync(file, { recursive: true });
                            } else {
                                fs.default.unlinkSync(file);
                            }
                            console.log(`Cleaned up: ${file}`);
                        }
                    } catch (error) {
                        console.error(`Failed to clean up ${file}:`, error);
                    }
                }
            }
        }
    };
}
