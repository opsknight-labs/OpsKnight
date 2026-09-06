import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeIncidentCreation: vi.fn(),
  assertCanCreateIncidentForService: vi.fn(),
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/incidents/creation', () => ({
  executeIncidentCreation: mocks.executeIncidentCreation,
}));
vi.mock('@/lib/incidents/operator-lifecycle', () => ({
  updateIncidentStatus: vi.fn(),
  resolveIncidentWithNote: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn(),
  assertCanCreateIncidentForService: mocks.assertCanCreateIncidentForService,
  assertCanAddIncidentNote: vi.fn(),
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import { createIncident, createMobileIncident } from './actions';

describe('incident creation action adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanCreateIncidentForService.mockResolvedValue(undefined);
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', name: 'Test User' });
    mocks.executeIncidentCreation.mockResolvedValue({ id: 'inc-1', outcome: 'CREATED' });
  });

  function formData() {
    const form = new FormData();
    form.append('title', 'Database latency');
    form.append('description', 'Write latency above threshold');
    form.append('serviceId', 'svc-1');
    form.append('urgency', 'HIGH');
    form.append('priority', 'P1');
    form.append('dedupKey', 'db-latency');
    form.append('assigneeId', 'user-2');
    form.append('customField_impact', 'customer-facing');
    return form;
  }

  it('authorizes the service and delegates WEB creation to the domain engine', async () => {
    const result = await createIncident(formData());

    expect(mocks.assertCanCreateIncidentForService).toHaveBeenCalledWith('svc-1');
    expect(mocks.executeIncidentCreation).toHaveBeenCalledWith({
      title: 'Database latency',
      description: 'Write latency above threshold',
      urgency: 'HIGH',
      serviceId: 'svc-1',
      priority: 'P1',
      dedupKey: 'db-latency',
      assigneeId: 'user-2',
      teamId: null,
      visibility: undefined,
      customFields: [{ fieldId: 'impact', value: 'customer-facing' }],
      source: 'WEB',
      actor: { id: 'user-1', name: 'Test User' },
    });
    expect(result).toEqual({ id: 'inc-1', outcome: 'CREATED' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/incidents');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/incidents/inc-1');
  });

  it('forwards explicit visibility when provided in form data', async () => {
    const form = formData();
    form.append('visibility', 'PRIVATE');

    await createIncident(form);

    expect(mocks.executeIncidentCreation).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: 'PRIVATE' })
    );
  });

  it('uses the MOBILE source without maintaining a second creation implementation', async () => {
    mocks.executeIncidentCreation.mockResolvedValue({ id: 'inc-existing', outcome: 'MERGED' });

    const result = await createMobileIncident(formData());

    expect(mocks.executeIncidentCreation).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MOBILE' })
    );
    expect(result).toEqual({ id: 'inc-existing', outcome: 'MERGED' });
  });

  it('rejects an invalid urgency before invoking the domain engine', async () => {
    const form = formData();
    form.set('urgency', 'CRITICAL');

    await expect(createIncident(form)).rejects.toMatchObject({
      code: 'INCIDENT_INVALID_ARGUMENT',
    });
    expect(mocks.executeIncidentCreation).not.toHaveBeenCalled();
  });
});
