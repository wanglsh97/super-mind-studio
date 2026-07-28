# 生产固定管理员登录实施任务

## 1. 规格与配置

- [x] 1.1 将 change 同步为用户确认的生产固定凭据方案并通过 strict 校验
- [x] 1.2 允许生产环境显式设置 `ADMIN_FIXED_CREDENTIALS_ENABLED=true`
- [x] 1.3 保持固定凭据、短期 Session、Guard 和登录限流行为并覆盖回归测试

## 2. 部署配置与文档

- [x] 2.1 保持生产模板默认关闭，并更新部署手册记录显式启用、风险和回滚
- [x] 2.2 运行 format、lint、typecheck、相关 unit tests、build 和 OpenSpec strict validate

## 3. 生产发布

- [x] 3.1 备份生产环境配置并将私有 `.env.production` 的固定凭据开关设为 `true`
- [x] 3.2 发布线上并验证 readiness、正确登录、Session、受保护 API、退出和错误密码 401
- [ ] 3.3 提交并推送实现，记录生产版本和回滚配置
