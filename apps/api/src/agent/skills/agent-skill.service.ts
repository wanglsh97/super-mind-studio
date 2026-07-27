import type { AgentSkillMarketItem } from '@supermind/sdk'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import type { AgentSkillDescriptor } from './agent-skill.registry'
import { AgentSkillRepository } from './agent-skill.repository'
import { PlatformAgentSkillCatalog } from './platform-agent-skill.catalog'

@Injectable()
export class AgentSkillService {
  constructor(
    @Inject(PlatformAgentSkillCatalog) private readonly catalog: PlatformAgentSkillCatalog,
    @Inject(AgentSkillRepository) private readonly repository: AgentSkillRepository,
  ) {}

  async listMarket(userId: string): Promise<AgentSkillMarketItem[]> {
    const installed = new Map(
      (await this.repository.listForUser(userId)).map((state) => [state.skillId, true]),
    )
    return this.catalog.list().map((skill) => toMarketItem(skill, installed.get(skill.id)))
  }

  async listForUser(userId: string): Promise<readonly AgentSkillDescriptor[]> {
    const added = new Set((await this.repository.listForUser(userId)).map((state) => state.skillId))
    return this.catalog.list().filter((skill) => added.has(skill.id))
  }

  async install(userId: string, skillId: string): Promise<AgentSkillMarketItem> {
    const skill = this.requireSkill(skillId)
    await this.repository.install(userId, skillId)
    return toMarketItem(skill, true)
  }

  async uninstall(userId: string, skillId: string): Promise<void> {
    this.requireSkill(skillId)
    await this.repository.uninstall(userId, skillId)
  }

  private requireSkill(skillId: string): AgentSkillDescriptor {
    const skill = this.catalog.find(skillId)
    if (!skill) throw new NotFoundException('Skill 不存在或已下架')
    return skill
  }
}

function toMarketItem(
  skill: AgentSkillDescriptor,
  enabled: boolean | undefined,
): AgentSkillMarketItem {
  return {
    id: skill.id,
    name: skill.name,
    version: skill.version,
    description: skill.description,
    category: skill.category,
    allowedTools: skill.allowedTools,
    installed: enabled !== undefined,
    enabled: enabled ?? false,
  }
}
