# Super Mind Studio V1 实施任务

任务按三个产品建设板块归类。三个板块不是强制串行阶段：为满足“优先串通流程”，第一实施波次应先完成板块一的 `1.1–1.20`，随后立即完成板块三的 `3.1–3.6`，形成 Web → SDK → API → Mock Adapter → SSE → PostgreSQL 闭环；再继续完善真实模型、管理员中后台和其他用户能力。

## 1. API 网关服务建设（包含数据库与部署基础）

### 工程、契约与数据库基础

- [x] 1.1 固定 Node.js、pnpm 和 TypeScript 版本，创建根 workspace、统一脚本和 lockfile
- [x] 1.2 初始化 `apps/api` NestJS Express 应用，配置 `/api/v1` 前缀、DTO 校验、request ID 和统一 JSON 错误 envelope
- [x] 1.3 初始化唯一内部包 `packages/sdk`，定义 provider-neutral 的请求、响应、错误、usage、模型和任务状态契约
- [x] 1.4 创建 API 配置模块和 `.env.example`，校验数据库、Redis、Mock 开关、模型别名和可选 provider key，且不打印密钥
- [x] 1.5 创建本地 PostgreSQL/Redis Docker Compose，生产环境的数据服务端口不得暴露公网
- [x] 1.6 建立 Prisma schema：`RequestLog`、`BillingRecord`、`ImageGenerationTask`、`AdminAuditLog`
- [x] 1.7 为四张表补齐主外键、唯一约束、状态字段、JSON 字段及后台筛选索引
- [x] 1.8 生成并验证 Prisma 初始迁移，提供空库迁移和测试数据清理命令
- [x] 1.9 实现 Prisma/Redis 基础模块和连接生命周期，限制 PostgreSQL 连接池规模
- [x] 1.10 实现 Pino 基础日志、request ID 贯穿和 API Key/Cookie/Authorization 过滤
- [x] 1.11 实现 `/health/live` 和 `/health/ready`，readiness 必须检查 PostgreSQL 与 Redis
- [x] 1.12 建立 workspace format、lint、typecheck、unit、build 命令并在干净环境执行通过

### Mock Chat 最小主链路

- [x] 1.13 定义统一 `ChatAdapter` 接口、Adapter registry、稳定模型别名和标准 SSE 事件
- [x] 1.14 实现确定性 Mock Chat Adapter，支持延迟 delta、usage、首包前失败、流中失败和取消
- [x] 1.15 实现 `RequestLifecycleService.start`，在 provider 调用前创建含完整 messages 的 `RequestLog(pending)`，写库失败时禁止调用模型
- [x] 1.16 实现 `POST /api/v1/chat/completions`，强制 `stream: true` 并依次输出 delta、usage 和唯一 `[DONE]`
- [x] 1.17 实现成功、失败、取消统一终结逻辑，在事务中更新 RequestLog 并 upsert 一对一 BillingRecord
- [x] 1.18 在 `@supermind/sdk` 实现 Fetch POST SSE parser、typed event/error、request ID、usage、`[DONE]` 校验和 AbortSignal
- [x] 1.19 添加无外部网络的 API/SDK Chat E2E，覆盖 delta、usage、`[DONE]`、取消、完整 Prompt 和费用落库
- [x] 1.20 建立 Mock Chat 回归基线，确保无任何真实 API Key 时也能稳定执行

### 网关治理与国内文本模型

- [x] 1.21 实现 Redis 原子 IP 限流和可信代理 IP 解析，Chat 默认 10 次/60 秒，Redis 不可用时 fail closed
- [x] 1.22 完善 Chat DTO 边界，限制 messages、参数范围和 `max_tokens <= 4096`，拒绝请求不得调用 Adapter
- [x] 1.23 实现共享 `OpenAICompatibleChatTransport`，统一 HTTP 超时、SSE、AbortSignal 和可注入测试 client
- [x] 1.24 建立 Adapter contract suite，统一验证请求、chunk、usage、错误和取消映射
- [x] 1.25 实现 Qwen Adapter，用去敏 fixture 和低额度真实请求分别验收
- [x] 1.26 实现 GLM Adapter，用去敏 fixture 和低额度真实请求分别验收
- [x] 1.27 实现 DeepSeek Adapter，用去敏 fixture 和低额度真实请求分别验收
- [x] 1.28 实现 `/api/v1/models`，仅返回启用 alias、实际模型 ID、能力、展示名、配置状态和健康摘要
- [x] 1.29 实现 provider 被动健康状态和 Redis TTL 投影，不用健康状态强行切换已开始的流
- [x] 1.30 实现单模型首 delta 前最多一次 failover，对比模式及首 delta 后禁止切换
- [x] 1.31 添加 failover 测试，覆盖超时/5xx 切换、不可重试错误、首 delta 后失败和取消
- [x] 1.32 实现版本化单价配置、usageUnknown 和输入/输出 token 人民币费用换算测试
- [x] 1.33 逐个启用 Qwen、GLM、DeepSeek；每启用一个都运行 Mock 基线、contract suite 和真实冒烟

