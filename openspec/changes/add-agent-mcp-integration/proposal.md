## Why

现有 Agent 已预留 `AgentMcpRegistry` 空端口，`web_search` 也验证了对固定 MCP 端点执行
`tools/call` 的可行性，但仍不能把任意平台批准的 MCP Server 工具纳入 Agent loop。需要在
不暴露凭证、不开放任意 URL、也不提前建设用户 OAuth 管理的前提下，完成一条可运行、可审计的
平台托管 MCP 纵向切片。

## What Changes

- 将空 `AgentMcpRegistry` 替换为平台托管实现，从服务端环境解析固定 MCP Server、认证引用和
  工具白名单。
- 使用官方 MCP TypeScript SDK v1 的 Streamable HTTP client 完成 initialize、`tools/list`
  和 `tools/call`，并统一处理连接、超时、取消、结果大小和关闭。
- 仅把配置白名单与远端实际发现结果的交集注册为 Agent 工具，使用
  `mcp__<server-id>__<tool-name>` 命名空间隔离冲突。
- MCP 描述和结果继续按不可信外部数据处理；Bearer Token 只允许从服务端环境变量引用，
  不进入 Prompt、API、审计或日志。
- 增加已认证的只读 MCP Server 状态 API、SDK client 与 Agent 页面状态摘要，便于确认配置、
  发现结果和错误。
- 增加本地 fixture MCP Server 与显式 smoke，验证
  Web/SDK/API/Agent/MCP/tool-result/PostgreSQL 的完整链路。

## Capabilities

### New Capabilities

- `agent-mcp-integration`: 平台托管 MCP Server 配置、工具发现、命名空间、Agent 调用、状态投影
  和审计边界。

### Modified Capabilities

- `agent-tools`: MCP 端口从空实现升级为只暴露平台白名单远端工具的动态 registry。

## Impact

- `apps/api` 新增 MCP 配置解析、官方 SDK client、registry、状态 API 和测试 fixture。
- `packages/sdk` 新增只读 MCP Server 状态类型与 client。
- `apps/web` 在 Agent composer 展示 MCP 连接/工具数量，并为动态 MCP 调用提供通用活动卡。
- 新增 `@modelcontextprotocol/sdk` v1 依赖；不新增数据库表、Worker、微服务或公网端口。
- 回滚时清空 `AGENT_MCP_SERVERS_JSON` 并回退代码即可；既有 AgentRun/AgentToolCall 审计记录保留。

## V1 Acceptance Boundary

本 change 的最低成功标准是：配置一个无认证的本地 Streamable HTTP fixture MCP Server 后，
已登录用户可在 Agent 页面看到该服务器 ready，Agent 能发现并调用一个白名单只读工具，页面显示
工具生命周期，`AgentToolCall` 持久化 namespaced 工具名和脱敏审计；未配置时行为与当前版本一致。

V1 不实现用户自助添加 Server、浏览器 LocalStorage 凭证、OAuth、stdio、本地进程拉起、
resources/prompts/sampling/elicitation、自动重连、写入/破坏性 MCP 工具或逐次审批。
