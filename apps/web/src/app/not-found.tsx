import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-[calc(100dvh-4.5rem)] place-items-center bg-surface px-6 py-12 text-ink md:min-h-dvh">
      <section className="w-full max-w-md border-y border-line-soft py-9 text-center">
        <p className="text-xs font-semibold tracking-[0.18em] text-ink-subtle">SUPER MIND STUDIO</p>
        <p className="mt-4 text-sm font-semibold text-ink-subtle">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">找不到这个页面</h1>
        <p className="mt-3 text-sm leading-6 text-ink-muted">
          这个链接可能已失效，或页面地址输入有误。返回工作台后可以继续使用其他功能。
        </p>
        <Link
          href="/"
          className="mt-7 inline-flex rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-focus"
        >
          返回首页
        </Link>
      </section>
    </main>
  );
}