### 文生图网关能力

- [x] 1.34 定义 Image API/SDK 契约、`ImageAdapter` 接口和 `pending/running/succeeded/failed` 状态机
- [x] 1.35 实现 Mock Image Adapter，支持可控状态、成功结果、失败、超时和下载 fixture
- [x] 1.36 实现 `POST /api/v1/images/generations`，执行 5 次/60 秒 IP 限流并在上游提交前创建持久化任务
- [x] 1.37 实现幂等状态查询，根据已存 provider task ID 合法推进 ImageGenerationTask 状态
- [x] 1.38 实现图片下载代理，校验平台 task、image index、允许的 URL/类型/大小并设置安全响应头
- [x] 1.39 在 SDK 实现 image create/get/wait/downloadUrl，轮询支持退避、超时、终态停止和取消
- [x] 1.42 添加 Image 集成测试，覆盖提交、API 重启后轮询、成功下载、失败和客户端超时

### Prompt 优化网关能力

- [x] 1.43 定义 expand/simplify/structure mode、普通 JSON API/SDK 契约和版本化模板 registry
- [x] 1.44 实现 `POST /api/v1/prompts/optimize`，拒绝客户端自定义 system Prompt，并复用模型 registry、限流、日志、usage 和计费
- [x] 1.45 使用 `PROMPT_OPTIMIZER_MODEL` 解析默认 alias，alias 禁用时返回明确错误而不静默换模型
- [x] 1.46 在 SDK 实现 `prompts.optimize` typed 方法和统一 error/usage/cost 解析
- [x] 1.47 添加三模式、模板版本、输入边界、禁用模型和完整日志字段测试

### 可观测、质量门禁和 ECS 部署

