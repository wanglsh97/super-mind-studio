import { Client } from 'langsmith'
import { evaluate } from 'langsmith/evaluation'
import type { EvaluationResult, EvaluatorT } from 'langsmith/evaluation'

import { agentEvalDeterministicEvaluators } from '../src/eval/evaluators'
import {
  assertLangSmithApiKey,
  datasetNameForSuite,
  loadLangSmithEvalConfig,
  parseEvalSuite,
  timeoutMsForSuite,
  type EvalSuite,
  type LangSmithEvalConfig,
} from '../src/eval/langsmith-eval.config'
import { GENERAL_AGENT_EVAL_EXAMPLES } from '../src/eval/web-agent/dataset-general'
import { WEBSITE_AGENT_EVAL_EXAMPLES } from '../src/eval/web-agent/dataset-website'

/**
 * 真实 Agent LangSmith Eval。
 *
 * 用法:
 *   pnpm -C apps/api test:eval [-- --suite=general|website] [--fresh]
 *
 * 门禁: LANGSMITH_API_KEY + LANGSMITH_EVAL_LIVE=true，否则 exit 0 跳过。
 * Nest harness 仅在门禁通过后动态加载，避免 skip 路径拉起 AppModule。
 */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const config = loadLangSmithEvalConfig()
  if (!config.apiKey) {
    console.warn(`[eval] 跳过：${missingKeyMessage(config)}`)
    return
  }
  if (!config.liveEnabled) {
    console.warn(
      '[eval] 跳过：未启用 LANGSMITH_EVAL_LIVE=true（真实 Agent 评测会产生模型/工具费用）。',
    )
    return
  }

  assertLangSmithApiKey(config)
  if (config.tracingEnabled) {
    process.env.LANGSMITH_TRACING = 'true'
  }
  process.env.LANGSMITH_API_KEY = config.apiKey
  process.env.LANGSMITH_PROJECT = config.project

  const suite = args.suite
  const datasetName = datasetNameForSuite(config, suite)
  const timeoutMs = timeoutMsForSuite(config, suite)
  const examples = suite === 'website' ? WEBSITE_AGENT_EVAL_EXAMPLES : GENERAL_AGENT_EVAL_EXAMPLES

  console.log(
    JSON.stringify({
      suite,
      dataset: datasetName,
      model: config.evalModelAlias,
      judge: config.judgeModelAlias,
      timeoutMs,
      exampleCount: examples.length,
      project: config.project,
    }),
  )

  const client = new Client({ apiKey: config.apiKey })
  await ensureDataset(client, datasetName, examples, args.fresh)

  const { createAgentEvalHarness } = await import('../src/eval/web-agent/harness')
  const { createWebAgentTarget } = await import('../src/eval/web-agent/target')
  const { createFinalResponseJudgeEvaluator, createModelInvocationJudge } = await import(
    '../src/eval/web-agent/final-response-judge'
  )

  const harness = await createAgentEvalHarness({
    evalModelAlias: config.evalModelAlias,
    judgeModelAlias: config.judgeModelAlias,
  })

  try {
    const target = createWebAgentTarget(harness, { suite, timeoutMs })
    const judgeEvaluator = createFinalResponseJudgeEvaluator(
      createModelInvocationJudge(harness.modelInvocation, harness.judgeModelId),
      harness.judgeModelId,
    )
    const evaluators: EvaluatorT[] = [...agentEvalDeterministicEvaluators, judgeEvaluator]

    console.log(`\n[eval] 运行 suite=${suite} experiment…`)
    const results = await evaluate(target, {
      data: datasetName,
      evaluators,
      experimentPrefix: `agent-${suite}`,
      maxConcurrency: 1,
      metadata: {
        suite,
        evalModel: config.evalModelAlias,
        judgeModel: config.judgeModelAlias,
        modelId: harness.modelId,
      },
    })

    // langsmith 0.8：evaluate() 返回前已 processData，并把 processedCount 置满；
    // for-await 会得到 0 行，必须读 results.results。
    const rows = results.results
    const failures: string[] = []
    for (const row of rows) {
      const evalResults = row.evaluationResults?.results ?? []
      for (const result of evalResults) {
        if (!isPassing(result)) {
          failures.push(
            `example=${row.example.id} evaluator=${result.key} comment=${result.comment ?? '-'}`,
          )
        }
      }
    }

    console.log(`[eval] 实验名: ${results.experimentName}`)
    console.log(
      `[eval] LangSmith: https://smith.langchain.com/  → project「${config.project}」→ Datasets「${datasetName}」→ Experiments「${results.experimentName}」`,
    )
    console.log(
      '[eval] OTel/Tempo: 用实验 outputs 中的 requestId 在 Admin 请求日志详情 / Tempo 按 supermind.request_id 查询调用链（私有 OTel，不转发 LangSmith）。',
    )

    if (rows.length !== examples.length) {
      failures.push(`示例数量不符：期望 ${examples.length}，实际 ${rows.length}`)
    }
    if (failures.length > 0) {
      console.error(`[eval] 未通过:\n  - ${failures.join('\n  - ')}`)
      process.exitCode = 1
      return
    }
    console.log(`[eval] 全部通过（${rows.length} 个示例）`)
  } finally {
    await harness.close()
  }
}

