import 'server-only';
import { createHash } from 'node:crypto';
import { cache } from 'react';
import {
  agentReleaseManifestSchema,
  supportsServer,
  type AgentDistribution,
} from './distribution-contract';
import { APP_VERSION } from '@/lib/version';
const version = APP_VERSION.replace(/^v/, '');
async function boundedAsset(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Release asset body is unavailable.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error('Release asset exceeds its size limit.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}
/** Only official release assets are fetched. Missing/unverified releases produce no copyable install. */
export const getAgentDistribution = cache(async (): Promise<AgentDistribution | null> => {
  const tag = process.env.OPSKNIGHT_AGENT_RELEASE_TAG ?? `v${version}`;
  if (
    !tag.startsWith('v') ||
    !agentReleaseManifestSchema.shape.version.safeParse(tag.slice(1)).success
  )
    return null;
  const base = `https://github.com/opsknight-labs/OpsKnight/releases/download/${tag}`;
  try {
    const [manifestResponse, installerResponse] = await Promise.all([
      fetch(`${base}/agent-release-manifest.json`, {
        next: { revalidate: 300 },
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${base}/install.sh`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(5000) }),
    ]);
    if (!manifestResponse.ok || !installerResponse.ok) return null;
    const manifestText = await boundedAsset(manifestResponse, 16_384);
    const manifest = agentReleaseManifestSchema.parse(JSON.parse(manifestText));
    if (`v${manifest.version}` !== tag || !supportsServer(manifest, version)) return null;
    const installer = await boundedAsset(installerResponse, 1024 * 1024);
    if (
      installer.length > 1024 * 1024 ||
      createHash('sha256').update(installer).digest('hex') !== manifest.installer.sha256
    )
      return null;
    return { manifest, installerUrl: `${base}/install.sh`, checkedAt: new Date().toISOString() };
  } catch {
    return null;
  }
});
