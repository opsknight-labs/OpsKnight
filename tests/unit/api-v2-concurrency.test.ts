import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { etagFor, ifMatchWhere, parseIfMatch } from '@/lib/api-v2/concurrency';

const req = (ifMatch?: string) =>
  new NextRequest('http://localhost:3000/api/v2/teams/t1', {
    method: 'PATCH',
    headers: ifMatch ? { 'if-match': ifMatch } : {},
  });

describe('API v2 ETag / If-Match', () => {
  it('issues a strong validator from the monotonic revision, never a weak one', () => {
    expect(etagFor(7)).toBe('"7"');
    expect(etagFor(7).startsWith('W/')).toBe(false);
  });

  it('round-trips an issued ETag into an exact-revision condition', () => {
    const expected = parseIfMatch(req(etagFor(42)));
    expect(expected).toBe(42);
    expect(ifMatchWhere(expected)).toEqual({ revision: 42 });
    // Revision 0 is a real value, not "no precondition".
    expect(ifMatchWhere(0)).toEqual({ revision: 0 });
  });

  it('rejects revisions that cannot fit the column', () => {
    expect(() => parseIfMatch(req('"99999999999"'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' })
    );
  });

  it('treats a missing header and * as no precondition', () => {
    expect(parseIfMatch(req())).toBeNull();
    expect(parseIfMatch(req('*'))).toBeNull();
    expect(ifMatchWhere(null)).toEqual({});
  });

  it('answers a weak validator with 412 because it cannot match under strong comparison', () => {
    expect(() => parseIfMatch(req('W/"7"'))).toThrowError(
      expect.objectContaining({ code: 'PRECONDITION_FAILED' })
    );
  });

  it('rejects malformed or multiple ETags with a validation error', () => {
    expect(() => parseIfMatch(req('abc'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' })
    );
    expect(() => parseIfMatch(req('"1", "2"'))).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_FAILED' })
    );
  });
});
