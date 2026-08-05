import { Inject, Injectable } from '@nestjs/common'

import type { CreationStatus, WebProjectStatus } from '../generated/prisma/client'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class CreationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findWebsiteForOwner(id: string, userId: string) {
    return this.prisma.webProject.findFirst({
      where: { id, userId },
      include: { creation: { include: { assets: true } } },
    })
  }

  listWebsitesForOwner(userId: string) {
    return this.prisma.webProject.findMany({
      where: { userId },
      include: { creation: { include: { assets: { orderBy: { createdAt: 'asc' } } } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  updateTerminalStatus(id: string, status: WebProjectStatus, creationStatus: CreationStatus, errorCode: string | null, errorMessage: string | null) {
    return this.prisma.webProject.update({
      where: { id },
      data: { status, errorCode, errorMessage, creation: { update: { status: creationStatus } } },
    })
  }
}
