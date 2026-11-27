import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertResponderOrAbove: vi.fn(),
  incidentUpdate: vi.fn(),
  withholdStatusPagesForService: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({ assertResponderOrAbove: mocks.assertResponderOrAbove }));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { incident: { update: mocks.incidentUpdate } },
}));
vi.mock('@/lib/status-pages/snapshot', () => ({
  withholdStatusPagesForService: mocks.withholdStatusPagesForService,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { updateIncidentVisibility } from '@/app/(app)/incidents/actions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.incidentUpdate.mockResolvedValue({ serviceId: 'svc-1' });
});

describe('updateIncidentVisibility', () => {
  it('withholds the public status pages of the incident service as soon as it goes private', async () => {
    await updateIncidentVisibility('inc-1', 'PRIVATE');
    expect(mocks.withholdStatusPagesForService).toHaveBeenCalledWith('svc-1');
  });

  it('leaves the pages alone when the incident becomes public (the projector widens it)', async () => {
    await updateIncidentVisibility('inc-1', 'PUBLIC');
    expect(mocks.withholdStatusPagesForService).not.toHaveBeenCalled();
  });
});
