import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResponseContext } from '@/lib/automation/response-context';

const mocks = vi.hoisted(() => ({
  incident: vi.fn(),
  events: vi.fn(),
  notifications: vi.fn(),
  executions: vi.fn(),
  suggestions: vi.fn(),
  decision: vi.fn(),
  health: vi.fn(),
  view: vi.fn(),
  permissions: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: mocks.incident },
    incidentEvent: { findMany: mocks.events },
    notification: { findMany: mocks.notifications },
    runbookExecution: { findMany: mocks.executions },
    runbookSuggestion: { findMany: mocks.suggestions },
    incidentAutomationDecision: { findUnique: mocks.decision },
  },
}));
vi.mock('@/lib/escalation/execution-health', () => ({
  getEscalationExecutionHealth: mocks.health,
}));
vi.mock('@/lib/rbac', () => ({
  assertCanViewIncident: mocks.view,
  getUserPermissions: mocks.permissions,
}));

import {
  getIncidentResponseTimeline,
  loadIncidentResponseTimeline,
  RESPONSE_TIMELINE_LIMITS,
} from '@/lib/incidents/response-timeline';

const RESPONDER = [
  'automation.read',
  'incident.read.all',
  'incident.sensitive.read',
  'runbook.read.all',
];
const AUDITOR = ['automation.read', 'incident.read.all', 'runbook.read.all'];
const USER = ['incident.read.scoped'];

const t = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute, 0));

const context = buildResponseContext({
  versionId: 'version-1',
  versionNumber: 4,
  fields: [
    { fieldId: 'f-region', key: 'region', type: 'STRING' },
    { fieldId: 'f-host', key: 'host', type: 'STRING' },
    { fieldId: 'f-tier', key: 'tier', type: 'ENUM' },
  ],
  inputContext: {
    region: { state: 'RECOGNIZED', value: 'eu-west-1' },
    host: { state: 'RECOGNIZED', value: 'web-01' },
  },
  enrichedContext: {
    region: { state: 'RECOGNIZED', value: 'eu-west-1' },
    host: { state: 'RECOGNIZED', value: 'web-01.prod' },
  },
} as Parameters<typeof buildResponseContext>[0]);

function liveDecision(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'LIVE',
    fallbackReason: null,
    responseContext: context,
    ...overrides,
  };
}

