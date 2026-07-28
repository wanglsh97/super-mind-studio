## Context

当前 `AgentService.createRun` 先查询用户全局 active run，再持有一个以 userId 为键的 Redis 锁
直到 run 终结。SDK/Web 同样只投影一个 `activeRun` 并据此禁用全部 Composer。执行器、事件总线、
取消控制器和审计记录已经以 runId 隔离；Sandbox 则以 Thread 为复用边界。

同一 Thread 目前不具备并发写入安全性：消息 sequence 使用读取最大值再递增，Context Summary
为每 Thread 单行覆盖，且两个 Run 会 reset 和操作同一个 Sandbox。因此本 change 只开放不同
Thread 并行。

## Goals / Non-Goals

**Goals:**

- 同一用户在不同 Thread 中最多并发运行配置数量的 Agent run。
- 同一 Thread 始终最多一个 active run。
- 并发准入在跨请求竞态下仍不超过上限，Redis 故障时不绕过付费保护。
- Web 能展示多个后台 run，并只阻止当前 active Thread 的重复提交。

**Non-Goals:**

- 不允许同一 Thread 并发，不定义并发回答的消息合并语义。
- 不增加排队、优先级、steering、Worker、重启续跑或多机调度。
- 不改变单个 run 的模型、工具、时间、Token、Sandbox 或费用预算。

## Decisions

### Decision 1: Thread lock and user admission are separate controls

Redis 长生命周期锁改为 Thread 粒度 `agent:active-run:thread:<threadId>`，token 仍由创建请求生成，
并在 run 终态 `finally` 中按值释放。锁已占用时返回同 Thread active run 的 ID。

用户并发上限由 PostgreSQL 事务执行原子准入：事务先获取基于 userId 的
`pg_advisory_xact_lock`，再检查当前用户 active run 数量和目标 Thread active run，最后创建
Run 与 user message。数据库状态是并发数量真源；Redis Thread 锁用于快速互斥和故障关闭。

### Decision 2: Concurrency is bounded and configurable

新增 `AGENT_MAX_CONCURRENT_RUNS_PER_USER`，默认 2，允许 1–5。值为 1 可作为即时降级和回滚手段。
超过上限返回明确的冲突错误和当前 active run 摘要，不调用模型、工具或 Sandbox。

该上限不替代每个 run 的既有预算。Provider 限流、单机容量和费用仍需通过现有 RequestLog、
BillingRecord、健康状态和部署监控观察；本 change 不承诺提升全站吞吐。

### Decision 3: Public state is a collection keyed by Thread

Thread 列表响应将 `activeRun` 改为 `activeRuns`，包含当前用户所有 `RUNNING/CANCELLING` run。
Thread 详情继续保留单个 `activeRun`，因为同 Thread 互斥仍是 invariant。

Web Workspace 保存 active run 集合，并提供按 threadId upsert/remove。当前 Thread active 时
Composer 和 Skill 选择禁用；其他 Thread 仍可提交。会话列表显示 active 状态，页面在存在后台
run 时周期性刷新列表；打开 active Thread 后沿用现有 SSE cursor 恢复。

### Decision 4: Same-Thread isolation remains authoritative

同 Thread 的 Redis 锁和 PostgreSQL 事务检查必须同时存在。任何绕过 Web 的重复提交都在创建
provider RequestLog、Sandbox 或工具调用前被拒绝。Thread 删除仍在存在 active run 时拒绝。

## Failure Handling

- Redis 获取失败：返回 503，数据库中不创建 Run。
- Thread 锁冲突：查询该 Thread active run 并返回 `AGENT_THREAD_ACTIVE_RUN`。
- 用户达到上限：返回 `AGENT_USER_CONCURRENCY_LIMIT` 和上限，不创建 Run。
- Run 创建事务失败：释放已获得的 Thread 锁。
- Run 终结后 Redis 释放失败：终态不回滚，TTL 和启动清理回收锁。
- 页面丢失后台状态：下一次轮询或 Thread 列表刷新以 PostgreSQL 投影纠正。

## Testing

- Repository 集成测试覆盖同用户并发准入、上限、不同 Thread 成功和同 Thread 拒绝。
- Service 单元测试覆盖 Redis fail closed、锁释放和不启动执行器。
- SDK contract 测试覆盖 `activeRuns` 解码。
- Web 测试覆盖当前 Thread 禁用、其他 Thread 可提交、后台状态刷新和独立终态移除。
- Mock Agent E2E 并发启动两个 Thread，验证事件、消息、取消和账单隔离。

## Rollback

先将 `AGENT_MAX_CONCURRENT_RUNS_PER_USER=1`，无需数据库迁移即可恢复单用户串行行为；随后可回退
SDK/Web/API 字段。已经创建的并发 Run 按各自终态自然完成或由用户取消，审计记录保持不变。
