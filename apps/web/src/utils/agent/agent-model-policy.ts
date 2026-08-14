/** 已有 Thread 只有在模型确实变化时才调用持久化更新；草稿选择保持本地。 */
export function shouldUpdateCurrentThreadModel(
  activeThreadId: string | null,
  currentModel: string,
  nextModel: string,
): boolean {
  return activeThreadId !== null && currentModel !== nextModel
}

export function isCurrentThreadModelSelectionDisabled(
  activeThreadId: string | null,
  activeRuns: readonly { threadId: string }[],
): boolean {
  return activeThreadId !== null && activeRuns.some((run) => run.threadId === activeThreadId)
}

export function isCurrentThreadModelUpdatePending(
  activeThreadId: string | null,
  updatingThreadId: string | null,
): boolean {
  return activeThreadId !== null && updatingThreadId === activeThreadId
}

export async function updateThreadModelOptimistically<T extends { model: string }>(input: {
  currentModel: string
  nextModel: string
  applySelection: (model: string) => void
  persist: () => Promise<T>
  isStillCurrent: () => boolean
}): Promise<T> {
  input.applySelection(input.nextModel)
  try {
    const updated = await input.persist()
    if (input.isStillCurrent()) input.applySelection(updated.model)
    return updated
  } catch (error) {
    if (input.isStillCurrent()) input.applySelection(input.currentModel)
    throw error
  }
}
