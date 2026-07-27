'use client'

import {
  AGENT_SKILL_CATEGORIES,
  createAIGatewayClient,
  type AgentSkillCategory,
  type AgentSkillMarketSummary,
} from '@supermind/sdk'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useAuthenticationFailure } from '../../components/use-authentication-failure'
import { useUserSession } from '../../components/user-session-provider'
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

export default function SkillsPage() {
  const session = useUserSession()
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [items, setItems] = useState<AgentSkillMarketSummary[]>([])
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<AgentSkillCategory | ''>('')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
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
      const result = await client.skills.list({
        page,
        pageSize: 12,
        ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(category ? { category } : {}),
        sort,
      })
      setItems(result.items)
      setTotalPages(Math.max(1, result.totalPages))
      if (session.status === 'authenticated') {
        const candidates = await client.agent.skills.candidates()
        setAdded(new Set(candidates.map((skill) => skill.name)))
      } else {
        setAdded(new Set())
      }
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : 'Skill 市场加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [category, handleAuthenticationFailure, keyword, page, session.status, sort])

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
      setError(cause instanceof Error ? cause.message : '无法读取所选 Skill 文件夹')
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
      } else {
        await client.skills.add(name)
        setAdded((current) => new Set(current).add(name))
      }
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : 'Skill 添加状态更新失败')
      }
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="mx-auto max-w-[76rem] px-4 py-10 sm:px-6 md:px-10 md:py-16">
      <header className="grid gap-8 border-b border-line pb-9 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="liquid-label text-brand">OPEN SKILL REGISTRY</p>
          <h1 className="mt-3 font-display text-[clamp(2.8rem,7vw,5.8rem)] leading-[0.9] font-semibold tracking-[-0.065em]">
            找到下一种
            <br />
            工作方式。
          </h1>
          <p className="mt-6 max-w-xl text-sm leading-6 text-ink-muted">
            浏览已审核的传统 Skill 资源包。添加后，可在 Agent Run 中手动指定，也可交给模型自主选择。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={secondaryButton} href="/skills/mine">
            我的 Skill
          </Link>
          <button type="button" className={primaryButton} onClick={() => void chooseSkillFolder()}>
            上传 Skill
          </button>
        </div>
      </header>

      <section className="liquid-glass-soft mt-7 grid gap-3 rounded-2xl p-3 md:grid-cols-[1fr_11rem_10rem_auto]">
        <input
          aria-label="搜索 Skill"
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            setPage(1)
          }}
          placeholder="搜索名称、标题、简介或作者"
          className={controlClass}
        />
        <select
          aria-label="分类"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as AgentSkillCategory | '')
            setPage(1)
          }}
          className={controlClass}
        >
          <option value="">全部分类</option>
          {AGENT_SKILL_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {categoryLabels[value]}
            </option>
          ))}
        </select>
        <select
          aria-label="排序"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as 'latest' | 'popular')
            setPage(1)
          }}
          className={controlClass}
        >
          <option value="latest">最新发布</option>
          <option value="popular">添加最多</option>
        </select>
        <button type="button" onClick={() => void load()} className={secondaryButton}>
          刷新
        </button>
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
      ) : items.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-dashed border-line p-16 text-center">
          <p className="font-semibold">没有匹配的已发布 Skill</p>
          <p className="mt-2 text-sm text-ink-muted">换个关键词或清除分类筛选。</p>
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
                <Link href={`/skills/${encodeURIComponent(skill.name)}`}>
                  <h2 className="mt-2 text-xl font-bold tracking-tight group-hover:text-brand">
                    {skill.title}
                  </h2>
                </Link>
                <p className="mt-3 line-clamp-3 text-sm leading-6 text-ink-muted">
                  {skill.description}
                </p>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
                <Link
                  href={`/skills/${encodeURIComponent(skill.name)}`}
                  className="font-mono text-xs text-ink-faint hover:text-brand"
                >
                  {skill.name}
                </Link>
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

const controlClass =
  'min-h-11 rounded-xl border border-white/80 bg-white/55 px-3 text-sm outline-none focus:border-brand/40 focus:ring-3 focus:ring-brand-focus/10'
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