- [x] 1.48 补齐 Pino 结构化字段，关联 capability、model/provider、duration、usage/cost、failover、error 和完整 Prompt
- [x] 1.49 配置 provider 超时和连接限制，为平台 TTFB、provider latency、成功率和错误率提供数据字段
- [x] 1.50 提供长时间 pending 记录的筛选能力，帮助发现无 BullMQ 情况下的终结写入异常
- [x] 1.51 建立 CI：format/lint、typecheck、unit、PostgreSQL/Redis + Mock E2E、build 和 Prisma migration validate
- [x] 1.52 确保 CI 不使用真实 provider key、不访问外部模型并通过所有核心路径测试
- [x] 1.53 为 Web/API 创建多阶段生产 Dockerfile，以非 root 用户运行并配置健康检查
- [x] 1.54 创建生产 Docker Compose，编排 Nginx、Web、API、PostgreSQL、Redis、持久卷、健康依赖和 4C8G 资源上限
- [x] 1.55 配置 Nginx 的 Web、Admin、API、Swagger 和 health 路由，同时支持指定域名与公网 IP
- [x] 1.56 为 Chat SSE 关闭 proxy buffering/cache、配置读取超时和断连传播，并用延迟 Mock chunk 验证
- [x] 1.57 配置 Docker 日志大小/数量轮转，防止完整 Prompt 日志持续占满系统盘
- [x] 1.58 编写 PostgreSQL 备份、恢复和发布前备份流程，明确 Redis 无需备份
- [x] 1.59 编写 ECS 初始化、环境注入、启动、迁移、health、日志、发布和回滚 runbook
- [ ] 1.60 在 ECS 先以 Mock-only 配置通过公网 IP 和域名回归，再逐个注入真实 provider key
- [ ] 1.61 完成网关板块验收，记录镜像版本、迁移版本、实际模型 ID/地域/定价和禁用回退方法
- [x] 1.62 新增可配置 Chat 模型目录，将公开模型实例 ID、社区名称、厂商 Adapter 与上游模型 ID 解耦，并兼容现有单模型环境变量
- [x] 1.63 将 Chat 模型目录迁入代码仓库并移除运行时环境覆盖，模型变更必须经过代码评审与发布
- [x] 1.64 兼容 Agent Sandbox 的 workspace 相对路径，统一规范化 read/write/shell/output 路径并保持目录越界防护
- [x] 1.65 修复 OpenSandbox 显式产物 realpath 校验的流式 stdout 收集，确保 export_file 可持久化并在聊天中展示文件卡片
- [x] 1.66 将 shell、read_file、write_file、export_file 重组为通用 Sandbox tools，与 Skill activation tool 保持平级注册和独立模块边界
- [x] 1.67 按工具复杂度整理 Agent tools 目录：单文件工具平铺，多文件 web-fetch/web-search 工具归入同名目录
- [x] 1.68 移除公开 Chat completions Controller、DTO、SSE、SDK `chat.*` 契约及专属测试，将保留的模型基础设施收敛为 Agent 使用的 `ModelGatewayModule`
- [x] 1.69 为 Qwen3.7-Plus、GLM-5.2、DeepSeek-V4-Pro、Kimi K3 显式配置 thinking，并将 `reasoning_content` 规范化为 Agent reasoning 事件，覆盖工具调用历史回灌
- [x] 1.70 为 Agent run 增加 `thinkingEffort=fast|balanced|deep` 契约并贯通工具循环、上下文摘要和四个 Provider Adapter，覆盖校验与协议映射测试
- [x] 1.71 在 Agent Thread 详情中返回全部持久化消息的 token 估算与绑定模型最大上下文，并覆盖服务端契约测试
- [x] 1.72 扩展统一 usage 契约以采集 cached input 与 reasoning Token，并为四个 Provider、Mock 和 Pi bridge 补齐映射测试
- [x] 1.73 新增 AgentModelInvocation 调用级账本与 Skill/Tool 归因迁移，在 Agent 每次模型调用终结时幂等持久化实际 resolved model 和 usage
- [x] 1.74 实现仅当前用户可访问的一年 Token 日历、每日明细和模型总量聚合 API，并覆盖权限、缺失维度按 0 展示和无历史回填测试

## 2. 管理员中后台

### 登录与访问控制

- [x] 2.1 实现固定 `root/123456` credential verifier、签名短期 HttpOnly/SameSite Cookie、session 查询和退出接口
- [x] 2.2 实现管理员登录 5 次/分钟独立限流和统一失败文案
- [x] 2.3 实现 Admin guard，保护全部 `/api/v1/admin/*` 非登录接口
- [x] 2.4 初始化 `/admin/login` 和受保护的中后台布局，实现会话恢复、退出和 401 跳转
- [x] 2.5 添加未登录、过期、伪造 Cookie 和超限登录测试，确保任何管理数据均不泄露

### Dashboard 与请求日志

- [x] 2.6 实现 dashboard overview/trends/latencies/errors 聚合接口，返回请求量、成功率、费用、健康和最近错误但不返回 Prompt
- [x] 2.7 实现 Dashboard 指标卡和 ECharts 图表，处理空数据、加载和局部请求失败
- [x] 2.8 实现请求日志分页及时间、能力、模型、状态、request ID 筛选 API
- [x] 2.9 实现请求日志列表、筛选器和分页交互
- [x] 2.10 实现认证日志详情 API 和详情抽屉，展示完整 Prompt、provider metadata、failover、usage/cost 和完整错误

### 数据库表管理与审计

- [x] 2.11 实现服务端表/字段/操作 allowlist，明确四张业务表的查询、编辑和删除能力
- [x] 2.12 实现白名单 rows 查询、字段级 PATCH 和允许记录 DELETE，拒绝任意表名、SQL 和不可编辑字段
- [x] 2.13 实现数据库表展示页面、字段编辑表单和删除二次确认
- [x] 2.14 在同一 Prisma 事务中提交业务变更与不可变 AdminAuditLog，失败时整体回滚
- [x] 2.15 实现 RequestLog 删除时 BillingRecord 关系处理及事务/重复请求测试
- [x] 2.16 实现只读审计日志查询与展示，不提供 AuditLog PATCH/DELETE 路由
- [x] 2.17 完成中后台安全验收：未认证探测、Prompt 访问边界、allowlist 绕过、修改/删除与审计原子性
- [x] 2.18 对固定开发凭证增加生产告警，并在公网正式开放前将管理员认证升级设为发布硬门槛
- [x] 2.19 修复 Agent 请求日志详情仅展示 Provider 输入快照的问题，补充关联 AgentRun 的完整持久化消息并区分两种口径
- [x] 2.20 在 Dashboard 增加今日 Token 概览、按实际模型的输入/输出/缓存/思考明细、三个月全站日历热力图及 Skill/Tool 聚合，以万/亿为单位紧凑展示大值，并验证响应不泄露用户内容

