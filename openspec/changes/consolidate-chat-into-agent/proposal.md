## Why

普通 `/chat` 与 `/agent` 都提供模型选择、流式消息和 Composer，但 `/chat` 仅保存浏览器内存状态，缺少持久会话、工具、Skill、MCP 和上下文管理。Image 与 Prompt 也作为独立主页面分散用户目标。并列入口让用户难以理解产品核心，也重复维护多个任务型表单。用户已确认 C 端专职提供 Agent 工作台：普通聊天是 Agent 的基础子场景，图片与 Prompt 页面不再作为独立产品入口。

## What Changes

- 将根路径 `/` 设为用户端普通对话和多步任务的唯一主入口，删除营销 Hero 首页。
- 移除 `/agent` 页面路由且不提供兼容跳转；移除 `/chat` 的独立页面实现，旧 `/chat` 继续兼容跳转到根路径 `/`。
- 全局导航和登录默认回跳统一指向 `/`，登录成功后直接进入 Agent。
- 在 Agent Composer 中保留“模型对比”入口；`/chat/compare` 暂时保持独立页面和现有并发隔离语义。
- 删除只服务于旧 `/chat` 页面的浏览器内存 Chat adapter。
- 直接删除 `/image`、`/prompt` 路由及页面专属 form/history/helper/test，不提供兼容跳转。
- 根工作台、全局导航、登录回跳和登录页只呈现 Agent 及其配套 Skill 能力，不再维护营销首页或独立 Image/Prompt/API 展示页面。
- 删除 `/api` C 端页面和导航入口，不提供兼容跳转；保留同源 `/api/v1/*` 网关、Swagger、`@supermind/sdk` 与开发文档。
- 保留 Chat/Image/Prompt Gateway API、`@supermind/sdk`、数据库与管理员日志，供 Agent 工具化扩展和 API 演示继续复用；不改变网关协议。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `web-agent`: `/` 成为普通对话和工具型任务的统一入口，并提供模型对比子入口。
- `user-workspace-routing`: Agent-only 根工作台导航、登录回跳、旧 `/chat` 兼容行为及 `/agent`、Image、Prompt、API 展示路由退役。

## Impact

- `apps/web` 删除营销首页及旧 Chat、Image、Prompt、API 展示页面专属代码，把 Agent 页面迁移到根路径并更新导航、登录回跳和对比页返回入口。
- `spec/需求文档.md`、`spec/技术选型方案.md` 和 README 同步新的用户端信息架构。
- API、SDK、数据库和部署拓扑不变，无 migration。
- 回滚时可恢复旧首页、`/agent`、`/chat`、`/image`、`/prompt` 页面和导航；底层 Gateway API 始终保留。
