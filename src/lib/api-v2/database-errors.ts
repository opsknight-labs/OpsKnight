import { Prisma } from '@prisma/client';
import { AppError, isAppError } from '@/lib/errors';

/**
 * Translate Prisma/driver failures into the public error contract so every route
 * answers the same way: uniqueness and reference violations are 409, a missing
 * row is 404, serialization failures and deadlocks are a retryable 409, and
 * connectivity or pool exhaustion is a retryable 503. Anything else is left for
 * the default (500) handling and its details are never exposed.
 */
const UNAVAILABLE_CODES = new Set([
  'P1001', // cannot reach database server
  'P1002', // database server timed out
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // timed out fetching a connection from the pool
]);

export function mapDatabaseError(error: unknown): unknown {
  if (isAppError(error)) return error;

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
      case 'P2003':
        return new AppError({ code: 'RESOURCE_CONFLICT', cause: error });
      case 'P2025':
        return new AppError({ code: 'RESOURCE_NOT_FOUND', cause: error });
      case 'P2034':
        return new AppError({ code: 'TRANSIENT_CONFLICT', cause: error });
      default:
        if (UNAVAILABLE_CODES.has(error.code)) {
          return new AppError({
            code: 'DATABASE_UNAVAILABLE',
            cause: error,
            details: { retryAfter: 2 },
          });
        }
    }
  }
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new AppError({ code: 'DATABASE_UNAVAILABLE', cause: error, details: { retryAfter: 2 } });
  }
  return error;
}
