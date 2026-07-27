import { Inject, Injectable } from '@nestjs/common'

import type { AgentSkillFileEntry } from '@supermind/sdk'

import { PrismaService } from '../../../database/prisma.service'

export interface SkillPackageProjection {
  skillMarkdown: string
  files: AgentSkillFileEntry[]
}

export interface SkillPackageProjectionReader {
  findByObjectKey(objectKey: string): Promise<SkillPackageProjection | null>
}

@Injectable()
export class PrismaSkillPackageProjectionReader implements SkillPackageProjectionReader {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByObjectKey(objectKey: string): Promise<SkillPackageProjection | null> {
    const skill = await this.prisma.skill.findUnique({
      where: { packageObjectKey: objectKey },
      select: { skillMarkdown: true, fileTree: true },
    })
    if (!skill?.skillMarkdown || !isFileTree(skill.fileTree)) return null
    return {
      skillMarkdown: skill.skillMarkdown,
      files: skill.fileTree.map((file) => ({ ...file })),
    }
  }
}

function isFileTree(value: unknown): value is AgentSkillFileEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'path' in entry &&
        typeof entry.path === 'string' &&
        'type' in entry &&
        (entry.type === 'file' || entry.type === 'directory') &&
        'size' in entry &&
        (typeof entry.size === 'number' || entry.size === null),
    )
  )
}
