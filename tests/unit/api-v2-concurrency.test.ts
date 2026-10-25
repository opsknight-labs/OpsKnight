import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { etagFor, ifMatchWhere, parseIfMatch, withIfMatch } from '@/lib/api-v2/concurrency';

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

  describe('withIfMatch (DEF-05 regression)', () => {
    it('translates P2025 into PRECONDITION_FAILED (412) even across bundler/chunk boundaries', async () => {
      // Simulate error where code === 'P2025' but not instanceof Prisma.PrismaClientKnownRequestError
      const syntheticChunkError = Object.assign(new Error('Record to update not found.'), {
        code: 'P2025',
        clientVersion: '5.10.0',
      });

      await expect(
        withIfMatch(3, async () => {
          throw syntheticChunkError;
        })
      ).rejects.toMatchObject({
        code: 'PRECONDITION_FAILED',
        status: 412,
      });
    });

    it('passes through other Prisma errors and non-P2025 errors', async () => {
      const otherError = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });

      await expect(
        withIfMatch(3, async () => {
          throw otherError;
        })
      ).rejects.toThrow('Unique constraint failed');
    });

    it('passes through P2025 when expected is null (unconditional write)', async () => {
      const p2025Error = Object.assign(new Error('Record not found'), { code: 'P2025' });

      await expect(
        withIfMatch(null, async () => {
          throw p2025Error;
        })
      ).rejects.toThrow('Record not found');
    });
  });
});
