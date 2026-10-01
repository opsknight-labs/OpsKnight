import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { dashboardUserReadWhere } from '@/lib/authorization-filters';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(req: NextRequest) {
  try {
    const actor = await getCurrentAuthorizationActor();
    const query = (
      req.nextUrl.searchParams.get('q') ||
      req.nextUrl.searchParams.get('search') ||
      ''
    )
      .trim()
      .slice(0, 100);
    const requestedLimit = Number(req.nextUrl.searchParams.get('limit')) || 25;
    const limit = Math.max(1, Math.min(requestedLimit, 50));

    const users = await prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        AND: [
          dashboardUserReadWhere(actor),
          query.length > 0
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { email: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {},
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: limit + 1,
    });

    const hasMore = users.length > limit;
    const resultUsers = hasMore ? users.slice(0, limit) : users;

    return jsonOk(
      { users: resultUsers, hasMore },
      200,
      { 'Cache-Control': 'private, no-store' }
    );
  } catch (error) {
    return jsonError(error);
  }
}
