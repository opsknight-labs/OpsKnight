import 'server-only';
import { Prisma } from '@prisma/client';
import { PROACTIVE_LIMITS } from './contract';
import {
  diffDiagnoses,
  parseDiagnosis,
  type InvestigationDigest,
  investigationDigestSchema,
} from './proactive-digest';
import type { InvestigationContent } from './proactive-content';

/**
 * Live updates of an automatic investigation (continuous re-assessment): while the incident stays open,
 * new alerts, notes, status or urgency changes, runbook outcomes or deploys on its service re-run the
 * investigation with the previous conclusion as context, at most every `reassessDebounceMs` and
 * `reassessPerIncidentDaily` times a day.
 */

type Tx = Prisma.TransactionClient;

/** Timeline events that are news for a running investigation (urgency changes are STATUS_CHANGE events). */
const SIGNAL_EVENT_TYPES = [
  'ACKNOWLEDGED',
  'ESCALATED',
  'REOPENED',
  'STATUS_CHANGE',
  'RUNBOOK_COMPLETED',
  'RUNBOOK_FAILED',
] as const;

export interface NewSignals {
  alerts: number;
  notes: number;
  events: number;
  changes: number;
}

const DAY_MS = 86_400_000;

/** When the evidence behind a note was last read: the stored time, else the note's own creation. */
export const assessedSince = (content: InvestigationContent, createdAt: Date) =>
  content.assessedAt && !Number.isNaN(Date.parse(content.assessedAt))
    ? new Date(content.assessedAt)
    : createdAt;

/** Re-runs that count against today's cap: start times within the last 24 hours. */
export const reassessmentsToday = (content: InvestigationContent, now: Date) =>
  (content.reassessedAt ?? []).filter(at => now.getTime() - Date.parse(at) < DAY_MS).length;

/**
 * A stored ISO time as a UTC wall-clock timestamp (the columns' own type), or NULL when it is malformed: a bad
 * value can never abort the scan's transaction. jsonpath's datetime() with silent errors is the safe parse.
 */
const utcFromJson = (value: Prisma.Sql) => Prisma.sql`((jsonb_path_query_first(
  jsonb_build_object('t', regexp_replace(${value}, 'Z$', '+00:00')), '$.t.datetime()', '{}', true
) #>> '{}')::timestamptz AT TIME ZONE 'UTC')`;

/** A time computed here, compared in UTC whatever the session's time zone. */
const utc = (at: Date) => Prisma.sql`(${at.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/**
 * Open incidents on `serviceIds`, opened within the re-assessment window, whose investigation is older than the
 * debounce, under today's cap, with at least one new signal since it last read the evidence. One bounded
 * statement, capped per scan across all services.
 */
export async function findReassessCandidates(
  tx: Tx,
  serviceIds: string[],
  now: Date
): Promise<string[]> {
  if (serviceIds.length === 0) return [];
  const debounced = new Date(now.getTime() - PROACTIVE_LIMITS.reassessDebounceMs);
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const openedAfter = new Date(now.getTime() - PROACTIVE_LIMITS.reassessWindowMs);
  const cap = PROACTIVE_LIMITS.reassessPerIncidentDaily;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT n."incidentId" AS id
    FROM "SquireProactiveNote" n
    JOIN "Incident" i ON i."id" = n."incidentId"
    CROSS JOIN LATERAL (
      SELECT COALESCE(${utcFromJson(Prisma.sql`n."content"->>'assessedAt'`)}, n."createdAt") AS since
    ) s
    WHERE n."kind" = 'INVESTIGATION'
      AND i."serviceId" = ANY(${serviceIds}::text[])
      AND i."status"::text IN ('OPEN', 'ACKNOWLEDGED')
      AND i."createdAt" >= ${utc(openedAfter)}
      AND n."updatedAt" <= ${utc(debounced)}
      AND NOT (
        CASE WHEN jsonb_typeof(n."content"->'reassessedAt') = 'array'
          THEN jsonb_array_length(n."content"->'reassessedAt') ELSE 0 END >= ${cap}
        AND COALESCE(${utcFromJson(Prisma.sql`n."content"->'reassessedAt'->>0`)} > ${utc(dayAgo)}, false)
      )
      AND (
        EXISTS (SELECT 1 FROM "Alert" a WHERE a."incidentId" = i."id" AND a."createdAt" > s.since)
        OR EXISTS (SELECT 1 FROM "IncidentNote" x WHERE x."incidentId" = i."id" AND x."createdAt" > s.since)
        OR EXISTS (
          SELECT 1 FROM "IncidentEvent" e
          WHERE e."incidentId" = i."id" AND e."createdAt" > s.since
            AND e."type"::text = ANY(${[...SIGNAL_EVENT_TYPES]}::text[])
        )
        OR EXISTS (
          SELECT 1 FROM "ChangeEvent" c
          WHERE c."serviceId" = i."serviceId" AND c."createdAt" > s.since
            AND c."occurredAt" > s.since - interval '1 day'
        )
      )
    ORDER BY n."updatedAt" ASC
    LIMIT ${PROACTIVE_LIMITS.reassessPerScan}
  `);
  return rows.map(row => row.id);
}

