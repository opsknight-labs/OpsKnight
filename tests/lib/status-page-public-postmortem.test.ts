import { describe, expect, it } from 'vitest';
import { serializePublicPostmortem } from '@/lib/status-pages/public-postmortem';

describe('public postmortem projection', () => {
  it('keeps customer-safe content and strips internal-only fields before the browser boundary', () => {
    const result = serializePublicPostmortem({
      title: 'Checkout outage review',
      summary: 'Checkout requests failed for a subset of users.',
      timeline: [
        {
          id: 'internal-event-1',
          timestamp: '2026-09-10T10:00:00.000Z',
          type: 'DETECTION',
          title: 'Detected',
          description: 'Error rate increased.',
          actor: 'Alice Responder',
        },
      ],
      impact: {
        usersAffected: 1200,
        downtimeMinutes: 18,
        errorRate: 12.5,
        servicesAffected: ['Checkout'],
        slaBreaches: 3,
        revenueImpact: 45000,
        apiErrors: 5000,
        performanceDegradation: 20,
      },
      rootCause: 'A bad deployment exhausted the connection pool.',
      resolution: 'Rolled back the deployment.',
      lessons: 'Add a connection-pool saturation alert.',
      status: 'PUBLISHED',
      isPublic: true,
      createdAt: new Date('2026-09-10T12:00:00.000Z'),
      publishedAt: new Date('2026-09-10T13:00:00.000Z'),
      incident: {
        id: 'incident-public-id',
        title: 'Checkout errors',
        resolvedAt: new Date('2026-09-10T10:18:00.000Z'),
      },
    });

    expect(result.id).toBe('incident-public-id');
    expect(result.createdBy).toEqual({
      id: 'public-incident-response-team',
      name: 'Incident Response Team',
      email: '',
    });
    expect(result.timeline).toEqual([
      {
        id: 'public-timeline-0',
        timestamp: '2026-09-10T10:00:00.000Z',
        type: 'DETECTION',
        title: 'Detected',
        description: 'Error rate increased.',
      },
    ]);
    expect(result.impact).toEqual({
      usersAffected: 1200,
      downtimeMinutes: 18,
      errorRate: 12.5,
      servicesAffected: ['Checkout'],
      apiErrors: 5000,
      performanceDegradation: 20,
    });
    expect(JSON.stringify(result)).not.toContain('Alice Responder');
    expect(JSON.stringify(result)).not.toContain('slaBreaches');
    expect(JSON.stringify(result)).not.toContain('revenueImpact');
    expect(JSON.stringify(result)).not.toContain('internal-event-1');
  });
});
