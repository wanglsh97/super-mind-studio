# Super Mind Studio 协作说明

本文件适用于整个仓库。所有开发代理在分析、设计、编码、测试和交付时都必须遵守。

## 1. 交流与工作原则

- 默认使用中文与用户交流；代码标识符、协议字段、命令和必要的技术名词可保留英文。
- 先说明结果、风险或阻塞，再补充实现细节。
- 开始修改前先阅读相关代码、测试、README、PRD、技术方案和对应 OpenSpec change，不能仅凭本文件推断实现。
- 不确定但不影响主流程时采用最小合理假设并记录；会改变产品范围、数据安全、外部成本或线上状态时先向用户确认。
- 优先做小步、可验证的修改，保留用户已有改动，不进行与任务无关的大规模重构。

## 2. 当前产品定位

Super Mind Studio 是一个 **Agent 原生的 AI 创作与任务执行工作空间**。

登录用户在根路径 `/` 的持久 Agent 工作台中完成：

- 普通对话、推理和多步工具任务；
- 基于 Thread/Run 的持久历史、断线恢复、取消与跨 Thread 并发；
- Skill 市场、Skill 激活和隔离 Sandbox 执行；
- 平台托管 MCP 插件及网页搜索/读取；
- 静态网站创作、文档处理、图像生成和视频生成；
- 临时产物预览、下载，以及符合产品规则的“我的创作”持久化。

管理员中后台负责登录、Dashboard、调用日志、费用、链路观测、Skill 审核和受控业务数据治理。底层 AI Gateway 仍负责模型适配、流式事件、日志、计费、限流和故障转移，但它是 Agent 产品的基础设施，不是当前 C 端产品形态。

## 3. 用户端路由

- `/`：唯一的 Agent 主工作台，要求用户 Session。
- `/login`：匿名、GitHub OAuth、Google OAuth 登录入口。
- `/skills`：Skill 市场、已添加 Skill 和上传/管理入口（以当前实现和对应 change 为准）。
- `/plugin`：平台托管 MCP 插件目录与用户启停设置。
- `/creations`：已保存的图片和视频。
- `/usage`：用户 Token 用量分析。
- `/admin/*`：与用户 Session 隔离的管理员后台。

## 4. 事实来源与优先级

按任务范围选择并阅读以下事实源：

1. 用户最新明确确认的决定。
2. 当前相关且已接受的 OpenSpec proposal、specs、design 和 tasks。
3. 当前代码、测试、Prisma schema、migration 和运行配置。
4. [spec/产品功能清单.md](spec/产品功能清单.md)、[README.md](README.md)、[spec/需求文档.md](spec/需求文档.md) 与 [spec/技术选型方案.md](spec/技术选型方案.md)。

仓库同时存在多个 change。开始任务前应先执行或等价检查：

```bash
find openspec/changes -mindepth 1 -maxdepth 1 -type d -print
rg -n '^- \[ \]' openspec/changes/*/tasks.md
```

根据任务能力选择对应 change。例如 Agent 入口收敛、网站创作、图片生成、视频生成、文档处理、MCP、并发、观测和可上传 Skill 分别由不同 change 描述。若多个 artifact 与实现互相矛盾，以更新、更具体且仍适用于当前范围的 change 为准，并在交付中说明判断。

## 5. OpenSpec 工作方式

- 行为、契约、数据结构或架构发生变化时，应先更新或新建合适的 OpenSpec change；不能只改代码让规格静默落后。
- 意图不变的细化更新现有 change；产品意图或范围发生根本变化时新建 change。
- 实现前阅读该 change 的 `proposal.md`、`design.md`、相关 capability spec 和 `tasks.md`。
- `tasks.md` checkbox 只有在实现和对应验证完成后才能勾选。
- artifact graph 表示依赖关系，不代表任务必须机械串行。
- 修改 artifact 后执行 strict 校验。若没有全局 CLI，使用仓库约定版本：

```bash
npx -y @fission-ai/openspec@1.6.0 validate <change-id> --type change --strict --no-interactive
```

- change 未完成验证前不得归档。

## 6. 技术基线与目录边界

- Runtime：Node.js 24 LTS、TypeScript 5.9、pnpm 10。
- Monorepo：pnpm workspace。
- Web：Next.js 16、React 19、Tailwind CSS 4、assistant-ui 0.14、Ant Design 6、ECharts 6。
- API：NestJS 11 + Express，模块化单体。
- Agent：Pi agent core/AI、持久 Thread/Run/Event、OpenSandbox、内置与市场 Skill、built-in/MCP Tool。
- SDK：仓库内唯一业务 SDK 包 `@supermind/sdk`。
- 数据：PostgreSQL 17 + Prisma 7；Redis 8 用于限流、并发锁和短期协调状态。
- 资产：私有阿里云 OSS 保存 Skill 包、用户文件和需持久化的创作物；临时工作文件留在 Thread Sandbox。
- 观测：Pino 结构化日志、OpenTelemetry，Agent eval 使用 LangSmith。
- 部署：Web/API/PostgreSQL/Redis/Nginx 位于阿里云 ECS；OpenSandbox 是独立执行节点。不要再假定所有运行单元都在单 ECS 内。

