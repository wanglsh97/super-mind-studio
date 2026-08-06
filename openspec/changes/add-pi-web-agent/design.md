## Context

Super Mind Studio 已有 `/chat`、`/image`、`/prompt` 专业页面以及稳定的 `@supermind/sdk → NestJS → Adapter → provider` 调用链。当前 Chat 使用 assistant-ui LocalRuntime 管理浏览器内存消息，每个请求只执行一次模型流；它不提供服务端会话、工具调用循环、网页读取或断线后的运行恢复。

本 change 新增独立 `/agent`，以 `@earendil-works/pi-agent-core` 的 harness/Agent loop 作为服务端编排核心。Agent 面向通用助手场景，首个工具是 `web_fetch`；图片、视频、skills 和 MCP 后续通过相同 registry 扩展。GitHub 登录用户是唯一使用者，NestJS 继续是认证、计费、限流和数据真源。

约束包括：单机 4C8G 模块化单体、不使用 BullMQ/独立 Worker、不向浏览器暴露 provider/MCP 凭证、不破坏现有专业页面、API 重启时不恢复进行中的 Agent run。

## Goals / Non-Goals

**Goals:**

- 交付 `/agent → SDK → Agent API → Pi harness → Mock tool-calling model → web_fetch → follow-up turn → persisted events` 的确定性纵向切片。
- 将 Agent loop、tools 和未来 skills/MCP 集中在 NestJS 服务端，并保持 provider 类型只存在于 Adapter 层。
- 提供用户隔离的持久会话、可续读事件、统一思考模块、工具状态、取消和累计用量/费用。
- 让模型只能选择经过 tool-calling contract test 的模型实例，并将会话模型固定到创建时选择。
- 建立小而稳定的 Tool/Skill/MCP registry 端口，使后续能力不要求重写 Agent loop。

**Non-Goals:**

- 不替换 `/chat`，不改变多模型对比、Image 或 Prompt 页面行为。
- 不在本 change 实现图片/视频 Agent 工具、MCP 连接、skill 加载、用户自定义工具或工具审批。
- 不执行网页 JavaScript，不提供浏览器集群、搜索引擎、文件系统、shell、任意 SQL 或任意认证转发。
- 不支持运行中追加/steer/follow-up 消息，不支持同一用户并发 Agent run。
- 不实现会话分享、Agent run 后台队列、API 重启续跑或多机高可用。

## Decisions

### Decision 1: Pi harness runs in NestJS

`AgentModule` 在服务端创建 Pi Agent/loop，Web 只通过 SDK 创建 run、订阅事件和取消。这样 provider/MCP 凭证、工具实现、运行上限、用户级并发锁、日志和费用都位于可信边界内，且浏览器断线不终止进程内 run。

备选的浏览器 harness 会让页面关闭即终止、限制可被篡改、MCP 凭证更难保护，并需要双端协调持久事件，因此不采用。Pi 的 coding agent、TUI 和内置本地文件/shell 工具不作为依赖。

### Decision 2: Agent reuses an internal model invocation port

AgentModule 不通过 HTTP 调用本机 `/api/v1/chat/completions`，也不让 Pi 直接持有 provider API Key。现有 Chat 编排中可复用的模型解析、Adapter、限流、RequestLifecycle 和计费能力应提取为内部 `ModelInvocationPort`。普通 Chat Controller 和 Agent runtime 都依赖该端口：

```mermaid
flowchart LR
    W["/agent + @supermind/sdk"] --> AC["AgentController"]
    AC --> AR["AgentRunService"]
    AR --> PI["Pi harness"]
    PI --> SP["Pi StreamFn bridge"]
    SP --> MI["ModelInvocationPort"]
    MI --> MR["Model catalog"]
    MI --> AD["Chat Adapter registry"]
    MI --> RL["Request lifecycle + billing"]
    PI --> TR["AgentToolRegistry"]
    TR --> WF["web_fetch"]
```

Pi `StreamFn` bridge 在 Pi 的 `Context/AssistantMessageEvent` 与平台内部 tool-calling 事件之间转换。公共 `@supermind/sdk` 不暴露 Pi `Model`、`Context` 或 `AgentTool` 类型，避免 SDK 被 Pi 实现绑定。

### Decision 3: Tool calling is a provider-neutral internal contract

模型目录为模型实例增加 `agent` capability。只有启用、已配置且通过 tool-calling contract test 的实例可创建 Agent thread。统一内部模型请求支持 system prompt、user/assistant/tool-result messages、JSON Schema tools 和 tool choice；统一流支持 text、reasoning、tool-call、usage、finish 和 error。各 provider Adapter 映射自己的协议，业务 Service 不读取厂商响应类型。

