import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey, hasApiScopes } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return jsonError('Unauthorized. Missing or invalid API key.', 401);
    }
    if (!hasApiScopes(apiKey.scopes, ['services:read'])) {
      return jsonError('API key missing scope: services:read.', 403);
    }

    const { checkRateLimit } = await import('@/lib/rate-limit');
    const rate = await checkRateLimit(`api:${apiKey.id}:services:get`, 60, 60_000);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
      });
    }
    const { id } = await params;
    const apiUser = await prisma.user.findUnique({
      where: { id: apiKey.userId },
      select: { role: true, status: true, teamMemberships: { select: { teamId: true } } },
    });
    if (!apiUser || apiUser.status !== 'ACTIVE') return jsonError('Unauthorized.', 401);
    const hasGlobalRead = apiUser.role === 'ADMIN' || apiUser.role === 'RESPONDER';
    const teamIds = apiUser.teamMemberships.map(membership => membership.teamId);
    const service = await prisma.service.findFirst({
      where: { id, ...(hasGlobalRead ? {} : { teamId: { in: teamIds } }) },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        teamId: true,
        escalationPolicyId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!service) {
      return jsonError('Service not found.', 404);
    }

    return jsonOk({ service });
  } catch (_error) {
    return jsonError('Internal Server Error', 500);
  }
}
