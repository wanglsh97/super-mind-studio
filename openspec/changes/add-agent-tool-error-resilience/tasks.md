# Tasks

## 1. 统一错误出口

- [ ] 1.1 扩展工具错误 envelope 和 registry/adapter 规范，覆盖未注册、取消、未捕获异常，并补单元测试
- [ ] 1.2 修改 Pi adapter，使工具边界不向 Agent loop 泄漏工具异常，保留 telemetry 和结构化错误码
- [ ] 1.3 统一内置工具错误内容、summary、audit 和 retryable，补充 Sandbox/MCP 错误映射测试

## 2. 工具执行管道能力

- [x] 2.1 增加 prepareArguments 兼容层并映射 Pi executionMode，验证预处理发生在 schema 校验前
- [x] 2.2 增加服务端 before-execution policy，验证拒绝时不出站
- [ ] 2.3 增加 after-execution 结果规范化/脱敏钩子，保证旧工具行为兼容
- [ ] 2.4 增加受控进度 update 事件，验证失败时 update 先于最终结果、settle 后 update 丢弃
- [ ] 2.5 增加 executionMode/资源冲突约束，明确写入、导出和 skill 操作的串行策略

## 3. Run 状态一致性

- [ ] 3.1 finalize 时补偿所有未结束 tool call，避免 PostgreSQL 中遗留 RUNNING
- [ ] 3.2 补充 Agent run 继续执行、取消、runtime crash 和 SSE/数据库顺序集成测试

## 4. 文档与验证

- [ ] 4.1 更新 SDK/事件类型、README、Swagger 或配置说明（如公共行为发生变化）
- [ ] 4.2 运行相关单测、集成/E2E、typecheck、lint、build 和 OpenSpec strict validation
- [ ] 4.3 每完成一个可验收小功能点创建独立 commit，模块验收后再按仓库规则 push
