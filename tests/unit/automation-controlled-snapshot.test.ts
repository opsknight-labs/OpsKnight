import { afterEach, expect, it, vi } from 'vitest';
import { requireControlledSnapshotScope } from '../load/helpers/automation-snapshot';

afterEach(() => vi.unstubAllEnvs());
it.each([
  ['OPSKNIGHT_LOAD_CERT_DB', 'false'],
  ['AUTOMATION_K8S_NAMESPACE', 'production'],
  ['DATABASE_URL', 'postgresql://localhost:55443/automation_cert'],
  ['DATABASE_URL', 'postgresql://127.0.0.1:5432/automation_cert'],
  ['DATABASE_URL', 'postgresql://127.0.0.1:55443/shared'],
])('rejects restoration outside the owned fixture: %s=%s', async (key, value) => {
  vi.stubEnv('OPSKNIGHT_LOAD_CERT_DB', 'true');
  vi.stubEnv('AUTOMATION_K8S_NAMESPACE', 'automation-cert');
  vi.stubEnv('DATABASE_URL', 'postgresql://127.0.0.1:55443/automation_cert');
  vi.stubEnv(key, value);
  await expect(requireControlledSnapshotScope()).rejects.toThrow('owned');
});
