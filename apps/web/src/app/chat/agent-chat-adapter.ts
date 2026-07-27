import type { AIGatewayClient, ChatMessage, TextModelId, Usage } from '@supermind/sdk'
import type { ChatModelAdapter, ThreadMessage } from '@assistant-ui/react'

export interface AgentChatOptions {
  model: TextModelId
  modelName: string
  temperature: number
  topP: number
  maxTokens: number
}

export interface AgentMessageMetadata extends Record<string, unknown> {
  model?: string
  requestId?: string
  usage?: Usage
}

export function createAgentChatAdapter(
  client: AIGatewayClient,
  getOptions: () => AgentChatOptions,
  onError?: (error: unknown) => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const options = getOptions()
      let content = ''
      let metadata: AgentMessageMetadata = { model: options.modelName }

      try {
        for await (const event of client.chat.stream(
          {
            model: options.model,
            messages: toGatewayMessages(messages),
            stream: true,
            temperature: options.temperature,
            topP: options.topP,
            maxTokens: options.maxTokens,
          },
          { signal: abortSignal },
        )) {
          if (event.type === 'start') {
            metadata = { ...metadata, requestId: event.requestId }
          } else if (event.type === 'delta') {
            content += event.content
          } else if (event.type === 'usage') {
            metadata = { ...metadata, usage: event.usage }
          } else if (event.type === 'error') {
            throw new Error(event.error.message)
          }

          yield {
            content: [{ type: 'text', text: content }],
            metadata: { custom: metadata },
          }
        }
      } catch (error) {
        onError?.(error)
        throw error
      }
    },
  }
}

export function toGatewayMessages(messages: readonly ThreadMessage[]): ChatMessage[] {
  const gatewayMessages: ChatMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      gatewayMessages.push({ role: 'system', content: textContent(message) })
    }
    if (message.role === 'user' || message.role === 'assistant') {
      gatewayMessages.push({ role: message.role, content: textContent(message) })
    }
  }
  return gatewayMessages
}

function textContent(message: ThreadMessage): string {
  return message.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
    .trim()
}
