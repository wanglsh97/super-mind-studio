import { Injectable } from '@nestjs/common'

interface RunQuestionEventSequence {
  flush(): Promise<void>
  advancePast(sequence: number): void
}

/**
 * 连接持久问卷事件与当前进程内的 AgentRunProjector。
 *
 * 问卷事件由 HTTP/Question service 写入数据库，而普通 Pi 事件由 projector 编号。等待工具
 * 期间两者必须共享同一条 sequence 时间线，否则 tool-result 会与 question event 冲突。
 */
@Injectable()
export class AgentRunQuestionEventBridge {
  private readonly runs = new Map<string, RunQuestionEventSequence>()

  register(runId: string, sequence: RunQuestionEventSequence): void {
    this.runs.set(runId, sequence)
  }

  unregister(runId: string): void {
    this.runs.delete(runId)
  }

  async flush(runId: string): Promise<void> {
    await this.runs.get(runId)?.flush()
  }

  advancePast(runId: string, sequence: number): void {
    this.runs.get(runId)?.advancePast(sequence)
  }
}
