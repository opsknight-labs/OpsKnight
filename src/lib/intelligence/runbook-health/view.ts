import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import { withDbBudget } from '../jobs/db-budget';
import { enabledOpsInsightAreas, type OpsInsightView } from '../ops-insights/contract';
import { listInsightsForScope, readableOpsInsightScopes } from '../ops-insights/view';
import { RESOLVED_PREFIX } from '../ops-insights/producers/missing-runbook';
import { getIntelligenceSettings } from '../settings/service';
import {
  runStatsFromRollup,
  stepStatsFromRollup,
  summarizeRunbookEffectiveness,
  RUNBOOK_HEALTH_LIMITS,
  type RunbookEffectiveness,
} from './insights';
import {
  extractImperativeSteps,
  noteRefsFromHrefs,
  type DraftStep,
  type NoteRef,
  type ResolvedProblemNotes,
} from './notes';

/**
 * Read side of runbook health: the numbers come from the daily rollups, the insights from the OpsInsight
 * store, and note text is resolved here, per viewer, only for incidents that viewer may read. Every read is
 * bounded and index-backed and runs under a short statement budget: a slow read hides the section, never
 * the page. Nothing here writes or calls a model.
 */

const DAY_MS = 86_400_000;
const READ_BUDGET = { maxDbMs: 2_000 };

export const RUNBOOK_INSIGHT_KINDS = {
  health: 'runbook.health',
  missing: 'runbook.missing',
} as const;

async function runbooksAreaOn() {
  const settings = await getIntelligenceSettings();
  return enabledOpsInsightAreas(settings).includes('runbooks') ? settings : null;
}

/**
 * Text of the referenced notes the actor may read, keyed `${kind}:${id}`. Two primary-key reads, each
 * joined to the incident through the product's incident read filter; an unreadable note is simply absent.
 */
