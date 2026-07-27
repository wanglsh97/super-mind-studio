'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { ChatCompareSession, ChatEvent, ModelSummary, TextModelId } from '@supermind/sdk'
import Link from 'next/link'
import type { FormEvent } from 'react'
import { useEffect, useReducer, useRef, useState } from 'react'

import { AssistantMarkdown } from '../assistant-markdown'
import type { CompareColumn } from './compare-state'
import { compareReducer, initialCompareState } from './compare-state'
import { ProtectedUserPage } from '../../../components/protected-user-page'
import { useAuthenticationFailure } from '../../../components/use-authentication-failure'

const client = createAIGatewayClient()

export default function ChatComparePage() {
  return (
    <ProtectedUserPage>
      <ChatCompareContent />
    </ProtectedUserPage>
  )
}

function ChatCompareContent() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [prompt, setPrompt] = useState('')
  const [models, setModels] = useState<ModelSummary[]>([])
  const [selected, setSelected] = useState<TextModelId[]>([])
  const [loadError, setLoadError] = useState('')
  const [state, dispatch] = useReducer(compareReducer, initialCompareState)
  const sessionRef = useRef<ChatCompareSession | null>(null)

  useEffect(() => {
    let active = true
    void client.models
      .list()
      .then((items) => {
        if (!active) return
        const chatModels = items.filter(
          (model) => model.enabled && model.capabilities.includes('chat'),
        )
        setModels(chatModels)
        setSelected(chatModels.slice(0, Math.min(3, chatModels.length)).map(({ id }) => id))
      })
      .catch(() => {
        if (active) setLoadError('模型列表加载失败')
      })
    return () => {
      active = false
      sessionRef.current?.cancelAll()
    }
  }, [])

  function toggleModel(model: TextModelId) {
    if (state.active) return
    setSelected((current) =>
      current.includes(model)
        ? current.filter((candidate) => candidate !== model)
        : current.length < 3
          ? [...current, model]
          : current,
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = prompt.trim()
    if (!content || selected.length < 2 || state.active) return
    const session = client.chat.compare({
      models: selected,
      messages: [{ role: 'user', content }],
    })
    sessionRef.current = session
    dispatch({ type: 'start', models: selected })
    for (const run of session.runs) {
      void consumeRun(run.model, run.events)
    }
  }

  async function consumeRun(model: TextModelId, events: AsyncIterable<ChatEvent>) {
    try {
      for await (const event of events) dispatch({ type: 'event', model, event })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (handleAuthenticationFailure(error)) return
      dispatch({
        type: 'fail',
        model,
        message: error instanceof Error ? error.message : '请求失败',
      })
    }
  }

  function stop(model: TextModelId) {
    sessionRef.current?.runs.find((run) => run.model === model)?.cancel()
    dispatch({ type: 'cancel', model })
  }

  function stopAll() {
    sessionRef.current?.cancelAll()
    dispatch({ type: 'cancelAll' })
  }

  return (
    <main className="px-5 py-8 sm:px-8 sm:py-12 lg:px-10">
      <div className="mx-auto max-w-[96rem]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.2em] text-cyan-700 dark:text-cyan-300">
              COMPARE
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">多模型对比</h1>
            <p className="mt-2 text-slate-500">
              每列都是独立请求；失败或停止某一路不会影响其他模型。
            </p>
          </div>
          <Link
            href="/chat"
            className="rounded-full border border-slate-200 px-4 py-2 text-sm dark:border-white/10"
          >
            返回单模型
          </Link>
        </header>

        <form
          onSubmit={submit}
          className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white/75 p-4 dark:border-white/10 dark:bg-white/5"
        >
          <fieldset disabled={state.active}>
            <legend className="text-sm font-semibold">选择 2–3 个模型</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {models.map((model) => (
                <label
                  key={model.id}
                  className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-sm dark:border-white/10"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(model.id)}
                    onChange={() => toggleModel(model.id)}
                  />
                  {model.displayName}
                </label>
              ))}
            </div>
          </fieldset>
          {loadError && (
            <p role="alert" className="text-sm text-rose-600">
              {loadError}
            </p>
          )}
          <div className="flex gap-3">
            <textarea
              value={prompt}
              disabled={state.active}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={4000}
              placeholder="输入同一个问题进行对比"
              className="min-h-24 flex-1 rounded-xl border border-slate-200 bg-transparent p-3 text-sm dark:border-white/10"
            />
            {state.active ? (
              <button
                type="button"
                onClick={stopAll}
                className="self-end rounded-xl border border-rose-300 px-4 py-3 text-sm text-rose-600"
              >
                全部停止
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim() || selected.length < 2}
                className="self-end rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-slate-950"
              >
                开始对比
              </button>
            )}
          </div>
        </form>

        {state.columns.length > 0 && (
          <section
            className={`mt-6 grid gap-4 ${state.columns.length === 2 ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}
          >
            {state.columns.map((column) => (
              <CompareCard
                key={column.model}
                column={column}
                displayName={
                  models.find(({ id }) => id === column.model)?.displayName ?? column.model
                }
                onStop={() => stop(column.model)}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  )
}

function CompareCard({
  column,
  displayName,
  onStop,
}: {
  column: CompareColumn
  displayName: string
  onStop: () => void
}) {
  const active = column.status === 'loading' || column.status === 'streaming'
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white/80 p-5 dark:border-white/10 dark:bg-white/5">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">{displayName}</h2>
          <p className="mt-1 text-xs text-slate-400">{statusLabel(column.status)}</p>
        </div>
        {active && (
          <button
            type="button"
            onClick={onStop}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-white/10"
          >
            停止此列
          </button>
        )}
      </header>
      <div className="mt-5 min-h-56 text-sm leading-7">
        {column.status === 'loading' ? (
          <p className="text-slate-400">正在连接…</p>
        ) : (
          <AssistantMarkdown>{column.content || '暂无内容'}</AssistantMarkdown>
        )}
      </div>
      {column.error && (
        <p role="alert" className="mt-4 text-sm text-rose-600">
          {column.error}
        </p>
      )}
      <footer className="mt-5 border-t border-slate-200 pt-3 text-xs text-slate-400 dark:border-white/10">
        <p>Token：{column.usage?.usageUnknown ? '未知' : (column.usage?.totalTokens ?? '—')}</p>
        <p>费用：{column.usage?.estimatedCostCny ? `¥${column.usage.estimatedCostCny}` : '—'}</p>
        <p className="mt-1 break-all">Request ID：{column.requestId ?? '—'}</p>
      </footer>
    </article>
  )
}

function statusLabel(status: CompareColumn['status']): string {
  return {
    loading: '连接中',
    streaming: '生成中',
    success: '已完成',
    error: '失败',
    cancelled: '已停止',
  }[status]
}
