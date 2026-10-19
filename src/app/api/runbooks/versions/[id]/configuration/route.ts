import { z } from 'zod';
import { jsonOk, jsonError } from '@/lib/api-response';
import { assertCapability } from '@/lib/rbac';
import { CAPABILITIES } from '@/lib/authorization';
import prisma from '@/lib/prisma';
import {
  flattenSteps,
  parseRunbookDefinition,
  minimumRiskForStep,
} from '@/lib/runbooks/definition';
import { requiresAgent } from '@/lib/runbooks/types';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await assertCapability(CAPABILITIES.RUNBOOK_READ_ALL);
    const input = z
      .object({ id: z.string().cuid(), runbookId: z.string().cuid() })
      .strict()
      .parse({ ...(await params), runbookId: new URL(request.url).searchParams.get('runbookId') });
    const version = await prisma.runbookVersion.findFirst({
      where: {
        id: input.id,
        runbookId: input.runbookId,
        state: { in: ['PUBLISHED', 'RETIRED'] },
        runbook: { archivedAt: null },
      },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
    if (!version) return jsonError('Version unavailable.', 404);
    const steps = flattenSteps(parseRunbookDefinition(version.definition, version.inputs));
    return jsonOk({
      id: version.id,
      inputs: version.inputs,
      hasAgentWrite: steps.some(
        step => requiresAgent(step.type) && minimumRiskForStep(step) !== 'READ_ONLY'
      ),
    });
  } catch {
    return jsonError('Version configuration unavailable or access denied.', 403);
  }
}
