import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ incidents: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { incident: { findMany: mocks.incidents } } }));
import { getWidgetRealtimeProjection } from '@/lib/widget-data-provider';

beforeEach(() => {
  mocks.incidents.mockResolvedValue([
    {
      id: 'protected',
      title: 'Customer ABC123 payment failure',
      status: 'OPEN',
      urgency: 'HIGH',
      createdAt: new Date(),
      acknowledgedAt: null,
      resolvedAt: null,
      serviceId: 'service',
      assigneeId: null,
      service: { name: 'Payments' },
      automationDecision: { incidentId: 'protected' },
      automationTraces: [],
    },
    {
      id: 'ordinary',
      title: 'Ordinary operational incident',
      status: 'OPEN',
      urgency: 'LOW',
      createdAt: new Date(),
      acknowledgedAt: null,
      resolvedAt: null,
      serviceId: 'service',
      assigneeId: null,
      service: { name: 'Payments' },
      automationDecision: null,
      automationTraces: [],
    },
  ]);
});

it('redacts dashboard source titles while preserving ordinary incident visibility', async () => {
  const restricted = await getWidgetRealtimeProjection({}, false);
  expect(JSON.stringify(restricted)).not.toContain('ABC123');
  expect(restricted.activeIncidents[0].title).toBe('Restricted alert content');
  expect(restricted.activeIncidents[1].title).toBe('Ordinary operational incident');
  const privileged = await getWidgetRealtimeProjection({}, true);
  expect(privileged.activeIncidents[0].title).toContain('ABC123');
});
