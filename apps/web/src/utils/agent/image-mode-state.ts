const IMAGE_MODE_STORAGE_PREFIX = 'supermind:image-mode:';

export function readImageMode(storage: Pick<Storage, 'getItem'>, threadId: string): boolean {
  try {
    return storage.getItem(`${IMAGE_MODE_STORAGE_PREFIX}${threadId}`) === '1';
  } catch {
    return false;
  }
}

export function writeImageMode(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  threadId: string,
  selected: boolean,
): void {
  try {
    const key = `${IMAGE_MODE_STORAGE_PREFIX}${threadId}`;
    if (selected) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch {
    // localStorage 不可用时保持当前 React 状态。
  }
}
