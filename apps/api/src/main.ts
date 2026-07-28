import 'reflect-metadata'

import { randomUUID } from 'node:crypto'

import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { configureApiDocumentation } from './api-documentation'
import { configureApplication } from './configure-app'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const config = app.get(ConfigService)

  if (config.get<boolean>('ADMIN_FIXED_CREDENTIALS_ENABLED', true)) {
    new Logger('Security').warn(
      '固定管理员凭证 root/123456 已启用；公网环境存在高风险，仅应在明确接受风险时使用',
    )
  }

  configureApplication(app)
  configureApiDocumentation(app)

  const port = config.getOrThrow<number>('API_PORT')
  await app.listen(port)
}

void bootstrap().catch((error: unknown) => {
  const failureId = randomUUID()
  console.error(`API 启动失败，failureId=${failureId}`, error)
  process.exitCode = 1
})
