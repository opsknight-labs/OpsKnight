import 'server-only';
import prisma from '@/lib/prisma';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

let emptyUntil = 0;
let probe: Promise<boolean> | null = null;
/** Negative-only, one-second process-local hint. Every real claim still performs all live fences. */
export async function mayHaveAgentWork(): Promise<boolean> {
  if (Date.now() < emptyUntil) return false;
  if (probe) return probe;
  probe = (async () => {
    const now = new Date();
    const work = await prisma.runbookStepAttempt.findFirst({
      where: {
        status: 'PENDING',
        availableAt: { lte: now },
        claimDeadlineAt: { gt: now },
        executionStep: {
          execution: {
            status: { in: ['RUNNING', 'WAITING_AGENT'] },
            cancelRequestedAt: null,
            deadlineAt: { gt: now },
          },
        },
      },
      select: { id: true },
    });
    addOperationalMetric('opsknight_runbook_claim_availability_probes_total', 1, {
      result: work ? 'work' : 'empty',
    });
    if (!work) emptyUntil = Date.now() + 1000;
    return Boolean(work);
  })();
  try {
    return await probe;
  } finally {
    probe = null;
  }
}
