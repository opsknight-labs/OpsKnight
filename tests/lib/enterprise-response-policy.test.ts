import { describe, expect, it, vi } from 'vitest';
import { resolveIncidentClassification } from '@/lib/incidents/classification';
import { escalationConditionsMatch } from '@/lib/escalation/conditions';
import { resolveIncidentEngagement } from '@/lib/incidents/engagement';
import { deriveNewIncidentSlaTransition } from '@/lib/incident-sla/next-transition';
import { resolveSupportHours } from '@/lib/incidents/support-hours';

function policy(scopeKey: string, version: number, rule: Record<string, unknown>, derive = false) {
  return {
    id: `${scopeKey}-v${version}`,
    scopeKey,
    version,
    inheritWorkspace: scopeKey !== 'workspace',
    derivePriorityFromUrgency: derive,
    createdAt: new Date(),
    createdById: null,
    sealedAt: new Date(),
    rules: [
      {
        id: `${scopeKey}-rule`,
        policyId: `${scopeKey}-v${version}`,
        matchType: 'ALERT_SEVERITY',
        matchValue: 'warning',
        label: null,
        priority: null,
        urgency: null,
        priorityMode: 'INHERIT',
        urgencyMode: 'INHERIT',
        ...rule,
      },
    ],
  };
}

