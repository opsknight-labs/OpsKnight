import 'server-only';
import { createHash } from 'node:crypto';
import { OPS_INSIGHT_LIMITS, type OpsInsightItem } from '../contract';
import type { OpsInsightProducer } from '../producer';
import { noteRefHref } from '../../runbook-health/insights';
import {
  missingRunbookProblems,
  type MissingRunbookProblem,
  type ProblemNotes,
} from '../../runbook-health/notes';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 90;
const PROBLEM_INCIDENTS = 300;
export const RESOLVED_PREFIX = 'Resolved: ';
/** Where a person reviews the suggestion with the notes they may read and creates the draft. */
export const missingRunbookHref = (serviceId: string) =>
  `/services/${serviceId}?tab=runbooks#missing-runbooks`;

export interface MissingRunbookInput {
  serviceId: string;
  problems: MissingRunbookProblem[];
}

/**
 * Missing runbook (plan J5), scope SERVICE: a recurring problem (one masked incident title) that responders
 * resolved by hand with at least three similar resolution notes, and no runbook ran on any of those
 * incidents. The stored insight holds the problem's hash, counts and links to the notes by id; the notes,
 * the problem's title and the draft steps are resolved on read for the incidents the viewer may read.
 *
 * Reads, three statements: the service's latest 300 resolved fingerprints in 90 days on
 * idx_incident_fingerprint_service_recent, their MANUAL_RESOLVED events on idx_event_type, and runbook
 * runs on those incidents on RunbookExecution ("incidentId").
 */
export const missingRunbookProducer: OpsInsightProducer<MissingRunbookInput> = {
  kind: 'runbook.missing',
  version: 1,
  area: 'runbooks',
  scopeType: 'SERVICE',

  async loadInput(scope, { tx, now }) {
    const fingerprints = await tx.incidentFingerprint.findMany({
      where: {
        serviceId: scope.id,
        incidentCreatedAt: { gte: new Date(now.getTime() - WINDOW_DAYS * DAY_MS) },
        resolvedAt: { not: null },
      },
      orderBy: { incidentCreatedAt: 'desc' },
      take: PROBLEM_INCIDENTS,
      select: { incidentId: true, template: true, templateHash: true },
    });
    if (fingerprints.length === 0) return null;
    const incidentIds = fingerprints.map(row => row.incidentId);
    const events = await tx.incidentEvent.findMany({
      where: {
        incidentId: { in: incidentIds },
        type: 'MANUAL_RESOLVED',
        message: { startsWith: RESOLVED_PREFIX },
      },
      orderBy: { createdAt: 'desc' },
      take: PROBLEM_INCIDENTS * 2,
      select: { id: true, incidentId: true, message: true },
    });
    if (events.length === 0) return null;
    const ran = await tx.runbookExecution.groupBy({
      by: ['incidentId'],
      where: { incidentId: { in: incidentIds } },
      _count: { _all: true },
    });
    const runsByIncident = new Map(ran.map(row => [row.incidentId, row._count._all]));
    // Newest first: a reopened incident keeps only its latest resolution note.
    const noteByIncident = new Map<string, { id: string; text: string }>();
    for (const event of events)
      if (!noteByIncident.has(event.incidentId))
        noteByIncident.set(event.incidentId, {
          id: event.id,
          text: event.message.slice(RESOLVED_PREFIX.length),
        });

    const problems = new Map<string, ProblemNotes & { notes: ProblemNotes['notes'][number][] }>();
    for (const row of fingerprints) {
      if (!row.template) continue;
      const hash =
        row.templateHash ?? createHash('sha256').update(row.template).digest('hex').slice(0, 32);
      let problem = problems.get(hash);
      if (!problem) {
        problem = { templateHash: hash, notes: [], runbookRuns: 0 };
        problems.set(hash, problem);
      }
      problem.runbookRuns += runsByIncident.get(row.incidentId) ?? 0;
      const note = noteByIncident.get(row.incidentId);
      if (note)
        problem.notes.push({
          kind: 'event',
          id: note.id,
          incidentId: row.incidentId,
          text: note.text,
        });
    }
    return {
      serviceId: scope.id,
      problems: missingRunbookProblems([...problems.values()], OPS_INSIGHT_LIMITS.examples),
    };
  },

  derive({ serviceId, problems }): OpsInsightItem[] {
    return problems.map(problem => ({
      key: problem.templateHash,
      severity: 'INFO',
      title: `${problem.noteCount} incidents of one recurring problem were resolved by hand the same way`,
      summary: `No runbook ran on any of them, and their resolution notes describe ${problem.stepCount} ${
        problem.stepCount === 1 ? 'step' : 'steps'
      }. Review the notes and draft a runbook from them.`,
      evidence: {
        window: `last ${WINDOW_DAYS} days`,
        facts: [
          { label: 'Similar resolution notes', value: String(problem.noteCount) },
          { label: 'Draft steps found', value: String(problem.stepCount) },
          { label: 'Runbook runs on these incidents', value: '0' },
        ],
        examples: problem.refs.map((ref, index) => ({
          label: `Resolution note ${index + 1}`,
          href: noteRefHref(ref),
        })),
      },
      draftHref: missingRunbookHref(serviceId),
    }));
  },
};
