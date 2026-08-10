/**
 * LangSmith Agent Eval 配置（仅离线脚本读取 process.env，不进 Nest 运行时模块）。
 */

export type EvalSuite = 'general' | 'website'

export interface LangSmithEvalConfig {
  apiKey: string | undefined
  project: string
  tracingEnabled: boolean
  liveEnabled: boolean
  evalModelAlias: string
  judgeModelAlias: string
  generalDatasetName: string
  websiteDatasetName: string
  generalTimeoutMs: number
  websiteTimeoutMs: number
}

export const DEFAULT_LANGSMITH_PROJECT = 'super-mind-studio-eval'
export const DEFAULT_GENERAL_DATASET = 'super-mind-studio-web-agent-eval-v1'
export const DEFAULT_WEBSITE_DATASET = 'super-mind-studio-website-agent-eval-v1'
export const DEFAULT_EVAL_MODEL = 'kimi'
export const DEFAULT_GENERAL_TIMEOUT_MS = 180_000
export const DEFAULT_WEBSITE_TIMEOUT_MS = 600_000

function readPositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function loadLangSmithEvalConfig(
  env: NodeJS.ProcessEnv = process.env,
): LangSmithEvalConfig {
  return {
    apiKey: env.LANGSMITH_API_KEY?.trim() || undefined,
    project: env.LANGSMITH_PROJECT?.trim() || DEFAULT_LANGSMITH_PROJECT,
    tracingEnabled: env.LANGSMITH_TRACING?.trim().toLowerCase() === 'true',
    liveEnabled: env.LANGSMITH_EVAL_LIVE?.trim().toLowerCase() === 'true',
    evalModelAlias: env.LANGSMITH_EVAL_MODEL?.trim() || DEFAULT_EVAL_MODEL,
    judgeModelAlias: env.LANGSMITH_EVAL_JUDGE_MODEL?.trim() || DEFAULT_EVAL_MODEL,
    generalDatasetName: env.LANGSMITH_EVAL_GENERAL_DATASET?.trim() || DEFAULT_GENERAL_DATASET,
    websiteDatasetName: env.LANGSMITH_EVAL_WEBSITE_DATASET?.trim() || DEFAULT_WEBSITE_DATASET,
    generalTimeoutMs: readPositiveInt(env.LANGSMITH_EVAL_GENERAL_TIMEOUT_MS, DEFAULT_GENERAL_TIMEOUT_MS),
    websiteTimeoutMs: readPositiveInt(env.LANGSMITH_EVAL_WEBSITE_TIMEOUT_MS, DEFAULT_WEBSITE_TIMEOUT_MS),
  }
}

export function assertLangSmithApiKey(config: LangSmithEvalConfig): string {
  if (!config.apiKey) {
    throw new Error(
      '缺少 LANGSMITH_API_KEY：请先在 https://smith.langchain.com/ 创建 API Key，' +
        '并写入根目录 .env，然后重新运行 pnpm -C apps/api test:eval。',
    )
  }
  return config.apiKey
}

export function parseEvalSuite(raw: string | undefined): EvalSuite {
  const value = raw?.trim().toLowerCase()
  if (!value || value === 'general') return 'general'
  if (value === 'website') return 'website'
  throw new Error(`未知 suite「${raw}」，仅支持 general | website`)
}

export function datasetNameForSuite(config: LangSmithEvalConfig, suite: EvalSuite): string {
  return suite === 'website' ? config.websiteDatasetName : config.generalDatasetName
}

export function timeoutMsForSuite(config: LangSmithEvalConfig, suite: EvalSuite): number {
  return suite === 'website' ? config.websiteTimeoutMs : config.generalTimeoutMs
}
