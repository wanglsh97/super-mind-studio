import { RAG_EMBEDDING_DIMENSIONS } from './embedding.port'
import { MockEmbeddingAdapter, hashToUnitVector } from './mock-embedding.adapter'

describe('MockEmbeddingAdapter', () => {
  it('creates stable normalized vectors without a network', async () => {
    const adapter = new MockEmbeddingAdapter()
    const [first, second] = await adapter.embed(['Super Mind Studio RAG', 'Super Mind Studio RAG'])

    expect(first).toEqual(second)
    expect(first!.vector).toHaveLength(RAG_EMBEDDING_DIMENSIONS)
    expect(Math.hypot(...first!.vector)).toBeCloseTo(1, 10)
    expect(first).toMatchObject({ model: 'mock-hash-embedding', version: 'v1' })
  })

  it('returns an all-zero vector for text with no indexable token', () => {
    expect(hashToUnitVector(' ！？\n')).toEqual(new Array(RAG_EMBEDDING_DIMENSIONS).fill(0))
  })

  it('honors a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new MockEmbeddingAdapter().embed(['hello'], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})
