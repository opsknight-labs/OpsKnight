import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRequest, parseResponse } from '../helpers/api-test';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  checkRateLimit: vi.fn(),
  resolveApiKeyActor: vi.fn(),
  authorize: vi.fn(),
  applyRestIncidentPatch: vi.fn(),
  scheduleStatusPageNotification: vi.fn(),
  sendServiceNotifications: vi.fn(),
  triggerWebhooksForService: vi.fn(),
  incidentFindUnique: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiKey: mocks.authenticateApiKey }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock('@/lib/authorization-actors', () => ({ resolveApiKeyActor: mocks.resolveApiKeyActor }));
vi.mock('@/lib/authorization-policy', () => ({
  AUTHORIZATION_ACTIONS: {
    INCIDENT_READ: 'incident.read',
    INCIDENT_MANAGE: 'incident.manage',
  },
  authorize: mocks.authorize,
}));
vi.mock('@/lib/incidents/rest-patch', () => ({
  applyRestIncidentPatch: mocks.applyRestIncidentPatch,
}));
vi.mock('@/lib/jobs/queue', () => ({
  scheduleStatusPageNotification: mocks.scheduleStatusPageNotification,
}));
vi.mock('@/lib/service-notifications', () => ({
  sendServiceNotifications: mocks.sendServiceNotifications,
}));
vi.mock('@/lib/status-page-webhooks', () => ({
  triggerWebhooksForService: mocks.triggerWebhooksForService,
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
  },
}));

import { PATCH } from '@/app/api/incidents/[id]/route';

const context = { params: Promise.resolve({ id: 'inc-1' }) };

function incident(status = 'ACKNOWLEDGED') {
  return {
    id: 'inc-1',
    title: 'Database latency',
    description: 'High latency detected',
    status,
    urgency: 'HIGH',
    priority: 'P1',
    serviceId: 'svc-1',
    assigneeId: null,
    teamId: null,
    visibility: 'PUBLIC',
    createdAt: new Date('2026-08-28T00:00:00.000Z'),
    acknowledgedAt: status === 'ACKNOWLEDGED' ? new Date('2026-08-28T00:01:00.000Z') : null,
    resolvedAt: status === 'RESOLVED' ? new Date('2026-08-28T00:10:00.000Z') : null,
  };
}

describe('PATCH /api/incidents/:id lifecycle adoption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateApiKey.mockResolvedValue({
      id: 'key-1',
      userId: 'user-1',
      scopes: ['incidents:write'],
    });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetAt: Date.now() + 60_000,
      count: 1,
    });
    mocks.resolveApiKeyActor.mockResolvedValue({
      id: 'user-1',
      role: 'RESPONDER',
      status: 'ACTIVE',
      teamIds: [],
      apiKey: { id: 'key-1', scopes: ['incidents:write'] },
    });
    mocks.authorize.mockReturnValue({ allowed: true, scope: 'global' });
    mocks.sendServiceNotifications.mockResolvedValue({ success: true });
    mocks.scheduleStatusPageNotification.mockResolvedValue(undefined);
    mocks.triggerWebhooksForService.mockResolvedValue(undefined);
  });

  it('routes status changes through the REST lifecycle transaction and dispatches changed-only effects', async () => {
    const patchedIncident = incident('ACKNOWLEDGED');
    mocks.applyRestIncidentPatch.mockResolvedValue({
      incident: patchedIncident,
      lifecycle: {
        incidentId: 'inc-1',
        command: 'ACKNOWLEDGE',
        source: 'REST_API',
        previousStatus: 'OPEN',
        status: 'ACKNOWLEDGED',
        changed: true,
      },
      urgencyChanged: false,
      assigneeChanged: false,
      changed: true,
    });
    mocks.incidentFindUnique.mockResolvedValue({
      ...patchedIncident,
      service: { id: 'svc-1', name: 'Database' },
      assignee: null,
    });

    const req = await createMockRequest('PATCH', '/api/incidents/inc-1', {
      status: 'ACKNOWLEDGED',
    });
    const res = await PATCH(req, context);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(200);
    expect(data.incident.status).toBe('ACKNOWLEDGED');
    expect(mocks.applyRestIncidentPatch).toHaveBeenCalledWith({
      incidentId: 'inc-1',
      status: 'ACKNOWLEDGED',
      urgency: undefined,
      assigneeId: undefined,
      hasAssigneeUpdate: false,
      actor: { id: 'user-1' },
    });
    expect(mocks.triggerWebhooksForService).toHaveBeenCalledWith(
      'svc-1',
      'incident.acknowledged',
      expect.objectContaining({ id: 'inc-1', status: 'ACKNOWLEDGED' })
    );
    expect(mocks.sendServiceNotifications).toHaveBeenCalledWith('inc-1', 'acknowledged');
    expect(mocks.scheduleStatusPageNotification).toHaveBeenCalledWith('inc-1', 'acknowledged');
  });

  it('does not repeat lifecycle side effects for an idempotent status retry', async () => {
    mocks.applyRestIncidentPatch.mockResolvedValue({
      incident: incident('ACKNOWLEDGED'),
      lifecycle: {
        incidentId: 'inc-1',
        command: null,
        source: 'REST_API',
        previousStatus: 'ACKNOWLEDGED',
        status: 'ACKNOWLEDGED',
        changed: false,
      },
      urgencyChanged: false,
      assigneeChanged: false,
      changed: false,
    });

    const req = await createMockRequest('PATCH', '/api/incidents/inc-1', {
      status: 'ACKNOWLEDGED',
    });
    const res = await PATCH(req, context);

    expect(res.status).toBe(200);
    expect(mocks.incidentFindUnique).not.toHaveBeenCalled();
    expect(mocks.triggerWebhooksForService).not.toHaveBeenCalled();
    expect(mocks.sendServiceNotifications).not.toHaveBeenCalled();
    expect(mocks.scheduleStatusPageNotification).not.toHaveBeenCalled();
  });

  it('returns the typed lifecycle validation contract at the API boundary', async () => {
    mocks.applyRestIncidentPatch.mockRejectedValue(
      new AppError({
        code: 'INCIDENT_REQUIRED_FIELDS_MISSING',
        userMessage: 'Complete required custom fields before resolving: Impact',
        details: { fields: ['Impact'] },
      })
    );

    const req = await createMockRequest('PATCH', '/api/incidents/inc-1', {
      status: 'RESOLVED',
    });
    const res = await PATCH(req, context);
    const { status, data } = await parseResponse(res);

    expect(status).toBe(422);
    expect(data.code).toBe('INCIDENT_REQUIRED_FIELDS_MISSING');
    expect(data.error).toContain('Complete required custom fields');
    expect(mocks.triggerWebhooksForService).not.toHaveBeenCalled();
    expect(mocks.sendServiceNotifications).not.toHaveBeenCalled();
  });

  it('authorizes the API-key actor before entering the lifecycle transaction', async () => {
    mocks.authorize.mockReturnValue({ allowed: false, reason: 'role_denied' });

    const req = await createMockRequest('PATCH', '/api/incidents/inc-1', {
      status: 'ACKNOWLEDGED',
    });
    const res = await PATCH(req, context);

    expect(res.status).toBe(403);
    expect(mocks.applyRestIncidentPatch).not.toHaveBeenCalled();
  });
});
