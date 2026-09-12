import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { saveIncidentSlaPolicy } from '@/lib/incident-sla/policy-config';
import { responsePolicyError } from '@/lib/response-policy-http';

const validScope = /^(workspace|service:[A-Za-z0-9_-]+)$/;

export async function GET(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const scopeKey = request.nextUrl.searchParams.get('scopeKey') ?? 'workspace';
  if (!validScope.test(scopeKey)) return jsonError('Invalid scopeKey', 400);
  const policy = await prisma.incidentSlaPolicy.findFirst({
    where: { scopeKey, sealedAt: { not: null } },
    orderBy: { version: 'desc' },
    include: { rules: true },
  });
  const response = jsonOk({ policy });
  if (policy) response.headers.set('ETag', `"${policy.version}"`);
  return response;
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'write');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  const expected = request.headers.get('if-match')?.replaceAll('"', '');
  if (!expected || !/^\d+$/.test(expected)) return jsonError('If-Match version is required', 428);
  try {
    const body = await request.json();
    const policy = await saveIncidentSlaPolicy(
      { ...body, expectedVersion: Number(expected) },
      { actorId: auth.actor.id, capabilities: ['admin.manage'], source: 'API' }
    );
    return jsonOk({ policy }, 201, { ETag: `"${policy.version}"` });
  } catch (error) {
    return responsePolicyError(error, 'Invalid SLA policy');
  }
}
