'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const evidencePath = process.env.MCP_RELEASE_EVIDENCE;
if (!evidencePath) {
  process.stderr.write(
    'MCP GA blocked: MCP_RELEASE_EVIDENCE must identify reviewed final-SHA live evidence outside the repository.\n'
  );
  process.exit(1);
}
const absolute = path.resolve(evidencePath);
const relative = path.relative(process.cwd(), absolute);
if (!relative.startsWith('..' + path.sep))
  throw new Error('Release evidence must remain outside the repository');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- local operator-supplied evidence artifact, never HTTP input
const evidence = JSON.parse(fs.readFileSync(absolute, 'utf8'));
const required = [
  'architecture',
  'protocol',
  'oauth',
  'rbac',
  'workflowParity',
  'approvals',
  'durableTasks',
  'mixedLoad',
  'faultTolerance',
  'clients',
  'deployment',
  'migrationUpgrade',
  'security',
  'documentation',
];
const missing = required.filter(gate => {
  const row = new Map(Object.entries(evidence.gates ?? {})).get(gate);
  return (
    !row ||
    row.status !== 'passed' ||
    row.sourceRevision !== revision ||
    !Array.isArray(row.artifactUrls) ||
    !row.artifactUrls.length ||
    !row.artifactUrls.every(url => typeof url === 'string' && url.startsWith('https://'))
  );
});
if (
  evidence.sourceRevision !== revision ||
  missing.length ||
  !/^sha256:[a-f0-9]{64}$/.test(evidence.imageDigest ?? '')
) {
  process.stderr.write(
    `MCP GA blocked at ${revision}: missing/mismatched evidence: ${missing.join(', ')}\n`
  );
  process.exit(1);
}
process.stdout.write(`Reviewed MCP release evidence covers ${revision}.\n`);
