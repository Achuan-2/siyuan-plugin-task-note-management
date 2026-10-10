const ts = require('typescript');

const consoleMethod = /^console\.(?:error|warn|log|info|debug)$/;
const translationMethod = /(?:^|\.)i18n$|^this\.(?:tr|translate)$/;
const chineseText = /[\u4e00-\u9fff]/;

/** 日志固定使用英文；只检查代码中的文案，不检查注释或运行时数据。 */
function auditConsoleMessages(ast, filename = ast.fileName, embedded = false, injectedExpressions = new Map()) {
    const issues = [];
    function inspectArgument(node, sourceAst = ast) {
        // 嵌入脚本中的占位符保留其外层表达式，避免 JSON.stringify(i18n(...)) 被漏掉。
        if (ts.isIdentifier(node) && injectedExpressions.has(node.text)) {
            const injected = injectedExpressions.get(node.text);
            inspectArgument(injected.expression, injected.ast);
            return;
        }
        if (ts.isCallExpression(node) && translationMethod.test(node.expression.getText(sourceAst))) {
            issues.push(`${filename}: console messages must use fixed English text, not i18n`);
            return;
        }
        if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'i18n') {
            issues.push(`${filename}: console messages must use fixed English text, not i18n`);
            return;
        }
        if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && chineseText.test(node.text)) {
            issues.push(`${filename}: Chinese text in console message: ${node.text}`);
        }
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            // 也覆盖注入到脚本字符串内部的参数，如 console.error('Prefix: ${...}')。
            for (const [token, injected] of injectedExpressions) {
                if (node.text.includes(token)) inspectArgument(injected.expression, injected.ast);
            }
        }
        ts.forEachChild(node, child => inspectArgument(child, sourceAst));
    }
    function visit(node) {
        if (ts.isCallExpression(node) && consoleMethod.test(node.expression.getText(ast))) node.arguments.forEach(argument => inspectArgument(argument));
        // 番茄钟的独立窗口和 executeJavaScript 中也包含日志。
        if (!embedded && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
            const injections = new Map();
            const content = ts.isTemplateExpression(node)
                ? node.head.text + node.templateSpans.map((span, index) => {
                    const token = `__console_injected_${index}__`;
                    injections.set(token, { expression: span.expression, ast });
                    return token + span.literal.text;
                }).join('')
                : node.text;
            if (/\bconsole\.(?:error|warn|log|info|debug)\s*\(/.test(content)) {
                const scripts = [...content.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
                for (const script of scripts.length ? scripts.map(match => match[1]) : [content]) {
                    const scriptAst = ts.createSourceFile('embedded.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
                    issues.push(...auditConsoleMessages(scriptAst, `${filename} (embedded script)`, true, injections));
                }
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return [...new Set(issues)];
}

module.exports = { auditConsoleMessages };
