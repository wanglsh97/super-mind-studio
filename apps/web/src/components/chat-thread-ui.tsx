'use client'

import type { AgentThinkingEffort, TextModelAlias, TextModelId, Usage } from '@supermind/sdk'
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiState,
  useThreadViewport,
} from '@assistant-ui/react'
import { CheckIcon, ChevronRightIcon, CopyIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { CHAT_PROVIDER_BRANDING } from '@/const/branding/chat-provider-branding'
import { AssistantMarkdown } from '@/components/chat/assistant-markdown'
import { AgentRunProgressIndicator } from '@/components/agent-run-progress-indicator'
import type { AgentRunProgressStage } from '@/utils/agent/agent-run-adapter'
import { cn } from '@/utils/cn'

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
        'relative flex h-[calc(100dvh-4.5rem)] min-h-[34rem] flex-col overflow-hidden p-3 pt-14 md:h-dvh md:p-[clamp(0.8rem,2vw,1.4rem)]',
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
      className="agent-console-surface relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
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
  const isAtBottom = useThreadViewport((viewport) => viewport.isAtBottom)

  if (isAtBottom) return null

  return (
    <ThreadPrimitive.ScrollToBottom
      aria-label="滚动到底部"
      className={cn(
        'absolute bottom-48 left-1/2 z-5 grid size-9 -translate-x-1/2 cursor-pointer place-items-center rounded-full border border-line bg-surface-card text-brand dark:bg-surface-muted dark:text-brand-light',
        focusRing,
      )}
    >
      ↓
    </ThreadPrimitive.ScrollToBottom>
  )
}

export function AgentComposerDock({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="sticky bottom-0 z-3 bg-linear-to-b from-transparent via-surface/85 via-28% to-surface px-1 pt-5 pb-2 md:px-4.5 md:pt-7 md:pb-2.5">
      {children}
    </div>
  )
}

