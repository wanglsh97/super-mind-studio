import { Inject, Injectable } from '@nestjs/common'
import type { AgentExecutionErrorCode, AgentSkillFileEntry } from '@aigateway/sdk'

import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from './storage/skill-object-store.port'
import type { AgentSkillRegistry } from './agent-skill.registry'
import type {
  ExecutableSkillRecord,
  ExecutableSkillRepositoryPort,
} from './executable-skill.repository'
import { ExecutableSkillRepository } from './executable-skill.repository'

export const MAX_ADDED_AGENT_SKILLS = 50

export interface ActiveSkillManifestEntry {
  skillId: string
  name: string
  packageSha256: string
}

export interface ActivatedSkill {
  manifest: ActiveSkillManifestEntry
  skillMarkdown: string
  files: AgentSkillFileEntry[]
  archive: Uint8Array
}

@Injectable()
export class ExecutableSkillService implements AgentSkillRegistry {
  constructor(
    @Inject(ExecutableSkillRepository)
    private readonly repository: ExecutableSkillRepositoryPort,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objectStore: SkillObjectStorePort,
  ) {}

  ensureMockPublishedSkill(): Promise<ExecutableSkillRecord> {
    return this.repository.ensureMockPublishedSkill()
  }

  async add(userId: string, name: string): Promise<ExecutableSkillRecord> {
    const skill = await this.repository.findPublishedByName(name)
    if (!skill) throw new ExecutableSkillError('SKILL_NOT_PUBLISHED', 'Skill 不存在或未发布')
    await this.repository.addForUser(userId, skill, MAX_ADDED_AGENT_SKILLS)
    return skill
  }

  async remove(userId: string, name: string): Promise<void> {
    const skill = await this.repository.findAddedByName(userId, name)
    if (!skill) return
    await this.repository.removeForUser(userId, skill.id)
  }

  listCandidates(userId: string): Promise<ExecutableSkillRecord[]> {
    return this.repository.listAddedPublished(userId)
  }

  async activateManually(
    userId: string,
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<ActivatedSkill[]> {
    const activated: ActivatedSkill[] = []
    for (const name of [...new Set(names)]) {
      const skill = await this.repository.findAddedPublishedByName(userId, name)
      if (!skill) {
        throw new ExecutableSkillError('SKILL_NOT_ADDED', `Skill ${name} 未添加、已下架或不存在`)
      }
      activated.push(await this.loadCurrentPackage(skill, signal))
    }
    return activated
  }

  private async loadCurrentPackage(
    skill: ExecutableSkillRecord,
    signal?: AbortSignal,
  ): Promise<ActivatedSkill> {
    if (!skill.packageObjectKey || !skill.packageSha256) {
      throw new ExecutableSkillError(
        'SKILL_PACKAGE_UNAVAILABLE',
        `Skill ${skill.name} 没有可用资源包`,
      )
    }
    const stored = await this.objectStore.loadSkillPackage(skill.packageObjectKey, signal)
    if (!stored) {
      throw new ExecutableSkillError(
        'SKILL_PACKAGE_UNAVAILABLE',
        `Skill ${skill.name} 资源包不可用`,
      )
    }
    if (stored.metadata.sha256 !== skill.packageSha256) {
      throw new ExecutableSkillError(
        'SKILL_PACKAGE_INTEGRITY_FAILED',
        `Skill ${skill.name} 资源包完整性校验失败`,
      )
    }
    return {
      manifest: {
        skillId: skill.id,
        name: skill.name,
        packageSha256: stored.metadata.sha256,
      },
      skillMarkdown: stored.skillMarkdown,
      files: stored.files.map((file) => ({ ...file })),
      archive: Uint8Array.from(stored.archive),
    }
  }
}

export class ExecutableSkillError extends Error {
  readonly retryable = false

  constructor(
    readonly code: AgentExecutionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ExecutableSkillError'
  }
}