## 3. 用户端网页（Chat、文生图、Prompt 优化）

### 公共页面基础与最小 Chat 闭环

- [x] 3.1 初始化 `apps/web` Next.js 用户端，完成首页、桌面导航、PC-only 布局和亮/暗主题
- [x] 3.2 实现 `/chat` 最小单模型页面：输入、发送、增量内容、loading 和 error
- [x] 3.3 Web Chat 仅通过 workspace `@supermind/sdk` 调用，不在组件中复制 SSE/parser 或引用 provider 类型
- [x] 3.4 实现停止生成和清空对话，取消后 UI 立即停止追加并与数据库 cancelled 状态一致
- [x] 3.5 展示最终 usage、人民币估算、模型 alias 和 request ID
- [x] 3.6 完成第一波端到端验收：浏览器 → SDK → API → Mock Adapter → SSE → RequestLog/BillingRecord

### Chat 完整能力与多模型对比

- [x] 3.7 完成多轮消息状态、模型选择、参数设置和新会话交互
- [x] 3.8 使用经过消毒的 Markdown 渲染 assistant 内容，禁止原始 HTML 和危险链接协议
- [x] 3.9 在 SDK 实现 2–3 模型 compare helper，为每个模型创建独立请求和 AbortController
- [x] 3.10 实现多模型对比布局，每列独立显示 delta、loading、usage/cost、error 和停止操作
- [x] 3.11 添加对比 E2E，覆盖三路不同速度、单路失败、单路取消、全部取消和禁止 failover
- [x] 3.12 验证最低 1366px 桌面布局、亮色和暗色主题下的 Chat 可用性与流式状态
- [x] 3.23 使用 assistant-ui LocalRuntime 和 primitives 重构单模型 Agent 会话，保留 SDK SSE、取消、usage 与安全 Markdown 边界
- [x] 3.24 将右侧 Chat 模块调整为完整消息画布，把模型、对比和参数控制收进底部 Composer，并展示 AI 内容提醒
- [x] 3.25 移除 Composer 输入框自身的粗焦点描边，仅由 Composer 卡片提供统一的细焦点状态
- [x] 3.26 重排 Composer 底部操作栏，将对比与参数左置、模型与圆形发送按钮右置，并移除快捷键提示
- [x] 3.27 放大发送箭头并将原生模型 select 替换为可统一美化的无障碍下拉菜单
- [x] 3.28 模型发现接口返回实际模型 ID，并在 Composer 模型菜单中展示厂商 Logo 与具体模型名称
- [x] 3.29 Chat 与模型对比页面改为消费动态模型实例 ID，并直接展示模型目录配置的社区名称

### 文生图页面

- [x] 3.13 实现 `/image` 表单，支持中英文 Prompt、启用模型和受支持尺寸/参数选择
- [x] 3.14 通过 SDK 串通创建任务和轮询，展示 pending/running/succeeded/failed 与超时/取消状态
- [x] 3.15 实现图片结果预览和网关代理下载，不直接拼接不可信 provider URL
- [x] 3.16 实现 localStorage 最近 5 条任务、缩略图和 Prompt 历史，容忍损坏、过期和缺失结果
- [x] 3.17 完成 Image 页面 Mock E2E

### Prompt 优化页面

- [x] 3.18 实现 `/prompt` 页面原始 Prompt 输入、expand/simplify/structure 三模式和三个快捷示例
- [x] 3.19 通过 SDK 调用优化接口，展示消毒后的结果、模型、usage、费用和 request ID
- [x] 3.20 实现结果复制、提交防重、loading、错误和重试交互
- [x] 3.21 添加三模式页面测试，确认客户端不能注入任意 system Prompt

### 用户端整体验收