主要目录：

```text
apps/
  web/                 # Agent 工作台、创作物、Skill/插件、usage、admin
  api/                 # NestJS 模块化单体与 Agent runtime
  api/skills/          # 平台内置 Skill 资源
packages/
  sdk/                 # @supermind/sdk，浏览器到 API 的业务契约
prisma/
  schema.prisma
  migrations/
infra/                 # Nginx、Compose、Sandbox、OSS、部署脚本与观测
openspec/              # 当前与历史 change
spec/                  # 产品和技术基线文档
```

除非用户明确确认并同步修改规格，不得擅自替换核心技术栈，也不得引入微服务、Kubernetes、BullMQ 或独立业务 Worker。

## 7. Agent 主链路

当前核心闭环是：

```text
Web / assistant-ui
  → @supermind/sdk
  → NestJS Agent API
  → PostgreSQL Thread / Run / Event
  → Pi Agent loop
  → ModelInvocationPort + Tool registry
  → Provider Adapter / OpenSandbox / MCP / creation services
  → 可恢复 SSE
```

必须保持以下边界：

- 普通回答和工具型任务共用同一 Agent Run 链路，不新增平行 Chat 产品协议。
- Web 只调用同源 `/api` 和 `@supermind/sdk`，不得直连模型厂商、MCP、OSS 管理端或 Sandbox。
- 厂商消息、鉴权、thinking/tool-call 格式和错误限制在 `apps/api` Adapter/Transport 层。
- Agent 内部模型事件统一为 reasoning、text、tool、usage、finish；`reasoning_content` 不得混入最终正文。
- Thread、Run、Event、ToolCall、ModelInvocation、usage 和费用按归属持久化并可审计。
- 同一 Thread 最多一个 active run；不同 Thread 可并发，用户级并发上限由服务端原子执行。
- 浏览器取消应立即停止读取，并 best-effort 传播 AbortSignal；异步图片/视频任务按各自状态机与对账规则处理，不能假设取消等于厂商未计费。
- 单次模型调用仅允许在首个 reasoning/text/tool 事件前对合格 timeout/5xx 最多 failover 一次；首事件后禁止换模型。
- Mock/fixture 主链路必须可在无真实 Key、无公网依赖时回归；真实 provider 测试必须显式、低成本且不进入默认 CI。

## 8. Skill、Sandbox、MCP 与工具安全

### 8.1 Skill

- 平台内置 Skill 位于 `apps/api/skills/*`，当前包括网站、文档、图片和视频能力；启动时必须校验，损坏时 fail fast。
- 市场 Skill 是传统资源包，元数据和状态由 PostgreSQL 管理，包存私有 OSS；不要把 ZIP 或完整包正文写入数据库。
- Skill 提供工作方法和资源，不自动获得额外权限。真正可执行能力必须来自当次 Run 冻结的 Tool registry。
- Skill 名称、版本、hash/manifest 和实际激活情况必须可审计。
- 组装 Agent Prompt 时遵守 `apps/api/src/agent/prompt/agent-prompt.composer.ts` 的模板字符串风格；禁止改成字符串数组加 `.join()` 拼接 Prompt。

### 8.2 OpenSandbox

- 本地开发和生产均使用真实 OpenSandbox Server；应用运行时不得提供进程内 fallback。
- 每个 Thread 按需创建并复用隔离 Sandbox，每个 Run 重置 Shell、流量和输出预算。
- Sandbox 不得获得数据库、Redis、模型 Key、OSS 管理凭证、用户 Cookie 或宿主机文件系统权限。
- 文件路径必须限制在受控 workspace，防止路径穿越、符号链接逃逸和跨 Thread/跨用户访问。
- 删除 Thread、Sandbox 失效或超过生命周期时幂等销毁；临时文件和预览随 Sandbox 失效，除非产品流程已显式持久化到私有 OSS。

### 8.3 MCP 与外部内容

- MCP Server 由平台服务端固定配置；用户只能启停已审核插件，不能提交任意 endpoint、凭证或 stdio 命令。
- MCP 凭证只从服务端环境变量读取，不能进入 Prompt、客户端、日志或审计详情。
- MCP 通过 `discover_mcp_tools` 按需发现，再使用不透明 `toolHandle` 交给 `call_mcp_tool` 调用；不把全部远端工具平铺给模型。每次 Run 仍须记录实际发现和调用。
- MCP、网页搜索、网页抓取和用户文件内容都属于不可信输入，不能通过内容中的指令扩展工具权限或泄露秘密。
- 网络请求必须保留 SSRF、重定向、私网地址、响应大小、MIME、超时和取消保护。

