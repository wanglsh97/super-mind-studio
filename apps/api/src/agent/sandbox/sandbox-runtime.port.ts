import type {
  AgentExecutionError,
  AgentSandboxLimitReason,
  AgentShellOutput,
  AgentSkillFileEntry,
} from '@supermind/sdk'

export const SANDBOX_RUNTIME_PORT = Symbol('SANDBOX_RUNTIME_PORT')
export const SANDBOX_SKILLS_ROOT = '/workspace/.skills'

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
  threadId?: string
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

export interface InstallSandboxSkillPackageInput {
  sandboxId: string
  skillName: string
  downloadUrl: string
  expectedSha256: string
  expectedSizeBytes: number
  signal?: AbortSignal
}

export interface InstalledSandboxSkillPackage {
  rootPath: string
  packageSha256: string
  skillMarkdown: string
  files: AgentSkillFileEntry[]
}

export interface SandboxPreviewEndpoint {
  url: string
  expiresAt: string
}

export interface SandboxRuntimePort {
  healthCheck(signal?: AbortSignal): Promise<void>
  createSandbox(input: CreateSandboxInput): Promise<SandboxDescriptor>
  waitUntilReady(sandboxId: string, signal?: AbortSignal): Promise<SandboxDescriptor>
  runCommand(input: RunSandboxCommandInput): Promise<SandboxCommandResult>
  installSkillPackage(input: InstallSandboxSkillPackageInput): Promise<InstalledSandboxSkillPackage>
  writeFile(input: WriteSandboxFileInput): Promise<SandboxFileResult>
  readFile(sandboxId: string, path: string, signal?: AbortSignal): Promise<SandboxFileResult | null>
  /** 读取显式产物：仅允许 /workspace/output 下非符号链接的普通文件。 */
  readOutputFile(
    sandboxId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<SandboxFileResult | null>
  getUsage(sandboxId: string, signal?: AbortSignal): Promise<SandboxUsage>
  /** 创建一个短时效的 Sandbox HTTP 预览入口，不得当作可持久部署地址。 */
  createPreviewEndpoint(
    sandboxId: string,
    port: number,
    expiresInSeconds: number,
    signal?: AbortSignal,
  ): Promise<SandboxPreviewEndpoint>
  /** 中断遗留命令并重置下一 Run 的计数，保留 Thread workspace 文件。 */
  resetRunState(sandboxId: string, signal?: AbortSignal): Promise<void>
  cancelSandbox(sandboxId: string, signal?: AbortSignal): Promise<void>
  destroySandbox(sandboxId: string, signal?: AbortSignal): Promise<void>
  listLeakedSandboxes(referenceTime: Date, signal?: AbortSignal): Promise<SandboxDescriptor[]>
}
