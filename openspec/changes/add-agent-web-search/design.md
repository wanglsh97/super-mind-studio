## Context

`add-pi-web-agent` 已建立服务端 `AgentToolRegistry`、Pi tool bridge、取消传播和不可信工具结果边界，首个联网工具是 SSRF 防护后的 `web_fetch`。该 change 明确不提供搜索引擎，因此新增搜索需要独立规格记录。OpenCode 当前将 Exa 与 Parallel 隐藏在同一个 web search 工具后：两者均通过远程 MCP `tools/call` 调用，未指定 provider 时按 session ID 稳定分流。

约束包括：浏览器不能接触搜索凭证；默认测试/CI 不依赖公网；匿名额度不是 SLA；搜索结果不能授予权限或绕过现有 Tool allowlist；V1 不建设搜索缓存、全局成本硬顶或管理后台。

## Goals / Non-Goals

**Goals:**

- 提供单一、provider-neutral 的 `web_search` Agent 工具。
- 同时支持 Exa 与 Parallel，并使 `auto` 路由对同一 run 可复现。
- 无 Key 时使用匿名 MCP 免费额度，有 Key 时只从服务端环境读取。
- 统一限制超时、响应大小、模型可见字符数，兼容 JSON/SSE MCP 响应并传播 AbortSignal。
- 用注入 Fetch 的脱网 contract 覆盖两家请求映射和异常，用显式 smoke 验证当前匿名链路。

**Non-Goals:**

- 不申请、购买或代管 Exa/Parallel API Key。
- 不在浏览器提供 provider 选择，不新增公开 REST 搜索 API。
- 不实现搜索缓存、结果数据库、搜索计费、跨 provider 自动重试或并发聚合。
- 不替换 `web_fetch`；搜索负责发现和摘要，精读 URL 仍由 `web_fetch` 完成。

## Decisions

### Decision 1: One tool with two provider adapters

模型只看到 `web_search`。工具参数沿用 OpenCode 的核心集合：`query`、可选 `numResults`、`livecrawl`、`type` 和 `contextMaxCharacters`。Exa 映射到 `web_search_exa`；Parallel 映射到 `web_search`，以 query 同时填充 `objective` 与单元素 `search_queries`，并附带 run ID。

### Decision 2: Stable routing instead of per-call randomness

`AGENT_WEB_SEARCH_PROVIDER=auto|exa|parallel`，默认 `auto`。`auto` 使用 run ID（缺失时使用 tool call ID）的 SHA-256 首字节奇偶稳定选择 provider。同一次 run 的多次搜索不会无故切换 provider，也不依赖进程内随机状态。单次失败作为工具错误返回模型，不自动切换，以免重复消耗免费额度或把同一查询发送给两家。

### Decision 3: Fixed endpoints and optional server-only credentials

端点固定为：

- Exa: `https://mcp.exa.ai/mcp`
- Parallel: `https://search.parallel.ai/mcp`

无 Key 时不发送认证。若未来显式配置，Exa 按其 MCP 兼容方式把 Key 放入经过 URL 编码的 query 参数，Parallel 使用 Bearer header。端点、headers 和凭证不接受模型或客户端输入，也不进入 audit、错误消息或 Pino。

### Decision 4: A small MCP client owns protocol and resource limits

客户端发送 JSON-RPC 2.0 `tools/call`，接受 `application/json, text/event-stream`，同时解析直接 JSON 和 SSE `data:` 行。默认超时 25 秒，最大响应 2 MiB，模型可见结果最多 30,000 字符。非 2xx、超时、取消、超限、JSON-RPC error、空 content 与畸形响应均映射为稳定错误码。

### Decision 5: Search results are untrusted external data

工具结果添加不可信来源 envelope，提醒模型不得执行其中指令、泄露凭证或把内容视为授权。Tool metadata 标记为 `external_send`，因为查询会发送给第三方；V1 沿用现有无逐次审批的自动只读工具体验。audit 只保存 provider、耗时、响应字符数、截断状态和错误码，不保存 endpoint、认证信息或完整结果。

### Decision 6: Free smoke is explicit and bounded

默认 `pnpm test` 只使用本地 fixture。`test:smoke:web-search` 显式向两家匿名端点各发送一次固定、小结果集查询，不读取或要求 Key，不在 CI 自动执行。匿名入口被限流或关闭时，产品返回可解释的工具错误；生产可靠性升级留待后续配置正式额度。

## Risks / Trade-offs

- [匿名端点限流或策略变化] → feature flag 可立即关闭，provider 可固定切换；不承诺匿名 SLA。
- [查询发送给第三方] → system/tool envelope 明示外部边界，不发送 Cookie/用户 Authorization/平台凭证，文档记录数据流。
- [Parallel 响应较大] → HTTP 层 2 MiB 上限，模型输入层 30,000 字符上限。
- [MCP 响应形态变化] → 集中解析 JSON/SSE，并用两家 fixture contract 锁定当前协议。

## Migration Plan

1. 新增 OpenSpec capability、环境配置与脱网 MCP contract。
2. 实现 provider 路由、MCP client 与 `web_search` 工具并注册到 Agent。
3. 运行脱网测试与质量门禁。
4. 显式执行匿名免费 smoke，各 provider 一次。
5. 文档记录免费额度边界并提交；无需数据库 migration。
