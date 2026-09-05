import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_HEALTH_GUIDES,
  calculateOperationalScore,
  overallStatus,
  generate24HourHistory,
  healthDurationLabel,
  CHECK_WEIGHTS,
  type AdminHealthCheck,
} from '@/lib/admin-health';

describe('health duration labels', () => {
  it('distinguishes missing evidence from a real zero-duration sample', () => {
    expect(healthDurationLabel(null)).toBe('no samples');
    expect(healthDurationLabel(undefined)).toBe('no samples');
    expect(healthDurationLabel(0)).toBe('0 ms');
  });

  it('makes severe latency readable without discarding precision', () => {
    expect(healthDurationLabel(26_989)).toBe('27.0 s');
    expect(healthDurationLabel(313_559)).toBe('5m 14s');
  });
});

describe('admin health guide links', () => {
  it('uses stable latest-channel routes that exist in both published v1.4 and v1.5 docs', () => {
    expect(ADMIN_HEALTH_GUIDES).toEqual({
      monitoring: 'https://opsknight.com/docs/latest/deployment/monitoring/',
      scalability: 'https://opsknight.com/docs/latest/core-concepts/scalability/',
      migrations: 'https://opsknight.com/docs/latest/deployment/database-migrations/',
      maintenance: 'https://opsknight.com/docs/latest/deployment/maintenance/',
      sla: 'https://opsknight.com/docs/latest/core-concepts/analytics/',
      encryption: 'https://opsknight.com/docs/latest/security/encryption/',
      upgrades: 'https://opsknight.com/docs/latest/deployment/upgrade-rollback/',
    });
  });
});

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findMany: vi.fn().mockResolvedValue([]) },
    backgroundJob: { findMany: vi.fn().mockResolvedValue([]) },
    inboundDelivery: { findMany: vi.fn().mockResolvedValue([]) },
    notificationDeliveryAttempt: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const mockBaseChecks: AdminHealthCheck[] = [
  {
    id: 'database',
    label: 'PostgreSQL Database',
    category: 'database',
    status: 'healthy',
    summary: 'PostgreSQL responded in 8 ms.',
    details: ['Connection check passed.'],
  },
  {
    id: 'database-capacity',
    label: 'Database capacity',
    category: 'database',
    status: 'healthy',
    summary: '15 of 100 connections in use (15%).',
    details: ['Active connections: 4'],
  },
  {
    id: 'migrations',
    label: 'Database migrations',
    category: 'database',
    status: 'healthy',
    summary: 'Packaged migrations match the database history.',
    details: ['Applied records: 28'],
  },
  {
    id: 'scheduler',
    label: 'Scheduler and workers',
    category: 'workers',
    status: 'healthy',
    summary: 'Last successful cycle 1 minute ago.',
    details: ['Lock holder: node-1'],
  },
  {
    id: 'jobs',
    label: 'Background jobs',
    category: 'workers',
    status: 'healthy',
    summary: '0 pending, 0 processing, 0 failed in 24 hours.',
    details: ['Overdue pending: 0'],
  },
  {
    id: 'sla-performance',
    label: 'SLA query performance',
    category: 'workers',
    status: 'healthy',
    summary: '23441 queries in 24 hours; p95 180 ms.',
    details: ['p50: 24 ms, average: 42 ms'],
  },
  {
    id: 'escalations',
    label: 'Escalation backlog',
    category: 'workers',
    status: 'healthy',
    summary: 'No escalation steps are overdue.',
    details: ['Overdue timers: 0'],
  },
  {
    id: 'paging-configuration',
    label: 'Paging configuration coverage',
    category: 'alerting',
    status: 'healthy',
    summary: 'All 8 services have an escalation policy.',
    details: ['Without policy: none'],
  },
  {
    id: 'notifications',
    label: 'Notification providers',
    category: 'alerting',
    status: 'healthy',
    summary: '3 enabled provider(s); 0 failed delivery records.',
    details: ['Pending: 0'],
  },
  {
    id: 'integrations',
    label: 'Inbound integrations',
    category: 'alerting',
    status: 'healthy',
    summary: '5 enabled integration(s); 0% error rate.',
    details: ['Integrations with errors: none'],
  },
  {
    id: 'public-url',
    label: 'Public URL',
    category: 'security',
    status: 'healthy',
    summary: 'Canonical origin: https://ops.example.com',
    details: ['Configured origins agree.'],
  },
  {
    id: 'encryption',
    label: 'Encryption configuration',
    category: 'security',
    status: 'healthy',
    summary: 'A valid 32-byte hexadecimal encryption key is configured.',
    details: ['Encryption key valid.'],
  },
  {
    id: 'version',
    label: 'Version and upgrades',
    category: 'platform',
    status: 'healthy',
    summary: 'Running 1.4.0; no newer stable release was found.',
    details: ['Version up to date.'],
  },
];

