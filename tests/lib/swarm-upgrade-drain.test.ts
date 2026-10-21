import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Docker Swarm upgrade safety & pre-migration worker drain', () => {
  const deployScript = readFileSync('deploy/swarm/scripts/deploy.sh', 'utf8');

  it('verifies deploy.sh executes pre-migration worker drain before calling migrate.sh', () => {
    const drainPos = deployScript.indexOf('INCOMPATIBLE_WORKERS=');
    const migratePos = deployScript.indexOf('"${SCRIPT_DIR}/migrate.sh"');
    const deployStackPos = deployScript.indexOf('docker stack deploy', migratePos);

    expect(drainPos).toBeGreaterThan(0);
    expect(migratePos).toBeGreaterThan(drainPos);
    expect(deployStackPos).toBeGreaterThan(migratePos);

    // Verify key incompatible worker roles are covered
    for (const role of [
      'opsknight-general-worker',
      'opsknight-critical-worker',
      'opsknight-bulk-worker',
      'opsknight-runbook-worker',
      'opsknight-scheduler',
      'opsknight-status-projector',
      'opsknight-app',
    ]) {
      expect(deployScript).toContain(`\${STACK_NAME}_${role}`);
    }
  });

  const drainSnippet = deployScript.slice(
    deployScript.indexOf('INCOMPATIBLE_WORKERS='),
    deployScript.indexOf('export OPSKNIGHT_IMAGE', deployScript.indexOf('# --- Step 5:'))
  );

  it('drains active worker services to 0 replicas and verifies 0 running tasks before migration', () => {
    const result = spawnSync('bash', ['-s'], {
      encoding: 'utf8',
      input: `
set -eu
STACK_NAME=opsknight
WORKER_DRAIN_TIMEOUT_SEC=10
POLL_FILE=$(mktemp)
echo 0 > "$POLL_FILE"
SCALE_FILE=$(mktemp)
trap 'rm -f "$POLL_FILE" "$SCALE_FILE"' EXIT
sleep() { :; }

docker() {
  if [ "$1 $2" = "service inspect" ]; then
    local svc="$3"
    if [ "$svc" = "opsknight_opsknight-general-worker" ]; then
      if [ "\${4:-}" = "--format" ]; then
        printf '2\\n'
      else
        return 0
      fi
    else
      return 1
    fi
  elif [ "$1 $2" = "service scale" ]; then
    echo "$3" >> "$SCALE_FILE"
  elif [ "$1 $2" = "service ps" ]; then
    local count
    count=$(cat "$POLL_FILE")
    count=$((count + 1))
    echo "$count" > "$POLL_FILE"
    if [ "$count" -ge 2 ]; then
      # Active tasks drained
      printf ''
    else
      printf 'task-1\\n'
    fi
  fi
}

${drainSnippet}

grep -q '^opsknight_opsknight-general-worker=0$' "$SCALE_FILE"
`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Draining and stopping worker before migration: opsknight_opsknight-general-worker'
    );
    expect(result.stdout).toContain(
      'Worker opsknight_opsknight-general-worker successfully stopped (0 active tasks)'
    );
  });

  it('proceeds cleanly without scaling when no incompatible worker services exist (fresh deployment)', () => {
    const result = spawnSync('bash', ['-s'], {
      encoding: 'utf8',
      input: `
set -eu
STACK_NAME=opsknight
WORKER_DRAIN_TIMEOUT_SEC=10
scaled=0

docker() {
  if [ "$1 $2" = "service inspect" ]; then
    # No service exists
    return 1
  elif [ "$1 $2" = "service scale" ]; then
    scaled=$((scaled + 1))
  fi
}

${drainSnippet}

[ "$scaled" -eq 0 ]
`,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('Draining and stopping');
  });

  it('fails closed and aborts before migration if worker tasks fail to terminate within timeout', () => {
    const result = spawnSync('bash', ['-s'], {
      encoding: 'utf8',
      input: `
set -eu
STACK_NAME=opsknight
WORKER_DRAIN_TIMEOUT_SEC=1
sleep() { :; }

docker() {
  if [ "$1 $2" = "service inspect" ]; then
    local svc="$3"
    if [ "$svc" = "opsknight_opsknight-general-worker" ]; then
      if [ "\${4:-}" = "--format" ]; then
        printf '2\\n'
      else
        return 0
      fi
    else
      return 1
    fi
  elif [ "$1 $2" = "service scale" ]; then
    :
  elif [ "$1 $2" = "service ps" ]; then
    # Stuck active tasks never drain
    printf 'stuck-task-id\\n'
  fi
}

${drainSnippet}
`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      '[FATAL] Timed out waiting for worker opsknight_opsknight-general-worker to stop before migration'
    );
  });
});
