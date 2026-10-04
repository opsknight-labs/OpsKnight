/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS tests run before npm installation. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classifyChanges, changedPaths } = require('../../scripts/ci/runbook-change-gates.cjs');
const all = { runbooks: true, deployment: true, swarm: true };

test('unrelated documentation and product UI skip expensive jobs', () => {
  assert.deepEqual(
    classifyChanges([
      'README.md',
      'docs/v2.1.0/reference/runbooks.md',
      'src/app/(app)/billing/page.tsx',
    ]),
    { runbooks: false, deployment: false, swarm: false }
  );
});
test('Runbook code, Agent code and browser journeys run only Runbook jobs', () => {
  for (const path of [
    'src/lib/runbooks/orchestrator.ts',
    'agent/src/executor.ts',
    'tests/e2e/runbooks-ui.spec.ts',
    'src/components/runbooks/RunbookControls.tsx',
  ]) {
    assert.deepEqual(classifyChanges([path]), { runbooks: true, deployment: false, swarm: false });
  }
});
test('shared dependencies retain safety coverage', () => {
  for (const path of [
    'package-lock.json',
    'prisma/schema.prisma',
    'prisma/migrations/deleted/migration.sql',
    '.github/actions/setup-node/action.yml',
    '.github/workflows/runbook-validation.yml',
  ])
    assert.deepEqual(classifyChanges([path]), all);
  for (const path of [
    'src/lib/encryption.ts',
    'src/lib/auth.ts',
    'src/components/ui/shadcn/button.tsx',
    'src/app/(app)/incidents/[id]/page.tsx',
  ])
    assert.equal(classifyChanges([path]).runbooks, true);
});
test('deployment methods are independently gated', () => {
  assert.deepEqual(classifyChanges(['deploy/kubernetes/helm/opsknight/values.yaml']), {
    runbooks: false,
    deployment: true,
    swarm: false,
  });
  assert.deepEqual(classifyChanges(['deploy/swarm/docker-stack.yml']), {
    runbooks: false,
    deployment: true,
    swarm: true,
  });
  assert.deepEqual(classifyChanges(['agent/Dockerfile']), {
    runbooks: true,
    deployment: true,
    swarm: false,
  });
});
test('push checks its whole commit range; PR uses the base merge point', () => {
  const base = 'a'.repeat(40),
    head = 'b'.repeat(40);
  const git = args => {
    assert.ok(args.includes('--no-renames'));
    assert.ok(args.includes('-z'));
    assert.ok(args.includes(base) && args.includes(head));
    return 'agent/old file.ts\0README.md\0';
  };
  assert.deepEqual(changedPaths('push', { before: base, after: head }, git), [
    'agent/old file.ts',
    'README.md',
  ]);
  changedPaths(
    'pull_request',
    { pull_request: { base: { sha: base }, head: { sha: head } } },
    args => {
      assert.ok(args.includes('--merge-base'));
      return git(args);
    }
  );
});
test('manual, new branches and unavailable history fail open to full validation', () => {
  assert.equal(changedPaths('workflow_dispatch', {}), null);
  assert.equal(changedPaths('push', { before: '0'.repeat(40), after: 'b'.repeat(40) }), null);
  assert.equal(
    changedPaths('push', { before: 'a'.repeat(40), after: 'b'.repeat(40) }, () => {
      throw new Error('missing history');
    }),
    null
  );
});
