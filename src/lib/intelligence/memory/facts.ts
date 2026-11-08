import 'server-only';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import {
  authorize,
  AUTHORIZATION_ACTIONS,
  type AuthorizationActor,
} from '@/lib/authorization-policy';
import { KNOWLEDGE_LIMITS, knowledgeContentHash, validateServiceFact } from './contract';
import { getSquireMemorySettings } from './settings';

type Client = Prisma.TransactionClient | typeof prisma;

export interface ServiceFactView {
  id: string;
  text: string;
  approvedBy: string | null;
  createdAt: Date;
}

/**
 * Who may decide what Squire remembers about a service: someone who manages services or intelligence, or a
 * member of the service's owning team who may give intelligence feedback. Always on top of reading the service.
 */
export async function canCurateServiceKnowledge(
  actor: AuthorizationActor,
  serviceId: string,
  client: Client = prisma
): Promise<boolean> {
  if (actor.status !== 'ACTIVE' || actor.apiKey) return false;
  let readable: Prisma.ServiceWhereInput;
  try {
    readable = serviceReadWhere(actor);
  } catch {
    return false;
  }
  const service = await client.service.findFirst({
    where: { AND: [{ id: serviceId }, readable] },
    select: { id: true, teamId: true },
  });
  if (!service) return false;
  if (hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE)) return true;
  if (
    authorize({
      actor,
      action: AUTHORIZATION_ACTIONS.SERVICE_UPDATE,
      resource: { type: 'service', teamId: service.teamId },
    }).allowed
  )
    return true;
  return (
    hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK) &&
    service.teamId !== null &&
    actor.teamIds.includes(service.teamId)
  );
}

const denied = () =>
  new AppError({
    code: 'AUTHORIZATION_DENIED',
    userMessage: 'Only people who manage this service can change what Squire remembers about it.',
  });

/**
 * The domain command behind a confirmed "remember this" proposal. Everything the proposal claimed is re-checked
 * inside the confirming transaction: the knowledge index is on, the incident is still readable, the person may
 * curate its service's knowledge, the fact is still a valid fact and the service has room for it. The proposal
 * id is the fact's identity, so a replayed confirmation can never store it twice.
 */
export async function recordServiceFactCommand(
  actor: AuthorizationActor,
  input: { incidentId: string; fact: string; proposalId: string },
  tx: Prisma.TransactionClient
): Promise<{ id: string; serviceId: string }> {
  if (!(await getSquireMemorySettings(tx)).knowledgeEnabled)
    throw new AppError({
      code: 'PRECONDITION_FAILED',
      userMessage: 'Squire’s knowledge index is turned off, so nothing was saved.',
    });
  const valid = validateServiceFact(input.fact);
  if (!valid.ok) throw new AppError({ code: 'VALIDATION_FAILED', userMessage: valid.reason });
  const incident = await tx.incident.findFirst({
    where: { AND: [{ id: input.incidentId }, incidentReadWhere(actor)] },
    select: { serviceId: true, service: { select: { name: true, teamId: true } } },
  });
  if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  if (!(await canCurateServiceKnowledge(actor, incident.serviceId, tx))) throw denied();
  const count = await tx.knowledgeChunk.count({
    where: { serviceId: incident.serviceId, sourceKind: 'SERVICE_FACT' },
  });
  if (count >= KNOWLEDGE_LIMITS.maxFactsPerService)
    throw new AppError({
      code: 'PRECONDITION_FAILED',
      userMessage: `This service already has ${KNOWLEDGE_LIMITS.maxFactsPerService} learned facts. Remove one first.`,
    });
  const title = `Fact about ${incident.service.name}`.slice(0, KNOWLEDGE_LIMITS.titleChars);
  const now = new Date();
  const chunk = await tx.knowledgeChunk.create({
    data: {
      sourceKind: 'SERVICE_FACT',
      sourceId: input.proposalId,
      chunkIndex: 0,
      serviceId: incident.serviceId,
      teamId: incident.service.teamId,
      title,
      text: valid.fact,
      contentHash: knowledgeContentHash(title, valid.fact),
      approvedById: actor.id,
      sourceCreatedAt: now,
      sourceUpdatedAt: now,
    },
    select: { id: true },
  });
  await logAudit(
    {
      action: 'intelligence.squire.fact.approved',
      entityType: 'SERVICE',
      entityId: incident.serviceId,
      actorId: actor.id,
      source: 'UI',
      details: { factId: chunk.id, incidentId: input.incidentId, length: valid.fact.length },
    },
    tx
  );
  return { id: chunk.id, serviceId: incident.serviceId };
}

/** Learned facts of one service, newest first, for people who may read the service. */
export async function listServiceFacts(
  actor: AuthorizationActor,
  serviceId: string
): Promise<ServiceFactView[] | null> {
  let readable: Prisma.ServiceWhereInput;
  try {
    readable = serviceReadWhere(actor);
  } catch {
    return null;
  }
  const service = await prisma.service.findFirst({
    where: { AND: [{ id: serviceId }, readable] },
    select: { id: true },
  });
  if (!service) return null;
  const rows = await prisma.knowledgeChunk.findMany({
    where: { serviceId, sourceKind: 'SERVICE_FACT' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: KNOWLEDGE_LIMITS.maxFactsPerService,
    select: {
      id: true,
      text: true,
      createdAt: true,
      approvedBy: { select: { name: true, email: true } },
    },
  });
  return rows.map(row => ({
    id: row.id,
    text: row.text,
    createdAt: row.createdAt,
    approvedBy: row.approvedBy?.name || row.approvedBy?.email || null,
  }));
}

/** Removes one learned fact; audited. Removal works even while the index is off, so mistakes can be undone. */
export async function removeServiceFact(
  actor: AuthorizationActor,
  input: { serviceId: string; factId: string }
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    if (!(await canCurateServiceKnowledge(actor, input.serviceId, tx))) throw denied();
    const removed = await tx.knowledgeChunk.deleteMany({
      where: { id: input.factId, serviceId: input.serviceId, sourceKind: 'SERVICE_FACT' },
    });
    if (removed.count === 0) return false;
    await logAudit(
      {
        action: 'intelligence.squire.fact.removed',
        entityType: 'SERVICE',
        entityId: input.serviceId,
        actorId: actor.id,
        source: 'UI',
        details: { factId: input.factId },
      },
      tx
    );
    return true;
  });
}
