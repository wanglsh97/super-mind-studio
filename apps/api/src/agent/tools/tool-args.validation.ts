/**
 * 轻量 JSON Schema 参数校验（覆盖 Agent 工具所需的基础 object/string/number 约束）。
 * 不引入 Ajv：保持依赖面小，并在 registry 层 fail-closed 拒绝无效参数。
 */

export interface ToolArgsValidationSuccess {
  ok: true
  args: Record<string, unknown>
}

export interface ToolArgsValidationFailure {
  ok: false
  code: 'AGENT_TOOL_INVALID_ARGS'
  message: string
  issues: string[]
}

export type ToolArgsValidationResult = ToolArgsValidationSuccess | ToolArgsValidationFailure

export function validateToolArguments(
  parameters: Record<string, unknown>,
  raw: unknown,
): ToolArgsValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('参数必须是 JSON 对象')
  }
  const args = { ...(raw as Record<string, unknown>) }

  if (parameters.type !== undefined && parameters.type !== 'object') {
    return fail('工具 schema 仅支持 type=object')
  }

  const properties =
    parameters.properties &&
    typeof parameters.properties === 'object' &&
    !Array.isArray(parameters.properties)
      ? (parameters.properties as Record<string, Record<string, unknown>>)
      : {}

  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((item): item is string => typeof item === 'string')
    : []

  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      return fail(`缺少必填参数：${key}`)
    }
  }

  if (parameters.additionalProperties === false) {
    for (const key of Object.keys(args)) {
      if (!(key in properties)) {
        return fail(`不允许的额外参数：${key}`)
      }
    }
  }

  for (const [key, schema] of Object.entries(properties)) {
    if (!(key in args)) continue
    const value = args[key]
    const expectedType = schema.type
    if (expectedType === 'string') {
      if (typeof value !== 'string') {
        return fail(`参数 ${key} 必须是 string`)
      }
      const minLength = typeof schema.minLength === 'number' ? schema.minLength : undefined
      if (minLength !== undefined && value.length < minLength) {
        return fail(`参数 ${key} 长度不得小于 ${minLength}`)
      }
      const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined
      if (maxLength !== undefined && value.length > maxLength) {
        return fail(`参数 ${key} 长度不得大于 ${maxLength}`)
      }
    } else if (expectedType === 'number' || expectedType === 'integer') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return fail(`参数 ${key} 必须是 ${expectedType}`)
      }
      if ((expectedType === 'integer' || schema.integer === true) && !Number.isInteger(value)) {
        return fail(`参数 ${key} 必须是整数`)
      }
      const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined
      if (minimum !== undefined && value < minimum) {
        return fail(`参数 ${key} 不得小于 ${minimum}`)
      }
      const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined
      if (maximum !== undefined && value > maximum) {
        return fail(`参数 ${key} 不得大于 ${maximum}`)
      }
    } else if (expectedType === 'boolean') {
      if (typeof value !== 'boolean') {
        return fail(`参数 ${key} 必须是 boolean`)
      }
    } else if (expectedType === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return fail(`参数 ${key} 必须是 object`)
      }
    } else if (expectedType === 'array') {
      if (!Array.isArray(value)) {
        return fail(`参数 ${key} 必须是 array`)
      }
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      return fail(`参数 ${key} 必须是允许的枚举值`)
    }
  }

  return { ok: true, args }
}

function fail(message: string): ToolArgsValidationFailure {
  return {
    ok: false,
    code: 'AGENT_TOOL_INVALID_ARGS',
    message,
    issues: [message],
  }
}
