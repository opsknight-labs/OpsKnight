import { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';

/**
 * Optimistic concurrency for editable resources.
 *
 * Detail reads return a strong validator, `ETag: "<revision>"`. `revision` is a dedicated
 * monotonic counter that a database trigger increments on every UPDATE of the row, from any code
 * path, so two writes can never share a validator (unlike a millisecond timestamp). Escalation
 * policies move their revision on every edit, including steps-only edits, because their update
 * always touches the parent row. A write that sends `If-Match` is applied only if the row still
 * carries that revision; otherwise the request fails with 412 instead of silently overwriting a
 * newer change. The check is part of the UPDATE's WHERE clause, so it is atomic with the write and
 * holds across replicas. `If-Match` is optional: omitting it keeps last-write-wins.
 *
 * RFC 9110 compares `If-Match` strongly, so a weak validator (`W/"..."`) can never match and is
 * answered with 412. Related data embedded only for reading (for example the services referencing
 * an escalation policy) is not covered by the validator.
 */
export function etagFor(revision: number): string {
  return `"${revision}"`;
}

export function etagHeaders(revision: number): Record<string, string> {
  return { ETag: etagFor(revision) };
}

/** Parse If-Match into the expected revision, or null when absent or `*`. */
export function parseIfMatch(req: Request): number | null {
  const raw = req.headers.get('if-match')?.trim();
  if (!raw || raw === '*') return null;
  if (raw.includes(',')) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'If-Match supports a single ETag.',
      fields: [{ field: 'If-Match', code: 'invalid', message: 'Send one ETag.' }],
    });
  }
  // A weak validator never satisfies strong comparison (RFC 9110 section 13.1.1).
  if (raw.startsWith('W/')) throw preconditionFailed();
  const match = /^"(\d{1,10})"$/.exec(raw);
  if (!match || Number(match[1]) > 2_147_483_647) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'If-Match must be an ETag previously returned by this API.',
      fields: [{ field: 'If-Match', code: 'invalid', message: 'Malformed ETag.' }],
    });
  }
  return Number(match[1]);
}

/** Extra `where` condition that makes an UPDATE conditional on the expected revision. */
export function ifMatchWhere(expected: number | null): { revision?: number } {
  return expected === null ? {} : { revision: expected };
}

/** Throw 412 when a version-conditional write matched no row. */
export function preconditionFailed(): AppError {
  return new AppError({ code: 'PRECONDITION_FAILED' });
}

/**
 * Run a write that used `ifMatchWhere`, translating "record not found" (the
 * version no longer matches) into 412. Without If-Match, errors pass through.
 */
export async function withIfMatch<T>(expected: number | null, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      expected !== null &&
      (error instanceof Prisma.PrismaClientKnownRequestError || (error as any)?.code === 'P2025') &&
      (error as any)?.code === 'P2025'
    ) {
      throw preconditionFailed();
    }
    throw error;
  }
}

/** Sensitive writes require a precondition; `*` retains RFC existence semantics. */
export function requireIfMatch(req: Request): number | null {
  if (!req.headers.get('if-match')?.trim()) {
    throw new AppError({ code: 'PRECONDITION_REQUIRED' });
  }
  return parseIfMatch(req);
}

/** Authoring writes must compare an exact revision, never just resource existence. */
export function requireRevisionIfMatch(req: Request): number {
  const revision = requireIfMatch(req);
  if (revision === null) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'If-Match must contain a concrete strong revision ETag; wildcard is unsupported.',
      fields: [{ field: 'If-Match', code: 'invalid', message: 'Send the draft ETag.' }],
    });
  }
  return revision;
}
