# Proposal: Agent 工具错误韧性与状态一致性

## Problem

当前项目的内置工具多数会把业务异常返回为 `isError: true`，但 `toPiAgentTool()` 又把该结果
重新抛成异常，依赖 Pi runtime 再次捕获。Registry、MCP 和漏掉本地 catch 的工具异常也可能
穿透到 `agent.prompt()`，导致单个工具失败升级为 `AGENT_RUN_CRASHED`。如果 Pi 没有发出
`tool_execution_end`，数据库中的工具调用还可能永久停留在 `RUNNING`。

同时，工具契约缺少参数预处理、统一前置拦截、后置规范化、进度更新和显式并发模式，导致模型
自我修复能力、错误可诊断性、长任务可观察性和文件写入安全性不足。

## Goals

本 change 将工具调用收敛为稳定管道：

```text
raw arguments → prepare → validate → before hook → execute → progress flush → after hook
→ normalized ToolResult → Pi tool message → projector → SSE/PostgreSQL
```

所有可归因于单个工具的失败都必须变成模型可见的失败 tool result；只有 Agent runtime、
数据库或不可恢复的基础设施错误才可以让 run 失败。Run 终结时必须关闭所有未完成的工具调用。

## Acceptance

- 工具未注册、参数错误、取消、MCP/Sandbox 异常和工具实现未捕获异常均有稳定错误码，且不会
  因单个工具失败直接终止 Agent loop。
- tool result 的 `content`、`summary`、`audit` 和 `isError` 语义统一，错误码不依赖文本正则
  作为唯一来源。
- 工具支持可选参数预处理、运行前拒绝、运行后脱敏/审计和有序进度更新。
- 写入/破坏性工具不会因同一批次并行调用造成未定义覆盖；执行模式有测试覆盖。
- run 终态前不存在 `RUNNING` 的遗留工具调用；SSE、数据库快照和最终状态一致。
- 直接相关测试、typecheck、lint、build 和 OpenSpec strict validation 通过。

## Risks

- adapter 统一 catch 可能掩盖真正的 Agent runtime bug，因此仅捕获工具执行边界内的错误，
  并保留 telemetry 与原始错误日志。
- 新增字段会影响 SDK/前端类型，必须保持向后兼容并补充事件解码测试。