/** What arrived since `since`: counts about this incident and its service only. */
export async function readNewSignals(
  tx: Tx,
  input: { incidentId: string; serviceId: string; since: Date }
): Promise<NewSignals> {
  const { incidentId, serviceId, since } = input;
  const after = { gt: since };
  const [alerts, notes, events, changes] = await Promise.all([
    tx.alert.count({ where: { incidentId, createdAt: after } }),
    tx.incidentNote.count({ where: { incidentId, createdAt: after } }),
    tx.incidentEvent.count({
      where: { incidentId, createdAt: after, type: { in: [...SIGNAL_EVENT_TYPES] } },
    }),
    tx.changeEvent.count({
      where: {
        serviceId,
        createdAt: after,
        occurredAt: { gt: new Date(since.getTime() - DAY_MS) },
      },
    }),
  ]);
  return { alerts, notes, events, changes };
}

export const hasNewSignals = (signals: NewSignals) =>
  signals.alerts + signals.notes + signals.events + signals.changes > 0;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Plain lines for the model and the digest. */
export function signalLines(signals: NewSignals): string[] {
  return [
    signals.alerts ? plural(signals.alerts, 'new alert') : '',
    signals.notes ? plural(signals.notes, 'new note') : '',
    signals.events ? plural(signals.events, 'status, urgency or runbook change') : '',
    signals.changes ? plural(signals.changes, 'new deploy or change on the service') : '',
  ].filter(Boolean);
}

/** The next note content after a successful re-run: the new conclusion, its digest first in a bounded history. */
export function nextInvestigationContent(
  previous: InvestigationContent,
  next: InvestigationContent,
  input: { startedAt: Date; signals: NewSignals }
): { content: InvestigationContent; digest: InvestigationDigest } {
  const revision = (previous.revision ?? 1) + 1;
  const oldCitations = new Set(previous.citations.map(item => `${item.kind}:${item.id}`));
  const sources = new Map(
    [...previous.sources, ...next.sources].map(source => [`${source.kind}:${source.id}`, source])
  );
  const digest = investigationDigestSchema.parse({
    at: input.startedAt.toISOString(),
    revision,
    signals: signalLines(input.signals),
    ...diffDiagnoses(parseDiagnosis(previous.answer), parseDiagnosis(next.answer)),
    newEvidence: next.citations
      .filter(item => !oldCitations.has(`${item.kind}:${item.id}`))
      .slice(0, PROACTIVE_LIMITS.maxListItems),
    // Both runs store at most 64 sources each, so the union always fits the digest's bound of 128.
    sources: [...sources.values()],
  });
  return {
    digest,
    content: {
      ...next,
      assessedAt: input.startedAt.toISOString(),
      revision,
      reassessedAt: withAttempt(previous, input.startedAt),
      updates: [digest, ...(previous.updates ?? [])].slice(0, PROACTIVE_LIMITS.maxDigests),
    },
  };
}

/** The same note with one more re-run attempt recorded: a failed run still counts toward debounce and cap. */
export function withAttempt(previous: InvestigationContent, startedAt: Date): string[] {
  return [...(previous.reassessedAt ?? []), startedAt.toISOString()].slice(
    -PROACTIVE_LIMITS.reassessPerIncidentDaily
  );
}
