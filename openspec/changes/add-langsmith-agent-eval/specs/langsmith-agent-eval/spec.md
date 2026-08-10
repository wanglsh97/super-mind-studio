## ADDED Requirements

### Requirement: Live Agent evaluation entry replaces Mock gateway eval
系统 SHALL 提供以真实 Agent 网关路径为被测目标的离线 LangSmith 评测入口，并 MUST NOT 再以 Mock Chat Adapter 的单次 Chat/Prompt 实验作为本能力的交付物。未配置 `LANGSMITH_API_KEY` 或未启用 live 开关时，评测命令 SHALL 以退出码 0 跳过。

#### Scenario: Skip without live enablement
- **WHEN** 执行评测命令但未同时满足 API key 与 live 开关
- **THEN** 系统不发起真实 Agent run，并以退出码 0 结束

#### Scenario: Mock chat-completion experiment is not the delivered suite
- **WHEN** 查阅本能力的默认评测入口与文档
- **THEN** 默认被测对象为 Agent threads/runs 路径，而非 Mock `chat-completion` / `prompt-optimize-expand` 实验

### Requirement: Suite selection for general and website
系统 SHALL 支持通过 CLI 选择 `general` 或 `website` 套件，**默认 `general`**；两套手工 Dataset 均须可创建或复用，但仅当前选中的 suite 会执行 `evaluate()`。

#### Scenario: Default runs general suite
- **WHEN** 已启用 live 且未指定 suite
- **THEN** 系统只对 general Dataset 运行实验

#### Scenario: Explicit website suite
- **WHEN** 已启用 live 且指定 `--suite=website`
- **THEN** 系统对 website Dataset 运行实验，且 MUST NOT 要求调用方先跑 general

### Requirement: Production-like Agent target with real model
评测目标 SHALL 通过本地 Nest 应用与用户 Session，经 `@supermind/sdk` 创建 Agent thread/run 并订阅 SSE；模型默认 alias 为 `kimi`（可配置覆盖）。`website` suite SHALL 使用 website 模式约定；`general` suite MUST NOT 以 website mode 作为默认。

#### Scenario: General suite uses agent API without website mode
- **WHEN** 运行 general suite 的一条示例
- **THEN** 目标路径经过 Agent API/编排栈，且请求未默认带上 website mode

### Requirement: Ordered-subsequence trajectory evaluation
L3 评分 SHALL 判定示例声明的期望工具名序列是否为实际 `tool-call` 有序序列的子序列（允许实际序列包含额外工具调用）；顺序颠倒或缺失期望步骤 MUST 失败。系统 MUST NOT 将「出现未期望工具」单独定义为 L3 失败条件（无工具黑名单）。

#### Scenario: Extra tools still pass subsequence
- **WHEN** 期望为 `web_search` 然后 `web_fetch`，实际为 `web_search`、`web_fetch`、`web_search`
- **THEN** L3 轨迹评分为通过

#### Scenario: Out-of-order tools fail
- **WHEN** 期望为 `web_search` 然后 `web_fetch`，实际为 `web_fetch` 然后 `web_search`
- **THEN** L3 轨迹评分为不通过

### Requirement: Single attempt per example
每条 Dataset 示例在一次实验中 SHALL 只执行一次 Agent run；系统 MUST NOT 为提高 L3 通过率自动重试同一示例。

#### Scenario: No automatic retry
- **WHEN** 第一次 Agent run 的轨迹未满足有序子序列
- **THEN** 该示例直接按该次输出计分，且不再自动发起第二次 run

### Requirement: Per-suite run timeout
系统 SHALL 为单例 Agent run 配置超时，默认 general 180 秒、website 600 秒（可配置）；超时 MUST abort 该 run，并将该例相关评分记为失败且 comment 可诊断（如 timeout）。

#### Scenario: General run exceeds timeout
- **WHEN** general suite 中一次 Agent run 超过 general 超时
- **THEN** 系统中止该 run，且该例不以成功轨迹通过

### Requirement: Final response LLM-as-judge
系统 SHALL 对 Agent 最终助手文本提供 LLM-as-judge（默认 judge 模型 alias `kimi`），依据示例参考期望给出通过/不通过；judge MUST NOT 再启动完整 Agent run。

#### Scenario: Judge scores final text
- **WHEN** 示例含参考期望且 Agent 产生最终文本
- **THEN** LangSmith 实验中出现 judge 分数与简短 comment

### Requirement: Lightweight correlation with private OTel
评测输出 SHALL 包含 `runId`，并在该 run 已产生 RequestLog 时包含至少一个 `requestId`；系统 MUST NOT 将生产 OTLP 管道改为导出到 LangSmith，MUST NOT 以本评测为由移除 Tempo 或管理员 Trace 查询能力。

#### Scenario: Correlation ids are recorded
- **WHEN** 一次 live Agent 评测 run 完成并产生 RequestLog
- **THEN** 写入 LangSmith 的 outputs 或 evaluator comment 包含 `runId` 与至少一个 `requestId`

#### Scenario: Tempo remains the trace store
- **WHEN** 需要查看评测或生产请求的调用链
- **THEN** 仍通过既有 OTel → Collector → Tempo（及 Admin 抽屉）查看，而不是要求仅使用 LangSmith Trace 替代 Tempo
