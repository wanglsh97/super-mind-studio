import 'reflect-metadata'

import type { AddressInfo } from 'node:net'

import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'

import type { createSuperMindClient } from '@supermind/sdk'

import { AppModule } from '../../app.module'
import { configureApplication } from '../../configure-app'
import { MODEL_INVOCATION_PORT } from '../../chat/model-invocation.port'
import type { ModelInvocationPort } from '../../chat/model-invocation.port'
import { PrismaService } from '../../database/prisma.service'
import { createAnonymousIdentity } from '../../user-auth/anonymous-identity'
import { USER_SESSION_COOKIE } from '../../user-auth/user-auth.constants'
import { UserSessionService } from '../../user-auth/user-session.service'

const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<typeof import('@supermind/sdk')>

export type EvalGatewayClient = ReturnType<typeof createSuperMindClient>

export interface AgentEvalHarness {
  app: INestApplication
  baseUrl: string
  client: EvalGatewayClient
  prisma: PrismaService
  modelInvocation: ModelInvocationPort
  modelId: string
  judgeModelId: string
  close: () => Promise<void>
}

export async function createAgentEvalHarness(input: {
  evalModelAlias: string
  judgeModelAlias: string
}): Promise<AgentEvalHarness> {
  const { createSuperMindClient: createClient } = await nativeImport('@supermind/sdk')
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  configureApplication(app)
  await app.listen(0, '127.0.0.1')

  const address = app.getHttpServer().address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  const prisma = app.get(PrismaService)
  const sessions = app.get(UserSessionService)
  const modelInvocation = app.get<ModelInvocationPort>(MODEL_INVOCATION_PORT)

  const { token } = await sessions.create(createAnonymousIdentity())

  const client = createClient({
    baseUrl,
    fetch: (inputUrl, init) => {
      return globalThis.fetch(inputUrl, {
        ...init,
        headers: {
          ...(init?.headers as Record<string, string>),
          cookie: `${USER_SESSION_COOKIE}=${token}`,
        },
      })
    },
  })

  const models = await client.models.list()
  const modelId = resolveModelId(models, input.evalModelAlias)
  const judgeModelId = resolveModelId(models, input.judgeModelAlias)

  return {
    app,
    baseUrl,
    client,
    prisma,
    modelInvocation,
    modelId,
    judgeModelId,
    close: async () => {
      await app.close()
    },
  }
}

function resolveModelId(
  models: Awaited<ReturnType<EvalGatewayClient['models']['list']>>,
  alias: string,
): string {
  const normalized = alias.trim().toLowerCase()
  const byAlias = models.find(
    (model) =>
      model.enabled &&
      model.capabilities.includes('agent') &&
      String(model.alias).toLowerCase() === normalized,
  )
  if (byAlias) return byAlias.id

  const byId = models.find(
    (model) =>
      model.enabled &&
      model.capabilities.includes('agent') &&
      model.id.toLowerCase() === normalized,
  )
  if (byId) return byId.id

  const available = models
    .filter((model) => model.enabled && model.capabilities.includes('agent'))
    .map((model) => `${model.id}(alias=${model.alias})`)
    .join(', ')
  throw new Error(
    `找不到可用的 Agent 模型「${alias}」。当前可用: ${available || '(无)'}。请确认对应 provider 已启用且配置 API Key。`,
  )
}
