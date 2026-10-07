import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ alerts: vi.fn(), access: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: { alert: { findMany: db.alerts } } }));
vi.mock('@/lib/automation/access', () => ({ assertAutomationAccess: db.access }));
import { automationAction } from '@/app/(app)/services/[id]/automation/actions';
beforeEach(() => {
  db.alerts.mockReset();
  db.access.mockReset().mockResolvedValue({ id: 'operator' });
});
it('discovers bounded service-owned recent fields as event mappings without credential exposure', async () => {
  db.alerts.mockResolvedValue([
    { payload: { custom_details: { environment: 'prd', region: 'eu', token: 'private' } } },
    { payload: { custom_details: { environment: 'stg' } } },
  ]);
  const response = await automationAction({ action: 'discoverRecent', serviceId: 'service-a' });
  expect(db.access).toHaveBeenCalledWith('service-a', 'automation.read');
  expect(db.alerts).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { serviceId: 'service-a' },
      take: 20,
      select: { payload: true },
    })
  );
  expect(response.ok).toBe(true);
  if (response.ok)
    expect(response.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'payload.custom_details.environment',
          source: 'EVENT',
          frequency: 2,
        }),
      ])
    );
  expect(JSON.stringify(response)).not.toContain('private');
  expect(JSON.stringify(response)).not.toContain('token');
});
it('does not read alerts when service access is denied', async () => {
  db.access.mockRejectedValue(new Error('Forbidden service'));
  const response = await automationAction({ action: 'discoverRecent', serviceId: 'other-service' });
  expect(response.ok).toBe(false);
  expect(db.alerts).not.toHaveBeenCalled();
});
