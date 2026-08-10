## 1. 清理 Mock 网关 Eval 并重写入口

- [x] 1.1 移除或改写 Mock Chat/Prompt `eval-targets`、旧 `eval-agent` 双实验逻辑及误导性「Agent Eval = Mock」文档表述；`test:eval` 改为真实 Agent 入口
- [x] 1.2 扩展 `langsmith-eval.config` / env 示例：`LANGSMITH_EVAL_LIVE`、model/judge、suite 超时、general/website dataset 名；无 key 或非 live 时 exit 0

## 2. Agent Live Eval 核心

- [x] 2.1 实现轨迹有序子序列匹配、分 suite 超时、从 SSE/`RequestLog` 提取最终文本与 `runId`/`requestId`；覆盖子序列与超时相关单测
- [x] 2.2 实现 Nest+SDK target（默认 `kimi`）、L1 LLM-as-judge、`--suite=general|website`（默认 general）与 `--fresh`；脚本打印 Experiment 与 Tempo/Admin 互查提示
- [x] 2.3 写入 general 与 website 两套手工 Dataset；默认只跑 general，website 仅显式 `--suite=website`

## 3. 文档与验证

- [x] 3.1 更新 `langsmith-eval.md`；在 `langsmith-eval-integration-plan.md` 顶部标注 Mock 方案已被本 change 取代（Chat=Agent）
- [x] 3.2 运行 eval 相关单测与 typecheck；校验非 live skip；OpenSpec strict 校验；可选手工 live 冒烟并记录 alias
