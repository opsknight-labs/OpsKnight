import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  assertCanViewIncident: vi.fn(),
  getCurrentAuthorizationActor: vi.fn(),
  getUserPermissions: vi.fn(),
  executionFindFirst: vi.fn(),
  incidentFindFirst: vi.fn(),
  approve: vi.fn(),
  cancel: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: mocks.assertCapability,
  assertCanViewIncident: mocks.assertCanViewIncident,
  getCurrentAuthorizationActor: mocks.getCurrentAuthorizationActor,
  getUserPermissions: mocks.getUserPermissions,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/prisma', () => ({
  default: {
    runbookExecution: { findFirst: mocks.executionFindFirst },
    incident: { findFirst: mocks.incidentFindFirst },
  },
}));
vi.mock('@/lib/runbooks/orchestrator', () => ({
  previewRunbookExecution: vi.fn(),
  startRunbookExecution: vi.fn(),
  approveExecutionStep: mocks.approve,
  cancelExecution: mocks.cancel,
}));

import {
  approveIncidentRunbookStepAction,
  cancelIncidentRunbookAction,
} from '@/components/incident/runbook-actions';

const INCIDENT = 'cincident0001';
const EXECUTION = 'cexecution001';
const STEP = 'cstep00000001';
const DIGEST = 'a'.repeat(64);

const responder: AuthorizationActor = {
  id: 'cuser00000001',
  role: 'RESPONDER',
  status: 'ACTIVE',
  teamIds: ['team-a'],
};

function execution(overrides: Record<string, unknown> = {}) {
  return {
    id: EXECUTION,
    incidentId: INCIDENT,
    serviceId: 'cservice00001',
    triggeredByUserId: 'cother0000001',
    service: { teamId: 'team-b' },
    ...overrides,
  };
}

describe('incident-page runbook approve and cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockResolvedValue(responder);
    mocks.assertCanViewIncident.mockResolvedValue(undefined);
    mocks.getCurrentAuthorizationActor.mockResolvedValue(responder);
    mocks.incidentFindFirst.mockResolvedValue({ id: INCIDENT });
    mocks.executionFindFirst.mockResolvedValue(execution());
  });

  it('refuses a responder who did not trigger the run and is not on the service team', async () => {
    await expect(
      approveIncidentRunbookStepAction(INCIDENT, EXECUTION, STEP, DIGEST)
    ).rejects.toThrow();
    await expect(cancelIncidentRunbookAction(INCIDENT, EXECUTION)).rejects.toThrow();
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it('allows a member of the service team', async () => {
    mocks.executionFindFirst.mockResolvedValue(execution({ service: { teamId: 'team-a' } }));
    await cancelIncidentRunbookAction(INCIDENT, EXECUTION);
    await approveIncidentRunbookStepAction(INCIDENT, EXECUTION, STEP, DIGEST);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.approve).toHaveBeenCalledTimes(1);
  });

  it('allows the triggerer', async () => {
    mocks.executionFindFirst.mockResolvedValue(execution({ triggeredByUserId: responder.id }));
    await cancelIncidentRunbookAction(INCIDENT, EXECUTION);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a run that belongs to a different incident', async () => {
    mocks.executionFindFirst.mockResolvedValue(
      execution({ triggeredByUserId: responder.id, incidentId: 'cincident0002' })
    );
    await expect(cancelIncidentRunbookAction(INCIDENT, EXECUTION)).rejects.toThrow(
      'does not belong to this incident'
    );
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
