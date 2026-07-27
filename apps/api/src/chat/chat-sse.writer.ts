import type { ChatSsePayload } from '@supermind/sdk'
import type { Response } from 'express'

const CHAT_SSE_DONE = '[DONE]'

export function writeChatSsePayload(response: Response, payload: ChatSsePayload): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

export function writeChatSseDone(response: Response): void {
  response.write(`data: ${CHAT_SSE_DONE}\n\n`)
}
