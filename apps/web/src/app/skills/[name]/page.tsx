'use client'

import { createAIGatewayClient, type AgentSkillMarketDetail } from '@supermind/sdk'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { useAuthenticationFailure } from '../../../components/use-authentication-failure'
import { useUserSession } from '../../../components/user-session-provider'

const client = createAIGatewayClient()

export default function SkillDetailPage() {
  const params = useParams<{ name: string }>()
  const session = useUserSession()
  const handleAuthenticationFailure = useAuthenticationFailure()
  const name = decodeURIComponent(params.name)
  const [detail, setDetail] = useState<AgentSkillMarketDetail | null>(null)
  const [added, setAdded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    void Promise.all([
      client.skills.detail(name),
      session.status === 'authenticated' ? client.agent.skills.candidates() : Promise.resolve([]),
    ])
      .then(([next, candidates]) => {
        if (!active) return
        setDetail(next)
        setAdded(candidates.some((skill) => skill.name === name))
      })
      .catch((cause: unknown) => {
        if (active && !handleAuthenticationFailure(cause)) {
          setError(cause instanceof Error ? cause.message : 'Skill 详情加载失败')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [handleAuthenticationFailure, name, session.status])

  async function toggle() {
    setBusy(true)
    try {
      if (added) await client.skills.remove(name)
      else await client.skills.add(name)
      setAdded(!added)
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : 'Skill 添加状态更新失败')
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-5 py-20 text-sm text-ink-muted">正在读取 Skill…</main>
    )
  }
  if (!detail) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-20">
        <p role="alert" className="rounded-2xl bg-rose-50 p-5 text-rose-700">
          {error || 'Skill 不存在或已下架'}
        </p>
        <Link href="/skills" className="mt-6 inline-block text-sm font-bold text-brand">
          ← 返回市场
        </Link>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-[72rem] px-5 py-10 md:px-10 md:py-16">
      <Link href="/skills" className="font-mono text-xs font-bold text-brand">
        ← SKILL MARKET
      </Link>
      <header className="mt-8 grid gap-8 border-b border-line pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="font-mono text-xs tracking-widest text-ink-faint">{detail.name}</p>
          <h1 className="mt-3 text-[clamp(2.6rem,6vw,5rem)] leading-none font-black tracking-[-0.055em]">
            {detail.title}
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-ink-muted">{detail.description}</p>
        </div>
        {session.status === 'authenticated' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void toggle()}
            className="rounded-xl bg-brand px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? '处理中…' : added ? '已添加 · 移除' : '添加到 Agent'}
          </button>
        ) : (
          <Link
            href={`/login?returnTo=${encodeURIComponent(`/skills/${name}`)}`}
            className="rounded-xl border border-line px-6 py-3 text-sm font-bold"
          >
            登录后添加
          </Link>
        )}
      </header>

      {error ? (
        <p role="alert" className="mt-5 text-sm text-rose-600">
          {error}
        </p>
      ) : null}
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <article className="rounded-3xl border border-line bg-surface-card p-6 md:p-8">
          <p className="font-mono text-[0.62rem] font-bold tracking-widest text-brand">SKILL.md</p>
          <pre className="mt-5 overflow-x-auto whitespace-pre-wrap font-sans text-sm leading-7 text-ink-muted">
            {detail.skillMarkdown || '该 Skill 暂无可展示说明。'}
          </pre>
        </article>
        <aside className="rounded-3xl border border-line bg-[#24202e] p-6 text-white">
          <p className="font-mono text-[0.62rem] font-bold tracking-widest text-[#b8f3e0]">
            PACKAGE FILES
          </p>
          {detail.files.length === 0 ? (
            <p className="mt-5 text-sm text-white/60">暂无文件树投影。</p>
          ) : (
            <ul className="mt-5 grid gap-2">
              {detail.files.map((file) => (
                <li key={file.path} className="flex gap-3 text-xs text-white/75">
                  <span className="text-[#b8f3e0]">
                    {file.type === 'directory' ? 'DIR' : 'FILE'}
                  </span>
                  <span className="min-w-0 break-all">{file.path}</span>
                  <span className="ml-auto text-white/35">{file.size ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  )
}
