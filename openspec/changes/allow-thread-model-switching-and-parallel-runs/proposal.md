## Why

当前 Agent Thread 在创建时永久绑定模型。Web 中切换模型会创建新 Thread，导致用户无法在保留现有消息、工具结果、Sandbox 和上下文摘要的前提下换用另一模型继续任务。系统已经通过 `allow-concurrent-agent-runs-across-threads` 支持不同 Thread 有界并行，但默认单用户并发上限仍为 3，与本次确认的产品上限 5 不一致。

本 change 将模型从“不可变 Thread 身份”调整为“可变 Thread 默认值”，同时为每个 Run 保存不可变模型快照，保证历史、计费和审计不因后续切换而失真。模型切换与 Run 创建共享 Thread 级互斥边界，不开放同一 Thread 并发。

## What Changes

- 新增 owner-scoped Thread 模型更新 API；用户选择可用 Agent 模型后立即更新当前 Thread，不创建新 Thread 或伪造会话消息。
- 模型切换期间若当前 Thread 存在 `RUNNING`、`CANCELLING` 或 `WAITING_FOR_USER` Run，则返回 `409 AGENT_THREAD_ACTIVE_RUN`；其他 Thread 的运行不阻塞切换。
- 为 `AgentRun` 新增不可变 `modelId/provider` 快照，并通过 Prisma migration 从现有 Thread 安全回填历史 Run。
- 创建 Run 时在 Thread 锁保护下读取当前模型，并原子写入 Run 快照；模型更新同时修改 Thread 的 `modelId/provider`。
- 跨模型继续使用既有用户消息、最终回答、Tool Call、Tool Result 和上下文摘要；旧 Provider reasoning 继续持久化展示和审计，但不得回灌给不同 Provider。
- 按新模型 context window 重新计算下一次 Run 的上下文预算，必要时沿用现有压缩流程生成新摘要。
- Web 在当前 Thread 活跃时禁用模型选择器；切换成功后留在当前 Thread，失败时回滚选择并展示错误。
- 保留不同 Thread 并行、同 Thread 单 active run、后台继续和事件补读语义，并将 `AGENT_MAX_CONCURRENT_RUNS_PER_USER` 默认值从 3 调整为 5。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-sessions`：Thread 默认模型可变、Run 模型不可变快照、同 Thread 切换与创建 Run 的并发安全，以及默认五任务并发上限。
- `agent-context`：跨 Provider 继续任务时的消息、工具、reasoning、摘要和 context window 处理规则。
- `web-agent`：当前 Thread 内即时模型切换、运行期禁用、后台多任务状态与事件恢复。

## Impact

- `prisma/schema.prisma` 和正式 migration：`AgentRun` 新增 `modelId/provider`，历史数据从所属 `AgentThread` 回填后收紧为非空。
- `apps/api`：新增 Thread 模型更新 DTO/Controller/Service/Repository 路径，复用 Thread Redis 锁，调整 Run 创建快照和跨 Provider 历史组装。
- `packages/sdk`：新增 `agent.threads.updateModel(threadId, { model })` typed 方法，并在 Run/Thread 契约中返回模型快照。
- `apps/web`：模型选择器从“创建新 Thread”改为更新当前 Thread，并按 Thread active 状态禁用与恢复。
- `.env.example`、配置测试和并发 E2E：默认单用户并发上限改为 5。
- 不改变模型目录、厂商 Adapter、Provider failover、单 Run 预算、Sandbox Thread 隔离或管理员认证。

## Acceptance Boundary

用户在一个无 active run 的现有 Thread 中从 Qwen 切换到 GLM 后，Thread ID、消息、工具结果、Sandbox 和摘要保持不变，下一次 Run 使用 GLM 且 Run 行保存 GLM 快照；旧 Qwen Run 的快照、usage 和费用保持不变。当前 Thread 活跃时模型切换被拒绝，但同一用户可在其他 Thread 切换或运行任务。一个用户最多同时运行五个不同 Thread，第六个 Run 在调用模型、工具或 Sandbox 前被拒绝。离开 Thread 不取消后台 Run，切回后按 sequence 补读。

## Rollback Boundary

先将 `AGENT_MAX_CONCURRENT_RUNS_PER_USER=1` 可降级为单用户串行，再回退 Web 模型更新入口和 API；`AgentRun.modelId/provider` 为向后兼容的审计字段，回滚应用时可以保留，不需要删除历史数据。模型更新接口下线后现有 Thread 保持最后一次模型绑定。若必须回退数据库，只能在确认旧应用不写新字段后执行单独向下迁移，本 change 不以删除审计数据作为常规回滚步骤。
