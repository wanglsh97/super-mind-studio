import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { AdminAuditAction, Prisma } from '../../generated/prisma/client';
import type { AdminFieldKind, AdminTableCapability, AdminTableName } from './admin-table-allowlist';
import { AdminTableAllowlist } from './admin-table-allowlist';
import { serializeAdminRows } from '../admin-serialize';
import type { AdminTableRowsQueryDto } from './dto/admin-table-rows-query.dto';

export interface AdminMutationContext {
  actor: string;
  requestId?: string;
  sourceIp?: string;
}

type ModelDelegate = {
  count: (args?: unknown) => Promise<number>;
  findMany: (args: unknown) => Promise<unknown[]>;
  findUnique: (args: unknown) => Promise<unknown | null>;
  create: (args: unknown) => Promise<Record<string, unknown>>;
  update: (args: unknown) => Promise<Record<string, unknown>>;
  delete: (args: unknown) => Promise<Record<string, unknown>>;
};

@Injectable()
export class AdminTableRowsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminTableAllowlist) private readonly allowlist: AdminTableAllowlist,
  ) {}

  async list(tableName: string, query: AdminTableRowsQueryDto) {
    return this.listRows(tableName, query);
  }

  private async listRows(tableName: string, query: AdminTableRowsQueryDto) {
    const capability = this.allowlist.assertOperation(tableName, 'query');
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const sortBy = query.sortBy ?? defaultSortField(capability);
    if (!capability.fields.some(({ name }) => name === sortBy)) {
      throw new BadRequestException(`不支持的排序字段：${sortBy}`);
    }
    const orderBy = { [sortBy]: query.sortOrder ?? 'desc' };
    const skip = (page - 1) * pageSize;
    const select = Object.fromEntries(capability.fields.map(({ name }) => [name, true]));
    const delegate = this.delegate(capability.name);
    const [total, items] = await Promise.all([
      delegate.count(),
      delegate.findMany({ orderBy, skip, take: pageSize, select }),
    ]);
    return {
      items: serializeAdminRows(items),
      page,
      pageSize,
      total,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async create(tableName: string, rawBody: Record<string, unknown>, context: AdminMutationContext) {
    const capability = this.allowlist.assertCreatableBody(tableName, rawBody);
    const body = normalizeBody(capability, rawBody);
    return this.prisma.$transaction(async (transaction) => {
      const after = await this.delegate(capability.name, transaction).create({ data: body });
      await writeAudit(
        transaction,
        AdminAuditAction.CREATE,
        capability.name,
        String(after[capability.primaryKey]),
        null,
        after,
        context,
      );
      return after;
    });
  }

  async update(
    tableName: string,
    id: string,
    rawPatch: Record<string, unknown>,
    context: AdminMutationContext,
  ) {
    const capability = this.allowlist.assertEditablePatch(tableName, rawPatch);
    const patch = normalizeBody(capability, rawPatch);
    return this.prisma.$transaction(async (transaction) => {
      const delegate = this.delegate(capability.name, transaction);
      const before = await delegate.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('业务记录不存在');
      const after = await delegate.update({ where: { id }, data: patch });
      await writeAudit(
        transaction,
        AdminAuditAction.UPDATE,
        capability.name,
        id,
        before,
        after,
        context,
      );
      return after;
    });
  }

  async delete(tableName: string, id: string, context: AdminMutationContext) {
    const capability = this.allowlist.assertOperation(tableName, 'delete');
    return this.prisma.$transaction(async (transaction) => {
      const delegate = this.delegate(capability.name, transaction);
      const before = await delegate.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('业务记录不存在');
      await delegate.delete({ where: { id } });
      await writeAudit(
        transaction,
        AdminAuditAction.DELETE,
        capability.name,
        id,
        before,
        null,
        context,
      );
      return { deleted: true, id };
    });
  }

  private delegate(
    table: AdminTableName,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): ModelDelegate {
    switch (table) {
      case 'users':
        return client.user as unknown as ModelDelegate;
      case 'user-sessions':
        return client.userSession as unknown as ModelDelegate;
      case 'request-logs':
        return client.requestLog as unknown as ModelDelegate;
      case 'billing-records':
        return client.billingRecord as unknown as ModelDelegate;
      case 'image-generation-tasks':
        return client.imageGenerationTask as unknown as ModelDelegate;
      case 'video-generation-tasks':
        return client.videoGenerationTask as unknown as ModelDelegate;
      case 'admin-audit-logs':
        return client.adminAuditLog as unknown as ModelDelegate;
      case 'agent-threads':
        return client.agentThread as unknown as ModelDelegate;
      case 'agent-messages':
        return client.agentMessage as unknown as ModelDelegate;
      case 'agent-runs':
        return client.agentRun as unknown as ModelDelegate;
      case 'agent-events':
        return client.agentEvent as unknown as ModelDelegate;
      case 'agent-tool-calls':
        return client.agentToolCall as unknown as ModelDelegate;
    }
  }
}

function defaultSortField(capability: AdminTableCapability): string {
  return capability.fields.some(({ name }) => name === 'createdAt')
    ? 'createdAt'
    : capability.primaryKey;
}

function normalizeBody(
  capability: AdminTableCapability,
  rawBody: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(rawBody).map(([name, value]) => {
      const field = capability.fields.find((candidate) => candidate.name === name)!;
      if (value === null) {
        if (!field.nullable) throw new BadRequestException(`字段 ${name} 不能为空`);
        return [name, field.kind === 'json' ? Prisma.DbNull : null];
      }
      assertFieldValue(name, field.kind, value);
      if (field.kind === 'datetime' && typeof value === 'string') {
        return [name, new Date(value)];
      }
      return [name, value];
    }),
  );
}