Mock Adapter 必须确定性模拟：文本直答、一次 `web_fetch` 后完成、多个 fetch、无效参数、未知工具、模型流错误、超限和取消。单模型首 delta failover 规则不得把两个 provider 的 tool call 拼接为同一响应；发生 provider 切换时必须尚未向 Pi bridge 提交任何 text/reasoning/tool-call delta。

Qwen、GLM、DeepSeek 和 Kimi 等采用 OpenAI-compatible Chat Completions wire format 的 Adapter 共享同一层 tool-call 编解码器：统一发送 `tools/tool_choice`，按 `index` 聚合流式 `delta.tool_calls`，校验 call ID、函数名、JSON object 参数及 `finish_reason=tool_calls` 一致性，并输出平台中立 `tool-call` 事件。各 Adapter 只保留厂商特有的 endpoint、鉴权、reasoning、usage、错误码和非标准字段映射；不得复制或在业务 Service 中解析工具协议。

### Decision 4: Threads, runs, messages and events are persisted separately

建议 Prisma 实体：

| Entity | Purpose and invariants |
| --- | --- |
| `AgentThread` | 所有者、固定 modelId、标题、createdAt/updatedAt；软状态不承担运行锁 |
| `AgentMessage` | thread 内有序 user/assistant/tool message；内容由 parts JSON 表达 |
| `AgentRun` | 一次用户提交的运行、状态、计数、累计 usage/cost、开始/结束时间和停止原因 |
| `AgentEvent` | run 内单调递增 sequence、事件类型和 payload；唯一 `(runId, sequence)` |
| `AgentToolCall` | tool call ID、工具名、校验后参数、状态、截断结果摘要、时间和错误 |

消息 parts 至少支持 `text`、`reasoning`、`tool-call`、`tool-result`。Reasoning 只保存 provider 明确返回的字段，独立限长，仅返回会话所有者，不写入 Pino；它不作为普通 assistant text 回灌下一轮。UI 展示层可将 reasoning 与工具活动聚合，但不得改变持久化 part 类型。

删除 thread 时在事务内级联删除其消息、run、event 和 tool call。首版不做回收站。所有查询和变更都以当前 GitHub 用户 ID 过滤，客户端不能声明 ownerId。

### Decision 5: Runs are asynchronous resources with replayable events

API 采用资源式生命周期：

```text
POST   /api/v1/agent/threads
GET    /api/v1/agent/threads
GET    /api/v1/agent/threads/:threadId
PATCH  /api/v1/agent/threads/:threadId
DELETE /api/v1/agent/threads/:threadId
POST   /api/v1/agent/threads/:threadId/runs
GET    /api/v1/agent/runs/:runId/events?after=<sequence>
POST   /api/v1/agent/runs/:runId/cancel
```

创建 run 返回 `202` 和 run ID，NestJS 进程内异步执行。每个对用户可见的增量或状态先写入 `AgentEvent`，再投影到 SSE；客户端保存最后 sequence，断线后使用 `after` 补读。SSE 在无业务事件时定期发送注释心跳，同源 Next.js 代理的超时必须大于最长 Agent Run；SDK 若在未收到 `[DONE]` 时遇到 EOF 或可重试网络错误，必须按最后 sequence 有界重连，不得把提前断流当作正常完成。服务端可对高频 text/reasoning delta 做短窗口合并后落库，但不得改变文本顺序。

取消接口幂等，并通过 AbortController 传播到当前模型调用与 `web_fetch`。浏览器断线不触发取消。API 启动时将遗留 `running/cancelling` run 标记为 `interrupted`，不重放模型或工具。

### Decision 6: One active run per user is enforced server-side

每个用户可以拥有多个 thread，但全局最多一个 active run。Redis 原子锁用于快速互斥，PostgreSQL 的 active run 查询和状态事务作为真源与故障兜底；Redis 不保存会话或事件。创建 run 时先验证 thread owner、模型 capability、输入和限额，再竞争用户锁。运行终结在 `finally` 中释放锁；启动清理会处理过期锁和遗留 run。

运行中所有 Agent Composer 禁用，但用户仍可浏览其他历史 thread。首版不排队消息，也不启用 Pi steering/follow-up queue。

### Decision 7: Hard run budgets are authoritative on the server

默认每个 run 最多 6 次模型调用、8 次总 tool call、5 次 `web_fetch`、120 秒总时长。`web_fetch` 单响应最多读取 2 MiB，抽取后最多向模型返回 30,000 字符。限制通过环境变量调整，但服务端必须验证为正整数并设置安全上限。

