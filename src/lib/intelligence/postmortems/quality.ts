/**
 * Deterministic quality checklist for a postmortem being edited. Pure and client-safe: the editor calls it
 * on every change and shows only what is still missing (nothing when the postmortem is complete).
 */

export const TIMELINE_GAP_MINUTES = 30;

export type QualityIssueCode =
  | 'MISSING_ROOT_CAUSE'
  | 'NO_ACTION_ITEMS'
  | 'ACTION_ITEMS_WITHOUT_OWNER'
  | 'ACTION_ITEMS_WITHOUT_DUE_DATE'
  | 'TIMELINE_GAP';

export interface QualityIssue {
  code: QualityIssueCode;
  message: string;
}

export interface QualityInput {
  rootCause: string | null | undefined;
  actionItems: ReadonlyArray<{ owner?: string | null; dueDate?: string | null; status?: string }>;
  timeline: ReadonlyArray<{ timestamp: string }>;
  /** When the incident started and was resolved; without it the timeline is not checked. */
  window: { start: Date | string; end: Date | string | null } | null;
}

const MINUTE_MS = 60_000;
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The auto-draft placeholder is not a root cause. */
const hasRootCause = (text: string | null | undefined) => {
  const value = (text ?? '').trim();
  return value.length > 0 && !/^to be determined/i.test(value);
};

/** Gaps longer than the threshold between consecutive timeline entries while the incident was open. */
export function timelineGaps(
  timeline: QualityInput['timeline'],
  window: NonNullable<QualityInput['window']>,
  thresholdMinutes = TIMELINE_GAP_MINUTES
): Array<{ from: Date; minutes: number }> {
  const start = new Date(window.start).getTime();
  const end = window.end === null ? NaN : new Date(window.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const inside = timeline
    .map(event => new Date(event.timestamp).getTime())
    .filter(at => Number.isFinite(at) && at >= start && at <= end)
    .sort((a, b) => a - b);
  const points = [start, ...inside, end];
  const gaps: Array<{ from: Date; minutes: number }> = [];
  points.slice(1).forEach((point, index) => {
    const previous = points.at(index) as number;
    const minutes = Math.floor((point - previous) / MINUTE_MS);
    if (minutes > thresholdMinutes) gaps.push({ from: new Date(previous), minutes });
  });
  return gaps;
}

export function checkPostmortemQuality(input: QualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (!hasRootCause(input.rootCause))
    issues.push({ code: 'MISSING_ROOT_CAUSE', message: 'No root cause is written yet.' });

  if (input.actionItems.length === 0) {
    issues.push({ code: 'NO_ACTION_ITEMS', message: 'There are no action items.' });
  } else {
    const open = input.actionItems.filter(item => item.status !== 'COMPLETED');
    const noOwner = open.filter(item => !item.owner).length;
    const noDue = open.filter(item => !item.dueDate).length;
    if (noOwner > 0)
      issues.push({
        code: 'ACTION_ITEMS_WITHOUT_OWNER',
        message: `${noOwner} open action ${plural(noOwner, 'item has', 'items have')} no owner.`,
      });
    if (noDue > 0)
      issues.push({
        code: 'ACTION_ITEMS_WITHOUT_DUE_DATE',
        message: `${noDue} open action ${plural(noDue, 'item has', 'items have')} no due date.`,
      });
  }

  if (input.window) {
    const gaps = timelineGaps(input.timeline, input.window);
    if (gaps.length > 0) {
      const longest = Math.max(...gaps.map(gap => gap.minutes));
      issues.push({
        code: 'TIMELINE_GAP',
        message: `The timeline has ${gaps.length} ${plural(gaps.length, 'gap', 'gaps')} longer than ${TIMELINE_GAP_MINUTES} minutes while the incident was open (longest ${longest} min).`,
      });
    }
  }
  return issues;
}
