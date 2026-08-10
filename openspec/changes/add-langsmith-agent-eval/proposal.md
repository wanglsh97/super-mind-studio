## Why

用户端单次 Chat 已并入 Agent，Prompt 优化也不在本 change 范围。平台需要的是对**真实 Agent 网关路径**的离线质量评测，而非 Mock Chat/Prompt 护栏。同时必须保持私有 OTel → Tempo 作为请求链路真源，LangSmith 只承担 Dataset / Experiment / 评分，二者轻量用 ID 配合。

## What Changes

- 以 LangSmith Dataset + `evaluate()` 接入**真实 Agent**离线评测（默认模型 alias `kimi`，可配置覆盖）；target 走本地 Nest + 用户 Session + `@supermind/sdk` → Agent threads/runs → Pi → `ModelInvocationPort` → 真实上游。
- 提供统一评测入口，支持 `--suite=general|website`（**默认 `general`**）；两套手工 Dataset 都建立，website 仅在显式选 suite 时执行。
- 评分：**L3** 为工具轨迹**有序子序列**匹配；**L1** 为最终答复 LLM-as-judge（默认 `kimi`）。**不设工具黑名单**；**每例只跑 1 次**（不重试）。
- 超时：`general` 默认 3 分钟 / 例，`website` 默认 10 分钟 / 例；超时 abort 并记失败。
- **删除/替换**工作区已有 Mock「网关 Chat/Prompt」`test:eval` 脚手架与相关文档表述，避免再冒充 Agent Eval。
- 与 OTel/Tempo **轻量配合**：评测输出携带 `runId` / `requestId` 便于互查；**不**将 OTLP 指向 LangSmith，**不**移除 Tempo 或 Admin Trace 抽屉。
- 结果在 [smith.langchain.com](https://smith.langchain.com/) 查看；无 `LANGSMITH_API_KEY` 或未开 live 开关时 exit 0 跳过；**不**作为 PR 强制 CI 门禁。

## Capabilities

### New Capabilities

- `langsmith-agent-eval`: 真实 Agent 离线评测（general / website suite）、有序子序列 L3、LLM-as-judge L1、live 门禁、与私有 OTel 的 ID 关联。

### Modified Capabilities

- 无。（不修改 `private-otel-observability` / `admin-trace-inspection` 的禁止第三方 exporter 要求。）

## Impact

- `apps/api`：以 Agent live 评测替换现有 Mock eval 代码与 script；扩展 env（live、model、judge、suite 超时、dataset 名等）。
- `docs/development`：重写评测指南；`langsmith-eval-integration-plan.md` 中 Mock 网关方案标为已被本 change 取代（Chat=Agent）。
- 运行时 Nest 业务模块、生产 Compose、Tempo、Admin Trace：**无行为变更**。
- 会产生真实模型与工具上游费用；website suite 费用与耗时更高。
- 回滚：移除评测脚本/依赖与相关 env；不影响 Agent 主链路与私有 OTel。
