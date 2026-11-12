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
  /** Open action items read across earlier occurrences (counted, then the first few listed). */
  openItems: 100,
} as const;

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
