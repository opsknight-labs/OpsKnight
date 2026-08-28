import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { authenticateApiKey } from '@/lib/api-auth';
import { jsonError, jsonOk } from '@/lib/api-response';
import { resolveApiKeyActor } from '@/lib/authorization-actors';
import { serviceReadWhere } from '@/lib/authorization-filters';

function parseLimit(value: string | null) {
  const limit = Number(value);
  if (Number.isNaN(limit) || limit <= 0) return 50;
  return Math.min(limit, 200);
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = await authenticateApiKey(req);
    if (!apiKey) {
      return jsonError('Unauthorized. Missing or invalid API key.', 401);
    }

    const { checkRateLimit } = await import('@/lib/rate-limit');
    const rate = await checkRateLimit(`api:${apiKey.id}:services:list`, 60, 60_000);
    if (!rate.allowed) {
      const retryAfter = Math.ceil((rate.resetAt - Date.now()) / 1000);
      return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
      });
    }
    const { searchParams } = new URL(req.url);
    const limit = parseLimit(searchParams.get('limit'));
    const actor = await resolveApiKeyActor(apiKey);
    if (!actor) return jsonError('Unauthorized.', 401);
    let accessFilter;
    try {
      accessFilter = serviceReadWhere(actor);
    } catch {
      return jsonError('Forbidden. Service access denied.', 403);
    }

    const services = await prisma.service.findMany({
      where: accessFilter,
      orderBy: { createdAt: 'desc' },
      take: limit,
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

    return jsonOk({ services });
  } catch (_error) {
    return jsonError('Internal Server Error', 500);
  }
}
