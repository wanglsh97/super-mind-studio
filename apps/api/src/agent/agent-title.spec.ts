import { AGENT_DEFAULT_THREAD_TITLE, AGENT_DERIVED_TITLE_MAX_LENGTH } from './agent.constants'
import { deriveAgentThreadTitle } from './agent-title'

describe('deriveAgentThreadTitle', () => {
  it('returns the default title for blank or whitespace-only input', () => {
    expect(deriveAgentThreadTitle('')).toBe(AGENT_DEFAULT_THREAD_TITLE)
    expect(deriveAgentThreadTitle('   \n\t  ')).toBe(AGENT_DEFAULT_THREAD_TITLE)
  })

  it('collapses internal whitespace', () => {
    expect(deriveAgentThreadTitle('  总结\n\n页面  ')).toBe('总结 页面')
  })

  it('uses only the prompt when the first message contains uploaded files', () => {
    expect(
      deriveAgentThreadTitle(
        '[[supermind-files]][{"name":"简历.pdf","path":"/workspace/input/简历.pdf"}][[/supermind-files]]\n分析这份简历',
      ),
    ).toBe('分析这份简历')
  })

  it('does not expose an internal video reference asset id in the title', () => {
    expect(
      deriveAgentThreadTitle(
        '让人物站起来\n\n[当前视频首帧资产ID: da8fb2cc-63c1-4161-92b9-cefc27cc02a0]',
      ),
    ).toBe('让人物站起来')
  })

  it('keeps titles within the derived length limit', () => {
    const short = 'a'.repeat(AGENT_DERIVED_TITLE_MAX_LENGTH)
    expect(deriveAgentThreadTitle(short)).toBe(short)

    const long = 'b'.repeat(AGENT_DERIVED_TITLE_MAX_LENGTH + 10)
    const derived = deriveAgentThreadTitle(long)
    expect(derived.endsWith('…')).toBe(true)
    expect(derived.length).toBe(AGENT_DERIVED_TITLE_MAX_LENGTH + 1)
    expect(derived.slice(0, AGENT_DERIVED_TITLE_MAX_LENGTH)).toBe(
      'b'.repeat(AGENT_DERIVED_TITLE_MAX_LENGTH),
    )
  })
})
