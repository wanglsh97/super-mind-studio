'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { logoutUser, sanitizeUserReturnTo } from '../lib/user-auth-client'
import { ThemeToggle } from './theme-toggle'
import { useUserSession } from './user-session-provider'

const navigation = [
  { href: '/agent', label: 'Agent' },
  { href: '/image', label: '文生图' },
  { href: '/prompt', label: 'Prompt 优化' },
]

export function SiteHeader() {
  const router = useRouter()
  const pathname = usePathname()
  const session = useUserSession()
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    setAvatarFailed(false)
  }, [session.user?.avatarUrl])

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logoutUser()
    } finally {
      session.clear()
      const returnTo = sanitizeUserReturnTo(pathname)
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      router.refresh()
      setLoggingOut(false)
    }
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[#ded9e8]/90 bg-[#f4f2f8]/85 px-5 py-3 backdrop-blur-xl sm:px-8 lg:px-10 dark:border-[#302943] dark:bg-[#110e1a]/85">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 sm:justify-start">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md font-semibold tracking-tight text-[#211b32] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#7057e8] dark:text-white"
          aria-label="Super Mind Studio 首页"
        >
          <span className="grid h-8 w-8 rotate-45 place-items-center rounded-[0.55rem] bg-[#7057e8] text-xs font-bold text-white shadow-sm">
            <span className="-rotate-45">SM</span>
          </span>
          <span>Super Mind Studio</span>
        </Link>

        <div className="order-2 flex items-center gap-2 sm:order-3 sm:ml-3">
          {session.status === 'authenticated' && session.user ? (
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white/75 p-1 pr-2 shadow-sm dark:border-white/10 dark:bg-white/5">
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-[0.65rem] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {session.user.avatarUrl && !avatarFailed ? (
                  // GitHub controls this HTTPS avatar URL; failure falls back to local initials.
                  <img
                    src={session.user.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  session.user.githubUsername.slice(0, 2).toUpperCase()
                )}
              </span>
              <span className="hidden max-w-32 truncate text-xs font-semibold md:inline">
                {session.user.githubUsername}
              </span>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void logout()}
                className="rounded-full px-2 py-1 text-[0.68rem] text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:hover:bg-white/10 dark:hover:text-white"
              >
                {loggingOut ? '退出中…' : '退出'}
              </button>
            </div>
          ) : session.status === 'unauthenticated' ? (
            <Link
              href={`/login?returnTo=${encodeURIComponent(sanitizeUserReturnTo(pathname))}`}
              className="rounded-full border border-[#ded9e8] bg-white/75 px-3 py-2 text-xs font-semibold shadow-sm transition hover:border-[#7057e8] hover:text-[#7057e8] dark:border-white/10 dark:bg-white/5"
            >
              GitHub 登录
            </Link>
          ) : null}
          <ThemeToggle />
        </div>

        <nav
          className="order-3 mt-3 grid w-full grid-cols-3 rounded-xl border border-[#ded9e8] bg-white/60 p-1 text-center text-xs font-medium text-[#70677f] shadow-sm sm:order-2 sm:ml-auto sm:mt-0 sm:flex sm:w-auto sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
          aria-label="主要导航"
        >
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 transition hover:bg-[#ebe7f3] hover:text-[#4d38b8] focus-visible:outline-2 focus-visible:outline-[#7057e8] sm:px-3.5 dark:hover:bg-white/10 dark:hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}
