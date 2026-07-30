'use client'

import {
  AGENT_SKILL_CATEGORIES,
  createAIGatewayClient,
  type AgentSkillCategory,
  type AgentSkillFileEntry,
  type AgentSkillFilePreview,
  type AgentSkillMarketDetail,
  type AgentSkillMarketSummary,
  type OwnerSkillRecord,
} from '@supermind/sdk'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuthenticationFailure } from '../../components/use-authentication-failure'
import { useUserSession } from '../../components/user-session-provider'
import { cn } from '../../lib/cn'
import type { SkillFolderFile } from './skill-folder-package'
import { SkillUploadDialog } from './skill-upload-dialog'

const client = createAIGatewayClient()
const categoryLabels: Record<AgentSkillCategory, string> = {
  development: '开发工具',
  data: '数据处理',
  research: '研究分析',
  content: '内容创作',
  productivity: '效率自动化',
  other: '其他',
}
const statusLabels: Record<OwnerSkillRecord['publicationStatus'], string> = {
  pending_review: '待审核',
  published: '已发布',
  rejected: '已驳回',
  delisted: '已下架',
}
type SkillView = 'market' | 'added' | 'mine'

export default function SkillsPage() {
  const session = useUserSession()
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [items, setItems] = useState<AgentSkillMarketSummary[]>([])
  const [ownedItems, setOwnedItems] = useState<OwnerSkillRecord[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [view, setView] = useState<SkillView>('market')
  const [category, setCategory] = useState<AgentSkillCategory | ''>('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [uploadFiles, setUploadFiles] = useState<SkillFolderFile[] | null>(null)
  const [selectedSkill, setSelectedSkill] = useState<AgentSkillMarketDetail | null>(null)
  const [openingSkill, setOpeningSkill] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (view === 'mine') {
        setItems([])
        setTotalPages(1)
        setOwnedItems(session.status === 'authenticated' ? await client.skills.owner.list() : [])
        return
      }

      if (view === 'added') {
        setOwnedItems([])
        setTotalPages(1)
        if (session.status !== 'authenticated') {
          setItems([])
          setAdded(new Set())
          return
        }
        const candidates = await client.agent.skills.candidates()
        setAdded(new Set(candidates.map((skill) => skill.name)))
        const details = await Promise.allSettled(
          candidates.map((skill) => client.skills.detail(skill.name)),
        )
        setItems(details.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])))
        return
      }

      setOwnedItems([])
      const marketRequest = client.skills.list({
        page,
        pageSize: 12,
        ...(category ? { category } : {}),
        sort: 'latest',
      })
      const [result, candidates] = await Promise.all([
        marketRequest,
        session.status === 'authenticated' ? client.agent.skills.candidates() : Promise.resolve([]),
      ])
      setItems(result.items)
      setTotalPages(Math.max(1, result.totalPages))
      setAdded(new Set(candidates.map((skill) => skill.name)))
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : '技能加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [category, handleAuthenticationFailure, page, session.status, view])

  useEffect(() => {
    void load()
  }, [load])

  async function chooseSkillFolder() {
    const pickerWindow = window as DirectoryPickerWindow
    if (!pickerWindow.showDirectoryPicker) {
      setError('当前浏览器不支持文件夹选择，请使用最新版 Chrome 或 Edge')
      return
    }

    try {
      const directory = await pickerWindow.showDirectoryPicker({ mode: 'read' })
      const files = await readDirectoryFiles(directory)
      if (files.length > 0) setUploadFiles(files)
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : '无法读取所选技能文件夹')
    }
  }

  async function toggle(name: string) {
    setBusy(name)
    setError('')
    try {
      if (added.has(name)) {
        await client.skills.remove(name)
        setAdded((current) => {
          const next = new Set(current)
          next.delete(name)
          return next
        })
        if (view === 'added') {
          setItems((current) => current.filter((skill) => skill.name !== name))
        }
      } else {
        await client.skills.add(name)
        setAdded((current) => new Set(current).add(name))
      }
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : '技能添加状态更新失败')
      }
    } finally {
      setBusy('')
    }
  }

  async function openSkillFiles(name: string) {
    setOpeningSkill(name)
    setError('')
    try {
      setSelectedSkill(await client.skills.detail(name))
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : '无法加载技能文件目录')
      }
    } finally {
      setOpeningSkill('')
    }
  }

  async function delist(name: string) {
    if (!window.confirm(`确认下架 ${name}？所有用户的新 Run 将立即无法激活。`)) return
    setBusy(name)
    setError('')
    try {
      const updated = await client.skills.owner.delist(name)
      setOwnedItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : '下架失败')
      }
    } finally {
      setBusy('')
    }
  }

  function selectView(nextView: SkillView) {
    setView(nextView)
    setPage(1)
  }

  return (
    <main className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6 md:px-10 md:py-16">
      <header className="liquid-glass-soft grid items-center gap-5 overflow-hidden rounded-[1.6rem] px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:px-6">
        <div className="flex min-w-0 items-start gap-4">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-[0.9rem] border border-brand/15 bg-brand/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.8)]"
          >
            <span className="size-3 rotate-45 rounded-[0.2rem] bg-brand shadow-[0_5px_14px_rgb(39_100_255/0.35)]" />
          </span>
          <h1 className="max-w-[48rem] pt-1 text-[clamp(1rem,1.4vw,1.125rem)] font-medium leading-7 tracking-[-0.01em] text-ink-secondary">
            技能是人工智能代理可复用的功能。它们提供了程序化的知识，有助于 Agent
            更高效地完成特定任务。
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-self-end">
          <button type="button" className={primaryButton} onClick={() => void chooseSkillFolder()}>
            上传技能
          </button>
        </div>
      </header>

      <section
        aria-label="技能分类"
        className="mt-6 flex min-h-12 items-center gap-5 border-b border-line px-5 md:px-6"
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            aria-pressed={view === 'added'}
            className={cn(categoryTabClass, view === 'added' && categoryTabActiveClass)}
            onClick={() => selectView('added')}
          >
            已添加
          </button>
          <button
            type="button"
            aria-pressed={view === 'mine'}
            className={cn(categoryTabClass, view === 'mine' && categoryTabActiveClass)}
            onClick={() => selectView('mine')}
          >
            我的
          </button>
          <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line" />
          <button
            type="button"
            aria-pressed={view === 'market' && category === ''}
            className={cn(
              categoryTabClass,
              view === 'market' && category === '' && categoryTabActiveClass,
            )}
            onClick={() => {
              setView('market')
              setCategory('')
              setPage(1)
            }}
          >
            全部
          </button>
          {AGENT_SKILL_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === 'market' && category === value}
              className={cn(
                categoryTabClass,
                view === 'market' && category === value && categoryTabActiveClass,
              )}
              onClick={() => {
                setView('market')
                setCategory(value)
                setPage(1)
              }}
            >
              {categoryLabels[value]}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <p role="alert" className="mt-5 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <section
          aria-busy="true"
          aria-label="正在加载技能"
          className="mt-8 grid gap-3 sm:grid-cols-[repeat(auto-fill,17rem)]"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="h-44 w-full animate-pulse rounded-2xl bg-surface-inset sm:w-[17rem]"
            />
          ))}
        </section>
      ) : session.status !== 'authenticated' && view !== 'market' ? (
        <section className="mt-8 rounded-3xl border border-dashed border-line p-16 text-center">
          <p className="font-semibold">登录后查看{view === 'added' ? '已添加' : '我的'} 技能</p>
          <Link className={cn(primaryButton, 'mt-5')} href="/login?returnTo=%2Fskills">
            登录
          </Link>
        </section>
      ) : view === 'mine' ? (
        ownedItems.length === 0 ? (
          <section className="mt-8 rounded-3xl border border-dashed border-line p-16 text-center">
            <p className="font-semibold">你还没有上传过技能哦～</p>
          </section>
        ) : (
          <section className="mt-8 grid gap-3">
            <p className="mb-1 text-sm text-ink-muted">
              首次发布需审核；发布后的覆盖更新不会再次送审。
            </p>
            {ownedItems.map((item) => (
              <article
                key={item.id}
                className="grid gap-4 rounded-2xl border border-line bg-surface-card p-5 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-bold">{item.title}</h2>
                    <span className="rounded-full bg-surface-inset px-2.5 py-1 text-[0.65rem] font-bold text-ink-muted">
                      {statusLabels[item.publicationStatus]}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-xs text-ink-faint">
                    {item.name} · {categoryLabels[item.category]}
                  </p>
                  {item.publicationStatus === 'rejected' ? (
                    <p className="mt-2 text-xs text-rose-600">
                      审核未通过，请修正资源包后重新上传。
                    </p>
                  ) : item.publicationStatus === 'delisted' ? (
                    <p className="mt-2 text-xs text-amber-700">
                      已下架，既有添加记录仍保留但不可激活。
                    </p>
                  ) : null}
                </div>
                {item.publicationStatus === 'published' ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy === item.name}
                      onClick={() => void delist(item.name)}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-rose-200 px-4 text-xs font-bold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                    >
                      {busy === item.name ? '处理中…' : '下架'}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
          </section>
        )
      ) : items.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-line p-16 text-center">
          <p className="font-semibold">
            {view === 'added' ? '还没有添加技能' : '没有匹配的已发布技能'}
          </p>
          <p className="mt-2 text-sm text-ink-muted">
            {view === 'added' ? '从其他分类中找到技能并添加。' : '切换其他分类试试。'}
          </p>
        </section>
      ) : (
        <section className="mt-8 grid gap-3 sm:grid-cols-[repeat(auto-fill,17rem)]">
          {items.map((skill) => (
            <article
              key={skill.id}
              className="liquid-glass group relative flex h-44 w-full flex-col overflow-hidden rounded-2xl px-4 py-4 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-ink-faint/45 hover:bg-surface-card focus-within:border-ink-faint/45 sm:w-[17rem] dark:hover:bg-surface-card"
            >
              <button
                type="button"
                aria-label={`查看 ${skill.title} 的文件目录`}
                disabled={openingSkill === skill.name}
                onClick={() => void openSkillFiles(skill.name)}
                className="absolute inset-0 z-0 cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-[-3px] disabled:cursor-wait"
              />
              <div className="pointer-events-none relative z-10 flex min-w-0 gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface-inset text-sm font-semibold text-ink-secondary"
                >
                  {skill.title.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="truncate text-base font-semibold tracking-tight text-ink-primary">
                      {skill.title}
                    </h2>
                    <span className="shrink-0 font-mono text-[0.62rem] text-ink-faint">
                      +{skill.addCount}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{categoryLabels[skill.category]}</p>
                  <p className="mt-3 line-clamp-2 text-sm leading-5 text-ink-secondary">
                    {skill.description}
                  </p>
                </div>
              </div>
              <div className="pointer-events-none relative z-10 mt-auto flex items-center justify-between pt-3">
                <span className="font-mono text-xs text-ink-faint">{skill.name}</span>
                {session.status === 'authenticated' ? (
                  <button
                    type="button"
                    disabled={busy === skill.name}
                    onClick={() => void toggle(skill.name)}
                    className={cn(
                      'pointer-events-auto',
                      added.has(skill.name) ? compactSecondaryButton : compactPrimaryButton,
                    )}
                  >
                    {busy === skill.name ? '处理中…' : added.has(skill.name) ? '移除' : '添加'}
                  </button>
                ) : (
                  <Link
                    className={cn('pointer-events-auto', compactSecondaryButton)}
                    href="/login?returnTo=%2Fskills"
                  >
                    登录后添加
                  </Link>
                )}
              </div>
            </article>
          ))}
        </section>
      )}

      {view === 'market' ? (
        <nav className="mt-8 flex items-center justify-center gap-4 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className={secondaryButton}
          >
            上一页
          </button>
          <span className="font-mono text-xs text-ink-faint">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
            className={secondaryButton}
          >
            下一页
          </button>
        </nav>
      ) : null}

      {uploadFiles ? (
        <SkillUploadDialog
          selectedFiles={uploadFiles}
          onChooseFolder={() => void chooseSkillFolder()}
          onClose={() => setUploadFiles(null)}
        />
      ) : null}
      {selectedSkill ? (
        <SkillFilesDialog skill={selectedSkill} onClose={() => setSelectedSkill(null)} />
      ) : null}
    </main>
  )
}

