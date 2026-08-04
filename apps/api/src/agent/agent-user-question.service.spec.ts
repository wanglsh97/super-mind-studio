import type { AgentUserQuestion } from '@supermind/sdk'
import { BadRequestException } from '@nestjs/common'

import type { AgentRunEventBus } from './agent-run-event-bus'
import type { AgentRunQuestionEventBridge } from './agent-run-question-event-bridge'
import { AgentUserQuestionService } from './agent-user-question.service'
import type { AgentUserQuestionRepository } from './agent-user-question.repository'

function setup() {
  let created: AgentUserQuestion | undefined
  const repository = {
    createPending: jest.fn(async (input) => {
      created = {
        id: input.id,
        runId: input.runId,
        status: 'pending',
        questions: input.questions,
        createdAt: '2026-08-04T00:00:00.000Z',
        settledAt: null,
      }
      return {
        question: created,
        event: {
          type: 'user-question-asked',
          runId: input.runId,
          sequence: 7,
          question: created,
        },
      }
    }),
    findPendingForThreadOwner: jest.fn(),
    findForOwner: jest.fn(async () => created ?? null),
    answer: jest.fn(async (_questionId, _userId, answers) => ({
      question: { ...created!, status: 'answered', settledAt: '2026-08-04T00:01:00.000Z' },
      event: {
        type: 'user-question-answered',
        runId: created!.runId,
        sequence: 8,
        questionId: created!.id,
        answers,
      },
      settledNow: true,
    })),
    skip: jest.fn(async () => ({
      question: { ...created!, status: 'skipped', settledAt: '2026-08-04T00:01:00.000Z' },
      event: {
        type: 'user-question-skipped',
        runId: created!.runId,
        sequence: 8,
        questionId: created!.id,
      },
      settledNow: true,
    })),
    cancelPendingForRun: jest.fn().mockResolvedValue(1),
  } as unknown as jest.Mocked<AgentUserQuestionRepository>
  const bus = { publish: jest.fn() } as unknown as jest.Mocked<AgentRunEventBus>
  const bridge = {
    flush: jest.fn().mockResolvedValue(undefined),
    advancePast: jest.fn(),
  } as unknown as jest.Mocked<AgentRunQuestionEventBridge>
  return {
    repository,
    bus,
    bridge,
    service: new AgentUserQuestionService(repository, bus, bridge),
    created: () => created,
  }
}

const toolQuestions = [
  {
    header: '人数',
    question: '一共有几个人？',
    options: [
      { label: '一个人', description: '独自出行' },
      { label: '两个人', description: '结伴出行' },
    ],
  },
  {
    header: '偏好',
    question: '喜欢什么体验？',
    multi_select: true,
    options: [
      { label: '历史文化', description: '博物馆和古迹' },
      { label: '美食', description: '本地餐饮' },
    ],
  },
]

describe('AgentUserQuestionService', () => {
  it('waits for an answer and returns labels instead of internal UUIDs to the model', async () => {
    const { service, repository, bridge, created } = setup()
    const pending = service.ask({
      runId: 'run-1',
      userId: 'user-1',
      toolCallId: 'call-1',
      questions: toolQuestions,
      signal: new AbortController().signal,
    })
    await waitUntil(() => created() !== undefined)
    const question = created()!
    const answers = [
      {
        questionId: question.questions[0]!.id,
        selectedOptionIds: [question.questions[0]!.options[1]!.id],
      },
      {
        questionId: question.questions[1]!.id,
        selectedOptionIds: question.questions[1]!.options.map((option) => option.id),
      },
    ]

    await service.answer(question.id, 'user-1', answers)
    const result = await pending

    expect(result.content).toContain('"一共有几个人？"=["两个人"]')
    expect(result.content).toContain('"喜欢什么体验？"=["历史文化","美食"]')
    for (const item of question.questions) {
      expect(result.content).not.toContain(item.id)
      for (const option of item.options) expect(result.content).not.toContain(option.id)
    }
    expect(repository.answer).toHaveBeenCalledWith(question.id, 'user-1', answers)
    expect(bridge.advancePast).toHaveBeenCalledWith('run-1', 8)
  })

  it('accepts Other exclusively and exposes its trimmed text to the model', async () => {
    const { service, created } = setup()
    const pending = service.ask({
      runId: 'run-2',
      userId: 'user-1',
      toolCallId: 'call-2',
      questions: [toolQuestions[0]!],
      signal: new AbortController().signal,
    })
    await waitUntil(() => created() !== undefined)
    const question = created()!

    await service.answer(question.id, 'user-1', [
      {
        questionId: question.questions[0]!.id,
        selectedOptionIds: [],
        customText: '  两位成人和一名儿童  ',
      },
    ])

    await expect(pending).resolves.toMatchObject({
      content: expect.stringContaining('"一共有几个人？"=["Other: 两位成人和一名儿童"]'),
    })
  })

  it('rejects foreign option IDs and fixed-option plus Other combinations before settlement', async () => {
    const { service, repository, created } = setup()
    void service
      .ask({
        runId: 'run-3',
        userId: 'user-1',
        toolCallId: 'call-3',
        questions: [toolQuestions[0]!],
        signal: new AbortController().signal,
      })
      .catch(() => undefined)
    await waitUntil(() => created() !== undefined)
    const question = created()!

    await expect(
      service.answer(question.id, 'user-1', [
        {
          questionId: question.questions[0]!.id,
          selectedOptionIds: ['00000000-0000-4000-8000-000000000999'],
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      service.answer(question.id, 'user-1', [
        {
          questionId: question.questions[0]!.id,
          selectedOptionIds: [question.questions[0]!.options[0]!.id],
          customText: '其他',
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(repository.answer).not.toHaveBeenCalled()
  })

  it('cancels the durable pending batch when the run signal aborts', async () => {
    const { service, repository, created } = setup()
    const controller = new AbortController()
    const pending = service.ask({
      runId: 'run-4',
      userId: 'user-1',
      toolCallId: 'call-4',
      questions: [toolQuestions[0]!],
      signal: controller.signal,
    })
    await waitUntil(() => created() !== undefined)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: 'AGENT_TOOL_ABORTED' })
    expect(repository.cancelPendingForRun).toHaveBeenCalledWith('run-4')
  })

  it('rejects duplicate question text before persistence', async () => {
    const { service, repository } = setup()
    await expect(
      service.ask({
        runId: 'run-5',
        userId: 'user-1',
        toolCallId: 'call-5',
        questions: [toolQuestions[0]!, { ...toolQuestions[0]!, header: '同行' }],
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_ASK_USER_QUESTION' })
    expect(repository.createPending).not.toHaveBeenCalled()
  })
})

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20 && !predicate(); index += 1) await Promise.resolve()
  if (!predicate()) throw new Error('condition was not reached')
}
