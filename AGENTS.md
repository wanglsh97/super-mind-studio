# Super Mind Studio 协作说明

本文件适用于整个仓库。所有开发代理在分析、设计、编码、测试和交付时都必须遵守。

## 1. 交流语言

- 默认使用中文与用户交流，代码标识符、协议字段、命令和必要的技术名词可保留英文。
- 先说明结果、风险或阻塞，再补充实现细节。
- 不确定但不影响主流程时，采用最小合理假设并明确记录；会改变产品范围、数据安全或外部成本时，先向用户确认。

## 2. 项目目标

Super Mind Studio 是一个公开访问的 AI 能力演示站及其管理员中后台，V1 包含：

1. API 网关服务建设，包括统一模型协议、数据库表、日志计费、限流、测试和单机部署基础。
2. 管理员中后台，包括登录、Dashboard、请求日志、数据库业务表维护和操作审计。
3. 用户端网页，包括 Chat、文生图和 Prompt 优化。

V1 的首要目标是先串通完整流程，不追求一次性完成所有真实模型和高级治理能力。

## 3. 事实来源与优先级

开始工作前按任务范围阅读以下文件：

- 产品范围：[spec/需求文档.md](spec/需求文档.md)
- 技术基线：[spec/技术选型方案.md](spec/技术选型方案.md)
- 当前 OpenSpec change：[openspec/changes/build-aigateway-v1](openspec/changes/build-aigateway-v1)
- 技术设计：[openspec/changes/build-aigateway-v1/design.md](openspec/changes/build-aigateway-v1/design.md)
- 实施任务：[openspec/changes/build-aigateway-v1/tasks.md](openspec/changes/build-aigateway-v1/tasks.md)

发生冲突时按以下优先级处理：

1. 用户最新明确确认的决定。
2. 当前已接受的 OpenSpec proposal、specs 和 design。
3. 技术选型方案。
4. PRD 中未被后续决定覆盖的内容。

不能只在代码中改变已确认行为。若需求或架构发生变化，应同步更新对应 OpenSpec artifact 和相关文档，保持代码、规格与任务一致。

## 4. 当前 OpenSpec 工作方式

- 当前 change ID 为 `build-aigateway-v1`，schema 为 `spec-driven`。
- 实现前必须阅读当前任务对应的 `proposal.md`、`design.md`、capability spec 和 `tasks.md`。
- 按 `tasks.md` 的 checkbox 跟踪进度；只有实现完成并通过相应验证后才能将 `- [ ]` 改为 `- [x]`。
- 行为与 spec 不一致时，先修改 artifact 并说明原因，不能让实现静默偏离规格。
- 每次修改 artifact 后执行 strict 校验。若本机没有全局 CLI，使用：

```bash
npx -y @fission-ai/openspec@1.6.0 validate build-aigateway-v1 --type change --strict --no-interactive
```

- OpenSpec artifact graph 表示依赖关系，不代表所有任务必须机械串行执行。
- change 未完成验证前不得归档。

## 5. 实施优先级

三个板块用于任务归类，实际实现采用纵向切片：

1. 先完成 `tasks.md` 中网关板块 `1.1–1.20`。
2. 紧接着完成用户端板块 `3.1–3.6`。
3. 首个验收闭环必须是：

```text
Web → @supermind/sdk → NestJS API → Mock Adapter → SSE → PostgreSQL
```

4. Mock 闭环稳定后，再逐个接入 Qwen、GLM、DeepSeek。
5. 然后完成管理员中后台、Chat 对比、文生图、Prompt 优化和 ECS 上线完善。

任何阶段都应保持已经完成的主链路可运行。没有真实 API Key 时不得阻塞工程骨架、Mock 流程、自动化测试和页面开发。

## 6. 技术基线

