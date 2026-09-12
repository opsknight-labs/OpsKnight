import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveClassificationPolicy } from '@/lib/incidents/classification-policy';
import { getClassificationPolicyHistory } from '@/lib/incidents/response-policy';
import { responsePolicyError } from '@/lib/response-policy-http';

export async function GET(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const history = await prisma.$transaction(tx => getClassificationPolicyHistory(tx, 'workspace'));
  const response = jsonOk({ policy: history[0] ?? null });
  if (history[0]) response.headers.set('ETag', `"${history[0].version}"`);
  return response;
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const expected = request.headers.get('if-match')?.replaceAll('"', '');
  if (!expected || !/^\d+$/.test(expected)) return jsonError('If-Match version is required', 428);
  try {
    const body = await request.json();
    const policy = await saveClassificationPolicy(
      { ...body, scopeKey: 'workspace', expectedVersion: Number(expected) },
      'API',
      { actorId: auth.actor.id, capabilities: ['admin.manage'], source: 'API' }
    );
    return jsonOk({ policy }, 201, { ETag: `"${policy.version}"` });
  } catch (error) {
    return responsePolicyError(error, 'Invalid response policy');
  }
}
