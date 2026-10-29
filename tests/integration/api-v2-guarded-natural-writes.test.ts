/**
 * Receipt-less (natural idempotency) REST v2 writes run the MCP approval hook as the first statement
 * of the transaction that applies their effect. Proven with the real hook against PostgreSQL:
 * a failing hook leaves nothing behind, a passing hook commits exactly together with the effect,
 * and a write that loses its conflict check rolls the hook's own writes back.
 */
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashTokenV2 } from '@/lib/api-keys';
import { authenticateV2Request } from '@/lib/api-v2/auth';
import { withInternalV2Invocation } from '@/lib/api-v2/internal-context';
import { AppError } from '@/lib/errors';
import { POST as createOverride } from '@/app/api/v2/schedules/[id]/overrides/route';
import { POST as createStatusPage } from '@/app/api/v2/status-pages/route';
import { POST as retryNotification } from '@/app/api/v2/notifications/[id]/retry/route';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

type Guard = (tx: Prisma.TransactionClient, phase?: 'replay' | 'mutation') => Promise<void>;

const MARKER = 'test.mcp_guard.marker';

async function makeKey() {
  const user = await createTestUser({ role: 'ADMIN', email: `admin-${randomUUID()}@example.com` });
  const token = `ok_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await db.apiKey.create({
    data: {
      name: 'guarded natural writes',
      prefix: token.slice(0, 12),
      tokenHash: hashTokenV2(token),
      scopes: ['admin:manage'],
      userId: user.id,
    },
  });
  return { user, token };
}

function request(token: string, method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost:3000${url}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function call<P extends Record<string, string>>(
  handler: (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>,
  token: string,
  method: string,
  url: string,
  params: P,
  body?: unknown,
  guard?: Guard
) {
  const req = request(token, method, url, body);
  const invoke = () => handler(req, { params: Promise.resolve(params) });
  if (!guard) return invoke();
  const auth = await authenticateV2Request(request(token, method, url, body));
  return withInternalV2Invocation(req, auth, invoke, guard);
}

const rejectingGuard: Guard = async () => {
  throw new AppError({ code: 'PRECONDITION_FAILED', userMessage: 'Approval no longer valid.' });
};

/** Writes a marker through the transaction it is given and checks the effect is not yet written. */
function markingGuard(
  runId: string,
  effectAbsent: (tx: Prisma.TransactionClient) => Promise<boolean>
) {
  const calls: Array<{ phase: string | undefined; effectAbsent: boolean }> = [];
  const guard: Guard = async (tx, phase) => {
    calls.push({ phase, effectAbsent: await effectAbsent(tx) });
    await tx.auditLog.create({
      data: { action: MARKER, entityType: 'SYSTEM_CONFIG', entityId: runId },
    });
  };
  return { guard, calls };
}

const markers = (runId: string) =>
  db.auditLog.count({ where: { action: MARKER, entityId: runId } });

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
}, 120_000);

describe('createScheduleOverride', () => {
  const window = { startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-01T08:00:00.000Z' };

  async function setup() {
    const { user, token } = await makeKey();
    const schedule = await db.onCallSchedule.create({ data: { name: `Guarded ${randomUUID()}` } });
    const url = `/api/v2/schedules/${schedule.id}/overrides`;
    const body = { userId: user.id, ...window };
    const audits = () =>
      db.auditLog.count({ where: { action: 'schedule_override.created', entityId: schedule.id } });
    const overrides = () => db.onCallOverride.count({ where: { scheduleId: schedule.id } });
    return { token, schedule, url, body, audits, overrides };
  }

  it('persists nothing when the approval hook rejects', async () => {
    const { token, schedule, url, body, audits, overrides } = await setup();
    const res = await call(
      createOverride,
      token,
      'POST',
      url,
      { id: schedule.id },
      body,
      rejectingGuard
    );
    expect(res.status).toBe(412);
    expect(await overrides()).toBe(0);
    expect(await audits()).toBe(0);
  });

  it('commits the hook exactly once with the override, and rolls it back on a 409', async () => {
    const { token, schedule, url, body, audits, overrides } = await setup();
    const runId = randomUUID();
    const { guard, calls } = markingGuard(
      runId,
      async tx => (await tx.onCallOverride.count({ where: { scheduleId: schedule.id } })) === 0
    );
    const res = await call(createOverride, token, 'POST', url, { id: schedule.id }, body, guard);
    expect(res.status).toBe(201);
    expect(calls).toEqual([{ phase: undefined, effectAbsent: true }]);
    expect(await overrides()).toBe(1);
    expect(await audits()).toBe(1);
    expect(await markers(runId)).toBe(1);

    const conflictRun = randomUUID();
    const second = markingGuard(conflictRun, async () => true);
    const conflict = await call(
      createOverride,
      token,
      'POST',
      url,
      { id: schedule.id },
      body,
      second.guard
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('SCHEDULE_OVERRIDE_CONFLICT');
    expect(second.calls).toHaveLength(1);
    expect(await markers(conflictRun)).toBe(0);
    expect(await overrides()).toBe(1);
    expect(await audits()).toBe(1);
  });

  it('behaves as before without the hook', async () => {
    const { token, schedule, url, body, audits, overrides } = await setup();
    const res = await call(createOverride, token, 'POST', url, { id: schedule.id }, body);
    expect(res.status).toBe(201);
    const created = (await res.json()).data;
    expect(created).toMatchObject({
      scheduleId: schedule.id,
      startDate: window.startDate,
      endDate: window.endDate,
    });
    const duplicate = await call(createOverride, token, 'POST', url, { id: schedule.id }, body);
    expect(duplicate.status).toBe(409);
    expect(await overrides()).toBe(1);
    expect(await audits()).toBe(1);
  });
});

describe('createStatusPage', () => {
  const body = () => ({
    name: `Status ${randomUUID().slice(0, 8)}`,
    slug: `s-${randomUUID().slice(0, 8)}`,
  });
  const audits = () => db.auditLog.count({ where: { action: 'status_page.created' } });

  it('persists nothing when the approval hook rejects', async () => {
    const { token } = await makeKey();
    const res = await call(
      createStatusPage,
      token,
      'POST',
      '/api/v2/status-pages',
      {},
      body(),
      rejectingGuard
    );
    expect(res.status).toBe(412);
    expect(await db.statusPage.count()).toBe(0);
    expect(await audits()).toBe(0);
  });

  it('commits the hook exactly once with the page, and rolls it back when the limit rejects', async () => {
    const { token } = await makeKey();
    const runId = randomUUID();
    const { guard, calls } = markingGuard(runId, async tx => (await tx.statusPage.count()) === 0);
    const res = await call(
      createStatusPage,
      token,
      'POST',
      '/api/v2/status-pages',
      {},
      body(),
      guard
    );
    expect(res.status).toBe(201);
    expect(calls).toEqual([{ phase: undefined, effectAbsent: true }]);
    expect(await db.statusPage.count()).toBe(1);
    expect(await audits()).toBe(1);
    expect(await markers(runId)).toBe(1);

    const rejectedRun = randomUUID();
    const second = markingGuard(rejectedRun, async () => true);
    const rejected = await call(
      createStatusPage,
      token,
      'POST',
      '/api/v2/status-pages',
      {},
      body(),
      second.guard
    );
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).code).toBe('STATUS_PAGE_LIMIT_REACHED');
    expect(second.calls).toHaveLength(1);
    expect(await markers(rejectedRun)).toBe(0);
    expect(await db.statusPage.count()).toBe(1);
    expect(await audits()).toBe(1);
  });

  it('behaves as before without the hook', async () => {
    const { token } = await makeKey();
    const input = body();
    const res = await call(createStatusPage, token, 'POST', '/api/v2/status-pages', {}, input);
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ ...input, isDefault: true, enabled: false });
    const second = await call(createStatusPage, token, 'POST', '/api/v2/status-pages', {}, body());
    expect(second.status).toBe(403);
    expect(await db.statusPage.count()).toBe(1);
    expect(await audits()).toBe(1);
  });
});

describe('retryNotification', () => {
  async function failedEmail() {
    const recipient = await createTestUser({ role: 'RESPONDER' });
    return db.notification.create({
      data: {
        userId: recipient.id,
        channel: 'EMAIL',
        status: 'FAILED',
        attempts: 1,
        maxAttempts: 3,
        payloadEncrypted: 'v1:encrypted-placeholder',
        failedAt: new Date(),
        errorMsg: 'provider unavailable',
      },
    });
  }

  async function failedTeams() {
    const deliveryKey = `teams:delivery:${randomUUID()}`;
    const operation = await db.externalOperation.create({
      data: {
        provider: 'MICROSOFT_TEAMS',
        operation: 'deliver',
        idempotencyKey: deliveryKey,
        status: 'FAILED',
      },
    });
    const recipient = await createTestUser({ role: 'RESPONDER' });
    const notification = await db.notification.create({
      data: {
        userId: recipient.id,
        channel: 'MICROSOFT_TEAMS',
        status: 'FAILED',
        attempts: 1,
        maxAttempts: 3,
        deliveryKey,
        failedAt: new Date(),
        errorMsg: 'provider unavailable',
      },
    });
    return { notification, operation };
  }

  const url = (id: string) => `/api/v2/notifications/${id}/retry`;
  const audits = (id: string) =>
    db.auditLog.count({ where: { action: 'notification.retry_requested', entityId: id } });
  const statusOf = async (id: string) =>
    (await db.notification.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  it('persists nothing when the approval hook rejects', async () => {
    const { token } = await makeKey();
    const notification = await failedEmail();
    const res = await call(
      retryNotification,
      token,
      'POST',
      url(notification.id),
      { id: notification.id },
      undefined,
      rejectingGuard
    );
    expect(res.status).toBe(412);
    expect(
      await db.notification.findUniqueOrThrow({ where: { id: notification.id } })
    ).toMatchObject({
      status: 'FAILED',
      attempts: 1,
      maxAttempts: 3,
      errorMsg: 'provider unavailable',
    });
    expect(await audits(notification.id)).toBe(0);
  });

  it('commits the hook exactly once with the requeue, and rolls it back when a concurrent retry wins', async () => {
    const { token } = await makeKey();
    const notification = await failedEmail();
    const runId = randomUUID();
    const { guard, calls } = markingGuard(
      runId,
      async tx =>
        (await tx.notification.findUniqueOrThrow({ where: { id: notification.id } })).status ===
        'FAILED'
    );
    const res = await call(
      retryNotification,
      token,
      'POST',
      url(notification.id),
      { id: notification.id },
      undefined,
      guard
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ phase: undefined, effectAbsent: true }]);
    expect(await statusOf(notification.id)).toBe('PENDING');
    expect(await audits(notification.id)).toBe(1);
    expect(await markers(runId)).toBe(1);

    // The route's pre-check sees FAILED; a concurrent retry then commits before the compare-and-set.
    const raced = await failedEmail();
    const racedRun = randomUUID();
    const racing = markingGuard(racedRun, async () => {
      await db.notification.update({ where: { id: raced.id }, data: { status: 'PENDING' } });
      return true;
    });
    const conflict = await call(
      retryNotification,
      token,
      'POST',
      url(raced.id),
      { id: raced.id },
      undefined,
      racing.guard
    );
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('NOTIFICATION_NOT_RETRYABLE');
    expect(racing.calls).toHaveLength(1);
    expect(await markers(racedRun)).toBe(0);
    expect(await audits(raced.id)).toBe(0);
  });

  it('requeues a Microsoft Teams delivery atomically with the hook, and surfaces the hook failure', async () => {
    const { token } = await makeKey();
    const rejected = await failedTeams();
    const id = rejected.notification.id;
    const denied = await call(
      retryNotification,
      token,
      'POST',
      url(id),
      { id },
      undefined,
      rejectingGuard
    );
    expect(denied.status).toBe(412);
    expect(await statusOf(id)).toBe('FAILED');
    expect(
      (await db.externalOperation.findUniqueOrThrow({ where: { id: rejected.operation.id } }))
        .status
    ).toBe('FAILED');
    expect(await db.backgroundJob.count({ where: { type: 'EXTERNAL_OPERATION' } })).toBe(0);
    expect(await audits(id)).toBe(0);

    const runId = randomUUID();
    const { guard, calls } = markingGuard(
      runId,
      async tx => (await tx.backgroundJob.count({ where: { type: 'EXTERNAL_OPERATION' } })) === 0
    );
    const res = await call(retryNotification, token, 'POST', url(id), { id }, undefined, guard);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ phase: undefined, effectAbsent: true }]);
    expect(await statusOf(id)).toBe('PENDING');
    expect(
      (await db.externalOperation.findUniqueOrThrow({ where: { id: rejected.operation.id } }))
        .status
    ).toBe('PENDING');
    expect(await db.backgroundJob.count({ where: { type: 'EXTERNAL_OPERATION' } })).toBe(1);
    expect(await audits(id)).toBe(1);
    expect(await markers(runId)).toBe(1);
  });

  it('behaves as before without the hook', async () => {
    const { token } = await makeKey();
    const notification = await failedEmail();
    const res = await call(retryNotification, token, 'POST', url(notification.id), {
      id: notification.id,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      success: true,
      message: `Notification '${notification.id}' scheduled for retry.`,
    });
    expect(await statusOf(notification.id)).toBe('PENDING');
    const again = await call(retryNotification, token, 'POST', url(notification.id), {
      id: notification.id,
    });
    expect(again.status).toBe(409);
    expect(await audits(notification.id)).toBe(1);

    const teams = await failedTeams();
    const teamsRes = await call(retryNotification, token, 'POST', url(teams.notification.id), {
      id: teams.notification.id,
    });
    expect(teamsRes.status).toBe(200);
    expect(await statusOf(teams.notification.id)).toBe('PENDING');
    expect(await db.backgroundJob.count({ where: { type: 'EXTERNAL_OPERATION' } })).toBe(1);
    expect(await audits(teams.notification.id)).toBe(1);
  });
});
