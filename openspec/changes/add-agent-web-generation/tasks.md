## 1. 契约与数据模型

- [x] 1.1 新增 Creation、CreationAsset、WebProject Prisma 模型及 30 天 OSS Lifecycle migration/config
- [x] 1.2 将 SDK/API 收口为既有 Agent Run `mode: website`，删除 `/creations/websites*` 专用套件
- [x] 1.3 实现一 Thread 一 WebProject、成功覆盖、失败不切换产物和 30 天重置

## 2. 内置建站 Skill

- [x] 2.1 新增平台内置不可编辑 `website-building` Skill 及固定技术栈/目录/命令规范
- [x] 2.2 website mode 在每个 Run 模型调用前自动激活 Skill，普通 Chat 不加载
- [x] 2.3 测试 Skill 内容完整、注入顺序和普通 Chat 隔离
- [x] 2.4 将硬编码 Skill 迁移为仓库标准 `SKILL.md`/`scripts` 目录并同步 Sandbox 安装路径
- [x] 2.5 启动时校验并缓存 `website-building`，测试损坏 fail-fast 和 website-only 正文注入
- [x] 2.6 将所有 Sandbox Skill 安装路径统一为 `/workspace/.skills/<name>` 并移除平台专用目录

## 3. create_website 交付 Tool

- [x] 3.1 只向 website mode 注册 `create_website`，不暴露任意路径或构建命令
- [x] 3.2 实现固定项目校验、`pnpm build -- --base=./`、有界失败日志与 `dist/index.html` 校验
- [x] 3.3 实现受控 `source.zip`/`dist.zip` 生成、二次校验和私有 OSS 临时对象写入
- [x] 3.4 实现数据库事务原子切换产物指针、旧对象 best-effort 删除和 expiresAt 重置
- [x] 3.5 实现受控静态服务、owner-scoped 同源预览重定向与 Thread 删除失效
- [x] 3.6 测试成功交付、构建失败不覆盖、重复覆盖、owner 隔离和预览凭证不入库
- [x] 3.7 将 `package.json.name` 设为项目命名真源，源码下载使用 `<package-name>.zip` 并兼容旧 `source.zip` 产物

## 4. 前端交互与我的创作

- [x] 4.1 将网页选择态按 Thread 存入 localStorage，手动取消后恢复普通 Chat
- [x] 4.2 实现 `create_website` 产物卡，显示预览、两个 ZIP、最近构建时间与已覆盖态
- [x] 4.3 “我的创作”仅列出最新成功网站产物，通过通用 owner-scoped Creation Asset 路由下载
- [x] 4.4 测试 GitHub 门槛、选择态、最新/覆盖卡、空列表、过期和未授权边界
- [x] 4.5 将 `create_website` 成功结果改为紧凑交付卡，并实现宽屏右侧/窄屏覆盖式 Website Artifact 工作区
- [x] 4.6 实现同源源码 ZIP 的有界客户端解析、文件树/只读代码预览、单一源码 ZIP 下载与纯展示禁用部署按钮
- [x] 4.7 将 Artifact 外层调整为与聊天区一致的直角分栏，并用开源 Prism 按文件类型渲染语法颜色
- [x] 4.8 移除重复的构建 ZIP 下载按钮，只保留文案为“下载”的源码 ZIP 下载入口
- [x] 4.9 将桌面端网站产物区提升为与聊天区平级的第三栏，保留窄屏覆盖式交互
- [x] 4.10 移除页面壳内间距并仅在聊天面板保留 padding，使产物区与分割线贴齐工作区边界

## 5. 文档与验收

- [x] 5.1 更新 README/.env.example/部署文档，记录内置 Skill、单 Tool、静态限制和删除 Thread 边界
- [x] 5.2 运行 API/SDK/Web 相关测试、typecheck、lint、build 和 OpenSpec strict 校验
- [x] 5.3 所有开发完成后启动 dev，用内置浏览器验证普通 Chat、GitHub 门槛、网页 Run、临时预览、ZIP 下载与 Thread 删除失效
- [x] 5.4 更新 Skill 名称、仓库路径和加载策略文档，运行相关测试、typecheck、build 与 strict 校验
