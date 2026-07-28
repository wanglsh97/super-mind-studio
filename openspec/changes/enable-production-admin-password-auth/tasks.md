# 生产管理员密码认证实施任务

## 1. 规格与凭据验证

- [x] 1.1 创建并 strict 校验 `enable-production-admin-password-auth` change
- [x] 1.2 增加生产管理员开关、用户名和 `scrypt-v1` 哈希配置校验
- [ ] 1.3 实现生产哈希凭据验证和动态管理员 Session username，覆盖单元测试

## 2. 部署配置与文档

- [ ] 2.1 将生产管理员变量加入 Compose 显式环境白名单和环境模板
- [ ] 2.2 更新部署手册，记录强密码/哈希生成、启用、轮换和回滚流程
- [ ] 2.3 运行 format、lint、typecheck、相关 unit tests、build 和 OpenSpec strict validate

## 3. 生产发布

- [ ] 3.1 备份生产环境配置，生成一次性强密码并仅保存 `scrypt-v1` 哈希
- [ ] 3.2 发布线上并验证 readiness、正确登录、Session、受保护 API、退出和错误密码 401
- [ ] 3.3 提交并推送实现，记录生产版本和回滚配置
