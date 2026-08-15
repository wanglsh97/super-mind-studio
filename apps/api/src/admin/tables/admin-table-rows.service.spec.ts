import type { PrismaService } from '../../database/prisma.service';
import { AdminTableAllowlist } from './admin-table-allowlist';
import { AdminTableRowsService } from './admin-table-rows.service';

function delegate() {
  return {
    count: jest.fn().mockResolvedValue(1),
    findMany: jest.fn().mockResolvedValue([{ id: 'row-1' }]),
    findUnique: jest.fn().mockResolvedValue({ id: 'row-1', inputTokens: 1 }),
    update: jest.fn().mockResolvedValue({ id: 'row-1', inputTokens: 2 }),
    delete: jest.fn().mockResolvedValue({ id: 'row-1' }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
  };
}

function setup() {
  const requestLog = delegate();
  const billingRecord = delegate();
  const imageGenerationTask = delegate();
  const adminAuditLog = delegate();
  const transactionClient = { requestLog, billingRecord, imageGenerationTask, adminAuditLog };
  const transaction = jest.fn(async (operation: (client: typeof transactionClient) => unknown) =>
    operation(transactionClient),
  );
  const prisma = {
    ...transactionClient,
    $transaction: transaction,
  } as unknown as PrismaService;
  return {
    adminAuditLog,
    billingRecord,
    imageGenerationTask,
    requestLog,
    service: new AdminTableRowsService(prisma, new AdminTableAllowlist()),
    transaction,
  };
}

describe('AdminTableRowsService', () => {
  it.each([
    ['request-logs', 'requestLog'],
    ['billing-records', 'billingRecord'],
    ['image-generation-tasks', 'imageGenerationTask'],
    ['admin-audit-logs', 'adminAuditLog'],
  ] as const)('queries only the mapped delegate for %s', async (table, delegateName) => {
    const context = setup();

    await expect(context.service.list(table, { page: 2, pageSize: 10 })).resolves.toEqual({
      items: [{ id: 'row-1' }],
      page: 2,
      pageSize: 10,
      total: 1,
      pageCount: 1,
    });
    expect(context[delegateName].findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      select: expect.any(Object),
      skip: 10,
      take: 10,
    });
  });

  it('never projects complete Prompt fields from generic database row lists', async () => {
    const context = setup();

    await context.service.list('request-logs', {});
    await context.service.list('image-generation-tasks', {});

    const requestSelect = context.requestLog.findMany.mock.calls[0]?.[0]?.select;
    const imageSelect = context.imageGenerationTask.findMany.mock.calls[0]?.[0]?.select;
    expect(requestSelect).not.toHaveProperty('prompt');
    expect(imageSelect).not.toHaveProperty('prompt');
  });

  it('rejects unknown sort fields and unknown tables before querying Prisma', async () => {
    const { requestLog, service } = setup();

    await expect(service.list('request-logs', { sortBy: 'DROP TABLE' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.list('not-a-table', {})).rejects.toMatchObject({ status: 404 });
    expect(requestLog.findMany).not.toHaveBeenCalled();
  });

  it('rejects create, update, and delete for the read-only table browser', async () => {
    const context = setup();
    const id = '00000000-0000-4000-8000-000000000212';

    await expect(
      context.service.create('billing-records', { inputTokens: 1 }, { actor: 'root' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      context.service.update('billing-records', id, { inputTokens: 2 }, { actor: 'root' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      context.service.delete('request-logs', id, { actor: 'root' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(context.transaction).not.toHaveBeenCalled();
  });
});
