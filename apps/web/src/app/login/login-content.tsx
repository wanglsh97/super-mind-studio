'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { BrandMark } from '../../components/brand-mark'
import { ThemeToggle } from '../../components/theme-toggle'
import { useUserSession } from '../../components/user-session-provider'
import { cn } from '../../lib/cn'
import {
  githubLoginUrl,
  googleLoginUrl,
  loginAnonymously,
  sanitizeUserReturnTo,
  userLoginErrorMessage,
} from '../../lib/user-auth-client'
import styles from './login.module.css'

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand-focus focus-visible:outline-offset-3'

export function LoginContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const session = useUserSession()
  const [leaving, setLeaving] = useState<'github' | 'google' | null>(null)
  const [anonymousBusy, setAnonymousBusy] = useState(false)
  const [anonymousError, setAnonymousError] = useState('')
  const returnTo = sanitizeUserReturnTo(searchParams.get('returnTo'))
  const errorMessage = userLoginErrorMessage(searchParams.get('error'))

  useEffect(() => {
    if (session.status === 'authenticated') router.replace(returnTo)
  }, [returnTo, router, session.status])

  async function continueAnonymously() {
    if (anonymousBusy || leaving !== null) return
    setAnonymousBusy(true)
    setAnonymousError('')
    try {
      const result = await loginAnonymously(returnTo)
      await session.refresh()
      router.replace(result.returnTo)
    } catch (cause) {
      setAnonymousError(cause instanceof Error ? cause.message : 'Anonymous sign-in failed')
      setAnonymousBusy(false)
    }
  }

  return (
    <main
      data-login-shell
      className={cn(
        styles.shell,
        'relative min-h-screen min-w-[1366px] overflow-hidden px-12 py-9',
      )}
    >
      <header className="relative z-10 mx-auto flex w-full max-w-[74rem] items-center justify-between">
        <a href="/" className={cn('flex items-center gap-3 rounded-xl', focusRing)}>
          <BrandMark className="size-10 object-contain" alt="" />
          <span className="font-display text-base font-bold tracking-[-0.01em] text-ink">
            Super Mind Studio
          </span>
        </a>
        <ThemeToggle />
      </header>

      <div className="relative z-1 mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-[74rem] grid-cols-[minmax(0,1.15fr)_minmax(25rem,0.85fr)] items-center gap-16 py-12">
        <section aria-labelledby="login-title" className="w-full max-w-[39rem]">
          <p className="font-mono text-[0.65rem] font-bold tracking-[0.18em] text-brand uppercase">
            Your AI workspace
          </p>
          <h1
            id="login-title"
            className="mt-5 max-w-[10ch] font-display text-[5.1rem] leading-[0.96] font-bold tracking-[-0.065em] text-ink"
          >
            让每个想法
            <span className="block text-brand">开始工作。</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-base leading-7 text-ink-muted">
            选择一种身份进入统一工作台。三种方式拥有相同能力，身份与数据彼此独立。
          </p>

          <div className={cn(styles.routeMap, 'mt-7 max-w-[34rem]')} aria-hidden="true">
            <IdentityNode className="top-[3.1rem]" label="GH" />
            <IdentityNode className="top-1/2 -translate-y-1/2" label="G" google />
            <IdentityNode className="bottom-[3.1rem]" label="A" anonymous />
            <div className={cn(styles.route, styles.routeGithub)}>
              <span className={styles.routePulse} />
            </div>
            <div className={cn(styles.route, styles.routeGoogle)}>
              <span className={styles.routePulse} />
            </div>
            <div className={cn(styles.route, styles.routeAnonymous)}>
              <span className={styles.routePulse} />
            </div>
            <div className={styles.destination}>
              <BrandMark className="size-[4.5rem] object-contain" alt="" />
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[0.6rem] tracking-[0.08em] text-ink-subtle uppercase">
            <span>Agent workspace</span>
            <span>Model compare</span>
            <span>Skill market</span>
          </div>
        </section>

        <section
          className="liquid-glass relative w-full max-w-[29rem] overflow-hidden rounded-[2rem] p-9"
          aria-labelledby="login-options-title"
        >
          <div className="relative z-1">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="font-mono text-[0.6rem] font-bold tracking-[0.15em] text-brand uppercase">
                  Sign in
                </p>
                <h2
                  id="login-options-title"
                  className="mt-2 font-display text-[1.75rem] font-bold tracking-[-0.035em] text-ink"
                >
                  选择登录方式
                </h2>
              </div>
              <span className="rounded-full border border-brand/15 bg-brand/7 px-3 py-1.5 font-mono text-[0.52rem] tracking-[0.08em] text-brand">
                功能一致
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-ink-muted">
              OAuth 仅用于确认身份，我们不会保存第三方访问令牌。
            </p>

            {errorMessage && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-[#f2b8aa] bg-[#fff0ec] px-4 py-3 text-xs leading-relaxed text-[#a73c29] dark:border-[#6b3a36] dark:bg-[#321d21] dark:text-[#ffb5a5]"
              >
                {errorMessage}
              </div>
            )}

            <div className="mt-7 grid gap-3">
              <a
                href={githubLoginUrl(returnTo)}
                aria-disabled={leaving !== null || anonymousBusy}
                onClick={() => setLeaving('github')}
                className={cn(
                  'group flex min-h-[4.5rem] items-center gap-4 rounded-2xl border border-line bg-surface-card/76 px-4 text-left transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_14px_32px_rgb(39_100_255/0.1)] dark:bg-white/[0.04]',
                  (leaving !== null || anonymousBusy) && 'pointer-events-none opacity-60',
                  focusRing,
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#111827] text-white dark:bg-white dark:text-[#111827]">
                  <svg className="size-5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.08c.98 0 1.95.13 2.86.38 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.32c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"
                    />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm text-ink">
                    {leaving === 'github'
                      ? '正在打开 GitHub…'
                      : errorMessage
                        ? '重新使用 GitHub 登录'
                        : '使用 GitHub 登录'}
                  </strong>
                  <span className="mt-1 block text-[0.68rem] text-ink-subtle">
                    使用 GitHub 公开资料确认身份
                  </span>
                </span>
                <ArrowIcon />
              </a>

              <a
                href={googleLoginUrl(returnTo)}
                aria-disabled={leaving !== null || anonymousBusy}
                onClick={() => setLeaving('google')}
                className={cn(
                  'group flex min-h-[4.5rem] items-center gap-4 rounded-2xl border border-line bg-surface-card/76 px-4 text-left transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-[0_14px_32px_rgb(39_100_255/0.1)] dark:bg-white/[0.04]',
                  (leaving !== null || anonymousBusy) && 'pointer-events-none opacity-60',
                  focusRing,
                )}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-soft bg-white">
                  <GoogleIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm text-ink">
                    {leaving === 'google' ? '正在打开 Google…' : '使用 Google 登录'}
                  </strong>
                  <span className="mt-1 block text-[0.68rem] text-ink-subtle">
                    使用 Google 公开资料确认身份
                  </span>
                </span>
                <ArrowIcon />
              </a>
            </div>

            <div className="my-6 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-line-soft" />
              <span className="font-mono text-[0.52rem] tracking-[0.12em] text-ink-subtle uppercase">
                或者
              </span>
              <span className="h-px flex-1 bg-line-soft" />
            </div>

            <button
              type="button"
              disabled={anonymousBusy || leaving !== null}
              onClick={() => void continueAnonymously()}
              className={cn(
                'group flex min-h-[4.5rem] w-full cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-line bg-transparent px-4 text-left transition-[background,border-color] hover:border-mint hover:bg-mint/6',
                'disabled:pointer-events-none disabled:opacity-45',
                'motion-reduce:transition-none',
                focusRing,
              )}
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-mint/12 font-mono text-xs font-bold text-cyan dark:text-mint">
                A
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block text-sm text-ink">
                  {anonymousBusy ? '正在创建匿名身份…' : '匿名进入'}
                </strong>
                <span className="mt-1 block text-[0.68rem] leading-4 text-ink-subtle">
                  无需授权；退出或会话到期后无法找回这次身份
                </span>
              </span>
              <ArrowIcon />
            </button>
            {anonymousError ? (
              <p role="alert" className="mt-3 text-xs leading-5 text-danger">
                {anonymousError}
              </p>
            ) : null}
            <p className="mt-6 text-center text-[0.65rem] leading-5 text-ink-subtle">
              继续即表示你选择以该身份创建独立的工作区会话。
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}

function IdentityNode({
  anonymous = false,
  className,
  google = false,
  label,
}: Readonly<{
  anonymous?: boolean
  className?: string
  google?: boolean
  label: string
}>) {
  return (
    <span
      className={cn(
        'absolute left-0 grid size-11 place-items-center rounded-xl border border-line bg-surface-card font-mono text-[0.62rem] font-bold text-ink shadow-[0_8px_20px_rgb(44_74_120/0.08)]',
        google && 'text-[#4285f4]',
        anonymous && 'border-mint/30 bg-mint/8 text-cyan dark:text-mint',
        className,
      )}
    >
      {label}
    </span>
  )
}

function ArrowIcon() {
  return (
    <svg
      className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path d="M4 10h11m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function GoogleIcon() {
  return (
    <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.06v2.62A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.93A6 6 0 0 1 6.09 12c0-.67.12-1.32.31-1.93V7.45H3.06A10 10 0 0 0 2 12c0 1.63.39 3.18 1.06 4.55l3.34-2.62Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.94c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.94 5.45l3.34 2.62C7.19 7.7 9.4 5.94 12 5.94Z"
      />
    </svg>
  )
}
