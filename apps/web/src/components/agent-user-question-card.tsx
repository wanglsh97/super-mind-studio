'use client'

import type { AgentUserQuestion, AnswerAgentUserQuestionRequest } from '@supermind/sdk'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ListChecksIcon, PenLineIcon } from 'lucide-react'
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
    <section aria-label="Agent 需要你的回答" className="mx-auto my-5 w-full max-w-3xl px-4">
      <div className="overflow-hidden rounded-[1.35rem] border border-brand/18 bg-surface-card shadow-[0_18px_48px_rgba(23,47,92,0.10)] dark:border-brand/22">
        <header className="border-b border-line-soft bg-[linear-gradient(110deg,rgba(52,111,255,0.09),transparent_52%)] px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand text-white shadow-[0_8px_18px_rgba(52,111,255,0.24)]">
                <ListChecksIcon aria-hidden className="size-[1.05rem]" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-[-0.01em] text-ink dark:text-white">
                  需要你确认
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  回答后，Agent 会带着这些信息继续
                </p>
              </div>
            </div>
            <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-ink-muted">
              {index + 1} / {question.questions.length}
            </span>
          </div>

          <div className="mt-4 grid grid-flow-col gap-1.5" aria-label="问卷进度">
            {question.questions.map((entry, progressIndex) => (
              <span
                key={entry.id}
                className={cn(
                  'h-1 rounded-full transition-colors duration-200 motion-reduce:transition-none',
                  progressIndex < index || answered[progressIndex]
                    ? 'bg-brand'
                    : progressIndex === index
                      ? 'bg-brand/45'
                      : 'bg-line',
                )}
              />
            ))}
          </div>
        </header>

        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-brand/8 px-2 py-1 text-[0.68rem] font-bold tracking-[0.08em] text-brand-hover dark:bg-brand/14 dark:text-brand-light">
              {item.header}
            </span>
            <span className="text-xs text-ink-subtle">
              {item.multiSelect ? '可多选' : '请选择一项'}
            </span>
          </div>
          <h2 className="mt-3 max-w-2xl text-lg font-semibold leading-7 tracking-[-0.02em] text-ink dark:text-white sm:text-xl">
            {item.question}
          </h2>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            {item.options.map((option) => {
              const active = selected.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => selectOption(option.id)}
                  className={cn(
                    'group flex min-h-[5.1rem] items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow,transform] duration-150 motion-reduce:transition-none focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2',
                    active
                      ? 'border-brand/55 bg-brand/[0.075] shadow-[inset_0_0_0_1px_rgba(52,111,255,0.08)] dark:bg-brand/12'
                      : 'border-line bg-surface hover:-translate-y-0.5 hover:border-brand/30 hover:bg-brand/[0.025] dark:bg-white/[0.025] dark:hover:bg-brand/[0.07]',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors',
                      active
                        ? 'border-brand bg-brand text-white'
                        : 'border-line-strong bg-surface-card text-transparent group-hover:border-brand/35 dark:bg-white/[0.04]',
                    )}
                  >
                    <CheckIcon aria-hidden className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink dark:text-white">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-ink-muted">
                      {option.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>

          <div
            className={cn(
              'mt-2.5 flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
              customSelected[item.id]
                ? 'border-brand/55 bg-brand/[0.06] dark:bg-brand/10'
                : 'border-dashed border-line-strong bg-surface/55 dark:bg-white/[0.018]',
            )}
          >
            <button
              type="button"
              aria-label="选择其他答案"
              aria-pressed={customSelected[item.id] === true}
              onClick={selectOther}
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-lg focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2',
                customSelected[item.id] ? 'bg-brand text-white' : 'bg-surface-inset text-ink-muted',
              )}
            >
              <PenLineIcon aria-hidden className="size-4" />
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
                placeholder="其他想法，直接告诉 Agent…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle dark:text-white"
              />
            </label>
          </div>

          {error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft bg-surface/60 px-5 py-3.5 sm:px-6">
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setError(null)
                  setIndex((value) => value - 1)
                }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink-muted transition-colors hover:bg-surface-inset hover:text-ink disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2"
              >
                <ArrowLeftIcon aria-hidden className="size-4" />
                上一步
              </button>
            ) : null}
            <button
              type="button"
              disabled={submitting}
              onClick={() => void skip()}
              className="min-h-9 rounded-lg px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-inset hover:text-ink disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2"
            >
              跳过这组问题
            </button>
          </div>
          <button
            type="button"
            disabled={!isCurrentValid || submitting}
            onClick={() => void next()}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(52,111,255,0.22)] transition-[background-color,transform,box-shadow] hover:-translate-y-0.5 hover:bg-brand-hover hover:shadow-[0_10px_22px_rgba(52,111,255,0.28)] disabled:translate-y-0 disabled:bg-line-strong disabled:shadow-none dark:disabled:bg-white/12 focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-2 motion-reduce:transition-none"
          >
            {submitting ? '正在提交…' : isLast ? '确认并继续' : '下一步'}
            {!submitting ? <ArrowRightIcon aria-hidden className="size-4" /> : null}
          </button>
        </footer>
      </div>
    </section>
  )
}

function toErrorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
