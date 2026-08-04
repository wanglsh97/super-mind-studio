import { AgentToolExecutionError } from './agent-tool'

import type { AgentToolDefinition } from './agent-tool'

export const ASK_USER_QUESTION_DESCRIPTION = [
  'Use this tool when you need to ask the user structured questions during execution.',
  'This allows you to:',
  '1. Gather user preferences or requirements.',
  '2. Clarify ambiguous instructions.',
  '3. Get decisions on implementation choices as you work.',
  '4. Offer choices to the user about what direction to take.',
  '',
  'Usage notes:',
  '- Users can always select "Other" to provide custom text input, so do not add an "Other" option yourself.',
  '- Set multi_select to true when the user may select more than one answer.',
  '- If you recommend a specific option, put it first and append "(Recommended)" to its label.',
  '- Ask one to four questions at a time, then wait for the user to answer or skip before continuing.',
].join('\n')

/**
 * 内置结构化提问工具。持久化、SSE 与用户回答只作为该工具 await 的内部通道；
 * 模型侧始终只看到一个普通的成功 tool result。
 */
export interface AskUserQuestionWaiter {
  ask(input: {
    runId: string
    userId: string
    toolCallId: string
    questions: AskUserQuestionInput['questions']
    signal: AbortSignal
  }): Promise<{ content: string; summary: string }>
}

export interface AskUserQuestionInput extends Record<string, unknown> {
  questions: Array<{
    header: string
    question: string
    options: Array<{ label: string; description: string }>
    multi_select?: boolean
  }>
}

export const ASK_USER_QUESTION_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['header', 'question', 'options'],
        properties: {
          header: { type: 'string', minLength: 1, maxLength: 12 },
          question: { type: 'string', minLength: 1, maxLength: 500 },
          multi_select: { type: 'boolean' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['label', 'description'],
              properties: {
                label: { type: 'string', minLength: 1, maxLength: 120 },
                description: { type: 'string', minLength: 1, maxLength: 500 },
              },
            },
          },
        },
      },
    },
  },
} as const

export function createAskUserQuestionTool(
  waiter: AskUserQuestionWaiter,
): AgentToolDefinition<AskUserQuestionInput> {
  return {
    name: 'ask_user_question',
    label: '询问用户',
    description: ASK_USER_QUESTION_DESCRIPTION,
    riskLevel: 'read',
    approvalPolicy: 'none',
    parameters: ASK_USER_QUESTION_PARAMETERS,
    async execute(args, context) {
      if (!context.runId || !context.userId) {
        throw new AgentToolExecutionError({
          code: 'ASK_USER_QUESTION_SCOPE_REQUIRED',
          message: 'ask_user_question requires an Agent run scope',
        })
      }
      const result = await waiter.ask({
        runId: context.runId,
        userId: context.userId,
        toolCallId: context.toolCallId,
        questions: args.questions,
        signal: context.signal,
      })
      return { content: result.content, summary: result.summary, isError: false }
    },
  }
}
