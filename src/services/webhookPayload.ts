export const WEBHOOK_SOURCE = 'siyuan-plugin-task-note-management';

export const WEBHOOK_JSON_TYPES = ['feishu', 'wecom', 'custom'] as const;

export type ReminderWebhookJsonType = (typeof WEBHOOK_JSON_TYPES)[number];

export const WEBHOOK_JSON_TEMPLATES: Record<Exclude<ReminderWebhookJsonType, 'custom'>, string> = {
    feishu: '{\n    "msg_type": "text",\n    "content": {\n        "text": "${title}\\n${message}"\n    }\n}',
    wecom: '{\n    "msgtype": "text",\n    "text": {\n        "content": "${title}\\n${message}"\n    }\n}',
};

export const DEFAULT_WEBHOOK_JSON_TYPE: ReminderWebhookJsonType = 'feishu';

function isReminderWebhookJsonType(value: unknown): value is ReminderWebhookJsonType {
    return typeof value === 'string' && WEBHOOK_JSON_TYPES.includes(value as ReminderWebhookJsonType);
}

export function normalizeReminderWebhookJsonType(value: unknown): ReminderWebhookJsonType {
    return isReminderWebhookJsonType(value) ? value : DEFAULT_WEBHOOK_JSON_TYPE;
}

function normalizeWebhookTemplateText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim();
}

export function inferReminderWebhookJsonType(jsonTemplate: string): ReminderWebhookJsonType {
    const normalizedTemplate = normalizeWebhookTemplateText(jsonTemplate);
    if (!normalizedTemplate || normalizedTemplate === normalizeWebhookTemplateText(WEBHOOK_JSON_TEMPLATES.feishu)) {
        return 'feishu';
    }
    // 兼容没有保存 JSON 类型、仍使用旧版企业微信预设的设置。
    const legacyWecomTemplate = WEBHOOK_JSON_TEMPLATES.wecom.replace('"msgtype"', '"msgType"');
    if (normalizedTemplate === normalizeWebhookTemplateText(WEBHOOK_JSON_TEMPLATES.wecom)
        || normalizedTemplate === normalizeWebhookTemplateText(legacyWecomTemplate)) {
        return 'wecom';
    }
    return 'custom';
}

function resolveReminderWebhookJsonTemplate(jsonType: unknown, customTemplate: unknown): string {
    const normalizedType = normalizeReminderWebhookJsonType(jsonType);
    if (normalizedType !== 'custom') {
        return WEBHOOK_JSON_TEMPLATES[normalizedType];
    }
    return typeof customTemplate === 'string' && customTemplate.trim()
        ? customTemplate
        : WEBHOOK_JSON_TEMPLATES.feishu;
}

export function assertWebhookResponse(body: string): void {
    let result: unknown;
    try {
        result = JSON.parse(body);
    } catch {
        // 自定义 Webhook 可能返回空响应或纯文本，仍以 HTTP 状态判断成功。
        return;
    }

    if (!result || typeof result !== 'object' || !('errcode' in result)) return;
    const { errcode, errmsg } = result as { errcode: unknown; errmsg?: unknown };
    if ((typeof errcode === 'number' || typeof errcode === 'string') && Number(errcode) !== 0) {
        const detail = typeof errmsg === 'string' && errmsg ? `: ${errmsg}` : '';
        throw new Error(`Webhook errcode ${errcode}${detail}`);
    }
}

export function buildWebhookReminderInfo(reminderInfo: any): any | undefined {
    if (!reminderInfo || typeof reminderInfo !== 'object') return undefined;

    const keys = [
        'id',
        'blockId',
        'title',
        'note',
        'priority',
        'categoryId',
        'categoryName',
        'categoryColor',
        'categoryIcon',
        'time',
        'date',
        'endDate',
        'isAllDay',
        'isOverdue',
        'isRepeatInstance',
        'originalId',
    ];
    const result: any = {};
    keys.forEach((key) => {
        const value = reminderInfo[key];
        if (value !== undefined && value !== null && value !== '') {
            result[key] = value;
        }
    });

    return Object.keys(result).length > 0 ? result : undefined;
}

function replaceWebhookTemplateVariables(value: any, variables: Record<string, string>): any {
    if (typeof value === 'string') {
        return value.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : match
        );
    }

    if (Array.isArray(value)) {
        return value.map((item) => replaceWebhookTemplateVariables(item, variables));
    }

    if (value && typeof value === 'object') {
        const result: any = {};
        Object.entries(value).forEach(([key, item]) => {
            result[key] = replaceWebhookTemplateVariables(item, variables);
        });
        return result;
    }

    return value;
}

function renderWebhookTemplateAsJsonText(template: string, variables: Record<string, string>): string {
    return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (match, name) => {
        if (!Object.prototype.hasOwnProperty.call(variables, name)) return match;
        return JSON.stringify(variables[name]);
    });
}

function buildDefaultWebhookPayload(
    title: string,
    message: string,
    event: string,
    sentAt: string,
    options: { reminderInfo?: any; reminders?: any[] } = {}
): any {
    const payload: any = {
        source: WEBHOOK_SOURCE,
        event,
        title,
        message,
        sentAt,
    };

    const reminder = buildWebhookReminderInfo(options.reminderInfo);
    if (reminder) {
        payload.reminder = reminder;
    }

    if (Array.isArray(options.reminders)) {
        payload.reminders = options.reminders
            .map((item) => buildWebhookReminderInfo(item))
            .filter(Boolean);
        payload.count = payload.reminders.length;
    }

    return payload;
}

export function buildWebhookPayload(
    title: string,
    message: string,
    event: string,
    sentAt: string,
    jsonTemplate: string,
    jsonType: string = 'custom',
    options: { reminderInfo?: any; reminders?: any[] } = {}
): any | null {
    const template = resolveReminderWebhookJsonTemplate(jsonType, jsonTemplate).trim();
    if (!template) {
        return buildDefaultWebhookPayload(title, message, event, sentAt, options);
    }

    const defaultPayload = buildDefaultWebhookPayload(title, message, event, sentAt, options);
    const variables: Record<string, string> = {
        source: WEBHOOK_SOURCE,
        event,
        title,
        message,
        sentAt,
        count: String(defaultPayload.count ?? ''),
    };

    try {
        const parsed = JSON.parse(template);
        return replaceWebhookTemplateVariables(parsed, variables);
    } catch (parseError) {
        try {
            return JSON.parse(renderWebhookTemplateAsJsonText(template, variables));
        } catch (renderError) {
            console.warn("Invalid Webhook JSON template format:", renderError || parseError);
            return null;
        }
    }
}
