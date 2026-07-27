## Context

当前旧 `/chat` 使用 assistant-ui LocalRuntime 直接消费 Chat SSE，刷新后状态丢失；`/image` 和 `/prompt` 分别维护图片任务表单/localStorage 历史与 Prompt 优化表单；Agent 使用持久 thread/run/event 模型，并已覆盖普通文本回答、模型选择、停止、错误、费用、工具、Skill、MCP 和上下文压缩。多个并列任务页面与营销首页削弱 Agent 产品定位，并带来重复维护。

## Goals / Non-Goals

### Goals

- 让用户登录后直接在根路径 `/` 开始普通对话或多步 Agent 任务，C 端不再提供营销首页、`/agent` 别名或独立 Image/Prompt 工作台。
- 保持旧书签和已有链接可恢复地跳转。
- 保留多模型对比及底层 Chat/Image/Prompt API/SDK。
- 不破坏登录、登出回跳和导航激活状态。

### Non-Goals

- 不把 `/chat/compare` 改写为 Agent 多 run 编排。
- 不删除 Chat API、Adapter、SDK 类型、限流、计费或日志。
- 不迁移旧 `/chat` 的浏览器内存消息，因为其本来不持久化。
- 不迁移 Image localStorage 历史；删除页面不会主动清理用户浏览器已有键。
- 不把 Image/Prompt 能力接入 Agent 工具，本 change 只收敛页面。
- 不删除 Image/Prompt API、SDK、Adapter、数据库、计费或管理员日志。
- 不改变 Agent thread、run 或数据库结构。

## Decisions

### `/` 是规范入口，`/chat` 使用服务端临时跳转

Agent 页面实现迁移到 `apps/web/src/app/page.tsx`，原营销 Hero 与 `apps/web/src/app/agent/page.tsx` 删除。`apps/web/src/app/chat/page.tsx` 保留为极小的 Next.js Server Component，并调用 `redirect('/')`。这样旧 Chat 链接不会 404，也不会先加载旧客户端 bundle。`/agent` 不保留 page 或 redirect，访问时直接返回 404。

### 多模型对比暂时保留独立路由

`/chat/compare` 的每列是独立 Chat SSE 请求，和 Agent 的单用户 active run、持久 thread 语义不同。本 change 只把它作为 Agent 的子入口：Agent Composer 提供“模型对比”链接，对比页返回 `/`，侧栏在对比页保持 Agent 导航激活。

### 删除旧页面专属 adapter

`agent-chat-adapter.ts` 只被旧 `/chat` 页面使用。移除页面后同时删除 adapter 及其测试，避免保留无人消费的浏览器内存聊天路径。Markdown 渲染和共享 thread UI 仍被 Agent、Prompt 与对比页使用，继续保留。

### 登录默认回跳到 Agent

`sanitizeUserReturnTo` 只允许 `/` 与 `/chat/compare`，缺失、`/agent` 或其他非法值统一回退 `/`。`/chat/compare` 仍是显式允许的受保护页面。

### Image/Prompt 路由直接删除

与 `/chat` 的历史兼容策略不同，`/image` 和 `/prompt` 不保留 page file 或 redirect。删除对应目录中的页面专属实现、helper 与测试后，Next.js 对这两个 URL 返回 404。共享 Markdown、SDK、API 和管理后台功能不属于页面专属代码，继续保留。

### 根路径不再提供营销首页

Agent 已是唯一 C 端工作台，登录用户不需要先经过 Hero 或 CTA。根路径直接渲染受登录保护的 Agent 页面，营销 Hero、Gateway Prism、接入说明与底部 CTA 全部删除。

### `/api` 展示页直接删除

现有 `/api` 页面只手工列出少量 Gateway endpoint，与已经包含 Agent thread/run、MCP、Skill 市场和上传能力的 `@supermind/sdk` 不再一致。删除页面、侧栏入口和页面专属示例代码，不保留 redirect。该路由退役不影响 Nginx/Next rewrites 下的 `/api/v1/*` 请求、NestJS Swagger `/api-docs`、SDK 源码或仓库文档。

## Risks / Trade-offs

- Agent 比旧 Chat 多一次 thread/run 持久化并受单用户 active run 约束，但换来刷新恢复、审计和扩展能力一致性。
- `/chat/compare` 暂时保留在旧路径，URL 信息架构仍不完全统一；后续可独立迁移到新的根工作台子路由。
- 旧 `/chat` E2E 需要改为验证跳转，普通对话能力改由 Agent E2E 负责。
- 旧 `/image`、`/prompt` 链接会直接 404；这是用户明确要求的不兼容删除。
- Image/Prompt API 暂时没有对应 C 端消费者，但保留它们可避免把页面信息架构调整扩大成网关删除和数据库破坏性迁移。

## Verification

- 路由测试确认 `/chat` 不渲染旧 UI，并跳转到 `/`。
- 构建产物不再包含 `/agent`、`/image`、`/prompt`、`/api` 页面，dev 验证四者返回 404；`/api/v1/*` 仍按现有代理配置访问网关。
- 根路径源码与渲染结果直接提供 Agent，不再包含营销 Hero。
- 用户认证 helper 测试确认 `/agent`、`/chat`、`/image`、`/prompt` 和非法回跳为 `/`，对比页仍允许。
- Web 测试、typecheck、lint 和生产 build 通过。
- OpenSpec strict validation 通过。
