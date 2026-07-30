# Super Mind Studio

Super Mind Studio 是一个面向灵感探索与任务执行的 AI Agent 工作空间。用户可通过一次性匿名、GitHub OAuth 或 Google OAuth 登录，在持久 Agent 中进行普通对话或多步任务并使用 Skill；管理员中后台负责模型调用、费用、日志和业务数据治理。底层模型网关统一提供 Qwen、GLM、DeepSeek、Kimi 与 Mock Adapter，Image 与 Prompt 作为内部 API/SDK 能力保留。

## 环境要求

- Node.js 24 LTS
- pnpm 10（仓库通过 `packageManager` 固定版本）
- Docker Engine 与 Docker Compose（启动 PostgreSQL、Redis 时需要）

## 初始化

```bash
corepack enable
pnpm install
cp .env.example .env
# 匿名登录始终可用；需要 OAuth 时创建本地 Client 并填写对应配置
# GITHUB_OAUTH_ENABLED=true
# GITHUB_CLIENT_ID=...
# GITHUB_CLIENT_SECRET=...
# GOOGLE_OAUTH_ENABLED=true
# GOOGLE_CLIENT_ID=...
# GOOGLE_CLIENT_SECRET=...
pnpm infra:up
pnpm db:migrate:deploy
pnpm dev
```

本地 callback 必须分别精确配置为 `http://localhost:3001/api/v1/auth/github/callback` 和 `http://localhost:3001/api/v1/auth/google/callback`。GitHub 只保存已验证主邮箱；Google 只在 `email_verified=true` 时保存邮箱，缺少邮箱不影响登录。身份唯一性只使用 `(authProvider, providerUserId)`，绝不按邮箱合并。用户端 Session API 不返回 Provider ID 或邮箱。`USER_SESSION_TTL_SECONDS` 固定为 `2592000`（30 天），不要提交 Client Secret、OAuth token 或 Session Secret。

默认地址：

- Web：http://localhost:3000
- API：http://localhost:3001/api/v1
- Liveness：http://localhost:3001/health/live
- Readiness：http://localhost:3001/health/ready
- Swagger UI：http://localhost:3001/api-docs
- OpenAPI JSON：http://localhost:3001/api-docs/openapi.json

登录页、模型列表和 health 保持公开。根路径 `/` 直接承载 Agent，要求 `aigateway_user_session` HttpOnly Cookie；该 Cookie 可由匿名、GitHub 或 Google 登录创建。匿名登录每次创建新的不可恢复 User，但拥有与 OAuth 用户相同的功能和永久数据保留行为。以下用户能力同样要求该 Session：

- `POST /api/v1/images/generations` 及任务状态/下载
- `POST /api/v1/prompts/optimize`
- `/api/v1/agent/*`（持久 Agent 会话、运行事件和 Skill 市场）

## 用户对话入口

根路径 `/` 是普通对话和工具型多步任务的统一入口，会话与运行事件持久化到 PostgreSQL。登录成功后直接进入 `/`；营销 Hero 首页与 `/agent` 路由均已移除，`/agent` 不做兼容跳转。旧 `/chat` 不再加载独立的浏览器内存聊天应用，访问时会兼容跳转到 `/`。

`/chat/compare` 和公开 `POST /api/v1/chat/completions` 已删除，`@supermind/sdk` 不再暴露 `chat.stream/compare`。服务端仍使用厂商 Chat Completions 协议作为 Adapter 实现细节，Agent 通过内部 `ModelInvocationPort` 消费统一 reasoning/text/tool/usage/finish 事件。

四个真实模型均在服务端显式使用 thinking：Qwen3.7-Plus 开启 `enable_thinking`，GLM-5.2 与 DeepSeek-V4-Pro 开启 `thinking.type` 并使用 `reasoning_effort=max`，Kimi K3 使用其强制 thinking 模式和 `reasoning_effort=max`。`reasoning_content` 只进入 Agent reasoning 事件，不混入最终回答文本。

C 端不再提供 `/image` 与 `/prompt` 页面，访问这两个地址直接返回 404，不做兼容跳转。Image/Prompt 的 API、SDK、数据库记录和管理端日志仍保留，供 Agent 工具化或后续内部场景复用。

C 端 `/api` 展示页也已移除并直接返回 404。该页面删除不影响同源 `/api/v1/*` 网关、API 服务上的 Swagger/OpenAPI、`@supermind/sdk` 或仓库内开发文档。

## Agent Skill 市场

登录后访问 `/skills` 可以安装、启用、停用或卸载平台维护的 Skill。Skill 内容来自 API 仓库内经过审核的清单，服务启动时会校验 ID、版本、字段长度和工具引用；系统不会扫描本地目录、下载远程包、执行 Skill 代码或把 Skill 当成新的工具权限。

安装状态按平台 User UUID 保存在 `UserAgentSkill`。启用状态从下一次 Agent 模型调用开始生效，`AgentPromptComposer` 会按用户加载已启用 Skill，并把 `skillId@version` 写入当次 prompt manifest。浏览器只接收展示元数据，不接收模型指令正文。

