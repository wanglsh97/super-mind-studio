import {
  extractTrajectory,
  isOrderedSubsequence,
  extractAssistantTextFromDeltas,
} from './extract-run'

import type { AgentStreamEvent } from '@supermind/sdk'

describe('isOrderedSubsequence', () => {
  it('允许额外工具且保持期望顺序时通过', () => {
    expect(isOrderedSubsequence(['web_search', 'web_fetch', 'web_search'], ['web_search', 'web_fetch'])).toBe(
      true,
    )
  })

  it('顺序颠倒失败', () => {
    expect(isOrderedSubsequence(['web_fetch', 'web_search'], ['web_search', 'web_fetch'])).toBe(false)
  })

  it('缺失步骤失败', () => {
    expect(isOrderedSubsequence(['web_search'], ['web_search', 'web_fetch'])).toBe(false)
  })

  it('空期望恒通过', () => {
    expect(isOrderedSubsequence(['shell'], [])).toBe(true)
  })
})

describe('extractTrajectory / text', () => {
  const events = [
    { type: 'tool-call', toolName: 'web_search' },
    { type: 'text-delta', delta: '你好' },
    { type: 'tool-call', toolName: 'web_fetch' },
    { type: 'text-delta', delta: '世界' },
  ] as AgentStreamEvent[]

  it('按 tool-call 顺序提取轨迹', () => {
    expect(extractTrajectory(events)).toEqual(['web_search', 'web_fetch'])
  })

  it('拼接 text-delta', () => {
    expect(extractAssistantTextFromDeltas(events)).toBe('你好世界')
  })
})
