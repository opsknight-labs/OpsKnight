import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const enroll = vi.hoisted(() => ({ enrollAgent: vi.fn() }));
vi.mock('../../../agent/src/client', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../agent/src/client')>()),
  enrollAgent: enroll.enrollAgent,
}));

import { loadIdentity } from '../../../agent/src/index';

const identity = {
  agentId: 'agent-1',
  baseUrl: 'https://opsknight.example.com',
  privateKey: 'private-key',
  publicKey: 'public-key',
} as never;

const canChmod = typeof process.getuid === 'function' && process.getuid() !== 0;

describe('agent enrollment keeps the identity it was issued', () => {
  let directory: string;
  let identityPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN = 'one-time-token';
    delete process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_FILE;
    delete process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN_PATH;
    directory = await mkdtemp(join(tmpdir(), 'agent-identity-'));
    identityPath = join(directory, 'identity.json');
    enroll.enrollAgent.mockResolvedValue(identity);
  });

  afterEach(async () => {
    delete process.env.OPSKNIGHT_AGENT_ENROLLMENT_TOKEN;
    await chmod(directory, 0o700).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  });

  it('saves the identity after enrolling, even past a stale temp file from an earlier run', async () => {
    await writeFile(`${identityPath}.${process.pid}.tmp`, 'stale');

    await expect(loadIdentity(identityPath, 'https://opsknight.example.com')).resolves.toBe(
      identity
    );

    expect(JSON.parse(await readFile(identityPath, 'utf8'))).toMatchObject({ agentId: 'agent-1' });
  });

  it.runIf(canChmod)(
    'does not spend the token when the identity location is not writable',
    async () => {
      await chmod(directory, 0o500);

      await expect(loadIdentity(identityPath, 'https://opsknight.example.com')).rejects.toThrow();

      expect(enroll.enrollAgent).not.toHaveBeenCalled();
    }
  );

  it.runIf(canChmod)(
    'retries the save, not the enrollment, when saving failed after enrolling',
    async () => {
      // The directory goes read-only just after the server has bound our key.
      enroll.enrollAgent.mockImplementationOnce(async () => {
        await chmod(directory, 0o500);
        return identity;
      });

      await expect(loadIdentity(identityPath, 'https://opsknight.example.com')).rejects.toThrow();
      await chmod(directory, 0o700);
      await expect(loadIdentity(identityPath, 'https://opsknight.example.com')).resolves.toBe(
        identity
      );

      expect(enroll.enrollAgent).toHaveBeenCalledTimes(1);
      expect(JSON.parse(await readFile(identityPath, 'utf8'))).toMatchObject({
        agentId: 'agent-1',
      });
    }
  );
});
