import type {
  GatewayError,
  ModelSummary,
  OptimizePromptRequest,
  OptimizePromptResult,
} from './types.js';
import { AIGatewayAuthenticationError, AIGatewayError, AIGatewayProtocolError } from './errors.js';
import { createAgentClient } from './agent-client.js';
import type { AgentClient } from './agent-client.js';
import type { SkillDirectUploadTransport } from './skill-upload.js';
import type { CreativeItem } from './creations.js';
import { requestCreativeJson } from './creations.js';
import {
  createAdminSkillClient,
  createSkillMarketClient,
  type AdminSkillClient,
  type SkillMarketClient,
} from './skill-market-client.js';

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CreateSuperMindClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: 'omit' | 'same-origin' | 'include';
  skillUploadTransport?: SkillDirectUploadTransport;
}

export interface SuperMindClient {
  prompts: {
    optimize(input: OptimizePromptRequest, options?: RequestOptions): Promise<OptimizePromptResult>;
  };
  models: {
    list(options?: RequestOptions): Promise<ModelSummary[]>;
  };
  agent: AgentClient;
  creations: {
    list(options?: RequestOptions): Promise<CreativeItem[]>;
  };
  skills: SkillMarketClient;
  admin: {
    skills: AdminSkillClient;
  };
}

export function createSuperMindClient(options: CreateSuperMindClientOptions = {}): SuperMindClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) throw new TypeError('A Fetch API implementation is required');
  const baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
  const fetchWithCredentials: typeof globalThis.fetch = (input, init) =>
    fetchImplementation(input, {
      credentials: options.credentials ?? 'same-origin',
      ...init,
    });

  return {
    prompts: {
      optimize: (input, requestOptions) =>
        optimizePrompt(fetchWithCredentials, baseUrl, input, requestOptions),
    },
    models: {
      list: (requestOptions) => listModels(fetchWithCredentials, baseUrl, requestOptions),
    },
    agent: createAgentClient(fetchWithCredentials, baseUrl, {
      ...(options.skillUploadTransport === undefined
        ? {}
        : { skillUploadTransport: options.skillUploadTransport }),
    }),
    creations: {
      list: (requestOptions) =>
        requestCreativeJson<CreativeItem[]>(fetchWithCredentials, `${baseUrl}/api/v1/creations`, {
          headers: { accept: 'application/json' },
          ...(requestOptions?.signal === undefined ? {} : { signal: requestOptions.signal }),
        }),
    },
    skills: createSkillMarketClient(fetchWithCredentials, baseUrl),
    admin: {
      skills: createAdminSkillClient(fetchWithCredentials, baseUrl),
    },
  };
}

async function optimizePrompt(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  input: OptimizePromptRequest,
  options: RequestOptions | undefined,
): Promise<OptimizePromptResult> {
  const response = await fetchImplementation(`${baseUrl}/api/v1/prompts/optimize`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(input),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  const headerRequestId = response.headers.get('x-request-id');
  if (!response.ok) throw await responseError(response, headerRequestId);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AIGatewayProtocolError(
      headerRequestId ?? 'unknown',
      'Prompt optimization response is not valid JSON',
      error,
    );
  }
  return parseOptimizePromptResult(body, headerRequestId);
}

