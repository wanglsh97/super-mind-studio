## Why

管理员后台已经部署到公网，但现有认证只接受固定开发凭据 `root/123456`，并由生产环境启动校验强制关闭。
用户最新明确决定不升级认证体系，线上与本地使用相同的固定账号密码，因此需要移除生产环境的启动硬门槛，
并在生产配置中显式打开固定凭据。

## What Changes

- `ADMIN_FIXED_CREDENTIALS_ENABLED=true` 在生产环境不再触发配置校验失败。
- 生产和本地继续共用固定凭据 `root/123456`，不新增管理员表、哈希配置或外部认证。
- 管理员 Session 继续使用短期签名 Secure/HttpOnly/SameSite=Strict Cookie，登录继续受独立 IP 限流保护。
- API 启动日志明确提示固定凭据在公网环境的高风险。
- 部署手册记录显式启用、风险和关闭开关的回滚方式。

## Capabilities

### Modified Capabilities

- `admin-console`: 允许生产环境显式启用现有固定管理员凭据。

## Impact

- API 环境校验、启动安全提示和单元测试。
- ECS 部署手册与生产私有环境配置。
- 不修改数据库结构，不建立管理员用户表或 RBAC。

## Non-goals

- 多管理员、RBAC、密码找回、MFA、第三方管理员 OAuth 或后台自助修改密码。
- 将普通 UserSession 与管理员 Session 合并。
- 更换固定用户名或密码。
- 声称现有 IP 限流足以把固定弱密码变成安全的公网认证方案。

## Acceptance and Rollback Boundary

验收要求生产以 `ADMIN_FIXED_CREDENTIALS_ENABLED=true` 启动，`root/123456` 登录后获得短期管理员 Session，
错误密码返回统一 401，受保护 API 必须校验 Session。回滚只需将开关改为 `false` 并重新部署，不涉及数据库恢复。
