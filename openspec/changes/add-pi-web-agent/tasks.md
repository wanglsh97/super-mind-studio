## 1. Mock Agent 首个纵向闭环

- [x] 1.1 为 `@supermind/sdk` 定义 Agent thread/run/message part/event/error 公共契约与序列化测试，保持 Pi 和 provider 类型不进入 SDK 公共面
- [x] 1.2 新增 AgentThread、AgentMessage、AgentRun、AgentEvent、AgentToolCall Prisma 模型、索引、关联约束和正式 migration，并验证生成客户端与迁移回滚说明
- [x] 1.3 建立 NestJS AgentModule、线程/运行 repository 端口和用户 owner 过滤，添加跨用户读取/修改拒绝测试
- [x] 1.4 定义 provider-neutral `ModelInvocationPort` 的 text/reasoning/tool-call/tool-result/usage 事件，并以不改变现有 Chat 行为的方式从 Chat 编排中提取复用边界
- [x] 1.5 扩展 Mock Chat Adapter 以确定性模拟一次 `web_fetch` tool call、tool result 后续 turn、reasoning、usage、错误和取消，并添加统一 contract tests
- [x] 1.6 精确锁定 `@earendil-works/pi-agent-core` 依赖，建立 Pi `StreamFn` bridge，将平台模型事件双向映射为 Pi context/assistant events，并覆盖文本、reasoning 和 tool-call 映射测试
- [x] 1.7 实现服务端内存 Tool registry 和测试用确定性 `web_fetch` fixture tool，使 Pi harness 完成 tool-call → tool-result → follow-up 模型 turn
- [x] 1.8 实现 Agent run 状态机、递增事件 sequence、消息 parts 持久化和最终快照，覆盖 succeeded/failed/cancelled/limit_reached/interrupted 转换测试
- [x] 1.9 实现 thread CRUD、run create、cursor event SSE 和 cancel API，并同步 Swagger、统一错误 envelope 与认证 guard 测试
- [x] 1.10 在 SDK 实现 thread CRUD、run create、按 sequence 订阅/重连和 cancel client，覆盖事件顺序、断线补读、AbortSignal 和协议错误测试
- [x] 1.11 新增最小 `/agent` 页面，使用 assistant-ui 展示持久消息、增量文本、折叠 reasoning、tool 状态、loading/error/cancelled 和停止操作
- [x] 1.12 添加无公网依赖的 Agent E2E，串通 Web → SDK → Agent API → Pi harness → Mock tool-calling Adapter → fixture tool → follow-up turn → SSE cursor → PostgreSQL RequestLog/BillingRecord
- [x] 1.13 执行 Agent 首个闭环相关单测、集成测试、页面 E2E、typecheck、lint 和 build，并记录 Mock 验收结果

## 2. 持久会话与单用户运行约束

- [x] 2.1 实现 Agent thread 列表、详情、新建、有限长度默认标题和更新时间排序，添加空状态及分页/边界测试
- [x] 2.2 实现 thread 重命名与永久删除事务，删除前端二次确认，并验证级联删除 Agent 子记录但保留 RequestLog/BillingRecord
- [x] 2.3 将模型目录增加显式 `agent` capability，只允许启用、配置且通过 tool-calling contract 的模型创建 Agent thread
- [x] 2.4 实现 `/agent` 模型选择和“切换模型即新建 thread”，验证已存在 thread 的 modelId 不可修改且旧会话保持不变
- [x] 2.5 实现 PostgreSQL 真源加 Redis 原子锁的单用户全局 active run 约束，覆盖跨 thread 并发、跨用户独立和 Redis 异常 fail-closed 测试
- [x] 2.6 运行期间禁用该用户所有 Agent Composer 的提交操作但允许浏览历史，并在服务端拒绝篡改客户端发起的并发 prompt
- [x] 2.7 实现 API 启动时遗留 running/cancelling run 转 interrupted、过期锁清理和 UI 中断状态，确认不自动重放模型或工具
- [x] 2.8 验证刷新、关闭事件连接、重新进入会话和 sequence cursor 补读均不取消进程内 run，且不会重复消息或工具卡片
- [x] 2.9 执行会话模块单测、PostgreSQL/Redis 集成测试、认证边界 E2E、typecheck、lint 和 build
- [x] 2.10 为 Agent SSE 增加空闲心跳、同源 Next.js 长代理超时和 SDK 未完整 EOF 按 sequence 有界重连，验证长工具调用不再使 UI 永久停留在 running