- Runtime：Node.js 24 LTS、TypeScript 5.9、pnpm 10。
- Monorepo：pnpm workspace。
- Web：Next.js 16、React 19、Tailwind CSS 4、shadcn/ui、Zustand 5、ECharts 6。
- API：NestJS 11 + Express。
- SDK：仓库内唯一业务 SDK 包 `@supermind/sdk`。
- 数据库：PostgreSQL 17 + Prisma 7。
- 缓存：Redis 8，仅用于限流和短期模型健康状态。
- 日志：Pino 结构化日志。
- 部署：Nginx + Docker Compose，运行在一台阿里云 ECS Ubuntu 服务器上。

除非用户明确确认并同步修改技术方案，不得擅自替换上述核心技术栈，也不得引入微服务、Kubernetes、BullMQ 或独立 Worker。

## 7. 预期目录边界

```text
apps/
  web/                 # 用户端网页和 /admin 管理后台
  api/                 # NestJS 模块化单体 API
packages/
  sdk/                 # @supermind/sdk
prisma/
  schema.prisma
  migrations/
infra/
  nginx/
  compose/
  scripts/
openspec/              # OpenSpec 规格和任务
spec/                  # PRD 与技术选型文档
```

- `apps/web` 不得直接调用厂商 API，也不得持有厂商 API Key。
- 用户端 Chat、Image、Prompt 调用必须经过 `@supermind/sdk`。
- 厂商协议、鉴权、错误和响应类型必须限制在 `apps/api` 的 Adapter 层。
- 不要把 Chat、Image、Prompt 拆成多个 npm SDK 包。
- 管理后台可使用独立的内部 admin client，但不能绕过服务端认证和字段白名单。

## 8. API 网关强制约束

### 8.1 模型与 Adapter

- 文本模型稳定别名为 `qwen`、`glm`、`deepseek`。
- V1 文生图仅保留确定性 Mock 闭环，稳定别名为 `mock-image`，不接入真实图片 Provider。
- 实际模型 ID、启用状态、API Key、价格和 fallback 通过环境变量或服务端配置提供。
- 新增厂商必须实现统一 Adapter contract，不得让业务 Service 依赖厂商响应类型。
- dev/test/CI 必须提供确定性 Mock Adapter，CI 不得依赖真实余额或外部网络。

### 8.2 Chat 流式协议

- Chat 接口为 `POST /api/v1/chat/completions`，并强制 `stream: true`。
- 使用 Fetch POST stream 和 SSE parser，不使用只支持 GET 的原生 EventSource。
- 返回 OpenAI 兼容 SSE chunk、平台 usage/人民币费用扩展，并以唯一 `data: [DONE]` 结束。
- 单模型仅允许在第一个 content delta 发送前，对符合条件的 timeout/5xx 最多 failover 一次。
- 第一个 delta 发送后禁止切换模型，必须返回规范化流错误并结束。
- 多模型对比的每个模型都是独立请求；某一路失败不能触发 failover，也不能中断其他路。
- 客户端取消必须立即停止页面读取，并 best-effort 向 API 和上游传播 AbortSignal。

### 8.3 文生图与 Prompt 优化

- 文生图采用提交任务、持久化 task ID、客户端轮询和网关代理下载的模式。
- V1 不使用后台 Worker；无人轮询的任务不主动刷新是已接受边界。
- Prompt 优化只允许 `expand`、`simplify`、`structure` 三种 mode。
- Prompt system template 由服务端版本化维护，客户端不能通过优化接口传任意 system Prompt。
- Prompt 优化复用文本模型 registry、限流、日志、usage 和计费。

### 8.4 错误和限流

- 非流式错误使用统一 JSON envelope，包含 requestId、code、message、retryable 和可选 details。
- SSE 建立前使用 HTTP 状态码；SSE 建立后使用规范化 error event。
- 默认限流：Chat 10 次/IP/分钟，文生图 5 次/IP/分钟，管理员登录 5 次/IP/分钟。
- Chat `max_tokens` 上限为 4096。
- Redis 不可用时，付费模型请求必须 fail closed，不能绕过限流继续调用。

## 9. 数据库与日志规则

