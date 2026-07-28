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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: TextModelId
  messages: ChatMessage[]
  stream: true
  temperature?: number
  topP?: number
  maxTokens?: number
  comparison?: boolean
}

export type ChatFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown'

export interface ChatSseDeltaPayload {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: TextModelId
  request_id: string
  choices: Array<{
    index: number
    delta: {
      role?: 'assistant'
      content?: string
    }
    finish_reason: ChatFinishReason | null
  }>
}

export interface ChatSseUsagePayload {
  id: string
  object: 'chat.completion.usage'
  created: number
  model: TextModelId
  request_id: string
  choices: []
  usage: {
    prompt_tokens: number | null
    completion_tokens: number | null
    total_tokens: number | null
    aigateway: {
      estimated_cost_cny: string | null
      usage_unknown: boolean
    }
  }
}

export interface ChatSseErrorPayload {
  object: 'chat.completion.error'
  request_id: string
  error: GatewayError
}

export type ChatSsePayload = ChatSseDeltaPayload | ChatSseUsagePayload | ChatSseErrorPayload

export const CHAT_SSE_DONE = '[DONE]' as const

export type ChatEvent =
  | { type: 'start'; requestId: string; model: TextModelId }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'usage'; requestId: string; usage: Usage }
  | { type: 'error'; requestId: string; error: GatewayError }
  | { type: 'done'; requestId: string }

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
