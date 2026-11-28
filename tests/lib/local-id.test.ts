import { afterEach, describe, expect, it, vi } from 'vitest';
import { localId } from '@/lib/local-id';

describe('localId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the browser has it', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'fixed-id' });
    expect(localId()).toBe('fixed-id');
  });

  it('still returns a UUID-shaped, unique id on a plain-http origin without randomUUID', () => {
    vi.stubGlobal('crypto', {});
    const ids = new Set(Array.from({ length: 200 }, () => localId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it('works when there is no crypto object at all', () => {
    vi.stubGlobal('crypto', undefined);
    expect(localId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