function assertFieldValue(name: string, kind: AdminFieldKind, value: unknown): void {
  if (kind === 'string' && (typeof value !== 'string' || value.length > 20_000)) {
    throw new BadRequestException(`字段 ${name} 必须是合法字符串`);
  }
  if (kind === 'number' && (!Number.isInteger(value) || Number(value) < 0)) {
    throw new BadRequestException(`字段 ${name} 必须是非负整数`);
  }
  if (kind === 'boolean' && typeof value !== 'boolean') {
    throw new BadRequestException(`字段 ${name} 必须是布尔值`);
  }
  if (
    kind === 'decimal' &&
    !(
      (typeof value === 'string' && /^\d+(?:\.\d{1,8})?$/.test(value)) ||
      (typeof value === 'number' && Number.isFinite(value) && value >= 0)
    )
  ) {
    throw new BadRequestException(`字段 ${name} 必须是非负金额`);
  }
  if (kind === 'json' && (typeof value !== 'object' || value === null)) {
    throw new BadRequestException(`字段 ${name} 必须是 JSON 对象或数组`);
  }
  if (kind === 'datetime' && typeof value !== 'string') {
    throw new BadRequestException(`字段 ${name} 必须是 ISO 时间字符串`);
  }
  if (kind === 'enum' && typeof value !== 'string') {
    throw new BadRequestException(`字段 ${name} 必须是枚举字符串`);
  }
}

async function writeAudit(
  transaction: Prisma.TransactionClient,
  action: AdminAuditAction,
  targetTable: AdminTableName,
  targetId: string,
  before: unknown,
  after: unknown,
  context: AdminMutationContext,
) {
  await transaction.adminAuditLog.create({
    data: {
      actor: context.actor,
      action,
      targetTable,
      targetId,
      beforeData: before === null ? Prisma.DbNull : snapshot(before),
      afterData: after === null ? Prisma.DbNull : snapshot(after),
      ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      ...(context.sourceIp === undefined ? {} : { sourceIp: context.sourceIp }),
    },
  });
}

function snapshot(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
