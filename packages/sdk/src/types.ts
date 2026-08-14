export const TEXT_MODEL_ALIASES = ['qwen', 'glm', 'deepseek', 'kimi'] as const;

export type TextModelAlias = (typeof TEXT_MODEL_ALIASES)[number];
export type TextModelId = string;
export type ModelAlias = TextModelAlias;

export type Capability = 'chat' | 'image' | 'prompt' | 'agent';

export interface GatewayError {
  requestId: string;
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostCny: string | null;
  usageUnknown: boolean;
}

export type ChatFinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'unknown';

export const PROMPT_OPTIMIZATION_MODES = ['expand', 'simplify', 'structure'] as const;
export type PromptOptimizationMode = (typeof PROMPT_OPTIMIZATION_MODES)[number];

export interface OptimizePromptRequest {
  prompt: string;
  mode: PromptOptimizationMode;
}

export interface OptimizePromptResult {
  requestId: string;
  model: TextModelAlias;
  optimizedPrompt: string;
  usage: Usage;
  templateVersion: string;
}

export interface ModelSummary {
  id: string;
  alias: ModelAlias;
  modelId?: string;
  capabilities: Capability[];
  displayName: string;
  enabled: boolean;
  configured: boolean;
  health: 'unknown' | 'healthy' | 'unhealthy';
}
