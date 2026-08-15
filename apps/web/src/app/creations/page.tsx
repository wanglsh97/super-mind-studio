'use client';

import { useEffect, useMemo, useState } from 'react';
import { createSuperMindClient, type CreativeItem } from '@supermind/sdk';
import { DownloadIcon, PlayIcon } from 'lucide-react';

import { ProtectedUserPage } from '@/components/protected-user-page';
import { useUserSession } from '@/components/user-session-provider';
import { filterCreations, type CreationFilter } from './creations-view';

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
  const displayItems = useMemo(
    () => visibleItems.filter((item) => item.type !== 'website'),
    [visibleItems],
  );

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    void client.creations
      .list()
      .then(setItems)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '加载创作失败'))
      .finally(() => setLoading(false));
  }, [session.status]);

  return (
    <main className="mx-auto min-h-screen max-w-[1320px] px-4 py-6 sm:px-5 lg:px-6 lg:py-8">
      <div
        className="mx-auto grid w-full max-w-md grid-cols-4 rounded-full bg-[#f0f1f6] p-1 dark:bg-white/[0.07]"
        aria-label="创作类型筛选"
      >
        {(
          [
            ['all', '全部'],
            ['website', '网站'],
            ['image', '图片'],
            ['video', '视频'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
            className={
              filter === value
                ? 'rounded-full bg-white px-2.5 py-2 text-xs font-semibold text-ink shadow-[0_2px_8px_rgba(23,28,38,0.08)] transition sm:text-sm dark:bg-white/[0.12] dark:text-white'
                : 'rounded-full px-2.5 py-2 text-xs font-medium text-ink-muted transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:text-sm dark:hover:text-white'
            }
          >
            {label}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="mt-16 text-center text-sm text-ink-muted">正在加载…</p>
      ) : error ? (
        <p role="alert" className="mt-16 text-center text-sm text-rose-600">
          {error}
        </p>
      ) : (
        <section className="mt-8 columns-1 gap-3 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5">
          {displayItems.map((item) => (
            <CreationCard key={item.id} item={item} />
          ))}
          {displayItems.length === 0 ? (
            <p className="text-center text-sm text-ink-muted [column-span:all]">
              还没有
              {filter === 'all'
                ? ''
                : filter === 'website'
                  ? '网站'
                  : filter === 'image'
                    ? '图片'
                    : '视频'}
              创作。
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}

function CreationCard({ item }: { item: CreativeItem }) {
  const [hovered, setHovered] = useState(false);
  const asset = item.assets?.[0];
  const previewUrl = asset?.previewUrl;

  if (item.type === 'image' && previewUrl) {
    return (
      <article
        className="group relative mb-3 break-inside-avoid cursor-pointer overflow-hidden rounded-xl bg-surface"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setHovered(true)}
        onBlurCapture={() => setHovered(false)}
      >
        <img
          src={previewUrl}
          alt={item.title}
          className="h-auto w-full object-contain transition-transform duration-300 ease-out"
          style={{ transform: hovered ? 'scale(1.05)' : 'scale(1)' }}
        />
        {asset.downloadUrl ? (
          <DownloadOverlay href={asset.downloadUrl} title={`下载图片：${item.title}`} />
        ) : null}
      </article>
    );
  }

  if (item.type === 'video' && previewUrl) {
    return (
      <VideoCreation title={item.title} src={previewUrl} downloadUrl={asset.downloadUrl} />
    );
  }

  return null;
}

function VideoCreation({
  src,
  title,
  downloadUrl,
}: {
  src: string;
  title: string;
  downloadUrl: string | undefined;
}) {
  const [hovered, setHovered] = useState(false);
  const play = (video: HTMLVideoElement) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void video.play().catch(() => undefined);
  };
  const reset = (video: HTMLVideoElement) => {
    video.pause();
    video.currentTime = 0;
  };

  return (
    <article
      className="group relative mb-3 break-inside-avoid cursor-pointer overflow-hidden rounded-xl bg-black"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={() => setHovered(false)}
    >
      <video
        src={src}
        aria-label={title}
        muted
        loop
        playsInline
        tabIndex={0}
        preload="metadata"
        onMouseEnter={(event) => play(event.currentTarget)}
        onMouseLeave={(event) => reset(event.currentTarget)}
        onFocus={(event) => play(event.currentTarget)}
        onBlur={(event) => reset(event.currentTarget)}
        className="aspect-video w-full object-cover transition-transform duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
        style={{ transform: hovered ? 'scale(1.05)' : 'scale(1)' }}
      />
      <span className="pointer-events-none absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-full bg-black/55 text-white shadow-sm backdrop-blur-sm">
        <PlayIcon aria-hidden="true" className="ml-0.5 size-3.5 fill-current" />
      </span>
      {downloadUrl ? <DownloadOverlay href={downloadUrl} title={`下载视频：${title}`} /> : null}
    </article>
  );
}

function DownloadOverlay({ href, title }: { href: string; title: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 flex h-1/2 items-end justify-end p-3 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-within:opacity-100"
      style={{
        backgroundImage:
          'linear-gradient(to top, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.2) 52%, transparent)',
      }}
    >
      <a
        href={href}
        download
        aria-label={title}
        title={title}
        className="pointer-events-auto grid size-8 translate-y-1 place-items-center rounded-full text-white transition duration-300 ease-out group-hover:translate-y-0 hover:bg-white/15 group-focus-within:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <DownloadIcon aria-hidden="true" className="size-5" />
      </a>
    </div>
  );
}
