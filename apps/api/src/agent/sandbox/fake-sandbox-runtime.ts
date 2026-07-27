import { createHash } from 'node:crypto'

import type {
  AgentExecutionError,
  AgentExecutionErrorCode,
  AgentSandboxLimitReason,
  AgentShellOutput,
} from '@supermind/sdk'

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

export interface FakeSandboxCommandFixture {
  command: string
  stdout?: string
  stderr?: string
  exitCode?: number
  durationMs?: number
  outboundBytes?: number
  peakMemoryBytes?: number
  peakProcesses?: number
}

export interface FakeSandboxRuntimeOptions {
  now?: () => Date
  commands?: readonly FakeSandboxCommandFixture[]
}

interface SandboxState {
  descriptor: SandboxDescriptor
  limits: SandboxLimits
  usage: SandboxUsage
  files: Map<string, Uint8Array>
  commandSequence: number
}

const EMPTY_OUTPUT: AgentShellOutput = Object.freeze({
  bytes: 0,
  truncated: false,
  content: '',
})

export class FakeSandboxRuntime implements SandboxRuntimePort {
  private readonly sandboxes = new Map<string, SandboxState>()
  private readonly commands: ReadonlyMap<string, FakeSandboxCommandFixture>
  private readonly now: () => Date
  private sandboxSequence = 0

  constructor(options: FakeSandboxRuntimeOptions = {}) {
    this.now = options.now ?? (() => new Date('2000-01-01T00:00:00.000Z'))
    this.commands = new Map((options.commands ?? []).map((fixture) => [fixture.command, fixture]))
  }

  async healthCheck(signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
  }

