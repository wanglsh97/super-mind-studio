## Why

现有 Agent 只能以文本追问用户，不能在工具循环中发起可验证、可恢复展示的结构化选择。这会使模型在关键产品决策、配置选择和计划澄清时无法可靠等待用户输入，也无法让刷新后的页面恢复待答交互。

## What Changes

- 新增服务端内置工具 `ask_user_question`，让 Agent 发起 1–4 题的结构化问卷并在同一 run 内等待用户回答。
- 持久化问卷、答案和跳过结果，新增 `waiting_for_user` active run 状态与有序 SSE 事件。
- 新增 owner-scoped 回答/跳过 API、SDK 契约和 `/agent` 问卷卡片；固定支持“其他”自定义填写。
- 不设置自动超时；待答 run 持续占用既有 active-run 槽位。API 重启时问卷不恢复，相关 run 统一转为 `interrupted` 且页面不显示。

## Capabilities

### New Capabilities

- `ask-user-question`: Agent 结构化提问工具、问卷持久化、回答/跳过生命周期、模型回灌和用户端交互。

### Modified Capabilities

- `agent-sessions`: Agent run 增加 `waiting_for_user` 非终态，并在启动清理时将该状态作为可中断的 active run。
- `web-agent`: Agent 事件流和 `/agent` 时间线支持待答问卷、回答与跳过事件。

## Impact

- `prisma/schema.prisma` 及正式 migration 增加问卷和答案数据模型，并扩展 run 状态。
- `apps/api/src/agent` 增加独立 Question 服务、tool、DTO、控制器端点、repository 与 Pi bridge。
- `packages/sdk` 扩展 Agent 公共类型、严格事件编解码和 client 方法；不暴露 Pi 或 provider 类型。
- `apps/web` 渲染问卷卡片，复用既有 Agent event cursor/reconnect，不新增 Worker、队列或自动超时任务。