function seed() {
  mocks.incident.mockResolvedValue({
    id: 'inc-1',
    status: 'RESOLVED',
    createdAt: t(0),
    acknowledgedAt: t(3),
    resolvedAt: t(20),
    resolutionKind: 'AUTOMATION',
    automationSourceRestricted: false,
    automationTraces: [],
    automationDecision: {
      incidentId: 'inc-1',
      mode: 'LIVE',
      routeType: 'ESCALATION_POLICY',
      escalationPolicyNameSnapshot: 'Payments primary',
      matchedRouteRuleName: 'EU payments',
      basePriority: 'P3',
      finalPriority: 'P1',
      evaluationAt: t(0),
      fallbackReason: null,
      version: { versionNumber: 4 },
    },
  });
  mocks.decision.mockResolvedValue(liveDecision());
  mocks.events.mockResolvedValue(
    [
      { id: 'e1', type: 'ESCALATED', message: 'Escalated to Alice (Level 1)', createdAt: t(1) },
      {
        id: 'e2',
        type: 'ACKNOWLEDGED',
        message: 'Incident acknowledged by Alice',
        createdAt: t(3),
      },
      {
        id: 'e3',
        type: 'RUNBOOK_SKIPPED',
        message: 'Runbook skipped: automation context unavailable (FALLBACK) for Disk cleanup',
        createdAt: t(4),
      },
      {
        id: 'e4',
        type: 'RUNBOOK_VERIFIED',
        message: 'Recovery verified for Restart web',
        createdAt: t(16),
      },
      {
        id: 'e5',
        type: 'MANUAL_RESOLVED',
        message: 'Resolved after verified recovery: Restart web',
        createdAt: t(20),
      },
    ].reverse()
  );
  mocks.notifications.mockResolvedValue([
    {
      id: 'n1',
      channel: 'SMS',
      status: 'DELIVERED',
      recipientDisplay: '+15550000',
      errorMsg: null,
      createdAt: t(1),
      sentAt: t(1),
      deliveredAt: t(2),
      failedAt: null,
      user: { name: 'Alice' },
    },
    {
      id: 'n2',
      channel: 'EMAIL',
      status: 'FAILED',
      recipientDisplay: null,
      errorMsg: 'bounce for bob@example.com',
      createdAt: t(1),
      sentAt: null,
      deliveredAt: null,
      failedAt: t(2),
      user: { name: 'Bob' },
    },
  ]);
  mocks.suggestions.mockResolvedValue([
    {
      id: 's1',
      state: 'STARTED',
      createdAt: t(5),
      startedAt: t(6),
      dismissedAt: null,
      binding: { runbook: { name: 'Restart web' } },
      runbookVersion: { version: 7 },
    },
  ]);
  mocks.executions.mockResolvedValue([
    {
      id: 'x1',
      status: 'SUCCEEDED',
      createdAt: t(6),
      startedAt: t(6),
      completedAt: t(15),
      triggeredByType: 'TRIGGER',
      failureCode: null,
      targetSelection: {
        selector: { host: '${{ context.host }}', role: 'web' },
        resolvedLabels: { host: 'web-01.prod', role: 'web' },
        contextKeys: ['host'],
        poolId: 'pool-1',
      },
      unattendedWritesAuthorized: true,
      recoveryOutcome: 'RESOLVED',
      recoveryCheckedAt: t(19),
      runbook: { name: 'Restart web' },
      runbookVersion: { version: 7 },
      triggeredByUser: null,
      resolvedTargetAgent: { name: 'agent-eu-1', hostname: 'web-01.prod' },
      resolvedTargetAgentPool: null,
      steps: [
        {
          id: 'st1',
          stepKey: 'check',
          name: 'Check health',
          riskClass: 'READ_ONLY',
          status: 'SUCCEEDED',
          requiresApproval: false,
          startedAt: t(7),
          approvedAt: null,
          approvedBy: null,
          verificationResult: null,
        },
        {
          id: 'st2',
          stepKey: 'restart',
          name: 'Restart service',
          riskClass: 'IDEMPOTENT_WRITE',
          status: 'SUCCEEDED',
          requiresApproval: true,
          startedAt: t(8),
          approvedAt: t(9),
          approvedBy: { name: 'Carol' },
          verificationResult: {
            verified: true,
            checkKeys: ['verify'],
            capturedAt: t(14).toISOString(),
            reason: 'Health checks passed',
            differences: [],
          },
        },
        {
          id: 'st3',
          stepKey: 'flush',
          name: 'Flush cache',
          riskClass: 'NON_IDEMPOTENT',
          status: 'WAITING_APPROVAL',
          requiresApproval: true,
          startedAt: t(10),
          approvedAt: null,
          approvedBy: null,
          verificationResult: {
            verified: false,
            checkKeys: ['verify-cache'],
            capturedAt: t(13).toISOString(),
            reason: 'Cache hit ratio unchanged',
            differences: [],
          },
        },
      ],
    },
  ]);
  mocks.health.mockResolvedValue({
    generation: 0,
    incidentEscalationStatus: 'COMPLETED',
    needsAttention: false,
    steps: [
      {
        stepIndex: 0,
        stepNumber: 1,
        outcome: 'COMPLETED',
        attempts: 1,
        maxAttempts: 3,
        error: null,
        failedAt: null,
        completedAt: t(1).toISOString(),
        targetLabel: 'Primary on-call',
        timelineEvidence: true,
        continuedAfter: false,
      },
      {
        stepIndex: 1,
        stepNumber: 2,
        outcome: 'FAILED',
        attempts: 3,
        maxAttempts: 3,
        error: 'provider timeout',
        failedAt: t(11).toISOString(),
        completedAt: null,
        targetLabel: 'Secondary',
        timelineEvidence: false,
        continuedAfter: false,
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
});

describe('getIncidentResponseTimeline', () => {
  it('projects all five lanes in chronological order for a sensitive responder', async () => {
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline).not.toBeNull();
    const entries = timeline!.entries;
    const times = entries.map(entry => entry.at);
    expect([...times].sort()).toEqual(times);
    expect(timeline!.lanes.map(lane => lane.lane)).toEqual([
      'ROUTING',
      'PAGING',
      'REMEDIATION',
      'VERIFICATION',
      'RECOVERY',
    ]);
    expect(timeline!.lanes.every(lane => lane.visible && !lane.restricted)).toBe(true);

    const decision = entries.find(entry => entry.kind === 'ROUTING_DECISION');
    expect(decision?.title).toBe('Matched rule: EU payments');
    expect(decision?.facts).toEqual(
      expect.arrayContaining([
        { label: 'Mode', value: 'LIVE' },
        { label: 'Automation version', value: 'v4' },
        { label: 'Priority', value: 'P3 → P1' },
        { label: 'Route', value: 'Escalation policy' },
        { label: 'Escalation policy', value: 'Payments primary' },
      ])
    );

    const steps = entries.filter(entry => entry.kind === 'ESCALATION_STEP');
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      lane: 'PAGING',
      tone: 'oncall',
      detail: 'Escalated to Alice (Level 1)',
    });
    expect(steps[1]).toMatchObject({ tone: 'critical', title: 'Escalation step 2 · Secondary' });
    // The "(Level 1)" event is folded into its step instead of duplicated.
    expect(entries.some(entry => entry.kind === 'ESCALATION_EVENT')).toBe(false);

    const failedNotification = entries.find(entry => entry.id === 'notification:n2');
    expect(failedNotification?.tone).toBe('critical');
    expect(JSON.stringify(failedNotification)).not.toContain('bob@example.com');

    const started = entries.find(entry => entry.id === 'execution:x1:started');
    expect(started?.facts).toEqual(
      expect.arrayContaining([
        { label: 'Trigger', value: 'Automatic (trigger)' },
        { label: 'Target', value: 'agent-eu-1 (web-01.prod)' },
        { label: 'Target labels', value: 'host=web-01.prod, role=web' },
        { label: 'Context keys', value: 'host' },
        { label: 'Write actions', value: 'Unattended writes authorized' },
      ])
    );
    expect(entries.find(entry => entry.id === 'execution:x1:finished')?.tone).toBe('success');
    expect(entries.find(entry => entry.id === 'approval:st2')).toMatchObject({
      state: 'APPROVED',
      title: 'Step approved: Restart service',
    });
    expect(entries.find(entry => entry.id === 'approval:st3')).toMatchObject({
      state: 'REQUIRED',
      tone: 'warning',
    });

    const verification = entries.filter(entry => entry.lane === 'VERIFICATION');
    expect(verification.map(entry => entry.title)).toEqual([
      'Not verified: Flush cache',
      'Verified: Restart service',
      'Recovery verified',
    ]);
    expect(entries.find(entry => entry.id === 'event:e3')).toMatchObject({
      lane: 'REMEDIATION',
      kind: 'RUNBOOK_EVENT',
      eventType: 'RUNBOOK_SKIPPED',
    });

    const recovery = entries.filter(entry => entry.lane === 'RECOVERY');
    expect(recovery.map(entry => entry.title)).toEqual([
      'Acknowledged',
      'Resolved after verified recovery: Restart web',
      'Resolved',
    ]);
    expect(recovery.at(-1)).toMatchObject({
      resolutionKind: 'AUTOMATION',
      facts: [{ label: 'Resolution', value: 'Automation' }],
    });

    expect(timeline!.context).toMatchObject({
      visibility: 'VISIBLE',
      status: 'AVAILABLE',
      versionNumber: 4,
    });
    if (timeline!.context.visibility !== 'HIDDEN' && timeline!.context.status === 'AVAILABLE') {
      expect(timeline!.context.fields).toEqual([
        {
          key: 'region',
          type: 'STRING',
          state: 'RECOGNIZED',
          source: 'ALERT',
          value: 'eu-west-1',
          redacted: false,
        },
        {
          key: 'host',
          type: 'STRING',
          state: 'RECOGNIZED',
          source: 'ENRICHMENT',
          value: 'web-01.prod',
          redacted: false,
        },
        {
          key: 'tier',
          type: 'ENUM',
          state: 'MISSING',
          source: 'NONE',
          value: null,
          redacted: false,
        },
      ]);
    }
  });

  it('uses bounded, batched queries and reuses supplied escalation health', async () => {
    await getIncidentResponseTimeline(
      'inc-1',
      { capabilities: RESPONDER },
      { escalationHealth: null }
    );
    expect(mocks.health).not.toHaveBeenCalled();
    expect(mocks.incident).toHaveBeenCalledTimes(1);
    expect(mocks.events).toHaveBeenCalledTimes(1);
    expect(mocks.events.mock.calls[0][0].take).toBe(RESPONSE_TIMELINE_LIMITS.events);
    expect(mocks.notifications.mock.calls[0][0].take).toBe(RESPONSE_TIMELINE_LIMITS.notifications);
    expect(mocks.executions).toHaveBeenCalledTimes(1);
    const executionQuery = mocks.executions.mock.calls[0][0];
    expect(executionQuery.take).toBe(RESPONSE_TIMELINE_LIMITS.executions);
    expect(executionQuery.select.steps.take).toBe(RESPONSE_TIMELINE_LIMITS.stepsPerExecution);
    expect(mocks.suggestions.mock.calls[0][0].take).toBe(RESPONSE_TIMELINE_LIMITS.suggestions);
  });

  it('redacts context values, context-derived labels and source content for auditors', async () => {
    mocks.incident.mockResolvedValue({
      ...(await mocks.incident()),
      automationSourceRestricted: true,
    });
    mocks.events.mockResolvedValue([
      {
        id: 'e9',
        type: 'REOPENED',
        message: 'Re-triggered by event: password=hunter2 on web-01.prod',
        createdAt: t(25),
      },
    ]);
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: AUDITOR });
    const serialized = JSON.stringify(timeline);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('eu-west-1');
    expect(serialized).toContain('Alert re-triggered. Source content is restricted.');
    const started = timeline!.entries.find(entry => entry.id === 'execution:x1:started');
    expect(started?.facts).toContainEqual({
      label: 'Target labels',
      value: 'host=[restricted], role=web',
    });
    expect(timeline!.context).toMatchObject({ visibility: 'REDACTED', status: 'AVAILABLE' });
    if (timeline!.context.visibility !== 'HIDDEN' && timeline!.context.status === 'AVAILABLE') {
      expect(
        timeline!.context.fields.map(field => [field.key, field.value, field.redacted])
      ).toEqual([
        ['region', null, true],
        ['host', null, true],
        ['tier', null, false],
      ]);
    }
    // Routing details stay visible to automation readers.
    expect(timeline!.entries.some(entry => entry.kind === 'ROUTING_DECISION')).toBe(true);
  });

  it('withholds routing, runbook and context data from viewers without those capabilities', async () => {
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: USER });
    expect(mocks.executions).not.toHaveBeenCalled();
    expect(mocks.suggestions).not.toHaveBeenCalled();
    expect(mocks.decision).not.toHaveBeenCalled();
    expect(mocks.events.mock.calls[0][0].where.type.in).not.toContain('RUNBOOK_SKIPPED');
    expect(timeline!.context).toEqual({ visibility: 'HIDDEN' });
    expect(timeline!.entries.some(entry => entry.kind === 'ROUTING_DECISION')).toBe(false);
    const lanes = Object.fromEntries(timeline!.lanes.map(lane => [lane.lane, lane]));
    expect(lanes.ROUTING).toMatchObject({ visible: true, restricted: true });
    expect(lanes.REMEDIATION.visible).toBe(false);
    expect(lanes.VERIFICATION.visible).toBe(false);
    expect(lanes.RECOVERY).toMatchObject({ visible: true, restricted: true });
    expect(timeline!.entries.some(entry => entry.lane === 'REMEDIATION')).toBe(false);
  });

  it.each([
    [liveDecision({ fallbackReason: 'VERSION_UNAVAILABLE' }), 'FALLBACK'],
    [liveDecision({ mode: 'SHADOW' }), 'NO_LIVE_DECISION'],
    [liveDecision({ responseContext: null }), 'NOT_CAPTURED'],
    [
      liveDecision({
        responseContext: {
          ...context,
          fields: context.fields.map(field =>
            field.key === 'host' ? { ...field, value: 'attacker-host' } : field
          ),
        },
      }),
      'INTEGRITY_FAILED',
    ],
    [null, 'NO_LIVE_DECISION'],
  ])('reports unavailable context (%#) as %s', async (decision, reason) => {
    mocks.decision.mockResolvedValue(decision);
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.context).toEqual({ visibility: 'VISIBLE', status: 'UNAVAILABLE', reason });
    expect(JSON.stringify(timeline!.context)).not.toContain('attacker-host');
  });

  it('labels shadow and fallback routing decisions', async () => {
    const base = await mocks.incident();
    mocks.incident.mockResolvedValue({
      ...base,
      automationDecision: { ...base.automationDecision, mode: 'SHADOW' },
    });
    let timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.entries.find(entry => entry.kind === 'ROUTING_DECISION')).toMatchObject({
      title: 'Automation evaluated in shadow mode',
      detail: expect.stringContaining('do not change routing'),
    });
    mocks.incident.mockResolvedValue({
      ...base,
      automationDecision: {
        ...base.automationDecision,
        fallbackReason: 'EVALUATION_TIMEOUT',
        matchedRouteRuleName: null,
      },
    });
    timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.entries.find(entry => entry.kind === 'ROUTING_DECISION')).toMatchObject({
      title: 'Automation fell back to service-default routing',
      tone: 'warning',
      facts: expect.arrayContaining([{ label: 'Fallback reason', value: 'EVALUATION_TIMEOUT' }]),
    });
  });

  it('synthesizes lifecycle entries when typed events are missing', async () => {
    mocks.events.mockResolvedValue([]);
    mocks.executions.mockResolvedValue([]);
    mocks.suggestions.mockResolvedValue([]);
    mocks.notifications.mockResolvedValue([]);
    mocks.health.mockResolvedValue(null);
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.entries.map(entry => entry.title)).toEqual([
      'Incident triggered',
      'Matched rule: EU payments',
      'Acknowledged',
      'Resolved',
    ]);
  });

  it('returns null for a missing incident', async () => {
    mocks.incident.mockResolvedValue(null);
    expect(await getIncidentResponseTimeline('missing', { capabilities: RESPONDER })).toBeNull();
  });

  it('bounds the projected entries while keeping routing context', async () => {
    mocks.notifications.mockResolvedValue(
      Array.from({ length: 400 }, (_, index) => ({
        id: `bulk-${index}`,
        channel: 'PUSH',
        status: 'SENT',
        recipientDisplay: 'device',
        errorMsg: null,
        createdAt: t(30),
        sentAt: new Date(t(30).getTime() + index * 1000),
        deliveredAt: null,
        failedAt: null,
        user: null,
      }))
    );
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.truncated).toBe(true);
    expect(timeline!.entries.length).toBeLessThanOrEqual(RESPONSE_TIMELINE_LIMITS.entries);
    expect(timeline!.entries[0].kind).toBe('INCIDENT_TRIGGERED');
  });

  it('links entries to the decision, execution, approval, notification and event records', async () => {
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    const byId = new Map(timeline!.entries.map(entry => [entry.id, entry.record]));
    expect(byId.get('decision:inc-1')).toEqual({ type: 'DECISION', id: 'inc-1' });
    expect(byId.get('execution:x1:started')).toEqual({ type: 'EXECUTION', id: 'x1' });
    expect(byId.get('approval:st3')).toEqual({ type: 'APPROVAL', id: 'st3', executionId: 'x1' });
    expect(byId.get('notification:n1')).toEqual({ type: 'NOTIFICATION', id: 'n1' });
    expect(byId.get('suggestion:s1')).toEqual({ type: 'SUGGESTION', id: 's1' });
    expect(byId.get('event:e3')).toEqual({ type: 'EVENT', id: 'e3' });
    expect(byId.get('event:e2')).toEqual({ type: 'EVENT', id: 'e2' });
    expect(byId.get('escalation:0:1')).toEqual({ type: 'ESCALATION_STEP', id: '1' });
  });

  it('surfaces a resolution recommendation and human intervention for NO_ESCALATION incidents', async () => {
    const base = await mocks.incident();
    mocks.incident.mockResolvedValue({ ...base, status: 'OPEN', resolvedAt: null });
    mocks.events.mockResolvedValue(
      [
        {
          id: 'v1',
          type: 'RUNBOOK_VERIFIED',
          message:
            'Recovery verified: Restart web (1/1 write actions verified). Resolution recommended: confirm recovery and resolve the incident.',
          createdAt: t(16),
        },
        {
          id: 'h1',
          type: 'RUNBOOK_UNVERIFIED',
          message:
            'Human intervention required: no responder is paged for this incident. Runbook Restart web failed.',
          createdAt: t(18),
        },
      ].reverse()
    );
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.humanInterventionRequired).toBe(true);
    expect(timeline!.entries.find(entry => entry.id === 'event:v1')).toMatchObject({
      lane: 'RECOVERY',
      title: 'Recovery verified · resolution recommended',
      signal: 'RESOLUTION_RECOMMENDED',
    });
    expect(timeline!.entries.find(entry => entry.id === 'event:h1')).toMatchObject({
      lane: 'RECOVERY',
      tone: 'critical',
      title: 'Human intervention required',
      signal: 'HUMAN_INTERVENTION',
    });
  });

  it('clears the intervention indicator once resolved and hides it from non-runbook readers', async () => {
    const intervention = {
      id: 'h1',
      type: 'RUNBOOK_UNVERIFIED',
      message: 'Human intervention required: no responder is paged for this incident.',
      createdAt: t(18),
    };
    mocks.events.mockResolvedValue([intervention]);
    expect(
      (await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER }))!
        .humanInterventionRequired
    ).toBe(false);
    const base = await mocks.incident();
    mocks.incident.mockResolvedValue({ ...base, status: 'OPEN', resolvedAt: null });
    expect(
      (await getIncidentResponseTimeline('inc-1', { capabilities: USER }))!
        .humanInterventionRequired
    ).toBe(false);
  });

  it('surfaces uncertain write outcomes and in-flight waiting state', async () => {
    const [execution] = await mocks.executions();
    mocks.executions.mockResolvedValue([
      { ...execution, id: 'x2', status: 'FAILED', failureCode: 'UNKNOWN_OUTCOME' },
      { ...execution, id: 'x3', status: 'WAITING_APPROVAL', completedAt: null },
    ]);
    const timeline = await getIncidentResponseTimeline('inc-1', { capabilities: RESPONDER });
    expect(timeline!.entries.find(entry => entry.id === 'execution:x2:finished')).toMatchObject({
      tone: 'warning',
      detail: expect.stringContaining('never retried automatically'),
    });
    expect(
      timeline!.entries.find(entry => entry.id === 'execution:x3:started')?.facts
    ).toContainEqual({ label: 'Current status', value: 'Waiting for approval — paging continues' });
    expect(timeline!.entries.some(entry => entry.id === 'execution:x3:finished')).toBe(false);
  });
});

describe('loadIncidentResponseTimeline', () => {
  it('denies an invisible incident before any projection query', async () => {
    mocks.view.mockRejectedValue(new Error('Incident access denied'));
    await expect(loadIncidentResponseTimeline('inc-1')).rejects.toThrow('Incident access denied');
    expect(mocks.permissions).not.toHaveBeenCalled();
    expect(mocks.incident).not.toHaveBeenCalled();
  });

  it('applies the current user permissions', async () => {
    mocks.view.mockResolvedValue({ id: 'auditor' });
    mocks.permissions.mockResolvedValue({ capabilities: AUDITOR });
    const timeline = await loadIncidentResponseTimeline('inc-1');
    expect(timeline!.context).toMatchObject({ visibility: 'REDACTED' });
  });
});
