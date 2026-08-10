## Context

- 产品面：用户端单次 Chat 已下线，**Chat = Agent**；本 change **不评** Prompt 优化。
- 观测：私有 OTel → Collector → Tempo + Admin 抽屉已是请求链路真源（见 `add-private-otel-observability`）；禁止把生产 OTLP 改打到 LangSmith。
- 旧草案：[docs/development/langsmith-eval-integration-plan.md](../../../docs/development/langsmith-eval-integration-plan.md) 描述的 Mock Chat/Prompt Eval **已被取代**，不得再作为交付基线。
- grilling 确认见本 change 讨论记录；关键锁定如下表。

| 决策 | 选择 |
| --- | --- |
| 被测路径 | 真实 Agent 网关（Nest + SDK + Pi + 真实模型） |
| Mock 网关 Chat/Prompt | 删除，不交付 |
| 模型 | 默认 `kimi`，可 env 覆盖 |
| Suite | `general`（默认）与 `website`；同一命令 `--suite=` |
| L3 | 期望 tool 序列为实际轨迹的**有序子序列** |
| 工具黑名单 | 无 |
| 重试 | 无（每例 1 次） |
| 超时 | general 180s；website 600s（可配置） |
| L1 | LLM-as-judge（默认 `kimi`） |
| OTel | 轻量 ID 互查；保留 Tempo |

## Goals / Non-Goals

**Goals:**

- 可对真实 kimi Agent 跑离线 Experiment，在 LangSmith UI 查看分数与 run。
- general / website 两套手工 Dataset；默认只跑 general。
- L3 子序列 + L1 judge；超时可结束挂起 run。
- 每条成功产生 RequestLog 的评测 run 能带出 `runId` / `requestId` 供 Tempo/Admin 互查。
- 清掉 Mock eval 脚手架，文档不再声称「Agent Eval = Mock Chat」。

**Non-Goals:**

- Online eval、生产 trace 回流、OTLP 转发 LangSmith、拆除 Tempo。
- 工具黑名单、轨迹精确匹配、同例多轮重试。
- Prompt 优化评测、裸 `chat/completions` 用户面评测。
- PR 强制 live CI。

## Decisions

### Decision 1: 单一 capability 与入口

- Capability：`langsmith-agent-eval`
- 命令：`pnpm -C apps/api test:eval`（替换旧 Mock 入口）
- CLI：`--suite=general|website`（默认 general）、`--fresh` 重建对应 Dataset、`--help`
- Live 门禁：`LANGSMITH_API_KEY` 存在且 `LANGSMITH_EVAL_LIVE=true`，否则 skip exit 0

### Decision 2: Target 贴近生产

对齐现有 Agent e2e 启动方式：一次性拉起 `AppModule`、签发 Session、经 SDK 建 thread/run、订阅 SSE。

- general：不传 `mode: 'website'`，不预选建站 skill
- website：`mode: 'website'`（及该模式所需的既有约定）；允许更长超时
- 从 SSE 提取：有序 `tool-call.toolName` 序列、最终助手文本；结束后查 Prisma `RequestLog` 得 `requestId[]`

### Decision 3: L3 有序子序列

定义：存在下标严格递增的映射，使 `expected[i] === actual[map[i]]`。

- `['web_search','web_fetch']` ⊂ `['web_search','web_fetch','web_search']` → 通过  
- 顺序颠倒或缺失 → 失败  
- 不因「多调了 shell」单独失败（无黑名单）；若因此挂起，由超时兜底  

### Decision 4: 无重试 + 分 suite 超时

- 每例仅 1 次 Agent run
- 默认超时：general `180_000` ms，website `600_000` ms（env 可覆盖）
- 超时或 `user-question-asked` 长时间未结束：abort run，outputs 标记失败原因，evaluator 给 0

### Decision 5: L1 LLM-as-judge

- 独立最小模型调用（复用已启动 Nest 内 `ModelInvocationPort`），不再起 Agent
- Judge 默认 `LANGSMITH_EVAL_JUDGE_MODEL=kimi`
- 版本化 judge prompt；输出 0/1 + comment
- Judge 逻辑可单测（注入 mock invoke）

### Decision 6: Dataset

- general：`super-mind-studio-web-agent-eval-v1`（约 8 条手工，偏 search/fetch 任务）
- website：`super-mind-studio-website-agent-eval-v1`（手工例子；任务表述贴合建站模式）
- `--fresh` 只重建当前 suite 的 Dataset

### Decision 7: OTel 轻量配合

- 评测 Nest 进程沿用现有 instrumentation 时，链路进 Tempo
- LangSmith 只存 experiment / 分数；outputs 或 comment 含 `runId`、`requestId`
- 脚本结束打印：experiment 提示 + 用 requestId 查 Admin/Tempo 的说明
- `LANGSMITH_TRACING` 默认 false，不作为生产 trace 真源

### Decision 8: 删除 Mock 脚手架

实现阶段删除或改写：

- `scripts/eval-agent.ts`（Mock 双实验）→ 真实 Agent 入口
- `eval-targets.ts` 等纯 Mock Chat/Prompt target
- 文档与 `.env.example` 中「Mock Adapter 零费用 Agent Eval」表述

可保留可复用的确定性 helper（如非空/延迟 evaluator），但不得再作为 Chat/Prompt Mock 实验交付。

## Risks / Trade-offs

- [无黑名单 + 子序列] → 可能「多调工具仍 L3 通过」；用 L1 judge 与超时补质量/挂起
- [无重试] → 单次 flaky 直接失败；接受手工重跑 experiment
- [website 贵且慢] → 默认不跑；需显式 `--suite=website`
- [真实费用] → live 显式开关；文档写明 kimi 与工具上游成本
- [与旧 integration-plan 冲突] → 文档头部标注取代关系，避免双真源

## Migration Plan

1. 改写 OpenSpec（本步骤）并 strict 校验。
2. 实现时：先移除 Mock 入口与误导文档，再落地 general suite，最后补 website dataset + `--suite=website`。
3. 验证：非 live skip；general live 手工冒烟；website 可选冒烟。

回滚：去掉 live 脚本与 langsmith 依赖；OTel/Tempo 不变。
