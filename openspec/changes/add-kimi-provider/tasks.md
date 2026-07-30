## 1. 保护现有纵向主链路

- [x] 1.1 运行并确认 Web → SDK → API → Mock Adapter → SSE → 数据库日志回归基线不受 Kimi 变更影响
- [x] 1.2 扩展 `@supermind/sdk` 文本别名为 `kimi`，补充类型与契约测试

## 2. Kimi 脱网接入

- [x] 2.1 增加 Kimi feature flag、API Key、Base URL 和模型 ID 配置校验及 `.env.example` 空占位
- [x] 2.2 实现 `KimiChatAdapter` 的鉴权、请求、delta、usage、finish、错误、request ID 和取消映射
- [x] 2.3 使用官方形态去敏 fixture 接入共享 Adapter contract suite，默认测试禁止外部网络
- [x] 2.4 在 Chat registry 注册启用的 Kimi Adapter，并验证请求日志保存 provider 与实际模型 ID

## 3. 真实验收与交付

- [x] 3.1 提供最多输出 16 Token 的显式 Kimi smoke 命令，缺少 Key 时必须在联网前失败
- [x] 3.2 使用仅保存在本地 `.env` 的 Key 完成真实 Kimi smoke
- [ ] 3.3 在 Moonshot 控制台确认已撤销对话中暴露的旧 Key
- [x] 3.4 运行 workspace 完整门禁与 OpenSpec strict validation，并逐项提交实现变更
- [x] 3.5 真实 Kimi smoke 通过后，将本次大功能 push 到远端
