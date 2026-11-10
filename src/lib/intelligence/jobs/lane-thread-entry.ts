/**
 * Entry point of the worker thread that runs the intelligence lane for an `integrated` process (see
 * lane-thread.ts). Bundled to scripts/dist/intelligence-lane-thread.cjs by
 * scripts/build-intelligence-lane-thread.mjs; never imported by application code.
 *
 * The thread has its own V8 heap, event loop and Prisma client (the lane's pool), so the lane's response
 * parsing, allocation and garbage collection never pause `processEvent` on the main thread.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { disconnectPrisma } from '@/lib/prisma';
import { laneHostForThread, serveLaneThread, type LaneThreadData } from './lane-thread-channel';
import {
  configureLaneHost,
  getLocalIntelligenceLaneStatus,
  startIntelligenceLane,
  stopIntelligenceLane,
} from './runner';

if (!parentPort) throw new Error('The intelligence lane thread entry must run in a worker thread');

const host = laneHostForThread(workerData as LaneThreadData);
const server = serveLaneThread(parentPort, {
  status: getLocalIntelligenceLaneStatus,
  stop: async () => {
    try {
      await stopIntelligenceLane();
    } finally {
      await disconnectPrisma().catch(() => {});
    }
  },
});
configureLaneHost({ ...host, onCycle: () => server.report() });
startIntelligenceLane();
server.flush();