## 3. 生产级 web_fetch 工具

- [x] 3.1 定义 `web_fetch` JSON Schema、标准成功/错误结果、AbortSignal 和审计字段，并用 Tool registry 测试拒绝未知工具及无效参数
- [x] 3.2 实现 HTTP/HTTPS URL 规范化，拒绝内嵌凭证、非 HTTP 协议、localhost 和畸形 URL，添加 IPv4/IPv6 边界测试
- [x] 3.3 实现 DNS 全地址分类和连接固定，拒绝 private、loopback、link-local、multicast、reserved、unspecified、云元数据及无法证明公网的目标，并覆盖 DNS rebinding 防护测试
- [x] 3.4 实现最多五跳的手动重定向和逐跳 URL/DNS 校验，验证公网到内网重定向、循环和超限均在连接前阻断
- [x] 3.5 实现无 Cookie/Authorization 的受限 HTTP client、连接/总超时、2 MiB 流式读取上限和取消传播，覆盖慢响应、超大响应和断连测试
- [x] 3.6 实现 Content-Type 白名单，接受 HTML、JSON 和受支持文本，拒绝 PDF、图片、视频、压缩包与未知二进制
- [x] 3.7 实现不执行 JavaScript/不加载子资源的 HTML 正文与标题提取、JSON/文本规范化、30,000 字符截断和内容哈希，使用本地 fixture 覆盖复杂页面及乱码
- [x] 3.8 在 Agent system prompt 和 tool result envelope 中标记网页内容为不可信数据，添加 Prompt Injection fixture 以验证工具白名单和网络限制无法被内容绕过
- [ ] 3.9 持久化限长工具结果与 requested/final URL、状态、类型、字节、耗时、截断和错误审计，验证 Pino/数据库均不记录敏感响应头或凭证
- [ ] 3.10 完善 `/agent` tool card，实时展示目标 URL、running/succeeded/failed/cancelled、HTTP 状态和简短摘要，并验证消毒和窄屏布局
- [x] 3.10a 将 reasoning、中间进度文本与 tool call 聚合为单一思考模块，验证运行中默认展开、终态自动收起及手动重开
- [x] 3.10b 用“思考记录 + 独立执行卡”取代合并式思考模块，保证 message-end 先于工具执行，工具运行时不再显示“正在思考”，并重做通用 Tool UI 的状态、折叠详情和窄屏布局
- [x] 3.10c 将 Sandbox 单命令默认上限调整为 180 秒，验证 fresh website bootstrap 不再因刚超过 60 秒被误判失败，且仍受 Agent Run 总时长约束
- [ ] 3.11 执行 `web_fetch` SSRF 安全测试、内容抽取单测、工具集成测试、Agent E2E、typecheck、lint 和 build，全套测试不得依赖公网

## 4. 运行预算、计费与真实模型

- [ ] 4.1 增加 Agent 配置校验与安全上限，默认限制每 run 六次模型调用、八次工具调用、五次 `web_fetch` 和 120 秒
- [ ] 4.2 在 Pi loop 边界强制模型/工具/时间预算，达到限制时停止新工作、取消当前操作 best effort，并持久化可解释的 limit_reached 事件
- [ ] 4.3 将每次 Agent 内部模型调用关联到独立 RequestLog/BillingRecord 和 agentRunId，验证失败、取消及 tool loop 多 turn 的一对一账单不变量
- [ ] 4.4 在 AgentRun 事务聚合模型调用数、Token、人民币费用和工具调用数，并在 SDK/UI 展示最终累计值
- [x] 4.5 为首个候选真实 Agent 模型增加 tool calling/reasoning Adapter 映射与 contract fixture，不支持 reasoning 时不得伪造 reasoning part
- [x] 4.5a 抽取 OpenAI-compatible 通用 tool-call 编解码层并接入 Qwen、GLM、DeepSeek、Kimi，覆盖工具定义、分片参数、多工具、非法 JSON、finish 一致性、tool result follow-up 和取消 contract
- [ ] 4.6 使用最低成本真实 smoke 验证候选模型的工具参数流、一次 `web_fetch` follow-up、usage、取消和错误；记录 alias/model ID 后才启用 `agent` capability
- [ ] 4.7 验证首 delta 前 failover 不拼接不同 provider 的 text/reasoning/tool-call，首事件后失败以规范化 Agent 错误终结
- [ ] 4.8 执行预算、日志计费、真实 Adapter contract、Agent 流式 E2E、typecheck、lint 和 build

