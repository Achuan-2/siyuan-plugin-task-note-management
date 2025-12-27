// vite.config.ts
import { resolve } from "path";
import { defineConfig } from "file:///D:/Code/siyuan-plugin-task-note-management/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.27_sass@1.97.1/node_modules/vite/dist/node/index.js";
import { viteStaticCopy } from "file:///D:/Code/siyuan-plugin-task-note-management/node_modules/.pnpm/vite-plugin-static-copy@1.0_2319ccc167a45f7f321559732f22023a/node_modules/vite-plugin-static-copy/dist/index.js";
import { svelte } from "file:///D:/Code/siyuan-plugin-task-note-management/node_modules/.pnpm/@sveltejs+vite-plugin-svelt_f134bf981a3ed1f1ccede7758cbc355a/node_modules/@sveltejs/vite-plugin-svelte/src/index.js";
import zipPack from "file:///D:/Code/siyuan-plugin-task-note-management/node_modules/.pnpm/vite-plugin-zip-pack@1.2.4__830f45131e5d3cc3dd8df218be98789e/node_modules/vite-plugin-zip-pack/dist/esm/index.mjs";
import fg from "file:///D:/Code/siyuan-plugin-task-note-management/node_modules/.pnpm/fast-glob@3.3.3/node_modules/fast-glob/out/index.js";
import { execSync } from "child_process";
var __vite_injected_original_dirname = "d:\\Code\\siyuan-plugin-task-note-management";
var env = process.env;
var isSrcmap = env.VITE_SOURCEMAP === "inline";
var isDev = env.NODE_ENV === "development";
var outputDir = isDev ? "dev" : "dist";
console.log("isDev=>", isDev);
console.log("isSrcmap=>", isSrcmap);
console.log("outputDir=>", outputDir);
var vite_config_default = defineConfig({
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "src")
    }
  },
  plugins: [
    svelte(),
    viteStaticCopy({
      targets: [
        { src: "./README*.md", dest: "./" },
        { src: "./plugin.json", dest: "./" },
        { src: "./preview.png", dest: "./" },
        { src: "./icon.png", dest: "./" },
        { src: "./audios/*", dest: "./audios/" },
        { src: "./assets/*", dest: "./assets/" },
        { src: "./i18n/*", dest: "./i18n/" }
      ]
    }),
    // Auto copy to SiYuan plugins directory in dev mode
    ...isDev ? [
      {
        name: "auto-copy-to-siyuan",
        writeBundle() {
          try {
            execSync("node --no-warnings ./scripts/make_dev_copy.js", {
              stdio: "inherit",
              cwd: process.cwd()
            });
          } catch (error) {
            console.warn("Auto copy to SiYuan failed:", error.message);
            console.warn("You can manually run: pnpm run make-link-win");
          }
        }
      }
    ] : []
  ],
  define: {
    "process.env.DEV_MODE": JSON.stringify(isDev),
    "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
  },
  build: {
    outDir: outputDir,
    // Keep existing files in output directory for incremental builds
    emptyOutDir: false,
    minify: true,
    sourcemap: isSrcmap ? "inline" : false,
    lib: {
      entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
      fileName: "index",
      formats: ["cjs"]
    },
    rollupOptions: {
      plugins: [
        ...isDev ? [
          {
            name: "watch-external",
            async buildStart() {
              const files = await fg([
                "./i18n/**",
                "./README*.md",
                "./plugin.json"
              ]);
              for (let file of files) {
                this.addWatchFile(file);
              }
            }
          }
        ] : [
          // Clean up unnecessary files under dist dir
          cleanupDistFiles({
            patterns: ["i18n/*.yaml", "i18n/*.md"],
            distDir: outputDir
          }),
          zipPack({
            inDir: "./dist",
            outDir: "./",
            outFileName: "package.zip"
          })
        ]
      ],
      external: ["siyuan", "process"],
      output: {
        entryFileNames: "[name].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === "style.css") {
            return "index.css";
          }
          return assetInfo.name;
        },
        // 禁用代码分割，将所有代码打包到单个文件中
        manualChunks: void 0,
        inlineDynamicImports: true
      }
    }
  }
});
function cleanupDistFiles(options) {
  const {
    patterns,
    distDir
  } = options;
  return {
    name: "rollup-plugin-cleanup",
    enforce: "post",
    writeBundle: {
      sequential: true,
      order: "post",
      async handler() {
        const fg2 = await import("file:///D:/Code/siyuan-plugin-task-note-management/node_modules/.pnpm/fast-glob@3.3.3/node_modules/fast-glob/out/index.js");
        const fs = await import("fs");
        const distPatterns = patterns.map((pat) => `${distDir}/${pat}`);
        console.debug("Cleanup searching patterns:", distPatterns);
        const files = await fg2.default(distPatterns, {
          dot: true,
          absolute: true,
          onlyFiles: false
        });
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
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJkOlxcXFxDb2RlXFxcXHNpeXVhbi1wbHVnaW4tdGFzay1ub3RlLW1hbmFnZW1lbnRcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcImQ6XFxcXENvZGVcXFxcc2l5dWFuLXBsdWdpbi10YXNrLW5vdGUtbWFuYWdlbWVudFxcXFx2aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vZDovQ29kZS9zaXl1YW4tcGx1Z2luLXRhc2stbm90ZS1tYW5hZ2VtZW50L3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJwYXRoXCJcclxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnLCBsb2FkRW52IH0gZnJvbSBcInZpdGVcIlxyXG5pbXBvcnQgeyB2aXRlU3RhdGljQ29weSB9IGZyb20gXCJ2aXRlLXBsdWdpbi1zdGF0aWMtY29weVwiXHJcbmltcG9ydCBsaXZlcmVsb2FkIGZyb20gXCJyb2xsdXAtcGx1Z2luLWxpdmVyZWxvYWRcIlxyXG5pbXBvcnQgeyBzdmVsdGUgfSBmcm9tIFwiQHN2ZWx0ZWpzL3ZpdGUtcGx1Z2luLXN2ZWx0ZVwiXHJcbmltcG9ydCB6aXBQYWNrIGZyb20gXCJ2aXRlLXBsdWdpbi16aXAtcGFja1wiO1xyXG5pbXBvcnQgZmcgZnJvbSAnZmFzdC1nbG9iJztcclxuaW1wb3J0IGZzIGZyb20gJ2ZzJztcclxuaW1wb3J0IHsgZXhlY1N5bmMgfSBmcm9tICdjaGlsZF9wcm9jZXNzJztcclxuXHJcblxyXG5jb25zdCBlbnYgPSBwcm9jZXNzLmVudjtcclxuY29uc3QgaXNTcmNtYXAgPSBlbnYuVklURV9TT1VSQ0VNQVAgPT09ICdpbmxpbmUnO1xyXG5jb25zdCBpc0RldiA9IGVudi5OT0RFX0VOViA9PT0gJ2RldmVsb3BtZW50JztcclxuXHJcbmNvbnN0IG91dHB1dERpciA9IGlzRGV2ID8gXCJkZXZcIiA6IFwiZGlzdFwiO1xyXG5cclxuY29uc29sZS5sb2coXCJpc0Rldj0+XCIsIGlzRGV2KTtcclxuY29uc29sZS5sb2coXCJpc1NyY21hcD0+XCIsIGlzU3JjbWFwKTtcclxuY29uc29sZS5sb2coXCJvdXRwdXREaXI9PlwiLCBvdXRwdXREaXIpO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcclxuICAgIHJlc29sdmU6IHtcclxuICAgICAgICBhbGlhczoge1xyXG4gICAgICAgICAgICBcIkBcIjogcmVzb2x2ZShfX2Rpcm5hbWUsIFwic3JjXCIpLFxyXG4gICAgICAgIH1cclxuICAgIH0sXHJcblxyXG4gICAgcGx1Z2luczogW1xyXG4gICAgICAgIHN2ZWx0ZSgpLFxyXG5cclxuICAgICAgICB2aXRlU3RhdGljQ29weSh7XHJcbiAgICAgICAgICAgIHRhcmdldHM6IFtcclxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vUkVBRE1FKi5tZFwiLCBkZXN0OiBcIi4vXCIgfSxcclxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vcGx1Z2luLmpzb25cIiwgZGVzdDogXCIuL1wiIH0sXHJcbiAgICAgICAgICAgICAgICB7IHNyYzogXCIuL3ByZXZpZXcucG5nXCIsIGRlc3Q6IFwiLi9cIiB9LFxyXG4gICAgICAgICAgICAgICAgeyBzcmM6IFwiLi9pY29uLnBuZ1wiLCBkZXN0OiBcIi4vXCIgfSxcclxuICAgICAgICAgICAgICAgIHsgc3JjOiBcIi4vYXVkaW9zLypcIiwgZGVzdDogXCIuL2F1ZGlvcy9cIiB9LFxyXG4gICAgICAgICAgICAgICAgeyBzcmM6IFwiLi9hc3NldHMvKlwiLCBkZXN0OiBcIi4vYXNzZXRzL1wiIH0sXHJcbiAgICAgICAgICAgICAgICB7IHNyYzogXCIuL2kxOG4vKlwiLCBkZXN0OiBcIi4vaTE4bi9cIiB9LFxyXG4gICAgICAgICAgICBdLFxyXG4gICAgICAgIH0pLFxyXG5cclxuICAgICAgICAvLyBBdXRvIGNvcHkgdG8gU2lZdWFuIHBsdWdpbnMgZGlyZWN0b3J5IGluIGRldiBtb2RlXHJcbiAgICAgICAgLi4uKGlzRGV2ID8gW1xyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBuYW1lOiAnYXV0by1jb3B5LXRvLXNpeXVhbicsXHJcbiAgICAgICAgICAgICAgICB3cml0ZUJ1bmRsZSgpIHtcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBSdW4gdGhlIGNvcHkgc2NyaXB0IGFmdGVyIGJ1aWxkXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV4ZWNTeW5jKCdub2RlIC0tbm8td2FybmluZ3MgLi9zY3JpcHRzL21ha2VfZGV2X2NvcHkuanMnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdGRpbzogJ2luaGVyaXQnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY3dkOiBwcm9jZXNzLmN3ZCgpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignQXV0byBjb3B5IHRvIFNpWXVhbiBmYWlsZWQ6JywgZXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnNvbGUud2FybignWW91IGNhbiBtYW51YWxseSBydW46IHBucG0gcnVuIG1ha2UtbGluay13aW4nKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICBdIDogW10pLFxyXG5cclxuICAgIF0sXHJcblxyXG4gICAgZGVmaW5lOiB7XHJcbiAgICAgICAgXCJwcm9jZXNzLmVudi5ERVZfTU9ERVwiOiBKU09OLnN0cmluZ2lmeShpc0RldiksXHJcbiAgICAgICAgXCJwcm9jZXNzLmVudi5OT0RFX0VOVlwiOiBKU09OLnN0cmluZ2lmeShlbnYuTk9ERV9FTlYpXHJcbiAgICB9LFxyXG5cclxuICAgIGJ1aWxkOiB7XHJcbiAgICAgICAgb3V0RGlyOiBvdXRwdXREaXIsXHJcbiAgICAgICAgLy8gS2VlcCBleGlzdGluZyBmaWxlcyBpbiBvdXRwdXQgZGlyZWN0b3J5IGZvciBpbmNyZW1lbnRhbCBidWlsZHNcclxuICAgICAgICBlbXB0eU91dERpcjogZmFsc2UsXHJcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxyXG4gICAgICAgIHNvdXJjZW1hcDogaXNTcmNtYXAgPyAnaW5saW5lJyA6IGZhbHNlLFxyXG5cclxuICAgICAgICBsaWI6IHtcclxuICAgICAgICAgICAgZW50cnk6IHJlc29sdmUoX19kaXJuYW1lLCBcInNyYy9pbmRleC50c1wiKSxcclxuICAgICAgICAgICAgZmlsZU5hbWU6IFwiaW5kZXhcIixcclxuICAgICAgICAgICAgZm9ybWF0czogW1wiY2pzXCJdLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgcm9sbHVwT3B0aW9uczoge1xyXG4gICAgICAgICAgICBwbHVnaW5zOiBbXHJcbiAgICAgICAgICAgICAgICAuLi4oaXNEZXYgPyBbXHJcbiAgICAgICAgICAgICAgICAgICAge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBuYW1lOiAnd2F0Y2gtZXh0ZXJuYWwnLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBhc3luYyBidWlsZFN0YXJ0KCkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmZyhbXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJy4vaTE4bi8qKicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJy4vUkVBRE1FKi5tZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJy4vcGx1Z2luLmpzb24nXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBdKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGZpbGUgb2YgZmlsZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmFkZFdhdGNoRmlsZShmaWxlKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIF0gOiBbXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdW5uZWNlc3NhcnkgZmlsZXMgdW5kZXIgZGlzdCBkaXJcclxuICAgICAgICAgICAgICAgICAgICBjbGVhbnVwRGlzdEZpbGVzKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcGF0dGVybnM6IFsnaTE4bi8qLnlhbWwnLCAnaTE4bi8qLm1kJ10sXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc3REaXI6IG91dHB1dERpclxyXG4gICAgICAgICAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICAgICAgICAgIHppcFBhY2soe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbkRpcjogJy4vZGlzdCcsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG91dERpcjogJy4vJyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgb3V0RmlsZU5hbWU6ICdwYWNrYWdlLnppcCdcclxuICAgICAgICAgICAgICAgICAgICB9KVxyXG4gICAgICAgICAgICAgICAgXSlcclxuICAgICAgICAgICAgXSxcclxuXHJcbiAgICAgICAgICAgIGV4dGVybmFsOiBbXCJzaXl1YW5cIiwgXCJwcm9jZXNzXCJdLFxyXG5cclxuICAgICAgICAgICAgb3V0cHV0OiB7XHJcbiAgICAgICAgICAgICAgICBlbnRyeUZpbGVOYW1lczogXCJbbmFtZV0uanNcIixcclxuICAgICAgICAgICAgICAgIGFzc2V0RmlsZU5hbWVzOiAoYXNzZXRJbmZvKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKGFzc2V0SW5mby5uYW1lID09PSBcInN0eWxlLmNzc1wiKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBcImluZGV4LmNzc1wiXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBhc3NldEluZm8ubmFtZVxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgIC8vIFx1Nzk4MVx1NzUyOFx1NEVFM1x1NzgwMVx1NTIwNlx1NTI3Mlx1RkYwQ1x1NUMwNlx1NjI0MFx1NjcwOVx1NEVFM1x1NzgwMVx1NjI1M1x1NTMwNVx1NTIzMFx1NTM1NVx1NEUyQVx1NjU4N1x1NEVGNlx1NEUyRFxyXG4gICAgICAgICAgICAgICAgbWFudWFsQ2h1bmtzOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICAgICAgICBpbmxpbmVEeW5hbWljSW1wb3J0czogdHJ1ZSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgfVxyXG59KTtcclxuXHJcblxyXG4vKipcclxuICogQ2xlYW4gdXAgc29tZSBkaXN0IGZpbGVzIGFmdGVyIGNvbXBpbGVkXHJcbiAqIEBhdXRob3IgZnJvc3RpbWVcclxuICogQHBhcmFtIG9wdGlvbnM6XHJcbiAqIEByZXR1cm5zIFxyXG4gKi9cclxuZnVuY3Rpb24gY2xlYW51cERpc3RGaWxlcyhvcHRpb25zOiB7IHBhdHRlcm5zOiBzdHJpbmdbXSwgZGlzdERpcjogc3RyaW5nIH0pIHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgICBwYXR0ZXJucyxcclxuICAgICAgICBkaXN0RGlyXHJcbiAgICB9ID0gb3B0aW9ucztcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIG5hbWU6ICdyb2xsdXAtcGx1Z2luLWNsZWFudXAnLFxyXG4gICAgICAgIGVuZm9yY2U6ICdwb3N0JyxcclxuICAgICAgICB3cml0ZUJ1bmRsZToge1xyXG4gICAgICAgICAgICBzZXF1ZW50aWFsOiB0cnVlLFxyXG4gICAgICAgICAgICBvcmRlcjogJ3Bvc3QnIGFzICdwb3N0JyxcclxuICAgICAgICAgICAgYXN5bmMgaGFuZGxlcigpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZnID0gYXdhaXQgaW1wb3J0KCdmYXN0LWdsb2InKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGZzID0gYXdhaXQgaW1wb3J0KCdmcycpO1xyXG4gICAgICAgICAgICAgICAgLy8gY29uc3QgcGF0aCA9IGF3YWl0IGltcG9ydCgncGF0aCcpO1xyXG5cclxuICAgICAgICAgICAgICAgIC8vIFx1NEY3Rlx1NzUyOCBnbG9iIFx1OEJFRFx1NkNENVx1RkYwQ1x1Nzg2RVx1NEZERFx1ODBGRFx1NTMzOVx1OTE0RFx1NTIzMFx1NjU4N1x1NEVGNlxyXG4gICAgICAgICAgICAgICAgY29uc3QgZGlzdFBhdHRlcm5zID0gcGF0dGVybnMubWFwKHBhdCA9PiBgJHtkaXN0RGlyfS8ke3BhdH1gKTtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZGVidWcoJ0NsZWFudXAgc2VhcmNoaW5nIHBhdHRlcm5zOicsIGRpc3RQYXR0ZXJucyk7XHJcblxyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZXMgPSBhd2FpdCBmZy5kZWZhdWx0KGRpc3RQYXR0ZXJucywge1xyXG4gICAgICAgICAgICAgICAgICAgIGRvdDogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBhYnNvbHV0ZTogdHJ1ZSxcclxuICAgICAgICAgICAgICAgICAgICBvbmx5RmlsZXM6IGZhbHNlXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgICAgICAvLyBjb25zb2xlLmluZm8oJ0ZpbGVzIHRvIGJlIGNsZWFuZWQgdXA6JywgZmlsZXMpO1xyXG5cclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmcy5kZWZhdWx0LmV4aXN0c1N5bmMoZmlsZSkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHN0YXQgPSBmcy5kZWZhdWx0LnN0YXRTeW5jKGZpbGUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHN0YXQuaXNEaXJlY3RvcnkoKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGZzLmRlZmF1bHQucm1TeW5jKGZpbGUsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBmcy5kZWZhdWx0LnVubGlua1N5bmMoZmlsZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhgQ2xlYW5lZCB1cDogJHtmaWxlfWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgRmFpbGVkIHRvIGNsZWFuIHVwICR7ZmlsZX06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH07XHJcbn1cclxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFzVCxTQUFTLGVBQWU7QUFDOVUsU0FBUyxvQkFBNkI7QUFDdEMsU0FBUyxzQkFBc0I7QUFFL0IsU0FBUyxjQUFjO0FBQ3ZCLE9BQU8sYUFBYTtBQUNwQixPQUFPLFFBQVE7QUFFZixT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
