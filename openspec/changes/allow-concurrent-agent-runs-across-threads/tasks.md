## 1. 规格与准入契约

- [x] 1.1 新增跨 Thread 并发 proposal、design、capability specs 和任务，通过 OpenSpec strict validation
- [x] 1.2 增加单用户并发上限配置、Thread 粒度 Redis 锁和 PostgreSQL 原子准入，覆盖不同 Thread 成功、同 Thread 拒绝、上限和 Redis fail-closed

## 2. SDK 与 Web 多运行状态

- [ ] 2.1 将 Thread 列表契约升级为 `activeRuns`，更新 API mapper、SDK 解码和 contract tests
- [ ] 2.2 将 Web Workspace 升级为按 Thread 管理 active run，只禁用当前 Thread，并支持后台状态刷新、恢复和独立取消

## 3. 验收与交付

- [ ] 3.1 增加 Mock 并发集成/E2E，验证两个 Thread 的事件、消息、取消、Sandbox 和费用隔离
- [ ] 3.2 更新配置与说明，运行相关测试、typecheck、lint、build 和 OpenSpec strict validation
