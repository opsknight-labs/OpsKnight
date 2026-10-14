import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const version = process.env.OPSKNIGHT_VERSION?.replace(/^v/, '');
const digest = process.env.OPSKNIGHT_AGENT_IMAGE_DIGEST;
const revision = process.env.OPSKNIGHT_REVISION;
const [releaseBase, prerelease, ...extra] = (version ?? '').split('-');
const validVersion =
  /^\d+\.\d+\.\d+$/.test(releaseBase) &&
  extra.length === 0 &&
  (prerelease === undefined || /^(alpha|beta|rc)\.\d+$/.test(prerelease));
if (
  !validVersion ||
  !/^sha256:[a-f0-9]{64}$/.test(digest ?? '') ||
  !/^[a-f0-9]{40}$/.test(revision ?? '')
)
  throw new Error('A release version, published OCI digest and source revision are required.');
const stableVersion = version.split('-')[0];
const [major, minor, patch] = stableVersion.split('.').map(Number);
const manifest = {
  schemaVersion: 1,
  version,
  revision,
  protocolVersions: [1],
  policySchemaVersion: 1,
  // Declare the matching server release only. Wider ranges require tested compatibility evidence.
  server: { minimum: stableVersion, maximumExclusive: `${major}.${minor}.${patch + 1}` },
  image: {
    reference: `ghcr.io/opsknight-labs/opsknight-agent@${digest}`,
    architectures: ['linux/amd64', 'linux/arm64'],
  },
  installer: {
    filename: 'install.sh',
    sha256: createHash('sha256').update(readFileSync('dist/agent/install.sh')).digest('hex'),
  },
};
writeFileSync('dist/agent/agent-release-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
