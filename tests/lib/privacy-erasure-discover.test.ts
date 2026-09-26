import { describe, it, expect, vi, beforeEach } from 'vitest';

function emptyDependencyReport() {
  return {
    teams: [],
    teamsLed: [],
    escalationPolicies: [],
    scheduleLayers: [],
    overrides: [],
    shifts: [],
    incidents: [],
    actionItems: [],
    dashboards: [],
  };
}

const mocks = vi.hoisted(() => ({
  discoverUserDependencies: vi.fn(),
  assertUserIsNotSoleOwner: vi.fn(),
  assertNotLastAdmin: vi.fn(),
}));

vi.mock('@/lib/users/dependencies', () => ({
  discoverUserDependencies: mocks.discoverUserDependencies,
}));
vi.mock('@/app/(app)/users/actions', () => ({
  assertUserIsNotSoleOwner: mocks.assertUserIsNotSoleOwner,
  assertNotLastAdmin: mocks.assertNotLastAdmin,
}));

function countStub(value = 0) {
  return vi.fn().mockResolvedValue(value);
}

function buildMockPrisma() {
  return {
    user: {
      findUnique: vi.fn().mockResolvedValue({ id: 'cuserA0000001', email: 'alice@example.com' }),
    },
    oidcIdentity: { count: countStub() },
    oidcLinkingApproval: { count: countStub() },
    apiKey: { count: countStub() },
    userDevice: { count: countStub() },
    userToken: { count: countStub() },
    dashboard: { count: countStub() },
    teamMember: { count: countStub() },
    incidentWatcher: { count: countStub() },
    onCallShift: { count: countStub() },
    incidentNote: { count: countStub() },
    postmortem: { count: countStub() },
    incidentTemplate: { count: countStub() },
    actionItem: { count: countStub() },
    notification: { count: countStub() },
    inAppNotification: { count: countStub() },
    auditLog: { count: countStub() },
    oidcConfig: { count: countStub() },
    slackIntegration: { count: countStub() },
    slackOAuthConfig: { count: countStub() },
    slackDestination: { count: countStub() },
    notificationProvider: { count: countStub() },
    microsoftTeamsConfig: { count: countStub() },
    microsoftTeamsInstallation: { count: countStub() },
    microsoftTeamsDestination: { count: countStub() },
  };
}

const mockPrisma = vi.hoisted(() => ({
  current: null as unknown as ReturnType<typeof buildMockPrisma>,
}));
vi.mock('@/lib/prisma', () => ({
  // eslint-disable-next-line security/detect-object-injection -- test-only proxy delegates to a typed mock bucket, not user input
  default: new Proxy({}, { get: (_t, prop) => (mockPrisma.current as never)[prop] }),
}));

import { discoverSubjectErasureData } from '@/lib/privacy/erasure/discover';

const SUBJECT_ID = 'cuserA0000001';

describe('discoverSubjectErasureData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.current = buildMockPrisma();
    mocks.discoverUserDependencies.mockResolvedValue(emptyDependencyReport());
    mocks.assertUserIsNotSoleOwner.mockResolvedValue(undefined);
    mocks.assertNotLastAdmin.mockResolvedValue(undefined);
  });

  it('has no blocking conditions when there are no admin invariant issues or active dependencies', async () => {
    const discovery = await discoverSubjectErasureData(SUBJECT_ID);
    expect(discovery.blockingConditions).toEqual([]);
  });

  it('surfaces the last-admin invariant as a blocking condition', async () => {
    mocks.assertNotLastAdmin.mockRejectedValue(
      new Error('Cannot delete the last admin user. Create another admin first.')
    );

    const discovery = await discoverSubjectErasureData(SUBJECT_ID);
    expect(discovery.blockingConditions).toContain(
      'Cannot delete the last admin user. Create another admin first.'
    );
  });

  it('surfaces the sole-team-owner invariant as a blocking condition', async () => {
    mocks.assertUserIsNotSoleOwner.mockRejectedValue(
      new Error('Reassign team ownership before deleting this user.')
    );

    const discovery = await discoverSubjectErasureData(SUBJECT_ID);
    expect(discovery.blockingConditions).toContain(
      'Reassign team ownership before deleting this user.'
    );
  });

  it('blocks on an active incident assignment but not on plain team membership or dashboards', async () => {
    mocks.discoverUserDependencies.mockResolvedValue({
      ...emptyDependencyReport(),
      incidents: [
        { incidentId: 'inc-1', title: 'Prod down', serviceId: 'svc-1', serviceName: 'API' },
      ],
      teams: [{ membershipId: 'tm-1', teamId: 'team-1', teamName: 'SRE', role: 'MEMBER' }],
      dashboards: [{ dashboardId: 'd-1', name: 'My dashboard', visibility: 'PRIVATE' }],
    });

    const discovery = await discoverSubjectErasureData(SUBJECT_ID);

    expect(discovery.blockingConditions).toEqual(['Assigned to 1 active incident(s).']);
  });

  it('blocks on future on-call overrides, active rotation layers, escalation ownership, and open action items', async () => {
    mocks.discoverUserDependencies.mockResolvedValue({
      ...emptyDependencyReport(),
      scheduleLayers: [
        {
          assignmentId: 'a1',
          layerId: 'l1',
          layerName: 'Primary',
          scheduleId: 's1',
          scheduleName: 'Sched',
        },
      ],
      overrides: [
        {
          overrideId: 'o1',
          scheduleId: 's1',
          scheduleName: 'Sched',
          relation: 'recipient',
          start: new Date(),
          end: new Date(),
        },
      ],
      escalationPolicies: [{ stepId: 'e1', stepOrder: 1, policyId: 'p1', policyName: 'Policy' }],
      actionItems: [{ actionItemId: 'ai1', title: 'Follow up', incidentId: 'inc-1' }],
    });

    const discovery = await discoverSubjectErasureData(SUBJECT_ID);

    expect(discovery.blockingConditions).toEqual([
      'Still assigned to 1 on-call rotation layer(s).',
      'Referenced by 1 active/future on-call override(s).',
      'Still targeted by 1 escalation policy step(s).',
      'Owns 1 open postmortem action item(s).',
    ]);
  });
});
