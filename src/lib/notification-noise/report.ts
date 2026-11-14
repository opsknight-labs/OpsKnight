import type { OpsRollupPoint } from '@/lib/metric-rollup';

/**
 * Personal notification noise report. Pure: no database, no server-only imports, so the settings UI can
 * import the types. Fed by the daily pages rollup (OPS_ROLLUPS.pagesPerUserService).
 *
 * A "page" is one incident that notified the person on a day (however many channels it used), placed at
 * the local hour of its first notification that day.
 */

export const NOISE_REPORT_DAYS = 30;
/** An incident the source or automation closed this soon after opening needed nobody. */
export const AUTO_RESOLVE_WINDOW_MINUTES = 5;

/** One rollup row: UTC day, service and the person's local hour. */
export interface NoiseDailyRow {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  serviceId: string;
  /** Local hour, 0-23. */
  hour: number;
  pages: number;
  /** Pages the person acknowledged (through the page itself, or as the incident's assignee). */
  acted: number;
  /** Pages for incidents that resolved without a person within AUTO_RESOLVE_WINDOW_MINUTES. */
  autoResolved: number;
}

export interface NoiseCounts {
  pages: number;
  acted: number;
  autoResolved: number;
}

export interface NoiseServiceRow extends NoiseCounts {
  serviceId: string;
  serviceName: string;
}

export interface NoiseReport extends NoiseCounts {
  days: number;
  /** Busiest first. */
  byService: NoiseServiceRow[];
  /** Always 24 entries, index = local hour. */
  byHour: Array<NoiseCounts & { hour: number }>;
}

const DAY_MS = 86_400_000;

/** The report window: the last NOISE_REPORT_DAYS complete UTC days, the days the rollup has. */
export function noiseWindow(now: Date, days: number = NOISE_REPORT_DAYS): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { from: new Date(to.getTime() - days * DAY_MS), to };
}

/** Rollup points to report rows; points with a malformed tag are skipped. */
export function toNoiseDailyRows(points: readonly OpsRollupPoint[]): NoiseDailyRow[] {
  return points.flatMap(point => {
    const tags = (point.tags ?? {}) as {
      serviceId?: unknown;
      hour?: unknown;
      autoResolved?: unknown;
    };
    if (typeof tags.serviceId !== 'string' || typeof tags.hour !== 'number') return [];
    return [
      {
        day: point.bucket.toISOString().slice(0, 10),
        serviceId: tags.serviceId,
        hour: tags.hour,
        pages: point.count,
        acted: point.sum,
        autoResolved: tags.autoResolved === true ? point.count : 0,
      },
    ];
  });
}

const empty = (): NoiseCounts => ({ pages: 0, acted: 0, autoResolved: 0 });

function add(into: NoiseCounts, row: NoiseCounts) {
  into.pages += row.pages;
  into.acted += row.acted;
  into.autoResolved += row.autoResolved;
}

export function buildNoiseReport(
  rows: readonly NoiseDailyRow[],
  serviceNames: ReadonlyMap<string, string>,
  days: number = NOISE_REPORT_DAYS
): NoiseReport {
  const total = empty();
  const services = new Map<string, NoiseCounts>();
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, ...empty() }));
  for (const row of rows) {
    if (row.pages <= 0 || row.hour < 0 || row.hour > 23) continue;
    add(total, row);
    add(byHour[row.hour], row);
    const service = services.get(row.serviceId) ?? empty();
    add(service, row);
    services.set(row.serviceId, service);
  }
  const byService = [...services.entries()]
    .map(([serviceId, counts]) => ({
      serviceId,
      serviceName: serviceNames.get(serviceId) ?? 'A service you cannot open',
      ...counts,
    }))
    .sort((a, b) => b.pages - a.pages || a.serviceName.localeCompare(b.serviceName));
  return { days, ...total, byService, byHour };
}

/** Whole percent, 0 when there is nothing to divide by. */
export function share(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
