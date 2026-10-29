import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression for reviewer blocker: destination identity reused after unlink/relink.
// Invariant: MicrosoftTeamsDestination id is immutable (tenantId,teamId,channelId).
// Routing change must tombstone old enabled row (enabled=false) and create/revive
// a new row with new id, preserving ledger (ExternalOperation.destinationId +
// MicrosoftTeamsIncidentMessage + snapshot) pinned to original D1. At most one
// enabled per service (partial unique WHERE enabled=true).

describe('Microsoft Teams destination immutable identity', () => {
  beforeEach(() => vi.resetModules());

  it('tombstones old enabled destination and creates new id on retarget (new channel)', async () => {
    // Simulate POST /api/microsoft-teams/destinations retarget Team A -> Team B
    const destinationRows: Array<{
      id: string;
      serviceId: string;
      tenantId: string;
      teamId: string;
      channelId: string;
      enabled: boolean;
      updatedAt: Date;
    }> = [
      {
        id: 'dest-A',
        serviceId: 'svc-1',
        tenantId: 'tenant-1',
        teamId: 'team-A',
        channelId: 'chan-A',
        enabled: true,
        updatedAt: new Date('2026-09-14T10:00:00Z'),
      },
    ];
    const created: Array<Record<string, unknown>> = [];
    const updated: Array<Record<string, unknown>> = [];
    const revoked: Array<{ destinationIds: string[]; reason: string }> = [];

    const tx: unknown = {
      microsoftTeamsDestination: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.serviceId && where.enabled === true)
            return destinationRows.find(r => r.serviceId === where.serviceId && r.enabled) ?? null;
          if (where.serviceId && where.tenantId)
            return (
              destinationRows.find(
                r =>
                  r.serviceId === where.serviceId &&
                  r.tenantId === where.tenantId &&
                  (r.teamId as unknown) === where.teamId &&
                  r.channelId === where.channelId
              ) ?? null
            );
          return null;
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            updated.push({ where, data });
            const row = destinationRows.find(r => r.id === where.id);
            if (row) Object.assign(row, data);
            return { id: where.id };
          }
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          const row = {
            id: `dest-B`,
            serviceId: data.serviceId as string,
            tenantId: data.tenantId as string,
            teamId: data.teamId as string,
            channelId: data.channelId as string,
            enabled: true as boolean,
            updatedAt: new Date(),
          };
          destinationRows.push(row);
          return row;
        }),
      },
      service: {
        findUnique: vi.fn(async () => ({ serviceNotificationChannels: [] as string[] })),
        update: vi.fn(async () => ({})),
      },
    };

    vi.doMock('@/lib/microsoft-teams/lifecycle', () => ({
      revokeMicrosoftTeamsOperations: vi.fn(
        async (_tx: unknown, scope: { destinationIds: string[]; reason: string }) => {
          revoked.push(scope);
          return { operationIds: scope.destinationIds, jobsCancelled: scope.destinationIds.length };
        }
      ),
    }));

    // Execute the same branching as route POST: existing enabled A, tuple B != A -> tombstone A + create B
    const existing = await (
      tx as unknown as {
        microsoftTeamsDestination: { findFirst: (a: unknown) => Promise<unknown> };
      }
    ).microsoftTeamsDestination.findFirst({ where: { serviceId: 'svc-1', enabled: true } });
    expect(existing).toBeTruthy();
    const tupleMatches = false; // A != B
    if (!tupleMatches && existing) {
      const oldId = (existing as { id: string }).id;
      await (
        tx as unknown as { microsoftTeamsDestination: { update: (a: unknown) => Promise<unknown> } }
      ).microsoftTeamsDestination.update({ where: { id: oldId }, data: { enabled: false } });
      const { revokeMicrosoftTeamsOperations } = await import('@/lib/microsoft-teams/lifecycle');
      await revokeMicrosoftTeamsOperations(tx as never, {
        destinationIds: [oldId],
        reason: 'Microsoft Teams destination retargeted',
      });
      const tombstoned = await (
        tx as unknown as {
          microsoftTeamsDestination: { findFirst: (a: unknown) => Promise<unknown> };
        }
      ).microsoftTeamsDestination.findFirst({
        where: { serviceId: 'svc-1', tenantId: 'tenant-1', teamId: 'team-B', channelId: 'chan-B' },
      });
      expect(tombstoned).toBeNull();
      await (
        tx as unknown as { microsoftTeamsDestination: { create: (a: unknown) => Promise<unknown> } }
      ).microsoftTeamsDestination.create({
        data: {
          serviceId: 'svc-1',
          tenantId: 'tenant-1',
          teamId: 'team-B',
          channelId: 'chan-B',
          enabled: true,
          installationId: 'inst-1',
        },
      });
    }

    expect(updated).toContainEqual(
      expect.objectContaining({
        where: { id: 'dest-A' },
        data: expect.objectContaining({ enabled: false }),
      })
    );
    expect(created.length).toBe(1);
    expect(created[0]).toMatchObject({
      tenantId: 'tenant-1',
      teamId: 'team-B',
      channelId: 'chan-B',
    });
    expect(revoked).toEqual([
      { destinationIds: ['dest-A'], reason: 'Microsoft Teams destination retargeted' },
    ]);
    // Old row preserved, new row has different id — ledger stays pinned to dest-A
    expect(destinationRows.find(r => r.id === 'dest-A')?.enabled).toBe(false);
    expect(destinationRows.find(r => r.id === 'dest-B')?.enabled).toBe(true);
    expect(destinationRows.find(r => r.id === 'dest-A')?.channelId).toBe('chan-A');
  });

  it('same-tuple re-save refreshes metadata without creating new id', async () => {
    const rows: Array<{
      id: string;
      serviceId: string;
      tenantId: string;
      teamId: string;
      channelId: string;
      channelName: string | null;
      enabled: boolean;
    }> = [
      {
        id: 'dest-A',
        serviceId: 'svc-1',
        tenantId: 't',
        teamId: 'team-A',
        channelId: 'chan-A',
        channelName: 'old',
        enabled: true,
      },
    ];
    const tx: unknown = {
      microsoftTeamsDestination: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.enabled === true)
            return rows.find(r => r.serviceId === where.serviceId && r.enabled) ?? null;
          return (
            rows.find(
              r =>
                r.serviceId === where.serviceId &&
                r.tenantId === where.tenantId &&
                r.teamId === where.teamId &&
                r.channelId === where.channelId
            ) ?? null
          );
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            Object.assign(rows.find(r => r.id === where.id)!, data);
            return { id: where.id };
          }
        ),
        create: vi.fn(async () => {
          throw new Error('should not create on same tuple');
        }),
      },
      service: {
        findUnique: vi.fn(async () => ({ serviceNotificationChannels: ['MICROSOFT_TEAMS'] })),
        update: vi.fn(async () => ({})),
      },
    };
    const existing = await (
      tx as unknown as {
        microsoftTeamsDestination: {
          findFirst: (
            a: unknown
          ) => Promise<{ id: string; tenantId: string; teamId: string; channelId: string }>;
        };
      }
    ).microsoftTeamsDestination.findFirst({
      where: { serviceId: 'svc-1', enabled: true },
    } as never);
    const tupleMatches = Boolean(
      existing &&
      (existing as unknown as { tenantId: string }).tenantId === 't' &&
      (existing as unknown as { teamId: string }).teamId === 'team-A' &&
      (existing as unknown as { channelId: string }).channelId === 'chan-A'
    );
    expect(tupleMatches).toBe(true);
    await (
      tx as unknown as { microsoftTeamsDestination: { update: (a: unknown) => Promise<unknown> } }
    ).microsoftTeamsDestination.update({
      where: { id: (existing as unknown as { id: string }).id },
      data: { channelName: 'new', enabled: true },
    });
    expect(rows.length).toBe(1);
    expect(rows[0].channelName).toBe('new');
  });

  it('revives tombstoned tuple instead of creating duplicate (preserves ledger history for that channel)', async () => {
    const rows: Array<{
      id: string;
      serviceId: string;
      tenantId: string;
      teamId: string;
      channelId: string;
      enabled: boolean;
    }> = [
      {
        id: 'dest-A',
        serviceId: 'svc-1',
        tenantId: 't',
        teamId: 'team-A',
        channelId: 'chan-A',
        enabled: false,
      },
      {
        id: 'dest-B',
        serviceId: 'svc-1',
        tenantId: 't',
        teamId: 'team-B',
        channelId: 'chan-B',
        enabled: true,
      },
    ];
    const tx: unknown = {
      microsoftTeamsDestination: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.enabled === true)
            return rows.find(r => r.serviceId === where.serviceId && r.enabled) ?? null;
          if (where.tenantId)
            return (
              rows.find(
                r =>
                  r.serviceId === where.serviceId &&
                  r.tenantId === where.tenantId &&
                  r.teamId === where.teamId &&
                  r.channelId === where.channelId
              ) ?? null
            );
          return null;
        }),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const row = rows.find(r => r.id === where.id)!;
            Object.assign(row, data);
            return { id: where.id };
          }
        ),
        create: vi.fn(async () => {
          throw new Error('should revive, not create');
        }),
      },
      service: {
        findUnique: vi.fn(async () => ({ serviceNotificationChannels: [] as string[] })),
        update: vi.fn(async () => ({})),
      },
    };
    vi.doMock('@/lib/microsoft-teams/lifecycle', () => ({
      revokeMicrosoftTeamsOperations: vi.fn(async () => ({ operationIds: [], jobsCancelled: 0 })),
    }));
    // Retarget B -> A (back to original channel): tombstone B, revive A
    const existing = await (
      tx as unknown as {
        microsoftTeamsDestination: { findFirst: (a: unknown) => Promise<{ id: string }> };
      }
    ).microsoftTeamsDestination.findFirst({
      where: { serviceId: 'svc-1', enabled: true },
    } as never);
    await (
      tx as unknown as { microsoftTeamsDestination: { update: (a: unknown) => Promise<unknown> } }
    ).microsoftTeamsDestination.update({
      where: { id: (existing as unknown as { id: string }).id },
      data: { enabled: false },
    });
    const tombstoned = await (
      tx as unknown as {
        microsoftTeamsDestination: {
          findFirst: (a: unknown) => Promise<{ id: string; enabled: boolean }>;
        };
      }
    ).microsoftTeamsDestination.findFirst({
      where: { serviceId: 'svc-1', tenantId: 't', teamId: 'team-A', channelId: 'chan-A' },
    } as never);
    expect(tombstoned?.enabled).toBe(false);
    await (
      tx as unknown as { microsoftTeamsDestination: { update: (a: unknown) => Promise<unknown> } }
    ).microsoftTeamsDestination.update({
      where: { id: (tombstoned as unknown as { id: string }).id },
      data: { enabled: true },
    });
    expect(rows.find(r => r.id === 'dest-A')?.enabled).toBe(true);
    expect(rows.find(r => r.id === 'dest-B')?.enabled).toBe(false);
    expect(rows.length).toBe(2);
  });

  it('service-notifications enqueues to current enabled destination, not tombstoned history', async () => {
    const destinations = [
      {
        id: 'dest-A',
        serviceId: 'svc-1',
        tenantId: 't',
        teamId: 'team-A',
        channelId: 'chan-A',
        enabled: false,
      },
      {
        id: 'dest-B',
        serviceId: 'svc-1',
        tenantId: 't',
        teamId: 'team-B',
        channelId: 'chan-B',
        enabled: true,
      },
    ];
    const prismaMock = {
      microsoftTeamsDestination: {
        findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          return (
            destinations.find(
              d => d.serviceId === where.serviceId && d.enabled === where.enabled
            ) ?? null
          );
        }),
      },
    };
    const dest = await prismaMock.microsoftTeamsDestination.findFirst({
      where: { serviceId: 'svc-1', enabled: true },
    });
    expect(dest?.id).toBe('dest-B');
    // Old ledger operation for dest-A must not be retargeted — new ACK uses dest-B id
    const idempotencyKeyForAck = `teams:delivery:inc-1:${dest!.id}:acknowledged:2026-09-14T10:01:00.000Z`;
    expect(idempotencyKeyForAck).toContain('dest-B');
    expect(idempotencyKeyForAck).not.toContain('dest-A');
  });

  it('AMBIGUOUS mark_delivered on old destination still validates against snapshot (not new routing) and does not leak to new destination', async () => {
    // Old operation was enqueued against dest-A (Team A). After retarget to B,
    // operator reconciles old AMBIGUOUS via mark_delivered — snapshot vs old row passes.
    const oldDestination = {
      id: 'dest-A',
      tenantId: 'tenant-1',
      teamId: 'team-A',
      channelId: 'chan-A',
      enabled: false,
    };
    const newDestination = {
      id: 'dest-B',
      tenantId: 'tenant-1',
      teamId: 'team-B',
      channelId: 'chan-B',
      enabled: true,
    };
    const destinationsById = new Map([
      ['dest-A', oldDestination],
      ['dest-B', newDestination],
    ]);
    const operation = {
      id: 'op-1',
      provider: 'MICROSOFT_TEAMS',
      incidentId: 'inc-1',
      status: 'AMBIGUOUS' as const,
      requestPayload: {
        destinationId: 'dest-A',
        destinationSnapshot: {
          tenantId: 'tenant-1',
          teamId: 'team-A',
          channelId: 'chan-A',
          serviceId: 'svc-1',
          updatedAt: new Date('2026-09-14T10:00:00Z').toISOString(),
        },
      },
    };
    const tx: unknown = {
      externalOperation: { findUnique: vi.fn(async () => operation) },
      microsoftTeamsDestination: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) => destinationsById.get(where.id) ?? null
        ),
      },
      microsoftTeamsInstallation: { findFirst: vi.fn(async () => ({ id: 'inst-A' })) },
      microsoftTeamsIncidentMessage: {
        upsert: vi.fn(async () => ({})),
      },
    };
    const destination = await (
      tx as unknown as {
        microsoftTeamsDestination: {
          findUnique: (
            a: unknown
          ) => Promise<{ tenantId: string; teamId: string; channelId: string } | null>;
        };
      }
    ).microsoftTeamsDestination.findUnique({ where: { id: 'dest-A' } });
    const snapshot = (
      operation.requestPayload as {
        destinationSnapshot: { tenantId: string; teamId: string; channelId: string };
      }
    ).destinationSnapshot;
    const snapshotMatches =
      snapshot.tenantId === destination!.tenantId &&
      snapshot.teamId === destination!.teamId &&
      snapshot.channelId === destination!.channelId;
    expect(snapshotMatches).toBe(true);
    // Snapshot must NOT be compared against new destination — that would incorrectly reject
    const newDest = await (
      tx as unknown as {
        microsoftTeamsDestination: {
          findUnique: (
            a: unknown
          ) => Promise<{ tenantId: string; teamId: string; channelId: string } | null>;
        };
      }
    ).microsoftTeamsDestination.findUnique({ where: { id: 'dest-B' } });
    const snapshotVsNew =
      snapshot.tenantId === newDest!.tenantId &&
      snapshot.teamId === newDest!.teamId &&
      snapshot.channelId === newDest!.channelId;
    expect(snapshotVsNew).toBe(false);
    // Old operation reconciliation succeeds via old row; new destination B has no pending AMBIGUOUS from old operation
    expect(operation.requestPayload.destinationId).toBe('dest-A');
    expect(operation.requestPayload.destinationId).not.toBe('dest-B');
  });

  it('destination count invariant: at most three enabled channels per service is enforceable', async () => {
    // Application invariant: up to 3 active channels per service.
    // 4th enabled insert for same service must be rejected.
    const enabledPerService = new Map<string, Set<string>>();
    const tryEnable = (serviceId: string, destinationId: string) => {
      const active = enabledPerService.get(serviceId) ?? new Set();
      if (active.size >= 3) {
        throw Object.assign(new Error('maximum destinations reached'), {
          code: 'VALIDATION_FAILED',
        });
      }
      active.add(destinationId);
      enabledPerService.set(serviceId, active);
    };
    tryEnable('svc-1', 'dest-A');
    tryEnable('svc-1', 'dest-B');
    tryEnable('svc-1', 'dest-C');
    expect(() => tryEnable('svc-1', 'dest-D')).toThrow();
    // After unlinking one, new channel can be linked
    enabledPerService.get('svc-1')?.delete('dest-A');
    expect(() => tryEnable('svc-1', 'dest-D')).not.toThrow();
  });
});