相关 API：

- `GET /api/v1/agent/skills`
- `PUT /api/v1/agent/skills/:skillId/install`
- `PATCH /api/v1/agent/skills/:skillId`
- `DELETE /api/v1/agent/skills/:skillId/install`

## Agent 沙箱生命周期

Agent Thread 在第一次 Run 时按需创建一个隔离沙箱，同一 Thread 的后续 Run 复用该工作区；每轮仍会重新校验并激活 Skill，同时重置 Shell、流量和输出预算。Run 成功、失败或取消后沙箱转为空闲，不立即销毁；删除 Thread、沙箱失效或达到空闲/硬生命周期上限时执行幂等销毁。

`SANDBOX_TIMEOUT_SECONDS` 同时控制沙箱最大生命周期和空闲保留上限，默认值为 `3600`（1 小时）。OpenSandbox 的创建请求会接收同样的硬 TTL，API 重启后会从 PostgreSQL 恢复未过期 Thread 沙箱的清理期限。

本地开发与生产环境都只使用真实 OpenSandbox Server，不提供进程内 Sandbox fallback。API 启动前必须配置 `OPEN_SANDBOX_DOMAIN`、`OPEN_SANDBOX_API_KEY`，并按需配置协议、镜像、请求/就绪超时和 server proxy；缺少连接配置时 API 会直接拒绝启动。

`/api/v1/admin/*` 使用另一枚 `aigateway_admin_session` Cookie，与用户 Session 完全隔离。Swagger 只描述 Cookie 认证边界，不展示或接收 OAuth code、Provider access token、Client Secret 或原始 Session token。

## Agent 跨会话并发

同一用户可以在不同 Thread 中并发运行 Agent，同一 Thread 始终最多一个 active run。默认每用户最多同时运行 3 个，可通过 `AGENT_MAX_CONCURRENT_RUNS_PER_USER` 设置为 1–5；设为 1 可立即降级为串行模式。Web 只禁用当前运行中 Thread 的输入，其他 Thread 继续可用，并在侧栏标记后台任务。

并发上限在 PostgreSQL 事务中原子检查，Redis Thread 锁不可用时 fail closed。每个 Run 的事件、取消、Sandbox、usage 和费用仍按 runId/threadId 隔离。

## Agent 网页搜索

Agent 提供统一的 `web_search` 工具，服务端参考 OpenCode 通过远程 MCP 对接 Exa 与 Parallel，模型和浏览器不会看到两家的内部工具名或凭证。默认 `AGENT_WEB_SEARCH_PROVIDER=auto` 会按 Agent run ID 稳定选择一家；排障时可固定为 `exa` 或 `parallel`，设置 `AGENT_WEB_SEARCH_ENABLED=false` 可从工具清单中关闭搜索。

当前开发流程直接使用两家无需 Key 的匿名免费入口，不需要申请 API，也不要在 `.env` 中填写凭证。匿名额度可能被限流或调整，不是生产 SLA；若以后需要正式额度，只能在服务端配置可选的 `EXA_API_KEY` 或 `PARALLEL_API_KEY`，不能发送到浏览器、写入日志或提交仓库。

搜索词会发送给被选中的第三方 provider。返回内容受 2 MiB 响应上限和 30,000 字符模型输入上限约束，并作为不可信外部数据交给 Agent；结果中的指令不能扩展工具权限或要求泄露凭证。需要精读特定 URL 时由 Agent 继续调用具备 SSRF 防护的 `web_fetch`。

默认测试完全使用本地 fixture，不访问公网。仅在需要检查当前匿名入口时显式运行以下命令；它会向 Exa 和 Parallel 各发送一次固定的小查询，不读取 API Key：

```bash
pnpm test:smoke:web-search
```

## Agent MCP 接入

Agent 支持由平台管理员在 API 服务端配置远程 MCP Server。每次 Agent run 开始前，API 会通过 Streamable HTTP 发现允许的工具，并把 built-in 与 MCP 工具集合冻结到本次运行；远程工具统一命名为 `mcp__<server-id>__<tool-name>`。浏览器只能读取脱敏后的 Server 状态和工具数量，不会收到 endpoint、Authorization header 或 token。登录用户可以在 `/plugin` 启用或禁用内置 Server，偏好按账户保存并只影响之后启动的 Agent run。

平台 MCP 端点定义在 `apps/api/src/agent/mcp/agent-mcp.config.ts`，需要完成外部服务审核后随代码发布。需要 Bearer Token 的 Server 只从服务端环境变量读取凭证，例如：

```dotenv
DOCS_MCP_TOKEN=<仅保存在服务端的 token>
```

V1 只支持 Streamable HTTP，以及 `read`/`external_send` 风险级别；不支持浏览器自助添加 Server、OAuth、stdio、resources、prompts、sampling、elicitation 或破坏性工具。生产环境只允许 HTTPS endpoint，本地开发和测试可使用 loopback HTTP。配置声明了工具白名单时，工具必须同时存在于远端 `tools/list` 与该白名单中才会注册；未声明时注册安全发现到的全部工具。

