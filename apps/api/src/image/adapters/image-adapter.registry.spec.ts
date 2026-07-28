import type { ImageAdapter } from './image-adapter'
import { ImageAdapterRegistry } from './image-adapter.registry'

function adapter(id: ImageAdapter['id']): ImageAdapter {
  return {
    id,
    resolvedModel: `${id}-v1`,
    submit: jest.fn(),
    getStatus: jest.fn(),
    download: jest.fn(),
  }
}

describe('ImageAdapterRegistry', () => {
  it('registers and lists provider-neutral image adapters', () => {
    const mock = adapter('mock')
    const registry = new ImageAdapterRegistry([mock])

    expect(registry.get('mock')).toBe(mock)
    expect(registry.list()).toEqual([mock])
  })

  it('rejects duplicate IDs and missing adapters', () => {
    expect(() => new ImageAdapterRegistry([adapter('mock'), adapter('mock')])).toThrow('duplicated')
    expect(() => new ImageAdapterRegistry([]).get('mock')).toThrow('not registered')
  })
})
