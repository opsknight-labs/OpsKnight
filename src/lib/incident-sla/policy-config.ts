import 'server-only';
import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { revalidatePath } from 'next/cache';
import { incidentSlaPolicyInputSchema } from './policy-validation';
import { emitAuditEvent } from '@/lib/audit';
import type { AuthorizedPolicyActor } from '@/lib/incidents/policy-actor';

export type IncidentResponsePolicyErrorCode = 'CONFLICT' | 'UNAUTHORIZED' | 'NOT_FOUND';

/** A stable boundary between policy persistence and user-facing actions. */
export class IncidentResponsePolicyError extends Error {
  constructor(public readonly code: IncidentResponsePolicyErrorCode) {
    super(
      code === 'CONFLICT'
        ? 'Policy changed. Reload settings before saving.'
        : code === 'UNAUTHORIZED'
          ? 'Admin access required.'
          : 'Service not found.'
    );
    this.name = 'IncidentResponsePolicyError';
  }
}

/** Deliberately uncached: creation reads the current immutable version transactionally. */
export async function getIncidentSlaPolicy(scopeKey: string) {
  return prisma.incidentSlaPolicy.findFirst({
    where: { scopeKey, sealedAt: { not: null } },
    orderBy: { version: 'desc' },
    include: { rules: true },
  });
}

export async function saveIncidentSlaPolicy(
  rawInput: unknown,
  authorizedActor?: AuthorizedPolicyActor
) {
  const input = incidentSlaPolicyInputSchema.parse(rawInput);
  const permissions = authorizedActor
    ? {
        authenticated: true,
        id: authorizedActor.actorId,
        capabilities: authorizedActor.capabilities,
      }
    : await getUserPermissions();
  if (
    !permissions.authenticated ||
    !permissions.id ||
    !permissions.capabilities.includes('admin.manage')
  )
    throw new IncidentResponsePolicyError('UNAUTHORIZED');
  const serviceId = input.scopeKey.startsWith('service:') ? input.scopeKey.slice(8) : null;
  const result = await prisma.$transaction(async tx => {
    // Scope-specific xact lock serializes even first-version creation (no row exists yet).
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incident-sla:${input.scopeKey}`}, 0))`;
    if (serviceId) {
      const exists = await tx.service.findUnique({
        where: { id: serviceId },
        select: { id: true },
      });
      if (!exists) throw new IncidentResponsePolicyError('NOT_FOUND');
    }
    const previous = await tx.incidentSlaPolicy.findFirst({
      where: { scopeKey: input.scopeKey, sealedAt: { not: null } },
      orderBy: { version: 'desc' },
    });
    if ((previous?.version ?? 0) !== input.expectedVersion)
      throw new IncidentResponsePolicyError('CONFLICT');
    const policy = await tx.incidentSlaPolicy.create({
      data: {
        scopeKey: input.scopeKey,
        version: input.expectedVersion + 1,
        inheritWorkspace: input.inheritWorkspace,
        baseAckTargetMs: input.baseAckTargetMs,
        baseResolveTargetMs: input.baseResolveTargetMs,
        createdById: permissions.id,
        rules: { create: input.rules },
      },
      include: { rules: true },
    });
    const sealedPolicy = await tx.incidentSlaPolicy.update({
      where: { id: policy.id },
      data: { sealedAt: new Date() },
      include: { rules: true },
    });
    await emitAuditEvent(
      {
        action: 'incident_sla.policy.version_created',
        source: authorizedActor?.source ?? 'UI',
        target: { type: serviceId ? 'SERVICE' : 'SYSTEM_CONFIG', id: serviceId ?? 'workspace' },
        actor: { type: 'USER', id: permissions.id },
        metadata: {
          scopeKey: input.scopeKey,
          previousPolicyId: previous?.id ?? null,
          previousVersion: previous?.version ?? null,
          newPolicyId: sealedPolicy.id,
          newVersion: sealedPolicy.version,
          inheritWorkspace: sealedPolicy.inheritWorkspace,
          baseAckTargetMs: sealedPolicy.baseAckTargetMs,
          baseResolveTargetMs: sealedPolicy.baseResolveTargetMs,
          rules: sealedPolicy.rules,
          futureIncidentsOnly: true,
        },
      },
      tx
    );
    return sealedPolicy;
  });
  // No policy cache to invalidate. Refresh every settings/read route that presents configuration.
  for (const path of [
    '/settings/incident-sla',
    '/settings',
    '/services',
    '/audit',
    ...(serviceId ? [`/services/${serviceId}`, `/services/${serviceId}/settings`] : []),
  ])
    revalidatePath(path);
  return result;
}
