// Run with: node --test scripts/test-habit-panel-archive.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const filename = 'src/components/panel/HabitPanel.ts';
const source = ts.createSourceFile(filename,
    fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), ts.ScriptTarget.Latest, true);
const members = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'HabitPanel').members;
const methods = members.filter(node => ['setHabitArchived', 'showHabitContextMenu'].includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const code = ts.transpileModule(`class Panel { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(checkIn, endDate) {
    const original = {
        id: 'habit', title: '习惯', startDate: '2026-01-01', endDate,
        target: 5, updatedAt: 'old', checkIns: {
            '2026-10-31': { count: 2, status: ['✅'] },
            ...(checkIn ? { '2026-11-01': checkIn } : {})
        }
    };
    const saves = [];
    const items = [];
    const errors = [];
    class Menu {
        addItem(item) { items.push(item); }
        addSeparator() {}
        open() {}
    }
    const Panel = new Function('getLogicalDateString', 'getRelativeDateString', 'getLocalDateTimeString',
        'Menu', 'i18n', 'showMessage', `${code}; return Panel;`)(
        () => '2026-11-01', offset => {
            assert.equal(offset, -1);
            return '2026-10-31';
        }, () => '2026-11-01 12:00:00', Menu, key => key, (...args) => errors.push(args)
    );
    const panel = Object.assign(new Panel(), {
        plugin: { loadHabitData: async () => ({ habit: original }) },
        saveHabit: async (habit, previous) => saves.push({ habit, previous }),
        createCheckInSubmenu: () => [], createPomodoroStartSubmenu: () => []
    });
    return { panel, original, saves, items, errors };
}

test('未打卡或空记录归档到昨天，保留历史记录与原始对象', async () => {
    for (const checkIn of [undefined, {}, { count: 0, entries: [], status: [] }]) {
        const { panel, original, saves } = fixture(checkIn, '2027-01-01');
        await panel.setHabitArchived('habit', true);
        assert.equal(saves[0].habit.endDate, '2026-10-31');
        assert.equal(saves[0].habit.updatedAt, '2026-11-01 12:00:00');
        assert.deepEqual(saves[0].habit.checkIns, original.checkIns);
        assert.equal(saves[0].previous, original);
        assert.equal(original.endDate, '2027-01-01');
    }
});

test('任意打卡即归档到今天，兼容新旧记录且不要求达标', async () => {
    for (const checkIn of [{ count: 1 }, { entries: [{ emoji: '❌' }] }, { status: ['✅'] }]) {
        const { panel, saves } = fixture(checkIn);
        await panel.setHabitArchived('habit', true);
        assert.equal(saves[0].habit.endDate, '2026-11-01');
    }
});

test('右键菜单对今天或更早结束的习惯提供取消归档并清空结束日期', async () => {
    for (const endDate of ['2026-10-31', '2026-11-01', '2027-01-01', undefined]) {
        const { panel, original, saves, items } = fixture({ count: 1 }, endDate);
        panel.showHabitContextMenu({ clientX: 0, clientY: 0 }, original);
        const canUnarchive = !!endDate && endDate <= '2026-11-01';
        const action = items.find(item => item.label === (canUnarchive ? 'unarchiveHabitMenuItem' : 'archiveHabitMenuItem'));
        assert.ok(action);
        await action.click();
        assert.equal(saves[0].habit.endDate, canUnarchive ? undefined : '2026-11-01');
        if (canUnarchive) assert.equal(Object.hasOwn(saves[0].habit, 'endDate'), false);
    }
});

test('习惯被删除时不恢复数据，保存失败时提示且不修改原数据', async () => {
    const { panel, original, saves, errors } = fixture();
    panel.plugin.loadHabitData = async () => ({});
    await panel.setHabitArchived('habit', true);
    assert.equal(saves.length, 0);
    panel.plugin.loadHabitData = async () => ({ habit: original });
    panel.saveHabit = async () => { throw new Error('storage unavailable'); };
    await panel.setHabitArchived('habit', true);
    assert.equal(original.endDate, undefined);
    assert.deepEqual(errors, [['saveFailed', 3000, 'error']]);
});
