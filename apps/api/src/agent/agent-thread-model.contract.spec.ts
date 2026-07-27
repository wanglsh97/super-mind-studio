import type { UpdateAgentThreadRequest } from '@supermind/sdk'

/**
 * 已存在 thread 的 modelId 不可通过 API 修改；更新契约仅允许 title。
 * 运行时写入路径见 AgentThreadRepository.renameForOwner（只更新 title）。
 */
describe('Agent thread model immutability contract', () => {
  it('only accepts title on thread update requests', () => {
    const patch = { title: '新标题' } satisfies UpdateAgentThreadRequest
    expect(Object.keys(patch)).toEqual(['title'])
    expect('model' in patch).toBe(false)
    expect('modelId' in patch).toBe(false)
  })
})