export function AgentComposerRoot({ children }: Readonly<{ children: ReactNode }>) {
  const [hasFocus, setHasFocus] = useState(false)

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root
        style={
          hasFocus
            ? {
                borderColor: 'rgb(60 60 67 / 0.58)',
                boxShadow: '0 0 0 1px rgb(60 60 67 / 0.16)',
              }
            : undefined
        }
        onFocusCapture={() => setHasFocus(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setHasFocus(false)
        }}
        className={cn(
          'liquid-glass relative mx-auto w-full max-w-[58rem] rounded-2xl p-2.5 pb-3 transition-[border-color,box-shadow]',
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

export function AgentDictationTranscript() {
  const dictation = useAuiState(({ composer }) => composer.dictation)
  if (!dictation) return null

  return (
    <div
      className="flex items-center gap-2 px-2.5 pb-1 text-xs text-brand"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-current" />
      <span className="font-semibold">正在聆听</span>
      <ComposerPrimitive.DictationTranscript className="min-w-0 truncate text-ink-muted" />
    </div>
  )
}

export function AgentComposerFooter({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex items-center justify-between gap-2 dark:border-line">{children}</div>
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
  return <div className="flex min-w-0 items-center gap-1.5">{children}</div>
}

export function AgentDictationButton({
  disabled,
}: Readonly<{
  disabled?: boolean
}>) {
  const dictationActive = useAuiState(({ composer }) => composer.dictation !== undefined)
  const className = cn(
    'grid size-9 shrink-0 place-items-center rounded-full text-ink-muted transition-[background,color,transform] hover:-translate-y-px hover:bg-brand-subtle hover:text-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:transform-none',
    focusRing,
  )

  if (dictationActive) {
    return (
      <ComposerPrimitive.StopDictation
        className={cn(className, 'bg-brand-subtle text-brand')}
        aria-label="停止语音输入"
        title="停止语音输入"
      >
        <span aria-hidden="true" className="size-3 rounded-[0.2rem] bg-current" />
      </ComposerPrimitive.StopDictation>
    )
  }

  return (
    <ComposerPrimitive.Dictate
      className={className}
      disabled={disabled}
      aria-label="开始语音输入"
      title="开始语音输入"
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current stroke-1.8">
        <rect x="7" y="2.5" width="6" height="9" rx="3" />
        <path d="M4.75 9.25a5.25 5.25 0 0 0 10.5 0M10 14.5v3M7 17.5h6" strokeLinecap="round" />
      </svg>
    </ComposerPrimitive.Dictate>
  )
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
        'grid size-[1.2rem] shrink-0 place-items-center overflow-hidden rounded-full border border-line text-[0.62rem] font-extrabold leading-none dark:border-line-soft',
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
  onChange,
}: Readonly<{
  value: TextModelId
  options: ReadonlyArray<{ value: TextModelId; label: string; provider: TextModelAlias }>
  disabled: boolean
  boundHint?: boolean
  menuTitle?: string
  onChange: (value: TextModelId) => void
}>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)
  const selectedLabel = selected?.label ?? value

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
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-8 max-w-[10rem] items-center gap-1.5 rounded-lg px-2.5 text-[0.7rem] font-semibold text-ink-muted transition-[background,color] hover:bg-surface-inset/45 hover:text-ink-secondary aria-expanded:bg-surface-inset aria-expanded:text-ink-secondary md:min-w-[7.5rem]',
          focusRing,
        )}
      >
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
          role="listbox"
          aria-label="选择运行模型"
          className="liquid-glass absolute right-0 bottom-[calc(100%+0.45rem)] z-10 w-48 overflow-hidden rounded-xl p-1 shadow-[0_14px_34px_rgb(39_59_112/0.16)]"
        >
          <p className="px-2 py-1 text-[0.55rem] font-semibold text-ink-subtle">
            {menuTitle ?? (boundHint ? '切换模型将新建会话' : '运行模型')}
          </p>
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
                  'flex min-h-8 w-full items-center justify-between rounded-lg px-2.5 text-[0.68rem] font-medium text-ink-muted transition-[background,color] hover:bg-surface-inset/45 hover:text-ink-secondary',
                  isSelected && 'text-ink font-semibold',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ModelLogo alias={option.provider} />
                  <span className="truncate">{option.label}</span>
                </span>
                {isSelected && <span aria-hidden="true">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const THINKING_EFFORT_OPTIONS: ReadonlyArray<{
  value: AgentThinkingEffort
  label: string
  note: string
}> = [
  { value: 'fast', label: '快速', note: '更快、更省' },
  { value: 'balanced', label: '均衡', note: '默认' },
  { value: 'deep', label: '深度', note: 'token消耗更高' },
]

export function ThinkingEffortSelect({
  value,
  disabled,
  onChange,
}: Readonly<{
  value: AgentThinkingEffort
  disabled: boolean
  onChange: (effort: AgentThinkingEffort) => void
}>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedLabel =
    THINKING_EFFORT_OPTIONS.find((option) => option.value === value)?.label ?? '均衡'

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
      className="relative"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={`思考强度：${selectedLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex h-8 items-center rounded-lg px-2.5 text-[0.68rem] font-medium text-ink-subtle transition-[background,color] hover:bg-surface-inset/45 hover:text-ink-muted aria-expanded:bg-surface-inset aria-expanded:text-ink-muted',
          focusRing,
        )}
      >
        <span>思考强度：</span>
        <span className="font-semibold text-ink-muted">{selectedLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={cn(
            'size-3 shrink-0 fill-none stroke-current stroke-[1.6] transition-transform',
            open && 'rotate-180',
          )}
        >
          <path d="m5 6 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="选择思考强度"
          className="liquid-glass absolute right-0 bottom-[calc(100%+0.4rem)] z-10 w-40 rounded-lg p-0.5"
        >
          {THINKING_EFFORT_OPTIONS.map((option) => {
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
                  'flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left transition-[background,color] hover:bg-surface-inset/45',
                  isSelected && 'bg-surface-inset/55',
                )}
              >
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 whitespace-nowrap">
                  <span
                    className={cn(
                      'text-[0.66rem] font-semibold text-ink-muted',
                      isSelected && 'text-ink',
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="text-[0.55rem] text-ink-subtle">{option.note}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-3.5 shrink-0 place-items-center text-[0.62rem] font-bold',
                    isSelected ? 'text-brand' : 'text-transparent',
                  )}
                >
                  ✓
                </span>
              </button>
            )
          })}
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
      <div className="liquid-glass-soft max-w-[min(82%,38rem)] rounded-2xl px-4 py-3 text-[0.97rem] leading-7 text-ink-secondary max-md:max-w-[92%] dark:text-ink-secondary">
        <MessagePrimitive.Parts />
      </div>
    </MessagePrimitive.Root>
  )
}

export function AssistantMessage({
  label,
  renderPart,
  runProgress,
}: Readonly<{
  label: string
  metadata: ReactNode
  renderPart?: (part: { type: string; text?: string; toolUI?: ReactNode }) => ReactNode | null
  runProgress?: AgentRunProgressStage | null
}>) {
  const isRunning = useAuiState(({ message }) => message.status?.type === 'running')

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
        <div className="mt-2 text-[0.97rem] leading-7 text-ink dark:text-ink">
          <MessagePrimitive.GroupedParts
            groupBy={groupPartByType({
              reasoning: ['group-agent-activity'],
              'tool-call': ['group-agent-activity'],
            })}
          >
            {({ part, children }) => {
              if (part.type === 'group-agent-activity') {
                return <AgentActivityDisclosure isRunning={isRunning}>{children}</AgentActivityDisclosure>;
              }
              if (renderPart) return renderPart(part);
              if (part.type === 'text') return <AssistantMarkdown>{part.text}</AssistantMarkdown>;
              return null;
            }}
          </MessagePrimitive.GroupedParts>
          {isRunning && runProgress ? <AgentRunProgressIndicator stage={runProgress} /> : null}
          <AuiIf condition={({ message }) => message.status?.type === 'running' && !runProgress}>
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
        {!isRunning ? (
          <div className="mt-3 flex min-h-7 items-center justify-between gap-4 font-mono text-[0.56rem] text-ink-subtle">
          <ActionBarPrimitive.Root className="flex items-center gap-1">
            <ActionBarPrimitive.Copy
              aria-label="复制回复"
              title="复制"
              className="group/copy grid size-7 cursor-pointer place-items-center rounded-md transition-[background,color,opacity] hover:bg-brand-subtle hover:text-brand-hover disabled:cursor-not-allowed dark:hover:bg-brand-subtle dark:hover:text-brand-light"
            >
              <CopyIcon
                aria-hidden="true"
                className="size-3.5 group-data-[copied=true]/copy:hidden"
                strokeWidth={1.8}
              />
              <CheckIcon
                aria-hidden="true"
                className="hidden size-3.5 group-data-[copied=true]/copy:block"
                strokeWidth={1.8}
              />
            </ActionBarPrimitive.Copy>
            <ActionBarPrimitive.FeedbackPositive
              aria-label="有帮助"
              title="有帮助"
              className="grid size-7 cursor-pointer place-items-center rounded-md transition-[background,color,opacity] hover:bg-brand-subtle hover:text-brand-hover disabled:cursor-not-allowed disabled:opacity-25 data-[submitted=true]:bg-brand-subtle data-[submitted=true]:text-brand dark:hover:bg-brand-subtle dark:hover:text-brand-light"
            >
              <ThumbsUpIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </ActionBarPrimitive.FeedbackPositive>
            <ActionBarPrimitive.FeedbackNegative
              aria-label="没帮助"
              title="没帮助"
              className="grid size-7 cursor-pointer place-items-center rounded-md transition-[background,color,opacity] hover:bg-brand-subtle hover:text-brand-hover disabled:cursor-not-allowed disabled:opacity-25 data-[submitted=true]:bg-brand-subtle data-[submitted=true]:text-brand dark:hover:bg-brand-subtle dark:hover:text-brand-light"
            >
              <ThumbsDownIcon aria-hidden="true" className="size-3.5" strokeWidth={1.8} />
            </ActionBarPrimitive.FeedbackNegative>
          </ActionBarPrimitive.Root>
          </div>
        ) : null}
      </div>
    </MessagePrimitive.Root>
  )
}

function AgentActivityDisclosure({
  children,
  isRunning,
}: Readonly<{
  children: ReactNode;
  isRunning: boolean;
}>) {
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    setOpen(isRunning);
  }, [isRunning]);

  return (
    <details
      className="group my-2 text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85 open:opacity-75"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center py-1 font-normal tracking-[0.02em] [&::-webkit-details-marker]:hidden">
        <span>思考与工具调用</span>
        <AgentDisclosureChevron />
      </summary>
      <div className="mt-1.5 space-y-1.5">{children}</div>
    </details>
  );
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
    <details className="group my-2 text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85 open:opacity-75">
      <summary className="flex cursor-pointer list-none items-center py-1 font-normal tracking-[0.02em] [&::-webkit-details-marker]:hidden">
        <span>思考过程</span>
        <AgentDisclosureChevron />
      </summary>
      <div className="mt-2 whitespace-pre-wrap">
        {text}
      </div>
    </details>
  )
}

export function AgentToolCall({ url }: Readonly<{ url?: string }>) {
  return (
    <div className="my-2 flex flex-wrap items-center gap-2 text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85">
      <span className="font-sans font-semibold">web_fetch</span>
      {url ? <span className="break-all">{url}</span> : null}
      <span>调用中…</span>
    </div>
  );
}

export function AgentDisclosureChevron() {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className="size-4 shrink-0 opacity-75 transition-[opacity,transform] duration-150 group-hover:opacity-100 [details[open]>summary>&]:rotate-90 motion-reduce:transition-none"
      strokeWidth={2}
    />
  );
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
    <div className="my-2 text-[0.97rem] leading-7 text-ink opacity-55 transition-opacity duration-150 hover:opacity-85">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-sans font-semibold">web_fetch</span>
        <span>{status ?? (isError ? 'failed' : 'succeeded')}</span>
        {httpStatus ? (
          <span>HTTP {httpStatus}</span>
        ) : null}
      </div>
      {summary ? <p className="mt-1.5">{summary}</p> : null}
      {finalUrl ? (
        <a
          className="mt-1 inline-block break-all text-inherit hover:underline"
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
