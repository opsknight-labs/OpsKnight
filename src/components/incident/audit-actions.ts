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

/**
 * One page of the incident's audit history, newest first. Needs incident read plus the Audit Log page's
 * capability (AUDIT_READ); without the latter it answers `{ allowed: false }` instead of throwing. One query
 * per page on idx_audit_service_change_cursor (entityType, entityId, createdAt DESC, id DESC). Only shaped
 * summaries leave the server, never raw details.
 */
export async function loadIncidentAuditAction(
  incidentId: string,
  cursor?: string | null
): Promise<IncidentAuditPage> {
  const id = idSchema.parse(incidentId);
  const user = await assertCanViewIncident(id);
  if (!capabilitiesOf(user).includes(CAPABILITIES.AUDIT_READ)) return { allowed: false };
  const after = cursor ? idSchema.parse(cursor) : null;
  const rows = await prisma.auditLog.findMany({
    where: { entityType: 'INCIDENT', entityId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
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
  });
  const page = rows.slice(0, PAGE);
  return {
    allowed: true,
    rows: page.map(toAuditTrailRow),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
  };
}
