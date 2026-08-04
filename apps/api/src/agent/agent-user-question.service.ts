import { randomUUID } from 'node:crypto'

import type { AgentUserQuestion, AgentUserQuestionAnswerItem } from '@supermind/sdk'
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { AgentRunEventBus } from './agent-run-event-bus'
import { AgentRunQuestionEventBridge } from './agent-run-question-event-bridge'
import {
  AgentUserQuestionAlreadyPendingError,
  AgentUserQuestionRepository,
} from './agent-user-question.repository'
import { AgentToolExecutionError } from './tools/agent-tool'
import type { AskUserQuestionInput, AskUserQuestionWaiter } from './tools/ask-user-question.tool'

interface ToolResult {
  content: string
  summary: string
}

interface Waiter {
  resolve(value: ToolResult): void
  reject(error: Error): void
  detach(): void
}

@Injectable()
export class AgentUserQuestionService implements AskUserQuestionWaiter {
  private readonly waiters = new Map<string, Waiter>()

  constructor(
    @Inject(AgentUserQuestionRepository)
    private readonly questions: AgentUserQuestionRepository,
    @Inject(AgentRunEventBus) private readonly bus: AgentRunEventBus,
    @Inject(AgentRunQuestionEventBridge)
    private readonly sequenceBridge: AgentRunQuestionEventBridge,
  ) {}

  async ask(input: {
    runId: string
    userId: string
    toolCallId: string
    questions: AskUserQuestionInput['questions']
    signal: AbortSignal
  }): Promise<ToolResult> {
    const questionId = randomUUID()
    const normalizedQuestions = normalizeToolQuestions(input.questions)
    const deferred = createDeferredToolResult()
    const abort = () => {
      void this.questions.cancelPendingForRun(input.runId).finally(() => {
        this.rejectWaiter(questionId, abortedError())
      })
    }
    input.signal.addEventListener('abort', abort, { once: true })
    this.waiters.set(questionId, {
      resolve: deferred.resolve,
      reject: deferred.reject,
      detach: () => input.signal.removeEventListener('abort', abort),
    })

    try {
      await this.sequenceBridge.flush(input.runId)
      const created = await this.questions.createPending({
        id: questionId,
        runId: input.runId,
        userId: input.userId,
        toolCallId: input.toolCallId,
        questions: normalizedQuestions,
      })
      this.sequenceBridge.advancePast(input.runId, created.event.sequence)
      if (input.signal.aborted) {
        await this.questions.cancelPendingForRun(input.runId)
        this.rejectWaiter(questionId, abortedError())
      } else {
        this.bus.publish(input.runId, created.event)
      }
      return await deferred.promise
    } catch (error) {
      this.rejectWaiter(questionId, normalizeAskError(error))
      throw normalizeAskError(error)
    } finally {
      this.removeWaiter(questionId)
    }
  }

  async pendingForThread(threadId: string, userId: string): Promise<AgentUserQuestion | null> {
    return this.questions.findPendingForThreadOwner(threadId, userId)
  }

  async answer(
    questionId: string,
    userId: string,
    answers: AgentUserQuestionAnswerItem[],
  ): Promise<AgentUserQuestion> {
    const question = await this.findQuestionForValidation(questionId, userId)
    const normalizedAnswers = validateAnswers(question, answers)
    await this.sequenceBridge.flush(question.runId)
    const result = await this.questions.answer(questionId, userId, normalizedAnswers)
    if (!result) throw hiddenNotFound()
    if (result.event) {
      this.sequenceBridge.advancePast(result.question.runId, result.event.sequence)
      this.bus.publish(result.question.runId, result.event)
    }
    if (result.settledNow) {
      this.resolveWaiter(questionId, {
        content: renderAnswersForModel(question, normalizedAnswers),
        summary: '用户已回答问题',
      })
    }
    return result.question
  }

  async skip(questionId: string, userId: string): Promise<AgentUserQuestion> {
    const question = await this.findQuestionForValidation(questionId, userId)
    await this.sequenceBridge.flush(question.runId)
    const result = await this.questions.skip(questionId, userId)
    if (!result) throw hiddenNotFound()
    if (result.event) {
      this.sequenceBridge.advancePast(result.question.runId, result.event.sequence)
      this.bus.publish(result.question.runId, result.event)
    }
    if (result.settledNow) {
      this.resolveWaiter(questionId, {
        content:
          'User skipped the questions. Continue with best judgment or ask different questions.',
        summary: '用户跳过问题',
      })
    }
    return result.question
  }

  async cancelForRun(runId: string): Promise<void> {
    await this.questions.cancelPendingForRun(runId)
  }

  private async findQuestionForValidation(
    questionId: string,
    userId: string,
  ): Promise<AgentUserQuestion> {
    const question = await this.questions.findForOwner(questionId, userId)
    if (!question) throw hiddenNotFound()
    return question
  }

  private resolveWaiter(questionId: string, value: ToolResult): void {
    const waiter = this.waiters.get(questionId)
    if (!waiter) return
    waiter.resolve(value)
    this.removeWaiter(questionId)
  }

  private rejectWaiter(questionId: string, error: Error): void {
    const waiter = this.waiters.get(questionId)
    if (!waiter) return
    waiter.reject(error)
    this.removeWaiter(questionId)
  }

  private removeWaiter(questionId: string): void {
    const waiter = this.waiters.get(questionId)
    waiter?.detach()
    this.waiters.delete(questionId)
  }
}

