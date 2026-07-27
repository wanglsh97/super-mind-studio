import { createHash } from 'node:crypto'
import { posix } from 'node:path'

import {
  ConnectionConfig,
  Sandbox,
  SandboxManager,
  type ConnectionProtocol,
  type SandboxInfo,
} from '@alibaba-group/opensandbox'
import type { AgentExecutionError, AgentExecutionErrorCode, AgentShellOutput } from '@aigateway/sdk'
import type { OnModuleDestroy } from '@nestjs/common'

import {
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxInput,
  type RunSandboxCommandInput,
  type SandboxCommandResult,
  type SandboxDescriptor,
  type SandboxFileResult,
  type SandboxLimits,
  type SandboxRuntimePort,
  type SandboxUsage,
  type WriteSandboxFileInput,
} from './sandbox-runtime.port'

const MIB = 1024 * 1024
const RUNTIME_OWNER = 'ai-gateway-studio'

interface OpenSandboxRuntimeState {
  descriptor: SandboxDescriptor
  limits: SandboxLimits
  usage: SandboxUsage
  instance: OpenSandboxInstance
  activeCommandIds: Set<string>
}

interface OpenSandboxInstanceInfo {
  id: string
  status: string
  createdAt: Date
  expiresAt: Date | null
  metadata?: Record<string, string>
}

interface OpenSandboxCommandExecution {
  id?: string
  exitCode?: number | null
  durationMs?: number
  stdout: string
  stderr: string
}

interface OpenSandboxMetrics {
  memoryUsedMiB: number
}

interface RunOpenSandboxCommandInput {
  command: string
  workingDirectory: string
  timeoutSeconds: number
  signal?: AbortSignal
  onInit(commandId: string): void
  onStdout(content: string): void
  onStderr(content: string): void
}

export interface OpenSandboxInstance {
  readonly id: string
  getInfo(): Promise<OpenSandboxInstanceInfo>
  waitUntilReady(readyTimeoutSeconds: number): Promise<void>
  runCommand(input: RunOpenSandboxCommandInput): Promise<OpenSandboxCommandExecution>
  ensureDirectory(path: string): Promise<void>
  writeFile(path: string, bytes: Uint8Array): Promise<void>
  readFile(path: string): Promise<Uint8Array | null>
  getMetrics(): Promise<OpenSandboxMetrics>
  interrupt(commandId: string): Promise<void>
  kill(): Promise<void>
  close(): Promise<void>
}

export interface CreateOpenSandboxClientInput {
  image: string
  timeoutSeconds: number
  cpu: string
  memory: string
  metadata: Record<string, string>
}

export interface OpenSandboxClient {
  healthCheck(): Promise<void>
  create(input: CreateOpenSandboxClientInput): Promise<OpenSandboxInstance>
  connect(sandboxId: string): Promise<OpenSandboxInstance>
  listOwned(): Promise<OpenSandboxInstanceInfo[]>
  kill(sandboxId: string): Promise<void>
  close(): Promise<void>
}

export interface OpenSandboxRuntimeOptions {
  domain: string
  protocol?: ConnectionProtocol
  apiKey: string
  image: string
  requestTimeoutSeconds?: number
  readyTimeoutSeconds?: number
  useServerProxy?: boolean
  now?: () => Date
  client?: OpenSandboxClient
}

export class OpenSandboxRuntime implements SandboxRuntimePort, OnModuleDestroy {
  private readonly client: OpenSandboxClient
  private readonly image: string
  private readonly now: () => Date
  private readonly readyTimeoutSeconds: number
  private readonly states = new Map<string, OpenSandboxRuntimeState>()

  constructor(options: OpenSandboxRuntimeOptions) {
    this.image = options.image
    this.now = options.now ?? (() => new Date())
    this.readyTimeoutSeconds = options.readyTimeoutSeconds ?? 60
    this.client =
      options.client ??
      new SdkOpenSandboxClient(
        new ConnectionConfig({
          domain: options.domain,
          protocol: options.protocol ?? 'http',
          apiKey: options.apiKey,
          requestTimeoutSeconds: options.requestTimeoutSeconds ?? 30,
          useServerProxy: options.useServerProxy ?? true,
        }),
      )
  }

