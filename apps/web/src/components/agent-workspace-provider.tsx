'use client'

import { createAIGatewayClient } from '@supermind/sdk'
import type {
  AgentRunSummary,
  AgentThinkingEffort,
  AgentThreadSummary,
  ModelSummary,
} from '@supermind/sdk'
import { usePathname, useRouter } from 'next/navigation'
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { useUserSession } from './user-session-provider'
import {
  removeActiveRun as removeActiveRunState,
  upsertActiveRun as upsertActiveRunState,
} from '@/utils/agent/agent-active-runs'

const client = createAIGatewayClient()

/** 与 API `AGENT_THREAD_TITLE_MAX_LENGTH` 对齐。 */
export const AGENT_THREAD_TITLE_MAX_LENGTH = 200

export type AgentWorkspaceValue = {
  threads: AgentThreadSummary[]
  models: ModelSummary[]
  selectedModel: string
  setSelectedModel: (modelId: string) => void
  thinkingEffort: AgentThinkingEffort
  setThinkingEffort: (effort: AgentThinkingEffort) => void
  loading: boolean
  listError: string | null
  /** 当前用户在不同 Thread 中进行中的 Agent runs。 */
  activeRuns: AgentRunSummary[]
  startNewThread: () => void
  openThread: (threadId: string) => void
  prependThread: (thread: AgentThreadSummary) => void
  refreshThreads: () => Promise<void>
  upsertActiveRun: (run: AgentRunSummary) => void
  removeActiveRun: (threadId: string) => void
  renameThread: (threadId: string, title: string) => Promise<AgentThreadSummary>
  deleteThread: (threadId: string) => Promise<void>
}

export const AgentWorkspaceContext = createContext<AgentWorkspaceValue | null>(null)

export function AgentWorkspaceProvider({ children }: Readonly<{ children: ReactNode }>) {
  const session = useUserSession()
  const router = useRouter()
  const pathname = usePathname()
  const onAgentRoute = pathname === '/'

  const [threads, setThreads] = useState<AgentThreadSummary[]>([])
  const [models, setModels] = useState<ModelSummary[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [thinkingEffort, setThinkingEffort] = useState<AgentThinkingEffort>('balanced')
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [activeRuns, setActiveRuns] = useState<AgentRunSummary[]>([])

  const refreshThreads = useCallback(async () => {
    const threadPage = await client.agent.threads.list()
    setThreads(threadPage.items)
    setActiveRuns(threadPage.activeRuns)
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
        setActiveRuns(threadPage.activeRuns)
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

  useEffect(() => {
    if (!onAgentRoute || session.status !== 'authenticated' || activeRuns.length === 0) return
    const timer = window.setInterval(() => {
      void refreshThreads().catch(() => undefined)
    }, 3_000)
    return () => window.clearInterval(timer)
  }, [activeRuns.length, onAgentRoute, refreshThreads, session.status])

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

  const upsertActiveRun = useCallback((run: AgentRunSummary) => {
    setActiveRuns((current) => upsertActiveRunState(current, run))
  }, [])

  const removeActiveRun = useCallback((threadId: string) => {
    setActiveRuns((current) => removeActiveRunState(current, threadId))
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
      thinkingEffort,
      setThinkingEffort,
      loading,
      listError,
      activeRuns,
      startNewThread,
      openThread,
      prependThread,
      refreshThreads,
      upsertActiveRun,
      removeActiveRun,
      renameThread,
      deleteThread,
    }),
    [
      threads,
      models,
      selectedModel,
      thinkingEffort,
      loading,
      listError,
      activeRuns,
      startNewThread,
      openThread,
      prependThread,
      refreshThreads,
      upsertActiveRun,
      removeActiveRun,
      renameThread,
      deleteThread,
    ],
  )

  return <AgentWorkspaceContext.Provider value={value}>{children}</AgentWorkspaceContext.Provider>
}