V1 核心表：

- `RequestLog`：请求生命周期、完整 Prompt/messages、模型、状态、耗时、failover 和错误。
- `BillingRecord`：与 RequestLog 一对一，记录 usage、价格版本和人民币估算费用。
- `ImageGenerationTask`：平台任务、厂商任务、状态、结果和错误。
- `AdminAuditLog`：管理员修改/删除操作的不可变审计记录。

必须遵守：

- 参数校验和限流通过后，先创建 `RequestLog(pending)`，成功后才允许调用付费 provider。
- 成功、失败或取消后终结 RequestLog，并在同一事务 upsert BillingRecord。
- 管理员修改或删除业务数据时，业务变更和 AdminAuditLog 必须在同一事务提交。
- AdminAuditLog 只能新增和查询，不得提供编辑或删除接口。
- 数据库结构变化必须通过 Prisma migration，禁止只修改线上数据库或依赖自动 schema push 代替正式迁移。
- PostgreSQL 是业务记录真源；Redis 数据可重建，不保存账单、请求日志或审计真相。

V1 为联调和诊断在 PostgreSQL 与 Pino 中保存完整 Prompt，暂不自动清理，但：

- 用户端、Dashboard 聚合和日志列表不得返回完整 Prompt。
- 只有已认证的管理员请求详情可以读取完整 Prompt。
- 不得记录 API Key、Cookie、Authorization header 或 session secret。
- Docker 日志必须配置大小和数量轮转。

## 10. 管理员中后台规则

- V1 开发联调账号为 `root`，密码为 `123456`，暂不建立用户表和 RBAC。
- 登录成功后使用短期签名 HttpOnly Cookie；生产 HTTPS 下必须设置 Secure。
- `/admin/*` 页面和 `/api/v1/admin/*` API 必须同时受保护，不能只做前端路由拦截。
- 数据库管理必须使用服务端表、字段和操作白名单，不得接受任意 SQL 或信任客户端传入的权限描述。
- 编辑和删除需要二次确认，且必须记录不可变审计日志。
- 固定账号只用于开发流程。正式面向不受控公网开放管理员入口前，必须升级认证方案或关闭公网管理入口。

## 11. 用户端网页规则

- 用户端支持一次性匿名、GitHub OAuth 和 Google OAuth 三种登录；三种 provider 身份永不自动合并，即使邮箱相同也各自创建 User。首页、登录页、模型列表和 health 可公开访问，`/chat`、`/image`、`/prompt` 及对应付费 API 必须校验用户 Session。
- NestJS API 是用户认证真源，客户端不得传入或声明 `userId`；RequestLog 和 ImageGenerationTask 必须关联当前登录用户。
- 管理员认证暂时保持独立固定账号，不与用户 Session 混用。
- 页面必须提供明确的 loading、streaming、success、empty、cancelled 和 error 状态。
- Chat Markdown 必须消毒，禁止原始 HTML 和危险链接协议。
- 多模型对比的内容、usage、费用、错误和取消状态相互独立。
- 文生图最近 5 条历史保存在 localStorage；读取时要容忍损坏、过期和缺失数据。
- Web 同时适配桌面和移动端，并支持亮/暗主题。
- 浏览器始终使用同源 `/api`，不能为公网 IP 和域名构建两套不同客户端。

## 12. 测试和完成标准

开发时至少覆盖：

- 单元测试：Adapter 协议转换、费用计算、限流、首 delta failover、状态机、管理员 guard 和字段白名单。
- Contract test：Mock、Qwen、GLM、DeepSeek 的统一 Adapter 行为。
- 集成测试：PostgreSQL/Redis、请求生命周期、BillingRecord 一对一、管理员事务审计。
- 流式 E2E：delta、usage、`[DONE]`、取消、首包前失败和流中失败。
- 页面 E2E：Chat、对比、Image、Prompt、管理员未授权和完整 Prompt 访问边界。
- 部署冒烟：Nginx 下 SSE 不缓冲、IP/域名同源访问、health、数据库持久化和回滚。

