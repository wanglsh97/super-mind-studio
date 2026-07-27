## Why

现有 Agent 只能在已知 URL 上使用 `web_fetch`，无法先发现当前网页或为时效性问题寻找来源。OpenCode 已验证了用一个搜索工具对接 Exa 与 Parallel 远程 MCP 的轻量方案；两家当前均提供无需 API Key 的匿名试用入口，适合先以零凭证、低成本方式跑通纵向流程。

## What Changes

- 为服务端 Agent registry 新增 `web_search`，支持查询、结果数量、搜索类型、live crawl 偏好和模型上下文字符上限。
- 参考 OpenCode，通过固定的 Exa 与 Parallel MCP 端点调用 `tools/call`；`auto` 模式按 run ID 稳定选择 provider，也可通过服务端配置固定到 `exa` 或 `parallel`。
- 增加 provider-neutral MCP HTTP/JSON-RPC 客户端，兼容 JSON 与 SSE 响应，支持超时、取消、响应大小限制、规范化错误和结果截断。
- 匿名免费模式不要求 Key；保留可选的 `EXA_API_KEY` 与 `PARALLEL_API_KEY` 服务端配置，但不申请、不提交、不打印真实凭证。
- 增加完全脱网的单元/契约测试，以及仅显式运行、每家一次查询的匿名免费 smoke。

## Capabilities

### New Capabilities

- `agent-web-search`: Agent 的 `web_search` 工具、Exa/Parallel MCP provider、稳定路由、免费匿名 smoke 和安全边界。

### Modified Capabilities

- `agent-tools`: 将原先“本 change 不提供搜索引擎”的边界通过独立 change 扩展为受控的只读搜索工具；`web_fetch` 行为保持不变。

## Impact

- `apps/api` 新增搜索契约、MCP 客户端、provider 路由、工具实现、环境校验、测试和显式 smoke 脚本。
- Agent system prompt 的真实工具清单自动包含 `web_search`，Pi loop、SDK 与事件协议无需新增公开 API。
- 搜索词会发送到被选中的第三方 provider；响应作为不可信外部数据返回模型，不携带用户 Cookie、Authorization 或其他平台凭证。
- 默认测试和 CI 不访问公网。回滚时设置 `AGENT_WEB_SEARCH_ENABLED=false` 即可从 registry 移除工具。

## Acceptance Boundary

Exa 与 Parallel 必须通过同一套脱网 MCP contract；`auto` 路由对同一 run 稳定；匿名 smoke 各执行一次并成功返回内容；相关测试、typecheck、lint、build 与 OpenSpec strict validation 通过。真实 Key 不属于本 change 的验收条件。
