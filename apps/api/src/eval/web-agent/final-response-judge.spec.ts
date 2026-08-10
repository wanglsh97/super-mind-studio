import {
  buildJudgeUserPrompt,
  createFinalResponseJudgeEvaluator,
  parseJudgeResponse,
} from './final-response-judge'

describe('parseJudgeResponse', () => {
  it('解析 pass true', () => {
    expect(parseJudgeResponse('{"pass":true,"reason":"符合"}')).toEqual({
      pass: true,
      reason: '符合',
    })
  })

  it('解析夹杂文本的 JSON', () => {
    expect(parseJudgeResponse('好的\n{"pass":false,"reason":"偏题"}\n')).toEqual({
      pass: false,
      reason: '偏题',
    })
  })

  it('无法解析时失败', () => {
    expect(parseJudgeResponse('不是 json').pass).toBe(false)
  })
})

describe('buildJudgeUserPrompt', () => {
  it('包含参考与回复', () => {
    const prompt = buildJudgeUserPrompt({ referenceAnswer: '期望A', content: '回复B' })
    expect(prompt).toContain('期望A')
    expect(prompt).toContain('回复B')
  })
})

describe('createFinalResponseJudgeEvaluator', () => {
  it('judge 调用失败时将当前样本记为失败而不抛出', async () => {
    const evaluator = createFinalResponseJudgeEvaluator(
      async () => {
        throw new Error('judge unavailable')
      },
      'kimi-id',
    )
    const result = await evaluator(
      { outputs: { content: '回答', runId: 'run-1', requestIds: ['req-1'] } } as never,
      { outputs: { referenceAnswer: '期望' } } as never,
    )
    expect(result).toEqual({
      key: 'final_response_judge',
      score: 0,
      comment: 'judge 调用失败：judge unavailable',
    })
  })
})
