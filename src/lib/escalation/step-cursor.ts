/**
 * Keeps in-flight escalations pointing at the right tier when a policy's steps
 * are deleted or reordered.
 *
 * `Incident.currentEscalationStep` is the index of the NEXT step to page in the
 * live policy (steps before it are already handled; null once terminal). The
 * index means nothing without the policy's order at the time it was written, so
 * every mutation that deletes or reorders steps must move the cursor in the same
 * transaction, or an incident skips a tier or pages one twice.
 */
import type { Prisma } from '@prisma/client';

/** Step ids of a policy in escalation order. */
export async function readEscalationStepOrder(
  tx: Pick<Prisma.TransactionClient, 'escalationRule'>,
  policyId: string
): Promise<string[]> {
  const rows = await tx.escalationRule.findMany({
    where: { policyId },
    orderBy: { stepOrder: 'asc' },
    select: { id: true },
  });
  return rows.map(row => row.id);
}

/**
 * Where an incident's cursor belongs after the policy order changed from
 * `before` to `after` (both lists of step ids).
 *
 * The steps before the cursor were paged; they must stay ahead of every step that
 * was not. When they still form the front of the new order the cursor is simply
 * how many of them survive: a deleted earlier tier shifts it down, deleting the
 * tier it points at or any later tier leaves it, and reordering only unpaged
 * tiers leaves it. A reorder that moves an unpaged tier above a paged one cannot
 * be expressed by one number without a per-incident snapshot of what was paged;
 * then the cursor goes to the first unpaged tier, which re-pages a tier rather
 * than skipping one.
 */
export function remapEscalationCursor(
  before: readonly string[],
  after: readonly string[],
  cursor: number
): number {
  const survivors = new Set(after);
  const paged = new Set(before.slice(0, cursor).filter(id => survivors.has(id)));
  let front = 0;
  while (front < after.length && paged.has(after.at(front) ?? '')) front += 1;
  if (front === paged.size) return front;

  const unpaged = new Set(before.slice(cursor));
  const first = after.findIndex(id => unpaged.has(id));
  return first === -1 ? front : first;
}

/**
 * Moves the cursor of every in-flight incident that follows the live policy.
 * Call inside the transaction that changed the steps, with the policy row locked.
 * Incidents pinned by a LIVE automation decision run on their own frozen copy of
 * the policy and are left alone. Returns how many cursors moved.
 */
export async function remapOpenIncidentEscalationCursors(
  tx: Prisma.TransactionClient,
  input: { policyId: string; before: readonly string[]; after: readonly string[] }
): Promise<number> {
  const { policyId, before, after } = input;
  if (before.length === after.length && before.every((id, index) => id === after.at(index))) return 0;

  // Row locks make a worker's commit wait, so no step is paged between this read and the write.
  const rows = await tx.$queryRaw<Array<{ id: string; step: number }>>`
    SELECT i.id, i."currentEscalationStep" AS step
    FROM "Incident" i
    JOIN "Service" s ON s.id = i."serviceId"
    LEFT JOIN "IncidentAutomationDecision" d ON d."incidentId" = i.id
    WHERE s."escalationPolicyId" = ${policyId}
      AND i."escalationStatus" IN ('ESCALATING', 'PAUSED')
      AND i."currentEscalationStep" IS NOT NULL
      AND i.status::text IN ('OPEN', 'SNOOZED', 'SUPPRESSED')
      AND (d."incidentId" IS NULL OR d.mode::text <> 'LIVE')
    FOR UPDATE OF i
  `;

  const moves = new Map<string, { from: number; to: number; ids: string[] }>();
  for (const row of rows ?? []) {
    const to = remapEscalationCursor(before, after, row.step);
    if (to === row.step) continue;
    const key = `${row.step}:${to}`;
    const move = moves.get(key) ?? { from: row.step, to, ids: [] };
    move.ids.push(row.id);
    moves.set(key, move);
  }

  let moved = 0;
  for (const { from, to, ids } of moves.values()) {
    await tx.incident.updateMany({ where: { id: { in: ids } }, data: { currentEscalationStep: to } });
    // The queued job names its step too; left stale it would lose the claim to the moved cursor.
    await tx.$executeRaw`
      UPDATE "BackgroundJob"
      SET payload = jsonb_set(
        jsonb_set(payload, '{stepIndex}', to_jsonb(${to}::int)),
        '{logicalKey}',
        to_jsonb('ESCALATION:' || (payload->>'incidentId') || ':'
          || COALESCE(payload->>'generation', '0') || ':' || ${to}::text)
      )
      WHERE type = 'ESCALATION'::"JobType"
        AND status = 'PENDING'::"JobStatus"
        AND payload->>'incidentId' = ANY(${ids}::text[])
        AND (payload->>'stepIndex')::int = ${from}
    `;
    moved += ids.length;
  }
  return moved;
}

interface StepContent {
  targetType: string;
  targetUserId: string | null;
  targetTeamId: string | null;
  targetScheduleId: string | null;
  notificationChannels: readonly string[];
  notifyOnlyTeamLead: boolean;
  conditions?: ReadonlyArray<{ field: string; operator: string; values: readonly string[] }>;
}

/** What a step pages, ignoring its delay (delays are positional, not part of a tier's identity). */
function stepSignature(step: StepContent): string {
  return JSON.stringify([
    step.targetType,
    step.targetUserId,
    step.targetTeamId,
    step.targetScheduleId,
    [...step.notificationChannels].sort(),
    step.notifyOnlyTeamLead,
    (step.conditions ?? [])
      .map(c => JSON.stringify([c.field, c.operator, [...c.values].sort()]))
      .sort(),
  ]);
}

/**
 * For an API that replaces the whole step list: the stored step id behind each
 * replacement step, in replacement order, when every replacement is identical to a
 * distinct stored step (a pure delete or reorder). Null when any replacement is an
 * edit or an insert, because no step identity can be inferred for it.
 */
export function matchReplacementSteps(
  stored: ReadonlyArray<StepContent & { id: string }>,
  replacement: readonly StepContent[]
): string[] | null {
  const free = stored.map(step => ({ id: step.id, signature: stepSignature(step) }));
  const ids: string[] = [];
  for (const step of replacement) {
    const signature = stepSignature(step);
    const index = free.findIndex(candidate => candidate.signature === signature);
    if (index === -1) return null;
    ids.push(...free.splice(index, 1).map(match => match.id));
  }
  return ids;
}
