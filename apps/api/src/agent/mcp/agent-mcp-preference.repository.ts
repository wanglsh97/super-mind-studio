import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../../database/prisma.service'

@Injectable()
export class AgentMcpPreferenceRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listForUser(userId: string): Promise<ReadonlyMap<string, boolean>> {
    const rows = await this.prisma.userMcpServerPreference.findMany({
      where: { userId },
      select: { serverId: true, enabled: true },
    })
    return new Map(rows.map((row) => [row.serverId, row.enabled]))
  }

  async setEnabled(userId: string, serverId: string, enabled: boolean): Promise<void> {
    await this.prisma.userMcpServerPreference.upsert({
      where: { userId_serverId: { userId, serverId } },
      create: { userId, serverId, enabled },
      update: { enabled },
    })
  }
}
