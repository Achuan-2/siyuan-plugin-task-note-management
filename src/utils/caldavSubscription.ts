import { forwardProxy } from "../api";
import { i18n } from "../pluginInstance";
import { parseIcsFile, ParsedIcsEvent } from './icsImport';
import type { IcsSubscription } from './icsSubscription';
import { getTaskNotePreviewText } from './taskNoteStorage';

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

interface CalDavResponse {
    status: number;
    statusText: string;
    url: string;
    text(): Promise<string>;
    getHeader(name: string): string | null;
}

interface CalDavResourceInfo {
    isCalendar: boolean;
    supportsVevent: boolean;
    principalUrl: string | null;
    homeSetUrl: string | null;
}

const EXCLUDED_CALENDAR_RESOURCE_TYPES = new Set([
    'schedule-inbox',
    'schedule-outbox',
    'notification',
    'subscribed',
    'calendar-proxy-read',
    'calendar-proxy-write',
    'deleted-calendar',
    'trashbin'
]);

const VALID_VEVENT_STATUSES = new Set(['TENTATIVE', 'CONFIRMED', 'CANCELLED']);
const MAX_REDIRECTS = 3;

function ensureTrailingSlash(url: string): string {
    return url.endsWith('/') ? url : `${url}/`;
}

function getCalendarUrl(subscription: IcsSubscription): string {
    const url = (subscription.url || '').trim();
    if (!url) {
        throw new Error(i18n("caldavUrlRequired"));
    }
    return ensureTrailingSlash(url);
}

function getAuthHeader(subscription: IcsSubscription): Record<string, string> {
    if (!subscription.username && !subscription.password) return {};
    const credentials = `${subscription.username || ''}:${subscription.password || ''}`;
    return {
        Authorization: `Basic ${btoa(unescape(encodeURIComponent(credentials)))}`
    };
}

/**
 * SiYuan v3.6.5+ forwardProxy blocks private/loopback IP ranges.
 */
function isPrivateEndpoint(endpoint: string): boolean {
    try {
        const hostname = new URL(endpoint).hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0') {
            return true;
        }
        if (hostname.startsWith('127.')) return true;
        if (hostname.startsWith('10.')) return true;
        if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
        if (hostname.startsWith('192.168.')) return true;
        if (hostname.startsWith('169.254.')) return true;
        return false;
    } catch {
        return false;
    }
}

function isLikelyCorsOrNetworkError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    const name = String(err?.name || '').toLowerCase();
    return (
        name === 'typeerror' ||
        msg.includes('failed to fetch') ||
        msg.includes('networkerror') ||
        msg.includes('cors') ||
        msg.includes('preflight') ||
        msg.includes('access-control-allow-origin') ||
        msg.includes('err_failed') ||
        msg.includes('load failed')
    );
}

function isRedirectStatus(status: number): boolean {
    return status === 301 || status === 302 || status === 307 || status === 308;
}

function readProxyHeader(headers: Record<string, any> | undefined, name: string): string | null {
    if (!headers || typeof headers !== 'object') return null;
    const target = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === target) {
            if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : null;
            return value != null ? String(value) : null;
        }
    }
    return null;
}

async function sendViaForwardProxy(
    targetUrl: string,
    method: string,
    headers: Record<string, string>,
    body?: string
): Promise<CalDavResponse> {
    let currentUrl = targetUrl;
    const headerEntries = Object.entries(headers).map(([key, value]) => ({ [key]: value }));
    const contentType = headers['Content-Type'] || headers['content-type'] || 'application/xml; charset=utf-8';

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
        const proxied = await forwardProxy(
            currentUrl,
            method,
            body ?? '',
            headerEntries,
            30000,
            contentType
        );

        if (!proxied || typeof proxied.status !== 'number') {
            throw new Error(`CalDAV proxy ${method} failed: invalid response from forwardProxy`);
        }

        const location = readProxyHeader(proxied.headers, 'location');
        if (isRedirectStatus(proxied.status) && location && redirectCount < MAX_REDIRECTS) {
            currentUrl = new URL(location, currentUrl).toString();
            continue;
        }

        const bodyText = typeof proxied.body === 'string' ? proxied.body : String(proxied.body ?? '');
        return {
            status: proxied.status,
            statusText: '',
            url: proxied.url || currentUrl,
            text: async () => bodyText,
            getHeader: (name: string) => readProxyHeader(proxied.headers, name)
        };
    }

    throw new Error(`CalDAV proxy ${method} failed: too many redirects`);
}

