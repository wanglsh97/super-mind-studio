import { Inject, Injectable } from '@nestjs/common'

import {
  SANDBOX_RUNTIME_PORT,
  type SandboxCommandResult,
  type SandboxFileResult,
  type SandboxRuntimePort,
} from './sandbox-runtime.port'
import type { ActivatedSkill } from '../skills/executable-skill.service'
import { ExecutableSkillService } from '../skills/executable-skill.service'

interface RunExecutionSession {
  userId: string
  sandboxId: string
  activeSkills: Map<string, ActivatedSkill>
}

@Injectable()
export class AgentExecutionSessionService {
  private readonly sessions = new Map<string, RunExecutionSession>()

  constructor(
    @Inject(ExecutableSkillService) private readonly skills: ExecutableSkillService,
    @Inject(SANDBOX_RUNTIME_PORT) private readonly sandboxes: SandboxRuntimePort,
  ) {}

  async startRun(runId: string, userId: string, signal?: AbortSignal): Promise<string> {
    const existing = this.sessions.get(runId)
    this.assertOwner(existing, userId)
    if (existing) return existing.sandboxId
    return (await this.createSession(runId, userId, signal)).sandboxId
  }

  async activateSkill(
    runId: string,
    userId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<{ sandboxId: string; skill: ActivatedSkill; alreadyActive: boolean }> {
    const existing = this.sessions.get(runId)
    this.assertOwner(existing, userId)
    const active = existing?.activeSkills.get(name)
    if (existing && active) {
      return { sandboxId: existing.sandboxId, skill: active, alreadyActive: true }
    }

    const [prepared] = await this.skills.prepareActivation(userId, [name], signal)
    if (!prepared) throw new Error(`Skill activation returned no package: ${name}`)
    const session = existing ?? (await this.createSession(runId, userId, signal))
    const installed = await this.sandboxes.installSkillPackage({
      sandboxId: session.sandboxId,
      skillName: prepared.manifest.name,
      downloadUrl: prepared.download.url,
      expectedSha256: prepared.manifest.packageSha256,
      expectedSizeBytes: prepared.download.metadata.sizeBytes,
      ...(signal === undefined ? {} : { signal }),
    })
    const skill: ActivatedSkill = {
      manifest: prepared.manifest,
      skillMarkdown: installed.skillMarkdown,
      files: installed.files.map((file) => ({ ...file })),
    }
    session.activeSkills.set(name, skill)
    return { sandboxId: session.sandboxId, skill, alreadyActive: false }
  }

  async runShell(
    runId: string,
    userId: string,
    input: { command: string; workingDirectory: string; signal?: AbortSignal },
  ): Promise<SandboxCommandResult> {
    const session = this.requireActiveSession(runId, userId)
    return this.sandboxes.runCommand({
      sandboxId: session.sandboxId,
      command: input.command,
      workingDirectory: input.workingDirectory,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    })
  }

  async readFile(
    runId: string,
    userId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult | null> {
    const session = this.requireActiveSession(runId, userId)
    return this.sandboxes.readFile(session.sandboxId, path, signal)
  }

  async writeFile(
    runId: string,
    userId: string,
    path: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult> {
    const session = this.requireActiveSession(runId, userId)
    return this.sandboxes.writeFile({
      sandboxId: session.sandboxId,
      path,
      bytes,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async destroyRun(runId: string): Promise<void> {
    const session = this.sessions.get(runId)
    if (!session) return
    this.sessions.delete(runId)
    await this.sandboxes.destroySandbox(session.sandboxId)
  }

  private async createSession(
    runId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<RunExecutionSession> {
    const created = await this.sandboxes.createSandbox({
      runId,
      ...(signal === undefined ? {} : { signal }),
    })
    try {
      const ready = await this.sandboxes.waitUntilReady(created.sandboxId, signal)
      const session = { userId, sandboxId: ready.sandboxId, activeSkills: new Map() }
      this.sessions.set(runId, session)
      return session
    } catch (error) {
      // Preserve the creation/ready error. A failed compensating destroy is retried by reconciliation.
      await this.sandboxes.destroySandbox(created.sandboxId).catch(() => undefined)
      throw error
    }
  }

  private requireActiveSession(runId: string, userId: string): RunExecutionSession {
    const session = this.sessions.get(runId)
    this.assertOwner(session, userId)
    if (!session || session.activeSkills.size === 0) {
      throw new Error('Shell 和文件工具只能在 Skill 激活后使用')
    }
    return session
  }

  private assertOwner(session: RunExecutionSession | undefined, userId: string): void {
    if (session && session.userId !== userId)
      throw new Error('Run execution session owner mismatch')
  }
}
