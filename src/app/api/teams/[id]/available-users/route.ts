import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { assertResponderOrAbove } from '@/lib/rbac';
import { logger, withRequestContext } from '@/lib/logger';

const MAX_RESULTS = 50;

async function getAvailableUsers(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await assertResponderOrAbove();
    const { id: teamId } = await params;
    const query = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 100);
    const requestedLimit = Number(req.nextUrl.searchParams.get('limit')) || 20;
    const limit = Math.max(1, Math.min(requestedLimit, MAX_RESULTS));

    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) return jsonError('Team not found', 404);

    const users = await prisma.user.findMany({
      where: {
        status: { not: 'DISABLED' },
        teamMemberships: { none: { teamId } },
        ...(query.length > 0
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' as const } },
                { email: { contains: query, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: limit + 1,
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        avatarUrl: true,
        gender: true,
      },
    });

    return jsonOk({ users: users.slice(0, limit), hasMore: users.length > limit });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to search users';
    logger.error('team.available_users.search_failed', { error: message });
    if (message.startsWith('Unauthorized')) return jsonError(message, 403);
    return jsonError('Unable to search the user directory', 500);
  }
}

export const GET = withRequestContext(getAvailableUsers, 'api.teams.available-users');
