const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// 执行真实撤回实现，只替换思源 API、持久化和浏览器环境。
module.exports = function loadTaskActionUndo(dependencies) {
    const cache = new Map();
    function load(name) {
        if (cache.has(name)) return cache.get(name).exports;
        const module = { exports: {} };
        cache.set(name, module);
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/utils', `${name}.ts`), 'utf8');
        const code = ts.transpileModule(source, {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
        }).outputText;
        const requireDependency = id => {
            if (id === './taskUndoPatch' || id === './reminderLoadUtils') return load(id.slice(2));
            if (id === './dateUtils') return {};
            return dependencies;
        };
        new Function('require', 'module', 'exports', 'document', 'window', 'CustomEvent', 'setTimeout', 'clearTimeout', code)(
            requireDependency, module, module.exports, dependencies.document, dependencies.window,
            dependencies.CustomEvent, dependencies.setTimeout || setTimeout, dependencies.clearTimeout || clearTimeout,
        );
        return module.exports;
    }
    return { ...load('taskActionUndo'), ...load('taskUndoPatch') };
};
