'use client'

import { usePathname, useSearchParams } from 'next/navigation'

/** 仅在已挂起 Suspense 的叶子组件中使用，避免根布局被 searchParams 整树 CSR。 */
export function useAgentActiveThreadId(): string | null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  if (pathname !== '/') return null
  return searchParams.get('thread')
}
