import type { AgentExecutionError, AgentSandboxLimitReason, AgentShellOutput } from '@supermind/sdk'

export const SANDBOX_RUNTIME_PORT = Symbol('SANDBOX_RUNTIME_PORT')

const MIB = 1024 * 1024
const GIB = 1024 * MIB

export interface SandboxLimits {
  cpuCores: number
  memoryBytes: number
  diskBytes: number
  processLimit: number
  sandboxTimeoutMs: number
  commandTimeoutMs: number
  shellCallLimit: number
  egressBytes: number
  outputPerCallBytes: number
  outputTotalBytes: number
}

export const DEFAULT_SANDBOX_LIMITS: Readonly<SandboxLimits> = Object.freeze({
  cpuCores: 1,
  memoryBytes: GIB,
  diskBytes: 2 * GIB,
  processLimit: 64,
  sandboxTimeoutMs: 120_000,
  commandTimeoutMs: 60_000,
  shellCallLimit: 20,
  egressBytes: 100 * MIB,
  outputPerCallBytes: MIB,
  outputTotalBytes: 5 * MIB,
})

export type SandboxLifecycleStatus = 'creating' | 'ready' | 'cancelled' | 'failed' | 'destroyed'

export interface SandboxDescriptor {
  sandboxId: string
  runId: string
  status: SandboxLifecycleStatus
  createdAt: string
  expiresAt: string
}

export interface SandboxUsage {
  shellCalls: number
  returnedOutputBytes: number
  outboundBytes: number
  diskBytes: number
  peakMemoryBytes: number
  peakProcesses: number
}

export interface CreateSandboxInput {
  runId: string
  limits?: Partial<SandboxLimits>
  signal?: AbortSignal
}

export interface RunSandboxCommandInput {
  sandboxId: string
  command: string
  workingDirectory: string
  timeoutMs?: number
  signal?: AbortSignal
}

export interface SandboxCommandResult {
  commandId: string
  exitCode: number | null
  durationMs: number
  stdout: AgentShellOutput
  stderr: AgentShellOutput
  limitReason: AgentSandboxLimitReason | null
  error?: AgentExecutionError
}

export interface WriteSandboxFileInput {
  sandboxId: string
  path: string
  bytes: Uint8Array
  signal?: AbortSignal
}

export interface SandboxFileResult {
  path: string
  sizeBytes: number
  sha256: string
  bytes: Uint8Array
}

export interface SandboxRuntimePort {
  healthCheck(signal?: AbortSignal): Promise<void>
  createSandbox(input: CreateSandboxInput): Promise<SandboxDescriptor>
  waitUntilReady(sandboxId: string, signal?: AbortSignal): Promise<SandboxDescriptor>
  runCommand(input: RunSandboxCommandInput): Promise<SandboxCommandResult>
  writeFile(input: WriteSandboxFileInput): Promise<SandboxFileResult>
  readFile(sandboxId: string, path: string, signal?: AbortSignal): Promise<SandboxFileResult | null>
  getUsage(sandboxId: string, signal?: AbortSignal): Promise<SandboxUsage>
  cancelSandbox(sandboxId: string, signal?: AbortSignal): Promise<void>
  destroySandbox(sandboxId: string, signal?: AbortSignal): Promise<void>
  listLeakedSandboxes(referenceTime: Date, signal?: AbortSignal): Promise<SandboxDescriptor[]>
}
