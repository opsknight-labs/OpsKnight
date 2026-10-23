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
});
