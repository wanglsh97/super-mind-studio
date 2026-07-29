'use client'

import type { AgentThinkingEffort, TextModelAlias, TextModelId, Usage } from '@supermind/sdk'
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
} from '@assistant-ui/react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { CHAT_PROVIDER_BRANDING } from '../config/chat-provider-branding'
import { cn } from '../lib/cn'
import { AssistantMarkdown } from '../app/chat/assistant-markdown'

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3'

export function AgentPageShell({
  children,
  ...props
}: Readonly<{ children?: ReactNode } & React.HTMLAttributes<HTMLElement>>) {
  return (
    <main
      {...props}
      className={cn(
        'relative flex h-[calc(100dvh-4.5rem)] min-h-[34rem] flex-col overflow-hidden p-[clamp(0.65rem,2vw,1.4rem)] md:h-dvh md:p-[clamp(0.8rem,2vw,1.4rem)]',
        props.className,
      )}
    >
      {children}
    </main>
  )
}

export function AgentConsolePanel({
  children,
  label,
}: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <section
      aria-label={label}
      className="liquid-glass relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[1.8rem] md:rounded-[2.2rem]"
    >
      {children}
    </section>
  )
}

export function AgentThreadRoot({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ThreadPrimitive.Root className="relative flex h-full min-h-0 flex-col">
      {children}
    </ThreadPrimitive.Root>
  )
}

export function AgentThreadViewport({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto scroll-pb-52">
      <div className="mx-auto w-full max-w-[58rem] px-3.5 pt-6 pb-4 md:px-6 md:pt-9.5 md:pb-6">
        {children}
      </div>
    </ThreadPrimitive.Viewport>
  )
}

export function AgentScrollToBottom() {
  return (
    <ThreadPrimitive.ScrollToBottom
      aria-label="滚动到底部"
      className={cn(
        'absolute right-3 bottom-48 z-5 grid size-9 place-items-center rounded-full border border-line bg-surface-card text-brand shadow-[0_8px_24px_rgb(46_32_76/0.12)] dark:bg-surface-muted dark:text-brand-light',
        focusRing,
      )}
    >
      ↓
    </ThreadPrimitive.ScrollToBottom>
  )
}

export function AgentComposerDock({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="sticky bottom-0 z-3 bg-linear-to-b from-transparent via-white/70 via-28% to-white/80 px-3 pt-7 pb-2.5 backdrop-blur-[2px] md:px-4.5 md:pb-2.5 dark:via-surface-raised/90 dark:to-surface-raised/96">
      {children}
    </div>
  )
}

export function AgentComposerRoot({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root
        className={cn(
          'liquid-glass relative mx-auto w-full max-w-[58rem] rounded-[1.4rem] p-2.5 pb-3 transition-[border-color,box-shadow,transform] focus-within:border-brand/35 focus-within:shadow-[0_18px_48px_rgb(39_100_255/0.16)]',
        )}
      >
        {children}
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  )
}

export function AgentComposerInput(
  props: Readonly<{ placeholder: string; disabled?: boolean; maxLength?: number }>,
) {
  return (
    <ComposerPrimitive.Input
      aria-label={props.placeholder}
      rows={1}
      maxLength={props.maxLength}
      disabled={props.disabled}
      placeholder={props.placeholder}
      className="w-full max-h-40 min-h-12 resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none placeholder:text-ink-subtle"
    />
  )
}

export function AgentComposerFooter({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line-soft pt-2 dark:border-line">
      {children}
    </div>
  )
}

export function AgentComposerActions({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex min-w-0 items-center gap-0.5 md:gap-1">{children}</div>
}

export function AgentComposerAction({
  children,
  onClick,
  href,
  expanded,
}: Readonly<{
  children: ReactNode
  onClick?: () => void
  href?: string
  expanded?: boolean
}>) {
  const className = cn(
    'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-[0.66rem] font-semibold whitespace-nowrap text-ink-muted transition-[background,color] hover:bg-brand-subtle hover:text-brand-hover dark:hover:bg-brand-subtle dark:hover:text-brand-light',
    focusRing,
  )
  if (href) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-expanded={expanded}>
      {children}
    </button>
  )
}

