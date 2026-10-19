/* eslint-disable security/detect-non-literal-fs-filename -- paths are isolated mkdtemp fixtures, never request input */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const helper = resolve('scripts/docker/install-alpine-packages.sh');
function invoke(failures, operation, packages = ['openssl']) {
  const directory = mkdtempSync(join(tmpdir(), 'opsknight-apk-'));
  try {
    writeFileSync(
      join(directory, 'apk'),
      `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$APK_TEST_LOG"
case " $* " in
  *" $APK_TEST_OPERATION "*)
    count=0
    if [ -f "$APK_TEST_COUNT" ]; then count=$(cat "$APK_TEST_COUNT"); fi
    count=$((count + 1))
    printf '%s' "$count" > "$APK_TEST_COUNT"
    if [ "$count" -le "$APK_TEST_FAILURES" ]; then exit 1; fi
    ;;
esac
`,
      { mode: 0o700 }
    );
    writeFileSync(join(directory, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const log = join(directory, 'commands');
    const result = spawnSync('sh', [helper, ...packages], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        APK_TEST_LOG: log,
        APK_TEST_COUNT: join(directory, 'count'),
        APK_TEST_OPERATION: operation,
        APK_TEST_FAILURES: String(failures),
      },
    });
    let commands = [];
    try {
      commands = readFileSync(log, 'utf8').trim().split('\n');
    } catch {
      /* No apk invocation expected for invalid input. */
    }
    for (const command of commands) {
      assert.match(command, /--timeout 30/);
      assert.doesNotMatch(command, /allow-untrusted|no-check-certificate|http:\/\//);
    }
    return { ...result, commands };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
test('retries temporary repository failures and completes verified installation', () => {
  const result = invoke(2, 'upgrade');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commands.filter(command => command.endsWith('upgrade')).length, 3);
  assert.equal(result.commands.filter(command => command.endsWith('add openssl')).length, 1);
});
test('retries a failed package download without accepting an incomplete installation', () => {
  const result = invoke(2, 'add');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.commands.filter(command => command.endsWith('add openssl')).length, 3);
});
test('fails closed after the bounded retry budget', () => {
  const result = invoke(10, 'upgrade');
  assert.equal(result.status, 1);
  assert.equal(result.commands.length, 3);
});
test('rejects an empty package list before invoking apk', () => {
  const result = invoke(0, 'upgrade', []);
  assert.equal(result.status, 2);
  assert.equal(result.commands.length, 0);
});
