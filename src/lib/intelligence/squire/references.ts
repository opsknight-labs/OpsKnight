import 'server-only';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { redactSecrets } from '../ai/redact';

export async function readChangeReference(actor: AuthorizationActor, id: string) {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  const readable = serviceReadWhere(actor);
  return prisma.changeEvent.findFirst({
    where: {
      id,
      ...(Object.keys(readable).length ? { OR: [{ serviceId: null }, { service: readable }] } : {}),
    },
    select: {
      id: true,
      summary: true,
      source: true,
      kind: true,
      occurredAt: true,
      service: { select: { id: true, name: true } },
    },
  });
}
export async function readAlertReference(actor: AuthorizationActor, id: string) {
  if (!hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ)) return null;
  const alert = await prisma.alert.findFirst({
    where: { id, incidentId: { not: null }, incident: incidentReadWhere(actor) },
    select: { id: true, incidentId: true, status: true, createdAt: true, payload: true },
  });
  if (!alert) return null;
  const payload =
    alert.payload && typeof alert.payload === 'object' && !Array.isArray(alert.payload)
      ? alert.payload
      : {};
  const summary =
    typeof payload.summary === 'string'
      ? payload.summary
      : typeof payload.title === 'string'
        ? payload.title
        : 'Recorded alert';
  return {
    id: alert.id,
    incidentId: alert.incidentId,
    status: alert.status,
    createdAt: alert.createdAt,
    summary: redactSecrets(summary).slice(0, 500),
  };
}
