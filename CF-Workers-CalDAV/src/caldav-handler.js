/**
 * CalDAV protocol handler
 */

export class CalDAVHandler {
  constructor(env) {
    this.env = env;
    this.db = env.DB;
    this.r2 = env.R2;
    this.kv = env.KV;
  }

  // Generate ETag
  generateEtag(content) {
    return `"${this.hashCode(content)}"`;
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  // Generate XML response
  xmlResponse(body, status = 207) {
    return new Response(body, {
      status,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'DAV': '1, 2, 3, calendar-access',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // Root path - WebDAV service discovery
  async handleRoot(request) {
    const method = request.method;

    if (method === 'PROPFIND') {
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
        </d:resourcetype>
        <d:current-user-principal>
          <d:href>/caldav/</d:href>
        </d:current-user-principal>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      return this.xmlResponse(xml);
    }

    return new Response('CalDAV Server', { status: 200 });
  }

  // User principal
  async handleUserPrincipal(request) {
    if (request.method === 'PROPFIND') {
      const url = new URL(request.url);
      const requestPath = url.pathname;
      
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>${requestPath}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <d:principal/>
        </d:resourcetype>
        <c:calendar-home-set>
          <d:href>/caldav/calendars/</d:href>
        </c:calendar-home-set>
        <d:current-user-principal>
          <d:href>${requestPath}</d:href>
        </d:current-user-principal>
        <d:displayname>CalDAV User</d:displayname>
        <d:principal-URL>
          <d:href>${requestPath}</d:href>
        </d:principal-URL>
        <d:principal-collection-set>
          <d:href>/principals/</d:href>
        </d:principal-collection-set>
        <c:calendar-user-address-set>
          <d:href>mailto:admin@caldav.local</d:href>
        </c:calendar-user-address-set>
        <cs:email-address-set>
          <cs:email-address>admin@caldav.local</cs:email-address>
        </cs:email-address-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      return this.xmlResponse(xml);
    }

    return new Response('User Principal', { status: 200 });
  }

  // Calendar home
  async handleCalendarHome(request) {
    if (request.method === 'PROPFIND') {
      const calendars = await this.db.prepare(
        'SELECT * FROM calendars ORDER BY created_at'
      ).all();

      let responses = '';
      for (const cal of calendars.results) {
        responses += `
  <d:response>
    <d:href>/caldav/calendars/${cal.id}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <c:calendar/>
        </d:resourcetype>
        <d:displayname>${this.escapeXml(cal.display_name)}</d:displayname>
        <c:calendar-description>${this.escapeXml(cal.description || '')}</c:calendar-description>
        <c:calendar-timezone>${this.escapeXml(cal.timezone)}</c:calendar-timezone>
        <x:calendar-color xmlns:x="http://apple.com/ns/ical/">${this.escapeXml(cal.color)}</x:calendar-color>
        <d:sync-token>data:,${cal.sync_token}</d:sync-token>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
          <c:comp name="VTODO"/>
          <c:comp name="VJOURNAL"/>
        </c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
      }

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>/caldav/calendars/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
        </d:resourcetype>
        <d:displayname>Calendars</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>${responses}
</d:multistatus>`;
      return this.xmlResponse(xml);
    }

    return new Response('Calendar Home', { status: 200 });
  }

  // Create calendar
  async handleMkcalendar(request, calendarId) {
    const body = await request.text();
    
    // Parse calendar properties from request (simplified)
    let displayName = calendarId;
    let description = '';
    let timezone = 'UTC';
    let color = '#3b82f6';

    // Simple XML parsing
    const displayNameMatch = body.match(/<d:displayname>(.*?)<\/d:displayname>/i);
    if (displayNameMatch) displayName = displayNameMatch[1];

    const descMatch = body.match(/<c:calendar-description>(.*?)<\/c:calendar-description>/i);
    if (descMatch) description = descMatch[1];

    const now = Math.floor(Date.now() / 1000);

    try {
      await this.db.prepare(`
        INSERT INTO calendars (id, name, display_name, description, color, timezone, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(calendarId, calendarId, displayName, description, color, timezone, now, now).run();

      return new Response(null, { 
        status: 201,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      });
    } catch (error) {
      console.error('MKCALENDAR error:', error);
      return new Response('Conflict', { status: 409 });
    }
  }

  // Get calendar (PROPFIND)
  async handleCalendarPropfind(request, calendarId) {
    const depth = request.headers.get('Depth') || '0';
    
    const calendar = await this.db.prepare(
      'SELECT * FROM calendars WHERE id = ?'
    ).bind(calendarId).first();

    if (!calendar) {
      return new Response('Not Found', { status: 404 });
    }

    if (depth === '0') {
      // Return calendar only
      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
  <d:response>
    <d:href>/caldav/calendars/${calendarId}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <c:calendar/>
        </d:resourcetype>
        <d:displayname>${this.escapeXml(calendar.display_name)}</d:displayname>
        <c:calendar-description>${this.escapeXml(calendar.description || '')}</c:calendar-description>
        <d:sync-token>data:,${calendar.sync_token}</d:sync-token>
        <c:supported-calendar-component-set>
          <c:comp name="VEVENT"/>
          <c:comp name="VTODO"/>
          <c:comp name="VJOURNAL"/>
        </c:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
      return this.xmlResponse(xml);
    } else {
      // Return calendar and all events
      const objects = await this.db.prepare(
        'SELECT * FROM calendar_objects WHERE calendar_id = ?'
      ).bind(calendarId).all();

      let responses = `
  <d:response>
    <d:href>/caldav/calendars/${calendarId}/</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype>
          <d:collection/>
          <c:calendar/>
        </d:resourcetype>
        <d:displayname>${this.escapeXml(calendar.display_name)}</d:displayname>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;

      for (const obj of objects.results) {
        responses += `
  <d:response>
    <d:href>/caldav/calendars/${calendarId}/${obj.id}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>${obj.etag}</d:getetag>
        <d:getcontenttype>${obj.content_type}</d:getcontenttype>
        <d:getcontentlength>${obj.size}</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
      }

      const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}
</d:multistatus>`;
      return this.xmlResponse(xml);
    }
  }

  // Handle REPORT request (calendar query)
  async handleCalendarReport(request, calendarId) {
    const body = await request.text();
    
    const objects = await this.db.prepare(
      'SELECT * FROM calendar_objects WHERE calendar_id = ?'
    ).bind(calendarId).all();

    let responses = '';
    
    for (const obj of objects.results) {
      // Fetch content from R2
      const r2Object = await this.r2.get(`${calendarId}/${obj.id}`);
      let calendarData = '';
      
      if (r2Object) {
        calendarData = await r2Object.text();
      }

      responses += `
  <d:response>
    <d:href>/caldav/calendars/${calendarId}/${obj.id}</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>${obj.etag}</d:getetag>
        <c:calendar-data>${this.escapeXml(calendarData)}</c:calendar-data>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}
</d:multistatus>`;
    
    return this.xmlResponse(xml);
  }

  // GET calendar (return all events)
  async handleGetCalendar(request, calendarId) {
    const objects = await this.db.prepare(
      'SELECT * FROM calendar_objects WHERE calendar_id = ?'
    ).bind(calendarId).all();

    let icalContent = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//CalDAV Server//Cloudflare Workers//EN\r\n';

    for (const obj of objects.results) {
      const r2Object = await this.r2.get(`${calendarId}/${obj.id}`);
      if (r2Object) {
        const content = await r2Object.text();
        // Extract VEVENT, VTODO, or VJOURNAL section
        const componentMatch = content.match(/BEGIN:(VEVENT|VTODO|VJOURNAL)[\s\S]*?END:\1/);
        if (componentMatch) {
          icalContent += componentMatch[0] + '\r\n';
        }
      }
    }

    icalContent += 'END:VCALENDAR\r\n';

    return new Response(icalContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // GET calendar object (event)
  async handleGetObject(request, calendarId, objectId) {
    const object = await this.db.prepare(
      'SELECT * FROM calendar_objects WHERE calendar_id = ? AND id = ?'
    ).bind(calendarId, objectId).first();

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const r2Object = await this.r2.get(`${calendarId}/${objectId}`);
    if (!r2Object) {
      return new Response('Not Found', { status: 404 });
    }

    const content = await r2Object.text();

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'ETag': object.etag,
        'Access-Control-Allow-Origin': '*',
      }
    });
  }

  // PUT calendar object (create/update event)
  async handlePutObject(request, calendarId, objectId) {
    const content = await request.text();
    const etag = this.generateEtag(content);
    const size = new TextEncoder().encode(content).length;

    // Check If-Match or If-None-Match headers
    const ifMatch = request.headers.get('If-Match');
    const ifNoneMatch = request.headers.get('If-None-Match');

    const existing = await this.db.prepare(
      'SELECT * FROM calendar_objects WHERE calendar_id = ? AND id = ?'
    ).bind(calendarId, objectId).first();

    if (ifMatch && existing) {
      // Normalize ETag comparison (remove quotes)
      const normalizedIfMatch = ifMatch.replace(/"/g, '');
      const normalizedExistingEtag = existing.etag.replace(/"/g, '');
      if (normalizedExistingEtag !== normalizedIfMatch) {
        return new Response('Precondition Failed', { status: 412 });
      }
    }

    if (ifNoneMatch === '*' && existing) {
      return new Response('Precondition Failed', { status: 412 });
    }

    // Extract UID
    const uidMatch = content.match(/UID:(.*)/);
    const uid = uidMatch ? uidMatch[1].trim() : objectId.replace('.ics', '');

    const now = Math.floor(Date.now() / 1000);

    try {
      // Store to R2
      await this.r2.put(`${calendarId}/${objectId}`, content, {
        httpMetadata: {
          contentType: 'text/calendar',
        }
      });

      // Update or insert to D1
      if (existing) {
        await this.db.prepare(`
          UPDATE calendar_objects 
          SET uid = ?, etag = ?, size = ?, updated_at = ?
          WHERE calendar_id = ? AND id = ?
        `).bind(uid, etag, size, now, calendarId, objectId).run();
      } else {
        await this.db.prepare(`
          INSERT INTO calendar_objects (id, calendar_id, uid, etag, size, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(objectId, calendarId, uid, etag, size, now, now).run();
      }

      // Update calendar sync-token
      await this.db.prepare(
        'UPDATE calendars SET sync_token = sync_token + 1, updated_at = ? WHERE id = ?'
      ).bind(now, calendarId).run();

      return new Response(null, {
        status: existing ? 204 : 201,
        headers: {
          'ETag': etag,
          'Access-Control-Allow-Origin': '*',
        }
      });
    } catch (error) {
      console.error('PUT error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  // DELETE calendar object
  async handleDeleteObject(request, calendarId, objectId) {
    const existing = await this.db.prepare(
      'SELECT * FROM calendar_objects WHERE calendar_id = ? AND id = ?'
    ).bind(calendarId, objectId).first();

    if (!existing) {
      return new Response('Not Found', { status: 404 });
    }

    try {
      // Delete from R2
      await this.r2.delete(`${calendarId}/${objectId}`);

      // Delete from D1
      await this.db.prepare(
        'DELETE FROM calendar_objects WHERE calendar_id = ? AND id = ?'
      ).bind(calendarId, objectId).run();

      // Update calendar sync-token
      const now = Math.floor(Date.now() / 1000);
      await this.db.prepare(
        'UPDATE calendars SET sync_token = sync_token + 1, updated_at = ? WHERE id = ?'
      ).bind(now, calendarId).run();

      return new Response(null, { 
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
        }
      });
    } catch (error) {
      console.error('DELETE error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  // PROPFIND calendar object
  async handleObjectPropfind(request, calendarId, objectId) {
    const object = await this.db.prepare(
      'SELECT * FROM calendar_objects WHERE calendar_id = ? AND id = ?'
    ).bind(calendarId, objectId).first();

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/caldav/calendars/${calendarId}/${objectId}</d:href>
    <d:propstat>
      <d:prop>
        <d:resourcetype/>
        <d:getetag>${object.etag}</d:getetag>
        <d:getcontenttype>${object.content_type}</d:getcontenttype>
        <d:getcontentlength>${object.size}</d:getcontentlength>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

    return this.xmlResponse(xml);
  }

  // XML escape
  escapeXml(text) {
    if (!text) return '';
    return text.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
