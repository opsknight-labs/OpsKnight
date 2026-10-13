import { createHmac } from 'node:crypto';
import { AppError } from '@/lib/errors';
import type { ApiV2CursorPayload, ApiV2Pagination } from './types';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

function cursorSignature(payload: { id: string; createdAt: string }): string {
  const secret = process.env.NEXTAUTH_SECRET || 'opsknight-v2-pagination-salt';
  return createHmac('sha256', secret)
    .update(`${payload.id}:${payload.createdAt}`)
    .digest('base64url')
    .slice(0, 16);
}

export function parsePaginationParams(searchParams: URLSearchParams): {
  limit: number;
  cursor: string | null;
} {
  const limitParam = searchParams.get('limit');
  const cursorParam = searchParams.get('cursor')?.trim() || null;

  let limit = DEFAULT_PAGE_LIMIT;
  if (limitParam !== null) {
    const parsed = Number(limitParam);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new AppError({
        code: 'INVALID_PAGINATION_LIMIT',
        userMessage: `Limit must be a positive integer between 1 and ${MAX_PAGE_LIMIT}.`,
      });
    }
    limit = Math.min(parsed, MAX_PAGE_LIMIT);
  }

  return { limit, cursor: cursorParam };
}

export function encodeCursor(payload: ApiV2CursorPayload): string {
  const sig = cursorSignature({ id: payload.id, createdAt: payload.createdAt });
  const json = JSON.stringify({ id: payload.id, createdAt: payload.createdAt, sig });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(cursorString: string): ApiV2CursorPayload {
  try {
    const raw = Buffer.from(cursorString, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.id === 'string' &&
      parsed.id.length > 0 &&
      typeof parsed.createdAt === 'string' &&
      !Number.isNaN(new Date(parsed.createdAt).getTime())
    ) {
      if (typeof parsed.sig === 'string') {
        const expectedSig = cursorSignature({ id: parsed.id, createdAt: parsed.createdAt });
        if (parsed.sig !== expectedSig) {
          throw new AppError({
            code: 'INVALID_PAGINATION_CURSOR',
            userMessage: 'The provided pagination cursor signature is invalid or has been modified.',
          });
        }
      }
      return { id: parsed.id, createdAt: parsed.createdAt };
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
  }

  throw new AppError({
    code: 'INVALID_PAGINATION_CURSOR',
    userMessage: 'The provided pagination cursor is invalid or malformed.',
  });
}

export function buildCursorWhere(cursorString?: string | null) {
  if (!cursorString) return {};
  const cursor = decodeCursor(cursorString);
  const cursorDate = new Date(cursor.createdAt);

  return {
    OR: [
      { createdAt: { lt: cursorDate } },
      {
        createdAt: cursorDate,
        id: { lt: cursor.id },
      },
    ],
  };
}

export function formatCursorPagination<T extends { id: string; createdAt: Date | string }>(
  items: T[],
  limit: number
): { data: T[]; pagination: ApiV2Pagination } {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;
  if (hasMore && data.length > 0) {
    const lastItem = data[data.length - 1];
    const createdAtIso =
      lastItem.createdAt instanceof Date
        ? lastItem.createdAt.toISOString()
        : String(lastItem.createdAt);
    nextCursor = encodeCursor({ id: lastItem.id, createdAt: createdAtIso });
  }

  return {
    data,
    pagination: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}
