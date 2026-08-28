import {
  isAppErrorCode,
  type AppErrorCode,
  type ErrorField,
} from '@/lib/errors';

export type StructuredErrorPayload = {
  error?: string;
  code?: AppErrorCode;
  action?: string;
  retryable?: boolean;
  fields?: ErrorField[];
};

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asErrorFields(value: unknown): ErrorField[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const fields = value.filter((field): field is ErrorField => {
    if (!field || typeof field !== 'object') return false;
    const candidate = field as Record<string, unknown>;
    return typeof candidate.field === 'string' && typeof candidate.message === 'string';
  });

  return fields.length > 0 ? fields : undefined;
}

/**
 * Reads the public AppError wire/state contract without requiring callers to
 * know whether the error came from a REST response, a server action state, or
 * an Error-like object. Unknown codes are deliberately ignored so legacy
 * string errors continue through the compatibility path.
 */
export function extractStructuredError(value: unknown): StructuredErrorPayload | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const candidate = value as Record<string, unknown>;
  const code = isAppErrorCode(candidate.code) ? candidate.code : undefined;
  const error =
    asTrimmedString(candidate.error) ??
    asTrimmedString(candidate.message) ??
    (value instanceof Error ? asTrimmedString(value.message) : undefined);
  const action = asTrimmedString(candidate.action);
  const retryable = typeof candidate.retryable === 'boolean' ? candidate.retryable : undefined;
  const fields = asErrorFields(candidate.fields);

  if (!code && !error && !action && retryable === undefined && !fields) return undefined;

  return { error, code, action, retryable, fields };
}

export class ClientAppError extends Error {
  readonly code?: AppErrorCode;
  readonly action?: string;
  readonly retryable?: boolean;
  readonly fields?: ErrorField[];

  constructor(payload: StructuredErrorPayload & { error: string }) {
    super(payload.error);
    this.name = 'ClientAppError';
    this.code = payload.code;
    this.action = payload.action;
    this.retryable = payload.retryable;
    this.fields = payload.fields;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function toClientAppError(
  value: unknown,
  fallback = 'The request could not be completed.'
): ClientAppError {
  if (value instanceof ClientAppError) return value;

  const structured = extractStructuredError(value);
  if (structured) {
    return new ClientAppError({
      ...structured,
      error: structured.error ?? fallback,
    });
  }

  if (typeof value === 'string' && value.trim()) {
    return new ClientAppError({ error: value.trim() });
  }

  if (value instanceof Error && value.message.trim()) {
    return new ClientAppError({ error: value.message.trim() });
  }

  return new ClientAppError({ error: fallback });
}

/**
 * Preserve typed error metadata from a failed fetch instead of flattening the
 * response body into `new Error(data.error)`.
 */
export async function errorFromResponse(
  response: Response,
  fallback = `Request failed (${response.status}).`
): Promise<ClientAppError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  return toClientAppError(body, fallback);
}

export async function throwIfResponseError(response: Response, fallback?: string): Promise<void> {
  if (!response.ok) {
    throw await errorFromResponse(response, fallback);
  }
}
