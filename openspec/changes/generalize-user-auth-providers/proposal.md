## Why

当前 `User`、Session DTO、管理日志和认证 Service 都以 `githubId/githubUsername` 为核心，新增匿名和
Google 登录只能通过伪造 GitHub 字段复用旧模型。这会把厂商身份泄漏到业务模块，且 Google 没有 GitHub
username 语义。需要将平台内部 User 与具体登录协议解耦，并以统一模型承载三种登录来源。

## What Changes

- 将 `User` 改为通用字段：平台 UUID、`authProvider`、`providerUserId`、`userName`、头像、邮箱和登录时间；
  以 `(authProvider, providerUserId)` 唯一识别登录身份。
- 新增 `UserModule`，集中负责通用 User 的查询、创建和资料刷新；`UserAuthModule` 只负责登录协议、Provider
  Client、OAuth state 和 Session。
- 保留 GitHub OAuth，新增 Google Authorization Code + OIDC 登录；Google 使用稳定 `sub` 识别身份，未验证
  或缺失邮箱不阻止登录。
- 新增一次性匿名登录。每次调用均创建全新的 User 和 30 天固定 Session，不使用设备指纹、localStorage
  身份或账号恢复机制。
- 三种身份永远独立。系统不按邮箱合并、不绑定、不解绑、不迁移数据；相同自然人使用不同 Provider 时得到
  不同平台 User。
- 匿名用户与 OAuth 用户拥有相同功能和数据保留规则；匿名 Session 失效后不可恢复，但其业务数据永久保留。
- Session API、用户端导航和管理日志改用通用用户字段，移除所有 GitHub 专属业务文案和筛选字段。
- 匿名登录在所有环境始终可用。GitHub 与 Google 独立启用；未启用时登录入口返回统一禁用错误，声明启用但
  配置不完整时应用启动失败。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `user-authentication`: 从 GitHub 单一身份扩展为匿名、GitHub、Google 三种独立身份，并引入 Provider-neutral
  User 模型。
- `admin-console`: 请求日志按通用用户来源、名称和 Provider ID 展示与筛选。
- `observability-billing`: 用户归属继续使用平台 UUID，不再依赖 GitHub 字段。

## Impact

- Prisma `User` 删除 `githubId/githubUsername/displayName`，新增 `authProvider/providerUserId/userName` 和复合
  唯一约束；所有既有业务外键继续引用 `User.id`。
- API 新增 `UserModule`、Google OAuth client 和 Google 登录路由，并重构现有 GitHub/匿名/Session 代码。
- Web 登录页增加 Google 入口并移除设备指纹逻辑；Session profile、导航、管理日志全面改用通用字段。
- 新增 Google OAuth 环境变量；移除 `ALLOW_ANONYMOUS_LOGIN`。
- 本 change 不兼容旧数据库数据。已确认可重置 User 及全部关联业务数据，不提供历史回填。

## Non-goals

- 账号绑定、解绑、合并、跨 Provider 数据迁移或通过邮箱识别同一自然人。
- 匿名身份恢复、设备指纹、匿名数据清理或匿名功能限制。
- 本地邮箱密码、用户中心、全设备退出、OAuth token 持久化或代表用户调用 Provider API。
- 修改独立管理员认证体系。

## Acceptance and Rollback Boundary

验收要求三种登录方式在 dev 与 production 采用相同行为；相同邮箱的 GitHub/Google fixture 创建不同 User；
重复 OAuth 登录复用同 Provider 身份；每次匿名登录创建不同 User；Session、业务授权和管理日志只使用通用
用户字段。CI 不访问真实 OAuth Provider。

回滚前必须停止新登录和业务写入。由于数据库迁移不兼容旧 User 结构，回滚只允许恢复发布前 PostgreSQL
备份或重置数据库，不能依赖反向字段转换。
