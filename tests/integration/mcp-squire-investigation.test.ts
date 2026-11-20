// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import type { SquireEvent } from '@/lib/intelligence/squire/contract';

// The Squire turn itself is covered elsewhere; here it is a stream the test releases step by step.
const turn = vi.hoisted(() => ({
  release: [] as Array<() => void>,
  calls: [] as unknown[][],
}));
vi.mock('@/lib/intelligence/squire/chat', () => ({
  streamSquire: async function* (...args: unknown[]): AsyncGenerator<SquireEvent> {
    turn.calls.push(args);
    const gate = () => new Promise<void>(resolve => turn.release.push(resolve));
    yield { type: 'meta', name: 'Squire', mode: 'ai' } as SquireEvent;
    yield {
      type: 'investigation',
      step: { index: 0, title: 'Check recent changes', status: 'running', calls: [] },
    };
    await gate();
    yield {
      type: 'investigation',
      step: {
        index: 0,
        title: 'Check recent changes',
        status: 'done',
        calls: [{ tool: 'get_recent_changes', label: 'Recent changes', ok: true }],
      },
    };
    await gate();
    yield { type: 'delta', text: 'A deploy at 10:02 preceded the errors.' };
    yield { type: 'done' };
  },
}));
const enabled = vi.hoisted(() => ({ value: true }));
vi.mock('@/lib/mcp/core/ask-squire-settings', () => ({
  isAskSquireEnabled: vi.fn(async () => enabled.value),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, resetAt: Date.now() + 60_000 })),
}));

import { resetDatabase, testPrisma as db } from '../helpers/test-db';
import { ASK_SQUIRE_SCOPES } from '@/lib/mcp/core/ask-squire-contract';
import {
  SQUIRE_INVESTIGATIONS_PER_PERSON,
  cleanupExpiredSquireInvestigations,
  getSquireInvestigationForMcp,
  startSquireInvestigationForMcp,
} from '@/lib/mcp/core/squire-investigation';

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);

beforeEach(async () => {
  enabled.value = true;
  // Let any turn left from an earlier test finish.
  for (let i = 0; i < 10; i += 1) turn.release.splice(0).forEach(resolve => resolve());
  await new Promise(resolve => setTimeout(resolve, 50));
  turn.calls.length = 0;
  await db.squireMcpInvestigation.deleteMany();
});

const person = (id: string, scopes: readonly string[] = ASK_SQUIRE_SCOPES): AuthorizationActor => ({
  id,
  role: 'RESPONDER',
  status: 'ACTIVE',
  teamIds: [],
  apiKey: { id: 'grant', scopes },
});
const alice = person('user-alice');
const question = { question: 'Why did checkout start failing?' };

const releaseNext = async () => {
  await vi.waitFor(() => expect(turn.release.length).toBeGreaterThan(0));
  turn.release.shift()!();
};