export async function resolveNoteRefs(
  actor: AuthorizationActor,
  refs: readonly NoteRef[],
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Map<string, { incidentId: string; text: string }>> {
  const resolved = new Map<string, { incidentId: string; text: string }>();
  if (refs.length === 0) return resolved;
  let incident;
  try {
    incident = incidentReadWhere(actor);
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthorizationError') return resolved;
    throw error;
  }
  const ids = (kind: NoteRef['kind']) =>
    [...new Set(refs.filter(ref => ref.kind === kind).map(ref => ref.id))].slice(0, 50);
  const noteIds = ids('note');
  const eventIds = ids('event');
  const notes = noteIds.length
    ? await client.incidentNote.findMany({
        where: { id: { in: noteIds }, incident },
        select: { id: true, incidentId: true, content: true },
      })
    : [];
  const events = eventIds.length
    ? await client.incidentEvent.findMany({
        where: { id: { in: eventIds }, type: 'MANUAL_RESOLVED', incident },
        select: { id: true, incidentId: true, message: true },
      })
    : [];
  for (const note of notes)
    resolved.set(`note:${note.id}`, { incidentId: note.incidentId, text: note.content });
  for (const event of events)
    resolved.set(`event:${event.id}`, {
      incidentId: event.incidentId,
      text: event.message.startsWith(RESOLVED_PREFIX)
        ? event.message.slice(RESOLVED_PREFIX.length)
        : event.message,
    });
  return resolved;
}

const refsOf = (insight: OpsInsightView) =>
  noteRefsFromHrefs((insight.evidence.examples ?? []).map(example => example.href));

export interface RunbookHealthView {
  effectiveness: RunbookEffectiveness;
  insights: OpsInsightView[];
  /** Missing-step insight id -> the note responders keep adding, for the viewer; absent when unreadable. */
  suggestedSteps: Record<string, string>;
}

/**
 * The Health section of one runbook. Null when runbook insights are off or the viewer may not read the
 * runbook (runbookReadWhere). Reads: settings, the visibility check, the stored insights, the runbook
 * by primary key, its latest run on idx_runbook_execution_runbook_recent and 90 days of two rollups on
 * idx_metric_rollup_subject.
 */
export async function getRunbookHealthView(
  runbookId: string,
  actor: AuthorizationActor,
  now: Date = new Date()
): Promise<RunbookHealthView | null> {
  const settings = await runbooksAreaOn();
  if (!settings) return null;
  if (!(await readableOpsInsightScopes(actor, 'RUNBOOK', [runbookId])).has(runbookId)) return null;
  const insights = await listInsightsForScope(actor, { type: 'RUNBOOK', id: runbookId });
  return withDbBudget(READ_BUDGET, async tx => {
    const runbook = await tx.runbook.findUnique({
      where: { id: runbookId },
      select: {
        updatedAt: true,
        draftVersion: { select: { updatedAt: true } },
        publishedVersion: { select: { publishedAt: true } },
      },
    });
    if (!runbook) return null;
    const windowDays = RUNBOOK_HEALTH_LIMITS.windowDays;
    const range = {
      from: new Date(now.getTime() - windowDays * DAY_MS),
      to: now,
      subjectKey: runbookId,
    };
    const lastRun = await tx.runbookExecution.findFirst({
      where: { runbookId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const runPoints = await queryOpsRollup(OPS_ROLLUPS.runbookRun, range, tx);
    const stepPoints = await queryOpsRollup(OPS_ROLLUPS.runbookStepOutcome, range, tx);
    const edits = [
      runbook.updatedAt,
      runbook.draftVersion?.updatedAt,
      runbook.publishedVersion?.publishedAt,
    ].filter((date): date is Date => date instanceof Date);

    const missingSteps = insights.filter(
      insight =>
        insight.kind === RUNBOOK_INSIGHT_KINDS.health && insight.key.startsWith('missing-step:')
    );
    const notes = await resolveNoteRefs(actor, missingSteps.flatMap(refsOf), tx);
    const suggestedSteps: Record<string, string> = {};
    for (const insight of missingSteps) {
      const texts = refsOf(insight)
        .map(ref => notes.get(`${ref.kind}:${ref.id}`)?.text)
        .filter((text): text is string => Boolean(text));
      const step =
        extractImperativeSteps(texts, 1)[0]?.name ?? texts[0]?.replace(/\s+/g, ' ').slice(0, 160);
      if (step) suggestedSteps[insight.id] = step;
    }

    return {
      effectiveness: summarizeRunbookEffectiveness({
        windowDays,
        fixWindowMinutes: settings.runbookFixWindowMinutes,
        runs: runStatsFromRollup(runPoints, settings.runbookFixWindowMinutes),
        steps: stepStatsFromRollup(stepPoints),
        lastRunAt: lastRun?.createdAt ?? null,
        lastEditedAt: edits.length
          ? new Date(Math.max(...edits.map(date => date.getTime())))
          : null,
      }),
      insights,
      suggestedSteps,
    };
  });
}

export interface MissingRunbookSuggestion extends ResolvedProblemNotes {
  insight: OpsInsightView;
  steps: DraftStep[];
}

/**
 * Open "write a runbook for this" suggestions on one service, each with the notes, problem title and draft
 * steps the viewer may read. A suggestion whose notes are all unreadable to the viewer still shows (its
 * counts are not sensitive) but has no notes and no steps, so it cannot be drafted by that viewer.
 */
export async function getMissingRunbookSuggestions(
  serviceId: string,
  actor: AuthorizationActor
): Promise<MissingRunbookSuggestion[]> {
  if (!(await runbooksAreaOn())) return [];
  const insights = (await listInsightsForScope(actor, { type: 'SERVICE', id: serviceId })).filter(
    insight => insight.kind === RUNBOOK_INSIGHT_KINDS.missing
  );
  if (insights.length === 0) return [];
  return withDbBudget(READ_BUDGET, async tx => {
    const notes = await resolveNoteRefs(actor, insights.flatMap(refsOf), tx);
    const readableIncidents = [...new Set([...notes.values()].map(note => note.incidentId))];
    const templates = readableIncidents.length
      ? await tx.incidentFingerprint.findMany({
          where: { incidentId: { in: readableIncidents } },
          select: { incidentId: true, template: true },
        })
      : [];
    const templateOf = new Map(templates.map(row => [row.incidentId, row.template]));
    return insights.map(insight => {
      const readable = refsOf(insight)
        .map(ref => notes.get(`${ref.kind}:${ref.id}`))
        .filter((note): note is { incidentId: string; text: string } => Boolean(note));
      const texts = readable.map(note => note.text);
      return {
        insight,
        template: readable.map(note => templateOf.get(note.incidentId)).find(Boolean) ?? '',
        notes: texts,
        steps: extractImperativeSteps(texts),
      };
    });
  });
}
