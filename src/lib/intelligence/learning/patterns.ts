import 'server-only';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

type Outcome = {
  template: string;
  serviceId: string;
  incidentCreatedAt: Date;
  resolvedAt: Date | null;
  patternVersion?: number;
};
const keyFor = (template: string) =>
  createHash('sha256').update(template).digest('hex').slice(0, 32);

/** Delta under the fingerprint's transaction lock: a replay, reopen or title edit cannot double-count. */
export async function updateOutcomePattern(
  tx: Prisma.TransactionClient,
  previous: Outcome | null,
  next: Outcome
): Promise<void> {
  const changes = new Map<
    string,
    { scope: string; key: string; support: number; successes: number; duration: number }
  >();
  const add = (outcome: Outcome, sign: number) => {
    if (!outcome.template) return;
    const key = keyFor(outcome.template);
    const identity = `${outcome.serviceId}:${key}`;
    const entry = changes.get(identity) ?? {
      scope: outcome.serviceId,
      key,
      support: 0,
      successes: 0,
      duration: 0,
    };
    entry.support += sign;
    if (outcome.resolvedAt) {
      entry.successes += sign;
      entry.duration += sign * Math.max(0, +outcome.resolvedAt - +outcome.incidentCreatedAt);
    }
    changes.set(identity, entry);
  };
  if (previous?.patternVersion === 1) add(previous, -1);
  add(next, 1);
  // A stable lock order also handles two incidents whose templates are edited in opposite directions.
  for (const entry of [...changes.values()].sort((a, b) =>
    `${a.scope}:${a.key}`.localeCompare(`${b.scope}:${b.key}`)
  )) {
    if (!entry.support && !entry.successes && !entry.duration) continue;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "IntelligencePattern" ("id", "scopeKey", "kind", "key", "support", "successes", "failures", "resolutionTotalMs", "lastSeenAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${entry.scope}, 'PROBLEM_OUTCOME', ${entry.key},
        ${Math.max(0, entry.support)}, ${Math.max(0, entry.successes)}, ${Math.max(0, entry.support - entry.successes)}, ${Math.max(0, entry.duration)}, ${next.incidentCreatedAt}, now())
      ON CONFLICT ("scopeKey", "kind", "key") DO UPDATE SET
        "support" = GREATEST(0, "IntelligencePattern"."support" + ${entry.support}),
        "successes" = GREATEST(0, "IntelligencePattern"."successes" + ${entry.successes}),
        "failures" = GREATEST(0, "IntelligencePattern"."failures" + ${entry.support - entry.successes}),
        "resolutionTotalMs" = GREATEST(0, "IntelligencePattern"."resolutionTotalMs" + ${entry.duration}),
        "lastSeenAt" = GREATEST("IntelligencePattern"."lastSeenAt", EXCLUDED."lastSeenAt"), "updatedAt" = now()`);
    await tx.intelligencePattern.deleteMany({
      where: { scopeKey: entry.scope, kind: 'PROBLEM_OUTCOME', key: entry.key, support: 0 },
    });
  }
}
