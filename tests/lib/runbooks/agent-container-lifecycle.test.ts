import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResultSpool } from '../../../agent/src/spool';
import {
  determineActiveBlockingCondition,
  computeReportedLastError,
  type SafetyLimits,
} from '../../../agent/src/recovery';

const agentImage = process.env.OPSKNIGHT_AGENT_TEST_IMAGE || 'opsknight-agent:test';

const hasDockerAgentImage = (() => {
  try {
    const res = spawnSync('docker', ['image', 'inspect', agentImage], { timeout: 4000 });
    return res.status === 0;
  } catch {
    return false;
  }
})();

describe('Agent Container & Process Lifecycle Tests', () => {
  it.runIf(hasDockerAgentImage)('verifies tini entrypoint is PID 1 and reaps child processes without zombies', () => {
    // 1. Verify PID 1 in container is tini
    const psRes = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--entrypoint',
        '/sbin/tini',
        agentImage,
        '--',
        'ps',
        '-ef',
      ],
      { encoding: 'utf8', timeout: 10000 }
    );

    expect(psRes.status).toBe(0);
    expect(psRes.stdout).toMatch(/1\s+0\s+.*\/sbin\/tini/);

    // 2. Spawn 30 short-lived child processes to verify no zombie accumulation
    const zombieCheckRes = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--entrypoint',
        '/sbin/tini',
        agentImage,
        '--',
        '/bin/sh',
        '-c',
        'for i in $(seq 1 30); do (exit 0) & done; wait; ps -A -o stat= | grep -c "Z" || true',
      ],
      { encoding: 'utf8', timeout: 10000 }
    );

    expect(zombieCheckRes.status).toBe(0);
    // Zombie count must be 0
    expect(zombieCheckRes.stdout.trim()).toBe('0');
  });

  it.runIf(hasDockerAgentImage)('verifies container handles SIGTERM signal gracefully', () => {
    // Launch a container with tini sleeping in background, then send SIGTERM
    const containerName = `test-tini-sigterm-${Date.now()}`;
    const startRes = spawnSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        containerName,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--entrypoint',
        '/sbin/tini',
        agentImage,
        '--',
        'sleep',
        '60',
      ],
      { encoding: 'utf8', timeout: 10000 }
    );
    expect(startRes.status).toBe(0);

    try {
      // Send SIGTERM to the container
      const killRes = spawnSync('docker', ['kill', '--signal=SIGTERM', containerName], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(killRes.status).toBe(0);

      // Verify the container has terminated
      const waitRes = spawnSync('docker', ['wait', containerName], {
        encoding: 'utf8',
        timeout: 10000,
      });
      expect(waitRes.status).toBe(0);
    } finally {
      spawnSync('docker', ['rm', '-f', containerName], { timeout: 5000 });
    }
  });

  it.runIf(hasDockerAgentImage)('verifies Podman executes cleanly under read-only rootfs and dispatches client socket calls', () => {
    // 1. podman --version works under read-only rootfs without stat .config crash
    const versionRes = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--entrypoint',
        '/bin/sh',
        agentImage,
        '-c',
        'podman --version',
      ],
      { encoding: 'utf8', timeout: 10000 }
    );
    expect(versionRes.status).toBe(0);
    expect(versionRes.stdout).toContain('podman version 5.');

    // 2. podman connects cleanly to CONTAINER_HOST socket client without filesystem/permission failures
    const socketRes = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '-e',
        'CONTAINER_HOST=tcp://127.0.0.1:9999',
        '--entrypoint',
        '/bin/sh',
        agentImage,
        '-c',
        'podman info',
      ],
      { encoding: 'utf8', timeout: 10000 }
    );
    // Must fail specifically on connection refused, NOT on read-only file systems or missing user dirs
    expect(socketRes.stderr || socketRes.stdout).toContain('unable to connect to Podman socket');
    expect(socketRes.stderr || socketRes.stdout).not.toContain('Read-only file system');
    expect(socketRes.stderr || socketRes.stdout).not.toContain('no such file or directory');
  });

  it('verifies identity and spool persistence across process restarts', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-persist-test-'));
    try {
      const spoolDir = join(tempDir, 'spool');
      const identityFile = join(tempDir, 'identity.json');

      const mockIdentity = {
        agentId: 'agent_cert_test_123',
        privateKey: 'mock-private-key-ed25519',
        enrolledAt: new Date().toISOString(),
      };
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(identityFile, JSON.stringify(mockIdentity));

      // 1. First run: spool an attempt
      const spool1 = new ResultSpool(spoolDir);
      await spool1.initialize();
      await spool1.put({
        attemptId: 'cuid123456789012345678901',
        leaseToken: 'lease_token_789',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
      });
      expect(await spool1.depth()).toBe(1);

      // 2. Process restart: simulate starting a new Agent daemon reading from same directory
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const loadedIdentityRaw = await readFile(identityFile, 'utf8');
      const loadedIdentity = JSON.parse(loadedIdentityRaw);
      expect(loadedIdentity.agentId).toBe('agent_cert_test_123');

      const spool2 = new ResultSpool(spoolDir);
      await spool2.initialize();
      const records = await spool2.list();
      expect(records.length).toBe(1);
      expect(records[0].attemptId).toBe('cuid123456789012345678901');
      expect(records[0].status).toBe('SUCCEEDED');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('demonstrates dynamic error recovery during sustained polling cycles', async () => {
    const limits: SafetyLimits = {
      maxSpoolRecords: 10,
      maxSpoolBytes: 1024 * 1024,
      maxSpoolRecordAgeMs: 60000,
      maxDeadLetterRecords: 5,
      maxDeadLetterBytes: 512 * 1024,
      maxDeadLetterAgeMs: 60000,
    };

    const clockError: string | null = null;
    const isDraining = false;
    const deadLetters = 0;
    let spoolCount = 0;
    let transientCommError: string | null = null;
    const inFlightError: string | null = null;

    // Cycle 1: Agent healthy and idle
    let blocking = determineActiveBlockingCondition({
      clockError,
      isDraining,
      deadLetterStats: { count: deadLetters, totalBytes: 0, oldestAgeMs: 0 },
      spoolStats: { count: spoolCount, totalBytes: 0, oldestAgeMs: 0 },
      limits,
    });
    expect(blocking).toBeNull();
    expect(
      computeReportedLastError({
        activeBlockingError: blocking,
        inFlightError,
        transientError: transientCommError,
      })
    ).toBeNull();

    // Cycle 2: Network outage happens, spool backlog builds up to 15 records
    transientCommError = 'Agent API temporarily unavailable.';
    spoolCount = 15;
    blocking = determineActiveBlockingCondition({
      clockError,
      isDraining,
      deadLetterStats: { count: deadLetters, totalBytes: 0, oldestAgeMs: 0 },
      spoolStats: { count: spoolCount, totalBytes: 20000, oldestAgeMs: 1000 },
      limits,
    });
    expect(blocking).toContain('Spool threshold reached (15 records');
    // Reports blocking condition
    expect(
      computeReportedLastError({
        activeBlockingError: blocking,
        inFlightError,
        transientError: transientCommError,
      })
    ).toContain('Spool threshold reached');

    // Cycle 3: Network returns, spool drains completely to 0
    spoolCount = 0;
    transientCommError = null; // Cleared by flushSpool
    blocking = determineActiveBlockingCondition({
      clockError,
      isDraining,
      deadLetterStats: { count: deadLetters, totalBytes: 0, oldestAgeMs: 0 },
      spoolStats: { count: spoolCount, totalBytes: 0, oldestAgeMs: 0 },
      limits,
    });
    // Active condition dynamically cleared!
    expect(blocking).toBeNull();
    // Agent reports healthy null
    expect(
      computeReportedLastError({
        activeBlockingError: blocking,
        inFlightError,
        transientError: transientCommError,
      })
    ).toBeNull();
  });
});
