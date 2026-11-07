import { describe, expect, it, vi } from 'vitest';

const record = vi.hoisted(() => vi.fn());
vi.mock('@/lib/intelligence/changes/service', () => ({ recordChange: record }));
vi.mock('@/lib/integrations/handler', () => ({
  createIntegrationHandler:
    (
      options: { schema: { parse: (body: unknown) => unknown } },
      handle: (context: unknown) => Promise<unknown>
    ) =>
    (body: unknown) =>
      handle({
        payload: options.schema.parse(body),
        integration: { serviceId: 'trusted-service' },
      }),
}));
import { POST } from '@/app/api/integrations/changes/route';

describe('changes webhook', () => {
  it('preserves matching labels and component while keeping the authenticated service scope', async () => {
    record.mockResolvedValue({ status: 'created', id: 'change' });
    const invoke = POST as unknown as (body: unknown) => Promise<unknown>;
    await expect(
      invoke({
        serviceId: 'untrusted-service',
        source: 'argo',
        kind: 'config',
        summary: 'Pool resized',
        component: 'checkout',
        labels: { environment: 'prod', replicas: 3 },
      })
    ).resolves.toEqual({ action: 'change_recorded' });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'trusted-service',
        kind: 'CONFIG',
        component: 'checkout',
        labels: { environment: 'prod', replicas: 3 },
      })
    );
  });
});
