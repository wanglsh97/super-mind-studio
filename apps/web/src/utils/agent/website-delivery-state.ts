import type { CreativeItem } from '@supermind/sdk'

export type WebsiteDeliveryCardState = 'current' | 'superseded'

export function resolveWebsiteDeliveryCardState(
  items: readonly CreativeItem[],
  projectId: string,
  runId: string,
): WebsiteDeliveryCardState {
  const current = items.find((item) => item.type === 'website' && item.projectId === projectId)
  return current?.runId === runId ? 'current' : 'superseded'
}
