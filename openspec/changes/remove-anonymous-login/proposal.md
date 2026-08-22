## Why

知识库等长期能力需要稳定、可恢复的唯一账号归属。一次性匿名身份在 Cookie 丢失或 Session 到期后无法恢复，
会产生无人可重新访问的持久数据，因此不再适合作为用户入口。

## What Changes

- 删除 Web 登录页的匿名入口和匿名登录客户端。
- 删除 `POST /api/v1/auth/anonymous`，只允许 GitHub 与 Google OAuth 创建用户 Session。
- 既有匿名 Session 在后续校验时立即失效，不能继续访问 Agent、Skill、文件或未来知识库。
- 保留数据库 `ANONYMOUS` 枚举和既有匿名 User/业务记录，避免本 change 引入破坏性数据清理。
- 更新产品、技术、部署和 API 文档，将稳定 OAuth 账号作为用户能力前提。

## Capabilities

### Modified Capabilities

- `user-authentication`: 用户登录来源由匿名、GitHub、Google 收敛为 GitHub 与 Google OAuth。

## Impact

- Web 登录页、认证客户端和测试不再包含匿名登录。
- API 不再暴露匿名登录路由，并拒绝历史匿名 Session。
- 无 Prisma schema 或 migration 变更；历史匿名数据保留但不可通过用户 Session 访问。
- 知识库能力不在本 change 实现，只建立其稳定账号前提。

## Non-goals

- 实现知识库、账号绑定、跨 Provider 合并或邮箱密码登录。
- 删除、迁移或重新归属历史匿名 User 及其业务数据。
- 改变 GitHub/Google OAuth 的身份唯一键或管理员认证。

## Acceptance and Rollback Boundary

验收要求登录页仅显示 GitHub 和 Google；匿名登录 API 返回 404；历史匿名 Session 返回 401 并被撤销；
GitHub/Google 登录、Session 恢复和退出保持正常。回滚只需恢复应用代码；历史数据未删除，无数据库回滚步骤。
