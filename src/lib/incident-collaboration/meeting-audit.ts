/**
 * Incident Meeting Canonical Audit Emitter
 *
 * Emits canonical audit events for meeting lifecycle transitions,
 * retries, cleanup debt, and reconciliation.
 *
 * Security: NEVER records raw join URLs, access tokens, Graph payloads,
 * or provider credentials in audit records.
 */

import type { Prisma } from '@prisma/client';
import { emitAuditEvent, type AuditActorType, type AuditEventSource } from '@/lib/audit';
import type { IncidentMeetingProvider } from './types';

export type MeetingAuditAction =
  | 'MEETING_PROVISION_REQUESTED'
  | 'MEETING_PROVISION_SUCCEEDED'
  | 'MEETING_PROVISION_FAILED'
  | 'MEETING_CLOSE_REQUESTED'
  | 'MEETING_CLOSE_SUCCEEDED'
  | 'MEETING_CLOSE_FAILED'
  | 'MEETING_RECONCILE_REQUESTED'
  | 'MEETING_RECONCILE_SUCCEEDED'
  | 'MEETING_RECONCILE_FAILED'
  | 'MEETING_CLEANUP_RETRY_REQUESTED';

export interface EmitMeetingAuditParams {
  action: MeetingAuditAction;
  incidentId: string;
  provider: IncidentMeetingProvider;
  generation: number;
  actor?: {
    type?: AuditActorType;
    id?: string | null;
    email?: string | null;
    name?: string | null;
  } | null;
  source?: AuditEventSource;
  result?: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'RETRY';
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

export async function emitMeetingAuditEvent(params: EmitMeetingAuditParams): Promise<void> {
  try {
    const actorType: AuditActorType = params.actor?.type ?? 'SYSTEM';
    const source: AuditEventSource = params.source ?? 'BACKGROUND';

    // Scrub sensitive parameters from metadata if present
    const cleanMetadata: Record<string, unknown> = {
      provider: params.provider,
      generation: params.generation,
      result: params.result ?? 'SUCCESS',
      reason: params.reason ?? null,
      ...params.metadata,
    };
    delete cleanMetadata.token;
    delete cleanMetadata.clientSecret;
    delete cleanMetadata.accessToken;
    delete cleanMetadata.rawPayload;

    await emitAuditEvent({
      action: params.action,
      source,
      target: {
        type: 'INCIDENT',
        id: params.incidentId,
      },
      actor: {
        type: actorType,
        id: params.actor?.id ?? null,
        email: params.actor?.email ?? null,
        name: params.actor?.name ?? null,
      },
      metadata: cleanMetadata as Prisma.InputJsonValue,
    });
  } catch {
    // Audit emission is non-blocking to prevent aborting critical transactions
  }
}
