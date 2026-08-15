## Why

现有图片能力只验证了独立 Mock 任务闭环，不能在当前 Agent 工作台中完成真实创作、连续改图和作品保存。现在需要复用已经稳定的 Thread、Agent Run、Skill、Tool、Sandbox 与“我的创作”能力，通过阿里云百炼接入可灵、Vidu、万相和 Qwen Image，使图像生成成为 Agent 编排下的原生创作能力。

## What Changes

- 在现有 Composer 的“网页开发”“文档操作”入口旁增加“图像生成”模式；模式保持当前文本模型作为外层 Agent 编排模型，不提供独立图片模型选择器。
- 新增平台内置、不可编辑的 `gen-image` Skill。每个图像生成模式 Run 在首次模型调用前自动加载 Skill，并向该 Run 注册 `generate_image` Tool。
- `generate_image` 由 Agent 传入 Prompt、可选平台图片模型、参考图片标识和受支持参数；服务端负责模型目录解析、所有权校验、默认值和厂商协议，不允许模型传入厂商 ID、任意 URL 或 Sandbox 路径。
- 通过阿里云百炼北京地域接入 `qwen-image-2.0-pro`、`wan2.7-image-pro`、`kling/kling-v3-image-generation` 和 `vidu/vidu-image_reference2image`；平台统一为持久图片任务，Transport 按官方能力归一化 Qwen 2.0 Pro 同步结果与其余模型异步提交/查询/取消；默认图片模型由服务端环境变量配置，环境默认值为Qwen Image。
- 新增 API 进程内的持久化 Image Reconciler 和 Agent Run 恢复机制，以 PostgreSQL lease 恢复等待中的百炼任务、Tool result 和最后一轮 Agent 总结，不引入 BullMQ 或独立 Worker。
- 将 Thread Sandbox 统一有效期调整为三小时。生成图片默认只保存于当前 Thread Sandbox；过期后未保存图片不可预览、下载或继续编辑，消息保留并显示已过期。
- 用户可将成功图片下载到本地，或显式保存到平台私有 OSS 和 `/creations`“我的创作”；保存操作幂等，保存后的作品永久保留且本期不提供删除或继续创作。
- 一个 Thread 仍只允许一个活动 Agent Run；同一用户最多五个活动 Thread。图片生成占用同一套准入、取消、SSE、请求日志和计费生命周期。
- 生产和开发模型目录不注册 `mock-image`。普通 CI 使用去敏 HTTP fixture 验证协议且不访问外部网络；不新增真实模型 smoke CI 脚本，真实模型启用前采用人工最低成本验收并记录模型、地域、参数和费用。
- 本 change 不增加内容审核链路、每日张数限制、全站人民币硬顶、图片删除、创作版本历史或 Seedream；内容安全视为开发前已具备的外部前置能力，Seedream 留待后续火山引擎 change。

## Capabilities

### New Capabilities

- `agent-image-generation`: 图像生成 Run mode、内置 `gen-image` Skill、`generate_image` Tool、Agent 工具循环、连续改图和对话内图片 Tool UI。
- `bailian-image-provider`: 版本化图片模型目录、百炼共享同步/异步 Transport、四个模型映射、错误归一化、任务 Reconciler 与可恢复 Agent Run。
- `image-creation-assets`: Thread Sandbox 临时图片、三小时过期、所有者预览/下载、显式 OSS 保存及 `/creations` 展示。

### Modified Capabilities

无。仓库尚未归档发布对应主规格；本 change 通过独立 capability 明确覆盖 `build-aigateway-v1` 中仅 Mock、查询驱动刷新和无长期对象存储的旧边界。

## Impact

- `apps/web`：Composer 模式入口、按 Thread 保留的图像模式、`generate_image` Tool UI、临时图片状态和保存交互。
- `apps/api`：Agent Run mode/Skill/Tool 注册、图片模型目录、百炼 Adapter/Transport、Reconciler、Run 恢复、Sandbox 图片路由和 Creation 保存服务。
- `packages/sdk`：Agent Run mode、图像 Tool result、图片预览/下载/保存和模型能力类型；不向 Web 暴露厂商协议或密钥。
- PostgreSQL/Prisma：扩展 ImageGenerationTask 状态、轮询 lease、AgentRun/ToolCall 关联、参考图片链和临时/永久资产元数据，并提供正式 migration。
- 配置与部署：图片能力仅配置百炼北京 Base URL/API Key；四模型目录、运行参数和安全边界由代码内置，并复用三小时 Sandbox 与现有私有 OSS；保持单 ECS、单 API 进程、PostgreSQL、Redis 的模块化单体拓扑。
- 回滚：同时清空百炼 Base URL/API Key，停止领取新任务但继续终结已提交任务；数据库迁移保持向后兼容，已保存 OSS 作品、账单和请求日志不删除。
