import type {
  AgentMessage,
  AgentMessagePart,
  AgentRunLimitReason,
  AgentRunStatus,
  AgentRunUsage,
  AgentStreamEvent,
  GatewayError,
  AgentContextBudgetState,
} from '@supermind/sdk'

/**
 * 纯函数：把 Agent run 事件流折叠为消息视图。
 *
 * 产出的消息与服务端持久化的 AgentMessage 形状一致（parts: text/reasoning/tool-call/
 * tool-result），因此页面对“已持久化历史消息”和“实时 run 消息”可用同一渲染器。
 */
export interface AgentRunViewState {
  status: AgentRunStatus | 'idle'
  limitReason: AgentRunLimitReason | null
  messages: AgentMessage[]
  usage: AgentRunUsage | null
  error: GatewayError | null
  contextBudget: AgentContextBudgetState | null
  compressionEvents: Extract<AgentStreamEvent, { type: 'context-compressed' }>[]
}

export function initialAgentRunViewState(): AgentRunViewState {
  return {
    status: 'idle',
    limitReason: null,
    messages: [],
    usage: null,
    error: null,
    contextBudget: null,
    compressionEvents: [],
  }
}

export function reduceAgentEvent(
  state: AgentRunViewState,
  event: AgentStreamEvent,
): AgentRunViewState {
  switch (event.type) {
    case 'run-status':
      return { ...state, status: event.status }
    case 'run-terminal':
      return { ...state, status: event.status, limitReason: event.limitReason }
    case 'message-start':
      if (event.role !== 'assistant') return state
      return {
        ...state,
        messages: [
          ...state.messages,
          { id: event.messageId, role: 'assistant', parts: [], createdAt: '' },
        ],
      }
    case 'text-delta':
      return appendDelta(state, event.messageId, 'text', event.delta)
    case 'reasoning-delta':
      return appendDelta(state, event.messageId, 'reasoning', event.delta)
    case 'context-budget':
      return { ...state, contextBudget: event }
    case 'context-compressed':
      return { ...state, compressionEvents: [...state.compressionEvents, event] }
    case 'tool-call':
      return upsertAssistantPart(state, event.messageId, {
        type: 'tool-call',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      })
    case 'tool-result':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: event.toolCallId,
            role: 'tool',
            parts: [
              {
                type: 'tool-result',
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                status: event.status,
                isError: event.isError,
                summary: event.summary,
                ...(event.audit === undefined ? {} : { audit: event.audit }),
              },
            ],
            createdAt: '',
          },
        ],
      }
    case 'usage':
      return { ...state, usage: event.usage }
    case 'error':
      return { ...state, error: event.error }
    case 'tool-status':
    case 'message-end':
      return state
    default:
      return state
  }
}

export function reduceAgentEvents(
  state: AgentRunViewState,
  events: readonly AgentStreamEvent[],
): AgentRunViewState {
  return events.reduce(reduceAgentEvent, state)
}

function ensureAssistant(state: AgentRunViewState, messageId: string): AgentRunViewState {
  if (state.messages.some((message) => message.id === messageId)) return state
  return {
    ...state,
    messages: [...state.messages, { id: messageId, role: 'assistant', parts: [], createdAt: '' }],
  }
}

function appendDelta(
  state: AgentRunViewState,
  messageId: string,
  kind: 'text' | 'reasoning',
  delta: string,
): AgentRunViewState {
  const ensured = ensureAssistant(state, messageId)
  return {
    ...ensured,
    messages: ensured.messages.map((message) => {
      if (message.id !== messageId) return message
      const parts = [...message.parts]
      const last = parts.at(-1)
      if (last && last.type === kind) {
        parts[parts.length - 1] = { type: kind, text: last.text + delta }
      } else {
        parts.push(
          kind === 'text' ? { type: 'text', text: delta } : { type: 'reasoning', text: delta },
        )
      }
      return { ...message, parts }
    }),
  }
}

function upsertAssistantPart(
  state: AgentRunViewState,
  messageId: string,
  part: AgentMessagePart,
): AgentRunViewState {
  const ensured = ensureAssistant(state, messageId)
  return {
    ...ensured,
    messages: ensured.messages.map((message) =>
      message.id === messageId ? { ...message, parts: [...message.parts, part] } : message,
    ),
  }
}

export function isActiveStatus(status: AgentRunStatus | 'idle'): boolean {
  return status === 'running' || status === 'cancelling' || status === 'waiting_for_user'
}
