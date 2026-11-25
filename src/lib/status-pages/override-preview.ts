import { statusPresentation } from './status-presentation';

/** "Dec 3, 2026, 14:30" in the given zone; UTC when none. */
function stamp(date: Date, timeZone?: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(date);
}

/** Local zone as the browser reports it, e.g. "Asia/Kolkata". */
export function describeLocalZone(timeZone: string, at: Date): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find(item => item.type === 'timeZoneName')?.value;
  return `${timeZone}${part ? ` (${part})` : ''}`;
}

/**
 * One sentence describing what an override will do, in the admin's zone and in UTC so the end
 * time is unambiguous across teams. `until: null` means the 30-day maximum.
 */
export function describeOverrideEffect(input: {
  status: string | null;
  until: string | null;
  timeZone: string;
  maxDays?: number;
  now?: Date;
}): string {
  if (!input.status) return 'Shown automatically from incidents.';
  const now = input.now ?? new Date();
  const label = statusPresentation(input.status as never).label;
  const end = input.until
    ? new Date(input.until)
    : new Date(now.getTime() + (input.maxDays ?? 30) * 86_400_000);
  if (Number.isNaN(end.getTime())) return `Shown as ${label}.`;
  if (end <= now) return `Ends in the past, so it cannot be applied.`;
  const local = stamp(end, input.timeZone);
  const utc = stamp(end, 'UTC');
  const lead = input.until ? 'Shown' : 'No end time set, so shown';
  return `${lead} as ${label} until ${local} (${input.timeZone}) / ${utc} UTC, then automatic.`;
}
