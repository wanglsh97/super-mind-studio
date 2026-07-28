'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { BrandMark } from '../../components/brand-mark'
import { useUserSession } from '../../components/user-session-provider'
import { cn } from '../../lib/cn'
import {
  githubLoginUrl,
  googleLoginUrl,
  loginAnonymously,
  sanitizeUserReturnTo,
  userLoginErrorMessage,
} from '../../lib/user-auth-client'

const focusRing =
  'focus-visible:outline-3 focus-visible:outline-brand focus-visible:outline-offset-4'

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
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-6 py-12 md:px-10">
      <div className="w-full max-w-[38rem]">
        <section
          className="liquid-glass relative overflow-hidden rounded-[2.2rem] p-8 md:p-12"
          aria-labelledby="login-title"
        >
          <div className="pointer-events-none absolute top-0 right-0 size-[4.5rem] border-b border-l border-line bg-brand-subtle [clip-path:polygon(100%_0,100%_100%,0_0)] dark:border-[#403654] dark:bg-brand-subtle" />
          <div className="absolute top-4 right-4 z-1 font-mono text-[0.5rem] tracking-widest text-ink-subtle">
            ACCESS / 01
          </div>
          <div className="liquid-glass-soft mx-auto grid size-16 place-items-center rounded-[1.25rem] border-brand/20 bg-brand/10 shadow-[inset_0_1px_0_rgb(255_255_255/0.82),0_10px_28px_rgb(39_100_255/0.16)] dark:border-brand/25 dark:bg-brand/14">
            <BrandMark className="size-[3.65rem] object-contain" alt="Super Mind Studio" />
          </div>
          <p className="mt-8 text-center font-mono text-[0.62rem] font-bold tracking-[0.13em] text-brand">
            USER SIGN IN
          </p>
          {errorMessage && (
            <div
              role="alert"
              className="mt-5 rounded-md border border-[#f2b8aa] bg-[#fff0ec] px-4 py-3 text-xs leading-relaxed text-[#a73c29] dark:border-[#6b3a36] dark:bg-[#321d21] dark:text-[#ffb5a5]"
            >
              {errorMessage}
            </div>
          )}

          <a
            href={githubLoginUrl(returnTo)}
            aria-disabled={leaving !== null || anonymousBusy}
            onClick={() => setLeaving('github')}
            className={cn(
              'liquid-button relative z-1 mt-8 flex min-h-14 items-center justify-center gap-3 rounded-2xl px-5 text-sm font-bold transition-[transform,box-shadow] hover:-translate-y-0.5',
              (leaving !== null || anonymousBusy) && 'pointer-events-none opacity-60',
              focusRing,
            )}
          >
            <svg
              className="size-[1.125rem] shrink-0"
              viewBox="0 0 24 24"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <path
                fill="currentColor"
                d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A11 11 0 0 1 12 6.08c.98 0 1.95.13 2.86.38 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.4-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.32c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"
              />
            </svg>
            <span>
              {leaving === 'github'
                ? 'OPENING GITHUB…'
                : errorMessage
                  ? 'TRY GITHUB AGAIN'
                  : 'CONTINUE WITH GITHUB'}
            </span>
          </a>

          <a
            href={googleLoginUrl(returnTo)}
            aria-disabled={leaving !== null || anonymousBusy}
            onClick={() => setLeaving('google')}
            className={cn(
              'relative z-1 mt-3 flex min-h-14 items-center justify-center gap-3 rounded-2xl border border-line bg-surface px-5 text-sm font-bold text-ink transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-brand/35 hover:shadow-[0_12px_30px_rgb(39_100_255/0.10)] dark:bg-surface-raised',
              (leaving !== null || anonymousBusy) && 'pointer-events-none opacity-60',
              focusRing,
            )}
          >
            <GoogleIcon />
            <span>{leaving === 'google' ? 'OPENING GOOGLE…' : 'CONTINUE WITH GOOGLE'}</span>
          </a>

          <div className="mt-4 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start max-sm:gap-2">
            <span className="font-mono text-[0.48rem] tracking-wide text-ink-subtle">
              SECURE OAUTH
            </span>
            <button
              type="button"
              disabled={anonymousBusy || leaving !== null}
              onClick={() => void continueAnonymously()}
              className={cn(
                'font-mono text-[0.48rem] tracking-wide text-ink-subtle transition-colors duration-150',
                'cursor-pointer hover:text-ink-muted',
                'disabled:pointer-events-none disabled:opacity-45',
                'motion-reduce:transition-none',
                focusRing,
              )}
            >
              {anonymousBusy ? 'Signing in…' : 'anonymously login'}
            </button>
          </div>
          {anonymousError ? (
            <p role="alert" className="mt-2 text-right text-[0.65rem] text-danger max-sm:text-left">
              {anonymousError}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  )
}

function GoogleIcon() {
  return (
    <svg className="size-[1.125rem] shrink-0" viewBox="0 0 24 24" aria-hidden="true">
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
