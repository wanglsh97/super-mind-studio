# add-github-user-auth

为 Super Mind Studio 用户端增加 GitHub OAuth 登录、数据库会话、付费能力访问保护和日志用户归属。

## 数据迁移前置条件

用户关系在数据库中为必填字段，迁移不会按 IP 猜测或自动回填匿名记录。若开发或测试数据库已有匿名请求数据，确认无需保留后显式执行：

```bash
CONFIRM_DELETE_ANONYMOUS_DATA=delete-anonymous-request-data \
  DATABASE_URL='postgresql://...' \
  sh infra/scripts/prepare-user-auth-migration.sh
pnpm db:migrate:deploy
```

生产环境执行前必须备份 PostgreSQL。脚本不会删除 `AdminAuditLog`。
