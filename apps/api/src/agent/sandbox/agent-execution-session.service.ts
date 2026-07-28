import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import {
  SANDBOX_RUNTIME_PORT,
  type SandboxCommandResult,
  type SandboxFileResult,
  type SandboxRuntimePort,
} from './sandbox-runtime.port'
import { AgentThreadRepository } from '../agent-thread.repository'
import type { ActivatedSkill } from '../skills/executable-skill.service'
import { ExecutableSkillService } from '../skills/executable-skill.service'

interface ThreadExecutionSession {
  threadId: string
  userId: string
  sandboxId: string
  createdAt: Date
  expiresAt: Date
  cleanupTimer?: ReturnType<typeof setTimeout>
}

interface RunExecutionSession {
  runId: string
  userId: string
  thread: ThreadExecutionSession
  activeSkills: Map<string, ActivatedSkill>
}

@Injectable()
export class AgentExecutionSessionService {
  private readonly logger = new Logger(AgentExecutionSessionService.name)
  private readonly threadSessions = new Map<string, ThreadExecutionSession>()
  private readonly runSessions = new Map<string, RunExecutionSession>()
  private readonly pendingThreads = new Map<string, Promise<ThreadExecutionSession>>()
  private readonly timeoutMs: number

  constructor(
    @Inject(ExecutableSkillService) private readonly skills: ExecutableSkillService,
    @Inject(SANDBOX_RUNTIME_PORT) private readonly sandboxes: SandboxRuntimePort,
    @Inject(AgentThreadRepository) private readonly threads: AgentThreadRepository,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.timeoutMs = config.get<number>('SANDBOX_TIMEOUT_SECONDS', 3_600) * 1_000
  }

