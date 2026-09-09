import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { diffClassificationPolicies } from '@/lib/incidents/response-policy';

export async function GET(request: NextRequest) {
  if (!(await authorizeResponsePolicyApi(request, 'read'))) return jsonError('Unauthorized', 401);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
  const from = Number(request.nextUrl.searchParams.get('from'));
  const to = Number(request.nextUrl.searchParams.get('to'));
  if (
    !/^(workspace|service:[A-Za-z0-9_-]+|integration:[A-Za-z0-9_-]+)$/.test(scopeKey) ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to)
  )
    return jsonError('Invalid diff query', 400);
  const versions = await prisma.incidentClassificationPolicy.findMany({
    where: { scopeKey, version: { in: [from, to] }, sealedAt: { not: null } },
    include: { rules: true },
  });
  const before = versions.find(version => version.version === from);
  const after = versions.find(version => version.version === to);
  if (!before || !after) return jsonError('Policy version not found', 404);
  return jsonOk({ changes: diffClassificationPolicies(before, after) });
}
