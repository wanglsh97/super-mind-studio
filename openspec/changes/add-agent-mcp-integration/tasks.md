## 1. 规格与安全配置

- [x] 1.1 新增 `agent-mcp-integration` proposal、design、capability specs 和任务，通过 OpenSpec strict validation
- [x] 1.2 增加平台 MCP Server JSON 配置、Bearer 环境引用、生产 HTTPS/本地 loopback、只读风险和限制参数校验，更新 `.env.example`

## 2. 服务端 MCP 纵向切片

- [ ] 2.1 引入官方 MCP SDK v1，实现 Streamable HTTP 连接、分页 `tools/list`、`tools/call`、超时/取消/关闭和输出规范化
- [ ] 2.2 实现平台 MCP registry、精确工具白名单与 namespaced 动态定义，覆盖冲突、schema/描述上限和凭证脱敏
- [ ] 2.3 在 Agent run 开始前冻结 built-in + MCP 工具集合，并统一用于 Prompt、上下文预算、Pi 执行和 PostgreSQL 审计

## 3. 状态与前端可见性

- [ ] 3.1 增加已认证 MCP Server 只读状态 API 与 `@supermind/sdk` 类型/client，确保响应不含 endpoint/auth/token 信息
- [ ] 3.2 在 Agent 页面展示 MCP readiness/工具数量，并为动态 `mcp__*` 工具调用渲染通用活动卡

## 4. 验收与交付

- [ ] 4.1 增加本地 Streamable HTTP fixture 的脱网 contract/integration 测试与显式 MCP smoke
- [ ] 4.2 更新 README、Swagger/配置说明，运行相关测试、typecheck、lint、build 和 OpenSpec strict validation
