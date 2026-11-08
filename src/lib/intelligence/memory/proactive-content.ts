import { z } from 'zod/v4';
import { redactSecrets } from '../ai/redact';
import { PROACTIVE_LIMITS } from './contract';

/**
 * The stored shape of proactive notes and the deterministic writers behind them. Pure: the lane gathers the facts,
 * these functions turn them into content, and the incident page renders it after filtering every reference
 * through the viewer's read rules. Free text mentions only the incident itself; anything about another record
 * (similar incidents, changes, runbooks) is stored as a reference and rendered only when the viewer may read it.
 */

const text = (max: number) => z.string().max(max);
const ref = z.object({ id: z.string().max(64), label: text(300) }).strict();

export const proactiveRefsSchema = z
  .object({
    similar: z
      .array(
        ref.extend({
          matchPercent: z.number().int().min(0).max(100),
          resolution: text(400).nullable(),
        })
      )
      .max(PROACTIVE_LIMITS.maxListItems),
    changes: z
      .array(ref.extend({ minutesBefore: z.number().int().min(0) }))
      .max(PROACTIVE_LIMITS.maxListItems),
    runbooks: z
      .array(ref.extend({ succeeded: z.number().int().min(0), eligible: z.number().int().min(0) }))
      .max(PROACTIVE_LIMITS.maxListItems),
  })
  .strict();
export type ProactiveRefs = z.infer<typeof proactiveRefsSchema>;

/** Every record the model saw. AI prose is shown only to a viewer who may read all of them. */
const inputRefsSchema = z
  .object({
    incidents: z.array(z.string().max(64)).max(20),
    changes: z.array(z.string().max(64)).max(20),
    runbooks: z.array(z.string().max(64)).max(20),
  })
  .strict();

const aiMeta = { model: text(200) };

