import 'server-only';
import prisma from '@/lib/prisma';
import {
  enqueueWorkItems,
  WORK_KINDS,
  type ClaimedWorkItem,
  type WorkKind,
} from '../jobs/work-queue';
import type { IntelligenceSettingsView } from '../settings/service';
import { KNOWLEDGE_LIMITS, PROACTIVE_LIMITS } from './contract';
import { PROACTIVE_SCAN_SUBJECT, runProactiveJob, scanProactiveWork } from './proactive';
import { squireKnowledgeEnabled } from './settings';
import { KNOWLEDGE_SUBJECT, syncKnowledgePass } from './sync';

type Handler = (
  item: ClaimedWorkItem,
  context: { settings: IntelligenceSettingsView; signal: AbortSignal }
) => Promise<void>;

/**
 * Lane handlers for Squire's knowledge memory and proactive notes. Registered into the runner's
 * DEFAULT_HANDLERS; every one is idempotent, bounded, and runs its statements under the lane's database budget.
 */
export const SQUIRE_MEMORY_HANDLERS: Partial<Record<WorkKind, Handler>> = {
  // One coalesced item: a bounded pass over every source kind, then another pass straight away while behind.
  [WORK_KINDS.SYNC_KNOWLEDGE]: async (_item, { settings, signal }) => {
    if (!(await squireKnowledgeEnabled())) return;
    const pass = await syncKnowledgePass(settings, { signal });
    if (pass.more && !signal.aborted)
      await enqueueWorkItems([{ kind: WORK_KINDS.SYNC_KNOWLEDGE, subjectKey: KNOWLEDGE_SUBJECT }]);
  },
  [WORK_KINDS.SQUIRE_PROACTIVE_SCAN]: async (_item, { settings }) => {
    await scanProactiveWork(settings);
  },
  [WORK_KINDS.SQUIRE_PROACTIVE]: async (item, { settings, signal }) => {
    await runProactiveJob(item.subjectKey, item.generation, settings, signal);
  },
};

const schedule = { knowledgeAt: 0, scanAt: 0 };

/** Tests only: forget when work was last scheduled. */
export function resetSquireMemorySchedule(): void {
  schedule.knowledgeAt = 0;
  schedule.scanAt = 0;
}

/**
 * Called once per lane cycle. Costs one small read per interval and enqueues nothing while the knowledge index
 * is off and no service has opted into proactive Squire.
 */
export async function scheduleSquireMemoryWork(
  now: number,
  handlers: Partial<Record<WorkKind, unknown>>
): Promise<void> {
  const due: Array<{ kind: WorkKind; subjectKey: string }> = [];
  if (
    handlers[WORK_KINDS.SYNC_KNOWLEDGE] &&
    now - schedule.knowledgeAt >= KNOWLEDGE_LIMITS.syncIntervalMs
  ) {
    schedule.knowledgeAt = now;
    if (await squireKnowledgeEnabled())
      due.push({ kind: WORK_KINDS.SYNC_KNOWLEDGE, subjectKey: KNOWLEDGE_SUBJECT });
  }
  if (
    handlers[WORK_KINDS.SQUIRE_PROACTIVE_SCAN] &&
    now - schedule.scanAt >= PROACTIVE_LIMITS.scanIntervalMs
  ) {
    schedule.scanAt = now;
    const anyOptedIn = await prisma.squireServicePolicy.findFirst({
      where: {
        OR: [
          { briefingEnabled: true },
          { nudgeAfterMinutes: { not: null } },
          { postmortemDraftEnabled: true },
        ],
      },
      select: { serviceId: true },
    });
    if (anyOptedIn)
      due.push({ kind: WORK_KINDS.SQUIRE_PROACTIVE_SCAN, subjectKey: PROACTIVE_SCAN_SUBJECT });
  }
  if (due.length) await enqueueWorkItems(due);
}