function parseOptimizePromptResult(
  value: unknown,
  headerRequestId: string | null,
): OptimizePromptResult {
  const result = asRecord(value);
  const requestId = stringValue(result?.requestId);
  const model = stringValue(result?.model);
  const optimizedPrompt = stringValue(result?.optimizedPrompt);
  const templateVersion = stringValue(result?.templateVersion);
  const usage = asRecord(result?.usage);
  const protocolRequestId = requestId ?? headerRequestId ?? 'unknown';
  if (
    !result ||
    !requestId ||
    (headerRequestId !== null && requestId !== headerRequestId) ||
    !model ||
    !['qwen', 'glm', 'deepseek', 'kimi'].includes(model) ||
    !optimizedPrompt ||
    !templateVersion ||
    !usage
  ) {
    throw new AIGatewayProtocolError(protocolRequestId, 'Prompt optimization response is invalid');
  }

  return {
    requestId,
    model: model as OptimizePromptResult['model'],
    optimizedPrompt,
    templateVersion,
    usage: {
      inputTokens: nullableNumber(usage.inputTokens, requestId),
      outputTokens: nullableNumber(usage.outputTokens, requestId),
      totalTokens: nullableNumber(usage.totalTokens, requestId),
      estimatedCostCny: nullableString(usage.estimatedCostCny, requestId),
      usageUnknown: requiredBoolean(usage.usageUnknown, requestId),
    },
  };
}

async function listModels(
  fetchImplementation: typeof globalThis.fetch,
  baseUrl: string,
  options: RequestOptions | undefined,
): Promise<ModelSummary[]> {
  const response = await fetchImplementation(`${baseUrl}/api/v1/models`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  });
  const requestId = response.headers.get('x-request-id');

  if (!response.ok) throw await responseError(response, requestId);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AIGatewayProtocolError(
      requestId ?? 'unknown',
      'Models response is not valid JSON',
      error,
    );
  }

  if (!Array.isArray(body)) {
    throw new AIGatewayProtocolError(requestId ?? 'unknown', 'Models response must be an array');
  }

  return body.map((value) => parseModelSummary(value, requestId ?? 'unknown'));
}

function parseModelSummary(value: unknown, requestId: string): ModelSummary {
  const model = asRecord(value);
  const id = stringValue(model?.id);
  const alias = stringValue(model?.alias);
  const modelId = model?.modelId === undefined ? undefined : stringValue(model.modelId);
  const displayName = stringValue(model?.displayName);
  const capabilities = model?.capabilities;
  const enabled = booleanValue(model?.enabled);
  const configured = booleanValue(model?.configured);
  const health = model?.health;

  if (
    !model ||
    !id ||
    !alias ||
    !['qwen', 'glm', 'deepseek', 'kimi'].includes(alias) ||
    !displayName ||
    (model?.modelId !== undefined && !modelId) ||
    !Array.isArray(capabilities) ||
    !capabilities.every((item) => ['chat', 'image', 'prompt', 'agent'].includes(String(item))) ||
    enabled === undefined ||
    configured === undefined ||
    !['unknown', 'healthy', 'unhealthy'].includes(String(health))
  ) {
    throw new AIGatewayProtocolError(
      requestId,
      'Models response contains an invalid model summary',
    );
  }

  return value as ModelSummary;
}

async function responseError(response: Response, headerRequestId: string | null) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const record = asRecord(body);
  const requestId = stringValue(record?.requestId) ?? headerRequestId ?? 'unknown';
  const details = asRecord(record?.details);
  const error: GatewayError = {
    requestId,
    code: stringValue(record?.code) ?? `HTTP_${response.status}`,
    message: stringValue(record?.message) ?? `Gateway request failed with HTTP ${response.status}`,
    retryable:
      booleanValue(record?.retryable) ?? (response.status === 429 || response.status >= 500),
    ...(details === undefined ? {} : { details }),
  };
  return response.status === 401
    ? new AIGatewayAuthenticationError(error)
    : new AIGatewayError(error, { status: response.status });
}

function nullableNumber(value: unknown, requestId: string): number | null {
  if (value === null || typeof value === 'number') return value;
  throw new AIGatewayProtocolError(requestId, 'Usage token value must be a number or null');
}

function nullableString(value: unknown, requestId: string): string | null {
  if (value === null || typeof value === 'string') return value;
  throw new AIGatewayProtocolError(requestId, 'Usage cost value must be a string or null');
}

function requiredBoolean(value: unknown, requestId: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new AIGatewayProtocolError(requestId, 'Usage unknown flag must be a boolean');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
