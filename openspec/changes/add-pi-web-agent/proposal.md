## Why

现有 `/chat` 适合轻量对话和多模型对比，但不能在一个受控运行中自主选择工具、读取外部信息、跨多次模型调用完成任务，也不能在刷新后恢复会话。项目需要新增一个独立的通用 Web Agent，以 Pi harness 作为服务端 Agent loop，在不破坏 Chat、Image 等专业页面的前提下建立可扩展的 tools、skills 和 MCP 能力基础。

## What Changes

- 新增独立 `/agent` 用户入口，保留 `/chat`、`/image` 和未来 `/video` 专业能力页面；同一套 Agent 后续可将图片、视频和 MCP 能力注册为工具，无需按能力重复建设 Agent。
- 在 NestJS 模块化单体中接入 `@earendil-works/pi-agent-core`，由服务端管理模型多轮调用、tool-call/tool-result 循环、取消、运行上限和事件持久化；浏览器只负责 assistant-ui 展示和控制。
- 新增服务端持久化 Agent 会话，支持列表、新建、重命名、删除和刷新恢复；模型与会话绑定，切换模型时创建新会话。
- 新增 Agent run 与可续读事件流。浏览器断线不取消运行，可使用递增事件游标恢复；同一用户全局最多一个 active run。
- 新增服务端 Tool registry 和首个只读工具 `web_fetch`。模型可自主访问通过安全校验的公网 HTTP/HTTPS URL，但不执行 JavaScript、不加载子资源，并限制协议、目标网络、重定向、内容类型、大小、超时和调用次数。
- 持久化 provider 明确返回的 reasoning part；页面将 reasoning 与中间进度聚合为思考记录，将 tool call 单独呈现为执行阶段，不再用“正在思考”包裹已开始的工具执行，且不诱导、推断或伪造模型未返回的隐藏推理。
- 每次 Agent 内部模型调用继续生成独立 `RequestLog/BillingRecord`，`AgentRun` 聚合 Token、人民币费用、模型调用次数和工具调用次数。
- 为后续 skill registry 和 MCP registry 预留稳定端口与模块边界，但本 change 不实现 skill 发现/加载、MCP 连接、凭证管理或用户配置界面。
- 将 Agent system prompt 从运行服务中的硬编码常量重构为版本化、可测试的服务端 Prompt Composer。Composer 按固定信任层级动态装配平台核心规则、产品执行策略、运行时上下文、真实工具能力、平台 Skill、用户 Memory 和会话上下文；所有模型共享同一语义组装方法，只允许 renderer 做格式和长度适配。
- 每次模型调用前根据模型目录声明的最大 context window 计算可用输入预算，并将持久会话历史回灌模型。上下文达到阈值后依次执行轻量、中度和强制压缩；强制压缩使用当前会话模型生成版本化结构化摘要，原始消息继续保留。
- 为未来 Skill、MCP 和 Memory 提供空实现端口，并为 Tool contract 增加风险与审批元数据；V1 不动态加载 Skill、不连接 MCP、不提取长期 Memory，也不注册需要审批的写入或破坏性工具。
- 首版不实现会话分享、工具审批/风险分级、运行中追加消息、JavaScript 网页渲染、后台 Worker 或 API 重启后的 Agent run 恢复。

## Capabilities

### New Capabilities

- `web-agent`: 通用 `/agent` 入口、Pi 服务端 Agent loop、模型选择、运行生命周期、流式事件、reasoning 展示、运行限制和计费聚合。
- `agent-sessions`: 用户隔离的持久会话、消息 parts、历史列表、重命名、删除、刷新恢复和单用户 active run 约束。
- `agent-tools`: 服务端工具注册契约、tool-call/tool-result 生命周期、安全的 `web_fetch` 纵向切片，以及未来 skills/MCP 的扩展边界。
- `agent-context`: 分层 system prompt、会话历史装配、模型上下文预算、渐进压缩、结构化摘要、上下文占用事件，以及 Skill/MCP/Memory 的空扩展端口。

### Modified Capabilities

无。现有 Chat、Image、Prompt 和管理后台行为保持不变；Agent 复用内部模型网关与请求生命周期能力，但不改变现有公开能力的需求语义。

## Impact

- `apps/web` 新增 `/agent` 页面、会话侧栏、Agent 事件恢复、reasoning/tool UI 和累计费用展示。
- `apps/api` 新增 Agent、Agent Session、Agent Tool 模块，并扩展内部模型调用端口以支持结构化 tool calling 和 provider reasoning；厂商协议仍限制在 Adapter 层。
- `packages/sdk` 新增 Agent thread/run/event 客户端契约；Web 仍只通过 `@supermind/sdk` 访问公开业务 API。
- Prisma 新增 Agent 会话、消息、运行、事件和工具调用相关表及正式 migration；PostgreSQL 是运行记录真源，Redis 仅用于用户级 active run 锁和短期取消状态。
- Prisma 新增每个 thread 至多一条的 `AgentContextSummary`；摘要覆盖更新不删除原始消息，每次模型压缩调用继续通过 RequestLog/BillingRecord 审计。
- 新增 Pi agent core 及网页正文抽取所需依赖；不引入 `pi-coding-agent`、TUI、BullMQ、独立 Worker 或浏览器自动化集群。
- 首个验收闭环为：`/agent` → `@supermind/sdk` → NestJS AgentModule → Pi harness → Mock tool-calling model → `web_fetch` → 后续模型 turn → SSE/event cursor → PostgreSQL 日志与费用。
- 回滚时可隐藏 `/agent` 导航并停止 Agent API；现有 `/chat`、`/image`、`/prompt` 不依赖新模块。新增数据库表保留以避免破坏性回滚，后续版本再通过 migration 清理。
