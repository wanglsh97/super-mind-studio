import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common'

import { RedisService } from '../redis/redis.service'
import { AGENT_ACTIVE_RUN_LOCK_TTL_SECONDS, agentActiveRunLockKey } from './agent.constants'

/**
 * 单 Thread active Agent run 的 Redis 原子锁。
 *
 * PostgreSQL 的 active run 查询仍是真源；本锁用于跨请求快速互斥。
 * Redis 不可用时 fail closed，不得绕过约束创建付费 run。
 */
@Injectable()
export class AgentActiveRunLock {
  private readonly logger = new Logger(AgentActiveRunLock.name)

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  /**
   * 尝试获取用户级锁。成功返回 true；键已被占用返回 false。
   * Redis 异常抛出 503。
   */
  async tryAcquire(threadId: string, token: string): Promise<boolean> {
    try {
      return await this.redis.trySetNxEx(
        agentActiveRunLockKey(threadId),
        token,
        AGENT_ACTIVE_RUN_LOCK_TTL_SECONDS,
      )
    } catch (error) {
      this.logger.error({ error, threadId }, 'Redis Agent active-run lock acquire failed closed')
      throw new HttpException('Agent 并发锁服务暂时不可用', HttpStatus.SERVICE_UNAVAILABLE)
    }
  }

  async release(threadId: string, token: string): Promise<void> {
    try {
      await this.redis.deleteIfValueEquals(agentActiveRunLockKey(threadId), token)
    } catch (error) {
      // 释放失败不阻断终态；TTL 与启动清理会回收过期锁。
      this.logger.warn({ error, threadId }, 'Redis Agent active-run lock release failed')
    }
  }

  /** 同一 Thread 已有 active run 时的统一冲突响应。 */
  threadConflict(existingRunId?: string): ConflictException {
    return new ConflictException({
      message: '当前会话已有进行中的 Agent 运行，请等待其结束',
      details:
        existingRunId === undefined
          ? { code: 'AGENT_ACTIVE_RUN' }
          : {
              code: 'AGENT_THREAD_ACTIVE_RUN',
              activeRunId: existingRunId,
            },
    })
  }

  userLimit(limit: number): ConflictException {
    return new ConflictException({
      message: `已达到同时运行 ${limit} 个 Agent 的上限`,
      details: { code: 'AGENT_USER_CONCURRENCY_LIMIT', limit },
    })
  }
}
