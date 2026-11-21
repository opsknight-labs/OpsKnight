import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  auditCreateMany: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    auditLog: { create: mocks.auditCreate, createMany: mocks.auditCreateMany },
    user: { findUnique: mocks.userFindUnique },
  },
}));

import { emitAuditEvent, emitSystemAuditEvents, logAudit } from '@/lib/audit';
import { runWithContext } from '@/lib/request-context';

describe('audit event contract', () => {
  it('batches system events with the same versioned and redacted audit contract', async () => {
    vi.clearAllMocks();
    await runWithContext({ requestId: 'batch-request' }, () =>
      emitSystemAuditEvents([
        {
          action: 'intelligence.group.automatic',
          source: 'SYSTEM',
          target: { type: 'SYSTEM_CONFIG', id: 'group-1' },
          occurredAt: new Date('2026-11-06T10:00:00Z'),
          metadata: { sourceId: 'incident-1', password: 'private-batch-secret' },
        },
        {
          action: 'intelligence.group.automatic',
          source: 'SYSTEM',
          target: { type: 'SYSTEM_CONFIG', id: 'group-1' },
          metadata: { sourceId: 'incident-2' },
        },
      ])
    );
    expect(mocks.auditCreateMany).toHaveBeenCalledOnce();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    const data = mocks.auditCreateMany.mock.calls[0][0].data;
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      actorId: null,
      actorEmail: null,
      actorName: null,
      details: {
        contractVersion: 1,
        source: 'SYSTEM',
        requestId: 'batch-request',
        occurredAt: '2026-11-06T10:00:00.000Z',
        actor: { type: 'SYSTEM', id: null, email: null, name: null },
        metadata: { sourceId: 'incident-1', password: '[REDACTED]' },
      },
    });
    expect(JSON.stringify(data)).not.toContain('private-batch-secret');
  });

  it('does not partially persist invalid or oversized system audit batches', async () => {
    vi.clearAllMocks();
    const event = {
      action: 'batch',
      source: 'SYSTEM' as const,
      target: { type: 'SYSTEM_CONFIG' as const },
    };
    await expect(
      emitSystemAuditEvents([event, { ...event, occurredAt: new Date(NaN) }])
    ).rejects.toThrow('Invalid audit timestamp');
    await expect(emitSystemAuditEvents(Array.from({ length: 501 }, () => event))).rejects.toThrow(
      'exceeds 500'
    );
    await emitSystemAuditEvents([]);
    expect(mocks.auditCreateMany).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auditCreate.mockResolvedValue({});
    mocks.userFindUnique.mockResolvedValue({ email: 'actor@example.com', name: 'Actor' });
  });

  it('writes actor, action, target, source, timestamp, request, and change values', async () => {
    await emitAuditEvent({
      action: 'incident.lifecycle.resolve',
      source: 'API',
      target: { type: 'SYSTEM_CONFIG', id: 'incident-1' },
      actor: { type: 'USER', id: 'user-1' },
      requestId: 'request-1',
      occurredAt: new Date('2026-08-28T10:00:00.000Z'),
      oldValue: { status: 'ACKNOWLEDGED' },
      newValue: { status: 'RESOLVED' },
      metadata: { reason: 'Recovered' },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'incident.lifecycle.resolve',
        entityType: 'SYSTEM_CONFIG',
        entityId: 'incident-1',
        actorId: 'user-1',
        actorEmail: 'actor@example.com',
        actorName: 'Actor',
        details: {
          contractVersion: 1,
          source: 'API',
          requestId: 'request-1',
          occurredAt: '2026-08-28T10:00:00.000Z',
          actor: {
            type: 'USER',
            id: 'user-1',
            email: 'actor@example.com',
            name: 'Actor',
          },
          target: { type: 'SYSTEM_CONFIG', id: 'incident-1' },
          oldValue: { status: 'ACKNOWLEDGED' },
          newValue: { status: 'RESOLVED' },
          metadata: { reason: 'Recovered' },
        },
      }),
    });
  });

  it('redacts sensitive values before persistence', async () => {
    await emitAuditEvent({
      action: 'integration.updated',
      source: 'UI',
      target: { type: 'SYSTEM_CONFIG', id: 'jira' },
      metadata: { apiToken: 'secret-token', nested: { password: 'secret-password' } },
    });

    const serialized = JSON.stringify(mocks.auditCreate.mock.calls[0]);
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-password');
    expect(serialized).toContain('[REDACTED]');
  });

  it('inherits the active request correlation id when none is supplied', async () => {
    await runWithContext({ requestId: 'request-from-middleware' }, () =>
      emitAuditEvent({
        action: 'incident.viewed',
        source: 'API',
        target: { type: 'SYSTEM_CONFIG', id: 'incident-1' },
      })
    );

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: expect.objectContaining({ requestId: 'request-from-middleware' }),
      }),
    });
  });

  it('adapts legacy logAudit calls into the versioned contract', async () => {
    await logAudit({
      action: 'USER_UPDATED',
      entityType: 'USER',
      entityId: 'user-2',
      actorId: 'user-1',
      details: { targetEmail: 'TARGET@EXAMPLE.COM', ip: '127.0.0.1' },
    });

    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetEmail: 'target@example.com',
        ip: '127.0.0.1',
        details: expect.objectContaining({
          source: 'UI',
          contractVersion: 1,
          targetEmail: 'target@example.com',
          ip: '127.0.0.1',
        }),
      }),
    });
  });

  it('rejects invalid timestamps before persistence', async () => {
    await expect(
      emitAuditEvent({
        action: 'invalid.time',
        source: 'SYSTEM',
        target: { type: 'SYSTEM_CONFIG' },
        occurredAt: new Date(Number.NaN),
      })
    ).rejects.toThrow(RangeError);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
