export interface AgentActivityPartLike {
  type: string;
}

/**
 * 将一次工具辅助推理中的 reasoning、工具调用和中间进度文本归入同一思考模块。
 * 最后一次工具调用之后的文本视为最终回答，继续留在思考模块之外。
 */
export function agentActivityPartIndices(
  parts: readonly AgentActivityPartLike[],
): ReadonlySet<number> {
  let lastToolCallIndex = -1;

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index]?.type === 'tool-call') {
      lastToolCallIndex = index;
      break;
    }
  }

  const indices = new Set<number>();

  parts.forEach((part, index) => {
    if (
      part.type === 'reasoning' ||
      part.type === 'tool-call' ||
      (part.type === 'text' && lastToolCallIndex >= 0 && index < lastToolCallIndex)
    ) {
      indices.add(index);
    }
  });

  return indices;
}
