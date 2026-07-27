'use client'

import { createAIGatewayClient, type OwnerSkillRecord } from '@supermind/sdk'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { ProtectedUserPage } from '../../../components/protected-user-page'
import { useAuthenticationFailure } from '../../../components/use-authentication-failure'

const client = createAIGatewayClient()
const statusLabel = {
  pending_review: '待审核',
  published: '已发布',
  rejected: '已驳回',
  delisted: '已下架',
} as const

export default function MySkillsPage() {
  return (
    <ProtectedUserPage>
      <MySkills />
    </ProtectedUserPage>
  )
}

function MySkills() {
  const handleAuthenticationFailure = useAuthenticationFailure()
  const [items, setItems] = useState<OwnerSkillRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await client.skills.owner.list())
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : '我的 Skill 加载失败')
      }
    } finally {
      setLoading(false)
    }
  }, [handleAuthenticationFailure])

  useEffect(() => {
    void load()
  }, [load])

  async function delist(name: string) {
    if (!window.confirm(`确认下架 ${name}？所有用户的新 Run 将立即无法激活。`)) return
    try {
      const updated = await client.skills.owner.delist(name)
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (cause) {
      if (!handleAuthenticationFailure(cause)) {
        setError(cause instanceof Error ? cause.message : '下架失败')
      }
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-12 md:px-10 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <Link href="/skills" className="font-mono text-xs font-bold text-brand">
            ← 市场
          </Link>
          <h1 className="mt-3 text-4xl font-black tracking-tight">我的 Skill</h1>
          <p className="mt-3 text-sm text-ink-muted">
            首次发布需审核；发布后的覆盖更新不会再次送审。
          </p>
        </div>
        <Link href="/skills" className="rounded-xl bg-brand px-5 py-3 text-sm font-bold text-white">
          上传新 Skill
        </Link>
      </div>
      {error ? (
        <p role="alert" className="mt-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="mt-10 text-sm text-ink-muted">正在加载…</p>
      ) : items.length === 0 ? (
        <section className="mt-10 rounded-3xl border border-dashed border-line p-14 text-center">
          <p className="font-bold">你还没有上传 Skill</p>
          <Link href="/skills" className="mt-4 inline-block text-sm font-bold text-brand">
            创建第一个
          </Link>
        </section>
      ) : (
        <section className="mt-8 grid gap-3">
          {items.map((item) => (
            <article
              key={item.id}
              className="grid gap-4 rounded-2xl border border-line bg-surface-card p-5 md:grid-cols-[1fr_auto] md:items-center"
            >
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-bold">{item.title}</h2>
                  <span className="rounded-full bg-surface-inset px-2.5 py-1 text-[0.65rem] font-bold text-ink-muted">
                    {statusLabel[item.publicationStatus]}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xs text-ink-faint">
                  {item.name} · {item.category}
                </p>
                {item.publicationStatus === 'rejected' ? (
                  <p className="mt-2 text-xs text-rose-600">审核未通过，请修正资源包后重新上传。</p>
                ) : item.publicationStatus === 'delisted' ? (
                  <p className="mt-2 text-xs text-amber-700">
                    已下架，既有添加记录仍保留但不可激活。
                  </p>
                ) : null}
              </div>
              <div className="flex gap-2">
                {item.publicationStatus === 'published' ? (
                  <>
                    <Link
                      href={`/skills/${item.name}`}
                      className="rounded-lg border border-line px-3 py-2 text-xs font-bold"
                    >
                      查看
                    </Link>
                    <button
                      type="button"
                      onClick={() => void delist(item.name)}
                      className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-600"
                    >
                      下架
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}
