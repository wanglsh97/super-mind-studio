import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { CreateImageGenerationDto } from './create-image-generation.dto'

describe('CreateImageGenerationDto', () => {
  it('accepts a bounded provider-neutral image request', async () => {
    const dto = plainToInstance(CreateImageGenerationDto, {
      model: 'mock-image',
      prompt: '水墨山水',
      size: '1024x1024',
      count: 1,
    })
    await expect(validate(dto)).resolves.toHaveLength(0)
  })

  it.each([
    { model: 'unknown', prompt: 'ok' },
    { model: 'mock-image', prompt: '' },
    { model: 'mock-image', prompt: 'ok', size: 'arbitrary' },
    { model: 'mock-image', prompt: 'ok', count: 5 },
  ])('rejects invalid image input %#', async (input) => {
    await expect(
      validate(plainToInstance(CreateImageGenerationDto, input)),
    ).resolves.not.toHaveLength(0)
  })
})
