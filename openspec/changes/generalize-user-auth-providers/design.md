## Context

现有系统已由 NestJS 维护 `UserSession`，所有请求、图片、Agent、Skill 和文件均通过平台 `User.id` 归属。
问题集中在身份入口：`User` 表和 Session profile 直接保存并暴露 GitHub 字段，当前未完成的匿名方案还会
派生伪 `githubId`。新增 Google 后若继续扩展可空 Provider 字段，将使业务代码长期依赖登录厂商。

本 change 保持模块化单体和现有 Session/授权边界，只替换身份建模与登录入口。用户已确认旧数据库无需保留，
因此不设计历史回填或双写兼容期。

## Goals / Non-goals

### Goals

- 所有业务模块只识别平台 User UUID 和通用公开 profile。
- 匿名、GitHub、Google 分别映射为一个独立 User，永不合并。
- OAuth 再次登录按 Provider 稳定 ID 复用 User 并刷新可变资料。
- 匿名登录每次创建新 User，不提供恢复能力，但权限和数据生命周期与 OAuth 用户相同。
- 保留现有 30 天固定数据库 Session、多设备会话和资源所有权能力。
- 管理员可按通用身份来源、名称和 Provider ID 定位请求。

### Non-goals

- 多身份绑定到同一 User、邮箱归并或冲突合并 UI。
- 匿名用户清理、回收、功能限制和成本策略调整。
- OAuth refresh token、长期 access token、账号中心或用户资料编辑。

## Architecture

```text
Anonymous Controller --------------------\
GitHub OAuth Client -> normalized input ---+-> UserService -> User -> UserSession
Google OAuth Client -> normalized input ---/

UserSessionGuard -> AuthenticatedUser -> Request/Image/Agent/Skill/File services
Admin logs -> User relation -> generic user summary
```

`UserModule` 提供 `UserService` 与 User Repository，接收统一输入：

```ts
type AuthProvider = 'ANONYMOUS' | 'GITHUB' | 'GOOGLE'

interface AuthIdentityInput {
  authProvider: AuthProvider
  providerUserId: string
  userName: string
  avatarUrl: string | null
  email: string | null
}
```

`UserAuthModule` 持有三种登录流程、OAuth state、Provider Client、Session Service 和 Guard。GitHub/Google 原始
响应类型不得越过 Provider Client。业务模块只消费：

```ts
interface AuthenticatedUser {
  id: string
  authProvider: AuthProvider
  userName: string
  avatarUrl: string | null
}
```

## Data Model

`User`：

- `id`: 平台 UUID 主键，所有业务外键继续引用此字段。
- `authProvider`: `ANONYMOUS | GITHUB | GOOGLE`。
- `providerUserId`: Provider 稳定身份；GitHub numeric ID 字符串、Google OIDC `sub` 或匿名随机值。
- `userName`: 非唯一通用展示名称。
- `avatarUrl/email`: 可空；仅服务端持久化 email。
- `lastLoginAt/createdAt/updatedAt`。
- 复合唯一约束 `(authProvider, providerUserId)`；`userName` 建普通筛选索引。

不增加 `UserIdentity` 表。一个 User 只代表一种登录来源，也不提供改变 Provider 的操作。

映射：

| Provider | providerUserId | userName | email |
| --- | --- | --- | --- |
| Anonymous | 服务端高熵随机值 | `Anonymous User` | `null` |
| GitHub | profile `id` | profile `login` | 已验证主邮箱或 `null` |
| Google | OIDC `sub` | `name ?? verifiedEmail ?? "Google User"` | `email_verified=true` 时的邮箱，否则 `null` |

## Login and Session Flows

### Anonymous

`POST /api/v1/auth/anonymous` 不接收身份请求体。每次请求生成新的 Provider ID，创建新 User 和 UserSession，
并覆盖当前 Session Cookie。服务端不读取设备指纹，Web 不保存匿名身份。退出、Cookie 丢失或固定 Session
过期后，原匿名 User 不可恢复；其数据按现有永久保留规则继续存在。

### OAuth

GitHub 与 Google 使用独立 authorize/callback 路由和 Provider-bound OAuth state。callback 交换 code、获取并
校验资料、映射为 `AuthIdentityInput`，再按 `(authProvider, providerUserId)` upsert User。可变资料和
`lastLoginAt` 在每次成功登录刷新。

Google 请求最小 `openid profile email` scope，以 `sub` 为唯一身份。缺失/未验证 email 不拒绝登录，不按 email
查询 User。Provider access token、ID token、authorization code 和 Session token 均不持久化或记录。

### Session

三种登录共用现有 Session Cookie、数据库哈希 token 和 30 天固定有效期。每次登录创建新 Session 并覆盖
Cookie，不主动撤销此前 Session；退出只撤销当前 Cookie 指向的 Session。其他设备 Session 不受影响。

## Provider Configuration

- Anonymous 无开关，所有环境始终可用。
- GitHub/Google 各自拥有 `*_OAUTH_ENABLED`。
- 未启用时对应入口返回 `503 AUTH_PROVIDER_DISABLED`，应用仍可启动。
- 声明启用时 client ID、client secret、callback URL 必须完整，否则配置校验失败。
- Google 新增 client ID、client secret、callback URL 和 HTTP timeout。

## API and Admin Boundaries

普通 Session 响应只返回平台 `id`、`authProvider`、`userName`、`avatarUrl`，不返回 `providerUserId` 或 email。
管理日志列表返回 `id/authProvider/userName/avatarUrl`，支持 Provider 与名称筛选；Provider ID 只允许管理员
详情与精确筛选使用。所有 GitHub 专属标签、DTO 参数和文档改为通用术语。

## Failure Handling

- OAuth state 缺失、过期、重放或跨 Provider 使用：拒绝且不创建 Session。
- Provider 响应缺少稳定 ID：归一化为不可重试认证响应错误。
- Google email 缺失或未验证：保存 `null`，继续登录。
- User 或 Session 写库失败：不设置 Cookie。
- OAuth Provider 未启用：返回统一 `AUTH_PROVIDER_DISABLED`。
- Session 无效/过期：保持现有 401 行为。

## Migration and Rollback

正式 migration 删除 GitHub 专属列并建立通用列/约束。因为已确认不保留旧数据，部署前清空所有引用 User 的
业务数据或重建数据库；migration 不猜测或回填身份。生产执行前必须备份。回滚使用备份或数据库重置。

## Testing Strategy

- UserService：三 Provider 创建、OAuth upsert、同 email 不合并、复合唯一性、资料刷新。
- Provider Client：GitHub/Google code exchange、资料映射、缺失 email、未验证 email、超时和错误归一化。
- OAuth state：Provider 绑定、过期、重放、开放重定向。
- Session/API E2E：三入口、重复 OAuth、重复匿名产生不同 User、退出、过期、资源归属。
- Web：三登录入口、匿名无 fingerprint、Session profile、禁用 Provider 错误。
- Admin：通用摘要、Provider/名称/Provider ID 筛选和公开响应隐私边界。
- 全量 format、lint、typecheck、unit、Mock E2E、build、Prisma validate 与 OpenSpec strict validate。
