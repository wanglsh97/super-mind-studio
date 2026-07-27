# Super Mind Studio

Super Mind Studio 是一个面向灵感探索与内容创作的 AI 工作空间。用户通过 GitHub 登录后可以使用 Chat、多模型对比、文生图、Prompt 优化、Agent 与 Skill；管理员中后台负责模型调用、费用、日志和业务数据治理。底层 AI Gateway 统一模型协议与厂商差异，当前工程优先使用 Mock Adapter 串通完整链路。

## 环境要求

- Node.js 24 LTS
- pnpm 10（仓库通过 `packageManager` 固定版本）
- Docker Engine 与 Docker Compose（启动 PostgreSQL、Redis 时需要）

## 初始化

```bash
corepack enable
pnpm install
cp .env.example .env
# 在 GitHub 创建仅供本地开发使用的 OAuth App，再填写下列三项
# GITHUB_OAUTH_ENABLED=true
# GITHUB_CLIENT_ID=...
# GITHUB_CLIENT_SECRET=...
pnpm infra:up
pnpm db:migrate:deploy
pnpm dev
```

本地 OAuth App 的 callback 必须精确配置为 `http://localhost:3001/api/v1/auth/github/callback`。邮箱只在 GitHub 返回已验证主邮箱时保存，缺少邮箱不影响登录；用户端 Session API 不返回邮箱。`USER_SESSION_TTL_SECONDS` 固定为 `2592000`（30 天），不要提交 Client Secret 或 Session Secret。

默认地址：

- Web：http://localhost:3000
- API：http://localhost:3001/api/v1
- Liveness：http://localhost:3001/health/live
- Readiness：http://localhost:3001/health/ready
- Swagger UI：http://localhost:3001/api-docs
- OpenAPI JSON：http://localhost:3001/api-docs/openapi.json

首页、登录页、模型列表和 health 保持公开。以下用户能力要求 `aigateway_user_session` HttpOnly Cookie，Cookie 只能由 GitHub callback 创建：

- `POST /api/v1/chat/completions`
- `POST /api/v1/images/generations` 及任务状态/下载
- `POST /api/v1/prompts/optimize`
- `/api/v1/agent/*`（持久 Agent 会话、运行事件和 Skill 市场）

## Agent Skill 市场

登录后访问 `/skills` 可以安装、启用、停用或卸载平台维护的 Skill。Skill 内容来自 API 仓库内经过审核的清单，服务启动时会校验 ID、版本、字段长度和工具引用；系统不会扫描本地目录、下载远程包、执行 Skill 代码或把 Skill 当成新的工具权限。

安装状态按 GitHub 用户保存在 `UserAgentSkill`。启用状态从下一次 Agent 模型调用开始生效，`AgentPromptComposer` 会按用户加载已启用 Skill，并把 `skillId@version` 写入当次 prompt manifest。浏览器只接收展示元数据，不接收模型指令正文。

相关 API：

- `GET /api/v1/agent/skills`
- `PUT /api/v1/agent/skills/:skillId/install`
- `PATCH /api/v1/agent/skills/:skillId`
- `DELETE /api/v1/agent/skills/:skillId/install`

`/api/v1/admin/*` 使用另一枚 `aigateway_admin_session` Cookie，与 GitHub 用户 Session 完全隔离。Swagger 只描述 Cookie 认证边界，不展示或接收 OAuth code、GitHub access token、Client Secret 或原始 Session token。

## 阿里云 ECS 生产部署

项目提供 Web/API 多阶段镜像、单机生产 Compose、Nginx SSE 代理、日志轮转、PostgreSQL 备份恢复和人工发布脚本。部署前请完整阅读 [ECS 单机部署与回滚手册](docs/deployment/ecs.md)。

首次 ECS 上线必须使用 Mock-only 模型配置，并使用独立的生产 GitHub OAuth App。生产 callback 只支持 HTTPS 域名；公网 IP 只能用于首页和 health 等公开入口验收，不能作为生产登录入口。生产环境变量只保存在服务器的 `.env.production`，不要复制本机 `.env` 或提交真实密钥。

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

Mock Chat 主链路可在不配置任何真实厂商 API Key 的情况下执行完整回归。命令会校验测试数据库名，部署已有 migration，并运行 SDK、API、本地 PostgreSQL E2E、Web 状态测试与 Web 生产构建：

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

浏览器手工验收时运行 `pnpm dev`，先通过 GitHub 登录，再访问同源 `/chat` 发起请求；页面展示的 request ID 应能在 `RequestLog` 中查到唯一的 `SUCCEEDED` 记录、必填 `userId` 及其一对一 `BillingRecord`。API 的注入点使用显式 token，使 `tsx watch` 开发态与 TypeScript 生产构建保持一致。

重置测试数据库前必须显式提供数据库名包含 `_test` 或 `test_` 的 `DATABASE_URL`：

```bash
DATABASE_URL=postgresql://aigateway:password@localhost:5432/aigateway_test pnpm db:test:reset
```

禁止把真实 API Key、生产数据库密码或 Cookie secret 提交到仓库。
