## Context

Super Mind Studio 已有匿名用户端、NestJS API、PostgreSQL 请求日志和独立管理员会话。新增身份能力的目标是识别模型调用者，而不是建设通用账号平台。GitHub OAuth 负责证明外部身份；本地数据库负责用户映射、应用 Session、请求归属和资源授权。

## Goals / Non-goals

### Goals

- 三项用户能力强制 GitHub 登录，API 不信任客户端传入的用户标识。
- 使用稳定 GitHub 数字 ID 识别账号，允许 username、昵称、头像和邮箱随再次登录刷新。
- 使用可撤销的数据库 Session，支持多设备独立登录和退出。
- 每条新请求和图片任务具有数据库级必填用户关系。
- 管理员能从请求日志识别和筛选调用用户。

### Non-goals

- 独立账号密码、账号合并、用户中心、历史页面、额度和用户级限流。
- 用户禁用、后台用户管理或管理员认证改造。
- 保存 GitHub access token 或代表用户调用 GitHub 的长期能力。

## Architecture

```text
Browser -> GET /api/v1/auth/github -> GitHub authorize
GitHub -> GET /api/v1/auth/github/callback -> NestJS API
NestJS API -> GitHub token/user/emails endpoints
NestJS API -> User upsert + UserSession insert -> HttpOnly cookie
Browser -> @supermind/sdk -> SessionGuard -> CurrentUser
CurrentUser -> RequestLog / ImageGenerationTask ownership
```

OAuth 和用户 Session 全部由 NestJS 管理。Next.js 只调用 `GET /api/v1/auth/session` 恢复会话，通过同源地址跳转登录，并在页面展示返回的安全用户摘要。SDK 不接受 `userId` 参数。

## Data Model

`User`：

- `id`: 平台 UUID/CUID 主键。
- `githubId`: GitHub 数字 ID 的字符串表示，唯一且不可变。
- `githubUsername`: 当前 username，建立查询索引但不作为身份主键。
- `displayName`: 可空。
- `avatarUrl`: 可空，仅允许 GitHub 返回的 HTTPS URL。
- `email`: 可空，只保存 GitHub 返回的已验证主邮箱；没有邮箱不阻止登录。
- `createdAt`、`updatedAt`、`lastLoginAt`。

`UserSession`：

- `id`、`userId`、`tokenHash`（唯一）、`expiresAt`、`createdAt`、`lastSeenAt`。
- 浏览器 Cookie 保存高熵随机明文 token；数据库只保存密码学哈希。
- 固定有效期为登录成功后 30 天，不做滑动续期；允许同一用户多个 Session。
- 退出仅删除当前 Session；过期 Session 可在登录、认证或维护脚本中清理。

`RequestLog.userId` 与 `ImageGenerationTask.userId` 为必填外键并建立索引。`BillingRecord` 不重复保存用户 ID。项目尚未上线用户数据，本 change 不提供匿名历史回填；执行迁移前清理不兼容的开发测试记录。

## OAuth Security

- 使用 Authorization Code flow，生成一次性 `state` 并存入短期、HttpOnly、SameSite=Lax Cookie；callback 必须常量时间校验 state 并一次性消费。
- callback code 只能发送到 GitHub token endpoint，不得写入日志、错误 details 或前端 URL。
- 仅请求读取基础身份和邮箱所需 scope。GitHub access token 只在 callback 请求生命周期内使用，获取资料后立即丢弃，不落库、不进日志。
- 仅接受配置的 callback URL。开发与生产使用不同 OAuth App；生产 callback 和最终跳转必须为 HTTPS 域名。
- `returnTo` 只接受 `/chat`、`/image`、`/prompt` 等明确站内路径，拒绝绝对 URL、协议相对 URL和未知路径，防止开放重定向。
- Session Cookie 使用 HttpOnly、SameSite=Lax、限定 Path；生产强制 Secure。Session token 轮换发生在每次成功登录。

## Authorization Boundaries

- `POST /chat/completions`、`POST /images/generations`、Image 状态/下载、`POST /prompts/optimize` 使用统一 `UserSessionGuard`。
- Guard 从 Cookie 查找 `tokenHash`、检查固定过期时间并加载当前用户；请求 body/header 中的 `userId` 一律忽略或拒绝。
- `RequestLifecycleService.start` 必须接收服务端解析的用户 ID，并在 provider 调用前原子创建用户归属日志。
- Image 状态和下载查询同时使用 `taskId + userId`；不存在和不属于当前用户统一返回 404，避免泄露任务存在性。
- `/api/v1/models`、health、首页和 `/login` 保持公开。

## Web Behavior

- 未登录进入 `/chat`、`/image`、`/prompt` 时跳转 `/login?returnTo=...`。
- 登录页提供 GitHub 登录按钮、必要的邮箱 scope 提示和错误/重试状态。
- 登录成功后回到经过白名单验证的目标页；失败留在登录页并展示不泄露 GitHub token/code 的统一错误。
- 导航展示头像、username 和退出；头像加载失败时使用本地占位符。
- API 仍以 401 作为最终安全边界，前端路由保护不是授权依据。

## Admin Log Integration

管理员日志列表联表返回最小用户摘要：平台用户 ID、GitHub ID、username、avatar。支持精确 GitHub ID 与 username 搜索。日志详情可返回昵称和可选邮箱。Dashboard 聚合、用户端 API、Pino 日志不得输出邮箱或 Session/OAuth 凭证。

日志通过用户外键展示当前 GitHub资料；本 change 不额外保存每次请求时的 username 快照。GitHub ID 保持稳定，因而 username 变更不会破坏用户归属。

## Failure Handling

- GitHub OAuth/token/user API 超时或失败：不创建 User/Session，返回登录页可重试错误。
- GitHub 已验证主邮箱缺失：`email = null`，继续登录。
- User upsert 或 Session 写库失败：不设置认证 Cookie。
- Session 无效或过期：API 返回统一 401；Web 引导重新登录。
- Redis 状态不影响身份 Session 真源；原有付费请求限流策略保持不变。

## Testing Strategy

- OAuth client 使用注入式 HTTP client 和去敏 fixture，CI 不访问 GitHub。
- 单元测试覆盖 state、returnTo 白名单、资料映射、可选邮箱、token 哈希、固定过期和 Cookie 属性。
- 集成测试覆盖用户 upsert、多设备 Session、当前设备退出、过期 Session、三类能力 Guard、日志必填用户关系和 Image 越权 404。
- Web E2E 使用测试认证注入或 Mock OAuth callback，覆盖登录跳转、会话恢复、退出和三页保护。
- 生产只进行一次低风险真实 GitHub OAuth 冒烟，不输出授权 code/token。

## Rollout

1. 先添加数据库模型、认证模块和 Mock OAuth 测试，不开放页面强制跳转。
2. 接入 API Guard 和资源所有权，完成全套 Mock 回归。
3. 接入 `/login`、会话恢复和导航用户状态。
4. 开发 OAuth App 冒烟通过后部署；生产迁移前备份并清理不兼容的匿名测试记录。
5. 配置生产 OAuth App、HTTPS callback，完成登录、三能力、日志归属和越权验收。

## Risks

- GitHub 不可用时新用户不能登录；已有未过期本地 Session 仍可继续使用。
- 30 天固定 Session 在设备丢失时无法由用户自助撤销全部设备；本 change 接受该边界。
- 管理后台固定凭证及公网入口安全不属于本 change，仍是独立上线风险。
