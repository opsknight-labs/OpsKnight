import 'server-only';
import { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';
import {
  INTELLIGENCE_ENGINE_VERSION,
  policyDefinitionSchema,
  type CorrelationRule,
  type PolicyDefinition,
} from '../contract';
import { createHash } from 'node:crypto';
import { resolveEffectivePolicy } from '../settings/service';
import { getAutoGate } from '../evaluation/quality';
import { extendedWindowEnd, scopeHash, windowFor } from './rules';
import {
  combinedContent,
  scoreSimilarity,
  type SimilarityFingerprint,
} from '../similarity/scoring';

type Tx = Prisma.TransactionClient;

export type CorrelationMode = 'SHADOW' | 'SUGGESTED' | 'ACCEPTED';

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
  certificationRunId?: string;
  scopeDefinition?: PolicyDefinition;
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
  status: string;
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
  if (input.decision === 'ACCEPTED' && !input.certificationRunId)
    throw new Error('Automatic grouping requires certification evidence');
  const { rule, incident } = input;
  const scope = scopeHash(input.scopeServiceIds ?? [input.serviceId]);
  const window = windowFor(incident.createdAt, rule);

  // Compatible per-service policies share topology groups. Serialize their identity even when their
  // policy ids differ, so two services arriving together cannot create duplicate open groups.
  if (rule.kind === 'TOPOLOGY' && input.scopeDefinition) {
    const definitionKey = createHash('sha256')
      .update(JSON.stringify(input.scopeDefinition))
      .digest('hex');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-topology:${scope}:${rule.id}:${input.signatureHash}:${definitionKey}`}, 0))`;
  }

  const findGroup = () =>
    rule.kind === 'TOPOLOGY' && input.scopeDefinition
      ? tx.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT g."id", g."windowEnd", g."maxWindowEnd", g."anchorIncidentId", g."status"
      FROM "CorrelationGroup" g JOIN "IntelligencePolicyVersion" v ON v."policyId" = g."policyId" AND v."version" = g."policyVersion"
      WHERE v."definition" = ${JSON.stringify(input.scopeDefinition)}::jsonb AND g."ruleId" = ${rule.id}
        AND g."scopeHash" = ${scope} AND g."signatureHash" = ${input.signatureHash}
        AND g."windowStart" <= ${incident.createdAt} AND g."windowEnd" >= ${incident.createdAt}
      ORDER BY g."windowStart" DESC LIMIT 1`)
      : tx.$queryRaw<GroupRow[]>(Prisma.sql`
      SELECT "id", "windowEnd", "maxWindowEnd", "anchorIncidentId", "status" FROM "CorrelationGroup"
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
  if (input.decision === 'ACCEPTED' && (group.status !== 'OPEN' || +group.windowEnd < Date.now())) {
    return {
      groupId: group.id,
      anchorIncidentId: group.anchorIncidentId ?? incident.id,
      role: 'MEMBER',
      memberCreated: false,
      relationshipCreated: false,
      matched: false,
    };
  }

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
        if (source !== incident.id)
          await proposeLink(
            tx,
            source,
            incident.id,
            rule.id,
            group.id,
            undefined,
            input.match?.minScore
          );
      }
    } else if (input.decision === 'ACCEPTED') {
      // Re-electing an earlier anchor appends reversals for unreviewed automatic links; human
      // decisions are never rewritten or carried over to another target.
      const moved = await tx.$queryRaw<Array<{ id: string; source: string }>>(Prisma.sql`
        UPDATE "IncidentRelationship" r SET "decision" = 'REVERTED', "updatedAt" = now()
        WHERE r."targetIncidentId" = ${previous} AND r."origin" = 'RULE' AND r."decision" = 'ACCEPTED'
          AND r."evidence"->>'groupId' = ${group.id} AND r."evidence"->>'automatic' = 'true'
          AND NOT EXISTS (SELECT 1 FROM "IncidentRelationshipEvent" e WHERE e."relationshipId" = r."id" AND e."actorType" = 'USER')
        RETURNING r."id", r."sourceIncidentId" AS source`);
      for (const row of moved)
        await tx.incidentRelationshipEvent.create({
          data: {
            relationshipId: row.id,
            fromDecision: 'ACCEPTED',
            toDecision: 'REVERTED',
            actorType: 'SYSTEM',
            reasonCode: 'ANCHOR_REELECTED',
          },
        });
      for (const source of [previous, ...moved.map(row => row.source)]) {
        if (source !== incident.id)
          await proposeLink(
            tx,
            source,
            incident.id,
            rule.id,
            group.id,
            input.certificationRunId,
            input.match?.minScore
          );
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
    sourcePolicyId: input.policyId,
    sourcePolicyVersion: input.policyVersion,
    automatic: input.decision === 'ACCEPTED',
    ...(input.certificationRunId ? { certificationRunId: input.certificationRunId } : {}),
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
    role === 'MEMBER' && input.decision !== 'SHADOW'
      ? await proposeLink(
          tx,
          incident.id,
          anchor,
          rule.id,
          group.id,
          input.certificationRunId,
          input.match?.minScore
        )
      : false;

  return { groupId: group.id, anchorIncidentId: anchor, role, memberCreated, relationshipCreated };
}

/** Proposes a reversible RELATED link from a member to its anchor. Idempotent; true when newly created. */
async function proposeLink(
  tx: Tx,
  sourceId: string,
  targetId: string,
  ruleId: string,
  groupId: string,
  certificationRunId?: string,
  minimumScore?: number
) {
  const [pairSource, pairTarget] = [sourceId, targetId].sort();
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`intelligence-link:${pairSource}:${pairTarget}`}, 0))`
  );
  const automatic = Boolean(certificationRunId);
  const decision = automatic ? 'ACCEPTED' : 'SUGGESTED';
  let score = 1;
  if (minimumScore !== undefined) {
    const rows = await tx.incidentFingerprint.findMany({
      where: { incidentId: { in: [sourceId, targetId] } },
    });
    const fingerprints = rows.map(row => ({
      ...row,
      labels:
        row.labels && typeof row.labels === 'object' && !Array.isArray(row.labels)
          ? Object.fromEntries(
              Object.entries(row.labels).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string'
              )
            )
          : {},
    }));
    if (fingerprints.length !== 2) return false;
    score = combinedContent(scoreSimilarity(fingerprints[0], fingerprints[1]).components);
    if (score < minimumScore) return false;
  }
  if (automatic) {
    const eligible = await tx.incident.findMany({
      where: {
        id: { in: [sourceId, targetId] },
        urgency: { not: 'HIGH' },
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      select: { id: true, serviceId: true },
    });
    if (eligible.length !== 2) return false;
    const source = eligible.find(row => row.id === sourceId)!;
    const target = eligible.find(row => row.id === targetId)!;
    const [policy, targetPolicy, group] = await Promise.all([
      resolveEffectivePolicy(source.serviceId, tx),
      resolveEffectivePolicy(target.serviceId, tx),
      tx.correlationGroup.findUnique({
        where: { id: groupId },
        select: { policyId: true, policyVersion: true },
      }),
    ]);
    if (
      policy.effectiveMode !== 'AUTO' ||
      policy.source !== 'service' ||
      targetPolicy.effectiveMode === 'OFF' ||
      !group
    )
      return false;
    const version = await tx.intelligencePolicyVersion.findUnique({
      where: { policyId_version: { policyId: group.policyId, version: group.policyVersion } },
      select: { definition: true },
    });
    const definition = policyDefinitionSchema.safeParse(version?.definition);
    if (
      !definition.success ||
      JSON.stringify(definition.data) !== JSON.stringify(policy.definition)
    )
      return false;
    const gate = await getAutoGate(source.serviceId, policy.definition, tx);
    if (!gate.allowed || !gate.runId) return false;
    certificationRunId = gate.runId;
    const veto = await tx.incidentRelationship.findFirst({
      where: {
        OR: [
          { sourceIncidentId: sourceId, targetIncidentId: targetId },
          { sourceIncidentId: targetId, targetIncidentId: sourceId },
          { sourceIncidentId: sourceId, evidence: { path: ['groupId'], equals: groupId } },
        ],
        decision: { in: ['REJECTED', 'REVERTED'] },
      },
      select: { id: true },
    });
    if (veto) return false;
  }
  const evidence = JSON.stringify({
    type: 'correlation',
    ruleId,
    groupId,
    anchorIncidentId: targetId,
    automatic,
    ...(certificationRunId ? { certificationRunId } : {}),
  });
  const relationship = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO "IncidentRelationship"
      ("id", "sourceIncidentId", "targetIncidentId", "type", "origin", "decision", "score", "evidence", "engineVersion", "updatedAt")
    SELECT gen_random_uuid()::text, ${sourceId}, ${targetId}, 'RELATED'::"IncidentRelationshipType",
            'RULE'::"IntelligenceOrigin", ${decision}::"CorrelationDecision", ${score}, ${evidence}::jsonb,
            ${INTELLIGENCE_ENGINE_VERSION}, now()
    WHERE NOT ${automatic} OR (
      EXISTS (SELECT 1 FROM "Incident" WHERE "id" = ${sourceId} AND "urgency" <> 'HIGH' AND "status" IN ('OPEN', 'ACKNOWLEDGED'))
      AND EXISTS (SELECT 1 FROM "Incident" WHERE "id" = ${targetId} AND "urgency" <> 'HIGH' AND "status" IN ('OPEN', 'ACKNOWLEDGED')))
    ON CONFLICT ("sourceIncidentId", "targetIncidentId", "type") DO NOTHING RETURNING "id"`);
  if (relationship.length !== 1) return false;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "IncidentRelationshipEvent" ("id", "relationshipId", "toDecision", "actorType", "reasonCode")
    VALUES (gen_random_uuid()::text, ${relationship[0].id}, ${decision}::"CorrelationDecision", 'SYSTEM', ${automatic ? 'AUTO_GROUP' : 'RULE_MATCH'})`);
  if (automatic)
    await logAudit(
      {
        action: 'intelligence.group.automatic',
        entityType: 'SYSTEM_CONFIG',
        entityId: `intelligence-group:${groupId}`,
        source: 'SYSTEM',
        details: { sourceId, anchorIncidentId: targetId, ruleId, certificationRunId },
      },
      tx
    );
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