## 5. Skill/MCP/Memory 扩展边界与交付

- [x] 5.1 定义 `AgentSkillRegistry` 端口和返回空集合的 V1 实现，验证 Agent 启动不会扫描本地 skill 目录或注入未注册内容
- [x] 5.2 定义 `AgentMcpRegistry` 端口和返回空集合的 V1 实现，验证 Agent 启动不会连接 MCP、读取凭证或动态发现工具
- [x] 5.2a 定义 `AgentMemoryProvider` 端口和返回空集合的 V1 实现，验证 Agent 启动不会扫描、提取或持久化长期 Memory
- [ ] 5.3 更新 PRD、技术方案、README、`.env.example`、Swagger 和部署说明，明确 `/agent`、Pi 服务端边界、运行预算、数据保留、API 重启中断及 MCP/skills 后续范围
- [ ] 5.4 为 Nginx Agent event SSE 配置关闭 buffering/cache、合理 read timeout 和同源路由，并验证域名/IP 下 cursor 重连
- [ ] 5.5 增加部署 draining 流程：停止接收新 Agent run、最多等待 120 秒并明确中断剩余 run，不引入 Worker 或队列
- [ ] 5.6 运行 Agent 全量单元、contract、PostgreSQL/Redis 集成、流式 E2E、页面 E2E、隐私边界、typecheck、lint、build 和 Docker/Nginx 冒烟
- [ ] 5.7 备份 PostgreSQL 后执行 migration 与回滚演练，以 feature flag 隐藏 `/agent` 验证现有 Chat/Image/Prompt 不依赖 Agent 模块
- [ ] 5.8 对 `add-pi-web-agent` 执行 OpenSpec strict 校验并确认所有 checkbox 只在对应实现与验证完成后勾选

## 6. 分层 System Prompt 与上下文压缩

- [x] 6.1 为模型目录增加经验证的 `contextWindowTokens`，实现包含工具 schema、输出和安全预留的 `AgentTokenEstimator/ContextBudget`，覆盖精确/保守估算及 60/75/88% 阈值测试
- [x] 6.2 实现版本化 `AgentPromptComposer`，按固定信任层级动态组装核心策略、运行时、真实 Tool、Skill/MCP/Memory 空端口与 manifest，并移除 `AgentRunService` 的硬编码 prompt
- [x] 6.3 为 Tool contract 增加风险/审批元数据并拒绝尚不支持的显式审批工具；为 SDK 消息新增 `media-reference` part 和安全 placeholder 转换
- [x] 6.4 在每次模型调用前装配 PostgreSQL 历史、当前 Pi context 和最近 4/最少 2 turns；回灌带低信任边界的历史 reasoning，并覆盖跨 run 多轮、工具 follow-up 和未完成工具保留测试
- [x] 6.5 实现 none/light/moderate 确定性压缩，覆盖 reasoning、工具进度/结果、失败尝试、多媒体 placeholder、顺序不变和当前用户输入不丢失
- [x] 6.6 新增唯一 `AgentContextSummary` migration/repository 与 V1 JSON Schema，使用当前模型执行禁用工具的强制摘要、失败重试一次、事务覆盖和 `context_window` 终止
- [x] 6.7 扩展 SDK/API 的 `context-budget`、`context-compressed` 与最新摘要契约，在 `/agent` Composer 展示占用率、时间线展示压缩事件、详情展示结构化摘要
- [ ] 6.8 添加 Prompt golden/manifest、历史恢复、三层压缩、摘要污染/Schema 失败、两次失败终止、事件重连和 UI 测试，并运行相关单测、PostgreSQL 集成、typecheck、lint、build 与 strict OpenSpec 校验
- [x] 6.9 将平台维护的主 Agent、强制摘要及内置工具模型可见 Prompt 统一为英文，保留动态内容原始语言，并更新版本、golden test 与规格
