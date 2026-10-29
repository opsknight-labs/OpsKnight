import 'server-only';
import { Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION, type CorrelationRule } from '../contract';
import { extendedWindowEnd, scopeHash, windowFor } from './rules';
import {
  combinedContent,
  scoreSimilarity,
  type SimilarityFingerprint,
} from '../similarity/scoring';

type Tx = Prisma.TransactionClient;

export type CorrelationMode = 'SHADOW' | 'SUGGESTED';

export interface JoinInput {
  policyId: string;
  policyVersion: number;
  rule: Pick<CorrelationRule, 'id' | 'kind' | 'windowSeconds' | 'maxWindowSeconds'>;
  serviceId: string;
  signatureHash: string;
  incident: { id: string; createdAt: Date };
  /** SHADOW records only; SUGGESTED also proposes a reversible link to the group's anchor. */
  decision: CorrelationMode;
  scopeServiceIds?: readonly string[];
  match?: { fingerprint: SimilarityFingerprint; minScore: number };
}

export interface JoinResult {
  groupId: string;
  anchorIncidentId: string;
  role: 'ANCHOR' | 'MEMBER';
  /** True when this call created the membership; false on an idempotent replay. */
  memberCreated: boolean;
  relationshipCreated: boolean;
  matched?: boolean;
}

type GroupRow = {
  id: string;
  windowEnd: Date;
  maxWindowEnd: Date;
  anchorIncidentId: string | null;
};

/**
 * Joins an incident to the correlation group for (policy version, rule, service scope, signature,
 * window), creating the group if needed. Safe under any number of concurrent workers: group creation
 * is a single INSERT … ON CONFLICT DO NOTHING on the scope-aware identity, the anchor is elected under
 * the group's row lock, and membership/relationship inserts are idempotent. Incident and alert rows are
 * never touched. All times derive from the incident, and the anchor is always the earliest incident
 * (by creation time, then id), so the outcome does not depend on the order incidents are processed in.
 */
