import assert from 'node:assert/strict'

import {
  ConnectionConfig,
  Sandbox,
  SandboxManager,
  type SandboxInfo,
} from '@alibaba-group/opensandbox'

const domain = process.env.OPEN_SANDBOX_DOMAIN ?? '127.0.0.1:8080'
const protocol = process.env.OPEN_SANDBOX_PROTOCOL === 'https' ? 'https' : 'http'
const image = process.env.OPENSANDBOX_POC_IMAGE ?? 'opensandbox/code-interpreter:v1.1.0'
const requestTimeoutSeconds = Number(process.env.OPENSANDBOX_POC_REQUEST_TIMEOUT_SECONDS ?? 180)

const connectionConfig = new ConnectionConfig({
  domain,
  protocol,
  apiKey: process.env.OPEN_SANDBOX_API_KEY,
  requestTimeoutSeconds,
  disableMetrics: true,
})

const manager = SandboxManager.create({ connectionConfig })
let sandbox: Sandbox | undefined

interface PocReport {
  server: string
  image: string
  sandboxId?: string
  createReadyMs?: number
  readyState?: string
  uploadedContent?: string
  command?: {
    id?: string
    exitCode?: number | null
    stdout: string
    stderr: string
    streamedStdout: string
    streamedStderr: string
  }
  downloadedContent?: string
  cancelCommandId?: string
  cancelExitCode?: number | null
  cancelError?: string
  cancelMs?: number
  cancelVerified?: boolean
  destroyVerified?: boolean
}

const report: PocReport = {
  server: `${protocol}://${domain}`,
  image,
}

async function main(): Promise<void> {
  try {
    const createStartedAt = Date.now()
    sandbox = await Sandbox.create({
      connectionConfig,
      image,
      timeoutSeconds: 120,
      resource: {
        cpu: '1',
        memory: '1Gi',
      },
      readyTimeoutSeconds: 60,
    })
    report.createReadyMs = Date.now() - createStartedAt
    report.sandboxId = sandbox.id

    const info = await sandbox.getInfo()
    report.readyState = info.status.state
    assert.equal(info.status.state, 'Running')

    await sandbox.files.createDirectories([
      { path: '/workspace/input', mode: 755 },
      { path: '/workspace/work', mode: 755 },
      { path: '/workspace/output', mode: 755 },
    ])
    await sandbox.files.writeFiles([
      {
        path: '/workspace/input/source.txt',
        data: 'OpenSandbox 文件往返验证',
        mode: 644,
      },
    ])
    report.uploadedContent = await sandbox.files.readFile('/workspace/input/source.txt')
    assert.equal(report.uploadedContent, 'OpenSandbox 文件往返验证')

    const streamed = { stdout: '', stderr: '' }
    const execution = await sandbox.commands.run(
      'pwd; cat ../input/source.txt > result.txt; printf stdout-ok; printf stderr-ok >&2; exit 7',
      {
        workingDirectory: '/workspace/work',
        timeoutSeconds: 10,
      },
      {
        onStdout: (message) => {
          streamed.stdout += message.text
        },
        onStderr: (message) => {
          streamed.stderr += message.text
        },
      },
    )
    report.command = {
      id: execution.id,
      exitCode: execution.exitCode,
      stdout: joinLogs(execution.logs.stdout),
      stderr: joinLogs(execution.logs.stderr),
      streamedStdout: streamed.stdout,
      streamedStderr: streamed.stderr,
    }
    assert.equal(execution.exitCode, 7)
    assert.match(report.command.stdout, /\/workspace\/work/)
    assert.match(report.command.stdout, /stdout-ok/)
    assert.match(report.command.stderr, /stderr-ok/)
    assert.match(report.command.streamedStdout, /stdout-ok/)
    assert.match(report.command.streamedStderr, /stderr-ok/)

    report.downloadedContent = await sandbox.files.readFile('/workspace/work/result.txt')
    assert.equal(report.downloadedContent, 'OpenSandbox 文件往返验证')

    const controller = new AbortController()
    let interruptPromise: Promise<void> = Promise.resolve()
    const cancelStartedAt = Date.now()
    try {
      const cancelledExecution = await sandbox.commands.run(
        'sleep 10; touch /workspace/work/should-not-exist',
        {
          workingDirectory: '/workspace/work',
          timeoutSeconds: 20,
        },
        {
          onInit: (init) => {
            report.cancelCommandId = init.id
            interruptPromise = delay(500)
              .then(() => sandbox?.commands.interrupt(init.id))
              .then(() => undefined)
              .finally(() => controller.abort())
          },
        },
        controller.signal,
      )
      report.cancelExitCode = cancelledExecution.exitCode
    } catch (error) {
      report.cancelError =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    }
    await interruptPromise
    report.cancelMs = Date.now() - cancelStartedAt
    assert.ok(report.cancelCommandId)
    assert.ok(report.cancelMs < 5_000, `命令取消耗时过长: ${report.cancelMs} ms`)

    await delay(1_200)
    const cancelledCheck = await sandbox.commands.run('test ! -e should-not-exist', {
      workingDirectory: '/workspace/work',
      timeoutSeconds: 5,
    })
    report.cancelVerified = cancelledCheck.exitCode === 0
    assert.equal(report.cancelVerified, true)

    const beforeDestroy = await manager.listSandboxInfos({
      states: ['Running'],
      pageSize: 100,
    })
    assert.ok(hasSandbox(beforeDestroy.items, sandbox.id))

    const destroyedSandboxId = sandbox.id
    await sandbox.kill()
    await sandbox.close()
    sandbox = undefined

    report.destroyVerified = await waitUntilDestroyed(destroyedSandboxId)
    assert.equal(report.destroyVerified, true)

    console.log(JSON.stringify(report, null, 2))
  } finally {
    if (sandbox) {
      try {
        await sandbox.kill()
      } finally {
        await sandbox.close()
      }
    }
    await manager.close()
  }
}

function joinLogs(logs: readonly { text: string }[]): string {
  return logs.map((log) => log.text).join('')
}

function hasSandbox(items: readonly SandboxInfo[], sandboxId: string): boolean {
  return items.some((item) => item.id === sandboxId)
}

async function waitUntilDestroyed(sandboxId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await manager.listSandboxInfos({ pageSize: 100 })
    if (!hasSandbox(result.items, sandboxId)) return true
    await delay(100)
  }
  return false
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
