import { createHash } from 'node:crypto'

import { RAG_EMBEDDING_DIMENSIONS, type EmbeddingPort, type EmbeddingResult } from './embedding.port'

const MODEL = 'mock-hash-embedding'
const VERSION = 'v1'

/**
 * 仅用于本地开发与 CI 的确定性离线 embedding。
 * 它不代表生产语义检索质量，因此真实运行必须显式启用外部 provider。
 */
export class MockEmbeddingAdapter implements EmbeddingPort {
  async embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly EmbeddingResult[]> {
    if (signal?.aborted) throw new DOMException('Embedding 已取消', 'AbortError')
    return texts.map((text) => ({ vector: hashToUnitVector(text), model: MODEL, version: VERSION }))
  }
}

export function hashToUnitVector(text: string): number[] {
  const vector = new Array<number>(RAG_EMBEDDING_DIMENSIONS).fill(0)
  for (const token of text.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []) {
    const digest = createHash('sha256').update(token).digest()
    for (let offset = 0; offset < digest.length; offset += 2) {
      const firstByte = digest[offset]!
      const secondByte = digest[offset + 1]!
      const slot = ((firstByte << 8) | secondByte) % RAG_EMBEDDING_DIMENSIONS
      vector[slot] = vector[slot]! + (firstByte & 1 ? 1 : -1)
    }
  }
  const magnitude = Math.hypot(...vector)
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude)
}
