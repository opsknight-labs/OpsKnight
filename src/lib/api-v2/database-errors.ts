import { Prisma } from '@prisma/client';
import { isDatabaseUnavailableError, toPrismaClientError } from '@/lib/db/errors';
import { AppError, isAppError } from '@/lib/errors';
import { postgresSqlState } from '@/lib/postgres-error';

/**
 * Translate Prisma/driver failures into the public error contract so every route
 * answers the same way: uniqueness and reference violations are 409, a missing
 * row is 404, serialization failures and deadlocks are a retryable 409, and
 * connectivity or pool exhaustion is a retryable 503. Anything else is left for
 * the default (500) handling and its details are never exposed.
 */
export function mapDatabaseError(rawError: unknown): unknown {
  if (isAppError(rawError)) return rawError;
  const error = toPrismaClientError(rawError);
  const state = postgresSqlState(error);
  if (state === '40001' || state === '40P01')
    return new AppError({ code: 'TRANSIENT_CONFLICT', cause: error });
  if (state === '57014')
    return new AppError({ code: 'DATABASE_UNAVAILABLE', cause: error, details: { retryAfter: 2 } });

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
      case 'P2003':
        return new AppError({ code: 'RESOURCE_CONFLICT', cause: error });
      case 'P2025':
        return new AppError({ code: 'RESOURCE_NOT_FOUND', cause: error });
      case 'P2034':
        return new AppError({ code: 'TRANSIENT_CONFLICT', cause: error });
    }
  }
  // Connectivity, pool exhaustion and database configuration failures (Prisma 5 engine codes,
  // Prisma 7 adapter kinds, initialization and engine panics) are a retryable 503.
  if (isDatabaseUnavailableError(error)) {
    return new AppError({ code: 'DATABASE_UNAVAILABLE', cause: error, details: { retryAfter: 2 } });
  }
  return rawError;
}
