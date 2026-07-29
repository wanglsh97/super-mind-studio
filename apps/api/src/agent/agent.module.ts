import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { ModelGatewayModule } from '../chat/model-gateway.module'
import { RedisModule } from '../redis/redis.module'
import { RequestLifecycleModule } from '../request-lifecycle/request-lifecycle.module'
import { UserAuthModule } from '../user-auth/user-auth.module'
import { TokenAnalyticsModule } from '../token-analytics/token-analytics.module'
import { AgentActiveRunLock } from './agent-active-run.lock'
import { AgentContextPreparer } from './context/agent-context-preparer'
import { AgentOutputFileRepository } from './files/agent-output-file.repository'
import { AgentOutputFileService } from './files/agent-output-file.service'
import { AgentContextSummaryRepository } from './context/agent-context-summary.repository'
import { AgentContextSummaryService } from './context/agent-context-summary.service'
import { AgentController } from './agent.controller'
import { AgentMessageRepository } from './agent-message.repository'
import { AgentModelInvocationRepository } from './agent-model-invocation.repository'
import { AgentMcpSdkClient } from './mcp/agent-mcp.client'
import { AgentMcpPreferenceRepository } from './mcp/agent-mcp-preference.repository'
import { AGENT_MCP_REGISTRY, PlatformAgentMcpRegistry } from './mcp/agent-mcp.registry'
import { AGENT_MEMORY_PROVIDER, EmptyAgentMemoryProvider } from './memory/agent-memory.provider'
import { AgentRunEventBus } from './agent-run-event-bus'
import { AgentRunRepository } from './agent-run.repository'
import { AgentRunService } from './agent-run.service'
import { AgentService } from './agent.service'
import { AgentStartupCleanupService } from './agent-startup-cleanup.service'
import { AgentThreadRepository } from './agent-thread.repository'
import { AgentPromptComposer } from './prompt/agent-prompt.composer'
import { AgentExecutionSessionService } from './sandbox/agent-execution-session.service'
import { OpenSandboxRuntime } from './sandbox/open-sandbox-runtime'
import { SANDBOX_RUNTIME_PORT } from './sandbox/sandbox-runtime.port'
import type { SandboxRuntimePort } from './sandbox/sandbox-runtime.port'
import { AGENT_SKILL_REGISTRY } from './skills/agent-skill.registry'
import { AgentSkillRepository } from './skills/agent-skill.repository'
import { AgentSkillService } from './skills/agent-skill.service'
import { ExecutableSkillBootstrap } from './skills/executable-skill.bootstrap'
import { MOCK_EXECUTABLE_SKILL_PACKAGE } from './skills/executable-skill.fixture'
import { ExecutableSkillRepository } from './skills/executable-skill.repository'
import { ExecutableSkillService } from './skills/executable-skill.service'
import { SkillMarketController } from './skills/market/skill-market.controller'
import { SkillMarketRepository } from './skills/market/skill-market.repository'
import { SkillMarketService } from './skills/market/skill-market.service'
import { PlatformAgentSkillCatalog } from './skills/platform-agent-skill.catalog'
import { SkillPublishingRepository } from './skills/publishing/skill-publishing.repository'
import { SkillPublishingService } from './skills/publishing/skill-publishing.service'
import { InMemorySkillObjectStore } from './skills/storage/in-memory-skill-object-store'
import {
  AliyunOssSkillObjectStore,
  createAliyunOssClient,
} from './skills/storage/aliyun-oss-skill-object-store'
import { SKILL_OBJECT_STORE_PORT } from './skills/storage/skill-object-store.port'
import { AGENT_TOOLS, AgentToolRegistry } from './tools/agent-tool.registry'
import { createExportFileTool } from './tools/export-file.tool'
import { createReadFileTool } from './tools/read-file.tool'
import { createShellTool } from './tools/shell.tool'
import { createActivateSkillTool } from './tools/activate-skill.tool'
import { createWriteFileTool } from './tools/write-file.tool'
import { InMemorySkillUploadSigner } from './skills/upload/in-memory-skill-upload-signer'
import { SKILL_UPLOAD_SIGNER_PORT } from './skills/upload/skill-upload-signer.port'
import { SkillUploadSessionRepository } from './skills/upload/skill-upload-session.repository'
import {
  SKILL_UPLOAD_CLOCK,
  SkillUploadSessionService,
} from './skills/upload/skill-upload-session.service'
import type { AgentToolDefinition } from './tools/agent-tool'
import { webFetchFixtureTool } from './tools/web-fetch/fixture.tool'
import { webFetchTool } from './tools/web-fetch/tool'
import { createWebSearchTool } from './tools/web-search/tool'

export function resolveAgentTools(
  config: ConfigService,
  sessions: AgentExecutionSessionService,
  outputs: AgentOutputFileService,
): readonly AgentToolDefinition[] {
  // CI/确定性 E2E 可显式启用 fixture；默认使用生产级联网 web_fetch。
  const webTool =
    process.env.AGENT_WEB_FETCH_FIXTURE === 'true' ? webFetchFixtureTool : webFetchTool
  const tools: AgentToolDefinition[] = [webTool]
  if (config.get<boolean>('AGENT_WEB_SEARCH_ENABLED', true)) {
    const exaApiKey = config.get<string>('EXA_API_KEY')
    const parallelApiKey = config.get<string>('PARALLEL_API_KEY')
    tools.push(
      createWebSearchTool({
        providerMode: config.get<'auto' | 'exa' | 'parallel'>('AGENT_WEB_SEARCH_PROVIDER', 'auto'),
        timeoutMs: config.get<number>('AGENT_WEB_SEARCH_TIMEOUT_MS', 25_000),
        maxResponseBytes: config.get<number>('AGENT_WEB_SEARCH_MAX_RESPONSE_BYTES', 2_097_152),
        maxOutputChars: config.get<number>('AGENT_WEB_SEARCH_MAX_OUTPUT_CHARS', 30_000),
        ...(exaApiKey ? { exaApiKey } : {}),
        ...(parallelApiKey ? { parallelApiKey } : {}),
      }),
    )
  }
  return [
    ...tools,
    createActivateSkillTool(sessions),
    createShellTool(sessions),
    createReadFileTool(sessions),
    createWriteFileTool(sessions),
    createExportFileTool(outputs),
  ]
}

