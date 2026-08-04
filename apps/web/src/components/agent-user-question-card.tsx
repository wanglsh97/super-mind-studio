'use client'

import type { AgentUserQuestion, AnswerAgentUserQuestionRequest } from '@supermind/sdk'
import { ArrowLeftIcon, CornerDownLeftIcon, PenLineIcon, XIcon } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  buildAnswerRequest,
  isQuestionAnswered,
  type QuestionCustomSelectionMap,
  type QuestionCustomTextMap,
  type QuestionSelectionMap,
} from '@/utils/agent/agent-user-question-state'
import { cn } from '@/utils/cn'

export function AgentUserQuestionCard({
  question,
  onAnswer,
  onSkip,
}: Readonly<{
  question: AgentUserQuestion
  onAnswer: (input: AnswerAgentUserQuestionRequest) => Promise<void>
  onSkip: () => Promise<void>
}>) {
  const [index, setIndex] = useState(0)
  const [selections, setSelections] = useState<QuestionSelectionMap>({})
  const [customText, setCustomText] = useState<QuestionCustomTextMap>({})
  const [customSelected, setCustomSelected] = useState<QuestionCustomSelectionMap>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const answer = useMemo(
    () => buildAnswerRequest(question, selections, customText, customSelected),
    [customSelected, customText, question, selections],
  )
  const answered = useMemo(
    () =>
      question.questions.map((item) =>
        isQuestionAnswered(item.id, selections, customText, customSelected),
      ),
    [customSelected, customText, question.questions, selections],
  )

  const item = question.questions[index]
  if (!item) return null

  const selected = selections[item.id] ?? []
  const isLast = index === question.questions.length - 1
  const isCurrentValid = answered[index] === true

  const selectOption = (optionId: string) => {
    setError(null)
    setCustomSelected((current) => ({ ...current, [item.id]: false }))
    setSelections((current) => {
      const previous = current[item.id] ?? []
      const next = item.multiSelect
        ? previous.includes(optionId)
          ? previous.filter((id) => id !== optionId)
          : [...previous, optionId]
        : [optionId]
      return { ...current, [item.id]: next }
    })
  }

  const selectOther = () => {
    setError(null)
    setSelections((current) => ({ ...current, [item.id]: [] }))
    setCustomSelected((current) => ({ ...current, [item.id]: true }))
  }

  const next = async () => {
    if (!isCurrentValid || submitting) return
    if (!isLast) {
      setIndex((value) => value + 1)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onAnswer(answer)
    } catch (cause) {
      setError(toErrorMessage(cause, '回答提交失败，请检查后重试。'))
    } finally {
      setSubmitting(false)
    }
  }

  const skip = async () => {
    if (submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await onSkip()
    } catch (cause) {
      setError(toErrorMessage(cause, '暂时无法跳过，请稍后重试。'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section aria-label="Agent 需要你的回答" className="mx-auto w-full max-w-[58rem]">
      <div className="max-h-[calc(100dvh-7rem)] overflow-y-auto overscroll-contain rounded-[1.4rem] border border-line bg-surface-card shadow-[0_8px_24px_rgb(15_23_42/0.06)] dark:border-line-soft dark:shadow-none">
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-medium text-ink-muted">
                {item.header} · {index + 1} / {question.questions.length} ·{' '}
                {item.multiSelect ? '可多选' : '单选'}
              </p>
              <h2 className="mt-1.5 max-w-2xl text-base font-semibold leading-6 tracking-[-0.02em] text-ink dark:text-white sm:text-lg">
                {item.question}
              </h2>
            </div>
            <button
              type="button"
              aria-label="跳过这组问题"
              disabled={submitting}
              onClick={() => void skip()}
              className="grid size-8 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2"
            >
              <XIcon aria-hidden className="size-5" />
            </button>
          </div>

          <div className="mt-3 space-y-0.5">
            {item.options.map((option, optionIndex) => {
              const active = selected.includes(option.id)
              return (
                <div key={option.id} className="group">
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectOption(option.id)}
                    className={cn(
                      'flex min-h-[3.75rem] w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none dark:hover:bg-white/[0.055] dark:focus-visible:bg-white/[0.055]',
                      active ? 'bg-surface-muted dark:bg-white/[0.055]' : 'bg-transparent',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium tabular-nums',
                        active
                          ? 'bg-ink text-surface-card dark:bg-white dark:text-surface'
                          : 'bg-surface-inset text-ink-muted',
                      )}
                    >
                      {optionIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-5 text-ink dark:text-white">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[0.7rem] leading-4 text-ink-muted sm:text-xs">
                        {option.description}
                      </span>
                    </span>
                    <CornerDownLeftIcon
                      aria-hidden
                      className="size-4 shrink-0 text-ink-subtle opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    />
                  </button>
                </div>
              )
            })}
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="mt-2 flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pb-5">
          <div
            className={cn(
              'flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2',
              customSelected[item.id] ? 'bg-surface-muted' : 'bg-transparent',
            )}
          >
            <button
              type="button"
              aria-label="选择其他答案"
              aria-pressed={customSelected[item.id] === true}
              onClick={selectOther}
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2',
                customSelected[item.id]
                  ? 'bg-ink text-surface-card dark:bg-white dark:text-surface'
                  : 'bg-surface-inset text-ink-muted',
              )}
            >
              <PenLineIcon aria-hidden className="size-3.5" />
            </button>
            <label htmlFor={`agent-question-other-${item.id}`} className="min-w-0 flex-1">
              <span className="sr-only">其他答案</span>
              <input
                id={`agent-question-other-${item.id}`}
                value={customText[item.id] ?? ''}
                onFocus={selectOther}
                onChange={(event) => {
                  selectOther()
                  setCustomText((current) => ({ ...current, [item.id]: event.target.value }))
                }}
                placeholder="其他，告诉 Agent 你的想法…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle dark:text-white"
              />
            </label>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            {index > 0 ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setError(null)
                  setIndex((value) => value - 1)
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2"
              >
                <ArrowLeftIcon aria-hidden className="size-4" />
                上一步
              </button>
            ) : null}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void skip()}
              className="min-h-9 rounded-full border border-line px-4 text-sm font-medium text-ink hover:bg-surface-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2 dark:text-white"
            >
              跳过
            </button>
            <button
              type="button"
              disabled={!isCurrentValid || submitting}
              onClick={() => void next()}
              className="min-h-9 rounded-full bg-ink px-5 text-sm font-semibold text-surface-card hover:opacity-85 disabled:bg-surface-inset disabled:text-ink-subtle disabled:opacity-100 focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2 dark:bg-white dark:text-surface dark:disabled:bg-white/10 dark:disabled:text-ink-subtle"
            >
              {submitting ? '正在提交…' : isLast ? '提交' : '下一步'}
            </button>
          </div>
        </footer>
      </div>
    </section>
  )
}

function toErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
