## 1. 规格与配置

- [x] 1.1 新增 `agent-web-search` proposal、design、capability spec 和任务，并通过 OpenSpec strict validation
- [x] 1.2 增加 enable、provider、超时、响应/输出上限及可选 Key 的环境校验和 `.env.example`，验证默认匿名模式不要求凭证

## 2. 双 Provider 搜索实现

- [x] 2.1 实现通用 MCP `tools/call` 客户端，覆盖 JSON/SSE、HTTP/JSON-RPC 错误、空响应、超时、取消和响应大小限制
- [x] 2.2 实现 Exa/Parallel 请求映射与按 run ID 稳定的 `auto` 路由，覆盖固定 provider、可选鉴权和凭证不进入错误/audit
- [x] 2.3 实现并注册 `web_search` 工具，覆盖参数校验、不可信内容 envelope、30,000 字符截断、进度、摘要和规范化审计

## 3. 验收与交付

- [x] 3.1 增加不访问公网的双 provider contract/Agent registry 测试，确认 Pi prompt 只暴露统一 `web_search`
- [x] 3.2 增加显式 `test:smoke:web-search`，使用匿名免费端点对 Exa 与 Parallel 各查询一次并记录非敏感结果
- [x] 3.3 更新 README 和配置说明，记录第三方数据流、匿名额度非 SLA、关闭/固定 provider 方法
- [x] 3.4 运行相关测试、typecheck、lint、build 和 OpenSpec strict validation，按已验证 checkbox 独立提交