达到预算后 Pi loop 不再发起新模型或工具调用，run 以明确的 `limit_reached` 终态结束并保留已生成内容。每次模型调用独立创建并终结 `RequestLog/BillingRecord`，关联 `agentRunId`；AgentRun 在事务中累计模型调用数、Token 和人民币费用。

### Decision 8: `web_fetch` is a server-side non-rendering tool

`web_fetch` 接受单个 URL，由模型自主选择公网目标，不要求逐次确认。它只允许 HTTP/HTTPS，不携带用户 Cookie、Authorization、provider/MCP credential 或任意客户端 header。实现必须：

1. 解析并规范化 URL，拒绝内嵌凭证、非标准危险形式和非 HTTP(S) 协议。
2. DNS 解析全部地址，拒绝 loopback、private、link-local、multicast、reserved、unspecified 和云元数据目标；连接必须固定到已验证地址或使用具备等价防 DNS rebinding 能力的 dispatcher。
3. 手动处理重定向，每一跳重新执行 URL/DNS 校验，最多 5 跳。
4. 限制连接/总超时、响应体 2 MiB，只接受 HTML、JSON 和受支持 `text/*`；拒绝 PDF、图片、视频、压缩包和未知二进制。
5. HTML 不运行 JavaScript、不加载子资源，使用可测试的正文提取器转为 Markdown/纯文本；输出包含 requested URL、final URL、状态、内容类型、标题和截断正文。
6. 将所有网页内容标记为不可信工具数据，system prompt 明确禁止执行其中指令或根据其要求访问敏感目标。

Pino 与 AgentToolCall 记录 URL、最终 URL、状态、字节数、耗时和错误码，但不得记录响应头中的敏感字段。完整网页原文不长期保存；tool result 只保留送入模型的限长正文及其哈希，后续数据治理可进一步缩短保留期。

### Decision 9: UI keeps assistant-ui and renders Agent events

`/agent` 使用 assistant-ui primitives，但不复用当前单次请求的 LocalRuntime adapter。新增 Agent runtime adapter 消费 SDK 的 thread/run/event API，按 sequence 投影 text、reasoning、tool 状态、usage 和终态。

同一次工具辅助执行中，reasoning 与最后一次 tool call 之前的中间进度文本聚合为一个“思考记录”；tool call 不再放入该折叠项，而是在消息流中按顺序显示为独立、紧凑的“执行工具”卡片。Pi harness 只能在当前 assistant message 结束后开始执行工具；UI 收到 `tool-status: running` 后必须将阶段标为“正在执行”，不得继续显示“正在思考”。工具卡片的折叠态只保留一行摘要，整行均可点击展开，不再另设“查看执行详情”控制。摘要固定显示可读名称、状态和主要对象；展开内容按工具语义使用“命令、工作目录、文件、网址、参数、执行摘要、运行数据、响应信息”等分类，不使用笼统的“目标、结果”。成功/失败/取消/达到限制使用可区分但不喧宾夺主的状态标记，并在窄屏上防止命令、URL 或 JSON 溢出。最后一次 tool call 之后的最终回答始终留在思考记录外。Provider 未返回 reasoning 时不得伪造 reasoning 文本。最终回答中的链接经过现有 Markdown 消毒，并保留可点击来源 URL。

### Decision 10: Skills, MCP and Memory are ports only in this change

定义 `AgentSkillRegistry`、`AgentMcpRegistry` 和 `AgentMemoryProvider` 接口，初始实现返回空集合；Agent system prompt 和 tool registry 通过组合器消费这些端口，而不是硬编码未来实现。首版没有磁盘 skill 扫描、远程 MCP transport、OAuth、凭证存储、动态 tool discovery、长期 Memory 提取或管理 UI。后续 change 必须单独定义多用户隔离、工具名称冲突、恶意描述、授权、连接生命周期和 Memory 数据治理。

### Decision 11: A versioned Prompt Composer builds one semantic prompt for every model

`AgentRunService` 不再持有完整 system prompt 常量，而是调用 `AgentPromptComposer` 生成 `systemPrompt + messages + tools + manifest`。所有 Agent 模型共享同一组语义组件；renderer 只能按模型能力调整标签、格式和长度，不能改变权限、安全边界和产品行为。组件存放在仓库内并随代码发布，管理员不能在线修改。

