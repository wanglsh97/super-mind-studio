# 通用用户与多 Provider 登录实施任务

## 1. 规格与通用用户数据模型

- [x] 1.1 建立并 strict 校验 `generalize-user-auth-providers` change，记录三身份独立、匿名一次性身份、统一权限和不兼容数据库重置边界
- [x] 1.2 更新 Prisma `User` 为通用字段和 `(authProvider, providerUserId)` 唯一约束，创建正式 migration 并生成 Prisma client
- [x] 1.3 新增 `UserModule`、通用身份输入和 `UserService`，覆盖三 Provider 创建、OAuth upsert、资料刷新和相同邮箱不合并测试

## 2. API 登录与 Session

- [x] 2.1 重构 GitHub OAuth client 输出通用身份输入，移除 Session Service 对 GitHub 类型和字段的依赖
- [x] 2.2 将 API 匿名登录改为无请求体的一次性服务端随机 User，删除服务端设备指纹派生和匿名环境开关依赖
- [x] 2.3 实现 Google OAuth client、Provider-bound state、authorize/callback 路由和错误归一化，覆盖缺失/未验证邮箱与禁用 Provider
- [ ] 2.4 扩展配置校验和环境样例：Google 独立启用、启用时凭证必填、禁用时应用可启动
- [ ] 2.5 完成 API Session 与授权回归，验证三 Provider 共用 Session、匿名重复登录创建不同 User、相同邮箱不合并且业务归属仍使用平台 UUID

## 3. Web 与管理后台

- [ ] 3.1 将 Web Session profile、导航和用户展示迁移到 `authProvider/userName/avatarUrl`，移除所有 `github*` 业务字段
- [ ] 3.2 登录页新增 Google 入口，将匿名登录改为无 fingerprint 请求，并覆盖三入口 loading/error/returnTo 测试
- [ ] 3.3 将管理员日志 API 与页面改为通用用户摘要及 provider/userName/providerUserId 筛选，普通 Session 不返回 Provider ID 或 email

## 4. 文档与验收

- [ ] 4.1 更新 PRD、技术方案、README、Swagger 和部署配置，移除 GitHub-only、设备指纹和匿名生产禁用陈述
- [ ] 4.2 运行 format、lint、typecheck、unit、相关 PostgreSQL/Redis Mock E2E、build、Prisma migration validate 和 OpenSpec strict validate
- [ ] 4.3 完成三种登录浏览器回归；真实 OAuth 凭证缺失时记录待执行的 GitHub/Google callback 冒烟，不伪造线上验收结果
