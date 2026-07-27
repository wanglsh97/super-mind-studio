# GitHub 用户认证实施任务

## 1. 身份数据与 OAuth 基础

- [x] 1.1 更新 Prisma schema，新增 `User`、`UserSession`，为 `RequestLog` 和 `ImageGenerationTask` 增加必填用户关系、唯一约束和筛选索引
- [x] 1.2 创建正式 Prisma migration，并提供迁移前清理匿名开发测试记录的显式步骤，不在迁移中静默猜测或回填用户
- [x] 1.3 扩展 API 配置与 `.env.example`，校验 GitHub client、callback、Session secret 和 30 天固定有效期，确保 secret 不进入日志或响应
- [x] 1.4 实现可注入 HTTP client 的 GitHub OAuth client，覆盖 token、profile、已验证主邮箱映射和超时/错误归一化
- [x] 1.5 实现 OAuth state、callback URL 和 `returnTo` 白名单校验，拒绝伪造、重放与开放重定向
- [x] 1.6 实现 User upsert 和数据库 UserSession：高熵 token、仅存哈希、多设备独立 Session、固定 30 天过期和过期清理
- [x] 1.7 实现 `/api/v1/auth/github`、callback、session、logout API 及生产安全 Cookie，GitHub access token 仅在 callback 生命周期内存在
- [x] 1.8 添加 OAuth/Session 单元与集成测试，CI 全程使用 fixture，不访问真实 GitHub

## 2. 付费能力认证与数据归属

- [x] 2.1 实现统一 `UserSessionGuard` 和 current-user 注入，所有业务 Service 只接受服务端解析的用户身份
- [x] 2.2 保护 Chat 和 Prompt 优化 API，在 Adapter 调用前创建带必填 `userId` 的 RequestLog，并保持原有 IP 限流
- [x] 2.3 保护 Image 创建、状态和下载 API，为任务写入必填 `userId`，使用 `taskId + userId` 校验所有权并对越权统一返回 404
- [x] 2.4 更新 `@supermind/sdk` 的 401/session 相关 typed error 行为，不增加或透传客户端 `userId`
- [x] 2.5 更新 Mock Adapter、测试 factory 和数据库清理工具，为所有付费路径提供确定性测试用户和 Session
- [x] 2.6 添加 API/SDK 集成与 E2E，覆盖匿名 401、登录成功、日志归属、图片跨用户越权、多设备 Session、过期和当前设备退出

## 3. Web 登录与会话体验

- [x] 3.1 新增 `/login` 页面，提供 GitHub 登录按钮、邮箱 scope 说明、loading、失败和重试状态
- [x] 3.2 实现 Web 会话恢复和 `/chat`、`/image`、`/prompt` 路由保护，登录后仅返回白名单站内路径
- [x] 3.3 在公共导航展示 GitHub avatar/username 和退出入口，头像失败时使用本地占位符
- [x] 3.4 统一处理 API 401，使失效/过期 Session 回到登录页且不产生无限重定向
- [x] 3.5 添加 Web E2E，覆盖三页未登录跳转、Mock OAuth 登录、目标页返回、刷新恢复和单设备退出

## 4. 管理日志、文档与上线验收

- [x] 4.1 扩展管理员请求日志 API，返回最小用户摘要并支持 GitHub username/ID 筛选；详情返回昵称和可选邮箱
- [x] 4.2 更新请求日志页面的用户列、筛选和详情展示，确认 Dashboard、公开 API 和 Pino 不泄露邮箱或认证凭证
- [x] 4.3 更新 Swagger/README、部署环境说明和 PostgreSQL 备份/回滚步骤，移除实现文档中的“公开匿名调用”陈述
- [x] 4.4 运行 format、lint、typecheck、unit、PostgreSQL/Redis + Mock OAuth E2E、build、Prisma migration validate 和 OpenSpec strict validate
- [ ] 4.5 使用开发 GitHub OAuth App 完成本地域名回调冒烟，记录 callback 与 GitHub ID 映射但不记录 code/token
- [ ] 4.6 在生产发布前备份 PostgreSQL，配置独立生产 OAuth App 和 HTTPS 域名 callback，验收登录、三能力、日志用户筛选和 Image 越权保护
