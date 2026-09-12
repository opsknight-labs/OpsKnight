import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// Hoisted mocks — vi.mock is hoisted so use vi.hoisted for shared state
const mocks = vi.hoisted(() => ({
  getUserPermissions: vi.fn(),
  logAudit: vi.fn().mockResolvedValue(undefined),
  prisma: {
    systemConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    notificationProviderCapacity: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    notificationRuntimeSettings: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const admin = { id: 'admin-1', authenticated: true, capabilities: ['admin.manage'], role: 'ADMIN' as const };

vi.mock('@/lib/rbac', () => ({ getUserPermissions: mocks.getUserPermissions }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/notification-capacity-control', () => ({ invalidateNotificationCapacityControl: vi.fn() }));
vi.mock('@/lib/notification-capacity/cache', () => ({
  invalidateCapacityCache: vi.fn(),
  invalidateRuntimeCache: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ __esModule: true, default: mocks.prisma }));

import { PATCH, GET } from '@/app/api/admin/notifications/capacity/route';

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('https://example.com/api/admin/notifications/capacity', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', { code: 'P2002', clientVersion: 'test' });
}

describe('notification capacity control plane — API regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserPermissions.mockResolvedValue(admin);
    // Default: no existing row
    mocks.prisma.notificationProviderCapacity.findUnique.mockResolvedValue(null);
    mocks.prisma.notificationRuntimeSettings.findUnique.mockResolvedValue(null);
    mocks.prisma.systemConfig.findUnique.mockResolvedValue(null);
    // $transaction default: execute callback with a tx-like object
    mocks.prisma.$transaction.mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') {
        const tx = {
          notificationProviderCapacity: mocks.prisma.notificationProviderCapacity,
          notificationRuntimeSettings: mocks.prisma.notificationRuntimeSettings,
          systemConfig: mocks.prisma.systemConfig,
        };
        return cb(tx);
      }
      return Promise.all(cb);
    });
  });

  it('DB runtime CAS: stale revision in TX yields 409 (not silent overwrite)', async () => {
    const existing = {
      id: 'default',
      bulkQueueLowWatermark: 5000,
      bulkQueueHighWatermark: 25000,
      defaultBulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 5,
      updatedAt: new Date(),
    };
    mocks.prisma.notificationRuntimeSettings.findUnique.mockResolvedValue(existing);
    // Simulate concurrent writer: updateMany affected 0 rows => CAS_CONFLICT
    mocks.prisma.notificationRuntimeSettings.updateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(
      jsonRequest({ bulkQueueLowWatermark: 6000, bulkQueueHighWatermark: 30000, defaultBulkSharePercent: 80, adaptiveBackpressure: true, revision: 5 })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/changed elsewhere/i);
  });

  it('second runtime save without reload uses updated revision (no stale currentRevision)', async () => {
    const row = {
      id: 'default',
      bulkQueueLowWatermark: 5000,
      bulkQueueHighWatermark: 25000,
      defaultBulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 5,
      updatedAt: new Date(),
    };
    mocks.prisma.notificationRuntimeSettings.findUnique.mockResolvedValue(row);
    mocks.prisma.notificationRuntimeSettings.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.notificationRuntimeSettings.findUniqueOrThrow.mockResolvedValue({ revision: 6, updatedAt: new Date() });

    const res = await PATCH(
      jsonRequest({ bulkQueueLowWatermark: 6000, bulkQueueHighWatermark: 30000, defaultBulkSharePercent: 80, adaptiveBackpressure: true, revision: 5 })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.revision ?? body.revision).toBe(6);
    // Overview component would now hold currentRevision=6, so next save would send revision:6
    // Simulate next save with wrong old rev still rejected:
    mocks.prisma.notificationRuntimeSettings.findUnique.mockResolvedValue({ ...row, revision: 6 });
    mocks.prisma.notificationRuntimeSettings.updateMany.mockResolvedValue({ count: 0 });
    const stale = await PATCH(
      jsonRequest({ bulkQueueLowWatermark: 7000, bulkQueueHighWatermark: 30000, defaultBulkSharePercent: 80, adaptiveBackpressure: true, revision: 5 })
    );
    expect(stale.status).toBe(409);
  });

  it('provider first-create race (P2002 inside TX) surfaces as 409 CAS', async () => {
    mocks.prisma.notificationProviderCapacity.findUnique.mockResolvedValue(null);
    mocks.prisma.notificationProviderCapacity.create.mockRejectedValue(p2002());

    const res = await PATCH(
      jsonRequest({ provider: 'ses', channel: 'EMAIL', mode: 'CUSTOM', ratePerSecond: 100, maxInFlight: 20, bulkSharePercent: 80, adaptiveBackpressure: true })
    );
    expect(res.status).toBe(409);
  });

  it('provider CAS conflict via updateMany count 0 surfaces as 409', async () => {
    mocks.prisma.notificationProviderCapacity.findUnique.mockResolvedValue({
      provider: 'ses',
      channel: 'EMAIL',
      mode: 'CUSTOM',
      ratePerSecond: 100,
      maxInFlight: 20,
      bulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 3,
      updatedAt: new Date(),
    });
    mocks.prisma.notificationProviderCapacity.updateMany.mockResolvedValue({ count: 0 });

    const res = await PATCH(
      jsonRequest({ provider: 'ses', channel: 'EMAIL', mode: 'CUSTOM', ratePerSecond: 200, maxInFlight: 30, bulkSharePercent: 75, adaptiveBackpressure: false, revision: 3 })
    );
    expect(res.status).toBe(409);
  });

  it('audit failure rolls back (update is inside same $transaction as logAudit)', async () => {
    const existing = {
      provider: 'ses',
      channel: 'EMAIL',
      mode: 'CUSTOM',
      ratePerSecond: 100,
      maxInFlight: 20,
      bulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 3,
      updatedAt: new Date(),
    };
    mocks.prisma.notificationProviderCapacity.findUnique.mockResolvedValue(existing as any);
    mocks.prisma.notificationProviderCapacity.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.notificationProviderCapacity.findUniqueOrThrow.mockResolvedValue({ revision: 4, updatedAt: new Date() });
    // Audit throws inside TX => TX should reject and route should not return 200
    mocks.logAudit.mockRejectedValueOnce(new Error('audit down'));
    mocks.prisma.$transaction.mockImplementationOnce(async (cb: any) => {
      const tx = {
        notificationProviderCapacity: mocks.prisma.notificationProviderCapacity,
        notificationRuntimeSettings: mocks.prisma.notificationRuntimeSettings,
        systemConfig: mocks.prisma.systemConfig,
      };
      return cb(tx);
    });

    await expect(
      PATCH(jsonRequest({ provider: 'ses', channel: 'EMAIL', mode: 'CUSTOM', ratePerSecond: 110, maxInFlight: 21, bulkSharePercent: 80, adaptiveBackpressure: true, revision: 3 }))
    ).rejects.toThrow(/audit down/);
  });

  it('requires revision when row exists (prevents blind overwrite)', async () => {
    mocks.prisma.notificationProviderCapacity.findUnique.mockResolvedValue({
      provider: 'twilio',
      channel: 'SMS',
      mode: 'CUSTOM',
      ratePerSecond: 50,
      maxInFlight: 10,
      bulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 2,
      updatedAt: new Date(),
    });
    const res = await PATCH(
      jsonRequest({ provider: 'twilio', channel: 'SMS', mode: 'CUSTOM', ratePerSecond: 60, maxInFlight: 12, bulkSharePercent: 80, adaptiveBackpressure: true })
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/revision is required/i);
  });

  it('GET returns revision for provider capacities', async () => {
    mocks.getUserPermissions.mockResolvedValue(admin);
    mocks.prisma.systemConfig.findUnique.mockResolvedValue({ value: { bulkPaused: false } } as any);
    mocks.prisma.notificationRuntimeSettings.findUnique.mockResolvedValue({
      id: 'default',
      bulkQueueLowWatermark: 5000,
      bulkQueueHighWatermark: 25000,
      defaultBulkSharePercent: 80,
      adaptiveBackpressure: true,
      revision: 7,
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    } as any);
    mocks.prisma.notificationProviderCapacity.findMany.mockResolvedValue([
      {
        provider: 'ses',
        channel: 'EMAIL',
        mode: 'CUSTOM',
        ratePerSecond: 100,
        maxInFlight: 20,
        bulkSharePercent: 80,
        adaptiveBackpressure: true,
        revision: 4,
        updatedAt: new Date(),
      },
    ] as any);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.runtime?.revision ?? body.runtime?.revision).toBe(7);
    const cap = (body.data?.providerCapacities ?? body.providerCapacities)[0];
    expect(cap.revision).toBe(4);
  });

  it('branches on code, not message text (error-contract invariant)', async () => {
    const src = await import('node:fs').then(m => m.readFileSync('src/app/api/admin/notifications/capacity/route.ts', 'utf8'));
    expect(src).not.toContain('e.message === \'CAS_CONFLICT\'');
    expect(src).not.toContain('e.message === "CAS_CONFLICT"');
    expect(src).toContain("code === 'CAS_CONFLICT'");
  });
});
