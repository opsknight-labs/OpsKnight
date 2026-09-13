'use client';

import { enqueueRequest } from '@/lib/offline-queue';

export type BrowserIncidentStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'RESOLVED'
  | 'SNOOZED'
  | 'SUPPRESSED';

export type IncidentStatusMutationResult =
  | { state: 'COMMITTED'; duplicate: boolean }
  | { state: 'QUEUED'; queueId: string };

export class IncidentStatusMutationError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'IncidentStatusMutationError';
  }
}

function newIdempotencyKey(incidentId: string) {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `incident-status:${incidentId}:${random}`;
}

function mutationUrl(incidentId: string) {
  const path = `/api/incidents/${encodeURIComponent(incidentId)}/status`;
  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
}

function userMessageForStatus(status: number, fallback: string) {
  if (status === 401) return 'Your session expired. Sign in again before changing this incident.';
  if (status === 403) return 'You are not authorized to change this incident.';
  if (status === 409) return 'The incident changed on another device. Refresh before retrying.';
  if (status === 429) return 'Too many requests. Please retry shortly.';
  if (status >= 500) return 'OpsKnight could not confirm the change. Please retry.';
  return fallback;
}

async function parseError(response: Response) {
  try {
    const payload = (await response.clone().json()) as {
      error?: unknown;
      code?: unknown;
      retryable?: unknown;
    };
    return {
      message: typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`,
      code: typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`,
      retryable:
        payload.retryable === true || response.status === 408 || response.status === 429 || response.status >= 500,
    };
  } catch {
    return {
      message: `HTTP ${response.status}`,
      code: `HTTP_${response.status}`,
      retryable: response.status === 408 || response.status === 429 || response.status >= 500,
    };
  }
}

async function queueStatusMutation(input: {
  incidentId: string;
  status: BrowserIncidentStatus;
  expectedStatus?: BrowserIncidentStatus;
  idempotencyKey: string;
}) {
  const body = JSON.stringify({
    status: input.status,
    ...(input.expectedStatus ? { expectedStatus: input.expectedStatus } : {}),
  });
  const queueId = await enqueueRequest({
    operation: 'INCIDENT_STATUS',
    laneKey: `incident:${input.incidentId}`,
    url: mutationUrl(input.incidentId),
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
    idempotencyKey: input.idempotencyKey,
    expectedState: input.expectedStatus ?? null,
  });
  if (!queueId) {
    throw new IncidentStatusMutationError(
      'Offline storage is unavailable; the incident was not changed.',
      null,
      'OFFLINE_QUEUE_UNAVAILABLE',
      true
    );
  }
  return { state: 'QUEUED' as const, queueId };
}

export async function mutateIncidentStatus(input: {
  incidentId: string;
  status: BrowserIncidentStatus;
  expectedStatus?: BrowserIncidentStatus;
}): Promise<IncidentStatusMutationResult> {
  const idempotencyKey = newIdempotencyKey(input.incidentId);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return queueStatusMutation({ ...input, idempotencyKey });
  }

  const body = JSON.stringify({
    status: input.status,
    ...(input.expectedStatus ? { expectedStatus: input.expectedStatus } : {}),
  });
  try {
    const response = await fetch(mutationUrl(input.incidentId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body,
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) {
      const error = await parseError(response);
      throw new IncidentStatusMutationError(
        userMessageForStatus(response.status, error.message),
        response.status,
        error.code,
        error.retryable
      );
    }
    let duplicate = response.headers.get('Idempotency-Replayed') === 'true';
    try {
      const payload = (await response.clone().json()) as { duplicate?: unknown };
      duplicate = duplicate || payload.duplicate === true;
    } catch {}
    return { state: 'COMMITTED', duplicate };
  } catch (error) {
    if (error instanceof IncidentStatusMutationError) throw error;
    try {
      return await queueStatusMutation({ ...input, idempotencyKey });
    } catch (queueError) {
      if (queueError instanceof IncidentStatusMutationError) throw queueError;
      throw new IncidentStatusMutationError(
        'OpsKnight could not confirm the change and offline storage is unavailable. Refresh the incident before retrying.',
        null,
        'NETWORK_QUEUE_FAILED',
        true
      );
    }
  }
}