function normalizeToolQuestions(
  input: AskUserQuestionInput['questions'],
): AgentUserQuestion['questions'] {
  if (input.length < 1 || input.length > 4) throw invalidToolInput('问题数量必须为 1 到 4 个')
  const questionTexts = new Set<string>()
  const optionLabels = new Set<string>()
  return input.map((question) => {
    const header = question.header.trim()
    const text = question.question.trim()
    if (!header || header.length > 12) throw invalidToolInput('问题标题长度必须为 1 到 12 个字符')
    if (!text || text.length > 500) throw invalidToolInput('问题题干长度必须为 1 到 500 个字符')
    if (question.options.length < 2 || question.options.length > 4) {
      throw invalidToolInput('每个问题必须包含 2 到 4 个选项')
    }
    const normalizedText = text.toLocaleLowerCase()
    if (questionTexts.has(normalizedText)) throw invalidToolInput('问题题干不得重复')
    questionTexts.add(normalizedText)
    const options = question.options.map((option) => {
      const label = option.label.trim()
      const description = option.description.trim()
      if (!label || label.length > 120) throw invalidToolInput('选项标签长度必须为 1 到 120 个字符')
      if (!description || description.length > 500) {
        throw invalidToolInput('选项说明长度必须为 1 到 500 个字符')
      }
      const normalizedLabel = label.toLocaleLowerCase()
      if (optionLabels.has(normalizedLabel)) throw invalidToolInput('选项标签不得重复')
      optionLabels.add(normalizedLabel)
      return { id: randomUUID(), label, description }
    })
    return {
      id: randomUUID(),
      header,
      question: text,
      options,
      multiSelect: question.multi_select === true,
    }
  })
}

function validateAnswers(
  question: AgentUserQuestion,
  answers: AgentUserQuestionAnswerItem[],
): AgentUserQuestionAnswerItem[] {
  if (question.status !== 'pending') return answers
  if (answers.length !== question.questions.length) throw invalidAnswers('每个问题都必须回答')
  const byQuestionId = new Map(answers.map((answer) => [answer.questionId, answer]))
  if (byQuestionId.size !== question.questions.length) throw invalidAnswers('问题答案不得重复')

  return question.questions.map((item) => {
    const answer = byQuestionId.get(item.id)
    if (!answer) throw invalidAnswers('每个问题都必须回答')
    const selectedOptionIds = [...new Set(answer.selectedOptionIds)]
    if (selectedOptionIds.length !== answer.selectedOptionIds.length) {
      throw invalidAnswers('同一选项不得重复选择')
    }
    const customText = answer.customText?.trim()
    if (customText) {
      if (selectedOptionIds.length > 0) throw invalidAnswers('固定选项与其他答案不能同时提交')
      if (customText.length > 2_000) throw invalidAnswers('其他答案不能超过 2000 个字符')
      return { questionId: item.id, selectedOptionIds: [], customText }
    }
    if (answer.customText !== undefined) throw invalidAnswers('其他答案不能为空')
    if (selectedOptionIds.length === 0) throw invalidAnswers('请选择至少一个选项')
    if (!item.multiSelect && selectedOptionIds.length !== 1) {
      throw invalidAnswers('单选问题只能选择一个选项')
    }
    const allowed = new Set(item.options.map((option) => option.id))
    if (selectedOptionIds.some((optionId) => !allowed.has(optionId))) {
      throw invalidAnswers('选项不属于当前问题')
    }
    return { questionId: item.id, selectedOptionIds }
  })
}

function renderAnswersForModel(
  question: AgentUserQuestion,
  answers: AgentUserQuestionAnswerItem[],
): string {
  const rendered = answers.map((answer) => {
    const item = question.questions.find((candidate) => candidate.id === answer.questionId)
    if (!item) throw invalidAnswers('问题不存在')
    const values = answer.customText
      ? [`Other: ${answer.customText}`]
      : answer.selectedOptionIds.map((optionId) => {
          const option = item.options.find((candidate) => candidate.id === optionId)
          if (!option) throw invalidAnswers('选项不存在')
          return option.label
        })
    return `${JSON.stringify(item.question)}=${JSON.stringify(values)}`
  })
  return `User has answered your questions: ${rendered.join(', ')}. You can now continue with the user's answers in mind.`
}

function createDeferredToolResult(): {
  promise: Promise<ToolResult>
  resolve(value: ToolResult): void
  reject(error: Error): void
} {
  let resolve!: (value: ToolResult) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ToolResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function invalidToolInput(message: string): AgentToolExecutionError {
  return new AgentToolExecutionError({
    code: 'INVALID_ASK_USER_QUESTION',
    message,
    summary: '提问参数无效',
  })
}

function invalidAnswers(message: string): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_QUESTION_ANSWERS',
    message,
    retryable: false,
  })
}

function hiddenNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'AGENT_QUESTION_NOT_FOUND',
    message: '问卷不存在或已失效',
    retryable: false,
  })
}

function abortedError(): AgentToolExecutionError {
  return new AgentToolExecutionError({
    code: 'AGENT_TOOL_ABORTED',
    message: '问卷等待已取消',
    summary: '问卷已取消',
  })
}

function normalizeAskError(error: unknown): Error {
  if (error instanceof AgentToolExecutionError) return error
  if (error instanceof AgentUserQuestionAlreadyPendingError) {
    return new AgentToolExecutionError({
      code: 'AGENT_QUESTION_ALREADY_PENDING',
      message: '当前运行已有待回答问卷',
      summary: '问卷创建失败',
    })
  }
  return error instanceof Error ? error : new Error('问卷创建失败')
}
