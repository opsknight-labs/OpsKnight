import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendIncidentCard = vi.fn();
const createIncidentCard = vi.fn();
const updateIncidentCard = vi.fn();
const recoverIncidentCard = vi.fn();
const operationUpdates: Array<Record<string, unknown>> = [];
let currentResultPayload: Record<string, unknown> | null = null;
let ledgerUpdateCount = 0;
let ownerOperation: {
  id: string;
  status: string;
  leaseExpiresAt: Date | null;
  resultPayload: Record<string, unknown> | null;
} | null = { id: 'op-create', status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() + 60_000), resultPayload: { createAttempted: true } };

const incident = {
  id: 'inc-1', title: 'Incident', description: null, status: 'RESOLVED', urgency: 'HIGH', priority: null,
  serviceId: 'svc-1', service: { name: 'API' }, assignee: null, createdAt: new Date('2026-01-01T00:00:00Z'),
  acknowledgedAt: new Date('2026-01-01T00:01:00Z'), resolvedAt: new Date('2026-01-01T00:02:00Z'),
  escalationGeneration: 0, slaAckTargetMs: null, slaResolveTargetMs: null, slaPausedMs: null, slaPauseStartedAt: null,
};
const ledger = {
  messageId: 'old-activity', conversationId: 'old-conversation', createState: 'AMBIGUOUS', createOperationId: 'op-create',
};

const prismaMock = {
  externalOperation: {
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { operationUpdates.push(data); return { count: 1 }; }),
    findUnique: vi.fn(async ({ select }: { select?: Record<string, unknown> }) => select?.status
      ? { status: 'FAILED', leaseToken: null }
      : { id: 'op-late', provider: 'MICROSOFT_TEAMS', operation: 'TEAMS_SEND_CARD', status: 'PROCESSING', attempts: 1, incidentId: 'inc-1', requestPayload: { destinationId: 'dest-1', eventType: 'resolved', incidentUpdatedAt: incident.resolvedAt.toISOString() }, resultPayload: currentResultPayload }),
  },
  incident: { findUnique: vi.fn(async () => incident) },
  service: { findUnique: vi.fn(async () => ({ serviceNotificationChannels: ['MICROSOFT_TEAMS'], serviceNotifyOnTriggered: true, serviceNotifyOnAck: true, serviceNotifyOnResolved: true })) },
  microsoftTeamsDestination: { findUnique: vi.fn(async () => ({ id: 'dest-1', tenantId: 'tenant-1', teamId: 'team-1', channelId: 'channel-1', enabled: true, updatedAt: new Date(), serviceId: 'svc-1' })) },
  microsoftTeamsIncidentMessage: {
    findUnique: vi.fn(async () => ledger), updateMany: vi.fn(async () => ({ count: ledgerUpdateCount })),
  },
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    microsoftTeamsIncidentMessage: { findUnique: vi.fn(async () => ledger), updateMany: vi.fn(async () => ({ count: ledgerUpdateCount })) },
    externalOperation: { findUnique: vi.fn(async () => ownerOperation), updateMany: vi.fn(async () => ({ count: 1 })) },
  })),
};

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/db-locks', () => ({ acquireAdvisoryLock: vi.fn(async () => undefined) }));
vi.mock('@/lib/provider-admission', () => ({
  acquireProviderAdmission: vi.fn(async () => ({ allowed: true })),
  acquireProviderConcurrency: vi.fn(async () => ({ allowed: true, leaseKey: 'lease' })),
  releaseProviderConcurrency: vi.fn(async () => undefined), deferProviderAdmission: vi.fn(async () => undefined),
}));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreakerError: class extends Error {},
  CircuitBreakers: { microsoftTeams: () => ({ getState: () => 'CLOSED', execute: (fn: () => Promise<unknown>) => fn() }) },
}));
vi.mock('@/lib/microsoft-teams/provider', () => ({ microsoftTeamsChatProvider: { sendIncidentCard, createIncidentCard, updateIncidentCard, recoverIncidentCard } }));
vi.mock('@/lib/audit', () => ({ emitAuditEvent: vi.fn(async () => undefined) }));

