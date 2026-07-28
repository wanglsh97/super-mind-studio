# enable-production-admin-password-auth

按用户明确决定，允许生产环境通过开关启用与本地相同的固定管理员账号 `root/123456`。

该方案不属于正式安全认证体系。公网启用会带来可猜测凭据、撞库和未授权后台访问风险；现有 IP 限流、
短期 Secure/HttpOnly Cookie 与操作审计继续保留，但不能消除固定弱密码风险。

## 生产发布记录

- 发布时间：2026-07-28
- 生产版本：`23eda84147aeee225d861bd60a93f95e8ba54c39`
- 环境配置备份：`.env.production.backup-admin-20260728214540`
- PostgreSQL 备份：`backups/aigateway-20260728T134935Z.dump`
- 线上验收：登录 201、Session 200、Dashboard 200、退出后 Session 401、错误密码 401；
  Session Cookie 包含 Secure、HttpOnly 与 SameSite=Strict。
- 回滚：恢复环境备份或将 `ADMIN_FIXED_CREDENTIALS_ENABLED=false`，将 `APP_VERSION` 恢复到上一版本后重新部署。
