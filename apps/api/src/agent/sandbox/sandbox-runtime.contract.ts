import type { SandboxRuntimePort } from './sandbox-runtime.port'

export interface SandboxRuntimeContractHarness {
  runtime: SandboxRuntimePort
  dispose?(): Promise<void>
}

export function sandboxRuntimeContract(
  name: string,
  createHarness: () => SandboxRuntimeContractHarness,
): void {
  describe(`${name} SandboxRuntimePort contract`, () => {
    let harness: SandboxRuntimeContractHarness

    beforeEach(() => {
      harness = createHarness()
    })

    afterEach(async () => {
      await harness.dispose?.()
    })

    it('supports lifecycle, command, file, usage and idempotent destroy', async () => {
      await expect(harness.runtime.healthCheck()).resolves.toBeUndefined()
      const created = await harness.runtime.createSandbox({ runId: 'contract-run' })
      expect(created).toMatchObject({ runId: 'contract-run', status: 'creating' })
      await expect(harness.runtime.waitUntilReady(created.sandboxId)).resolves.toMatchObject({
        status: 'ready',
      })

      const bytes = new TextEncoder().encode('contract-file')
      await expect(
        harness.runtime.writeFile({
          sandboxId: created.sandboxId,
          path: '/workspace/input/value.txt',
          bytes,
        }),
      ).resolves.toMatchObject({ sizeBytes: bytes.byteLength })
      await expect(
        harness.runtime.readFile(created.sandboxId, '/workspace/input/value.txt'),
      ).resolves.toMatchObject({ bytes })

      await expect(
        harness.runtime.runCommand({
          sandboxId: created.sandboxId,
          command: 'echo contract',
          workingDirectory: '/workspace/work',
        }),
      ).resolves.toMatchObject({
        exitCode: 0,
        stdout: { content: 'contract\n', truncated: false },
        limitReason: null,
      })
      await expect(harness.runtime.getUsage(created.sandboxId)).resolves.toMatchObject({
        shellCalls: 1,
        returnedOutputBytes: 9,
        diskBytes: bytes.byteLength,
      })

      await expect(harness.runtime.destroySandbox(created.sandboxId)).resolves.toBeUndefined()
      await expect(harness.runtime.destroySandbox(created.sandboxId)).resolves.toBeUndefined()
    })

    it('rejects paths outside workspace and honours a pre-aborted signal', async () => {
      const created = await harness.runtime.createSandbox({ runId: 'contract-paths' })
      await harness.runtime.waitUntilReady(created.sandboxId)
      await expect(
        harness.runtime.writeFile({
          sandboxId: created.sandboxId,
          path: '/etc/passwd',
          bytes: new Uint8Array(),
        }),
      ).rejects.toMatchObject({ code: 'FILE_ACCESS_DENIED' })

      const controller = new AbortController()
      const reason = new Error('contract aborted')
      controller.abort(reason)
      await expect(
        harness.runtime.createSandbox({ runId: 'contract-aborted', signal: controller.signal }),
      ).rejects.toBe(reason)
    })
  })
}
