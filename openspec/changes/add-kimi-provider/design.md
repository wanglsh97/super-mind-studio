## Context

现有 Chat 网关已经具备 provider-neutral `ChatAdapter`、共享 OpenAI-compatible Fetch/SSE transport、稳定别名、完整请求日志和 Adapter contract suite。Qwen、GLM、DeepSeek 的脱网实现已完成，但真实凭证尚未准备；当前可用的 Moonshot 账户使 Kimi 成为第一条真实厂商验收链路。Kimi 中国区 API 使用 OpenAI-compatible `POST /v1/chat/completions`、Bearer 鉴权与 SSE。

约束包括：真实 Key 不得进入 Git、前端或日志；默认测试和 CI 不访问外网；公开 Chat 仍使用现有 SDK 和 SSE 契约；每个小点独立 commit，大功能完成后才 push。

## Goals / Non-Goals

**Goals:**

- 将 `kimi` 加入 SDK 与 API 的稳定文本别名集合。
- 通过独立 Adapter 映射 Moonshot 请求、delta、usage、完成原因、错误和取消。
- 使用去敏 fixture 与共享 contract suite 完成脱网验收。
- 提供显式、低输出额度的真实 smoke，并确保缺少 Key 时在联网前失败。
- 在日志中保存别名、provider、实际模型 ID 和 provider request ID，不保存 Key。

**Non-Goals:**

- 不将 Kimi 替换成 Qwen、GLM、DeepSeek 的兼容别名。
- 不增加 Moonshot 官方 SDK 依赖，继续使用共享 Fetch transport。
- 不实现虚拟 API Key、用户账户、后台凭证管理或 Key 数据库存储。
- 不支持 Kimi 文件、联网搜索、工具调用和专有 thinking 参数。

## Decisions

1. `kimi` 成为新的公开稳定别名，而不是复用 `qwen`。这样日志、计费、健康状态和未来模型列表可以准确区分厂商，代价是 SDK 联合类型发生向后兼容扩展。
2. 新建 `KimiChatAdapter` 并复用 `OpenAICompatibleChatTransport`。Adapter 独立持有 Bearer 鉴权、Moonshot Base URL、请求字段与错误码；不引入额外 SDK 包。
3. 中国区默认 `KIMI_BASE_URL=https://api.moonshot.cn/v1`，同时允许环境变量覆盖。构造时只接受 HTTPS，防止 Key 被发送到明文端点。
4. `KIMI_API_KEY` 只由 ECS 或本地 `.env` 注入；`.env.example` 仅包含空占位。已在聊天中暴露的旧 Key 必须撤销，不参与任何测试。
5. 真实 smoke 使用最多 16 个输出 Token 的固定短 Prompt，且不进入默认 `pnpm test`/CI。验收只记录模型、request ID、finish reason 和 usage 状态。

## Risks / Trade-offs

- [旧 Key 已暴露] → 立即撤销并生成新 Key，新 Key 只写入本地 `.env`。
- [Kimi 当前模型 ID 会变化] → 使用 `KIMI_MODEL_ID` 配置，SDK 只暴露稳定别名。
- [兼容协议存在边缘差异] → 使用官方形态去敏 fixture，并由共享 contract suite 覆盖取消与错误。
- [新增公开别名扩大 V1 范围] → 独立 OpenSpec change 和 feature flag，关闭 `KIMI_ENABLED` 即可回滚。

## Migration Plan

1. 扩展 SDK 别名与配置校验。
2. 实现 Kimi Adapter、fixture、contract suite 和 registry feature flag。
3. 运行完整脱网门禁。
4. 用户撤销旧 Key，在本地 `.env` 写入新 Key、模型 ID，并显式运行 smoke。
5. smoke 通过后启用 `KIMI_ENABLED`，提交验收并 push；失败时保持开关关闭。

## Open Questions

- 真实账户当前可调用的模型 ID 由 `/v1/models` 或控制台确认；在确认前不硬编码到公开契约。