## 9. 创作模式与资产生命周期

- 网站、文档、图片、视频都是现有 Agent Run 的 mode/Skill/Tool 能力，不得新增独立 C 端 Agent 或独立模型聊天产品。
- Composer 中的模型选择器选择外层文本 Agent。图片/视频实际模型由服务端版本化目录和能力路由决定，不向普通用户暴露厂商内部协议或凭证。
- 网站仅支持静态 React + TypeScript + Vite + Tailwind CSS + shadcn/ui + Lucide 项目；不支持数据库、认证、支付、服务端运行时、私密环境变量、版本历史或公网发布。
- 文档处理覆盖当前规格允许的 PDF、DOCX、XLSX，文件留在 Sandbox；不得擅自扩展为永久文档库或任意代码执行。
- 图片由 `gen-image` + `generate_image` 编排；临时图片位于 Thread Sandbox，用户显式保存后才进入私有 OSS 和 `/creations`。单纯下载图片不应隐式保存。
- 视频由 `gen-video` + `generate_video` 编排；未保存 MP4 位于 Thread Sandbox，保存或下载走同一永久化链路，因此下载过的视频会进入 `/creations`。
- 图片、视频和网站资产只能通过 owner-scoped opaque ID 与同源代理访问；不得向客户端返回 provider URL、OSS object key、Sandbox 内部路径或签名管理凭证。
- 异步 provider 任务由 API 内持久 Reconciler、PostgreSQL lease 和原 provider task ID 恢复；不自动重提、不引入后台 Worker。
- 保存、下载、过期、Thread 删除和 Creation 保留规则因资产类型不同，修改前必须阅读对应 change，不能抽象成一个错误的统一行为。

## 10. 认证、权限与隐私

- 用户支持一次性匿名、GitHub OAuth 和 Google OAuth；身份以 `(authProvider, providerUserId)` 唯一，同邮箱也绝不自动合并。
- NestJS API 是用户认证真源，客户端不得传入或声明 `userId`。所有 Thread、Run、文件、Skill、任务和 Creation 都必须校验当前用户归属。
- 用户 Session 使用 `aigateway_user_session` HttpOnly Cookie。
- 管理员使用独立的 `aigateway_admin_session` Cookie、Guard 和 `/api/v1/admin/*`；不得与用户 Session 混用。
- 固定管理员账号仍是受限的当前方案。生产启用必须显式配置并记录公网风险；不要擅自扩成用户表/RBAC，也不要描述成成熟的生产身份体系。
- 管理后台数据库功能当前只提供表、schema 和白名单行数据查询，不提供通用编辑或删除 API；不得因历史规格擅自恢复写操作或接受任意 SQL。
- Skill 审核等现有管理员写操作必须维持服务端权限边界和不可变审计；若未来恢复业务表修改/删除，业务变更和 `AdminAuditLog` 必须在同一事务提交。
- 不得记录 API Key、OAuth token、Cookie、Authorization header、Session secret、OSS 签名或 Sandbox 内部秘密。
- 完整用户输入可按当前联调/审计规则进入受控 PostgreSQL 和 Pino，但用户端、Dashboard 聚合和日志列表不得返回；只有授权的管理员详情接口可访问允许字段。

## 11. 数据、计费与可靠性

- PostgreSQL 是用户、会话、事件、任务、文件元数据、Creation、日志、账单和审计的真源；Redis 数据必须可重建。
- 数据库结构变化必须提交正式 Prisma migration，禁止只改 `schema.prisma`、依赖 `db push` 或直接修改线上数据库。
- 付费调用必须在参数校验、认证和限流通过后，先创建可追踪的 pending 日志/任务记录；写库失败时 fail closed。
- 成功、失败或取消后按对应能力终结 RequestLog，并保证 BillingRecord/调用级费用的一致性与幂等性。
- 文本模型按 Token 和版本化价格计费；图片/视频按各自调用、张数、时长或模型定价快照计费，不能套用 Token 口径。
- Redis 不可用时，付费调用、并发检查或依赖锁正确性的操作必须 fail closed。
- Pino 与 Docker 日志必须轮转；OpenTelemetry/管理端观测不能泄露 Prompt、凭证或大体积 Tool result。

## 12. UI 与前端约束

