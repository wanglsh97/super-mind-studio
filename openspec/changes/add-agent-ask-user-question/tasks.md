## 1. SDK 和数据模型

- [x] 1.1 定义 SDK 的问卷、答案、`waiting_for_user` 状态和 `user-question-*` 事件公共契约，覆盖严格编解码测试
- [x] 1.2 新增 Prisma 问卷/答案模型与正式 migration，扩展 active run 启动清理，验证生成客户端与迁移回滚说明

## 2. 服务端工具与 API

- [x] 2.1 实现 owner-scoped Question repository 和独立服务：创建、完整答案校验、跳过、首次结算胜出与幂等读取测试
- [x] 2.2 实现 `ask_user_question` 工具与 Pi await bridge；持久化事件后挂起，覆盖回答、跳过、取消与模型回灌测试
- [x] 2.3 新增回答/跳过 API 与 SDK client，验证跨用户、失效问卷、重复提交和取消边界

## 3. 用户端与验证

- [x] 3.1 在 `/agent` 渲染可续读单批问卷卡片，支持单/多选、其他、提交和跳过；失效问卷不显示
- [ ] 3.2 执行问卷单测、集成测试、SDK contract、Agent SSE/E2E、typecheck、lint、build 和 strict OpenSpec 校验
