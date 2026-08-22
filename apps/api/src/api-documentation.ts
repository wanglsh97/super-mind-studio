import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

import { ADMIN_SESSION_COOKIE } from './admin/auth/admin-auth.service'
import { USER_SESSION_COOKIE } from './user-auth/user-auth.constants'

export function configureApiDocumentation(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Super Mind Studio API')
    .setDescription(
      'Agent、文生图与 Prompt 优化要求用户 Session Cookie；用户可通过 GitHub OAuth 或 Google OAuth 登录，不提供匿名登录，且 provider 身份不按邮箱合并。管理员接口使用独立管理员 Session Cookie。OAuth code、access token 和 Cookie 均不得写入请求正文或日志。',
    )
    .setVersion('1.0')
    .addCookieAuth(USER_SESSION_COOKIE, undefined, USER_SESSION_COOKIE)
    .addCookieAuth(ADMIN_SESSION_COOKIE, undefined, ADMIN_SESSION_COOKIE)
    .addTag('User authentication', 'GitHub OAuth、Google OAuth、用户 Session 查询与当前设备退出')
    .addTag('Chat', '登录用户的流式 Chat 能力')
    .addTag('Images', '登录用户的文生图任务、状态与下载')
    .addTag('Prompts', '登录用户的 Prompt 优化')
    .addTag('Admin', '使用独立管理员 Session 的内部管理接口')
    .build()

  const documentFactory = () => SwaggerModule.createDocument(app, config)
  SwaggerModule.setup('api-docs', app, documentFactory, {
    jsonDocumentUrl: 'api-docs/openapi.json',
    yamlDocumentUrl: 'api-docs/openapi.yaml',
    customSiteTitle: 'Super Mind Studio API',
  })
}
