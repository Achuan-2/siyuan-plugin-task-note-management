const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const { auditConsoleMessages } = require('./lib/console-audit.cjs');

function loadI18n(language, logger = console) {
    const filename = path.join(__dirname, '../src/pluginInstance.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const module = { exports: {} };
    const localRequire = name => require(path.resolve(path.dirname(filename), name));
    const window = { siyuan: { config: { lang: language } } };
    new Function('require', 'module', 'exports', 'window', 'console', code)(localRequire, module, module.exports, window, logger);
    return module.exports;
}

test('实例初始化前使用思源语言的内置词典，兼容新旧语言标识', () => {
    for (const language of ['en', 'en_US', 'en-US']) {
        assert.equal(loadI18n(language).i18n('habitCheckedInState'), 'Checked in');
    }
    for (const language of ['zh_CN', 'zh-CN', 'zh-TW']) {
        assert.equal(loadI18n(language).i18n('habitCheckedInState'), '已打卡');
    }
});

test('缺失翻译的诊断日志固定为英文，保留键名且不递归调用翻译函数', () => {
    for (const language of ['zh_CN', 'en']) {
        const entries = [];
        const api = loadI18n(language, { warn: (...args) => entries.push(args) });
        assert.equal(api.i18n('missingTranslationForTest'), '');
        assert.deepEqual(entries, [['Translation not found:', 'missingTranslationForTest']]);
    }
});

test('日志检查覆盖模板、嵌入脚本和 i18n 调用，忽略注释及错误对象', () => {
    const audit = source => auditConsoleMessages(ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
    assert.deepEqual(audit('// console.error("中文注释");\nconsole.error("Save failed:", error);'), []);
    assert.ok(audit('console.warn(`加载 ${id} 失败`);').some(issue => issue.includes('Chinese text')));
    assert.ok(audit('console.error(i18n("saveFailed"), error);').some(issue => issue.includes('fixed English')));
    assert.ok(audit('const script = `console.error("加载失败", error);`;').some(issue => issue.includes('embedded script')));
    assert.ok(audit('const html = `<script>console.error("加载失败", error);</script>`;').some(issue => issue.includes('embedded script')));
    assert.deepEqual(audit('const script = `// console.error("中文注释");\nconsole.error("Load failed:", error);`;'), []);
    assert.ok(audit('const script = `console.error(${JSON.stringify(i18n("copyFailed"))}, error);`;').some(issue => issue.includes('fixed English')));
    assert.ok(audit('const script = `console.error(\'Prefix: ${i18n("copyFailed")}\', error);`;').some(issue => issue.includes('fixed English')));
    assert.ok(audit('const script = `console.error(${JSON.stringify("加载失败")}, error);`;').some(issue => issue.includes('Chinese text')));
    assert.deepEqual(audit('const html = `<button>${i18n("confirm")}</button><script>console.error("Load failed:", error);</script>`;'), []);
    assert.deepEqual(audit('const script = `// console.error(${i18n("copyFailed")});\nconsole.error("Load failed:", error);`;'), []);
});

test('宿主词典优先，缺失或空值按当前语言补齐，卸载后仍可翻译', () => {
    const api = loadI18n('en');
    api.setPluginInstance({ i18n: { habitCheckedInState: 'Host translation', habitNotCheckedInState: '' } });
    assert.equal(api.i18n('habitCheckedInState'), 'Host translation');
    assert.equal(api.i18n('habitNotCheckedInState'), 'Not checked in');
    assert.equal(api.i18n('noHabitStatsData'), 'No habit data');
    api.setPluginInstance(null);
    assert.equal(api.i18n('habitCheckedInState'), 'Checked in');
});

test('插值保留用户输入的美元字符与模板字符，不发生二次替换', () => {
    const api = loadI18n('en');
    const title = "$& $' $` $$ ${parentTitle}";
    const result = api.i18n('taskSetAsSubtask', { childTitle: title, parentTitle: 'Parent' });
    assert.equal(result, `"${title}" has been set as a subtask of "Parent"`);
    assert.equal(api.i18n('taskSetAsSubtask', { childTitle: 'Child' }), '"Child" has been set as a subtask of "${parentTitle}"');
});

test('数量、日期和番茄钟进度提示完整替换参数', () => {
    const api = loadI18n('en');
    assert.equal(api.i18n('taskListPagination', { page: '2', pages: '5', count: '45' }), 'Page 2 / 5 (45 items)');
    assert.equal(api.i18n('repeatEveryNWeeksDays', { interval: '2', days: 'Monday, Friday' }), 'Every 2 weeks on Monday, Friday');
    assert.equal(api.i18n('switchedTaskPreservingProgress', { phase: 'focus' }), 'Task switched; focus progress preserved');
});

function loadRepeatDescription(language) {
    const filename = path.join(__dirname, '../src/components/dataManager/repeatUtils.ts');
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    const api = loadI18n(language);
    const localRequire = name => {
        if (name.endsWith('pluginInstance')) return api;
        if (name.endsWith('dateUtils')) return { getLocaleTag: () => language.replace('_', '-') };
        if (name.endsWith('lunarUtils')) return {
            formatLunarDay: () => '十五', formatLunarMonth: () => '正月',
        };
        return {};
    };
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports.getRepeatDescription;
}

test('真实重复描述函数按语言生成完整句子，保留原有重复配置', () => {
    const config = { enabled: true, type: 'weekly', interval: 2, weekDays: [1, 5] };
    const original = structuredClone(config);
    const english = loadRepeatDescription('en');
    const chinese = loadRepeatDescription('zh_CN');
    assert.equal(english(config), 'Every 2 weeks on Monday, Friday');
    assert.equal(chinese(config), '每2周的周一、周五');
    assert.deepEqual(config, original);
    assert.equal(english({ enabled: true, type: 'monthly', interval: 2, monthDays: [1, 15] }), 'Every 2 months on day(s) 1, 15');
});

test('按星期及农历的重复描述在英文界面不残留中文', () => {
    const describe = loadRepeatDescription('en');
    const configs = [
        { enabled: true, type: 'monthly', monthlyRepeatMode: 'weekday', monthlyWeekRules: [{ order: 1, weekday: 1 }] },
        { enabled: true, type: 'lunar-monthly', lunarDay: 15 },
        { enabled: true, type: 'lunar-yearly', lunarMonth: 1, lunarDay: 15 },
    ];
    for (const config of configs) {
        const text = describe(config);
        assert.ok(text.length > 0);
        assert.equal(/[\u4e00-\u9fff]|\$\{/.test(text), false, text);
    }
    assert.equal(describe(configs[0]), 'Every month on First Monday');
});

// 执行源码中的真实函数或方法；只替换网络、思源窗口和存储依赖。
function loadDeclarations(relative, names, dependencies, methods = false) {
    const filename = path.join(__dirname, '..', relative);
    const source = fs.readFileSync(filename, 'utf8');
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
    const declarations = new Map();
    function visit(node) {
        const matches = methods ? ts.isMethodDeclaration(node) : ts.isFunctionDeclaration(node);
        if (matches && node.name && names.includes(node.name.getText(ast))) {
            declarations.set(node.name.getText(ast), node.getText(ast));
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const name of names) assert.ok(declarations.has(name), `Missing declaration: ${name}`);
    const body = names.map(name => declarations.get(name)).join('\n');
    const code = ts.transpileModule(methods ? `export class Fixture { ${body} }` : body, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    const result = methods ? 'module.exports' : `{ ${names.join(', ')} }`;
    return new Function('module', 'exports', ...Object.keys(dependencies), `${code}\nreturn ${result};`)(module, module.exports, ...Object.values(dependencies));
}

test('节假日 ICS 的中文补班及英文假日分类不随界面语言改变', async () => {
    const events = [
        { date: '2026-10-10', title: '国庆节补班' },
        { date: '2026-10-11', title: '国庆节休息' },
        { date: '2026-12-25', title: 'Winter holiday' },
        { date: '2026-12-26', title: 'Workday' },
        { date: '2026-12-27', title: 'Unknown event' },
    ];
    for (const language of ['zh_CN', 'en']) {
        let saved;
        const { syncHolidays } = loadDeclarations('src/utils/icsSubscription.ts', ['syncHolidays'], {
            fetchIcsContent: async () => '', parseIcsFile: async () => events, i18n: loadI18n(language).i18n,
        });
        assert.equal(await syncHolidays({ saveHolidayData: async data => { saved = data; } }, 'fixture'), true);
        assert.deepEqual(Object.values(saved).map(event => event.type), ['workday', 'holiday', 'holiday', 'workday', 'holiday']);
        assert.equal(saved['2026-10-10'].title, '国庆节补班');
    }
});

function loadHabitDayDialog(language) {
    const filename = path.join(__dirname, '../src/components/dialog/HabitDayDialog.ts');
    const habitUtilsFilename = path.join(__dirname, '../src/utils/habitUtils.ts');
    function transpile(file) {
        return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
        }).outputText;
    }
    const habitUtilsModule = { exports: {} };
    new Function('module', 'exports', transpile(habitUtilsFilename))(habitUtilsModule, habitUtilsModule.exports);
    const module = { exports: {} };
    const localRequire = name => {
        if (name.endsWith('habitUtils')) return habitUtilsModule.exports;
        if (name.endsWith('pluginInstance')) return loadI18n(language);
        if (name.endsWith('dateUtils')) return { getLocalDateTimeString: () => '2026-10-10T12:00:00' };
        if (name.endsWith('habitMemoBlockSync')) return { syncHabitMemoBlock: async () => {} };
        return {};
    };
    new Function('require', 'module', 'exports', transpile(filename))(localRequire, module, module.exports);
    return { HabitDayDialog: module.exports.HabitDayDialog, constants: habitUtilsModule.exports };
}

test('补录番茄的自动打卡保留固定来源标识，能识别并回收且不修改自定义表情含义', async () => {
    for (const language of ['en', 'zh_CN']) {
        const { HabitDayDialog, constants } = loadHabitDayDialog(language);
        const { Fixture } = loadDeclarations('src/index.ts', ['isPomodoroTargetAutoCheckInEntry', 'removePomodoroTargetAutoCheckInFromDate'], constants, true);
        const recognition = new Fixture();
        for (const configured of [false, true]) {
            const habit = {
                id: 'habit', autoCheckInAfterPomodoro: true, autoCheckInEmoji: '✅',
                checkInEmojis: configured ? [{ emoji: '✅', meaning: 'Custom meaning', countsAsSuccess: true }] : [],
                checkIns: {}, totalCheckIns: 0,
            };
            const dialog = Object.create(HabitDayDialog.prototype);
            dialog.habit = habit;
            let saves = 0;
            dialog.onSave = async () => { saves++; };
            assert.equal(await dialog.applyAutoCheckInFromPomodoro('2026-10-10', 1), true);
            assert.equal(saves, 1);
            const entry = habit.checkIns['2026-10-10'].entries[0];
            assert.equal(entry.meaning, constants.POMODORO_PER_SESSION_AUTO_CHECKIN_MEANING);
            assert.equal(recognition.isPomodoroTargetAutoCheckInEntry(entry, '✅'), true);
            assert.equal(recognition.isPomodoroTargetAutoCheckInEntry(entry, '❌'), false);
            if (configured) assert.equal(habit.checkInEmojis[0].meaning, 'Custom meaning');
            assert.equal(recognition.removePomodoroTargetAutoCheckInFromDate(habit, '2026-10-10', '✅', '2026-10-10T13:00:00'), true);
            assert.equal(habit.totalCheckIns, 0);
            assert.equal(habit.checkIns['2026-10-10'], undefined);
        }
    }
});

test('局域网 S3 代理错误使用完整双语句子，英文没有中文标点且保留地址', async () => {
    const endpoint = 'http://192.168.1.2:9000';
    for (const language of ['en', 'zh_CN']) {
        const { uploadToS3ByForwardProxy } = loadDeclarations('src/utils/icsExport.ts', ['uploadToS3ByForwardProxy'], {
            isPrivateEndpoint: () => true, i18n: loadI18n(language).i18n,
        });
        await assert.rejects(uploadToS3ByForwardProxy({}, 'bucket', 'key', '', endpoint), error => {
            assert.ok(error.message.includes(endpoint));
            assert.equal(/\$\{/.test(error.message), false);
            if (language === 'en') {
                assert.equal(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(error.message), false);
                assert.ok(error.message.includes(`(${endpoint}).`));
            } else {
                assert.ok(error.message.includes(`（${endpoint}）。`));
            }
            return true;
        });
    }
});
