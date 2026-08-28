import { NextResponse } from 'next/server';
import { getUserFriendlyError } from './user-friendly-errors';
import { isAppError, toPublicAppError, type AppError } from './errors';

export function jsonError(
  error: string | AppError | unknown,
  status?: number,
  meta?: Record<string, unknown>,
  headers?: HeadersInit
) {
  if (isAppError(error)) {
    const publicError = toPublicAppError(error);

    return NextResponse.json(
      {
        // Preserve the existing string field for backward compatibility while
        // exposing stable machine-readable semantics to new clients.
        error: publicError.message,
        code: publicError.code,
        action: publicError.action,
        retryable: publicError.retryable,
        fields: publicError.fields,
        meta,
      },
      { status: error.status, headers }
    );
  }

  const friendlyMessage = getUserFriendlyError(error);
  return NextResponse.json({ error: friendlyMessage, meta }, { status: status ?? 500, headers });
}

export function jsonOk<T>(payload: T, status: number = 200, headers?: HeadersInit) {
  return NextResponse.json(payload, { status, headers });
}