describe('calculateOperationalScore and weighted health logic', () => {
  it('returns 100% score and healthy status when all signals are healthy', () => {
    const result = calculateOperationalScore(mockBaseChecks);
    expect(result.scorePercent).toBe(100);
    expect(result.overall).toBe('healthy');
    expect(result.criticalIssues).toHaveLength(0);
    expect(result.warningIssues).toHaveLength(0);
  });

  it('calculates weighted score accurately when advisory SLA telemetry has high latency', () => {
    const checksWithSlowSla = mockBaseChecks.map(c =>
      c.id === 'sla-performance'
        ? {
            ...c,
            status: 'degraded' as const,
            summary: '23441 queries in 24 hours; p95 23512 ms.',
          }
        : c
    );

    const result = calculateOperationalScore(checksWithSlowSla);

    // Advisory check has weight 1 out of total 67.
    // Weighted score is 66.75 / 67 * 100 = 99.6%
    expect(result.scorePercent).toBeGreaterThanOrEqual(99);
    expect(result.overall).toBe('degraded');
    expect(result.criticalIssues).toHaveLength(0);
    expect(result.warningIssues).toHaveLength(1);
    expect(result.warningIssues[0].id).toBe('sla-performance');
  });

  it('marks overall as degraded (Operational with Warnings) for minor auxiliary issues without dropping score to 40%', () => {
    const checksWithMultipleAdvisories = mockBaseChecks.map(c => {
      if (c.id === 'sla-performance') return { ...c, status: 'degraded' as const };
      if (c.id === 'paging-configuration') return { ...c, status: 'degraded' as const };
      if (c.id === 'version') return { ...c, status: 'degraded' as const };
      return c;
    });

    const result = calculateOperationalScore(checksWithMultipleAdvisories);

    expect(result.scorePercent).toBeGreaterThan(95);
    expect(result.overall).toBe('degraded');
    expect(result.criticalIssues).toHaveLength(0);
    expect(result.warningIssues).toHaveLength(3);
  });

  it('marks overall as unhealthy when a critical infrastructure check fails', () => {
    const checksWithBrokenDb = mockBaseChecks.map(c =>
      c.id === 'database'
        ? {
            ...c,
            status: 'unhealthy' as const,
            summary: 'PostgreSQL is unavailable to this application instance.',
          }
        : c
    );

    const result = calculateOperationalScore(checksWithBrokenDb);

    expect(result.overall).toBe('unhealthy');
    expect(result.criticalIssues).toHaveLength(1);
    expect(result.criticalIssues[0].id).toBe('database');
  });

  it('treats missing evidence as uncertainty instead of silently passing it', () => {
    const checks = mockBaseChecks.map(check =>
      check.id === 'sla-performance' ? { ...check, status: 'unknown' as const } : check
    );
    const result = calculateOperationalScore(checks);

    expect(result.scorePercent).toBeLessThan(100);
    expect(result.overall).toBe('degraded');
    expect(result.warningIssues.some(check => check.id === 'sla-performance')).toBe(true);
  });

  it('does not degrade the cluster when an optional replica role is not running locally', () => {
    const result = calculateOperationalScore([
      ...mockBaseChecks,
      {
        id: 'worker-replica',
        label: 'Local durable-job worker',
        category: 'workers',
        status: 'unknown',
        required: false,
        summary: 'This web replica does not run the durable-job worker.',
        details: [],
      },
    ]);

    expect(result.overall).toBe('healthy');
    expect(result.warningIssues).toHaveLength(0);
  });

  it('treats informational deployment topology as known non-degrading evidence', () => {
    const result = calculateOperationalScore([
      ...mockBaseChecks,
      {
        id: 'worker-replica',
        label: 'Local durable-job worker',
        category: 'workers',
        status: 'informational',
        summary: 'Dedicated workers own durable jobs.',
        details: [],
      },
    ]);

    expect(result.scorePercent).toBe(100);
    expect(result.overall).toBe('healthy');
    expect(result.warningIssues).toHaveLength(0);
  });

  it('assigns higher weight to database, migrations, encryption, and scheduler than auxiliary checks', () => {
    expect(CHECK_WEIGHTS.database).toBe(10);
    expect(CHECK_WEIGHTS.migrations).toBe(10);
    expect(CHECK_WEIGHTS.encryption).toBe(10);
    expect(CHECK_WEIGHTS.scheduler).toBe(10);

    expect(CHECK_WEIGHTS['sla-performance']).toBe(1);
    expect(CHECK_WEIGHTS['paging-configuration']).toBe(1);
    expect(CHECK_WEIGHTS.version).toBe(1);
  });

  it('overallStatus matches calculateOperationalScore overall result', () => {
    expect(overallStatus(mockBaseChecks)).toBe('healthy');

    const degraded = mockBaseChecks.map(c =>
      c.id === 'sla-performance' ? { ...c, status: 'degraded' as const } : c
    );
    expect(overallStatus(degraded)).toBe('degraded');

    const unhealthy = mockBaseChecks.map(c =>
      c.id === 'database' ? { ...c, status: 'unhealthy' as const } : c
    );
    expect(overallStatus(unhealthy)).toBe('unhealthy');
  });
});

