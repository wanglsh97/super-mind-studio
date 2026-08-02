## ADDED Requirements

### Requirement: Admin-only trace inspection
系统 SHALL 仅允许通过现有 Admin Guard 认证的管理员按 RequestLog 的 `requestId` 查询关联 Trace 和受控 Trace 摘要；未认证用户 MUST 无法读取任何 Trace 数据。

#### Scenario: Administrator opens a request trace
- **WHEN** 已认证管理员在请求日志详情中请求某个允许访问的 requestId 的调用链
- **THEN** API 返回该 requestId 关联的只读 Trace 树和白名单字段

#### Scenario: Unauthenticated trace request is rejected
- **WHEN** 未认证客户端请求管理员 Trace API
- **THEN** API 返回认证失败且不泄露 Trace 存在性、Tempo 地址或内部查询信息

### Requirement: Safe trace query boundary
管理员 Trace API SHALL 仅接受固定的 requestId 与受限时间窗口查询，MUST 不接受 Tempo 查询语言、任意 URL、任意 tag、自由文本或浏览器直连后端的请求。

#### Scenario: Query injection is rejected
- **WHEN** 管理员客户端提交包含自由查询表达式或未允许筛选字段的 Trace 请求
- **THEN** API 拒绝请求且不将该值转发给 Tempo

### Requirement: Read-only sanitized trace presentation
系统 SHALL 在 `/admin` 以内联调用链抽屉展示 span 名称、父子关系、开始/结束时间、耗时、状态、规范化错误码与受控模型/工具元数据；系统 MUST 不使用 iframe 或显示禁止 telemetry 字段。

#### Scenario: Trace drawer renders safely
- **WHEN** 管理员打开有可用 Trace 的请求日志详情
- **THEN** 页面显示只读瀑布式调用链而不加载 Grafana iframe、Tempo 地址、Prompt、模型输出或工具内容

### Requirement: Trace backend degradation
系统 SHALL 在 Trace 后端不可用时向已认证管理员返回明确的“调用链暂不可用”状态，且不得影响请求日志详情、账单详情或其他管理员功能。

#### Scenario: Tempo query fails
- **WHEN** 管理员打开请求详情且 Tempo 查询失败
- **THEN** 请求日志详情仍正常展示，并且调用链区域显示可恢复的不可用状态
