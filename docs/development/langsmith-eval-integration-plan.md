# LangSmith Eval 接入方案（历史草案 · 已取代）

> **状态：已被 OpenSpec change [`add-langsmith-agent-eval`](../../openspec/changes/add-langsmith-agent-eval/) 取代。**  
> 产品面：用户端单次 Chat 已并入 Agent；交付物为**真实 Agent** 离线 Eval（`--suite=general|website`），不再交付 Mock Chat/Prompt 网关实验。  
> 现行用法见 [langsmith-eval.md](./langsmith-eval.md)。

以下内容保留作讨论归档，**不要再按本文实现**。

---

## 1. 原背景与目标（过时）

曾计划为 Chat completion 与 Prompt 优化引入 Mock Adapter 确定性离线评测：

- 用确定性 Mock Adapter，CI 与本地无外部模型费用。
- LangSmith Dataset + `evaluate()` 沉淀实验。
- 不侵入运行时 Nest 模块。

原非目标：不接入 LangChain、不做 LLM-as-judge、不改写 OTel/Tempo。

## 2. 与 OTel 的职责分层（仍然有效）

| 能力 | 实现 |
| --- | --- |
| 运行时 tracing | 私有 OTel → Collector → Tempo（禁止默认第三方 exporter） |
| Dataset / evaluate / 实验对比 | LangSmith SDK（离线脚本） |
| 互查 | 评测 outputs 携带 `runId` / `requestId` |

**现行决策**：不把 OTLP 指向 LangSmith；不删除 Tempo / Admin 抽屉。

## 3. 现行替代方案摘要

见 OpenSpec `add-langsmith-agent-eval` 的 `proposal.md` / `design.md` / `specs/langsmith-agent-eval/spec.md`。
