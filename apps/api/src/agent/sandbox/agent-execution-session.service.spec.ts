import type { ConfigService } from '@nestjs/config';

import type { AgentThreadRepository, AgentThreadSandboxRow } from '../agent-thread.repository';
import type { ExecutableSkillService } from '../skills/executable-skill.service';
import type { ExecutableSkillRecord } from '../skills/executable-skill.repository';
import {
  MOCK_EXECUTABLE_SKILL_DOWNLOAD,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from '../skills/executable-skill.fixture';
import { AgentExecutionSessionService } from './agent-execution-session.service';
import { createOpenSandboxRuntimeTestDouble } from './open-sandbox-runtime.test';
import type { SandboxRuntimePort } from './sandbox-runtime.port';

function setup(
  options: {
    sandboxes?: SandboxRuntimePort;
    prepareActivation?: ExecutableSkillService['prepareActivation'];
    listCandidates?: ExecutableSkillService['listCandidates'];
  } = {},
) {
  const records = new Map<string, AgentThreadSandboxRow>();
  const threads = {
    findSandboxForOwner: jest.fn(async (threadId: string, userId: string) => {
      const row = records.get(threadId);
      return row?.userId === userId ? row : null;
    }),
    markSandboxReady: jest.fn(
      async (
        threadId: string,
        userId: string,
        input: { sandboxId: string; createdAt: Date; expiresAt: Date; lastUsedAt?: Date },
      ) => {
        records.set(threadId, {
          id: threadId,
          userId,
          sandboxId: input.sandboxId,
          sandboxStatus: 'ready',
          sandboxCreatedAt: input.createdAt,
          sandboxLastUsedAt: input.lastUsedAt ?? new Date(),
          sandboxExpiresAt: input.expiresAt,
        });
      },
    ),
    markSandboxIdle: jest.fn(async (threadId: string) => {
      const row = records.get(threadId);
      if (row) row.sandboxStatus = 'idle';
    }),
    clearSandbox: jest.fn(async (threadId: string) => {
      records.delete(threadId);
    }),
    listOwnedSandboxes: jest.fn(async () => [...records.values()]),
  } as unknown as AgentThreadRepository;
  const skills = {
    listCandidates: options.listCandidates ?? jest.fn(async () => []),
    prepareActivation:
      options.prepareActivation ??
      jest.fn(async (_userId: string, selected: readonly string[]) => [
        {
          manifest: {
            skillId: `id-${selected[0]}`,
            name: selected[0],
            packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
          },
          download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
        },
      ]),
  } as unknown as ExecutableSkillService;
  const sandboxes = options.sandboxes ?? createOpenSandboxRuntimeTestDouble();
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService;
  const service = new AgentExecutionSessionService(skills, sandboxes, threads, config);
  return { records, sandboxes, service, skills, threads };
}

function candidate(name = 'test-skill'): ExecutableSkillRecord {
  return {
    id: `id-${name}`,
    name,
    title: name,
    description: `${name} description`,
    status: 'PUBLISHED',
    packageObjectKey: `skills/${name}/package.zip`,
    packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
  };
}

describe('AgentExecutionSessionService Thread sandbox lifecycle', () => {
  it('installs the immutable static website Skill files into a website Run sandbox', async () => {
    const { service } = setup();
    await service.startRun('run-web', 'thread-web', 'user-1');

    await service.installWebsiteBuildingSkill('run-web', 'user-1');

    await expect(
      service.readFile('run-web', 'user-1', '/workspace/.skills/website-building/SKILL.md'),
    ).resolves.toMatchObject({ sizeBytes: expect.any(Number) });
    const init = await service.readFile(
      'run-web',
      'user-1',
      '/workspace/.skills/website-building/scripts/init.sh',
    );
    const packager = await service.readFile(
      'run-web',
      'user-1',
      '/workspace/.skills/website-building/scripts/package.py',
    );
    const initScript = new TextDecoder().decode(init?.bytes);
    expect(initScript).toContain('npm install --global pnpm@9.15.9');
    expect(initScript).toContain('pnpm create vite@6.5.0');
    expect(new TextDecoder().decode(packager?.bytes)).toContain("excluded_dirs = {'.git'");

    await service.finishRun('run-web');
    await service.destroyThread('thread-web');
  });

  it('keeps base file tools available while resetting per-Run Skill activation', async () => {
    const { service, sandboxes, skills } = setup();
    const createSandbox = jest.spyOn(sandboxes, 'createSandbox');

    const firstSandbox = await service.startRun('run-1', 'thread-1', 'user-1');
    await service.writeFile(
      'run-1',
      'user-1',
      '/workspace/work/shared.txt',
      new TextEncoder().encode('thread-workspace'),
    );
    await service.activateSkill('run-1', 'user-1', 'test-skill');
    await expect(
      service.readFile('run-1', 'user-1', '/workspace/.skills/test-skill/SKILL.md'),
    ).resolves.toMatchObject({ path: '/workspace/.skills/test-skill/SKILL.md' });
    await service.finishRun('run-1');

    const secondSandbox = await service.startRun('run-2', 'thread-1', 'user-1');
    expect(secondSandbox).toBe(firstSandbox);
    await expect(
      service.readFile('run-2', 'user-1', '/workspace/work/shared.txt'),
    ).resolves.toMatchObject({ path: '/workspace/work/shared.txt' });
    await service.activateSkill('run-2', 'user-1', 'test-skill');
    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        limits: expect.objectContaining({ sandboxTimeoutMs: 10_800_000 }),
      }),
    );
    expect(skills.prepareActivation).toHaveBeenCalledTimes(1);

    await service.finishRun('run-2');
    await service.destroyThread('thread-1');
  });

  it('prefetches candidates without blocking Run startup and reuses the local package', async () => {
    let resolvePreparation:
      | ((value: Awaited<ReturnType<ExecutableSkillService['prepareActivation']>>) => void)
      | undefined;
    const prepareActivation = jest.fn(
      () =>
        new Promise<Awaited<ReturnType<ExecutableSkillService['prepareActivation']>>>((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    const { service, sandboxes, skills } = setup({
      listCandidates: jest.fn(async () => [candidate()]),
      prepareActivation,
    });
    const install = jest.spyOn(sandboxes, 'installSkillPackage');

    await expect(service.startRun('run-prefetch', 'thread-prefetch', 'user-1')).resolves.toEqual(
      expect.any(String),
    );
    const activationPromise = service.activateSkill('run-prefetch', 'user-1', 'test-skill');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(prepareActivation).toHaveBeenCalledTimes(1);
    if (!resolvePreparation) throw new Error('prefetch did not start');

    resolvePreparation([
      {
        manifest: {
          skillId: 'id-test-skill',
          name: 'test-skill',
          packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
        },
        download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
      },
    ]);
    const activation = await activationPromise;

    expect(activation.skill.manifest).toEqual({
      skillId: 'id-test-skill',
      name: 'test-skill',
      packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
    });
    expect(skills.prepareActivation).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith(expect.objectContaining({ background: true }));

    await service.finishRun('run-prefetch');
    await service.destroyThread('thread-prefetch');
  });

  it('retries one synchronous download when candidate prefetch fails', async () => {
    const sandboxes = createOpenSandboxRuntimeTestDouble();
    const originalInstall = sandboxes.installSkillPackage.bind(sandboxes);
    const install = jest
      .spyOn(sandboxes, 'installSkillPackage')
      .mockRejectedValueOnce(new Error('prefetch download failed'))
      .mockImplementation((input) => originalInstall(input));
    const { service, skills } = setup({
      sandboxes,
      listCandidates: jest.fn(async () => [candidate()]),
    });

    await service.startRun('run-retry', 'thread-retry', 'user-1');
    await expect(service.activateSkill('run-retry', 'user-1', 'test-skill')).resolves.toMatchObject(
      {
        alreadyActive: false,
        skill: { manifest: { name: 'test-skill' } },
      },
    );

    expect(skills.prepareActivation).toHaveBeenCalledTimes(2);
    expect(install).toHaveBeenCalledTimes(2);
    expect(install.mock.calls[0]?.[0]).toMatchObject({ background: true });
    expect(install.mock.calls[1]?.[0]).not.toHaveProperty('background');

    await service.finishRun('run-retry');
    await service.destroyThread('thread-retry');
  });

  it('keeps a downloaded Skill executable in the current Thread after candidate removal', async () => {
    const listCandidates = jest
      .fn<
        ReturnType<ExecutableSkillService['listCandidates']>,
        Parameters<ExecutableSkillService['listCandidates']>
      >()
      .mockResolvedValueOnce([candidate()])
      .mockResolvedValue([]);
    const { service, skills } = setup({ listCandidates });

    await service.startRun('run-before-removal', 'thread-sticky', 'user-1');
    await service.activateSkill('run-before-removal', 'user-1', 'test-skill');
    await service.finishRun('run-before-removal');

    await service.startRun('run-after-removal', 'thread-sticky', 'user-1');
    await service.activateSkill('run-after-removal', 'user-1', 'test-skill');

    expect(listCandidates).toHaveBeenCalledTimes(2);
    expect(skills.prepareActivation).toHaveBeenCalledTimes(1);

    await service.finishRun('run-after-removal');
    await service.destroyThread('thread-sticky');
  });

  it('limits candidate prefetch to four concurrent package operations', async () => {
    const candidates = Array.from({ length: 6 }, (_, index) => candidate(`candidate-${index}`));
    const releases: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const prepareActivation = jest.fn(
      (_userId: string, names: readonly string[]) =>
        new Promise<Awaited<ReturnType<ExecutableSkillService['prepareActivation']>>>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          releases.push(() => {
            active -= 1;
            resolve([
              {
                manifest: {
                  skillId: `id-${names[0]}`,
                  name: names[0]!,
                  packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
                },
                download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
              },
            ]);
          });
        }),
    );
    const { service } = setup({
      listCandidates: jest.fn(async () => candidates),
      prepareActivation,
    });

    await service.startRun('run-bounded', 'thread-bounded', 'user-1');
    await waitUntil(() => prepareActivation.mock.calls.length === 4);
    expect(peak).toBe(4);

    releases.splice(0, 4).forEach((release) => release());
    await waitUntil(() => prepareActivation.mock.calls.length === 6);
    expect(peak).toBe(4);
    releases.splice(0).forEach((release) => release());

    for (const skill of candidates) {
      await service.activateSkill('run-bounded', 'user-1', skill.name);
    }
    expect(prepareActivation).toHaveBeenCalledTimes(6);

    await service.finishRun('run-bounded');
    await service.destroyThread('thread-bounded');
  });

  it('isolates different Thread workspaces and rejects cross-user reuse', async () => {
    const { service } = setup();
    const first = await service.startRun('run-1', 'thread-1', 'user-1');
    const second = await service.startRun('run-2', 'thread-2', 'user-1');
    expect(first).not.toBe(second);

    await expect(service.startRun('run-3', 'thread-1', 'user-2')).rejects.toThrow('owner mismatch');
    await service.finishRun('run-1');
    await service.finishRun('run-2');
    await service.destroyThread('thread-1');
    await service.destroyThread('thread-2');
  });

  it('recreates a stale Thread sandbox when an input upload cannot write to it', async () => {
    const sandboxes = createOpenSandboxRuntimeTestDouble();
    const originalWriteFile = sandboxes.writeFile.bind(sandboxes);
    const writeFile = jest
      .spyOn(sandboxes, 'writeFile')
      .mockRejectedValueOnce(new Error('sandbox no longer exists'))
      .mockImplementation((input) => originalWriteFile(input));
    const destroySandbox = jest.spyOn(sandboxes, 'destroySandbox');
    const { service } = setup({ sandboxes });

    await expect(
      service.uploadThreadFile(
        'thread-upload',
        'user-1',
        'reference.png',
        new Uint8Array([1, 2, 3]),
      ),
    ).resolves.toMatchObject({ path: '/workspace/input/reference.png' });

    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile.mock.calls[0]?.[0].sandboxId).not.toBe(
      writeFile.mock.calls[1]?.[0].sandboxId,
    );
    expect(destroySandbox).toHaveBeenCalledTimes(1);
  });

  it('destroys a partially created sandbox when readiness fails', async () => {
    const readyError = new Error('ready timeout');
    const destroySandbox = jest.fn().mockRejectedValue(new Error('temporary network failure'));
    const sandboxes = {
      createSandbox: jest.fn().mockResolvedValue({ sandboxId: 'sandbox-partial' }),
      waitUntilReady: jest.fn().mockRejectedValue(readyError),
      destroySandbox,
    } as unknown as SandboxRuntimePort;
    const { service } = setup({ sandboxes });

    await expect(service.startRun('run-1', 'thread-1', 'user-1')).rejects.toBe(readyError);
    expect(destroySandbox).toHaveBeenCalledWith('sandbox-partial');
  });

  it('destroys the retained sandbox when its Thread is deleted', async () => {
    const { service, sandboxes, records } = setup();
    const destroySandbox = jest.spyOn(sandboxes, 'destroySandbox');
    await service.startRun('run-1', 'thread-1', 'user-1');
    await service.finishRun('run-1');

    await service.destroyThread('thread-1');

    expect(destroySandbox).toHaveBeenCalledTimes(1);
    expect(records.has('thread-1')).toBe(false);
  });
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not reached');
}
