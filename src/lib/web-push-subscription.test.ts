import { describe, expect, it } from 'vitest';

describe('web push endpoint identity', () => {
  it('uses an opaque fingerprint instead of the raw endpoint', async () => {
    const { webPushDeviceKey } = await import('./web-push-subscription');
    const endpoint = 'https://push.example.test/send/secret-capability';
    const key = webPushDeviceKey(endpoint);
    expect(key).toMatch(/^web:[0-9a-f]{64}$/);
    expect(key).not.toContain(endpoint);
    expect(key).not.toContain('secret-capability');
  });
});
