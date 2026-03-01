# CF-Workers-CalDAV

基于 Cloudflare Workers + D1 + R2 + KV 的 CalDAV 服务器实现。

## 🌟 特性

- ✅ **CalDAV 协议支持** - 支持 VCALENDAR, VTODO, VJOURNAL
- ✅ **单用户多设备** - 支持多个设备同时同步
- ✅ **多平台客户端支持** - macOS, iOS, Android (DAVx⁵), Thunderbird
- ✅ **无服务器架构** - 基于 Cloudflare Workers，无需维护服务器
- ✅ **混合存储方案**:
  - **D1** - 存储日历元数据和索引
  - **R2** - 存储实际的 iCalendar 文件
  - **KV** - 存储会话和临时数据

## 📋 前置要求

- Node.js 16+ 和 npm
- Cloudflare 账户（免费版即可）
- Wrangler CLI（Cloudflare 的命令行工具）

## 🚀 快速开始

### 1. 克隆项目并安装依赖

```bash
# 安装 Node.js 依赖
npm install

# 安装 Wrangler CLI（如果还没有）
npm install -g wrangler

# 创建 Wrangler 配置文件
mv wrangler.toml.example wrangler.toml
```

### 2. 登录 Cloudflare

```bash
wrangler login
```

### 3. 创建 Cloudflare 资源

#### 3.1 创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create caldav_db

# 输出示例：
# ✅ Successfully created DB 'caldav_db'!
# 
# [[d1_databases]]
# binding = "DB"
# database_name = "caldav_db"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# 复制 database_id 并填写到 wrangler.toml 中
```

#### 3.2 初始化数据库表结构

```bash
wrangler d1 execute caldav_db --file=src/schema.sql
```

#### 3.3 创建 KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv namespace create CALDAV_KV

# 输出示例：
# ✅ Success!
# Add the following to your wrangler.toml:
# [[kv_namespaces]]
# binding = "KV"
# id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# 复制 id 并填写到 wrangler.toml 中
```

#### 3.4 创建 R2 存储桶

```bash
wrangler r2 bucket create caldav-calendars
```

### 4. 配置 wrangler.toml

编辑 `wrangler.toml` 文件：

```toml
name = "caldav-server"
main = "src/index.js"
compatibility_date = "2024-01-01"

# D1 数据库 - 填写步骤 3.1 获取的 database_id
[[d1_databases]]
binding = "DB"
database_name = "caldav_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"  # 替换为你的 database_id

# KV 命名空间 - 填写步骤 3.3 获取的 id
[[kv_namespaces]]
binding = "KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # 替换为你的 KV id

# R2 存储桶
[[r2_buckets]]
binding = "R2"
bucket_name = "caldav-calendars"

# 环境变量 - 请修改用户名和密码
[vars]
USERNAME = "admin"              # 修改为你的用户名
PASSWORD = "changeme"           # ⚠️ 请修改为安全的密码！
BASE_URL = "https://your-domain.workers.dev"  # 你的 Worker URL

# 启用日志（可选）
[observability]
enabled = true
head_sampling_rate = 1

[observability.logs]
enabled = true
invocation_logs = true
```

### 5. 部署

```bash
wrangler deploy
```

### 6. 测试部署

```bash
# 测试 .well-known 自动发现
curl -I https://your-domain.workers.dev/.well-known/caldav

# 测试认证和 PROPFIND
curl -X PROPFIND https://your-domain.workers.dev/caldav/ \
  -u admin:changeme \
  -H "Depth: 0"
```

## 🔧 常用命令

### 开发和部署

```bash
# 本地开发
wrangler dev

# 部署到生产环境
wrangler deploy

# 查看实时日志
wrangler tail --format pretty

# 查看部署状态
wrangler deployments list
```

### 数据库管理

```bash
# 查看所有日历
wrangler d1 execute caldav_db --command="SELECT * FROM calendars"

# 查看所有事件
wrangler d1 execute caldav_db --command="SELECT * FROM calendar_objects"

# 统计信息
wrangler d1 execute caldav_db --command="SELECT COUNT(*) as count FROM calendar_objects"

# 备份数据库
wrangler d1 export caldav_db --output=backup.sql

# 恢复数据库
wrangler d1 execute caldav_db --file=backup.sql

# 删除所有数据（谨慎使用！）
wrangler d1 execute caldav_db --command="DELETE FROM calendar_objects"
wrangler d1 execute caldav_db --command="DELETE FROM calendars"
```

### R2 存储管理

```bash
# 列出所有文件
wrangler r2 object list caldav-calendars

# 下载文件
wrangler r2 object get caldav-calendars/path/to/file.ics --file=local-file.ics

# 上传文件
wrangler r2 object put caldav-calendars/path/to/file.ics --file=local-file.ics

# 删除文件
wrangler r2 object delete caldav-calendars/path/to/file.ics
```

## 📱 客户端配置

### macOS / iOS (Apple 日历)