- [x] 3.22 添加用户端完整回归：Chat 单模型/对比、Image、Prompt、取消、错误和对应数据库记录
- [x] 3.23 验证公网 IP 与域名使用同源 `/api` 配置，无需构建两套前端
- [x] 3.24 验证用户端和 Dashboard 聚合响应不返回完整 Prompt，公开页面不能读取任何管理接口数据
- [x] 3.25 完成用户端 PC 桌面验收，确认三项能力均能在 Mock 模式独立演示，真实模型可按 alias 单独启停
- [x] 3.30 将用户端共享外壳、首页、登录、Chat、文生图、Prompt、Skill 与 API 页面统一为极简 Apple HIG 分层视觉系统：白纸背景、Labels/Fills/Separators/Bg token、无投影，并完成 PC 桌面截图验收
- [x] 3.31 提供移动端导航抽屉与窄屏重排入口，确保用户端在手机与桌面宽度均可用
- [x] 3.32 将产品品牌统一为 Super Mind Studio，将 workspace SDK scope 迁移为 `@supermind/sdk`，并保留 AI Gateway 作为底层技术模块
- [x] 3.33 为 assistant-ui 消息 Markdown 增加 fenced SVG 安全预览，流式未闭合时保留源码并阻止脚本、外部资源和原始 HTML
- [x] 3.34 修复 LocalRuntime 流式生成与会话历史同步竞态，运行期间禁止重置消息仓库并在结束后重新水合
- [x] 3.35 将 MCP 状态从 Composer 迁入右上角运行环境浮层，统一展示 Sandbox、MCP、Skills 与上下文占用
- [x] 3.36 移除运行环境的重复入口浮层，将详情面板改为可直接折叠和恢复的单层组件
- [x] 3.37 移除 `/chat/compare`、Agent 中的对比入口及相关 C 端状态代码，只保留 `/chat` 到根 Agent 的旧链接兼容跳转
- [x] 3.38 在运行模型浮层加入统一的快速/均衡/深度思考强度选择，并将选择传入当前 Agent run
- [x] 3.43 为 assistant-ui Agent 消息增加自定义 fenced 代码块渲染，提供语言标识、Prism 高亮与复制反馈，并保持 SVG 安全预览和 Markdown 安全边界
- [x] 3.39 简化 Composer 模型选择器，底部按钮移除 Logo、列表保留 Logo，并将思考强度拆为相邻的独立轻量选择器
- [ ] 3.40 将 Agent 运行停止按钮改为与发送按钮等尺寸的圆形纯图标控件，使用方形停止符号并保留可访问名称
- [ ] 3.41 为思考强度档位增加推理特点说明，并以名称、弱化说明和固定行末选中标记的两行信息样式展示
- [x] 3.42 将运行环境 Context 模块改为当前 Thread token 总数与绑定模型最大上下文的占比，不再消费单次调用的 context-budget
- [x] 3.44 新增用户 Token 分析页，将汇总指标合并至 Token 用量顶部模块，展示最近一年 GitHub 风格固定阈值总量热力图、阈值图例及日期精确值悬浮提示、按日期倒序分页的每日 input/output/cache/reasoning 明细表和实际模型总量饼图，并以万/亿为单位紧凑展示大值
- [x] 3.45 接入受审核的 MCP 插件：端点定义收敛至代码、凭证仅从服务端环境变量读取、默认关闭；配置未声明工具白名单时，用户启用后向 Agent 放开该 MCP 安全发现到的全部工具，并在 `/plugin` 展示脱敏状态
- [x] 3.46 将用户端 MCP 设置统一命名为“插件”，将插件与技能中心放在左侧栏的对话列表之前，并为对话列表设置可滚动的最大高度
- [x] 3.47 将插件页面路由切换为 `/plugin`，并按开发工具、商业运营、旅行出行和其他分类提供可切换的插件目录
- [x] 3.48 接入高德地图 Streamable HTTP MCP，使用服务端 Query Key 凭证并归类至旅行出行插件
- [ ] 3.49 接入飞常准航旅 MCP（暂时注释，待提供不降级的 HTTPS MCP 端点）
- [x] 3.50 MCP 客户端拒绝重定向，防止携带凭证降级或跨端点传输
- [ ] 3.51 将 MCP 改为服务级提示词、按需工具发现和 Run-scoped 统一调用协议，保留真实工具审计与 schema 校验
