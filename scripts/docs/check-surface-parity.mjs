#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { exists, filesUnder, repositoryRoot } from './discovery-lib.mjs';

const contractPath = 'docs/internal/product-surface-contracts.yaml';
const reportPath = 'generated/docs-certification/surface-parity-report.md';
const registry = YAML.parse(readFileSync(resolve(repositoryRoot, contractPath), 'utf8'));
const docs = filesUnder('docs/v2.0.0', path => path.endsWith('.md'));
const failures = [];
const actionPattern = /\b(click|select|choose|press|enable|disable|retry|rotate|revoke|reopen|escalate|assign|export|delete|test|create|configure)\b/i;
const taskPages = docs.filter(path => {
  const content = readFileSync(resolve(repositoryRoot, path), 'utf8');
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) return false;
  return Boolean(YAML.parse(frontmatter[1])?.reader?.task);
});
let actionableLines = 0;

const forbiddenClaims = [
  { pattern: /(?:click|select|choose|press)\s+\*\*Reopen\*\*/i, message: 'claims a manual Reopen control' },
  { pattern: /(?:Web|Slack)[^\n]{0,100}(?:click|select|choose|press)[^\n]{0,60}\*\*Escalate\*\*/i, message: 'claims a Web/Slack manual Escalate control' },
  { pattern: /supported Slack or Microsoft Teams incident card/i, message: 'conflates Slack and Teams manual escalation support' },
  { pattern: /Resolve and reopen an incident/i, message: 'presents resolve and reopen as one user-facing task' },
  { pattern: /(?:supply|enter)[^\n]{0,40}(?:meaningful summary|requested summary)[^\n]{0,40}(?:when prompted|prompt)/i, message: 'claims a Slack resolution summary prompt' },
  { pattern: /(?:inbound events?|alert[^\n]{0,20}events?)[^\n]{0,40}(?:may reopen|can automatically reopen)[^\n]{0,40}recently resolved/i, message: 'claims generic inbound alerts/events reopen resolved incidents' },
  { pattern: /Settings\s*(?:→|->)\s*Integrations\s*(?:→|->)\s*Failures/i, message: 'claims non-existent Settings → Integrations → Failures route' },
  { pattern: /Settings\s*(?:→|->)\s*ChatOps identity/i, message: 'claims non-existent Settings → ChatOps identity route' },
  { pattern: /Settings\s*(?:→|->)\s*Notifications\s*(?:→|->)\s*Providers\s*(?:→|->)/i, message: 'claims non-existent nested Settings → Notifications → Providers subroutes' },
  { pattern: /Settings\s*(?:→|->)\s*Health Center/i, message: 'claims non-existent Settings → Health Center (should be Settings → System → Health)' },
  { pattern: /Collaboration\s*(?:→|->)\s*Create war room/i, message: 'claims non-existent Collaboration menu for war rooms' },
];

for (const path of docs) {
  const content = readFileSync(resolve(repositoryRoot, path), 'utf8');
  actionableLines += content.split('\n').filter(line => actionPattern.test(line)).length;
  for (const claim of forbiddenClaims) {
    if (claim.pattern.test(content)) failures.push(`${path}: ${claim.message}`);
  }
}

const validStatuses = new Set(['SUPPORTED', 'PARTIAL', 'API_ONLY', 'AUTOMATIC_ONLY', 'NOT_SUPPORTED', 'FUTURE']);
for (const contract of registry.contracts ?? []) {
  if (!contract.id || !contract.description) failures.push('surface contract missing id or description');
  for (const [surface, status] of Object.entries(contract.surfaces ?? {})) {
    if (!validStatuses.has(status)) failures.push(`${contract.id}.${surface}: invalid status ${status}`);
  }
  for (const evidence of contract.evidence ?? []) {
    if (!exists(evidence)) failures.push(`${contract.id}: missing implementation evidence ${evidence}`);
  }
  for (const page of contract.documentation ?? []) {
    if (!exists(page)) failures.push(`${contract.id}: missing documentation ${page}`);
  }
}

const report = `# Product surface parity report

- Release: ${registry.release}
- Documentation pages scanned: ${docs.length}
- Task-oriented pages scanned: ${taskPages.length}
- Action-bearing lines inspected by the automated guard: ${actionableLines}
- Explicit cross-surface contracts: ${(registry.contracts ?? []).length}
- Forbidden surface-pattern violations remaining: ${failures.length}

## Enforced high-risk contracts

${(registry.contracts ?? []).map(contract => `- \`${contract.id}\`: ${Object.entries(contract.surfaces).map(([surface, status]) => `${surface}=\`${status}\``).join(', ')}`).join('\n')}

This report is generated from every 2.0 Markdown page and the implementation-backed
surface registry. It is a lexical false-claim alarm, not a substitute for the
runtime/API evidence required by each task page.
`;

mkdirSync(resolve(repositoryRoot, 'generated/docs-certification'), { recursive: true });
writeFileSync(resolve(repositoryRoot, reportPath), report);

if (failures.length) {
  console.error(`Product surface parity failed (${failures.length}):`);
  failures.forEach(failure => console.error(`  - ${failure}`));
  process.exit(1);
}
console.log(`Product surface parity passed: ${taskPages.length} task pages and ${actionableLines} action-bearing lines scanned.`);