  async healthCheck(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.client.healthCheck()
        throwIfAborted(signal)
        return
      } catch (error) {
        lastError = error
      }
    }
    throw normalizeUnavailable(lastError, 'OpenSandbox 健康检查失败')
  }

  async createSandbox(input: CreateSandboxInput): Promise<SandboxDescriptor> {
    throwIfAborted(input.signal)
    const limits = { ...DEFAULT_SANDBOX_LIMITS, ...input.limits }
    validateLimits(limits)

    let instance: OpenSandboxInstance | undefined
    try {
      instance = await this.client.create({
        image: this.image,
        timeoutSeconds: Math.ceil(limits.sandboxTimeoutMs / 1_000),
        cpu: String(limits.cpuCores),
        memory: `${Math.ceil(limits.memoryBytes / MIB)}Mi`,
        metadata: {
          'aigateway.owner': RUNTIME_OWNER,
          'aigateway.run-id': input.runId,
        },
      })
      throwIfAborted(input.signal)
      const info = await instance.getInfo()
      const descriptor = descriptorFromInfo(info, input.runId, 'creating')
      this.states.set(instance.id, {
        descriptor,
        limits,
        usage: emptyUsage(),
        instance,
        activeCommandIds: new Set(),
      })
      return { ...descriptor }
    } catch (error) {
      if (instance) await killAndCloseBestEffort(instance)
      if (input.signal?.aborted) throw abortReason(input.signal)
      throw normalizeUnavailable(error, '创建 Sandbox 失败')
    }
  }

  async waitUntilReady(sandboxId: string, signal?: AbortSignal): Promise<SandboxDescriptor> {
    throwIfAborted(signal)
    const state = await this.requireState(sandboxId)
    try {
      await state.instance.waitUntilReady(this.readyTimeoutSeconds)
      throwIfAborted(signal)
      const info = await state.instance.getInfo()
      state.descriptor = descriptorFromInfo(info, state.descriptor.runId, 'ready')
      return { ...state.descriptor }
    } catch (error) {
      state.descriptor.status = 'failed'
      await killAndCloseBestEffort(state.instance)
      if (isTimeoutError(error)) {
        throw executionError('SANDBOX_TIMEOUT', '等待 Sandbox ready 超时', true)
      }
      throw normalizeUnavailable(error, '等待 Sandbox ready 失败')
    }
  }

  async runCommand(input: RunSandboxCommandInput): Promise<SandboxCommandResult> {
    throwIfAborted(input.signal)
    const state = await this.requireReadyState(input.sandboxId)
    assertWorkspacePath(input.workingDirectory)
    if (state.usage.shellCalls >= state.limits.shellCallLimit) {
      return limitResult('shell_calls', 'SHELL_CALL_LIMIT', 'Shell 调用次数已达上限')
    }
    state.usage.shellCalls += 1

    const timeoutMs = Math.min(
      input.timeoutMs ?? state.limits.commandTimeoutMs,
      state.limits.commandTimeoutMs,
    )
    const remainingOutput = Math.max(
      0,
      state.limits.outputTotalBytes - state.usage.returnedOutputBytes,
    )
    const collector = new BoundedCommandOutput(
      Math.min(state.limits.outputPerCallBytes, remainingOutput),
    )
    const startedAt = Date.now()
    let currentCommandId = ''

    try {
      await state.instance.ensureDirectory(input.workingDirectory)
      const execution = await state.instance.runCommand({
        command: input.command,
        workingDirectory: input.workingDirectory,
        timeoutSeconds: Math.max(1, Math.ceil(timeoutMs / 1_000)),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onInit: (commandId) => {
          currentCommandId = commandId
          state.activeCommandIds.add(commandId)
        },
        onStdout: (content) => collector.appendStdout(content),
        onStderr: (content) => collector.appendStderr(content),
      })
      if (collector.observedBytes === 0) {
        collector.appendStdout(execution.stdout)
        collector.appendStderr(execution.stderr)
      }
      const output = collector.result()
      state.usage.returnedOutputBytes += output.returnedBytes
      const outputLimited = output.stdout.truncated || output.stderr.truncated
      return {
        commandId: execution.id ?? currentCommandId,
        exitCode: execution.exitCode ?? null,
        durationMs: execution.durationMs ?? Date.now() - startedAt,
        stdout: output.stdout,
        stderr: output.stderr,
        limitReason: outputLimited ? 'output' : null,
        ...(outputLimited
          ? {
              error: executionError(
                'SHELL_OUTPUT_LIMIT',
                'Shell 输出已按单次或 Run 总预算截断',
                false,
              ),
            }
          : {}),
      }
    } catch (error) {
      if (input.signal?.aborted) throw abortReason(input.signal)
      if (isTimeoutError(error)) {
        return limitResult(
          'command_timeout',
          'SHELL_COMMAND_TIMEOUT',
          `命令执行超过 ${timeoutMs} ms`,
          timeoutMs,
          currentCommandId,
        )
      }
      throw normalizeUnavailable(error, '执行 Sandbox 命令失败')
    } finally {
      if (currentCommandId) state.activeCommandIds.delete(currentCommandId)
    }
  }

  async writeFile(input: WriteSandboxFileInput): Promise<SandboxFileResult> {
    throwIfAborted(input.signal)
    const state = await this.requireReadyState(input.sandboxId)
    assertWorkspacePath(input.path)
    let previous: Uint8Array | null
    try {
      previous = await state.instance.readFile(input.path)
    } catch (error) {
      if (!isNotFoundError(error)) throw error
      previous = null
    }
    const nextDiskBytes =
      state.usage.diskBytes - (previous?.byteLength ?? 0) + input.bytes.byteLength
    if (nextDiskBytes > state.limits.diskBytes) {
      throw executionError('FILE_SIZE_LIMIT', 'Sandbox 磁盘空间不足', false, {
        limitBytes: state.limits.diskBytes,
      })
    }
    const bytes = Uint8Array.from(input.bytes)
    await state.instance.ensureDirectory(posix.dirname(input.path))
    await state.instance.writeFile(input.path, bytes)
    state.usage.diskBytes = nextDiskBytes
    return fileResult(input.path, bytes)
  }

  async readFile(
    sandboxId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult | null> {
    throwIfAborted(signal)
    const state = await this.requireReadyState(sandboxId)
    assertWorkspacePath(path)
    const bytes = await state.instance.readFile(path)
    return bytes ? fileResult(path, bytes) : null
  }

  async getUsage(sandboxId: string, signal?: AbortSignal): Promise<SandboxUsage> {
    throwIfAborted(signal)
    const state = await this.requireState(sandboxId)
    try {
      const metrics = await state.instance.getMetrics()
      state.usage.peakMemoryBytes = Math.max(
        state.usage.peakMemoryBytes,
        Math.ceil(metrics.memoryUsedMiB * MIB),
      )
    } catch {
      // 指标不可用不能掩盖命令或清理结果；健康检查会单独暴露依赖状态。
    }
    return { ...state.usage }
  }

  async cancelSandbox(sandboxId: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const state = await this.requireState(sandboxId)
    await Promise.allSettled(
      [...state.activeCommandIds].map((commandId) => state.instance.interrupt(commandId)),
    )
    state.descriptor.status = 'cancelled'
  }

  async destroySandbox(sandboxId: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const state = this.states.get(sandboxId)
    let destroyed = false
    try {
      if (state) {
        await state.instance.kill()
      } else {
        await this.client.kill(sandboxId)
      }
      destroyed = true
    } catch (error) {
      if (isNotFoundError(error)) {
        destroyed = true
      } else {
        throw normalizeUnavailable(error, '销毁 Sandbox 失败')
      }
    } finally {
      if (state && destroyed) {
        state.descriptor.status = 'destroyed'
        state.usage.diskBytes = 0
        state.activeCommandIds.clear()
        await state.instance.close().catch(() => undefined)
        this.states.delete(sandboxId)
      }
    }
  }

  async listLeakedSandboxes(
    referenceTime: Date,
    signal?: AbortSignal,
  ): Promise<SandboxDescriptor[]> {
    throwIfAborted(signal)
    const infos = await this.client.listOwned()
    return infos
      .filter(
        (info) =>
          info.expiresAt !== null &&
          info.expiresAt.getTime() <= referenceTime.getTime() &&
          !['Deleted', 'Deleting'].includes(info.status),
      )
      .map((info) =>
        descriptorFromInfo(info, info.metadata?.['aigateway.run-id'] ?? 'unknown', 'failed'),
      )
      .sort((left, right) => left.sandboxId.localeCompare(right.sandboxId))
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.states.values()].map((state) => state.instance.close()))
    await this.client.close()
  }

  private async requireState(sandboxId: string): Promise<OpenSandboxRuntimeState> {
    const existing = this.states.get(sandboxId)
    if (existing) return existing
    try {
      const instance = await this.client.connect(sandboxId)
      const info = await instance.getInfo()
      const runId = info.metadata?.['aigateway.run-id'] ?? 'unknown'
      const state: OpenSandboxRuntimeState = {
        descriptor: descriptorFromInfo(info, runId),
        limits: { ...DEFAULT_SANDBOX_LIMITS },
        usage: emptyUsage(),
        instance,
        activeCommandIds: new Set(),
      }
      this.states.set(sandboxId, state)
      return state
    } catch (error) {
      throw normalizeUnavailable(error, `Sandbox 不可用: ${sandboxId}`)
    }
  }

  private async requireReadyState(sandboxId: string): Promise<OpenSandboxRuntimeState> {
    const state = await this.requireState(sandboxId)
    if (state.descriptor.status === 'cancelled' || state.descriptor.status === 'destroyed') {
      throw executionError('RUN_CANCELLED', `Sandbox 已${state.descriptor.status}`, false)
    }
    if (new Date(state.descriptor.expiresAt).getTime() <= this.now().getTime()) {
      state.descriptor.status = 'failed'
      throw executionError('SANDBOX_TIMEOUT', 'Sandbox 生命周期已到期', false)
    }
    if (state.descriptor.status !== 'ready') {
      throw normalizeUnavailable(new Error('Sandbox is not ready'), 'Sandbox 尚未 ready')
    }
    return state
  }
}

