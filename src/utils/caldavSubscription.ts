import { parseIcsFile, ParsedIcsEvent } from './icsImport';
import type { IcsSubscription } from './icsSubscription';

export interface CalDavRemoteEvent {
    event: ParsedIcsEvent;
    href: string;
    etag?: string;
    rawIcs: string;
}

interface CalDavRequestOptions {
    method: string;
    url?: string;
    body?: string;
    headers?: Record<string, string>;
}

function getCalendarUrl(subscription: IcsSubscription): string {
    const url = (subscription.url || '').trim();
    if (!url) {
        throw new Error('CalDAV 日历地址不能为空');
    }
    return url.endsWith('/') ? url : `${url}/`;
}

function getAuthHeader(subscription: IcsSubscription): Record<string, string> {
    if (!subscription.username && !subscription.password) return {};
    const credentials = `${subscription.username || ''}:${subscription.password || ''}`;
    return {
        Authorization: `Basic ${btoa(unescape(encodeURIComponent(credentials)))}`
    };
}

async function calDavRequest(
    subscription: IcsSubscription,
    options: CalDavRequestOptions
): Promise<Response> {
    const response = await fetch(options.url || getCalendarUrl(subscription), {
        method: options.method,
        headers: {
            ...getAuthHeader(subscription),
            ...(options.headers || {})
        },
        body: options.body
    });

    if (!response.ok && response.status !== 207) {
        const text = await response.text().catch(() => '');
        const error = new Error(
            `CalDAV ${options.method} 失败: HTTP ${response.status} ${response.statusText}${
                text ? ` - ${text.slice(0, 300)}` : ''
            }`
        );
        (error as any).status = response.status;
        throw error;
    }

    return response;
}

function formatIfMatchEtag(etag: string): string {
    if (!etag) return '';
    let formatted = etag.trim();
    if (formatted.startsWith('W/')) {
        formatted = formatted.substring(2);
    }
    if (!formatted.startsWith('"')) {
        formatted = `"${formatted}`;
    }
    if (!formatted.endsWith('"')) {
        formatted = `${formatted}"`;
    }
    return formatted;
}

function getElementsByLocalName(parent: ParentNode, localName: string): Element[] {
    return Array.from(parent.querySelectorAll('*')).filter(
        node => node.localName.toLowerCase() === localName.toLowerCase()
    ) as Element[];
}

function getFirstTextByLocalName(parent: ParentNode, localName: string): string {
    const element = getElementsByLocalName(parent, localName)[0];
    return element?.textContent || '';
}

function toAbsoluteHref(calendarUrl: string, href: string): string {
    try {
        return new URL(href, calendarUrl).toString();
    } catch (_error) {
        return href;
    }
}

async function discoverPrincipal(subscription: IcsSubscription, baseUrl: string): Promise<string | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:current-user-principal />
  </d:prop>
</d:propfind>`;

    try {
        const response = await calDavRequest(subscription, {
            method: 'PROPFIND',
            url: baseUrl,
            body,
            headers: {
                Depth: '0',
                'Content-Type': 'application/xml; charset=utf-8'
            }
        });

        const xml = await response.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        
        const principalElement = getElementsByLocalName(doc, 'current-user-principal')[0];
        if (principalElement) {
            const href = getFirstTextByLocalName(principalElement, 'href');
            if (href) {
                return toAbsoluteHref(baseUrl, href);
            }
        }
    } catch (e) {
        console.warn('discoverPrincipal failed:', e);
    }
    return null;
}

async function discoverCalendarHomeSet(subscription: IcsSubscription, principalUrl: string): Promise<string | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-home-set />
  </d:prop>
</d:propfind>`;

    try {
        const response = await calDavRequest(subscription, {
            method: 'PROPFIND',
            url: principalUrl,
            body,
            headers: {
                Depth: '0',
                'Content-Type': 'application/xml; charset=utf-8'
            }
        });

        const xml = await response.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        
        const homeSetElement = getElementsByLocalName(doc, 'calendar-home-set')[0];
        if (homeSetElement) {
            const href = getFirstTextByLocalName(homeSetElement, 'href');
            if (href) {
                return toAbsoluteHref(principalUrl, href);
            }
        }
    } catch (e) {
        console.warn('discoverCalendarHomeSet failed:', e);
    }
    return null;
}

async function discoverFirstCalendarCollection(subscription: IcsSubscription, homeSetUrl: string): Promise<string | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype />
    <d:displayname />
  </d:prop>