export function AgentComposerSubmitGroup({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex min-w-0 items-center gap-1.5 md:gap-2">{children}</div>
}

export function AgentSendButton({
  children,
  disabled,
  cancel,
  onClick,
}: Readonly<{
  children?: ReactNode
  disabled?: boolean
  cancel?: boolean
  onClick?: () => void
}>) {
  const base = cn(
    'liquid-button grid place-items-center rounded-full text-white transition-[background,transform,box-shadow] hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:transform-none',
    focusRing,
  )
  if (cancel) {
    return (
      <ComposerPrimitive.Cancel
        className={cn(
          base,
          'h-9 w-auto rounded-full px-3 text-[0.7rem] font-bold dark:bg-surface-inset dark:text-ink',
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </ComposerPrimitive.Cancel>
    )
  }
  return (
    <ComposerPrimitive.Send
      className={cn(base, 'size-9 shrink-0')}
      disabled={disabled}
      aria-label="发送消息"
    >
      {children ?? (
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="size-5 fill-none stroke-current stroke-2"
        >
          <path d="M10 15V5m0 0L6 9m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </ComposerPrimitive.Send>
  )
}

export function AgentSendButtonDisabled() {
  return (
    <button
      type="button"
      className="grid size-9 shrink-0 place-items-center rounded-full bg-brand text-white opacity-40"
      disabled
      aria-label="发送消息"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="size-5 fill-none stroke-current stroke-2"
      >
        <path d="M10 15V5m0 0L6 9m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

export function AgentPrivacyNote() {
  return (
    <p className="mx-auto mt-2 w-full max-w-[58rem] text-center text-[0.62rem] text-ink-subtle">
      内容由 AI 生成，请仔细甄别
    </p>
  )
}

export function AgentComposerError({ message }: Readonly<{ message: string }>) {
  return (
    <p role="alert" className="mx-2.5 mt-2 text-[0.7rem] text-danger">
      {message}
    </p>
  )
}

export function AgentActiveRunHint({ message }: Readonly<{ message: string }>) {
  return (
    <p className="mx-auto mb-2 w-full max-w-[58rem] text-center text-[0.78rem] leading-snug text-warning dark:text-warning-light">
      {message}
    </p>
  )
}

export function AgentInterruptedBanner({ message }: Readonly<{ message: string }>) {
  return (
    <p
      role="status"
      className="mx-auto mt-3 w-full max-w-[58rem] rounded-lg border border-warning/35 bg-warning/12 px-3.5 py-2 text-[0.8rem] leading-snug text-warning dark:text-warning-light"
    >
      {message}
    </p>
  )
}

export function ParameterSliders({
  temperature,
  topP,
  maxTokens,
  onTemperatureChange,
  onTopPChange,
  onMaxTokensChange,
}: Readonly<{
  temperature: number
  topP: number
  maxTokens: number
  onTemperatureChange: (value: number) => void
  onTopPChange: (value: number) => void
  onMaxTokensChange: (value: number) => void
}>) {
  return (
    <section
      aria-label="生成参数"
      className="mx-1 mt-2 grid grid-cols-1 gap-2.5 rounded-xl bg-surface-muted p-3 md:grid-cols-3 md:gap-4"
    >
      <ParameterSlider
        label="Temperature"
        value={temperature}
        min={0}
        max={2}
        step={0.1}
        onChange={onTemperatureChange}
      />
      <ParameterSlider
        label="Top P"
        value={topP}
        min={0}
        max={1}
        step={0.05}
        onChange={onTopPChange}
      />
      <ParameterSlider
        label="Max tokens"
        value={maxTokens}
        min={1}
        max={4096}
        step={1}
        onChange={onMaxTokensChange}
      />
    </section>
  )
}

function ParameterSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: Readonly<{
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}>) {
  return (
    <label>
      <span className="flex justify-between text-[0.62rem] text-ink-muted md:text-[0.68rem]">
        <b>{label}</b>
        <output className="font-mono">{value}</output>
      </span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-brand"
      />
    </label>
  )
}

export function ModelLogo({ alias }: Readonly<{ alias: TextModelAlias }>) {
  const branding = CHAT_PROVIDER_BRANDING[alias]
  const logoClasses: Record<TextModelAlias, string> = {
    kimi: 'border-ink bg-ink text-white italic dark:border-ink dark:bg-ink',
    qwen: 'border-brand-muted bg-surface-card',
    glm: branding.logoUrl ? 'bg-surface-card' : 'border-[#17151e] bg-[#17151e] text-white',
    deepseek: 'border-[#d7e1ff] text-[#5d7cf0]',
  }

  return (
    <span
      className={cn(
        'grid size-[1.3rem] shrink-0 place-items-center overflow-hidden rounded-full border border-line text-[0.68rem] font-extrabold leading-none shadow-[0_1px_2px_rgb(46_32_76/0.08)] dark:border-line-soft',
        logoClasses[alias],
        branding.logoUrl && 'bg-cover bg-center bg-no-repeat',
      )}
      style={branding.logoUrl ? { backgroundImage: `url("${branding.logoUrl}")` } : undefined}
      aria-hidden="true"
    >
      {!branding.logoUrl && <span>{branding.fallbackText}</span>}
    </span>
  )
}

export function ModelSelect({
  value,
  options,
  disabled,
  boundHint,
  menuTitle,
  thinkingEffort,
  onThinkingEffortChange,
  onChange,
}: Readonly<{
  value: TextModelId
  options: ReadonlyArray<{ value: TextModelId; label: string; provider: TextModelAlias }>
  disabled: boolean
  boundHint?: boolean
  menuTitle?: string
  thinkingEffort: AgentThinkingEffort
  onThinkingEffortChange: (effort: AgentThinkingEffort) => void
  onChange: (value: TextModelId) => void
}>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const selectedLabel = selected?.label ?? value
  const selectedProvider = selected?.provider ?? 'qwen'

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick)
  }, [open])

  return (
    <div
      className="relative min-w-0"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={
          boundHint
            ? `当前会话模型：${selectedLabel}（切换将新建会话）`
            : `运行模型：${selectedLabel}`
        }
        title={boundHint ? '切换模型将新建会话，当前会话保持不变' : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'liquid-glass-soft flex h-9 min-w-0 items-center gap-2 rounded-xl px-3 text-xs font-bold text-ink-secondary transition-[border-color,background,box-shadow] hover:border-brand/25 focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2 aria-expanded:border-brand/30 aria-expanded:shadow-[0_0_0_2px_rgb(39_100_255/0.08)] md:min-w-[8.5rem]',
          focusRing,
        )}
      >
        <ModelLogo alias={selectedProvider} />
        <span className="min-w-0 flex-1 truncate">{selectedLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn(
            'size-3.5 shrink-0 fill-none stroke-current stroke-[1.6] transition-transform',
            open && 'rotate-180',
          )}
        >
          <path d="m5 6 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="运行模型与思考强度"
          className="liquid-glass absolute right-0 bottom-[calc(100%+0.55rem)] z-10 w-64 overflow-hidden rounded-[1.15rem] p-1.5 shadow-[0_20px_50px_rgb(39_59_112/0.2)] max-md:w-[min(16rem,calc(100vw-2rem))]"
        >
          <p className="px-2.5 py-1 text-[0.58rem] font-bold tracking-widest text-ink-subtle">
            {menuTitle ?? (boundHint ? '切换模型将新建会话' : '运行模型')}
          </p>
          <div role="listbox" aria-label="选择运行模型">
            {options.map((option) => {
              const isSelected = option.value === value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex min-h-9 w-full items-center justify-between rounded-lg px-2.5 text-[0.72rem] font-semibold text-ink-secondary transition-[background,color] hover:bg-brand-subtle hover:text-brand-hover dark:text-ink-dark-muted dark:hover:bg-surface-muted dark:hover:text-brand-light',
                    isSelected &&
                      'bg-brand-muted text-brand-hover dark:bg-[#392d52] dark:text-brand-light',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <ModelLogo alias={option.provider} />
                    <span>{option.label}</span>
                  </span>
                  {isSelected && <span aria-hidden="true">✓</span>}
                </button>
              )
            })}
          </div>
          <div className="mx-1 mt-1.5 border-t border-line/70 pt-2">
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[0.58rem] font-bold tracking-widest text-ink-subtle">
                思考强度
              </span>
              <span className="text-[0.56rem] text-ink-subtle">本次运行</span>
            </div>
            <div
              role="radiogroup"
              aria-label="选择思考强度"
              className="grid grid-cols-3 gap-1 rounded-xl border border-line/70 bg-surface-inset/70 p-1"
            >
              {(
                [
                  { value: 'fast', label: '快速', note: '更快' },
                  { value: 'balanced', label: '均衡', note: '默认' },
                  { value: 'deep', label: '深度', note: '更充分' },
                ] as const
              ).map((option) => {
                const isSelected = option.value === thinkingEffort
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onThinkingEffortChange(option.value)}
                    className={cn(
                      'relative min-w-0 rounded-lg px-1 py-2 text-center transition-[background,color,box-shadow] focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-1',
                      isSelected
                        ? 'bg-[linear-gradient(145deg,rgb(39_100_255/0.14),rgb(139_124_255/0.18))] text-brand-hover shadow-[0_3px_12px_rgb(77_86_220/0.14)] dark:text-brand-light'
                        : 'text-ink-subtle hover:bg-surface/70 hover:text-ink-secondary',
                    )}
                  >
                    <span className="block text-[0.68rem] font-bold">{option.label}</span>
                    <span className="mt-0.5 block text-[0.52rem] leading-none opacity-70">
                      {option.note}
                    </span>
                    {isSelected && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-x-3 bottom-0.5 h-px rounded-full bg-brand/70"
                      />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function AgentEmptyState({
  kicker,
  title,
}: Readonly<{
  kicker: string
  title: string
}>) {
  return (
    <div className="grid min-h-[calc(100dvh-14rem)] place-items-center content-center text-center md:min-h-[calc(100dvh-15rem)]">
      <div
        aria-hidden="true"
        className="liquid-glass grid size-[4.8rem] place-items-center rounded-[1.7rem] shadow-[0_18px_45px_rgb(39_100_255/0.15)]"
      >
        <span className="grid size-8 rotate-45 place-items-center rounded-lg bg-[linear-gradient(135deg,#2764ff,#8b7cff)] font-mono text-[0.55rem] font-black text-white">
          <span className="-rotate-45">AI</span>
        </span>
      </div>
      <p className="mt-5 font-mono text-[0.58rem] font-bold tracking-[0.15em] text-ink-subtle">
        {kicker}
      </p>
      <h2 className="mt-3 text-xl font-bold tracking-tight">{title}</h2>
    </div>
  )
}

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col items-end gap-2 py-4">
      <div className="font-mono text-[0.55rem] font-bold tracking-[0.13em] text-ink-subtle">
        YOU
      </div>
      <div className="max-w-[min(82%,38rem)] rounded-2xl rounded-br-md bg-[linear-gradient(135deg,#2764ff,#4d6ee8)] px-4 py-3 text-[0.87rem] leading-relaxed text-white shadow-[0_12px_30px_rgb(39_100_255/0.16)] max-md:max-w-[92%] dark:bg-surface dark:text-ink">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  )
}

export function AssistantMessage({
  label,
  metadata,
  renderPart,
}: Readonly<{
  label: string
  metadata: ReactNode
  renderPart?: (part: { type: string; text?: string; toolUI?: ReactNode }) => ReactNode | null
}>) {
  return (
    <MessagePrimitive.Root className="group flex gap-4 py-4">
      <div
        aria-hidden="true"
        className="liquid-glass-soft grid size-[2.1rem] shrink-0 rotate-45 place-items-center rounded-lg text-brand dark:text-brand-light"
      >
        <span className="-rotate-45 font-mono text-[0.47rem] font-black">AI</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[0.55rem] font-bold tracking-[0.13em] text-ink-subtle">
          {label}
        </div>
        <div className="mt-2 text-[0.9rem] leading-relaxed text-ink-secondary dark:text-ink-secondary">
          <MessagePrimitive.Parts>
            {({ part }) => {
              if (renderPart) return renderPart(part)
              if (part.type === 'text') return <AssistantMarkdown>{part.text}</AssistantMarkdown>
              return null
            }}
          </MessagePrimitive.Parts>
          <AuiIf condition={({ message }) => message.status?.type === 'running'}>
            <span
              className="ml-1 inline-block h-4 w-1.5 animate-blink bg-brand align-[-0.12rem]"
              aria-label="正在生成"
            />
          </AuiIf>
        </div>
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root
            className="mt-3 border-l-2 border-danger-light pl-3 text-xs text-danger"
            role="alert"
          >
            请求失败：
            <ErrorPrimitive.Message />
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
        <div className="mt-3 flex min-h-7 items-center justify-between gap-4 font-mono text-[0.56rem] text-ink-subtle">
          {metadata}
          <ActionBarPrimitive.Root>
            <ActionBarPrimitive.Copy className="rounded-md px-2 py-1 font-sans text-[0.65rem] opacity-25 transition-[background,color,opacity] group-hover:opacity-100 hover:bg-brand-subtle hover:text-brand-hover focus-visible:opacity-100 dark:hover:bg-brand-subtle dark:hover:text-brand-light">
              复制
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  )
}

export function ChatUsageMetadata({
  usage,
  model,
  requestId,
}: Readonly<{
  usage?: Usage | undefined
  model?: string | undefined
  requestId?: string | undefined
}>) {
  const status = useAuiState(({ message }) => message.status)
  return (
    <p className="break-anywhere">
      {model ?? '模型'} · {status?.type === 'running' ? '生成中' : usageLabel(usage)}
      {usage?.estimatedCostCny ? ` · ¥${usage.estimatedCostCny}` : ''}
      {requestId ? ` · ${requestId}` : ''}
    </p>
  )
}

export function AgentRunMetadata({
  model,
  runStatus,
  totalTokens,
  modelCalls,
  toolCalls,
}: Readonly<{
  model?: string | undefined
  runStatus?: string | null | undefined
  totalTokens?: number | null | undefined
  modelCalls?: number | null | undefined
  toolCalls?: number | null | undefined
}>) {
  const status = useAuiState(({ message }) => message.status)
  const interrupted = runStatus === 'interrupted' || status?.type === 'incomplete'
  return (
    <p>
      {model ?? '模型'}
      {status?.type === 'running'
        ? ' · 生成中'
        : runStatus === 'interrupted'
          ? ' · 已中断'
          : totalTokens != null
            ? ` · ${totalTokens} tokens`
            : ''}
      {modelCalls != null ? ` · 模型 ${modelCalls}` : ''}
      {toolCalls != null ? ` · 工具 ${toolCalls}` : ''}
      {interrupted && runStatus === 'interrupted' ? ' · 未自动重放' : ''}
    </p>
  )
}

export function AgentReasoning({ text }: Readonly<{ text: string }>) {
  return (
    <details className="my-2 rounded-xl border border-dashed border-line px-3 py-2 text-[0.85rem] text-ink-muted dark:border-line-soft">
      <summary className="cursor-pointer">推理过程（可能不完整或不准确）</summary>
      <div className="mt-2 whitespace-pre-wrap">{text}</div>
    </details>
  )
}

export function AgentToolCall({ url }: Readonly<{ url?: string }>) {
  return (
    <div className="my-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-brand-muted/8 px-3 py-2 text-sm dark:border-line-soft">
      <span className="font-mono font-semibold">web_fetch</span>
      {url ? <span className="break-all text-[0.8rem] text-ink-subtle">{url}</span> : null}
      <span className="rounded-lg bg-ink-subtle/16 px-1.5 py-0.5 text-xs">调用中…</span>
    </div>
  )
}

export function AgentToolResult({
  isError,
  status,
  httpStatus,
  summary,
  finalUrl,
}: Readonly<{
  isError?: boolean | undefined
  status?: string | undefined
  httpStatus?: number | undefined
  summary?: string | undefined
  finalUrl?: string | undefined
}>) {
  return (
    <div
      className={cn(
        'my-2 rounded-xl border px-3 py-2 text-sm',
        isError
          ? 'border-[#e3b3b3] bg-[rgb(227_179_179/0.12)]'
          : 'border-line bg-brand-muted/8 dark:border-line-soft',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">web_fetch</span>
        <span
          className={cn(
            'rounded-lg px-1.5 py-0.5 text-xs',
            status === 'failed' || isError ? 'text-[#a63d3d]' : 'text-[#2f7a4d]',
          )}
        >
          {status ?? (isError ? 'failed' : 'succeeded')}
        </span>
        {httpStatus ? (
          <span className="text-[0.8rem] text-ink-subtle">HTTP {httpStatus}</span>
        ) : null}
      </div>
      {summary ? <p className="mt-1.5">{summary}</p> : null}
      {finalUrl ? (
        <a
          className="mt-1 inline-block break-all text-[0.8rem] text-brand hover:underline"
          href={finalUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          {finalUrl}
        </a>
      ) : null}
    </div>
  )
}

function usageLabel(usage?: Usage): string {
  if (!usage) return '等待用量'
  return usage.usageUnknown ? 'Token 未知' : `${usage.totalTokens} tokens`
}

export function NewThreadButton({ onNewThread }: Readonly<{ onNewThread: () => void }>) {
  const hasMessages = useAuiState(({ thread }) => thread.messages.length > 0)
  if (!hasMessages) return null
  return <AgentComposerAction onClick={onNewThread}>新会话</AgentComposerAction>
}

export function ResetThreadButton() {
  const api = useAui()
  const hasMessages = useAuiState(({ thread }) => thread.messages.length > 0)
  if (!hasMessages) return null
  return <AgentComposerAction onClick={() => api.thread().reset()}>新会话</AgentComposerAction>
}
