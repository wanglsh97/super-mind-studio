## Context

`AgentThread` 当前保存 `modelId/provider`，`AgentService.createRun` 始终读取 Thread 绑定模型，Web 切换模型则创建新 Thread。`AgentRun` 尚未保存模型快照，实际调用模型仅能通过 RequestLog 和 `AgentModelInvocation` 追踪。现有并发实现已将 Redis 长锁收敛为 Thread 粒度，以 PostgreSQL `pg_advisory_xact_lock(userId)` 原子执行单用户并发准入；不同 Thread 可并行，同 Thread 最多一个 active run，Web 按 Thread 恢复后台 Run。

模型切换会同时影响持久化身份、上下文组装和并发边界。若只在 Web 本地改变选择，服务端仍会使用旧模型；若直接更新 Thread 而不保存 Run 快照，历史模型归属会随 Thread 后续更新丢失；若模型更新与 `createRun` 不共享锁，则两个请求可能竞争并生成不确定的 Run 模型。

## Goals / Non-Goals

**Goals:**

- 在当前 Thread 内立即持久化新的默认模型，不新建 Thread。
- 同一 Thread 活跃期间禁止切换，不同 Thread 互不阻塞。
- 每个 Run 不可变地记录创建时的公开模型 ID 和 Provider。
- 跨 Provider 保留可移植历史，同时不向新 Provider 回灌旧 Provider reasoning。
- 保持后台多 Thread 并行与可恢复事件流，并将默认用户并发上限设为 5。

**Non-Goals:**

- 不允许同一 Thread 同时运行多个 Run。
- 不支持运行中热切模型、单个 Run 内由用户手动换模型或消息级临时模型。
- 不自动迁移已下架模型、不自动选择替代模型；调用不可用模型时直接返回现有模型不可用错误。
- 不重算全部历史摘要，不修改旧消息、旧 Run、旧账单或旧 reasoning 展示。
- 不引入队列、Worker、多机调度、跨 Thread 共享 Sandbox 或新的 Provider Adapter。

## Decisions

### Decision 1: Thread stores mutable default; Run stores immutable snapshot

`AgentThread.modelId/provider` 表示下一次 Run 的默认选择，可以通过专用 API 更新。`AgentRun.modelId/provider` 在 Run 创建事务中从 Thread 复制，之后不可编辑。RequestLog 和 `AgentModelInvocation` 继续记录每次实际 resolved model、failover、usage 与费用；三层含义分别是默认选择、Run 用户选择快照和真实调用事实。

数据库 migration 先添加 nullable 字段，使用 `AgentRun.threadId -> AgentThread` 回填，再设置非空并增加按模型查询所需索引。上线前 Thread 模型不可变，因此该回填能准确表示既有 Run 的选择；migration 不从可能发生 failover 的 RequestLog 反推 Thread 选择。

### Decision 2: Dedicated immediate model update API

新增 `PATCH /api/v1/agent/threads/:threadId/model`，请求仅接受 `{ model: string }`，返回更新后的 `AgentThreadSummary`。服务端按顺序执行 owner 校验、模型目录 `resolveForAgent` 校验、Thread 锁获取、持锁后二次读取 Thread、数据库原子更新 `modelId/provider`。成功响应后 Web 才确认选择；失败则恢复旧值。模型切换不插入 system/user/assistant 消息，也不改变标题和更新时间以外的会话内容。

专用接口优于扩展 rename patch：模型更新具有活跃 Run、模型目录、Provider 配对和上下文语义，不能退化为通用字段更新。

### Decision 3: Model update and Run creation share the Thread lock

模型更新临时获取与 Run 相同的 `agent:active-run:thread:<threadId>` Redis 锁。Run 持锁覆盖整个非终态生命周期，因此 `RUNNING`、`CANCELLING`、`WAITING_FOR_USER` 均阻止切换。模型更新完成后立即按 token 释放锁。

`createRun` 必须在获得 Thread 锁后重新读取 Thread 模型，并在 PostgreSQL advisory admission transaction 中把 Thread 模型复制到 AgentRun。这样切换和创建 Run 对同一 Thread 串行；其他 Thread 使用不同 Redis key，可独立切换或运行。Redis 获取失败继续 fail closed，不更新 Thread，也不启动付费调用。

### Decision 4: Cross-provider history is portable except reasoning

切换后继续组装同一 Thread 的用户消息、assistant 最终文本、Tool Call 和 Tool Result。Provider reasoning 继续作为 owner-only 持久化 part 展示和审计，但在组装新 Run 历史时，根据消息所属 Run 的 `provider` 与当前 Run Provider 比较：Provider 不同则移除 reasoning 回灌；Provider 相同可沿用既有 Adapter 所需 reasoning 历史规则。

