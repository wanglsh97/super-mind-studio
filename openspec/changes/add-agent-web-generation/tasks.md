## 1. 契约与数据模型

- [x] 1.1 新增 Creation、CreationAsset、WebProject Prisma 模型及 30 天 OSS Lifecycle migration/config
- [x] 1.2 将 SDK/API 收口为既有 Agent Run `mode: website`，删除 `/creations/websites*` 专用套件
- [x] 1.3 实现一 Thread 一 WebProject、成功覆盖、失败不切换产物和 30 天重置

## 2. 内置建站 Skill

- [x] 2.1 新增平台内置不可编辑 `static-website-builder` Skill 及固定技术栈/目录/命令规范
- [x] 2.2 website mode 在每个 Run 模型调用前自动激活 Skill，普通 Chat 不加载
- [x] 2.3 测试 Skill 内容完整、注入顺序和普通 Chat 隔离

## 3. create_website 交付 Tool

- [x] 3.1 只向 website mode 注册 `create_website`，不暴露任意路径或构建命令
- [x] 3.2 实现固定项目校验、`pnpm build -- --base=./`、有界失败日志与 `dist/index.html` 校验
- [x] 3.3 实现受控 `source.zip`/`dist.zip` 生成、二次校验和私有 OSS 临时对象写入
- [x] 3.4 实现数据库事务原子切换产物指针、旧对象 best-effort 删除和 expiresAt 重置
- [x] 3.5 实现受控静态服务、owner-scoped 同源预览重定向与 Thread 删除失效
- [x] 3.6 测试成功交付、构建失败不覆盖、重复覆盖、owner 隔离和预览凭证不入库

## 4. 前端交互与我的创作

- [x] 4.1 将网页选择态按 Thread 存入 localStorage，手动取消后恢复普通 Chat
- [x] 4.2 实现 `create_website` 产物卡，显示预览、两个 ZIP、最近构建时间与已覆盖态
- [x] 4.3 “我的创作”仅列出最新成功网站产物，通过通用 owner-scoped Creation Asset 路由下载
- [x] 4.4 测试 GitHub 门槛、选择态、最新/覆盖卡、空列表、过期和未授权边界

## 5. 文档与验收

- [x] 5.1 更新 README/.env.example/部署文档，记录内置 Skill、单 Tool、静态限制和删除 Thread 边界
- [x] 5.2 运行 API/SDK/Web 相关测试、typecheck、lint、build 和 OpenSpec strict 校验
- [x] 5.3 所有开发完成后启动 dev，用内置浏览器验证普通 Chat、GitHub 门槛、网页 Run、临时预览、ZIP 下载与 Thread 删除失效