async function sendViaDirectFetch(
    targetUrl: string,
    method: string,
    headers: Record<string, string>,
    body?: string
): Promise<CalDavResponse> {
    const response = await fetch(targetUrl, {
        method,
        headers,
        body
    });

    return {
        status: response.status,
        statusText: response.statusText || '',
        url: response.url || targetUrl,
        text: () => response.text(),
        getHeader: (name: string) => response.headers.get(name)
    };
}

async function calDavRequest(
    subscription: IcsSubscription,
    options: CalDavRequestOptions
): Promise<CalDavResponse> {
    const targetUrl = options.url || getCalendarUrl(subscription);
    const headers: Record<string, string> = {
        ...getAuthHeader(subscription),
        ...(options.headers || {})
    };

    let response: CalDavResponse;
    try {
        response = await sendViaDirectFetch(targetUrl, options.method, headers, options.body);
    } catch (directError: any) {
        if (isLikelyCorsOrNetworkError(directError) && !isPrivateEndpoint(targetUrl)) {
            console.warn('Direct CalDAV fetch failed, falling back to forwardProxy:', targetUrl, directError);
            response = await sendViaForwardProxy(targetUrl, options.method, headers, options.body);
        } else {
            throw directError;
        }
    }

    const isSuccess = (response.status >= 200 && response.status < 300) || response.status === 207;
    if (!isSuccess) {
        const text = await response.text().catch(() => '');
        const error = new Error(
            `CalDAV ${options.method} failed: HTTP ${response.status} ${response.statusText}${
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

function escapeXml(value: string): string {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getElementsByLocalName(parent: ParentNode, localName: string): Element[] {
    return Array.from(parent.querySelectorAll('*')).filter(
        node => node.localName.toLowerCase() === localName.toLowerCase()
    ) as Element[];
}

function getFirstTextByLocalName(parent: ParentNode, localName: string): string {
    const element = getElementsByLocalName(parent, localName)[0];
    return (element?.textContent || '').trim();
}

function getRawTextByLocalName(parent: ParentNode, localName: string): string {
    const element = getElementsByLocalName(parent, localName)[0];
    return element?.textContent || '';
}

function getOkPropstats(responseElement: Element): Element[] {
    const propstats = getElementsByLocalName(responseElement, 'propstat');
    if (propstats.length === 0) return [responseElement];

    const okPropstats = propstats.filter(propstat => {
        const statusText = getFirstTextByLocalName(propstat, 'status');
        if (!statusText) return true;
        return /\b2\d\d\b/.test(statusText);
    });
    return okPropstats.length > 0 ? okPropstats : propstats;
}

function toAbsoluteHref(baseUrl: string, href: string): string {
    try {
        return new URL(href.trim(), baseUrl).toString();
    } catch (_error) {
        return href.trim();
    }
}

function normalizeUrlForCompare(url: string): string {
    try {
        const parsed = new URL(url);
        const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.origin}${normalizedPath}`;
    } catch {
        return url.replace(/\/+$/, '');
    }
}

function isCalendarCollectionResource(resourceType: Element | undefined): boolean {
    if (!resourceType) return false;
    const childNames = new Set(
        Array.from(resourceType.children).map(child => child.localName.toLowerCase())
    );
    if (!childNames.has('calendar')) return false;
    for (const excluded of EXCLUDED_CALENDAR_RESOURCE_TYPES) {
        if (childNames.has(excluded)) return false;
    }
    return true;
}

function supportsVeventComponent(propstats: Element[]): boolean {
    for (const propstat of propstats) {
        const compSet = getElementsByLocalName(propstat, 'supported-calendar-component-set')[0];
        if (!compSet) continue;
        const comps = getElementsByLocalName(compSet, 'comp');
        if (comps.length === 0) continue;
        return comps.some(comp => (comp.getAttribute('name') || '').toUpperCase() === 'VEVENT');
    }
    // If server did not return supported-calendar-component-set, assume VEVENT is supported.
    return true;
}

function detectWritePrivilege(propstats: Element[]): 'writable' | 'readonly' | 'unknown' {
    for (const propstat of propstats) {
        const privSet = getElementsByLocalName(propstat, 'current-user-privilege-set')[0];
        if (!privSet) continue;
        const privileges = getElementsByLocalName(privSet, 'privilege');
        if (privileges.length === 0) continue;

        const hasWrite = privileges.some(priv =>
            Array.from(priv.children).some(child => {
                const name = child.localName.toLowerCase();
                return name === 'write' || name === 'write-content' || name === 'all';
            })
        );
        return hasWrite ? 'writable' : 'readonly';
    }
    return 'unknown';
}

function scoreCalendarCandidate(href: string, displayName: string, privilege: 'writable' | 'readonly' | 'unknown'): number {
    let score = 0;
    if (privilege === 'writable') score += 100;
    else if (privilege === 'unknown') score += 50;
    else score -= 50;

    const lowerHref = href.toLowerCase();
    const lowerName = displayName.toLowerCase();

    if (
        lowerHref.includes('contact_birthdays') ||
        lowerHref.includes('birthday') ||
        lowerName.includes('birthday') ||
        lowerName.includes('生日')
    ) {
        score -= 60;
    }

    if (
        lowerHref.includes('holiday') ||
        lowerName.includes('holiday') ||
        lowerName.includes('节假日')
    ) {
        score -= 30;
    }

    const lastSegment = lowerHref.replace(/\/+$/, '').split('/').pop() || '';
    if (
        lastSegment === 'home' ||
        lastSegment === 'personal' ||
        lastSegment === 'default' ||
        lastSegment === 'calendar' ||
        lowerName === 'home' ||
        lowerName === 'personal' ||
        lowerName === 'default' ||
        lowerName === 'calendar' ||
        lowerName === '家庭' ||
        lowerName === '个人' ||
        lowerName === '日历'
    ) {
        score += 20;
    }

    return score;
}

async function inspectCalDavResource(subscription: IcsSubscription, targetUrl: string): Promise<CalDavResourceInfo | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype />
    <d:current-user-principal />
    <c:calendar-home-set />
    <c:supported-calendar-component-set />
  </d:prop>
</d:propfind>`;

    try {
        const response = await calDavRequest(subscription, {
            method: 'PROPFIND',
            url: targetUrl,
            body,
            headers: {
                Depth: '0',
                'Content-Type': 'application/xml; charset=utf-8'
            }
        });

        const xml = await response.text();
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        if (getElementsByLocalName(doc, 'parsererror').length > 0) {
            return null;
        }

        const effectiveBaseUrl = response.url || targetUrl;
        const responseElements = getElementsByLocalName(doc, 'response');
        const primaryResponse = responseElements[0] || doc.documentElement;
        if (!primaryResponse) return null;

        const propstats = getOkPropstats(primaryResponse);
        let isCalendar = false;
        let principalUrl: string | null = null;
        let homeSetUrl: string | null = null;

        for (const propstat of propstats) {
            const resourceType = getElementsByLocalName(propstat, 'resourcetype')[0];
            if (isCalendarCollectionResource(resourceType)) {
                isCalendar = true;
            }
            if (!principalUrl) {
                const principalEl = getElementsByLocalName(propstat, 'current-user-principal')[0];
                const href = principalEl ? getFirstTextByLocalName(principalEl, 'href') : '';
                if (href) {
                    principalUrl = toAbsoluteHref(effectiveBaseUrl, href);
                }
            }
            if (!homeSetUrl) {
                const homeSetEl = getElementsByLocalName(propstat, 'calendar-home-set')[0];
                const href = homeSetEl ? getFirstTextByLocalName(homeSetEl, 'href') : '';
                if (href) {
                    homeSetUrl = toAbsoluteHref(effectiveBaseUrl, href);
                }
            }
        }

        const supportsVevent = supportsVeventComponent(propstats);
        return {
            isCalendar,
            supportsVevent,
            principalUrl,
            homeSetUrl
        };
    } catch (e) {
        console.warn('inspectCalDavResource failed:', targetUrl, e);
        return null;
    }
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
        if (getElementsByLocalName(doc, 'parsererror').length > 0) {
            return null;
        }

        const effectiveBaseUrl = response.url || principalUrl;
        const responseElements = getElementsByLocalName(doc, 'response');
        for (const resp of responseElements) {
            const propstats = getOkPropstats(resp);
            for (const propstat of propstats) {
                const homeSetElement = getElementsByLocalName(propstat, 'calendar-home-set')[0];
                if (homeSetElement) {
                    const href = getFirstTextByLocalName(homeSetElement, 'href');
                    if (href) {
                        return toAbsoluteHref(effectiveBaseUrl, href);
                    }
                }
            }
        }
    } catch (e) {
        console.warn('discoverCalendarHomeSet failed:', principalUrl, e);
    }
    return null;
}

async function discoverCalendarCollection(subscription: IcsSubscription, homeSetUrl: string): Promise<string | null> {
    const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:resourcetype />
    <d:displayname />
    <c:supported-calendar-component-set />
    <d:current-user-privilege-set />
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
        if (getElementsByLocalName(doc, 'parsererror').length > 0) {
            return null;
        }

        const effectiveBaseUrl = response.url || homeSetUrl;
        const normalizedParent = normalizeUrlForCompare(effectiveBaseUrl);
        const responseElements = getElementsByLocalName(doc, 'response');

        const childCandidates: Array<{ url: string; score: number }> = [];
        let selfCandidate: string | null = null;

        for (const resp of responseElements) {
            const href = getFirstTextByLocalName(resp, 'href');
            if (!href) continue;

            const propstats = getOkPropstats(resp);
            const isCalendar = propstats.some(propstat =>
                isCalendarCollectionResource(getElementsByLocalName(propstat, 'resourcetype')[0])
            );
            if (!isCalendar) continue;
            if (!supportsVeventComponent(propstats)) continue;

            const absoluteUrl = ensureTrailingSlash(toAbsoluteHref(effectiveBaseUrl, href));
            const displayName = propstats
                .map(propstat => getFirstTextByLocalName(propstat, 'displayname'))
                .find(Boolean) || '';

            if (normalizeUrlForCompare(absoluteUrl) === normalizedParent) {
                selfCandidate = absoluteUrl;
                continue;
            }

            const privilege = detectWritePrivilege(propstats);
            const score = scoreCalendarCandidate(absoluteUrl, displayName, privilege);
            childCandidates.push({ url: absoluteUrl, score });
        }

        if (childCandidates.length > 0) {
            childCandidates.sort((a, b) => b.score - a.score);
            return childCandidates[0].url;
        }

        return selfCandidate;
    } catch (e) {
        console.warn('discoverCalendarCollection failed:', homeSetUrl, e);
    }
    return null;
}

async function discoverFromEntryPoint(subscription: IcsSubscription, entryUrl: string): Promise<string | null> {
    const info = await inspectCalDavResource(subscription, entryUrl);
    if (!info) return null;

    if (info.isCalendar && info.supportsVevent) {
        return ensureTrailingSlash(entryUrl);
    }

    if (info.homeSetUrl) {
        const calendarUrl = await discoverCalendarCollection(subscription, info.homeSetUrl);
        if (calendarUrl) return calendarUrl;
    }

    if (info.principalUrl) {
        const homeSetUrl = await discoverCalendarHomeSet(subscription, info.principalUrl);
        if (homeSetUrl) {
            const calendarUrl = await discoverCalendarCollection(subscription, homeSetUrl);
            if (calendarUrl) return calendarUrl;
        }
    }

    return null;
}

async function getOrDiscoverCalendarUrl(subscription: IcsSubscription): Promise<string> {
    let url = (subscription.url || '').trim();
    if (!url) {
        throw new Error(i18n("caldavUrlRequired"));
    }

    if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
    }

    const baseWithoutSlash = url.replace(/\/+$/, '');
    const normalizedUrl = ensureTrailingSlash(baseWithoutSlash);

    try {
        const urlObj = new URL(baseWithoutSlash);
        const hostname = urlObj.hostname.toLowerCase();
        const pathname = urlObj.pathname;
        const isRoot = pathname === '' || pathname === '/';

        // Feishu specific quick discovery for root URL
        if (isRoot && hostname === 'caldav.feishu.cn') {
            const discovered = await discoverCalendarCollection(subscription, 'https://caldav.feishu.cn/calendars/');
            if (discovered) return discovered;
        }

        // Step 1: Inspect the user-provided URL directly (works for direct calendar URLs,
        // Apple iCloud root, Nextcloud /remote.php/dav, Baikal /dav.php, Radicale root/user paths).
        const directInfo = await inspectCalDavResource(subscription, normalizedUrl);
        if (directInfo) {
            if (directInfo.isCalendar && directInfo.supportsVevent) {
                return normalizedUrl;
            }
            if (directInfo.homeSetUrl) {
                const calendarUrl = await discoverCalendarCollection(subscription, directInfo.homeSetUrl);
                if (calendarUrl) return calendarUrl;
            }
            if (directInfo.principalUrl) {
                const homeSetUrl = await discoverCalendarHomeSet(subscription, directInfo.principalUrl);
                if (homeSetUrl) {
                    const calendarUrl = await discoverCalendarCollection(subscription, homeSetUrl);
                    if (calendarUrl) return calendarUrl;
                }
            }
        }

        // Step 2: The provided URL might itself be a calendar-home-set
        // (e.g. Radicale /<user>/, Nextcloud /remote.php/dav/calendars/<user>/, iCloud /<dsid>/calendars/).
        if (!isRoot) {
            const directCollection = await discoverCalendarCollection(subscription, normalizedUrl);
            if (directCollection) return directCollection;
        }

        // Step 3: Probe standard RFC 6764 and common CalDAV server endpoints
        // (Apple iCloud, Nextcloud, Baikal, Radicale, DingTalk, WeCom, generic).
        const candidateEntries = new Set<string>();
        if (hostname === 'calendar.dingtalk.com') {
            candidateEntries.add('https://calendar.dingtalk.com/dav/principals/');
        }
        if (hostname === 'caldav.wecom.work') {
            candidateEntries.add('https://caldav.wecom.work/calendar/');
        }
        candidateEntries.add(`${urlObj.origin}/.well-known/caldav`);
        candidateEntries.add(`${baseWithoutSlash}/remote.php/dav/`);
        candidateEntries.add(`${baseWithoutSlash}/dav.php/`);
        candidateEntries.add(`${baseWithoutSlash}/html/dav.php/`);
        candidateEntries.add(`${baseWithoutSlash}/dav/principals/`);
        candidateEntries.add(`${baseWithoutSlash}/caldav/`);
        if (!isRoot) {
            candidateEntries.add(`${urlObj.origin}/remote.php/dav/`);
            candidateEntries.add(`${urlObj.origin}/dav.php/`);
        }

        // Avoid re-probing the exact URL already inspected in Step 1.
        const inspectedNormalized = normalizeUrlForCompare(normalizedUrl);
        for (const startUrl of candidateEntries) {
            if (normalizeUrlForCompare(startUrl) === inspectedNormalized) continue;
            try {
                const discovered = await discoverFromEntryPoint(subscription, startUrl);
                if (discovered) return discovered;
            } catch (e) {
                console.warn(`Discovery failed at path ${startUrl}:`, e);
            }
        }

        // Step 4: Fallback try /calendars/
        const fallbackCalendars = await discoverCalendarCollection(subscription, `${baseWithoutSlash}/calendars/`);
        if (fallbackCalendars) return fallbackCalendars;
    } catch (e) {
        console.error('CalDAV auto-discovery failed:', e);
    }

    return normalizedUrl;
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
        throw new Error(i18n("caldavResponseParseFailed", { error: String(parserError.textContent || '') }));
    }

    const responseElements = getElementsByLocalName(doc, 'response');
    const remoteEvents: CalDavRemoteEvent[] = [];
    const hrefsToFetch: string[] = [];

    for (const responseElement of responseElements) {
        const href = getFirstTextByLocalName(responseElement, 'href');
        const propstats = getOkPropstats(responseElement);
        const rawIcs = propstats.map(p => getRawTextByLocalName(p, 'calendar-data')).find(Boolean) || '';
        const etag = propstats.map(p => getFirstTextByLocalName(p, 'getetag')).find(Boolean) || '';

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
            const hrefElements = batchHrefs.map(h => `  <D:href>${escapeXml(h)}</D:href>`).join('\n');

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
                const propstats = getOkPropstats(resp);
                const rawIcs = propstats.map(p => getRawTextByLocalName(p, 'calendar-data')).find(Boolean) || '';
                if (!href || !rawIcs) continue;

                const etag = propstats.map(p => getFirstTextByLocalName(p, 'getetag')).find(Boolean) || '';
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

const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

function getUtf8ByteLength(str: string): number {
    if (utf8Encoder) {
        return utf8Encoder.encode(str).length;
    }
    return unescape(encodeURIComponent(str)).length;
}

/**
 * RFC 5545 Section 3.1: Content lines MUST be folded to at most 75 octets (UTF-8 bytes)
 * without splitting multi-byte characters.
 */
function foldIcsLine(line: string): string {
    if (getUtf8ByteLength(line) <= 75) return line;

    const chunks: string[] = [];
    let current = '';
    let currentBytes = 0;
    let maxBytes = 75;

    for (const ch of line) {
        const chBytes = getUtf8ByteLength(ch);
        if (current && currentBytes + chBytes > maxBytes) {
            chunks.push(current);
            current = ch;
            currentBytes = chBytes;
            maxBytes = 74; // Reserve 1 byte for leading folding space
        } else {
            current += ch;
            currentBytes += chBytes;
        }
    }
    if (current) {
        chunks.push(current);
    }

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

function formatDateTimeUtc(date: string, time?: string): string {
    const [yearStr, monthStr, dayStr] = String(date || '').split('-');
    const [hourStr, minuteStr] = String(time || '00:00').split(':');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    const hour = Number(hourStr || 0);
    const minute = Number(minuteStr || 0);

    if (
        Number.isFinite(year) &&
        Number.isFinite(month) &&
        Number.isFinite(day) &&
        Number.isFinite(hour) &&
        Number.isFinite(minute)
    ) {
        const localDate = new Date(year, month - 1, day, hour, minute, 0, 0);
        if (!Number.isNaN(localDate.getTime())) {
            const pad = (n: number) => String(n).padStart(2, '0');
            return (
                `${localDate.getUTCFullYear()}${pad(localDate.getUTCMonth() + 1)}${pad(localDate.getUTCDate())}` +
                `T${pad(localDate.getUTCHours())}${pad(localDate.getUTCMinutes())}${pad(localDate.getUTCSeconds())}Z`
            );
        }
    }

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
        const inclusiveEndDate = task.endDate && task.endDate >= task.date ? task.endDate : task.date;
        const endDate = addDays(inclusiveEndDate, 1);
        return [
            `DTSTART;VALUE=DATE:${formatDateCompact(task.date)}`,
            `DTEND;VALUE=DATE:${formatDateCompact(endDate)}`
        ];
    }

    const startUtc = formatDateTimeUtc(task.date, task.time);
    const endDateStr = task.endDate || task.date;
    const endTimeStr = task.endTime || task.time;
    let endUtc = formatDateTimeUtc(endDateStr, endTimeStr);
    if (endUtc < startUtc) {
        endUtc = startUtc;
    }

    return [
        `DTSTART:${startUtc}`,
        `DTEND:${endUtc}`
    ];
}

function getUid(task: any): string {
    return task.uid || `${task.id || Date.now()}@siyuan-task-note-management`;
}

function lineStartsWithProperty(line: string, propertyName: string): boolean {
    const upper = line.toUpperCase();
    const prop = propertyName.toUpperCase();
    return upper.startsWith(`${prop}:`) || upper.startsWith(`${prop};`);
}

function extractTopLevelPropertyValue(eventLines: string[], propertyName: string): string | null {
    let subDepth = 0;
    for (let i = 1; i < eventLines.length - 1; i++) {
        const line = eventLines[i];
        if (/^BEGIN:/i.test(line)) {
            subDepth++;
            continue;
        }
        if (/^END:/i.test(line)) {
            subDepth = Math.max(0, subDepth - 1);
            continue;
        }
        if (subDepth === 0 && lineStartsWithProperty(line, propertyName)) {
            const colonIndex = line.indexOf(':');
            if (colonIndex >= 0) {
                return line.slice(colonIndex + 1).trim();
            }
        }
    }
    return null;
}

function buildReplacementLines(task: any, existingValidStatus?: string | null): string[] {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const lines = [
        `UID:${escapeIcsText(getUid(task))}`,
        `SUMMARY:${escapeIcsText(task.title || i18n("unnamedCalendarEvent"))}`,
        ...buildDateLines(task),
        `DTSTAMP:${now}`,
        `LAST-MODIFIED:${now}`
    ];

    const taskDescription = task.note || getTaskNotePreviewText(task) || task.description;
    if (taskDescription) {
        lines.push(`DESCRIPTION:${escapeIcsText(taskDescription)}`);
    }

    // RFC 5545 restricts VEVENT STATUS to TENTATIVE / CONFIRMED / CANCELLED.
    // Strict servers (Apple iCloud, SabreDAV/Nextcloud/Baikal, Radicale) reject STATUS:COMPLETED on VEVENT.
    const statusValue = existingValidStatus && VALID_VEVENT_STATUSES.has(existingValidStatus.toUpperCase())
        ? existingValidStatus.toUpperCase()
        : 'CONFIRMED';
    lines.push(`STATUS:${statusValue}`);

    if (task.completed) {
        lines.push('X-SIYUAN-COMPLETED:TRUE');
    }

    return lines;
}

function findPrimaryVeventBounds(lines: string[]): { start: number; end: number } | null {
    const blocks: Array<{ start: number; end: number; hasRecurrenceId: boolean }> = [];
    for (let i = 0; i < lines.length; i++) {
        if (!/^BEGIN:VEVENT$/i.test(lines[i])) continue;
        let depth = 0;
        let hasRecurrenceId = false;
        for (let j = i + 1; j < lines.length; j++) {
            if (/^BEGIN:/i.test(lines[j])) {
                depth++;
                continue;
            }
            if (/^END:VEVENT$/i.test(lines[j]) && depth === 0) {
                blocks.push({ start: i, end: j, hasRecurrenceId });
                i = j;
                break;
            }
            if (/^END:/i.test(lines[j])) {
                depth = Math.max(0, depth - 1);
                continue;
            }
            if (depth === 0 && lineStartsWithProperty(lines[j], 'RECURRENCE-ID')) {
                hasRecurrenceId = true;
            }
        }
    }
    if (blocks.length === 0) return null;
    const master = blocks.find(b => !b.hasRecurrenceId) || blocks[0];
    return { start: master.start, end: master.end };
}

function buildCalDavIcs(task: any, existingRawIcs?: string): string {
    const replacementNames = [
        'UID',
        'SUMMARY',
        'DTSTART',
        'DTEND',
        'DURATION',
        'DTSTAMP',
        'LAST-MODIFIED',
        'DESCRIPTION',
        'STATUS',
        'X-SIYUAN-COMPLETED'
    ];

    let lines = existingRawIcs ? unfoldIcsLines(existingRawIcs) : [];
    let bounds = findPrimaryVeventBounds(lines);
    if (!bounds) {
        lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//SiYuan Task Note Management//CalDAV//CN',
            'BEGIN:VEVENT',
            'END:VEVENT',
            'END:VCALENDAR'
        ];
        bounds = findPrimaryVeventBounds(lines)!;
    }

    const existingEventSlice = lines.slice(bounds.start, bounds.end + 1);
    const existingStatus = extractTopLevelPropertyValue(existingEventSlice, 'STATUS');
    const replacementLines = buildReplacementLines(task, existingStatus);

    // Only strip top-level VEVENT properties, preserving nested sub-components such as VALARM.
    const cleaned: string[] = [];
    let subDepth = 0;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (index <= bounds.start || index >= bounds.end) {
            cleaned.push(line);
            continue;
        }
        if (/^BEGIN:/i.test(line)) {
            subDepth++;
            cleaned.push(line);
            continue;
        }
        if (/^END:/i.test(line)) {
            subDepth = Math.max(0, subDepth - 1);
            cleaned.push(line);
            continue;
        }
        if (subDepth > 0) {
            cleaned.push(line);
            continue;
        }
        const shouldReplace = replacementNames.some(name => lineStartsWithProperty(line, name));
        if (!shouldReplace) {
            cleaned.push(line);
        }
    }

    const updatedBounds = findPrimaryVeventBounds(cleaned)!;
    cleaned.splice(updatedBounds.end, 0, ...replacementLines);

    return `${cleaned.map(foldIcsLine).join('\r\n')}\r\n`;
}

async function getTaskHref(subscription: IcsSubscription, task: any): Promise<string> {
    if (task.caldavHref) return task.caldavHref;

    const calendarUrl = await getOrDiscoverCalendarUrl(subscription);
    const uid = encodeURIComponent(getUid(task).replace(/[\\/:*?"<>|]/g, '-'));
    return new URL(`${uid}.ics`, calendarUrl).toString();
}

export function hasCalDavRemoteTaskChanged(currentTask: any, nextTask: any): boolean {
    if (!currentTask || !nextTask) return true;
    const normStr = (v: any) => String(v ?? '');
    const currentDesc = normStr(currentTask.note || getTaskNotePreviewText(currentTask) || currentTask.description || '');
    const nextDesc = normStr(nextTask.note || getTaskNotePreviewText(nextTask) || nextTask.description || '');
    if (normStr(currentTask.title) !== normStr(nextTask.title)) return true;
    if (currentDesc !== nextDesc) return true;
    if (normStr(currentTask.date) !== normStr(nextTask.date)) return true;
    if (normStr(currentTask.time) !== normStr(nextTask.time)) return true;
    if (normStr(currentTask.endDate) !== normStr(nextTask.endDate)) return true;
    if (normStr(currentTask.endTime) !== normStr(nextTask.endTime)) return true;
    if (Boolean(currentTask.completed) !== Boolean(nextTask.completed)) return true;
    return false;
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

        const returnedEtag = response.getHeader('ETag');
        return {
            href,
            rawIcs,
            etag: returnedEtag || undefined
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
            const returnedEtag = response.getHeader('ETag');
            return {
                href,
                rawIcs,
                etag: returnedEtag || undefined
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
