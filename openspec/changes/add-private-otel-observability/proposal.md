## Why

当前平台能够通过 Pino、PostgreSQL 请求日志与 Dashboard 查看单次调用结果，但一次 Agent Run 内的模型流、Tool/MCP、Redis 与 PostgreSQL 调用仍需人工拼接排查。随着真实模型与 MCP 增加，需要一条不向第三方导出内容数据、且能由管理员安全查看的端到端诊断链路。

## What Changes

- 在 API 接入可禁用的 OpenTelemetry Trace 与 Metrics 采集，覆盖 HTTP、PostgreSQL、Redis、出站 HTTP 及 Agent 的模型/工具/MCP 关键边界。
- 部署仅在 Docker backend 网络可访问的 OTel Collector 与 Tempo；Trace 仅保留 7 天，不开放公网端口，不配置第三方 exporter。
- 以低基数、非内容属性关联现有 `requestId`、Agent Run、模型、Tool、状态、TTFB、Token 与费用；Pino 关联 `traceId/spanId`。
- 在现有管理员认证边界后新增只读 Trace 查询 API 与调用链抽屉；浏览器不直接访问 Tempo/Grafana，不使用 iframe，也不接受任意查询透传。
- 在应用与 Collector 双层禁止 Prompt、模型输出、工具参数/输出、用户身份、IP、Cookie、Authorization、API Key 及 HTTP body 进入 telemetry。
- 对成功、失败、取消、慢请求与 failover 的 Trace 全量采集，并确保观测组件故障不影响模型调用、账单与请求生命周期终结。

## Capabilities

### New Capabilities

- `private-otel-observability`: 私有自建 Trace/Metric 全量采集、脱敏、7 天保留与业务日志关联。
- `admin-trace-inspection`: 仅管理员可用的、经过字段白名单限制的 Trace 查询和调用链展示。

### Modified Capabilities

- 无。

## Impact

- `apps/api` 将新增 OTel 初始化、业务埋点、Pino trace 关联、管理端 Trace 查询适配层与测试。
- `apps/web` 将在现有管理员请求日志详情中新增只读调用链抽屉。
- `infra/compose` 将新增 OTel Collector、Tempo 及其仅内网访问、7 天保留、全量采集与敏感字段删除配置；不修改 PostgreSQL 的业务真源职责。
- 新增 OpenTelemetry Node SDK、OTLP exporter、自动 instrumentation 与 Collector/Tempo 镜像依赖；不引入第三方 SaaS 或公网 telemetry 出口。
