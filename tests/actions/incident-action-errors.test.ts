import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  assertResponderOrAbove: vi.fn(),
  assertCanCreateIncidentForService: vi.fn(),
  assertCanAddIncidentNote: vi.fn(),
  getCurrentUser: vi.fn(),
  executeIncidentCreation: vi.fn(),
  incidentUpdate: vi.fn(),
  teamFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  incidentEventCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: mocks.assertResponderOrAbove,
  assertCanCreateIncidentForService: mocks.assertCanCreateIncidentForService,
  assertCanAddIncidentNote: mocks.assertCanAddIncidentNote,
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/incidents/creation', () => ({
  executeIncidentCreation: mocks.executeIncidentCreation,
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      update: mocks.incidentUpdate,
    },
    team: {
      findUnique: mocks.teamFindUnique,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
    incidentEvent: {
      create: mocks.incidentEventCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  createIncident,
  reassignIncident,
  updateIncidentUrgency,
} from '@/app/(app)/incidents/actions';

describe('incident server-action typed errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertResponderOrAbove.mockResolvedValue({ id: 'responder-1' });
    mocks.assertCanCreateIncidentForService.mockResolvedValue({ id: 'responder-1' });
    mocks.getCurrentUser.mockResolvedValue({ id: 'responder-1', name: 'Responder' });
    mocks.executeIncidentCreation.mockResolvedValue({ id: 'inc-1', outcome: 'CREATED' });
    mocks.transaction.mockImplementation(async callback =>
      callback({
        incident: { update: mocks.incidentUpdate },
        team: { findUnique: mocks.teamFindUnique },
        user: { findUnique: mocks.userFindUnique },
        incidentEvent: { create: mocks.incidentEventCreate },
      })
    );
  });

  it('preserves typed authorization failures instead of flattening them to Error', async () => {
    const denied = new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Unauthorized. Responder access or above required.',
    });
    mocks.assertResponderOrAbove.mockRejectedValue(denied);

    await expect(updateIncidentUrgency('inc-1', 'HIGH')).rejects.toBe(denied);
    expect(mocks.incidentUpdate).not.toHaveBeenCalled();
  });

  it('returns a typed validation error for an invalid urgency', async () => {
    await expect(updateIncidentUrgency('inc-1', 'CRITICAL')).rejects.toMatchObject({
      code: 'INCIDENT_INVALID_ARGUMENT',
      userMessage: 'Invalid incident urgency.',
      fields: [expect.objectContaining({ field: 'urgency', code: 'invalid' })],
    });
    expect(mocks.incidentUpdate).not.toHaveBeenCalled();
  });

  it('preserves service authorization errors during incident creation', async () => {
    const denied = new AppError({
      code: 'INCIDENT_CREATE_SERVICE_ACCESS_DENIED',
      userMessage: 'Unauthorized. You can only create incidents for your team services.',
    });
    mocks.assertCanCreateIncidentForService.mockRejectedValue(denied);

    const formData = new FormData();
    formData.set('title', 'Database latency');
    formData.set('serviceId', 'svc-1');
    formData.set('urgency', 'HIGH');

    await expect(createIncident(formData)).rejects.toBe(denied);
    expect(mocks.executeIncidentCreation).not.toHaveBeenCalled();
  });

  it('uses a structured not-found error for a missing reassignment team', async () => {
    mocks.teamFindUnique.mockResolvedValue(null);

    await expect(reassignIncident('inc-1', '', 'team-missing')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      details: { resource: 'team', teamId: 'team-missing' },
    });
    expect(mocks.incidentUpdate).not.toHaveBeenCalled();
  });
});
