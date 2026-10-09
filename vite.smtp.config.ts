import { resolve } from 'node:path';
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
    build: {
        outDir: process.env.NODE_ENV === 'development' ? 'dev' : 'dist',
        emptyOutDir: false,
        target: 'node18',
        lib: { entry: resolve(__dirname, 'src/desktop/smtp.ts'), formats: ['cjs'], fileName: () => 'desktop-smtp.cjs' },
        rollupOptions: {
            external: [...builtinModules, ...builtinModules.map(name => `node:${name}`)],
            output: { inlineDynamicImports: true },
        },
    },
});
