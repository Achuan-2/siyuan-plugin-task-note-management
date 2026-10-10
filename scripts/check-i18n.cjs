const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const svelte = require('svelte/compiler');
const { auditConsoleMessages } = require('./lib/console-audit.cjs');

const root = path.resolve(__dirname, '..');
const chinese = JSON.parse(fs.readFileSync(path.join(root, 'i18n/zh_CN.json'), 'utf8'));
const english = JSON.parse(fs.readFileSync(path.join(root, 'i18n/en.json'), 'utf8'));
const issues = [];
const placeholders = value => [...new Set([...value.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1]))].sort();

for (const key of new Set([...Object.keys(chinese), ...Object.keys(english)])) {
    for (const [language, dictionary] of [['zh_CN', chinese], ['en', english]]) {
        if (typeof dictionary[key] !== 'string' || !dictionary[key].trim()) issues.push(`${language}: missing or empty translation: ${key}`);
    }
    if (typeof chinese[key] === 'string' && typeof english[key] === 'string') {
        if (JSON.stringify(placeholders(chinese[key])) !== JSON.stringify(placeholders(english[key]))) {
            issues.push(`Placeholder mismatch: ${key}`);
        }
        if (/[\u4e00-\u9fff]/.test(english[key])) issues.push(`Chinese text in English translation: ${key}`);
    }
}

function checkKey(key, filename) {
    if (!(key in chinese) || !(key in english)) issues.push(`${filename}: undefined i18n key: ${key}`);
}

function checkTypeScript(source, filename) {
    const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    issues.push(...auditConsoleMessages(ast, filename));
    for (const diagnostic of ast.parseDiagnostics) issues.push(`${filename}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    function visit(node) {
        if (ts.isCallExpression(node) && /(?:^|\.)i18n$|^this\.(?:tr|translate)$/.test(node.expression.getText(ast))) {
            function checkArgument(argument) {
                if (!argument) return;
                if (ts.isStringLiteral(argument)) checkKey(argument.text, filename);
                else if (ts.isConditionalExpression(argument)) {
                    checkArgument(argument.whenTrue);
                    checkArgument(argument.whenFalse);
                }
            }
            checkArgument(node.arguments[0]);
        }
        if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'i18n') {
            checkKey(node.name.text, filename);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
}

async function checkSvelte(source, filename) {
    // 只检查界面与脚本；SCSS 由 Vite 构建验证。
    const processed = await svelte.preprocess(source, {
        script: ({ content }) => {
            checkTypeScript(content, filename);
            return { code: ts.transpileModule(content, {
                compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
            }).outputText };
        },
        style: () => ({ code: '' }),
    }, { filename });
    const ast = svelte.parse(processed.code);
    function visit(node) {
        if (node.type === 'Text' && /[\u4e00-\u9fff]/.test(node.data)) {
            issues.push(`${filename}: hard-coded UI text: ${node.data.trim()}`);
        }
        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'i18n') {
            const argument = node.arguments[0];
            if (argument?.type === 'Literal' && typeof argument.value === 'string') checkKey(argument.value, filename);
            if (argument?.type === 'ConditionalExpression') {
                for (const branch of [argument.consequent, argument.alternate]) {
                    if (branch.type === 'Literal' && typeof branch.value === 'string') checkKey(branch.value, filename);
                }
            }
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(child => child && typeof child === 'object' && visit(child));
            else if (value && typeof value === 'object') visit(value);
        }
    }
    visit(ast.html);
}

async function checkDirectory(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await checkDirectory(filename);
        else if (/\.(ts|svelte)$/.test(filename)) {
            const source = fs.readFileSync(filename, 'utf8');
            const relative = path.relative(root, filename);
            try {
                if (filename.endsWith('.svelte')) await checkSvelte(source, relative);
                else checkTypeScript(source, relative);
            } catch (error) {
                issues.push(`${relative}: ${error.message}`);
            }
        }
    }
}

checkDirectory(path.join(root, 'src')).then(() => {
    if (issues.length) {
        console.error([...new Set(issues)].join('\n'));
        process.exitCode = 1;
    } else {
        console.log(`i18n check passed: ${Object.keys(chinese).length} bilingual keys; references, placeholders, Svelte UI text and English-only console messages verified.`);
    }
});
