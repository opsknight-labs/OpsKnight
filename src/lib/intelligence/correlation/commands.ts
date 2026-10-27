import 'server-only';
import type { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { INTELLIGENCE_ENGINE_VERSION } from '../contract';

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Invalid id');
const note = z
  .string()
  .transform(value => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/ {2,}/g, ' ').trim())
  .pipe(z.string().max(500))
  .optional();

export const decideRelationshipSchema = z
  .object({
    relationshipId: id,
    decision: z.enum(['ACCEPTED', 'REJECTED', 'REVERTED']),
    note,
  })
  .strict();

export const linkIncidentsSchema = z
  .object({ incidentId: id, otherIncidentId: id, note })
  .strict()
  .refine(value => value.incidentId !== value.otherIncidentId, {
    message: 'An incident cannot be linked to itself',
    path: ['otherIncidentId'],
  });

function validationError(issues: Array<{ path: PropertyKey[]; message: string }>) {
  return new AppError({
    code: 'VALIDATION_FAILED',
    fields: issues.map(issue => ({ field: issue.path.map(String).join('.') || 'input', message: issue.message })),
  });
}

function assertMayDecide(actor: AuthorizationActor) {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_FEEDBACK)) {
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'You do not have permission to change related-incident links.',
    });
  }
}

/** The actor must be able to read every incident involved; otherwise the link is reported as not found. */
async function assertCanReadAll(tx: Prisma.TransactionClient, actor: AuthorizationActor, ids: string[]) {
  const visible = await tx.incident.findMany({
    where: { AND: [{ id: { in: ids } }, incidentReadWhere(actor)] },
    select: { id: true },
  });
  if (visible.length !== new Set(ids).size) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
}

type Decision = 'ACCEPTED' | 'REJECTED' | 'REVERTED';

async function setDecision(
  tx: Prisma.TransactionClient,
  actor: AuthorizationActor,
  relationship: { id: string; decision: string },
  decision: Decision,
  reasonCode: string,
  text: string | undefined
): Promise<boolean> {
  if (relationship.decision === decision) return false;
  await tx.incidentRelationship.update({ where: { id: relationship.id }, data: { decision } });
  await tx.incidentRelationshipEvent.create({
    data: {
      relationshipId: relationship.id,
      fromDecision: relationship.decision as 'SHADOW' | 'SUGGESTED' | Decision,
      toDecision: decision,
      actorType: 'USER',
      actorId: actor.id,
      reasonCode,
      note: text || null,
    },
  });
  return true;
}

export interface DecisionResult {
  relationshipId: string;
  decision: Decision;
  changed: boolean;
}

/**
 * Accepts, rejects or reverts a suggested link. Append-only (every change adds an event), idempotent
 * (repeating the current decision changes nothing), serialised per link, and visibility-checked on
 * both incidents. Shadow-only suggestions were never shown, so they cannot be decided.
 */
export async function decideRelationship(actor: AuthorizationActor, input: unknown): Promise<DecisionResult> {
  assertMayDecide(actor);
  const parsed = decideRelationshipSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const { relationshipId, decision, note: text } = parsed.data;

  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-relationship:${relationshipId}`}, 0))`;
    const relationship = await tx.incidentRelationship.findUnique({
      where: { id: relationshipId },
      select: { id: true, decision: true, sourceIncidentId: true, targetIncidentId: true },
    });
    if (!relationship || relationship.decision === 'SHADOW') throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    await assertCanReadAll(tx, actor, [relationship.sourceIncidentId, relationship.targetIncidentId]);

    const changed = await setDecision(tx, actor, relationship, decision, `HUMAN_${decision}`, text);
    if (changed) {
      await logAudit(
        {
          action: 'intelligence.relationship.decided',
          entityType: 'SYSTEM_CONFIG',
          entityId: `intelligence-relationship:${relationshipId}`,
          actorId: actor.id,
          source: 'UI',
          details: { decision, from: relationship.decision },
        },
        tx
      );
    }
    return { relationshipId, decision, changed };
  });
}

/**
 * Links two incidents by hand. Symmetric, so the pair is stored in canonical order; linking again
 * reactivates a previously withdrawn link instead of creating a duplicate.
 */
export async function linkIncidents(actor: AuthorizationActor, input: unknown): Promise<DecisionResult> {
  assertMayDecide(actor);
  const parsed = linkIncidentsSchema.safeParse(input);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const [source, target] = [parsed.data.incidentId, parsed.data.otherIncidentId].sort();

  return prisma.$transaction(async tx => {
    await assertCanReadAll(tx, actor, [source, target]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-link:${source}:${target}`}, 0))`;
    // A suggestion may already exist in either direction.
    const existing = await tx.incidentRelationship.findFirst({
      where: {
        type: 'RELATED',
        OR: [
          { sourceIncidentId: source, targetIncidentId: target },
          { sourceIncidentId: target, targetIncidentId: source },
        ],
      },
      select: { id: true, decision: true },
    });
    if (existing) {
      const changed = await setDecision(tx, actor, existing, 'ACCEPTED', 'HUMAN_LINK', parsed.data.note);
      return { relationshipId: existing.id, decision: 'ACCEPTED' as const, changed };
    }
    const created = await tx.incidentRelationship.create({
      data: {
        sourceIncidentId: source,
        targetIncidentId: target,
        type: 'RELATED',
        origin: 'HUMAN',
        decision: 'ACCEPTED',
        score: 1,
        evidence: { type: 'manual' },
        engineVersion: INTELLIGENCE_ENGINE_VERSION,
      },
    });
    await tx.incidentRelationshipEvent.create({
      data: {
        relationshipId: created.id,
        toDecision: 'ACCEPTED',
        actorType: 'USER',
        actorId: actor.id,
        reasonCode: 'HUMAN_LINK',
        note: parsed.data.note || null,
      },
    });
    await logAudit(
      {
        action: 'intelligence.relationship.linked',
        entityType: 'SYSTEM_CONFIG',
        entityId: `intelligence-relationship:${created.id}`,
        actorId: actor.id,
        source: 'UI',
      },
      tx
    );
    return { relationshipId: created.id, decision: 'ACCEPTED' as const, changed: true };
  });
}