async function killAndCloseBestEffort(instance: OpenSandboxInstance): Promise<void> {
  await instance.kill().catch(() => undefined)
  await instance.close().catch(() => undefined)
}

class SdkOpenSandboxClient implements OpenSandboxClient {
  private readonly manager: SandboxManager

  constructor(private readonly connectionConfig: ConnectionConfig) {
    this.manager = SandboxManager.create({ connectionConfig })
  }

  async healthCheck(): Promise<void> {
    const lifecycleUrl = this.connectionConfig.getBaseUrl()
    const response = await this.connectionConfig.fetch(
      `${lifecycleUrl.slice(0, -'/v1'.length)}/health`,
    )
    if (!response.ok) {
      throw new Error(`OpenSandbox health returned HTTP ${response.status}`)
    }
    const payload: unknown = await response.json()
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('status' in payload) ||
      payload.status !== 'healthy'
    ) {
      throw new Error('OpenSandbox health returned an unexpected payload')
    }
  }

  async create(input: CreateOpenSandboxClientInput): Promise<OpenSandboxInstance> {
    const sandbox = await Sandbox.create({
      connectionConfig: this.connectionConfig,
      image: input.image,
      timeoutSeconds: input.timeoutSeconds,
      resource: { cpu: input.cpu, memory: input.memory },
      metadata: input.metadata,
      skipHealthCheck: true,
    })
    return new SdkOpenSandboxInstance(sandbox)
  }

  async connect(sandboxId: string): Promise<OpenSandboxInstance> {
    const sandbox = await Sandbox.connect({
      connectionConfig: this.connectionConfig,
      sandboxId,
      skipHealthCheck: true,
    })
    return new SdkOpenSandboxInstance(sandbox)
  }

  async listOwned(): Promise<OpenSandboxInstanceInfo[]> {
    const response = await this.manager.listSandboxInfos({
      metadata: { 'aigateway.owner': RUNTIME_OWNER },
      pageSize: 100,
    })
    return response.items.map(infoFromSdk)
  }

  async kill(sandboxId: string): Promise<void> {
    await this.manager.killSandbox(sandboxId)
  }

  async close(): Promise<void> {
    await this.manager.close()
  }
}

