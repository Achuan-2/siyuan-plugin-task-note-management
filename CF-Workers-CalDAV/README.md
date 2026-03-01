# CF-Workers-CalDAV

A CalDAV server implementation based on Cloudflare Workers + D1 + R2 + KV.

## 🌟 Features

- ✅ **CalDAV Protocol Support** - Support VCALENDAR, VTODO, VJOURNAL
- ✅ **Single User, Multiple Devices** - Support synchronization across multiple devices
- ✅ **Multi-Platform Client Support** - macOS, iOS, Android (DAVx⁵), Thunderbird
- ✅ **Serverless Architecture** - Based on Cloudflare Workers, no server maintenance required
- ✅ **Hybrid Storage Solution**:
  - **D1** - Store calendar metadata and indexes
  - **R2** - Store actual iCalendar files
  - **KV** - Store sessions and temporary data

## 📋 Prerequisites

- Node.js 16+ and npm
- Cloudflare account (free tier works)
- Wrangler CLI (Cloudflare's command-line tool)

## 🚀 Quick Start

### 1. Clone Project and Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install Wrangler CLI (if not already installed)
npm install -g wrangler

# Create Wrangler configuration file
mv wrangler.toml.example wrangler.toml
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Create Cloudflare Resources

#### 3.1 Create D1 Database

```bash
# Create database
wrangler d1 create caldav_db

# Example output:
# ✅ Successfully created DB 'caldav_db'!
# 
# [[d1_databases]]
# binding = "DB"
# database_name = "caldav_db"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Copy the database_id and fill it in wrangler.toml
```

#### 3.2 Initialize Database Schema

```bash
wrangler d1 execute caldav_db --file=src/schema.sql
```

#### 3.3 Create KV Namespace

```bash
# Create KV namespace
wrangler kv namespace create CALDAV_KV

# Example output:
# ✅ Success!
# Add the following to your wrangler.toml:
# [[kv_namespaces]]
# binding = "KV"
# id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Copy the id and fill it in wrangler.toml
```

#### 3.4 Create R2 Bucket

```bash
wrangler r2 bucket create caldav-calendars
```

### 4. Configure wrangler.toml

Edit the `wrangler.toml` file:

```toml
name = "caldav-server"
main = "src/index.js"
compatibility_date = "2024-01-01"

# D1 Database - Fill in the database_id from step 3.1
[[d1_databases]]
binding = "DB"
database_name = "caldav_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # Replace with your database_id

# KV Namespace - Fill in the id from step 3.3
[[kv_namespaces]]
binding = "KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # Replace with your KV id

# R2 Bucket
[[r2_buckets]]
binding = "R2"
bucket_name = "caldav-calendars"

# Environment Variables - Please modify username and password
[vars]
USERNAME = "admin"              # Change to your username
PASSWORD = "changeme"           # ⚠️ Change to a secure password!
BASE_URL = "https://your-domain.workers.dev"  # Your Worker URL

# Enable logging (optional)
[observability]
enabled = true
head_sampling_rate = 1

[observability.logs]
enabled = true
invocation_logs = true
```

### 5. Deploy

```bash
wrangler deploy
```

### 6. Test Deployment

```bash
# Test .well-known auto-discovery
curl -I https://your-domain.workers.dev/.well-known/caldav

# Test authentication and PROPFIND
curl -X PROPFIND https://your-domain.workers.dev/caldav/ \
  -u admin:changeme \
  -H "Depth: 0"
```

## 🔧 Common Commands

### Development and Deployment

```bash
# Local development
wrangler dev

# Deploy to production
wrangler deploy

# View real-time logs
wrangler tail --format pretty

# View deployment status
wrangler deployments list
```

### Database Management

```bash
# View all calendars
wrangler d1 execute caldav_db --command="SELECT * FROM calendars"

# View all events
wrangler d1 execute caldav_db --command="SELECT * FROM calendar_objects"

# Statistics
wrangler d1 execute caldav_db --command="SELECT COUNT(*) as count FROM calendar_objects"

# Backup database
wrangler d1 export caldav_db --output=backup.sql

# Restore database
wrangler d1 execute caldav_db --file=backup.sql

# Delete all data (use with caution!)
wrangler d1 execute caldav_db --command="DELETE FROM calendar_objects"
wrangler d1 execute caldav_db --command="DELETE FROM calendars"
```

### R2 Storage Management

```bash
# List all files
wrangler r2 object list caldav-calendars

# Download file
wrangler r2 object get caldav-calendars/path/to/file.ics --file=local-file.ics

# Upload file
wrangler r2 object put caldav-calendars/path/to/file.ics --file=local-file.ics

# Delete file
wrangler r2 object delete caldav-calendars/path/to/file.ics
```

## 📱 Client Configuration

### macOS / iOS (Apple Calendar)

#### macOS System Settings

1. Open **System Settings** → **Internet Accounts**
2. Click **Add Account** → **Add Other Account** → **CalDAV Account**
3. Fill in information:
   - **Account Type**: Manual
   - **Username**: Your configured username
   - **Password**: Your configured password
   - **Server Address**: `your-domain.workers.dev` (no https:// prefix needed)

#### iOS Settings

1. Open **Settings** → **Calendar** → **Accounts** → **Add Account**
2. Select **Other** → **Add CalDAV Account**
3. Fill in information:
   - **Server**: `your-domain.workers.dev`
   - **Username**: Your configured username
   - **Password**: Your configured password
   - **Description**: CalDAV Server (any name)

### Android (DAVx⁵)

1. Install [DAVx⁵](https://www.davx5.com/) app
2. Add account → **Login with URL and username**
3. Fill in information:
   - **Base URL**: `https://caldav-server.your-subdomain.workers.dev/caldav/`
   - **Username**: Your configured username
   - **Password**: Your configured password

### Thunderbird

1. Install [TbSync](https://addons.thunderbird.net/thunderbird/addon/tbsync/) and [Provider for CalDAV & CardDAV](https://addons.thunderbird.net/thunderbird/addon/dav-4-tbsync/) add-ons
2. Tools → Synchronization Settings (TbSync) → Account Actions → Add new account → CalDAV & CardDAV
3. Choose **Manual configuration**
4. Fill in information:
   - **Account name**: CalDAV Server (any name)
   - **Username**: Your configured username
   - **Password**: Your configured password
   - **CalDAV server**: `https://your-domain.workers.dev/caldav/`

## 🔍 Technical Details

### CalDAV Protocol Support

This server implements the following CalDAV methods:

- **PROPFIND** - Query resource properties (calendars, event lists)
- **REPORT** - Calendar queries (calendar-query, calendar-multiget)
- **GET** - Retrieve event content
- **PUT** - Create/update events (supports If-Match, If-None-Match)
- **DELETE** - Delete events
- **MKCALENDAR** - Create new calendars
- **OPTIONS** - Server capability declaration

### Storage Architecture

#### D1 Database (Metadata)

- **calendars** table - Calendar information
  - id, name, display_name, description, color, timezone
  - created_at, updated_at, sync_token

- **calendar_objects** table - Event metadata
  - id, calendar_id, uid, etag
  - content_type, size, created_at, updated_at

#### R2 Storage (File Content)

- Path: `{calendar_id}/{object_id}.ics`
- Stores complete iCalendar file content

#### KV Storage (Sessions/Cache)

- Reserved for session management and caching

### CalDAV Endpoints

| Endpoint | Methods | Description |
|----------|---------|-------------|
| `/.well-known/caldav` | GET | Service discovery (301 redirect) |
| `/` | PROPFIND | Root path service discovery |
| `/caldav/` | PROPFIND | User home directory |
| `/principals/` | PROPFIND | macOS/iOS specific path |
| `/calendar/dav/{user}/user/` | PROPFIND | macOS specific path |
| `/caldav/calendars/` | PROPFIND | Calendar list |
| `/caldav/calendars/{id}/` | PROPFIND, REPORT, MKCALENDAR | Calendar operations |
| `/caldav/calendars/{id}/{event}.ics` | GET, PUT, DELETE | Event operations |

## 🔐 Security Recommendations

1. **Strong Password** - Use a strong password, don't use the default `changeme`. You can use Python to generate a secure password
2. **HTTPS Only** - Cloudflare Workers automatically provide HTTPS, disable HTTP access
3. **Regular Password Updates** - Periodically change the PASSWORD in `wrangler.toml` and redeploy
4. **Restrict Access** - Add additional security layers through Cloudflare Access (IP whitelist, two-factor authentication)
5. **Regular Backups** - Regularly backup your database using `wrangler d1 export`
6. **Monitor Logs** - Monitor abnormal access through `wrangler tail` or Cloudflare dashboard

## 🐛 Troubleshooting

### Authentication Failure

- Check if username and password are correct
- Ensure configuration in `wrangler.toml` is applied (redeploy)

### 404 Errors

- Check if URL is correct
- Confirm Worker is successfully deployed: `wrangler deployments list`

### D1 Errors

- Confirm database is created and initialized
- Check database_id in `wrangler.toml`

### R2 Errors

- Confirm bucket is created
- Check if bucket_name matches

## 📝 Limitations and Notes

1. **Free Tier Limits** - Cloudflare free tier has usage limits:
   - Workers: 100,000 requests/day
   - D1: 5GB storage, 5 million reads/day
   - R2: 10GB storage, 1 million operations/month
   - KV: 100,000 reads/day, 1,000 writes/day

2. **Single User Design** - Current implementation only supports a single user (multiple devices)

3. **Simplified Implementation** - This is a simplified CalDAV implementation and may not support all advanced features

## 🔄 Updates and Maintenance

### Update Code

```bash
git pull  # If you cloned from repository
wrangler deploy
```

### Database Migration

If you need to modify the schema:

```bash
# 1. Backup current data
wrangler d1 execute caldav_db --command="SELECT * FROM calendars"

# 2. Run new migration script
wrangler d1 execute caldav_db --file=migrations/001_migration.sql
```

## 📄 License

MIT License

## 🌐 Language

- [中文文档](README_zh.md)
