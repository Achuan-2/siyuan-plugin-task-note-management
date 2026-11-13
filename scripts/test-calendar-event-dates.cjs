// Run with: pnpm exec node --test scripts/test-calendar-event-dates.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const compile = content => ts.transpileModule(content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const source = ts.createSourceFile('CalendarView.ts', fs.readFileSync(
    path.join(root, 'src/components/panel/CalendarView.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const methods = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'CalendarView')
    .members.filter(node => ['snapToMinutes', 'shouldKeepSingleDayEndDate',
        'updateEventTime', 'updateSingleInstance', 'updateRecurringEventSeries'].includes(node.name?.getText(source)))
    .map(node => node.getText(source)).join('\n');
const dateSource = ts.createSourceFile('dateUtils.ts', fs.readFileSync(
    path.join(root, 'src/utils/dateUtils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const dates = {};
new Function('exports', compile(dateSource.statements.filter(node =>
    ['formatDateString', 'getLocalDateString', 'getLocalTimeString', 'getLocalDateTime'].includes(node.name?.getText(dateSource)))
    .map(node => node.getText(dateSource)).join('\n')))(dates);
const repeatSource = ts.createSourceFile('repeatUtils.ts', fs.readFileSync(
    path.join(root, 'src/components/dataManager/repeatUtils.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const repeat = {};
new Function('exports', compile(repeatSource.statements.filter(node =>
    node.name?.getText(repeatSource) === 'parseReminderInstanceId').map(node => node.getText(repeatSource)).join('\n')))(repeat);

function fixture(route, props, { allDay = false, start, end, resize = false } = {}) {
    const data = { task: { id: 'task', title: '任务', ...structuredClone(props) } };
    if (route !== '普通任务') data.task.repeat = { type: 'daily', endDate: '2026-12-31' };
    const saves = [], instances = [], errors = [];
    const dependencies = {
        ...dates, ...repeat,
        getAllReminders: async () => data,
        saveReminders: async (_plugin, reminders) => saves.push(structuredClone(reminders)),
        window: { dispatchEvent: () => {} },
        CustomEvent: class {}, i18n: key => key, showMessage: () => {},
        console: { error: (...args) => errors.push(args) },
    };
    const CalendarView = new Function(...Object.keys(dependencies),
        compile(`class CalendarView { ${methods} }`) + '; return CalendarView;')(...Object.values(dependencies));
    const view = Object.assign(new CalendarView(), {
        plugin: {}, shouldResetNotification: () => false,
        saveInstanceModification: async modification => instances.push(structuredClone(modification)),
    });
    const oldStart = route === '普通任务' ? props.date : '2026-11-14';
    const extendedProps = { ...props, originalId: 'task' };
    const info = {
        event: { id: `task_${oldStart}`, title: '任务', allDay, extendedProps,
            start: new Date(start), end: end ? new Date(end) : null },
        oldEvent: { startStr: `${oldStart}T09:00:00`, allDay, extendedProps },
        revert: () => errors.push('reverted'),
    };
    const run = async () => {
        if (route === '普通任务') await view.updateEventTime('task', info, resize);
        else if (route === '重复任务单次实例') await view.updateSingleInstance(info, resize);
        else await view.updateRecurringEventSeries(info, resize);
        assert.deepEqual(errors, []);
        if (route === '重复任务单次实例') {
            assert.equal(instances.length, 1);
            assert.equal(instances[0].instanceDate, oldStart);
            return instances[0];
        }
        assert.equal(saves.length, 1);
        if (route === '普通任务') return saves[0].task;
        const created = Object.values(saves[0]).find(task => task.id !== 'task');
        assert.ok(created);
        assert.equal(created.repeat.endDate, '2026-12-31');
        return created;
    };
    return { run };
}

for (const route of ['普通任务', '重复任务单次实例', '重复任务后续系列']) {
    for (const [label, start, end] of [
        ['拖到另一天', '2026-11-16T09:00:00', '2026-11-16T10:00:00'],
        ['同日调整时间', '2026-11-13T14:00:00', '2026-11-13T15:00:00'],
    ]) {
        test(`${route}：同日时间段${label}保留显式结束日期和结束时间`, async () => {
            const saved = await fixture(route, {
                date: '2026-11-13', endDate: '2026-11-13', time: '09:00', endTime: '10:00',
            }, { start, end }).run();
            assert.equal(saved.date, start.slice(0, 10));
            assert.equal(saved.endDate, end.slice(0, 10));
            assert.equal(saved.time, start.slice(11, 16));
            assert.equal(saved.endTime, end.slice(11, 16));
        });
    }

    for (const end of ['2026-11-17T00:00:00', null]) {
        test(`${route}：全天单日任务拖动保留结束日期（end=${end}）`, async () => {
            const saved = await fixture(route, { date: '2026-11-13', endDate: '2026-11-13' }, {
                allDay: true, start: '2026-11-16T00:00:00', end,
            }).run();
            assert.equal(saved.date, '2026-11-16');
            assert.equal(saved.endDate, '2026-11-16');
            assert.equal(saved.time, undefined);
            assert.equal(saved.endTime, undefined);
        });
    }

    test(`${route}：跨日时间段拖动同步移动结束日期`, async () => {
        const saved = await fixture(route, {
            date: '2026-11-13', endDate: '2026-11-14', time: '23:00', endTime: '01:00',
        }, { start: '2026-11-16T23:00:00', end: '2026-11-17T01:00:00' }).run();
        assert.equal(saved.date, '2026-11-16');
        assert.equal(saved.endDate, '2026-11-17');
        assert.equal(saved.endTime, '01:00');
    });

    test(`${route}：没有显式结束日期的同日任务拖动不新增结束日期`, async () => {
        const saved = await fixture(route, { date: '2026-11-13', time: '09:00', endTime: '10:00' }, {
            start: '2026-11-16T09:00:00', end: '2026-11-16T10:00:00',
        }).run();
        assert.equal(saved.date, '2026-11-16');
        assert.equal(saved.endDate, undefined);
        assert.equal(saved.endTime, '10:00');
    });

    test(`${route}：跨日时间段拉伸到单日仍保存结束日期`, async () => {
        const saved = await fixture(route, {
            date: '2026-11-13', endDate: '2026-11-14', time: '09:00', endTime: '10:00',
        }, { resize: true, start: '2026-11-13T09:00:00', end: '2026-11-13T10:00:00' }).run();
        assert.equal(saved.endDate, '2026-11-13');
        assert.equal(saved.endTime, '10:00');
    });
}