现有 `AgentContextSummary` 继续有效，不因切换立即重算。下一次 Run 使用新模型 context window 重新执行预算评估；需要压缩时由新模型产生新 revision。若上下文仍无法满足新模型窗口，Run 使用现有 context-limit 终态/错误，不回滚已经成功的 Thread 模型更新。

### Decision 5: Web state remains keyed by Thread

模型选择器显示当前 Thread 的 `model`。无 Thread 时选择只影响创建新 Thread 的初始模型；已有 Thread 时选择调用 `updateModel`。当前 Thread 存在 active run 时禁用选择器，包括等待用户回答与取消中；其他 Thread 状态不影响当前选择器。

离开 Thread 不发送取消。服务端继续执行，Web 通过 Thread 列表的 `activeRuns` 展示后台状态；重新打开 Thread 后按 last sequence 补读。模型更新只修改目标 Thread 在本地列表和详情缓存中的 model，不覆盖其他 Thread。

### Decision 6: User concurrency remains bounded, defaulting to five

沿用现有 PostgreSQL 用户 advisory admission 和 Thread Redis 长锁，将 `AGENT_MAX_CONCURRENT_RUNS_PER_USER` 默认值从 3 改为 5，合法范围保持 1–5。达到 5 个 active Thread 后，第六次创建返回 `AGENT_USER_CONCURRENCY_LIMIT`，不创建用户消息、Run、RequestLog，不调用 Provider、工具或 Sandbox。

## Data Flow

### Switch model

```text
Web selector
  → SDK threads.updateModel
  → PATCH /agent/threads/:threadId/model
  → owner + model catalog validation
  → acquire Thread Redis lock
  → reread Thread
  → update AgentThread(modelId, provider)
  → release lock
  → update current Thread UI state
```

### Create next Run

```text
POST /agent/threads/:threadId/runs
  → acquire same Thread Redis lock
  → reread AgentThread model
  → user advisory admission transaction
  → create User message + AgentRun(modelId, provider)
  → execute Agent with Run snapshot
  → persist events/invocations/billing
  → release Thread lock at terminal state
```

## Failure Handling

- Thread 不属于当前用户：沿用 owner-scoped not found，不泄露存在性。
- 新模型不在启用的 Agent 模型目录：400 模型不可用错误，Thread 不变。
- Thread 有 active Run：409 `AGENT_THREAD_ACTIVE_RUN`，返回 activeRunId，Thread 不变。
- Redis 不可用或锁操作失败：503 fail closed，Thread 不变。
- 数据库模型更新失败：释放临时锁，UI 回滚选择。
- 更新成功但响应丢失：客户端刷新 Thread 后以数据库模型为准；重复更新同一模型幂等。
- 第六个并发 Run：返回 `AGENT_USER_CONCURRENCY_LIMIT` 和 limit=5。
- 新模型 context window 不足：Run 按既有压缩和 context-limit 语义失败，Thread 默认模型保持新值。

## Testing

- Repository/Service：owner 过滤、模型与 Provider 同步更新、同模型幂等、active lock 冲突、Redis fail closed、更新与 createRun 竞态。
- Migration integration：现有 Thread/Run 回填、非空约束、旧 Run 模型不随 Thread 更新。
- Agent context：跨 Provider 去除 reasoning，保留文本/tool 历史与摘要；同 Provider 历史保持现有语义；新 context window 预算生效。
- SDK contract：`PATCH` URL/body/response/error/AbortSignal。
- Web：空 Thread 选择用于创建、现有 Thread 即时更新、active 时禁用、失败回滚、其他 Thread active 不影响切换。
- 并发 E2E：五个不同 Thread 可运行、第六个拒绝、同 Thread 第二个拒绝、后台继续、切回补读、独立取消。

## Rollout and Rollback

1. 在维护窗口执行向前 migration，回填并收紧 AgentRun 快照字段。
2. 发布支持新字段和更新接口的 API/SDK。
3. 发布 Web 即时切换交互，运行模型切换和五并发 E2E。
4. 观察 Provider、Sandbox、PostgreSQL 连接和 ECS 资源；必要时将并发环境变量降为 1–3。
5. 回滚 Web/API 时保留 AgentRun 快照字段；不删除历史审计数据。

## Risks / Trade-offs

- 五并发会提高单机资源与费用峰值：保持配置上限、Thread 隔离、Provider 限流和 Redis fail closed，并通过环境变量即时降级。
- 新模型窗口较小可能使下一次 Run 需要额外摘要调用或失败：切换本身不做付费预计算，风险在首次发送时明确暴露。
- 跨 Provider 工具历史仍依赖 OpenAI-compatible 公共表示：contract tests 必须覆盖 call ID、arguments 和 tool result 关联，不回灌厂商私有字段。
- 临时锁更新依赖 Redis：牺牲 Redis 故障时的模型切换可用性，以换取与付费 Run 创建一致的竞态安全。
