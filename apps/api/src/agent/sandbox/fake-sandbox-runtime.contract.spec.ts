import { FakeSandboxRuntime } from './fake-sandbox-runtime'
import { sandboxRuntimeContract } from './sandbox-runtime.contract'

sandboxRuntimeContract('Fake', () => ({
  runtime: new FakeSandboxRuntime({
    commands: [{ command: 'echo contract', stdout: 'contract\n' }],
  }),
}))
