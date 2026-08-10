# Tasks

## 1. 统一结构化错误

- [ ] 1.1 统一 `AgentToolExecutionError` 字段和 Pi 兼容字符串 message，补构造/渲染测试
- [ ] 1.2 让已知 Sandbox、MCP、文件和 shell 错误由工具包装后抛出统一异常
- [ ] 1.3 让 Registry 仅兜底包装未知异常，原始 cause 只进入服务端日志
- [ ] 1.4 补充错误 message 的脱敏、限长、嵌套限制和 retryable 语义测试

## 2. 工具进度

- [ ] 2.1 复用 Pi `onUpdate(partial AgentToolResult)`，补充工具到 Pi 的 update 测试
- [ ] 2.2 将 Pi `tool_execution_update` 映射为现有 SSE tool progress 事件
- [ ] 2.3 验证 progress 不进入模型上下文、不写 PostgreSQL，最终 tool result 为权威状态
- [ ] 2.4 验证 progress 广播失败或丢失不影响工具最终结果

## 3. 可观察性与验证

- [ ] 3.1 在 Registry 工具调用边界补充 OTel/埋点，埋点失败不得改变 Pi 错误传播
- [ ] 3.2 补充 Agent run 使用 Pi 原生错误处理、不自动重试/重放的集成测试

## 4. 文档与验证

- [ ] 4.1 更新 SDK、事件类型或 README（如公共行为发生变化）
- [ ] 4.2 运行相关单测、集成/E2E、typecheck、lint、build 和 OpenSpec strict validation
- [ ] 4.3 每完成一个可验收小功能点创建独立 commit