  async createSandbox(input: CreateSandboxInput): Promise<SandboxDescriptor> {
    throwIfAborted(input.signal)
    const limits = { ...DEFAULT_SANDBOX_LIMITS, ...input.limits }
    validateLimits(limits)
    const createdAt = this.now()
    const sandboxId = `fake-${input.runId}-${++this.sandboxSequence}`
    const state: SandboxState = {
      descriptor: {
        sandboxId,
        runId: input.runId,
        status: 'creating',
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + limits.sandboxTimeoutMs).toISOString(),
      },
      limits,
      usage: {
        shellCalls: 0,
        returnedOutputBytes: 0,
        outboundBytes: 0,
        diskBytes: 0,
        peakMemoryBytes: 0,
        peakProcesses: 0,
      },
      files: new Map(),
      commandSequence: 0,
    }
    this.sandboxes.set(sandboxId, state)
    return cloneDescriptor(state.descriptor)
  }

  async waitUntilReady(sandboxId: string, signal?: AbortSignal): Promise<SandboxDescriptor> {
    throwIfAborted(signal)
    const state = this.requireSandbox(sandboxId)
    this.assertUsable(state)
    state.descriptor.status = 'ready'
    return cloneDescriptor(state.descriptor)
  }

  async runCommand(input: RunSandboxCommandInput): Promise<SandboxCommandResult> {
    throwIfAborted(input.signal)
    const state = this.requireReadySandbox(input.sandboxId)
    assertWorkspacePath(input.workingDirectory)
    const commandId = `${input.sandboxId}-command-${++state.commandSequence}`

    if (state.usage.shellCalls >= state.limits.shellCallLimit) {
      return limitResult(commandId, 'shell_calls', 'SHELL_CALL_LIMIT', 'Shell 调用次数已达上限')
    }
    state.usage.shellCalls += 1

    const fixture = this.commands.get(input.command) ?? { command: input.command }
    const durationMs = fixture.durationMs ?? 0
    const timeoutMs = Math.min(
      input.timeoutMs ?? state.limits.commandTimeoutMs,
      state.limits.commandTimeoutMs,
    )
    if (durationMs > timeoutMs) {
      return limitResult(
        commandId,
        'command_timeout',
        'SHELL_COMMAND_TIMEOUT',
        `命令执行超过 ${timeoutMs} ms`,
        timeoutMs,
      )
    }

    state.usage.peakMemoryBytes = Math.max(
      state.usage.peakMemoryBytes,
      fixture.peakMemoryBytes ?? 0,
    )
    state.usage.peakProcesses = Math.max(state.usage.peakProcesses, fixture.peakProcesses ?? 0)
    if (state.usage.peakMemoryBytes > state.limits.memoryBytes) {
      return limitResult(
        commandId,
        'memory',
        'SANDBOX_RESOURCE_LIMIT',
        'Sandbox 内存使用超过上限',
        durationMs,
      )
    }
    if (state.usage.peakProcesses > state.limits.processLimit) {
      return limitResult(
        commandId,
        'processes',
        'SANDBOX_RESOURCE_LIMIT',
        'Sandbox 进程数超过上限',
        durationMs,
      )
    }

    state.usage.outboundBytes += fixture.outboundBytes ?? 0
    if (state.usage.outboundBytes > state.limits.egressBytes) {
      return limitResult(
        commandId,
        'egress',
        'SANDBOX_RESOURCE_LIMIT',
        'Sandbox 出口流量超过上限',
        durationMs,
      )
    }

    const remainingOutput = Math.max(
      0,
      state.limits.outputTotalBytes - state.usage.returnedOutputBytes,
    )
    const callBudget = Math.min(state.limits.outputPerCallBytes, remainingOutput)
    const stdout = boundedOutput(fixture.stdout ?? '', callBudget)
    const stderr = boundedOutput(
      fixture.stderr ?? '',
      Math.max(0, callBudget - byteLength(stdout.content)),
    )
    state.usage.returnedOutputBytes += byteLength(stdout.content) + byteLength(stderr.content)
    const outputLimited = stdout.truncated || stderr.truncated || callBudget === 0

    return {
      commandId,
      exitCode: fixture.exitCode ?? 0,
      durationMs,
      stdout,
      stderr,
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
  }

  async writeFile(input: WriteSandboxFileInput): Promise<SandboxFileResult> {
    throwIfAborted(input.signal)
    const state = this.requireReadySandbox(input.sandboxId)
    assertWorkspacePath(input.path)
    const previousSize = state.files.get(input.path)?.byteLength ?? 0
    const nextDiskBytes = state.usage.diskBytes - previousSize + input.bytes.byteLength
    if (nextDiskBytes > state.limits.diskBytes) {
      throw executionError('FILE_SIZE_LIMIT', 'Sandbox 磁盘空间不足', false, {
        limitBytes: state.limits.diskBytes,
      })
    }
    const bytes = copyBytes(input.bytes)
    state.files.set(input.path, bytes)
    state.usage.diskBytes = nextDiskBytes
    return fileResult(input.path, bytes)
  }

  async readFile(
    sandboxId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult | null> {
    throwIfAborted(signal)
    const state = this.requireReadySandbox(sandboxId)
    assertWorkspacePath(path)
    const bytes = state.files.get(path)
    return bytes ? fileResult(path, bytes) : null
  }

  async getUsage(sandboxId: string, signal?: AbortSignal): Promise<SandboxUsage> {
    throwIfAborted(signal)
    return { ...this.requireSandbox(sandboxId).usage }
  }

  async cancelSandbox(sandboxId: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const state = this.requireSandbox(sandboxId)
    if (state.descriptor.status !== 'destroyed') state.descriptor.status = 'cancelled'
  }

  async destroySandbox(sandboxId: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const state = this.sandboxes.get(sandboxId)
    if (!state) return
    state.descriptor.status = 'destroyed'
    state.files.clear()
    state.usage.diskBytes = 0
  }

  async listLeakedSandboxes(
    referenceTime: Date,
    signal?: AbortSignal,
  ): Promise<SandboxDescriptor[]> {
    throwIfAborted(signal)
    return [...this.sandboxes.values()]
      .filter(
        (state) =>
          state.descriptor.status !== 'destroyed' &&
          new Date(state.descriptor.expiresAt).getTime() <= referenceTime.getTime(),
      )
      .map((state) => cloneDescriptor(state.descriptor))
      .sort((left, right) => left.sandboxId.localeCompare(right.sandboxId))
  }

  private requireSandbox(sandboxId: string): SandboxState {
    const state = this.sandboxes.get(sandboxId)
    if (!state) throw new Error(`Sandbox not found: ${sandboxId}`)
    return state
  }

  private requireReadySandbox(sandboxId: string): SandboxState {
    const state = this.requireSandbox(sandboxId)
    this.assertUsable(state)
    if (state.descriptor.status !== 'ready') {
      throw new Error(`Sandbox is not ready: ${sandboxId}`)
    }
    return state
  }

  private assertUsable(state: SandboxState): void {
    if (state.descriptor.status === 'cancelled' || state.descriptor.status === 'destroyed') {
      throw executionError('RUN_CANCELLED', `Sandbox 已${state.descriptor.status}`, false)
    }
    if (new Date(state.descriptor.expiresAt).getTime() <= this.now().getTime()) {
      state.descriptor.status = 'failed'
      throw executionError('SANDBOX_TIMEOUT', 'Sandbox 生命周期已到期', false)
    }
  }
}

function limitResult(
  commandId: string,
  limitReason: AgentSandboxLimitReason,
  code: AgentExecutionErrorCode,
  message: string,
  durationMs = 0,
): SandboxCommandResult {
  return {
    commandId,
    exitCode: null,
    durationMs,
    stdout: { ...EMPTY_OUTPUT },
    stderr: { ...EMPTY_OUTPUT },
    limitReason,
    error: executionError(code, message, false),
  }
}

function boundedOutput(content: string, budgetBytes: number): AgentShellOutput {
  const encoded = new TextEncoder().encode(content)
  const bounded = encoded.slice(0, budgetBytes)
  return {
    bytes: encoded.byteLength,
    truncated: encoded.byteLength > bounded.byteLength,
    content: new TextDecoder().decode(bounded),
  }
}

function fileResult(path: string, bytes: Uint8Array): SandboxFileResult {
  return {
    path,
    sizeBytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: copyBytes(bytes),
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

function copyBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value)
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function cloneDescriptor(value: SandboxDescriptor): SandboxDescriptor {
  return { ...value }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Sandbox operation aborted')
}