describe('enterprise response-policy contract', () => {
  it('resolves priority and urgency independently across integration, service and workspace', async () => {
    const policies = [
      policy('integration:i1', 4, { priorityMode: 'SET', priority: 'P1' }),
      policy('service:s1', 7, { urgencyMode: 'SET', urgency: 'HIGH' }),
      policy('workspace', 12, {
        priorityMode: 'SET',
        priority: 'P4',
        urgencyMode: 'SET',
        urgency: 'MEDIUM',
      }),
    ];
    const tx = {
      incidentClassificationPolicy: {
        findFirst: vi.fn(({ where: { scopeKey } }) =>
          Promise.resolve(policies.find(candidate => candidate.scopeKey === scopeKey) ?? null)
        ),
      },
    };
    const result = await resolveIncidentClassification(tx as never, {
      serviceId: 's1',
      integrationId: 'i1',
      alertSeverity: 'warning',
    });
    expect(result.priority).toBe('P1');
    expect(result.priorityProvenance).toMatchObject({ scope: 'integration:i1', policyVersion: 4 });
    expect(result.urgency).toBe('HIGH');
    expect(result.urgencyProvenance).toMatchObject({ scope: 'service:s1', policyVersion: 7 });
  });

  it('treats CLEAR as terminal and never recreates priority through urgency fallback', async () => {
    const policies = [
      policy('service:s1', 2, { priorityMode: 'CLEAR', urgencyMode: 'INHERIT' }),
      policy(
        'workspace',
        3,
        { priorityMode: 'SET', priority: 'P1', urgencyMode: 'SET', urgency: 'HIGH' },
        true
      ),
    ];
    const tx = {
      incidentClassificationPolicy: {
        findFirst: vi.fn(({ where: { scopeKey } }) =>
          Promise.resolve(policies.find(candidate => candidate.scopeKey === scopeKey) ?? null)
        ),
      },
    };
    const result = await resolveIncidentClassification(tx as never, {
      serviceId: 's1',
      alertSeverity: 'warning',
    });
    expect(result.priority).toBeNull();
    expect(result.priorityProvenance.scope).toBe('service:s1');
    expect(result.urgency).toBe('HIGH');
  });

  it('lets a service explicitly disable workspace urgency fallback', async () => {
    const policies = [
      {
        ...policy('service:s1', 2, { priorityMode: 'INHERIT', urgencyMode: 'INHERIT' }),
        priorityFallbackMode: 'DISABLED',
      },
      {
        ...policy(
          'workspace',
          3,
          { priorityMode: 'INHERIT', urgencyMode: 'SET', urgency: 'HIGH' },
          true
        ),
        priorityFallbackMode: 'ENABLED',
      },
    ];
    const tx = {
      incidentClassificationPolicy: {
        findFirst: vi.fn(({ where: { scopeKey } }) =>
          Promise.resolve(policies.find(item => item.scopeKey === scopeKey) ?? null)
        ),
      },
    };
    const result = await resolveIncidentClassification(tx as never, {
      serviceId: 's1',
      alertSeverity: 'warning',
    });
    expect(result.urgency).toBe('HIGH');
    expect(result.priority).toBeNull();
  });

  it('uses typed escalation conditions with fail-closed unknown fields/operators', () => {
    const context = {
      priority: 'P1' as const,
      urgency: 'HIGH' as const,
      supportHoursState: 'OUTSIDE' as const,
    };
    expect(
      escalationConditionsMatch(
        [
          { field: 'PRIORITY', operator: 'IN', values: ['P1', 'P2'] },
          { field: 'SUPPORT_HOURS_STATE', operator: 'EQUALS', values: ['OUTSIDE'] },
        ],
        context
      )
    ).toBe(true);
    expect(
      escalationConditionsMatch(
        [{ field: 'UNTRUSTED', operator: 'EQUALS', values: ['x'] }],
        context
      )
    ).toBe(false);
  });

  it('defers only LOW urgency outside support hours without pausing SLA', () => {
    const now = new Date('2026-09-11T20:00:00Z');
    const nextSupportAt = new Date('2026-09-14T03:30:00Z');
    expect(
      resolveIncidentEngagement({
        urgency: 'LOW',
        now,
        supportHours: {
          state: 'OUTSIDE',
          timezone: 'Asia/Kolkata',
          scope: 'workspace',
          policyId: 'p1',
          policyVersion: 1,
          nextSupportAt,
        },
      })
    ).toMatchObject({
      deferred: true,
      earliestDeliveryAt: nextSupportAt,
      trafficClass: 'DEFERABLE',
    });
    expect(
      resolveIncidentEngagement({
        urgency: 'HIGH',
        now,
        supportHours: {
          state: 'OUTSIDE',
          timezone: 'UTC',
          scope: 'workspace',
          policyId: 'p1',
          policyVersion: 1,
          nextSupportAt,
        },
      }).deferred
    ).toBe(false);
  });

  it('derives the indexed hint from the canonical SLA projector', () => {
    const createdAt = new Date('2026-09-09T00:00:00Z');
    const next = deriveNewIncidentSlaTransition(
      {
        ackTargetMs: 300_000,
        resolveTargetMs: 3_600_000,
        source: 'WORKSPACE_PRIORITY_OVERRIDE',
        policyId: 'p',
        policyVersion: 1,
        policyRule: 'P1',
        capturedAt: createdAt,
      },
      createdAt
    );
    expect(next?.kind).toBe('ACK_WARNING');
    expect(next?.at.getTime()).toBeGreaterThan(createdAt.getTime());
  });

  it.each([
    ['Asia/Kolkata', '2026-09-10T04:00:00Z', 'INSIDE'],
    ['Asia/Kolkata', '2026-09-10T13:00:00Z', 'OUTSIDE'],
    ['America/New_York', '2026-03-09T13:30:00Z', 'INSIDE'],
    ['America/New_York', '2026-11-02T14:30:00Z', 'INSIDE'],
  ])('evaluates support hours in %s at DST-safe local time', async (timezone, iso, expected) => {
    const supportPolicy = {
      id: 'hours-v1',
      scopeKey: 'workspace',
      version: 1,
      timezone,
      inheritWorkspace: false,
      createdAt: new Date(),
      createdById: null,
      sealedAt: new Date(),
      windows: [1, 2, 3, 4, 5].map(dayOfWeek => ({
        id: `w${dayOfWeek}`,
        policyId: 'hours-v1',
        dayOfWeek,
        startMinute: 540,
        endMinute: 1080,
      })),
      exceptions: [],
    };
    const tx = {
      responseSupportHoursPolicy: {
        findFirst: vi.fn(({ where: { scopeKey } }) =>
          Promise.resolve(scopeKey === 'workspace' ? supportPolicy : null)
        ),
      },
    };
    const result = await resolveSupportHours(tx as never, { serviceId: 's1', at: new Date(iso) });
    expect(result.state).toBe(expected);
  });

  it('finds exact short support windows after a closure longer than 15 days', async () => {
    const exceptions = Array.from({ length: 20 }, (_, offset) => ({
      id: `e${offset}`,
      policyId: 'hours-v1',
      localDate: new Date(Date.UTC(2026, 8, 1 + offset)),
      available: false,
      startMinute: null,
      endMinute: null,
      label: null,
    }));
    const supportPolicy = {
      id: 'hours-v1',
      scopeKey: 'workspace',
      version: 1,
      timezone: 'UTC',
      mode: 'SCHEDULED',
      inheritWorkspace: false,
      createdAt: new Date(),
      createdById: null,
      sealedAt: new Date(),
      windows: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        id: `w${dayOfWeek}`,
        policyId: 'hours-v1',
        dayOfWeek,
        startMinute: 542,
        endMinute: 547,
      })),
      exceptions,
    };
    const tx = {
      responseSupportHoursPolicy: {
        findFirst: vi.fn(({ where: { scopeKey } }) =>
          Promise.resolve(scopeKey === 'workspace' ? supportPolicy : null)
        ),
      },
    };
    const result = await resolveSupportHours(tx as never, {
      serviceId: 's1',
      at: new Date('2026-09-01T00:00:00Z'),
    });
    expect(result.nextSupportAt?.toISOString()).toBe('2026-09-21T09:02:00.000Z');
  });
});
