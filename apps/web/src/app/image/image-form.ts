import type { ImageModelAlias, ImageRequest, ImageTask, ModelSummary } from '@supermind/sdk'

export interface ImageSizeOption {
  label: string
  value: string
}

export const IMAGE_SIZE_OPTIONS: Readonly<Record<ImageModelAlias, readonly ImageSizeOption[]>> = {
  wanxiang: [
    { label: '1:1 · 1024 × 1024', value: '1024x1024' },
    { label: '16:9 · 1280 × 720', value: '1280x720' },
    { label: '9:16 · 720 × 1280', value: '720x1280' },
  ],
  cogview: [
    { label: '1:1 · 1024 × 1024', value: '1024x1024' },
    { label: '16:9 · 1344 × 768', value: '1344x768' },
    { label: '9:16 · 768 × 1344', value: '768x1344' },
  ],
}

export function enabledImageModels(models: readonly ModelSummary[]): ModelSummary[] {
  return models.filter(
    (model) =>
      model.enabled &&
      model.capabilities.includes('image') &&
      (model.alias === 'wanxiang' || model.alias === 'cogview'),
  )
}

export function maxImageCount(model: ImageModelAlias): number {
  return model === 'cogview' ? 1 : 4
}

export function createImageRequest(input: {
  model: ImageModelAlias
  prompt: string
  size: string
  count: number
}): ImageRequest {
  const prompt = input.prompt.trim()
  if (!prompt) throw new TypeError('Prompt 不能为空')
  const sizes = IMAGE_SIZE_OPTIONS[input.model]
  if (!sizes.some(({ value }) => value === input.size)) throw new TypeError('当前模型不支持该尺寸')
  if (
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > maxImageCount(input.model)
  ) {
    throw new TypeError('当前模型不支持该生成数量')
  }
  return { model: input.model, prompt, size: input.size, count: input.count }
}

export function imageResultItems(
  task: ImageTask,
  downloadUrl: (taskId: string, index: number) => string,
) {
  if (task.status !== 'succeeded') return []
  return task.results.map((result) => ({
    ...result,
    url: downloadUrl(task.taskId, result.index),
  }))
}
