import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const mocks = vi.hoisted(() => ({
  actor: {
    id: 'operator',
    role: 'RESPONDER',
    status: 'ACTIVE',
    teamIds: [],
    apiKey: { id: 'key', scopes: ['incidents:read', 'incidents:write', 'schedules:write'] },
  } as AuthorizationActor,
  tx: {
    incident: { findFirst: vi.fn() },
    onCallLayer: { findFirst: vi.fn() },
  },
  applyLifecycle: vi.fn(),
  addParticipant: vi.fn(),
  moveParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/api-v2/auth', () => ({
  authenticateV2Request: vi.fn(async () => ({ actor: mocks.actor, apiKey: mocks.actor.apiKey })),
}));
vi.mock('@/lib/api-v2/rate-limit', () => ({ enforceV2RateLimit: vi.fn(async () => ({})) }));
vi.mock('@/lib/api-v2/idempotency', () => ({
  runV2IdempotentMutation: vi.fn(async (_req, _id, _scope, _body, execute) => ({
    value: await execute(mocks.tx),
    replayed: false,
  })),
  idempotencyResponseHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/api-v2/audit', () => ({ logV2Audit: mocks.audit }));
vi.mock('@/lib/incidents/lifecycle', () => ({
  applyIncidentLifecycleCommand: mocks.applyLifecycle,
}));
vi.mock('@/lib/schedules/mutations', () => ({
  addScheduleLayerUser: mocks.addParticipant,
  moveScheduleLayerUser: mocks.moveParticipant,
  removeScheduleLayerUser: mocks.removeParticipant,
}));

import { POST as reopen } from '@/app/api/v2/incidents/[id]/reopen/route';
import { POST as snooze } from '@/app/api/v2/incidents/[id]/snooze/route';
import { POST as unsnooze } from '@/app/api/v2/incidents/[id]/unsnooze/route';
import { POST as suppress } from '@/app/api/v2/incidents/[id]/suppress/route';
import { POST as unsuppress } from '@/app/api/v2/incidents/[id]/unsuppress/route';
import { POST as unacknowledge } from '@/app/api/v2/incidents/[id]/unacknowledge/route';
import { POST as addParticipant } from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/route';
import {
  PATCH as moveParticipant,
  DELETE as removeParticipant,
} from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route';

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>;
function call(handler: Handler, body: unknown = {}, method = 'POST') {
  return handler(
    new NextRequest('http://localhost/api/v2/test', {
      method,
      headers: { 'idempotency-key': 'test-request' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id: 'incident', layerId: 'layer', userId: 'responder' }) }
  );
}
function callIncident(handler: Handler, body: unknown = {}) {
  return handler(
    new NextRequest('http://localhost/api/v2/incidents/incident/action', {
      method: 'POST',
      headers: { 'idempotency-key': 'test-request' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'incident' }) }
  );
}
function callParticipant(handler: Handler, body: unknown, method: string, child: boolean) {
  return handler(
    new NextRequest('http://localhost/api/v2/schedules/schedule/layers/layer/participants', {
      method,
      headers: { 'idempotency-key': 'test-request' },
      ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
    }),
    {
      params: Promise.resolve({
        id: 'schedule',
        layerId: 'layer',
        ...(child ? { userId: 'responder' } : {}),
      }),
    }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.incident.findFirst.mockResolvedValue({ id: 'incident' });
  mocks.tx.onCallLayer.findFirst.mockResolvedValue({ id: 'layer' });
  mocks.applyLifecycle.mockResolvedValue({
    incidentId: 'incident',
    previousStatus: 'RESOLVED',
    status: 'OPEN',
    changed: true,
  });
  mocks.addParticipant.mockResolvedValue({
    scheduleId: 'schedule',
    layerId: 'layer',
    userId: 'responder',
  });
  mocks.moveParticipant.mockResolvedValue({
    scheduleId: 'schedule',
    layerId: 'layer',
    userId: 'responder',
  });
  mocks.removeParticipant.mockResolvedValue({
    scheduleId: 'schedule',
    layerId: 'layer',
    userId: 'responder',
    removed: true,
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe('incident lifecycle adapters reuse canonical commands', () => {
  it.each([
    [reopen, 'REOPEN'],
    [unsnooze, 'UNSNOOZE'],
    [suppress, 'SUPPRESS'],
    [unsuppress, 'UNSUPPRESS'],
    [unacknowledge, 'UNACKNOWLEDGE'],
  ] as const)(
    'dispatches %s using the authenticated actor and outer transaction',
    async (handler, command) => {
      const response = await callIncident(handler, {
        expectedStatus: 'RESOLVED',
        note: 'Operator decision',
      });
      expect(response.status).toBe(200);
      expect(mocks.applyLifecycle).toHaveBeenCalledWith(
        mocks.tx,
        expect.objectContaining({
          incidentId: 'incident',
          command,
          source: 'REST_API',
          actor: { id: 'operator' },
          expectedStatus: 'RESOLVED',
        })
      );
      expect(mocks.audit).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'operator', apiKeyId: 'key', tx: mocks.tx })
      );
    }
  );
  it('requires a snooze expiry and forwards it as a Date', async () => {
    expect((await callIncident(snooze, {})).status).toBe(400);
    expect(mocks.applyLifecycle).not.toHaveBeenCalled();
    expect((await callIncident(snooze, { snoozedUntil: '2099-01-01T01:00:00Z' })).status).toBe(200);
    expect(mocks.applyLifecycle).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ snoozedUntil: new Date('2099-01-01T01:00:00Z') })
    );
  });
  it('hides inaccessible incidents and rejects properties belonging to another workflow', async () => {
    mocks.tx.incident.findFirst.mockResolvedValue(null);
    expect((await callIncident(reopen)).status).toBe(404);
    expect((await callIncident(reopen, { snoozedUntil: '2099-01-01T01:00:00Z' })).status).toBe(400);
    expect(mocks.applyLifecycle).not.toHaveBeenCalled();
  });
  it('propagates audit failure so the owner rolls back command and replay', async () => {
    mocks.audit.mockRejectedValue(new Error('audit failed'));
    expect((await callIncident(reopen)).status).toBe(500);
  });
});

describe('schedule participants preserve domain invariants', () => {
  it('checks that the layer belongs to the URL schedule before mutation', async () => {
    mocks.tx.onCallLayer.findFirst.mockResolvedValue(null);
    expect(
      (await callParticipant(addParticipant, { userId: 'responder' }, 'POST', false)).status
    ).toBe(404);
    expect(mocks.tx.onCallLayer.findFirst).toHaveBeenCalledWith({
      where: { id: 'layer', scheduleId: 'schedule' },
      select: { id: true },
    });
    expect(mocks.addParticipant).not.toHaveBeenCalled();
  });
  it('adds through the shared active-responder and uniqueness command', async () => {
    expect(
      (await callParticipant(addParticipant, { userId: 'responder' }, 'POST', false)).status
    ).toBe(201);
    expect(mocks.addParticipant).toHaveBeenCalledWith('layer', 'responder', mocks.tx);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 'schedule', tx: mocks.tx })
    );
  });
  it('moves and removes through shared position normalization commands', async () => {
    expect(
      (await callParticipant(moveParticipant, { direction: 'up' }, 'PATCH', true)).status
    ).toBe(200);
    expect(mocks.moveParticipant).toHaveBeenCalledWith('layer', 'responder', 'up', mocks.tx);
    expect((await callParticipant(removeParticipant, undefined, 'DELETE', true)).status).toBe(200);
    expect(mocks.removeParticipant).toHaveBeenCalledWith('layer', 'responder', mocks.tx);
  });
  it('rejects invalid directions and arbitrary layer/participant properties', async () => {
    expect(
      (await callParticipant(moveParticipant, { direction: 'sideways' }, 'PATCH', true)).status
    ).toBe(400);
    expect(
      (await callParticipant(addParticipant, { userId: 'responder', position: 100 }, 'POST', false))
        .status
    ).toBe(400);
    expect(mocks.moveParticipant).not.toHaveBeenCalled();
    expect(mocks.addParticipant).not.toHaveBeenCalled();
  });
  it('uses strict URL parameters', async () => {
    expect((await call(reopen)).status).toBe(400);
  });
});
