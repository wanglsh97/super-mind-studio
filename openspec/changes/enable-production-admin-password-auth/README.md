# enable-production-admin-password-auth

按用户明确决定，允许生产环境通过开关启用与本地相同的固定管理员账号 `root/123456`。

该方案不属于正式安全认证体系。公网启用会带来可猜测凭据、撞库和未授权后台访问风险；现有 IP 限流、
短期 Secure/HttpOnly Cookie 与操作审计继续保留，但不能消除固定弱密码风险。
