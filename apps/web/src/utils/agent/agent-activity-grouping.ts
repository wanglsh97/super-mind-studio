export interface AgentActivityPartLike {
  type: string;
  toolName?: string;
}

/**
 * 只把 provider reasoning 与工具执行前的中间进度归入思考记录。
 * 工具调用必须保留在折叠项外，作为独立执行卡按消息顺序展示。
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
      (part.type === 'text' && lastToolCallIndex >= 0 && index < lastToolCallIndex)
    ) {
      indices.add(index);
    }
  });

  return indices;
}
