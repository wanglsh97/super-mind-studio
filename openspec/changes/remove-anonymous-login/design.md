## Context

当前 User 使用 `(authProvider, providerUserId)` 唯一识别身份，匿名登录则每次创建不可恢复的新 User。长期知识库
必须绑定到可重复登录的账号，因此要同时关闭匿名身份创建和既有匿名 Session 的授权能力。

## Goals / Non-goals

### Goals

- 只有 GitHub 与 Google OAuth 可以创建用户 Session。
- 匿名登录端点不存在，Web 不提供匿名入口。
- 历史匿名 Session 不再通过统一用户鉴权边界。
- 保留历史数据，避免静默删除用户产物或审计记录。

### Non-goals

- 清理历史匿名数据或修改 `AuthProvider` 数据库枚举。
- 将同一自然人的 GitHub 与 Google 身份合并为一个 User。
- 在本 change 中设计或实现知识库。

## Architecture and Decisions

认证链路只保留：

```text
GitHub/Google OAuth -> UserService upsert -> UserSession -> UserSessionGuard -> 用户能力
```

删除 Controller 的匿名路由和 Web helper，保证新匿名 User 无公开创建入口。`UserSessionService.read` 在返回用户前
检查历史 Session 对应 User；若 Provider 为 `ANONYMOUS`，删除该 Session 并返回现有 401。该检查位于统一 Session
边界，因此 Agent、Skill、文件及未来知识库无需分别增加匿名判断。

数据库暂时保留 `ANONYMOUS`，因为 PostgreSQL enum 删除值和历史数据清理都属于独立、不可逆的数据治理工作。
管理员审计页面仍可显示或筛选历史匿名记录，不能将其理解为仍支持匿名登录。

## Failure Handling and Rollback

- 匿名登录 URL 由 NestJS 返回 404，不提供兼容重定向或替代 Session。
- 历史匿名 Session 返回与其他无效 Session 相同的 401，且 best-effort 在同次请求内撤销记录。
- GitHub/Google 均未配置时应用仍可启动，但用户无法登录；部署必须至少启用一个 OAuth Provider。
- 回滚恢复路由、客户端和 Session 接受逻辑即可，不需要数据库回滚。

## Testing Strategy

- Controller/Web unit：不存在匿名 helper 和交互，OAuth 两入口保持正常。
- Session unit：历史匿名 Session 被删除并返回 401。
- API E2E：`POST /api/v1/auth/anonymous` 返回 404 且不创建 User/Session。
- 运行 API/Web 相关测试、typecheck、build 和 OpenSpec strict validation。
