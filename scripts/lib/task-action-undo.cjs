const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// 执行真实撤回实现，只替换思源 API、持久化和浏览器环境。
module.exports = function loadTaskActionUndo(dependencies) {
    const cache = new Map();
    const repeatSource = ts.createSourceFile('repeatUtils.ts', fs.readFileSync(
        path.resolve(__dirname, '../../src/components/dataManager/repeatUtils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    const repeatMutations = repeatSource.statements.filter(statement =>
        ['excludeRepeatInstance', 'deleteRepeatInstanceState'].includes(statement.name?.getText(repeatSource)));
    const repeatCode = ts.transpileModule(repeatMutations.map(statement => statement.getText(repeatSource)).join('\n'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const repeatExports = {};
    new Function('exports', repeatCode)(repeatExports);
    function load(name) {
        if (cache.has(name)) return cache.get(name).exports;
        const module = { exports: {} };
        cache.set(name, module);
        const source = fs.readFileSync(path.resolve(__dirname, '../../src/utils', `${name}.ts`), 'utf8');
        const code = ts.transpileModule(source, {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
        }).outputText;
        const requireDependency = id => {
            if (['./taskUndoPatch', './reminderLoadUtils', './taskUndoToast', './taskActionUndo'].includes(id)) return load(id.slice(2));
            if (id === '../components/dataManager/repeatUtils') return repeatExports;
            if (id === './dateUtils') return {};
            if (['siyuan', '../api', '../pluginInstance', './icsSubscription'].includes(id)) return dependencies;
            throw new Error(`Unconfigured task undo test dependency: ${id}`);
        };
        new Function('require', 'module', 'exports', 'document', 'window', 'CustomEvent', 'setTimeout', 'clearTimeout', code)(
            requireDependency, module, module.exports, dependencies.document, dependencies.window,
            dependencies.CustomEvent, dependencies.setTimeout || setTimeout, dependencies.clearTimeout || clearTimeout,
        );
        return module.exports;
    }
    return { ...load('taskActionUndo'), ...load('taskUndoPatch'), ...load('taskInstanceActions'), ...repeatExports };
};
