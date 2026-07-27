import { DEFAULT_SANDBOX_LIMITS } from './sandbox-runtime.port'
import { FakeSandboxRuntime } from './fake-sandbox-runtime'

describe('FakeSandboxRuntime', () => {
  it('resets per-Run counters while preserving the Thread workspace', async () => {
    const runtime = new FakeSandboxRuntime({
      commands: [{ command: 'echo run', stdout: 'ok\n', outboundBytes: 12 }],
    })
    const sandbox = await runtime.createSandbox({
      runId: 'run-1',
      threadId: 'thread-1',
      limits: { sandboxTimeoutMs: 1_800_000 },
    })
    await runtime.waitUntilReady(sandbox.sandboxId)
    await runtime.writeFile({
      sandboxId: sandbox.sandboxId,
      path: '/workspace/work/retained.txt',
      bytes: new TextEncoder().encode('retained'),
    })
    await runtime.runCommand({
      sandboxId: sandbox.sandboxId,
      command: 'echo run',
      workingDirectory: '/workspace/work',
    })
    expect(await runtime.getUsage(sandbox.sandboxId)).toMatchObject({
      shellCalls: 1,
      outboundBytes: 12,
    })

    await runtime.resetRunState(sandbox.sandboxId)

    expect(await runtime.getUsage(sandbox.sandboxId)).toMatchObject({
      shellCalls: 0,
      outboundBytes: 0,
      returnedOutputBytes: 0,
    })
    await expect(
      runtime.readFile(sandbox.sandboxId, '/workspace/work/retained.txt'),
    ).resolves.toMatchObject({ sizeBytes: 8 })
  })

  it('creates one deterministic sandbox and supports command, file, usage and idempotent destroy', async () => {
    const runtime = new FakeSandboxRuntime({
      now: () => new Date('2000-01-01T00:00:00.000Z'),
      commands: [{ command: 'node clean.mjs', stdout: 'done\n', durationMs: 25 }],
    })
    const created = await runtime.createSandbox({ runId: 'run-1' })
    expect(created).toMatchObject({
      sandboxId: 'fake-run-1-1',
      status: 'creating',
      createdAt: '2000-01-01T00:00:00.000Z',
      expiresAt: '2000-01-01T00:02:00.000Z',
    })
    await expect(runtime.waitUntilReady(created.sandboxId)).resolves.toMatchObject({
      status: 'ready',
    })

    const fileBytes = new TextEncoder().encode('a,b\n1,2\n')
    const written = await runtime.writeFile({
      sandboxId: created.sandboxId,
      path: '/workspace/input/data.csv',
      bytes: fileBytes,
    })
    fileBytes[0] = 0
    expect(
      new TextDecoder().decode((await runtime.readFile(created.sandboxId, written.path))!.bytes),
    ).toBe('a,b\n1,2\n')

    await expect(
      runtime.runCommand({
        sandboxId: created.sandboxId,
        command: 'node clean.mjs',
        workingDirectory: '/workspace/work',
      }),
    ).resolves.toMatchObject({
      commandId: 'fake-run-1-1-command-1',
      exitCode: 0,
      durationMs: 25,
      stdout: { content: 'done\n', truncated: false },
      limitReason: null,
    })
    await expect(runtime.getUsage(created.sandboxId)).resolves.toMatchObject({
      shellCalls: 1,
      diskBytes: 8,
      returnedOutputBytes: 5,
    })

    await runtime.destroySandbox(created.sandboxId)
    await expect(runtime.destroySandbox(created.sandboxId)).resolves.toBeUndefined()
    await expect(runtime.getUsage(created.sandboxId)).resolves.toMatchObject({ diskBytes: 0 })
  })

  it('enforces command timeout, Shell count, memory, process and egress budgets', async () => {
    const runtime = new FakeSandboxRuntime({
      commands: [
        { command: 'slow', durationMs: 61_000 },
        { command: 'memory', peakMemoryBytes: 101 },
        { command: 'processes', peakProcesses: 3 },
        { command: 'network', outboundBytes: 101 },
      ],
    })
    const createReady = async (runId: string) => {
      const sandbox = await runtime.createSandbox({
        runId,
        limits: { memoryBytes: 100, processLimit: 2, egressBytes: 100, shellCallLimit: 1 },
      })
      await runtime.waitUntilReady(sandbox.sandboxId)
      return sandbox.sandboxId
    }

    const slowId = await createReady('slow')
    await expect(
      runtime.runCommand({
        sandboxId: slowId,
        command: 'slow',
        workingDirectory: '/workspace/work',
      }),
    ).resolves.toMatchObject({
      limitReason: 'command_timeout',
      error: { code: 'SHELL_COMMAND_TIMEOUT' },
    })
    await expect(
      runtime.runCommand({
        sandboxId: slowId,
        command: 'anything',
        workingDirectory: '/workspace/work',
      }),
    ).resolves.toMatchObject({
      limitReason: 'shell_calls',
      error: { code: 'SHELL_CALL_LIMIT' },
    })

    for (const [runId, command, limitReason] of [
      ['memory', 'memory', 'memory'],
      ['processes', 'processes', 'processes'],
      ['network', 'network', 'egress'],
    ] as const) {
      const sandboxId = await createReady(runId)
      await expect(
        runtime.runCommand({ sandboxId, command, workingDirectory: '/workspace/work' }),
      ).resolves.toMatchObject({ limitReason, error: { code: 'SANDBOX_RESOURCE_LIMIT' } })
    }
  })

  it('bounds per-command and total output and reports truncation', async () => {
    const runtime = new FakeSandboxRuntime({
      commands: [{ command: 'verbose', stdout: '123456789', stderr: 'error' }],
    })
    const sandbox = await runtime.createSandbox({
      runId: 'output',
      limits: { outputPerCallBytes: 5, outputTotalBytes: 6 },
    })
    await runtime.waitUntilReady(sandbox.sandboxId)

    const first = await runtime.runCommand({
      sandboxId: sandbox.sandboxId,
      command: 'verbose',
      workingDirectory: '/workspace',
    })
    expect(first).toMatchObject({
      stdout: { bytes: 9, content: '12345', truncated: true },
      stderr: { bytes: 5, content: '', truncated: true },
      limitReason: 'output',
      error: { code: 'SHELL_OUTPUT_LIMIT' },
    })
    const second = await runtime.runCommand({
      sandboxId: sandbox.sandboxId,
      command: 'verbose',
      workingDirectory: '/workspace',
    })
    expect(second.stdout.content).toBe('1')
    expect((await runtime.getUsage(sandbox.sandboxId)).returnedOutputBytes).toBe(6)
  })

  it('supports cancellation, AbortSignal and expired sandbox leak queries', async () => {
    let now = new Date('2026-07-23T00:00:00.000Z')
    const runtime = new FakeSandboxRuntime({ now: () => now })
    const active = await runtime.createSandbox({
      runId: 'active',
      limits: { sandboxTimeoutMs: 10 },
    })
    const destroyed = await runtime.createSandbox({
      runId: 'destroyed',
      limits: { sandboxTimeoutMs: 10 },
    })
    await runtime.waitUntilReady(active.sandboxId)
    await runtime.destroySandbox(destroyed.sandboxId)
    now = new Date('2026-07-23T00:00:00.011Z')

    await expect(runtime.listLeakedSandboxes(now)).resolves.toEqual([
      expect.objectContaining({ sandboxId: active.sandboxId }),
    ])
    await runtime.cancelSandbox(active.sandboxId)
    await expect(
      runtime.runCommand({
        sandboxId: active.sandboxId,
        command: 'echo no',
        workingDirectory: '/workspace',
      }),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' })

    const controller = new AbortController()
    const reason = new Error('cancelled')
    controller.abort(reason)
    await expect(
      runtime.createSandbox({ runId: 'aborted', signal: controller.signal }),
    ).rejects.toBe(reason)
  })

  it('uses the accepted production budget defaults', () => {
    expect(DEFAULT_SANDBOX_LIMITS).toEqual({
      cpuCores: 1,
      memoryBytes: 1024 * 1024 * 1024,
      diskBytes: 2 * 1024 * 1024 * 1024,
      processLimit: 64,
      sandboxTimeoutMs: 120_000,
      commandTimeoutMs: 60_000,
      shellCallLimit: 20,
      egressBytes: 100 * 1024 * 1024,
      outputPerCallBytes: 1024 * 1024,
      outputTotalBytes: 5 * 1024 * 1024,
    })
  })

  it('allows exactly 20 Shell calls under the default Run budget', async () => {
    const runtime = new FakeSandboxRuntime()
    const sandbox = await runtime.createSandbox({ runId: 'default-shell-budget' })
    await runtime.waitUntilReady(sandbox.sandboxId)

    for (let call = 0; call < DEFAULT_SANDBOX_LIMITS.shellCallLimit; call += 1) {
      await expect(
        runtime.runCommand({
          sandboxId: sandbox.sandboxId,
          command: `echo ${call}`,
          workingDirectory: '/workspace/work',
        }),
      ).resolves.toMatchObject({ exitCode: 0, limitReason: null })
    }
    await expect(
      runtime.runCommand({
        sandboxId: sandbox.sandboxId,
        command: 'echo over-limit',
        workingDirectory: '/workspace/work',
      }),
    ).resolves.toMatchObject({
      exitCode: null,
      limitReason: 'shell_calls',
      error: { code: 'SHELL_CALL_LIMIT' },
    })
  })
})
