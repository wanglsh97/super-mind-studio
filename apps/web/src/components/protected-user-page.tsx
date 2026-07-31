'use client'

import { usePathname, useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { useEffect } from 'react'

import { sanitizeUserReturnTo } from '@/utils/auth/user-auth-client'
import { useUserSession } from './user-session-provider'

export function ProtectedUserPage({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const router = useRouter()
  const session = useUserSession()

  useEffect(() => {
    if (session.status !== 'unauthenticated') return
    const returnTo = sanitizeUserReturnTo(pathname)
    router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
  }, [pathname, router, session.status])

  if (session.status === 'authenticated') return children
  if (session.status === 'error') {
    return (
      <main className="mx-auto max-w-2xl px-5 py-20 text-center">
        <p role="alert" className="text-rose-700 dark:text-rose-300">
          {session.error}
        </p>
        <button
          type="button"
          onClick={() => void session.refresh()}
          className="mt-5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold dark:border-white/15"
        >
          重试
        </button>
      </main>
    )
  }
  return (
    <main className="mx-auto max-w-2xl px-5 py-20 text-center text-sm text-slate-500">
      {session.status === 'unauthenticated' ? '正在前往登录页…' : '正在恢复用户会话…'}
    </main>
  )
}
