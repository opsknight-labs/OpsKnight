import type { IncidentInsights } from '@/lib/intelligence/incident-ux/strip';

const at = new Date('2026-11-01T10:00:00Z');

/** An incident with nothing to say: SUGGEST mode, current analysis, no findings. */
export function quietInsights(overrides: Partial<IncidentInsights> = {}): IncidentInsights {
  return {
    incidentId: 'inc-1',
    mode: 'SUGGEST',
    canManage: false,
    canGiveFeedback: true,
    canExecuteRunbooks: true,
    canPostNote: true,
    analysis: { status: 'CURRENT', message: 'Recommendations checked.', canRefresh: false },
    proactive: null,
    triage: null,
    similar: null,
    related: null,
    group: null,
    response: null,
    impact: null,
    noise: [],
    ai: { summaryEnabled: false },
    squire: { enabled: true, mobileEnabled: false, name: 'Pip' },
    ...overrides,
  };
}

/** An incident where every section has content. */
export function busyInsights(overrides: Partial<IncidentInsights> = {}): IncidentInsights {
  return quietInsights({
    proactive: {
      briefing: {
        createdAt: at,
        mode: 'BASIC',
        headline: 'Checkout is failing',
        facts: ['Opened 4 minutes ago'],
        analysisPending: false,
        refs: { similar: [], changes: [], runbooks: [] },
        ai: null,
        nextSteps: ['Check the last deploy'],
      },
      nudge: null,
      postmortemDraft: null,
    },
    triage: {
      canAct: true,
      suggestions: [
        {
          findingId: 't1',
          kind: 'TRIAGE_URGENCY',
          confidencePercent: 72,
          urgency: 'HIGH',
          myVerdict: null,
          precedents: 4,
          sloBurning: false,
        },
        {
          findingId: 't2',
          kind: 'TRIAGE_ASSIGNMENT',
          confidencePercent: 70,
          owner: { type: 'team', id: 'team-1', name: 'Team Payments' },
          myVerdict: null,
          precedents: 3,
          sloBurning: false,
        },
      ],
    },
    similar: [
      {
        findingId: 's1',
        myVerdict: null,
        incidentId: 'inc-old',
        title: 'Checkout pool exhausted (last month)',
        status: 'RESOLVED',
        serviceName: 'Checkout',
        createdAt: at,
        resolvedAt: at,
        minutesToResolve: 190,
        resolutionSummary: 'Restarted the pool',
        postmortem: null,
        matchPercent: 91,
        reasons: ['Very similar wording', 'Same service'],
      },
    ],
    related: [
      {
        relationshipId: 'rel-1',
        decision: 'ACCEPTED',
        origin: 'RULE',
        automatic: true,
        ruleId: 'same-db',
        incidentId: 'inc-rel',
        title: 'Orders API slow',
        status: 'OPEN',
        serviceName: 'Orders',
        createdAt: at,
      },
    ],
    group: {
      role: 'PARENT',
      parent: null,
      parentHidden: false,
      members: [
        {
          kind: 'INCIDENT',
          id: 'inc-child',
          ref: '#CHILD',
          title: 'Cart 502',
          status: 'OPEN',
          at,
          relationshipId: 'rel-pc',
          automatic: true,
          current: false,
        },
        {
          kind: 'ALERT',
          decisionId: 'dec-1',
          alertId: 'alert-1',
          title: 'db-7 CPU saturated',
          at,
          ungroupable: true,
          reversed: false,
        },
      ],
      hiddenMembers: 0,
      anchorOnset: at,
      truncated: false,
      canUngroupAlerts: false,
      canUngroupIncidents: false,
    },
    response: {
      changes: [
        {
          findingId: 'c1',
          changeId: 'chg-1',
          kind: 'DEPLOY',
          summary: 'deploy api v9',
          source: 'ci',
          version: 'v9',
          url: null,
          serviceName: 'Checkout',
          occurredAt: at,
          leadMinutes: 12,
          relation: 'SAME_SERVICE',
          confidencePercent: 70,
          riskPercent: 55,
        },
      ],
      upstreamIncidents: [
        {
          findingId: 'u1',
          incidentId: 'inc-up',
          title: 'Database failover',
          status: 'OPEN',
          serviceName: 'Postgres',
          leadMinutes: 5,
          confidencePercent: 60,
        },
      ],
      runbooks: [
        {
          findingId: 'r1',
          runbookId: 'rb-1',
          name: 'Restart pool',
          succeeded: 3,
          eligible: 4,
          bound: true,
        },
      ],
    },
    impact: {
      serviceId: 'svc',
      downstream: [
        { id: 'web', name: 'Web', distance: 1, status: 'DEGRADED', openIncidents: 2 },
        { id: 'mobile', name: 'Mobile', distance: 2, status: 'OPERATIONAL', openIncidents: 0 },
      ],
      downstreamTruncated: false,
      components: [],
      componentsTruncated: false,
      slo: {
        state: 'AVAILABLE',
        severity: 'critical',
        objectives: [
          {
            name: 'Availability',
            targetPercent: 99.9,
            fastBurn: 14.4,
            slowBurn: 6,
            severity: 'critical',
            budgetMinutes: 43,
            incidentBudgetPercent: 12,
          },
        ],
      },
    },
    noise: [{ kind: 'suppressed', label: 'Suppressed by Known noisy probe' }],
    ai: { summaryEnabled: true },
    ...overrides,
  });
}
