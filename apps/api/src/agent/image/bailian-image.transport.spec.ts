import { ConfigService } from '@nestjs/config';

import { BailianAsyncImageTransport } from './bailian-image.transport';

describe('BailianAsyncImageTransport fixture contract', () => {
  const config = new ConfigService({
    BAILIAN_IMAGE_API_KEY: 'fixture-secret',
    BAILIAN_IMAGE_BASE_URL: 'https://fixture.invalid/api/v1',
  });

  it('derives the native image endpoint from a configured compatible-mode Base URL', async () => {
    const fetchImpl = jest.fn(async () =>
      new Response(
        JSON.stringify({
          output: {
            choices: [{ message: { content: [{ image: 'https://result.example/image.png' }] } }],
          },
          request_id: 'fixture-request-2',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as typeof fetch;
    const transport = new BailianAsyncImageTransport(
      new ConfigService({
        BAILIAN_IMAGE_API_KEY: 'fixture-secret',
        BAILIAN_IMAGE_BASE_URL: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      }),
      fetchImpl,
    );

    await transport.submit({
      path: '/services/aigc/multimodal-generation/generation',
      body: { model: 'qwen-image-2.0-pro' },
      asynchronous: false,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      expect.any(Object),
    );
  });

  it('submits and queries sanitized async fixtures with required auth/header', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const fetchImpl = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
      const payload = String(input).includes('/tasks/')
        ? {
            output: {
              task_id: 'fixture-task-1',
              task_status: 'SUCCEEDED',
              choices: [{ message: { content: [{ image: 'https://result.example/image.png' }] } }],
            },
          }
        : {
            output: { task_id: 'fixture-task-1', task_status: 'PENDING' },
            request_id: 'fixture-request-1',
          };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const transport = new BailianAsyncImageTransport(config, fetchImpl);
    await expect(
      transport.submit({
        path: '/services/aigc/image-generation/generation',
        body: { model: 'fixture' },
      }),
    ).resolves.toMatchObject({ taskId: 'fixture-task-1' });
    await expect(transport.query('fixture-task-1')).resolves.toMatchObject({
      status: 'SUCCEEDED',
      resultUrl: 'https://result.example/image.png',
    });
    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer fixture-secret',
      'X-DashScope-Async': 'enable',
    });
  });

  it('classifies an ambiguous submission disconnect without retrying', async () => {
    const transport = new BailianAsyncImageTransport(
      config,
      jest.fn(async () => {
        throw new Error('socket reset');
      }) as typeof fetch,
    );
    await expect(transport.submit({ path: '/submit', body: {} })).rejects.toMatchObject({
      outcomeUnknown: true,
    });
  });
});