本地开发可选接入企查查企业数据 MCP：在未提交的 `.env` 中设置 `QCC_API_KEY`；接入 RollingGo 酒店与机票 MCP 时设置 `ROLLINGGO_MCP_API_KEY`；接入高德地图 MCP 时设置 `AMAP_MCP_API_KEY`。所有平台 MCP 默认关闭，用户在 `/plugin` 手动开启后才会参与新的 Agent 运行；如果端点配置未声明工具白名单，则会向 Agent 提供该 MCP 安全发现到的全部工具。浏览器页面仅显示状态与工具数量，绝不会返回 Key 或服务端地址。

相关接口与验证命令：

- `GET /api/v1/agent/mcp/servers`：要求用户 Session，只返回脱敏状态与当前用户开关。
- `PATCH /api/v1/agent/mcp/servers/:serverId`：只接受 `{ "enabled": boolean }`，不能新增或修改 Server。
- 平台预置 Context7、DeepWiki 和企查查企业数据；启动 dev 服务后可在 Agent 右上角运行环境面板确认用户已开启的 Server 状态和工具数量。

## 阿里云 ECS 生产部署

项目提供 Web/API 多阶段镜像、单机生产 Compose、Nginx SSE 代理、日志轮转、PostgreSQL 备份恢复和人工发布脚本。部署前请完整阅读 [ECS 单机部署与回滚手册](docs/deployment/ecs.md)。

首次 ECS 上线必须使用 Mock-only 模型配置。匿名登录始终可用；启用 GitHub 或 Google 时必须使用独立的生产 OAuth Client，且 callback 只支持 HTTPS 域名。公网 IP 只能用于 health 等公开入口验收，不能作为 OAuth callback。生产环境变量只保存在服务器的 `.env.production`，不要复制本机 `.env` 或提交真实密钥。

## 常用命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm check
pnpm db:validate
pnpm db:generate
pnpm db:migrate:dev
pnpm db:migrate:deploy
```

Mock Agent 主链路可在不配置任何真实厂商 API Key 的情况下执行完整回归。命令会校验测试数据库名，部署已有 migration，并运行 SDK、API、本地 PostgreSQL E2E、Web 状态测试与 Web 生产构建：

```bash
TEST_DATABASE_URL=postgresql://aigateway:password@localhost:5432/aigateway_test pnpm test:mock-chat
```

Qwen Adapter 的默认单元测试只读取去敏 fixture，不访问外部网络。购买并配置北京地域百炼 API Key 后，可显式执行一次低额度真实冒烟；若控制台提供了带 Workspace ID 的专属地址，应同时覆盖 `QWEN_BASE_URL`：

```bash
pnpm test:smoke:qwen
```

GLM 同样使用显式的低额度冒烟命令，默认端点为智谱官方兼容地址：

```bash
pnpm test:smoke:glm
```

DeepSeek 当前使用 V4 模型 ID，真实冒烟命令如下：

```bash
pnpm test:smoke:deepseek
```

上述冒烟命令与 Kimi 一样读取根目录中不会提交的 `.env`，不会打印 API Key，也不会被 `pnpm test` 或 CI 自动执行。运行前必须填写对应 `*_API_KEY`；模型 ID 统一取自 `apps/api/src/chat/chat-models.config.ts`，正式启动 API 时还需要将对应 `*_ENABLED` 改为 `true`。

Kimi 使用中国区 Moonshot 兼容端点。先在 Moonshot 控制台创建新 Key，并只写入不会提交的本地 `.env`：

```bash
KIMI_ENABLED=true
KIMI_API_KEY=<新创建的 Key>
KIMI_BASE_URL=https://api.moonshot.cn/v1
```

然后显式执行最多输出 16 Token 的真实冒烟：

```bash
pnpm test:smoke:kimi
```

浏览器手工验收时运行 `pnpm dev`，分别通过匿名、GitHub 和 Google 登录后在同源 `/` 发起普通对话；Agent 的内部模型调用应能在 `RequestLog` 中查到 `SUCCEEDED` 记录、必填 `userId` 及其一对一 `BillingRecord`。访问 `/chat` 应直接跳转到 `/`，访问 `/agent` 应返回 404。API 的注入点使用显式 token，使 `tsx watch` 开发态与 TypeScript 生产构建保持一致。

重置测试数据库前必须显式提供数据库名包含 `_test` 或 `test_` 的 `DATABASE_URL`：

```bash
DATABASE_URL=postgresql://aigateway:password@localhost:5432/aigateway_test pnpm db:test:reset
```

禁止把真实 API Key、生产数据库密码或 Cookie secret 提交到仓库。

## 如何查看sandbox容器

1. 登录到ECS后台，执行`docker ps`
2. 找到对应的sandboxId，然后执行`docker exec -it <sandboxId> <shell命令>`

## 如何看数据库

1. `/admin` 后台能看，但不能改数据。
2. Prisma Studio：先执行 `pnpm infra:up`，然后执行 `pnpm exec prisma studio`。
