import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockPerformDataCleanup } = vi.hoisted(() => ({
  mockPerformDataCleanup: vi.fn().mockResolvedValue({
    incidents: 3,
    alerts: 5,
    logs: 0,
    metrics: 12,
    events: 8,
    auditLogs: 0,
    inAppNotifications: 0,
    slaPerformanceLogs: 0,
    executionTimeMs: 15,
    dryRun: true,
  }),
}));

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'usr-admin-1', role: 'ADMIN' }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/data-cleanup', () => ({
  performDataCleanup: (...args: unknown[]) => mockPerformDataCleanup(...args),
  getStorageStats: vi.fn(),
}));

vi.mock('@/lib/retention-policy', () => ({
  getRetentionPolicy: vi.fn(),
  updateRetentionPolicy: vi.fn(),
}));

import { POST } from '@/app/api/settings/retention/route';

describe('POST /api/settings/retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes policyOverride to performDataCleanup when policy is sent in body', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dryRun: true,
        policy: {
          incidentRetentionDays: 90,
          alertRetentionDays: 30,
          logRetentionDays: 30,
          metricsRetentionDays: 90,
        },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.dryRun).toBe(true);

    expect(mockPerformDataCleanup).toHaveBeenCalledWith(true, {
      incidentRetentionDays: 90,
      alertRetentionDays: 30,
      logRetentionDays: 30,
      metricsRetentionDays: 90,
    });
  });

  it('defaults dryRun to true when not explicitly false and operates without policy', async () => {
    const req = new NextRequest('http://localhost:3000/api/settings/retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockPerformDataCleanup).toHaveBeenCalledWith(true, undefined);
  });
});
