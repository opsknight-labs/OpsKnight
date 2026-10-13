import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import {
  apiV2Error,
  apiV2Success,
  authenticateV2Request,
  enforceV2Authorization,
  enforceV2RateLimit,
} from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.RUNBOOK_READ);

    const { id } = await params;
    const runbook = await prisma.runbook.findUnique({
      where: { id },
      include: {
        publishedVersion: true,
      },
    });

    if (!runbook || runbook.archivedAt) {
      throw new AppError({
        code: 'RUNBOOK_NOT_FOUND',
        userMessage: `Runbook with id '${id}' was not found.`,
      });
    }

    const steps = (runbook.publishedVersion?.definition as { steps?: unknown[] })?.steps ?? [];

    const dto = {
      id: runbook.id,
      name: runbook.name,
      slug: runbook.slug,
      description: runbook.description,
      version: runbook.publishedVersion?.version ?? 1,
      steps,
      createdAt: runbook.createdAt,
      updatedAt: runbook.updatedAt,
    };

    return apiV2Success(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
}
