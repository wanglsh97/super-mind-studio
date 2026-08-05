import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service'

@Injectable()
export class CreationRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listWebsitesForOwner(userId: string) {
    return this.prisma.webProject.findMany({
      where: { userId },
      include: { creation: { include: { assets: { orderBy: { createdAt: 'asc' } } } } },
      orderBy: { createdAt: 'desc' },
    })
  }
}
