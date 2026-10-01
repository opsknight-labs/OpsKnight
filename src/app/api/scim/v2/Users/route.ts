import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  SCIM_LIST_SCHEMA,
  isScimRequestAuthorized,
  parseScimFilter,
  scimError,
  serializeScimUser,
} from '@/lib/scim';

const select = {
  id: true,
  scimExternalId: true,
  email: true,
  name: true,
  avatarUrl: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function authorized(request: NextRequest): Promise<boolean> {
  return await isScimRequestAuthorized(request.headers.get('authorization'));
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  try {
    const filter = parseScimFilter(request.nextUrl.searchParams.get('filter'));
    const startIndex = Math.max(1, Number(request.nextUrl.searchParams.get('startIndex')) || 1);
    const count = Math.min(
      100,
      Math.max(1, Number(request.nextUrl.searchParams.get('count')) || 100)
    );
    // Collection search must expose only resources managed through SCIM. A
    // matching local/OIDC email must not produce an ID that the resource route
    // subsequently rejects, nor silently authorize SCIM to adopt the account.
    const where = filter
      ? { AND: [{ scimExternalId: { not: null } }, filter] }
      : { scimExternalId: { not: null } };
    const [users, totalResults] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select,
        skip: startIndex - 1,
        take: count,
        orderBy: { id: 'asc' },
      }),
      prisma.user.count({ where }),
    ]);
    return Response.json({
      schemas: [SCIM_LIST_SCHEMA],
      totalResults,
      startIndex,
      itemsPerPage: users.length,
      Resources: users.map(serializeScimUser),
    });
  } catch (error) {
    return scimError(400, error instanceof Error ? error.message : 'Invalid SCIM request.');
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.userName === 'string' ? body.userName.trim().toLowerCase() : '';
  const externalId = typeof body?.externalId === 'string' ? body.externalId.trim() : '';

  let displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';

  // Handle SCIM name object ({ formatted, givenName, familyName })
  if (!displayName && typeof body?.name === 'object' && body.name !== null) {
    const nameObj = body.name as Record<string, unknown>;
    if (typeof nameObj.formatted === 'string' && nameObj.formatted.trim()) {
      displayName = nameObj.formatted.trim();
    } else {
      const given = typeof nameObj.givenName === 'string' ? nameObj.givenName.trim() : '';
      const family = typeof nameObj.familyName === 'string' ? nameObj.familyName.trim() : '';
      displayName = [given, family].filter(Boolean).join(' ');
    }
  }

  const resolvedName = displayName || (email.includes('@') ? email.split('@')[0] : email);

  if (!email || !externalId || !/^\S+@\S+\.\S+$/.test(email)) {
    return scimError(400, 'userName email and externalId are required.');
  }
  const collision = await prisma.user.findFirst({
    where: { OR: [{ email }, { scimExternalId: externalId }] },
    select: { id: true },
  });
  if (collision) return scimError(409, 'A user with this userName or externalId already exists.');

  // Extract photo if passed in SCIM payload
  let avatarUrl: string | null = null;
  if (Array.isArray(body?.photos)) {
    const photoObj =
      body.photos.find(
        (p: unknown) =>
          typeof p === 'object' &&
          p !== null &&
          ('type' in p ? (p as { type: unknown }).type === 'photo' : false)
      ) ?? body.photos[0];
    if (
      typeof photoObj === 'object' &&
      photoObj !== null &&
      'value' in photoObj &&
      typeof (photoObj as { value: unknown }).value === 'string' &&
      /^https?:\/\//i.test((photoObj as { value: string }).value)
    ) {
      avatarUrl = (photoObj as { value: string }).value.trim();
    }
  }

  // Generate deterministic default avatar if no IdP photo was provided
  if (!avatarUrl) {
    avatarUrl = getDefaultAvatar(resolvedName, externalId);
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: resolvedName,
      avatarUrl,
      scimExternalId: externalId,
      role: 'USER',
      roleSource: 'SCIM',
      status: body?.active === false ? 'DISABLED' : 'ACTIVE',
    },
    select,
  });
  await logAudit({
    action: 'scim.user.provisioned',
    entityType: 'USER',
    entityId: user.id,
    source: 'INTEGRATION',
    details: { externalId, active: user.status !== 'DISABLED' },
  });
  return Response.json(serializeScimUser(user), { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!(await authorized(request))) return scimError(401, 'Invalid SCIM bearer token.');
  return scimError(405, 'PATCH requires a user resource URL.');
}
