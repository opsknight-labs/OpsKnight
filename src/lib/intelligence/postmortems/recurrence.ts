/**
 * Postmortem recurrence: how often a problem (the masked incident title of `IncidentFingerprint.template`)
 * came back on a service, the last postmortem written for it and the follow-ups still open. Pure and
 * client-safe: the loaders in `./loaders` read the rows, everything here only shapes them.
 */

export const RECURRENCE_WINDOW_DAYS = 90;
export const RECURRENCE_LIMITS = {
  /** Earlier occurrences read per incident; a longer history is reported as "N+". */
  occurrences: 100,
  /** Earlier incidents listed. */
  incidents: 5,
  /** Open action items listed. */
  actionItems: 10,
  /** Recurring problems read per service for the insight. */
  problems: 20,
  /** Overdue action items read per service for the insight. */
  overdueItems: 100,
} as const;

const DAY_MS = 86_400_000;

export interface RecurrenceActionItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  incidentId: string;
  overdue: boolean;
}

export interface PostmortemRecurrence {
  /** Masked title shared by every occurrence. */
  template: string;
  windowDays: number;
  /** Occurrences inside the window, this incident included. */
  occurrences: number;
  /** The read cap was reached: there may be more occurrences than counted. */
  capped: boolean;
  /** Earlier occurrences, most recent first. */
  previous: Array<{ incidentId: string; title: string; createdAt: Date }>;
  lastPostmortem: { incidentId: string; title: string; status: string; createdAt: Date } | null;
  /** Follow-ups from earlier occurrences that are not completed, most urgent first. */
  openActionItems: RecurrenceActionItem[];
  openActionItemCount: number;
  overdueActionItemCount: number;
}

/** "Seen 4 times in 90 days", or null when this is the first occurrence (nothing to say). */
export function recurrenceHeadline(
  recurrence: Pick<PostmortemRecurrence, 'occurrences' | 'capped' | 'windowDays'>
): string | null {
  if (recurrence.occurrences < 2) return null;
  return `Seen ${recurrence.occurrences}${recurrence.capped ? '+' : ''} times in ${recurrence.windowDays} days`;
}

export const isOverdue = (item: { dueDate: Date | null; status: string }, now: Date): boolean =>
  item.status !== 'COMPLETED' && item.dueDate !== null && item.dueDate.getTime() < now.getTime();

/** One insight as the shared operations-insight store takes it (`OpsInsightItem`), declared here so this stays pure. */
export interface PostmortemInsightItem {
  key: string;
  kind: typeof REPEAT_CAUSE_OVERDUE_KIND;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  summary: string;
  evidence: {
    window: string;
    facts: Array<{ label: string; value: string }>;
    examples: Array<{ label: string; href: string }>;
  };
}

export const REPEAT_CAUSE_OVERDUE_KIND = 'postmortem.repeat-cause-overdue-action';

export interface RepeatCauseInput {
  now: Date;
  windowDays: number;
  problems: Array<{
    /** Stable identity of the problem on this service (the template hash). */
    key: string;
    template: string;
    occurrences: number;
    lastSeenAt: Date;
    latestIncidentId: string;
    /** Not completed and past their due date, from any earlier occurrence of this problem. */
    overdueActionItems: Array<{
      id: string;
      title: string;
      priority: string;
      dueDate: Date;
      incidentId: string;
    }>;
  }>;
}

const clip = (text: string, max: number) => {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};
const day = (date: Date) => date.toISOString().slice(0, 10);
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * "This problem keeps coming back and the follow-up that should prevent it is overdue": one insight per
 * recurring problem with at least one overdue action item. Critical when the follow-up is high priority or a
 * month late on a problem seen three or more times. Deterministic: the same input yields the same items.
 */
export function deriveRepeatCauseInsights(input: RepeatCauseInput): PostmortemInsightItem[] {
  const items: PostmortemInsightItem[] = [];
  for (const problem of input.problems) {
    const overdue = [...problem.overdueActionItems]
      .filter(item => item.dueDate.getTime() < input.now.getTime())
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id));
    if (problem.occurrences < 2 || overdue.length === 0) continue;
    const oldest = overdue[0];
    const daysLate = Math.floor((input.now.getTime() - oldest.dueDate.getTime()) / DAY_MS);
    const serious = overdue.some(item => item.priority === 'HIGH') || daysLate >= 30;
    items.push({
      key: problem.key.slice(0, 200),
      kind: REPEAT_CAUSE_OVERDUE_KIND,
      severity: serious && problem.occurrences >= 3 ? 'CRITICAL' : 'WARNING',
      title: clip(
        `Repeat problem with ${plural(overdue.length, 'overdue action item')}: ${problem.template}`,
        140
      ),
      summary: clip(
        `"${clip(problem.template, 120)}" came back ${problem.occurrences} times in ${input.windowDays} days while ${plural(overdue.length, 'follow-up')} from an earlier postmortem ${overdue.length === 1 ? 'is' : 'are'} past due.`,
        400
      ),
      evidence: {
        window: `last ${input.windowDays} days`,
        facts: [
          { label: 'Occurrences', value: String(problem.occurrences) },
          { label: 'Last seen', value: day(problem.lastSeenAt) },
          { label: 'Overdue action items', value: String(overdue.length) },
          { label: 'Longest overdue', value: plural(Math.max(daysLate, 0), 'day') },
        ],
        examples: [
          ...overdue.slice(0, 3).map(item => ({
            label: clip(`${item.title} (due ${day(item.dueDate)})`, 160),
            href: `/postmortems/${item.incidentId}`,
          })),
          { label: 'Latest occurrence', href: `/incidents/${problem.latestIncidentId}` },
        ],
      },
    });
  }
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}
