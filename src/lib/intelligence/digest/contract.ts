import { z } from 'zod/v4';

/** Shared with the settings form, so this module must stay dependency-free. */

export const DIGEST_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export const DIGEST_SETTINGS_DEFAULTS = { enabled: false, dayOfWeek: 1, hourUtc: 8 } as const;

export const digestSettingsInputSchema = z.object({
  enabled: z.boolean(),
  dayOfWeek: z.number().int().min(0).max(6),
  hourUtc: z.number().int().min(0).max(23),
  expectedRevision: z.number().int().min(0),
});
export type DigestSettingsInput = z.infer<typeof digestSettingsInputSchema>;

const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of the ISO week containing `date`. */
export function isoWeekStart(date: Date): Date {
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - day * DAY_MS);
}

/** ISO-8601 week label such as "2026-W05"; the week belongs to the year of its Thursday. */
export function isoWeekKey(date: Date): string {
  const thursday = new Date(isoWeekStart(date).getTime() + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const firstThursdayWeek = isoWeekStart(new Date(Date.UTC(year, 0, 4)));
  const week = Math.round((isoWeekStart(date).getTime() - firstThursdayWeek.getTime()) / (7 * DAY_MS)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** When this ISO week's digest is due. */
export function digestScheduledFor(now: Date, schedule: { dayOfWeek: number; hourUtc: number }): Date {
  const offsetDays = (schedule.dayOfWeek + 6) % 7;
  return new Date(isoWeekStart(now).getTime() + offsetDays * DAY_MS + schedule.hourUtc * 3_600_000);
}

/**
 * True once this week's send time has passed. A digest missed while the lane was down is sent late in
 * the same week, but never carried into the next one, so an outage cannot cause a burst of old mail.
 */
export function isDigestDue(now: Date, schedule: { enabled: boolean; dayOfWeek: number; hourUtc: number }): boolean {
  return schedule.enabled && now.getTime() >= digestScheduledFor(now, schedule).getTime();
}
