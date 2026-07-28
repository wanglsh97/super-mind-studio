## 1. 规格与安全配置

- [x] 1.1 新增 `agent-mcp-integration` proposal、design、capability specs 和任务，通过 OpenSpec strict validation
- [x] 1.2 增加平台 MCP Server JSON 配置、Bearer 环境引用、生产 HTTPS/本地 loopback、只读风险和限制参数校验，更新 `.env.example`

## 2. 服务端 MCP 纵向切片

- [x] 2.1 引入官方 MCP SDK v1，实现 Streamable HTTP 连接、分页 `tools/list`、`tools/call`、超时/取消/关闭和输出规范化
- [x] 2.2 实现平台 MCP registry、精确工具白名单与 namespaced 动态定义，覆盖冲突、schema/描述上限和凭证脱敏
- [x] 2.3 在 Agent run 开始前冻结 built-in + MCP 工具集合，并统一用于 Prompt、上下文预算、Pi 执行和 PostgreSQL 审计

## 3. 状态与前端可见性

- [x] 3.1 增加已认证 MCP Server 只读状态 API 与 `@supermind/sdk` 类型/client，确保响应不含 endpoint/auth/token 信息
- [x] 3.2 在 Agent 页面展示 MCP readiness/工具数量，并为动态 `mcp__*` 工具调用渲染通用活动卡

## 4. 验收与交付

- [x] 4.1 使用 mock client 单元测试覆盖协议边界，真实远程 Server 仅在显式 dev 验收中访问
- [x] 4.2 更新 README、Swagger/配置说明，运行相关测试、typecheck、lint、build 和 OpenSpec strict validation
- [x] 4.3 配置 Context7/DeepWiki 并启动 API/Web dev，验证 Nest 运行时依赖注入、工具发现与白名单注册

## 5. 用户内置 MCP 开关

- [x] 5.1 新增每用户 MCP Server 启停偏好表和 Prisma migration，默认启用且按用户隔离
- [x] 5.2 扩展 MCP registry、状态 API 与 SDK，使禁用项不发现、不进入 Prompt/工具集合，并拒绝未知 Server ID
- [x] 5.3 新增用户端 `/mcp` 配置页和账户菜单入口，覆盖加载、保存、错误、启用与禁用状态
- [x] 5.4 补充单元/集成测试，运行 migration、typecheck、lint、test、build 与 OpenSpec strict validation，并启动 dev 冒烟
