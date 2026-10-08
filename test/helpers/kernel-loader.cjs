const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// 加载真实无 DOM 业务模块，仅替换前端语言上下文；可用于验证内核独立运行。
function createKernelLoader() {
    const root = path.resolve(__dirname, '../..');
    const modules = new Map();
    function load(filename) {
        if (filename === path.join(root, 'src/pluginInstance.ts')) return { i18n: () => '' };
        if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
        if (modules.has(filename)) return modules.get(filename).exports;
        const module = { exports: {} };
        modules.set(filename, module);
        const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
        }).outputText;
        const localRequire = name => {
            if (!name.startsWith('.')) return require(name);
            const target = path.resolve(path.dirname(filename), name);
            return load(path.extname(target) ? target : target + '.ts');
        };
        new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
        return module.exports;
    }
    return relative => load(path.join(root, relative));
}

module.exports = { createKernelLoader };