function parseArgs(argv: string[]): { help: boolean; fresh: boolean; suite: EvalSuite } {
  let help = false
  let fresh = false
  let suiteRaw: string | undefined
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--help' || arg === '-h') help = true
    else if (arg === '--fresh') fresh = true
    else if (arg.startsWith('--suite=')) suiteRaw = arg.slice('--suite='.length)
    else if (arg === '--suite') {
      throw new Error('请使用 --suite=general 或 --suite=website')
    } else {
      throw new Error(`未知参数: ${arg}`)
    }
  }
  return { help, fresh, suite: parseEvalSuite(suiteRaw) }
}

function printHelp(): void {
  console.log(`用法: tsx --env-file-if-exists=../../.env scripts/eval-agent.ts [--suite=general|website] [--fresh]

选项:
  --suite=general|website  评测套件（默认 general）
  --fresh                  删除并重建当前 suite 的 LangSmith dataset
  --help                   显示帮助

门禁环境变量:
  LANGSMITH_API_KEY        必需
  LANGSMITH_EVAL_LIVE=true 必需（真实 Agent，有费用）
  LANGSMITH_EVAL_MODEL     默认 kimi
  LANGSMITH_EVAL_JUDGE_MODEL 默认 kimi`)
}

function isPassing(result: EvaluationResult): boolean {
  return result.score === 1 || result.score === true
}

async function ensureDataset(
  client: Client,
  datasetName: string,
  examples: readonly {
    inputs: Record<string, unknown>
    outputs: Record<string, unknown>
    metadata: Record<string, unknown>
  }[],
  fresh: boolean,
): Promise<void> {
  const exists = await client.hasDataset({ datasetName })
  if (exists && fresh) {
    console.log(`[eval] --fresh：删除已有 dataset "${datasetName}"`)
    await client.deleteDataset({ datasetName })
  } else if (exists) {
    console.log(`[eval] 复用已有 dataset "${datasetName}"`)
    return
  }
  console.log(`[eval] 创建 dataset "${datasetName}" 并写入 ${examples.length} 条手工示例`)
  const dataset = await client.createDataset(datasetName, {
    description: 'Super Mind Studio 真实 Agent Eval 手工示例',
  })
  // langsmith 0.8：createExamples 接受 ExampleCreate[]（每条带 dataset_id）
  await client.createExamples(
    examples.map((example) => ({
      dataset_id: dataset.id,
      inputs: example.inputs,
      outputs: example.outputs,
      metadata: example.metadata,
    })),
  )
}

function missingKeyMessage(config: LangSmithEvalConfig): string {
  try {
    assertLangSmithApiKey(config)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return '缺少 LANGSMITH_API_KEY'
}

void main().catch((error: unknown) => {
  console.error(`[eval] 评测失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
