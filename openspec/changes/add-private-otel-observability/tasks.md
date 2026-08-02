## 1. API telemetry foundation

- [x] 1.1 增加 OTel Node SDK、OTLP exporter、自动 instrumentation 与环境校验；在 NestJS `main.ts` 前加载 instrumentation，`OTEL_ENABLED=false` 或 Collector 未配置时安全降级。
- [x] 1.2 配置 HTTP、Redis、PostgreSQL/Prisma driver 与 undici 自动埋点，禁用 HTTP body、SQL 参数及其他内容采集。
- [x] 1.3 建立 `TelemetryService` 与属性白名单，封装 trace/span、规范化错误、TTFB 与低基数 Metric 写入；禁止公共业务代码直接写任意 telemetry 属性。
- [x] 1.4 为 Pino 增加 traceId/spanId correlation，同时保持既有 requestId 与敏感字段脱敏行为。

## 2. Agent and gateway instrumentation

- [ ] 2.1 为 Agent Run、上下文准备、模型调用/流、请求终结建立手工 span，使用 requestId/runId 进行内部关联并避免每个 SSE delta/token 生成 span。
- [ ] 2.2 为 Tool、MCP discovery/call、Sandbox 与 web 工具统一执行边界建立 span，记录受控工具名称、时长、状态与规范化错误码。
- [ ] 2.3 增加 Agent Run、模型 TTFB、模型调用、Tool/MCP 时长、Token 和费用的低基数 metrics，并约束 label 集合。
- [ ] 2.4 添加单元与 Mock E2E，覆盖成功、取消、流中失败、首事件前 failover、MCP 失败、Trace/Pino/requestId 关联和禁止属性缺失。

## 3. Private telemetry infrastructure

- [ ] 3.1 新增 OTel Collector 和 Tempo Compose profile、配置文件、持久卷、健康检查、资源上限与仅 backend 网络访问；不得映射公网端口或配置第三方 exporter。
- [ ] 3.2 在 Collector 配置应用与出口双层敏感字段删除、批量队列限制和失败不阻塞；成功、失败、超时、取消、failover 与慢请求均全量采集。
- [ ] 3.3 配置 Tempo 7 天 retention、查询访问限制与备份/清理说明；明确其不是 PostgreSQL 业务备份的一部分。
- [ ] 3.4 验证 Collector/Tempo 宕机、队列饱和和 profile 未启用时 API、模型调用、账单与 Pino 均不受阻塞。

## 4. Admin trace inspection

- [ ] 4.1 实现 Tempo TraceStore adapter 和 ObservabilityAdminModule，只支持 requestId 关联 Trace、受限窗口摘要与单 Trace 白名单 span 树；拒绝任意 Tempo 查询透传。
- [ ] 4.2 为 Trace 查询端点接入现有 Admin Guard、审计必要的管理访问事件，并覆盖未认证、伪造 Cookie、未知 requestId、查询注入和 Tempo 不可用。
- [ ] 4.3 在管理员请求日志详情添加只读调用链抽屉，展示瀑布关系、耗时、状态、规范化错误和受控模型/工具元数据；不得 iframe、直连内部服务或显示内容数据。
- [ ] 4.4 完成浏览器 E2E 和部署烟测：调用链可见、未授权不可见、禁止字段不可见、Trace 后端故障显示降级状态。

## 5. Quality and delivery

- [ ] 5.1 更新 `.env.example`、Compose 运维说明、Swagger/管理员文档，明确 OTel 开关、内网端点、7 天保留、采样与隐私边界。
- [ ] 5.2 运行 format、lint、typecheck、unit、PostgreSQL/Redis Mock E2E、Web E2E、build 与 OpenSpec strict validation；记录 Collector/Tempo 资源实测和回滚步骤。
