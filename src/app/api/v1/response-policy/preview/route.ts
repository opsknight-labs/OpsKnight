import type { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { authorizeResponsePolicyApi } from '@/lib/response-policy-api-auth';
import { explainIncidentResponsePolicy } from '@/lib/incidents/response-policy';
import { responsePolicyError } from '@/lib/response-policy-http';

export async function POST(request: NextRequest) {
  const auth = await authorizeResponsePolicyApi(request, 'read');
  if (!auth.ok) return jsonError(auth.message, auth.status);
  try {
    const body = await request.json();
    const result = await prisma.$transaction(tx => explainIncidentResponsePolicy(tx, body));
    return jsonOk(result);
  } catch (error) {
    return responsePolicyError(error, 'Invalid response-policy preview request');
  }
}
