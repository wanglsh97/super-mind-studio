import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 文档级约束：删除 AgentThread 时级联清除 Agent 子表，但 RequestLog.agentRunId 为 SetNull，
 * 从而保留 RequestLog / BillingRecord 审计真相。真实数据路径由 agent-e2e 覆盖。
 */
describe('Agent thread delete cascade contract', () => {
  const migration = readFileSync(
    path.resolve(
      __dirname,
      '../../../../prisma/migrations/20260720091033_add_pi_web_agent/migration.sql',
    ),
    'utf8',
  )

  it('cascades Agent child tables from thread/run deletes', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE',
    )
    expect(migration).toMatch(/"AgentEvent".*REFERENCES "AgentRun"\("id"\) ON DELETE CASCADE/s)
    expect(migration).toMatch(/"AgentToolCall".*REFERENCES "AgentRun"\("id"\) ON DELETE CASCADE/s)
  })

  it('nulls RequestLog.agentRunId instead of deleting billing audit rows', () => {
    expect(migration).toContain(
      'FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL',
    )
  })
})
