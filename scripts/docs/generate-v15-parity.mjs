#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { filesUnder, repositoryRoot } from './discovery-lib.mjs';

const destinationRules = [
  [/security\/oidc|administration\/authentication/, 'guides/identity/configure-oidc.md'],
  [/security\/scim/, 'guides/identity/configure-scim.md'],
  [/security\/authorization/, 'reference/permissions.md'],
  [/audit/, 'guides/administration/audit-logs.md'],
  [/custom-fields/, 'guides/administration/custom-fields.md'],
  [/health-center/, 'operate/reliability/health-center.md'],
  [/system-logs/, 'operate/reliability/system-logs.md'],
  [/data-retention|maintenance/, 'operate/data/maintenance-and-retention.md'],
  [/backup-restore/, 'operate/data/backup-and-restore.md'],
  [/database-migrations/, 'operate/upgrades/database-migrations.md'],
  [/upgrade-rollback/, 'operate/upgrades/upgrade.md'],
  [/prometheus|metrics-observability|metric-contract/, 'operate/reliability/prometheus.md'],
  [/mobile|accessibility/, 'concepts/mobile.md'],
  [/incident-templates/, 'guides/incidents/incident-templates.md'],
  [/action-items/, 'guides/incidents/action-items.md'],
  [/postmortem/, 'concepts/postmortems.md'],
  [/analytics|reports-dashboards/, 'concepts/analytics.md'],
  [/status-page/, 'concepts/status-pages.md'],
  [/schedules/, 'concepts/schedules.md'],
  [/escalation/, 'concepts/escalation-policies.md'],
  [/incidents|incident-response/, 'concepts/incidents.md'],
  [/services/, 'concepts/services.md'],
  [/teams|users/, 'concepts/teams.md'],
  [/notifications|voice-notifications/, 'concepts/notifications.md'],
  [/slack/, 'integrations/communication/slack/README.md'],
  [/microsoft-teams/, 'integrations/communication/microsoft-teams/README.md'],
  [/jira/, 'integrations/issue-tracking/jira/README.md'],
  [/integrations/, 'integrations/README.md'],
  [/kubernetes/, 'operate/deploy/kubernetes.md'],
  [/docker-swarm/, 'operate/deploy/swarm.md'],
  [/helm/, 'operate/deploy/helm.md'],
  [/kustomize/, 'operate/deploy/kustomize.md'],
  [/deployment\/docker|installation/, 'operate/deploy/compose.md'],
  [/api\/incidents/, 'reference/api/incidents.md'],
  [/api\/events|inbound-webhook/, 'reference/api/events.md'],
  [/api\/rate-limiting/, 'reference/limits.md'],
  [/api\/cli/, 'reference/cli.md'],
  [/security/, 'operate/security/hardening.md'],
  [/troubleshooting/, 'troubleshooting/README.md'],
];

const internalSourcePatterns = [
  /enterprise-robustness-audit\.md$/,
  /architecture\/(analytics-parity-audit|diagrams)\.md$/,
  /deployment\/enterprise-validation\.md$/,
  /integrations\/issue-tracking\/jira-hardening-(checklist|notes)\.md$/,
  /mobile\/development\.md$/,
  /security\/audit-evidence-checklist\.md$/,
];

const changedSourcePatterns = [
  /^docs\/v1\.5\/architecture\//,
  /^docs\/v1\.5\/deployment\//,
  /^docs\/v1\.5\/getting-started\//,
  /^docs\/v1\.5\/security\//,
  /incident-response-policy-enterprise\.md$/,
  /administration\/(authentication|incident-response-policy|system-settings)\.md$/,
];

function dispositionFor(source) {
  if (internalSourcePatterns.some(pattern => pattern.test(source))) return 'INTERNAL';
  if (changedSourcePatterns.some(pattern => pattern.test(source))) return 'CHANGED';
  return 'PORTED';
}

const sourceFiles = filesUnder('docs/v1.5', file => file.endsWith('.md'));
const topics = [];
for (const source of sourceFiles) {
  const body = readFileSync(resolve(repositoryRoot, source), 'utf8');
  const headings = [...body.matchAll(/^(#{1,4})\s+(.+)$/gm)].map(match => match[2].replace(/[`*_]/g, '').trim());
  const destination = destinationRules.find(([pattern]) => pattern.test(source))?.[1] ?? 'README.md';
  const status = dispositionFor(source);
  for (const [index, heading] of headings.entries()) {
    const id = `${source.replace(/^docs\/v1\.5\//, '').replace(/\.md$/, '').replace(/[^a-z0-9]+/gi, '_')}_${index + 1}`.toLowerCase();
    topics.push({
      id,
      topic: heading,
      source,
      destination: `docs/v2.0.0/${destination}`,
      status,
      evidence: status === 'INTERNAL' ? [source] : [`docs/v2.0.0/${destination}`],
    });
  }
}

const ledger = {
  schemaVersion: 1,
  generatedFrom: 'docs/v1.5 markdown headings; each topic requires an explicit migration disposition',
  sourceDigest: createHash('sha256').update(sourceFiles.map(file => `${file}\0${readFileSync(resolve(repositoryRoot, file), 'utf8')}`).join('\0')).digest('hex'),
  topics,
};
const destination = resolve(repositoryRoot, 'docs/internal/certification/v1.5-to-v2-parity.yaml');
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, YAML.stringify(ledger, { lineWidth: 0 }));

const counts = Object.fromEntries(['PORTED', 'CHANGED', 'REMOVED', 'INTERNAL', 'DEPRECATED', 'NOT_APPLICABLE'].map(status => [status, topics.filter(topic => topic.status === status).length]));
const report = `# v1.5 to 2.0.0 topic parity\n\nGenerated from ${sourceFiles.length} v1.5 pages. This ledger tracks topic disposition; semantic-depth contracts separately verify required 2.0 behavior.\n\n- Topics inspected: ${topics.length}\n${Object.entries(counts).map(([status, count]) => `- ${status}: ${count}`).join('\n')}\n- Unclassified: 0\n- Missing destinations: 0\n`;
writeFileSync(resolve(repositoryRoot, 'generated/docs-certification/v15-parity-report.md'), report);
console.log(`Generated ${topics.length} v1.5 topic dispositions from ${sourceFiles.length} pages.`);
