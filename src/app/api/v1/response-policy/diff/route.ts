import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { diffClassificationPolicies } from '@/lib/incidents/response-policy';

export async function GET(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
  const resource = request.nextUrl.searchParams.get('resource') ?? 'classification';
  const from = Number(request.nextUrl.searchParams.get('from'));
  const to = Number(request.nextUrl.searchParams.get('to'));
  if (
    !/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/.test(scopeKey) ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    !['classification', 'sla', 'support-hours'].includes(resource)
  )
    return jsonError('Invalid diff query', 400);
  if (resource !== 'classification' && scopeKey.startsWith('integration:'))
    return jsonError('Invalid scopeKey for policy resource', 400);
  const where = { scopeKey, version: { in: [from, to] }, sealedAt: { not: null } };
  const versions =
    resource === 'classification'
      ? await prisma.incidentClassificationPolicy.findMany({ where, include: { rules: true } })
      : resource === 'sla'
        ? await prisma.incidentSlaPolicy.findMany({ where, include: { rules: true } })
        : await prisma.responseSupportHoursPolicy.findMany({
            where,
            include: { windows: true, exceptions: true },
          });
  const before = versions.find(version => version.version === from);
  const after = versions.find(version => version.version === to);
  if (!before || !after) return jsonError('Policy version not found', 404);
  if (resource === 'classification')
    return jsonOk({ changes: diffClassificationPolicies(before as never, after as never) });
  const omitMetadata = (value: Record<string, unknown>) => {
    const {
      id: _id,
      version: _version,
      createdAt: _createdAt,
      createdById: _createdById,
      sealedAt: _sealedAt,
      ...behavior
    } = value;
    return behavior;
  };
  return jsonOk({
    changes: [{ field: resource, from: omitMetadata(before), to: omitMetadata(after) }],
  });
}
