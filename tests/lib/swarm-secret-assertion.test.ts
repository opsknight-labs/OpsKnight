import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import YAML from 'yaml';

const workflow = YAML.parse(readFileSync('.github/workflows/swarm-validation.yml', 'utf8'));
const steps = Object.values(workflow.jobs).flatMap(
  job => (job as { steps?: Array<{ run?: string }> }).steps ?? []
);
const source = steps
  .map(step => step.run ?? '')
  .find(run => run.includes('assert_secret_file_equals()'))!;
const start = source.indexOf('assert_secret_file_equals()');
const end = source.indexOf('assert_runtime_secret_delivery()', start);
const assertion = source.slice(start, end);

it('checks every replica and fails with masked diagnostics when only the second replica is stale', () => {
  const result = spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    input: `
set -eu
sleep() { :; }
docker() {
  if [ "$1" = ps ]; then printf 'first\\nsecond\\n';
  elif [ "$1" = exec ]; then
    if [ "$2" = first ]; then printf 'test-secret-current'; else printf 'test-secret-stale'; fi
  else printf 'safe task-generation diagnostics\\n'; fi
}
${assertion}
assert_secret_file_equals fixture /run/secrets/keyring test-secret-current
`,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('values masked');
  expect(result.stderr).toContain('/run/secrets/keyring');
  expect(result.stderr).not.toContain('test-secret-current');
  expect(result.stderr).not.toContain('test-secret-stale');
});

it('accepts only when every running replica has the expected secret', () => {
  const result = spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    input: `
set -eu
docker() {
  if [ "$1" = ps ]; then printf 'first\\nsecond\\n';
  elif [ "$1" = exec ]; then printf 'test-secret-current'; fi
}
${assertion}
assert_secret_file_equals fixture /run/secrets/keyring test-secret-current
`,
  });
  expect(result.status).toBe(0);
});

const deploy = readFileSync('deploy/swarm/scripts/deploy.sh', 'utf8');
const convergence = deploy.slice(
  deploy.indexOf('while true; do', deploy.indexOf('# --- Step 7:')),
  deploy.indexOf('# --- Step 8:')
);
it('waits for task generation completion even when replica counts already match', () => {
  const result = spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    input: `
set -eu
STACK_NAME=fixture
CONVERGENCE_TIMEOUT_SEC=30
START_TIME=$(date +%s)
ready=0
sleep() { ready=1; }
docker() {
  if [ "$1" = stack ]; then printf 'fixture-service image 2/2 ports\\n';
  elif [ "$1 $2" = 'service inspect' ]; then
    if [ "$ready" = 0 ]; then printf updating; else printf completed; fi
  fi
}
${convergence}
[ "$ready" = 1 ]
`,
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('1 service(s) converging');
  expect(result.stdout).toContain('All services converged');
});

it('fails closed on a paused rolling update despite matching replica counts', () => {
  const result = spawnSync('bash', ['-s'], {
    encoding: 'utf8',
    input: `
set -eu
STACK_NAME=fixture
CONVERGENCE_TIMEOUT_SEC=30
START_TIME=$(date +%s)
docker() {
  if [ "$1" = stack ]; then printf 'fixture-service image 2/2 ports\\n';
  elif [ "$1 $2" = 'service inspect' ]; then printf paused;
  else printf 'safe task generation\\n'; fi
}
${convergence}
`,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('update failed: paused');
});