describe('generate24HourHistory', () => {
  it('generates 24 hourly samples with healthy baselines for peaceful periods', async () => {
    const now = new Date('2026-09-05T12:00:00.000Z');
    const samples = await generate24HourHistory(mockBaseChecks, 'healthy', now);

    expect(samples).toHaveLength(24);
    expect(samples.every(s => s.status === 'healthy')).toBe(true);
    expect(samples.every(s => s.scorePercent === 100)).toBe(true);
    const expectedHour = `${now.getHours().toString().padStart(2, '0')}:00`;
    expect(samples[23].hourLabel).toBe(expectedHour);
  });

  it('reflects live advisory degradation in current hour without painting all 24 prior hours red', async () => {
    const checksWithSlowSla = mockBaseChecks.map(c =>
      c.id === 'sla-performance'
        ? {
            ...c,
            status: 'degraded' as const,
            summary: '23441 queries in 24 hours; p95 23512 ms.',
          }
        : c
    );
    const now = new Date('2026-09-05T12:00:00.000Z');
    const samples = await generate24HourHistory(checksWithSlowSla, 'degraded', now);

    expect(samples).toHaveLength(24);
    // Current hour (samples[23]) is live hour with degraded status and ~99.6% score
    expect(samples[23].status).toBe('degraded');
    expect(samples[23].scorePercent).toBeGreaterThanOrEqual(99);

    // Prior 23 hours remain 100% healthy
    const priorHours = samples.slice(0, 23);
    expect(priorHours.every(s => s.status === 'healthy')).toBe(true);
    expect(priorHours.every(s => s.scorePercent === 100)).toBe(true);
  });

  it('does not classify customer incidents as OpsKnight platform-health failures', async () => {
    const prisma = (await import('@/lib/prisma')).default;
    const now = new Date('2026-09-05T12:00:00.000Z');

    // Simulate prisma.incident returning only items within the 24-hour query where clause
    vi.mocked(prisma.incident.findMany).mockResolvedValueOnce([
      {
        id: 'inc-recent',
        title: 'Recent P3 alert',
        priority: 'P3',
        status: 'RESOLVED',
        createdAt: new Date('2026-09-05T10:15:00.000Z'),
        resolvedAt: new Date('2026-09-05T10:45:00.000Z'),
      },
    ] as unknown as never);

    const samples = await generate24HourHistory(mockBaseChecks, 'healthy', now);
    expect(samples).toHaveLength(24);

    expect(samples.every(s => s.status === 'healthy')).toBe(true);
    expect(samples.every(s => s.scorePercent === 100)).toBe(true);
    expect(prisma.incident.findMany).not.toHaveBeenCalled();
  });
});
