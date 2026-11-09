import 'server-only';
import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { logger } from '@/lib/logger';
import { getNoiseControlKpis } from '../noise-controls/kpis';

/**
 * Data for the wallboard's noise tile: today's pre-paging KPIs. Organisation-wide numbers, so shown only
 * to viewers who may read intelligence (INTELLIGENCE_READ, which every role holding it reads globally).
 * `off` when no service has noise controls in SHADOW or ON; the tile then says how to turn them on.
 */
export type WallboardNoiseTile =
  | { state: 'off'; canManage: boolean }
  | {
      state: 'on';
      shadowOnly: boolean;
      days: number;
      pagesAvoided: number;
      shadowWouldAvoid: number;
      compressionRatio: number;
      grouped: number;
      falseGroupPercent: number;
      heartbeatsMissing: number;
    };

export async function getWallboardNoiseTile(
  actor: AuthorizationActor,
  options: { now?: Date } = {},
  client: typeof prisma = prisma
): Promise<WallboardNoiseTile | null> {
  if (actor.status !== 'ACTIVE' || !hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_READ))
    return null;
  const canManage = hasCapability(actor.role, CAPABILITIES.INTELLIGENCE_MANAGE);
  try {
    const modes = await client.noiseControlPolicy.groupBy({
      by: ['mode'],
      where: { mode: { in: ['SHADOW', 'ON'] } },
      _count: { _all: true },
    });
    if (!modes.length) return { state: 'off', canManage };
    const kpis = await getNoiseControlKpis({ days: 1, now: options.now }, client);
    return {
      state: 'on',
      shadowOnly: !modes.some(row => row.mode === 'ON'),
      days: kpis.days,
      pagesAvoided: kpis.pagesAvoided,
      shadowWouldAvoid: kpis.shadowWouldAvoid,
      compressionRatio: kpis.compressionRatio,
      grouped: kpis.grouped,
      falseGroupPercent: Math.round(kpis.falseGroupRate * 1000) / 10,
      heartbeatsMissing: kpis.heartbeats.missing,
    };
  } catch (error) {
    logger.warn('[Intelligence] Wallboard noise tile unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
