'use server';

import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { assertCanViewIncident } from '@/lib/rbac';
import { readPayload, type ReadablePayload } from '@/lib/payload-reader';

const PAGE = 25;
const idSchema = z.string().min(1).max(64);

export type IncidentAlertRow = {
  id: string;
  createdAt: string;
  status: string;
  severity: string | null;
  /** The first alert on the incident: the one that opened it. */
  opener: boolean;
  view: ReadablePayload;
};

/**
 * The alerts deduplicated into an incident, newest first, each read into its readable payload view. Same rule
 * as Squire's get_alert_payload: anyone who may read the incident may read its alerts; credentials are masked
 * by the reader before anything leaves the server.
 */
export async function loadIncidentAlertsAction(
  incidentId: string,
  cursor?: string | null
): Promise<{ alerts: IncidentAlertRow[]; nextCursor: string | null }> {
  const id = idSchema.parse(incidentId);
  await assertCanViewIncident(id);
  const after = cursor ? idSchema.parse(cursor) : null;
  const [rows, opener] = await Promise.all([
    prisma.alert.findMany({
      where: { incidentId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, createdAt: true, status: true, severity: true, payload: true },
    }),
    prisma.alert.findFirst({
      where: { incidentId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    }),
  ]);
  const page = rows.slice(0, PAGE);
  return {
    alerts: page.map(row => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      status: row.status,
      severity: row.severity,
      opener: row.id === opener?.id,
      view: readPayload(row.payload),
    })),
    nextCursor: rows.length > PAGE ? page[page.length - 1].id : null,
  };
}
