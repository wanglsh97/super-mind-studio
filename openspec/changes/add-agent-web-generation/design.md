## Context

项目已有 GitHub 用户认证、持久 Agent thread/run、独立 OpenSandbox 执行会话、`write_file`/`run_shell`/`export_file` 工具、私有 OSS 用户文件和图片任务。它们以单个文件和当前 Thread 为核心，尚未表达一个完整可下载的网站项目或统一的创作列表。

本 change 新增网站项目和创作资产层。网页生成仍由现有 Agent loop 在独立沙箱执行；Sandbox 已经是独立部署，允许 npm、shell 和公网访问。平台只持有项目元数据和归档，不持久化运行中的工作区。

## Goals / Non-Goals

**Goals:**

- 让 GitHub 登录用户通过正常 Agent 对话创建一个静态站点项目，并在同一 run 中生成、构建和导出。
- 允许 Agent 选择适合需求的前端技术栈，同时用可验证的静态交付契约保证预览与下载。
- 将源码 ZIP、构建 ZIP、缩略图以及图片结果投影到用户隔离的“我的创作”。
- 让 OSS 对象和数据库元数据在 30 天后进入不可见/清理状态，并为未来部署 Connector 留下标准 `dist` 边界。

**Non-Goals:**

- 不支持数据库、认证、支付、服务端 API、私密环境变量、GitHub/Cloudflare OAuth、仓库推送或公网部署。
- 不支持文件树、可视化编辑器、跨会话继续修改同一网页项目、共享预览或永久存储。
- 不新增后台 Worker；清理依赖 OSS Lifecycle，API 查询只负责屏蔽过期资产。

## Decisions

### Decision 1: 用 WebProject 表达一次性网站交付，而不扩展 AgentThread

`WebProject` 属于用户、关联创建它的 Agent thread/run，保存标题、技术栈、状态、构建目录、预览信息、过期时间。它独立于 thread 生命周期：删除聊天不会删除已交付项目，符合“产物保留、不可跨会话编辑”。

替代方案是直接在 `AgentThread` 上记录网站字段；这会把一次性产物与可多次运行的对话混为一体，也无法支持未来从图片/视频进入统一创作列表。

### Decision 2: 静态交付契约优先于固定技术栈

Agent 可以选择 Next.js static export、Vite、Astro 或其他可在 Sandbox 中构建的技术栈，但必须产生 `package.json`、锁文件、可执行 build 命令和无服务端依赖的静态 `dist` 目录。服务端在归档前验证这些边界；未满足即项目失败，不能宣称完成。

固定 Next.js 可以降低实现复杂度，但违背已确认的“Agent 根据需求选择技术栈”决定。任意框架但不要求静态输出则无法提供稳定预览和后续静态部署，因此不采用。

### Decision 3: 复用 Agent 输出工具归档 ZIP，新增项目级 manifest

网页 Agent 将源码 ZIP、`dist` ZIP 和可选截图放在 `/workspace/output`，通过既有 `export_file` 进入私有 OSS。`WebProjectService` 在 run 结束时以导出的受控文件创建 `CreativeAsset` 记录，并将 `expiresAt` 固定为创建后 30 天。为避免 Agent 任意命名造成歧义，服务端只接受项目 manifest 指定的 source/dist/preview 路径与 MIME 类型。

替代方案是让 API 直接读取完整 Sandbox 工作区；这会上传依赖缓存、临时文件或敏感意外文件，且扩大沙箱权限面。

### Decision 4: 创作列表采用规范化 Creation + CreationAsset 投影

`Creation` 是用户可见聚合，类型为 website/image/video；`CreationAsset` 是其受保护对象引用。`WebProject` 一对一关联 website Creation；`ImageGenerationTask` 成功时创建或更新 image Creation。视频暂不建业务任务，仅由 UI 显示空状态。

所有列表、详情和下载均以当前 session userId 查询。下载继续通过同源 API，不向数据库或 Agent event 保存持久 OSS URL。

### Decision 5: 预览是同源、用户私有的归档静态包读取

构建成功后，API 从已验证并归档的 `dist.zip` 按请求路径精确读取静态文件，只允许项目所有者访问；不直接暴露 Sandbox 端口或存储持久 URL。该方式使预览不依赖 Sandbox 的存活，符合 Sandbox 销毁后仍保留产物的边界；预览会在产物到期后立即失效。

未来部署 Connector 读取已经验证的 `dist` ZIP；它是额外授权动作，不能复用预览 URL 作为生产发布。

### Decision 6: GitHub 登录是网页生成功能门槛

创建网站项目和浏览“我的创作”均要求 authenticated user 的 provider 为 GitHub。匿名、Google 或未来其他身份访问时，API 返回明确拒绝码，Web 显示 GitHub 登录引导；客户端不能只靠路由隐藏实现该限制。

### Decision 7: 30 天保留使用 OSS Lifecycle + 过期读屏蔽

所有 creation object key 使用 `creations/{userId}/{creationId}/` 前缀并设置 `expiresAt`。部署必须为该前缀配置 30 天 Lifecycle 删除；查询在 `expiresAt <= now` 时返回 expired 状态并拒绝内容读取。数据库元数据通过受控清理任务或管理员操作最终移除，但安全不依赖该清理及时执行。

## Risks / Trade-offs

- [任意 shell/npm/公网可运行不可信代码] → 依赖独立 Sandbox 的无宿主挂载、无平台密钥、用户隔离和基础设施级资源回收；应用不在 Agent prompt 中暗示其安全。
- [技术栈多样造成构建失败] → 静态交付 manifest、确定性 Mock fixture、完整命令日志和失败状态；首次仅验证已知的 Vite/Next static fixture。
- [OSS Lifecycle 删除存在异步窗口] → API 用 expiresAt 立即屏蔽，不能仅依赖对象是否仍存在。
- [用户素材可经 Agent 外发] → 在创建网页前显示一次明确告知，并审计命令/目标域名而不记录凭证。
- [图片历史与新创作投影不一致] → Creation 以业务原表为真源，投影失败不影响 ImageGenerationTask；提供幂等回填路径。

## Migration Plan

1. 添加 Prisma enum、Creation、CreationAsset、WebProject 和 ImageGenerationTask 关联字段，并创建正式 migration。
2. 上线 API/SDK 和前端入口，但仅在 Sandbox/OSS 配置有效时显示网站创建能力。
3. 配置 OSS `creations/` 30 天 Lifecycle，先在 staging 用短生命周期验证；生产失败时保留 API 过期屏蔽。
4. 回滚时关闭创建入口和 API 写入；现有对象继续按 lifecycle 过期，不批量删除用户数据。

## Open Questions

- V1 不提供跨会话编辑；后续恢复项目时应创建新的 WebProject revision，而不是重新打开已过期 Sandbox。
- GitHub/Cloudflare Connector 的 OAuth scope、部署回调和自定义域名属于后续独立 change。
