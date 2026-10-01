import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  SCIM_LIST_SCHEMA,
  isScimRequestAuthorized,
  parseScimGroupFilter,
  scimError,
  serializeScimGroup,
} from '@/lib/scim';

async function authorized(request: NextRequest): Promise<boolean> {
  return await isScimRequestAuthorized(request.headers.get('authorization'));
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  try {
    const filter = parseScimGroupFilter(request.nextUrl.searchParams.get('filter'));
    const startIndex = Math.max(1, Number(request.nextUrl.searchParams.get('startIndex')) || 1);
    const count = Math.min(
      100,
      Math.max(1, Number(request.nextUrl.searchParams.get('count')) || 100)
    );

    const where = filter ? filter : {};
    const [teams, totalResults] = await prisma.$transaction([
      prisma.team.findMany({
        where,
        include: {
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
        skip: startIndex - 1,
        take: count,
        orderBy: { id: 'asc' },
      }),
      prisma.team.count({ where }),
    ]);

    const baseUrl = request.nextUrl.origin;
    return Response.json(
      {
        schemas: [SCIM_LIST_SCHEMA],
        totalResults,
        startIndex,
        itemsPerPage: teams.length,
        Resources: teams.map(team => serializeScimGroup(team, baseUrl)),
      },
      {
        headers: {
          'Content-Type': 'application/scim+json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (error) {
    return scimError(
      400,
      error instanceof Error ? error.message : 'Invalid SCIM request.',
      'invalidFilter'
    );
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';
  const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : '';

  if (!displayName) {
    return scimError(400, 'displayName is required.', 'invalidValue');
  }
  if (displayName.length > 100) {
    return scimError(400, 'displayName must not exceed 100 characters.', 'invalidValue');
  }

  const collisionWhere = externalId
    ? { OR: [{ name: displayName }, { scimExternalId: externalId }] }
    : { name: displayName };

  const collision = await prisma.team.findFirst({
    where: collisionWhere,
    select: { id: true },
  });
  if (collision) {
    return scimError(
      409,
      'A group with this displayName or externalId already exists.',
      'uniqueness'
    );
  }

  try {
    const team = await prisma.$transaction(async tx => {
      const created = await tx.team.create({
        data: {
          name: displayName,
          scimExternalId: externalId || null,
          description: 'Provisioned via SCIM 2.0',
        },
      });

      if (Array.isArray(body?.members)) {
        for (const m of body.members as Array<unknown>) {
          const rawVal =
            typeof m === 'object' && m !== null && 'value' in m
              ? (m as { value?: unknown }).value
              : m;
          const userId = typeof rawVal === 'string' ? rawVal.trim() : null;
          if (userId) {
            const user = await tx.user.findFirst({
              where: {
                OR: [{ id: userId }, { scimExternalId: userId }],
              },
              select: { id: true },
            });
            if (user) {
              await tx.teamMember.create({
                data: {
                  teamId: created.id,
                  userId: user.id,
                  role: 'MEMBER',
                },
              });
            }
          }
        }
      }

      return tx.team.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          members: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    });

    await logAudit({
      action: 'scim.group.created',
      entityType: 'TEAM',
      entityId: team.id,
      source: 'INTEGRATION',
      details: {
        displayName,
        externalId: externalId || null,
        memberCount: team.members.length,
      },
    });

    const baseUrl = request.nextUrl.origin;
    const location = `${baseUrl}/api/scim/v2/Groups/${team.id}`;
    return Response.json(serializeScimGroup(team, baseUrl), {
      status: 201,
      headers: {
        'Content-Type': 'application/scim+json; charset=utf-8',
        'Cache-Control': 'no-store',
        Location: location,
      },
    });
  } catch (error) {
    return scimError(
      500,
      error instanceof Error ? error.message : 'Internal error creating SCIM group.'
    );
  }
}
