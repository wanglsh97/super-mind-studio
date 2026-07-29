export const TEXT_MODEL_ALIASES = ['qwen', 'glm', 'deepseek', 'kimi'] as const
export const IMAGE_MODEL_ALIASES = ['mock-image'] as const

export type TextModelAlias = (typeof TEXT_MODEL_ALIASES)[number]
export type TextModelId = string
export type ImageModelAlias = (typeof IMAGE_MODEL_ALIASES)[number]
export type ModelAlias = TextModelAlias | ImageModelAlias

export type Capability = 'chat' | 'image' | 'prompt' | 'agent'

export interface GatewayError {
  requestId: string
  code: string
  message: string
  retryable: boolean
  details?: Record<string, unknown>
}

export interface Usage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  estimatedCostCny: string | null
  usageUnknown: boolean
}

export type ChatFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown'

export type ImageTaskStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface ImageRequest {
  model: ImageModelAlias
  prompt: string
  size?: string
  count?: number
}

export interface ImageResult {
  index: number
  width?: number
  height?: number
  contentType?: string
}

export interface ImageTask {
  taskId: string
  model: ImageModelAlias
  status: ImageTaskStatus
  results: ImageResult[]
  error?: GatewayError
  createdAt?: string
  updatedAt?: string
}

export const PROMPT_OPTIMIZATION_MODES = ['expand', 'simplify', 'structure'] as const
export type PromptOptimizationMode = (typeof PROMPT_OPTIMIZATION_MODES)[number]

export interface OptimizePromptRequest {
  prompt: string
  mode: PromptOptimizationMode
}

export interface OptimizePromptResult {
  requestId: string
  model: TextModelAlias
  optimizedPrompt: string
  usage: Usage
  templateVersion: string
}

export interface ModelSummary {
  id: string
  alias: ModelAlias
  modelId?: string
  capabilities: Capability[]
  displayName: string
  enabled: boolean
  configured: boolean
  health: 'unknown' | 'healthy' | 'unhealthy'
}
