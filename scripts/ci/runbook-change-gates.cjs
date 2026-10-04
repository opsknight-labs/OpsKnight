/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS runner without dependency installation. */
const { execFileSync } = require('node:child_process');
const { appendFileSync, readFileSync } = require('node:fs');

const ALL = { runbooks: true, deployment: true, swarm: true };
const SHARED_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'vitest.config.ts',
  'vitest.setup.ts',
  'Dockerfile',
  'docker-entrypoint.sh',
  'env.example',
  'scripts/ci/runbook-change-gates.cjs',
  'tests/ci/runbook-change-gates.test.cjs',
  '.github/workflows/runbook-validation.yml',
]);

function classifyChanges(paths) {
  const gates = { runbooks: false, deployment: false, swarm: false };
  for (const path of paths) {
    if (
      SHARED_FILES.has(path) ||
      path.startsWith('prisma/') ||
      path.startsWith('.github/actions/setup-node/')
    ) {
      return { ...ALL };
    }
    // Shared libraries include authorization, encryption, Prisma, and worker dependencies.
    if (
      path.startsWith('agent/') ||
      path.startsWith('src/lib/') ||
      path.startsWith('src/components/runbooks/') ||
      path.startsWith('src/components/incident/') ||
      path.startsWith('src/components/service/') ||
      path.startsWith('src/components/ui/') ||
      path.startsWith('src/components/layout/') ||
      path.startsWith('src/components/auth/') ||
      path.startsWith('src/components/providers/') ||
      path.startsWith('src/contexts/') ||
      path.startsWith('src/app/(app)/runbooks/') ||
      path.startsWith('src/app/(app)/services/') ||
      path.startsWith('src/app/(app)/incidents/') ||
      path.startsWith('src/app/api/runbook') ||
      path.startsWith('src/app/api/auth/') ||
      path.startsWith('src/app/auth/') ||
      path.startsWith('src/lib/incidents/') ||
      path.startsWith('src/app/api/incidents/') ||
      path.startsWith('tests/lib/runbooks/') ||
      path.startsWith('tests/helpers/') ||
      path.startsWith('tests/setup') ||
      (path.startsWith('tests/') && /(^|\/)runbook[^/]*$/i.test(path)) ||
      [
        'src/auth.ts',
        'src/middleware.ts',
        'src/proxy.ts',
        'src/instrumentation.ts',
        'src/app/layout.tsx',
        'src/app/providers.tsx',
        'src/app/(app)/layout.tsx',
        'src/app/globals.css',
        'playwright.runbooks.config.ts',
        'tailwind.config.ts',
        'postcss.config.js',
        'tests/integration/encryption-migration.test.ts',
        'tests/api/metrics.test.ts',
        'tests/lib/operational-metric-registry.test.ts',
        'tests/unit/encryption-registry.test.ts',
        'tests/lib/encryption-keyring-rotation.test.ts',
      ].includes(path)
    )
      gates.runbooks = true;

    if (
      path.startsWith('deploy/') ||
      path === 'agent/Dockerfile' ||
      path === 'tests/lib/deployment-config-unit.test.ts' ||
      path === 'scripts/auto-recover-migrations.ts' ||
      path === 'scripts/validate-release-tag.cjs' ||
      path === 'src/lib/runtime-capacity.ts' ||
      path === '.github/workflows/docker-image.yml' ||
      path === '.github/workflows/deployment-validation.yml'
    )
      gates.deployment = true;

    if (
      path.startsWith('deploy/swarm/') ||
      path.startsWith('deploy/images/') ||
      path.startsWith('deploy/scripts/') ||
      path === 'src/lib/runtime-capacity.ts' ||
      path === 'src/lib/job-worker.ts' ||
      path.startsWith('src/lib/runtime/') ||
      path === 'src/instrumentation.ts' ||
      path === '.github/workflows/swarm-validation.yml'
    ) {
      gates.swarm = true;
      gates.deployment = true;
    }
  }
  return gates;
}

function changedPaths(
  eventName,
  event,
  git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
) {
  let base;
  let head;
  let mergeBase = false;
  if (eventName === 'pull_request') {
    base = event.pull_request?.base?.sha;
    head = event.pull_request?.head?.sha;
    mergeBase = true;
  } else if (eventName === 'push') {
    base = event.before;
    head = event.after;
  } else return null;
  const valid = sha => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha) && !/^0+$/.test(sha);
  if (!valid(base) || !valid(head)) return null;
  try {
    // --no-renames includes both old and new paths, including deleted files.
    const args = [
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      ...(mergeBase ? ['--merge-base'] : []),
      base,
      head,
      '--',
    ];
    return git(args).split('\0').filter(Boolean);
  } catch {
    return null; // Missing/force-pushed history must never silently skip validation.
  }
}

if (require.main === module) {
  // GitHub supplies these runner-owned file paths, not pull-request content.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const paths = changedPaths(process.env.GITHUB_EVENT_NAME, event);
  const gates = paths === null ? ALL : classifyChanges(paths);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(gates)
      .map(([key, enabled]) => `${key}=${enabled}\n`)
      .join('')
  );
  console.log(JSON.stringify({ changedFiles: paths?.length ?? 'unknown/manual', gates }));
}

module.exports = { classifyChanges, changedPaths };
