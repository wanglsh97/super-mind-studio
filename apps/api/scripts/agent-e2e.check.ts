import 'reflect-metadata'

import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

import { NestFactory } from '@nestjs/core'

import type { AgentStreamEvent } from '@supermind/sdk'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/configure-app'
import { PrismaService } from '../src/database/prisma.service'
import { ExecutableSkillService } from '../src/agent/skills/executable-skill.service'
import { USER_SESSION_COOKIE } from '../src/user-auth/user-auth.constants'
import { UserSessionService } from '../src/user-auth/user-session.service'

/**
 * Agent 端到端检查（tsx + 真实 HTTP + PostgreSQL，不依赖公网）。
 *
 * 串通：SDK → Agent API → 手动 Skill 激活 → Pi harness → OpenSandbox Shell →
 * follow-up turn → SSE cursor → PostgreSQL RequestLog/BillingRecord。
 * 通过 `pnpm test:agent-e2e` 执行（需要本地 Postgres/Redis 与完整 .env）。
 */
// @supermind/sdk 为 ESM（仅 import 条件），在 tsx/CJS 下用原生动态 import 加载其构建产物。
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@supermind/sdk')>

async function main(): Promise<void> {
  // 强制 Mock、确定性、零成本：仅启用 Mock Adapter，禁用所有真实 provider。
  // 必须在进程启动前经 test:agent-e2e 脚本以环境变量注入（@nestjs/config 不覆盖已有 process.env）。
  assert.equal(process.env.MOCK_PROVIDER_ENABLED, 'true')
  for (const provider of ['QWEN', 'GLM', 'DEEPSEEK', 'KIMI']) {
    assert.equal(process.env[`${provider}_ENABLED`], 'false', `${provider} 必须在无外网 E2E 中关闭`)
  }
  assert.equal(process.env.AGENT_WEB_FETCH_FIXTURE, 'true')

  const { createAIGatewayClient } = await nativeImport('@supermind/sdk')
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  configureApplication(app)
  await app.listen(0, '127.0.0.1')

  const address = app.getHttpServer().address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const prisma = app.get(PrismaService)
  const sessions = app.get(UserSessionService)
  const executableSkills = app.get(ExecutableSkillService)

  const githubId = `agent-e2e-${randomUUID().slice(0, 8)}`
  const { token, user } = await sessions.create({
    githubId,
    githubUsername: 'agent-e2e',
    displayName: null,
    avatarUrl: null,
    email: null,
  })

  const client = createAIGatewayClient({
    baseUrl,
    fetch: (input, init) => {
      const url = new URL(String(input))
      assert.equal(url.protocol, 'http:', 'E2E 只允许本地 HTTP')
      assert.equal(url.hostname, '127.0.0.1', 'E2E 不得访问外网')
      return globalThis.fetch(input, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          cookie: `${USER_SESSION_COOKIE}=${token}`,
        },
      })
    },
  })

  let threadId: string | undefined
  try {
    // 认证边界：无会话 Cookie 不得访问 Agent API
    const unauth = await globalThis.fetch(`${baseUrl}/api/v1/agent/threads`)
    assert.equal(unauth.status, 401, '未登录访问 Agent threads 应返回 401')

    const models = await client.models.list()
    const model = models.find(
      (candidate) => candidate.enabled && candidate.capabilities.includes('agent'),
    )
    assert.ok(model, '需要至少一个启用且声明 agent capability 的模型（开发环境应启用 Mock）')
    assert.ok(model.capabilities.includes('agent'))

    const thread = await client.agent.threads.create({ model: model.id })
    threadId = thread.id
    await executableSkills.add(user.id, 'mock-data-cleaner')

    const run = await client.agent.runs.create(thread.id, {
      input: 'SCENARIO:shell 使用 Skill 清洗数据',
      skills: [{ name: 'mock-data-cleaner' }],
    })
    assert.equal(run.status, 'running')

    const events: AgentStreamEvent[] = []
    for await (const event of client.agent.runs.subscribe(run.id)) {
      events.push(event)
    }

    const types = events.map((event) => event.type)
    assert.ok(types.includes('tool-call'), '应出现 tool-call 事件')
    assert.ok(types.includes('tool-result'), '应出现 tool-result 事件')
    assert.ok(types.includes('skill-activation'), '应出现手动 Skill 激活事件')
    const skillActivated = events.find(
      (event) => event.type === 'skill-activation' && event.status === 'succeeded',
    )
    assert.ok(skillActivated && skillActivated.packageSha256, '激活事件应记录当前包 SHA-256')
    const shellCall = events.find(
      (event) => event.type === 'tool-call' && event.toolName === 'shell',
    )
    assert.ok(shellCall, 'Mock 模型应调用 OpenSandbox Shell')
    const terminal = events.at(-1)
    assert.equal(terminal?.type, 'run-terminal')
    assert.equal(terminal && 'status' in terminal ? terminal.status : undefined, 'succeeded')

    // sequence 严格递增；并发写入允许订阅视图存在间隙，但不得倒序或重复。
    events.forEach((event, index) => {
      const previous = events[index - 1]
      if (previous) assert.ok(event.sequence > previous.sequence, 'SSE sequence 应严格递增')
    })

    // 断线补读：从中间 sequence 重新订阅，只应收到之后的事件
    const midpoint = Math.floor(events.length / 2)
    const replay: AgentStreamEvent[] = []
    for await (const event of client.agent.runs.subscribe(run.id, { after: midpoint })) {
      replay.push(event)
    }
    assert.ok(
      replay.every((event) => event.sequence > midpoint),
      '补读只应返回游标之后的事件',
    )
    assert.equal(replay.at(-1)?.type, 'run-terminal')

    // 刷新恢复：thread 详情返回有序消息快照
    const detail = await client.agent.threads.get(thread.id)
    const roles = detail.messages.map((message) => message.role)
    assert.deepEqual(roles, ['user', 'assistant', 'tool', 'assistant'], '刷新后应恢复完整消息快照')
    assert.equal(detail.activeRun, null, 'run 已终结')
    assert.equal(detail.sandbox?.status, 'idle', 'Run 终结后 Thread Sandbox 应保持空闲可用')

    // PostgreSQL：Run、工具、模型调用与账单均形成可审计记录。
    const persistedRun = await prisma.agentRun.findUniqueOrThrow({ where: { id: run.id } })
    assert.equal(persistedRun.status, 'SUCCEEDED')
    assert.equal(persistedRun.modelCallCount, 2, '首轮工具调用和 follow-up 应各调用一次模型')
    assert.equal(persistedRun.toolCallCount, 1)
    assert.ok(persistedRun.completedAt)

    const toolCalls = await prisma.agentToolCall.findMany({ where: { runId: run.id } })
    assert.equal(toolCalls.length, 1)
    assert.equal(toolCalls[0]?.toolName, 'shell')
    assert.equal(toolCalls[0]?.status, 'SUCCEEDED')
    assert.deepEqual(toolCalls[0]?.args, {
      command: 'node scripts/clean.mjs',
      workingDirectory: '/workspace/skills/mock-data-cleaner',
    })

    // 每次模型调用一条 RequestLog + 一对一 BillingRecord。
    const requestLogs = await prisma.requestLog.findMany({
      where: { agentRunId: run.id },
      include: { billing: true },
    })
    assert.equal(requestLogs.length, 2, '两次模型调用应各有一条 RequestLog')
    for (const log of requestLogs) {
      assert.equal(log.capability, 'AGENT')
      assert.ok(log.billing, 'RequestLog 应有一对一 BillingRecord')
    }
    const requestLogIds = requestLogs.map((log) => log.id)
    const billingIds = requestLogs.map((log) => {
      assert.ok(log.billing)
      return log.billing.id
    })

    // 同一 Thread 的下一轮 Run 复用 Sandbox，但重新激活 Skill 并重置 Run 预算。
    const secondRun = await client.agent.runs.create(thread.id, {
      input: 'SCENARIO:shell 再次使用 Skill 清洗数据',
      skills: [{ name: 'mock-data-cleaner' }],
    })
    const secondEvents: AgentStreamEvent[] = []
    for await (const event of client.agent.runs.subscribe(secondRun.id)) {
      secondEvents.push(event)
    }
    assert.equal(secondEvents.at(-1)?.type, 'run-terminal')
    const persistedSecondRun = await prisma.agentRun.findUniqueOrThrow({
      where: { id: secondRun.id },
    })
    assert.equal(persistedSecondRun.status, 'SUCCEEDED')
    assert.equal(persistedSecondRun.sandboxId, persistedRun.sandboxId)
    assert.ok(persistedSecondRun.sandboxId, '两轮 Run 应记录同一个 Thread Sandbox ID')
    const detailAfterSecondRun = await client.agent.threads.get(thread.id)
    assert.equal(detailAfterSecondRun.sandbox?.id, persistedRun.sandboxId)
    assert.equal(detailAfterSecondRun.sandbox?.status, 'idle')

    // 2.2：重命名与永久删除；Agent 子记录级联清除，RequestLog/BillingRecord 保留
    const renamed = await client.agent.threads.rename(thread.id, { title: 'e2e 重命名会话' })
    assert.equal(renamed.title, 'e2e 重命名会话')
    const listed = await client.agent.threads.list()
    assert.ok(
      listed.items.some((item) => item.id === thread.id && item.title === 'e2e 重命名会话'),
      '列表应反映新标题',
    )

    await client.agent.threads.delete(thread.id)
    threadId = undefined

    assert.equal(await prisma.agentThread.count({ where: { id: thread.id } }), 0)
    assert.equal(await prisma.agentMessage.count({ where: { threadId: thread.id } }), 0)
    assert.equal(await prisma.agentRun.count({ where: { id: run.id } }), 0)
    assert.equal(await prisma.agentRun.count({ where: { id: secondRun.id } }), 0)
    assert.equal(await prisma.agentEvent.count({ where: { runId: run.id } }), 0)
    assert.equal(await prisma.agentToolCall.count({ where: { runId: run.id } }), 0)

    const retainedLogs = await prisma.requestLog.findMany({
      where: { id: { in: requestLogIds } },
      include: { billing: true },
    })
    assert.equal(retainedLogs.length, requestLogIds.length, '删除会话不得删除 RequestLog')
    for (const log of retainedLogs) {
      assert.equal(log.agentRunId, null, 'RequestLog.agentRunId 应为 SetNull')
      assert.ok(log.billing, 'BillingRecord 应随 RequestLog 保留')
      assert.ok(billingIds.includes(log.billing.id))
    }

    console.log(
      'agent-e2e.check PASS: Web→SDK→API→manual Skill→Pi→OpenSandbox Shell→follow-up→SSE cursor→PostgreSQL',
    )
  } finally {
    if (threadId)
      await prisma.agentThread.delete({ where: { id: threadId } }).catch(() => undefined)
    await prisma.requestLog.deleteMany({ where: { userId: user.id } }).catch(() => undefined)
    await prisma.userSession.deleteMany({ where: { userId: user.id } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined)
    await app.close()
  }
}

main().catch((error) => {
  console.error('agent-e2e.check FAILED')
  console.error(error)
  process.exitCode = 1
})
