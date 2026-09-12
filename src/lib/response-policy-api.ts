import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveClassificationPolicy } from '@/lib/incidents/classification-policy';
import { getClassificationPolicyHistory } from '@/lib/incidents/response-policy';
import { responsePolicyError } from '@/lib/response-policy-http';

export async function readScopedPolicy(request: NextRequest, scopeKey: string) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  if (scopeKey.startsWith('service:')) {
    const exists = await prisma.service.findUnique({
      where: { id: scopeKey.slice(8) },
      select: { id: true },
    });
    if (!exists) return jsonError('Service not found', 404);
  }
  if (scopeKey.startsWith('integration:')) {
    const exists = await prisma.integration.findUnique({
      where: { id: scopeKey.slice(12) },
      select: { id: true },
    });
    if (!exists) return jsonError('Integration not found', 404);
  }
  const history = await prisma.$transaction(tx => getClassificationPolicyHistory(tx, scopeKey));
  const response = jsonOk({ policy: history[0] ?? null });
  if (history[0]) response.headers.set('ETag', `"${history[0].version}"`);
  return response;
}

export async function writeScopedPolicy(request: NextRequest, scopeKey: string) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const version = request.headers.get('if-match')?.replaceAll('"', '');
  if (!version || !/^\d+$/.test(version)) return jsonError('If-Match version is required', 428);
  try {
    const body = await request.json();
    const policy = await saveClassificationPolicy(
      { ...body, scopeKey, expectedVersion: Number(version) },
      'API',
      { actorId: auth.actor.id, capabilities: ['admin.manage'], source: 'API' }
    );
    return jsonOk({ policy }, 201, { ETag: `"${policy.version}"` });
  } catch (error) {
    return responsePolicyError(error, 'Invalid response policy');
  }
}