平台维护的模型可见 Prompt 模板统一使用英文，包括主 Agent system prompt、强制压缩 summary prompt、内置工具描述、参数描述和工具结果安全封装。用户消息以及动态注入的 Skill、Memory、MCP 和外部内容保持原始语言并继续受对应信任边界约束；最终回答仍默认跟随用户当前语言。Prompt 语言调整必须更新 profile/component version 或 prompt hash，并通过 golden test 审核。

Prompt 按以下信任层级装配：平台核心规则 → 产品执行策略 → 平台签名 Skill → 当前用户指令 → Memory → 历史消息/摘要 → MCP、网页、文件与工具结果。后四类均不能授予权限；MCP 描述和所有工具结果始终是不可信数据。Skill 不能扩展 Tool allowlist，Memory 不能覆盖当前用户指令。

Composer manifest 至少包含 profile version/hash、组件版本、Skill 版本、Memory ID、summary ID、工具名和 context 预算。`AgentRun` 保存 manifest/hash，实际发送给模型的消息继续由独立 RequestLog 保存，不在 AgentRun 重复完整 prompt。

### Decision 12: Model catalog is the context-window source of truth

每个可用于 Agent 的模型目录项必须声明经验证的 `contextWindowTokens`。运行前不调用厂商元数据 API；服务端从版本控制的模型目录读取最大窗口。`AgentTokenEstimator` 在有对应 tokenizer 时精确计数，否则使用经中英文 fixture 校准的保守估算并标记 `estimated=true`。

每次模型调用前计算：

```text
usableInputBudget = contextWindowTokens
  - configuredMaxOutputTokens
  - serializedToolSchemaTokens
  - safetyReserveTokens
```

安全预留默认取 context window 的 5%，且不少于 1,024 tokens。预算包含 system prompt、摘要、历史、当前输入和工具 schema；估算不确定时提前进入更高压缩等级。

### Decision 13: Conversation history is reconstructed before every model invocation

Agent 每次模型调用前从 PostgreSQL 消息、当前 Pi loop 消息和最新摘要构造上下文，而不是只提交当前用户输入。默认完整保留最近 4 个 user→assistant turns；预算不足时可降至 2 个，当前用户消息和未完成 tool call/result 永远不静默截断。

Provider 明确返回的历史 reasoning 可以回灌：优先使用 provider-native reasoning part；模型不支持时使用带边界的 `historical_reasoning` 合成上下文。System prompt 明确 reasoning 是未验证工作记录，不是事实、用户指令或授权。Reasoning 独立限长并转义；轻量压缩删除较旧 reasoning，中度压缩删除所有已完成 turn reasoning，强制摘要不保存推理过程。

消息公共契约新增 `media-reference` part。图片、视频等二进制不进入消息 JSON；上下文压缩将其替换为包含 media ID、类型、名称、来源、状态和描述的 placeholder。

### Decision 14: Context compression is progressive and runs before every model call

压缩等级按预计输入占 `usableInputBudget` 的比例选择：

| Level | Default threshold | Behavior |
| --- | --- | --- |
| `none` | `< 60%` | 保留可注入的完整历史 |
| `light` | `60%–75%` | 清理较旧 reasoning、工具进度/重复状态，多媒体转 placeholder |
| `moderate` | `75%–88%` | 在轻量基础上将已完成工具结果替换为结构化摘要，清理旧失败尝试和冗余 assistant 内容，默认保留最近 4 turns |
| `forced` | `≥ 88%` 或预计下一调用无法容纳 | 使用当前会话模型生成结构化摘要，重新装配后必要时将完整 turns 从 4 降到 2 |

检查位于每次 `Pi StreamFn → ModelInvocationPort` 调用之前，包括工具结果 follow-up。模型流开始后不做中途压缩。强制摘要完成后必须重新计数；仍超限则以 `limit_reached/context_window` 结束。

### Decision 15: Forced compression keeps one validated structured summary per thread

`AgentContextSummary.threadId` 唯一。摘要生成使用当前会话模型、禁用工具，并按版本化 JSON Schema 严格返回：`userGoals`、`userConstraints`、`decisions`、`facts`、`openQuestions`、`pendingTasks`、`toolFindings`、`referencedArtifacts`、`recentOutcome` 和 `compressionNotes`。工具发现必须保留 tool call ID、工具名、来源 URL 和 `untrusted_external` 标记；摘要不得保存 reasoning。

摘要调用独立记录 RequestLog/BillingRecord 并计入 AgentRun Token/费用，但使用独立压缩调用预算。Schema 校验失败允许重试一次；第二次失败不覆盖旧摘要，并以 `limit_reached`、`limitReason=context_window`、`AGENT_CONTEXT_COMPRESSION_FAILED` 终结，主 Agent 不再调用。

