import { randomUUID } from 'node:crypto'

import type { EvaluationResult } from 'langsmith/evaluation'
import type { Example, Run } from 'langsmith/schemas'

import type { ModelInvocationPort } from '../../chat/model-invocation.port'

export interface JudgeInvoke {
  (input: {
    modelId: string
    system: string
    user: string
  }): Promise<string>
}

const JUDGE_SYSTEM = `你是严格的中文评测裁判。根据「参考期望」判断「助手最终回复」是否基本满足任务。
只输出一行 JSON：{"pass":true|false,"reason":"简短中文理由"}。不要输出其它内容。`

export function buildJudgeUserPrompt(input: {
  referenceAnswer: string
  content: string
}): string {
  return [
    '【参考期望】',
    input.referenceAnswer,
    '',
    '【助手最终回复】',
    input.content,
  ].join('\n')
}

export function parseJudgeResponse(raw: string): { pass: boolean; reason: string } {
  const trimmed = raw.trim()
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) return { pass: false, reason: `无法解析 judge 输出: ${trimmed.slice(0, 200)}` }
  try {
    const parsed = JSON.parse(match[0]) as { pass?: unknown; reason?: unknown }
    const pass = parsed.pass === true || parsed.pass === 1 || parsed.pass === 'true'
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : '无理由'
    return { pass, reason }
  } catch {
    return { pass: false, reason: `judge JSON 无效: ${trimmed.slice(0, 200)}` }
  }
}

export function createModelInvocationJudge(
  port: ModelInvocationPort,
  modelId: string,
): JudgeInvoke {
  return async ({ system, user }) => {
    let content = ''
    for await (const event of port.invoke({
      requestId: randomUUID(),
      modelId,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      signal: AbortSignal.timeout(60_000),
      allowFailover: false,
    })) {
      if (event.type === 'text') content += event.delta
    }
    return content
  }
}

export function createFinalResponseJudgeEvaluator(judge: JudgeInvoke, modelId: string) {
  return async function finalResponseJudge(run: Run, example?: Example): Promise<EvaluationResult> {
    const outputs = (run.outputs ?? {}) as {
      content?: unknown
      error?: unknown
      runId?: unknown
      requestIds?: unknown
    }
    const content = typeof outputs.content === 'string' ? outputs.content.trim() : ''
    const error = typeof outputs.error === 'string' ? outputs.error : ''
    if (error) {
      return {
        key: 'final_response_judge',
        score: 0,
        comment: `跳过 judge：${error}`,
      }
    }
    if (!content) {
      return { key: 'final_response_judge', score: 0, comment: '最终文本为空，跳过 judge' }
    }
    const referenceAnswer = String(
      ((example?.outputs ?? {}) as { referenceAnswer?: unknown }).referenceAnswer ?? '',
    ).trim()
    if (!referenceAnswer) {
      return {
        key: 'final_response_judge',
        score: 1,
        comment: '示例未提供 referenceAnswer，judge 跳过记通过',
      }
    }

    let raw: string
    try {
      raw = await judge({
        modelId,
        system: JUDGE_SYSTEM,
        user: buildJudgeUserPrompt({ referenceAnswer, content }),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return {
        key: 'final_response_judge',
        score: 0,
        comment: `judge 调用失败：${reason}`,
      }
    }
    const { pass, reason } = parseJudgeResponse(raw)
    const requestIds = Array.isArray(outputs.requestIds)
      ? outputs.requestIds.filter((id): id is string => typeof id === 'string')
      : []
    return {
      key: 'final_response_judge',
      score: pass ? 1 : 0,
      comment: [
        reason,
        typeof outputs.runId === 'string' ? `runId=${outputs.runId}` : '',
        requestIds.length > 0 ? `requestIds=${requestIds.join(',')}` : '',
      ]
        .filter(Boolean)
        .join('; '),
    }
  }
}
