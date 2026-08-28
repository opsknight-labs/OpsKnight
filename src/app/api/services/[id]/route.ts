import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return jsonError('Unauthorized. Missing or invalid API key.', 401);
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
    const actor = await resolveApiKeyActor(apiKey);
    if (!actor) return jsonError('Unauthorized.', 401);
    let accessFilter;
    try {
      accessFilter = serviceReadWhere(actor);
    } catch {
      return jsonError('Forbidden. Service access denied.', 403);
    }
    const service = await prisma.service.findFirst({
      where: { id, ...accessFilter },
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
