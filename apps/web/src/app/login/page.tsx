import type { Metadata } from 'next'
import { Suspense } from 'react'

import { LoginContent } from './login-content'

export const metadata: Metadata = { title: 'Sign in' }

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="px-5 py-24 text-center text-sm text-slate-500">Preparing sign-in…</main>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
