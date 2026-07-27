import assert from 'node:assert/strict'

import { DEFAULT_SANDBOX_LIMITS } from '../src/agent/sandbox/sandbox-runtime.port'
import { OpenSandboxRuntime } from '../src/agent/sandbox/open-sandbox-runtime'

const domain = process.env.OPEN_SANDBOX_DOMAIN ?? '127.0.0.1:8080'
const protocol = process.env.OPEN_SANDBOX_PROTOCOL === 'https' ? 'https' : 'http'
const image =
  process.env.OPEN_SANDBOX_IMAGE ??
  'sandbox-registry.cn-zhangjiakou.cr.aliyuncs.com/opensandbox/code-interpreter:v1.1.0'
const runId = `adapter-smoke-${Date.now()}`
const runtime = new OpenSandboxRuntime({
  domain,
  protocol,
  apiKey: process.env.OPEN_SANDBOX_API_KEY ?? '',
  image,
  requestTimeoutSeconds: Number(process.env.OPEN_SANDBOX_REQUEST_TIMEOUT_SECONDS ?? 180),
  readyTimeoutSeconds: Number(process.env.OPEN_SANDBOX_READY_TIMEOUT_SECONDS ?? 60),
  useServerProxy: process.env.OPEN_SANDBOX_USE_SERVER_PROXY !== 'false',
})

const startedAt = Date.now()
let sandboxId: string | undefined

async function main(): Promise<void> {
  try {
    await runtime.healthCheck()
    const createStartedAt = Date.now()
    const created = await runtime.createSandbox({ runId })
    sandboxId = created.sandboxId
    const ready = await runtime.waitUntilReady(created.sandboxId)
    const createReadyMs = Date.now() - createStartedAt
    assert.equal(ready.status, 'ready')

    const payload = new TextEncoder().encode('adapter-file-roundtrip')
    await runtime.writeFile({
      sandboxId,
      path: '/workspace/input/source.txt',
      bytes: payload,
    })
    const commandStartedAt = Date.now()
    const command = await runtime.runCommand({
      sandboxId,
      workingDirectory: '/workspace',
      command:
        "mkdir -p output && tr '[:lower:]' '[:upper:]' < input/source.txt > output/result.txt && printf 'adapter-shell-ok\\n'",
    })
    const commandMs = Date.now() - commandStartedAt
    assert.equal(command.exitCode, 0)
    assert.match(command.stdout.content, /adapter-shell-ok/)

    const result = await runtime.readFile(sandboxId, '/workspace/output/result.txt')
    assert.equal(new TextDecoder().decode(result?.bytes), 'ADAPTER-FILE-ROUNDTRIP')
    const usage = await runtime.getUsage(sandboxId)

    await runtime.destroySandbox(sandboxId)
    await runtime.destroySandbox(sandboxId)
    const leaks = await runtime.listLeakedSandboxes(new Date(Date.now() + 180_000))
    assert.ok(!leaks.some((sandbox) => sandbox.sandboxId === sandboxId))

    console.log(
      JSON.stringify(
        {
          server: `${protocol}://${domain}`,
          image,
          sandboxId,
          limits: DEFAULT_SANDBOX_LIMITS,
          createReadyMs,
          commandMs,
          totalMs: Date.now() - startedAt,
          command: {
            exitCode: command.exitCode,
            stdout: command.stdout.content,
            stderr: command.stderr.content,
          },
          fileRoundtrip: true,
          usage,
          idempotentDestroy: true,
        },
        null,
        2,
      ),
    )
    sandboxId = undefined
  } finally {
    if (sandboxId) await runtime.destroySandbox(sandboxId).catch(() => undefined)
    await runtime.onModuleDestroy()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
