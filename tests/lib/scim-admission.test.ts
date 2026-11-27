import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SCIM pre-database admission', () => {
  it('bounds unknown tokens by trusted client address without storing raw addresses', async () => {
    const { acquireScimAdmission } = await import('@/lib/scim/security/admission');
    for (let i = 0; i < 120; i++)
      (await acquireScimAdmission(`ip-one-${i}`, '192.0.2.1')).release();
    await expect(acquireScimAdmission('excess', '192.0.2.1')).rejects.toThrow('network admission');
    (await acquireScimAdmission('other-network', '192.0.2.2')).release();
    vi.advanceTimersByTime(60000);
    (await acquireScimAdmission('new-window', '192.0.2.1')).release();
  });
  it('bounds distinct token concurrency and releases capacity after failures', async () => {
    const { acquireScimAdmission } = await import('@/lib/scim/security/admission');
    vi.useRealTimers();
    const first = await acquireScimAdmission('one');
    const second = await acquireScimAdmission('two');
    const flood = await Promise.allSettled(
      Array.from({ length: 1000 }, (_, i) => acquireScimAdmission(`random-${i}`))
    );
    expect(flood.every(result => result.status === 'rejected')).toBe(true);
    first.release();
    first.release();
    second.release();
    const next = await acquireScimAdmission('three');
    next.release();
  });
  it('bounds sequential distinct-token work and preserves a revalidated credential lane', async () => {
    const { acquireScimAdmission } = await import('@/lib/scim/security/admission');
    const known = await acquireScimAdmission('verified');
    known.remember(true);
    known.release();
    for (let i = 0; i < 1199; i++) (await acquireScimAdmission(`random-${i}`)).release();
    await expect(acquireScimAdmission('new')).rejects.toThrow('busy');
    const priority = await acquireScimAdmission('verified');
    priority.remember(false);
    priority.release();
    await expect(acquireScimAdmission('verified')).rejects.toThrow('busy');
    vi.advanceTimersByTime(60000);
    (await acquireScimAdmission('new')).release();
  });
  it('keeps a flood from other addresses from starving an idle directory behind its own address', async () => {
    const { acquireScimAdmission } = await import('@/lib/scim/security/admission');
    // 1,200 random-token attempts spread over ten addresses used to exhaust the one shared budget.
    for (let address = 1; address <= 10; address++)
      for (let i = 0; i < 120; i++)
        (await acquireScimAdmission(`flood-${address}-${i}`, `192.0.2.${address}`)).release();

    (await acquireScimAdmission('idle-idp-token', '198.51.100.7')).release();
    // The flooding addresses themselves are still limited.
    await expect(acquireScimAdmission('more', '192.0.2.1')).rejects.toThrow('network admission');
  });
  it('caps a flood spread over many addresses without starving a verified directory', async () => {
    const { acquireScimAdmission } = await import('@/lib/scim/security/admission');
    const known = await acquireScimAdmission('verified-directory', '203.0.113.9');
    known.remember(true);
    known.release();
    // Up to the 6,000 per-minute ceiling (the verification above was the first), about 100 from each
    // of 60 addresses, so every address stays under its own 120 limit.
    for (let n = 0; n < 5999; n++)
      (await acquireScimAdmission(`spread-${n}`, `192.0.2.${(n % 60) + 1}`)).release();
    await expect(acquireScimAdmission('one-more', '198.51.100.200')).rejects.toThrow('busy');

    // The directory whose credential was verified recently still gets in, from any address.
    (await acquireScimAdmission('verified-directory', '203.0.113.9')).release();
    vi.advanceTimersByTime(60000);
    (await acquireScimAdmission('one-more', '198.51.100.200')).release();
  });
});
