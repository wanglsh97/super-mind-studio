'use client'

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { getUserSession, type UserSessionProfile, UserAuthApiError } from '@/utils/auth/user-auth-client'

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error'

interface UserSessionContextValue {
  status: SessionStatus
  user: UserSessionProfile | null
  error: string
  refresh(): Promise<void>
  clear(): void
}

const UserSessionContext = createContext<UserSessionContextValue | null>(null)

export function UserSessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [user, setUser] = useState<UserSessionProfile | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setStatus('loading')
    setError('')
    try {
      const restored = await getUserSession()
      setUser(restored.user)
      setStatus('authenticated')
    } catch (cause) {
      setUser(null)
      if (cause instanceof UserAuthApiError && cause.status === 401) {
        setStatus('unauthenticated')
        return
      }
      setError(cause instanceof Error ? cause.message : '用户会话恢复失败')
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<UserSessionContextValue>(
    () => ({
      status,
      user,
      error,
      refresh,
      clear: () => {
        setUser(null)
        setStatus('unauthenticated')
        setError('')
      },
    }),
    [error, refresh, status, user],
  )

  return <UserSessionContext.Provider value={value}>{children}</UserSessionContext.Provider>
}

export function useUserSession(): UserSessionContextValue {
  const value = useContext(UserSessionContext)
  if (!value) throw new Error('useUserSession requires UserSessionProvider')
  return value
}
