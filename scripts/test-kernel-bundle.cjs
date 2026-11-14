// 先执行 pnpm run build:kernel，再执行 node --test scripts/test-kernel-bundle.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('内核产物可以作为普通脚本启动，不依赖浏览器模块或 DOM', () => {
    const source = fs.readFileSync(path.join(__dirname, '../dist/kernel.js'), 'utf8');
    const script = new vm.Script(source, { filename: 'kernel.js' });
    const lifecycle = {};
    const context = vm.createContext({
        siyuan: { storage: {}, plugin: { lifecycle }, logger: {}, client: {} },
        console, URL, TextEncoder, TextDecoder,
    });
    script.runInContext(context, { timeout: 5000 });
    assert.equal(typeof lifecycle.onload, 'function');
    assert.equal(typeof lifecycle.onunload, 'function');
});
