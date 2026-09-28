import { NextResponse } from 'next/server';
import { isAppError, normalizeError, toPublicAppError, type AppError } from './errors';
import { getRequestContext } from './request-context';

export const API_DATA_STATES = ['available', 'partial', 'no_data', 'stale', 'unavailable'] as const;

export type ApiDataState = (typeof API_DATA_STATES)[number];

export interface ApiWarning {
  code: string;
  message: string;
  action?: string;
}

export interface ApiOffsetPagination {
  mode: 'offset';
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiCursorPagination {
  mode: 'cursor';
  limit: number;
  nextCursor: string | null;
  previousCursor?: string | null;
  hasMore: boolean;
}

export type ApiPagination = ApiOffsetPagination | ApiCursorPagination;

export interface ApiResponseContext {
  requestId: string;
  timestamp: string;
}

export interface ApiSuccessEnvelope<T> extends ApiResponseContext {
  success: true;
  data: T;
  dataState: Exclude<ApiDataState, 'unavailable'>;
  pagination?: ApiPagination;
  warnings?: ApiWarning[];
}

export interface ApiErrorEnvelope extends ApiResponseContext {
  success: false;
  dataState: 'unavailable';
  error: string;
  code: string;
  action?: string;
  retryable: boolean;
  fields?: ReturnType<typeof toPublicAppError>['fields'];
  meta?: Record<string, unknown>;
  warnings?: ApiWarning[];
}

interface CanonicalResponseOptions {
  context?: ApiResponseContext;
  headers?: HeadersInit;
  warnings?: ApiWarning[];
}

export interface ApiSuccessOptions extends CanonicalResponseOptions {
  status?: number;
  dataState?: Exclude<ApiDataState, 'unavailable'>;
  pagination?: ApiPagination;
}

export interface ApiErrorOptions extends CanonicalResponseOptions {
  meta?: Record<string, unknown>;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function validRequestId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && REQUEST_ID_PATTERN.test(normalized) ? normalized : undefined;
}

/**
 * Creates immutable response metadata once per request. Pass the returned
 * context to every response path so success and error responses correlate to
 * the same request and timestamp source.
 */
export function createApiResponseContext(
  request?: Pick<Request, 'headers'>,
  now: Date = new Date()
): ApiResponseContext {
  const requestId =
    validRequestId(request?.headers.get('x-request-id')) ??
    validRequestId(getRequestContext().requestId) ??
    crypto.randomUUID();

  return { requestId, timestamp: now.toISOString() };
}

function responseHeaders(context: ApiResponseContext, init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set('x-request-id', context.requestId);
  return headers;
}

function sanitizeJsonValue<T>(value: T): T {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return (Number.isSafeInteger(asNumber) ? asNumber : value.toString()) as unknown as T;
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeJsonValue(item)) as unknown as T;
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      !Object.prototype.hasOwnProperty.call(value, key)
    ) {
      continue;
    }
    if (nested !== undefined) {
      // eslint-disable-next-line security/detect-object-injection
      out[key] = sanitizeJsonValue(nested);
    }
  }
  return { ...out } as T;
}

/** Canonical success response. Legacy endpoints may continue using jsonOk during migration. */
export function jsonApiOk<T>(payload: T, options: ApiSuccessOptions = {}) {
  const context = options.context ?? createApiResponseContext();
  const safePayload = sanitizeJsonValue(payload);
  const body: ApiSuccessEnvelope<T> = {
    success: true,
    data: safePayload,
    dataState: options.dataState ?? (payload === null ? 'no_data' : 'available'),
    requestId: context.requestId,
    timestamp: context.timestamp,
    ...(options.pagination ? { pagination: options.pagination } : {}),
    ...(options.warnings?.length ? { warnings: options.warnings } : {}),
  };

  return NextResponse.json(body, {
    status: options.status ?? 200,
    headers: responseHeaders(context, options.headers),
  });
}

/** Canonical typed error response. Unknown exceptions are safely normalized. */
export function jsonApiError(error: AppError | unknown, options: ApiErrorOptions = {}) {
  const context = options.context ?? createApiResponseContext();
  const normalized = isAppError(error) ? error : normalizeError(error);
  const publicError = toPublicAppError(normalized);
  const body: ApiErrorEnvelope = {
    success: false,
    dataState: 'unavailable',
    error: publicError.message,
    code: publicError.code,
    action: publicError.action,
    retryable: publicError.retryable,
    fields: publicError.fields,
    requestId: context.requestId,
    timestamp: context.timestamp,
    meta: options.meta ? sanitizeJsonValue(options.meta) : undefined,
    ...(options.warnings?.length ? { warnings: options.warnings } : {}),
  };

  return NextResponse.json(body, {
    status: normalized.status,
    headers: responseHeaders(context, options.headers),
  });
}

export function jsonError(
  error: string | AppError | unknown,
  status?: number,
  meta?: Record<string, unknown>,
  headers?: HeadersInit
) {
  const context = createApiResponseContext();
  const safeMeta = meta ? sanitizeJsonValue(meta) : meta;
  if (isAppError(error)) {
    const publicError = toPublicAppError(error);

    return NextResponse.json(
      {
        success: false,
        dataState: 'unavailable',
        // Preserve the existing string field for backward compatibility while
        // exposing stable machine-readable semantics to new clients.
        error: publicError.message,
        code: publicError.code,
        action: publicError.action,
        retryable: publicError.retryable,
        fields: publicError.fields,
        meta: safeMeta,
        requestId: context.requestId,
        timestamp: context.timestamp,
      },
      { status: error.status, headers: responseHeaders(context, headers) }
    );
  }

  // Plain strings are an explicit legacy public contract. Do not reinterpret
  // their English wording. Unexpected exceptions are normalized to the safe
  // INTERNAL_ERROR contract instead of passing through a text translator.
  if (typeof error === 'string') {
    return NextResponse.json(
      {
        success: false,
        dataState: 'unavailable',
        error,
        code: 'LEGACY_API_ERROR',
        retryable: (status ?? 500) >= 500,
        meta: safeMeta,
        requestId: context.requestId,
        timestamp: context.timestamp,
      },
      { status: status ?? 500, headers: responseHeaders(context, headers) }
    );
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
      meta: safeMeta,
      success: false,
      dataState: 'unavailable',
      requestId: context.requestId,
      timestamp: context.timestamp,
    },
    { status: normalized.status, headers: responseHeaders(context, headers) }
  );
}

export function jsonOk<T>(
  payload: T,
  status: number = 200,
  headers?: HeadersInit,
  legacyAliases?: Record<string, unknown>
) {
  const context = createApiResponseContext();
  const safePayload = sanitizeJsonValue(payload);
  const safeLegacyAliases = legacyAliases ? sanitizeJsonValue(legacyAliases) : undefined;
  const aliases =
    safeLegacyAliases ??
    (safePayload !== null && typeof safePayload === 'object' && !Array.isArray(safePayload)
      ? (safePayload as Record<string, unknown>)
      : {});
  const body: ApiSuccessEnvelope<T> & Record<string, unknown> = {
    ...aliases,
    success: true,
    data: safePayload,
    dataState: payload === null ? 'no_data' : 'available',
    requestId: context.requestId,
    timestamp: context.timestamp,
  };

  return NextResponse.json(body, { status, headers: responseHeaders(context, headers) });
}