const categoryTabClass =
  'shrink-0 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap text-ink-muted transition-[background,color] hover:bg-brand/6 hover:text-brand-hover focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-1 dark:hover:bg-brand/12 dark:hover:text-brand-light'
const categoryTabActiveClass = 'bg-brand/10 text-brand-hover dark:bg-brand/16 dark:text-brand-light'
const primaryButton =
  'liquid-button inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-xs font-bold text-white transition hover:-translate-y-0.5 disabled:opacity-50'
const secondaryButton =
  'liquid-glass-soft inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-xs font-bold text-ink-muted transition hover:border-brand/30 hover:text-brand disabled:opacity-40'
const compactPrimaryButton =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-[#3a3a3c] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#242426] hover:text-white focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#ebebf5] dark:text-[#1c1c1e] dark:hover:bg-white dark:hover:text-[#1c1c1e]'
const compactSecondaryButton =
  'inline-flex h-8 cursor-pointer items-center justify-center rounded-lg bg-surface-inset px-3 text-xs font-semibold text-ink-secondary transition-colors hover:bg-surface-inset/70 disabled:cursor-not-allowed disabled:opacity-50'

function SkillFilesDialog({
  skill,
  onClose,
}: {
  skill: AgentSkillMarketDetail
  onClose: () => void
}) {
  const fileEntries = skill.files.filter((file) => file.type === 'file')
  const [selectedPath, setSelectedPath] = useState(
    fileEntries.find((file) => file.path === 'SKILL.md')?.path ?? fileEntries[0]?.path ?? '',
  )
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(skill.files.filter((file) => file.type === 'directory').map((file) => file.path)),
  )
  const [preview, setPreview] = useState<AgentSkillFilePreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!selectedPath) return
    let active = true
    setPreviewLoading(true)
    setPreviewError('')
    void client.skills
      .file(skill.name, selectedPath)
      .then((result) => {
        if (active) setPreview(result)
      })
      .catch((cause) => {
        if (active) {
          setPreview(null)
          setPreviewError(cause instanceof Error ? cause.message : '无法加载文件预览')
        }
      })
      .finally(() => {
        if (active) setPreviewLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedPath, skill.name])

  const tree = createSkillFileTree(skill.files)
  const selectedName = selectedPath.split('/').at(-1) ?? '文件预览'

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/20 px-4 py-6 backdrop-blur-[2px] dark:bg-black/45"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="skill-files-title"
        aria-modal="true"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-5xl overflow-hidden rounded-2xl border border-line bg-surface-card shadow-[0_20px_50px_rgb(0_0_0/0.12)] dark:border-line-soft dark:bg-surface-card dark:shadow-[0_20px_50px_rgb(0_0_0/0.35)]"
        role="dialog"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2
              id="skill-files-title"
              className="truncate text-lg font-semibold tracking-tight text-ink-primary"
            >
              {skill.title}
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">技能文件</p>
          </div>
          <button
            type="button"
            className={dialogCloseButton}
            onClick={onClose}
            aria-label="关闭文件预览"
          >
            ×
          </button>
        </div>
        <div className="grid h-[min(36rem,calc(100dvh-7rem))] min-h-[28rem] grid-rows-[minmax(12rem,34dvh)_minmax(18rem,1fr)] md:grid-cols-[15rem_minmax(0,1fr)] md:grid-rows-1">
          <aside className="overflow-y-auto border-b border-line bg-surface-inset/45 px-3 py-4 md:border-r md:border-b-0">
            <p className="px-2 pb-2 text-xs font-semibold text-ink-muted">文件</p>
            {tree.length === 0 ? (
              <p className="px-2 py-6 text-sm text-ink-muted">此技能未提供文件目录。</p>
            ) : (
              <ul aria-label={`${skill.title} 文件目录`}>
                {tree.map((node) => (
                  <SkillFileTreeNode
                    key={node.path}
                    node={node}
                    expandedPaths={expandedPaths}
                    selectedPath={selectedPath}
                    onSelect={setSelectedPath}
                    onToggle={(path) =>
                      setExpandedPaths((current) => {
                        const next = new Set(current)
                        if (next.has(path)) next.delete(path)
                        else next.add(path)
                        return next
                      })
                    }
                  />
                ))}
              </ul>
            )}
          </aside>
          <div className="flex min-w-0 flex-col bg-surface-card">
            <div className="flex min-h-13 items-center border-b border-line px-5">
              <span className="truncate text-sm font-medium text-ink-primary">{selectedName}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              {!selectedPath ? (
                <p className="py-12 text-center text-sm text-ink-muted">选择一个文件以预览内容。</p>
              ) : previewLoading ? (
                <p className="py-12 text-center text-sm text-ink-muted">正在加载预览…</p>
              ) : previewError ? (
                <p className="py-12 text-center text-sm text-rose-600">{previewError}</p>
              ) : preview?.previewable && preview.content !== null ? (
                <>
                  <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-ink-secondary">
                    {preview.content}
                  </pre>
                  {preview.truncated ? (
                    <p className="mt-5 border-t border-line pt-3 text-xs text-ink-muted">
                      文件较大，当前仅显示前 256 KB。
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="py-12 text-center text-sm text-ink-muted">
                  此文件为二进制文件，暂不支持文本预览。
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

interface SkillTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size: number | null
  children: SkillTreeNode[]
}

function SkillFileTreeNode({
  node,
  expandedPaths,
  selectedPath,
  onSelect,
  onToggle,
  depth = 0,
}: {
  node: SkillTreeNode
  expandedPaths: Set<string>
  selectedPath: string
  onSelect: (path: string) => void
  onToggle: (path: string) => void
  depth?: number
}) {
  const expanded = expandedPaths.has(node.path)
  const directory = node.type === 'directory'

  return (
    <li>
      <button
        type="button"
        aria-expanded={directory ? expanded : undefined}
        className={cn(
          'flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-[-2px]',
          directory
            ? 'text-ink-secondary hover:bg-surface-muted'
            : 'text-ink-muted hover:bg-surface-muted',
          !directory &&
            selectedPath === node.path &&
            'bg-surface-muted font-medium text-ink-primary',
        )}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        onClick={() => (directory ? onToggle(node.path) : onSelect(node.path))}
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-center text-ink-muted">
          {directory ? (expanded ? '⌄' : '›') : '·'}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {directory && expanded ? (
        <ul>
          {node.children.map((child) => (
            <SkillFileTreeNode
              key={child.path}
              node={child}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onToggle={onToggle}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function createSkillFileTree(files: AgentSkillFileEntry[]): SkillTreeNode[] {
  const root: SkillTreeNode = { name: '', path: '', type: 'directory', size: null, children: [] }
  const nodes = new Map<string, SkillTreeNode>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let parent = root
    let parentPath = ''
    for (const [index, part] of parts.entries()) {
      const path = parentPath ? `${parentPath}/${part}` : part
      const terminal = index === parts.length - 1
      let node = nodes.get(path)
      if (!node) {
        node = {
          name: part,
          path,
          type: terminal ? file.type : 'directory',
          size: terminal ? file.size : null,
          children: [],
        }
        nodes.set(path, node)
        parent.children.push(node)
      }
      parent = node
      parentPath = path
    }
  }
  const sort = (nodesToSort: SkillTreeNode[]) => {
    nodesToSort.sort((left, right) => {
      if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
      return left.name.localeCompare(right.name)
    })
    nodesToSort.forEach((node) => sort(node.children))
  }
  sort(root.children)
  return root.children
}

const dialogCloseButton =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-2xl leading-none text-ink-secondary transition-colors hover:bg-surface-inset hover:text-ink-primary focus-visible:outline-2 focus-visible:outline-brand-focus focus-visible:outline-offset-2'

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?(options?: { mode?: 'read' | 'readwrite' }): Promise<DirectoryHandle>
}

interface DirectoryHandle {
  readonly kind: 'directory'
  readonly name: string
  values(): AsyncIterableIterator<DirectoryEntryHandle>
}

interface FileHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
}

type DirectoryEntryHandle = DirectoryHandle | FileHandle

async function readDirectoryFiles(
  directory: DirectoryHandle,
  parentPath = directory.name,
): Promise<SkillFolderFile[]> {
  const files: SkillFolderFile[] = []
  for await (const entry of directory.values()) {
    const path = `${parentPath}/${entry.name}`
    if (entry.kind === 'directory') {
      files.push(...(await readDirectoryFiles(entry, path)))
      continue
    }

    const file = await entry.getFile()
    files.push({
      arrayBuffer: () => file.arrayBuffer(),
      name: file.name,
      size: file.size,
      text: () => file.text(),
      webkitRelativePath: path,
    })
  }
  return files
}