</d:propfind>`;

    try {
        const response = await calDavRequest(subscription, {
            method: 'PROPFIND',
            url: homeSetUrl,
            body,
            headers: {
                Depth: '1',
                'Content-Type': 'application/xml; charset=utf-8'
            }
        });

        const xml = await response.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        
        const responseElements = getElementsByLocalName(doc, 'response');
        for (const resp of responseElements) {
            const resourceType = getElementsByLocalName(resp, 'resourcetype')[0];
            if (resourceType) {
                const calendar = getElementsByLocalName(resourceType, 'calendar')[0];
                if (calendar) {
                    const href = getFirstTextByLocalName(resp, 'href');
                    if (href) {
                        return toAbsoluteHref(homeSetUrl, href);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('discoverFirstCalendarCollection failed:', e);
    }
    return null;
}

async function discoverCalendarFromPath(subscription: IcsSubscription, pathUrl: string): Promise<string | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype />
    <d:displayname />
  </d:prop>
</d:propfind>`;

    try {
        const response = await calDavRequest(subscription, {
            method: 'PROPFIND',
            url: pathUrl,
            body,
            headers: {
                Depth: '1',
                'Content-Type': 'application/xml; charset=utf-8'
            }
        });

        const xml = await response.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        
        const responseElements = getElementsByLocalName(doc, 'response');
        for (const resp of responseElements) {
            const resourceType = getElementsByLocalName(resp, 'resourcetype')[0];
            if (resourceType) {
                const calendar = getElementsByLocalName(resourceType, 'calendar')[0];
                if (calendar) {
                    const href = getFirstTextByLocalName(resp, 'href');
                    if (href) {
                        return toAbsoluteHref(pathUrl, href);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('discoverCalendarFromPath failed:', e);
    }
    return null;
}

async function getOrDiscoverCalendarUrl(subscription: IcsSubscription): Promise<string> {
    let url = (subscription.url || '').trim();
    if (!url) {
        throw new Error('CalDAV 日历地址不能为空');
    }

    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const isRoot = pathname === '' || pathname === '/';

        if (isRoot) {
            // Feishu specific quick discovery
            if (urlObj.hostname === 'caldav.feishu.cn') {
                const discovered = await discoverCalendarFromPath(subscription, 'https://caldav.feishu.cn/calendars/');
                if (discovered) return discovered;
            }

            // Probe endpoints in priority order
            const probeUrls = [
                // For DingTalk specifically, start at /dav/principals/
                ...(urlObj.hostname === 'calendar.dingtalk.com' ? ['https://calendar.dingtalk.com/dav/principals/'] : []),
                // For WeCom, start at /calendar/ (resolved from .well-known redirect)
                ...(urlObj.hostname === 'caldav.wecom.work' ? ['https://caldav.wecom.work/calendar/'] : []),
                // Standard /.well-known/ path
                `${url}/.well-known/caldav`,
                // Root URL
                url,
                // Common /dav/principals/ path
                `${url}/dav/principals/`,
                // Common /caldav/ path
                `${url}/caldav/`
            ];

            for (const startUrl of probeUrls) {
                try {
                    const principalUrl = await discoverPrincipal(subscription, startUrl);
                    if (principalUrl) {
                        const homeSetUrl = await discoverCalendarHomeSet(subscription, principalUrl);
                        if (homeSetUrl) {
                            const calendarUrl = await discoverFirstCalendarCollection(subscription, homeSetUrl);
                            if (calendarUrl) return calendarUrl;
                        }
                    }
                } catch (e) {
                    console.warn(`Discovery failed at standard path ${startUrl}:`, e);
                }
            }

            // Fallback try /calendars/
            const discovered = await discoverCalendarFromPath(subscription, `${url}/calendars/`);
            if (discovered) return discovered;
        }
    } catch (e) {
        console.error('CalDAV auto-discovery failed:', e);
    }

    return url.endsWith('/') ? url : `${url}/`;
}

export async function fetchCalDavEvents(subscription: IcsSubscription): Promise<CalDavRemoteEvent[]> {
    const calendarUrl = await getOrDiscoverCalendarUrl(subscription);
    if (subscription.url !== calendarUrl) {
        subscription.url = calendarUrl;
    }
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag />
    <C:calendar-data />
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT" />
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

    const response = await calDavRequest(subscription, {
        method: 'REPORT',
        url: calendarUrl,
        body,
        headers: {
            Depth: '1',
            'Content-Type': 'application/xml; charset=utf-8',
            Accept: 'application/xml,text/xml'
        }
    });
    const xml = await response.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const parserError = getElementsByLocalName(doc, 'parsererror')[0];
    if (parserError) {
        throw new Error(`CalDAV 响应解析失败: ${parserError.textContent || ''}`);
    }

    const responseElements = getElementsByLocalName(doc, 'response');
    const remoteEvents: CalDavRemoteEvent[] = [];
    const hrefsToFetch: string[] = [];

    for (const responseElement of responseElements) {
        const href = getFirstTextByLocalName(responseElement, 'href');
        const rawIcs = getFirstTextByLocalName(responseElement, 'calendar-data');
        const etag = getFirstTextByLocalName(responseElement, 'getetag');

        if (href) {
            if (rawIcs) {
                // Standard server returned data directly
                const events = await parseIcsFile(rawIcs);
                events.forEach(event => {
                    remoteEvents.push({
                        event,
                        href: toAbsoluteHref(calendarUrl, href),
                        etag,
                        rawIcs
                    });
                });
            } else if (href.toLowerCase().endsWith('.ics')) {
                // Feishu style - only returned hrefs
                hrefsToFetch.push(href);
            }
        }
    }

    // Fetch remaining events in batches using calendar-multiget
    if (hrefsToFetch.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < hrefsToFetch.length; i += batchSize) {
            const batchHrefs = hrefsToFetch.slice(i, i + batchSize);
            const hrefElements = batchHrefs.map(h => `  <D:href>${h}</D:href>`).join('\n');
            
            const multigetBody = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag />
    <C:calendar-data />
  </D:prop>
${hrefElements}
</C:calendar-multiget>`;

            const multigetResponse = await calDavRequest(subscription, {
                method: 'REPORT',
                url: calendarUrl,
                body: multigetBody,
                headers: {
                    'Content-Type': 'application/xml; charset=utf-8',
                    Accept: 'application/xml,text/xml'
                }
            });

            const multigetXml = await multigetResponse.text();
            const multigetDoc = new DOMParser().parseFromString(multigetXml, 'application/xml');
            const multigetResponseElements = getElementsByLocalName(multigetDoc, 'response');

            for (const resp of multigetResponseElements) {
                const href = getFirstTextByLocalName(resp, 'href');
                const rawIcs = getFirstTextByLocalName(resp, 'calendar-data');
                if (!href || !rawIcs) continue;

                const etag = getFirstTextByLocalName(resp, 'getetag');
                const events = await parseIcsFile(rawIcs);
                events.forEach(event => {
                    remoteEvents.push({
                        event,
                        href: toAbsoluteHref(calendarUrl, href),
                        etag,
                        rawIcs
                    });
                });
            }
        }
    }

    return remoteEvents;
}

function unfoldIcsLines(rawIcs: string): string[] {
    return rawIcs
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .reduce((lines: string[], line) => {
            if (/^[ \t]/.test(line) && lines.length > 0) {
                lines[lines.length - 1] += line.slice(1);
            } else if (line.trim()) {
                lines.push(line);
            }
            return lines;
        }, []);
}

function foldIcsLine(line: string): string {
    const chunks: string[] = [];
    let rest = line;
    while (rest.length > 75) {
        chunks.push(rest.slice(0, 75));
        rest = rest.slice(75);
    }
    chunks.push(rest);
    return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join('\r\n');
}

function escapeIcsText(value: string): string {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

function formatDateCompact(date: string): string {
    return String(date || '').replace(/-/g, '');
}

function formatDateTimeCompact(date: string, time?: string): string {
    const safeTime = (time || '00:00').padEnd(5, '0');
    return `${formatDateCompact(date)}T${safeTime.replace(':', '')}00`;
}

function addDays(date: string, days: number): string {
    const dt = new Date(`${date}T00:00:00`);
    dt.setDate(dt.getDate() + days);
    return [
        dt.getFullYear(),
        String(dt.getMonth() + 1).padStart(2, '0'),
        String(dt.getDate()).padStart(2, '0')
    ].join('-');
}

function buildDateLines(task: any): string[] {
    if (!task.date) return [];

    if (!task.time) {
        const endDate = addDays(task.endDate || task.date, 1);
        return [
            `DTSTART;VALUE=DATE:${formatDateCompact(task.date)}`,
            `DTEND;VALUE=DATE:${formatDateCompact(endDate)}`
        ];
    }

    const lines = [`DTSTART:${formatDateTimeCompact(task.date, task.time)}`];
    if (task.endDate || task.endTime) {
        lines.push(`DTEND:${formatDateTimeCompact(task.endDate || task.date, task.endTime || task.time)}`);
    }
    return lines;
}

function getUid(task: any): string {
    return task.uid || `${task.id || Date.now()}@siyuan-task-note-management`;
}

function buildReplacementLines(task: any): string[] {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
        `UID:${escapeIcsText(getUid(task))}`,
        `SUMMARY:${escapeIcsText(task.title || '未命名日程')}`,
        ...buildDateLines(task),
        `DTSTAMP:${now}`,
        `LAST-MODIFIED:${now}`
    ];

    if (task.note || task.description) {
        lines.push(`DESCRIPTION:${escapeIcsText(task.note || task.description)}`);
    }

    if (task.completed) {
        lines.push('STATUS:COMPLETED');
    }

    return lines;
}

function lineStartsWithProperty(line: string, propertyName: string): boolean {
    const upper = line.toUpperCase();
    const prop = propertyName.toUpperCase();
    return upper.startsWith(`${prop}:`) || upper.startsWith(`${prop};`);
}

function buildCalDavIcs(task: any, existingRawIcs?: string): string {
    const replacementNames = new Set([
        'UID',
        'SUMMARY',
        'DTSTART',
        'DTEND',
        'DTSTAMP',
        'LAST-MODIFIED',
        'DESCRIPTION',
        'STATUS'
    ]);
    const replacementLines = buildReplacementLines(task);

    let lines = existingRawIcs ? unfoldIcsLines(existingRawIcs) : [];
    if (lines.length === 0) {
        lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SiYuan Task Note Management//CalDAV//CN', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR'];
    }

    const eventStart = lines.findIndex(line => /^BEGIN:VEVENT$/i.test(line));
    const eventEnd = lines.findIndex((line, index) => index > eventStart && /^END:VEVENT$/i.test(line));
    if (eventStart < 0 || eventEnd < 0) {
        lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SiYuan Task Note Management//CalDAV//CN', 'BEGIN:VEVENT', 'END:VEVENT', 'END:VCALENDAR'];
    }

    const start = lines.findIndex(line => /^BEGIN:VEVENT$/i.test(line));
    const end = lines.findIndex((line, index) => index > start && /^END:VEVENT$/i.test(line));
    const cleaned = lines.filter((line, index) => {
        if (index <= start || index >= end) return true;
        return !Array.from(replacementNames).some(name => lineStartsWithProperty(line, name));
    });
    const nextEnd = cleaned.findIndex((line, index) => index > start && /^END:VEVENT$/i.test(line));
    cleaned.splice(nextEnd, 0, ...replacementLines);

    return `${cleaned.map(foldIcsLine).join('\r\n')}\r\n`;
}

async function getTaskHref(subscription: IcsSubscription, task: any): Promise<string> {
    if (task.caldavHref) return task.caldavHref;

    const calendarUrl = await getOrDiscoverCalendarUrl(subscription);
    const uid = encodeURIComponent(getUid(task).replace(/[\\/:*?"<>|]/g, '-'));
    return new URL(`${uid}.ics`, calendarUrl).toString();
}

export async function putCalDavTask(
    subscription: IcsSubscription,
    task: any
): Promise<{ etag?: string; rawIcs: string; href: string }> {
    const href = await getTaskHref(subscription, task);
    const rawIcs = buildCalDavIcs(task, task.caldavRawIcs);
    const headers: Record<string, string> = {
        'Content-Type': 'text/calendar; charset=utf-8'
    };
    if (task.caldavEtag) {
        headers['If-Match'] = formatIfMatchEtag(task.caldavEtag);
    }

    try {
        const response = await calDavRequest(subscription, {
            method: 'PUT',
            url: href,
            body: rawIcs,
            headers
        });

        return {
            href,
            rawIcs,
            etag: response.headers.get('ETag') || task.caldavEtag
        };
    } catch (error: any) {
        if (headers['If-Match'] && (error.status === 400 || error.status === 412 || error.status === 428)) {
            console.warn(`CalDAV PUT with If-Match failed (HTTP ${error.status}), retrying without If-Match...`);
            delete headers['If-Match'];
            const response = await calDavRequest(subscription, {
                method: 'PUT',
                url: href,
                body: rawIcs,
                headers
            });
            return {
                href,
                rawIcs,
                etag: response.headers.get('ETag') || task.caldavEtag
            };
        }
        throw error;
    }
}

export async function deleteCalDavTask(subscription: IcsSubscription, task: any): Promise<void> {
    if (!task?.caldavHref) return;

    const headers: Record<string, string> = {};
    if (task.caldavEtag) {
        headers['If-Match'] = formatIfMatchEtag(task.caldavEtag);
    }

    try {
        await calDavRequest(subscription, {
            method: 'DELETE',
            url: task.caldavHref,
            headers
        });
    } catch (error: any) {
        if (headers['If-Match'] && (error.status === 400 || error.status === 412 || error.status === 428)) {
            console.warn(`CalDAV DELETE with If-Match failed (HTTP ${error.status}), retrying without If-Match...`);
            delete headers['If-Match'];
            await calDavRequest(subscription, {
                method: 'DELETE',
                url: task.caldavHref,
                headers
            });
            return;
        }
        throw error;
    }
}
