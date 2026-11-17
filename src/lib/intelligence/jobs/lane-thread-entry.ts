/**
 * Entry point of the child process that runs the intelligence lane for an `integrated` process (see
 * lane-thread.ts). Bundled to scripts/dist/intelligence-lane-thread.cjs by
 * scripts/build-intelligence-lane-thread.mjs; never imported by application code.
 *
 * The process has its own V8 heap, event loop and Prisma client (the lane's pool), so the lane's response
 * parsing, allocation and garbage collection never pause `processEvent` in the parent, and nothing that
 * happens here (an uncaught error, running out of memory, a crash in the query engine) can end it.
 */
import { disconnectPrisma } from '@/lib/prisma';
import {
  exitWithParent,
  laneHostForThread,
  parentProcessPort,
  serveLaneThread,
} from './lane-thread-channel';
import {
  configureLaneHost,
  getLocalIntelligenceLaneStatus,
  startIntelligenceLane,
  stopIntelligenceLane,
} from './runner';

const port = parentProcessPort();
exitWithParent();
const host = laneHostForThread(port);
const server = serveLaneThread(port, {
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
