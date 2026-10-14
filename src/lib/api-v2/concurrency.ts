import type { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';

/**
 * Optimistic concurrency for editable resources.
 *
 * Detail reads return `ETag: W/"<updatedAt in epoch ms>"`. A write that sends
 * `If-Match` is applied only if the row still carries that `updatedAt`; otherwise
 * the request fails with 412 instead of silently overwriting a newer change. The
 * check is part of the UPDATE's WHERE clause, so it is atomic with the write and
 * holds across replicas. `If-Match` is optional: omitting it keeps last-write-wins.
 */
export function etagFor(updatedAt: Date): string {
  return `W/"${updatedAt.getTime()}"`;
}

export function etagHeaders(updatedAt: Date): Record<string, string> {
  return { ETag: etagFor(updatedAt) };
}

/** Parse If-Match into the expected updatedAt, or null when absent or `*`. */
export function parseIfMatch(req: NextRequest): Date | null {
  const raw = req.headers.get('if-match')?.trim();
  if (!raw || raw === '*') return null;
  const match = /^(?:W\/)?"(\d{1,16})"$/.exec(raw);
  if (!match) {
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'If-Match must be an ETag previously returned by this API.',
      fields: [{ field: 'If-Match', code: 'invalid', message: 'Malformed ETag.' }],
    });
  }
  return new Date(Number(match[1]));
}

/** Extra `where` condition that makes an UPDATE conditional on the expected version. */
export function ifMatchWhere(expected: Date | null): { updatedAt?: Date } {
  return expected ? { updatedAt: expected } : {};
}

/** Throw 412 when a version-conditional write matched no row. */
export function preconditionFailed(): AppError {
  return new AppError({ code: 'PRECONDITION_FAILED' });
}

/**
 * Run a write that used `ifMatchWhere`, translating "record not found" (the
 * version no longer matches) into 412. Without If-Match, errors pass through.
 */
export async function withIfMatch<T>(expected: Date | null, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (
      expected &&
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw preconditionFailed();
    }
    throw error;
  }
}
