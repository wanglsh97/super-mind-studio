## Context

网页创作不建立独立 Agent 服务。前端仍通过 `POST /api/v1/agent/threads/:threadId/runs` 发送消息，只在选中网页时附加 `mode: website`。服务端据此自动加载内置 Skill、缩小 Tool 集并投影唯一 WebProject。

## Goals / Non-Goals

**Goals:**

- 用内置 Skill 稳定脚手架、目录、UI 标准和构建命令。
- 用单一 `create_website` Tool 统一交付成功语义，Agent 不能仅根据文本或 shell 输出声称完成。
- 同一 Thread 可在 Sandbox 存活期内继续修改，每次成功交付覆盖上一份最终产物。
- 预览仅依赖当前 Thread Sandbox；删除 Thread 后只保留 ZIP 下载。

**Non-Goals:**

- 不实现版本快照、版本列表、回滚、跨 Thread 继续修改。
- 不支持任何后端能力或预留全栈扩展层。
- 不提供公网部署、公开分享或 Connector。

## Decisions

### Decision 1: website 是 Run mode，不是新接口链路

SDK 只为 `CreateAgentRunRequest` 增加 `mode?: 'website'`。GitHub 门槛、Skill 注入和 Tool 可见性都在既有 Agent 服务端处理。前端选择态按 `threadId` 存入 localStorage；取消只影响后续 Run，不删除 Thread 源码。

### Decision 2: 内置 Skill 独占“怎么建”

`website-building` 以标准 `SKILL.md`、`scripts/init.sh` 和 `scripts/package.py` 目录由平台随发布提供，不出现在市场、不允许用户编辑。服务启动时读取、校验名称与必需文件并缓存，缺失或损坏时 fail fast；website mode 每个 Run 都在模型调用前自动激活完整正文，普通 Chat 不加载。它与市场 Skill 使用同一 Sandbox 根目录 `/workspace/.skills/<name>`，不建立平台专用目录。Skill 固定：

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui + Lucide
- `/workspace/work` 为项目根目录
- `pnpm` 为唯一包管理器
- 初始化后必须将脚手架默认 `package.json.name` 改成由用户目标派生的、有意义的 kebab-case 项目名，后续修改保持该名称
- `pnpm build -- --base=./` 产生 `/workspace/work/dist`，并强制相对资源路径以兼容 ZIP 与 Sandbox 代理预览
- 纯静态资源，禁止数据库、服务端、登录、支付和私密配置

### Decision 3: 唯一 `create_website` Tool 独占“交付和预览”

Tool 不接受任意构建命令或路径，它在受控目录中固定执行：

1. 校验项目根目录、`package.json.name`、`pnpm-lock.yaml` 和禁止文件；项目名是用户下载归档的命名真源。
2. 执行 `pnpm build -- --base=./`；失败时返回有界日志，不改写已有最终产物。Agent 必须继续修复并重试。
3. 校验 `dist/index.html` 和静态资源边界。
4. 在 `/workspace/output` 生成排除 `node_modules`、`.git`、`dist`、缓存和密钥文件的 `source.zip`，以及根目录包含 `index.html` 的 `dist.zip`。
5. 将两个 ZIP 先写入新的私有对象，源码下载名为 `<package-name>.zip`、构建归档名为 `<package-name>-dist.zip`；校验完整性后在数据库事务中切换唯一 WebProject/CreationAsset 指针，再 best-effort 删除旧对象。OSS 内部对象键和 Sandbox 打包临时文件仍可使用固定 `source.zip`/`dist.zip`，不作为用户下载名。
6. 启动受控静态 HTTP 服务，返回不含 Sandbox 签名凭证的同源 Agent 预览路径。

### Decision 4: 单产物覆盖，不建立版本模型

一个 Thread 对应一个 WebProject 和一个 Creation。`create_website` 每次成功时更新 `agentRunId`、产物指针、成功时间和 `expiresAt = now + 30 days`。旧 Agent tool event只保留审计信息，UI 对比当前 WebProject `agentRunId` 后标记为“已被覆盖”，不提供旧产物或回滚。

### Decision 5: 删除 Thread 是预览终止点