新摘要通过校验后事务覆盖 thread 的唯一摘要，`revision` 递增且覆盖消息边界单调前进；原始消息始终保留。时间线持久化 `context-compressed` 元数据事件但不保存旧摘要正文，详情接口只返回当前摘要。

### Decision 16: Context state is observable and tools declare risk

SDK 事件新增 `context-budget`，包含 context window、可用预算、已用 Token、是否估算、`none/light/moderate/forced` 等级和可选 summary ID。每次模型调用前仅在数值或等级变化时持久化发布；UI 在 Composer 展示当前占用率，估算值显示“约”，时间线显示压缩事件，详情区域可展开最新结构化摘要及覆盖范围。

`AgentToolDefinition` 增加 `riskLevel=read|write|external_send|destructive` 和 `approvalPolicy=none|explicit`。V1 的 `web_fetch` 为 `read/none`；审批流未实现前，registry 必须拒绝注册 `explicit` 工具。Prompt 中的能力摘要始终从实际 registry 生成，模型自主决定是否调用已注册工具。

## Risks / Trade-offs

- [Pi API 快速演进导致集成破坏] → 固定精确版本，通过本地 bridge 隔离 Pi 类型，并为事件映射建立 contract tests。
- [真实国内模型的 tool calling/reasoning 兼容性不一致] → 模型目录显式标记 `agent` capability，只在 contract test 和低成本 smoke 通过后启用。
- [Agent 一次输入产生多次付费调用] → 服务端硬预算、用户级单运行、聚合费用展示、每次调用独立计费记录。
- [`web_fetch` 造成 SSRF/DNS rebinding] → 地址分类、逐跳校验、连接固定、无凭证转发和专门安全测试；任一校验不确定时 fail closed。
- [网页 Prompt Injection 影响模型行为] → 不可信数据边界、system instruction、工具白名单和运行预算；承认模型层防注入无法做到绝对保证。
- [高频 delta 使 PostgreSQL 写放大] → 小窗口批量/合并文本事件、保留严格 sequence 和最终消息快照。
- [API 重启丢失进程内执行] → 将 run 标记为 interrupted、保留历史并允许用户重新提交；首版明确不自动重放。
- [删除会话不可恢复] → UI 二次确认、服务端 owner 校验和事务级联；首版接受无回收站。
- [Reasoning 体积和敏感内容] → 独立 part、长度上限、运行结束自动收起、所有者可见、不写 Pino、不进入未来默认分享内容。
- [历史 reasoning 被模型误当作事实或指令] → 使用独立 part 或显式不可信边界、限长和分层删除，并在核心 prompt 中声明其低信任语义。
- [摘要遗漏用户约束或被工具内容污染] → 固定 Schema、来源字段、工具发现不可信标记、覆盖前严格校验、用户可见摘要和失败不覆盖旧版本。
- [Token 估算偏差导致 provider 拒绝请求] → 模型目录声明窗口、工具 schema/输出/安全预留纳入预算、保守估算提前压缩并记录误差。

## Migration Plan

1. 增加 Prisma schema/migration、Agent 模块空壳、配置校验和 Mock tool-calling contract，不暴露导航。
2. 提取内部 `ModelInvocationPort`，保证现有 Chat 回归完全通过，再接 Pi bridge。
3. 实现 thread/run/event persistence、用户级锁、取消和 interrupted 清理。
4. 实现受限 `web_fetch` 与 SSRF/内容抽取测试，使用本地可控 HTTP fixture，不依赖公网。
5. 实现 SDK 与 `/agent` UI，完成 Mock 纵向 E2E、刷新恢复和累计费用验收。
6. 对每个候选真实模型执行最低成本 tool-calling smoke，通过后才开启 `agent` capability。
7. 上线时先执行数据库备份与 migration，再开启 `/agent` 导航；观察运行时长、工具错误、数据库增长和费用。

回滚时关闭 Agent feature flag/导航并停止创建新 run，保留新增表和历史记录；现有专业页面继续工作。若需要重新启用，可直接恢复应用版本，无需回退数据 migration。

## Open Questions

- 首个真实 Agent 模型及 fallback 顺序由 contract test 和成本 smoke 决定，不在规格中硬编码厂商品牌。
- Agent thread 自动标题生成是否额外调用模型，首版实现前需在任务中选择无额外费用的截断标题或明确计费的标题生成。
- 网页正文的最终保留期限属于后续数据治理 change；首版沿用项目完整 Prompt 的诊断策略，但保持独立字段和限长以便迁移。