export async function joinCorrelationGroup(tx: Tx, input: JoinInput): Promise<JoinResult> {
  const { rule, incident } = input;
  const scope = scopeHash(input.scopeServiceIds ?? [input.serviceId]);
  const window = windowFor(incident.createdAt, rule);

  const findGroup = () =>
    tx.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT "id", "windowEnd", "maxWindowEnd", "anchorIncidentId" FROM "CorrelationGroup"
      WHERE "policyId" = ${input.policyId} AND "policyVersion" = ${input.policyVersion}
        AND "ruleId" = ${rule.id} AND "scopeHash" = ${scope} AND "signatureHash" = ${input.signatureHash}
        AND "windowStart" <= ${incident.createdAt} AND "windowEnd" >= ${incident.createdAt}
      ORDER BY "windowStart" DESC LIMIT 1`);

  let [group] = await findGroup();
  if (!group) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CorrelationGroup"
        ("id", "policyId", "policyVersion", "ruleId", "scopeKind", "scopeHash", "signatureHash",
         "windowStart", "windowEnd", "maxWindowEnd", "updatedAt")
      VALUES (gen_random_uuid()::text, ${input.policyId}, ${input.policyVersion}, ${rule.id}, ${rule.kind === 'TOPOLOGY' ? 'TOPOLOGY' : 'SERVICE'}, ${scope},
              ${input.signatureHash}, ${window.windowStart}, ${window.windowEnd}, ${window.maxWindowEnd}, now())
      ON CONFLICT ("policyId", "policyVersion", "ruleId", "scopeHash", "signatureHash", "windowStart") DO NOTHING`);
    // Either this call inserted the row or a concurrent worker did; both end up reading the same group.
    [group] = await findGroup();
  }
  if (!group) throw new Error('Correlation group could not be resolved');

  // The earliest incident is the anchor. The group row lock serialises elections; an incident that is
  // processed late but opened first takes over, and the previous anchor becomes a member linked to it.
  const [current] = await tx.$queryRaw<
    Array<{ anchor: string | null; anchorCreatedAt: Date | null }>
  >(Prisma.sql`
    SELECT g."anchorIncidentId" AS anchor, a."createdAt" AS "anchorCreatedAt"
    FROM "CorrelationGroup" g LEFT JOIN "Incident" a ON a."id" = g."anchorIncidentId"
    WHERE g."id" = ${group.id}
    FOR UPDATE OF g`);
  let score = 1;
  if (input.match && current?.anchor && current.anchor !== incident.id) {
    const anchorFingerprint = await tx.incidentFingerprint.findUnique({
      where: { incidentId: current.anchor },
    });
    if (anchorFingerprint) {
      const labels =
        anchorFingerprint.labels &&
        typeof anchorFingerprint.labels === 'object' &&
        !Array.isArray(anchorFingerprint.labels)
          ? Object.fromEntries(
              Object.entries(anchorFingerprint.labels).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : {};
      score = combinedContent(
        scoreSimilarity(input.match.fingerprint, { ...anchorFingerprint, labels }).components
      );
    } else score = 0;
    if (score < input.match.minScore)
      return {
        groupId: group.id,
        anchorIncidentId: current.anchor,
        role: 'MEMBER',
        memberCreated: false,
        relationshipCreated: false,
        matched: false,
      };
  }
  const widened = extendedWindowEnd(group, incident.createdAt, rule.windowSeconds);
  if (widened.getTime() > group.windowEnd.getTime()) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CorrelationGroup" SET "windowEnd" = GREATEST("windowEnd", ${widened}), "updatedAt" = now()
      WHERE "id" = ${group.id}`);
  }
  const precedes =
    !current?.anchor ||
    !current.anchorCreatedAt ||
    incident.createdAt.getTime() < current.anchorCreatedAt.getTime() ||
    (incident.createdAt.getTime() === current.anchorCreatedAt.getTime() &&
      incident.id < current.anchor);
  let anchor = current?.anchor ?? incident.id;
  if (precedes && anchor !== incident.id) {
    const previous = anchor;
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CorrelationMember" SET "role" = 'MEMBER'::"CorrelationMemberRole", "updatedAt" = now()
      WHERE "groupId" = ${group.id} AND "incidentId" = ${previous}`);
    if (input.decision === 'SUGGESTED') {
      // Unreviewed suggestions follow the anchor, so every proposed link in a group points at its anchor.
      // Links a person already accepted or rejected are their decision and stay as they are.
      const moved = await tx.$queryRaw<Array<{ source: string }>>(Prisma.sql`
        DELETE FROM "IncidentRelationship"
        WHERE "targetIncidentId" = ${previous} AND "origin" = 'RULE'::"IntelligenceOrigin"
          AND "decision" = 'SUGGESTED'::"CorrelationDecision" AND "evidence"->>'groupId' = ${group.id}
        RETURNING "sourceIncidentId" AS source`);
      for (const source of [previous, ...moved.map(row => row.source)]) {
        if (source !== incident.id) await proposeLink(tx, source, incident.id, rule.id, group.id);
      }
    }
    anchor = incident.id;
  }
  if (precedes) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CorrelationGroup" SET "anchorIncidentId" = ${incident.id}, "updatedAt" = now()
      WHERE "id" = ${group.id}`);
  }
  const role = anchor === incident.id ? 'ANCHOR' : 'MEMBER';

  const evidence = JSON.stringify({
    type: 'correlation',
    ruleId: rule.id,
    ruleKind: rule.kind,
    windowSeconds: rule.windowSeconds,
    role,
    anchorIncidentId: anchor,
  });
  const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "CorrelationMember"
      ("id", "groupId", "incidentId", "role", "decision", "score", "evidence", "policyVersion", "engineVersion", "updatedAt")
    VALUES (gen_random_uuid()::text, ${group.id}, ${incident.id}, ${role}::"CorrelationMemberRole",
            ${input.decision}::"CorrelationDecision", ${score}, ${evidence}::jsonb, ${input.policyVersion},
            ${INTELLIGENCE_ENGINE_VERSION}, now())
    ON CONFLICT ("groupId", "incidentId") DO NOTHING RETURNING "id"`);
  const memberCreated = inserted.length === 1;
  if (memberCreated) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CorrelationDecisionEvent" ("id", "memberId", "toDecision", "actorType", "reasonCode")
      VALUES (gen_random_uuid()::text, ${inserted[0].id}, ${input.decision}::"CorrelationDecision", 'SYSTEM', 'RULE_MATCH')`);
  }

  const relationshipCreated =
    role === 'MEMBER' && input.decision === 'SUGGESTED'
      ? await proposeLink(tx, incident.id, anchor, rule.id, group.id)
      : false;

  return { groupId: group.id, anchorIncidentId: anchor, role, memberCreated, relationshipCreated };
}

/** Proposes a reversible RELATED link from a member to its anchor. Idempotent; true when newly created. */
async function proposeLink(
  tx: Tx,
  sourceId: string,
  targetId: string,
  ruleId: string,
  groupId: string
) {
  const evidence = JSON.stringify({ type: 'correlation', ruleId, groupId });
  const relationship = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "IncidentRelationship"
      ("id", "sourceIncidentId", "targetIncidentId", "type", "origin", "decision", "score", "evidence", "engineVersion", "updatedAt")
    VALUES (gen_random_uuid()::text, ${sourceId}, ${targetId}, 'RELATED'::"IncidentRelationshipType",
            'RULE'::"IntelligenceOrigin", 'SUGGESTED'::"CorrelationDecision", 1, ${evidence}::jsonb,
            ${INTELLIGENCE_ENGINE_VERSION}, now())
    ON CONFLICT ("sourceIncidentId", "targetIncidentId", "type") DO NOTHING RETURNING "id"`);
  if (relationship.length !== 1) return false;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "IncidentRelationshipEvent" ("id", "relationshipId", "toDecision", "actorType", "reasonCode")
    VALUES (gen_random_uuid()::text, ${relationship[0].id}, 'SUGGESTED'::"CorrelationDecision", 'SYSTEM', 'RULE_MATCH')`);
  return true;
}

/** Marks groups whose window has passed as closed. Membership of historical incidents is unaffected. */
export async function closeExpiredGroups(tx: Tx, now: Date, limit: number): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    UPDATE "CorrelationGroup" SET "status" = 'CLOSED'::"CorrelationGroupStatus", "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "CorrelationGroup" WHERE "status" = 'OPEN'::"CorrelationGroupStatus" AND "windowEnd" < ${now}
      LIMIT ${limit})`);
}
