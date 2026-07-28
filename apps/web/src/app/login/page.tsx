import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LoginContent } from './login-content'

export const metadata: Metadata = { title: '登录 | Super Mind Studio' }

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main
          data-login-shell
          className="grid min-h-screen min-w-[1366px] place-items-center px-5 text-sm text-ink-muted"
        >
          正在准备登录…
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
