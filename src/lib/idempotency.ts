import 'server-only';

import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { AppError } from '@/lib/errors';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const MAX_PRINCIPAL_ID_LENGTH = 200;
const IDEMPOTENCY_TASK = 'IDEMPOTENCY_RECORD';
const DATE_TAG = '__opsknight_date';
const BIGINT_TAG = '__opsknight_bigint';

export type IdempotencyContext = {
  key: string;
  principalId: string;
};

export type IdempotentExecution<T> = {
  value: T;
  replayed: boolean;
};

type PersistedIdempotencyPayload = {
  task: typeof IDEMPOTENCY_TASK;
  scope: string;
  principalId: string;
  requestId: string;
  fingerprint: string;
  result: Prisma.JsonValue;
};

function invalidIdempotencyKey(message: string): AppError {
  return new AppError({
    code: 'IDEMPOTENCY_KEY_INVALID',
    userMessage: message,
    fields: [{ field: 'Idempotency-Key', code: 'invalid', message }],
  });
}

function normalizeContext(context: IdempotencyContext): IdempotencyContext {
  const key = context.key.trim();
  const principalId = context.principalId.trim();

  if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw invalidIdempotencyKey(
      `Idempotency-Key must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`
    );
  }
  if (!principalId || principalId.length > MAX_PRINCIPAL_ID_LENGTH) {
    throw invalidIdempotencyKey('Idempotency principal is invalid.');
  }

  return { key, principalId };
}

function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Date) return `date:${value.toISOString()}`;

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) return `number:${String(value)}`;
      return String(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'bigint':
      return `bigint:${value.toString()}`;
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map(item => canonicalize(item)).join(',')}]`;
      }
      const objectValue = value as Record<string, unknown>;
      const entries = Object.entries(objectValue)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
      return `{${entries.join(',')}}`;
    }
    default:
      return `${typeof value}:${String(value)}`;
  }
}

export function fingerprintIdempotencyPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function recordId(scope: string, context: IdempotencyContext): string {
  return `idem:${scope}:${context.principalId}:${context.key}`;
}

function encodeJson(value: unknown): Prisma.InputJsonValue {
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (value instanceof Date) {
    return { [DATE_TAG]: value.toISOString() };
  }
  if (typeof value === 'bigint') {
    return { [BIGINT_TAG]: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map(item => encodeJson(item)) as Prisma.InputJsonArray;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .map(([key, nested]) => [key, encodeJson(nested)]);
    return Object.fromEntries(entries) as Prisma.InputJsonObject;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw new AppError({
    code: 'INTERNAL_ERROR',
    details: { reason: 'Unsupported idempotency result type', valueType: typeof value },
  });
}

function decodeJson(value: Prisma.JsonValue): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => decodeJson(item));

  const objectValue = value as Record<string, Prisma.JsonValue>;
  const entries = Object.entries(objectValue);
  if (entries.length === 1) {
    const [firstEntry] = entries;
    if (firstEntry) {
      const [key, val] = firstEntry;
      if (key === DATE_TAG && typeof val === 'string') {
        return new Date(val);
      }
      if (key === BIGINT_TAG && typeof val === 'string') {
        return BigInt(val);
      }
    }
  }

  return Object.fromEntries(entries.map(([key, nested]) => [key, decodeJson(nested)]));
}

function parseRecord(payload: Prisma.JsonValue): PersistedIdempotencyPayload | null {
  if (!payload || Array.isArray(payload) || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, Prisma.JsonValue>;
  if (
    candidate.task !== IDEMPOTENCY_TASK ||
    typeof candidate.scope !== 'string' ||
    typeof candidate.principalId !== 'string' ||
    typeof candidate.requestId !== 'string' ||
    typeof candidate.fingerprint !== 'string' ||
    !Object.prototype.hasOwnProperty.call(candidate, 'result')
  ) {
    return null;
  }

  return candidate as unknown as PersistedIdempotencyPayload;
}

/**
 * Executes an operation with a persistent idempotency key inside the caller's
 * transaction. The operation result and the incident mutation commit or roll
 * back together. A deterministic BackgroundJob primary key provides the
 * concurrency fence; runSerializableTransaction retries the losing P2002 race.
 *
 * Completed BackgroundJob cleanup currently gives these records the same
 * seven-day retention window as other completed durable jobs.
 */
export async function executeIdempotentOperation<T>(
  tx: Prisma.TransactionClient,
  input: {
    scope: string;
    context?: IdempotencyContext;
    payload: unknown;
    execute: () => Promise<T>;
  }
): Promise<IdempotentExecution<T>> {
  if (!input.context) {
    return { value: await input.execute(), replayed: false };
  }

  const context = normalizeContext(input.context);
  const fingerprint = fingerprintIdempotencyPayload(input.payload);
  const id = recordId(input.scope, context);
  const existing = await tx.backgroundJob.findUnique({
    where: { id },
    select: { payload: true },
  });

  if (existing) {
    const record = parseRecord(existing.payload);
    if (
      !record ||
      record.scope !== input.scope ||
      record.principalId !== context.principalId ||
      record.requestId !== context.key
    ) {
      throw new AppError({
        code: 'INTERNAL_ERROR',
        details: { reason: 'Idempotency record collision or corruption', id, scope: input.scope },
      });
    }

    if (record.fingerprint !== fingerprint) {
      throw new AppError({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        userMessage: 'This Idempotency-Key was already used for a different request.',
        details: { scope: input.scope, requestId: context.key },
      });
    }

    return { value: decodeJson(record.result) as T, replayed: true };
  }

  const value = await input.execute();
  const now = new Date();
  await tx.backgroundJob.create({
    data: {
      id,
      type: 'SCHEDULED_TASK',
      status: 'COMPLETED',
      scheduledAt: now,
      completedAt: now,
      maxAttempts: 1,
      payload: {
        task: IDEMPOTENCY_TASK,
        scope: input.scope,
        principalId: context.principalId,
        requestId: context.key,
        fingerprint,
        result: encodeJson(value),
      },
    },
  });

  return { value, replayed: false };
}
