const WEBSITE_MODE_STORAGE_PREFIX = 'supermind:website-mode:'

export function websiteModeStorageKey(threadId: string | null): string {
  return `${WEBSITE_MODE_STORAGE_PREFIX}${threadId ?? 'new'}`
}

export function readWebsiteMode(
  storage: Pick<Storage, 'getItem'>,
  threadId: string | null,
): boolean {
  try {
    return storage.getItem(websiteModeStorageKey(threadId)) === '1'
  } catch {
    return false
  }
}

export function writeWebsiteMode(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  threadId: string | null,
  selected: boolean,
): void {
  try {
    const key = websiteModeStorageKey(threadId)
    if (selected) storage.setItem(key, '1')
    else storage.removeItem(key)
  } catch {
    // Storage 被禁用时由调用方继续保留当前 React 选择态。
  }
}
