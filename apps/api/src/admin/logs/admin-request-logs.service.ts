import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RequestCapability, RequestStatus } from '../../generated/prisma/client';
import type { Prisma } from '../../generated/prisma/client';
import type { RequestLogQueryDto } from './dto/request-log-query.dto';
import { serializeAdminRows, serializeAdminValue } from '../admin-serialize';

const CAPABILITY = {
  chat: RequestCapability.CHAT,
  image: RequestCapability.IMAGE,
  prompt: RequestCapability.PROMPT,
} as const;

const STATUS = {
  pending: RequestStatus.PENDING,
  succeeded: RequestStatus.SUCCEEDED,
  failed: RequestStatus.FAILED,
  cancelled: RequestStatus.CANCELLED,
} as const;

@Injectable()
export class AdminRequestLogsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(query: RequestLogQueryDto) {
    return this.listRows(query);
  }

  private async listRows(query: RequestLogQueryDto) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const from = query.from === undefined ? undefined : new Date(query.from);
    const to = query.to === undefined ? undefined : new Date(query.to);
    if (from && to && from > to) throw new BadRequestException('开始时间不能晚于结束时间');

    const where: Prisma.RequestLogWhereInput = {
      ...(from || to
        ? {
            createdAt: {
              ...(from === undefined ? {} : { gte: from }),
              ...(to === undefined ? {} : { lte: to }),
            },
          }
        : {}),
      ...(query.capability === undefined ? {} : { capability: CAPABILITY[query.capability] }),
      ...(query.model === undefined ? {} : { modelAlias: query.model }),
      ...(query.status === undefined ? {} : { status: STATUS[query.status] }),
      ...(query.requestId === undefined ? {} : { requestId: query.requestId }),
      ...(query.authProvider === undefined &&
      query.userName === undefined &&
      query.providerUserId === undefined
        ? {}
        : {
            user: {
              is: {
                ...(query.authProvider === undefined ? {} : { authProvider: query.authProvider }),
                ...(query.userName === undefined
                  ? {}
                  : {
                      userName: {
                        equals: query.userName,
                        mode: 'insensitive' as const,
                      },
                    }),
                ...(query.providerUserId === undefined
                  ? {}
                  : { providerUserId: query.providerUserId }),
              },
            },
          }),
    };
    const [total, items] = await Promise.all([
      this.prisma.requestLog.count({ where }),
      this.prisma.requestLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          requestId: true,
          capability: true,
          modelAlias: true,
          provider: true,
          status: true,
          stream: true,
          startedAt: true,
          completedAt: true,
          durationMs: true,
          errorCode: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              authProvider: true,
              userName: true,
              avatarUrl: true,
            },
          },
          billing: {
            select: {
              inputTokens: true,
              outputTokens: true,
              totalTokens: true,
              usageUnknown: true,
              estimatedCostCny: true,
            },
          },
        },
      }),
    ]);
    return {
      items: serializeAdminRows(items),
      page,
      pageSize,
      total,
      pageCount: Math.ceil(total / pageSize),
    };
  }

  async detail(requestId: string) {
    const detail = await this.prisma.requestLog.findUnique({
      where: { requestId },
      select: {
        requestId: true,
        capability: true,
        prompt: true,
        modelAlias: true,
        provider: true,
        resolvedModel: true,
        providerRequestId: true,
        status: true,
        stream: true,
        clientIp: true,
        startedAt: true,
        firstTokenAt: true,
        completedAt: true,
        durationMs: true,
        failoverFrom: true,
        failoverTo: true,
        failoverReason: true,
        errorCode: true,
        errorMessage: true,
        errorDetails: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
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
          select: {
            id: true,
            threadId: true,
            status: true,
            input: true,
            messages: {
              orderBy: { sequence: 'asc' },
              select: {
                id: true,
                role: true,
                sequence: true,
                parts: true,
                createdAt: true,
              },
            },
          },
        },
        imageTask: {
          select: {
            taskId: true,
            providerTaskId: true,
            status: true,
            effectivePrompt: true,
            modelAlias: true,
            resolvedModel: true,
            options: true,
            imageId: true,
            sandboxExpiresAt: true,
            results: true,
            errorCode: true,
            errorMessage: true,
          },
        },
      },
    });
    if (!detail) throw new NotFoundException('请求日志不存在');
    return serializeAdminValue(detail);
  }
}
