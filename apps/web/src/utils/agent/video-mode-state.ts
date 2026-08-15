const PREFIX = 'supermind:video-mode:';
export function readVideoMode(storage: Pick<Storage, 'getItem'>, threadId: string) {
  try {
    return storage.getItem(`${PREFIX}${threadId}`) === '1';
  } catch {
    return false;
  }
}
export function writeVideoMode(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  threadId: string | null,
  selected: boolean,
) {
  if (!threadId) return;
  try {
    const key = `${PREFIX}${threadId}`;
    if (selected) storage.setItem(key, '1');
    else storage.removeItem(key);
  } catch {
    // localStorage 不可用时保持当前 React 状态。
  }
}

export function bindDraftVideoModeToThread(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  threadId: string,
  selected: boolean,
) {
  writeVideoMode(storage, threadId, selected);
}
