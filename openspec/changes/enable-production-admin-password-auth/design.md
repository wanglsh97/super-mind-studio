## Context

现有 `AdminAuthService` 仅比较固定 `root/123456`，生产环境通过
`ADMIN_FIXED_CREDENTIALS_ENABLED=false` 将登录整体关闭。管理员 API Guard、短期 JWT Cookie、登录限流和
操作审计已经存在，可以在不改变后台授权模型和数据库的前提下替换凭据验证。

## Goals / Non-goals

### Goals

- 生产环境使用独立、高熵、不可从服务器配置直接读取明文的管理员密码。
- 保持现有管理员 Session、Guard、限流、审计和 Web 登录表单契约。
- 配置不完整或哈希格式非法时拒绝启动。
- 固定开发凭据继续只允许非生产环境显式启用。

### Non-goals

- 管理员数据库表、RBAC、多账号、MFA、密码轮换 UI 或找回流程。
- 复用 GitHub/Google 普通用户登录作为管理员认证。

## Credential Model

新增配置：

- `ADMIN_PASSWORD_AUTH_ENABLED`: 默认 `false`，生产管理员密码登录总开关。
- `ADMIN_USERNAME`: 启用时必填，1–64 个可打印非空字符。
- `ADMIN_PASSWORD_HASH`: 启用时必填，格式为
  `scrypt-v1$<32 hex salt>$<128 hex derived key>`。

生成流程使用密码学安全随机源产生至少 24 字符明文密码和 16-byte salt，通过 Node.js `scryptSync` 默认
成本派生 64-byte key。明文密码只在受控终端生成并交付一次；`.env.production` 只写入哈希。

## Authentication Flow

1. Controller 继续执行管理员登录 IP 限流。
2. Service 优先使用显式启用的生产哈希凭据；非生产环境可使用固定开发凭据。
3. 用户名和派生 key 都使用恒定时间比较；任一不匹配返回相同 401。
4. 成功后签发既有短期管理员 JWT，claim 的 `sub` 和 Session `username` 使用配置的管理员用户名。
5. Cookie 继续为 Secure、HttpOnly、SameSite=Strict，路径限制在 `/api/v1/admin`。

## Configuration and Failure Handling

- `NODE_ENV=production` 且 `ADMIN_FIXED_CREDENTIALS_ENABLED=true`：拒绝启动。
- `ADMIN_PASSWORD_AUTH_ENABLED=true` 且用户名/哈希缺失或非法：拒绝启动。
- 两种认证模式都未启用：登录返回现有 503，不影响其他服务。
- 两种模式同时启用：配置校验拒绝，避免凭据优先级含糊。
- 错误响应、日志和配置校验不得包含用户名以外的凭据材料。

## Rollout and Rollback

部署前备份现有 `.env.production`，生成强密码和哈希，写入三个新配置并保持固定凭据关闭。执行完整发布脚本后
以新密码完成登录、Session、受保护 API、退出和错误密码验收。回滚时将
`ADMIN_PASSWORD_AUTH_ENABLED=false` 并重新部署；既有 Session 最迟在短 TTL 后失效，紧急吊销可同时轮换
`ADMIN_SESSION_SECRET`。

## Testing Strategy

- Service：正确/错误生产密码、错误用户名、非法哈希、动态 Session username、开发固定凭据。
- 环境校验：生产哈希模式成功、缺失字段、非法格式、两种模式冲突、生产固定凭据拒绝。
- Controller/Guard：登录、Session、退出和限流回归。
- 部署：Compose config、API/Web build、线上 readiness、正确密码登录和错误密码 401。
