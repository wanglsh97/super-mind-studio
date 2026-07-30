'use client'

import {
  AGENT_SKILL_CATEGORIES,
  createAIGatewayClient,
  type AgentSkillCategory,
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
        <section aria-busy="true" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-72 animate-pulse rounded-3xl bg-surface-inset" />
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
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((skill, index) => (
            <article
              key={skill.id}
              className="liquid-glass group flex min-h-72 flex-col rounded-[1.7rem] p-5 transition hover:-translate-y-1 hover:border-brand/25 hover:shadow-[0_24px_60px_rgb(44_74_120/0.14)]"
            >
              <div className="flex items-start justify-between">
                <span className="grid size-12 place-items-center rounded-2xl bg-[linear-gradient(135deg,#2764ff,#8b7cff)] font-mono text-xs font-black text-white shadow-[0_10px_24px_rgb(39_100_255/0.2)]">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[0.62rem] text-ink-faint">+{skill.addCount}</span>
              </div>
              <div className="mt-7 flex-1">
                <p className="font-mono text-[0.6rem] tracking-widest text-brand">
                  {categoryLabels[skill.category]}
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight">{skill.title}</h2>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-ink-muted">
                  {skill.description}
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
                <span className="font-mono text-xs text-ink-faint">{skill.name}</span>
                {session.status === 'authenticated' ? (
                  <button
                    type="button"
                    disabled={busy === skill.name}
                    onClick={() => void toggle(skill.name)}
                    className={added.has(skill.name) ? secondaryButton : primaryButton}
                  >
                    {busy === skill.name
                      ? '处理中…'
                      : added.has(skill.name)
                        ? '已添加 · 移除'
                        : '添加'}
                  </button>
                ) : (
                  <Link className={secondaryButton} href="/login?returnTo=%2Fskills">
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