完成任务前必须：

1. 运行与改动直接相关的测试。
2. 运行 typecheck、lint 和 build；若项目尚未建立对应命令，需在交付说明中明确。
3. 不使用真实模型完成的测试必须通过 Mock Adapter。
4. 涉及真实模型时先使用最低成本冒烟，并记录所用 alias/model ID，不进行无界压力测试。
5. 更新对应 OpenSpec task checkbox，并说明验证结果。

不能把“代码已写完但未验证”描述为完成。

## 13. 部署边界

- 所有 V1 服务部署在同一台阿里云 ECS：Nginx、Web、API、PostgreSQL、Redis。
- Nginx 是唯一公网入口，PostgreSQL 和 Redis 不得暴露公网。
- 同时支持域名和公网 IP；域名、HTTPS、备案和 Cookie Secure 细节在部署联调阶段落地。
- Chat SSE 路由必须关闭 Nginx proxy buffering 和 cache，并配置合理 read timeout。
- 发布前备份 PostgreSQL；Redis 不备份。
- V1 使用人工发布和回滚流程，不默认配置自动生产部署。

## 14. V1 明确暂不实现

以下事项保留在后续 change，不得在当前任务中顺手扩大范围：

- 全站小时/每日调用量与成本硬顶、代理池防刷、验证码、WAF、设备指纹。
- Chat、Image、Prompt 的独立输入/输出内容审核和违规处置链路。
- Prompt 脱敏、保留期限、访问分级和自动清理。
- BullMQ、独立 Worker 和主动后台图片任务刷新。
- 正式管理员账号体系、密码哈希、RBAC 或外部身份认证。
- OpenAI、Claude、Gemini 等海外模型。

如果真实公网发布范围触及上述安全或合规风险，必须明确提醒用户，不能把模型厂商自带拦截或单 IP 限流描述为完整保障。

## 15. 代码修改原则

- 使用 pnpm，不混用 npm/yarn lockfile。
- 优先小步、可验证修改，避免与当前任务无关的大规模重构。
- 每完成并验证一个 `tasks.md` checkbox 对应的小功能点，立即创建一次独立 Git commit；不得把多个已完成的小功能点长期堆积在未提交工作区，也不得提交尚未通过相应验证的功能点。
- 一个小功能点完成并 commit 后，自动继续实现 `tasks.md` 中下一个未完成的小功能点，不等待用户再次确认；仅在需要新增权限、产生外部成本、执行破坏性操作或存在会实质改变产品范围的阻塞决策时暂停并请求用户指示。
- 每完成一个大模块并通过该模块验收后，立即 push 该模块累计的 commits。当前大模块按 `tasks.md` 一级板块定义：`1. API 网关服务建设`、`2. 管理员中后台`、`3. 用户端网页`；模块未完成时只 commit、不提前以“模块完成”名义 push。
- commit 和 push 前必须保留用户已有改动，只暂存当前功能点范围内的文件；禁止为满足提交规则擅自覆盖、回滚或夹带无关修改。
- 保持 TypeScript 类型边界，避免用 `any` 绕过公共契约和 Adapter 映射。
- 不提交真实 `.env`、API Key、数据库密码、Cookie secret、证书私钥或生产备份。
- 不覆盖或删除用户已有改动；发现工作区存在无关修改时应保留并绕开。
- 不执行破坏性数据库、Git 或部署操作，除非用户明确授权且已有可恢复方案。
- API 行为、数据结构或部署方式发生变化时，同步更新测试、`.env.example`、Swagger/README 和 OpenSpec artifact。


## assistant-ui

This project uses assistant-ui for chat interfaces.

Documentation: https://www.assistant-ui.com/llms-full.txt

Key patterns:
- Use AssistantRuntimeProvider at the app root
- Thread component for full chat interface
- AssistantModal for floating chat widget
- useChatRuntime hook with AI SDK transport