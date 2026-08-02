## Context

Super Mind Studio 当前运行在单台 4C8G ECS 上，NestJS API 已使用 Pino、RequestLog、BillingRecord、AgentModelInvocation、PostgreSQL 与 Redis 提供业务日志、计费和聚合 Dashboard。它们能记录调用结果，但不能直接展示一次 Agent Run 内模型流、Tool/MCP、数据库和缓存的父子关系与耗时。

该 change 已确认四项边界：所有 telemetry 自建且不向第三方导出；仅固定管理员 `root` 可查看；Trace 保留 7 天；管理员后台自绘只读调用链，错误仅保留规范化代码和类别。

## Goals / Non-Goals

**Goals:**

- 在不改变现有 API、SDK、账单和审计真源的前提下，建立 Agent 请求的 Trace/Metric 诊断能力。
- 对 API、模型流、Tool/MCP、PostgreSQL、Redis 与出站 HTTP 提供可关联的调用链和低基数指标。
- 仅通过现有 Admin Guard 后的 NestJS API 向 `/admin` 提供安全、只读、字段白名单化的 Trace 数据。
- 对采集、Collector、查询和存储实施双层内容防泄露与观测故障隔离。

**Non-Goals:**

- 不采集浏览器端 telemetry，不开放 Grafana/Tempo/Collector 公网入口，也不嵌入 Grafana iframe。
- 不记录 Prompt、回答、工具或 MCP 参数/输出、HTTP body、用户身份、IP 或凭证；不支持根据内容搜索 Trace。
- 不以 OTel 替代 Pino、PostgreSQL RequestLog/BillingRecord、管理审计或现有 Dashboard。
- 不在本 change 接入 Agent Eval、第三方 SaaS、日志系统、告警平台、全量成功 Trace 长期归档或多节点高可用。

## Decisions

### 1. API → Collector → Tempo，全部仅 backend 网络可达

API 的 OTLP exporter 只指向 Compose 中的 Collector；Collector 只导出至同一 backend 网络的 Tempo。各服务使用 `expose` 而非 `ports`，Nginx 不代理这些服务。Tempo 使用本地持久卷并设置 7 天保留期。

直接从 API 写 Tempo 会使采样、脱敏和未来后端迁移散落于应用；Collector 集中执行这两项策略。使用 SaaS 会引入出境与内容留存风险，已明确排除。

### 2. API 启动前加载 OTel，并同时采用自动和手工埋点

`instrumentation.ts` 必须在 `main.ts` 前通过 Node `--import` 加载。自动 instrumentation 覆盖 HTTP、Redis、PostgreSQL/Prisma 下的驱动与 undici 出站 HTTP。手工 span 只建立在业务边界：`agent.run`、`agent.model.invoke`、`provider.stream`、`agent.tool.invoke`、`agent.mcp.discover`、`agent.mcp.call` 与 `request.lifecycle.finalize`。

每个上游 SSE 流只对应一个 `provider.stream` span；记录 TTFB 和终态，不为每个 delta/token 创建 span 或 event。

### 3. Trace 属性和 Metrics 使用明确白名单

允许属性仅包括内部 request/run ID、capability、provider、受版本控制的模型 ID、Tool/MCP 名称、状态、规范化错误码、TTFB、token 汇总、费用与 failover 标记。Metrics 仅使用 provider/model/status/tool 等有界 label，不能使用 request/user/thread/run ID、原始 URL 或内容。

应用侧 TelemetryService 只接受该白名单；Collector 再使用 attributes/transform processor 删除禁止 key。Pino 通过当前 span context 追加 `traceId`、`spanId`，但维持现有的日志脱敏规则。

### 4. Collector 全量保留 7 天 Trace

Collector 对成功、失败、超时、取消、failover 与慢请求全量保留。开发和测试环境可用 memory/console exporter 全量采集，且不得依赖真实 Collector 或 Tempo。

全量采集提高诊断完整性，但会增加单机 CPU、内存和 Tempo 磁盘占用；Trace 固定仅保留 7 天。Collector 仍使用有界批量队列并设置丢弃优先于阻塞业务请求，确保 telemetry 不反压业务主链路。

### 5. 管理后台经 API 查询适配层展示，而非直连或 iframe

新增 `ObservabilityAdminModule`，受现有 Admin Guard 保护。它仅支持按现有 RequestLog 的 `requestId` 查询关联 Trace、读取一个 Trace 的白名单 span 树以及有限时间窗口的摘要；不得接受 Tempo 查询语言、任意 URL、任意 tag 或自由文本。前端在请求日志详情抽屉中呈现调用链树，不能直接请求 Tempo/Grafana。

将 Tempo API 隔离在 Adapter 后，使后续替换为兼容后端不改变管理员 API；同时避免把 Grafana Cookie、查询 URL 或内部服务地址暴露给浏览器。

### 6. Observability 故障必须 fail-open

OTel 默认初始化，并在未显式配置端点时使用内部 Collector 默认地址；Exporter 批量失败、Collector/Tempo 不可用或查询后端失败时，只写已脱敏 Pino 告警与内部 SDK 指标，绝不能阻塞 Agent、模型、Tool、账单或 RequestLifecycle 事务。管理员 UI 必须显示“调用链暂不可用”，不得伪造无 Trace 的成功结果。

## Risks / Trade-offs

- [4C8G 单机资源竞争] → 全量 Trace 仅保留 7 天，Collector/Tempo 使用明确 CPU/内存/磁盘限额；先以 Mock 负载测量，再决定是否启用 Grafana 容器。
- [自动埋点意外携带敏感 HTTP/数据库数据] → 默认禁用 body 与 SQL 参数捕获；应用白名单和 Collector 删除规则共同约束，并以回归测试检查导出 payload。
- [Collector tail sampling 缓冲耗尽] → 设置内存上限、批量队列上限和优先丢弃策略；业务 telemetry 调用不得同步等待导出。
- [Trace 与 RequestLog 关联不完整] → 在 Agent/模型调用 span 写入 `supermind.request_id`，并让 Pino 写 traceId/spanId；管理端仅由 requestId 发起固定查询。
- [Tempo 查询 API 或版本变化] → 封装为 API 内的 TraceStore adapter，并以 fixture 测试其输入输出映射。

## Migration Plan

1. 增加依赖、环境校验与内部 Collector 默认端点；开发环境使用 in-memory exporter 验证启动顺序和无 Collector 降级。
2. 加入自动/手工埋点、Pino correlation 与敏感字段测试，先在 Mock 模型、取消、失败、failover、MCP fixture 流量中验收。
3. 新增 Collector、Tempo、持久卷和仅 backend network 的 Compose profile；初始以 100% 开发采样验证脱敏与资源占用。
4. 生产启用 Collector 全量采集、7 天保留与资源限制；Collector/Tempo 不暴露端口。
5. 增加受 Admin Guard 保护的查询 API 与前端 Trace 抽屉；完成未认证、查询注入、内容泄露和后端不可用测试。

回滚通过停止 observability profile 或使 Collector/Tempo 下线完成；API/Pino/PostgreSQL 按原路径继续工作，Exporter 故障不会阻塞业务。Tempo volume 可在保留期外删除，不涉及业务数据库迁移或恢复。

## Open Questions

- 慢请求阈值的初始值将在 Mock 与真实模型低额度 smoke 的 p95 数据后确定；实现前默认以模型 TTFB 3 秒、Agent Run 10 秒作为可配置基线。
- Grafana 是否在首期随 Tempo 启用：管理员自绘 Trace 抽屉不依赖它，默认可后置以节省资源。
