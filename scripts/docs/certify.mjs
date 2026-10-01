#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import YAML from 'yaml';

const root = resolve(import.meta.dirname, '../..');
const run = (file, args) => execFileSync(file, args, { cwd: root, stdio: 'inherit' });
const fullRuntime = !process.argv.includes('--static');
const releaseCertification = process.argv.includes('--release');
const externalRuntime = process.argv.includes('--external-runtime');
const composeArgs = ['compose', '--project-name', 'opsknight-docs-v2-capture', '-f', 'tests/docs/environment/compose.yaml'];

run('node', ['scripts/docs/discover-capabilities.mjs', '--output', 'generated/docs-discovery/current.json']);
run('node', ['scripts/docs/generate-reference.mjs']);
run('node', ['scripts/docs/generate-integrations.mjs']);
run('node', ['scripts/docs/generate-capacity-reference.mjs']);
run('node', ['scripts/docs/generate-route-contract.mjs']);
run('node', ['scripts/docs/generate-v15-parity.mjs']);
run('node', ['scripts/docs/check-v15-parity.mjs', ...(releaseCertification ? ['--release'] : [])]);
run('node', ['scripts/docs/audit-reader-completeness.mjs']);
run('node', ['scripts/docs/check-frontmatter.mjs']);
run('node', ['scripts/check-docs-links.cjs']);
run('node', ['scripts/docs/check-reader-quality.mjs', ...(releaseCertification ? ['--release'] : [])]);
run('node', ['scripts/docs/check-dangerous-claims.mjs']);
run('node', ['scripts/check-docs-capabilities.cjs']);
run('node', ['scripts/docs/check-evidence.mjs']);
run('node', ['scripts/docs/check-review-signoffs.mjs', ...(releaseCertification ? ['--release'] : [])]);
run('node', ['scripts/docs/check-feature-graph.mjs']);
run('node', ['--test', ...readdirSync(join(root, 'tests/docs/tooling')).filter(name => name.endsWith('.test.mjs')).map(name => `tests/docs/tooling/${name}`)]);
if (fullRuntime) {
  if (!externalRuntime) run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans']);
  try {
    execFileSync('npx', ['playwright', 'test', '-c', 'playwright.docs.config.ts'], {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', ...(externalRuntime ? { DOCS_EXTERNAL_RUNTIME: 'true' } : {}) },
    });
    run('node', ['scripts/docs/check-evidence.mjs']);
  } finally {
    if (!externalRuntime) run('docker', [...composeArgs, 'down', '--volumes', '--remove-orphans']);
  }
}

