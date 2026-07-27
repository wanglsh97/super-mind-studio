import { Inject, Injectable, Logger } from '@nestjs/common'
import type { OnModuleInit } from '@nestjs/common'

import { RedisService } from '../redis/redis.service'
import { AgentRunRepository } from './agent-run.repository'
import { agentActiveRunLockKey } from './agent.constants'
import { SANDBOX_RUNTIME_PORT, type SandboxRuntimePort } from './sandbox/sandbox-runtime.port'

/**
 * API 启动清理：将进程外遗留的 running/cancelling run 标为 interrupted，
 * 并清除用户级 Redis active-run 锁。不重放模型调用或工具。
 */
@Injectable()
export class AgentStartupCleanupService implements OnModuleInit {
  private readonly logger = new Logger(AgentStartupCleanupService.name)

  constructor(
    @Inject(AgentRunRepository) private readonly runs: AgentRunRepository,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(SANDBOX_RUNTIME_PORT) private readonly sandboxes: SandboxRuntimePort,
  ) {}

  async onModuleInit(): Promise<void> {
    await Promise.all([this.cleanupRunState(), this.reconcileExpiredSandboxes()])
  }

  private async cleanupRunState(): Promise<void> {
    try {
      const interrupted = await this.runs.interruptAbandonedRuns()
      const locksCleared = await this.redis.deleteKeysByPrefix('agent:active-run:')
      this.logger.log(
        {
          interruptedRuns: interrupted.count,
          runIds: interrupted.runIds,
          locksCleared,
        },
        'Agent startup cleanup finished (no model/tool replay)',
      )
    } catch (error) {
      // 启动清理失败不应阻断 API 启动，但需可观测；后续请求仍受 PG/Redis 约束保护。
      this.logger.error({ error }, 'Agent startup cleanup failed')
    }
  }

  private async reconcileExpiredSandboxes(): Promise<void> {
    try {
      const leaked = await this.sandboxes.listLeakedSandboxes(new Date())
      const results = await Promise.allSettled(
        leaked.map((sandbox) => this.sandboxes.destroySandbox(sandbox.sandboxId)),
      )
      const failedSandboxIds = results.flatMap((result, index) =>
        result.status === 'rejected' ? [leaked[index]?.sandboxId ?? 'unknown'] : [],
      )
      this.logger.log(
        {
          discoveredSandboxes: leaked.length,
          destroyedSandboxes: leaked.length - failedSandboxIds.length,
          failedSandboxIds,
        },
        'Expired sandbox reconciliation finished',
      )
    } catch (error) {
      // OpenSandbox being unavailable is already reflected in readiness; it must not block API boot.
      this.logger.error({ error }, 'Expired sandbox reconciliation failed')
    }
  }
}

/** 测试辅助：构造与生产相同的锁 key，避免散落字面量。 */
export function activeRunLockKeyForTests(userId: string): string {
  return agentActiveRunLockKey(userId)
}
