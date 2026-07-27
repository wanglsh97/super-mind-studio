'use client'

import { AIGatewayTimeoutError, createAIGatewayClient } from '@supermind/sdk'
import type { ImageModelAlias, ImageTask, ModelSummary } from '@supermind/sdk'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import {
  createImageRequest,
  enabledImageModels,
  IMAGE_SIZE_OPTIONS,
  imageResultItems,
  maxImageCount,
} from './image-form'
import {
  IMAGE_HISTORY_KEY,
  type ImageHistoryEntry,
  readImageHistory,
  upsertImageHistory,
} from './image-history'
import { ProtectedUserPage } from '../../components/protected-user-page'
import { useAuthenticationFailure } from '../../components/use-authentication-failure'

const client = createAIGatewayClient()
const examples = ['雨后江南古镇，水墨画风格', 'A tiny astronaut tending flowers on Mars']
type PageStatus = 'idle' | 'submitting' | 'polling' | 'cancelled' | 'timeout' | 'error'

export default function ImagePage() {
  return (
    <ProtectedUserPage>
      <ImageContent />
    </ProtectedUserPage>
  )
}

function ImageContent() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [models, setModels] = useState<ModelSummary[]>([])
  const [model, setModel] = useState<ImageModelAlias>('wanxiang')
  const [prompt, setPrompt] = useState('')
  const [size, setSize] = useState(IMAGE_SIZE_OPTIONS.wanxiang[0]!.value)
  const [count, setCount] = useState(1)
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelError, setModelError] = useState('')
  const [task, setTask] = useState<ImageTask | null>(null)
  const [pageStatus, setPageStatus] = useState<PageStatus>('idle')
  const [taskError, setTaskError] = useState('')
  const [submittedPrompt, setSubmittedPrompt] = useState('')
  const [history, setHistory] = useState<ImageHistoryEntry[]>([])
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    let active = true
    void client.models
      .list()
      .then((summaries) => {
        if (!active) return
        const enabled = enabledImageModels(summaries)
        setModels(enabled)
        const first = enabled[0]
        if (first && (first.alias === 'wanxiang' || first.alias === 'cogview')) {
          setModel(first.alias)
          setSize(IMAGE_SIZE_OPTIONS[first.alias][0]!.value)
        }
      })
      .catch(() => {
        if (active) setModelError('图片模型加载失败，请稍后刷新')
      })
      .finally(() => {
        if (active) setLoadingModels(false)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    setHistory(readImageHistory(localStorage.getItem(IMAGE_HISTORY_KEY)))
  }, [])

  useEffect(() => {
    if (!task || !submittedPrompt) return
    setHistory((current) => {
      const next = upsertImageHistory(current, {
        prompt: submittedPrompt,
        savedAt: new Date().toISOString(),
        task,
      })
      try {
        localStorage.setItem(IMAGE_HISTORY_KEY, JSON.stringify(next))
      } catch {
        // Storage can be unavailable or full; the active task remains usable in memory.
      }
      return next
    })
  }, [submittedPrompt, task])

  function changeModel(next: ImageModelAlias) {
    setModel(next)
    setSize(IMAGE_SIZE_OPTIONS[next][0]!.value)
    setCount((current) => Math.min(current, maxImageCount(next)))
  }

  const available = models.length > 0
  const active = pageStatus === 'submitting' || pageStatus === 'polling'
  const results = task ? imageResultItems(task, client.images.downloadUrl) : []

  async function submit() {
    if (active || !available) return
    const request = createImageRequest({ model, prompt, size, count })
    const controller = new AbortController()
    activeRequest.current = controller
    setTask(null)
    setSubmittedPrompt(request.prompt)
    setTaskError('')
    setPageStatus('submitting')
    try {
      const created = await client.images.create(request, { signal: controller.signal })
      setTask(created)
      if (created.status === 'succeeded' || created.status === 'failed') {
        setPageStatus('idle')
        return
      }
      setPageStatus('polling')
      const completed = await client.images.wait(created.taskId, {
        signal: controller.signal,
        timeoutMs: 120_000,
        onUpdate: setTask,
      })
      setTask(completed)
      setPageStatus('idle')
    } catch (error) {
      if (controller.signal.aborted) {
        setPageStatus('cancelled')
      } else if (handleAuthenticationFailure(error)) {
        setPageStatus('idle')
      } else if (error instanceof AIGatewayTimeoutError) {
        setPageStatus('timeout')
      } else {
        setPageStatus('error')
        setTaskError(error instanceof Error ? error.message : '图片任务处理失败')
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  function cancelPolling() {
    activeRequest.current?.abort()
  }

  return (
    <main className="relative overflow-hidden px-5 py-10 sm:px-8 sm:py-16 lg:px-12">
      <div className="pointer-events-none absolute top-12 -right-28 size-80 rounded-full bg-[#8b7cff]/14 blur-[75px]" />
      <div className="mx-auto max-w-6xl">
        <header className="max-w-3xl">
          <p className="liquid-label flex items-center gap-3">
            <span className="h-px w-8 bg-linear-to-r from-[#8b7cff] to-[#ef85c7]" />
            Image studio
          </p>
          <h1 className="mt-5 font-display text-[clamp(3rem,6vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.06em]">
            用一句描述，
            <br />
            <span className="bg-linear-to-r from-[#8b7cff] to-[#ef85c7] bg-clip-text text-transparent">
              让画面浮出水面。
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-ink-muted">
            描述主体、环境与风格，选择已启用的模型和尺寸，然后等待作品生成。
          </p>
        </header>

        <section className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
            className="liquid-glass rounded-[2rem] p-5 sm:p-8"
          >
            <label className="block text-sm font-semibold" htmlFor="image-prompt">
              Prompt
            </label>
            <textarea
              id="image-prompt"
              value={prompt}
              disabled={active}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={4000}
              rows={8}
              placeholder="描述主体、环境、构图、光线和风格…"
              className="relative z-1 mt-3 w-full resize-y rounded-2xl border border-white/80 bg-white/45 p-5 text-sm leading-7 outline-none shadow-[inset_0_1px_2px_rgb(70_94_130/0.06)] transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand/35 focus:shadow-[0_0_0_4px_rgb(39_100_255/0.06)] dark:border-white/10 dark:bg-white/5"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={active}
                  onClick={() => setPrompt(example)}
                  className="liquid-glass-soft relative z-1 rounded-full px-3.5 py-2 text-left text-xs text-ink-muted transition-[color,transform] hover:-translate-y-0.5 hover:text-brand dark:border-white/10"
                >
                  {example}
                </button>
              ))}
            </div>

            {modelError && (
              <p role="alert" className="mt-4 text-sm text-rose-600">
                {modelError}
              </p>
            )}
            {!loadingModels && !modelError && !available && (
              <p role="status" className="mt-4 text-sm text-amber-700 dark:text-amber-300">
                当前没有已启用的图片模型。
              </p>
            )}

            {active ? (
              <button
                type="button"
                onClick={cancelPolling}
                className="relative z-1 mt-6 min-h-12 w-full rounded-2xl border border-rose-300/70 bg-white/45 px-5 font-semibold text-rose-600"
              >
                停止等待
              </button>
            ) : (
              <button
                type="submit"
                disabled={!prompt.trim() || !available}
                className="liquid-button relative z-1 mt-6 min-h-12 w-full rounded-2xl px-5 font-semibold transition-[transform,box-shadow] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40 disabled:transform-none"
              >
                {loadingModels ? '加载模型中…' : '生成图片'}
              </button>
            )}

            <TaskStatus task={task} pageStatus={pageStatus} error={taskError} />
          </form>

          <aside className="liquid-glass-soft h-fit rounded-[2rem] p-5 sm:p-7">
            <h2 className="font-semibold">生成设置</h2>
            <div className="mt-5 space-y-5">
              <Field label="模型">
                <select
                  value={model}
                  disabled={!available || active}
                  onChange={(event) => changeModel(event.target.value as ImageModelAlias)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-white/80 bg-white/55 px-3 outline-none focus:border-brand/30 dark:border-white/10 dark:bg-slate-900"
                >
                  {models.map((item) => (
                    <option key={item.alias} value={item.alias}>
                      {item.displayName}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="图片尺寸">
                <select
                  value={size}
                  disabled={!available || active}
                  onChange={(event) => setSize(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-xl border border-white/80 bg-white/55 px-3 outline-none focus:border-brand/30 dark:border-white/10 dark:bg-slate-900"
                >
                  {IMAGE_SIZE_OPTIONS[model].map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="生成数量">
                <select
                  value={count}
                  disabled={!available || active}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className="mt-2 min-h-11 w-full rounded-xl border border-white/80 bg-white/55 px-3 outline-none focus:border-brand/30 dark:border-white/10 dark:bg-slate-900"
                >
                  {Array.from({ length: maxImageCount(model) }, (_, index) => index + 1).map(
                    (value) => (
                      <option key={value} value={value}>
                        {value} 张
                      </option>
                    ),
                  )}
                </select>
              </Field>
            </div>
            <p className="mt-6 rounded-2xl border border-[#8b7cff]/12 bg-[#8b7cff]/7 p-4 text-xs leading-6 text-ink-muted dark:bg-violet-950/30 dark:text-violet-200">
              V1 用于技术流程验证，正式公开真实文生图前仍需补充独立的输入与图片内容审核。
            </p>
          </aside>
        </section>

        {results.length > 0 && (
          <section className="mt-7" aria-labelledby="image-results-title">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="liquid-label">RESULTS</p>
                <h2 id="image-results-title" className="mt-2 text-2xl font-semibold">
                  生成结果
                </h2>
              </div>
              <p className="text-sm text-slate-500">{results.length} 张</p>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {results.map((result) => (
                <article
                  key={result.index}
                  className="liquid-glass overflow-hidden rounded-[1.6rem]"
                >
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block bg-slate-100 dark:bg-slate-900"
                    aria-label={`预览第 ${result.index + 1} 张图片`}
                  >
                    <img
                      src={result.url}
                      alt={`生成结果 ${result.index + 1}`}
                      className="aspect-square w-full object-contain"
                    />
                  </a>
                  <footer className="flex items-center justify-between gap-3 p-4 text-sm">
                    <span className="text-slate-500">
                      {result.width && result.height
                        ? `${result.width} × ${result.height}`
                        : `图片 ${result.index + 1}`}
                    </span>
                    <a
                      href={result.url}
                      download
                      className="liquid-glass-soft relative z-1 rounded-xl px-3 py-2 font-semibold"
                    >
                      下载
                    </a>
                  </footer>
                </article>
              ))}
            </div>
          </section>
        )}

        {history.length > 0 && (
          <section className="mt-10" aria-labelledby="image-history-title">
            <h2 id="image-history-title" className="text-2xl font-semibold">
              最近生成
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {history.map((entry) => {
                const thumbnail = imageResultItems(entry.task, client.images.downloadUrl)[0]
                return (
                  <article
                    key={entry.task.taskId}
                    className="liquid-glass-soft overflow-hidden rounded-[1.4rem]"
                  >
                    {thumbnail ? (
                      <img
                        src={thumbnail.url}
                        alt="历史生成缩略图"
                        className="aspect-square w-full bg-slate-100 object-cover dark:bg-slate-900"
                      />
                    ) : (
                      <div className="grid aspect-square place-items-center bg-slate-100 text-xs text-slate-500 dark:bg-slate-900">
                        {entry.task.status}
                      </div>
                    )}
                    <div className="p-3">
                      <p className="line-clamp-2 text-xs leading-5">{entry.prompt}</p>
                      <p className="mt-2 text-[0.68rem] text-slate-400">{entry.task.model}</p>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

function TaskStatus({
  task,
  pageStatus,
  error,
}: {
  task: ImageTask | null
  pageStatus: PageStatus
  error: string
}) {
  if (!task && pageStatus === 'idle') return null
  const status =
    pageStatus === 'submitting'
      ? '正在提交任务…'
      : pageStatus === 'cancelled'
        ? '已停止本页轮询，服务端任务可能仍在运行。'
        : pageStatus === 'timeout'
          ? '等待超时，服务端任务状态未被修改，可稍后继续查询。'
          : pageStatus === 'error'
            ? error
            : task?.status === 'pending'
              ? '任务已提交，等待模型处理…'
              : task?.status === 'running'
                ? '模型正在生成图片…'
                : task?.status === 'succeeded'
                  ? '图片生成完成。'
                  : task?.error?.message || '图片生成失败。'
  return (
    <section
      aria-live="polite"
      className="relative z-1 mt-5 rounded-2xl border border-white/70 bg-white/38 p-4 dark:bg-white/5"
    >
      <p className="text-sm font-semibold">{status}</p>
      {task && <p className="mt-2 break-all text-xs text-slate-500">Task ID：{task.taskId}</p>}
    </section>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-ink-secondary dark:text-slate-200">
      {label}
      {children}
    </label>
  )
}
