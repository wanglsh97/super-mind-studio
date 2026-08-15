'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createSuperMindClient, type CreativeItem } from '@supermind/sdk';

import { ProtectedUserPage } from '@/components/protected-user-page';
import { useUserSession } from '@/components/user-session-provider';
import { creationExpiryLabel, filterCreations, type CreationFilter } from './creations-view';

const client = createSuperMindClient();

export default function CreationsPage() {
  return (
    <ProtectedUserPage>
      <CreationsContent />
    </ProtectedUserPage>
  );
}

function CreationsContent() {
  const session = useUserSession();
  const [items, setItems] = useState<CreativeItem[]>([]);
  const [filter, setFilter] = useState<CreationFilter>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const visibleItems = useMemo(() => filterCreations(items, filter), [filter, items]);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    void client.creations
      .list()
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '加载创作失败'))
      .finally(() => setLoading(false));
  }, [session.status]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-ink-muted">Creative workspace</p>
          <h1 className="mt-1 text-3xl font-semibold">我的创作</h1>
        </div>
        <Link href="/" className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
          新建网页创作
        </Link>
      </div>
      <p className="mt-3 text-sm text-ink-muted">网站产物会在 30 天后自动删除；图片也会集中显示在这里。</p>
      <div className="mt-6 flex gap-2" aria-label="创作类型筛选">
        {(
          [
            ['all', '全部'],
            ['website', '网站'],
            ['image', '图片'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={
              filter === value
                ? 'rounded-full bg-brand px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-full border border-line px-3 py-1.5 text-sm text-ink-muted'
            }
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="mt-12 text-sm text-ink-muted">正在加载…</p>
      ) : error ? (
        <p role="alert" className="mt-12 text-sm text-rose-600">
          {error}
        </p>
      ) : (
        <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => (
            <CreationCard key={item.id} item={item} />
          ))}
          {visibleItems.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-5 text-sm text-ink-muted">
              还没有{filter === 'all' ? '' : filter === 'website' ? '网站' : '图片'}创作。
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}

function CreationCard({ item }: { item: CreativeItem }) {
  const expiryLabel = creationExpiryLabel(item);
  return (
    <article className="rounded-2xl border border-line bg-surface-card p-5">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-brand/10 px-2 py-1 text-xs font-semibold text-brand-hover">
          {item.type === 'website' ? '网站' : '图片'}
        </span>
        <span className="text-xs text-ink-muted">{item.status}</span>
      </div>
      <h2 className="mt-4 line-clamp-2 font-semibold">{item.title}</h2>
      {item.type === 'image' && item.assets?.[0]?.previewUrl ? (
        <img
          src={item.assets[0].previewUrl}
          alt={item.title}
          className="mt-4 aspect-square w-full rounded-xl bg-surface object-contain"
        />
      ) : null}
      <p className="mt-3 text-xs text-ink-muted">
        创建于 {new Date(item.createdAt).toLocaleString('zh-CN')}
      </p>
      {expiryLabel ? <p className="mt-1 text-xs text-ink-muted">{expiryLabel}</p> : null}
      {item.type === 'website' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.assets
            ?.filter((asset) => asset.downloadUrl)
            .map((asset) => (
              <a
                key={asset.id}
                href={asset.downloadUrl}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
              >
                下载 {asset.name}
              </a>
            ))}
          {item.threadId ? (
            <Link
              className="px-1 py-1.5 text-xs font-semibold text-brand-hover"
              href={`/?thread=${encodeURIComponent(item.threadId)}`}
            >
              查看生成对话 →
            </Link>
          ) : null}
        </div>
      ) : item.type === 'image' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.assets
            ?.filter((asset) => asset.downloadUrl)
            .map((asset) => (
              <a
                key={asset.id}
                href={asset.downloadUrl}
                className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand/40 hover:text-brand"
              >
                下载图片
              </a>
            ))}
        </div>
      ) : null}
    </article>
  );
}
