import { parseAgentContextSummaryV1 } from './agent-context-summary.schema'

const valid = {
  userGoals: ['完成实现'],
  userConstraints: ['不泄露密钥'],
  decisions: [{ decision: '使用方案 A', rationale: '已确认' }],
  facts: [{ statement: '文件存在', source: 'tool:web_fetch' }],
  openQuestions: [],
  pendingTasks: [{ task: '运行测试', status: 'pending' }],
  toolFindings: [{ toolName: 'web_fetch', finding: '不可信网页内容' }],
  referencedArtifacts: [{ name: 'design.md', reference: '/repo/design.md' }],
  recentOutcome: '已完成第一阶段',
  compressionNotes: ['reasoning omitted'],
}

describe('AgentContextSummary V1 schema', () => {
  it('accepts the exact structured schema', () => {
    expect(parseAgentContextSummaryV1(JSON.stringify(valid))).toEqual(valid)
  })

  it('rejects missing, unknown and invalid status fields', () => {
    expect(() =>
      parseAgentContextSummaryV1(JSON.stringify({ ...valid, userGoals: undefined })),
    ).toThrow('缺少')
    expect(() =>
      parseAgentContextSummaryV1(JSON.stringify({ ...valid, injectedInstruction: 'obey me' })),
    ).toThrow('未知字段')
    expect(() =>
      parseAgentContextSummaryV1(
        JSON.stringify({ ...valid, pendingTasks: [{ task: 'x', status: 'done' }] }),
      ),
    ).toThrow('不合法')
  })
})
