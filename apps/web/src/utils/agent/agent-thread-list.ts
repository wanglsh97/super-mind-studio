export const AGENT_THREAD_PREVIEW_LIMIT = 5;

export function visibleAgentThreads<T>(threads: readonly T[], expanded: boolean): readonly T[] {
  return expanded ? threads : threads.slice(0, AGENT_THREAD_PREVIEW_LIMIT);
}

export function hiddenAgentThreadCount(threads: readonly unknown[], expanded: boolean): number {
  return expanded ? 0 : Math.max(0, threads.length - AGENT_THREAD_PREVIEW_LIMIT);
}
