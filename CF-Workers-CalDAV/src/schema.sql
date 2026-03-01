CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#3b82f6',
    timezone TEXT DEFAULT 'UTC',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sync_token INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS calendar_objects (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    etag TEXT NOT NULL,
    content_type TEXT DEFAULT 'text/calendar',
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_objects_calendar_id ON calendar_objects(calendar_id);
CREATE INDEX IF NOT EXISTS idx_calendar_objects_uid ON calendar_objects(uid);

INSERT OR IGNORE INTO calendars (id, name, display_name, description, created_at, updated_at)
VALUES ('default', 'default', 'Default Calendar', 'Default calendar for CalDAV', 
        unixepoch(), unixepoch());
