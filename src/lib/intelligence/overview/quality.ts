import 'server-only';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import {
  ALERT_QUALITY_WINDOW_DAYS,
  getAlertQualityLeaderboard,
  type AlertQualityRow,
} from '../triage/alert-quality';

const TOP = 5;

export interface OverviewQuality {
  /** The alert-quality leaderboard always looks back this many days, whatever window is selected. */
  windowDays: number;
  noisy: AlertQualityRow[];
  flapping: AlertQualityRow[];
  /** Whether the Jira one-click fix can be offered. */
  jiraConfigured: boolean;
}

/**
 * Noisiest and most flapping services the viewer can read, from the alert-quality leaderboard (which is
 * already scoped and bounded to 2,000 services and 25 rows). Nothing here suppresses or changes anything;
 * the page links each row to the existing fix flows.
 */
export async function getOverviewQuality(
  actor: AuthorizationActor,
  now: Date = new Date(),
  client: typeof prisma = prisma
): Promise<OverviewQuality> {
  const [rows, jira] = await Promise.all([
    getAlertQualityLeaderboard(actor, now, client),
    client.jiraConfig
      .findUnique({ where: { id: 'default' }, select: { enabled: true } })
      .catch(() => null),
  ]);
  return {
    windowDays: ALERT_QUALITY_WINDOW_DAYS,
    noisy: rows.filter(row => row.noiseScore > 0).slice(0, TOP),
    flapping: rows
      .filter(row => row.flappingRatio > 0)
      .sort((a, b) => b.flappingRatio - a.flappingRatio || b.incidents - a.incidents)
      .slice(0, TOP),
    jiraConfigured: Boolean(jira?.enabled),
  };
}
