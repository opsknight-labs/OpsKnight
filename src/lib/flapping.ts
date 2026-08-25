import prisma from './prisma';
import { logger } from './logger';

export interface FlappingConfig {
  /** Sliding window in seconds to count state transitions (default: 180s = 3 min) */
  windowSeconds: number;
  /** Number of state transitions within the window that constitute flapping (default: 4) */
  stateChangeThreshold: number;
}

const DEFAULT_CONFIG: FlappingConfig = {
  windowSeconds: 180,
  stateChangeThreshold: 4,
};

/**
 * Detects whether an alert is flapping based on rapid TRIGGERED <-> RESOLVED
 * oscillations within a sliding window.
 *
 * Uses the Alert table to count recent state transitions for the given dedupKey
 * on the specified service. If the transition count meets or exceeds the threshold,
 * the alert is considered flapping and the caller should set status: 'SUPPRESSED'
 * instead of opening a new incident and paging on-call responders.
 */
export async function checkAlertFlapping(
  dedupKey: string,
  serviceId: string,
  config: FlappingConfig = DEFAULT_CONFIG
): Promise<{ isFlapping: boolean; transitionCount: number }> {
  try {
    const windowStart = new Date(Date.now() - config.windowSeconds * 1000);

    const recentAlerts = await prisma.alert.findMany({
      where: {
        dedupKey,
        serviceId,
        createdAt: { gte: windowStart },
      },
      select: { status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    if (recentAlerts.length < config.stateChangeThreshold) {
      return { isFlapping: false, transitionCount: recentAlerts.length };
    }

    // Count state transitions (TRIGGERED -> RESOLVED or RESOLVED -> TRIGGERED)
    let transitions = 0;
    let lastStatus: string | null = null;

    for (const alert of recentAlerts) {
      if (lastStatus !== null && alert.status !== lastStatus) {
        transitions++;
      }
      lastStatus = alert.status;
    }

    const isFlapping = transitions >= config.stateChangeThreshold;

    if (isFlapping) {
      logger.warn('[Flapping] Alert flapping detected', {
        dedupKey,
        serviceId,
        transitions,
        threshold: config.stateChangeThreshold,
        windowSeconds: config.windowSeconds,
        recentAlertCount: recentAlerts.length,
      });
    }

    return { isFlapping, transitionCount: transitions };
  } catch (error) {
    logger.error('[Flapping] Error during flapping check', {
      dedupKey,
      serviceId,
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, assume not flapping to avoid suppressing genuine incidents
    return { isFlapping: false, transitionCount: 0 };
  }
}