class SdkOpenSandboxInstance implements OpenSandboxInstance {
  constructor(private readonly sandbox: Sandbox) {}

  get id(): string {
    return this.sandbox.id
  }

  async getInfo(): Promise<OpenSandboxInstanceInfo> {
    return infoFromSdk(await this.sandbox.getInfo())
  }

  async waitUntilReady(readyTimeoutSeconds: number): Promise<void> {
    await this.sandbox.waitUntilReady({
      readyTimeoutSeconds,
      pollingIntervalMillis: 250,
    })
  }

  async runCommand(input: RunOpenSandboxCommandInput): Promise<OpenSandboxCommandExecution> {
    const execution = await this.sandbox.commands.run(
      input.command,
      {
        workingDirectory: input.workingDirectory,
        timeoutSeconds: input.timeoutSeconds,
      },
      {
        skipAccumulation: true,
        onInit: ({ id }) => input.onInit(id),
        onStdout: ({ text }) => input.onStdout(text),
        onStderr: ({ text }) => input.onStderr(text),
      },
      input.signal,
    )
    return {
      ...(execution.id === undefined ? {} : { id: execution.id }),
      ...(execution.exitCode === undefined ? {} : { exitCode: execution.exitCode }),
      ...(execution.complete?.executionTimeMs === undefined
        ? {}
        : { durationMs: execution.complete.executionTimeMs }),
      stdout: execution.logs.stdout.map((entry) => entry.text).join(''),
      stderr: execution.logs.stderr.map((entry) => entry.text).join(''),
    }
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    await this.sandbox.files.writeFiles([{ path, data: bytes }])
  }

