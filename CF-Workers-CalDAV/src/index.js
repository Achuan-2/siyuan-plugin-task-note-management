/**
 * CalDAV Server on Cloudflare Workers
 * Storage: D1 (metadata) + R2 (iCalendar files) + KV (sessions)
 */

import { CalDAVHandler } from './caldav-handler.js';
import { Auth } from './auth.js';

export default {
  async fetch(request, env, ctx) {
    const auth = new Auth(env);
    const handler = new CalDAVHandler(env);

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      console.log(`${method} ${path}`);

      // .well-known service discovery (required by macOS/iOS)
      if (path === '/.well-known/caldav') {
        return new Response(null, {
          status: 301,
          headers: {
            'Location': '/caldav/',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      // Authentication
      const authResult = auth.authenticate(request);
      if (!authResult.success) {
        return new Response('Unauthorized', {
          status: 401,
          headers: {
            'WWW-Authenticate': 'Basic realm="CalDAV Server"',
            'Access-Control-Allow-Origin': '*',
          }
        });
      }

      // CORS preflight and OPTIONS (requires authentication for macOS)
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, PUT, DELETE, PROPFIND, REPORT, OPTIONS, MKCALENDAR',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, Depth, If-None-Match, If-Match',
            'Access-Control-Max-Age': '86400',
            'DAV': '1, 2, 3, calendar-access',
          }
        });
      }

      // macOS-specific path: /principals/
      if (path === '/principals/' || path === '/principals') {
        return handler.handleUserPrincipal(request);
      }

      // macOS-specific path: /calendar/dav/{username}/user/
      const macosUserMatch = path.match(/^\/calendar\/dav\/([^\/]+)\/user\/?$/);
      if (macosUserMatch) {
        return handler.handleUserPrincipal(request);
      }

      // Root path - service discovery
      if (path === '/' || path === '') {
        return handler.handleRoot(request);
      }

      // User principal
      if (path === '/caldav/' || path === '/caldav') {
        return handler.handleUserPrincipal(request);
      }

      // Calendar home
      if (path === '/caldav/calendars/' || path === '/caldav/calendars') {
        return handler.handleCalendarHome(request);
      }

      // Calendar operations
      const calendarMatch = path.match(/^\/caldav\/calendars\/([^\/]+)\/?$/);
      if (calendarMatch) {
        const calendarId = calendarMatch[1];
        
        if (method === 'PROPFIND') {
          return handler.handleCalendarPropfind(request, calendarId);
        } else if (method === 'REPORT') {
          return handler.handleCalendarReport(request, calendarId);
        } else if (method === 'MKCALENDAR') {
          return handler.handleMkcalendar(request, calendarId);
        } else if (method === 'GET') {
          return handler.handleGetCalendar(request, calendarId);
        }
      }

      // Calendar object (event) operations
      const objectMatch = path.match(/^\/caldav\/calendars\/([^\/]+)\/(.+\.ics)$/);
      if (objectMatch) {
        const calendarId = objectMatch[1];
        const objectId = objectMatch[2];

        if (method === 'GET') {
          return handler.handleGetObject(request, calendarId, objectId);
        } else if (method === 'PUT') {
          return handler.handlePutObject(request, calendarId, objectId);
        } else if (method === 'DELETE') {
          return handler.handleDeleteObject(request, calendarId, objectId);
        } else if (method === 'PROPFIND') {
          return handler.handleObjectPropfind(request, calendarId, objectId);
        }
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('Error:', error);
      return new Response(`Internal Server Error: ${error.message}`, { 
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
