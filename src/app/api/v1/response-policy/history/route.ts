import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { getClassificationPolicyHistory } from '@/lib/incidents/response-policy';

export async function GET(request: NextRequest) {
  if (!(await authorizeResponsePolicyApi(request, 'read'))) return jsonError('Unauthorized', 401);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
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
  const versions = await prisma.$transaction(tx =>
    getClassificationPolicyHistory(tx, scopeKey, { limit, beforeVersion })
  );
  return jsonOk({
    versions,
    nextBeforeVersion: versions.length === limit ? versions.at(-1)!.version : null,
  });
}
