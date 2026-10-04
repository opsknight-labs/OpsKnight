import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  view: vi.fn(),
  bindings: vi.fn(),
  executions: vi.fn(),
  suggestions: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  getUserPermissions: mocks.permissions,
  assertCanViewIncident: mocks.view,
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    serviceRunbookBinding: { findMany: mocks.bindings },
    runbookExecution: { findMany: mocks.executions },
    runbookSuggestion: { findMany: mocks.suggestions },
  },
}));
vi.mock('@/components/incident/runbook-actions', () => ({
  approveIncidentRunbookStepAction: vi.fn(),
  cancelIncidentRunbookAction: vi.fn(),
  dismissIncidentRunbookSuggestionAction: vi.fn(),
  startIncidentRunbookAction: vi.fn(),
  startIncidentRunbookSuggestionAction: vi.fn(),
}));
import IncidentRunbooks from '@/components/incident/IncidentRunbooks';

describe('Incident Runbook read boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bindings.mockResolvedValue([]);
    mocks.executions.mockResolvedValue([]);
    mocks.suggestions.mockResolvedValue([]);
    mocks.view.mockResolvedValue({});
  });
  it('does not query execution or output data without Runbook read permission', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['incident.read.scoped'] });
    expect(await IncidentRunbooks({ incidentId: 'incident1', serviceId: 'service1' })).toBeNull();
    expect(mocks.executions).not.toHaveBeenCalled();
    expect(mocks.bindings).not.toHaveBeenCalled();
    expect(mocks.suggestions).not.toHaveBeenCalled();
  });
  it('requires incident access before scoped readers can query Runbooks', async () => {
    mocks.permissions.mockResolvedValue({ capabilities: ['runbook.read.scoped'] });
    mocks.view.mockRejectedValue(new Error('Forbidden incident'));
    await expect(
      IncidentRunbooks({ incidentId: 'incident1', serviceId: 'service1' })
    ).rejects.toThrow('Forbidden incident');
    expect(mocks.executions).not.toHaveBeenCalled();
  });
});
