import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { explainIncidentResponsePolicy } from '@/lib/incidents/response-policy';

export async function POST(request: NextRequest) {
  if (!(await authorizeResponsePolicyApi(request, 'read'))) return jsonError('Unauthorized', 401);
  try {
    const body = await request.json();
    const result = await prisma.$transaction(tx => explainIncidentResponsePolicy(tx, body));
    return jsonOk(result);
  } catch {
    return jsonError('Invalid response-policy preview request', 400);
  }
}
