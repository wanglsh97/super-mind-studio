'use client'

import { useContext } from 'react'

import {
  AgentWorkspaceContext,
  type AgentWorkspaceValue,
} from '@/components/agent-workspace-provider'

export function useAgentWorkspace(): AgentWorkspaceValue {
  const value = useContext(AgentWorkspaceContext)
  if (!value) {
    throw new Error('useAgentWorkspace 必须在 AgentWorkspaceProvider 内使用')
  }
  return value
}