切换 Thread 或刷新页面不销毁 Sandbox，用户返回同一 Thread 仍可修改。删除 Thread 时先销毁 Sandbox，后删除对话数据；WebProject 与 CreationAsset 不与 Thread 建立级联外键，ZIP 保留至最后成功交付后 30 天。

### Decision 6: 预览凭证不入库

Tool event 只记录同源 `previewPath`、run/project/artifact ID、有界构建摘要和过期时间。浏览器访问同源 Agent 预览路径时，API 验证 Session、Run owner、当前 WebProject 和 Thread Sandbox，然后签发十五分钟有效的平台预览 capability，并通过不要求用户 Session 的静态代理读取 Sandbox 资源。代理响应强制 CSP sandbox，预览 capability 不写入 Agent event、Pino 或数据库，避免 Docker runtime 的远端 IP endpoint 暴露给浏览器或被客户端安全策略拦截。

### Decision 7: 交付结果使用对话内 Artifact 工作区

成功的 `create_website` Tool UI 在消息流中只渲染一张紧凑交付卡，卡片负责显示“网页开发”、构建时间和当前/覆盖状态；当前产物卡可打开对话右侧的 Website Artifact 工作区。工作区不新增网站 API，而是复用 Tool result 已有的 `previewPath`、`sourceDownloadUrl` 和 `distDownloadUrl`：

- “预览”页签通过隔离 iframe 加载仅在当前 Thread Sandbox 存活期有效的同源预览。
- “代码”页签由浏览器按需下载当前源码 ZIP，在有界文件数与解压体积内解析文件树；源码只作为文本交给开源 Prism 高亮组件，按扩展名选择语法，不执行归档中的代码。
- 顶部只保留一个文案为“下载”的动作，通过 owner-scoped 通用 Creation Asset 路由获取 `<package-name>.zip`；同一源码包同时供代码页按需读取，不再显示构建 ZIP 下载按钮。旧产物若仍记录为 `source.zip`，下载路由从归档根 `package.json.name` 恢复真实文件名。
- “部署”按钮首版保持禁用展示，不绑定点击处理、不调用 API，也不暗示已经发布。

宽屏时 Website Artifact 与 `AgentConsolePanel` 在 `AgentPageShell` 内处于同一布局层级；结合外层 AppShell 导航形成“侧边栏 + 聊天区 + 网站产物区”三栏结构。产物区不是聊天卡片内部的浮层或绝对定位子面板，聊天列优先占用剩余空间，产物列默认约占 48%、最小 32rem、最大 56rem，并在工作区右侧保留 1rem 留白。源码视图的文件树在桌面端使用 14–16rem 宽度，把新增空间优先留给代码正文。`AgentPageShell` 本身不提供内间距，只有聊天面板在自身内部保留响应式 padding，使两列分割线从工作区顶端延伸到底端。分割线提供可拖拽热区，按聊天最小可用宽度约束产物列尺寸，并支持左右方向键微调。窄屏时使用无圆角覆盖式面板且不显示拖拽控件。关闭后仍可从当前交付卡再次打开。新的成功覆盖会切换到最新产物，已覆盖卡不再打开旧预览或下载。

## Risks / Trade-offs

- 固定技术栈减少自由度，但能使 Skill、Tool、构建校验和预览保持一致。
- Sandbox 仍允许 npm、shell 和公网；安全边界依赖独立 Sandbox 资源隔离、无平台密钥和及时销毁。
- 不保留版本意味着成功覆盖后无法恢复旧版；UI 必须明示“已被覆盖”而不伪装历史版本仍可用。
- 浏览器解析源码 ZIP 会占用客户端内存，因此必须限制压缩包大小、文件数量、单文件预览大小和总解压体积，并为二进制或超限文件提供不可预览状态。

## Migration Plan

1. 删除旧 `/creations/websites*` 套件及归档预览实现。
2. 增加 Run mode、内置 Skill 和 `create_website`，保持普通 Chat 工具集不变。
3. 将前端网页选择态按 Thread 持久化，渲染最新/已覆盖产物卡。
4. 完成测试、build 和 strict 校验后才启动 dev 做真实 Sandbox 冒烟。
