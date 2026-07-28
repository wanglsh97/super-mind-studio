import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { RequestLogQueryDto } from './request-log-query.dto'

describe('RequestLogQueryDto', () => {
  it('transforms and accepts supported filters', async () => {
    const query = plainToInstance(RequestLogQueryDto, {
      page: '2',
      pageSize: '100',
      from: '2026-07-16T00:00:00.000Z',
      capability: 'prompt',
      model: 'deepseek',
      status: 'pending',
      requestId: '00000000-0000-4000-8000-000000000208',
      authProvider: 'GOOGLE',
      userName: 'Example User',
      providerUserId: 'google-subject',
    })

    await expect(validate(query)).resolves.toHaveLength(0)
    expect(query).toMatchObject({ page: 2, pageSize: 100 })
  })

  it.each([
    { page: 0 },
    { pageSize: 101 },
    { capability: 'unknown' },
    { model: 'openai' },
    { status: 'running' },
    { requestId: 'not-a-uuid' },
    { from: 'not-a-date' },
    { authProvider: 'PASSWORD' },
    { providerUserId: 'invalid\u0000id' },
  ])('rejects invalid filter %#', async (input) => {
    await expect(validate(plainToInstance(RequestLogQueryDto, input))).resolves.not.toHaveLength(0)
  })
})