  async ensureDirectory(path: string): Promise<void> {
    await this.sandbox.files.createDirectories([{ path, mode: 755 }])
  }

  async readFile(path: string): Promise<Uint8Array | null> {
    try {
      return await this.sandbox.files.readBytes(path)
    } catch (error) {
      if (isNotFoundError(error)) return null
      throw error
    }
  }

  async getMetrics(): Promise<OpenSandboxMetrics> {
    const metrics = await this.sandbox.getMetrics()
    return { memoryUsedMiB: metrics.memoryUsedMiB }
  }

  async interrupt(commandId: string): Promise<void> {
    await this.sandbox.commands.interrupt(commandId)
  }

  async kill(): Promise<void> {
    await this.sandbox.kill()
  }

  async close(): Promise<void> {
    await this.sandbox.close()
  }
}

class BoundedCommandOutput {
  private readonly stdoutChunks: Uint8Array[] = []
  private readonly stderrChunks: Uint8Array[] = []
  private stdoutBytes = 0
  private stderrBytes = 0
  private storedBytes = 0

  constructor(private readonly budgetBytes: number) {}

  get observedBytes(): number {
    return this.stdoutBytes + this.stderrBytes
  }

  appendStdout(content: string): void {
    this.stdoutBytes += byteLength(content)
    this.append(content, this.stdoutChunks)
  }

  appendStderr(content: string): void {
    this.stderrBytes += byteLength(content)
    this.append(content, this.stderrChunks)
  }

  result(): {
    stdout: AgentShellOutput
    stderr: AgentShellOutput
    returnedBytes: number
  } {
    const stdoutContent = decodeChunks(this.stdoutChunks)
    const stderrContent = decodeChunks(this.stderrChunks)
    return {
      stdout: {
        bytes: this.stdoutBytes,
        truncated: this.stdoutBytes > byteLength(stdoutContent),
        content: stdoutContent,
      },
      stderr: {
        bytes: this.stderrBytes,
        truncated: this.stderrBytes > byteLength(stderrContent),
        content: stderrContent,
      },
      returnedBytes: this.storedBytes,
    }
  }

