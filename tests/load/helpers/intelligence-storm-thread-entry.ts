/**
 * Worker-thread entry for `tests/load/intelligence-storm.ts --lane-mode thread`: the same drain loop as
 * the in-process run (helpers/storm-drain.ts), inside a lane thread started by the production host
 * (lane-thread.ts) and bundled by the production build script, so drain throughput is measured with the
 * lane where `integrated` runs it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { disconnectPrisma } from '../../../src/lib/prisma';
import {
  configureLaneHost,
  getLocalIntelligenceLaneStatus,
} from '../../../src/lib/intelligence/jobs/runner';
import {
  laneHostForThread,
  serveLaneThread,
  type LaneThreadData,
} from '../../../src/lib/intelligence/jobs/lane-thread-channel';
import { drainQueue } from './storm-drain';

if (!parentPort) throw new Error('Run this entry in a worker thread');
const port = parentPort;
configureLaneHost(laneHostForThread(workerData as LaneThreadData));
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
