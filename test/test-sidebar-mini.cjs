const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
test('迷你习惯的七天范围包含今天，跨月和跨年也不会变成自然周', () => {
    const source = fs.readFileSync(path.join(root, 'src/components/panel/HabitPanel.ts'), 'utf8');
    const ast = ts.createSourceFile('HabitPanel.ts', source, ts.ScriptTarget.Latest, true);
    const panel = ast.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'HabitPanel');
    const method = panel.members.find(node => node.name?.getText(ast) === 'getMiniCheckInStartDate');
    const Fixture = new Function('getLogicalDateString', compile(
        `class Fixture { ${method.getText(ast)} }`
    ) + '; return Fixture;')(() => '2026-11-17');
    const fixture = new Fixture();
    for (const [today, first] of [
        ['2026-11-17', '2026-11-11'], ['2026-12-02', '2026-11-26'], ['2027-01-02', '2026-12-27'],
    ]) {
        const start = fixture.getMiniCheckInStartDate(today);
        const localDate = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
        assert.equal(localDate(start), first);
        start.setDate(start.getDate() + 6);
        assert.equal(localDate(start), today);
    }
    assert.equal(fixture.getMiniCheckInStartDate().getDate(), 11);
});
