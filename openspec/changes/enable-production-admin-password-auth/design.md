## Context

现有 `AdminAuthService` 仅比较固定 `root/123456`，生产环境通过
`ADMIN_FIXED_CREDENTIALS_ENABLED=false` 将登录整体关闭。管理员 API Guard、短期 JWT Cookie、登录限流和
操作审计已经存在。用户明确选择让生产与本地共用固定账号密码，并接受不升级认证体系的风险。

## Goals / Non-goals

### Goals

- 允许生产环境显式启用现有固定凭据。
- 保持现有管理员 Session、Guard、限流、审计和 Web 登录表单契约不变。
- 不增加额外环境变量或数据库结构。
- 通过启动日志与部署文档记录风险和回滚方式。

### Non-goals

- 管理员数据库表、RBAC、多账号、MFA、密码轮换 UI 或找回流程。
- 复用 GitHub/Google 普通用户登录作为管理员认证。
- 对固定弱密码提供安全等价保证。

## Credential Model

沿用现有 `ADMIN_FIXED_CREDENTIALS_ENABLED`：

- `false`：管理员登录返回 503，其他服务不受影响。
- `true`：接受固定用户名 `root` 和固定密码 `123456`；开发、测试和生产语义一致。

仓库模板继续保持 `false` 的安全默认值；仅线上私有 `.env.production` 按用户决定设为 `true`。

## Authentication Flow

1. Controller 执行现有管理员登录 IP 限流（默认 5 次/IP/分钟）。
2. Service 使用恒定时间比较验证 `root/123456`，不匹配统一返回 401。
3. 成功后签发既有短期管理员 JWT。
4. Cookie 继续为 Secure、HttpOnly、SameSite=Strict，路径限制在 `/api/v1/admin`。
5. 其他管理员 API 继续由 Guard 校验 Session，数据修改继续写入审计日志。

IP 限流只约束单个来源，不能阻止分布式猜测。固定凭据泄漏后，攻击者可读取完整 Prompt 和管理数据，并执行
后台允许的修改或删除操作，因此该决定属于明确接受的高风险临时配置。

## Rollout and Rollback

部署前备份现有 `.env.production`，将 `ADMIN_FIXED_CREDENTIALS_ENABLED=true` 后执行完整发布脚本。验收登录、
Session、受保护 API、退出和错误密码。回滚时将开关恢复为 `false` 并重新部署；既有 Session 最迟在短 TTL
后失效，紧急吊销可同时轮换 `ADMIN_SESSION_SECRET`。

## Testing Strategy

- Service：正确/错误固定密码、错误用户名、关闭开关和固定 Session username。
- 环境校验：生产环境显式开启与关闭固定凭据均可启动，生产 Session Secret 仍必须独立配置。
- Controller/Guard：登录、Session、退出和限流回归。
- 部署：API/Web build、线上 readiness、正确密码登录、受保护 API 和错误密码 401。
