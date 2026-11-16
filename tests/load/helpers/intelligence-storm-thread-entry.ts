/**
 * Child-process entry for `tests/load/intelligence-storm.ts --lane-mode thread`: the same drain loop as
 * the in-process run (helpers/storm-drain.ts), inside a lane thread started by the production host
 * (lane-thread.ts) and bundled by the production build script, so drain throughput is measured with the
 * lane where `integrated` runs it.
 */
import { disconnectPrisma } from '../../../src/lib/prisma';
import {
  configureLaneHost,
  getLocalIntelligenceLaneStatus,
} from '../../../src/lib/intelligence/jobs/runner';
import {
  exitWithParent,
  laneHostForThread,
  parentProcessPort,
  serveLaneThread,
} from '../../../src/lib/intelligence/jobs/lane-thread-channel';
import { drainQueue } from './storm-drain';

const port = parentProcessPort();
exitWithParent();
configureLaneHost(laneHostForThread(port));
const drained = drainQueue().then(
  result => port.postMessage({ type: 'storm-result', result }),
  error =>
    port.postMessage({
      type: 'storm-result',
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    })
);
serveLaneThread(port, {
  status: getLocalIntelligenceLaneStatus,
  stop: async () => {
    await drained;
    await disconnectPrisma().catch(() => {});
  },
});
