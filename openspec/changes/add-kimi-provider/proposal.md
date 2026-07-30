## Why

当前已有可用的 Moonshot API 账户，而原计划的 Qwen、GLM、DeepSeek 真实凭证尚未准备好。优先接入 Kimi 可以立即验证真实模型的 Web → SDK → API → Provider SSE 主链路，同时保持既有三家 Adapter 的实现不变。

## What Changes

- 新增稳定文本模型别名 `kimi`，映射到环境变量配置的 Moonshot 实际模型 ID。
- 新增 Kimi Chat Adapter，复用共享 OpenAI-compatible transport，但独立处理鉴权、请求、流式 chunk、usage、完成原因和错误映射。
- 新增去敏 fixture、共享 Adapter contract suite、显式低额度真实 smoke 命令及配置校验。
- Chat API 在 Kimi 启用时按 `kimi` 别名选择 Adapter，并持久化 `provider=kimi` 与实际模型 ID。
- 不移除或替换 Qwen、GLM、DeepSeek；不把真实 API Key 写入仓库、日志或前端。
- 不在本变更中加入用户虚拟 Key、后台凭证管理、内容安全或全站预算硬顶。

## Capabilities

### New Capabilities

- `kimi-provider`: Kimi 稳定别名、Moonshot 配置、Chat Adapter、脱网契约测试和真实低额度冒烟验收。

### Modified Capabilities

无。现有 `build-aigateway-v1` change 尚未归档为主规格，本变更以独立 capability 记录范围增量。

## Impact

- 修改 `@supermind/sdk` 文本模型别名契约、NestJS Chat Adapter registry、环境配置和示例配置。
- 新增 Moonshot provider fixture、单元/契约测试和仅显式执行的 smoke 命令；默认测试与 CI 不访问外部网络。
- 部署时新增 `KIMI_ENABLED`、`KIMI_API_KEY`、`KIMI_BASE_URL`、`KIMI_MODEL_ID`，真实 Key 仅注入 ECS `.env`。
- 回滚时关闭 `KIMI_ENABLED` 即可恢复到原模型集合，不涉及数据库迁移或公开 API 路径变更。

## Acceptance Boundary

Kimi fixture 必须通过统一 Adapter contract suite；使用新生成且仅保存在本地 `.env` 的 Moonshot API Key 完成一次最多输出 16 Token 的真实流式 smoke；完整 workspace 门禁和 OpenSpec strict validation 通过。未完成真实 smoke 前不得标记本变更完成或 push 对应大功能。
