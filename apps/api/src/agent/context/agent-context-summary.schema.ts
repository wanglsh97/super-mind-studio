export const AGENT_CONTEXT_SUMMARY_SCHEMA_VERSION = 'v1' as const

export interface AgentContextSummaryV1 {
  userGoals: string[]
  userConstraints: string[]
  decisions: { decision: string; rationale?: string }[]
  facts: { statement: string; source: string }[]
  openQuestions: string[]
  pendingTasks: { task: string; status: 'pending' | 'in_progress' | 'blocked' }[]
  toolFindings: { toolName: string; finding: string }[]
  referencedArtifacts: { name: string; reference: string }[]
  recentOutcome: string
  compressionNotes: string[]
}

const ROOT_KEYS = [
  'userGoals',
  'userConstraints',
  'decisions',
  'facts',
  'openQuestions',
  'pendingTasks',
  'toolFindings',
  'referencedArtifacts',
  'recentOutcome',
  'compressionNotes',
] as const

export function parseAgentContextSummaryV1(text: string): AgentContextSummaryV1 {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new AgentContextSummaryValidationError('摘要不是合法 JSON', error)
  }
  const root = strictRecord(value, ROOT_KEYS, 'summary')
  return {
    userGoals: strings(root.userGoals, 'userGoals'),
    userConstraints: strings(root.userConstraints, 'userConstraints'),
    decisions: records(root.decisions, ['decision', 'rationale'], 'decisions').map((item) => ({
      decision: requiredString(item.decision, 'decisions.decision'),
      ...(item.rationale === undefined
        ? {}
        : { rationale: requiredString(item.rationale, 'decisions.rationale') }),
    })),
    facts: records(root.facts, ['statement', 'source'], 'facts').map((item) => ({
      statement: requiredString(item.statement, 'facts.statement'),
      source: requiredString(item.source, 'facts.source'),
    })),
    openQuestions: strings(root.openQuestions, 'openQuestions'),
    pendingTasks: records(root.pendingTasks, ['task', 'status'], 'pendingTasks').map((item) => {
      const status = requiredString(item.status, 'pendingTasks.status')
      if (!['pending', 'in_progress', 'blocked'].includes(status))
        invalid('pendingTasks.status 不合法')
      return {
        task: requiredString(item.task, 'pendingTasks.task'),
        status: status as 'pending' | 'in_progress' | 'blocked',
      }
    }),
    toolFindings: records(root.toolFindings, ['toolName', 'finding'], 'toolFindings').map(
      (item) => ({
        toolName: requiredString(item.toolName, 'toolFindings.toolName'),
        finding: requiredString(item.finding, 'toolFindings.finding'),
      }),
    ),
    referencedArtifacts: records(
      root.referencedArtifacts,
      ['name', 'reference'],
      'referencedArtifacts',
    ).map((item) => ({
      name: requiredString(item.name, 'referencedArtifacts.name'),
      reference: requiredString(item.reference, 'referencedArtifacts.reference'),
    })),
    recentOutcome: requiredString(root.recentOutcome, 'recentOutcome', true),
    compressionNotes: strings(root.compressionNotes, 'compressionNotes'),
  }
}

export class AgentContextSummaryValidationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'AgentContextSummaryValidationError'
  }
}

function strictRecord(
  value: unknown,
  keys: readonly string[],
  name: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${name} 必须是 object`)
  const record = value as Record<string, unknown>
  const actual = Object.keys(record)
  for (const key of keys) if (!(key in record)) invalid(`${name} 缺少 ${key}`)
  for (const key of actual) if (!keys.includes(key)) invalid(`${name} 含未知字段 ${key}`)
  return record
}

function records(value: unknown, keys: readonly string[], name: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) invalid(`${name} 必须是 array`)
  if (value.length > 100) invalid(`${name} 超过项目数量限制`)
  return value.map((item, index) => strictRecord(item, keys, `${name}[${index}]`))
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) invalid(`${name} 必须是 array`)
  if (value.length > 100) invalid(`${name} 超过项目数量限制`)
  return value.map((item, index) => requiredString(item, `${name}[${index}]`))
}

function requiredString(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    invalid(`${name} 必须是非空 string`)
  if (value.length > 4000) invalid(`${name} 超过长度限制`)
  return value
}

function invalid(message: string): never {
  throw new AgentContextSummaryValidationError(message)
}
