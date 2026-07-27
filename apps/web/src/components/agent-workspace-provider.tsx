'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type { AgentRunSummary, AgentThreadSummary, ModelSummary } from '@supermind/sdk'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useUserSession } from './user-session-provider'

const client = createAIGatewayClient()

/** 与 API `AGENT_THREAD_TITLE_MAX_LENGTH` 对齐。 */
export const AGENT_THREAD_TITLE_MAX_LENGTH = 200

type AgentWorkspaceValue = {
  threads: AgentThreadSummary[]
  models: ModelSummary[]
  selectedModel: string
  setSelectedModel: (modelId: string) => void
  loading: boolean
  listError: string | null
  /** 当前用户全局进行中的 Agent run；非空时禁用所有 Composer 提交。 */
  userActiveRun: AgentRunSummary | null
  startNewThread: () => void
  openThread: (threadId: string) => void
  prependThread: (thread: AgentThreadSummary) => void
  refreshThreads: () => Promise<void>
  setUserActiveRun: (run: AgentRunSummary | null) => void
  renameThread: (threadId: string, title: string) => Promise<AgentThreadSummary>
  deleteThread: (threadId: string) => Promise<void>
}

const AgentWorkspaceContext = createContext<AgentWorkspaceValue | null>(null)

export function AgentWorkspaceProvider({ children }: Readonly<{ children: ReactNode }>) {
  const session = useUserSession()
  const router = useRouter()
  const pathname = usePathname()
  const onAgentRoute = pathname === '/'

  const [threads, setThreads] = useState<AgentThreadSummary[]>([])
  const [models, setModels] = useState<ModelSummary[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [userActiveRun, setUserActiveRun] = useState<AgentRunSummary | null>(null)

  const refreshThreads = useCallback(async () => {
    const threadPage = await client.agent.threads.list()
    setThreads(threadPage.items)
    setUserActiveRun(threadPage.activeRun)
  }, [])

  useEffect(() => {
    if (!onAgentRoute || session.status !== 'authenticated') return
    let cancelled = false
    setLoading(true)
    setListError(null)
    void (async () => {
      try {
        const [threadPage, modelList] = await Promise.all([
          client.agent.threads.list(),
          client.models.list(),
        ])
        if (cancelled) return
        setThreads(threadPage.items)
        setUserActiveRun(threadPage.activeRun)
        const usable = modelList.filter(
          (model) => model.enabled && model.capabilities.includes('agent'),
        )
        setModels(usable)
        setSelectedModel((current) => current || usable[0]?.id || '')
      } catch (unknownError) {
        if (!cancelled) {
          setListError(unknownError instanceof Error ? unknownError.message : '加载 Agent 会话失败')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onAgentRoute, session.status])

  const startNewThread = useCallback(() => {
    router.push('/')
  }, [router])

  const openThread = useCallback(
    (threadId: string) => {
      const thread = threads.find((item) => item.id === threadId)
      if (thread) setSelectedModel(thread.model)
      router.push(`/?thread=${encodeURIComponent(threadId)}`)
    },
    [router, threads],
  )

  const prependThread = useCallback((thread: AgentThreadSummary) => {
    setThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)])
  }, [])

  const renameThread = useCallback(async (threadId: string, title: string) => {
    const updated = await client.agent.threads.rename(threadId, { title })
    setThreads((current) => {
      const next = current.map((item) => (item.id === threadId ? updated : item))
      return next.sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )
    })
    return updated
  }, [])

  const deleteThread = useCallback(
    async (threadId: string) => {
      await client.agent.threads.delete(threadId)
      setThreads((current) => current.filter((item) => item.id !== threadId))
      const params = new URLSearchParams(window.location.search)
      if (params.get('thread') === threadId) {
        router.push('/')
      }
    },
    [router],
  )

  const value = useMemo<AgentWorkspaceValue>(
    () => ({
      threads,
      models,
      selectedModel,
      setSelectedModel,
      loading,
      listError,
      userActiveRun,
      startNewThread,
      openThread,
      prependThread,
      refreshThreads,
      setUserActiveRun,
      renameThread,
      deleteThread,
    }),
    [
      threads,
      models,
      selectedModel,
      loading,
      listError,
      userActiveRun,
      startNewThread,
      openThread,
      prependThread,
      refreshThreads,
      renameThread,
      deleteThread,
    ],
  )

  return <AgentWorkspaceContext.Provider value={value}>{children}</AgentWorkspaceContext.Provider>
}

export function useAgentWorkspace(): AgentWorkspaceValue {
  const value = useContext(AgentWorkspaceContext)
  if (!value) {
    throw new Error('useAgentWorkspace 必须在 AgentWorkspaceProvider 内使用')
  }
  return value
}

/** 仅在已挂起 Suspense 的叶子组件中使用，避免根布局被 searchParams 整树 CSR。 */
export function useAgentActiveThreadId(): string | null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  if (pathname !== '/') return null
  return searchParams.get('thread')
}
