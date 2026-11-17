import 'server-only';
import type { LaneStandIn } from './lane-thread';
import {
  configureLaneHost,
  getLocalIntelligenceLaneStatus,
  startIntelligenceLane,
  stopIntelligenceLane,
} from './runner';

/**
 * The lane of an `integrated` process while intelligence is disabled and no lane thread exists (see
 * lane-thread.ts). It is the ordinary lane on the main thread, which while disabled reads one settings
 * row per poll and runs the disabled-time sweeps, exactly as before the thread existed. It never works
 * enabled: the first cycle that reads settings as enabled calls `handOff` and the host moves the lane
 * into a thread. Kept apart from lane-thread.ts so the thread host itself never loads the lane.
 */
export const mainThreadLaneStandIn: LaneStandIn = {
  start: handOff => {
    configureLaneHost({ handOffWhenEnabled: handOff });
    startIntelligenceLane();
  },
  stop: async () => {
    try {
      await stopIntelligenceLane();
    } finally {
      configureLaneHost({});
    }
  },
  status: getLocalIntelligenceLaneStatus,
};
