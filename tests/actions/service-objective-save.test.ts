import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));

vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn().mockResolvedValue({ id: 'admin-1' }) }));
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: (fn: (tx: object) => Promise<unknown>) => fn({}),
}));
vi.mock('@/lib/slo/commands', () => ({
  createServiceObjective: mocks.create,
  updateServiceObjective: mocks.update,
  archiveServiceObjective: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { AppError } from '@/lib/errors';
import { saveObjective } from '@/app/(app)/settings/service-objectives/actions';

function form(operation: string) {
  const data = new FormData();
  data.set('operation', operation);
  data.set('id', 'so_1');
  data.set('version', '2');
  data.set('serviceId', 'svc-1');
  data.set('metricType', 'UPTIME');
  data.set('name', 'Uptime');
  data.set('target', '99.9');
  data.set('comparator', 'GREATER_THAN_OR_EQUAL');
  data.set('windowType', 'ROLLING_DAYS');
  data.set('windowValue', '30');
  return data;
}

describe('saveObjective', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains an occupied slot instead of a generic concurrency error on create', async () => {
    mocks.create.mockRejectedValue(new AppError({ code: 'PRECONDITION_FAILED' }));

    await expect(saveObjective({ message: '', ok: false }, form('create'))).resolves.toEqual({
      message: 'An active objective already exists for this service and metric. Edit it instead.',
      ok: false,
    });
  });

  it('keeps the concurrency message when an edit loses a race', async () => {
    mocks.update.mockRejectedValue(new AppError({ code: 'PRECONDITION_FAILED' }));

    await expect(saveObjective({ message: '', ok: false }, form('update'))).resolves.toEqual({
      message: 'The resource was modified since it was read.',
      ok: false,
    });
  });
});
