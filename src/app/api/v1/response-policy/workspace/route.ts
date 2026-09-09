import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveClassificationPolicy } from '@/lib/incidents/classification-policy';
import { getClassificationPolicyHistory } from '@/lib/incidents/response-policy';
import { IncidentResponsePolicyError } from '@/lib/incident-sla/policy-config';

export async function GET(request: NextRequest) {
  if (!(await authorizeResponsePolicyApi(request, 'read'))) return jsonError('Unauthorized', 401);
  const history = await prisma.$transaction(tx => getClassificationPolicyHistory(tx, 'workspace'));
  const response = jsonOk({ policy: history[0] ?? null });
  if (history[0]) response.headers.set('ETag', `"${history[0].version}"`);
  return response;
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth) return jsonError('Unauthorized', 401);
  const expected = request.headers.get('if-match')?.replaceAll('"', '');
  if (!expected || !/^\d+$/.test(expected)) return jsonError('If-Match version is required', 428);
  try {
    const body = await request.json();
    const policy = await saveClassificationPolicy(
      { ...body, scopeKey: 'workspace', expectedVersion: Number(expected) },
      'API',
      auth.actor.id
    );
    return jsonOk({ policy }, 201, { ETag: `"${policy.version}"` });
  } catch (error) {
    if (error instanceof IncidentResponsePolicyError && error.code === 'CONFLICT')
      return jsonError('Policy version conflict', 409);
    return jsonError('Invalid response policy', 400);
  }
}
