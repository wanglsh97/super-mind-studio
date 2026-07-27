'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { OptimizePromptResult, PromptOptimizationMode } from '@supermind/sdk'
import { useState } from 'react'

import { AssistantMarkdown } from '../chat/assistant-markdown'
import { ProtectedUserPage } from '../../components/protected-user-page'
import { useAuthenticationFailure } from '../../components/use-authentication-failure'

const client = createAIGatewayClient()

const modes: Array<{ value: PromptOptimizationMode; title: string; description: string }> = [
  { value: 'expand', title: '扩写', description: '补充背景、细节与表达要求' },
  { value: 'simplify', title: '精简', description: '删除冗余，保留核心意图' },
  { value: 'structure', title: '结构化', description: '整理为角色、任务与约束' },
]

const examples = [
  '帮我写一封项目延期说明邮件',
  'Summarize this product proposal for executives',
  '设计一个适合初学者的 TypeScript 学习计划',
]

export default function PromptPage() {
  return (
    <ProtectedUserPage>
      <PromptContent />
    </ProtectedUserPage>
  )
}

function PromptContent() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<PromptOptimizationMode>('expand')
  const [submittedPrompt, setSubmittedPrompt] = useState('')
  const [submittedMode, setSubmittedMode] = useState<PromptOptimizationMode>('expand')
  const [result, setResult] = useState<OptimizePromptResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function submit(retry = false) {
    const original = retry ? submittedPrompt : prompt.trim()
    const selectedMode = retry ? submittedMode : mode
    if (!original || loading) return
    setLoading(true)
    setError('')
    setResult(null)
    setCopied(false)
    setSubmittedPrompt(original)
    setSubmittedMode(selectedMode)
    try {
      setResult(await client.prompts.optimize({ prompt: original, mode: selectedMode }))
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : 'Prompt 优化失败')
      }
    } finally {
      setLoading(false)
    }
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.optimizedPrompt)
      setCopied(true)
    } catch {
      setError('复制失败，请手动选择结果文本')
    }
  }

  return (
    <main className="relative overflow-hidden px-5 py-10 sm:px-8 sm:py-16 lg:px-12">
      <div className="pointer-events-none absolute top-10 -right-28 size-80 rounded-full bg-[#50d8c3]/12 blur-[70px]" />
      <div className="mx-auto max-w-6xl">
        <header className="max-w-3xl">
          <p className="liquid-label flex items-center gap-3">
            <span className="h-px w-8 bg-linear-to-r from-[#23a6b6] to-[#50d8c3]" />
            Prompt refiner
          </p>
          <h1 className="mt-5 font-display text-[clamp(3rem,6vw,5.5rem)] leading-[0.98] font-semibold tracking-[-0.06em]">
            把模糊的想法，
            <br />
            <span className="bg-linear-to-r from-[#168f9d] to-[#2764ff] bg-clip-text text-transparent">
              磨成清晰的指令。
            </span>
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-ink-muted">
            选择一种整理方式，让草稿保留原意，同时更完整、更简洁或更有结构。
          </p>
        </header>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="liquid-glass mt-10 rounded-[2rem] p-5 sm:p-8"
        >
          <label htmlFor="original-prompt" className="text-sm font-semibold">
            原始 Prompt
          </label>
          <textarea
            id="original-prompt"
            value={prompt}
            disabled={loading}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={4000}
            rows={9}
            placeholder="输入需要优化的 Prompt…"
            className="relative z-1 mt-3 w-full resize-y rounded-2xl border border-white/80 bg-white/45 p-5 text-sm leading-7 outline-none shadow-[inset_0_1px_2px_rgb(70_94_130/0.06)] transition-[border-color,box-shadow] placeholder:text-ink-subtle focus:border-brand/35 focus:shadow-[0_0_0_4px_rgb(39_100_255/0.06)] dark:border-white/10 dark:bg-white/5"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                disabled={loading}
                onClick={() => setPrompt(example)}
                className="liquid-glass-soft relative z-1 rounded-full px-3.5 py-2 text-left text-xs text-ink-muted transition-[color,transform] hover:-translate-y-0.5 hover:text-brand dark:border-white/10"
              >
                {example}
              </button>
            ))}
          </div>

          <fieldset className="mt-7">
            <legend className="text-sm font-semibold">优化模式</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {modes.map((item) => (
                <label
                  key={item.value}
                  className={`relative z-1 cursor-pointer rounded-2xl border p-4 transition-[border-color,background,box-shadow,transform] hover:-translate-y-0.5 ${mode === item.value ? 'border-brand/30 bg-white/72 shadow-[0_10px_30px_rgb(39_100_255/0.1)] dark:bg-brand/10' : 'border-white/70 bg-white/35 dark:border-white/10 dark:bg-white/4'}`}
                >
                  <input
                    type="radio"
                    name="prompt-mode"
                    value={item.value}
                    checked={mode === item.value}
                    disabled={loading}
                    onChange={() => setMode(item.value)}
                    className="sr-only"
                  />
                  <span className="font-semibold">{item.title}</span>
                  <span className="mt-2 block text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {item.description}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="submit"
            disabled={!prompt.trim() || loading}
            className="liquid-button relative z-1 mt-7 min-h-12 w-full rounded-2xl px-5 font-semibold transition-[transform,box-shadow] hover:-translate-y-0.5 disabled:opacity-40 disabled:transform-none"
          >
            {loading ? '正在优化…' : '优化 Prompt'}
          </button>
          {error && (
            <div
              role="alert"
              className="mt-4 flex flex-wrap items-center gap-3 text-sm text-rose-600"
            >
              <p>{error}</p>
              {submittedPrompt && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void submit(true)}
                  className="rounded-lg border border-rose-300 px-3 py-1.5 font-semibold"
                >
                  重试
                </button>
              )}
            </div>
          )}
        </form>

        {result && (
          <section className="mt-7 grid gap-4 lg:grid-cols-2" aria-label="Prompt 优化结果">
            <article className="liquid-glass-soft rounded-[2rem] p-6">
              <p className="text-xs font-bold tracking-[0.16em] text-slate-400">ORIGINAL</p>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{submittedPrompt}</p>
            </article>
            <article className="liquid-glass rounded-[2rem] p-6">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold tracking-[0.16em] text-brand">OPTIMIZED</p>
                <button
                  type="button"
                  onClick={() => void copyResult()}
                  className="liquid-glass-soft relative z-1 rounded-xl px-3 py-1.5 text-xs font-semibold text-brand"
                >
                  {copied ? '已复制' : '复制结果'}
                </button>
              </div>
              <div className="mt-4 text-sm leading-7">
                <AssistantMarkdown>{result.optimizedPrompt}</AssistantMarkdown>
              </div>
              <footer className="mt-6 border-t border-line-soft pt-4 text-xs leading-6 text-ink-muted">
                <p>
                  {result.model} ·{' '}
                  {result.usage.usageUnknown
                    ? 'Token 未知'
                    : `${result.usage.totalTokens ?? 0} tokens`}{' '}
                  ·{' '}
                  {result.usage.estimatedCostCny ? `¥${result.usage.estimatedCostCny}` : '费用未知'}
                </p>
                <p className="break-all">Request ID：{result.requestId}</p>
                <p>Template：{result.templateVersion}</p>
              </footer>
            </article>
          </section>
        )}
      </div>
    </main>
  )
}
