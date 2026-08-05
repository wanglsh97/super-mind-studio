import type { CreativeItem } from '@supermind/sdk'

export type CreationFilter = 'all' | 'website' | 'image'

export function filterCreations(items: readonly CreativeItem[], filter: CreationFilter): CreativeItem[] {
  return filter === 'all' ? [...items] : items.filter((item) => item.type === filter)
}

export function creationExpiryLabel(item: Pick<CreativeItem, 'expiresAt' | 'status'>): string | null {
  if (!item.expiresAt) return null
  if (item.status === 'expired') return '产物已过期'
  return `将于 ${new Date(item.expiresAt).toLocaleDateString('zh-CN')} 删除`
}
