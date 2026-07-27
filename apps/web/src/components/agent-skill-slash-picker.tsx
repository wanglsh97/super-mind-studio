'use client'

import type { AgentSkillCandidate } from '@supermind/sdk'
import { ComposerPrimitive, unstable_useSlashCommandAdapter } from '@assistant-ui/react'
import { useMemo } from 'react'

import { cn } from '../lib/cn'

interface AgentSkillSlashPickerProps {
  candidates: AgentSkillCandidate[]
  selectedNames: string[]
  loadState: 'loading' | 'ready' | 'failed'
  disabled: boolean
  onToggle: (name: string) => void
  onRetry: () => void
}

export function AgentSkillSlashPicker({
  candidates,
  selectedNames,
  loadState,
  disabled,
  onToggle,
  onRetry,
}: Readonly<AgentSkillSlashPickerProps>) {
  const selectedNameSet = useMemo(() => new Set(selectedNames), [selectedNames])
  const candidatesByName = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.name, candidate])),
    [candidates],
  )
  const slash = unstable_useSlashCommandAdapter({
    commands: candidates.map((skill) => ({
      id: skill.name,
      label: skill.title,
      description: skill.description,
      execute: () => onToggle(skill.name),
    })),
    removeOnExecute: true,
  })

  return (
    <>
      <ComposerPrimitive.Unstable_TriggerPopover
        char="/"
        adapter={slash.adapter}
        isLoading={loadState === 'loading'}
        aria-label="选择本次运行使用的技能"
        className="absolute right-0 bottom-[calc(100%+0.65rem)] left-0 z-20 mx-auto max-h-[min(24rem,55dvh)] w-full overflow-hidden rounded-[1.35rem] border border-line bg-surface-card/98 p-2 shadow-[0_22px_64px_rgb(35_45_75/0.2)] backdrop-blur-xl dark:bg-surface-raised/98"
      >
        <ComposerPrimitive.Unstable_TriggerPopover.Action {...slash.action} />
        <ComposerPrimitive.Unstable_TriggerPopoverItems>
          {(items) => {
            let content
            if (loadState === 'loading') {
              content = (
                <p className="px-3 py-4 text-sm text-ink-muted" role="status">
                  正在加载已添加的技能…
                </p>
              )
            } else if (loadState === 'failed') {
              content = (
                <button
                  type="button"
                  className="mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-semibold text-[#a63d3d] hover:bg-[#fff0f0] focus-visible:outline-3 focus-visible:outline-brand-focus dark:hover:bg-[#3a2025]"
                  onClick={onRetry}
                >
                  技能加载失败，点击重试
                  <span aria-hidden="true">↻</span>
                </button>
              )
            } else if (candidates.length === 0) {
              content = (
                <p className="px-3 py-4 text-sm text-ink-muted">
                  暂无已添加的技能，可前往技能中心添加。
                </p>
              )
            } else if (items.length === 0) {
              content = <p className="px-3 py-4 text-sm text-ink-muted">没有匹配的技能。</p>
            } else {
              content = items.map((item, index) => {
                const skill = candidatesByName.get(item.id)
                const selected = selectedNameSet.has(item.id)
                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    key={item.id}
                    item={item}
                    index={index}
                    disabled={disabled}
                    className={cn(
                      'group mx-1 grid w-[calc(100%-0.5rem)] grid-cols-[2.25rem_minmax(0,1fr)_1.5rem] items-center gap-2 rounded-xl px-2 py-2.5 text-left transition-colors',
                      'hover:bg-brand-subtle data-highlighted:bg-brand-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'grid size-8 place-items-center rounded-[0.7rem] border',
                        selected
                          ? 'border-brand/30 bg-brand text-white'
                          : 'border-brand/15 bg-brand-subtle text-brand',
                      )}
                    >
                      <SkillGlyph />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {skill?.title ?? item.label}
                      </span>
                      <span className="mt-0.5 block truncate text-xs leading-5 text-ink-muted">
                        {skill?.description || '激活后可在本次运行中使用'}
                      </span>
                    </span>
                    <span
                      aria-label={selected ? '已选择' : undefined}
                      className={cn(
                        'grid size-5 place-items-center rounded-full text-xs font-bold',
                        selected ? 'bg-brand text-white' : 'text-ink-subtle opacity-0',
                      )}
                    >
                      {selected ? '✓' : null}
                    </span>
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                )
              })
            }

            return (
              <>
                <div className="flex items-center justify-between gap-3 px-3 pt-2 pb-2.5">
                  <div>
                    <p className="text-xs font-bold tracking-[0.12em] text-ink-subtle">选择技能</p>
                    <p className="mt-1 text-xs text-ink-muted">输入名称或简介继续筛选</p>
                  </div>
                  <kbd className="rounded-md border border-line bg-surface-inset px-1.5 py-1 font-mono text-[0.65rem] text-ink-subtle">
                    ESC
                  </kbd>
                </div>
                <div className="max-h-[min(18rem,42dvh)] overflow-y-auto border-t border-line-soft py-1.5">
                  {content}
                </div>
              </>
            )
          }}
        </ComposerPrimitive.Unstable_TriggerPopoverItems>
      </ComposerPrimitive.Unstable_TriggerPopover>

      {selectedNames.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5 px-2.5 pt-1 pb-0.5"
          aria-label="本次运行已选技能"
        >
          <span className="mr-0.5 text-[0.68rem] font-semibold text-ink-subtle">本次运行</span>
          {selectedNames.map((name) => {
            const skill = candidatesByName.get(name)
            if (!skill) return null
            return (
              <button
                key={name}
                type="button"
                disabled={disabled}
                title={`移除 ${skill.title}`}
                aria-label={`移除技能 ${skill.title}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  onToggle(name)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  onToggle(name)
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-brand/20 bg-brand-subtle px-2 text-xs font-semibold text-brand transition-colors hover:border-brand/40 hover:bg-brand-muted/18 focus-visible:outline-3 focus-visible:outline-brand-focus disabled:cursor-not-allowed disabled:opacity-45"
              >
                <SkillGlyph className="size-3.5" />
                <span className="max-w-40 truncate">{skill.title}</span>
                <span aria-hidden="true" className="text-sm leading-none text-brand/65">
                  ×
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </>
  )
}

function SkillGlyph({ className = 'size-4' }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 2.75 11.4 7l4.25 1.4-4.25 1.4L10 14.05 8.6 9.8 4.35 8.4 8.6 7 10 2.75Z" />
      <path d="m15.15 13.05.65 1.95 1.95.65-1.95.65-.65 1.95-.65-1.95-1.95-.65 1.95-.65.65-1.95Z" />
    </svg>
  )
}
