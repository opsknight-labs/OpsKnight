import { PUBLIC_SERVICE_STATUSES, type PublicServiceStatus } from './public-contract';

export type StatusOverrideValue = Exclude<PublicServiceStatus, 'UNKNOWN'>;

/** Statuses an admin may pin a business service to; UNKNOWN is never set by hand. */
export const STATUS_OVERRIDE_VALUES = PUBLIC_SERVICE_STATUSES.filter(
  (status): status is StatusOverrideValue => status !== 'UNKNOWN'
) as [StatusOverrideValue, ...StatusOverrideValue[]];

/** Longest an override may stay without being renewed, so a forgotten pin cannot mislead for long. */
export const MAX_OVERRIDE_DAYS = 30;

/** The override in force at `now`, or null when unset, unknown or lapsed. */
export function activeStatusOverride(
  row: { statusOverride: string | null; statusOverrideUntil: Date | string | null },
  now = new Date()
): StatusOverrideValue | null {
  if (!row.statusOverride) return null;
  if (row.statusOverrideUntil && new Date(row.statusOverrideUntil) <= now) return null;
  return (STATUS_OVERRIDE_VALUES as readonly string[]).includes(row.statusOverride)
    ? (row.statusOverride as StatusOverrideValue)
    : null;
}
