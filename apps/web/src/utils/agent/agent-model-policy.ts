/**
 * 根 Agent 工作台规则：已存在 thread 的 model 不可改；在会话内改选模型 = 离开当前 thread、新建会话。
 */
export function shouldStartNewThreadOnModelChange(
  activeThreadId: string | null,
  currentModel: string,
  nextModel: string,
): boolean {
  return activeThreadId !== null && currentModel !== nextModel
}
