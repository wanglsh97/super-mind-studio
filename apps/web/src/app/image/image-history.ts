import type { ImageTask } from '@supermind/sdk'

export const IMAGE_HISTORY_KEY = 'aigateway-image-history-v1'
export const IMAGE_HISTORY_MAX = 5
export const IMAGE_HISTORY_TTL_MS = 30 * 24 * 60 * 60 * 1_000

export interface ImageHistoryEntry {
  prompt: string
  savedAt: string
  task: ImageTask
}

export function readImageHistory(value: string | null, now = Date.now()): ImageHistoryEntry[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ImageHistoryEntry => validEntry(item, now)).slice(0, 5)
  } catch {
    return []
  }
}

export function upsertImageHistory(
  entries: readonly ImageHistoryEntry[],
  entry: ImageHistoryEntry,
): ImageHistoryEntry[] {
  return [entry, ...entries.filter(({ task }) => task.taskId !== entry.task.taskId)].slice(
    0,
    IMAGE_HISTORY_MAX,
  )
}

function validEntry(value: unknown, now: number): value is ImageHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ImageHistoryEntry>
  const savedAt = typeof entry.savedAt === 'string' ? Date.parse(entry.savedAt) : Number.NaN
  const task = entry.task
  return (
    typeof entry.prompt === 'string' &&
    entry.prompt.length > 0 &&
    Number.isFinite(savedAt) &&
    now - savedAt <= IMAGE_HISTORY_TTL_MS &&
    now >= savedAt &&
    !!task &&
    typeof task.taskId === 'string' &&
    (task.model === 'wanxiang' || task.model === 'cogview') &&
    ['pending', 'running', 'succeeded', 'failed'].includes(task.status) &&
    Array.isArray(task.results)
  )
}
