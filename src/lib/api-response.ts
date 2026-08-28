import { NextResponse } from 'next/server';
import { isAppError, normalizeError, toPublicAppError, type AppError } from './errors';

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

  // Plain strings are an explicit legacy public contract. Do not reinterpret
  // their English wording. Unexpected exceptions are normalized to the safe
  // INTERNAL_ERROR contract instead of passing through a text translator.
  if (typeof error === 'string') {
    return NextResponse.json({ error, meta }, { status: status ?? 500, headers });
  }

  const normalized = normalizeError(error);
  const publicError = toPublicAppError(normalized);
  return NextResponse.json(
    {
      error: publicError.message,
      code: publicError.code,
      action: publicError.action,
      retryable: publicError.retryable,
      fields: publicError.fields,
      meta,
    },
    { status: normalized.status, headers }
  );
}

export function jsonOk<T>(payload: T, status: number = 200, headers?: HeadersInit) {
  return NextResponse.json(payload, { status, headers });
}
