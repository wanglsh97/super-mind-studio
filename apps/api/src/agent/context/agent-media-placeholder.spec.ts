import type { AgentMediaReferencePart } from '@supermind/sdk'

import { mediaReferencePlaceholder } from './agent-media-placeholder'

describe('mediaReferencePlaceholder', () => {
  it('keeps bounded metadata and never embeds media bytes', () => {
    const part: AgentMediaReferencePart = {
      type: 'media-reference',
      mediaId: 'media-1',
      mediaType: 'video',
      mimeType: 'video/mp4',
      name: 'demo <clip>.mp4',
      source: 'user',
      status: 'available',
      description: `演示视频 ${'x'.repeat(400)}`,
    }
    const placeholder = mediaReferencePlaceholder(part)
    expect(placeholder).toContain('[media-reference')
    expect(placeholder).toContain('type=video')
    expect(placeholder).toContain('demo <clip>.mp4')
    expect(placeholder.length).toBeLessThan(500)
    expect(placeholder).not.toContain('x'.repeat(300))
  })
})
