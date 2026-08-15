## Why

当前 Agent 工作台已具备持久 Thread/Run、Tool loop、临时 Sandbox、OSS 作品保存和“我的创作”，但不能完成视频创作。需要通过阿里云百炼接入可灵、HappyHorse、Vidu 和爱诗，在不增加第二个模型选择器的前提下，让用户从 Composer 切换到视频模式，用文本或单张首帧图片生成视频，并通过自然语言连续修改。

视频生成是分钟级、按任务计费的大文件异步能力，不能简单复用图片任务的客户端轮询或厂商临时 URL。平台必须持久跟踪任务、保护 Thread Sandbox、恢复中断的 Agent Tool loop，并将预览、保存、下载和计费边界收敛到服务端。

## What Changes

- 在 Composer 上方增加 Thread 级“视频生成”模式；现有模型选择器仍只选择外层文本 Agent，不增加视频模型选择器。
- 新增内置视频生成 Skill 和 `generate_video` Tool。每个视频 Run 由外层 Agent 解析自然语言、加载 Skill/环境并在需要时调用 Tool；无需二次确认，发送即开始生成。
- 通过百炼北京地域接入可灵、HappyHorse、Vidu、爱诗的文生视频与单张首帧生视频模型，以仓库内版本化目录聚合能力并隔离厂商协议。
- 首次请求按服务端环境变量选择满足要求的默认视频品牌（默认值为HappyHorse）；同一 Thread 软绑定实际视频模型。后续优先复用，能力不足时自动切换且只显示通用提示；实际模型只对后台可见。
- 默认参数为 5 秒、720P、纯文生视频 16:9、开启音频。平台聚合两条链路内的厂商能力并集，不限制用户自然语言；全部模型都不支持的修改保留在 Prompt 中，并沿用上一版可执行参数继续生成。
- 新增 API 进程内持久 Video Reconciler、PostgreSQL lease 和 Agent Run continuation。关闭页面不停止任务；API 重启后用原 provider task ID 恢复，不自动重试或重新提交。
- 参考图选择后直接写入私有临时 OSS staging 对象并返回opaque asset ID；提交时生成短期签名 URL，任务终态后删除，Bucket 生命周期规则兜底清理，不进入 Sandbox、不创建 Creation 或永久资产。
- 厂商成功结果必须先安全、流式下载到 Sandbox 并校验 MP4；未保存视频通过 owner-scoped Range 路由预览。
- 保存将视频幂等上传私有 OSS 并创建永久 Creation；下载执行完全相同的保存链路后，再下载到用户本地，因此下载过的视频也出现在“我的创作”。
- 外层 Agent 在视频 Tool 成功后再次生成最终回复和 3–5 条结构化修改建议；Web 渲染为可点击气泡，点击即发送 Prompt 并直接开始下一 Run。
- 新增视频任务账本和版本化人民币费用估算，管理员可查看实际模型、路由、状态、生成秒数、取消/超时和费用；普通用户不显示实际视频模型或费用。
- 本 change 不增加用户白名单、feature flag、平台内容审核、视频专属成本硬顶或连续取消防刷控制。

## Capabilities

### New Capabilities

- `agent-video-generation`: Thread 视频模式、内置 Skill、`generate_video` Tool、连续自然语言修改和结构化建议气泡。
- `bailian-video-provider`: 四品牌版本化模型目录、能力路由、百炼异步协议、持久任务协调、恢复、取消、超时和计费。
- `video-creation-assets`: Sandbox 参考图与临时视频、签名输入代理、Range 预览、OSS 永久保存/下载及“我的创作”。

### Modified Capabilities

无。本能力通过独立 change 增加，不修改 `build-aigateway-v1` 的既定验收边界。

## Impact

- `apps/web`：Composer 视频模式、参考图上传、视频 Tool UI、预览浮层、保存/下载和建议气泡。
- `apps/api`：视频 Skill/Tool、模型目录与 Adapter、任务 Reconciler、Run continuation、Sandbox 输入/输出路由、Creation 保存和管理员查询。
- `packages/sdk`：视频 Run mode、Tool 参数/result、任务状态、上传、预览、保存和下载契约；不暴露厂商 URL、Sandbox 路径或实际视频模型。
- PostgreSQL/Prisma：新增或扩展视频任务、模型绑定、轮询 lease、Sandbox资产、Creation 关联和视频计费字段，并提供正式 migration。
- 部署：复用单 ECS、单 API 进程、PostgreSQL、Redis、OpenSandbox、私有 OSS 和 Nginx；不引入 BullMQ、Worker、微服务或新公网入口。
- 回滚：停止接受新视频 Run，Reconciler继续对账已提交任务；新增可空字段、日志、账单和已保存 OSS 视频不删除。

## Acceptance Boundary

登录用户可在同一 Thread 切换到视频模式，以文本或文本加一张首帧图发送请求，经外层 Agent、`generate_video` Tool、能力路由和百炼异步任务生成视频。关闭页面或 API 重启后任务可恢复；成功视频进入 Thread Sandbox并可预览，保存或下载后成为永久 Creation；后续建议气泡可发起继承上下文的新一轮生成。全链路形成可审计任务、日志和人民币费用记录，并由离线 fixture 自动化测试验证。
