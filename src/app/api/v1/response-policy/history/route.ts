import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { getClassificationPolicyHistory } from '@/lib/incidents/response-policy';

export async function GET(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
  const resource = request.nextUrl.searchParams.get('resource') ?? 'classification';
  if (!['classification', 'sla', 'support-hours'].includes(resource))
    return jsonError('Invalid policy resource', 400);
  if (!/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/.test(scopeKey))
    return jsonError('Invalid scopeKey', 400);
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') ?? 25)));
  const beforeVersionRaw = request.nextUrl.searchParams.get('beforeVersion');
  const beforeVersion = beforeVersionRaw ? Number(beforeVersionRaw) : undefined;
  if (
    !Number.isInteger(limit) ||
    (beforeVersion !== undefined && (!Number.isInteger(beforeVersion) || beforeVersion <= 0))
  )
    return jsonError('Invalid pagination', 400);
  if (resource !== 'classification' && scopeKey.startsWith('integration:'))
    return jsonError('Invalid scopeKey for policy resource', 400);
  const page = {
    where: {
      scopeKey,
      sealedAt: { not: null },
      ...(beforeVersion ? { version: { lt: beforeVersion } } : {}),
    },
    orderBy: { version: 'desc' as const },
    take: limit,
  };
  const versions =
    resource === 'classification'
      ? await prisma.$transaction(tx =>
          getClassificationPolicyHistory(tx, scopeKey, { limit, beforeVersion })
        )
      : resource === 'sla'
        ? await prisma.incidentSlaPolicy.findMany({ ...page, include: { rules: true } })
        : await prisma.responseSupportHoursPolicy.findMany({
            ...page,
            include: { windows: true, exceptions: true },
          });
  return jsonOk({
    versions,
    nextBeforeVersion: versions.length === limit ? versions.at(-1)!.version : null,
  });
}
