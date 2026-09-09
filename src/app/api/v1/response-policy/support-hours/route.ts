import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveSupportHoursPolicy } from '@/lib/incidents/support-hours-policy';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';

export async function GET(request: NextRequest) {
  if (!(await authorizeResponsePolicyApi(request, 'read'))) return jsonError('Unauthorized', 401);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
  if (!/^(workspace|service:[A-Za-z0-9_-]+)$/.test(scopeKey))
    return jsonError('Invalid scopeKey', 400);
  const policy = await prisma.responseSupportHoursPolicy.findFirst({
    where: { scopeKey, sealedAt: { not: null } },
    orderBy: { version: 'desc' },
    include: { windows: true, exceptions: true },
  });
  const response = jsonOk({ policy });
  if (policy) response.headers.set('ETag', `"${policy.version}"`);
  return response;
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth) return jsonError('Unauthorized', 401);
  const expected = request.headers.get('if-match')?.replaceAll('"', '');
  if (!expected || !/^\d+$/.test(expected)) return jsonError('If-Match version is required', 428);
  try {
    const body = await request.json();
    const policy = await saveSupportHoursPolicy(
      { ...body, expectedVersion: Number(expected) },
      auth.actor.id
    );
    return jsonOk({ policy }, 201, { ETag: `"${policy.version}"` });
  } catch (error) {
    if (error instanceof IncidentResponsePolicyError && error.code === 'CONFLICT')
      return jsonError('Policy version conflict', 409);
    return jsonError('Invalid support-hours policy', 400);
  }
}