const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const relative = path => path.slice(root.length + 1);
const discovery = JSON.parse(readFileSync(join(root, 'generated/docs-discovery/current.json'), 'utf8'));
const catalog = YAML.parse(readFileSync(join(root, 'docs/v2.0.0/capabilities.yaml'), 'utf8'));
const reviewerChecklists = YAML.parse(readFileSync(join(root, 'docs/internal/certification/reviewer-checklists.yaml'), 'utf8'));
const reviewerSignoffs = Object.values(reviewerChecklists.areas ?? {}).map(item => item.signoff?.status ?? 'pending');
const v15Inventory = YAML.parse(readFileSync(join(root, 'docs/internal/certification/v1.5-topic-inventory.yaml'), 'utf8'));
const v15Review = YAML.parse(readFileSync(join(root, 'docs/internal/certification/v1.5-to-v2-parity.yaml'), 'utf8'));
const v15InventoryIds = new Set((v15Inventory.topics ?? []).map(item => item.id));
const v15Reviewed = (v15Review.dispositions ?? []).filter(item => v15InventoryIds.has(item.id));
const readerAudit = JSON.parse(readFileSync(join(root, 'generated/docs-certification/page-audit.json'), 'utf8'));
const capabilities = Object.values(catalog.capabilities);
const evidence = walk(join(root, 'generated/docs-evidence/current')).filter(path => extname(path) === '.png');
const journeys = walk(join(root, 'tests/docs/journeys')).filter(path => path.endsWith('.spec.ts'));
const pages = walk(join(root, 'docs/v2.0.0')).filter(path => path.endsWith('.md'));
const runtimeImage = fullRuntime ? process.env.DOCS_OPSKNIGHT_IMAGE : undefined;
const runtimeInspection = runtimeImage ? JSON.parse(execFileSync(
  'docker', ['image', 'inspect', runtimeImage], { cwd: root, encoding: 'utf8' }
))[0] : undefined;
const documentationRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const runtimeSourceRevision = runtimeInspection?.Config?.Labels?.['org.opencontainers.image.revision'];
if (fullRuntime && !/^[0-9a-f]{40}$/.test(runtimeSourceRevision ?? '')) {
  throw new Error('Runtime image OCI revision must be a full 40-character Git SHA.');
}

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sourceRevision: documentationRevision,
  documentationRevision,
  productSourceRevision: runtimeSourceRevision || documentationRevision,
  runtimeSourceRevision: runtimeSourceRevision || null,
  runtimeImageDigest: runtimeInspection?.RepoDigests?.find(value => value.includes('@sha256:')) || null,
  releaseState: 'upcoming',
  checks: {
    frontmatter: 'passed',
    links: 'passed',
    readerQuality: 'passed',
    readerCompleteness: readerAudit.readerCompleteTaskPages === readerAudit.taskPages ? 'passed' : 'pending',
    humanTaskVerification: readerAudit.humanVerifiedTaskPages === readerAudit.taskPages ? 'passed' : 'pending',
    capabilityCoverage: 'passed',
    featureClassification: discovery.featureGraph.unclassified.length === 0 ? 'passed' : 'failed',
    featureDocumentationAlarm: discovery.featureGraph.undocumented.length === 0 ? 'clear' : 'attention-required',
    semanticContractAlarm: discovery.featureGraph.unresolvedSemanticContracts.length === 0 ? 'clear' : 'attention-required',
    evidenceContract: 'passed',
    toolingTests: 'passed',
    humanReviewSignoffs: reviewerSignoffs.every(status => status === 'passed') ? 'passed' : 'pending',
    v15KnowledgeParity: v15Reviewed.length === v15InventoryIds.size ? 'passed' : 'pending',
    runtimeJourneys: fullRuntime ? 'passed' : 'not-run',
    websiteBuild: 'release-gated',
  },
  counts: {
    documentationPages: pages.length,
    capabilitiesDiscovered: capabilities.length,
    capabilitiesDocumented: capabilities.filter(item => item.status === 'documented').length,
    uiRoutes: discovery.uiRoutes.length,
    apiRoutes: discovery.apiRoutes.length,
    configurationItems: discovery.configuration.length,
    integrationCandidates: discovery.integrations.length,
    databaseModels: discovery.database.models.length,
    runtimeRoles: discovery.deployment.runtimeRoles.length,
    featureNodes: discovery.featureGraph.nodes.length,
    unclassifiedFeatures: discovery.featureGraph.unclassified.length,
    evidenceBackedClaims: discovery.featureGraph.summary.claims,
    unsupportedClaims: discovery.featureGraph.summary.unsupportedClaims,
    supportedProductFeatures: discovery.featureGraph.summary.supported,
    documentedSupportedFeatures: discovery.featureGraph.summary.documentedSupported,
    undocumentedSupportedFeatures: discovery.featureGraph.summary.undocumentedSupported,
    unresolvedSemanticContracts: discovery.featureGraph.summary.unresolvedSemanticContracts,
    missingEvidence: discovery.featureGraph.nodes.filter(item => item.sources.length === 0).length,
    supportedPublicApis: discovery.featureGraph.nodes.filter(item => item.kind === 'api' && item.classification === 'PUBLIC_API').length,
    notificationProviders: discovery.notificationProviders.length,
    rawLimits: discovery.limits.length,
    publicLimits: discovery.limits.filter(item => !['INTERNAL_IMPLEMENTATION', 'PROVIDER_CONSTRAINT'].includes(item.semanticClassification)).length,
    journeyFiles: journeys.length,
    evidenceScreenshots: evidence.length,
    humanReviewAreas: reviewerSignoffs.length,
    humanReviewAreasPassed: reviewerSignoffs.filter(status => status === 'passed').length,
    humanReviewAreasPending: reviewerSignoffs.filter(status => status === 'pending').length,
    humanReviewAreasFailed: reviewerSignoffs.filter(status => status === 'failed').length,
    v15Topics: v15InventoryIds.size,
    v15TopicsReviewed: v15Reviewed.length,
    v15TopicsPending: v15InventoryIds.size - v15Reviewed.length,
    taskDocumentationPages: readerAudit.taskPages,
    readerCompleteTaskPages: readerAudit.readerCompleteTaskPages,
    humanVerifiedTaskPages: readerAudit.humanVerifiedTaskPages,
    runtimeVerifiedTaskPages: readerAudit.runtimeVerifiedTaskPages,
  },
  artifacts: {
    discovery: 'generated/docs-discovery/current.json',
    capabilityCatalog: 'docs/v2.0.0/capabilities.yaml',
    readerAudit: 'generated/docs-certification/page-audit.json',
    evidence: evidence.map(relative),
    ...(runtimeInspection ? {
      runtime: {
        requestedImage: runtimeImage,
        digest: runtimeInspection.RepoDigests?.find(value => value.includes('@sha256:')),
        sourceRevision: runtimeInspection.Config?.Labels?.['org.opencontainers.image.revision'],
      },
    } : {}),
  },
};

mkdirSync(join(root, 'generated/docs-certification'), { recursive: true });
const reportName = fullRuntime ? 'current.json' : 'static.json';
writeFileSync(join(root, 'generated/docs-certification', reportName), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
