## Why

当前 Agent 对同一用户实行全局单 active run。用户在一个 Thread 执行较长的模型、Sandbox 或
MCP 任务时，无法在另一个独立 Thread 继续工作。现有 run、事件和不同 Thread 的 Sandbox 已按
runId/threadId 隔离，可以在不开放同一会话并发写入的前提下提供受控并行能力。

## What Changes

- 将单用户全局一个 active run 改为：不同 Thread 可并发、同一 Thread 最多一个 active run。
- 增加服务端可配置的单用户并发上限，默认 2、最大 5；Redis 不可用时继续 fail closed。
- 使用 PostgreSQL 原子准入串行化同一用户的创建竞态，并以数据库 active run 状态作为真源。
- Thread 列表 API/SDK 返回当前用户的 active run 集合，而不是单个全局 active run。
- Web 按 Thread 跟踪运行状态，只禁用当前运行中 Thread 的 Composer；其他 Thread 可提交新任务。
- 后台运行继续由服务端执行；会话列表展示运行状态，重新打开 Thread 后按事件游标恢复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-sessions`: 将单用户全局互斥调整为跨 Thread 有界并发和同 Thread 互斥。
- `web-agent`: 支持多个后台 active run 的状态展示、恢复和独立取消。

## Impact

- `apps/api` 修改 active-run 准入、Redis 锁粒度、PostgreSQL 查询与配置校验。
- `packages/sdk` 将 Thread 列表的 `activeRun` 投影升级为 `activeRuns`。
- `apps/web` 将全局单 run 状态升级为按 Thread 索引的多 run 状态。
- Prisma 数据表不新增字段；并发准入使用现有 `AgentRun(userId, status)` 索引与事务 advisory lock。
- 同一 Thread 的消息 sequence、Context Summary 和共享 Sandbox 不需要并发合并。
- 回滚时将并发上限设为 1 并恢复旧 API/Web 投影；已有 Run、事件和账单记录无需删除。

## Acceptance Boundary

同一用户在 Thread A 有 active run 时，可以在 Thread B 创建第二个 run；在 Thread A 再次提交
仍被拒绝。达到配置的用户并发上限后不调用模型或工具。两个 run 的事件、取消、消息、Sandbox、
usage 和费用彼此独立，刷新后能够恢复所有 active run 的列表状态和当前 Thread 的事件流。

本 change 不支持同一 Thread 并发、消息排队、运行中 steering、跨 run 共享上下文快照、后台
Worker、API 重启续跑或多机高可用。
