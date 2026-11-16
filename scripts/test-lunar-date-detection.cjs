// Run with: pnpm exec node --test scripts/test-lunar-date-detection.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// 加载真实解析模块，固定当前年份，避免复制一份解析实现来测试。
const root = path.resolve(__dirname, '..');
const fixedNow = new Date('2026-11-16T12:00:00+08:00').getTime();
class FixedDate extends Date {
    constructor(...args) {
        if (args.length) super(...args);
        else super(fixedNow);
    }
    static now() { return fixedNow; }
}

const modules = new Map();
function loadModule(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const localRequire = id => id.startsWith('.')
        ? loadModule(path.resolve(path.dirname(filename), `${id}.ts`))
        : require(id);
    new Function('require', 'module', 'exports', 'Date', code)(localRequire, module, module.exports, FixedDate);
    return module.exports;
}
const { parseNaturalDateTime, autoDetectDateTimeFromTitle } = loadModule(path.join(root, 'src/utils/dateUtils.ts'));

for (const text of [
    '农历10月20', '农历10月20日', '农历10月20号',
    '农历 10月 20', '农历十月二十', '农历十月20',
    '2026年农历10月20', '农历2026年10月20日',
    '提醒我农历10月20 生日',
]) {
    test(`${text}：转换为公历 2026-11-28`, () => {
        const result = parseNaturalDateTime(text);
        assert.equal(result.date, '2026-11-28');
        assert.equal(result.hasDate, true);
        assert.equal(result.hasTime, false);
    });
}

test('显式农历年份参与转换', () => {
    assert.equal(parseNaturalDateTime('农历2025年10月20').date, '2025-12-09');
});

test('农历日期后带时刻时保留日期与时间', () => {
    const result = parseNaturalDateTime('农历10月20 14:30');
    assert.equal(result.date, '2026-11-28');
    assert.equal(result.time, '14:30');
    assert.equal(result.hasTime, true);
});

test('农历日期范围分别转换两个端点', () => {
    const result = parseNaturalDateTime('农历10月20到农历10月21');
    assert.equal(result.date, '2026-11-28');
    assert.equal(result.endDate, '2026-11-29');
});

test('截止日期和弹窗默认日期归属都使用农历转换结果', () => {
    assert.equal(parseNaturalDateTime('截止农历10月20').endDate, '2026-11-28');
    const deadline = autoDetectDateTimeFromTitle('农历10月20 生日');
    assert.equal(deadline.endDate, '2026-11-28');
    assert.equal(deadline.date, undefined);
    assert.equal(deadline.cleanTitle, '生日');
    const start = autoDetectDateTimeFromTitle('农历10月20 生日', 'none', 'start');
    assert.equal(start.date, '2026-11-28');
    assert.equal(start.cleanTitle, '农历10月20 生日');
});

for (const text of ['10月20', '10月20日', '2026年10月20日', '2026-10-20', '20261020']) {
    test(`${text}：普通公历格式仍识别为 2026-10-20`, () => {
        assert.equal(parseNaturalDateTime(text).date, '2026-10-20');
    });
}

test('不带农历标记的传统写法继续支持', () => {
    assert.equal(parseNaturalDateTime('正月初一').date, '2026-02-17');
    assert.equal(parseNaturalDateTime('八月廿一').date, '2026-10-01');
});
