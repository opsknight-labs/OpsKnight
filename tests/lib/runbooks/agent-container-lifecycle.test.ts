import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

    // 2. Spawn short-lived child processes in Node without shell wait to verify tini reaps them cleanly
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
        'node',
        '-e',
        `
        const { spawn, execSync } = require('node:child_process');
        let done = 0;
        for (let i = 0; i < 30; i++) {
          const cp = spawn('false', [], { stdio: 'ignore' });
          cp.on('exit', () => {
            done++;
            if (done === 30) {
              const out = execSync('ps -A -o stat=').toString();
              const zombies = (out.match(/Z/g) || []).length;
              if (zombies > 0) {
                process.exit(1);
              }
              console.log('0');
            }
          });
        }
        `,
      ],
      { encoding: 'utf8', timeout: 15000 }
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

  it.runIf(hasDockerAgentImage)('proves Podman inspect, logs and restart execute successfully via rootless Unix socket', () => {
    const res = spawnSync(
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
        `
        set -eu
        trap 'kill "$PID" 2>/dev/null || true' EXIT
        node -e "
        const http = require('node:http');
        const server = http.createServer((req, res) => {
          res.setHeader('Libpod-API-Version', '5.0.0');
          if (req.url.includes('_ping')) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
            return;
          }
          if (req.url.includes('/info')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ version: { Version: '5.0.0' }, host: { distribution: { distribution: 'alpine' } } }));
            return;
          }
          if (req.url.includes('/containers/json')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([{ Id: 'test-c1', Names: ['/test-c1'], State: 'running' }]));
            return;
          }
          if (req.url.includes('/containers/test-c1/json')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ Id: 'test-c1', State: { Status: 'running', Health: { Status: 'healthy' } } }));
            return;
          }
          if (req.url.includes('/logs')) {
            res.writeHead(200, { 'Content-Type': 'application/vnd.docker.raw-stream' });
            const msg = Buffer.from('service ready and healthy\\n');
            const header = Buffer.alloc(8);
            header[0] = 1;
            header.writeUInt32BE(msg.length, 4);
            res.end(Buffer.concat([header, msg]));
            return;
          }
          if (req.url.includes('/restart')) {
            res.writeHead(204);
            res.end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
        });
        server.listen('/tmp/podman.sock');
        " &
        PID=$!
        for i in $(seq 1 50); do
          if [ -S /tmp/podman.sock ]; then break; fi
          sleep 0.05
        done
        [ -S /tmp/podman.sock ]
        export CONTAINER_HOST=unix:///tmp/podman.sock
        podman info --format "{{.Version.Version}}" | grep -q "5.0.0"
        podman inspect test-c1 --format "{{.State.Status}}" | grep -q "running"
        podman logs test-c1 | grep -q "service ready and healthy"
        podman restart test-c1 | grep -q "test-c1"
        `,
      ],
      { encoding: 'utf8', timeout: 15000 }
    );
    expect(res.status).toBe(0);
  });

  it('verifies identity and spool persistence across process executions', async () => {
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

      // 1. Process 1: write identity & write attempt to spool via dedicated Node execution
      const spool1 = new ResultSpool(spoolDir);
      await spool1.initialize();
      await spool1.put({
        attemptId: 'cuid123456789012345678901',
        leaseToken: 'lease_token_789',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
      });
      expect(await spool1.depth()).toBe(1);

      // 2. Process 2: separate spawned Node process reads the identity and the persisted spool records
      const p2 = spawnSync(
        process.execPath,
        [
          '-e',
          `
          const fs = require('node:fs');
          const identity = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
          if (identity.agentId !== 'agent_cert_test_123') process.exit(2);
          const spoolPath = process.argv[2];
          const files = fs.readdirSync(spoolPath).filter(f => f.endsWith('.json') && !f.startsWith('.'));
          if (files.length !== 1) process.exit(3);
          const record = JSON.parse(fs.readFileSync(spoolPath + '/' + files[0], 'utf8'));
          if (record.attemptId !== 'cuid123456789012345678901' || record.status !== 'SUCCEEDED') process.exit(4);
          process.exit(0);
          `,
          identityFile,
          spoolDir,
        ],
        { encoding: 'utf8', timeout: 10000 }
      );
      expect(p2.status).toBe(0);
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
