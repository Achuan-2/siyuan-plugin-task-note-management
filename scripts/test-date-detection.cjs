const chrono = require('chrono-node');

/**
 * Mocking necessary functions from dateUtils.ts for standalone testing
 */
const chronoParser = chrono.zh.casual.clone();
chronoParser.option = {
    ...chronoParser.option,
    forwardDate: false
};

function isValidDate(year, month, day) {
    if (year < 1900 || year > 2100) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day;
}

function parseNaturalDateTime(text) {
    try {
        let processedText = text.trim();
        const rangeSeparators = [" - ", "-", "~", "至", "到", " to "];
        for (const sep of rangeSeparators) {
            if (processedText.includes(sep)) {
                if (sep === "-" && /^\d{4}-\d{2}-\d{2}$/.test(processedText)) continue;
                const parts = processedText.split(sep);
                if (parts.length >= 2) {
                    for (let i = 1; i < parts.length; i++) {
                        const left = parts.slice(0, i).join(sep);
                        const right = parts.slice(i).join(sep);
                        const startResult = parseNaturalDateTimeInner(left);
                        const endResult = parseNaturalDateTimeInner(right);
                        if ((startResult.date || startResult.time) && (endResult.date || endResult.time)) {
                            let endDate = endResult.date;
                            let hasEndDate = endResult.hasDate;
                            if (!endResult.hasDate && endResult.time && startResult.date) {
                                endDate = startResult.date;
                                hasEndDate = true;
                            }
                            return {
                                date: startResult.date,
                                time: startResult.time,
                                hasTime: startResult.hasTime,
                                hasDate: startResult.hasDate,
                                endDate: endDate,
                                endTime: endResult.time,
                                hasEndTime: endResult.hasTime || !!endResult.time,
                                hasEndDate: hasEndDate,
                            };
                        }
                    }
                }
            }
        }
        return parseNaturalDateTimeInner(processedText);
    } catch (error) {
        return {};
    }
}

function parseNaturalDateTimeInner(text) {
    const results = chronoParser.parse(text, new Date(), { forwardDate: false });
    if (results.length === 0) return {};
    const result = results[0];
    const parsedDate = result.start.date();
    const year = parsedDate.getFullYear();
    const month = (parsedDate.getMonth() + 1).toString().padStart(2, '0');
    const day = parsedDate.getDate().toString().padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    const hasDate = result.start.isCertain('year') || result.start.isCertain('month') || result.start.isCertain('day');
    const hasTime = result.start.isCertain('hour') && result.start.isCertain('minute');
    let time = undefined;
    if (hasTime) {
        const hours = parsedDate.getHours().toString().padStart(2, '0');
        const minutes = parsedDate.getMinutes().toString().padStart(2, '0');
        time = `${hours}:${minutes}`;
    }
    return { date, time, hasTime, hasDate };
}

function autoDetectDateTimeFromTitle(title) {
    const parseResult = parseNaturalDateTime(title);
    if (!parseResult.date) {
        return { cleanTitle: title };
    }
    let cleanTitle = title;
    const timeExpressions = [
        /今天|今日/gi,
        /明天|明日/gi,
        /后天/gi,
        /大后天/gi,
        /下?周[一二三四五六日天]/gi,
        /下?星期[一二三四五六日天]/gi,
        /早上|上午|中午|下午|晚上/gi,
        /\d{4}年\s*\d{1,2}月\s*\d{1,2}[日号]/gi,
        /\d{1,2}月\s*\d{1,2}[日号]/gi,
        /[\d一二三四五六七八九十]+\s*[点时]\s*\d{0,2}\s*分?半?/gi,
        /\d+\s*天[后以]后/gi,
        /\d+\s*小时[后以]后/gi,
        /\d{8}/gi,
        /\d{4}[年\-\/\.]\s*\d{1,2}[月日\-\/\.]\s*\d{1,2}[日号]?/gi,
        /\d{1,2}[月日]\s*\d{1,2}[日号]/gi,
        /\d{1,2}\s*:\s*\d{2}(?::\d{2})?/gi,
        /[点时]\s*\d{1,2}\s*分?/gi,
        /到|至|~|-/gi,
    ];
    timeExpressions.forEach(pattern => {
        cleanTitle = cleanTitle.replace(pattern, '').trim();
    });
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^[，。、,~至\- \s]+|[，。、,~至\- \s]+$/g, '');
    return { ...parseResult, cleanTitle };
}

// ================= TEST CASES =================

const testCases = [
    "明天六点到明天 6:50。十个俯卧撑 烧水、大号、洗澡。穿衣 冥想十分钟。",
    "明天6:50~明天7:40。资料分析复盘。画思维导图。回忆行册。各种类型题目答题顺序。",
    "明天8 点到 11 点。5 题一个周期的刷题训练。每 40 分钟，进行 5 分钟的 卡片复习 15 分钟的休息。休息内容是听歌、到处走，或者去拿个快递。",
    "明天11 点到 明天12:30。吃饭 加休息时间 看一集武林外传。",
    "明天12:30~下午1:30。在哔哩哔哩搜索综合应用写作",
    "明天下午 1 点半到 明天下午 5 点 五题一个周期的刷题训练，每 40 分钟进行 5 分钟的卡片复习，15 分钟的休息。休息内容是听歌。到处走走。或者去拿个快递。",
    "明天下午 5 点到 下午6:30。十个俯卧撑。吃饭 看一集武林外传。",
    "明天晚上 6:30 到 明天晚上7 点洗澡。带手机放歌 声音可以小一点，能听得清的那种就行。",
    "明天晚上7 点到 明天晚上8 点。准备习概和形势与政策 3 周的教案。",
    "明天晚上 8 点到明天晚上 8:30，搜 监利市人才引进。筛选岗位。",
    "明天晚上 8:30 到明天晚上 9 点，半小时政治理论的学习。100 张卡片，理想情况下。",
    "明天晚上 9 点到明天晚上 9:30，做今日总结并设置好明日计划。"
];

console.log(`Running tests (Current Date: ${new Date().toLocaleDateString()})\n`);

testCases.forEach((testCase, index) => {
    const result = autoDetectDateTimeFromTitle(testCase);
    console.log(`Test Case ${index + 1}:`);
    console.log(`Input: ${testCase}`);
    console.log(`Result: ${result.date} ${result.time || 'HH:mm'} -> ${result.endDate || result.date} ${result.endTime || 'HH:mm'}`);
    console.log(`Title: ${result.cleanTitle}`);
    console.log('-'.repeat(60));
});
