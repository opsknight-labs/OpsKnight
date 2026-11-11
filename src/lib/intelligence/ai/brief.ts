/**
 * The one incident brief every AI feature sends (summary, postmortem draft, proactive briefing, handoff).
 * Pure text assembly with a hard character budget per section, so a noisy incident cannot grow the prompt:
 * a section keeps whole lines until its budget is spent and says how many it left out. Callers pass facts
 * the reader is already allowed to see; nothing here reads the database.
 */

export interface BriefSection {
  heading?: string;
  lines: readonly string[];
  /** Hard cap on the characters this section's lines may add. */
  budget: number;
  /** Which end survives when the budget runs out. Timelines keep the latest lines. */
  keep?: 'head' | 'tail';
}

export const BRIEF_BUDGETS = {
  header: 1_200,
  text: 1_000,
  timeline: 8_000,
  notes: 8_000,
  changes: 1_200,
  upstream: 1_200,
  similar: 2_400,
  runbooks: 1_200,
} as const;

export const clipText = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Whole lines within the budget; a line longer than the budget on its own is clipped, never dropped. */
export function fitLines(section: BriefSection): string[] {
  const ordered = section.keep === 'tail' ? [...section.lines].reverse() : [...section.lines];
  const kept: string[] = [];
  let used = 0;
  for (const raw of ordered) {
    const line = kept.length === 0 ? clipText(raw, section.budget) : raw;
    if (used + line.length + 1 > section.budget && kept.length > 0) break;
    kept.push(line);
    used += line.length + 1;
  }
  const omitted = section.lines.length - kept.length;
  if (section.keep === 'tail') kept.reverse();
  if (omitted > 0) {
    const note = `- (${omitted} ${section.keep === 'tail' ? 'earlier' : 'more'} not shown)`;
    if (section.keep === 'tail') kept.unshift(note);
    else kept.push(note);
  }
  return kept;
}

export function renderBrief(sections: readonly BriefSection[]): string {
  const out: string[] = [];
  for (const section of sections) {
    if (section.lines.length === 0) continue;
    if (section.heading) out.push(section.heading);
    out.push(...fitLines(section));
  }
  return out.join('\n');
}

export interface IncidentBriefInput {
  title: string;
  serviceName: string;
  status: string;
  urgency: string;
  alertCount?: number;
  createdAt: Date;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
  description?: string | null;
  resolutionNote?: string | null;
  /** Oldest first. */
  timeline?: ReadonlyArray<{ at: Date; text: string }>;
  /** Oldest first. */
  notes?: ReadonlyArray<{ at: Date; author: string; text: string }>;
  changes?: ReadonlyArray<{ label: string; minutesBefore: number }>;
  upstream?: ReadonlyArray<{ title: string; serviceName: string; minutesBefore: number }>;
  similar?: ReadonlyArray<{ label: string; matchPercent: number; resolution?: string | null }>;
  runbooks?: ReadonlyArray<{ label: string; succeeded: number; eligible: number }>;
}

export function incidentBrief(input: IncidentBriefInput): string {
  const header = [
    `Incident: ${clipText(input.title, 300)}`,
    `Service: ${clipText(input.serviceName, 200)}`,
    `Status: ${input.status.toLowerCase()}; urgency ${input.urgency.toLowerCase()}${
      input.alertCount === undefined ? '' : `; alerts ${input.alertCount}`
    }`,
    `Opened: ${iso(input.createdAt)}`,
    input.acknowledgedAt ? `Acknowledged: ${iso(input.acknowledgedAt)}` : 'Acknowledged: not yet',
    input.resolvedAt ? `Resolved: ${iso(input.resolvedAt)}` : 'Resolved: not yet',
  ];
  return renderBrief([
    { lines: header, budget: BRIEF_BUDGETS.header },
    {
      lines: input.description ? [`Description: ${input.description}`] : [],
      budget: BRIEF_BUDGETS.text,
    },
    {
      lines: input.resolutionNote ? [`Resolution note: ${input.resolutionNote}`] : [],
      budget: BRIEF_BUDGETS.text,
    },
    {
      heading: 'Timeline (oldest first):',
      lines: (input.timeline ?? []).map(event => `- ${iso(event.at)} ${clipText(event.text, 300)}`),
      budget: BRIEF_BUDGETS.timeline,
      keep: 'tail',
    },
    {
      heading: 'Responder notes (oldest first):',
      lines: (input.notes ?? []).map(
        note => `- ${iso(note.at)} ${note.author}: ${clipText(note.text, 600)}`
      ),
      budget: BRIEF_BUDGETS.notes,
      keep: 'tail',
    },
    {
      heading: 'Changes shortly before onset (correlation only, not confirmed causes):',
      lines: (input.changes ?? []).map(
        change => `- ${clipText(change.label, 240)} (${change.minutesBefore} min before)`
      ),
      budget: BRIEF_BUDGETS.changes,
    },
    {
      heading: 'Upstream incidents shortly before (correlation only):',
      lines: (input.upstream ?? []).map(
        item =>
          `- ${clipText(item.title, 200)} on ${item.serviceName}, ${item.minutesBefore} min before`
      ),
      budget: BRIEF_BUDGETS.upstream,
    },
    {
      heading: 'Similar past incidents:',
      lines: (input.similar ?? []).map(
        item =>
          `- ${clipText(item.label, 200)} (${item.matchPercent}% match)${
            item.resolution ? `; resolved with: ${clipText(item.resolution, 200)}` : ''
          }`
      ),
      budget: BRIEF_BUDGETS.similar,
    },
    {
      heading: 'Runbooks that have worked on this service:',
      lines: (input.runbooks ?? []).map(
        runbook =>
          `- ${clipText(runbook.label, 200)} (${runbook.succeeded} of ${runbook.eligible} runs succeeded)`
      ),
      budget: BRIEF_BUDGETS.runbooks,
    },
  ]);
}
