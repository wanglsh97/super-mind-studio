# add-agent-tool-error-resilience

统一 Agent 工具执行的错误收敛、状态补偿与可观察性，使单个工具失败始终成为模型可消费的
`isError: true` tool result，而不会无意中升级为整个 Agent run 崩溃。

本 change 来源于对 Pi 工具执行管道的对比分析，目标是逐项补齐当前项目在 adapter 兜底、
错误结构化、参数兼容、运行时策略、进度事件、并发安全和终态一致性方面的缺口。

## Goals

- 在项目自己的 Pi adapter 边界捕获工具异常并转换为失败 tool result。
- 统一错误码、用户/模型可见内容、UI 摘要和审计字段。
- 支持参数预处理、运行前拦截、运行后规范化和进度更新。
- 明确工具执行的串行/并行策略，保护文件和其他有副作用操作。
- Agent finalize 时补偿结束遗留的 running tool call。
- 通过单元、集成和流式事件测试逐项验证。

## Non-goals

- 不引入自动重试策略；是否重试仍由模型决定。
- 不改变模型 provider、MCP Server 配置或用户认证范围。
- 不实现通用审批 UI；仅保留当前 V1 的 `approvalPolicy` 约束。
- 不改变已有工具的业务能力和 Sandbox 资源限制。

## Scope and rollback

变更仅涉及 Agent tool contract、Pi adapter、run projector/service、内置工具包装和相关测试。
如需回滚，按任务粒度回退本 change 的 commit；不删除已有 AgentRun、AgentToolCall 或事件数据。
