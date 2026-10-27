import 'server-only';
import { Prisma } from '@prisma/client';
import { INTELLIGENCE_ENGINE_VERSION, type CorrelationRule } from '../contract';
import { extendedWindowEnd, scopeHash, windowFor } from './rules';

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
}

export interface JoinResult {
  groupId: string;
  anchorIncidentId: string;
  role: 'ANCHOR' | 'MEMBER';
  /** True when this call created the membership; false on an idempotent replay. */
  memberCreated: boolean;
  relationshipCreated: boolean;
}

type GroupRow = { id: string; windowEnd: Date; maxWindowEnd: Date; anchorIncidentId: string | null };

/**
 * Joins an incident to the correlation group for (policy version, rule, service scope, signature,
 * window), creating the group if needed. Safe under any number of concurrent workers: group creation
 * is a single INSERT … ON CONFLICT DO NOTHING on the scope-aware identity, the anchor is elected by
 * compare-and-set, and membership/relationship inserts are idempotent. Incident and alert rows are
 * never touched. All times derive from the incident, so replays are deterministic.
 */
export async function joinCorrelationGroup(tx: Tx, input: JoinInput): Promise<JoinResult> {
  const { rule, incident } = input;
  const scope = scopeHash([input.serviceId]);
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
      VALUES (gen_random_uuid()::text, ${input.policyId}, ${input.policyVersion}, ${rule.id}, 'SERVICE', ${scope},
              ${input.signatureHash}, ${window.windowStart}, ${window.windowEnd}, ${window.maxWindowEnd}, now())
      ON CONFLICT ("policyId", "policyVersion", "ruleId", "scopeHash", "signatureHash", "windowStart") DO NOTHING`);
    // Either this call inserted the row or a concurrent worker did; both end up reading the same group.
    [group] = await findGroup();
  }
  if (!group) throw new Error('Correlation group could not be resolved');

  const widened = extendedWindowEnd(group, incident.createdAt, rule.windowSeconds);
  if (widened.getTime() > group.windowEnd.getTime()) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "CorrelationGroup" SET "windowEnd" = GREATEST("windowEnd", ${widened}), "updatedAt" = now()
      WHERE "id" = ${group.id}`);
  }

  // First to join becomes the anchor; compare-and-set makes the election race-free.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "CorrelationGroup" SET "anchorIncidentId" = ${incident.id}, "updatedAt" = now()
    WHERE "id" = ${group.id} AND "anchorIncidentId" IS NULL`);
  const [{ anchor }] = await tx.$queryRaw<Array<{ anchor: string }>>(Prisma.sql`
    SELECT "anchorIncidentId" AS anchor FROM "CorrelationGroup" WHERE "id" = ${group.id}`);
  const role = anchor === incident.id ? 'ANCHOR' : 'MEMBER';

  const evidence = JSON.stringify({
    type: 'correlation',
    ruleId: rule.id,
    ruleKind: rule.kind,
    windowSeconds: rule.windowSeconds,
    role,
  });
  const inserted = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "CorrelationMember"
      ("id", "groupId", "incidentId", "role", "decision", "score", "evidence", "policyVersion", "engineVersion", "updatedAt")
    VALUES (gen_random_uuid()::text, ${group.id}, ${incident.id}, ${role}::"CorrelationMemberRole",
            ${input.decision}::"CorrelationDecision", 1, ${evidence}::jsonb, ${input.policyVersion},
            ${INTELLIGENCE_ENGINE_VERSION}, now())
    ON CONFLICT ("groupId", "incidentId") DO NOTHING RETURNING "id"`);
  const memberCreated = inserted.length === 1;
  if (memberCreated) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CorrelationDecisionEvent" ("id", "memberId", "toDecision", "actorType", "reasonCode")
      VALUES (gen_random_uuid()::text, ${inserted[0].id}, ${input.decision}::"CorrelationDecision", 'SYSTEM', 'RULE_MATCH')`);
  }

  let relationshipCreated = false;
  if (role === 'MEMBER' && input.decision === 'SUGGESTED') {
    const relationshipEvidence = JSON.stringify({ type: 'correlation', ruleId: rule.id, groupId: group.id });
    const relationship = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "IncidentRelationship"
        ("id", "sourceIncidentId", "targetIncidentId", "type", "origin", "decision", "score", "evidence", "engineVersion", "updatedAt")
      VALUES (gen_random_uuid()::text, ${incident.id}, ${anchor}, 'RELATED'::"IncidentRelationshipType",
              'RULE'::"IntelligenceOrigin", 'SUGGESTED'::"CorrelationDecision", 1, ${relationshipEvidence}::jsonb,
              ${INTELLIGENCE_ENGINE_VERSION}, now())
      ON CONFLICT ("sourceIncidentId", "targetIncidentId", "type") DO NOTHING RETURNING "id"`);
    relationshipCreated = relationship.length === 1;
    if (relationshipCreated) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "IncidentRelationshipEvent" ("id", "relationshipId", "toDecision", "actorType", "reasonCode")
        VALUES (gen_random_uuid()::text, ${relationship[0].id}, 'SUGGESTED'::"CorrelationDecision", 'SYSTEM', 'RULE_MATCH')`);
    }
  }

  return { groupId: group.id, anchorIncidentId: anchor, role, memberCreated, relationshipCreated };
}

/** Marks groups whose window has passed as closed. Membership of historical incidents is unaffected. */
export async function closeExpiredGroups(tx: Tx, now: Date, limit: number): Promise<number> {
  return tx.$executeRaw(Prisma.sql`
    UPDATE "CorrelationGroup" SET "status" = 'CLOSED'::"CorrelationGroupStatus", "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "CorrelationGroup" WHERE "status" = 'OPEN'::"CorrelationGroupStatus" AND "windowEnd" < ${now}
      LIMIT ${limit})`);
}