- assistant-ui runtime 是 Agent 消息、Composer 和 Thread 交互的核心，不要另建一套并行聊天状态机。
- 页面必须清楚展示 loading、streaming、waiting-for-user、success、empty、cancelled、expired 和 error 等适用状态。
- Assistant Markdown 必须消毒，禁止原始 HTML、危险链接协议和未验证的外部资源；代码块、SVG、文件和 Tool UI 延续现有安全边界。
- 后台运行状态按 threadId/runId 隔离。切换 Thread 不得取消其他 Thread 的任务，也不得把事件、usage、Tool 状态串线。
- 保持桌面和移动端可用、亮暗主题一致、键盘与屏幕阅读器可访问。
- UI 变更先复用现有组件、token 和交互语言；涉及 assistant-ui runtime、primitives、streaming 或 Tool UI 时，先阅读项目版本对应文档和现有封装。

## 13. 测试与完成标准

按改动风险选择直接相关的测试，至少覆盖受影响层级：

- 单元/contract：Provider 映射、模型事件、Tool schema、状态机、计费、限流、权限和路径安全。
- 集成：PostgreSQL/Redis、日志账单事务、lease/幂等、OSS/OpenSandbox adapter 边界。
- Agent E2E：Thread/Run、reasoning/text/tool/usage、可恢复 SSE、取消、failover、用户问答与并发隔离。
- 页面测试：登录保护、Thread 恢复、各 mode、Tool UI、资产预览/保存/下载、Skill/插件、管理员边界。
- 部署冒烟：Nginx SSE、不暴露数据库/Redis、health、migration、OpenSandbox、私有 OSS 和回滚路径。

完成任务前必须：

1. 运行与改动直接相关的测试。
2. 运行受影响 workspace 的 typecheck、lint 和 build；高影响或跨包修改运行根目录 `pnpm check`。
3. 默认自动化测试使用 Mock、fixture 或替换 adapter，不依赖真实余额和公网服务。
4. 真实模型/OSS/MCP/OpenSandbox 冒烟必须显式执行、限制成本并记录配置边界，不把未执行描述成已通过。
5. 涉及 Prisma 时运行 generate、migration/validate 和相关数据库集成测试。
6. 涉及 OpenSpec 时更新对应 checkbox 并通过 strict validation。

常用命令：

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
pnpm test:agent-e2e
pnpm test:mock-chat
```

不能把“代码已写完但未验证”描述为完成。

## 14. 部署与外部成本边界

- Nginx 是应用唯一公网入口；PostgreSQL、Redis、OSS 管理接口和 OpenSandbox 管理面不得直接暴露公网。
- Agent SSE 路由必须关闭 proxy buffering/cache，并配置合理 read timeout。
- 发布前备份 PostgreSQL；Redis 不作为业务备份对象。
- 生产环境变量只保存在服务器，不提交真实 `.env`、API Key、数据库密码、Cookie secret、OAuth secret、OSS 凭证、证书私钥或生产备份。
- 真实模型、OSS、OAuth、外部 MCP 和生产部署会产生费用或外部状态；未获得用户明确授权时，只做本地/fixture 验证。
- 当前产品没有完整的内容审核、全局成本硬顶、WAF、防刷、正式管理员体系等公网安全能力。不得把厂商审核、单 IP 限流或私有 Bucket 描述为完整保障。

## 15. 产品范围边界

除非用户确认并建立相应 change，不实现：

- 微服务、Kubernetes、BullMQ、独立 Worker 或另一个 SDK 包；
- 用户自助 MCP endpoint/OAuth/stdio、本地进程 MCP 或任意破坏性远程工具；
- 网站数据库、服务端 API、认证、支付、私密环境变量、版本历史、GitHub/Cloudflare 发布或自定义域名；
- 永久文档库、任意脚本执行或不受控格式支持；
- 正式管理员账号体系、RBAC 或外部管理员身份提供商；
- 全站内容审核、设备指纹、验证码、WAF、完整成本防刷与自动数据清理。

若真实公网发布触及这些风险，必须明确提醒用户并提出独立 change，不能在当前任务中静默扩大范围。

## 16. 修改、提交与交付

- 使用 pnpm，不混用 npm/yarn lockfile。
- 保持 TypeScript 类型边界，避免用 `any` 绕过公共契约、Tool schema 或 Adapter 映射。
- API、SDK、Prisma、Swagger、环境变量或部署行为变化时，同步更新测试、`.env.example`、README/部署文档和相关 OpenSpec artifact。
- 不覆盖、删除或回滚用户已有改动；只暂存当前任务范围内文件。
- 一个 OpenSpec task 的功能点和验证全部完成后再勾选并提交；不要提交明知未通过验证的功能。
- commit 信息应对应单一可理解的任务。模块是否 push 以用户当前指示和相关 change 为准。
- 不执行破坏性数据库、Git、OSS、Sandbox 或部署操作，除非用户明确授权且已有可恢复方案。