  async startRun(
    runId: string,
    threadId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const existing = this.runSessions.get(runId)
    this.assertOwner(existing, userId)
    if (existing) return existing.thread.sandboxId

    let thread = await this.getOrCreateThreadSession(runId, threadId, userId, signal)
    this.clearCleanupTimer(thread)
    try {
      await this.sandboxes.resetRunState(thread.sandboxId, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      await this.discardUnusableThread(thread)
      thread = await this.getOrCreateThreadSession(runId, threadId, userId, signal)
      await this.sandboxes.resetRunState(thread.sandboxId, signal)
    }
    this.runSessions.set(runId, {
      runId,
      userId,
      thread,
      activeSkills: new Map(),
    })
    return thread.sandboxId
  }

  async activateSkill(
    runId: string,
    userId: string,
    name: string,
    signal?: AbortSignal,
  ): Promise<{ sandboxId: string; skill: ActivatedSkill; alreadyActive: boolean }> {
    const session = this.requireRunSession(runId, userId)
    const active = session.activeSkills.get(name)
    if (active) {
      return { sandboxId: session.thread.sandboxId, skill: active, alreadyActive: true }
    }

    const [prepared] = await this.skills.prepareActivation(userId, [name], signal)
    if (!prepared) throw new Error(`Skill activation returned no package: ${name}`)
    const installed = await this.sandboxes.installSkillPackage({
      sandboxId: session.thread.sandboxId,
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
    return { sandboxId: session.thread.sandboxId, skill, alreadyActive: false }
  }

  async runShell(
    runId: string,
    userId: string,
    input: { command: string; workingDirectory: string; signal?: AbortSignal },
  ): Promise<SandboxCommandResult> {
    const session = this.requireRunSession(runId, userId)
    return this.sandboxes.runCommand({
      sandboxId: session.thread.sandboxId,
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
    const session = this.requireRunSession(runId, userId)
    return this.sandboxes.readFile(session.thread.sandboxId, path, signal)
  }

  async readOutputFile(
    runId: string,
    userId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult | null> {
    const session = this.requireRunSession(runId, userId)
    return this.sandboxes.readOutputFile(session.thread.sandboxId, path, signal)
  }

  async writeFile(
    runId: string,
    userId: string,
    path: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult> {
    const session = this.requireRunSession(runId, userId)
    return this.sandboxes.writeFile({
      sandboxId: session.thread.sandboxId,
      path,
      bytes,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  async finishRun(runId: string): Promise<void> {
    const session = this.runSessions.get(runId)
    if (!session) return
    this.runSessions.delete(runId)
    try {
      await this.sandboxes.resetRunState(session.thread.sandboxId)
      await this.threads.markSandboxIdle(
        session.thread.threadId,
        session.userId,
        session.thread.sandboxId,
      )
      this.scheduleCleanup(session.thread)
    } catch (error) {
      this.logger.warn(
        { error, runId, sandboxId: session.thread.sandboxId },
        'Thread sandbox became unusable while releasing Run',
      )
      await this.destroyThread(session.thread.threadId)
    }
  }

  async destroyThread(threadId: string): Promise<void> {
    const session =
      this.threadSessions.get(threadId) ?? (await this.restoreOneThreadSession(threadId))
    if (!session) return
    this.clearCleanupTimer(session)
    this.threadSessions.delete(threadId)
    for (const [runId, run] of this.runSessions) {
      if (run.thread.threadId === threadId) this.runSessions.delete(runId)
    }
    await this.sandboxes.destroySandbox(session.sandboxId)
    await this.threads.clearSandbox(threadId, session.sandboxId)
  }

  async restoreThreadSessions(): Promise<void> {
    const rows = await this.threads.listOwnedSandboxes()
    for (const row of rows) {
      const session = this.fromRow(row)
      if (session.expiresAt.getTime() <= Date.now()) {
        await this.sandboxes.destroySandbox(session.sandboxId).catch(() => undefined)
        await this.threads.clearSandbox(session.threadId, session.sandboxId)
        continue
      }
      this.threadSessions.set(session.threadId, session)
      this.scheduleCleanup(session)
    }
  }

  private async getOrCreateThreadSession(
    runId: string,
    threadId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<ThreadExecutionSession> {
    const current = this.threadSessions.get(threadId)
    this.assertThreadOwner(current, userId)
    if (current && current.expiresAt.getTime() > Date.now()) return current

    const pending = this.pendingThreads.get(threadId)
    if (pending) {
      const resolved = await pending
      this.assertThreadOwner(resolved, userId)
      return resolved
    }

    const creating = this.loadOrCreateThreadSession(runId, threadId, userId, signal)
    this.pendingThreads.set(threadId, creating)
    try {
      return await creating
    } finally {
      this.pendingThreads.delete(threadId)
    }
  }

  private async loadOrCreateThreadSession(
    runId: string,
    threadId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<ThreadExecutionSession> {
    const persisted = await this.threads.findSandboxForOwner(threadId, userId)
    if (persisted) {
      const session = this.fromRow(persisted)
      if (session.expiresAt.getTime() > Date.now()) {
        try {
          await this.sandboxes.waitUntilReady(session.sandboxId, signal)
          this.threadSessions.set(threadId, session)
          return session
        } catch {
          await this.sandboxes.destroySandbox(session.sandboxId).catch(() => undefined)
          await this.threads.clearSandbox(threadId, session.sandboxId)
        }
      } else {
        await this.sandboxes.destroySandbox(session.sandboxId).catch(() => undefined)
        await this.threads.clearSandbox(threadId, session.sandboxId)
      }
    }

    const created = await this.sandboxes.createSandbox({
      runId,
      threadId,
      limits: { sandboxTimeoutMs: this.timeoutMs },
      ...(signal === undefined ? {} : { signal }),
    })
    try {
      const ready = await this.sandboxes.waitUntilReady(created.sandboxId, signal)
      const session: ThreadExecutionSession = {
        threadId,
        userId,
        sandboxId: ready.sandboxId,
        createdAt: new Date(ready.createdAt),
        expiresAt: new Date(ready.expiresAt),
      }
      await this.threads.markSandboxReady(threadId, userId, {
        sandboxId: session.sandboxId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
      this.threadSessions.set(threadId, session)
      return session
    } catch (error) {
      await this.sandboxes.destroySandbox(created.sandboxId).catch(() => undefined)
      throw error
    }
  }

  private async restoreOneThreadSession(threadId: string): Promise<ThreadExecutionSession | null> {
    const row = (await this.threads.listOwnedSandboxes()).find((item) => item.id === threadId)
    if (!row) return null
    const session = this.fromRow(row)
    this.threadSessions.set(threadId, session)
    return session
  }

  private async discardUnusableThread(session: ThreadExecutionSession): Promise<void> {
    this.clearCleanupTimer(session)
    this.threadSessions.delete(session.threadId)
    await this.sandboxes.destroySandbox(session.sandboxId).catch(() => undefined)
    await this.threads.clearSandbox(session.threadId, session.sandboxId)
  }

  private fromRow(row: {
    id: string
    userId: string
    sandboxId: string
    sandboxCreatedAt: Date
    sandboxExpiresAt: Date
  }): ThreadExecutionSession {
    return {
      threadId: row.id,
      userId: row.userId,
      sandboxId: row.sandboxId,
      createdAt: row.sandboxCreatedAt,
      expiresAt: row.sandboxExpiresAt,
    }
  }

  private scheduleCleanup(session: ThreadExecutionSession): void {
    this.clearCleanupTimer(session)
    const delay = Math.max(0, Math.min(this.timeoutMs, session.expiresAt.getTime() - Date.now()))
    session.cleanupTimer = setTimeout(() => {
      void this.destroyThread(session.threadId).catch((error) => {
        this.logger.error(
          { error, threadId: session.threadId, sandboxId: session.sandboxId },
          'Thread sandbox idle cleanup failed',
        )
      })
    }, delay)
    session.cleanupTimer.unref?.()
  }

  private clearCleanupTimer(session: ThreadExecutionSession): void {
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
    delete session.cleanupTimer
  }

  private requireRunSession(runId: string, userId: string): RunExecutionSession {
    const session = this.runSessions.get(runId)
    this.assertOwner(session, userId)
    if (!session) throw new Error('Run Sandbox 尚未创建')
    return session
  }

  private assertOwner(session: RunExecutionSession | undefined, userId: string): void {
    if (session && session.userId !== userId)
      throw new Error('Run execution session owner mismatch')
  }

  private assertThreadOwner(session: ThreadExecutionSession | undefined, userId: string): void {
    if (session && session.userId !== userId)
      throw new Error('Thread execution session owner mismatch')
  }
}