describe('MCP Squire investigation (start and poll)', () => {
  it('returns an id at once, then the steps, then the cited answer', async () => {
    const started = await startSquireInvestigationForMcp(alice, 'grant-a', question);
    expect(started).toMatchObject({ status: 'running', pollIntervalMs: 5000 });
    expect(started.investigationId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const expiresIn = new Date(started.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(59 * 60_000);
    expect(expiresIn).toBeLessThanOrEqual(3600_000);
    // The turn runs as the person, limited to the read tools the connection's scopes allow.
    await vi.waitFor(() => expect(turn.calls).toHaveLength(1));
    const [actor, request, , scope] = turn.calls[0] as [
      AuthorizationActor,
      { message: string },
      unknown,
      { readTools: ReadonlySet<string> },
    ];
    expect(actor).toEqual({ id: 'user-alice', role: 'RESPONDER', status: 'ACTIVE', teamIds: [] });
    expect(request.message).toBe(question.question);
    expect(scope.readTools.has('get_recent_changes')).toBe(true);
    expect(scope.readTools.has('get_alert_payload')).toBe(false);

    const id = { investigationId: started.investigationId };
    await vi.waitFor(async () =>
      expect((await getSquireInvestigationForMcp(alice, 'grant-a', id)).progress).toEqual([
        { title: 'Check recent changes', status: 'running', reads: [] },
      ])
    );
    await releaseNext();
    await vi.waitFor(async () =>
      expect((await getSquireInvestigationForMcp(alice, 'grant-a', id)).progress).toEqual([
        { title: 'Check recent changes', status: 'done', reads: ['Recent changes'] },
      ])
    );
    expect((await getSquireInvestigationForMcp(alice, 'grant-a', id)).status).toBe('running');
    await releaseNext();
    await vi.waitFor(async () =>
      expect((await getSquireInvestigationForMcp(alice, 'grant-a', id)).status).toBe('completed')
    );
    const done = await getSquireInvestigationForMcp(alice, 'grant-a', id);
    expect(done).not.toHaveProperty('pollIntervalMs');
    expect(done.result).toMatchObject({
      mode: 'ai',
      answer: 'A deploy at 10:02 preceded the errors.',
      suggestedActions: [],
    });
    // Model-written steps and the answer are stored encrypted.
    const row = await db.squireMcpInvestigation.findUniqueOrThrow({
      where: { id: id.investigationId },
    });
    expect(row.payloadEncrypted).toBeTruthy();
    expect(row.payloadEncrypted).not.toContain('deploy');
    expect(row.payloadEncrypted).not.toContain('Check recent changes');
  });

  it('is readable only by the person who started it, on the same connection', async () => {
    const { investigationId } = await startSquireInvestigationForMcp(alice, 'grant-a', question);
    const notFound = { code: 'MCP_TASK_NOT_FOUND', status: 404 };
    await expect(
      getSquireInvestigationForMcp(person('user-bob'), 'grant-a', { investigationId })
    ).rejects.toMatchObject(notFound);
    await expect(
      getSquireInvestigationForMcp(alice, 'grant-other', { investigationId })
    ).rejects.toMatchObject(notFound);
    await expect(
      getSquireInvestigationForMcp(alice, 'grant-a', { investigationId: 'x'.repeat(32) })
    ).rejects.toMatchObject(notFound);
    await expect(
      getSquireInvestigationForMcp(alice, 'grant-a', { investigationId: 'bad' })
    ).rejects.toMatchObject({ code: 'MCP_INVALID_ARGUMENTS' });
  });

  it('expires after one hour and is purged by maintenance', async () => {
    const { investigationId } = await startSquireInvestigationForMcp(alice, 'grant-a', question);
    await db.squireMcpInvestigation.update({
      where: { id: investigationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      getSquireInvestigationForMcp(alice, 'grant-a', { investigationId })
    ).rejects.toMatchObject({ code: 'MCP_TASK_NOT_FOUND' });
    expect(await cleanupExpiredSquireInvestigations()).toBe(1);
    expect(await db.squireMcpInvestigation.count()).toBe(0);
  });

  it('bounds how many run at once per person; a lost run frees its slot and reports failed', async () => {
    const first = await startSquireInvestigationForMcp(alice, 'grant-a', question);
    for (let i = 1; i < SQUIRE_INVESTIGATIONS_PER_PERSON; i += 1)
      await startSquireInvestigationForMcp(alice, 'grant-a', question);
    await expect(startSquireInvestigationForMcp(alice, 'grant-b', question)).rejects.toMatchObject({
      code: 'MCP_RATE_LIMITED',
      status: 429,
    });
    // Someone else is not limited by Alice's runs.
    await expect(
      startSquireInvestigationForMcp(person('user-bob'), 'grant-b', question)
    ).resolves.toMatchObject({ status: 'running' });
    // A run whose process died (still RUNNING long after its time limit).
    await db.squireMcpInvestigation.update({
      where: { id: first.investigationId },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    await expect(startSquireInvestigationForMcp(alice, 'grant-a', question)).resolves.toMatchObject(
      { status: 'running' }
    );
    await expect(
      getSquireInvestigationForMcp(alice, 'grant-a', { investigationId: first.investigationId })
    ).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Start it again'),
    });
  });

  it('respects the Squire for MCP switch and the scope gate', async () => {
    const { investigationId } = await startSquireInvestigationForMcp(alice, 'grant-a', question);
    enabled.value = false;
    const disabled = { code: 'MCP_CAPABILITY_DISABLED', status: 403 };
    await expect(startSquireInvestigationForMcp(alice, 'grant-a', question)).rejects.toMatchObject(
      disabled
    );
    await expect(
      getSquireInvestigationForMcp(alice, 'grant-a', { investigationId })
    ).rejects.toMatchObject(disabled);
    enabled.value = true;
    const narrow = person('user-alice', ['incidents:read']);
    await expect(startSquireInvestigationForMcp(narrow, 'grant-a', question)).rejects.toMatchObject(
      { code: 'MCP_OPERATION_FORBIDDEN' }
    );
    await expect(
      getSquireInvestigationForMcp(narrow, 'grant-a', { investigationId })
    ).rejects.toMatchObject({ code: 'MCP_OPERATION_FORBIDDEN' });
  });
});