#### macOS 系统设置方式

1. 打开 **系统设置** → **互联网账户**
2. 点击 **添加账户** → **添加其他账户** → **CalDAV 账户**
3. 填写信息：
   - **账户类型**: 手动
   - **用户名**: 你配置的用户名
   - **密码**: 你配置的密码
   - **服务器地址**: `your-domain.workers.dev` （不需要 https:// 前缀）

#### iOS 设置方式

1. 打开 **设置** → **日历** → **账户** → **添加账户**
2. 选择 **其他** → **添加 CalDAV 账户**
3. 填写信息：
   - **服务器**: `your-domain.workers.dev`
   - **用户名**: 你配置的用户名
   - **密码**: 你配置的密码
   - **描述**: CalDAV Server（任意名称）

### Android (DAVx⁵)

1. 安装 [DAVx⁵](https://www.davx5.com/) 应用
2. 添加账户 → **使用 URL 和用户名登录**
3. 填写信息：
   - **基础 URL**: `https://caldav-server.your-subdomain.workers.dev/caldav/`
   - **用户名**: 你配置的用户名
   - **密码**: 你配置的密码

## 🔍 技术细节

### CalDAV 协议支持

本服务器实现了以下 CalDAV 方法：

- **PROPFIND** - 查询资源属性（日历、事件列表）
- **REPORT** - 日历查询（calendar-query, calendar-multiget）
- **GET** - 获取事件内容
- **PUT** - 创建/更新事件（支持 If-Match, If-None-Match）
- **DELETE** - 删除事件
- **MKCALENDAR** - 创建新日历
- **OPTIONS** - 服务器能力声明

### 存储架构

#### D1 数据库（元数据）

- **calendars** 表 - 日历信息
  - id, name, display_name, description, color, timezone
  - created_at, updated_at, sync_token

- **calendar_objects** 表 - 事件元数据
  - id, calendar_id, uid, etag
  - content_type, size, created_at, updated_at

#### R2 存储（文件内容）

- 路径: `{calendar_id}/{object_id}.ics`
- 存储完整的 iCalendar 文件内容

#### KV 存储（会话/缓存）

- 预留用于会话管理和缓存

### CalDAV 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/.well-known/caldav` | GET | 服务发现（301 重定向） |
| `/` | PROPFIND | 根路径服务发现 |
| `/caldav/` | PROPFIND | 用户主目录 |
| `/principals/` | PROPFIND | macOS/iOS 专用路径 |
| `/calendar/dav/{user}/user/` | PROPFIND | macOS 专用路径 |
| `/caldav/calendars/` | PROPFIND | 日历列表 |
| `/caldav/calendars/{id}/` | PROPFIND, REPORT, MKCALENDAR | 日历操作 |
| `/caldav/calendars/{id}/{event}.ics` | GET, PUT, DELETE | 事件操作 |

## 🔐 安全建议

1. **强密码** - 使用强密码，不要使用默认的 `changeme`。可以使用 python 生成安全密码
2. **HTTPS Only** - Cloudflare Workers 自动提供 HTTPS，禁止 HTTP 访问
3. **定期更新密码** - 定期修改 `wrangler.toml` 中的 PASSWORD 并重新部署
4. **限制访问** - 可以通过 Cloudflare 的 Access 功能添加额外的安全层（IP 白名单、双因素认证）
5. **定期备份** - 使用 `wrangler d1 export` 定期备份数据库
6. **监控日志** - 通过 `wrangler tail` 或 Cloudflare 仪表板监控异常访问

## 🐛 故障排除

### 认证失败

- 检查用户名和密码是否正确
- 确保 `wrangler.toml` 中的配置已应用（重新部署）

### 404 错误

- 检查 URL 是否正确
- 确认 Worker 已成功部署：`wrangler deployments list`

### D1 错误

- 确认数据库已创建并初始化
- 检查 `wrangler.toml` 中的 database_id

### R2 错误

- 确认存储桶已创建
- 检查 bucket_name 是否匹配

## 📝 限制和注意事项

1. **免费限额** - Cloudflare 免费版有使用限额：
   - Workers: 100,000 请求/天
   - D1: 5GB 存储，500 万行读取/天
   - R2: 10GB 存储，100 万次操作/月
   - KV: 100,000 读取/天，1,000 写入/天

2. **单用户设计** - 当前实现仅支持单个用户（多设备）

3. **简化实现** - 这是一个简化的 CalDAV 实现，可能不支持所有高级特性

## 🔄 升级和维护

### 更新代码

```bash
git pull  # 如果你从仓库克隆
wrangler deploy
```

### 数据库迁移

如果需要修改 schema：

```bash
# 1. 备份当前数据
wrangler d1 execute caldav_db --command="SELECT * FROM calendars"

# 2. 运行新的迁移脚本
wrangler d1 execute caldav_db --file=migrations/001_migration.sql
```

## 📄 许可证

MIT License