export function createSandboxRuntime(config: ConfigService): SandboxRuntimePort {
  return new OpenSandboxRuntime({
    domain: config.getOrThrow<string>('OPEN_SANDBOX_DOMAIN'),
    protocol: config.get<'http' | 'https'>('OPEN_SANDBOX_PROTOCOL', 'http'),
    apiKey: config.getOrThrow<string>('OPEN_SANDBOX_API_KEY'),
    image: config.getOrThrow<string>('OPEN_SANDBOX_IMAGE'),
    requestTimeoutSeconds: config.get<number>('OPEN_SANDBOX_REQUEST_TIMEOUT_SECONDS', 30),
    readyTimeoutSeconds: config.get<number>('OPEN_SANDBOX_READY_TIMEOUT_SECONDS', 60),
    useServerProxy: config.get<boolean>('OPEN_SANDBOX_USE_SERVER_PROXY', true),
  })
}

/**
 * AgentModule：通用 Web Agent 的模块化单体边界。
 *
 * 本 change 分阶段落地：先建立持久化端口与 owner 过滤，随后接入 ModelInvocationPort、
 * Pi harness bridge、Tool registry、run 状态机与资源式 API。厂商协议与 Pi 运行时类型
 * 始终限制在服务端，不进入 SDK 公共面或浏览器。
 */
@Module({
  imports: [
    ConfigModule,
    UserAuthModule,
    ModelGatewayModule,
    RequestLifecycleModule,
    RedisModule,
    TokenAnalyticsModule,
  ],
  controllers: [AgentController, SkillMarketController],
  providers: [
    AgentThreadRepository,
    AgentRunRepository,
    AgentMessageRepository,
    AgentModelInvocationRepository,
    AgentRunEventBus,
    AgentActiveRunLock,
    AgentContextPreparer,
    AgentContextSummaryRepository,
    AgentContextSummaryService,
    AgentRunService,
    AgentService,
    AgentStartupCleanupService,
    AgentPromptComposer,
    PlatformAgentSkillCatalog,
    AgentSkillRepository,
    AgentSkillService,
    { provide: AGENT_SKILL_REGISTRY, useExisting: ExecutableSkillService },
    ExecutableSkillRepository,
    ExecutableSkillService,
    ExecutableSkillBootstrap,
    SkillMarketRepository,
    SkillMarketService,
    SkillPublishingRepository,
    SkillPublishingService,
    {
      provide: SKILL_OBJECT_STORE_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (config.get<string>('SKILL_OBJECT_STORE_DRIVER') !== 'oss') {
          return new InMemorySkillObjectStore({
            skillPackages: [MOCK_EXECUTABLE_SKILL_PACKAGE],
          })
        }
        const { client, bucket } = createAliyunOssClient(config)
        return new AliyunOssSkillObjectStore(client, bucket)
      },
    },
    {
      provide: SKILL_UPLOAD_SIGNER_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (config.get<string>('SKILL_OBJECT_STORE_DRIVER') !== 'oss') {
          return new InMemorySkillUploadSigner()
        }
        const { client, bucket } = createAliyunOssClient(config)
        return new AliyunOssSkillObjectStore(client, bucket)
      },
    },
    SkillUploadSessionRepository,
    { provide: SKILL_UPLOAD_CLOCK, useValue: () => new Date() },
    SkillUploadSessionService,
    {
      provide: SANDBOX_RUNTIME_PORT,
      inject: [ConfigService],
      useFactory: createSandboxRuntime,
    },
    AgentExecutionSessionService,
    AgentOutputFileRepository,
    AgentOutputFileService,
    AgentMcpSdkClient,
    AgentMcpPreferenceRepository,
    PlatformAgentMcpRegistry,
    { provide: AGENT_MCP_REGISTRY, useExisting: PlatformAgentMcpRegistry },
    EmptyAgentMemoryProvider,
    { provide: AGENT_MEMORY_PROVIDER, useExisting: EmptyAgentMemoryProvider },
    {
      provide: AGENT_TOOLS,
      inject: [ConfigService, AgentExecutionSessionService, AgentOutputFileService],
      useFactory: (
        config: ConfigService,
        sessions: AgentExecutionSessionService,
        outputs: AgentOutputFileService,
      ): readonly AgentToolDefinition[] => resolveAgentTools(config, sessions, outputs),
    },
    AgentToolRegistry,
  ],
  exports: [
    AgentThreadRepository,
    AgentRunRepository,
    AgentMessageRepository,
    AgentRunEventBus,
    AgentRunService,
    AgentActiveRunLock,
    AgentToolRegistry,
    ExecutableSkillService,
    AgentExecutionSessionService,
    SkillUploadSessionService,
    SANDBOX_RUNTIME_PORT,
  ],
})
export class AgentModule {}
