'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useRef } from 'react'

import { useUserSession } from '@/components/user-session-provider'
import { sanitizeUserReturnTo } from '@/utils/auth/user-auth-client'

export function isUserAuthenticationFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.name === 'AIGatewayAuthenticationError' &&
    'status' in error &&
    error.status === 401
  )
}

export function useAuthenticationFailure(): (error: unknown) => boolean {
  const pathname = usePathname()
  const router = useRouter()
  const session = useUserSession()
  const redirecting = useRef(false)

  return useCallback(
    (error: unknown) => {
      if (!isUserAuthenticationFailure(error)) return false
      if (redirecting.current) return true
      redirecting.current = true
      session.clear()
      const returnTo = sanitizeUserReturnTo(pathname)
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      return true
    },
    [pathname, router, session],
  )
}
