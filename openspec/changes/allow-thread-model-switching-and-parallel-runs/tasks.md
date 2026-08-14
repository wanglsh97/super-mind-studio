## 1. 数据契约与迁移

- [x] 1.1 为 `AgentRun` 增加非空 `modelId/provider` 快照，创建 Prisma migration，以所属 `AgentThread` 回填既有 Run，并验证旧 Run 不随 Thread 更新
- [ ] 1.2 扩展 API mapper、SDK types 和管理员/分析读取边界，返回 Run 模型快照且不改变现有实际 invocation 归因
- [ ] 1.3 将 `AGENT_MAX_CONCURRENT_RUNS_PER_USER` 默认值从 3 调整为 5，同步 `.env.example`、配置校验测试和部署说明

## 2. Thread 模型即时更新

- [ ] 2.1 新增 Thread 模型更新 DTO、`PATCH /api/v1/agent/threads/:threadId/model` 和 `@supermind/sdk` typed client，覆盖 owner、输入、AbortSignal 与统一错误
- [ ] 2.2 实现 owner-scoped Repository 更新，在同一写入中同步 `modelId/provider`，同模型更新保持幂等
- [ ] 2.3 复用 Thread Redis 锁串行化模型更新与 `createRun`，active/Redis 故障 fail closed，其他 Thread 不受阻塞
- [ ] 2.4 调整 Run 准入事务：持锁后重新读取 Thread，并原子创建用户消息与带模型快照的 AgentRun，覆盖切换/创建竞态测试

## 3. 跨模型上下文

- [ ] 3.1 在历史组装中关联消息所属 Run Provider，跨 Provider 时过滤旧 reasoning 和厂商私有字段，同时保留最终文本、Tool Call 与 Tool Result
- [ ] 3.2 保留既有 Context Summary，并按新模型 context window 重算预算；后续摘要记录新模型，覆盖较小窗口压缩与 context-limit
- [ ] 3.3 增加 Qwen → GLM、GLM → DeepSeek 和同 Provider 模型切换 contract tests，验证工具调用关联与 reasoning 边界

## 4. Web 当前 Thread 切换体验

- [ ] 4.1 将已有 Thread 的模型选择从创建新 Thread 改为立即调用 `threads.updateModel`，成功后更新 Thread 列表与详情缓存，失败回滚并提示
- [ ] 4.2 当前 Thread 为 running/cancelling/waiting 时禁用模型选择器；其他 Thread active 不影响切换或提交
- [ ] 4.3 保持后台 Run 继续、侧边栏逐 Thread 状态、切回 sequence 补读和独立取消，增加刷新恢复测试

## 5. 并发与端到端验收

- [ ] 5.1 扩展并发集成/E2E：五个不同 Thread 成功、第六个在消息/Run/RequestLog/Provider/Sandbox 前拒绝、同 Thread 第二个拒绝
- [ ] 5.2 增加完整纵向 E2E：Qwen Thread 保留历史切到 GLM，下一 Run 使用 GLM 快照，旧 Run/账单不变，active 时切换返回 409
- [ ] 5.3 运行相关 unit、contract、integration、E2E、typecheck、lint、build、Prisma migration validate 和 OpenSpec strict validation，记录验证结果