  private append(content: string, target: Uint8Array[]): void {
    const remaining = Math.max(0, this.budgetBytes - this.storedBytes)
    if (remaining === 0) return
    const bounded = new TextEncoder().encode(content).slice(0, remaining)
    if (bounded.byteLength > 0) target.push(bounded)
    this.storedBytes += bounded.byteLength
  }
}

function infoFromSdk(info: SandboxInfo): OpenSandboxInstanceInfo {
  return {
    id: info.id,
    status: info.status.state,
    createdAt: info.createdAt,
    expiresAt: info.expiresAt,
    ...(info.metadata === undefined ? {} : { metadata: info.metadata }),
  }
}

function descriptorFromInfo(
  info: OpenSandboxInstanceInfo,
  runId: string,
  fallbackStatus: SandboxDescriptor['status'] = 'creating',
): SandboxDescriptor {
  return {
    sandboxId: info.id,
    runId,
    status: lifecycleStatus(info.status, fallbackStatus),
    createdAt: info.createdAt.toISOString(),
    expiresAt: (info.expiresAt ?? new Date(info.createdAt.getTime())).toISOString(),
  }
}

function lifecycleStatus(
  status: string,
  fallback: SandboxDescriptor['status'],
): SandboxDescriptor['status'] {
  if (status === 'Running') return 'ready'
  if (status === 'Deleted' || status === 'Deleting') return 'destroyed'
  if (status === 'Error') return 'failed'
  return fallback
}

function emptyUsage(): SandboxUsage {
  return {
    shellCalls: 0,
    returnedOutputBytes: 0,
    outboundBytes: 0,
    diskBytes: 0,
    peakMemoryBytes: 0,
    peakProcesses: 0,
  }
}

function limitResult(
  limitReason: SandboxCommandResult['limitReason'],
  code: AgentExecutionErrorCode,
  message: string,
  durationMs = 0,
  commandId = '',
): SandboxCommandResult {
  return {
    commandId,
    exitCode: null,
    durationMs,
    stdout: { bytes: 0, truncated: false, content: '' },
    stderr: { bytes: 0, truncated: false, content: '' },
    limitReason,
    error: executionError(code, message, false),
  }
}

function fileResult(path: string, bytes: Uint8Array): SandboxFileResult {
  const copy = Uint8Array.from(bytes)
  return {
    path,
    sizeBytes: copy.byteLength,
    sha256: createHash('sha256').update(copy).digest('hex'),
    bytes: copy,
  }
}

function executionError(
  code: AgentExecutionErrorCode,
  message: string,
  retryable: boolean,
  details?: Record<string, unknown>,
): AgentExecutionError {
  return { code, message, retryable, ...(details === undefined ? {} : { details }) }
}

function normalizeUnavailable(error: unknown, message: string): AgentExecutionError {
  if (isAgentExecutionError(error)) return error
  return executionError('SANDBOX_UNAVAILABLE', message, true, {
    cause: error instanceof Error ? error.message : String(error),
  })
}

function isAgentExecutionError(error: unknown): error is AgentExecutionError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'retryable' in error
  )
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && /timeout|timed out|deadline/i.test(error.message)
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof Error && /404|not found|no such/i.test(error.message)) return true
  if (typeof error !== 'object' || error === null) return false
  const candidate = error as {
    statusCode?: unknown
    rawBody?: unknown
    error?: { code?: unknown; message?: unknown }
  }
  return (
    candidate.statusCode === 404 ||
    candidate.error?.code === 'FILE_NOT_FOUND' ||
    (typeof candidate.rawBody === 'string' &&
      /FILE_NOT_FOUND|not found|no such/i.test(candidate.rawBody)) ||
    (typeof candidate.error?.message === 'string' &&
      /not found|no such/i.test(candidate.error.message))
  )
}

function validateLimits(limits: SandboxLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid sandbox limit ${name}`)
  }
}

function assertWorkspacePath(path: string): void {
  if (
    (path !== '/workspace' && !path.startsWith('/workspace/')) ||
    path.includes('/../') ||
    path.endsWith('/..')
  ) {
    throw executionError('FILE_ACCESS_DENIED', `文件路径不在 Sandbox workspace 内: ${path}`, false)
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal)
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Sandbox operation aborted')
}

function byteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const combined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}
