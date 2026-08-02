## ADDED Requirements

### Requirement: Private telemetry pipeline
系统 SHALL 在启用时将 API Trace 与 Metrics 仅发送至同一 Docker backend 网络中的 OTel Collector，并由 Collector 仅导出至自建 Tempo；Collector、Tempo 和可选 Grafana SHALL 不暴露公网端口或配置第三方 exporter。

#### Scenario: Production pipeline is private
- **WHEN** 生产 Compose 启用 observability profile
- **THEN** API 只能通过内部 Collector 端点导出 telemetry，且外部网络不能直接连接 Collector、Tempo 或 Grafana

### Requirement: Telemetry data minimization
系统 SHALL 仅采集白名单化的请求/运行标识、能力、模型、工具、状态、时间、token、费用、failover 与规范化错误元数据；系统 MUST 不采集或导出内容、身份、网络地址、HTTP body 或凭证。

#### Scenario: Forbidden data is not exported
- **WHEN** Agent 请求包含 Prompt、Cookie、Authorization、MCP 参数和模型输出
- **THEN** Collector 接收到并存入 Tempo 的 Trace 不包含这些值或其派生属性

### Requirement: Diagnostic traces and metrics
系统 SHALL 为 HTTP、PostgreSQL、Redis、出站 HTTP 以及 Agent run、模型流、Tool/MCP 调用和请求终结提供可关联的 Trace 或 Metrics；SSE 模型流 MUST 以单个流 span 表示并记录 TTFB 与终态。

#### Scenario: Agent model call is traceable
- **WHEN** Agent Run 调用模型并产生流式终态
- **THEN** 调用链包含 Agent、模型流和请求终结的关联 span，且不为每个 SSE delta 创建 span

### Requirement: Telemetry failure isolation
系统 SHALL 将 OTel 初始化和导出设计为 fail-open；Collector、Tempo 或 exporter 不可用 MUST 不阻塞 API 启动、模型调用、请求终结、账单写入或 Pino 日志。

#### Scenario: Collector is unavailable
- **WHEN** API 已启用 OTel 但 Collector 不可达
- **THEN** Agent 请求仍按既有请求生命周期完成，且系统仅产生不含敏感内容的本地告警

### Requirement: Sampling and retention
生产 Collector SHALL 保留 Trace 7 天，并对错误、超时、取消、failover 与慢请求保留全部 Trace，对其他成功 Trace 以 5% 采样。

#### Scenario: Failed trace is retained
- **WHEN** 模型流在首事件前失败并触发 failover 或终态失败
- **THEN** Collector 保留该 Trace，并记录规范化结果而非上游原始响应内容
