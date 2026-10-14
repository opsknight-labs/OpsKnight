import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { etagFor, ifMatchWhere, parseIfMatch } from '@/lib/api-v2/concurrency';

const req = (ifMatch?: string) =>
  new NextRequest('http://localhost:3000/api/v2/teams/t1', {
    method: 'PATCH',
    headers: ifMatch ? { 'if-match': ifMatch } : {},
  });

describe('API v2 ETag / If-Match', () => {
  it('issues a strong validator, never a weak one', () => {
    const tag = etagFor(new Date('2026-10-14T10:00:00.123Z'));
    expect(tag).toBe(`"${new Date('2026-10-14T10:00:00.123Z').getTime()}"`);
    expect(tag.startsWith('W/')).toBe(false);
  });

  it('round-trips an issued ETag into an exact-revision condition', () => {
    const updatedAt = new Date('2026-10-14T10:00:00.123Z');
    const expected = parseIfMatch(req(etagFor(updatedAt)));
    expect(expected?.getTime()).toBe(updatedAt.getTime());
    expect(ifMatchWhere(expected)).toEqual({ updatedAt: expected });
  });

  it('treats a missing header and * as no precondition', () => {
    expect(parseIfMatch(req())).toBeNull();
    expect(parseIfMatch(req('*'))).toBeNull();
    expect(ifMatchWhere(null)).toEqual({});
  });

  it('answers a weak validator with 412 because it cannot match under strong comparison', () => {
    expect(() => parseIfMatch(req('W/"1760436000123"'))).toThrowError(
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
