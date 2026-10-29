import { spawn, type ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { testPrisma as db } from '../helpers/test-db';
import { fixture, scopes, type Fixture } from '../helpers/mcp-approval';
import { setupMcpApprovalDatabase } from '../helpers/mcp-approval-scenarios';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

/**
 * Real process and connection faults, not injected exceptions: a separate OS process commits the
 * approval and is killed (SIGKILL) or loses its database backend at a chosen point.
 */
async function approvedLead(f: Fixture) {
  const prepared = await prepareMcpOperation(f.ctx(), await f.leadArgs());
  await f.review(prepared);
  return prepared;
}

function startChild(f: Fixture, approvalId: string) {
  const child = spawn(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '-c',
      'vitest.int.config.ts',
      '--no-file-parallelism',
      '--maxWorkers=1',
      'tests/integration/mcp-fault-child.test.ts',
    ],
    {
      env: {
        ...process.env,
        MCP_FAULT_CHILD: '1',
        MCP_FAULT_GRANT: f.grant.id,
        MCP_FAULT_CREDENTIAL: f.token.id,
        MCP_FAULT_SCOPES: JSON.stringify(scopes),
        MCP_FAULT_APPROVAL: approvalId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group, so SIGKILL reaches the test worker vitest forks, not just its CLI.
      detached: true,
    }
  );
  let output = '';
  child.stdout!.on('data', chunk => (output += chunk));
  child.stderr!.on('data', chunk => (output += chunk));
  const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));
  return { child, exited, output: () => output };
}

async function until<T>(check: () => Promise<T | undefined | false>, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('condition not reached');
}

/** Backends of this database blocked on a lock: the child waiting inside its effect transaction. */
const lockedBackends = () =>
  db.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;

/** Holds the team row so the child blocks after its approval marker but before its effect commits. */
function holdTeamRow(teamId: string, release: Promise<void>) {
  let locked!: () => void;
  const ready = new Promise<void>(resolve => (locked = resolve));
  const done = db.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT id FROM "Team" WHERE id = ${teamId} FOR UPDATE`;
      locked();
      await release;
    },
    { timeout: 150_000, maxWait: 10_000 }
  );
  return { ready, done };
}

function kill(child: ChildProcess) {
  process.kill(-child.pid!, 'SIGKILL');
}

const approval = (id: string) => db.mcpOperationApproval.findUniqueOrThrow({ where: { id } });
const lead = async (f: Fixture) =>
  (await db.team.findUniqueOrThrow({ where: { id: f.team.id } })).teamLeadId;

describe('approval commit under real process and connection faults', () => {
  it('rolls back atomically when the process is killed inside the effect transaction', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    let release!: () => void;
    const hold = holdTeamRow(f.team.id, new Promise<void>(resolve => (release = resolve)));
    await hold.ready;
    const run = startChild(f, prepared.approvalId);
    await until(async () => (await lockedBackends()).length > 0 || undefined);
    kill(run.child);
    await run.exited;
    release();
    await hold.done;
    // The marker and the effect were in one uncommitted transaction: neither survived.
    await until(async () => (await lockedBackends()).length === 0 || undefined);
    expect(await lead(f)).toBeNull();
    expect((await approval(prepared.approvalId)).status).toBe('EXECUTING');
    const retried = await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(retried).toMatchObject({ status: 'COMMITTED' });
    expect(await lead(f)).toBe(f.lead.id);
    expect(
      await db.auditLog.count({
        where: { entityId: prepared.approvalId, action: 'mcp.operation.committed' },
      })
    ).toBe(1);
  }, 180_000);

  it('recovers when the database backend is terminated mid-transaction (failover-style loss)', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    let release!: () => void;
    const hold = holdTeamRow(f.team.id, new Promise<void>(resolve => (release = resolve)));
    await hold.ready;
    const run = startChild(f, prepared.approvalId);
    const [blocked] = await until(async () => {
      const rows = await lockedBackends();
      return rows.length ? rows : undefined;
    });
    await db.$queryRaw`SELECT pg_terminate_backend(${blocked.pid}::int)`;
    release();
    await hold.done;
    await run.exited;
    expect(await lead(f)).toBeNull();
    expect(['EXECUTING', 'APPROVED']).toContain((await approval(prepared.approvalId)).status);
    const retried = await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(retried).toMatchObject({ status: 'COMMITTED' });
    expect(await lead(f)).toBe(f.lead.id);
  }, 180_000);

  it('keeps an effect that committed just before the process was killed, and never repeats it', async () => {
    const f = await fixture();
    const prepared = await approvedLead(f);
    const run = startChild(f, prepared.approvalId);
    await until(async () => ((await lead(f)) === f.lead.id ? true : undefined));
    kill(run.child);
    await run.exited;
    // Committed atomically with the effect, whatever happened to the response afterwards.
    expect((await approval(prepared.approvalId)).status).toBe('COMMITTED');
    const revision = (await db.team.findUniqueOrThrow({ where: { id: f.team.id } })).revision;
    const replay = await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(replay).toMatchObject({ status: 'COMMITTED', replayed: true });
    expect((await db.team.findUniqueOrThrow({ where: { id: f.team.id } })).revision).toBe(revision);
  }, 180_000);
});
