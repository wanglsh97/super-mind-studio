export const RAG_EMBEDDING_DIMENSIONS = 256

export interface EmbeddingResult {
  vector: readonly number[]
  model: string
  version: string
}

export interface EmbeddingPort {
  embed(texts: readonly string[], signal?: AbortSignal): Promise<readonly EmbeddingResult[]>
}
