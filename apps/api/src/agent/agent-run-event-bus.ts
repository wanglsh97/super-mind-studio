import type { AgentStreamEvent } from '@supermind/sdk'
import { Injectable, Logger } from '@nestjs/common'

type Listener = (event: AgentStreamEvent) => void

interface RunChannel {
  listeners: Set<Listener>
  closed: boolean
}

/**
 * 进程内 Agent run 事件总线。
 *
 * run 执行时把已持久化的 wire 事件投影到订阅者（SSE）。这里只承担“实时尾随”；断线补读的
 * 真源是 PostgreSQL 中的 AgentEvent（按 sequence 唯一），controller 负责先补读 DB 再接实时流，
 * 并按 sequence 去重。总线不持久化任何数据。
 */
@Injectable()
export class AgentRunEventBus {
  private readonly logger = new Logger(AgentRunEventBus.name)
  private readonly channels = new Map<string, RunChannel>()

  publish(runId: string, event: AgentStreamEvent): void {
    const channel = this.channels.get(runId)
    if (!channel) return
    for (const listener of channel.listeners) {
      try {
        listener(event)
      } catch (error) {
        this.logger.warn(
          { error, runId, eventType: event.type, sequence: event.sequence },
          'Agent run event listener failed; delivery remains best effort',
        )
      }
    }
  }

  close(runId: string): void {
    const channel = this.channels.get(runId)
    if (!channel) return
    channel.closed = true
    this.channels.delete(runId)
  }

  isActive(runId: string): boolean {
    return this.channels.has(runId)
  }

  /** 打开一个 run 通道（run 执行开始时调用）。 */
  open(runId: string): void {
    if (!this.channels.has(runId)) this.channels.set(runId, { listeners: new Set(), closed: false })
  }

  /**
   * 订阅实时事件。返回一个取消订阅函数。仅传递订阅之后发布的事件；补读历史由调用方从 DB 完成。
   */
  subscribe(runId: string, listener: Listener): () => void {
    let channel = this.channels.get(runId)
    if (!channel) {
      channel = { listeners: new Set(), closed: false }
      this.channels.set(runId, channel)
    }
    channel.listeners.add(listener)
    return () => {
      const current = this.channels.get(runId)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0 && current.closed) this.channels.delete(runId)
    }
  }
}
