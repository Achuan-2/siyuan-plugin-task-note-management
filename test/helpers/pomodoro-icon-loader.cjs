const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const renderDirectory = path.resolve(__dirname, '../../src/components/render');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

// 使用真实 SVG 与共享几何模块，允许原生菜单测试注入 Canvas API。
function loadPomodoroIcons({ code, globals = {} } = {}) {
    const cache = new Map();
    function load(filename) {
        if (cache.has(filename)) return cache.get(filename).exports;
        const module = { exports: {} };
        cache.set(filename, module);
        const localRequire = name => {
            const target = path.resolve(path.dirname(filename), name);
            if (target.endsWith('.svg?raw')) {
                return { __esModule: true, default: fs.readFileSync(target.slice(0, -4), 'utf8') };
            }
            return load(target + '.ts');
        };
        const source = filename === path.join(renderDirectory, 'pomodoroIcons.ts') && code !== undefined
            ? code : compile(fs.readFileSync(filename, 'utf8'));
        new Function('require', 'module', 'exports', ...Object.keys(globals), source)(
            localRequire, module, module.exports, ...Object.values(globals),
        );
        return module.exports;
    }
    return load(path.join(renderDirectory, 'pomodoroIcons.ts'));
}

module.exports = { loadPomodoroIcons };
