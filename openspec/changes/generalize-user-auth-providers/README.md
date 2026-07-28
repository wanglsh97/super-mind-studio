# generalize-user-auth-providers

将用户认证从 GitHub 专属模型升级为通用 User，并支持匿名、GitHub、Google 三种互不合并的登录身份。

## 数据迁移边界

本 change 经确认不保留旧 User 或其关联业务数据。迁移只面向空数据库或允许重置的环境，不提供旧
`githubId/githubUsername/displayName` 数据回填。实际执行数据库重置前仍需确认目标环境，并在生产环境先备份
PostgreSQL。
