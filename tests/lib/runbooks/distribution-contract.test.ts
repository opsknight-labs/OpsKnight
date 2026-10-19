import { describe, expect, it } from 'vitest';
import {
  agentReleaseManifestSchema,
  supportsServer,
  validateAgentEndpoint,
} from '@/lib/runbooks/distribution-contract';
const manifest = agentReleaseManifestSchema.parse({
  schemaVersion: 1,
  version: '2.1.0',
  revision: 'a'.repeat(40),
  protocolVersions: [1],
  policySchemaVersion: 1,
  server: { minimum: '2.0.0', maximumExclusive: '3.0.0' },
  image: {
    reference: `ghcr.io/opsknight-labs/opsknight-agent@sha256:${'b'.repeat(64)}`,
    architectures: ['linux/amd64', 'linux/arm64'],
  },
  installer: { filename: 'install.sh', sha256: 'c'.repeat(64) },
});
describe('verified Agent distribution', () => {
  it('restricts prerelease Agents to their matching server release', () => {
    const prerelease = { ...manifest, version: '2.1.0-rc.1' };
    expect(supportsServer(prerelease, '2.1.0-rc.1')).toBe(true);
    expect(supportsServer(prerelease, '2.1.0')).toBe(false);
    expect(supportsServer(manifest, '2.1.0-rc.1')).toBe(false);
  });
  it('rejects unsupported protocol and server pairs', () => {
    expect(supportsServer(manifest, '2.0.0')).toBe(true);
    expect(supportsServer(manifest, '3.0.0')).toBe(false);
    expect(supportsServer({ ...manifest, protocolVersions: [2] }, '2.0.0')).toBe(false);
    expect(supportsServer(manifest, 'broken')).toBe(false);
  });
  it.each([
    'http://localhost:3000',
    'https://127.0.0.1',
    'https://opsknight.company.com',
    'https://user:pass@ops.example.com',
    'https://ops.example.com/prefix',
    'https://ops.example.com?token=secret',
    'invalid',
  ])('blocks unsafe or unsupported endpoint %s', endpoint => {
    expect(validateAgentEndpoint(endpoint)).not.toBeNull();
  });
  it('supports real HTTPS hostnames and ports without rewriting them', () => {
    expect(validateAgentEndpoint('https://ops.company.internal:8443')).toBeNull();
  });
  it('requires immutable official image digests', () => {
    expect(
      agentReleaseManifestSchema.safeParse({
        ...manifest,
        image: { ...manifest.image, reference: 'ghcr.io/opsknight-labs/opsknight-agent:2.0.0' },
      }).success
    ).toBe(false);
  });
});
