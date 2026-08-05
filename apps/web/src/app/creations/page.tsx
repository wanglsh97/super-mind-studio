'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createAIGatewayClient, type CreativeItem } from '@supermind/sdk'

import { useUserSession } from '@/components/user-session-provider'
import { githubLoginUrl } from '@/utils/auth/user-auth-client'
import { creationExpiryLabel, filterCreations, type CreationFilter } from './creations-view'

const client = createAIGatewayClient()

export default function CreationsPage() {
  const session = useUserSession()
  const [items, setItems] = useState<CreativeItem[]>([])
  const [filter, setFilter] = useState<CreationFilter>('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const visibleItems = useMemo(
    () => filterCreations(items, filter),
    [filter, items],
  )

  useEffect(() => {
    if (session.status !== 'authenticated' || session.user?.authProvider !== 'GITHUB') {
      setLoading(false)
      return
    }
    void client.creations.list()
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '加载创作失败'))
      .finally(() => setLoading(false))
  }, [session.status, session.user?.authProvider])

  if (session.status === 'loading') return <main className="p-10 text-sm text-ink-muted">正在恢复会话…</main>
  if (session.status !== 'authenticated' || session.user?.authProvider !== 'GITHUB') {
    return <main className="mx-auto max-w-2xl px-6 py-24 text-center"><h1 className="text-3xl font-semibold">我的创作</h1><p className="mt-4 text-ink-muted">网页创作需要使用 GitHub 账号登录。</p><a className="mt-6 inline-flex rounded-xl bg-brand px-4 py-2 font-semibold text-white" href={githubLoginUrl('/creations')}>使用 GitHub 登录</a></main>
  }

  return <main className="mx-auto max-w-6xl px-6 py-10">
    <div className="flex items-end justify-between gap-4">
      <div><p className="text-sm text-ink-muted">Creative workspace</p><h1 className="mt-1 text-3xl font-semibold">我的创作</h1></div>
      <Link href="/" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">新建网页创作</Link>
    </div>
    <p className="mt-3 text-sm text-ink-muted">网站产物会在 30 天后自动删除；图片与未来的视频都会集中显示在这里。</p>
    <div className="mt-6 flex gap-2" aria-label="创作类型筛选">
      {([['all', '全部'], ['website', '网站'], ['image', '图片']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={filter === value ? 'rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white' : 'rounded-full border border-line px-3 py-1.5 text-sm text-ink-muted'}>{label}</button>)}
    </div>
    {loading ? <p className="mt-12 text-sm text-ink-muted">正在加载…</p> : error ? <p role="alert" className="mt-12 text-sm text-rose-600">{error}</p> : <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {visibleItems.map((item) => <CreationCard key={item.id} item={item} />)}
      {visibleItems.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-5 text-sm text-ink-muted">还没有{filter === 'all' ? '' : filter === 'website' ? '网站' : '图片'}创作。</p> : null}
      <article className="rounded-2xl border border-dashed border-line p-5 text-ink-muted"><span className="text-xs font-semibold">视频</span><h2 className="mt-4 font-semibold text-ink">即将支持</h2><p className="mt-2 text-sm">视频生成完成后将自动汇集到这里。</p></article>
    </section>}
  </main>
}

function CreationCard({ item }: { item: CreativeItem }) {
  const expiryLabel = creationExpiryLabel(item)
  return <article className="rounded-2xl border border-line bg-surface-card p-5">
    <div className="flex items-center justify-between"><span className="rounded-full bg-brand/10 px-2 py-1 text-xs font-semibold text-brand-hover">{item.type === 'website' ? '网站' : '图片'}</span><span className="text-xs text-ink-muted">{item.status}</span></div>
    <h2 className="mt-4 line-clamp-2 font-semibold">{item.title}</h2>
    <p className="mt-3 text-xs text-ink-muted">创建于 {new Date(item.createdAt).toLocaleString('zh-CN')}</p>
    {expiryLabel ? <p className="mt-1 text-xs text-ink-muted">{expiryLabel}</p> : null}
    {item.type === 'website' && item.threadId ? <Link className="mt-4 inline-block text-sm font-semibold text-brand-hover" href={`/?thread=${encodeURIComponent(item.threadId)}`}>查看生成对话 →</Link> : null}
    {item.type === 'website' && item.status === 'succeeded' && item.projectId ? <a className="mt-3 mr-3 inline-block text-sm font-semibold text-brand-hover" href={client.creations.previewWebsiteUrl(item.projectId)} target="_blank" rel="noopener noreferrer">打开预览 ↗</a> : null}
    {item.type === 'website' && item.assets?.filter((asset) => asset.downloadUrl).map((asset) => <a key={asset.id} className="mt-3 mr-3 inline-block text-sm font-semibold text-brand-hover" href={asset.downloadUrl}>下载 {asset.name}</a>)}
  </article>
}
