# LangSmith 真实 Agent Eval

对 **Agent 网关路径**（Nest + `@supermind/sdk` + Pi + 真实模型）做离线评测。结果写入 [LangSmith](https://smith.langchain.com/) Dataset / Experiments；请求链路仍由私有 **OTel → Tempo**（及 Admin 抽屉）排查，用 `runId` / `requestId` 互查。

> 用户端单次 Chat 已并入 Agent；本能力**不**使用 Mock Chat/Prompt 实验，也**不**评 Prompt 优化。旧草案见 [langsmith-eval-integration-plan.md](./langsmith-eval-integration-plan.md)（已取代）。

## 环境变量

```bash
LANGSMITH_API_KEY=lsv2_pt_...
LANGSMITH_PROJECT=super-mind-studio-eval
LANGSMITH_EVAL_LIVE=true          # 未设为 true 则跳过（exit 0）
LANGSMITH_EVAL_MODEL=kimi
LANGSMITH_EVAL_JUDGE_MODEL=kimi
# 可选超时 / dataset 名见 .env.example
```

另需本地 Postgres/Redis、对应模型 API Key（默认 kimi），以及 web_search / web_fetch 上游在 general 例子中可用。

## 运行

```bash
pnpm -C apps/api test:eval                      # 默认 --suite=general
pnpm -C apps/api test:eval -- --suite=website
pnpm -C apps/api test:eval -- --fresh           # 重建当前 suite 的 dataset
```

门禁：

- 无 `LANGSMITH_API_KEY` → 跳过，exit 0
- `LANGSMITH_EVAL_LIVE≠true` → 跳过，exit 0（避免误产生费用）

## 评分

| 维度 | 规则 |
|------|------|
| L3 轨迹 | 期望 tool 序列为实际 `tool-call` 序列的**有序子序列**；无工具黑名单；**不重试** |
| L1 最终答复 | LLM-as-judge（默认 kimi） |
| 超时 | general 180s / website 600s（可配）；超时 abort |

## 可视化与 OTel

1. 打开 https://smith.langchain.com/ → project → Dataset → Experiment  
2. 终端会打印 experiment 名；单条结果 comment / outputs 含 `runId`、`requestIds`  
3. 用 `requestId` 在 Admin 请求日志详情或 Tempo（tag `supermind.request_id`）查看调用链  

**不会**把 OTLP 转到 LangSmith，也**不**用 LangSmith 替换 Tempo。
