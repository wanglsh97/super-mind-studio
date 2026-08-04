import type { AgentUserQuestion, AnswerAgentUserQuestionRequest } from '@supermind/sdk'

export type QuestionSelectionMap = Record<string, string[]>
export type QuestionCustomTextMap = Record<string, string>
export type QuestionCustomSelectionMap = Record<string, boolean>

export function buildAnswerRequest(
  question: AgentUserQuestion,
  selections: QuestionSelectionMap,
  customText: QuestionCustomTextMap,
  customSelected: QuestionCustomSelectionMap,
): AnswerAgentUserQuestionRequest {
  return {
    answers: question.questions.map((entry) => ({
      questionId: entry.id,
      selectedOptionIds: customSelected[entry.id] ? [] : (selections[entry.id] ?? []),
      ...(customSelected[entry.id] ? { customText: (customText[entry.id] ?? '').trim() } : {}),
    })),
  }
}

export function isQuestionAnswered(
  questionId: string,
  selections: QuestionSelectionMap,
  customText: QuestionCustomTextMap,
  customSelected: QuestionCustomSelectionMap,
): boolean {
  if (customSelected[questionId]) return Boolean((customText[questionId] ?? '').trim())
  return (selections[questionId] ?? []).length > 0
}
