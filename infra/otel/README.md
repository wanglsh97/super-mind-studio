# 私有 OTel 运维

生产环境以 `--profile observability` 启动 Collector 与 Tempo；二者只在 Docker `backend` 内网，未映射公网端口。API 默认将 OTLP trace/metric 发送到 Collector，Collector 或 Tempo 不可用时 exporter 的失败不会阻塞 API 请求。

Tempo 只保留 Trace，`block_retention: 168h` 即 7 天；它保存的是诊断数据，不替代 PostgreSQL 业务备份。升级或回滚前按需单独备份 `tempo-data`，超过保留期的数据由 Tempo compactor 自动清理。

应用端和 Collector 都删除 HTTP body、Cookie、Authorization、SQL 语句等敏感字段。没有 tail sampling：成功、失败、超时、取消、failover 与慢请求都会采集。Tempo 查询仅由 API 管理员接口在 backend 网络中调用，浏览器不得直连。

本机验证可执行：`docker compose --env-file .env -f infra/compose/compose.yml -f infra/compose/compose.dev.yml -f infra/compose/compose.observability.dev.yml up -d`，并在 `.env` 设置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces`、`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://127.0.0.1:4318/v1/metrics`、`TEMPO_QUERY_URL=http://127.0.0.1:3200`。只会绑定 loopback 端口。
