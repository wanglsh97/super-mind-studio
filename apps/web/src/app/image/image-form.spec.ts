import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { ModelSummary } from '@supermind/sdk'

import {
  createImageRequest,
  enabledImageModels,
  IMAGE_SIZE_OPTIONS,
  imageResultItems,
  maxImageCount,
} from './image-form'

describe('image form contract', () => {
  it('keeps only enabled image aliases returned by model discovery', () => {
    const models: ModelSummary[] = [
      model('qwen', ['chat']),
      model('wanxiang', ['image']),
      { ...model('cogview', ['image']), enabled: false },
    ]
    assert.deepEqual(
      enabledImageModels(models).map(({ alias }) => alias),
      ['wanxiang'],
    )
  })

  it('uses provider-supported sizes and count limits', () => {
    assert.deepEqual(
      IMAGE_SIZE_OPTIONS.wanxiang.map(({ value }) => value),
      ['1024x1024', '1280x720', '720x1280'],
    )
    assert.deepEqual(
      IMAGE_SIZE_OPTIONS.cogview.map(({ value }) => value),
      ['1024x1024', '1344x768', '768x1344'],
    )
    assert.equal(maxImageCount('wanxiang'), 4)
    assert.equal(maxImageCount('cogview'), 1)
  })

  it('normalizes a valid request and rejects unsupported combinations', () => {
    assert.deepEqual(
      createImageRequest({
        model: 'wanxiang',
        prompt: '  水墨山水  ',
        size: '1024x1024',
        count: 2,
      }),
      { model: 'wanxiang', prompt: '水墨山水', size: '1024x1024', count: 2 },
    )
    assert.throws(
      () =>
        createImageRequest({
          model: 'cogview',
          prompt: 'city',
          size: '1280x720',
          count: 1,
        }),
      /不支持该尺寸/,
    )
    assert.throws(
      () =>
        createImageRequest({
          model: 'cogview',
          prompt: 'city',
          size: '1024x1024',
          count: 2,
        }),
      /不支持该生成数量/,
    )
  })

  it('builds result URLs only through the gateway URL factory', () => {
    const calls: Array<[string, number]> = []
    const items = imageResultItems(
      {
        taskId: 'task/with slash',
        model: 'wanxiang',
        status: 'succeeded',
        results: [{ index: 0, width: 1024, height: 1024 }],
      },
      (taskId, index) => {
        calls.push([taskId, index])
        return `/api/proxy/${encodeURIComponent(taskId)}/${index}`
      },
    )
    assert.deepEqual(calls, [['task/with slash', 0]])
    assert.equal(items[0]?.url, '/api/proxy/task%2Fwith%20slash/0')
  })
})

function model(alias: ModelSummary['alias'], capabilities: ModelSummary['capabilities']) {
  return {
    id: alias,
    alias,
    capabilities,
    displayName: alias,
    enabled: true,
    configured: true,
    health: 'unknown' as const,
  }
}
