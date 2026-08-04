import { ASK_USER_QUESTION_DESCRIPTION, createAskUserQuestionTool } from './ask-user-question.tool'

describe('ask_user_question tool description', () => {
  const tool = createAskUserQuestionTool({
    ask: async () => ({ content: 'answered', summary: 'answered' }),
  })

  it('explains the main situations where the model should ask the user', () => {
    expect(tool.description).toBe(ASK_USER_QUESTION_DESCRIPTION)
    expect(tool.description).toContain('Gather user preferences or requirements')
    expect(tool.description).toContain('Clarify ambiguous instructions')
    expect(tool.description).toContain('decisions on implementation choices')
    expect(tool.description).toContain('what direction to take')
  })

  it('documents option conventions using the actual tool schema', () => {
    expect(tool.description).toContain('always select "Other"')
    expect(tool.description).toContain('do not add an "Other" option yourself')
    expect(tool.description).toContain('Set multi_select to true')
    expect(tool.description).toContain('append "(Recommended)" to its label')
  })
})