describe('processMicrosoftTeamsOperation create fence', () => {
  beforeEach(() => {
    operationUpdates.length = 0;
    currentResultPayload = null;
    ledgerUpdateCount = 0;
    ownerOperation = { id: 'op-create', status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() + 60_000), resultPayload: { createAttempted: true } };
    Object.assign(ledger, { createState: 'AMBIGUOUS', createOperationId: 'op-create' });
    vi.clearAllMocks();
  });

  it('does not issue update or recovery create while a previous create is ambiguous', async () => {
    const { processMicrosoftTeamsOperation } = await import('@/lib/microsoft-teams/delivery');
    await expect(processMicrosoftTeamsOperation('op-late')).rejects.toThrow('requires create reconciliation');
    expect(sendIncidentCard).not.toHaveBeenCalled();
    expect(updateIncidentCard).not.toHaveBeenCalled();
    expect(recoverIncidentCard).not.toHaveBeenCalled();
    expect(operationUpdates).toContainEqual(expect.objectContaining({
      status: 'FAILED',
      resultPayload: expect.objectContaining({ blockedByCreateOperationId: 'op-create' }),
    }));
  });

  it('defers behind a live CREATING owner without issuing a provider call', async () => {
    Object.assign(ledger, { createState: 'CREATING', createOperationId: 'op-create' });
    const { processMicrosoftTeamsOperation } = await import('@/lib/microsoft-teams/delivery');
    await expect(processMicrosoftTeamsOperation('op-late')).rejects.toThrow('mutation is leased');
    expect(sendIncidentCard).not.toHaveBeenCalled();
    expect(updateIncidentCard).not.toHaveBeenCalled();
    expect(recoverIncidentCard).not.toHaveBeenCalled();
    expect(operationUpdates).toContainEqual(expect.objectContaining({ status: 'PENDING', attempts: { decrement: 1 } }));
  });

  it('turns a reclaimed same-operation CREATING fence into AMBIGUOUS without another POST', async () => {
    Object.assign(ledger, { createState: 'CREATING', createOperationId: 'op-late' });
    currentResultPayload = { createAttempted: true };
    ownerOperation = { id: 'op-late', status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() + 60_000), resultPayload: { createAttempted: true } };
    const { processMicrosoftTeamsOperation } = await import('@/lib/microsoft-teams/delivery');
    await expect(processMicrosoftTeamsOperation('op-late')).rejects.toThrow('requires create reconciliation');
    expect(sendIncidentCard).not.toHaveBeenCalled();
    expect(recoverIncidentCard).not.toHaveBeenCalled();
    expect(operationUpdates).toContainEqual(expect.objectContaining({ status: 'AMBIGUOUS' }));
  });

  it('safely resumes a same-operation CREATING fence when the worker died before provider I/O', async () => {
    Object.assign(ledger, { createState: 'CREATING', createOperationId: 'op-late' });
    ownerOperation = { id: 'op-late', status: 'PROCESSING', leaseExpiresAt: new Date(Date.now() + 60_000), resultPayload: null };
    ledgerUpdateCount = 1;
    createIncidentCard.mockImplementationOnce(async ({ beforeCreateAttempt }: { beforeCreateAttempt: () => Promise<void> }) => {
      await beforeCreateAttempt();
      throw new Error('provider path reached');
    });

    const { processMicrosoftTeamsOperation } = await import('@/lib/microsoft-teams/delivery');
    await expect(processMicrosoftTeamsOperation('op-late')).rejects.toThrow('provider path reached');

    expect(createIncidentCard).toHaveBeenCalledOnce();
    expect(operationUpdates).toContainEqual(expect.objectContaining({
      resultPayload: expect.objectContaining({ createAttempted: true }),
    }));
    expect(operationUpdates).not.toContainEqual(expect.objectContaining({ status: 'AMBIGUOUS' }));
  });

  it('fails closed when a CREATING fence has lost its owning operation', async () => {
    Object.assign(ledger, { createState: 'CREATING', createOperationId: 'missing-op' });
    ownerOperation = null;

    const { processMicrosoftTeamsOperation } = await import('@/lib/microsoft-teams/delivery');
    await expect(processMicrosoftTeamsOperation('op-late')).rejects.toThrow('requires create reconciliation');

    expect(createIncidentCard).not.toHaveBeenCalled();
    expect(operationUpdates).toContainEqual(expect.objectContaining({ status: 'FAILED' }));
  });
});
