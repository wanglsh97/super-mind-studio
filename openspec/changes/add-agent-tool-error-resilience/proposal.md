# Proposal: Pi-compatible tool errors and progress

## Problem

当前工具错误的返回方式和错误文本不统一，很多失败只显示“执行失败”，模型无法判断为什么
失败、下一步如何修复。Pi core 已经负责捕获工具异常、生成失败 tool result，并决定 Agent
是否继续，因此项目不应重复实现 Agent loop。

## Goals

本 change 只解决两件事：

1. 所有工具失败都抛出统一的 `AgentToolExecutionError`；已知业务错误由工具包装，未知异常由
   Registry 兜底。`Error.message` 保持 Pi 兼容的自然语言字符串，结构化 code、summary、
   retryable 和 audit 供项目使用。
2. 复用 Pi 的 `onUpdate(partial AgentToolResult)` 和 `tool_execution_update`，通过 SSE best-effort
   广播工具进度；不持久化、不进入模型上下文。

## Non-goals

- 不重写 Pi core 的异常处理和 Agent 控制流。
- 不自动重试或重放工具。
- 不实现 before/after hook、run 状态补偿或并发策略。
- 不改变工具的业务能力、Sandbox 资源限制或 MCP 配置。

## Acceptance

- 已知和未知工具异常都有统一结构和具体可修复 message。
- message、audit、OTel 和日志经过统一脱敏、限长和嵌套限制。
- Pi 原生 tool error 行为保持不变，项目不接管是否继续下一轮。
- progress 只通过 SSE best-effort 广播，最终 tool result 仍由 Pi 决定并作为权威结果。
- 相关测试、typecheck、lint、build 和 OpenSpec strict validation 通过。

## Rollback

按小功能 commit 回滚，不删除既有 AgentRun、工具调用或事件数据。
