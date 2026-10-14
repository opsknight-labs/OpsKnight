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
import { withV2Observability } from '@/lib/api-v2/observability';

export const GET = withV2Observability(async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { apiKey, actor } = await authenticateV2Request(req);
    const rlHeaders = await enforceV2RateLimit(apiKey.id, 'READ');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.USER_READ);

    const { id } = await params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        timeZone: true,
        department: true,
        jobTitle: true,
        createdAt: true,
        teamMemberships: {
          select: {
            team: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!user) {
      throw new AppError({
        code: 'USER_NOT_FOUND',
        userMessage: `User with id '${id}' was not found.`,
      });
    }

    const dto = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      timeZone: user.timeZone,
      department: user.department,
      jobTitle: user.jobTitle,
      createdAt: user.createdAt,
      teams: user.teamMemberships.map(tm => tm.team),
    };

    return apiV2Success(dto, { headers: rlHeaders });
  } catch (error) {
    return apiV2Error(error, req);
  }
});
