## Why

现有 Agent 已能在独立沙箱中执行工具并导出单个文件，但用户无法将对话目标沉淀为可预览、可下载的完整静态网站，也没有一个统一入口管理网站、图片和未来视频等创作成果。需要先交付可验证的静态网页生成闭环，并建立可扩展的创作资产中心。

## What Changes

- 新增仅面向 GitHub 已登录用户的静态网页生成能力：Agent 可在独立沙箱中按需求选择技术栈、写入代码、安装 npm 依赖、执行构建并准备本地预览。
- 新增网站项目和资产的持久化模型；构建成功后归档源码 ZIP 与静态构建产物 ZIP 至私有 OSS，并在 30 天后自动过期。
- 新增用户端“我的创作”入口，统一浏览网站、现有图片和未来视频创作；V1 提供网站和图片卡片，视频保留明确空状态。
- 扩展 Agent 工具与 prompt，使 Agent 以“纯静态站点”交付契约完成网页生成，并禁止声称数据库、登录、支付或私密 API Key 已可用。
- 为后续 GitHub / Cloudflare 部署 Connector 预留已归档 `dist` 资产边界；本 change 不接入 OAuth、仓库推送或公网发布。

## Capabilities

### New Capabilities

- `agent-web-generation`: Agent 驱动的静态站点项目生成、沙箱构建、私有预览及 ZIP 归档契约。
- `creative-library`: 用户隔离的“我的创作”统一列表、网站/图片资产投影、下载与到期可见性。

### Modified Capabilities

- `agent-tools`: 新增网站生成所需的受服务端控制的项目工具和静态交付边界。
- `user-files`: 网页项目的源码与构建产物采用 30 天 OSS 生命周期，不作为永久 Agent 输出文件保存。

## Impact

- `apps/api`：Agent tools、沙箱运行时、Prisma 模型与 migration、创作查询 API、OSS 对象归档与下载授权。
- `packages/sdk`：网页项目、创作列表和资产下载的公共契约及客户端。
- `apps/web`：GitHub 登录引导、网页生成入口和“我的创作”列表/详情 UI。
- `prisma/schema.prisma`：新增项目/资产关系，并与现有 `ImageGenerationTask` 关联。
- OSS：新增私有 `creations/` 前缀、30 天生命周期规则和服务端授权下载。

## V1 Boundary and Rollback

V1 只生成可静态构建的网站并保存源码与构建 ZIP；不提供跨会话项目编辑、代码编辑器、GitHub/Cloudflare 连接器、数据库、认证、支付、服务端密钥或外网公开部署。回滚时隐藏网页生成与“我的创作”入口并停止新建项目；已归档对象按既定生命周期自然过期，不执行破坏性批量删除。