export const briefingContentSchema = z
  .object({
    v: z.literal(1),
    headline: text(300),
    facts: z.array(text(300)).max(8),
    analysisPending: z.boolean(),
    refs: proactiveRefsSchema,
    ai: z
      .object({
        ...aiMeta,
        headline: text(200),
        currentState: text(600),
        possibleCauses: z.array(text(240)).max(5),
        nextSteps: z.array(text(240)).max(5),
        inputRefs: inputRefsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type BriefingContent = z.infer<typeof briefingContentSchema>;

export const nudgeContentSchema = z
  .object({
    v: z.literal(1),
    thresholdMinutes: z.number().int().min(1),
    lastUpdateAt: z.string().max(40),
    minutesSinceUpdate: z.number().int().min(0),
    draft: text(1_000),
    ai: z
      .object({ ...aiMeta, draft: text(1_000) })
      .strict()
      .optional(),
  })
  .strict();
export type NudgeContent = z.infer<typeof nudgeContentSchema>;

export const postmortemDraftContentSchema = z
  .object({
    v: z.literal(1),
    summary: text(2_000),
    impact: text(1_200),
    rootCause: text(2_000),
    resolution: text(2_000),
    lessons: text(2_000),
    timeline: z.array(z.object({ at: text(40), text: text(300) }).strict()).max(20),
    actionItems: z
      .array(z.object({ title: text(200), priority: z.enum(['HIGH', 'MEDIUM', 'LOW']) }).strict())
      .max(10),
    refs: proactiveRefsSchema,
    ai: z
      .object({
        ...aiMeta,
        summary: text(2_000),
        impact: text(1_200),
        rootCause: text(2_000),
        resolution: text(2_000),
        lessons: text(2_000),
        actionItems: z
          .array(
            z.object({ title: text(200), priority: z.enum(['HIGH', 'MEDIUM', 'LOW']) }).strict()
          )
          .max(10),
        inputRefs: inputRefsSchema,
      })
      .strict()
      .optional(),
  })
  .strict();
export type PostmortemDraftContent = z.infer<typeof postmortemDraftContentSchema>;

/** Facts about one incident, as the lane read them. Only this incident's own fields. */
export interface IncidentFacts {
  id: string;
  title: string;
  serviceName: string;
  status: string;
  urgency: string;
  createdAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  alertCount: number;
  resolutionNote: string | null;
  events: Array<{ at: Date; text: string }>;
}

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
const clean = (value: string, max: number) =>
  clip(redactSecrets(value).replace(/\s+/g, ' ').trim(), max);
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function buildBriefing(
  facts: IncidentFacts,
  refs: ProactiveRefs,
  options: { now: Date; analysisPending: boolean }
): BriefingContent {
  const age = minutesBetween(facts.createdAt, options.now);
  return {
    v: 1,
    headline: clean(`${facts.title} (${facts.serviceName})`, 300),
    facts: [
      `Opened ${durationText(age)} ago with ${facts.urgency.toLowerCase()} urgency; ${facts.alertCount} alert${facts.alertCount === 1 ? '' : 's'} so far.`,
      facts.acknowledgedAt
        ? `Acknowledged after ${durationText(minutesBetween(facts.createdAt, facts.acknowledgedAt))}.`
        : 'Not acknowledged yet.',
    ],
    analysisPending: options.analysisPending,
    refs,
  };
}

/**
 * Suggested next steps from the references the viewer may actually see, so a step never points at something
 * hidden from them. Deterministic and ordered by how much evidence backs each step.
 */
export function suggestNextSteps(refs: ProactiveRefs): string[] {
  const steps: string[] = [];
  const runbook = [...refs.runbooks].sort((a, b) => b.succeeded - a.succeeded)[0];
  if (runbook)
    steps.push(
      runbook.eligible > 0
        ? `Review the runbook “${runbook.label}” (it resolved ${runbook.succeeded} of ${runbook.eligible} similar runs).`
        : `Review the runbook “${runbook.label}”.`
    );
  const change = [...refs.changes].sort((a, b) => a.minutesBefore - b.minutesBefore)[0];
  if (change)
    steps.push(
      `Check the change “${change.label}”, recorded ${durationText(change.minutesBefore)} before this incident began; consider rolling it back if it matches.`
    );
  const precedent = refs.similar.find(item => item.resolution);
  if (precedent)
    steps.push(`A similar incident was resolved with: ${clip(precedent.resolution ?? '', 200)}`);
  steps.push('Confirm customer impact and post a stakeholder update.');
  return steps.slice(0, 4);
}

export function buildNudge(
  facts: IncidentFacts,
  options: { now: Date; lastUpdateAt: Date; thresholdMinutes: number }
): NudgeContent {
  const state =
    facts.status === 'ACKNOWLEDGED' ? 'We are investigating' : 'We are aware of and responding to';
  return {
    v: 1,
    thresholdMinutes: options.thresholdMinutes,
    lastUpdateAt: options.lastUpdateAt.toISOString(),
    minutesSinceUpdate: minutesBetween(options.lastUpdateAt, options.now),
    draft: clean(
      `${state} an issue affecting ${facts.serviceName}: ${facts.title}. Started ${iso(facts.createdAt)}, ${facts.urgency.toLowerCase()} urgency. Next update within 30 minutes.`,
      1_000
    ),
  };
}

export function buildPostmortemDraft(
  facts: IncidentFacts,
  refs: ProactiveRefs
): PostmortemDraftContent {
  const end = facts.resolvedAt ?? new Date(facts.createdAt);
  const duration = durationText(minutesBetween(facts.createdAt, end));
  const change = [...refs.changes].sort((a, b) => a.minutesBefore - b.minutesBefore)[0];
  return {
    v: 1,
    summary: clean(
      `${facts.title} affected ${facts.serviceName} for ${duration} (${iso(facts.createdAt)} to ${iso(end)}), with ${facts.urgency.toLowerCase()} urgency and ${facts.alertCount} alert${facts.alertCount === 1 ? '' : 's'}.`,
      2_000
    ),
    impact: 'To be completed: who and what was affected, and for how long.',
    rootCause: change
      ? 'Not yet confirmed. A change was recorded shortly before onset; verify whether it caused the incident.'
      : 'Not yet determined.',
    resolution: facts.resolutionNote ? clean(facts.resolutionNote, 2_000) : 'Not recorded.',
    lessons: 'To be completed by the team.',
    timeline: facts.events.slice(0, 20).map(event => ({
      at: iso(event.at),
      text: clean(event.text, 300),
    })),
    actionItems: [
      { title: 'Confirm and document the root cause', priority: 'HIGH' },
      ...(facts.acknowledgedAt && minutesBetween(facts.createdAt, facts.acknowledgedAt) > 15
        ? [
            {
              title: 'Review why acknowledgement took longer than 15 minutes',
              priority: 'MEDIUM' as const,
            },
          ]
        : []),
      {
        title: `Review alerting and runbooks for ${clip(facts.serviceName, 120)}`,
        priority: 'LOW',
      },
    ],
    refs,
  };
}

/** The plain-text brief the model receives: this incident's facts, plus references the lane already scoped. */
export function proactiveModelBrief(facts: IncidentFacts, refs: ProactiveRefs): string {
  const lines = [
    `Incident: ${facts.title}`,
    `Service: ${facts.serviceName}`,
    `Status: ${facts.status.toLowerCase()}; urgency ${facts.urgency.toLowerCase()}; alerts ${facts.alertCount}`,
    `Opened: ${iso(facts.createdAt)}`,
    facts.acknowledgedAt ? `Acknowledged: ${iso(facts.acknowledgedAt)}` : 'Acknowledged: not yet',
    facts.resolvedAt ? `Resolved: ${iso(facts.resolvedAt)}` : 'Resolved: not yet',
  ];
  if (facts.resolutionNote) lines.push(`Resolution note: ${clip(facts.resolutionNote, 1_000)}`);
  if (facts.events.length) {
    lines.push('Timeline (oldest first):');
    for (const event of facts.events.slice(0, 40))
      lines.push(`- ${iso(event.at)} ${clip(event.text, 300)}`);
  }
  if (refs.changes.length) {
    lines.push('Changes shortly before onset (correlation only, not confirmed causes):');
    for (const change of refs.changes)
      lines.push(`- ${change.label} (${change.minutesBefore} min before)`);
  }
  if (refs.similar.length) {
    lines.push('Similar past incidents on the same service:');
    for (const item of refs.similar)
      lines.push(
        `- ${item.label} (${item.matchPercent}% match)${item.resolution ? `; resolved with: ${clip(item.resolution, 200)}` : ''}`
      );
  }
  if (refs.runbooks.length) {
    lines.push('Runbooks that have worked on this service:');
    for (const runbook of refs.runbooks)
      lines.push(`- ${runbook.label} (${runbook.succeeded} of ${runbook.eligible} runs succeeded)`);
  }
  return redactSecrets(lines.join('\n'));
}

export function inputRefsOf(refs: ProactiveRefs) {
  return {
    incidents: refs.similar.map(item => item.id),
    changes: refs.changes.map(item => item.id),
    runbooks: refs.runbooks.map(item => item.id),
  };
}

/** Keeps only references the viewer may read; AI prose survives only if every input it saw is readable. */
export function filterProactiveRefs(
  refs: ProactiveRefs,
  visible: {
    incidents: ReadonlySet<string>;
    changes: ReadonlySet<string>;
    runbooks: ReadonlySet<string>;
  }
): ProactiveRefs {
  return {
    similar: refs.similar.filter(item => visible.incidents.has(item.id)),
    changes: refs.changes.filter(item => visible.changes.has(item.id)),
    runbooks: refs.runbooks.filter(item => visible.runbooks.has(item.id)),
  };
}

export function aiInputsVisible(
  inputs: { incidents: string[]; changes: string[]; runbooks: string[] },
  visible: {
    incidents: ReadonlySet<string>;
    changes: ReadonlySet<string>;
    runbooks: ReadonlySet<string>;
  }
): boolean {
  return (
    inputs.incidents.every(id => visible.incidents.has(id)) &&
    inputs.changes.every(id => visible.changes.has(id)) &&
    inputs.runbooks.every(id => visible.runbooks.has(id))
  );
}
