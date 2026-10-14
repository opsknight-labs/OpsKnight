import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { isAppError, normalizeError, toPublicAppError } from '@/lib/errors';
import { createApiResponseContext, type ApiResponseContext } from '@/lib/api-response';
import type {
  ApiV2Pagination,
  ApiV2ProblemDetails,
  ApiV2SuccessEnvelope,
  ApiV2ValidationErrorField,
} from './types';

const ERROR_TYPE_PREFIX = 'https://opsknight.com/errors/';

function sanitizeJsonValue<T>(value: T): T {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return (Number.isSafeInteger(asNumber) ? asNumber : value.toString()) as unknown as T;
  }
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString() as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => sanitizeJsonValue(item)) as unknown as T;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      ([key, nested]) =>
        key !== '__proto__' &&
        key !== 'constructor' &&
        key !== 'prototype' &&
        nested !== undefined
    )
    .map(([key, nested]) => [key, sanitizeJsonValue(nested)] as const);

  return Object.fromEntries(entries) as T;
}

export function apiV2Success<T>(
  data: T,
  options: {
    status?: number;
    pagination?: ApiV2Pagination;
    headers?: HeadersInit;
    context?: ApiResponseContext;
  } = {}
): NextResponse {
  const context = options.context ?? createApiResponseContext();
  const safeData = sanitizeJsonValue(data);

  const envelope: ApiV2SuccessEnvelope<T> = {
    data: safeData,
    ...(options.pagination ? { pagination: options.pagination } : {}),
    requestId: context.requestId,
    timestamp: context.timestamp,
  };

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('x-request-id', context.requestId);

  return NextResponse.json(envelope, {
    status: options.status ?? 200,
    headers,
  });
}

export function apiV2Created<T>(
  data: T,
  options: {
    pagination?: ApiV2Pagination;
    headers?: HeadersInit;
    context?: ApiResponseContext;
  } = {}
): NextResponse {
  return apiV2Success(data, { ...options, status: 201 });
}

export function apiV2NoContent(
  optionsOrHeaders?:
    | HeadersInit
    | {
        headers?: HeadersInit;
        context?: ApiResponseContext;
      }
): NextResponse {
  let headersInit: HeadersInit | undefined;
  let context: ApiResponseContext | undefined;

  if (optionsOrHeaders) {
    if (
      typeof optionsOrHeaders === 'object' &&
      ('headers' in optionsOrHeaders || 'context' in optionsOrHeaders) &&
      !(optionsOrHeaders instanceof Headers) &&
      !Array.isArray(optionsOrHeaders)
    ) {
      const opts = optionsOrHeaders as { headers?: HeadersInit; context?: ApiResponseContext };
      headersInit = opts.headers;
      context = opts.context;
    } else {
      headersInit = optionsOrHeaders as HeadersInit;
    }
  }

  const ctx = context ?? createApiResponseContext();
  const headers = new Headers(headersInit);
  headers.set('x-request-id', ctx.requestId);

  return new NextResponse(null, {
    status: 204,
    headers,
  });
}


export function apiV2Error(
  error: unknown,
  req?: Request,
  options: {
    status?: number;
    headers?: HeadersInit;
    context?: ApiResponseContext;
  } = {}
): NextResponse {
  const context = options.context ?? createApiResponseContext(req ? { headers: req.headers } : undefined);
  const instance = req ? new URL(req.url).pathname : '/api/v2';

  let status = options.status ?? 500;
  let code = 'INTERNAL_ERROR';
  let title = 'Internal Server Error';
  let detail = 'An unexpected error occurred while processing the request.';
  let retryable = false;
  let fields: ApiV2ValidationErrorField[] | undefined;
  let meta: Record<string, unknown> | undefined;

  if (error instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_FAILED';
    title = 'Validation Failed';
    detail = 'One or more request parameters failed validation.';
    retryable = false;
    fields = error.issues.map(issue => ({
      field: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    }));
  } else if (isAppError(error)) {
    const publicError = toPublicAppError(error);
    status = options.status ?? error.status;
    code = publicError.code;
    title = code.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    detail = publicError.message;
    retryable = publicError.retryable;
    if (publicError.fields && publicError.fields.length > 0) {
      fields = publicError.fields.map(f => ({
        field: f.field,
        code: f.code ?? 'invalid',
        message: f.message ?? 'Invalid value',
      }));
    }
    if (error.details) {
      meta = sanitizeJsonValue(error.details);
    }
  } else if (typeof error === 'string') {
    status = options.status ?? 400;
    code = status === 404 ? 'RESOURCE_NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHORIZED' : 'BAD_REQUEST';
    title = code.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    detail = error;
    retryable = status >= 500;
  } else if (error instanceof Error) {
    const normalized = normalizeError(error);
    const publicError = toPublicAppError(normalized);
    status = options.status ?? normalized.status;
    code = publicError.code;
    title = code.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
    detail = publicError.message;
    retryable = publicError.retryable;
  }

  const problem: ApiV2ProblemDetails = {
    type: `${ERROR_TYPE_PREFIX}${code.toLowerCase().replace(/_/g, '-')}`,
    title,
    status,
    detail,
    instance,
    code,
    requestId: context.requestId,
    timestamp: context.timestamp,
    retryable,
    ...(fields ? { fields } : {}),
    ...(meta ? { meta } : {}),
  };

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/problem+json; charset=utf-8');
  headers.set('x-request-id', context.requestId);

  if (status === 429 || code === 'RATE_LIMIT_EXCEEDED') {
    if (meta && typeof meta.retryAfter === 'number' && !headers.has('Retry-After')) {
      headers.set('Retry-After', String(meta.retryAfter));
    }
    if (meta && typeof meta.limit === 'number' && !headers.has('X-RateLimit-Limit')) {
      headers.set('X-RateLimit-Limit', String(meta.limit));
    }
    if (meta && typeof meta.remaining === 'number' && !headers.has('X-RateLimit-Remaining')) {
      headers.set('X-RateLimit-Remaining', String(meta.remaining));
    }
  }

  return NextResponse.json(problem, {
    status,
    headers,
  });
}
