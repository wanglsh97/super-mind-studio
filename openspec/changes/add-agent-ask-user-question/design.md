## Context

`add-pi-web-agent` 已交付服务端 Pi harness、持久 Agent run、顺序事件与工具 allowlist。现有 `AgentTool` 是 promise 形态，正好可用一个不持有数据库事务的 deferred 让工具等待用户交互。现有 API 重启策略不恢复进程内 Pi loop，因此本 change 不扩展为跨重启恢复。

参考 qwen-code、OpenCode 与 Grok Build 的实现，本设计采用 OpenCode 的独立 Question 服务与 Grok 的“跳过为成功结果”语义；不把用户问卷粘到权限确认框架。

## Goals / Non-Goals

**Goals:**

- 向模型提供稳定的 `ask_user_question` 工具与 1–4 题结构化 schema。
- 在回答或跳过后恢复同一 Pi run，并把结果作为成功 tool result 回灌。
- 令回答完全校验、owner-scoped、首次结算胜出且重复请求幂等。
- 通过持久事件在刷新和 SSE 重连后重建待答卡片。

**Non-Goals:**

- 不实现自动超时、后台 Worker、跨 API 重启恢复、Plan 专用 Chat/Skip 分支或工具审批。
- 不允许在运行中发送自由文本 steer/follow-up message。
- 不允许一个 run 同时存在多批问卷，或由客户端自定义 system prompt。

## Decisions

### Decision 1: Dedicated durable Question service

`AgentUserQuestionService` 负责创建、读取、回答、跳过与进程内 deferred。工具执行时先用短事务创建 `AgentUserQuestion` 与题目/选项 JSON，并以当前 run 下一个 sequence 写入 `user-question-asked` 事件；事务提交后广播事件，再 await deferred。它不复用 tool confirmation，也不在 await 期间持有数据库连接或事务。

`AgentRun.status` 新增 `WAITING_FOR_USER`。服务将 run 状态切换、问卷持久化和 asked event 放入同一事务。答题或跳过同样在一个事务中持久化答案/结算状态、切回 `RUNNING` 并追加事件；提交后调用 deferred resolve。一个 `(runId, status=PENDING)` 唯一约束保证只存在一批待答问卷。

### Decision 2: Stable schema and complete answer validation

工具参数固定为 `questions: [{header, question, options: [{label, description}], multi_select}]`。题目数为 1–4，`header` 最多 12 字符，选项数 2–4；题干和选项 label 在同一批中不得重复。UI 始终额外显示“其他”，但它不是模型 schema 的 option。

回答使用稳定 question item ID（不使用纯下标），每题提交 `selectedOptionIds` 和可选 `customText`。服务端再次验证选项归属、单/多选最小数量和选择 Other 时非空自定义文本。每一题必须作答才能结算整批。

### Decision 3: First settlement wins; Skip succeeds

`POST .../answer` 与 `POST .../skip` 通过 `UPDATE ... WHERE status=PENDING` 原子取得结算权。首次请求写入 `ANSWERED` 或 `SKIPPED`，后续相同或重复请求返回持久化结果，不重新 resolve 或生成事件。非 owner、错误 run 或失效 question 统一不泄漏资源存在性。

Answer result 回灌为 `User has answered your questions: "question"=["label"]. You can now continue with the user's answers in mind.`；自定义文本使用转义后的显式值。Skip 回灌为 `User skipped the questions. Continue with best judgment or ask different questions.`。二者都是成功 tool result，模型决定下一步。

### Decision 4: No timeout and deliberate restart interruption

不创建 timer、cron、Worker 或超时状态。待答问卷一直存在，且 `WAITING_FOR_USER` 保持为 active run，继续占用线程/用户并发限制。用户取消 run 时 abort 当前 deferred，问卷标为 cancelled，Pi tool 取消。

API 启动清理会将 `RUNNING`、`CANCELLING` 和 `WAITING_FOR_USER` 都标记 `INTERRUPTED`，并将未结算问卷标记失效。页面仅显示 active run 的 pending question；因此重启后不会显示旧卡片或尝试恢复 Pi loop。

### Decision 5: Event and UI protocol

SDK `AgentStreamEvent` 新增 `user-question-asked`、`user-question-answered` 和 `user-question-skipped`，每项有 `questionId`、稳定题目 ID 和必要显示数据。Thread detail 额外返回 active pending question，以消除“事件尚未订阅就刷新”的空窗。Web reducer 将 question state 附加到 run 视图；卡片只允许 owner 对 pending batch 选择/填写、提交或跳过，结算中禁用重复提交。

## Risks / Trade-offs

- [进程内 deferred 在重启丢失] → 明确 startup interruption，避免伪恢复或无限等待。
- [多标签页双提交] → 数据库条件更新、唯一约束和幂等读取。
- [不设超时会长期占用并发槽位] → 这是用户已确认的产品语义；用户始终可回答、跳过或取消整个 run。
- [模型参数恶意或冗长] → JSON Schema 与服务端长度/重复校验，UI 仅渲染已验证持久化内容。

## Migration Plan

1. 加入 SDK 运行状态、question schema、事件与 client 契约及测试。
2. 通过 Prisma migration 增加模型、索引和 `WAITING_FOR_USER` 状态；启动清理纳入该状态。
3. 增加 repository/service/tool/Pi bridge 和 API，覆盖事务、幂等、取消与 owner 边界。
4. 接入 Web 卡片及重连恢复，再执行 Mock Agent SSE/E2E。

回滚时隐藏 `ask_user_question` 的 registry 注册和 UI；已有中断问卷记录保留，避免破坏性 migration。
