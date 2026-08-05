## 1. 规格与持久化基础

- [x] 1.1 新增 Creation、CreationAsset、WebProject Prisma 模型及 ImageGenerationTask 关联，并创建正式 migration
- [ ] 1.2 实现 owner-scoped Creation/WebProject repository、状态机和 30 天 expiresAt 计算
- [ ] 1.3 为新模型、状态转换和 owner 隔离补充单元测试

## 2. 网页生成 Agent 闭环

- [x] 2.1 定义 SDK 的网页项目、创作列表、资产下载与预览公共契约
- [x] 2.2 实现 GitHub 身份门槛、WebProject 创建 API 和静态站点 Agent prompt/profile
- [x] 2.3 实现 manifest 校验、源码/静态构建 ZIP 导出、OSS 创作资产归档与同源下载
- [x] 2.4 实现归档静态包的 owner-scoped 同源预览与到期失效
- [ ] 2.5 补充 Mock Sandbox/Agent 集成测试，覆盖成功、构建失败、非 GitHub 拒绝和跨用户访问拒绝

## 3. 我的创作用户端

- [x] 3.1 在用户导航新增“我的创作”，并添加 GitHub 登录引导与受保护路由
- [x] 3.2 实现网站/图片统一卡片列表、类型筛选、视频空状态和过期状态
- [ ] 3.3 实现网站预览、源码 ZIP、构建 ZIP 下载入口及对应 loading/error 状态
- [ ] 3.4 补充页面单元/E2E 测试，覆盖 owner 内容、空状态、过期和未授权边界

## 4. 生命周期与验收

- [ ] 4.1 配置并记录 OSS `creations/` 30 天 Lifecycle，API 层屏蔽已过期对象
- [ ] 4.2 补充 Pino/RequestLog/Agent event 审计字段，确保不记录凭证或持久 OSS URL
- [ ] 4.3 运行 API、SDK、Web 的相关测试、typecheck、lint、build 与 OpenSpec strict 校验
- [x] 4.4 更新 README/.env.example/部署文档，并记录独立 Sandbox 与未来 Connector 边界
