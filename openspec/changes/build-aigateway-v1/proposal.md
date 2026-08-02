## Why

项目已经明确了产品范围、技术栈和部署边界，但尚缺少一份可以直接指导开发的模块化技术方案与实施顺序。当前应先建立一个可运行、可观测的端到端纵向切片，验证 Web、SDK、API、模型适配和数据落库的主链路，再以相同边界逐步补齐真实模型、文生图、管理后台和部署能力，降低同时铺开功能带来的返工风险。

## What Changes

- 建立 pnpm monorepo 下的模块化单体工程边界，统一 Web、API、内部 `@supermind/sdk`、数据库和基础设施配置。
- 先通过 Mock Adapter 串通 Agent run 到模型事件流、请求日志和计费记录的完整链路，形成第一个可验收版本。
- 在统一模型网关后逐个接入通义千问、智谱 GLM、DeepSeek 和 Kimi，并补齐模型目录、thinking/reasoning 事件、取消请求、错误归一化和首事件前故障转移。
- 将可选择的模型实例与厂商 Adapter 解耦，通过仓库内受版本控制的服务端模型目录配置公开模型 ID、社区名称、厂商和上游模型 ID，使同一厂商可并列新增多个模型而无需扩展前端联合类型或开放运行时配置入口。
- 复用统一网关能力实现文生图异步任务和 Prompt 优化页面。
- 建立独立管理后台，实现固定管理员登录、仪表盘、请求日志详情、业务表白名单编辑/删除和不可篡改的管理审计日志。
- 建立 Pino 结构化日志、PostgreSQL 业务记录、Redis 限流/健康状态和费用估算的可观测链路。
- 提供阿里云 ECS 单机 Docker Compose + Nginx 部署方案，同时支持域名和公网 IP 访问。
- V1 暂不实现内容安全审核、全站每日调用硬顶、正式账号/权限体系、BullMQ 和国外模型厂商；这些保留为后续 change，不作为本次主链路验收阻塞项。

## Capabilities

### New Capabilities

- `platform-foundation`: 工程骨架、共享契约、配置管理、数据库/缓存基础设施、健康检查和 Mock Adapter。
- `chat-gateway`: Agent 内部统一模型调用端口、模型事件流及国内文本模型适配；不再提供独立公开 Chat completions 产品接口。
- `image-generation`: 文生图提交、异步任务状态、结果轮询、图片代理下载及任务持久化。
- `prompt-optimization`: 基于统一聊天网关的 Prompt 优化模式、结果展示和复制操作。
- `admin-console`: 固定管理员认证、仪表盘、日志查询、业务表白名单维护和管理操作审计。
- `observability-billing`: 完整 Prompt 请求日志、结构化运行日志、Token/费用记录和运行指标聚合。
- `agent-token-analytics`: 仅面向 Agent Run 的可追溯 Token 明细、用户个人用量分析及管理员按模型、Skill、Tool 的聚合统计。
- `deployment-delivery`: ECS 单机容器编排、Nginx 域名/IP 入口、配置注入、数据备份和发布验收。

### Modified Capabilities

无。仓库当前没有已发布的 OpenSpec capability，本次全部为新增能力。

## Impact

- 新增 `apps/web`、`apps/api`、`packages/sdk` 及共享配置/类型模块；不引入额外的模型 SDK 包作为 Web 应用依赖。
- 新增面向 Agent、文生图和 Prompt 优化的 API，以及仅供管理后台使用的认证、查询和维护 API；移除已被 Agent 取代的公开 Chat completions API。
- 新增 PostgreSQL 表 `RequestLog`、`BillingRecord`、`ImageGenerationTask`、`AdminAuditLog`；Redis 仅承担限流与短期健康状态，不作为持久化来源。
- 新增 Nginx、Next.js、NestJS、PostgreSQL、Redis 的单机 Docker Compose 拓扑和 ECS 运维配置。
- 第一阶段可在没有真实厂商 API Key 时使用 Mock Adapter 验收；接入真实厂商时仅增加适配器和环境变量，不改变公开 SDK 契约。
- 回滚以容器镜像版本和数据库向后兼容迁移为边界；在首个生产版本前可整体回退到 Mock-only 版本，已落库请求记录不删除。

## V1 Acceptance Boundary

本 change 的最低成功标准是：登录用户从根路径 Agent 工作台创建持久 thread/run，经 `@supermind/sdk` 调用 NestJS Agent API，Mock Adapter 以可恢复事件流返回 reasoning、文本和终态，页面可正确展示，并在 PostgreSQL 中形成可被管理后台查询的请求日志与计费记录。独立 `/chat` 仅保留到 `/` 的兼容跳转，`/chat/compare` 与 `POST /api/v1/chat/completions` 不再属于产品契约。
