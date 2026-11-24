'use server';

import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { assertCanViewIncident, capabilitiesOf } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import { toAuditTrailRow, type AuditTrailRow } from '@/lib/incidents/audit-trail';

const PAGE = 30;
const idSchema = z.string().min(1).max(64);

export type IncidentAuditPage =
  { allowed: false } | { allowed: true; rows: AuditTrailRow[]; nextCursor: string | null };

/** Timeline events the platform writes on its own: escalation, SLA, auto-resolve and runbook steps. */
const AUTOMATED_EVENT_TYPES = [
  'ESCALATED',
  'SLA_WARNING',
  'SLA_BREACHED',
  'AUTO_RESOLVED',
  'RUNBOOK_SUGGESTED',
  'RUNBOOK_STARTED',
  'RUNBOOK_STEP_COMPLETED',
  'RUNBOOK_APPROVAL_REQUIRED',
  'RUNBOOK_COMPLETED',
  'RUNBOOK_FAILED',
  'RUNBOOK_CANCELLED',
  'RUNBOOK_SKIPPED',
  'RUNBOOK_VERIFIED',
  'RUNBOOK_UNVERIFIED',
] as const;

/**
 * One page of the incident's change history, newest first: audit rows (people, Squire, API/MCP, automation that
 * audits) merged with the automated timeline events the platform writes instead of audit rows (escalation steps,
 * SLA warnings, runbook steps). Needs incident read plus the Audit Log page's capability (AUDIT_READ); without it,
 * `{ allowed: false }`. Two bounded reads per page on existing indexes (audit: entityType, entityId, createdAt;
 * events: incidentId, createdAt). The cursor is the oldest timestamp shown. Only shaped summaries leave.
 */
export async function loadIncidentAuditAction(
  incidentId: string,
  cursor?: string | null
): Promise<IncidentAuditPage> {
  const id = idSchema.parse(incidentId);
  const user = await assertCanViewIncident(id);
  if (!capabilitiesOf(user).includes(CAPABILITIES.AUDIT_READ)) return { allowed: false };
  const before = cursor ? new Date(z.string().datetime().parse(cursor)) : null;
  const [audits, events] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entityType: 'INCIDENT',
        entityId: id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actorId: true,
        actorName: true,
        actorEmail: true,
        channel: true,
        details: true,
      },
    }),
    prisma.incidentEvent.findMany({
      where: {
        incidentId: id,
        ...(before ? { createdAt: { lt: before } } : {}),
        OR: [
          { type: { in: [...AUTOMATED_EVENT_TYPES] } },
          // Older escalation rows carry no type; their message says what happened.
          {
            OR: [{ type: null }, { type: 'LEGACY_OTHER' }],
            message: { startsWith: 'Escalat' },
          },
          {
            OR: [{ type: null }, { type: 'LEGACY_OTHER' }],
            message: { startsWith: 'Next escalation' },
          },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      select: { id: true, message: true, createdAt: true },
    }),
  ]);
  const merged: AuditTrailRow[] = [
    ...audits.map(toAuditTrailRow),
    ...events.map(event => ({
      id: `event-${event.id}`,
      at: event.createdAt.toISOString(),
      kind: 'automation' as const,
      actor: 'OpsKnight',
      summary: readableEventMessage(event.message),
      source: 'Automation',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const page = merged.slice(0, PAGE);
  const more = merged.length > PAGE || audits.length > PAGE || events.length > PAGE;
  return {
    allowed: true,
    rows: page,
    nextCursor: more && page.length ? page[page.length - 1].at : null,
  };
}

/** First line, with the timeline's "[[scheduledAt=ISO]]" token as a readable UTC time (the viewer's zone is client-side). */
function readableEventMessage(message: string): string {
  return message
    .split('\n')[0]
    .replace(/\[\[scheduledAt=([^\]]+)\]\]/g, (_match, iso: string) => {
      const at = new Date(iso);
      return Number.isNaN(at.getTime())
        ? iso
        : `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    })
    .slice(0, 160);
}
