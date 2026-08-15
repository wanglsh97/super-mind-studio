import type { PrismaService } from '../../database/prisma.service';
import { AdminRequestLogsService } from './admin-request-logs.service';

function setup() {
  const count = jest.fn().mockResolvedValue(2);
  const findMany = jest.fn().mockResolvedValue([{ requestId: 'request-1' }]);
  const findUnique = jest.fn();
  const prisma = {
    requestLog: { count, findMany, findUnique },
  } as unknown as PrismaService;
  return { count, findMany, findUnique, service: new AdminRequestLogsService(prisma) };
}

describe('AdminRequestLogsService', () => {
  it('combines filters, paginates, and never selects Prompt', async () => {
    const { count, findMany, service } = setup();

    await expect(
      service.list({
        page: 2,
        pageSize: 25,
        from: '2026-07-16T00:00:00.000Z',
        to: '2026-07-17T00:00:00.000Z',
        capability: 'chat',
        model: 'qwen',
        status: 'failed',
        requestId: '00000000-0000-4000-8000-000000000208',
        authProvider: 'GITHUB',
        userName: 'Fixture-Octocat',
        providerUserId: '90000001',
      }),
    ).resolves.toEqual({
      items: [{ requestId: 'request-1' }],
      page: 2,
      pageSize: 25,
      total: 2,
      pageCount: 1,
    });

    const where = {
      createdAt: {
        gte: new Date('2026-07-16T00:00:00.000Z'),
        lte: new Date('2026-07-17T00:00:00.000Z'),
      },
      capability: 'CHAT',
      modelAlias: 'qwen',
      status: 'FAILED',
      requestId: '00000000-0000-4000-8000-000000000208',
      user: {
        is: {
          authProvider: 'GITHUB',
          userName: { equals: 'Fixture-Octocat', mode: 'insensitive' },
          providerUserId: '90000001',
        },
      },
    };
    expect(count).toHaveBeenCalledWith({ where });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 25, take: 25 }));
    expect(JSON.stringify(findMany.mock.calls)).not.toContain('prompt');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          user: {
            select: {
              id: true,
              authProvider: true,
              userName: true,
              avatarUrl: true,
            },
          },
        }),
      }),
    );
    expect(JSON.stringify(findMany.mock.calls)).not.toContain('email');
  });

  it('uses bounded defaults and rejects an inverted time range before querying', async () => {
    const { count, service } = setup();

    await expect(service.list({})).resolves.toMatchObject({ page: 1, pageSize: 20 });
    await expect(
      service.list({ from: '2026-07-18T00:00:00.000Z', to: '2026-07-17T00:00:00.000Z' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(count).toHaveBeenCalledTimes(1);
  });

  it('returns the authenticated diagnostic detail including complete Prompt and relations', async () => {
    const { findUnique, service } = setup();
    findUnique.mockResolvedValue({
      requestId: '00000000-0000-4000-8000-000000000210',
      prompt: { messages: [{ role: 'user', content: '完整问题' }] },
      billing: { totalTokens: 10 },
      agentRun: {
        id: 'run-1',
        threadId: 'thread-1',
        status: 'SUCCEEDED',
        input: '完整问题',
        messages: [
          {
            id: 'message-1',
            role: 'ASSISTANT',
            sequence: 1,
            parts: [{ type: 'text', text: '完整回答' }],
            createdAt: new Date('2026-07-29T00:00:01.000Z'),
          },
        ],
      },
    });

    await expect(service.detail('00000000-0000-4000-8000-000000000210')).resolves.toMatchObject({
      prompt: expect.any(Object),
      billing: expect.any(Object),
      agentRun: {
        messages: [
          expect.objectContaining({
            role: 'ASSISTANT',
            parts: [{ type: 'text', text: '完整回答' }],
            createdAt: '2026-07-29T00:00:01.000Z',
          }),
        ],
      },
    });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: '00000000-0000-4000-8000-000000000210' },
        select: expect.objectContaining({
          prompt: true,
          providerRequestId: true,
          failoverReason: true,
          errorDetails: true,
          user: {
            select: {
              id: true,
              authProvider: true,
              providerUserId: true,
              userName: true,
              avatarUrl: true,
            },
          },
          billing: true,
          agentRun: {
            select: expect.objectContaining({
              messages: {
                orderBy: { sequence: 'asc' },
                select: expect.objectContaining({
                  role: true,
                  sequence: true,
                  parts: true,
                }),
              },
            }),
          },
          imageTask: expect.any(Object),
        }),
      }),
    );
  });

  it('filters user names case-insensitively when no provider ID is supplied', async () => {
    const { count, service } = setup();

    await service.list({ userName: 'Fixture-Octocat' });

    expect(count).toHaveBeenCalledWith({
      where: {
        user: {
          is: {
            userName: { equals: 'Fixture-Octocat', mode: 'insensitive' },
          },
        },
      },
    });
  });

  it('returns 404 for an unknown request ID', async () => {
    const { findUnique, service } = setup();
    findUnique.mockResolvedValue(null);

    await expect(service.detail('00000000-0000-4000-8000-000000000210')).rejects.toMatchObject({
      status: 404,
    });
  });
});
