'use client';

import { useEffect } from 'react';

import './globals.css';

export default function GlobalError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error('Unhandled application error', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <main className="grid min-h-dvh place-items-center bg-surface px-6 py-12 text-ink">
          <section className="w-full max-w-md border-y border-line-soft py-9 text-center">
            <p className="text-xs font-semibold tracking-[0.18em] text-ink-subtle">
              SUPER MIND STUDIO
            </p>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">页面暂时无法打开</h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">
              应用遇到了意外问题。你可以重新尝试，或返回工作台继续操作。
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-focus"
              >
                重新尝试
              </button>
              <a
                href="/"
                className="rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-brand-focus"
              >
                返回首页
              </a>
            </div>
            {error.digest ? (
              <p className="mt-6 text-xs text-ink-subtle">错误标识：{error.digest}</p>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
