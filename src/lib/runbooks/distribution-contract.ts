import { z } from 'zod/v3';
export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_POLICY_SCHEMA_VERSION = 1;
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const releaseVersion = z
  .string()
  .max(64)
  .refine(value => {
    const [stable, prerelease, ...extra] = value.split('-');
    return (
      /^\d+\.\d+\.\d+$/.test(stable) &&
      extra.length === 0 &&
      (prerelease === undefined || /^(alpha|beta|rc)\.\d+$/.test(prerelease))
    );
  }, 'Expected a stable version or numbered alpha/beta/rc release.');
export const agentReleaseManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    version: releaseVersion,
    revision: z.string().regex(/^[a-f0-9]{40}$/),
    protocolVersions: z.array(z.number().int().positive()).min(1),
    policySchemaVersion: z.literal(1),
    server: z.object({ minimum: version, maximumExclusive: version }).strict(),
    image: z
      .object({
        reference: z
          .string()
          .regex(/^ghcr\.io\/opsknight-labs\/opsknight-agent@sha256:[a-f0-9]{64}$/),
        architectures: z.array(z.enum(['linux/amd64', 'linux/arm64'])).min(1),
      })
      .strict(),
    installer: z
      .object({ filename: z.literal('install.sh'), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
  })
  .strict();
export type AgentReleaseManifest = z.infer<typeof agentReleaseManifestSchema>;
export type AgentDistribution = {
  manifest: AgentReleaseManifest;
  installerUrl: string;
  checkedAt: string;
};
function compareVersions(left: string, right: string) {
  const [aMajor, aMinor, aPatch] = left.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = right.split('.').map(Number);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}
export function supportsServer(manifest: AgentReleaseManifest, serverVersion: string) {
  const stableServer = serverVersion.split('-')[0];
  const prereleasePair = manifest.version.includes('-') || serverVersion.includes('-');
  return (
    releaseVersion.safeParse(serverVersion).success &&
    (!prereleasePair || manifest.version === serverVersion) &&
    manifest.protocolVersions.includes(AGENT_PROTOCOL_VERSION) &&
    compareVersions(stableServer, manifest.server.minimum) >= 0 &&
    compareVersions(stableServer, manifest.server.maximumExclusive) < 0
  );
}
export function validateAgentEndpoint(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return 'Use an HTTPS URL reachable from this Agent.';
    if (url.username || url.password || url.search || url.hash)
      return 'The endpoint must not contain credentials, query parameters or fragments.';
    if (url.pathname !== '/' && url.pathname !== '')
      return 'Path-prefixed Agent endpoints are not supported.';
    const host = url.hostname.toLowerCase();
    if (
      [
        'localhost',
        '127.0.0.1',
        '[::1]',
        'opsknight.company.com',
        'opsknight.example.com',
      ].includes(host) ||
      host.endsWith('.invalid')
    )
      return 'Enter the real Agent-reachable endpoint; loopback and example hosts are not installation targets.';
    return null;
  } catch {
    return 'Enter a valid HTTPS endpoint.';
  }
}
